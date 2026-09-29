# Phase 10 — Final System Audit & Reference Freeze

**Status:** COMPLETE
**Baseline commit:** `5e79a2b` — `phase9-runtime-e2e-verification` (not amended)
**Phase 10 commit:** `phase10-final-system-audit-freeze`
**Scope:** audit, document and freeze the current implementation. No rewrite, no new
features, no architecture replacement.

---

## 1. Executive summary

The current system is a **coherent, working monitoring reference** whose correctness
rests on three properties verified at runtime, not asserted:

1. **A single authorization boundary** (`MonitoringAccess`) that decides identity
   *before* examining the target, and resolves guardians only from `ChildGuardian`.
2. **Server-authoritative time**: escalation is persisted in the database, so
   deadlines survive restarts and cannot be influenced by a client.
3. **A thin client**: React renders server state and never decides timing, roles,
   approvers or expiry.

Phase 9 proved these on the real stack. Phase 10 audited the whole system and found
**one significant pre-existing defect** that only a schema-versus-code comparison plus
a live probe could reveal. It was documented precisely and deliberately **not**
rewritten. No production behaviour changed in Phase 10: this phase's output is
documentation, classification and evidence. That is intentional — an audit phase that
"improves" working code has stopped being an audit.

| Verdict | Detail |
|---|---|
| Monitoring / escalation / guardian core | **Working and verified** (E1–E17; 291 harness assertions) |
| Security boundary | **Intact**; no injection, no client-supplied actor, no monitoring exception leakage |
| Media | **NOT CONFIGURED / NOT VERIFIED** — no claim made anywhere |
| Concurrency | **Sequentially verified only** — not proof of parallel safety |
| Co-parent monitoring access | **Known gap** (Phase 9 D4), by design, unresolved |
| Legacy cry endpoint | **BROKEN** — new Phase 10 finding F1 |

---

## 2. Current architecture

ASP.NET Web API 2 · .NET Framework 4.7.2 · EF6 6.x Database-First (`Model1.edmx`)
· SQL Server · opaque DB-backed sessions · React 19 + Vite SPA · HTTP polling
(heartbeat 8 s, session/incident 5 s) · media unconfigured.

Seven monitoring tables sit outside the EDMX and are reached with parameterized raw
SQL — see `docs/architecture/DATABASE_OBJECTS_OUTSIDE_EDMX.md`.

---

## 3. Phase 3–9 completion status

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| 3 | Monitoring access + session lifecycle | Complete | 42/42 |
| 4 | Heartbeat + connection loss | Complete | 60/60 |
| 5/6 | Cry incident lifecycle + escalation | Complete | 83/83 |
| 7 | Guardians, pause, DND | Complete | 106/106 |
| 8 | Frontend monitoring integration | Complete | build + lint |

---

## 5. Known limitations (explicitly retained, not hidden)

| # | Limitation | Status |
|---|---|---|
| **L1** | **Live media not configured.** UI capability exists; the authorization/room path exists; the room is a `pending-*` placeholder; **actual video transmission has never been verified**. | Not fixed. No claim made. `meet.jit.si` must not be used as a shortcut. |
| **L2** | **True concurrency is not proven.** All tests are sequential. Atomic escalation claiming, pause approval, DND mutual exclusion and duplicate-notification prevention are *designed* for concurrency but **not demonstrated** under genuine parallel load. | Not fixed. No concurrency framework was introduced. |
| **L3** | **Co-parent monitoring access gap** (Phase 9 D4). | Documented; unresolved by design. |
| **L4** | **Feeding feature** (supervisor requirement). | Documented only; **not implemented**. |

---

## 6. Findings introduced by Phase 10

### F1 — P1: the legacy `/cry-detection` endpoint creates incidents that can never fire

**Discovered by** comparing the EDMX against the live schema, then confirming with a
live HTTP probe.

**Evidence chain**

1. The EDMX `CryAlert` entity maps **9** columns; the table has **21** (Phase 5/6
   added 12). The legacy `CryAlertService.PostCryAlert` still uses that stale EF
   entity (`_db.CryAlerts.Add(...)`).
2. Because the migration added defaults `DF_CryAlert_Status='Open'` and
   `DF_CryAlert_EscalationStage=0`, the insert **succeeds** — verified live:
   HTTP 200, `{"roomName":"baby-20260929-95d228","message":"Alert received"}`.
3. The inserted row has `Child_ID = NULL`, `MonitorSession_ID = NULL` and
   **`NextEscalationDueAt = NULL`** (verified by direct row read).
4. The sweeper's claim query requires
   `AND NextEscalationDueAt IS NOT NULL AND NextEscalationDueAt <= GETUTCDATE()`.
   So **this row can never be claimed, escalated, or notify anyone** — silent dead
   data that still reports success to the caller.
