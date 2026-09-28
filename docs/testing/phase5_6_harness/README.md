# Phase 5 + 6 Verification Harness (Cry Incident & Escalation)

This directory preserves the executable verification harness for **Phase 5 (cry incident
lifecycle)** and **Phase 6 (persistent escalation scheduler)** so the phase can be
re-verified at any time by anyone on the team.

* `Program.cs` — the harness (83 assertions, IDs `T5-*`, `C5-*`, `R1`–`R6`).

---

## 1. Purpose

Verify the completed Phase 5/6 implementation: the cry incident lifecycle
(`CryAlert` is the incident row) and the T+5 / T+15 escalation timeline that must
survive an application restart.

The harness is **not** a standard unit-test project. It is a standalone console
executable that references the **built** `WebApplication2.dll` and runs against the
**real development SQL Server database**, inside a single transaction that is always
rolled back. See [section 4](#4-how-it-is-built-and-run) for why.

Expected result: **83 passed, 0 failed, exit code 0**.

---

## 2. What it tests

| Group | IDs | What is proven |
|---|---|---|
| Incident creation | `T5-1`, `T5-0` | Authorized sitter creates an `Open`, stage-0 incident bound to the **Active** session |
| Authorization | `T5-3`...`T5-8`, `C5-3`, `C5-4b` | Every `MonitoringDenial` maps correctly: wrong job, child not in job, non-guardian parent, unassigned sitter, no active session |
| Child / job / session validation | `T5-2`, `T5-2b`, `T5-3b` | Each incident binds to its **own** session; a session mismatch is not even expressible |
| Deduplication | `T5-9`/`T5-10`, `T5-10b`, `T5-dedupe-scope` | A re-firing detector reuses the open incident and never moves the deadline; a *new* incident only after resolution |
| Escalation timing | `T5-12`...`T5-15`, `T5-15b`, `T5-18` | `NextEscalationDueAt` = created+5s, then created+15s; the stage never regresses |
| Atomic claiming | `T5-13`, `T5-16`/`T5-17`, `T5-17b` | Nothing is claimed before it is due; a duplicate sweep cannot double-notify |
| Sitter response | `T5-19`/`T5-20`, `T5-21`, `T5-21b`, `T5-22` | `GoingToChild` acknowledges, records actor/timestamp/audit, postpones parents, and is **idempotent** |
| Parent escalation | `T5-16b`, `T5-16c`, `T5-21b` | Stage 2 fans out to **all** guardians, one notification each |
| Cancellation | `T5-33`/`T5-35`, `T5-33b`/`T5-34`, `T5-cancelled-resolve` | Ending a session cancels its incident (never deletes); a cancelled incident never resumes and cannot be resolved |
| Job completion / cancellation teardown | `T5-33c`, `T5-34b`, `T5-resolved-terminal`, `T5-gate`, `T5-gate2` | A terminal job ends sessions and cancels incidents; a **Resolved** incident is never rewritten |
| Monitoring-session teardown | `T5-33`/`T5-35`, `T5-33c`, `T5-gate2` | Session end and job terminal states both stop escalation |
| Audit events | `T5-36*`, `T5-37*`, `T5-38*` | Every step is audited with a real actor (server steps use actor `0`/`Server`); no tokens/passwords/room names leak |
| Persistence across restart | `T5-28`/`T5-29`/`T5-30` | A **fresh** service instance claims the pending plan straight from the DB — no in-memory timer needed |
| DTO exposure / security | `C5-1b`, `C5-2b`/`C5-2c`, `C5-4`, `C5-7`...`C5-8b` | No `RoomName`/ids/placeholders leak; ops sweep is 401 without the key, 400 on bad input |
| Phase 3/4 regression | `T5-0`, `T5-2b`, `T5-3b` | Session lifecycle and access rules from Phase 3/4 still hold |
| Database residue cleanup | `R1`-`R6` | Table counts and job statuses are identical to the pre-run baseline |

---

## 3. Fixture rules that matter for maintenance

These were discovered while getting the suite green. Changing them produces failures
that look like product bugs but are not.

1. **`ChildGuardian` is the only authority for guardian access.**
   `MonitoringAccess` resolves a parent as a guardian *exclusively* through
   `ChildGuardian (Child_ID, Parent_ID, IsDeleted = 0)`.

2. **`Child.Parent_ID` alone does NOT satisfy the check.**
   A child whose `Child.Parent_ID` equals the caller is still `NotGuardian` when no
   `ChildGuardian` row exists.

3. **Child 27 and Child 29 need different fixtures.**
   * **Child 27** — multi-guardian fan-out. Needs two guardian rows: parent `34`
     (the job owner) **and** a second parent that is *neither* `34` *nor* `1`.
   * **Child 29** — used by the response/resolution tests. Needs **one** guardian row
     for parent `34`; without it every parent-authorized call returns `NotGuardian`
     instead of `InvalidRole`, and `GetIncident` throws.

4. **Parent 1 is reserved as the "non-guardian" probe.**
   The second guardian for child 27 must never be parent `1`, because `T5-7` uses
   parent 1 to assert `NotGuardian`.

5. **`JobService` uses EF change tracking.**
   The harness shares one `DbContext`. A raw-SQL status change (e.g.
   `UPDATE Job SET Status = ...`) is invisible to a later EF query, which returns the
   **tracked, stale** entity and rejects the transition with
   *"Cannot update status: Job is already ..."*. `SetJobStatus` therefore calls
   `db.Entry(tracked).Reload()` after the raw update.

6. **`ClaimsPrincipalHelper` reads `Thread.CurrentPrincipal`.**
   That is process-wide state, so the **last** simulated login silently applies to all
   later controller calls. Every simulated request must re-assert its principal
   (`SetPrincipal` / `Reauth` in the harness) or the test acts as the wrong user.

7. **Sitter response timing uses frozen `max()` semantics:**
   ```text
   max(created + 15 seconds, response + 10 seconds)
   ```
   A response arriving **more than 5 s** after the incident keeps the T+15 deadline
   (delta 15 s); only a response inside that window yields a delta of exactly 10 s.
   Asserting a flat `+10 s` is incorrect — the product behaviour is the `max()`.

---

## 4. How it is built and run

There is deliberately **no `.csproj`**: the harness compiles with the .NET Framework
`csc` directly against the already-built backend assembly. This keeps it entirely
outside the production `WebApplication2` project — it is *not* part of the shipped web
app and cannot affect it.

1. **Rebuild the backend** so the harness never runs against a stale assembly:
   ```powershell
   cd 'e:\Fyp Fazooliyaaat\Unified Backend Workspace\WebApplication2'
   & 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe' `
       WebApplication2.csproj /t:Rebuild /p:Configuration=Debug
   ```

2. **Assemble a working folder** (any directory will do) and copy in the harness plus
   its runtime dependencies:
   ```powershell
   $work = "$env:TEMP\phase56-harness"
   New-Item -ItemType Directory -Force -Path $work | Out-Null
   Copy-Item '.\docs\testing\phase5_6_harness\Program.cs' $work -Force
   Copy-Item '.\WebApplication2\bin\WebApplication2.dll'       $work -Force
   # also required: EntityFramework.dll, EntityFramework.SqlServer.dll,
   #                 System.Web.Http.dll, System.Net.Http.Formatting.dll
   Copy-Item '.\WebApplication2\bin\WebApplication2.dll.config' `
             (Join-Path $work 'Phase56Harness.exe.config') -Force
   ```

3. **Compile** with `csc`:
   ```powershell
   cd $work
   & 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:exe `
       /platform:x64 /out:Phase56Harness.exe `
       /r:WebApplication2.dll /r:EntityFramework.dll /r:EntityFramework.SqlServer.dll `
       /r:System.Web.Http.dll /r:System.Net.Http.Formatting.dll `
       /r:System.Data.dll /r:System.Configuration.dll /r:System.Net.Http.dll Program.cs
   ```

4. **Run it** (the connection string lives in `Phase56Harness.exe.config`, copied from
   the backend `Web.config`):
   ```powershell
   & '.\Phase56Harness.exe'
   $LASTEXITCODE   # 0 = all passed
   ```

Expected tail of output:

```text
[TX] ROLLBACK executed
PASS  R1 residue: CryAlert count == baseline (0)
...
RESULT: 83 passed, 0 failed
```

### Why a transaction instead of a mocked database

The behaviour under test **is** SQL behaviour: atomic claiming (`UPDLOCK` + `READPAST`),
the persisted `NextEscalationDueAt` deadline, and the uniqueness of the audit rows. A
mocked or in-memory provider could not prove any of that, so the harness runs against
the real engine.

* All fixtures and assertions run inside **one** `DbContextTransaction`.
* The transaction is **always rolled back** (including on an unhandled exception), so
  the development database is left exactly as it was found.
* The `R1`-`R6` checks then re-open a **fresh** context and compare table counts and
  job statuses against a baseline captured *before* the run — proving the rollback
  really cleaned up rather than merely appearing to.

### Environment used for the recorded result

* SQL Server Express (`DESKTOP-UD649GB\SQLEXPRESS`), database
  `BabySitterBooking and BabyMinder`.
* Jobs `170`/`171`, parent `34`, sitters `19`/`20`, children `27`/`29` are pre-existing
  rows the harness borrows (all rolled back afterwards).
* `SQLAgent$SQLEXPRESS` is **stopped/disabled** on this machine, so the run exercised
  the **sweep-on-poll** path. The SQL Agent configuration is reference-only — see
  `docs/database/phase5_6_escalation_scheduler.sql`.

### Deployment warning — `MonitoringOpsSweepKey`

`Web.config` currently ships a **development placeholder**:

```xml
<add key="MonitoringOpsSweepKey" value="dev-ops-sweep-key-change-me" />
```

This value is committed deliberately as a placeholder — **no real secret belongs in
version control.** Before any real deployment, override it through deployment
configuration (transform / environment-specific config / secret store) with a long
random value.

Until it is replaced, the `POST api/monitoring/ops/sweep` endpoint is protected only by
this guessable string. The endpoint fails closed (HTTP 503) if the key is missing
entirely, so never deploy with the setting removed.

### Related regression harnesses

Phase 3 and Phase 4 have their own harnesses in the same style (42 and 60 assertions
respectively). They are not preserved in this repository; rebuild them the same way
against the current `WebApplication2.dll` to confirm no regression was introduced by
`CryIncidentService`.

