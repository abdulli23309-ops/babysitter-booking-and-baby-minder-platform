$ProgressPreference='SilentlyContinue'
. 'e:\Fyp Fazooliyaaat\e2e_lib.ps1'
$JOB = 9001; $CHILD = 1
$script:pass = 0; $script:fail = 0
function Check($id, $desc, $cond, $detail) {
  if ($cond) { $script:pass++; Write-Host ("  PASS {0}  {1}" -f $id, $desc) }
  else { $script:fail++; Write-Host ("  FAIL {0}  {1}  [{2}]" -f $id, $desc, $detail) }
}

# Identities come from the server on login; the client never supplies an actor.
$pA  = Api POST '/api/parent/login'    $null @{ Username='usmantariq'; Password='1234'; Role='Parent' }
$pB  = Api POST '/api/parent/login'    $null @{ Username='hina';      Password='1234'; Role='Parent' }
$pX  = Api POST '/api/parent/login'    $null @{ Username='user5';     Password='1234'; Role='Parent' }
$st  = Api POST '/api/babysitter/login' $null @{ Username='sitter4';   Password='1234'; Role='Sitter' }
$tA=$pA.Body.token; $tB=$pB.Body.token; $tX=$pX.Body.token; $tS=$st.Body.token
Check 'E0' 'logins: parent/co-parent/unauthorized/sitter' `
  ($pA.Status -eq 200 -and $pB.Status -eq 200 -and $pX.Status -eq 200 -and $st.Status -eq 200) `
  "$($pA.Status)/$($pB.Status)/$($pX.Status)/$($st.Status)"

# E1 parent starts monitoring
$s = Api POST '/api/monitoring/session/start' $tA @{ jobId=$JOB; childId=$CHILD }
Check 'E1' 'Parent starts monitoring (session Active)' ($s.Status -eq 200 -and $s.Body.Status -eq 'Active') "status=$($s.Status) body=$($s.Body.Status)"

# E2 sitter enters active monitoring
$ss = Api GET "/api/monitoring/session?jobId=$JOB&childId=$CHILD" $tS $null
Check 'E2' 'Sitter can read the active session' ($ss.Status -eq 200 -and $ss.Body.Status -eq 'Active') "status=$($ss.Status)"

# E22 no duplicate monitoring session (idempotent start)
$s2 = Api POST '/api/monitoring/session/start' $tA @{ jobId=$JOB; childId=$CHILD }
Check 'E22' 'Repeat start returns the SAME session (idempotent)' `
  ($s2.Body.MonitorSessionId -eq $s.Body.MonitorSessionId) "first=$($s.Body.MonitorSessionId) second=$($s2.Body.MonitorSessionId)"

# E3 cry incident creation
$c1 = Api POST '/api/monitoring/cry' $tS @{ jobId=$JOB; childId=$CHILD }
Check 'E3' 'Cry incident created' ($c1.Status -eq 200 -and $c1.Body.Id -gt 0) "status=$($c1.Status) id=$($c1.Body.Id)"

# E23 no duplicate cry incident (dedupe)
$c2 = Api POST '/api/monitoring/cry' $tS @{ jobId=$JOB; childId=$CHILD }
Check 'E23' 'Repeat cry REUSES the open incident' `
  ($c2.Status -eq 200 -and ($c2.Body.Id -eq $c1.Body.Id -or $c2.Body.Reused -eq $true)) `
  "id1=$($c1.Body.Id) id2=$($c2.Body.Id) reused=$($c2.Body.Reused)"

# E4 T+5 sitter alert persisted
$inc = Api GET "/api/monitoring/cry?jobId=$JOB&childId=$CHILD" $tS $null
Check 'E4' 'T+5 sitter alert persisted in NextEscalationDueAt' `
  ($inc.Status -eq 200 -and $inc.Body.NextEscalationDueAt) "due=$($inc.Body.NextEscalationDueAt)"

# E5 sitter response
$g = Api POST '/api/monitoring/cry/going-to-child' $tS @{ jobId=$JOB; childId=$CHILD }
Check 'E5' 'Sitter "Going to Child" accepted' ($g.Status -eq 200) "status=$($g.Status)"

# E6 parent escalation state readable by co-parent
$inc2 = Api GET "/api/monitoring/cry?jobId=$JOB&childId=$CHILD" $tB $null
Check 'E6' 'Parent can read the incident (escalation is server-driven)' ($inc2.Status -eq 200) "stage=$($inc2.Body.EscalationStage) status=$($inc2.Status)"

# E7 pause request
$pr = Api POST '/api/monitoring/pause' $tA @{ jobId=$JOB; childId=$CHILD }
$pauseId = $pr.Body.MonitoringPause_ID
Check 'E7' 'Mother requests pause' ($pr.Status -eq 200 -and $pauseId) "status=$($pr.Status) id=$pauseId"

