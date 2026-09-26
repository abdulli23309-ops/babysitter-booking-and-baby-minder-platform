# API-C BASELINE AUDIT

**API-C (`WebApplication2`) — Remediation Baseline Audit**

| | |
|---|---|
| **Document purpose** | Machine-actionable audit of API-C as the **primary backend** to be improved and reorganized (per revised architecture decision) |
| **Scope** | API-C structure, preservation/refactor lists, dead code, port candidate features from API-A/B, rejected features, frontend risks, DB migration risks, implementation order |
| **Status** | Audit / planning only — no implementation code written |
| **Reference docs** | `docs/UNIFIED_BACKEND_FINAL_BLUEPRINT.md` (architectural blueprint, superseded only on the "new project vs. in-place" question) |
| **Stack (confirmed)** | .NET Framework 4.7.2 · ASP.NET Web API 2 · Entity Framework 6 (Database-First/EDMX) · SQL Server · Newtonsoft.Json 13.0.3 · Swashbuckle 5.6.0 · BCrypt.Net-Next 4.0.3 |

> **Revision note (architectural pivot).** The original blueprint proposed building a separate `Unified-Babysitter-API`. The revised team decision is: **API-C (`WebApplication2`) becomes the actively developed, improved, and reorganized backend**, and it is the **only** project where implementation work will occur. API-A and API-B remain reference-only; useful missing concepts are re-implemented cleanly inside API-C. This audit documents the baseline for that work.

---

## 1. Current Architecture

### 1.1 Stack & project facts

| Aspect | Verified fact |
|---|---|
| Project | `WebApplication2` (ASP.NET Web API 2 application; no `.sln` file, standalone `.csproj`) |
| Framework | .NET Framework 4.7.2 (`Web.config` `targetFramework="4.7.2"`) |
| Web API | `System.Web.Http` 5.3.0, attribute routing (`MapHttpAttributeRoutes`) + default `api/{controller}/{id}` |
| CORS | Global `EnableCorsAttribute("*", "*", "*")` in `WebApiConfig` |
| Data access | **EF6 Database-First (EDMX)** — `Models/Model1.edmx`, `Model1.Context.cs` (`BabySitterBooking_and_BabyMinderEntities`) throws `UnintentionalCodeFirstException` |
| Connection | `BabySitterBooking and BabyMinder` DB on `DESKTOP-UD649GB\SQLEXPRESS` (two entries: `…_Entities` and `…_Entities1`) |
| DI | **None** — controllers instantiate the DbContext with `new` |
| Migrations | **None** (no `Migrations/` folder) |
| Tests | **None** (no test project) |
| Swagger | Swashbuckle; `/` redirects to `/swagger` |
| Packages | EF 6.5.1, WebApi 5.3.0, Newtonsoft 13.0.3, BCrypt.Net-Next 4.0.3, Swashbuckle 5.6.0, JWT libs present **but unused** |

### 1.2 Layout

| Folder/area | Contents |
|---|---|
| `Controllers/` | 10 controllers (see §1.3) |
| `DTOs/` | 16 DTO files (auth/parent/sitter/jobs/availability/review/notification/cry) |
| `Models/` | POCOs generated from EDMX + `Model1.edmx` + `Model1.Context.cs` + `UserSession` |
| `Infrastructure/` | `SessionAuthorizeAttribute.cs`, `ClaimsPrincipalHelper.cs`, `ValidationHelper.cs` |
| `App_Start/` | `WebApiConfig.cs`, `SwaggerConfig.cs` |
| `Images/` | `Parents/`, `Sitters/`, `Children/` (with defaults) |
| `docs/` | Existing API contract + security + architecture docs (in-repo) |
| Missing | `Services/`, `Enums/`, `Data/`, `Data/Configurations/`, `Migrations/`, test project, DI setup |

### 1.3 Controllers (endpoints verified in a prior read)

