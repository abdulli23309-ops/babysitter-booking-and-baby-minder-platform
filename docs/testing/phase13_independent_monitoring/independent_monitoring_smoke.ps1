# =====================================================================
# PHASE 13 - Independent (job-free) Phone-2 monitoring smoke tests
# ---------------------------------------------------------------------
# WHAT THIS COVERS
# The independent monitoring context end to end over real HTTP, plus the
# security negatives the brief requires:
#   * pairing code create / redeem / single-use / unauthorized generator
#   * device credential valid, and revoked the moment monitoring stops
#   * media roles: parent = viewer, device = publisher
#   * independent cry: jobless incident, deduped, parent-only, resolvable
#   * a sitter is refused on every independent route
#   * a device credential cannot impersonate a parent account session
#   * the job-based monitoring API is still enforced by MonitoringAccess
#
# PRECONDITION
#   * IIS Express serving WebApplication2 (default http://localhost:5050)
#   * $env:LITTLECARE_TEST_PARENT_A  - parent who guardians the test child
#   * $env:LITTLECARE_TEST_PARENT_B  - an unrelated parent (must be denied)
#   * $env:LITTLECARE_TEST_SITTER    - any sitter (must be denied)
#   * -ChildId defaults to 1
# =====================================================================
param(
    [string]$BaseUrl = 'http://localhost:5050',
    [int]$ChildId = 1
)

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:pass++; Write-Host ("  PASS  " + $Name) }
    else { $script:fail++; Write-Host ("  FAIL  " + $Name + $(if ($Detail) { "  :: $Detail" } else { '' })) }
}

function Api {
    param(
        [ValidateSet('GET', 'POST', 'DELETE')][string]$Method,
        [string]$Path,
        $Body = $null,
        [string]$Token = $null,
        [string]$DeviceCredential = $null
    )
    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    if ($DeviceCredential) { $headers['X-Monitor-Device'] = $DeviceCredential }
    $params = @{ Method = $Method; Uri = "$BaseUrl$Path"; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($null -ne $Body) {
        $params['ContentType'] = 'application/json'
        $params['Body'] = ($Body | ConvertTo-Json -Depth 5)
    }
    try {
        $r = Invoke-WebRequest @params
        $json = $null
        try { $json = $r.Content | ConvertFrom-Json } catch { }
        return [pscustomobject]@{ Code = [int]$r.StatusCode; Body = $json; Raw = $r.Content }
    }
    catch {
        $code = 0
        $raw = ''
        if ($_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $raw = $reader.ReadToEnd()
                $reader.Close()
            } catch { }
        }
        $json = $null
        try { $json = $raw | ConvertFrom-Json } catch { }
        return [pscustomobject]@{ Code = $code; Body = $json; Raw = $raw }
    }
}

$parentA = $env:LITTLECARE_TEST_PARENT_A
$parentB = $env:LITTLECARE_TEST_PARENT_B
$sitter = $env:LITTLECARE_TEST_SITTER
foreach ($pair in @(@('PARENT_A', $parentA), @('PARENT_B', $parentB), @('SITTER', $sitter))) {
    if ([string]::IsNullOrWhiteSpace($pair[1])) {
        throw "Set LITTLECARE_TEST_$($pair[0]) before running this harness."
    }
}

Write-Host '=== PHASE 13 INDEPENDENT MONITORING SMOKE ==='
Write-Host "Base $BaseUrl   child $ChildId"

# ---------------------------------------------------------------------
# 1. AUTHENTICATION BOUNDARY
# ---------------------------------------------------------------------
$r = Api -Method GET -Path '/api/independent-monitoring/session'
Check 'no token -> 401 on the parent independent route' ($r.Code -eq 401) "got $($r.Code)"

$r = Api -Method GET -Path '/api/independent-monitoring/device/session'
Check 'no device credential -> 401 on the device route' ($r.Code -eq 401) "got $($r.Code)"

# ---------------------------------------------------------------------
# 2. PAIRING CODE
# ---------------------------------------------------------------------
$r = Api -Method POST -Path '/api/independent-monitoring/pairing-codes' -Body @{ ChildId = $ChildId } -Token $sitter
Check 'sitter cannot generate a pairing code' ($r.Code -in 401, 403) "got $($r.Code)"

