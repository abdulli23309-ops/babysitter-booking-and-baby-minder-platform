<#
.SYNOPSIS
  Little Care - one-command LAN development environment for babysitter monitoring.

.DESCRIPTION
  THE SINGLE SOURCE OF TRUTH for the Little Care development LAN/media address.

  Problem this solves
  -------------------
  The LAN IP of the development machine changes with DHCP. That address used to be
  hard-coded, by hand, in THREE independent places:

      1. E:\MiroTalkPOC\.env                        -> SFU_ANNOUNCED_IP
      2. WebApplication2\Web.MonitoringMedia.config -> MonitoringMediaServerUrl
      3. E:\MiroTalkPOC\app\ssl\cert.pem            -> TLS SAN (used by BOTH the
                                                       Vite dev server and MiroTalk)

  When DHCP moved the address all three went stale at once, and monitoring broke
  in three different ways (cert warning -> no camera/mic, dead iframe host, dead
  WebRTC ICE candidate). This script removes the manual step: it discovers the
  address once and feeds it into every consumer.

  What it does
  ------------
   1. Detects the ACTIVE LAN IPv4 (the interface that owns the default route).
   2. Validates that it is a private RFC1918 address.
   3. Regenerates the development TLS LEAF certificate with that address in its
      Subject Alternative Name, signed by the EXISTING local CA. The CA never
      changes, so a phone that already trusts the CA keeps trusting every newly
      issued leaf - an IP change needs no re-trust on the phone.
   4. Writes SFU_ANNOUNCED_IP into the MiroTalk .env.
   5. Writes MonitoringMediaServerUrl into the backend Web.MonitoringMedia.config
      (room salt and enable switch preserved untouched).
   6. Ensures the minimum inbound firewall rules for the LAN demo (optional).
   7. Starts MiroTalk, the ASP.NET backend and the Vite dev server (optional).
   8. Prints the addresses a phone should use.

  It is idempotent: run it every day; when nothing changed it does nothing.

.NOTES
  Development / LAN only. Never disables TLS verification, never disables the
  firewall, never widens CORS, never invents a hostname. Does not touch the
  database, the EDMX, monitoring authorization or MiroTalk room derivation.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1 -ConfigureOnly

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1 -ConfigureOnly -LanIp 192.168.1.42
#>
[CmdletBinding()]
param(
    # Override the auto-detected LAN address. Use only to test the pipeline.
    [string]$LanIp,

    # Configure the certificate and files, but do not start or stop any service.
    [switch]$ConfigureOnly,

    # Do not create/repair the Windows Firewall rules (needs elevation anyway).
    [switch]$SkipFirewall,

    # Reuse already-running services instead of restarting them where possible.
    [switch]$NoRestart,

    # MiroTalk deployment root (contains .env and app\ssl).
    [string]$MiroTalkRoot = 'E:\MiroTalkPOC',

    # MiroTalk HTTPS port (server + WebRTC signalling).
    [int]$MediaPort = 3010,

    # Vite dev server HTTPS port (the frontend phones open).
    [int]$FrontendPort = 5173,

    # IIS Express HTTPS port the Vite proxy targets (PC-local only).
    [int]$BackendHttpsPort = 44368,

    # WebRTC RTP port range announced by the SFU.
    [int]$RtpMinPort = 40000,
    [int]$RtpMaxPort = 40100
)

Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Paths - the ONE place the development addresses and file locations live.
# ---------------------------------------------------------------------------
$script:RepoRoot     = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:BackendDir   = Join-Path $script:RepoRoot 'WebApplication2'
$script:FrontendDir  = Join-Path $script:RepoRoot 'babysitter-app'
$script:MediaConfig  = Join-Path $script:BackendDir 'Web.MonitoringMedia.config'
$script:MiroTalkRoot = $MiroTalkRoot
$script:MiroTalkEnv  = Join-Path $MiroTalkRoot '.env'
$script:SslDir       = Join-Path $MiroTalkRoot 'app\ssl'
$script:CaCert       = Join-Path $script:SslDir 'ca.crt'
$script:CaKey        = Join-Path $script:SslDir 'ca.key'
$script:LeafCert     = Join-Path $script:SslDir 'cert.pem'
$script:LeafKey      = Join-Path $script:SslDir 'key.pem'
$script:ServerCnf    = Join-Path $script:SslDir 'server.cnf'