| Controller | Route prefix | Key endpoints | Auth |
|---|---|---|---|
| `AuthController` | `api/auth` | GET `me`, DELETE `logout` | Session |
| `ParentController` | `api/parent` | register, login, children/{id}, child (create), child/{id} (PUT/DELETE), create-job, jobs/{parentId}, deactivate | Mixed |
| `ChildrenController` | `api/parent` | child/{id} (PUT), child/{id} (DELETE) — **duplicate route space with ParentController** | Parent |
| `BabySitterController` | `api/babysitter` | register, login, earnings/{id}, deactivate | Mixed |
| `JobsController` | `api/jobs` | GET `` (open), jobdetails/{id}, confirm/{jobId}/{sitterId}, confirm-bulk, updateStatus/{jobId} (+ `start-session`,`start` aliases), sitter/{sitterId}, active | Session |
| `MatchingController` | `api/matching` | matches/{jobId}, availability/save, filter-siters, availability/{sitterId}, availability/clear/{sitterId}, search-sitters, jobrequests, babysitter/{id} | Session |
| `NotificationsController` | `api/notifications` | GET, {id}/read, clear, POST | Session |
| `ReviewController` | `api/review` | add, sitter/{id}, parent/{id}, user/{userId}/{role} | Session |
| `CryDetectionController` | `api/cry-detection` | POST (raise), latest | Session |
| `ImageController` | `api/images` | {type}/{filename}, default/{type}/{filename}, {filename}, default/{filename} | Anonymous |

### 1.4 Functional coverage (what API-C already has)

Registration/login (parent + sitter), session-token auth + role authorization, parent/sitter/child CRUD, job create/confirm/detail/list/active, date-specific availability, matching/search/filter, **bidding data but no endpoints**, notifications, reviews+ratings, cry-alert ingestion, earnings, soft delete, IDOR + RBAC guards in most modules.

---

---

## 2. Files to Preserve

These must keep their external contract and (where applicable) their files/content, with logic extracted upward into services rather than rewritten.

### 2.1 Controllers (route + contract preserved; logic moves to services)

| File | Preserve (contract) | Refactor (logic) |
|---|---|---|
| `Controllers/AuthController.cs` | `api/auth/me`, `api/auth/logout` | Wrap in `IAuthService` |
| `Controllers/ParentController.cs` | register/login/child/create-job/jobs/deactivate routes + response shapes | Split into `IAuthService`/`IChildService`/`IJobService`/`IAccountService` |
| `Controllers/ChildrenController.cs` | child update/delete routes | Reunify child endpoints under one `IChildService`; resolve `api/parent` route clash with `ParentController` |
| `Controllers/BabySitterController.cs` | register/login/earnings/deactivate routes | Split into `IAuthService`/`IJobService`/`IAccountService` |
| `Controllers/JobsController.cs` | all job routes | `IJobService` (incl. state machine) |
| `Controllers/MatchingController.cs` | all matching/availability routes | `IMatchingService` + `IAvailabilityService` |
| `Controllers/NotificationsController.cs` | all notification routes | `INotificationService` |
| `Controllers/ReviewController.cs` | all review routes | `IReviewService` |
| `Controllers/CryDetectionController.cs` | raise + latest routes | `ICryAlertService` |
| `Controllers/ImageController.cs` | all image routes + path guards + default fallback | `IImageService` |

### 2.2 Preserve (will be reused as-is, possibly relocated)

| Path | Reason |
|---|---|
| `Infrastructure/SessionAuthorizeAttribute.cs` | Core opaque-token auth; keep (optionally move under `Infrastructure/Authentication/`) |
| `Infrastructure/ClaimsPrincipalHelper.cs` | Identity extraction; keep |
| `Infrastructure/ValidationHelper.cs` | Validation; keep (optionally slim/extend) |
| `Models/UserSession.cs` | Session entity (already Code-First friendly) |
| `Images/**` | `Parents/`,`Sitters/`,`Children/`,`default*.jpg` — frontend `<img>` contract |
| `Web.config` connection strings + `entityFramework` section | Reuse instance + provider; connection string replaced by Code-First provider form in a later phase |
| `packages.config` | EF6/WebApi/Newtonsoft/BCrypt/Swashbuckle set stays |
| Existing `docs/api/*`, `docs/security/*`, `docs/architecture/*` | Reference for frontend + security decisions |

