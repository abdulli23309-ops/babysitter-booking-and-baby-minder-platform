# Little Care — Project Architecture Audit

**Purpose.** A complete, end-to-end technical description of this system, written to be
defensible line-by-line in a Final Year Project (FYP) defense. It explains not just *what*
each component does, but *why the seams sit where they do* and *what invariant each seam
protects*. The examiner's likely questions concern boundaries: who may see what, and where
is that enforced.

**Verification status.** Every file path, line-level behaviour, route, table name,
configuration key and status-code contract below was read directly from source in this
repository. The only **(inference)** items are runtime behaviours depending on the external
MiroTalk SFU process, which is not vendored here and could not be executed.

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Solution layout and technology choices](#2-solution-layout-and-technology-choices)
3. [Backend architecture (ASP.NET Web API 2)](#3-backend-architecture-aspnet-web-api-2)
4. [Database schema](#4-database-schema)
5. [Session creation and the authorization chain](#5-session-creation-and-the-authorization-chain)
6. [MediaSessionService and secure room derivation](#6-mediaSessionservice-and-secure-room-derivation)
7. [Frontend architecture (React / Vite)](#7-frontend-architecture-react--vite)
8. [WebRTC and MiroTalk integration](#8-webrtc-and-mirotalk-integration)
9. [Security model](#9-security-model)
10. [Phase 9.2 — the UI state mismatch bug and its fix](#10-phase-92--the-ui-state-mismatch-bug-and-its-fix)
11. [Phase 9.2 — premium monitoring redesign](#11-phase-92--premium-monitoring-redesign)
12. [Data flow: Babysitter opens the app → receives video](#12-data-flow-babysitter-opens-the-app--receives-video)
13. [Known limitations and risks](#13-known-limitations-and-risks)
14. [Defense question bank](#14-defense-question-bank)

---

## 1. System overview

### 1.1 What the application does

Little Care is a two-sided childcare marketplace with a **live baby-monitoring** capability
that is the distinguishing feature of the project.

Three user populations exist:

| Population | Account type | Monitoring role |
|---|---|---|
| **Parent** | `Parent` table | Guardian, and **media publisher** (holds the camera) |
| **Babysitter** | `Babysitters` table | Assigned carer, and **media viewer** (receive-only) |
| **Monitor device** | *No account* — paired hardware credential | Media publisher, and cry detector |

The core thesis of the design is a deliberate inversion: **the babysitter watches, the
parent's device broadcasts.** A sitter is a temporary, revocable, phone-losing stranger with
respect to the child's privacy, so the system never grants them publishing rights. The
parent — the long-term, guardian-bound principal — holds the camera.

### 1.2 Core components

```
┌──────────────────────────────────────────────────────────────────────┐
│  BROWSER (React 18 + Vite, mobile-first SPA)                         │
│                                                                       │
│   useMonitoring        ── REST polling (session, heartbeat, incident) │
│   useMonitoringMedia   ── one server-issued media session per scope  │
│   MonitoringMediaPanel ── iframe + SFU transport state machine       │
└───────────────┬──────────────────────────────┬───────────────────────┘
                │ HTTPS + Bearer               │ HTTPS + iframe
                │ (JSON, polling)               │ (WebRTC media)
### 1.3 The two monitoring scopes (critical concept)

The system has **two structurally separate monitoring domains**. Conflating them was the
root cause of a real defect this project had to fix, so it is worth stating precisely:

| | **Job-scoped monitoring** | **Independent monitoring** |
|---|---|---|
| Controller | `MonitoringController` | `IndependentMonitoringController` |
| Session table | `MonitorSession` (FK `Job_ID`, `Child_ID`) | `IndependentMonitoringSession` (no `Job_ID`) |
| Authorized by | `MonitoringAccess.Check` (guardian **or** assigned sitter) | Device credential **or** `ChildGuardian` row |
| Requires an active job? | **Yes** — `JobNotInProgress` denial | No |
| Auth credential | `Authorization: Bearer` (account session) | `X-Monitor-Device` (SHA-256 hashed, no account) |
| Room prefix (legacy) | `lc-m-` | `lc-i-` |

**Independent monitoring is "Phone 2".** It is the at-home case where there is no babysitter
and no booking — the parent simply wants to watch their own child from a second phone. The
Phase 12 requirement was that the cry detector be reachable **only** from that paired
device, never from a parent or sitter account session.

**The unification.** These two domains originally produced *different rooms* (`lc-m-485-*`
vs `lc-i-38-*`), so a Babysitter and the monitor device never actually met — the "room
unification" the Phase 9.2 log output confirmed working. Both now key the room on the
**shared monitoring scope** `(jobId, childId)` rather than their own session id. See
[§6](#6-mediaSessionservice-and-secure-room-derivation).

### 1.4 The architectural principle: the backend is authoritative

This single rule explains most of the design decisions in the codebase, and it is the
strongest answer to give when challenged on "who decides what".

**The client never decides.** It never decides authorization, never computes escalation
timings (T+5 / T+15), never expires a pause, never declares a camera disconnected, and
never invents a room. It sends `{ jobId, childId }` and renders what comes back.

Concretely, the codebase repeatedly removes client-side logic and comments on the removal:

- *Pause countdowns* display the server-computed `PauseSecondsRemaining`, re-read every poll,
  so client clock skew changes nothing.
- *Escalation stage* is a server integer. The UI translates it into words and never shows
  the number or does the arithmetic.
- *Connection loss* is decided by the server comparing **its own clock** against the last
  heartbeat stamp it recorded — never by a client-side timeout.
- *A dropdown asking "which child is the monitoring phone watching?"* was deleted, because
  choosing a child in a dropdown grants nothing: the server re-runs `MonitoringAccess` on
  every request regardless.

The corollary — and the bug fixed in
[§10](#10-phase-92--the-ui-state-mismatch-bug-and-its-fix) — is that **if the client cannot
decide, it must not fabricate**. A failed REST poll was being rendered as a claim about a
camera: the client asserting a fact it has no access to.

---
                ▼                               ▼
## 2. Solution layout and technology choices

### 2.1 Repository layout

```
Unified Backend Workspace/
├── WebApplication2/            ASP.NET Web API 2 backend (C#)
│   ├── Controllers/            14 controllers
│   ├── Services/
│   │   ├── Interfaces/         16 service contracts
│   │   └── Implementations/    16 service implementations
│   ├── Infrastructure/         MonitoringAccess, SessionAuthorize, claims, settings
│   ├── Models/                 EDMX-generated EF6 model
│   ├── DTOs/                   Response shapes (PascalCase by convention)
│   ├── docs/                   architecture, database, security, api, remediation
│   └── scripts/                DB migration + verification harnesses
├── babysitter-app/             React 18 + Vite frontend
│   ├── src/
│   │   ├── app/                App.jsx route table, ProtectedRoute, MonitorDeviceRoute
│   │   ├── hooks/              useMonitoring, useMonitoringMedia
│   │   ├── components/
│   │   │   ├── monitoring/     MediaPanel, LiveMediaStage, StatusBar, Sitter panels
│   │   │   ├── layout/         AppLayout, bottom navs, StickyHeader
│   │   │   └── ui/             Modal, Button, Input, Toast
│   │   ├── features/           parent/, babysitter/, auth/, cry/, notifications/
│   │   ├── services/           api.js, apiClient.js, independentMonitoringApi.js
│   │   └── app.css / tokens
│   └── docs/
├── docs/                       cross-cutting: requirements matrix, LAN runbooks, audits
└── start-littlecare-dev.ps1    one-shot LAN dev orchestrator (SFU + API + Vite + certs)
```

### 2.2 Technology choices and why

| Layer | Choice | Rationale |
|---|---|---|
| API framework | **ASP.NET Web API 2** (not ASP.NET Core) | Pre-existing platform choice; hosted on IIS/IIS Express. Classic `ApiController`, attribute routing, `[RoutePrefix]`. |
| ORM | **EF6** with a **frozen EDMX** | Phase 2 deliberately froze `Model1.edmx`. Monitoring tables are therefore reached via `Database.SqlQuery<T>` with parameterized raw SQL — an approved, audited pattern rather than a schema change. |
| Serialization | **Newtonsoft.Json 13.0.3** | Emits **PascalCase**. The frontend reads PascalCase DTO fields (`session.Status`, `data.Configured`); this was a documented bug source — see §10.4. |
| Auth | Opaque **bearer token → `UserSessions` row** | Revocable server-side. See [§5](#5-session-creation-and-the-authorization-chain). |
| Frontend | **React 18 + Vite** | Vite dev server on the LAN with a trusted HTTPS cert, so the browser grants `getUserMedia` on non-localhost origins. |
| Styling | **CSS Modules** + design tokens | A repo script (`scripts/check-css-modules.js`) asserts every `styles.*` reference resolves — verified passing in this pass. |
| Media | **Self-hosted MiroTalk SFU** | Gives control over publish enforcement and lets the embed bridge ship with the deployment. |
| Cry detection | **YAMNet (TensorFlow.js)** in-browser | Acoustic classification on-device; only the *verdict* is sent to the server. |

### 2.3 Notable structural constraint: the frozen EDMX

`docs/architecture/DATABASE_OBJECTS_OUTSIDE_EDMX.md` records tables that exist in SQL Server
but **not** in `Model1.edmx`:

| Table | Reached from | Notes |
|---|---|---|
| `MonitorSession` | `MonitoringService`, `CryIncidentService`, `GuardianConnectionService` | Holds connection heartbeats and pause columns |
| `MonitorEvent` | `CryIncidentService` | Append-only audit trail; `MonitorEvent_ID` is `bigint` |
| `ChildGuardian` | `MonitoringAccess`, `GuardianConnectionService` | **The authorization authority** |
| `GuardianInvitation` | `GuardianConnectionService` | Stores `TokenHash`, never a raw token |
| `JobChildren` | `MonitoringAccess` | Membership table; also raw SQL |
| `MonitoringDeviceSession` | `IndependentMonitoringController` | Hashed device credentials |
| `IndependentMonitoringSession` | `IndependentMonitoringController` | Phone-2 sessions |

**Why this matters in a defense.** A question like *"why didn't you just add these to the
EDMX?"* has a strong answer: freezing it kept Phases 3–12 free of a schema migration or
entity-regeneration step, which kept each phase independently verifiable and reversible. The
cost is that these tables use parameterized raw SQL via small public projection classes
(EF6's `SqlQuery<T>` materializes through reflection).

---
┌───────────────────────────────┐   ┌──────────────────────────────────┐
│  ASP.NET Web API 2            │   │  MiroTalk SFU (separate origin)  │
│  WebApplication2              │   │  WebRTC signalling + media relay │
## 3. Backend architecture (ASP.NET Web API 2)

### 3.1 Layering and the shape of a request

Every endpoint follows the same three-layer path, and the discipline is enforced by
convention and comments rather than by a DI container:

```
HTTP request
   │
   ├─▶ [SessionAuthorize]              Infrastructure/  — validate bearer token
   │
   ▼
Controller                            Controllers/      — validate shape, map status
   │  · never contains a business rule
   │  · never contains SQL
   ▼
Service                               Services/         — the rules live here
   │  · calls MonitoringAccess.Check   Infrastructure/  — the authorization gate
   │  · calls the database
   ▼
DTO                                   DTOs/             — PascalCase response shape
```

A recurring pattern worth noting in a defense: **controllers contain three small private
wrappers** that centralize exception→status mapping, so the mapping is defined exactly once
per family of actions:

| Wrapper | Used by | Maps |
|---|---|---|
| `MonitoringError(ex)` | every monitoring denial | `*NotFound` → 404, all others → 403 |
| `CryAction(action, msg)` | cry incident actions | denial via `MonitoringError`, paused → 409, `Argument`/`InvalidOperation` → 400, else 500 |
| `FamilyAction(action)` | guardian / pause / DND | denial via `MonitoringError`, `KeyNotFound` → 404, `UnauthorizedAccess` → 403, business rules → 400, else 500 |

Every catch-all logs via `Trace.TraceError` and returns a **fixed, user-safe** message.
Stack traces, SQL and table names never reach the client ("SECURITY (Phase 1 Fix B)" is
referenced repeatedly in the source).

### 3.2 `MonitoringController` — the core controller

`[RoutePrefix("api/monitoring")]`, `[SessionAuthorize]`. Note the deliberate comment that
there is **no** per-controller `[EnableCors]`: a per-controller attribute would *replace*
the single global config-driven policy in `WebApiConfig.Register`, which is exactly how a
wildcard CORS policy had previously survived.

Four constructor overloads exist so the Phase 3/4/7 verification harnesses can inject a
shared `DbContext`; the parameterless one composes the real services.

#### Session lifecycle routes

### 3.3 `AuthController`

`[SessionAuthorize]` + `[RoutePrefix("api/auth")]`.

| Method | Route | Notes |
|---|---|---|
| `POST` | `login` | **Single unified anonymous sign-in.** Auto-detects role |
| `GET` | `me` | Hydrates the client principal; 401 without a valid token |
| `DELETE` | `logout` | Deletes the `UserSessions` row so the token dies immediately |

Two details a defense should cover:

1. **The client never chooses its role.** Login tries `Parent`, then `Babysitters`, and
   returns the role the *server* found. A client cannot ask to be a sitter.
2. **Logout is server-side revocation**, not just clearing local state. The row is deleted,
   so every subsequent request with that token fails `SessionAuthorize` with 401. It returns
   200 even when no token was supplied, so the client can always finish local cleanup.

Password handling uses `BCrypt.Net-Next`, and login performs an **upgrade-on-verify**: if
`PasswordHasher.VerifyPassword` reports `NeedsUpgrade`, the hash is re-written with the
current cost factor. That is transparent rehash-on-login, a standard practice.

### 3.4 `IndependentMonitoringController`

Largest controller by line count (~28 KB). Owns the **Phone-2** domain: pairing, device
credential issuance, independent sessions, and the independent media path.

Its `AuthorizeDevice` helper enforces the identity separation that `MonitoringController`
mirrors for cry reporting:

> *A normal account bearer must never double as a Phone-2 credential, so the presence of an
> `Authorization` header is an immediate refusal.*

### 3.5 Remaining controllers

| Controller | Domain |
|---|---|
| `JobsController` | Booking lifecycle (post, accept, complete, cancel) |
| `BidsController` | Sitter applications and matching |
| `ParentController` | Parent profile, children, dashboard aggregates |
| `BabySitterController` | Sitter profile, availability, earnings, reviews received |
| `ChildrenController` | Child profiles and per-child data |
| `NotificationsController` | Notification list, mark-read, clear |
| `ReviewController` | Post-job reviews and ratings |
| `ImageController` | Profile/child image upload and retrieval |
| `JobInvitationsController`, `SitterInvitationsController` | Direct invite workflows |

### 3.6 `CryIncidentService` — the escalation state machine

The most safety-relevant service, and the one most likely to be examined. Statuses:

```
StatusOpen         "Open"           — detected, escalation running
StatusAcknowledged "Acknowledged"  — sitter responded
StatusResolved     "Resolved"       — sitter is with the child
StatusCancelled    "Cancelled"      — lifecycle ended it
```

Key rules, all server-owned:

- **Dedupe.** `CreateIncident` returns the already-open incident with `Reused=true`, so a
  detector firing repeatedly cannot create an alert storm.
- **Atomic claim.** The sweeper claims due work so escalation cannot double-fire.
- **Postponement takes a MAX.** Sitter response moves the parent deadline to
  `max(created+15s, response+10s)`. Taking the maximum means an *early* response cannot
  escalate parents before the normal T+15.
- **Idempotent responses.** A second "I'm going to the child" returns the incident unchanged
  — the deadline is never extended twice, so a sitter cannot postpone indefinitely.
- **Paused detection is a conflict, not an authorization failure.** It throws
## 4. Database schema

### 4.1 EDMX-mapped core tables

| Table | Purpose | Key columns |
|---|---|---|
| `Parent` | Parent accounts | `Parent_ID`, `Username`, `Password` (BCrypt), `Address`, `PictureAddress`, `IsDeleted` |
| `Babysitters` | Sitter accounts | `Sitter_ID`, `Username`, `Password` (BCrypt), `IsDeleted` |
| `Child` | Child profiles | `Child_ID`, `Parent_ID`, name/DOB, `IsDeleted` |
| `Jobs` | Bookings | `Job_ID`, `Parent_ID`, `AssignedSitter_ID`, `Status`, payment, geo |
| `UserSessions` | Auth infrastructure only | `Token`, `UserId`, `Role`, `CreatedAt`, `ExpiresAt` |
| `Notifications` | User notifications | recipient, type, read flag |
| `Reviews` / ratings | Post-job feedback | job, sitter, score, comment |

**Soft deletes are universal.** Every lookup above is filtered on `IsDeleted = 0`. This
matters for security: a deleted job or child must behave exactly like a nonexistent one, so
denials are indistinguishable from absence and enumeration is not possible.

`UserSessions` is explicitly **auth infrastructure only** — it holds no business data. This
keeps "is the token still valid?" separable from "is the monitoring session still active?",
which are different facts with different lifetimes.

### 4.2 Monitoring tables (outside the EDMX)

```
Child ──┬── JobChildren ──────────┐ (membership, raw SQL)
        │                         │
        ├── ChildGuardian ────┐   │  ← THE AUTHORIZATION AUTHORITY
        │                     │   │
        ├── MonitorSession ───┴───┘  (Job_ID, Child_ID, Status,
        │        │                       LastHeartbeatAt, IsPaused, DND cols)
        │        └── MonitorEvent       (append-only audit, bigint id)
        │
        └── CryAlert / CryIncident      (Status, EscalationStage,
                │                        NextEscalationDueAt, SitterResponse,
                │                        CancelledAtUtc, CancellationReason,
                │                        JobId, Child_ID, MonitorSession_ID, Guid Id)
                └── MonitorEvent
```

`CryAlert` is the table; `CryIncident` is the evolved service-level concept. The table and
the frozen EDMX `CryAlert` mapping were **deliberately preserved** while a legacy
`getLatestCryAlert` endpoint and its service were removed — the active pipeline reads the
same table through the new service, so historical rows are not orphaned.

Note the denormalization in `CryAlert`: it stores `JobId`, `Child_ID`, `MonitorSession_ID`
**and** a `Guid Id`. The `Guid` is the external, non-enumerable handle. Escalation
deadlines are **persisted** (`NextEscalationDueAt`) rather than held in in-memory timers, so
a server restart cannot lose a pending escalation — the sweeper simply asks *"what is due?"*

### 4.3 Independent-monitoring tables

| Table | Purpose |
|---|---|
| `IndependentMonitoringSession` | Phone-2 session. `Parent_ID`, `Child_ID`, `Status`, `IsDeleted`. **No `Job_ID`** |
| `MonitoringDeviceSession` | Paired-device credential. `CredentialHash`, `RevokedAtUtc`, `ExpiresAtUtc`, FK → `IndependentMonitoringSession` |

The missing `Job_ID` is the structural cause of the room-unification problem in
[§1.3](#13-the-two-monitoring-scopes-critical-concept): a job-linked room and an
independent room had no shared key until the room derivation was moved to the scope.

### 4.4 Guardian tables

| Table | Purpose |
|---|---|
| `ChildGuardian` | `Child_ID` + `Parent_ID`. **This is what makes a co-parent legitimate** |
| `GuardianInvitation` | `TokenHash` (**never a raw token**), status, expiry, inviter id |
## 5. Session creation and the authorization chain

### 5.1 Account session creation

```
POST /api/auth/login   { username, password }
   │
   ├─ Try Parent table by Username
   │     ├─ IsDeleted?            → 401 "Account has been deactivated."
   │     ├─ BCrypt verify         → 401 "Invalid credentials."  (also on BCrypt failure)
   │     ├─ NeedsUpgrade?         → re-hash with current cost, persist
   │     ├─ token = Guid(32) + Guid(32)   → 64 hex chars, unguessable
   │     ├─ expiry = now + SessionExpiryDays (Web.config, via SessionSettings)
   │     ├─ INSERT INTO UserSessions (Token, UserId, Role, CreatedAt, ExpiresAt)
   │     └─ 200 { userId, name, role, token, expiresAt, … }
   │
   ├─ Else try Babysitters table (identical flow)
   │
   └─ Else 401 "Invalid credentials."
```

Design points that matter:

- **Role is detected, never requested.** The body has no role field. The client cannot
  escalate by asking.
- **The token is opaque and random**, not a JWT. This is a deliberate trade-off: an opaque
  token costs a database lookup per request, but it gives **instant revocation** —
  `DELETE /api/auth/logout` deletes the row and the token is dead immediately, rather than
  remaining valid for the rest of its expiry window. For a childcare product, "the sitter was
  dismissed and lost the phone" must take effect now.
- **`UserSessions` is auth-only.** It carries no monitoring state, so logging out cannot
  accidentally end a monitoring session, and vice versa.
- **Expiry is centralized** in `Infrastructure/SessionSettings.cs` reading
  `SessionExpiryDays`, so parent and sitter logins cannot drift apart (Phase 1 Fix F).

`ClaimsPrincipalHelper.GetUserId()` / `GetRole()` read the identity from the validated
principal, and are used **everywhere** instead of any body field. That is why no endpoint in
the system accepts an "acting user" parameter.

### 5.2 `MonitoringAccess.Check` — the centralized authorization chain

This is the single most important method in the codebase. Every monitoring endpoint calls
it before reading or writing anything. It is a **pure decision function**: it only reads,
never writes, and never throws. The calling service converts a denial into an exception and
records the `SessionAccessDenied` audit event.

The ordered chain:

| # | Rule | Denial | HTTP |
|---|---|---|---|
| 1 | Caller must be an authenticated Parent or Sitter | `InvalidRole` | 403 |
| 2 | Job must exist (and not be soft-deleted) | `JobNotFound` | 404 |
| 3 | Job must genuinely be **in progress** | `JobNotInProgress` | 403 |
| 4 | **Identity, before any child detail** — Sitter must be `Job.AssignedSitter_ID`; Parent must have a `ChildGuardian` row for the child | `NotAssignedSitter` / `NotGuardian` | 403 |
| 5 | Child must exist | `ChildNotFound` | 404 |
| 6 | Child must belong to the job via `JobChildren` | `ChildNotInJob` | 403 |
| 7 | *(if a session id was supplied)* it must exist and belong to the same job+child | `SessionNotFound` / `SessionMismatch` | 404 / 403 |

**Why identity is checked at step 4, before the child exists at step 5.** This ordering is
deliberate and is the best single security answer in the project. If the child check came
first, an unauthorized caller could distinguish "child 27 doesn't exist" from "child 27
exists but isn't yours" — a **child-enumeration oracle**. By authorizing identity first,
a caller who may not watch child 27 gets `NotGuardian` regardless of whether 27 exists, so
existence never leaks. The source comment states this: *"this also covers non-existent child
ids, which then never leak existence to unauthorized parents."*

Two further details:

- **Step 3 accepts both `"InProgress"` and `"In Progress"`.** The data has both spellings and
  a NULL status is *not* in progress. This was a Phase 1 finding where data was explicitly
  not migrated that phase.
- **The role test is a whitelist.** `MonitoringDenial.InvalidRole` is returned for anything
  that is not exactly Parent or Sitter, so an unrecognized or future role fails closed.

### 5.3 The two identity systems, and why cry reporting needed a third check

`MonitoringAccess` answers *"may observe this child?"*. It deliberately admits **both** the
guardian and the assigned sitter, because both genuinely need the feed.

But reporting a cry is not an observation — it creates a `CryAlert` that pages the sitter
and escalates to the parent. It is a **safety-relevant write**. `MonitoringAccess` therefore
cannot express it, so `CreateCryIncident` runs an extra gate *before* the chain:

```
TryAuthorizeMonitorDeviceCry(childId):
   ├─ Authorization header present?      → REFUSE  (an account bearer is never a device)
   ├─ No X-Monitor-Device header?         → REFUSE
   ├─ Token not 64 chars?                 → REFUSE
   ├─ SHA-256(token) != stored hash?      → REFUSE
   ├─ Revoked / expired / session inactive → REFUSE
   ├─ Device's child != requested child?  → REFUSE
   └─ otherwise                            → allow
```

Every failure returns **one identical message**, so the endpoint cannot be used to probe
whether a credential exists or which child it belongs to. The endpoint then **fails closed
for everyone**, because the job-scoped device credential was deferred (the
`MonitoringDeviceSession` table is FK-bound to `IndependentMonitoringSession` and has no
`Job_ID`, so reusing it would need a schema change, which the phase rule forbade). The
source is explicit that this is the *intended secure state*, not a temporary loophole.

Crucially, **receiving** an alert and **answering** it are deliberately *not* restricted —
that is the sitter's actual job. Only *detecting and creating* the incident is.

The frontend mirrors this honestly: `/cry-detector` is routed through `MonitorDeviceRoute`,
not `ProtectedRoute`, and `CryDetector` is deliberately **not imported** into the account
route table.

---

`ChildGuardian` deserves emphasis: it is the reason a parent who did *not* create the child
can still monitor, and equally the reason a random parent cannot. Every guardian query joins
through it.

### 4.5 Data integrity notes worth raising in a defense

`docs/database/BACKEND_DATA_INTEGRITY_AUDIT.md` and the Phase 11 concurrency work record
real issues that were found and fixed, which make excellent defense material:
## 6. MediaSessionService and secure room derivation

### 6.1 The problem this service exists to solve

`WebApplication2/Services/Implementations/MediaSessionService.cs`

Before Phase 11 the only media identifier was `MonitorSession.RoomName` — a `"pending-*"`
placeholder — and React could receive a room name through React Router `location.state`. The
service's own doc comment states why that was unacceptable:

> *A room name handed to the browser is a shared secret with no authorization behind it, so
> that is not a safe media design.*

The fix moves room preparation **server-side, after authorization**, so the browser never
holds a secret and never decides a room exists.

### 6.2 Configuration (fail-closed)

Three `Web.config` appSettings, all server-only:

| Key | Purpose |
|---|---|
| `MonitoringMediaEnabled` | Master switch; must be `"true"` |
| `MonitoringMediaServerUrl` | SFU base URL |
| `MonitoringMediaRoomSalt` | **HMAC salt — never returned, logged, or placed in a DTO or URL** |

`GetConfiguredMiroTalkServerUrl()` is strict on purpose. It returns `null` — failing closed —
unless the URL is absolute, **HTTPS**, and has no userinfo, query, fragment, or non-root
path. A misconfigured or downgraded deployment therefore yields `Configured: false` and an
honest "Live video is not configured on this deployment", never an insecure fallback.

A room is only derived when `enabled && serverUrl != null && salt present && salt.Length >= 32`.

### 6.3 `GetMediaSession` — the ordered issuance flow

```
GET /api/monitoring/media?jobId=&childId=
   │
   ├─(1) Validate ids                      → ArgumentException  → 400
   │
   ├─(2) MonitoringAccess.Check            → MonitoringAccessException
   │         "media adds no authorization rules of its own"
   │
   ├─(3) Find the ACTIVE MonitorSession:
   │        SELECT TOP 1 MonitorSession_ID FROM MonitorSession
   │        WHERE Job_ID=@p0 AND Child_ID=@p1
### 6.4 HMAC room derivation — `DeriveCanonicalRoomId`

```
FORMAT   lc-m-{jobId}-{childId}-{hex8}
EXAMPLE  lc-m-157-27-f5bf55d0        ← matches the observed Phase 9.2 log

message = "canonical" + ":" + jobId + ":" + childId     (invariant culture)
key     = UTF8(MonitoringMediaRoomSalt)
digest  = HMACSHA256(key, UTF8(message))
hex8    = first 4 bytes of digest, lowercase hex   (32 bits)
roomId  = "lc-m-" + jobId + "-" + childId + "-" + hex8
```

Four properties, each answering a likely examiner question:

**Why HMAC at all, and not just `lc-m-{jobId}-{childId}`?** Because `jobId` and `childId` are
small sequential integers. Emitting them plainly would let anyone who can reach the SFU
**enumerate another family's room by counting**. The keyed digest removes that, and keeps the
room string free of anything personal. The 32-bit suffix is a truncation — a
*namespace-uniqueness* device, not a secret; actual authorization is `MonitoringAccess` plus,
on the device route, the SHA-256 credential check. The source says so plainly: *"This is a
room IDENTIFIER, not a capability."*

**Why is the session id gone?** This is the fix for §1.3. The old derivation keyed on
`MonitorSession_ID`, which is exactly why the job-linked session (485) and the independent
session (38) produced `lc-m-485-*` and `lc-i-38-*` — two different rooms, so the participants
never met. Keying on the scope they genuinely share makes them converge. The legacy
`DeriveRoomId(scope, sessionId, salt)` survives only as a fallback for when a caller cannot
resolve a `jobId` (it passes `0`), and it still fails closed rather than inventing a room.

**Why must the salt be stable?** The derivation is a **pure function** of
`(jobId, childId, salt)` — no clock, no randomness, no GUID, no database. That is what lets
the Babysitter's browser and the monitor device independently compute the same room with no
extra round trip. It also means **the salt must stay stable while a session is active**, or
participants will silently diverge into different rooms.

**Single room, asymmetric roles.** One room per scope; roles differ *within* it via the join
parameters in §8.2. This is why the log showed the Babysitter successfully consuming from
`lc-m-157-27-f5bf55d0`.

### 6.5 Independent-scoped media issuance

| Method | Caller | `canPublish` | Extra check |
|---|---|---|---|
| `GetIndependentParentMedia(parentId)` | Parent, via bearer | **`false`** | `EXISTS(SELECT 1 FROM ChildGuardian WHERE Child_ID=s.Child_ID AND Parent_ID=@p0)` |
## 7. Frontend architecture (React / Vite)

### 7.1 Routing (`src/app/App.jsx`)

The app is a single-page React Router application wrapped in three providers:

```
<ErrorBoundary>            catches render crashes and shows a recovery screen
  <AuthProvider>           principal, token, login/logout
    <ToastProvider>        transient notifications
      <AppLayout>          shell, cookie banner, scroll-to-top
        <Routes> …
```

| Route | Guard | Purpose |
|---|---|---|
| `/`, `/role`, `/login`, `/register`, `/create-account` | public | Onboarding |
| `/parent-dashboard`, `/my-jobs`, `/child-profile`, … | `ProtectedRoute allowedRoles={['parent']}` | Parent domain |
| `/babysitter-dashboard`, `/my-jobs`, `/job-details/:jobId`, … | `ProtectedRoute allowedRoles={['babysitter']}` | Sitter domain |
| `/baby-monitoring`, `/active-job` | `ProtectedRoute` (both roles) | **Monitoring** |
| `/cry-detector` | **`MonitorDeviceRoute`** | Phone-2 detector surface |
| `*` | — | `NotFoundScreen` |

Two routing decisions worth defending:

**`/cry-detector` is not an account route.** The backend refuses a cry report from any
ordinary account bearer, so exposing it to a parent or sitter *"would only ever show a
detector that can no longer report anything."* Restricting the route keeps the UI honest
about the server rule; the server is what actually enforces it.

**`/baby-monitoring` allows both roles**, with the justification that allowing the route does
not weaken authorization: `MonitoringAccess` permits an assigned sitter, and
`MediaSessionService` returns role `viewer` with `CanPublish=false`, so a sitter is
receive-only. The route guard is not the security boundary — the server is.

Dead aliases are normalized with `<Navigate replace>` (`/monitor` → `/baby-monitoring`,
`/messages` → `/babysitter-notifications`, etc.), so old bookmarks and deep links still work.

### 7.2 `useMonitoring.js` — the single polling owner

`src/hooks/useMonitoring.js`

Before Phase 8 each screen invented its own timer, session fetch and error handling. This
hook is **the one place** that owns monitoring polling:

| Concern | Value |
|---|---|
| Session poll | every `SESSION_POLL_MS = 5000` ms |
| Heartbeat | every `HEARTBEAT_MS = 8000` ms, only while `session.Status === 'Active'` |
| Re-entrancy | `inFlightRef` guard prevents stacked polls |
| Cleanup | `clearInterval` on every interval; `aliveRef` guards post-unmount writes |
| Consecutive-failure threshold | `CONSECUTIVE_POLL_FAILURES_BEFORE_OFFLINE = 3` (Phase 9.2) |

**Why 8 s for the heartbeat.** It must stay comfortably **below** the server's
`MonitoringHeartbeatTimeoutSeconds` (Web.config default 15 s), so a healthy client is never
reported Lost. The session poll runs slightly less often because it is a full round trip that
also drives the escalation sweep.

**Why the heartbeat error is swallowed.** The source carries a long correction comment: a
failed beat does *not* mean the child monitor is disconnected — the **server** decides that,
by comparing its own clock against the last stamp it recorded. A heartbeat can legitimately
fail (transient 500, proxy hiccup, one lost request), and turning that into a client-declared
"Connection problem" is exactly the "frontend is authoritative" mistake the project forbids.

`start()` is idempotent because the backend is: it returns the existing Active session rather
than creating a second one.

### 7.3 `useMonitoringMedia.js` — the server-issued media session

`src/hooks/useMonitoringMedia(jobId, childId, enabled, refreshKey)`
### 7.4 `ActiveJobDetails.jsx` — the role-aware Active Session screen

`src/features/babysitter/ActiveJobDetails.jsx`

One screen now serves **both** roles. The role comes from `useAuth()` — the server's own
login verdict — never from a route name or a prop, and it decides which control panel renders
beneath the video:

- Parent → `ParentSessionControls`
- Babysitter → `SitterActionDashboard` + `SitterMonitoringPanel`

It resolves `jobId` from the route param first, falling back to `location.state?.job` for
legacy navigation. It derives the monitored child, then wires both hooks:

```jsx
const monitoring = useMonitoring({
  jobId: numericJobId, childId: monitoredChild?.Child_ID ?? null, role, autoStart: true,
});

const sitterMedia = useMonitoringMedia(
  numericJobId, mediaChildId, enabled, session?.Status ?? 'none',
);
```

Note `childId: monitoredChild?.Child_ID ?? null` — when no child is resolved the hooks receive
`null`, and `scopeOk` is false, so **no request is made at all**. Guessing a child id would
either report against the wrong baby or be rejected.

`autoStart: true` is the sitter monitoring entry point; the effect is deferred by one
microtask to avoid React's set-state-in-effect warning — a pattern both hooks share.

The screen also renders the session clock, the job's date/window, location and payment, and a
live duration timer whose caption is derived from the server session state.

### 7.5 `MonitoringMediaPanel.jsx` — the live-video surface

`src/components/monitoring/MonitoringMediaPanel.jsx`
## 8. WebRTC and MiroTalk integration

### 8.1 Architecture: the SFU is a separate origin, on purpose

MiroTalk is a **self-hosted SFU (Selective Forwarding Unit)**. The app does not implement
WebRTC; it embeds the SFU in an iframe and lets it do the media work.

```
   ┌──────────────────────────┐        ┌──────────────────────────┐
   │ Phone 1 (Parent)         │        │ Phone 2 (Babysitter)     │
   │  React app               │        │  React app               │
   │   └─ iframe ─────────────┼──HTTPS┼── iframe ────────────────┤
   │                          │        │                          │
   │      both connect to the SAME room id on the SFU          │
   └────────────┬─────────────┘        └─────────────┬────────────┘
                │   WSS signalling (socket.io)        │
                │   SRTP media (UDP/TCP)             │
                ▼                                   ▼
        ┌───────────────────────────────────────────────────┐
        │  MiroTalk SFU  (https://<host>:3010)               │
        │  verifies room, enforces cant_publish, relays RTP  │
        └───────────────────────────────────────────────────┘
```

**Why a separate origin is a feature, not an obstacle.** The SFU cannot read Little Care's
DOM, cookies or session token. That isolation means a compromise of the media layer does not
hand over application credentials. The cost is that the parent page cannot inspect the SFU's
internals — which is precisely why the embed bridge (§8.4) exists rather than DOM scraping.

**Why the SFU is self-hosted rather than a public SaaS.** Three reasons, all verifiable in
the code: (a) the join path uses `audio_cant_unmute` / `video_cant_unhide`, which require
control over SFU configuration; (b) `?embed=1` and `littlecare-embed.js` ship with *our* own
deployment; (c) `MonitoringMediaServerUrl` validation demands **HTTPS** and refuses anything
else.

### 8.2 How the join path is built and how the room ID is passed

The browser **never** sees a salt and **never** builds a URL. It concatenates two
server-issued fields:

```jsx
// MonitoringMediaPanel.jsx
const frameSrc = media.ServerUrl + media.JoinPath;   // e.g. https://host:3010/join/?room=...
```

`BuildJoinPath(roomId, displayName, canPublish)` in `MediaSessionService`:

```
/join/?room={Uri.EscapeDataString(roomId)}
      &roomPassword=0
      &name={Uri.EscapeDataString(displayName)}
      &audio={0|1}&video={0|1}
      &screen=0&hide={hideSelf}&notify=0&chat=0&duration=unlimited
      &audio_cant_unmute={cantPublish}
      &video_cant_unhide={cantPublish}
      &isPresenter={0|1}
      &embed=1
```

| Parameter | Publisher (Parent) | Viewer (Babysitter) | Purpose |
|---|---|---|---|
### 8.4 The embed bridge (`littlecare-embed.js`)

The server appends `&embed=1`, which opts the room into a bridge script shipped with this
deployment at `public/js/littlecare-embed.js`. It is **inert on any other join**, so a normal
MiroTalk room is unaffected.

The bridge posts `postMessage` to the parent window, and `MonitoringMediaPanel` listens:

```js
// Phase 9.2: the listener is attached as soon as frameSrc EXISTS — never gated
// on frameLoaded. See §10.2 for why that gate was the second half of the bug.
if (event.origin !== frameOrigin) return;         // only the SFU origin may drive these
```

| Message | Payload | Effect |
|---|---|---|
| `littlecare:state` | `{ audio, video, videoElements }` | Real track state → mic/cam toggles; `bridgeReady = true` |
| `littlecare:transport` | `{ state: 'connected'\|'connecting'\|'failed', reason }` | **Feeds the status pill** (§10.2) |

Two properties make this trustworthy:

- **Origin-checked.** `event.origin !== frameOrigin` guards every message, so a hostile page
  cannot drive the controls or spoof a transport state.
- **It does not simulate.** The bridge clicks the SFU's *own* start/stop buttons and reports
  the resulting true track state. Until it has answered, `bridgeReady` is false and the
  controls render **disabled** — the code prefers a visibly unavailable control over a button
  that silently does nothing.

**`littlecare:transport` is new in Phase 9.2.** It gives the UI a truthful source for "is the
feed connected?" that is not borrowed from an unrelated REST endpoint. If the bridge does not
yet emit it, `transport` stays `null`, which the status logic treats as *"the SFU has not told
us anything"* — explicitly **not** the same as *disconnected*.

### 8.5 How the Parent/Monitor device publishes

```
1. Parent's phone opens the monitoring screen.
2. useMonitoringMedia → GET /api/monitoring/media?jobId&childId
3. Server: MonitoringAccess.Check (Parent is a ChildGuardian) → allowed
4. Server finds the ACTIVE MonitorSession, derives role "publisher", CanPublish=true
5. Server derives room lc-m-{job}-{child}-{hex8} and builds /join/?…&isPresenter=1&embed=1
6. React renders the iframe with allow="camera; microphone; fullscreen; autoplay"
7. Browser prompts for camera + microphone (HTTPS is mandatory for this)
8. SFU publishes the track into the room; consumers subscribe
9. Bridge reports littlecare:state {video:true} → mic/cam controls become usable
```

## 9. Security model

### 9.1 Scope separation: Job vs. Independent

The system enforces two *structurally separate* domains. The separation is physical (different
tables, different controllers, different credentials), not a flag in one shared table — which
is what makes it auditable.

| Dimension | Job-scoped | Independent ("Phone 2") |
|---|---|---|
| Root table | `MonitorSession` | `IndependentMonitoringSession` |
| Controller | `MonitoringController` | `IndependentMonitoringController` |
| Credential | `Authorization: Bearer` | `X-Monitor-Device` |
| Needs an in-progress job? | Yes | No |
| Who may publish? | Parent only | Device only (parent is `false`) |
| Cry reporting | **fails closed for everyone** (§5.3) | Device credential, child must match |

**Why the job-scoped cry endpoint currently admits nobody.** `MonitoringDeviceSession` is
FK-bound to `IndependentMonitoringSession` and has no `Job_ID`, so a job-scoped device
credential would require new tables/columns — forbidden by the phase's "no schema change" rule.
The code chooses to **fail closed**, and comments that this is *"the intended secure state
rather than a temporary loophole."* That is the correct trade-off: reusing the independent table
and hoping the job linkage can be inferred would have been a genuine authorization bug.

**Where the two domains are now intentionally joined.** Only in room derivation. The canonical
room keys on `(jobId, childId)`, so the independent device and the job-scoped sitter converge on
`lc-m-…`. This is a **namespace** convergence, not a permission merge: each side still passed
its own authorization check, and neither gains any capability the other had.

### 9.2 HMAC room derivation as an anti-enumeration control

Covered in detail in §6.4. The security-relevant summary:

- `jobId` / `childId` are **sequential integers**, so a plain concatenation would be an
  enumeration oracle for anyone who can reach the SFU.
- `HMACSHA256(serverSalt, "canonical:{jobId}:{childId}")`, truncated to 32 bits, removes the
  ability to compute another family's room without the salt.
- The salt is **server-only**: never returned in a DTO, never logged, never placed in a URL.
- The result is an **identifier, not a capability**. Possessing the room id authorizes nothing —
  `MonitoringAccess` still runs on every request.

A candid limitation to volunteer: a **32-bit** truncated HMAC has a birthday collision bound
around 2^16 rooms. That is a namespace-integrity concern, not an authorization one, and it is
acceptable at this project's scale; widening it is a one-line change.

### 9.3 Device authentication
### 9.4 Defense-in-depth summary

| Control | Where |
|---|---|
| BCrypt password hashing (+ transparent rehash on login) | `AuthController`, `PasswordHasher` |
| Opaque, revocable bearer tokens | `UserSessions` + `SessionAuthorize` |
| Centralized authorization chain | `MonitoringAccess.Check` |
| Role always from the token, never the body | `ClaimsPrincipalHelper` throughout |
| Scope-only request bodies (no raw session ids) | all monitoring controllers — IDOR defence |
| Hashed, revocable, expiring device credentials | `MonitoringDeviceSession` |
| Non-enumerable room ids | HMAC room derivation |
| SFU-enforced receive-only for sitters | `audio_cant_unmute` / `video_cant_unhide` |
| Cross-origin isolation of the media layer | SFU on its own origin |
| Origin-checked `postMessage` | `MonitoringMediaPanel` |
| Parameterized SQL everywhere | `SqlQuery<T>` with `@p0…` |
| No exception detail to the client | `CryAction` / `FamilyAction` / `MonitoringError` |
| Single global CORS policy (no per-controller override) | `WebApiConfig.Register` |
| Soft delete + `IsDeleted = 0` on every lookup | all queries |

### 9.5 Threats considered

| Threat | Mitigation |
|---|---|
| Sitter publishes video/audio of the child | 4-layer receive-only (§8.3) |
| Sitter joins another family's room | HMAC rooms + `MonitoringAccess` per request |
| Sitter reports a false cry to page parents | Device-credential-only reporting (§5.3) |
| IDOR: end another user's session by guessing ids | Scope-only bodies (`jobId`+`childId`) |
| Child enumeration by an unauthorized parent | Identity checked before child existence (§5.2) |
| Cross-family monitoring request | `ChildNotInJob` + `NotGuardian` + `SessionMismatch` |
| Stolen device credential | Hash at rest, expiry, revocation, child binding |
| XSS reading a media secret | No secret exists client-side; SFU is cross-origin |
| PostMessage spoofing of transport state | `event.origin` check |
| Leaking internals via errors | Fixed user-safe messages; `Trace` only |
| Monitoring pause abuse / self-approval | Server refuses self-approval; every rule re-checked |

### 9.6 Security gaps a determined examiner could find
## 10. Phase 9.2 — the UI state mismatch bug and its fix

### 10.1 Task 1: the backend 404

**Symptom.** `GET /api/monitoring/cry?jobId=157&childId=27` returned **404** on every poll.

**Root cause.** The route was never missing — `GetCryIncident` was correctly defined. The 404
came from the **exception→status mapping**:

```
CryIncidentService.GetIncident(jobId, childId, …)
   └─ no incident row found
        └─ throw new MonitoringAccessException(MonitoringDenial.IncidentNotFound)
                                        │
MonitoringController.CryAction          │
   └─ catch (MonitoringAccessException) │
        └─ MonitoringError(ex)          │
             └─ case IncidentNotFound: return NotFound();   ← 404
```

`MonitoringError` maps every `*NotFound` denial to a literal 404. But `IncidentNotFound` means
*"there is no incident"* — which, in the overwhelmingly common case of a **calm, quiet
nursery**, is the answer to *almost every poll*. The endpoint conflated two very different
situations behind one status code:

- "this baby is fine and nothing has been reported" — the **normal** state, and
- "you are not allowed to see this child's incidents" — a **real authorization outcome**.

A REST client cannot distinguish those from a bare status code without body-sniffing.

**The fix** (`MonitoringController.cs`). `GetCryIncident` now calls the service directly in a
`try/catch` rather than through `CryAction`, and special-cases exactly one denial:

```csharp
catch (MonitoringAccessException ex)
{
    if (ex.Denial == MonitoringDenial.IncidentNotFound)
        return Ok(null);          // 200 + null body == "no incident, nothing reported"

    return MonitoringError(ex);   // 403 for real refusals; 404 only if the scope is gone
}
```

Resulting contract:

| Status | Meaning |
|---|---|
| **200** + DTO | The incident |
| **200** + `null` | **No incident exists** — the normal quiet case |
| 400 | Non-positive ids |
| 403 | Genuine authorization refusal (`NotGuardian`, `NotAssignedSitter`, `InvalidRole`, `ChildNotInJob`, `JobNotInProgress`) |
| 404 | The *scope* does not exist (`JobNotFound`, `ChildNotFound`) |

Two deliberate choices:
### 10.2 Task 2: decoupling UI state from API polling

**Symptom.** The Babysitter successfully joined `lc-m-157-27-f5bf55d0` and the SFU logged
*"Consumer Success attached media"* — video was genuinely rendering. Yet the UI showed:

> "Reconnecting... Awaiting video feed... We lost the connection to the nursery camera."

The WebRTC layer was healthy. **The React component was lying.** Two independent defects
combined to produce it, and fixing only one would not have solved it.

#### Defect 1 — the sticky error (the real cause)

The old load-timeout effect wrote a sentinel that **nothing could ever clear**:

```jsx
// BEFORE — permanently poisoned the surface
useEffect(() => {
  if (!frameSrc) return undefined;
  const timer = setTimeout(() => setLoadedScopeKey(`error:${scopeKey}`), FRAME_LOAD_TIMEOUT_MS);
  return () => clearTimeout(timer);
}, [frameSrc, scopeKey]);
```

The effect only re-armed when `frameSrc` or `scopeKey` changed. The iframe stayed mounted, so
its `onLoad` never fired again. **One slow load therefore pinned the surface to "lost" for the
entire sitting** — including after video was visibly flowing.

#### Defect 2 — the dead bridge listener (why nothing could rescue it)

```jsx
// BEFORE — gated behind the very flag it would have cleared
useEffect(() => {
  if (!frameLoaded || !frameOrigin) return undefined;   // ← the gate
  window.addEventListener('message', onMessage);
  …
}, [frameLoaded, frameOrigin]);
```

In exactly the situation where proof of life was most needed, the listener for the SFU's own
`littlecare:state` messages **was switched off by the false negative itself**. The one signal
that could have corrected the error was disabled because of the error.

#### Defect 3 — REST polling was writing camera claims

`useMonitoring.refresh()` wrote the nested cry-read failure into the shared `error` state, which
the connection UI reads. So an unrelated JSON endpoint was driving wording *about the camera* —
the exact "frontend is authoritative" failure the project's own design notes forbid.

#### The fix

**A. A timeout is a fact about the SURFACE, and it is retractable.**

```jsx
const [timedOutScopeKey, setTimedOutScopeKey] = useState(null);
const [retryNonce, setRetryNonce] = useState(0);

const noteAlive = useCallback(() => {
  setTimedOutScopeKey(null);                       // retract the negative
  if (loadedScopeKeyRef.current === `error:${scopeKeyRef.current}`)
    setLoadedScopeKey(scopeKeyRef.current);        // and overwrite any error sentinel
}, []);
```

`noteAlive` is invoked by **every** piece of positive evidence — iframe `onLoad`, a bridge state
message, a transport event. This is the single most important rule in the fix: *a false "lost"
must always be retractable by the next sign of life.*

**B. The bridge listener is gated on the frame existing, not on it working.**

```jsx
if (!frameSrc || !frameOrigin) return undefined;   // gate on EXISTENCE, never on success
```

An SFU that can talk to us must always be able to overrule us.

**C. The status is now driven ONLY by SFU evidence.**

```jsx
const transportKey    = `${scopeKey}:${retryNonce}`;
const transportValue  = transport?.key === transportKey ? transport.value : null;

const conferenceStatus =
  transportValue === 'failed' ? 'failed'      // SFU said the peer connection failed
    : frameErrored            ? 'error'       // browser raised a real iframe error
      : frameLoaded            ? 'loaded'      // document loaded
        : timedOut              ? 'error'      // surface never came up (retractable)
          : 'connecting';

const feedIsLive = frameLoaded && transportValue !== 'failed';
```

Note the precedence: **`frameLoaded` outranks `timedOut`.** Because `noteAlive()` clears the
timeout the instant any positive evidence arrives, a slow load can no longer pin the pill to
## 11. Phase 9.2 — premium monitoring redesign

### 11.1 What changed, structurally

| Before | After | File |
|---|---|---|
| MiroTalk toolbar/settings/name overlays visible | Suppressed via `?embed=1` **plus** injected `display:none !important` CSS | `MonitoringMediaPanel.jsx` |
| 5-row always-visible status list | **One** floating glassmorphic pill over the video | `BabyMonitoringScreen.jsx` |
| Family/pause/DND cards in the main column | Moved into a `<MonitoringSettingsModal>` behind the gear | `MonitoringSettingsModal.jsx` (new) |
| Full-width red "Exit monitoring" button | Muted-coral "End session" in a sticky bottom dock | `BabyMonitoringScreen.jsx` + CSS |

**New files.** `MonitoringSettingsModal.jsx` and `monitoring-settings-modal.module.css`.

### 11.2 Step 1 — immersive container and toolbar suppression

The premium container, per the design directive:

```css
.stageFrame {
  border-radius: 24px;
  background: #0B132B;                             /* deep navy */
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;                                 /* clips the SFU's square video */
  aspect-ratio: 16 / 9;                             /* from the base .frame */
}
```

`SFU_CHROME_SUPPRESSION_CSS` hides `.toolbar`, `.settings`, `#buttons`, participant-name
overlays and dialogs with `display: none !important`.

**An honest constraint worth stating in the defense.** The SFU iframe is **cross-origin**, so
the browser's same-origin policy correctly denies access to `contentDocument`. The injection is
therefore a **progressive enhancement**, not a guarantee:

- **Same-origin** deployment (the usual LAN/dev setup) → chrome is stripped, video is bare.
- **Genuinely cross-origin** → nothing is injected, the attempt is logged once, and the panel
  still works via the server's `?embed=1` switch, which is MiroTalk's *supported* mechanism.

This is stated plainly in the code because the alternative — reaching into the frame from the
parent — is impossible by design, and any code claiming otherwise is either broken or has
already crossed a security boundary. **The security control is `audio_cant_unmute` /
`video_cant_unhide` (§8.3); the CSS is cosmetic.**

### 11.3 Step 2 — ruthless status consolidation

### 11.4 Step 3 — relocated administrative settings

`MonitoringSettingsModal` is a thin **dialog shell** around the shared `<Modal>`, which supplies
`role="dialog"`, `aria-modal`, the focus trap, Escape-to-close, focus restore and the body scroll
lock. The component adds only the heading, a close button, and a **role gate**: a sitter opening
the gear is told guardian settings are managed by the parents, rather than being shown buttons
that could only ever 403.

`Phase7FamilyPanel` is rendered **unchanged** — same component, same props, same server-backed
behaviour — just inside the modal. It is not re-implemented, because it is the tested
implementation of the guardian/pause/DND rules, including its refusal to count a pause down from
a client-chosen start. Rewriting it for a layout change would risk reintroducing a
client-authority bug.

The gear icon previously **navigated away** to the dashboard while wearing a settings icon —
misleading, and it discarded the user's place. It now opens the modal; the dashboard remains
reachable via the back button and bottom nav, so nothing becomes unreachable.

### 11.5 Step 4 — the unified control dock

```css
.controlDock {
  position: sticky; bottom: calc(72px + env(safe-area-inset-bottom, 0px));
  display: flex; justify-content: flex-end; gap: var(--space-2);
}
.dockEndButton {                       /* muted coral, not saturated red */
  border: 1px solid rgba(248,113,113,0.38);
  background: rgba(248,113,113,0.12);
  border-radius: var(--radius-full);
}
.dockToggle[data-on='false'] {          /* camera / mic, publisher only */
  background: rgba(248,113,113,0.12);
  border-color: rgba(248,113,113,0.42);
}
```

Two design justifications:

- **`sticky`, not `fixed`.** A fixed bar would have to hard-code the bottom-nav height to avoid
  covering it and would float over content at all times. Sticky participates in the scroll
  container and settles into the gap the bottom nav already leaves.
- **Muted coral, not saturated red.** Leaving is a *rare* action. It must be reachable one-handed
  without being the most eye-catching element on a screen whose job is a calm night-time feed.

The camera/mic toggles render **only when the server granted publishing**, because a viewer has
no camera or microphone to control. Offering them to a viewer would invite exactly the accidental
publishing the design forbids.

### 11.6 Accessibility notes

- Every state is carried by a **text label**, never colour alone (`data-live` + "Live" /
  "Reconnecting...").
- `prefers-reduced-motion: reduce` disables the status-dot pulse, the spinner and the fallback
  halo animation.
## 12. Data flow: Babysitter opens the app → receives video

### 12.1 Phase A — authentication

```
1. POST /api/auth/login { username, password }
      Server: BCrypt verify against Babysitters
      Server: INSERT UserSessions (64-hex opaque token, Role, ExpiresAt)
      ← 200 { userId, role: "Babysitter", token, expiresAt }

2. AuthProvider stores the token (services/sessionStorage.js)
3. apiClient attaches `Authorization: Bearer <token>` to every subsequent request
```

### 12.2 Phase B — scope discovery

```
4. GET /api/monitoring/accessible-scopes          (Bearer)
      MonitoringAccess over every candidate scope
      ← AccessibleMonitoringScopeDto[]   e.g. { JobId: 157, ChildId: 27, ChildName: "…" }

   NOTE: this endpoint GRANTS NOTHING. It only tells the UI what to offer, so a
   co-parent can see sessions they are entitled to but do not own.
```

### 12.3 Phase C — the monitoring session

```
5. POST /api/monitoring/session/start { jobId: 157, childId: 27 }
      MonitoringAccess.Check → allowed (JobNotInProgress? no; NotAssignedSitter? no;
                               ChildNotInJob? no)
      Idempotent: returns the EXISTING Active session if one exists
      ← 200 { MonitorSession_ID, Status: "Active", IsPaused: false, … }

6. useMonitoring now owns two timers:
      · every 8s → POST session/heartbeat  (server stamps LastHeartbeatAt)
      · every 5s → GET  session            (also drives the escalation sweep)
   A heartbeat failure is SWALLOWED — the server, not the client, decides "Lost".
```

### 12.4 Phase D — media issuance (the authorization moment)

```
7. GET /api/monitoring/media?jobId=157&childId=27      (Bearer)
      (1) validate ids
      (2) MonitoringAccess.Check                      ← AUTHORIZATION
      (3) find TOP 1 ACTIVE MonitorSession for (157, 27)
      (4) isParent = (role == "Parent") → false
            Role = "viewer"  DisplayName = "Babysitter"  CanPublish = false
      (5) room = HMACSHA256(salt, "canonical:157:27")[0..4] → hex8
            roomId  = "lc-m-157-27-f5bf55d0"
            joinPath = /join/?room=lc-m-157-27-f5bf55d0&name=Babysitter
                       &audio=0&video=0&hide=1&notify=0&chat=0
                       &audio_cant_unmute=1&video_cant_unhide=1
                       &isPresenter=0&embed=1
      ← 200 { Configured: true, ServerUrl, RoomId, JoinPath, CanPublish: false,
               MonitorSessionId, Role: "viewer" }
```

### 12.5 Phase E — rendering the surface

```
8.  useMonitoringMedia tags the result with scopeKey = "<MonitorSessionId>:<RoomId>"

9.  MonitoringMediaPanel (variant="stage"):
      frameSrc = ServerUrl + JoinPath        // concatenation ONLY — never built
      scopeKey = "485:lc-m-157-27-f5bf55d0"
      allow    = "fullscreen; autoplay"      // NO camera/microphone for a viewer
      key      = `${frameSrc}#${retryNonce}` // remountable for retry
### 12.8 Summary diagram

```
 Babysitter phone                      ASP.NET API                        MiroTalk SFU
 ─────────────────                     ───────────                        ───────────
      │                                     │                                  │
  ①  ├──── POST /auth/login ──────────────▶│ verify BCrypt, mint token         │
      │◀─── token, role="Babysitter" ──────│                                  │
      │                                     │                                  │
  ②  ├──── GET accessible-scopes ─────────▶│ MonitoringAccess                   │
      │◀─── [(157, 27)] ───────────────────│                                  │
      │                                     │                                  │
  ③  ├──── POST session/start ────────────▶│ idempotent create / return existing│
      │◀─── MonitorSession Active ─────────│                                  │
      │                                     │                                  │
  ④  ├──── GET media?jobId&childId ───────▶│ ① MonitoringAccess                 │
      │                                     │ ② find ACTIVE session             │
      │                                     │ ③ role=viewer, CanPublish=false   │
      │                                     │ ④ HMAC room lc-m-157-27-f5bf55d0  │
      │◀─── JoinPath + RoomId ─────────────│    (salt never leaves the server)  │
      │                                     │                                  │
  ⑤  ├──── iframe GET /join/?room=… ─────────────────────────────────────────▶│
      │                                     │              apply cant_publish  │
      │◀══════════ WSS signalling (ICE / DTLS-SRTP) ══════════════════════════▶│
      │◀══════════ SRTP media frames ════════════════════════════════════════▶│
      │                                     │                                  │
  ⑥  bridge → postMessage littlecare:state { videoElements: 1 }                │
      │◀────── littlecare:transport 'connected' ─────────────────────────────▶│
      │  feedIsLive = true  →  pill shows "Live"                              │
      │                                     │                                  │
  ⑦  ├── every 5s  GET session ───────────▶│ (drives the escalation sweep)     │
      ├── every 8s  POST heartbeat ───────▶│ (server decides "Lost")           │
      └── every 5s  GET cry ──────────────▶│ 200 + incident | 200 + null       │
                                            (a failure ⇒ console only)         │
```

**The one-line invariant of the whole flow:** every arrow into the API carries only
`{ jobId, childId }` plus a bearer token, and every arrow out of the API is a verdict the
client did not compute.

---

## 13. Known limitations and risks

### 13.1 Functional gaps

| Gap | Cause | Next step |
|---|---|---|
| **Job-scoped cry detection does not work** | `MonitoringDeviceSession` is FK-bound to the independent session and has no `Job_ID`; a job-scoped device credential would need a schema change, which the phase forbade | Add `Job_ID` + a job-scoped credential table; keep the endpoint failing closed until then |
| **"Feeding Baby" is disabled** | The recording pipeline (capture, upload, storage, schema) is deliberately not built | Build the pipeline, then wire the button — it must never be faked |
| **Recording / playback** | Not built; YAMNet runs on-device only | Server-side recording with an explicit consent model |
| **Push notifications** | Polling only (no push library), by deliberate architectural decision | Add SignalR if battery permits |

### 13.2 Technical risks

1. **No TURN server.** `SFU_ANNOUNCED_IP` is a LAN address, so media works on the LAN but will
   **not traverse NAT**. Real remote users behind symmetric NAT will fail. **coturn is required
   for production** — the single biggest deployment blocker.
2. **Single-instance assumption.** The escalation sweeper's atomic claim is designed for
   multi-instance contention but was only tested against one IIS Express instance.
3. **Frozen EDMX.** Monitoring tables are reached by raw SQL, so schema changes are manual and
## 14. Defense question bank

### 14.1 Architecture

**Q. Why is the backend authoritative?**
Because a client cannot be trusted and cannot be the source of truth for time or permissions.
The server owns its own clock (so pause expiry is immune to client clock skew), owns escalation
deadlines (so a client restart cannot lose a pending escalation), and re-runs `MonitoringAccess`
on every request (so hiding a button grants nothing).

**Q. Why Web API 2 and not ASP.NET Core?**
It is the existing platform in the project. The important architectural point is independent of
the framework: authorization is centralized in `MonitoringAccess.Check`, not distributed across
controllers, so it is testable and auditable regardless of hosting model.

**Q. Why is the EDMX frozen?**
To keep Phases 3–12 free of schema migration and entity regeneration, so each phase stayed
independently verifiable and reversible. The cost is parameterized raw SQL for the monitoring
tables, an approved and audited pattern here.

**Q. Why polling instead of WebSockets for app data?**
Deliberate (recorded as AD2 in the requirements matrix): it keeps the client stateless and the
server restart-safe, and avoids a persistent connection per user. WebRTC already uses a socket
for media; the JSON API does not need one.

### 14.2 Security

**Q. How do you stop a babysitter publishing video of the child?**
Four independent layers (§8.3): the server derives `CanPublish` from the token; the join path sets
`audio_cant_unmute=1` / `video_cant_unhide=1`, which the **SFU** enforces for the whole session;
the iframe `allow` list omits `camera; microphone`, so the browser never prompts; and the UI
renders no such controls. Only the first three are security controls.

**Q. Could someone edit the URL to publish?**
Editing the query string changes only the *initial* request. The SFU applies the cant_publish locks
server-side for the session's lifetime, and Little Care never issues a publisher room to a
non-parent. No single edit is sufficient.

**Q. What stops a parent watching someone else's child?**
`MonitoringAccess.Check` requires a `ChildGuardian` row for that exact child (`NotGuardian`
otherwise), plus `ChildNotInJob`, plus an in-progress job. Identity is checked **before** child
existence, so an unauthorized parent cannot even learn whether a child id exists — closing an
enumeration oracle.

**Q. Why is the room id HMAC'd rather than just the job and child ids?**
`jobId`/`childId` are sequential integers, so a plain concatenation would let anyone reaching the
SFU enumerate other families' rooms by counting. The keyed digest removes that. It is an
**identifier, not a capability** — authorization still happens on every request.

**Q. What if the room salt leaks?**
A leaked salt would allow room-id *computation*, not room *access* — the SFU still applies the
receive-only locks, and `MonitoringAccess` still gates every API call. It is nonetheless the
highest-value secret in the media path and should be protected (§9.6).

**Q. How is a dismissed babysitter locked out immediately?**
Opaque server-side sessions. `DELETE /api/auth/logout` deletes the `UserSessions` row, so the token
fails `SessionAuthorize` on the very next request rather than remaining valid until expiry. This is
### 14.3 Reliability

**Q. What was the most interesting bug you found?**
The Phase 9.2 UI state mismatch (§10.2), because it was a **two-part** failure and the visible
symptom pointed away from the real cause. The SFU log proved video was flowing while the UI said
"Reconnecting". The cause was a sentinel written by the load-timeout effect that *nothing could
clear* (the effect only re-armed on prop changes, and the iframe never re-fired `onLoad`),
compounded by a bridge listener gated behind `frameLoaded` — so the SFU's own proof of life was
switched off **by the false negative itself**. The lesson generalizes: a negative state must always
be retractable by the next positive signal.

**Q. Why did the backend return 404 for a healthy baby?**
Because "no incident exists" and "you are not authorized" both mapped to `MonitoringError`'s
`NotFound()`. In a quiet nursery — the overwhelmingly common case — that meant a 404 on essentially
every poll. Fixed by returning **200 + `null`** for `IncidentNotFound` while keeping real
authorization refusals at 403. The general principle: *the existence of a scope is a status code;
the existence of a thing within it is data.*

**Q. How do you know the monitoring session is lost?**
The **server** decides, by comparing its own clock against the heartbeat stamp it recorded. A
failed heartbeat on the client is swallowed deliberately: one failed request is not evidence of
anything, and a client-declared "connection lost" about someone else's camera is exactly the kind
of claim a client must not make.

### 14.4 Evaluation and future work

**Q. How was this tested?**
Per-phase verification harnesses under `docs/testing/` and `WebApplication2/scripts/`, each
covering the shared authorization chain, plus a requirements matrix tracking every requirement
with its evidence and verdict (including "KEEP" decisions with rationale).

**Q. What would you do next, in order?**
1. Add **coturn** — without it the product cannot work outside a LAN, which blocks everything else.
2. **Job-scoped device credentials** so cry detection works during a booked sitting (§13.1).
3. Replace 5 s polling with **SignalR** to cut request volume and improve latency.
4. **Load-test** the escalation sweeper across multiple instances to verify the atomic claim.
5. Move the room salt out of `Web.config` into a protected secret store.

---

*End of document. Sections 1–7 describe the system as built; §10–11 document the Phase 9.2
changes; §13 and §14 are deliberately self-critical, because knowing your own limitations is
stronger in a defense than being asked about them.*
the main reason not to use self-contained JWTs here.

**Q. What stops a parent reporting a fake cry to distract a sitter?**
Reporting a cry is treated as a safety-relevant **write**, not an observation. `MonitoringAccess`
answers "may observe?" and admits both guardian and sitter, so it cannot express "may detect?".
`CreateCryIncident` therefore requires a dedicated monitoring-device credential and refuses any
request bearing an ordinary bearer token (§5.3).

---
   there is no compile-time protection against column renames.
4. **32-bit HMAC truncation.** A namespace-integrity concern rather than an authorization one;
   acceptable at this scale, trivial to widen.
5. **Polling cost.** 5 s session + 8 s heartbeat + 5 s cry ≈ 3 requests per 15 s per client. Fine
   at university scale; would need a push channel at scale.
6. **React StrictMode double-effects.** All effects are written to be idempotent and cleanup-safe
   specifically for this; the sticky-error bug (§10.2) is a related class of defect.

### 13.3 Risks this pass introduced

- **`retryNonce` remounts the iframe.** Repeatedly tapping "Try again" on a dead SFU remounts the
  frame each time. Acceptable for a manual action, but production should rate-limit it.
- **`CONSECUTIVE_POLL_FAILURES_BEFORE_OFFLINE = 3`** means a ~15 s delay before reporting API
  unreachability. Deliberate: it stops one proxy hiccup from alarming the user.
- **SFU chrome suppression only works same-origin** (§11.2). Cross-origin deployments rely on
  `?embed=1` alone. Not a regression — the previous code did nothing at all.

---

10. Chrome-suppression effect attempts to inject the display:none stylesheet.
      Same-origin → injected. Cross-origin → logged once, skipped (§11.2).

11. Bridge listener attached as soon as frameSrc EXISTS (not on success):
      origin check → only 'littlecare:state' / 'littlecare:transport' accepted.
```

### 12.6 Phase F — WebRTC negotiation

```
12. Browser loads https://<host>:3010/join/?room=lc-m-157-27-f5bf55d0&…
13. SFU validates the room, applies isPresenter=0 and the two cant_publish locks,
    and opens a WSS signalling socket.
14. ICE candidates are exchanged; a DTLS-SRTP session is established.
15. The Babysitter attaches as a CONSUMER; the Parent's device is the producer.
      SFU log: "Consumer Success attached media videoType"   ← the observed success
16. RTP media flows through the SFU; the Babysitter's <video> renders frames.
17. Bridge reports littlecare:state { audio:false, video:false, videoElements:1 }
      → noteAlive() retracts any pending timeout
      → transport = 'connected'  (the SFU transport state is now unambiguous)
      → feedIsLive = true → the pill reads "Live" with an emerald dot
```

### 12.7 Phase G — steady state

```
18. Every 5s : GET session    → server verdict on session/connection/pause
    Every 8s : POST heartbeat → server re-evaluates "Lost" on its own clock
    Every 5s : GET cry        → 200 + incident, or 200 + null (§10.1)
                               a failure here is logged ONLY and cannot
                               change the video state (§10.2)

19. If the SFU reports littlecare:transport { state:'failed' }:
      → transportValue = 'failed' → conferenceStatus = 'failed'
      → pill: amber dot + "Reconnecting..."
      → overlay: "The video connection was interrupted. Little Care is retrying
                  automatically." + a "Try again" button

    On any later positive signal (onLoad / bridge state / transport connected):
      → noteAlive() + noteTransport('connected') → feedIsLive = true → "Live"
      THE FALSE NEGATIVE IS RETRACTED. This is the Phase 9.2 fix.
```

---
- The modal traps focus, restores it on close, supports Escape, and locks body scroll.
- The status pill is `pointer-events: none` so it never intercepts taps meant for the video.
- Disabled controls (before the bridge is ready) are visibly unavailable rather than silently
  inert.

---
The single glassmorphic pill:

```css
.statusPill {
  position: absolute; top: 16px; left: 16px; z-index: 3;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: 99px;
  background: rgba(11, 19, 43, 0.6);            /* dark navy glass */
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(12px);
  color: #FFFFFF; font-size: 0.85rem; font-weight: 600;
  pointer-events: none;                         /* never swallow taps to the video */
}
.statusPill .statusDot                   { background: #F59E0B; }   /* amber  */
.statusPill[data-live='true'] .statusDot { background: #10B981; }   /* emerald */
```

The pill was changed from a **light** white film to the **dark navy** one in the directive,
because white text on a translucent white film dropped below a usable contrast ratio over a
brightly lit nursery. The dot colour is backed by `data-live` and a text label, so state is
never conveyed by colour alone.

**Removed from `BabyMonitoringScreen`:** the always-on `MonitoringStatusBar` row set, the
redundant `monitorError` "connection problem" text, and the standalone camera/mic toggles.

**Deliberately kept:** `MonitoringStatusBar` still renders — but **only when it has something
true to say**:

```jsx
{(incident || session?.IsPaused || pause?.Status === 'Requested') ? (
  <MonitoringStatusBar … showPauseAndDnd={false} compact />
) : null}
```

A quiet nursery now shows one calm video and no status furniture. A crying baby still produces
an unmistakable banner. Nothing here is client-computed — this only decides **when** to show
server facts, never **what** they are.

---
"Reconnecting". That inversion is the specific repair.

Transport is **scoped by key** rather than reset in an effect. A verdict from a previous room
simply does not match the current key, so it is discarded by derivation — the same
scope-tagging pattern `useMonitoringMedia` already uses, and the reason one baby's state can
never leak onto another.

**D. REST polling can no longer describe the camera.** In `useMonitoring.js`:

```js
const CONSECUTIVE_POLL_FAILURES_BEFORE_OFFLINE = 3;

// cry read: purely diagnostic — never touches UI state
try {
  const c = await API.getCryIncident(jobId, childId);
  if (aliveRef.current) setIncident(c ?? null);
} catch (err) {
  logPollFailure('cry-incident', err);        // console only
}
```

Three further changes:

- **The incident is left untouched on failure.** A failed read says nothing about whether a baby
  is crying, and blanking an open alert would hide a real safety event.
- **`offline` is thresholded** — only after 3 consecutive *session-read* failures (~15 s), which
  means "this browser cannot reach the API", a narrow true statement. It is cleared by the very
  next success.
- **`apiReachable: !offline` is exposed alongside `offline`** so no future consumer can
  accidentally read `offline` as a claim about the nursery camera.

**E. Honest, recoverable fallback UI.** The overlay is now split by cause: a real transport
failure keeps camera-specific wording; a surface timeout says the surface is slow to open and
offers a **"Try again"** button that remounts the iframe via `retryNonce`. It is also gated on
`!frameLoaded`, so a rendering stream can never have the overlay painted over it.

**Verification.** `npx vite build` → 272 modules transformed, built successfully.
`npx eslint src/` → 0 problems. `node scripts/check-css-modules.js` → every `styles.*` resolves.
The end-to-end behaviour was **not** re-verified against a live SFU in this pass; the changes
were verified by build, lint and static reference checks only.

---

- **Scope existence is still a status code; incident existence is data.** The distinction a
  client actually needs — "am I allowed to see this?" — is preserved in the status.
- **The null case is not audited as a denial**, because nothing was refused; the caller was fully
  authorized and the answer is simply "nothing reported yet".

`Ok(null)` serializes to the JSON literal `null`, which axios delivers as a **successful**
response whose `data` is `null` — and every caller already renders `incident ?? null`.

---

Stating these proactively is stronger than being asked:

1. **The HMAC salt lives in `Web.config`.** Plaintext config is not ideal; a DPAPI-protected
   value or an environment secret would be better. Mitigated by the file never being served.
2. **`MonitoringMediaServerUrl` is public config.** Anyone who learns the SFU URL can attempt to
   join a room — but they cannot compute a room id without the salt, so this is defence in depth
   rather than a live hole.
3. **The SFU is a separate attack surface.** It is third-party code in the deployment and is not
   hardened by Little Care; its own config must be reviewed independently.
4. **Job-scoped cry detection is non-functional** (fails closed, §9.1). Secure but incomplete, and
   should be presented as a known limitation with a stated next step.
5. **Single-instance escalation.** `CryIncidentService`'s atomic claim targets multi-instance
   contention, but only one IIS Express instance was available for testing, so this is reasoned
   rather than load-verified — the project docs state this explicitly.
6. **No TURN server configured.** The dev `.env` shows `SFU_ANNOUNCED_IP` on a LAN address, so
   media works on the local network but **will not traverse NAT** for real remote users. A
   production deployment needs coturn.

---

The paired monitor device holds a **64-hex-character credential** issued at pairing time.

```
X-Monitor-Device: <64 hex chars>
   │
   ├─ Authorization header MUST be absent   (an account bearer is never a device)
   ├─ length == 64
   ├─ SHA-256(token) → lowercase hex → compared to MonitoringDeviceSession.CredentialHash
   ├─ RevokedAtUtc IS NULL
   ├─ ExpiresAtUtc > GETUTCDATE()
   ├─ IndependentMonitoringSession.Status = 'Active' AND IsDeleted = 0
   └─ Child.Child_ID == requested child
```

Properties that matter in a defense:

- **Hashed at rest.** `CredentialHash`, not the credential. A database dump does not yield
  usable device credentials.
- **Identity separation is enforced, not assumed.** The explicit refusal of a request bearing
  *both* an account token and a device credential prevents privilege crossover between systems.
- **Revocable and expiring.** `RevokedAtUtc` / `ExpiresAtUtc` give an immediate kill-switch and
  a bounded lifetime.
- **Every failure returns one identical message**, so the endpoint cannot enumerate valid
  credentials or discover which child a device belongs to.
- **Re-verified against `MonitoringAccess`** after the device check, so even a valid device
  credential cannot be pointed at another family's child.

---
The monitor *device* (Phone 2, independent flow) follows the same steps but authenticates
with `X-Monitor-Device` instead of a bearer token, and its room is derived from the same
`(jobId, childId)` scope — which is what allows it and the Babysitter to meet.

### 8.6 HTTPS and certificate requirements

Media capture only works on a **secure context**. The dev orchestrator
(`start-littlecare-dev.ps1`) therefore provisions a trusted certificate and serves:

- Vite on `https://<LAN-IP>:5173`
- MiroTalk on `https://<LAN-IP>:3010`
- WebRTC RTP on UDP and TCP (firewall rules are created by the script)

`GetConfiguredMiroTalkServerUrl()` rejects any non-HTTPS SFU URL, so a deployment that forgets
TLS fails closed rather than silently losing camera access.

---
| `audio`, `video` | `1`, `1` | `0`, `0` | Initial media state |
| `hide` | `0` | `1` | Hide own tile — the parent sees only the real camera feed |
| `audio_cant_unmute` | `0` | **`1`** | **SFU-enforced mute lock** |
| `video_cant_unhide` | `0` | **`1`** | **SFU-enforced camera lock** |
| `isPresenter` | `1` | `0` | SFU presenter flag |
| `embed` | `1` | `1` | Opt into the Little Care embed bridge |
| `screen`, `notify`, `chat` | `0` | `0` | Disable screen share, notifications, chat |
| `roomPassword` | `0` | `0` | Room is already unguessable (HMAC) |

### 8.3 How the Babysitter is restricted to receive-only

This is the most important security mechanism in the media layer, and it is deliberately
**not** implemented in the UI. The source is explicit:

> *`audio=0`/`video=0` only sets the INITIAL state; the viewer could still click their own
> mute/camera buttons and start publishing. These two MiroTalk parameters are enforced by the
> SFU for the whole session (verified present in this deployment's `app/src/Server.js`), so a
> Babysitter stays receive-only even if the UI offers the controls.*

The defence is **four independent layers**, and only the fourth is cosmetic:

| Layer | Mechanism | Enforced where |
|---|---|---|
| 1. **Role derivation** | `CanPublish = (role == "Parent")` | **Server**, from the bearer token |
| 2. **Join params** | `audio_cant_unmute=1`, `video_cant_unhide=1` | **The SFU**, for the session's lifetime |
| 3. **Iframe permissions** | `allow={canPublish ? 'camera; microphone; …' : 'fullscreen; autoplay'}` | **Browser** — a viewer is never even prompted |
| 4. **UI suppression** | no camera/mic controls rendered unless `canPublish` | React (presentation only) |

The `allow` attribute is the subtle one: it grants only the *permission prompt*. A Babysitter
joining as a viewer receives no `camera; microphone` in the allow-list, so the browser never
asks to publish, regardless of what the SFU does.

**If asked "could someone edit the URL to publish?"** — editing the query string only changes
the *initial* request. The SFU applies `audio_cant_unmute` / `video_cant_unhide` server-side
for the whole session, and Little Care never issues a publisher room to a non-parent.
Defence in depth means no single edit is sufficient.

---

A component rather than inline markup because the media state has **seven** genuinely
different conditions, and each needs exactly one honest rendering. The rule it enforces:

> *`Live` is shown if and only if the provider has genuinely established a session.*

Explicitly **never** rendered: fake sensor readings, "HD 1080p", a "Secure Connection" badge
over a stream that does not exist, or a mock nursery.

Props: `status`, `media`, `canPublish`, `reason`, `childName`, `variant`
(`hero` | `card` | `stage`).

`scopeKey` is `${media.MonitorSessionId}:${media.RoomId}` and `frameSrc` is
`` `${media.ServerUrl}${media.JoinPath}` `` — the browser concatenates a server-issued
address and path and **never builds or picks either**.

Three `variants`: `hero` (standalone), `card` (subtle border), `stage` (the Active Session
hero — one floating pill, no second caption bar).

**`LiveMediaStage.jsx`** wraps the stage variant. Its header carries two decisions: the child
is **derived, never chosen** (the old `<select>` implied authority the user lacks), and the
status is **consolidated** there so the user reads one word in one place.

**`MonitoringStatusBar.jsx`** renders five *distinct* facts (session, connection, pause,
alert, DND) because they can be true independently — a session can be Active while the
connection is Lost, while a pause is Approved, and while an incident sits at escalation.
After Phase 9.2 it is rendered on the monitoring screen **only when it has something to say**
(see §11.2).

### 7.6 `SitterMonitoringPanel.jsx` and `SitterActionDashboard.jsx`

`SitterMonitoringPanel` is a pure presentation component that states the rule it depends on:

> *BACKEND IS AUTHORITATIVE — Every state shown here comes from `useMonitoring`, which only
> sends `{ jobId, childId }`. This component never computes when T+5 or T+15 fires, never
> expires a pause, and never marks the connection lost.*

`SitterActionDashboard` presents the sitter's two escalation responses ("I'm going to the
child" / "With child"). Both are server actions and both are **idempotent** server-side, so a
double-tap cannot postpone a parent's escalation deadline twice.

---

The doc comment records what it replaced: the old code read `location.state?.roomName`, *"a
room name that had been passed around through React Router navigation… That is a shared
secret with no authorization attached, and it is exactly the 'room-name-only access' pattern
the security audit forbids."*

**The key design decision — one tagged state, no stored `loading` flag.** The hook holds a
single `result` tagged with a `scopeKey`. This eliminates two real problems:

1. *React's set-state-in-effect rule.* A stored `status` would have to be written to
   `'loading'` synchronously at the top of the effect, cascading a render. Instead "loading"
   is **derived**: no result for the current scope ⇒ loading.
2. *Stale-scope flashes.* If the user switches child, a result tagged with the previous scope
   no longer matches and is discarded automatically, so the previous baby's media can never
   be shown against the new child.

`refreshKey` (the monitoring session status) is folded into `scopeKey`, so `session/start`
being pressed re-requests media immediately. Without it the first `404` ("no active session
yet") would stick for the life of the screen.

| `status` | Meaning | UI wording |
|---|---|---|
| `idle` | no scope yet | "No active monitoring session" |
| `loading` | request in flight | "Opening monitoring room" |
| `ready` | server issued a media session | renders the iframe |
| `unavailable` | `Configured: false` | "Live video unavailable" + server's reason |
| `no-session` | 404 — no **Active** session | "Live video appears once Child Mode is started…" |
| `denied` | 403 — genuinely refused | "You are not authorised to view this child." |
| `error` | anything else | "Could not reach the live video service." |

The `no-session` vs `denied` split is a direct fix for finding **B3** in §4.5: a 404 means "not
started", and reporting it as "not authorised" would tell an owner parent they are forbidden
from watching their own child.

Also note the PascalCase discipline: the hook reads `data.Configured`, not `data.configured`,
because Newtonsoft emits PascalCase. Reading the wrong case yielded `undefined`, which made
every deployment look unconfigured and **discarded the server's real reason** (finding B5).

---
| `GetIndependentDeviceMedia(credential)` | Device, via `X-Monitor-Device` | **`true`** | SHA-256 hash match + not revoked + not expired + session Active |

Both resolve the child's **active job-linked `MonitorSession`** purely to derive the canonical
room id, then funnel into `BuildIndependentMedia` → `PopulateMiroTalkMedia` with the canonical
scope. When no active job session exists, `JobId` resolves to `0` and the legacy derivation is
used — which still fails closed.

---
   │          AND Status='Active' AND IsDeleted=0
   │        ORDER BY MonitorSession_ID DESC
   │         none → KeyNotFoundException   → 404
   │
   ├─(4) Derive the participant role SERVER-SIDE:
   │         isParent = (role == "Parent")
   │         Role        = isParent ? "publisher" : "viewer"
   │         DisplayName = isParent ? "Parent"  : "Babysitter"
   │         CanPublish  = isParent
   │
   └─(5) PopulateMiroTalkMedia(dto, canonicalScope, sessionId, jobId, childId)
             → { Configured, ServerUrl, RoomId, JoinPath, Reason }
```

Two invariants are enforced by ordering:

- **Authorization precedes session lookup** (2 before 3), so an unauthorized caller cannot
  learn whether a session exists.
- **The role comes from the authenticated token** (4), so the browser cannot request a
  different role. The comment: *"The server DTO and MiroTalk initial media settings are
  derived from this authenticated role; the browser cannot request a different role."*

---

- **`LEFT JOIN` producing NULL into a non-nullable `int` → HTTP 500.** Co-parent discovery
  broke whenever a second job had no live session. Fixed by changing the join/nullable
  handling rather than by masking it.
- **Duplicate monitoring sessions under concurrency.** Six simultaneous `session/start`
  calls produced **3** Active sessions (377, 376, 378) for one `(job, child)`. Fixed with
  an atomic claim so `StartSession` is genuinely idempotent under load, not just
  sequentially.
- **A media 404 reported as a false authorization denial.** "No active session yet" was
  shown to the owning parent as *"You are not authorised to view this child."* Both wrong
  and alarming. This is why `useMonitoringMedia` now distinguishes `no-session` from
  `denied` — see §7.3.

---
  `CryDetectionPausedException` → HTTP **409**.
- **Sweep-on-poll fallback.** `GetIncident` processes due escalations for the caller's own
  session before answering, so the workflow advances even with no SQL Agent schedule
  deployed. The sweep is wrapped in a try/catch so a sweep failure never breaks the read.

**Viewing never mutates.** Looking at the incident does not touch `EscalationStage`,
`NextEscalationDueAt`, `Status` or any timestamp. The source states this explicitly:
*"Reading must never postpone or suppress an escalation."* This is why "View Child" is a
pure read with no state-changing endpoint.

---
| Method | Route | Purpose |
|---|---|---|
| `POST` | `session/start` | Create or idempotently return the Active session for one child |
| `POST` | `session/heartbeat` | Record that a participant is still reachable (Phase 4) |
| `GET` | `session` | Latest session (`Active`, or `Ended` for post-hoc display); 404 if none |
| `POST` | `session/end` | Set `Status='Ended'`, `EndedAtUtc=UTC now` |

Every one of these takes **`{ jobId, childId }` only** — never a session id. This is an
explicit IDOR defence, commented in the source: *"Clients pass job + child, never raw session
ids, so a session cannot be ended by id guessing."*

#### Cry incident routes (Phases 5 & 6)

| Method | Route | Purpose |
|---|---|---|
| `POST` | `cry` | Create the incident, or return the open one with `Reused=true` (dedupe) |
| `GET` | `cry?jobId=&childId=` | Read the incident — **now 200 + `null` when none exists** (§10.1) |
| `POST` | `cry/going-to-child` | Sitter: acknowledge; postpones *parent* escalation to `max(created+15s, response+10s)` |
| `POST` | `cry/with-child` | Sitter: resolved |

#### Family / pause / DND routes (Phase 7) — all `[SessionAuthorize(Roles = "Parent")]`

`guardian/invitation` (+`/accept`, `/reject`, `/cancel`), `GET guardians`,
`pause` (request / approve / deny / cancel / read), and `dnd` (enable / disable / read —
expired DND reads as inactive).

#### Media & discovery routes (Phase 11)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `media?jobId=&childId=` | Issue (or refuse) a signed media session → `MonitoringMediaDto` |
| `GET` | `accessible-scopes` | Which `(job, child)` pairs may *this* user monitor right now — **discovery only, grants nothing** |
| `POST` | `ops/sweep?max=50` | Operations-only escalation sweeper, guarded by `X-Ops-Sweep-Key` |

`accessible-scopes` fixed a real co-parent gap: a guardian of *another* parent's child is
authorized by `MonitoringAccess`, but the old screen could only discover jobs it owned
itself. The comment notes this endpoint grants nothing — every subsequent call re-checks.

---
│                               │   │                                  │
│  Controllers ─▶ Services ─▶ EF6│  │  embedded via ?embed=1           │
│  MonitoringAccess (gate)      │   │  littlecare-embed.js bridge      │
└───────────────┬───────────────┘   └──────────────────────────────────┘
                ▼
┌───────────────────────────────┐
│  SQL Server                   │
│  EDMX-mapped + raw-SQL tables │
└───────────────────────────────┘
```

---