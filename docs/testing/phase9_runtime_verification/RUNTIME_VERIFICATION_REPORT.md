# Phase 9 — Runtime E2E Verification & Defect Remediation

**Status:** COMPLETE
**Baseline commit:** `ea14856` — `phase8-frontend-monitoring-integration` (not amended)
**Phase 9 commit:** `phase9-runtime-e2e-verification`

Phase 8's monitoring work had only been **statically reviewed** plus `npm run build`
/ `npm run lint`. This phase closes that gap by exercising the system through the
**real running application**: real browser → real React UI → real HTTP API → real
SQL Server → real monitoring state → real UI response.

---

## 1. Environment actually used

| Component | Detail |
|---|---|
| Backend | ASP.NET Web API on **IIS Express**, `https://localhost:44368` (+ `http://localhost:8089`), site `Phase9Backend` created from a standalone `applicationhost.config` **outside the repo** (no repo change) |
| Frontend | **Vite 8.0.10** dev server on `http://127.0.0.1:5173` |
| Proxy | Vite `/api` → `https://localhost:44368` (existing `vite.config.js`, unchanged) |
| Database | `DESKTOP-UD649GB\SQLEXPRESS`, database `BabySitterBooking and BabyMinder` |
| Browser | **Real headless Chrome 153** driven over the Chrome DevTools Protocol (CDP) from Node 24 using only built-ins (`fetch` + global `WebSocket`). No new npm dependency was added. |
| CORS | Verified: backend echoes `Access-Control-Allow-Origin: http://localhost:5173` for the Vite origin |
| Auth | Real opaque DB-backed sessions (`UserSessions`), real `Authorization: Bearer` |

### Test accounts used

No account was created or modified. All identities already existed as development
seed data, and each was verified at runtime by asserting the `userId` the backend
returned matched the database row.

| Role | Username | UserId | Notes |
|---|---|---|---|
| Parent A (guardian, primary) | `usmantariq` | 3 | job owner of the test job |
| Parent B (guardian, approver) | `hina` | 4 | second guardian (added as a fixture, see below) |
| Assigned sitter | `sitter4` | 4 | `Job.AssignedSitter_ID` of the test job |
| Unassigned sitter | `zara` | 3 | negative authorization probe |
| Unauthorized parent | `user5` | 5 | not a `ChildGuardian` of the child |

Credentials were **not** committed anywhere. These accounts use a legacy
**plaintext** development password that already exists in the seeded database; it was
read, never written to a source file.

### Test fixtures (created and then fully removed)

To exercise E1–E17 the following temporary rows were inserted and deleted again
(§7 proves the database returned to baseline):

* Jobs **9001** (`InProgress`, sitter 4, child 1), **9002** (`Completed`), **9003**
  (`InProgress`, different sitter), **9004** (`InProgress`, child not in `JobChildren`)
* `JobChildren` for those jobs
* `ChildGuardian` rows making **parent 3 and parent 4** both guardians of child 1.
  This was required because the shipped data gives every child exactly **one**
  guardian, so the E6–E8 "Parent A requests / Parent B approves" rule had no second
  guardian to exercise without one.

---

## 2. How results are classified

Every result below is backed by an **actual HTTP round trip or a real SQL query**,
never by reading source. `PASS` means the running system did the right thing.
Frontend-only evidence is labelled `-ui`.


---

## 3. E1–E17 results

