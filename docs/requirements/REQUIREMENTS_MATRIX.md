# Requirements Matrix — Current Implementation

**Phase 10 audit.** Classification vocabulary is strict:

| Class | Meaning |
|---|---|
| **KEEP** | Required by the project, implemented, and should exist in the future system. |
| **MODIFY** | Required, but the current design should be changed in the future system. |
| **REMOVE** | Not required; should not be carried into the future system. Not deleted now. |
| **RESEARCH** | Unclear whether required. Must be resolved before the future design is frozen. |

**Evidence basis.** "Runtime" means an actual HTTP round trip or a real browser
session (Phase 9). "Static" means code/schema inspection only. "Not verified" means
no evidence exists. Nothing is claimed as working without evidence.

> **Naming note.** The frozen architecture decisions are referenced as **AD1–AD12**
> to avoid confusion with the Phase 9 defect numbers **D1–D4**.

---

## 1. Authentication & session

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |
|---|---|---|---|---|---|---|
| A1 | Parent login | `POST /api/parent/login`, BCrypt-first verify with legacy fallback, opaque token issued | Runtime (Phase 9 login) | Working | KEEP | Behaviour is correct; modern backend should reimplement on ASP.NET Core identity. |
| A2 | Sitter login | `POST /api/babysitter/login` | Runtime | Working | KEEP | As A1. |
| A3 | Unified login used by the React app | `POST /api/auth/login` | Runtime (real browser login) | Working | KEEP | The SPA does not use A1/A2; keep one canonical login for the future API. |
| A4 | Logout / token revocation | `DELETE /api/auth/logout` deletes the `UserSessions` row | Static (route + service) | Working | KEEP | DB-backed revocation is a genuine strength over stateless JWT; preserve the *capability*. |
| A5 | Session expiry | `SessionExpiryDays = 7`; `SessionAuthorize` rejects when `ExpiresAt <= UtcNow` | Static + Runtime (expired/absent token → 401) | Working | KEEP | Keep absolute expiry. |
| A6 | Role handling | `Parent` / `Sitter` via `[SessionAuthorize(Roles=…)]` and `ClaimsPrincipalHelper` | Runtime | Working | KEEP | — |
| A7 | Password storage | BCrypt for new/verified logins; 24 of 28 parent rows and most sitters are **legacy plaintext/SHA** in the dev seed | Static (DB probe) | **Insecure (dev data)** | MODIFY | Real defect in the *data*, not the code. The verifier is correct; the legacy rows must be force-migrated or rotated. Do not copy legacy rows forward. |
| A8 | Token transport/storage | Opaque GUID in `localStorage` | Runtime (Phase 9 E5) | Working, with known risk | MODIFY | `localStorage` is XSS-readable. Acceptable for the reference; future system should consider httpOnly cookie + CSRF defence. |
| A9 | Bcrypt upgrade-on-login | `PasswordHasher.UpgradePassword` rehashes on successful login | Static | Working | KEEP | Good pattern; preserve. |

---

## 2. Jobs

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |
|---|---|---|---|---|---|---|
| J1 | Job creation / series | `JobService` + `JobSeries_ID` / `SeriesOccurrenceIndex` | Static | Working (not runtime-verified in Phase 9) | KEEP | — |
| J2 | Job status lifecycle | `Open` → `Assigned` → `InProgress` → `Completed` / `Cancelled` | Runtime (Phase 9 fixtures + UI) | Working | KEEP | — |
| J3 | **InProgress vs "In Progress"** | DB stores `InProgress`; `MonitoringAccess.IsInProgressStatus` accepts both spellings | Runtime | Working | MODIFY | The backend tolerates two spellings; the frontend mostly normalizes. A single canonical status value + a shared normalizer is required. This string mismatch caused Phase 9 defects **D1** and **D2**. |
| J4 | Stale-job expiry | `JobService.ExpireStaleJobs` cancels past booking windows with an audit trail | Runtime (jobs 115/152 auto-cancelled during Phase 9 browsing) | Working | KEEP | Legitimate behaviour; keep. |
| J5 | Completion / cancellation teardown | Cancels sessions + incidents, never deletes | Static + harness (Phase 5/6) | Working | KEEP | — |
| J6 | Job ownership listing | `GET /api/parent/jobs/{parentId}` returns only owned jobs, enforced by the B5 IDOR rule | Runtime | Working | MODIFY | Correct security, but it is why a co-parent cannot reach monitoring (**D4**). Needs a guardian-aware listing, not a weakened IDOR rule. |
| J7 | Lazy job expiration on read | Runs inside job-list reads | Runtime | Working | RESEARCH | Runs as a side effect of a GET. Surprising and untested under concurrency; decide whether it belongs in a background job in the future. |