### 2.3 Preserve with caution (will be re-expressed)

- The **entire DTO set** — these define the request/response JSON contract. See §7 for per-DTO risk notes.

---

## 3. Files Requiring Refactoring

| File | What is wrong | Refactor target |
|---|---|---|
| `Controllers/*` (all) | Business logic + `new DbContext` inline; large methods (e.g. `ParentController` 606 lines) | Thin controllers calling `IAuthService`/`IJobService`/… |
| `Models/*` (EDMX POCOs) | Database-First artifacts `Model1.edmx`, `Model1.Context.cs`, `UnintentionalCodeFirstException`; no Code First config | Replace with POCO entities + `Data/UnifiedDbContext.cs` + `Data/Configurations/*Configuration.cs` + EF6 Migrations; **delete EDMX** |
| `Models/Model1.Context.cs` | DbContext with raw SQL for session writes, no config | Migrate to `UnifiedDbContext` (keep the sanctioned session raw-SQL write) |
| `App_Start/WebApiConfig.cs` | No dependency resolver; global CORS `*` | Add lightweight DI (`IDependencyResolver`); keep route config |
| `Global.asax.cs` | Boilerplate | Trigger DB initializer / migrate dev DB when configured |
| Connection string | EDMX `metadata=res://…` form | Code-First provider connection string (new dev DB) |
| `Babysitter`/`Parent` password fields | SHA-256 primary; plaintext + BCrypt legacy verify | `PasswordHasher` (BCrypt-first + legacy upgrade) |

> **Key architectural principle for refactoring:** do **not** mix pure-structural changes (folder/namespace reorg) and functional changes (service extraction, hashing, state machine) in the same commit.

---

---

## 4. Dead / Duplicate Code

### 4.1 Dead or unused in API-C

| Item | Evidence | Action |
|---|---|---|
| `Bid` entity + `BidDTO` | `Bids` DbSet + `Bid-Babysitter`/`Bid-Job` relations exist; **no controller creates/accepts a bid**; `BidStatus` never assigned anywhere; bids only touched during sitter deactivation (soft-delete) | **Reuse** → implement bidding (`IBidService` + `BidsController`). Do not delete. |
| `JobDTO.Bids` / `BidDTO` | Defined in `DTOs/JobDTOs.cs`, never populated by any endpoint | Re-wire once bidding is added |
| `MatchingSitterDTO` | Small DTO; matching endpoints return `SitterDTO`/anonymous objects | Keep only if a consumer emerges, else drop |
| `JobSlotDto`, `UpdateChildDTO` | `UpdateChild` reads multipart form directly; `SaveAvailability` uses `AvailabilityDto`; some DTOs unconsumed | Clean up or wire up |
| JWT libs | `System.IdentityModel.Tokens.Jwt` 6.35.0 in `packages.config`, unused by code | Do **not** introduce JWT; optionally remove from packages later |
| `Model1.cs` + `….Entities1` conn string | Legacy leftover duplicate context/connection entry unused | Remove during Code-First phase |

### 4.2 Duplicate / overlapping logic

| Overlap | Detail | Resolution |
|---|---|---|
| `ParentController` vs `ChildrenController` | Both `RoutePrefix("api/parent")`; both expose `child/{childId}` (different verbs); child ownership + multipart read duplicated | Consolidate under one `IChildService` |
| `ComputeSha256Hash` | Private copy in both `ParentController` and `BabySitterController` | Single `PasswordHasher` |
| Login logic | `parent/login` + `babysitter/login` each implement SHA-256 + fallback + token issue | Single `IAuthService.Login(role)`; keep two thin routes |
| Availability lookup | Date/`Slot_ID` join repeated in `matches`, `search-sitters`, `jobrequests` (N+1 risk) | `IAvailabilityService.IsAvailable` helper |
| Conflict check | `HasConflictingJobs` lives in `MatchingController`, not reusable by `confirm` | Move to `IAvailabilityService`/`IMatchingService` |
| Status mutation | `UpdateJobStatus` and deactivation cascade both set `Job.Status` directly | Single `IJobService.TransitionStatus` state machine + `IAccountService` cascade |

