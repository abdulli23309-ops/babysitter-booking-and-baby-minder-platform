$root='E:\Fyp Fazooliyaaat\Unified Backend Workspace'
$server = 'DESKTOP-UD649GB\SQLEXPRESS'
$netHttp = 'C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\System.Net.Http.dll'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

# Read the REAL connection string from Web.config so every harness talks to the
# same database the application uses.
$webCfg = Get-Content "$root\WebApplication2\Web.config" -Raw
$m = [regex]::Match($webCfg, '<add name="BabySitterBooking_and_BabyMinderEntities"[^>]*connectionString="[^"]*"[^>]*/>')
$connEntry = if ($m.Success) { $m.Value } else { throw 'no entities connection string in Web.config' }
$connEntry = $connEntry.Replace('&quot;','"')
$provider = '<provider invariantName="System.Data.SqlClient" type="System.Data.Entity.SqlServer.SqlProviderServices, EntityFramework.SqlServer" />'

function New-HarnessConfig($work, $exe, $templatePath) {
  if ($templatePath -and (Test-Path $templatePath)) {
    # Prefer the documented template artifact; only substitute the escaped server.
    $cfg = Get-Content $templatePath -Raw
    $cfg = $cfg.Replace('&lt;YOUR-SERVER&gt;', $server).Replace('<YOUR-SERVER>', $server)
  } else {
    $cfg = "<?xml version=`"1.0`" encoding=`"utf-8`"?>`n<configuration>`n  <connectionStrings>`n    $connEntry`n  </connectionStrings>`n  $provider`n</configuration>"
  }
  Set-Content -Path (Join-Path $work "$exe.exe.config") -Value $cfg -NoNewline
}

$Harnesses = @(
  @{ Dir='phase3_harness';   Exe='Phase3Harness';   Cfg='Phase3Harness.exe.config.template';   Expected=42 },
  @{ Dir='phase4_harness';   Exe='Phase4Harness';   Cfg='Phase4Harness.exe.config.template';   Expected=60 },
  @{ Dir='phase5_6_harness'; Exe='Phase56Harness';  Cfg='';                                    Expected=83 },
  @{ Dir='phase7_harness';   Exe='Phase7Harness';   Cfg='Phase7Harness.exe.config.template';   Expected=106 }
)

foreach ($h in $Harnesses) {
  $work = Join-Path $env:TEMP ("h-" + $h.Dir)
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  Copy-Item (Join-Path $root "docs\testing\$($h.Dir)\Program.cs") $work -Force
  # Copy every backend dependency so the harness never hits a runtime assembly bind.
  Copy-Item "$root\WebApplication2\bin\*.dll" $work -Force
  Copy-Item $netHttp $work -Force
  New-HarnessConfig $work $h.Exe $(if ($h.Cfg) { Join-Path $root "docs\testing\$($h.Dir)\$($h.Cfg)" } else { $null })

  Push-Location $work
  & $csc /nologo /target:exe /platform:x64 /out:"$($h.Exe).exe" `
     /r:WebApplication2.dll /r:EntityFramework.dll /r:EntityFramework.SqlServer.dll `
     /r:System.Web.Http.dll /r:System.Net.Http.Formatting.dll /r:System.Net.Http.dll `
     /r:Newtonsoft.Json.dll Program.cs 2>&1 |
     Where-Object { $_ -notmatch 'warning CS1701|Location of symbol' } | Select-Object -First 3 | ForEach-Object { Write-Host "  COMPILE: $_" }
  Pop-Location

  if (-not (Test-Path (Join-Path $work "$($h.Exe).exe"))) { Write-Host "$($h.Dir): COMPILE FAILED"; continue }
  $out = & (Join-Path $work "$($h.Exe).exe") 2>&1
  $sum = ($out | Select-String -Pattern 'passed|failed' | Select-Object -Last 2) -join ' | '
  Write-Host ("{0} => {1}" -f $h.Dir, $sum)
}