---

## 3. Child monitoring

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |
|---|---|---|---|---|---|---|
| M1 | Monitoring scope per (job, child) | `MonitorSession(Job_ID, Child_ID)` | Runtime | Working | KEEP | Per-child scoping is correct; keep. |
| M2 | Session start (idempotent) | `POST /monitoring/session/start` returns the existing Active session | Runtime (E1, same id twice) | Working | KEEP | — |
| M3 | Session end | `POST /monitoring/session/end`; cancels incidents, invalidates pause/DND | Runtime (Phase 5/6 harness) | Working | KEEP | — |
| M4 | Access authorization | `MonitoringAccess.Check` — role → job exists → InProgress → identity (assigned sitter **or** `ChildGuardian`) → child exists → `JobChildren` → optional session match | Runtime (E17) | Working | KEEP (AD5, AD9) | The single security boundary. Preserve verbatim in the future system. |
| M5 | Heartbeat | `POST /monitoring/session/heartbeat`; role decides which timestamp is stamped | Runtime (E1/E2, 8s interval) | Working | KEEP | — |
| M6 | Connection loss | Staleness check inside the authorized GET ("sweep-on-poll"), timeout 15 s | Runtime (E14) | Working | KEEP | Loss never ends the session. |
| M7 | Connection restore | Resumed heartbeat → `Connected` | Runtime (E15) | Working | KEEP | — |
| M8 | `JobChildren` membership | Raw-SQL check (table is outside the EDMX) | Runtime (E17) | Working | KEEP | Keep; note the EDMX gap. |
| M9 | Polling ownership | `useMonitoring` is the single polling owner: heartbeat 8 s, session poll 5 s, in-flight guard, `clearInterval` cleanup | Static + Runtime (heartbeat advanced exactly 8 s) | Working | KEEP (AD2) | No duplicate intervals, no stacked polls. |

---

## 4. Cry detection & escalation

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |

---

## 5. Guardian, pause and DND

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |
|---|---|---|---|---|---|---|
| G1 | `ChildGuardian` is the authority | `MonitoringAccess` resolves guardians **only** via `ChildGuardian(Child_ID, Parent_ID, IsDeleted=0)` | Runtime (E17 non-guardian denied) | Working | KEEP (AD5) | Must never fall back to `Child.Parent_ID`. |
| G2 | Guardian invitation lifecycle | Create → Pending → Accept/Reject; `TokenHash` stored hashed, raw token never returned | Runtime (E16) | Working | KEEP | Good design; preserve. |
| G3 | Duplicate prevention | DB unique index `UQ_ChildGuardian_Child_Parent`; self-invite and duplicate invite refused (400) | Runtime + schema | Working | KEEP | — |
| G4 | Requester/approver separation | Server refuses self-approval (403) and sitter approval (403) | Runtime (E7/E8) | Working | KEEP | UI now also hides it (Phase 9 D3). |
| G5 | Co-parent monitoring access | Co-parent is a valid guardian but cannot derive a monitoring scope | Runtime (Phase 9 D4) | **Gap (by design)** | RESEARCH | Backend is correct; the UI/listing cannot reach it. Requires a guardian-aware listing — a security design decision, not a UI tweak. Resolve before the future backend design. |
| P1 | Pause request → approval | `Requested` with `PauseStartUtc = NULL`; a request never self-activates | Runtime (E7) | Working | KEEP | — |
| P2 | Exactly 150 s expiry, server-derived | `PauseExpiresAtUtc - PauseStartUtc` measured **exactly 150 s**; no client duration field exists | Runtime (E8/E10) | Working | KEEP | The client cannot influence the duration. |
| P3 | Incident cancelled by approved pause | `CancelParentPauseApproved`; `NextEscalationDueAt` cleared | Runtime (E8) + harness | Working | KEEP | — |
| P4 | New cry after pause | Fresh stage-0 incident, new T+5 deadline | Runtime (E11) | Working | KEEP | — |
| P5 | Sitter paused state | Session GET exposes `IsPaused` / `PauseSecondsRemaining`; sitter UI shows the banner | Runtime (E9, real browser) | Working | KEEP | — |
| P6 | Manual viewing during pause | Sitter panel remains available | Runtime (E9) | Working | KEEP | — |
| D1 | Independent per-parent DND | One row per `(session, user)` | Runtime (E12) | Working | KEEP | — |
| D2 | Mutual exclusion | Second simultaneous parent DND → 400; transactional | Runtime (E13) | Working | KEEP (AD10) | — |
| D3 | DND is presentation-only | Cry still recorded, escalation unaffected, notifications persisted | Runtime (E12) | Working | KEEP | — |
| D4 | DND duration | **60 minutes** | Runtime | Working as implemented | RESEARCH | No product requirement defines the duration. Confirm before the future design. |