### 4.3 Dead code in API-A/B (do not port)

- Large commented-out register/login/search/hire blocks in `AuthController`; plain-text login; the single-table `Schedule` with `day_of_week`+`time_slot` string. **Rejected** except the recurring-availability concept (§5).

---

## 5. API-A/B Features Worth Porting (into API-C)

| Feature (source) | Why it is missing/useful in API-C | Re-implement cleanly as |
|---|---|---|
| **Recurring weekly availability** (API-A `Schedule.day_of_week`; API-B `Schedule` with `TimeSpan` start/end) | API-C supports only date-specific `SitterAvailability(AvailableDate)`; no recurring model. `SearchSittersDTO.AvailabilityType`/`SelectedDays` already hint the frontend expects it | New `RecurringAvailability(Sitter_ID, DayOfWeek, StartTime, EndTime, City, IsDeleted)` + `IAvailabilityService.SaveRecurring`; matching unions date-specific + recurring (date-specific wins on overlap) |
| **Per-sitter default `City`** (API-A/B store `city` on `Babysitter`) | API-C keeps city only per availability row; no canonical service area on the sitter | Add nullable `Babysitter.City` default; keep per-availability `City` override |
| **TimeSpan-based slots** (API-B) | Validates time-overlap matching rather than slot-ID equivalence | Use `TimeSlot` IDs for date-specific availability/jobs; TimeSpan ranges for recurring |

### Explicitly rejected from API-A/B

- Plain-text auth, `api/Auth` god controller routes, `Hire`, `Rating`, the single-table `Schedule`, and all commented dead code.

---

---

## 6. Features Explicitly Rejected (Out of Scope)

| Rejected item | Reason |
|---|---|
| **Admin module** (entity/controller/role/dashboard) | Explicitly out of scope for the FYP domain |
| **JWT** | Opaque DB-backed session tokens are already frontend-compatible and revocable |
| **ASP.NET Core / .NET 8/10** | Preserve the existing stack |
| **EF Core** | Must stay on EF6 |
| **Node.js / microservices** | Not warranted for FYP scope |
| **NoSQL / Redis session store** | Keep the session table in EF6 |
| **CQRS / MediatR / event sourcing** | Unnecessary enterprise architecture |
| **Repository / Unit-of-Work abstraction** | EF6 DbContext already provides UoW; adds needless abstraction |
| **WebRTC / AI cry-detection / camera / mic / video streaming** | Monitoring app is a future, separate application; only the alert-ingestion boundary is kept |
| **Entity-DTO leakage** | Never expose `Password` or `IsDeleted` in responses |

---

## 7. Frontend Compatibility Risks

### 7.1 The frontend is not in this workspace

**[FACT]** No React/RN/Flutter/frontend project exists in the workspace (no `package.json`, `.jsx/.tsx`, `src/`). The contract below is inferred **only** from API-C controllers/DTOs and in-repo docs, and **must** be validated against the real frontend before Phase-17 integration.

### 7.2 Contracts that must be preserved