5. The React `/cry-detector` screen still calls it (`CryDetector.jsx` →
   `POST /cry-detection`) and then sets *"🚨 Parent connected. Video call stream
   open."* — a false claim: no parent was contacted, no notification was sent, and
   the "room" is a placeholder.

**Impact:** the client-side YAMNet cry detector — a headline feature — produces
alerts that do nothing while telling the sitter a parent is connected.

**Classification:** **REMOVE** (do not carry forward). The detector must post into
the existing monitoring incident pipeline.

**Why not fixed in Phase 10:** it is a functional/UX defect, not a security defect,
and correcting it means rewiring a feature and changing user-visible behaviour —
outside the "audit, don't rewrite" boundary. It is escalated as the **top item for
the next phase**. Note the safe direction here is *removing a duplicate path*, not
weakening anything in the monitoring pipeline.

> **Audit honesty note.** I initially suspected the stale EDMX would make the insert
> *fail* (`EscalationStage` is `NOT NULL`). A live probe disproved that: the
> defaults exist. The finding that survived is the NULL deadline, which is both
> verifiable and consequential. Schema claims in this project must be **probed**,
> not inferred from metadata shortcuts (`COLUMNPROPERTY(..., 'HasDefault')` proved

---

## 7. Security audit

| Check | Method | Result |
|---|---|---|
| SQL injection | Grep for interpolated (`$"…"`) and concatenated SQL across all `.cs` | **PASS** — zero matches; all SQL uses `@p0`-style parameters |
| Client-supplied actor/approver/DND-owner id | Grep `request.(UserId|ParentId|ApproverId|RequestedBy|DecidedBy|Duration|Seconds)` in `MonitoringController` | **PASS** — zero matches; all derived from the token |
| Client-controlled duration/expiry | DTO field audit | **PASS** — no duration field exists; 150 s verified server-side |
| Authorization bypass | Runtime E17 (non-guardian, unassigned sitter, wrong child, wrong job state, no token, bad token) | **PASS** — all denied |
| IDOR | `GetParentJobs` / `GetJobById` ownership checks | **PASS** (and intentionally strict — the cause of the D4 gap) |
| Guardian authority | `MonitoringAccess` Rule 4 | **PASS** — `ChildGuardian` only |
| Enumeration oracle | Identity checked before child existence | **PASS by design** — unknown child and forbidden child both 403 |
| Token exposure | Runtime E5 (URL, localStorage keys) | **PASS** — no room/token in URL; keys are session fields only |
| Room/secret exposure | `RoomName` deliberately excluded from DTOs | **PASS** |
| Ops endpoint | Static read | **PASS** — fails closed 503, constant-time compare, uniform error |
| CORS | Static + runtime | **PASS** — config-driven allow-list, fails closed, warned if `*` |
| Swagger | Static | **PASS** — gated by `EnableSwagger`, off in Release |
| Public surface | Enumerated all `[AllowAnonymous]` | **PASS** — 10 actions: 2 logins, 2 registrations, 3 public rating/profile reads, ops sweep (secret-protected) |
| Soft-delete bypass | Query audit | **PASS** — consistent `IsDeleted = 0` |
| Exception leakage | Monitoring vs legacy | **Monitoring PASS**; legacy **F2** (P2) |
| Passwords at rest | DB probe | **28 parents: 4 BCrypt, 24 legacy plaintext/SHA.** Code is correct; the *seed data* is not. Classified MODIFY. |

---

## 8. Database audit

Baseline before and after this phase is **identical** (ChildGuardian 29,
Notification 81, UserSessions 100, all monitoring tables 0). Audit probe rows and
fixtures were removed; see `DATABASE_OBJECTS_OUTSIDE_EDMX.md` for the full picture.

* **Indexes are deliberate and correct.** `UQ_ChildGuardian_Child_Parent` enforces
  guardian uniqueness in the database; `IX_CryAlert_Due (Status, NextEscalationDueAt)`
  matches the sweeper's query exactly.
* **FKs present** on the safety-critical relations; intentionally **absent** on
  `GuardianInvitation` / `MonitoringPause` / `MonitoringDnd` / `MonitorEvent` so
  audit history survives deletion of a parent record.
* **No CHECK constraints** on monitoring tables — status integrity is enforced in
  application code. Acceptable today; the future schema should add them.
* **UTC + soft delete** consistently applied; `MonitorEvent` is append-only.
* **Migrations are additive and re-runnable** (AD12 holds). No EDMX regeneration.
* **Known drift:** the `CryAlert` EDMX entity maps 9 of 21 columns (see F1).

---

## 9. Frontend audit

| Area | Result |
|---|---|
| Polling ownership | **Single owner** (`useMonitoring`): heartbeat 8 s, session 5 s, `inFlightRef` guard prevents stacked polls, `clearInterval` cleanup on every interval |
| Client authority | **None** — no client-side timing, role, approver or expiry logic |
| Routing | Parent and sitter monitoring routes verified at runtime |
| Status normalization | Working but **duplicated** across 3 files — classified MODIFY (this duplication caused D1/D2) |
| Loading / error / empty / unauthorized states | All present and verified in a real browser |
| Responsive | Verified 360–1280 px, no horizontal overflow |
| Hard-coded API origins | **None** |

---

## 10. Monitoring, guardian, pause and DND audit

| Area | Verdict | Evidence |
|---|---|---|
| Session lifecycle | **Verified** | E1 idempotent start, clean end |
| Authorization | **Verified** | E17 all denial paths |
| Heartbeat / loss / restore | **Verified** | E14/E15; loss never ends the session |
| Cry escalation | **Verified** | E3, exact +5 s / +15 s; atomic claim; re-poll does not re-escalate |
| Sitter response | **Verified** | E4, `max(created+15, responded+10)`, actor from token |
| Guardian invitation | **Verified** | E16 full lifecycle, hashed token, no raw token returned |
| Pause | **Verified** | E7–E11; exactly 150 s, server-derived; fresh incident after resume |
| DND | **Verified** | E12/E13; per-user, mutually exclusive, presentation-only |
| Notifications | **Verified** | E3/E6 fan-out to all guardians, no duplicates |
| Concurrent-safety | **NOT PROVEN** | L2 — sequential only |

---

## 11. Media status

| Capability | Status |
|---|---|
| Monitoring UI (frame, controls, honest unconfigured notice) | **Verified working** |
| Media authorization / room handling | **Verified** (`pending-*` placeholder, never exposed as a secret) |
| **Actual video/audio transmission** | **NOT CONFIGURED — never tested** |

No credentials exist in this environment. None were invented, and `meet.jit.si` was
not used as a shortcut. The feeding feature (§13) is therefore **blocked on media
configuration**.

---

## 12. Requirements matrix

Full matrix with per-item evidence and reasoning:
**`docs/requirements/REQUIREMENTS_MATRIX.md`**

| Class | Items |
|---|---|
| **KEEP** | The entire working core: auth/session, job lifecycle, monitoring, escalation, guardians, pause, DND, notifications, the security boundary, and the UI patterns |

---

## 14. Modern backend migration summary

Full document: **`docs/architecture/MODERN_BACKEND_MIGRATION_NOTES.md`**

Preserve: the authorization chain and its identity-before-target ordering;
`ChildGuardian`-only authority; persisted server-authoritative escalation; the
business rules (150 s pause, +5/+15 escalation, `max(created+15, responded+10)`,
DND presentation-only, loss ≠ end); the audit trail; the fail-closed ops posture.

Do not copy: status-string duplication; EDMX-as-truth; scattered raw SQL;
`ex.Message` responses; the duplicate incident path; silent `list[0]`-style
fallbacks; device-as-user; `localStorage` bearer tokens; legacy plaintext rows.

Principles: ASP.NET Core + EF Core with real migrations; explicit domain
boundaries; injectable clock; DTOs with no writable authority fields; centralized
error handling; modern DI and structured logging; secrets management; API
versioning; real media integration; and **API verification before UI integration**.

---

## 15. Outstanding risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Legacy cry path silently produces dead alerts and a false "parent connected" claim (F1) | **High** | Top item for the next phase; remove the duplicate path |
| R2 | Concurrency unproven (L2) | Medium | Write a real parallel test for claim/approve/DND in the new backend |
| R3 | Media unconfigured, blocking both the demo and feeding | Medium | Obtain real provider credentials before any media work |
| R4 | Co-parent cannot reach monitoring (D4) | Medium | Guardian-aware listing in the new backend — do **not** weaken the IDOR rule |
| R5 | Legacy plaintext password rows | Medium | Rotate / force-migrate; never migrate them forward |
| R6 | Exception text leakage in legacy controllers (F2) | Low | Global exception filter in the new backend |
| R7 | EDMX drift (F1) | Low | EF Core migrations eliminate this class of problem |
| R8 | Status-string duplication could recur | Low | Single canonical value + one shared normalizer |

---

## 16. Recommended next phase

1. **Requirements reconciliation** with the supervisor, resolving every **RESEARCH**
   item (G5, D4, N4, X4, F9, FE9) — these are decisions, not code.
2. **Design** the modern ASP.NET Core + EF Core backend using
   `MODERN_BACKEND_MIGRATION_NOTES.md` as the specification, and delete the legacy
   cry path in the design (R1).
3. **Implement** the backend, then **verify it through Postman/API** before any
   frontend work.
4. **Rebuild/integrate the frontend** against the verified API, with one shared
   status normalizer.
5. **Final human code-understanding pass.**

**Do not begin any of this inside Phase 10.**

---

## 17. Test results (Phase 10, re-run)

| Suite | Result |
|---|---|
| Backend build (`MSBuild /t:Rebuild`) | **PASS** |
| `npm run build` | **PASS** |
| `npm run lint` | **PASS** |
| Phase 3 harness | **42 / 42** |
| Phase 4 harness | **60 / 60** |
| Phase 5/6 harness | **83 / 83** |
| Phase 7 harness | **106 / 106** |

Phase 9 runtime suites were **not** re-run because Phase 10 changed **no production
code** — only new documentation was added. The existing Phase 9 evidence
(HTTP 110/110, browser 60/60) therefore still stands unweakened.

---

## 18. Git checkpoint

| Item | Value |
|---|---|
| Phase 9 (parent, untouched) | `5e79a2b` — `phase9-runtime-e2e-verification` |
| Phase 10 commit | `phase10-final-system-audit-freeze` |
| Production code changed | **none** |
| Database changed | **none** — restored to the Phase 9 baseline; audit probe rows removed |
| Pushed | **No** |
| Suggested tag | `fyp-current-reference-v1` — **not created by me**; see the note below |

> **Tag recommendation.** The audit supports freezing the current implementation, with
> one explicit caveat: the freeze contains a knowingly-broken path (**F1**) that is
> documented and classified REMOVE. Create the tag only if you are content for that
> known defect to be part of the reference baseline. I did not create it — tagging
> is a project decision, not an audit output.

| **MODIFY** | Status-string canonicalisation; EDMX → EF Core; global exception filter (F2); `localStorage` token strategy; legacy password rows; media configuration; shared status normalizer; CDN policy; feeding (FE1–FE7, FE10) |
| **REMOVE** | Legacy `/cry-detection` path and its `/cry-detector` screen (F1/C7/F8); video recording and video file storage (FE8) |
| **RESEARCH** | Co-parent monitoring reachability (G5); DND duration (D4); offline-notification behaviour (N4); media provider choice (X4); external CDN/ToS (F9); father/other guardians for feeding (FE9) |

**Nothing classified REMOVE was deleted.** The current system remains the reference.

---

## 13. Future Feeding requirement

Fully specified in **`docs/requirements/FEEDING_FEATURE_REQUIREMENT.md`**.
Summarised: a "Baby Is Fed" action on **Parent Phone 2** (a device/actuator, never a
user), feeding concurrent with — not replacing — monitoring, an alert to the mother,
persisted feeding history with feeds-today and time history, an **explicit** stop
action with **no invented timeout**, connection loss keeping the feed `InProgress`,
**no recording**, initial scope limited to sitter + mother + phone, and integration
with the existing monitoring/media architecture rather than a second video system.

**Classification: MODIFY / FUTURE IMPLEMENTATION. Not implemented in Phase 10.**

| Secrets in the SPA | **None** (only form-field names and comments) |
| External CDN dependency | TF.js from `cdn.jsdelivr.net`; OpenStreetMap tiles + Nominatim — classified RESEARCH (availability/CSP/ToS) |
| Console debugging left in | `console.error` in `Login.jsx` error paths only — acceptable |

> misleading here).