# ---------------------------------------------------------------------------
# Small output helpers
# ---------------------------------------------------------------------------
function Write-Step  { param([string]$Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Text) Write-Host "    [ok] $Text" -ForegroundColor Green }
function Write-Warn2 { param([string]$Text) Write-Host "    [warn] $Text" -ForegroundColor Yellow }
function Write-Skip  { param([string]$Text) Write-Host "    [--] $Text" -ForegroundColor DarkGray }

function Test-IsElevated {
    return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------------------------------------------------------------------------
# RFC1918 validation - we only ever publish a private LAN address.
# ---------------------------------------------------------------------------
function Test-PrivateLanIPv4 {
    param([string]$Address)
    $ip = $null
    if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$ip)) { return $false }
    $b = $ip.GetAddressBytes()
    if ($b[0] -eq 10) { return $true }                                       # 10.0.0.0/8
    if ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) { return $true }  # 172.16/12
    if ($b[0] -eq 192 -and $b[1] -eq 168) { return $true }                   # 192.168/16
    return $false
}

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# LAN address discovery - derive the address from the LIVE interface, never
# from a stored value.
# ---------------------------------------------------------------------------
function Get-LittleCareLanIPv4 {
    $found = New-Object System.Collections.Generic.List[object]

    # (1) Preferred: the interface that owns the IPv4 default route.
    $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
        Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' }
    foreach ($r in $routes) {
        $addrs = Get-NetIPAddress -InterfaceIndex $r.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.AddressState -eq 'Preferred' -and
                $_.IPAddress -ne '127.0.0.1' -and
                $_.IPAddress -notlike '169.254.*'
            }
        foreach ($a in $addrs) {
            $found.Add([pscustomobject]@{ IP = $a.IPAddress; Interface = $r.InterfaceAlias; Reason = 'default-route' })
        }
    }

    # (2) Fallback: any preferred IPv4 on a physical adapter that is up.
    if ($found.Count -eq 0) {
        $upIndexes = @((Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
            Where-Object { $_.Status -eq 'Up' }).ifIndex)
        foreach ($a in (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' })) {
            if ($upIndexes -contains $a.InterfaceIndex) {
                $found.Add([pscustomobject]@{ IP = $a.IPAddress; Interface = $a.InterfaceAlias; Reason = 'adapter-up' })
            }
        }
    }

    $private = $found | Where-Object { Test-PrivateLanIPv4 $_.IP } | Select-Object -First 1
    if ($null -eq $private) {
        throw ("Could not determine a private LAN IPv4 address. Candidates: " +
               (($found | ForEach-Object { "$($_.IP) [$($_.Interface)]" }) -join ', '))
    }
    return $private
}



