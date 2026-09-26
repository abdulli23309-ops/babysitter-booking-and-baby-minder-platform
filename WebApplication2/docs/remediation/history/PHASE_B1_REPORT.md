# PHASE B1 REPORT — Backend Forensic Discovery & Contract Verification

> **Date:** 2026-09-02  
> **Branch:** remediation  
> **Baseline tag:** fyp-baseline-pre-remediation  
> **Scope:** Complete backend forensic discovery, API contract verification, security audit, data integrity audit, code quality audit.

---

## 1. Objective

Phase B1 is a **purely forensic discovery and contract verification** phase. The goal is to establish the authoritative truth about the backend API before any architectural or security changes are made.

The frontend team (React 19, separate repository) has completed F0/F1 stabilization and needs authoritative backend answers. This phase inspects the actual backend source code and documents findings without modifying controllers, models, or contracts.

---

## 2. Backend Architecture

### Technology Stack (verified)
| Component | Version | Evidence |
|-----------|---------|----------|
| .NET Framework | 4.7.2 | `WebApplication2.csproj` → `<TargetFramework>net472</TargetFramework>` |
| ASP.NET Web API | 5.3.0 | `packages.config`, `WebApiConfig.cs` |
| Entity Framework | 6.5.1 (Database-First EDMX) | `Models/Model1.edmx`, `Model1.Context.cs` |
| SQL Server | — | `System.Data.SqlClient` |
| JSON | Newtonsoft.Json 13.0.3 | `packages.config` |
| API Docs | Swashbuckle 5.6.0 | `App_Start/SwaggerConfig.cs` |

### Architecture Pattern
- **Flat:** Controllers → EF6 DbContext (no Repository/Service layers)
- **DI:** None — every controller does `new BabySitterBooking_and_BabyMinderEntities()`
- **Authentication:** None
- **Authorization:** None

### Repository Structure
```
WebApplication2/
├── App_Start/          (WebApiConfig, SwaggerConfig)
├── Controllers/        (9 controllers)
├── DTOs/               (BabySitterDTOs, ParentDTOs, JobDTOs, ReviewDTO, CryAlertDto, NotificationDto, AvailabilityDto, BulkConfirmDto)
├── Images/             (Parents/, Sitters/ — uploaded files)
├── Models/             (EF entities + EDMX + T4 templates)
├── Properties/         (AssemblyInfo)
├── Global.asax.cs
├── Web.config          (connection strings, appSettings)
└── WebApplication2.csproj
```

---

## 3. API Inventory

### Complete Endpoint List

| Controller | Route Prefix | Endpoints |
|------------|--------------|-----------|
| ParentController | api/parent | register, login, profile/{id}, children/{parentId}, create-job, jobs/{parentId} |
| BabysitterController | api/babysitter | register, login, profile/{id}, earnings/{sitterId} |
| ChildrenController | api/children | get/{parentId}, child/{id}, update/{id}, delete/{id} |
| JobsController | api/jobs | sitter/{id}, {id}, confirm/{jobId}/{sitterId}, updateStatus/{id}, bid, acceptBid/{bidId} |
| ReviewController | api/reviews | add, user/{userId}/{role}, job/{jobId} |
| NotificationsController | api/notifications | GET (query), POST, {id}/read, clear |
| CryDetectionController | api/cry-detection | POST, latest |
| MatchingController | api/matching | filter-sitters, babysitter/{id}, availability (GET/POST/DELETE), accept-job/{jobId}/{sitterId} |
| ImageController | api/images | parent/{id}, sitter/{id} |

---

## 4. Authentication Findings

- **Mechanism:** None. No JWT, no cookies, no Identity, no session.
- **Login returns:** User data only (userId, name, role, address, pictureAddress). No credential issued.
- **Validation:** No `[Authorize]` attributes. No auth middleware.
- **Roles:** `"Parent"` and `"Sitter"` are the authoritative strings.
- **Logout:** None (no credential to invalidate).

**Code evidence:**
- `ParentController.LoginParent`: returns `Ok(new { message, userId, name, role, address, pictureAddress })`
- `BabysitterController.LoginBabysitter`: returns `Ok(new { message, userId, name, role })`
- Password check: `parent.Password != login.Password` (plain-text)

---

## 5. Authorization Findings

- **No authorization enforcement.** All endpoints are publicly accessible.
- **IDOR risk:** 16 endpoints trust client-supplied IDs without ownership validation.
- **High-risk examples:**
  - `POST api/parent/create-job` — trusts `ParentId`/`ChildId` from request body
  - `GET api/parent/jobs/{parentId}` — trusts URL `parentId`
  - `POST api/jobs/confirm/{jobId}/{sitterId}` — trusts both IDs
- **Dependency:** Authorization cannot be enforced without authentication (AUTH-001).

---

## 6. Frontend Contract Answers (Summary)

| Question | Answer |

## 8. Data Integrity Findings

### Job State States
`Open` → `Confirmed` → `Completed` (and presumably `Cancelled`, not validated)