### F2 — P2: legacy controllers return raw `ex.Message`

~120 sites across `ParentController`, `BabySitterController`, `BidsController`,
`MatchingController`, `ReviewController`, `JobsController`, `ChildrenController`,
`ImageController` and `NotificationsController` return raw exception text, which can
disclose SQL, table/column names or paths.

**Scope check:** the **monitoring surface is clean**. Every generic
`catch (Exception)` in `MonitoringController` returns a fixed message and logs
details via `Trace.TraceError`; the `ex.Message` uses there are typed catches
carrying the app's own controlled, user-safe text. Confirmed at runtime in E17 (no
stack trace, SQL text or exception detail reached the DOM).

**Classification:** **MODIFY** in the future backend (global exception filter). Not
fixed now: a ~120-site refactor is not a contained fix, and a partial fix would
leave the codebase inconsistent.

| 9 | **Runtime E2E verification** | Complete | HTTP 110/110, browser 60/60; 3 defects found and fixed |
| 10 | **Audit + freeze** | Complete | this document |

---

## 4. Runtime evidence (re-confirmed in Phase 10)

Real Chrome 153 over CDP → React SPA → HTTP API → SQL Server.

| Measurement | Result |
|---|---|
| Sitter escalation | **+5 s** (measured) |
| Parent escalation | **+15 s** (measured) |
| Pause expiry | **exactly 150 s** (measured) |
| Client heartbeat interval | **8 s** (observed advancing 8 s apart, below the 15 s server timeout) |
| Sitter pause banner | "Monitoring temporarily paused by parent — resumes in 2:15" |
| Responsive | 360/375/390/414/480/1280 px, no horizontal overflow |
