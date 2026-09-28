# Phase 4 Verification Harness (Heartbeat & Connection Loss)

Preserved source for the **Phase 4** regression baseline: sitter/parent heartbeat,
connection-loss detection and connection restoration.

* `Program.cs` — the harness (60 assertions, IDs `T4-*`).
* `Phase4Harness.exe.config.template` — config template (no credentials).

**Verified baseline:**

```text
60 passed
0 failed
exit code 0
```

---

## 1. What it validates

Phase 4 added liveness tracking on top of the Phase 3 session lifecycle: each
participant heartbeats independently, and the backend derives a
`Connected` / `Lost` state per side without anyone declaring it.

Coverage confirmed by a live run:

* **Heartbeat** — sitter and parent beats are accepted and update only their own
  timestamp (`T4-1`, `T4-2`).
* **Independent parent/sitter stamps** — a sitter beat touches *only*
  `SitterHeartbeatUtc` and a parent beat *only* `ParentHeartbeatUtc`; the other side
  stays `NULL` and unchanged (`T4-3a`, `T4-3b`). A lost connection on one side never
  ends the session while the other is still fine.
* **Connection loss** — a stale parent derives `ParentConnection = Lost` while the
  sitter stays `Connected` (`T4-14`); three further polls still produce **exactly one**
  `ConnectionLost` event, and re-staling the same episode does not duplicate it
  (`T4-15`, `T4-15b`, `T4-15c`).
* **Connection restoration** — a heartbeat after a loss yields **exactly one**
  `ConnectionRestored` for that side and keeps the **same** session row (same id,
  still `Active`, no new row) (`T4-16`, `T4-16b`, `T4-17`).
* **Monitoring access denials** — unassigned sitter, non-guardian parent, child not in
  the job and every non-`In Progress` job status are refused, and a denied heartbeat
  leaves no session and does not mutate the other child's stamps (`T4-8`...`T4-12`,
  `T4-21`, `T4-21b`, `T4-22`).
* **Session lifecycle regression** — a session never beaten derives `Lost`/`Lost` with
  `NULL` stamps (`T4-13b`), and other children's sessions stay untouched (`T4-20`).
* **Response/request hygiene** — the request DTO carries only `JobId` + `ChildId`, and
  the response only `Ok` + `ServerTimeUtc`, with no room names, tokens or DB internals
  (`T4-5`, `T4-23`).

---

## 2. IMPORTANT — the `999` heartbeat timeout is required

This harness **will fail** unless its `.exe.config` sets:

```xml
<add key="MonitoringHeartbeatTimeoutSeconds" value="999" />
```

That is deliberate and is the point of several tests. The backend's `Web.config`
default is `15`, so with the default a 60-second-old heartbeat correctly reads
`Lost`. By running the harness at `999`, a 60-second-old beat **stays `Connected`** —
which proves the timeout is genuinely read from configuration rather than hard-coded.
The template in this folder already contains the setting; do not remove it.

---

## 3. Build and run

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
   $work = "$env:TEMP\phase4-harness"
   New-Item -ItemType Directory -Force -Path $work | Out-Null
   Copy-Item '.\docs\testing\phase4_harness\Program.cs' $work -Force
   Copy-Item '.\WebApplication2\bin\WebApplication2.dll'      $work -Force
   # also required: EntityFramework.dll, EntityFramework.SqlServer.dll,
   #                 System.Web.Http.dll, System.Net.Http.Formatting.dll
   Copy-Item '.\docs\testing\phase4_harness\Phase4Harness.exe.config.template' `
             (Join-Path $work 'Phase4Harness.exe.config') -Force
   # then edit that copy: replace <YOUR-SERVER> with your SQL Server instance
   # and KEEP the MonitoringHeartbeatTimeoutSeconds=999 setting
   ```

3. **Compile:**
   ```powershell
   cd $work
   & 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:exe `
       /platform:x64 /out:Phase4Harness.exe `
       /r:WebApplication2.dll /r:EntityFramework.dll /r:EntityFramework.SqlServer.dll `
       /r:System.Web.Http.dll /r:System.Net.Http.Formatting.dll `
       /r:System.Data.dll /r:System.Configuration.dll /r:System.Net.Http.dll Program.cs
   ```

4. **Run and verify:**
   ```powershell
   & '.\Phase4Harness.exe'
   $LASTEXITCODE      # expect 0
   # expect final line: RESULT: 60 passed, 0 failed
   ```

5. **Verify database residue** (see section 4).

---

## 4. Transaction, rollback and residue

The harness runs its fixtures and assertions against the **real** development database
inside **one** `DbContextTransaction`, which is **always rolled back** — including on
an unhandled exception. It then re-opens a **fresh** context and compares
`MonitorSession` / `MonitorEvent` / `ChildGuardian` counts, job statuses and the
connection-event baseline against values captured *before* the run.

Expected after a clean run: `MonitorSession`, `MonitorEvent` and `ChildGuardian` back
to their pre-run counts, job statuses unchanged, and no leftover `ConnectionLost` /
`ConnectionRestored` audit rows.

---

## 5. Environment used for the recorded baseline

* SQL Server Express (`DESKTOP-UD649GB\SQLEXPRESS`), database
  `BabySitterBooking and BabyMinder`.
* The harness borrows pre-existing rows (jobs, parents, sitters, children) and rolls
  them back; it creates no permanent test data.

> **Reproducibility note:** the baseline above was verified on the development machine
> described here. It has **not** been reproduced from a clean checkout on a different
> machine, because the harness depends on specific pre-existing seed rows in the
> development database. Treat 60/60 as the *recorded* baseline for this environment.

## 6. Related harnesses

* `docs/testing/phase3_harness/` — access and session lifecycle regression (42 assertions).
* `docs/testing/phase5_6_harness/` — cry incident lifecycle and escalation (83 assertions).