# E8 co-parent approves
$ap = Api POST "/api/monitoring/pause/$pauseId/approve" $tB $null
Check 'E8' 'Co-parent guardian approves pause' ($ap.Status -eq 200) "status=$($ap.Status)"
# E9: the sitter sees the pause through the SESSION response, not the pause
# control endpoint. GET /api/monitoring/pause is deliberately parent-only (403 for
# a sitter) because requesting/approving a pause is a guardian action; the
# session DTO already carries IsPaused / PauseExpiresAtUtc / SecondsRemaining
# for every authorized viewer, so the sitter still learns that monitoring is
# temporarily paused without gaining a parent capability.
$ss2 = Api GET "/api/monitoring/session?jobId=$JOB&childId=$CHILD" $tS $null
Check 'E9' 'Sitter sees the approved pause via the session' `
  ($ss2.Status -eq 200 -and $ss2.Body.IsPaused -eq $true) "status=$($ss2.Status) IsPaused=$($ss2.Body.IsPaused)"

# E12 DND / E13 DND exclusion (presentation only, per-parent)
$d1 = Api POST '/api/monitoring/dnd' $tA @{ jobId=$JOB; childId=$CHILD }
Check 'E12' 'Mother enables DND' ($d1.Status -eq 200) "status=$($d1.Status)"
$dst = Api GET "/api/monitoring/dnd?jobId=$JOB&childId=$CHILD" $tB $null
# E13: DND is INDEPENDENT per parent and suppresses PRESENTATION only - it never
# deletes or suppresses the underlying notification.
# GetDndStates returns EVERY DND row for the session with an IsCurrentUser flag.
# That is required by the "both parents must not be DND simultaneously" rule: the
# co-parent must be able to SEE that the other parent is in DND before deciding
# to enable their own. So the correct assertions are:
#   (a) the mother's DND row is present and active, and
#   (b) there is NO active DND row belonging to the co-parent.
$drows = @($dst.Body)
$motherOn = @($drows | Where-Object { $_.IsCurrentUser -eq $false -and $_.IsActive -eq $true }).Count -ge 1
$selfOn   = @($drows | Where-Object { $_.IsCurrentUser -eq $true  -and $_.IsActive -eq $true }).Count -ge 1
Check 'E13' 'DND is per-parent; co-parent sees mother DND but has none of their own' `
  ($dst.Status -eq 200 -and $motherOn -and -not $selfOn) "rows=$($drows.Count) motherOn=$motherOn selfOn=$selfOn"
$dd = Api DELETE '/api/monitoring/dnd' $tA @{ jobId=$JOB; childId=$CHILD }
Check 'E12b' 'DND disable (cleanup)' ($dd.Status -ge 200 -and $dd.Status -lt 300) "status=$($dd.Status)"

# E14 heartbeat accepted
$hb = Api POST '/api/monitoring/session/heartbeat' $tA @{ jobId=$JOB; childId=$CHILD }
Check 'E14' 'Heartbeat accepted' ($hb.Status -eq 200) "status=$($hb.Status)"

# E15/E28 a heartbeat must NOT end or resolve the session
$afterHb = Api GET "/api/monitoring/session?jobId=$JOB&childId=$CHILD" $tA $null
Check 'E15' 'Heartbeat does NOT end/resolve the session' `
  ($afterHb.Body.Status -eq 'Active') "status=$($afterHb.Body.Status)"

# E10 pause carries a 150 second (2m30s) expiry
$exp = $ap
$expires = $exp.Body.PauseExpiresAtUtc
$minutes = 'n/a'
if ($expires) { $minutes = [int](([datetime]$expires) - ([datetime]::UtcNow)).TotalMinutes }
Check 'E10' 'Pause expiry is 150s (2m30s)' ($minutes -eq 2) "minutesUntilExpiry=$minutes expires=$expires"

# E11 pause semantics. IMPORTANT: this asserts the FROZEN Phase 7 rule, not my
# first guess. Approving a pause CANCELS the running incident through
# CryIncidentService.CancelParentPauseApproved, so escalation is genuinely
# suspended and the old incident can never resume. Phase 7 test T7-P34 then
# asserts that a cry AFTER the pause opens a FRESH T+0 incident rather than
# resuming the cancelled one - so a new row appearing here is REQUIRED, not a
# defect. What must never happen is the cancelled incident resuming.
$incDuring = Api GET "/api/monitoring/cry?jobId=$JOB&childId=$CHILD" $tA $null
$origStatus = $incDuring.Body.Status
Check 'E11' 'Approved pause suspended escalation and cancelled the incident' `
  ($incDuring.Status -eq 200 -and $origStatus -ne 'Open') "origIncidentStatus=$origStatus"