| Contract | Requirement | Risk if changed |
|---|---|---|
| Auth transport | `Authorization: Bearer {token}`; login returns `{token, expiresAt, userId, name, role}` | Login/state hydration breaks |
| Job status strings | `Open, Assigned, In Progress, Completed, Cancelled` as **strings** | Frontend enum display breaks |
| Role strings | `Parent`, `Sitter` | sessions + RBAC break |
| Create/update child | multipart form fields (`ChildName`, `DOB`, `Gender`, `SpecialRequirements`, `Guardian*`, `UseDefaultPicture`) | Multipart contract must not be re-keyed |
| Registration | multipart fields (`FullName`, `EmailAddress`, `Username`, `Password`, `PhoneNumber`, …) + default pictures | Keep form field names |
| Image URLs | `PictureAddress` stored as `Parents/…`; served via `api/images/{type}/{filename}` and `api/images/default/…` | `<img src>` breaks |
| Session aliases | `updateStatus/{id}`, `start-session/{id}`, `start/{id}` keep working; all delegate to one state machine | Additive fields only |
| Response key mix | Both camelCase and PascalCase aliases the API emits (e.g. `Job_ID` + `jobId`) remain | Additive fields only |
| Job creation | `POST api/parent/create-job` with `SitterId` (couples job to a sitter) | If an sitter-agnostic path is added, keep this route compatible (additive/optional `SitterId`) |

### 7.3 Rules to reduce risk

1. **Additive-first** — add new optional fields (e.g. `sessionStartedAt`, bid data) without renaming/removing existing ones.
2. **No route/verb/status-string changes** and **no integer-enum** serialization.
3. **Keep the anonymous-object key mix** exactly as-is.
4. Produce **`FRONTEND_API_COMPATIBILITY.md`** once the real frontend is available (Phase 17).

---

---

## 8. Database Migration Risks

| Risk | Detail | Mitigation |
|---|---|---|
| **EDMX → Code First switch** | Current `metadata=res://*` connection + `Model1.edmx`; switching changes the connection string and removes the model artifacts | Use a dev-only Code-First DB; do **not** touch the existing production DB; delete EDMX only after the new DB validates |
| **FK/table-name drift** | EDMX keeps legacy names; Code First may infer different ones | Explicitly set `ToTable(...)`, PK, and FK names in `EntityTypeConfiguration<T>`; review generated migration `Up()` |
| **Unique indexes on existing data** | If `Parent.EmailAddress`(etc.) already holds duplicates, `IsUnique` migration fails at `Update-Database` | For a **new** DB, indexes are created on empty tables (safe). For an existing DB, dedupe first. Recommend a fresh dev DB. |
| **Nullable/required drift** | API-C EDMX uses many `0..1 → *` (nullable FKs). Tightening to `1 → *` may reject inserted rows | Make required only where logic guarantees a value; test on dev data first |
| **Bid/Review uniqueness** | `(Job_ID, Sitter_ID)` and `(Job_ID, Reviewer_ID)` unique indexes need existing dupes removed | Add after cleanup; keep app-level guards as a backstop |
| **Session raw SQL** | `SessionAuthorizeAttribute`/logout use raw SQL against `UserSessions` | Keep the sanctioned Read/Delete queries; the Code-First map defines the table |
| **Legacy password hashes** | SHA-256/plaintext hashes must stay verifiable during the BCrypt transition | `PasswordHasher` detects scheme (`$2`→BCrypt, 44-char base64→SHA-256, else plaintext) and rehashes to BCrypt on success |
| **Environment coupling** | Targets a specific local SQLEXPRESS instance and DB; no `.sln` | Document the connection; parameterize by environment (`Web.config`/`Web.Release.config`) |

---

<!-- S9 -->
### 9. Exact Implementation Order (prioritized, dependency-respecting)

Implementation must proceed in small, build-verified, commit-atomic steps. Order below is chosen so each step only depends on already-stabilized pieces.

### 9.1 Safety & baseline (Phase 1, no logic change)

1. **Version control safety**
   - git status / git branch from WebApplication2 root.
   - Create and switch to pi-c-unification-remediation; tag the current stable baseline.
2. **Build/pack audit**
   - Run the project build; capture failures now as baseline issues.
   - Enumerate NuGet deps via packages.config (already captured: EF 6.1.1, BCrypt 1.6.0, etc.).