# ---------------------------------------------------------------------------
# Utility: write a text file without a UTF-8 BOM (IIS Express and OpenSSL read
# these files more predictably without one).
# ---------------------------------------------------------------------------
function Write-TextNoBom {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------------------
# OpenSSL discovery. Git for Windows ships a suitable build.
# ---------------------------------------------------------------------------
function Get-OpenSslPath {
    $cmd = Get-Command openssl -ErrorAction SilentlyContinue
    if ($cmd -and (Test-Path $cmd.Source)) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe'),
        (Join-Path $env:ProgramFiles 'Git\mingw64\bin\openssl.exe'),
        'C:\Program Files\Git\usr\bin\openssl.exe',
        (Join-Path ${env:ProgramFiles(x86)} 'Git\usr\bin\openssl.exe')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

# ---------------------------------------------------------------------------
# Read the certificate's identity + IPv4 SAN entries (used for idempotency).
# ---------------------------------------------------------------------------
function Get-LeafCertificateInfo {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($Path)
    } catch {
        return $null
    }
    $sanIps = @()
    $sanExt = $c.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' }
    if ($sanExt) {
        $text = $sanExt.Format($false)
        $sanIps = @([regex]::Matches($text, 'IP Address=([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)') |
            ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
    }
    return [pscustomobject]@{
        Subject  = $c.Subject
        Issuer   = $c.Issuer
        NotAfter = $c.NotAfter
        SanIps   = $sanIps
    }
}

# ---------------------------------------------------------------------------
# Run OpenSSL and return its exit code. OpenSSL writes routine progress text to
# stderr; with $ErrorActionPreference='Stop' PowerShell would turn that into a
# terminating NativeCommandError, so the preference is relaxed for the call and
# the exit code is checked by the caller instead.
# ---------------------------------------------------------------------------
function Invoke-OpenSsl {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $openssl = Get-OpenSslPath
    if (-not $openssl) { throw 'OpenSSL not found.' }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $openssl @Arguments 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
}

# ---------------------------------------------------------------------------
# Regenerate the development LEAF certificate for the given LAN address.
#
#   * The CA (ca.crt/ca.key) is REUSED, never regenerated. That is what keeps a
#     phone trusting the new leaf automatically after an IP change.
#   * SAN always keeps 127.0.0.1 and localhost so PC-local HTTPS keeps working.
#   * Idempotent: if the current leaf already carries this IP, is signed by our
#     CA and is not close to expiry, nothing is written.
# ---------------------------------------------------------------------------
function Set-LittleCareDevCertificate {
    param([string]$Address, [switch]$Force)

    $openssl = Get-OpenSslPath
    if (-not $openssl) {
        throw "OpenSSL was not found. Install Git for Windows (which bundles it) or add openssl to PATH."
    }
    foreach ($f in @($script:CaCert, $script:CaKey)) {
        if (-not (Test-Path $f)) {
            throw "Development CA is missing: $f. Generate it once (see docs\development\LAN_DEVELOPMENT.md); this script never replaces a trusted CA."
        }
    }

    $info = Get-LeafCertificateInfo -Path $script:LeafCert
    if (-not $Force -and $info) {
        $hasIp    = $info.SanIps -contains $Address
        $hasLocal = ($info.SanIps -contains '127.0.0.1')
        $caIssuer = ([string]$info.Issuer -match 'Little Care FYP Dev CA')
        $fresh    = ($info.NotAfter -gt (Get-Date).AddDays(30))
        if ($hasIp -and $hasLocal -and $caIssuer -and $fresh) {
            Write-Skip "Leaf certificate already covers $Address (expires $($info.NotAfter.ToString('yyyy-MM-dd')))."
            return $false
        }
    }

    # Preserve the previous leaf before overwriting it (matches the existing
    # cert.pem.old-<ip> convention so a rollback is always possible).
    if ($info) {
        $oldIp = ($info.SanIps | Where-Object { $_ -ne '127.0.0.1' } | Select-Object -First 1)
        $tag = if ($oldIp) { $oldIp } else { 'unknown' }
        Copy-Item $script:LeafCert (Join-Path $script:SslDir "cert.pem.old-$tag") -Force -ErrorAction SilentlyContinue
        Copy-Item $script:LeafKey  (Join-Path $script:SslDir "key.pem.old-$tag")  -Force -ErrorAction SilentlyContinue
    }

    $cnf = @(
        '[req]',
        'distinguished_name=dn',
        'req_extensions=v3',
        'prompt=no',
        '[dn]',
        "CN=$Address",
        'O=Little Care',
        '[v3]',
        'basicConstraints=CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth',
        'subjectAltName=@alt',
        '[alt]',
        "IP.1=$Address",
        'IP.2=127.0.0.1',
        'DNS.1=localhost'
    )
    Write-TextNoBom -Path $script:ServerCnf -Text (($cnf -join "`r`n") + "`r`n")

    $work = Join-Path $env:TEMP ("lcsign_" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        $caSerial = Join-Path $script:SslDir 'ca.srl'
        $serialArg = @()
        if (Test-Path $caSerial) {
            Copy-Item $caSerial (Join-Path $work 'ca.srl') -Force
            $serialArg = @('-CAserial', 'ca.srl')
        } else {
            $serialArg = @('-CAcreateserial')
        }

        Push-Location $work
        try {
            Copy-Item $script:CaCert 'ca.crt' -Force
            Copy-Item $script:CaKey  'ca.key' -Force
            Copy-Item $script:ServerCnf 'server.cnf' -Force

            $rc = Invoke-OpenSsl -Arguments @('genrsa', '-out', 'key.pem', '2048')
            if ($rc -ne 0) { throw "openssl genrsa failed ($rc)." }

            $rc = Invoke-OpenSsl -Arguments @('req', '-new', '-key', 'key.pem', '-out', 'csr.pem', '-config', 'server.cnf')
            if ($rc -ne 0) { throw "openssl req failed ($rc)." }

            $xargs = @('x509', '-req', '-in', 'csr.pem', '-CA', 'ca.crt', '-CAkey', 'ca.key') + $serialArg +
                     @('-out', 'cert.pem', '-days', '825', '-sha256', '-extfile', 'server.cnf', '-extensions', 'v3')
            $rc = Invoke-OpenSsl -Arguments $xargs
            if ($rc -ne 0) { throw "openssl x509 signing failed ($rc)." }

            if (Test-Path (Join-Path $work 'ca.srl')) {
                Copy-Item (Join-Path $work 'ca.srl') $caSerial -Force
            }
            Copy-Item 'key.pem'  $script:LeafKey  -Force
            Copy-Item 'cert.pem' $script:LeafCert -Force
        } finally {
            Pop-Location
        }
    } finally {
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }

    $newInfo = Get-LeafCertificateInfo -Path $script:LeafCert
    if (-not ($newInfo.SanIps -contains $Address)) {
        throw "Certificate regeneration did not produce the expected SAN for $Address."
    }
    Write-Ok "Issued new leaf certificate for $Address (SAN: $($newInfo.SanIps -join ', ')), signed by the existing CA."
    return $true
}


# ---------------------------------------------------------------------------
# MiroTalk: write SFU_ANNOUNCED_IP (the WebRTC ICE announced address).
# Preserves any trailing comment on the line.
# ---------------------------------------------------------------------------
function Set-MiroTalkAnnouncedIp {
    param([string]$Address)
    if (-not (Test-Path $script:MiroTalkEnv)) {
        Write-Warn2 "MiroTalk .env not found at $($script:MiroTalkEnv) - skipping SFU_ANNOUNCED_IP."
        return $false
    }
    $content = Get-Content $script:MiroTalkEnv -Raw
    $pattern = '(?m)^(\s*SFU_ANNOUNCED_IP\s*=\s*)(\S*)(.*)$'
    if ($content -match $pattern) {
        $current = $Matches[2]
        if ($current -eq $Address) {
            Write-Skip "SFU_ANNOUNCED_IP already $Address."
            return $false
        }
        $evaluator = [System.Text.RegularExpressions.MatchEvaluator] { param($m) $m.Groups[1].Value + $Address + $m.Groups[3].Value }
        $content = [regex]::Replace($content, $pattern, $evaluator)
        Write-TextNoBom -Path $script:MiroTalkEnv -Text $content
        Write-Ok "MiroTalk SFU_ANNOUNCED_IP: $current -> $Address"
        return $true
    }
    # Key absent: append it.
    $content = $content.TrimEnd() + "`r`nSFU_ANNOUNCED_IP=$Address`r`n"
    Write-TextNoBom -Path $script:MiroTalkEnv -Text $content
    Write-Ok "MiroTalk SFU_ANNOUNCED_IP added as $Address"
    return $true
}

# ---------------------------------------------------------------------------
# Backend: write MonitoringMediaServerUrl into the Git-ignored media config.
# The room salt and the enable switch are preserved exactly.
# ---------------------------------------------------------------------------
function Set-BackendMediaEndpoint {
    param([string]$Address, [int]$Port)
    $url = "https://{0}:{1}" -f $Address, $Port
    if (-not (Test-Path $script:MediaConfig)) {
        Write-Warn2 "Backend media config not found at $($script:MediaConfig) - skipping."
        return $false
    }
    $content = Get-Content $script:MediaConfig -Raw
    $pattern = '(<add\s+key="MonitoringMediaServerUrl"\s+value=")([^"]*)(")'
    if ($content -match $pattern) {
        $current = [regex]::Match($content, $pattern).Groups[2].Value
        if ($current -eq $url) {
            Write-Skip "MonitoringMediaServerUrl already $url."
            return $false
        }
        $evaluator = [System.Text.RegularExpressions.MatchEvaluator] { param($m) $m.Groups[1].Value + $url + $m.Groups[3].Value }
        $content = [regex]::Replace($content, $pattern, $evaluator)
        Write-TextNoBom -Path $script:MediaConfig -Text $content
        Write-Ok "Backend MonitoringMediaServerUrl: $current -> $url"
        return $true
    }
    # Key absent: insert before </appSettings>.
    $entry = '  <add key="MonitoringMediaServerUrl" value="' + $url + '" />'
    $content = $content -replace '</appSettings>', ($entry + "`r`n</appSettings>")
    Write-TextNoBom -Path $script:MediaConfig -Text $content
    Write-Ok "Backend MonitoringMediaServerUrl added as $url"
    return $true
}


# ---------------------------------------------------------------------------
# Firewall: the MINIMUM inbound rules for a LAN demo, scoped to the local
# subnet only. The firewall is never disabled and public exposure is avoided.
# Requires elevation; without it the exact command is printed instead.
# ---------------------------------------------------------------------------
function Ensure-LittleCareFirewallRules {
    $specs = @(
        [pscustomobject]@{ Name = 'LittleCare Dev - MiroTalk HTTPS (3010)';      Proto = 'TCP'; Port = "$MediaPort" },
        [pscustomobject]@{ Name = 'LittleCare Dev - Frontend Vite HTTPS (5173)'; Proto = 'TCP'; Port = "$FrontendPort" },
        [pscustomobject]@{ Name = 'LittleCare Dev - MiroTalk WebRTC RTP (UDP)';  Proto = 'UDP'; Port = "$RtpMinPort-$RtpMaxPort" },
        [pscustomobject]@{ Name = 'LittleCare Dev - MiroTalk WebRTC RTP (TCP)';  Proto = 'TCP'; Port = "$RtpMinPort-$RtpMaxPort" }
    )

    $missing = @($specs | Where-Object {
        -not (Get-NetFirewallRule -DisplayName $_.Name -ErrorAction SilentlyContinue)
    })

    if ($missing.Count -eq 0) {
        Write-Skip "Firewall rules already present (scoped to LocalSubnet)."
        return
    }

    if (-not (Test-IsElevated)) {
        Write-Warn2 "Firewall rules are missing and this shell is not elevated - skipping."
        Write-Warn2 "Run an elevated PowerShell to add them if a phone cannot reach the PC:"
        foreach ($m in $missing) {
            Write-Host ("      New-NetFirewallRule -DisplayName '" + $m.Name + "' -Direction Inbound -Action Allow -Protocol " +
                        $m.Proto + " -LocalPort " + $m.Port + " -Profile Public,Private,Domain -RemoteAddress LocalSubnet") -ForegroundColor DarkYellow
        }
        return
    }

    foreach ($m in $missing) {
        New-NetFirewallRule -DisplayName $m.Name -Direction Inbound -Action Allow `
            -Protocol $m.Proto -LocalPort $m.Port -Profile Public,Private,Domain `
            -RemoteAddress LocalSubnet -ErrorAction Stop | Out-Null
        Write-Ok "Added firewall rule: $($m.Name) [$($m.Proto) $($m.Port)]."
    }
}



# ---------------------------------------------------------------------------
# Service helpers
# ---------------------------------------------------------------------------
function Test-PortListening {
    param([int]$Port)
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    return [bool]$c
}

function Stop-ListenerOnPort {
    param([int]$Port)
    $stopped = $false
    $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        if ($c.OwningProcess -and $c.OwningProcess -gt 0) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            $stopped = $true
        }
    }
    return $stopped
}

