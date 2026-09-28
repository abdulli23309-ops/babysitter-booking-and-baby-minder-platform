# Phase 7 Verification Harness (Guardian Connection / Parent Pause / Parent DND)

Preserved source for the **Phase 7** regression suite: connecting a second parent
account to a child, the two-party monitoring pause, and per-parent Do-Not-Disturb.

* `Program.cs` — the harness (**106 assertions**, IDs `T7-G*`, `T7-P*`, `T7-D*`,
  `T7-S*`, `T7-R*`).
* `Phase7Harness.exe.config.template` — config template (no credentials).

**Verified baseline:**

```text
106 passed
0 failed
exit code 0
```

---

## 1. What it verifies

### Guardian connection (`T7-G0` … `T7-G27`)
Creation guards (self-invite, unknown identifier, non-guardian inviter, sitter role),
token handling (only a SHA-256 hash is ever stored; it never reaches the API or the
audit trail), duplicate-pending and duplicate-guardian refusal, invitee-scoped
visibility, **atomic** acceptance (the `ChildGuardian` row and the `Accepted` status
commit together or not at all), server-side `CanApprovePause` assignment from the
relation, rejection, inviter-only withdrawal, and lazy invitation expiry.

### Parent pause (`T7-P0` … `T7-P40`)
Request validation, the rule that a **request has no immediate effect**, exactly
**150 seconds** on approval, refusal of self-approval and of approvers without
`CanApprovePause`, denial, the `ParentPauseApproved` cancellation of the active cry
incident, `NextEscalationDueAt` being cleared, the paused state reaching the sitter
through the existing session GET, "a pause is not a connection loss", lazy expiry,
and a **fresh T+0 incident** after the pause.

### Parent DND (`T7-D1` … `T7-D18`)
Enable/disable, per-user ownership (no `UserId` in the request), **mutual exclusion**,
and the central rule that DND is **presentation only**: escalation still happens and
the DND-active parent still receives a persisted notification.

### The Phase 7 security fix (`T7-S1` … `T7-S5`)
The most important assertions in the file. They prove that a parent who exists only
in `Child.Parent_ID` and has **no** `ChildGuardian` row is neither authorized to
monitor nor included in the parent-escalation fan-out — including the case where the
table is completely empty. This is the regression test for the removed
`CryIncidentService.ReadGuardianParentIds` fallback.

### Residue (`R7`)
All eleven tables are compared against a baseline captured **before** the run, from a
**fresh** context after the rollback.

---

## 2. Build and run

Standalone source harness, **not** a `.csproj` test project. It compiles with the
.NET Framework `csc` against the built `WebApplication2.dll` and runs against the
real development database inside one transaction that is always rolled back.

1. **Rebuild the backend:**
   ```powershell
   cd 'e:\Fyp Fazooliyaaat\Unified Backend Workspace\WebApplication2'
   & 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe' `
       WebApplication2.csproj /t:Rebuild /p:Configuration=Debug
   ```

2. **Assemble a working folder:**
   ```powershell
   $work = "$env:TEMP\phase7-harness"
   New-Item -ItemType Directory -Force -Path $work | Out-Null
   Copy-Item '.\docs\testing\phase7_harness\Program.cs' $work -Force
   Copy-Item '.\WebApplication2\bin\WebApplication2.dll' $work -Force
   # also required: EntityFramework.dll, EntityFramework.SqlServer.dll,
   #                 System.Web.Http.dll, System.Net.Http.Formatting.dll,
   #                 Newtonsoft.Json.dll
   Copy-Item '.\docs\testing\phase7_harness\Phase7Harness.exe.config.template' `
             (Join-Path $work 'Phase7Harness.exe.config') -Force
   # edit the copy: replace <YOUR-SERVER> with your SQL Server instance
   ```

3. **Compile:**
   ```powershell
   cd $work
   & 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:exe `
       /platform:x64 /out:Phase7Harness.exe `
       /r:WebApplication2.dll /r:EntityFramework.dll /r:EntityFramework.SqlServer.dll `
       /r:System.Web.Http.dll /r:System.Net.Http.Formatting.dll `
       /r:System.Data.dll /r:System.Configuration.dll /r:System.Net.Http.dll `
       /r:Newtonsoft.Json.dll Program.cs
   ```

4. **Run and verify:**
   ```powershell
   & '.\Phase7Harness.exe'
   $LASTEXITCODE      # expect 0
   # expect final line: RESULT: 106 passed, 0 failed
   ```

> **Ordering matters:** copy `WebApplication2.dll` **after** creating the working
> folder, or a stale assembly from a previous run will be used.

---

## 3. Migration dependency

Phase 7 requires `docs/database/phase7_guardian_pause_dnd.sql` to have been applied
once — it creates `GuardianInvitation`, `MonitoringPause` and `MonitoringDnd`, and
backfills `ChildGuardian` from `Child.Parent_ID`. The script is idempotent.

> **Consequence for the earlier harnesses.** That backfill means `ChildGuardian` is no
> longer empty in the live database, so the Phase 3/4/5-6 fixtures had to stop
> assuming it was. They now `DELETE FROM ChildGuardian` first inside their rolled-back
> transaction (fixture isolation only — no assertion or expected value was changed),
> and Phase 3's R3 residue check compares against a runtime baseline instead of a
> hard-coded `0`, which is what that harness's own header comment always described.

---

## 4. Fixture rules that matter

* **Parent 34** is the primary guardian of children 27 and 29 (`CanApprovePause = 0`
  — a lone guardian may never approve).
* **Parent 1** owns child 1 via `Child.Parent_ID` but has **no** `ChildGuardian` row
  for 27/29. He is the reserved "legacy owner" probe for the security assertions.
* **A spare parent** owning no child and no guardian row is selected at runtime as the
  guardian invitee, so the invitee is always a legal target.
* **`JobService` uses EF change tracking.** A raw `UPDATE Job SET Status = ...` is
  invisible to a later EF query, so the helper reloads the tracked entity.
* **Notification assertions use deltas** where several tests in one run can notify
  the same account, so an assertion describes *this* escalation, not the total.

## 5. Environment used for the recorded baseline

* SQL Server Express (`DESKTOP-UD649GB\SQLEXPRESS`), database
  `BabySitterBooking and BabyMinder`.
* Jobs `170`/`171`, parent `34`, sitters `19`, children `27`/`29` are pre-existing
  rows the harness borrows; everything is rolled back.

> **Reproducibility note:** verified on the development machine described here. It has
> **not** been reproduced on a clean checkout or a fresh database, because the harness
> depends on specific pre-existing seed rows. Treat 106/106 as the *recorded* baseline
> for this environment.

## 6. Related harnesses

* `docs/testing/phase3_harness/` — access and session lifecycle (42 assertions).
* `docs/testing/phase4_harness/` — heartbeat and connection loss (60 assertions).
* `docs/testing/phase5_6_harness/` — cry incident and escalation (83 assertions).