3. **Documentation baseline**
   - Copy existing `docs/api/*` into this baseline tag so any future contract change is diffable.
4. **Freeze decisions into ARCHITECTURE_FREEZE.md** (derived from the Unified Blueprint + this audit).
   - Keep the short whitelist of non-negotiables: .NET 4.7.2, Web API 2, EF6, SQL Server, Code First + Migrations, opaque session tokens, BCrypt-first, no JWT, no admin module, no Core migration.

### 9.2 Structure & code hygiene (Phase 2-3, behavior-preserving)

5. **Folder normalization**
   - Establish canonical top-level folders: `Controllers/`, `DTOs/`, `Models/`, `Enums/`, `Data/`, `Data/Configurations/`, `Services/`, `Services/Interfaces/`, `Services/Implementations/`, `Infrastructure/`, `Migrations/`, `App_Start/`.
   - Move existing files into these folders in small batches; fix namespaces and using directives; **verify build after each batch**.
   - Do **not** mix behavioral changes with structural moves.
6. **Enum introduction (no JSON contract breakage)**
   - Add `JobStatus`, `BidStatus`, `UserRole`, `NotificationType`, `AvailabilityType` under `Enums/`.
   - Centralize string conversions; ensure outgoing serialization still produces the same strings the frontend expects (not integers).
   - Keep existing magic-string literals only where the contract demands them until the controller/service layer is extracted.
7. **Dead/duplicate cleanup**
   - Remove the unused `SetAvailabiltyModel`/`SlotModel`/`AvailabilitySlot`/`Schedule` leftovers only if they are confirmed dead in API-C (do not remove any DTO/route still hit by a controller).
   - Consolidate duplicate DTOs by **mapping to existing DTO names** where the frontend depends on them (additive only).

### 9.3 Service layer extraction (Phase 4, the core architectural lift)

Extract in this order, one service at a time:

8. **`IAuthService` / `AuthService`**
   - Purpose: login, register, logout, current-user resolution, session validation, soft-deleted-account rejection.
   - Depends on: `UnifiedDbContext`, `PasswordHasher`.
   - Used by: `AuthController`.
9. **`IAccountService` / `AccountService`**
   - Purpose: parent/babysitter profile read/update, curated deactivation cascade (revoke sessions, soft-delete related children/availability, handle active assignments).
   - Depends on: auth identity resolution, `IJobService` for cancelling active jobs where required.
   - Used by: `ParentController`, `BabySitterController`, `AuthController`.
10. **`IChildService` / `ChildService`**
    - Purpose: child CRUD, ownership/IDOR checks, soft delete.
    - Depends on: `UnifiedDbContext`.
    - Used by: `ChildrenController`.
11. **`IAvailabilityService` / `AvailabilityService`**
    - Purpose: date-specific availability + new recurring availability; **one authoritative `IsSitterAvailable(...)`** used everywhere (matching, assignment pre-checks).
    - Depends on: `UnifiedDbContext`.
    - Used by: `BabySitterController`, `IMatchingService`, `IJobService`.
12. **`IMatchingService` / `MatchingService`**
    - Purpose: `GetMatches`, `SearchSitters`, `FilterSitters`, `GetJobRequests`, `IsSitterAvailable`, availability conflict checking.
    - Depends on: `IAvailabilityService`, `IJobService`.
    - Used by: `MatchingController`.
13. **`IJobService` / `JobService`**
    - Purpose: job CRUD, centralized `TransitionStatus(...)` state machine, `start-session`/`end-session` timestamps, assignment from accepted bid, soft delete.
    - Depends on: `IMatchingService`, `IBidService`, `INotificationService`.
    - Used by: `JobsController` and any route that changes job state (existing `updateStatus`, `start-session`, `start` routes funnel through here).

**Rule:** only one service is extracted per commit-window until the build + smoke test passes.

### 9.4 Authentication security upgrade (Phase 5)