# Kill the MiroTalk node process even if it is not currently bound (defensive).
function Stop-MiroTalkNode {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and ($_.CommandLine -match 'app[\\/]src[\\/]Server\.js') }
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-MiroTalk {
    if (-not (Test-Path (Join-Path $script:MiroTalkRoot 'package.json'))) {
        Write-Warn2 "MiroTalk root not found ($($script:MiroTalkRoot)) - start the SFU manually."
        return
    }
    Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $script:MiroTalkRoot | Out-Null
}

function Start-Frontend {
    Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev' -WorkingDirectory $script:FrontendDir | Out-Null
}

# ---------------------------------------------------------------------------
# Backend (IIS Express). The backend stays on localhost:44368; only the Vite
# proxy talks to it, so the LAN IP never appears here.
# ---------------------------------------------------------------------------
function New-LittleCareBackendAppHost {
    param([int]$HttpsPort)

    $possible = @(
        (Join-Path $env:TEMP 'lc_apphost.config'),
        (Join-Path $script:BackendDir '.vs\WebApplication2.slnx\config\applicationhost.config')
    )
    foreach ($p in $possible) {
        if ((Test-Path $p) -and ((Get-Content $p -Raw) -match '<site\s+name="WebApplication2"')) {
            return $p
        }
    }

    $global = Join-Path $env:USERPROFILE 'Documents\IISExpress\config\applicationhost.config'
    if (-not (Test-Path $global)) { return $null }
    $content = Get-Content $global -Raw
    if ($content -notmatch '<site\s+name="WebApplication2"') {
        $site = @"
            <site name="WebApplication2" id="99" serverAutoStart="true">
                <application path="/">
                    <virtualDirectory path="/" physicalPath="$($script:BackendDir)" />
                </application>
                <bindings>
                    <binding protocol="https" bindingInformation="*:$HttpsPort:localhost" />
                </bindings>
            </site>
"@
        $content = $content.Replace('<sites>', "<sites>`r`n$site")
    }
    $out = Join-Path $env:TEMP 'lc_apphost.config'
    Write-TextNoBom -Path $out -Text $content
    return $out
}