| # | Flow | Result | Runtime evidence |
|---|---|---|---|
| E1 | Start monitoring | **PASS** | UI: login → `/baby-monitoring` → scope auto-derived to the `InProgress` job → "Start monitoring this child" → session `Active`, button disappears. `MonitorSession` created with correct `Job_ID`/`Child_ID`; a second `start` returned the **same** id (idempotent). Heartbeat advanced on the server (`04:57:43.990 → 04:57:51.990`, the documented 8 s interval) while the page stayed open. |
| E2 | Sitter monitoring | **PASS** | Sitter logs in → My Jobs → opens the in-progress job → monitoring panel renders. Sitter heartbeat stamped into `SitterHeartbeatUtc` and reported `Connected`; the parent column was **not** overwritten. Unassigned sitter denied (403). Sitter DOM contains **no** parent pause/DND/invite controls and no transmit/mic control. |
| E3 | Cry alert + escalation | **PASS** | `POST /monitoring/cry` created exactly one incident bound to the child + active session, `Open`, stage 0, with `NextEscalationDueAt = CreatedAt + 5 s` (measured delta exactly `5 s`). After T+5 stage advanced 0→1; after T+15 stage advanced 1→2 and `NextEscalationDueAt` was **cleared**. Sitter + parent `Notification` rows and `MonitorEvent` rows persisted. Re-reporting cry reused the open incident (no second row); re-polling did not re-escalate. |
| E4 | Sitter response | **PASS** | "Going to the child" → `Acknowledged`, `SitterResponse=GoingToChild`, `AcknowledgedByUserId` = the **sitter** (derived from the token). Deadline follows the real rule `max(created+15 s, responded+10 s)`. Parent calling the sitter action → 403. Repeat call idempotent. "With child" → `Resolved` (terminal) with `NextEscalationDueAt` cleared. A cry after resolution created a **new** stage-0 incident. |
| E5 | View child | **PARTIAL** | Monitoring UI: **PASS** — authorization, routing and state correct. Media backend integration: **verified as unconfigured**. Actual video: **NOT CONFIGURED** (see §8). UI honestly states "Live video is not configured on this deployment." No room secret in the URL, no room/jitsi key in `localStorage`. |
| E6 | Parent escalation | **PASS** | Stage 2 fired at T+15 and fanned out to **all** guardians resolved from `ChildGuardian` (not `Child.Parent_ID`), one notification each, no duplicates on re-sweep. |
| E7 | Pause request | **PASS** | Persisted as `Requested` with `PauseStartUtc` **NULL** — a request never self-activates; the session stayed unpaused. Requester's own approval attempt → **403**. Sitter approval attempt → 403. |
| E8 | Pause approval | **PASS (backend)** / UI reachability gap (see D4) | Approved by the *other* guardian → `PauseStartUtc`→`PauseExpiresAtUtc` measured **exactly 150 s**, `DecidedByParent_ID` = the approver. |
| E9 | Sitter paused state | **PASS** | Sitter UI showed **"Monitoring temporarily paused by parent — resumes in 2:15"** with no Approve/Decline controls. |
| E10 | Pause expiry | **PASS** | Waited the real 150 s (backend duration untouched). Server then reported `IsPaused=false` and marked the row `Expired` (`PauseExpiresAtUtc <= now`). No client countdown was used as proof. |
| E11 | New cry after pause | **PASS** | After resume a new cry produced a **fresh** stage-0 `Open` incident with a **new** `CreatedAt + 5 s` deadline — no stale stage or reused deadline. |
| E12 | DND | **PASS** | DND persisted with a 60-minute window. `MonitoringDnd.UserId` = the authenticated caller, never a client-supplied value. DND did **not** stop the cry incident, did not pause the session, and notifications were still persisted. |
| E13 | DND independence | **PASS** | A second simultaneous parent DND → 400; only one active DND row. The other guardian read the state as `IsCurrentUser=false`. Sitter could not set parent DND (403). |
| E14 | Connection loss | **PASS** | Stopping only the **parent** heartbeat for ~22 s (while the sitter kept beating) flipped `ParentConnection` to `Lost` **server-side**; the session stayed `Active` and the sitter stayed `Connected`. |
| E15 | Connection restore | **PASS** | Resuming the heartbeat returned `ParentConnection` to `Connected`. |
| E16 | Guardian invitation | **PASS** | Invitation `Pending` with `TokenHash` **hashed** and **no raw token** in the response. Self-invite refused (400). Invited parent accepted → `ChildGuardian` row created (3→4 guardians) and immediately gained monitoring access; family panel listed 4 guardians. Duplicate invitation refused (400). Rejection path → `Rejected`, **no** guardian created. An unrelated parent could not accept someone else's invitation (403). |
| E17 | Unauthorized access | **PASS** | Non-guardian parent (403), unassigned sitter (403), child not in `JobChildren` (403), job not `InProgress` (403), no token (401), bogus token (401), ops sweep not exposed (405). The UI granted **no** monitoring scope to a non-guardian and exposed no stack trace, SQL text or exception detail. |

### Two results that are correct behaviour, not defects

* **Unknown child returns 403, not 404.** The access chain checks **identity before
  child existence** (`MonitoringAccess` Rule 4 before Rule 5) deliberately, so a
  non-existent child is not distinguishable from a child the caller may not see.
* **Sitter "Connection Lost" on first read.** The sitter panel beats on an 8 s
  interval, so a read taken immediately after page load legitimately shows `Lost`.
  After one interval the server reported `Connected` and the timestamp kept advancing.


---

## 4. Defects found and fixed

All three were found **only** by running the real application; none was visible to
build, lint or the existing harnesses.

### D1 — Parent monitoring screen silently used a COMPLETED job (P1)

* **Affected flow:** E1 (and every parent monitoring entry point)
* **Symptom:** `/baby-monitoring` reported `Monitoring scope: job 9002, child Baby Ali`
  then "Monitoring not started", even though job 9001 was the live `InProgress` job.
  The API returns `Status = "InProgress"`, but the screen matched the literal
  `"In Progress"`, so the `find` never matched and silently fell through to
  `list[0]` — an arbitrary, often **completed**, job.
