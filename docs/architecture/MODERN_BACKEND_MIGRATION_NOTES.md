# Modern Backend Migration Notes

**Audience:** whoever designs the future ASP.NET Core + EF Core backend.
**Purpose:** record what this system learned — including its mistakes — so the next
implementation starts from evidence rather than from this code's shape.

This document is a specification, not a plan to execute now. The current
implementation is the frozen reference; nothing is being migrated in Phase 10.

---

## 1. What the current system actually is

| Aspect | Current reality |
|---|---|
| Stack | ASP.NET Web API 2, .NET Framework 4.7.2, EF6 6.x, SQL Server |
| Data access | **EF6 Database-First** (`Model1.edmx`) **plus** heavy raw SQL |
| Raw-SQL surface | 7 monitoring tables have no EDMX entity (see `DATABASE_OBJECTS_OUTSIDE_EDMX.md`) |
| Auth | Opaque GUID tokens in a `UserSessions` table, validated per request |
| Passwords | BCrypt with a legacy plaintext/SHA fallback for old rows |
| Frontend | React SPA, Vite, Axios, `localStorage` session, HTTP polling |
| Monitoring transport | HTTP polling (heartbeat 8 s, session/incident 5 s) — **no** SignalR |
| Media | **Not configured.** `RoomName` is a `pending-*` placeholder |
| Tests | 4 standalone `csc`-compiled harnesses (291 assertions) + Phase 9 runtime/browser suites |

---

## 2. What must be preserved conceptually

These were *earned* through Phases 3–9 and verified at runtime. Losing them would be
a regression, not a refactor.

### 2.1 The authorization chain (`MonitoringAccess`)

One ordered, centralized check reused by every monitoring/guardian operation:

```
role → job exists → job InProgress → identity (assigned sitter OR ChildGuardian)
     → child exists → child in JobChildren → optional session match
```

Two properties matter more than the implementation:

* **Identity is decided before the target is examined.** An unknown child is
  therefore indistinguishable from a forbidden child (both 403). This prevents
  enumeration and must be preserved.
* **`ChildGuardian` is the only guardian authority.** `Child.Parent_ID` must never
  become an authorization fallback.

### 2.2 Server-authoritative time and state

* Escalation is **persisted** in `NextEscalationDueAt`. No in-memory timers, so a
  restart loses nothing and a late worker is harmless.
* Deadlines verified at runtime: exactly **+5 s** (sitter), **+15 s** (parents),
  and `max(created+15, responded+10)` after a sitter response.
* The client never decides timing, roles, approvers or expiry. React only renders
  server state — this is what makes the system trustworthy.


### 2.4 Audit trail

`MonitorEvent` records every state change with a real actor (including `0`/`Server`
for server-driven steps), and never contains tokens, passwords or room names. Keep
this: it is what makes incident reconstruction possible.

### 2.5 Authorization-by-default operations

`POST /monitoring/ops/sweep` is operator-only: it **fails closed** (503) when the
key is unset, compares the key in **constant time**, and returns one uniform error
for missing vs wrong key. Replicate this exact posture.

---

## 3. What must NOT be copied

| Do not copy | Why (evidence) |
|---|---|
| **Status-string duplication** | The backend stored `InProgress` while some frontend code compared to `"In Progress"`. This silently routed the parent monitoring screen onto a **completed** job and hid in-progress jobs from the sitter entirely (Phase 9 D1/D2). Use one canonical value in the backend and a single shared normalizer in the client. |
| **DB-first EDMX as source of truth** | The `CryAlert` EDMX entity maps 9 of 21 columns and works only because two defaults exist. A future column added without a default would break the legacy path instantly. |
| **Raw SQL scattered through services** | 7 tables have no entity classes, so column renames are not compile-checked. |
| **`ex.Message` in HTTP responses** | ~120 legacy sites return raw exception text, which can leak SQL, table/column names and paths. The monitoring surface already does it correctly (fixed message + `Trace`) — make that the only pattern. |
| **A second, parallel incident path** | The legacy `/cry-detection` endpoint inserts a `CryAlert` with `NextEscalationDueAt = NULL`. The sweeper requires `NOT NULL`, so that row can **never** escalate or notify anyone — silent dead data, while the UI claims "Parent connected." One incident pipeline, one model. |
| **Silent fallbacks that hide bugs** | `?? list[0]` turned a failed lookup into "open the first job". Prefer an explicit empty state over a plausible-looking wrong answer. |
| **Two identity systems for one device** | For feeding, the monitoring phone is a **device**, not a user. Do not let it enter the accounts/roles model. |
| **`localStorage` bearer tokens long-term** | XSS-readable. Consider httpOnly cookies + CSRF defence. |
| **Legacy plaintext password rows** | The verifier is correct; the *data* is not. Force-migrate or rotate rather than carrying it forward. |