14. **`PasswordHasher` implementation**
    - Detect scheme:
      - starts with `$2` → BCrypt.
      - 44-char base64 (legacy SHA-256) → verify SHA-256 → rehash to BCrypt on success.
      - otherwise → treat as plaintext → verify → rehash to BCrypt on success.
    - All successful legacy logins migrate the stored password to BCrypt; existing accounts stay usable.
    - Keep session-token architecture unchanged (UserSession, opaque tokens, SessionAuthorizeAttribute) — only the password path improves.

### 9.5 Data layer modernization (Phase 6, dev-only, never production DB)

15. **Code First `UnifiedDbContext` + Fluent configurations**
    - Map every entity to its table explicitly via `ToTable(...)`.
    - Set PKs, FKs, required/nullable, cascade behavior, unique constraints, and indexes in `Data/Configurations/*Configuration.cs`.
    - Keep the table/column names compatible with the existing EDMX schema where the frontend / existing logic expects them; only rename after verifying no contract breakage.
16. **Initial migration + indexes/constraints**
    - Generate the initial migration against a **fresh dev database**; review `Up()`/`Down()`.
    - Add unique indexes (Parent Email, Parent Username, Sitter Email, Sitter Username, JobTimeSlot (Job_ID, Slot_ID), Bid (Job_ID, Sitter_ID), Review (Job_ID, Reviewer_ID)).
    - Add performance indexes (Jobs: Status+JobDate, City+Status, Parent_ID, AssignedSitter_ID; Availability: Sitter_ID+AvailableDate, AvailableDate; RecurringAvailability: Sitter_ID+DayOfWeek; Bid: Job_ID, Sitter_ID; Notifications/UserSessions: UserId+Role).
    - **Do not** migrate the existing production database; EDMX is removed only after the new DB validates.
17. **Swap DbContext usage from EDMX object context to Code First**
    - Point `UnifiedDbContext` to the dev DB first; verify all service/controller reads/writes still work.
    - Keep legacy EDMX artifacts until this validated; then remove `Model1.edmx` and the `metadata=res://*` connection path.


### 9.6 Availability unification (Phase 7)

18. **Date-specific availability** (SitterAvailability) —” already present in API-C; keep the table/column names unless contract breakage is found.
19. **New recurring availability** entity:
    - RecurringAvailability: ID, Sitter_ID, DayOfWeek (enum/int), StartTime, EndTime, IsActive, IsDeleted, timestamps.
    - One row per (Sitter, DayOfWeek) representing the weekly recurring block; scope to city/location if the frontend requires per-city recurrence (defer if unnecessary for scope).
20. **Unified query**
    - IAvailabilityService.IsSitterAvailable(sitterId, date, startTime, endTime, city) resolves:
      - the date-specific slots for that exact date/city;
      - the recurring weekly slot for that day-of-week, narrowed to the same city where applicable;
      - overlap with existing confirmed jobs / assigned sessions.
21. **Conflict rules**
    - A babysitter cannot have overlapping availability windows.
    - A babysitter cannot be assigned to a job that overlaps confirmed availability gaps or existing sessions.
    - Availability edits never retroactively change already-booked jobs â€” they only affect future matching/assignment checks.

### 9.7 Job state machine (Phase 8)

22. **Centralized transition method**
    - IJobService.TransitionStatus(jobId, newStatus, actor) is the **only** path that moves a job between states; the legacy routes (updateStatus, start-session, start) all delegate into it.
23. **Allowed transitions**
    - Open -> Assigned (triggered by accepting the winning bid, or by direct assignment where supported).
    - Assigned -> In Progress -> backend sets SessionStartedAt = DateTime.UtcNow.
    - In Progress -> Completed -> backend sets SessionEndedAt = DateTime.UtcNow and derives DurationMinutes.
    - Open -> Cancelled, Assigned -> Cancelled, In Progress -> Cancelled are permitted with business rules (who may cancel, refund/notice logic if applicable).
