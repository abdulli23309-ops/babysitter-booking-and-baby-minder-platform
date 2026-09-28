# Phase 3 Verification Harness (Monitoring Access & Session Lifecycle)

Preserved source for the **Phase 3** regression baseline: the monitoring
authorization chain and the monitor-session lifecycle.

* `Program.cs` — the harness (42 assertions, IDs `T3-*`).
* `Phase3Harness.exe.config.template` — config template (no credentials).

**Verified baseline:**

```text
42 passed
0 failed
exit code 0
```

---

## 1. What it validates

Phase 3 established the centralized `MonitoringAccess` decision chain and the
monitoring-session lifecycle. This harness is the historical regression baseline for
both, and is re-run after later phases to prove they did not change the rules.

Key areas covered:

* **Authorization matrix** — every `MonitoringDenial` reason is provoked and asserted
  (unassigned sitter, parent without a `ChildGuardian` row, child not in the job, job
  not in progress, no active session, session/child mismatch, invalid role).
* **Identity before detail** — a caller is rejected on *who they are* before any
  child-specific information is revealed.
* **Session lifecycle** — start, get, end; sessions bind to job + child and are
  independent per child.
* **Isolation** — activity on one child never touches another child's session.
* **Idempotency / no residue** — a denied request creates no session and no audit row.

Because guardians resolve **only** through `ChildGuardian`, this harness is the
reference for that rule; see the fixture notes in the Phase 5/6 README.

---

## 2. Build and run

This is a **standalone source harness, not a `.csproj` test project.** It compiles
with the .NET Framework `csc` against the already-built backend assembly and is not
part of the shipped `WebApplication2` application.

1. **Build the backend from source** so the harness never runs against a stale DLL:
   ```powershell
   cd 'e:\Fyp Fazooliyaaat\Unified Backend Workspace\WebApplication2'
   & 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe' `
       WebApplication2.csproj /t:Rebuild /p:Configuration=Debug
   ```

2. **Assemble a working folder** and copy in the harness plus dependencies:
   ```powershell
   $work = "$env:TEMP\phase3-harness"
   New-Item -ItemType Directory -Force -Path $work | Out-Null
   Copy-Item '.\docs\testing\phase3_harness\Program.cs' $work -Force
   Copy-Item '.\WebApplication2\bin\WebApplication2.dll'      $work -Force
   # also required: EntityFramework.dll, EntityFramework.SqlServer.dll,
   #                 System.Web.Http.dll, System.Net.Http.Formatting.dll
   Copy-Item '.\docs\testing\phase3_harness\Phase3Harness.exe.config.template' `
             (Join-Path $work 'Phase3Harness.exe.config') -Force
   # then edit that copy: replace <YOUR-SERVER> with your SQL Server instance
   ```

3. **Compile:**
   ```powershell
   cd $work
   & 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:exe `
       /platform:x64 /out:Phase3Harness.exe `
       /r:WebApplication2.dll /r:EntityFramework.dll /r:EntityFramework.SqlServer.dll `
       /r:System.Web.Http.dll /r:System.Net.Http.Formatting.dll `
       /r:System.Data.dll /r:System.Configuration.dll /r:System.Net.Http.dll Program.cs
   ```

4. **Run and verify:**
   ```powershell
   & '.\Phase3Harness.exe'
   $LASTEXITCODE      # expect 0
   # expect final line: RESULT: 42 passed, 0 failed
   ```

5. **Verify database residue** (see section 3).

---

## 3. Transaction, rollback and residue

The harness runs its fixtures and assertions against the **real** development database
inside **one** `DbContextTransaction`, which is **always rolled back** — including when
an unhandled exception occurs. It then re-opens a **fresh** context and compares
`MonitorSession` / `MonitorEvent` / `ChildGuardian` counts and job statuses against a
baseline captured *before* the run. Only a genuine rollback satisfies those checks, so
they are the proof that the harness left no residue.

Expected after a clean run: `CryAlert`, `MonitorSession`, `MonitorEvent` and
`ChildGuardian` all back to their pre-run counts, and job statuses unchanged.

---

## 4. Environment used for the recorded baseline

* SQL Server Express (`DESKTOP-UD649GB\SQLEXPRESS`), database
  `BabySitterBooking and BabyMinder`.
* The harness borrows pre-existing rows (jobs, parents, sitters, children) and rolls
  them back; it creates no permanent test data.

> **Reproducibility note:** the baseline above was verified on the development machine
> described here. It has **not** been reproduced from a clean checkout on a different
> machine, because the harness depends on specific pre-existing seed rows in the
> development database. Treat 42/42 as the *recorded* baseline for this environment.

## 5. Related harnesses

* `docs/testing/phase4_harness/` — heartbeat and connection-loss regression (60 assertions).
* `docs/testing/phase5_6_harness/` — cry incident lifecycle and escalation (83 assertions).

Run all three after changes to `MonitoringAccess`, `MonitoringService` or
`CryIncidentService`, since each phase's harness covers the shared authorization chain.