---

## 6. Notifications

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |
|---|---|---|---|---|---|---|
| N1 | Persisted notifications | `Notification` rows written for sitter and parent stages | Runtime (E3/E6) | Working | KEEP | — |
| N2 | Parent fan-out | Stage 2 notifies every `ChildGuardian` parent, one row each | Runtime (E6) | Working | KEEP | — |
| N3 | Duplicate prevention | Atomic claim; re-poll does not re-notify | Runtime + harness | Working | KEEP | — |

---

## 7. Media

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |
|---|---|---|---|---|---|---|
| X1 | Monitoring UI frame | Camera frame + controls render in the monitoring screens | Runtime (real browser) | Working | KEEP | — |
| X2 | Room handling | `MonitorSession.RoomName` generated server-side as `pending-<12 hex>` placeholder | Runtime | Working | KEEP (AD8) | Placeholder is the honest state. |
| X3 | Room/secret security | `RoomName` deliberately excluded from DTOs; no room or token in URL or storage | Runtime (E5) | Working | KEEP | — |
| X4 | Monitoring media provider | Self-hosted MiroTalk SFU with server-derived Little Care rooms | Static | Deployment configured | IMPLEMENTED | HTTPS trust and physical device media still require verification. |
| X5 | **Actual media configuration** | SFU URL + server-only room salt, held in the Git-ignored `Web.MonitoringMedia.config` | - | **CONFIGURED (dev)** | KEEP | Per-machine values stay out of Git. MiroTalk provider secrets are not required by the app. |
| X6 | **Actual media verification** | Standalone two-device POC passed over HTTP; HTTPS + in-app media not yet physically re-verified | - | **PARTIALLY VERIFIED** | MODIFY | No claim of working in-app video is made until the two-phone test is repeated over trusted HTTPS. |

---

## 8. Frontend

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |
|---|---|---|---|---|---|---|
| F1 | Parent monitoring screen | `BabyMonitoringScreen` + `MonitoringStatusBar` + `Phase7FamilyPanel` | Runtime (E1/E7/E12/E16) | Working (Phase 9 D1/D3 fixed) | KEEP | — |
| F2 | Sitter monitoring panel | `SitterMonitoringPanel` + `SitterPausedBanner` in `ActiveJobDetails` | Runtime (E2/E9) | Working (Phase 9 D2 fixed) | KEEP | — |
| F3 | Server-driven state | React renders server fields; it never decides timing, roles or expiry | Static + runtime evidence | Working | KEEP | Critical property; preserve. |
| F4 | Status normalization | `normalizeJobStatus` in `BabysitterMyJobs`, inline in `MyJobsScreen` / `BabyMonitoringScreen` | Static | Working, **duplicated** | MODIFY | Extract one shared helper; the duplication is how D1/D2 happened. |
| F5 | Responsive behaviour | Verified at 360/375/390/414/480/1280 px, no horizontal overflow | Runtime (real browser) | Working | KEEP | — |
| F6 | Loading / error / empty states | Scope loading, empty state, error alert, connection-lost copy | Runtime | Working | KEEP | — |
| F7 | Unauthorized UX | Non-guardian gets a plain empty state; no internals leaked | Runtime (E17) | Working | KEEP | — |
| F8 | `/cry-detector` screen | Client YAMNet detector posting to the dead C7 path, then showing a false "parent connected" claim | Runtime (Phase 10) | **BROKEN** | REMOVE | See C7. Do not carry forward as-is. |
| F9 | External CDN dependencies | TF.js from `cdn.jsdelivr.net`; OpenStreetMap tiles + Nominatim geocoding | Static | Works, adds availability/CSP/ToS coupling | RESEARCH | Decide self-host vs CDN, and Nominatim usage compliance, in the future build. |

---

## 9. Security