24. **Rejected transitions**
    - No transition out of Completed or Cancelled.
    - No jump Open -> Completed, Open -> In Progress, Assigned -> Completed without passing through the intermediate states.
    - Reject via a typed result/exception so controllers return a clear error instead of silent failure.
25. **Status strings stay frontend-compatible**
    - The stored/returned strings remain the exact values the frontend already knows; C# JobStatus enum is internal convenience, not a JSON breaking change.

### 9.8 Session timing + bidding + reviews + notifications + cry/image (Phases 9-14)

26. **Session timing (Phase 9)** â€” fields SessionStartedAt, SessionEndedAt, DurationMinutes added to Job (no separate session table). Backend sets them during Assigned -> In Progress and In Progress -> Completed. Earnings logic prefers actual duration when present, falling back to scheduled slot duration otherwise; existing session routes stay wire-compatible.
27. **Bidding (Phase 10)**
    - New BidsController + IBidService/BidService.
    - Rules: one bid per (Job, Sitter) enforced by the DB unique index; at most one accepted bid per job; accepting a bid may transition the job to Assigned.
    - Endpoints to implement: place bid, accept bid, reject bid, withdraw bid, list bids for a job, list bids by a sitter.
28. **Reviews (Phase 11)**
    - Move review logic into IReviewService/ReviewService.
    - Participation validation: only actual job participants can review.
    - DB unique constraint (Job_ID, Reviewer_ID) prevents duplicate reviews.
    - Compute and expose aggregated sitter/parent ratings where required by the frontend.
29. **Notifications (Phase 12)**
    - Centralize into INotificationService/NotificationService.
    - Wire notification creation to events: job assignment, bid accepted/rejected, cancellation, review, cry alert.
    - Avoid controllers creating Notification rows ad hoc.
30. **Cry alert boundary (Phase 13)**
    - Refactor existing ingestion into ICryAlertService/CryAlertService only.
    - Keep CryAlert storage + latest-alert query; generate Jitsi-compatible room names if that contract is used by a future monitoring client.
    - Do **not** introduce WebRTC/AI/camera/microphone/video streaming in this backend; keep the boundary ready for a separate monitoring application.
31. **Image service (Phase 14)**
    - Extract into IImageService/ImageService.
    - Preserve existing routes (pi/images/{type}/{filename}, pi/images/default/{type}/{filename}) and PictureAddress format.
    - Add path-traversal protection, folder whitelist (Parents/Sitters/Children), and default fallback images.

### 9.9 Testing, frontend validation, and wrap-up (Phases 15-17)

32. **Testing (Phase 15/16)**
    - Priority unit/integration targets:
      - PasswordHasher: BCrypt, SHA-256 legacy, plaintext legacy, rehash-on-success.
      - Job state machine: valid and invalid transitions, terminal states, session-timing side effects.
      - Availability: date vs recurring resolution, overlap rules, booked-job conflicts.
      - Bids: duplicate bid rejection, single accepted bid rule, withdraw/reject semantics.
      - Reviews: duplicate review rejection, non-participant rejection.
      - Auth: expired/revoked sessions, soft-deleted account rejection, role resolution.
    - Keep tests lightweight; do not require the full production DB â€” use a test database or in-memory-backed EF6 context only where EF6 has reasonable support, otherwise a dedicated test DB.
33. **Frontend contract validation (Phase 17)**
    - Once the real frontend(s) are available, map every call: endpoint, HTTP method, request body, query params, response shape, auth header, status strings, image URL format.
    - Produce FRONTEND_API_COMPATIBILITY.md and classify each as compatible / needs alias / additive field / breaking change.
    - Apply additive changes first; avoid renaming/deleting existing fields or paths until the frontend is updated in lockstep.
34. **Clean-up after stabilization**
    - Remove legacy EDMX artifacts, dead reference models, and unused DTO copies after the new pathways are confirmed.
    - Update ARCHITECTURE_FREEZE.md and this audit to reflect the final, implemented architecture so the team has a single source of truth.