$c3 = Api POST '/api/monitoring/cry' $tS @{ jobId=$JOB; childId=$CHILD }
Check 'E11b' 'A cry while paused opens a FRESH incident, never a resume (Phase 7 T7-P34)' `
  ($c3.Status -eq 200 -and $c3.Body.Id -ne $c1.Body.Id) "newId=$($c3.Body.Id) origId=$($c1.Body.Id) reused=$($c3.Body.Reused)"

# release the pause so the run finishes clean
[void](Api DELETE "/api/monitoring/pause/$pauseId" $tA $null)

# E16/E17 guardian authorization
$gA = Api GET "/api/monitoring/guardians?jobId=$JOB&childId=$CHILD" $tA $null
Check 'E16' 'Owner parent can list guardians' ($gA.Status -eq 200) "status=$($gA.Status)"
$gX = Api GET "/api/monitoring/guardians?jobId=$JOB&childId=$CHILD" $tX $null
Check 'E17' 'Unauthorized parent DENIED (403)' ($gX.Status -eq 403) "status=$($gX.Status)"
$smX = Api GET "/api/monitoring/session?jobId=$JOB&childId=$CHILD" $tX $null
Check 'E17b' 'Unauthorized parent DENIED on session read' ($smX.Status -eq 403) "status=$($smX.Status)"

# E18 co-parent discovery
$scB = Api GET '/api/monitoring/accessible-scopes' $tB $null
$nB = @($scB.Body).Count
$viaB = if ($nB -gt 0) { @($scB.Body)[0].Via } else { '' }
Check 'E18' 'Co-parent discovers scope via Guardian' `
  ($scB.Status -eq 200 -and $nB -gt 0 -and $viaB -eq 'Guardian') "n=$nB via=$viaB"
$scA = Api GET '/api/monitoring/accessible-scopes' $tA $null
Check 'E18b' 'Owner parent discovers the scope' ($scA.Status -eq 200 -and @($scA.Body).Count -gt 0) "n=$(@($scA.Body).Count)"
$scX = Api GET '/api/monitoring/accessible-scopes' $tX $null
Check 'E17c' 'Unauthorized parent sees NO scope' (@($scX.Body).Count -eq 0) "n=$(@($scX.Body).Count)"
$scS = Api GET '/api/monitoring/accessible-scopes' $tS $null
Check 'E2b' 'Sitter discovers the assigned scope' (@($scS.Body).Count -gt 0) "n=$(@($scS.Body).Count)"

# E19/E20 media endpoint
$mA = Api GET "/api/monitoring/media?jobId=$JOB&childId=$CHILD" $tA $null
Check 'E20' 'Parent media: server publisher role, fails closed, no token' `
  ($mA.Status -eq 200 -and $mA.Body.Role -eq 'publisher' -and $mA.Body.Configured -eq $false -and -not $mA.Body.Token) `
  "status=$($mA.Status) role=$($mA.Body.Role) configured=$($mA.Body.Configured)"
$mS = Api GET "/api/monitoring/media?jobId=$JOB&childId=$CHILD" $tS $null
Check 'E19' 'Sitter media: receive-only viewer, fails closed' `
  ($mS.Status -eq 200 -and $mS.Body.Role -eq 'viewer' -and $mS.Body.CanPublish -eq $false) `
  "status=$($mS.Status) role=$($mS.Body.Role) canPublish=$($mS.Body.CanPublish)"
$mB = Api GET "/api/monitoring/media?jobId=$JOB&childId=$CHILD" $tB $null
Check 'E18c' 'Co-parent media authorized' ($mB.Status -eq 200) "status=$($mB.Status) role=$($mB.Body.Role)"
$mX = Api GET "/api/monitoring/media?jobId=$JOB&childId=$CHILD" $tX $null
Check 'E19b' 'Unauthorized parent DENIED media (403)' ($mX.Status -eq 403) "status=$($mX.Status)"

# E25 legacy cry pipeline removed
$leg = Api GET "/api/cry-detection/latest?parentId=1" $tA $null
Check 'E25' 'Legacy /api/cry-detection REMOVED (404)' ($leg.Status -eq 404) "status=$($leg.Status)"

# cleanup: resolve incident, end session
[void](Api POST '/api/monitoring/cry/with-child' $tS @{ jobId=$JOB; childId=$CHILD })
[void](Api POST '/api/monitoring/session/end' $tA @{ jobId=$JOB; childId=$CHILD })

Write-Host ''
Write-Host ("RUNTIME RESULT: {0} passed, {1} failed" -f $script:pass, $script:fail)


# E9 sitter sees pause
