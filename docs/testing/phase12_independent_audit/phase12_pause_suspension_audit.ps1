$ProgressPreference='SilentlyContinue'
$ErrorActionPreference='Stop'
$helper = Join-Path $PSScriptRoot 'e2e_lib.ps1'
if (-not (Test-Path $helper)) { throw "Required API helper missing: $helper" }
. $helper
foreach ($name in 'LITTLECARE_TEST_PARENT_USER','LITTLECARE_TEST_PARENT_PASSWORD','LITTLECARE_TEST_COPARENT_USER','LITTLECARE_TEST_COPARENT_PASSWORD','LITTLECARE_TEST_SITTER_USER','LITTLECARE_TEST_SITTER_PASSWORD') {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "Set $name to an authorized test account before running this fixture." }
}
if ([string]::IsNullOrWhiteSpace($env:LITTLECARE_OPS_SWEEP_KEY)) { throw 'Set LITTLECARE_OPS_SWEEP_KEY for the test environment.' }
$JOB=9001; $CHILD=1
$SQL='DESKTOP-UD649GB\SQLEXPRESS'
function Q($q){ (& sqlcmd -S $SQL -E -C -d 'BabySitterBooking and BabyMinder' -h -1 -W -Q "SET NOCOUNT ON; $q" 2>$null | Where-Object { $_ -match '^\s*-?\d+\s*$' } | Select-Object -First 1) }

$tA=(Api POST '/api/parent/login' $null @{Username=$env:LITTLECARE_TEST_PARENT_USER;Password=$env:LITTLECARE_TEST_PARENT_PASSWORD;Role='Parent'}).Body.token
$tB=(Api POST '/api/parent/login' $null @{Username=$env:LITTLECARE_TEST_COPARENT_USER;Password=$env:LITTLECARE_TEST_COPARENT_PASSWORD;Role='Parent'}).Body.token
$tS=(Api POST '/api/babysitter/login' $null @{Username=$env:LITTLECARE_TEST_SITTER_USER;Password=$env:LITTLECARE_TEST_SITTER_PASSWORD;Role='Sitter'}).Body.token

# This is an integration fixture: it uses the named test job only and never
# deletes database rows. Start it on a dedicated test database with known state.
[void](Api POST '/api/monitoring/session/start' $tA @{jobId=$JOB;childId=$CHILD})

Write-Host 'STEP 1: cry BEFORE pause (creates incident A, escalation armed)'
$c1 = Api POST '/api/monitoring/cry' $tS @{jobId=$JOB;childId=$CHILD}
Write-Host ("  incident A id={0} status={1}" -f $c1.Body.Id, $c1.Body.Status)

Write-Host 'STEP 2: mother requests pause, co-parent approves'
$pr = Api POST '/api/monitoring/pause' $tA @{jobId=$JOB;childId=$CHILD}
$pz = $pr.Body.MonitoringPause_ID
$ap = Api POST "/api/monitoring/pause/$pz/approve" $tB $null
Write-Host ("  pause status={0} secondsRemaining={1}" -f $ap.Body.Status, $ap.Body.SecondsRemaining)

$incA = Api GET "/api/monitoring/cry?jobId=$JOB&childId=$CHILD" $tA $null
Write-Host ("  incident A after pause approval: status={0} (expected Cancelled)" -f $incA.Body.Status)

$notifBefore = Q "SELECT COUNT(*) FROM Notification WHERE Job_ID=$JOB"
Write-Host ("  notifications for job BEFORE paused cry: {0}" -f $notifBefore)

Write-Host 'STEP 3: cry DURING the active pause (detector keeps running on Phone 2)'
$c2 = Api POST '/api/monitoring/cry' $tS @{jobId=$JOB;childId=$CHILD}
Write-Host ("  incident B id={0} status={1} stage={2} dueAt={3}" -f $c2.Body.Id, $c2.Body.Status, $c2.Body.EscalationStage, $c2.Body.NextEscalationDueAt)

Write-Host 'STEP 4: drive the escalation sweeper (simulate the scheduler) and wait'
$opsKey=$env:LITTLECARE_OPS_SWEEP_KEY
for($i=1;$i -le 4;$i++){
  Start-Sleep -Seconds 6
  try {
    $sw = Invoke-WebRequest -Uri 'https://localhost:44368/api/monitoring/ops/sweep?max=50' -Headers @{'X-Ops-Sweep-Key'=$opsKey} -UseBasicParsing
    $swj = $sw.Content | ConvertFrom-Json
    Write-Host ("  sweep#{0} processed={1}" -f $i, $swj.processed)
  } catch { Write-Host ("  sweep#{0} status={1}" -f $i, [int]$_.Exception.Response.StatusCode) }
}

$incB = Api GET "/api/monitoring/cry?jobId=$JOB&childId=$CHILD" $tA $null
Write-Host ("  incident B FINAL: status={0} stage={1}" -f $incB.Body.Status, $incB.Body.EscalationStage)

$notifAfter = Q "SELECT COUNT(*) FROM Notification WHERE Job_ID=$JOB"
Write-Host ("  notifications for job AFTER paused cry: {0}  (delta={1})" -f $notifAfter, ([int]$notifAfter - [int]$notifBefore))

$pausedRows = Q "SELECT COUNT(*) FROM MonitoringPause WHERE Status='Approved'"
Write-Host ("  pause still active? approved rows={0}" -f $pausedRows)

Write-Host ''
Write-Host '=== VERDICT ==='
if ([int]$notifAfter -gt [int]$notifBefore) {
  Write-Host '  DEFECT CONFIRMED: the parent was alerted while monitoring was PAUSED.'
} else {
  Write-Host '  OK: no new parent notification was raised during the pause.'
}