---

## 4. Future backend principles

1. **ASP.NET Core + EF Core with real migrations** — generated from migrations, not
   from an EDMX snapshot.
2. **Explicit domain boundaries.** `MonitoringAccess`-equivalent authorization
   belongs in one place, not re-implemented per service.
3. **Server-authoritative time** via UTC + a clock abstraction, so escalation timing
   is testable without sleeping.
4. **DTOs with no writable authority fields.** Request DTOs carry *scope only*
   (`{ jobId, childId }`); actor, approver, duration and timestamps are derived

---

## 5. Required domain entities in the future system

Minimum set, with the relationships the current system proved necessary:

* `Account` / `Parent` / `Sitter` — identity and role
* `UserSession` — opaque-token sessions (keep the revocation capability)
* `Job` (with `Status` as a **single canonical value**) — and `JobChild` membership
* `Child`
* `ChildGuardian` — the guardian authority, unique per `(Child, Parent)`
* `GuardianInvitation` — hashed token, status, expiry
* `MonitorSession` — monitoring state, heartbeat timestamps, pause state
* `CryIncident` (evolved from `CryAlert`) — status, escalation stage, `NextEscalationDueAt`, actor/timestamps
* `MonitoringPause`, `MonitoringDnd`
* `Notification`, `AuditEvent`
* `FeedingRecord` — the future feature; per `FEEDING_FEATURE_REQUIREMENT.md`

## 6. API capabilities the future system must provide

* Session lifecycle: login, logout, expiry, role.
* Job lifecycle including a **single canonical** in-progress status and a
  guardian-aware job listing (so a co-parent is not orphaned).
* Monitoring: start, end, heartbeat, session read, incident read, sitter response,
  resolve, cancel.
* Guardian: invite, list-own, accept, reject, delete; guardian list.
* Pause: request, approve, deny, withdraw, read. DND: enable, disable, read.
* Ops sweeper with a fail-closed shared secret.
* Notifications: list, mark read.
* **Feeding** (future): start, stop, read state, history, per-recipient alerting.
* Media: a real integration that issues a short-lived room token — only once a
  provider is chosen.

## 7. Security requirements to carry forward

* Centralized authorization policy; deny by default; no client-supplied actor ids.
* `ChildGuardian`-only guardian resolution.
* Identity checked before target existence (no enumeration oracle).
* Server-derived durations and timestamps; no client authority fields in DTOs.
* Constant-time secret comparison; fail closed when a secret is unset.
* Allow-list CORS; Swagger disabled by default; no exception text to clients.
* All SQL parameterized (the current codebase already achieves this — keep it).
* Password hashing with no legacy fallback rows left in the data.

## 8. Known legacy constraints and limitations to resolve

* DND duration (60 min) has no stated product requirement — confirm.
* Co-parent monitoring reachability is unresolved (see `REQUIREMENTS_MATRIX.md` G5).
* Concurrency is only **sequentially** verified; the atomic claim is designed for it
  but not proven under genuine parallel load. Write a real concurrency test early.
* Offline-notification recipient behaviour is unverified.
* Media provider is undecided; the feeding feature is blocked on it.
* The lazy `ExpireStaleJobs` side effect on job-list reads should become an explicit
  scheduled job rather than a read side effect.

   server-side. Already the monitoring convention — make it global.
5. **Centralized error handling.** One exception filter; never echo `ex.Message`.
6. **Modern DI + structured logging**, replacing `SimpleDependencyResolver`/`Trace`.
7. **Configuration & secrets management** for the ops key, media credentials and CORS.
8. **Centralized CORS allow-list**; Swagger off by default.
9. **Testability as a design goal.** The current harnesses prove business rules can be
   tested *without* a running web server — preserve that seam.
10. **API versioning** if app and backend ship independently.
11. **Media as a real integration** — chosen provider, server-issued token, short-lived
    room secrets — only after real credentials exist. Never a public fallback server.
12. **API verification before UI integration.** Prove the API with a documented client
    (e.g. Postman) *before* rebuilding the frontend.

### 2.3 Business rules worth carrying verbatim

| Rule | Value |
|---|---|
| Monitoring pause duration | exactly **150 s**, server-derived, no client input |
| Pause lifecycle | request → other guardian approves/denies; requester can only withdraw |
| Pause effect | cancels the active incident and clears its deadline |
| After resume | a cry creates a **fresh** incident at stage 0 |
| DND | per-participant, mutually exclusive, **presentation-only** |
| DND duration | 60 min — *no requirement defines this; confirm it* |
| Connection loss | marks `Lost`, **never** ends the session; recovery automatic |
| Guardian invitations | token stored **hashed**, raw token never returned |