* **Root cause:** strict `===` comparison against a differently-spelled status
  string, plus a `?? list[0]` fallback that hid the mismatch instead of failing.
* **Fix:** `babysitter-app/src/features/parent/BabyMonitoringScreen.jsx` — normalise
  the status (trim/lowercase/strip spaces, underscores, hyphens), matching the
  convention already used in `MyJobsScreen`, and only accept a **genuinely**
  in-progress job (the arbitrary `list[0]` fallback was removed).
* **Regression:** browser assertion `E1-ui scope auto-derived to the InProgress job`,
  plus all four existing harnesses (still green).

### D2 — Sitter could not see or reach their in-progress job (P1)

* **Affected flow:** E2, E9 (sitter entry point)
* **Symptom:** the sitter's "My Jobs" screen showed **Active Jobs 0** and "No active
  babysitting sessions" while the API returned the job with `Status: "InProgress"`.
  The job matched **neither** the Active bucket (compared against `"In Progress"`)
  nor History (completed/cancelled only), so the sitter's running session was
  unreachable — and `handleJobClick` would have routed it to the **completed** screen.
* **Root cause:** the same status-spelling mismatch as D1, repeated in a second file,
  this time also in the click-routing branch and the status badge.
* **Fix:** `babysitter-app/src/features/babysitter/BabysitterMyJobs.jsx` — one
  `normalizeJobStatus` helper plus `ACTIVE/UPCOMING/HISTORY_JOB_STATUSES` sets,
  used by the three tab buckets, `handleJobClick` and the status badge.
* **Regression:** browser assertions "the InProgress job is offered to the sitter"
  and "sitter reaches the active job screen" (the real "View Details" click now
  lands on `/active-job-details`).

### D3 — Pause requester was offered Approve on their own request (P2)

* **Affected flow:** E7/E8
* **Symptom:** after requesting a pause, the **requester** still saw `Approve` /
  `Decline` buttons for their own request. The server correctly refused
  self-approval (403), so those buttons could only ever fail — misleading UX that
  invited an action the system forbids.
* **Root cause:** the panel rendered the decision buttons whenever
  `pause.Status === 'Requested'` without comparing `RequestedByParent_ID` to the
  signed-in user; it had no access to the current user at all.
* **Fix:** `babysitter-app/src/features/parent/Phase7FamilyPanel.jsx` — read the
  current user via `useAuth()`; the **requester** now only sees `Withdraw`, and
  `Approve` / `Decline` are shown only to the other guardian.
* **Regression:** browser assertions "requester is NOT offered Approve on their own
  request" and "requester can Withdraw their own request".

---

## 5. Known limitation discovered at runtime (NOT fixed — architectural)

---

## 6. Automated test results (all re-run after the fixes)

| Suite | Result |
|---|---|
| Phase 3 harness | **42 / 42** |
| Phase 4 harness | **60 / 60** |
| Phase 5/6 harness | **83 / 83** |
| Phase 7 harness | **106 / 106** |
| `npm run build` | **passed** (exit 0) |
| `npm run lint` | **passed** (exit 0, incl. CSS-module check) |
| Phase 9 HTTP/API runtime suite | **110 / 110** |
| Phase 9 real-browser UI suite | **60 / 60** |

The backend was rebuilt from source (`MSBuild /t:Rebuild`) before the harnesses ran,
so no harness executed against a stale DLL.

### Two harness-runner settings (not product changes)

Both were needed to reproduce the recorded baselines and affected only the
**temporary harness working folder**, never the repository:

1. The config templates contain an **XML-escaped** placeholder `&lt;YOUR-SERVER&gt;`;
   replacing the literal `<YOUR-SERVER>` silently does nothing, and the harness then
   fails with "server was not found" (named pipes, error 40).
2. The Phase 5/6 harness sends the literal ops-sweeper secret `harness-ops-key`,
   while the shipped development config carries the placeholder dev value. The
   controller reads the key from `MonitoringOpsSweepKey` and **fails closed**, so the
   harness's own config copy must carry the harness value.

---

## 7. Database: before → after

A verified backup was taken before any runtime testing
(`BACKUP DATABASE ... WITH INIT`, 1546 pages, ~180 MB).

| Table | Before | After | Verdict |
|---|---|---|---|
| Child | 29 | 29 | unchanged |
| Parent | 28 | 28 | unchanged |
| BabySitter | 19 | 19 | unchanged |
| Job | 148 | 148 | fixtures removed |
| JobChildren | 180 | 180 | fixtures removed |
| **ChildGuardian** | **29** | **29** | legitimate Phase 7 backfill intact |
| MonitorSession | 0 | 0 | clean |
| CryAlert | 0 | 0 | clean |
| MonitorEvent | 0 | 0 | clean |
| Notification | 81 | 81 | 87 test notifications removed |
| GuardianInvitation | 0 | 0 | clean |
| MonitoringPause | 0 | 0 | clean |
| MonitoringDnd | 0 | 0 | clean |
| UserSessions | 100 | 100 | 96 test sessions removed |