$r = Api -Method POST -Path '/api/independent-monitoring/pairing-codes' -Body @{ ChildId = $ChildId } -Token $parentB
Check 'unrelated parent cannot generate a code for that child' ($r.Code -eq 404) "got $($r.Code)"

$r = Api -Method POST -Path '/api/independent-monitoring/pairing-codes' -Body @{ ChildId = $ChildId } -Token $parentA
Check 'authorized parent generates a pairing code' ($r.Code -eq 200 -and $r.Body.code) "got $($r.Code) $($r.Raw)"
$code = $r.Body.code
Check 'pairing code is 10 characters' ($code -and $code.Length -eq 10) "code='$code'"

$r = Api -Method POST -Path '/api/independent-monitoring/device/pair' -Body @{ Code = 'ZZZZZZZZZZ' }
Check 'unknown code is rejected' ($r.Code -eq 400) "got $($r.Code)"

$r = Api -Method POST -Path '/api/independent-monitoring/device/pair' -Body @{ Code = $code.ToLower() }
Check 'code is case-insensitive and redeems' ($r.Code -eq 200 -and $r.Body.deviceCredential) "got $($r.Code) $($r.Raw)"
$device = $r.Body.deviceCredential
$sessionId = $r.Body.sessionId
Check 'redemption returned a device credential and session' ([bool]$device -and [bool]$sessionId)

$r = Api -Method POST -Path '/api/independent-monitoring/device/pair' -Body @{ Code = $code }
Check 'a redeemed code cannot be replayed' ($r.Code -eq 400) "got $($r.Code)"

# ---------------------------------------------------------------------
# 3. DEVICE CREDENTIAL + MEDIA ROLES
# ---------------------------------------------------------------------
$r = Api -Method GET -Path '/api/independent-monitoring/device/session' -DeviceCredential $device
Check 'valid device credential reads its session' ($r.Code -eq 200 -and $r.Body.childId -eq $ChildId) "got $($r.Code) $($r.Raw)"

$r = Api -Method POST -Path '/api/independent-monitoring/device/heartbeat' -DeviceCredential $device
Check 'device heartbeat accepted' ($r.Code -eq 200) "got $($r.Code)"

$r = Api -Method GET -Path '/api/independent-monitoring/device/media' -DeviceCredential $device
Check 'device media is a PUBLISHER session' ($r.Code -eq 200) "got $($r.Code) $($r.Raw)"
if ($r.Code -eq 200 -and $r.Body.Configured) {
    Check 'device media CanPublish=true' ($r.Body.CanPublish -eq $true)
    Check 'device media Role=publisher' ($r.Body.Role -eq 'publisher') "role=$($r.Body.Role)"
}

$r = Api -Method GET -Path '/api/independent-monitoring/media' -Token $parentA
Check 'parent media is a VIEWER session' ($r.Code -eq 200) "got $($r.Code) $($r.Raw)"
if ($r.Code -eq 200 -and $r.Body.Configured) {
    Check 'parent media CanPublish=false' ($r.Body.CanPublish -eq $false)
    Check 'parent media Role=viewer' ($r.Body.Role -eq 'viewer') "role=$($r.Body.Role)"
}

$r = Api -Method GET -Path '/api/independent-monitoring/media' -Token $sitter
Check 'sitter refused on the parent media route' ($r.Code -in 401, 403) "got $($r.Code)"

$r = Api -Method GET -Path '/api/independent-monitoring/media' -Token $parentB
Check 'unrelated parent refused on media' ($r.Code -in 403, 404) "got $($r.Code)"

# a device credential must not work on a parent (account) route
$r = Api -Method GET -Path '/api/independent-monitoring/session' -DeviceCredential $device
Check 'device credential cannot impersonate a parent session' ($r.Code -eq 401) "got $($r.Code)"

# ---------------------------------------------------------------------
# 4. INDEPENDENT CRY (jobless, parent-only, deduped)
# ---------------------------------------------------------------------
$r = Api -Method GET -Path '/api/independent-monitoring/incidents' -Token $parentA
$before = @($r.Body).Count