### State Transition Gaps
- No validation that `Completed` jobs cannot transition back.
- No check that only the owning parent can update a job.

### Booking Conflicts
- **No overlapping detection.** A sitter can be confirmed for two jobs with overlapping date/time slots. This is DATA-001.

### Entity Relationships
- Parent → Children (1:N)
- Parent → Jobs (1:N)
- Babysitter → Jobs (1:N, via AssignedSitter_ID)
- Job → JobTimeSlots (1:N) → TimeSlots (N:1)
- Babysitter → SitterAvailability (1:N)
- Job → Bids (1:N)
- Reviews are polymorphic via `ReviewerRole`/`ReviewForRole`

---

## 9. Code Quality Findings

| Area | Finding |
|------|---------|
| EF N+1 | `ReviewController.GetUserReviews` and `BabysitterController.GetEarnings` make per-row queries |
| Dead config | Duplicate connection string `...Entities1` |
| Redundant CORS | Global + per-controller attributes |
| Dynamic types | Previously in MatchingController (fixed in Phase B) |
| Validation | Minimal — only required-field checks in most controllers |

---

## 10. Build/Test Results

### Build
```
Command:    dotnet build WebApplication2.csproj -c Debug --nologo
Exit code:  0
Result:     Build succeeded. 1 Warning(s), 0 Error(s).
Warning:    MSB3277 — System.Net.Http version conflict (pre-existing, benign)
```

### Tests
- **No test project exists** in the repository.
- No unit/integration tests discovered.

---

## 11. Files Created

| Document | Purpose |
|----------|---------|
| `BACKEND_PREFLIGHT.md` | Repository structure, technology inventory, API route inventory |
| `BACKEND_API_CONTRACT.md` | Detailed contract for every frontend-consumed endpoint |
| `BACKEND_SECURITY_AUDIT.md` | Prioritized security risk register |
| `BACKEND_DATA_INTEGRITY_AUDIT.md` | Entity relationships, state transitions, booking conflict analysis |
| `BACKEND_CODE_QUALITY.md` | EF usage, error handling, DTO boundary analysis |
| `BACKEND_MASTER_BACKLOG.md` | Consolidated issue register with 24 issues (P0–P3) |
| `F1_BACKEND_ANSWERS.md` | Direct answers to 7 frontend F1 blocking questions |
| `PHASE_B1_REPORT.md` | This document — consolidated discovery report |

---

## 12. Recommended Next Phase

**Phase B2 (Remediation) should be gated behind product decisions on:**

1. **Authentication architecture** (C1) — JWT bearer vs. other. Blocks IDOR fixes and password hashing.
2. **Password migration strategy** (C2) — Lazy rehash vs. forced reset vs. no change.
3. **CORS policy for production** (C4) — Specific origins vs. wildcard.
4. **CryAlert ordering** (C5) — `CreatedAt` vs. `Timestamp` for "latest".

**Phase B2 implementation order (after decisions):**
1. Implement authentication (AUTH-001)
2. Implement password hashing with lazy rehash (AUTH-002)
3. Add ownership validation to all IDOR endpoints (AUTH-003)
4. Fix booking double-book conflict (DATA-001)
5. Tighten CORS (SEC-001)
6. Standardize error responses (API-001)
7. Fix N+1 queries (CODE-001, CODE-002)
8. Remove dead connection string (CODE-003)

**Do NOT begin Phase B2 without explicit approval.**

|----------|--------|
| Q1 Login response shape | Parent: `{ message, userId, name, role, address, pictureAddress }`. Babysitter: `{ message, userId, name, role }`. camelCase fields. |
| Q2 Role strings | `"Parent"` and `"Sitter"` (NOT "Babysitter") |
| Q3 Authentication | NONE — fully anonymous API |
| Q4 Authorization | NONE — no ownership validation |
| Q5 Login failure semantics | 401 plain string for invalid creds; 400 plain string for missing fields |
| Q6 Static images | `/Images/Parents/{filename}` and `/Images/Sitters/{filename}` (IIS static); ImageController API fallback |
| Q7 ID types | All `int` IDENTITY (safe for JS Number). CryAlert.Id is `Guid`. |

---

## 7. Security Findings

| Severity | Count | Examples |
|----------|-------|----------|
| P0 Critical | 3 | No auth, plain-text passwords, pervasive IDOR |
| P1 High | 5 | Open CORS, exception leakage, PII exposure, client-supplied role, booking conflicts |
| P2 Medium | 8 | Weak validation, N+1 queries, missing dashboard APIs, redundant CORS config |
| P3 Low | 3 | Dead connection string, redundant CORS, inconsistent media errors |

**Top risks:**
1. **Plain-text passwords** (AUTH-002) — immediate credential exposure
2. **No authentication** (AUTH-001) — blocks all other security
3. **IDOR on 16 endpoints** (AUTH-003) — data isolation impossible
4. **Booking double-book conflict** (DATA-001) — business logic gap