Test rows were removed using an explicit cut-off (`CreatedAt >= 2026-09-28 09:00`),
which was **verified beforehand** to leave exactly the recorded baseline
(Notification 81, UserSessions 100) — so no pre-existing row was touched. The 29
`ChildGuardian` rows required by later phases are intact, and no fixture job
(9001–9004) remains.

### One honest, non-residue database change

Two **pre-existing production-like** jobs moved from `Open` to `Cancelled`
(jobs 115 and 152, `CancellationReason = "Booking window expired without session
start"`, `CancelledAt = 2026-09-29 04:44:10`). This is the application's own **lazy
job expiration** (`JobService.ExpireStaleJobs`), which runs on job-list reads by
design; browsing the job lists in the browser triggered it. It is genuine application
behaviour on real data, **not** test residue, so it was deliberately **not** reverted
— reverting it would falsify legitimate state. It is disclosed here instead.

---

## 8. Media — explicit statement

| Item | Status |
|---|---|
| Monitoring UI (status, alerts, pause, DND, family panel) | **verified working** |
| Authorization and room handling | **verified** — `RoomName` is a `pending-*` placeholder, never exposed as a secret, no room/token in URL or storage |
| **Actual live video** | **NOT CONFIGURED — never tested** |

No JaaS/media credentials exist in this environment. None were invented and no
security was bypassed to make video appear. The UI reports the absence honestly
("Live video is not configured on this deployment"). **No claim of working live video
is made anywhere in this phase.**

---

## 9. Responsive / UI-UX verification

Rendered in the real browser at **360, 375, 390, 414, 480 and 1280 px**:

* no horizontal overflow (`scrollWidth == clientWidth` at every width)
* monitoring status (`SESSION` / `PAUSE` / `ALERT`) readable at every width
* family panel and sitter panel usable at every width

Elements extending past the viewport were confirmed to belong to the intentionally
**off-canvas navigation drawer** (translated off-screen, `overflow-x: hidden`), so
they cannot scroll the page; the overflow check therefore ignores clipped ancestors.

---

## 10. What was NOT proven

* **Live video** — not configured, therefore untestable (§8).
* **DND duration** remains **1 hour**; the phase brief forbade changing it, so it is
  recorded as existing behaviour, not verified against a product requirement.
* **True parallel concurrency** (two parents clicking approve simultaneously) was
  exercised **sequentially**, not with genuinely simultaneous requests. Sequential
  tests do not prove concurrency safety — this remains an open limitation.
* **Co-parent UI reachability** (D4) is a known, reported gap.
* Escalation timing was verified through the polling/sweep path; a dedicated external
  scheduler (SQL Agent) driving `ops/sweep` was not exercised as a long-running service.

---

## 11. Files changed in Phase 9

```
babysitter-app/src/features/parent/BabyMonitoringScreen.jsx   (D1)
babysitter-app/src/features/babysitter/BabysitterMyJobs.jsx  (D2)
babysitter-app/src/features/parent/Phase7FamilyPanel.jsx     (D3)
docs/testing/phase9_runtime_verification/RUNTIME_VERIFICATION_REPORT.md  (this report)
```

No backend, package, SQL or EDMX change was needed: all three defects were
frontend-only, and the backend's authorization, escalation, pause, DND and
notification logic was verified correct at runtime.


### D4 — A co-parent guardian cannot reach the monitoring screen through the UI (P1, documented)

Phase 7 allows several guardians per child, and the pause rule requires a pause to be
approved by **the other** guardian. At runtime the approving parent (parent 4) found
that `/baby-monitoring` rendered no monitoring content at all.

**Root cause:** the screen derives its scope from `GET /api/parent/jobs/{parentId}`,
which returns only jobs the caller **owns** (`Job.Parent_ID`) and is deliberately
restricted by the B5 IDOR rule ("a Parent may only list their own jobs"). A guardian
of someone else's child therefore has no job in that list, gets no scope, and sees
only the "No active babysitting session to monitor" empty state. The deep-link path
(`ParentActiveJobScreen` → `navigate('/baby-monitoring', { state })`) still works, but
no screen offers it to a co-parent.

**Why it was not fixed here:** closing it requires a guardian-aware job listing
(i.e. touching the IDOR boundary of a security-reviewed endpoint) or an equivalent
routing change. That is a design decision beyond "fix only what is necessary" for a
verification phase, so it is reported rather than silently expanded. The **backend is
correct** — parent 4 approved a pause over HTTP with her own real token (verified,
200). E8 is therefore PASS for the backend and the UI reachability gap is recorded
here for the next phase.