| # | Requirement | Implementation | Evidence | Status | Class | Reason / Future action |
|---|---|---|---|---|---|---|
| S1 | `MonitoringAccess` boundary | Centralised, ordered, structured denials mapped to HTTP status | Runtime (E17) | Working | KEEP (AD9) | Preserve verbatim. |
| S2 | IDOR protection | `GetParentJobs`/`GetJobById` enforce ownership; guardian set from `ChildGuardian` | Runtime | Working | KEEP | — |
| S3 | Actor identity from auth only | No controller reads an actor/approver/DND-owner id from the request body | Static (grep: zero matches) | Working | KEEP | — |
| S4 | Client cannot choose duration/expiry | No duration field exists in any monitoring DTO | Static + runtime (exactly 150 s) | Working | KEEP | — |

---

## 10. Frozen architecture decision verification (AD1–AD12)

| AD | Decision | Verified by | Status |
|---|---|---|---|
| AD1 | Escalation work is **persisted**; no in-memory timers | Deadlines live in `CryAlert.NextEscalationDueAt`; the sweeper only asks "what is due?" | **Holds** |
| AD2 | HTTP polling, not SignalR/WebSockets | `useMonitoring` polls; no push library in the frontend | **Holds** |
| AD3 | `MonitorSession` represents monitoring state | Single table for session/connection/pause | **Holds** |
| AD4 | `UserSessions` is auth infrastructure only | Used by `SessionAuthorize`; no business data | **Holds** |
| AD5 | `ChildGuardian` is the guardian authority | `MonitoringAccess` Rule 4 queries only `ChildGuardian` | **Holds** |
| AD6 | `CryAlert` is the incident record; no second model | One incident table; the legacy C7 path reuses the same table | **Holds** |
| AD7 | Server-authoritative timestamps | `DateTime.UtcNow` / `GETUTCDATE()` everywhere; no client clock | **Holds** |
| AD8 | Media stays unconfigured until real capability is verified | `RoomName` is a `pending-*` placeholder; no credentials | **Holds** |
| AD9 | `MonitoringAccess` is the security boundary | All monitoring services call it first | **Holds** |
| AD10 | DND mutual exclusion is transactional | Rejected with 400 in a transaction | **Holds** |
| AD11 | Soft-delete + audit preserved | `IsDeleted` plus `MonitorEvent` audit rows | **Holds** |
| AD12 | EF6 Database-First with additive SQL migrations | EDMX unchanged; monitoring tables added by SQL scripts | **Holds**, but see EDMX drift below |

### One architecture caveat discovered in Phase 10

The EDMX `CryAlert` entity maps only the **9 original** columns, while the table now
has **21** (Phase 5/6 added 12). The insert still works *only* because the migration
added defaults `DF_CryAlert_Status = 'Open'` and `DF_CryAlert_EscalationStage = 0`.
This is safe today but fragile: the EDMX silently disagrees with the table, and a
future column added without a matching default would break the legacy EF path
immediately. It is a primary reason to move to EF Core in the next phase.
(Initially suspected as a NOT NULL failure; disproved empirically — the defaults
exist and `COLUMNPROPERTY(..., 'HasDefault')` was the misleading signal.)

---

## 11. Future requirement — Feeding (documented, NOT implemented)

Full specification: `docs/requirements/FEEDING_FEATURE_REQUIREMENT.md`.

| # | Requirement | Class | Note |
|---|---|---|---|
| FE1 | "Baby Is Fed" action on **Parent Phone 2** (the physical monitoring phone) | MODIFY | The phone is an **actuator**, not a user/recipient. Reuse the monitoring session; do not create a parallel identity model. |
| FE2 | Feeding does not stop or replace normal monitoring | MODIFY | Feed and monitor are concurrent states of one session. |
| FE3 | Mother is alerted: "Babysitter is feeding your child now." and may view the live feed | MODIFY | Reuse the existing `ChildGuardian` fan-out; do not build a second notification system. |
| FE4 | Feeding history persisted: child, job, babysitter, start, end, status, created/updated | MODIFY | New table; additive like the Phase 2/5/6/7 migrations. |
| FE5 | Parent-facing history: feeds today + time history; sitter can also view it | MODIFY | Read-only history endpoints. |
| FE6 | Explicit feeding stop action | MODIFY | **No arbitrary timeout** — the sitter ends it. |
| FE7 | Connection loss keeps feeding `InProgress` (never auto-completes) | MODIFY | Reuse the existing connection-loss model; do not invent a second one. |
| FE8 | **No video recording / no video file storage** | REMOVE | Explicitly out of scope. Do not carry a recording concept forward. |
| FE9 | Initial scope = Babysitter + Mother + Parent Phone 2; father/other guardians deferred | RESEARCH | Do not modify the existing general guardian architecture for this. |
| FE10 | Feeding integrates with the existing monitoring/media architecture | MODIFY | Explicitly not a second, unrelated video system. |