function Restart-Backend {
    $iis = 'C:\Program Files\IIS Express\iisexpress.exe'
    if (-not (Test-Path $iis)) {
        Write-Warn2 "IIS Express not found - start the backend from Visual Studio (https://localhost:$BackendHttpsPort)."
        return
    }
    $appHost = New-LittleCareBackendAppHost -HttpsPort $BackendHttpsPort
    if (-not $appHost) {
        Write-Warn2 "Could not locate/generate an IIS Express apphost config - start the backend from Visual Studio."
        return
    }
    Get-Process iisexpress -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 900
    Start-Process -FilePath $iis -ArgumentList @("/config:`"$appHost`"", '/site:WebApplication2') -WindowStyle Minimized | Out-Null
    Write-Ok "Backend (IIS Express) restarted from $appHost on https://localhost:$BackendHttpsPort."
}

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'Little Care - development LAN configuration' -ForegroundColor White
Write-Host '-------------------------------------------' -ForegroundColor DarkGray

# 1. Resolve the LAN address (detected, or the controlled override).
if ($LanIp) {
    if (-not (Test-PrivateLanIPv4 $LanIp)) {
        throw "The supplied -LanIp '$LanIp' is not a private RFC1918 address."
    }
    $addr = [pscustomobject]@{ IP = $LanIp; Interface = '(override)'; Reason = 'parameter' }
    Write-Step "Using supplied LAN address $($addr.IP)."
} else {
    $addr = Get-LittleCareLanIPv4
    Write-Step "Detected LAN address $($addr.IP) on '$($addr.Interface)' ($($addr.Reason))."
}

# 2. Certificate (leaf only, signed by the existing trusted CA).
Write-Step 'Configuring development TLS certificate...'
$certChanged = Set-LittleCareDevCertificate -Address $addr.IP

# 3. MiroTalk announced IP.
Write-Step 'Configuring MiroTalk announced IP...'
$envChanged = Set-MiroTalkAnnouncedIp -Address $addr.IP

# 4. Backend media endpoint.
Write-Step 'Configuring backend media endpoint...'
$cfgChanged = Set-BackendMediaEndpoint -Address $addr.IP -Port $MediaPort

# 5. Firewall (best effort).
if (-not $SkipFirewall) {
    Write-Step 'Checking development firewall rules...'
    Ensure-LittleCareFirewallRules
}

# 6. Services.
if (-not $ConfigureOnly) {
    Write-Step 'Starting development services...'
    if (-not $NoRestart) {
        if (Stop-ListenerOnPort -Port $MediaPort) { Write-Skip "Stopped process on port $MediaPort." }
        Stop-MiroTalkNode
        if (Stop-ListenerOnPort -Port $FrontendPort) { Write-Skip "Stopped process on port $FrontendPort." }
    }

    if (-not (Test-PortListening -Port $MediaPort)) {
        Start-MiroTalk
        Write-Ok "MiroTalk starting on https://$($addr.IP):$MediaPort ..."
    } else {
        Write-Skip "MiroTalk already listening on port $MediaPort."
    }

    if ($NoRestart) {
        Write-Skip 'NoRestart: leaving the backend running as it is.'
    } else {
        Restart-Backend
    }

    if (-not (Test-PortListening -Port $FrontendPort)) {
        Start-Frontend
        Write-Ok "Frontend starting on https://$($addr.IP):$FrontendPort ..."
    } else {
        Write-Skip "Frontend already listening on port $FrontendPort."
    }

    # Give the Node services a moment so the readiness check is meaningful.
    Start-Sleep -Seconds 6
} else {
    Write-Skip 'ConfigureOnly: services were not started or stopped.'
}

# 7. Report.
$mediaUp   = Test-PortListening -Port $MediaPort
$frontUp   = Test-PortListening -Port $FrontendPort

Write-Host ''
Write-Host 'Little Care Development Environment' -ForegroundColor White
Write-Host '-----------------------------------' -ForegroundColor DarkGray
Write-Host ("LAN IP:              {0}" -f $addr.IP)
Write-Host ("Backend:             https://localhost:{0}  (PC-local; Vite proxies /api to it)" -f $BackendHttpsPort)
Write-Host ("MiroTalk (SFU):      https://{0}:{1}" -f $addr.IP, $MediaPort)
Write-Host ("Frontend:            https://{0}:{1}" -f $addr.IP, $FrontendPort)
Write-Host ''
Write-Host ("MiroTalk listening:  {0}" -f $(if ($mediaUp) { 'YES' } else { 'NO' }))
Write-Host ("Frontend listening:  {0}" -f $(if ($frontUp) { 'YES' } else { 'NO' }))
Write-Host ("Certificate SAN IP:  {0}" -f ((Get-LeafCertificateInfo -Path $script:LeafCert).SanIps -join ', '))
Write-Host ''
Write-Host 'Opening on the babysitter phone (must first trust ca.crt):' -ForegroundColor White
Write-Host ("  Frontend:  https://{0}:{1}" -f $addr.IP, $FrontendPort)
Write-Host ("  MiroTalk:  https://{0}:{1}" -f $addr.IP, $MediaPort)
Write-Host ''
if ($mediaUp -and $frontUp) {
    Write-Host 'Babysitter Monitoring: READY' -ForegroundColor Green
} else {
    Write-Host 'Babysitter Monitoring: services still starting (re-run or wait a few seconds)' -ForegroundColor Yellow
}
Write-Host ''