$r = Api -Method POST -Path '/api/independent-monitoring/device/cry' -DeviceCredential $device
Check 'device reports a cry' ($r.Code -eq 200) "got $($r.Code) $($r.Raw)"
$incidentId = $r.Body.incidentId

$r = Api -Method POST -Path '/api/independent-monitoring/device/cry' -DeviceCredential $device
Check 'repeated cry report reuses the same incident' ($r.Code -eq 200 -and $r.Body.incidentId -eq $incidentId) "got $($r.Code) $($r.Raw)"

$r = Api -Method GET -Path '/api/independent-monitoring/incidents' -Token $parentA
$rows = @($r.Body)
Check 'parent sees the incident' ($r.Code -eq 200 -and $rows.Count -eq ($before + 1)) "got $($r.Code) count=$($rows.Count)"
Check 'incident is reported open' ($rows.Count -gt 0 -and $rows[0].IsOpen) ($rows[0] | ConvertTo-Json -Compress)

$r = Api -Method GET -Path '/api/independent-monitoring/incidents' -Token $parentB
Check 'unrelated parent cannot read the incident' (@($r.Body).Count -eq 0) "got $($r.Code) count=$(@($r.Body).Count)"

$r = Api -Method GET -Path '/api/independent-monitoring/incidents' -Token $sitter
Check 'sitter cannot read independent incidents' ($r.Code -in 401, 403) "got $($r.Code)"

$r = Api -Method POST -Path '/api/independent-monitoring/cry/resolve' -Token $parentA
Check 'parent resolves the incident' ($r.Code -eq 200 -and $r.Body.resolved -ge 1) "got $($r.Code) $($r.Raw)"

# ---------------------------------------------------------------------
# 5. ONE ACTIVE INDEPENDENT SESSION PER PARENT
# ---------------------------------------------------------------------
$r = Api -Method POST -Path '/api/independent-monitoring/pairing-codes' -Body @{ ChildId = $ChildId } -Token $parentA
Check 'a second pairing is refused while a session is active' ($r.Code -eq 409) "got $($r.Code)"

# ---------------------------------------------------------------------
# 6. STOP REVOKES THE DEVICE
# ---------------------------------------------------------------------
$r = Api -Method POST -Path '/api/independent-monitoring/session/stop' -Token $parentA
Check 'parent stops monitoring' ($r.Code -eq 200) "got $($r.Code)"

$r = Api -Method POST -Path '/api/independent-monitoring/device/heartbeat' -DeviceCredential $device
Check 'device credential is revoked after stop' ($r.Code -eq 401) "got $($r.Code)"

$r = Api -Method GET -Path '/api/independent-monitoring/device/media' -DeviceCredential $device
Check 'revoked device cannot obtain media' ($r.Code -eq 401) "got $($r.Code)"

$r = Api -Method POST -Path '/api/independent-monitoring/device/cry' -DeviceCredential $device
Check 'revoked device cannot report a cry' ($r.Code -eq 401) "got $($r.Code)"

$r = Api -Method POST -Path '/api/independent-monitoring/pairing-codes' -Body @{ ChildId = $ChildId } -Token $parentA
Check 'a new pairing is allowed once stopped' ($r.Code -eq 200) "got $($r.Code)"

# ---------------------------------------------------------------------
# 7. JOB-BASED MONITORING IS UNTOUCHED
# ---------------------------------------------------------------------
$r = Api -Method GET -Path '/api/monitoring/accessible-scopes' -Token $parentA
Check 'job-based scope discovery still responds for a parent' ($r.Code -eq 200) "got $($r.Code) $($r.Raw)"

$r = Api -Method GET -Path '/api/monitoring/accessible-scopes' -Token $sitter
Check 'job-based scope discovery still responds for a sitter' ($r.Code -eq 200) "got $($r.Code)"

$r = Api -Method POST -Path '/api/monitoring/session/start' -Body @{ JobId = 1; ChildId = 1 } -Token $parentA
Check 'job-based session start still enforces MonitoringAccess' ($r.Code -in 400, 403, 404) "got $($r.Code) $($r.Raw)"

Write-Host ''
Write-Host "RESULT: $script:pass passed, $script:fail failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