| S5 | SQL injection | All SQL is `@p0`-parameterized; **zero** interpolated or concatenated SQL in the codebase | Static (grep) | Working | KEEP | — |
| S6 | Exception leakage (monitoring) | Generic catches return fixed text and `Trace.TraceError` the detail | Static + runtime (E17) | Working | KEEP | — |
| S7 | Exception leakage (legacy controllers) | ~120 sites return raw `ex.Message` in `catch (Exception)` | Static | **Information disclosure** | MODIFY | Pre-existing, outside the monitoring surface. Remediate in the future backend with a global exception filter. Not a small fix, so not attempted here. |
| S8 | CORS | Config-driven allow-list, fails closed to localhost, warns if `*` | Static + runtime (echoed the Vite origin) | Working | KEEP | — |
| S9 | Swagger | Gated by `EnableSwagger`; flipped off in Release publish | Static | Working | KEEP | — |
| S10 | Ops endpoint | Fails closed 503, constant-time key compare, uniform error | Static + harness | Working | KEEP | — |
| S11 | Public endpoints | Only 10 `[AllowAnonymous]` actions: logins, registrations, public ratings/profile, ops sweep (secret-protected) | Static | Working | KEEP | — |
| S12 | Soft-delete bypass | Queries consistently filter `IsDeleted = 0` | Static + harness | Working | KEEP (AD11) | — |

| N4 | Offline recipient behaviour | Notification rows persist for later retrieval | Static | Working, **not runtime-verified for a truly offline recipient** | RESEARCH | Needs an explicit offline-recipient test. |
| N5 | Notification on legacy paths | The broken C7 path notifies nobody | Runtime | Broken (via C7) | REMOVE | Resolved by removing C7. |

|---|---|---|---|---|---|---|
| C1 | Client-side acoustic detection (YAMNet) | `/cry-detector` screen loads TF.js + YAMNet from CDN and classifies audio locally | Static | **Detects locally, but its alert path is broken — see C7** | MODIFY | Local detection is a reasonable UX aid, but must never be authoritative. |
| C2 | Server-authoritative timing | Incident deadlines persisted in `CryAlert.NextEscalationDueAt`; no in-memory timers (AD1) | Runtime (exact +5 s / +15 s) | Working | KEEP (AD1, AD7) | The core design; preserve exactly. |
| C3 | T+5 sitter alert | `SitterAlertDelaySeconds = 5` | Runtime (measured 5 s) | Working | KEEP | — |
| C4 | T+15 parent escalation | `ParentEscalationDelaySeconds = 15`; fans out to all `ChildGuardian` rows | Runtime (measured 15 s) | Working | KEEP | — |
| C5 | Sitter response | `GoingToChild` acknowledges, records actor from the token, deadline becomes `max(created+15, responded+10)` | Runtime (E4) | Working | KEEP | — |
| C6 | Resolution / cancellation / dedupe / persistence | `WithChild` resolves; lifecycle cancels; re-report reuses the open incident; plan survives restart | Runtime (E3/E4) + Phase 5/6 harness (atomic claim, 83/83) | Working | KEEP (AD6) | `CryAlert` is the incident record; do **not** add a second incident model. |
| C7 | **Legacy `/cry-detection` endpoint** | `CryDetectionController` → `CryAlertService` uses the **stale EDMX entity**; inserts a row with `Child_ID=NULL`, `MonitorSession_ID=NULL`, **`NextEscalationDueAt=NULL`** | **Runtime (Phase 10 probe)** | **BROKEN** | REMOVE | The sweeper requires `NextEscalationDueAt IS NOT NULL`, so this row can **never** be claimed, escalated or notified — it is silent dead data. It is also the path the `/cry-detector` UI still calls, and that UI then shows a false "Parent connected. Video call stream open." Must not be carried forward; the detector must post to the monitoring incident pipeline. See `FINAL_SYSTEM_AUDIT.md` §F1. |
| C8 | Ops-only sweeper | `POST /monitoring/ops/sweep`, `[AllowAnonymous]` + `X-Ops-Sweep-Key`, **fails closed 503** when unconfigured, constant-time compare, uniform error | Static + Phase 5/6 harness | Working | KEEP | Correct operator design. |


