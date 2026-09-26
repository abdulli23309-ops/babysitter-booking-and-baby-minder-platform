# PHASE C REPORT — SECURITY, AUTHORIZATION & CONTRACT VERIFICATION

> **Branch:** remediation  
> **Baseline tag:** fyp-baseline-pre-remediation (untouched)  
> **Date:** 2026-09-02  
> **Scope:** C1–C7 (Security, Authorization, Contract Verification, Frontend Sync)  
> **Method:** Full static inspection of all controllers, models, DTOs, config. No code modified in this phase.

---

## 1. Phase Objective

Perform a complete security, authorization, and API-contract audit of the Babysitter Booking & Baby Minder backend, and deliver authoritative documentation to the React frontend team — **without modifying the technology stack, database schema, or introducing speculative architecture.**

---

## 2. Preflight Findings

See `PHASE_C_PREFLIGHT.md` for the complete read-only audit. Summary:

| Area | Status |
|------|--------|
| Authentication (C1) | **None** — login returns user data only, no token/cookie/session |
| Password Security (C2) | **Plain text** — stored and compared as raw strings |
| Authorization/IDOR (C3) | **None** — 16 endpoints with no ownership validation |
| CORS (C4) | **Fully open** (`*`, `*`, `*`) — safe only while API is open |
| Cry Alert (C5) | **Functional** — `CreatedAt` ordering preserved from Phase B |
| Connection Strings (C6) | **One active, one dead** — `...Entities1` is unreferenced legacy config |
| Frontend Contract (C7) | **Documented** — 30 endpoints across 9 controllers |

---

## 3. Authentication Findings (C1)

### AUTH-001 — POST Parent login returns
**Route:** `POST api/parent/login`  
**Request body:** `LoginDTO` `{ Username, Password, Role }`  
**Response JSON (200):**
```json
{
  "message": "Login Successful",
  "userId": 1,
  "name": "Parent FullName",
  "role": "Parent",
  "address": "Parent Address",
  "pictureAddress": "filename.jpg"
}
```
**Code:** `Controllers/ParentController.cs` → `LoginParent(LoginDTO login)`  
- Rejects if `login.Role != "Parent"` → `BadRequest("Invalid role for this endpoint")`
- Lookup: `db.Parents.FirstOrDefault(x => x.Username == login.Username)`
- **Password check:** `parent.Password != login.Password` → plain-text comparison
- Failure: `Content(HttpStatusCode.Unauthorized, "User not found")` or `"Wrong password"`

### AUTH-002 — POST Babysitter login returns
**Route:** `POST api/babysitter/login`  
**Request body:** `LoginDTO` `{ Username, Password, Role }`  
**Response JSON (200):**
```json
{
  "message": "Login Successful",
  "userId": 1,
  "name": "Sitter FullName",

---

## 4. Password Security Findings (C2)

| Aspect | Finding |
|--------|---------|
| Storage | **Plain text** — `Parent.Password` and `Babysitter.Password` are `string` properties, stored as-is |
| Registration | `ParentController.RegisterParent` and `BabysitterController.RegisterBabysitter` store the password directly from form/JSON with **no hashing** |
| Comparison | **Equality operator** (`!=`) — plain string comparison |
| Salt | **None** |
| Algorithm | **None** |

**Models:** `Models/Parent.cs`, `Models/Babysitter.cs` — `public string Password { get; set; }`

**Risk:** Critical. Full credential exposure on any database breach.

**Migration blocker:** Hashing existing passwords requires a one-time data migration or a lazy rehash strategy. Cannot silently overwrite plain-text hashes without locking out existing users or requiring a forced reset.

---

## 5. Authorization/IDOR Findings (C3)

**Trust model:** The backend has **no authenticated principal**. Any caller can assert any `ParentId` / `SitterId` / `ChildId` in URL or body.

| Controller | Endpoint | Resource ID | Ownership Check | Risk | Finding |
|------------|----------|-------------|-----------------|------|---------|
| ParentController | POST create-job | ParentId, ChildId (body) | **None** — trusts body | CRITICAL | Any caller can create a job as any parent/child |
| ParentController | GET jobs/{parentId} | parentId (URL) | **None** | HIGH | Any caller can read any parent's jobs |
| ParentController | GET children/{parentId} | parentId (URL) | **None** | HIGH | Any caller can read any parent's children |
| ChildrenController | PUT child/{childId} | childId (URL) | **None** | HIGH | Any caller can modify any child |
| BabysitterController | GET earnings/{sitterId} | sitterId (URL) | **None** | HIGH | Any caller can read any sitter's earnings |
| NotificationsController | GET (userId param) | userId (query) | **None** | HIGH | Any caller can read any user's notifications |
| NotificationsController | PUT {id}/read | id (URL) | **None** | HIGH | Any caller can mark any notification read |
| NotificationsController | DELETE clear | userId (query) | **None** | HIGH | Any caller can clear any user's notifications |
| CryDetectionController | POST (body) | ParentId (body) | **None** | HIGH | Any caller can post an alert as any parent |
| CryDetectionController | GET latest | parentId (query) | **None** | HIGH | Any caller can read any parent's latest alert |
| ReviewController | POST add | Reviewer_ID, ReviewFor_ID (body) | **None** | HIGH | Any caller can post a review as/for anyone |
| ReviewController | GET user/{userId}/{role} | userId (URL) | **None** | MEDIUM | Any caller can read any user's reviews |
| MatchingController | POST availability/save | SitterId (body) | **None** | HIGH | Any caller can set any sitter's availability |
| MatchingController | DELETE availability/clear/{sitterId} | sitterId (URL) | **None** | HIGH | Any caller can clear any sitter's availability |
| JobsController | POST confirm/{jobId}/{sitterId} | jobId, sitterId (URL) | **None** | CRITICAL | Any caller can confirm any job as any sitter |
| JobsController | POST updateStatus/{jobId} | jobId (URL) | **None** | HIGH | Any caller can update any job's status |

**Architectural blocker:** Ownership cannot be enforced without a trustworthy authenticated principal. **Dependency: C1 (authentication).**

  "role": "Sitter"
}
```
**Code:** `Controllers/BabysitterController.cs` → `LoginBabysitter(LoginDTO login)`  
- Rejects if `login.Role != "Sitter"` → `BadRequest("Invalid role for this endpoint")`
- Lookup: `db.Babysitters.FirstOrDefault(s => s.Username == login.Username)`
- **Password check:** `sitter.Password != login.Password` → plain-text comparison

### AUTH-003 — Credential type
**None.** The backend does NOT generate JWT, bearer token, session cookie, or forms-auth cookie. Login returns **user data only** (userId, name, role, address, pictureAddress). No `Set-Cookie` header. No token stored server-side.

### AUTH-004 — Authentication validation on protected endpoints
**None.** No `[Authorize]` attribute anywhere. No custom authorization filters. No OWIN/ASP.NET middleware validating tokens or sessions. `Global.asax.cs` has no auth startup. All endpoints are publicly accessible.

### AUTH-005 — Authoritative role strings
- `"Parent"` — used in ParentController login check and returned in response
- `"Sitter"` — used in BabysitterController login check and returned in response
- Review roles (separate from auth): `"Parent"` and `"Sitter"` stored in `ReviewerRole`/`ReviewForRole`

### AUTH-006 — Logout
**None.** No logout endpoint exists. Since no credential is issued, there is nothing to invalidate.

---

## 6. CORS Findings (C4)

**Current state — fully open:**
- **Global:** `WebApiConfig.cs` → `new EnableCorsAttribute("*", "*", "*")` + `config.EnableCors(cors)`
- **Per-controller:** `[EnableCors(origins: "*", headers: "*", methods: "*")]` on every controller

| Aspect | Value |
|--------|-------|
| Origins | `*` (any) |
| Headers | `*` (any) |
| Methods | `*` (any) |
| Credentials | Not explicitly allowed (`SupportsCredentials` not set) |
| Production-safe | **No** — open CORS is acceptable only while the API is fully open (no auth) |

**Frontend compatibility:** React/Vite dev server uses relative `/api/...` routes with a dev proxy. Current CORS `*` supports this. If credentials (cookies/auth headers) are added later, `*` origin will be rejected by browsers — CORS must be tightened then.

---

## 7. Cry Alert Findings (C5)

**Entity (`Models/CryAlert.cs`):** Both fields exist:
- `Timestamp` (DateTime?) — set by client in the DTO
- `CreatedAt` (DateTime) — database default (`getdate()` per model annotation)

**Current behavior (preserved from Phase B):**
- `POST api/cry-detection` — inserts using `Timestamp`, `Level`, `RoomName`, `JobId`, `ParentId`, `BabysitterId` from DTO. `CreatedAt` is DB-generated.
- `GET api/cry-detection/latest` — orders by **`CreatedAt DESC`** and takes first

**Semantic question for product decision:** "Latest" is currently ordered by server-generated `CreatedAt` (insert time), not client-supplied `Timestamp` (event time). If a batch import or delayed upload occurs, these diverge. **Flagged — requires product decision on authoritative ordering.**

---

## 8. Connection String Findings (C6)

**`Web.config` contains two connection strings:**

| Name | Entity path | Referenced in code | Status |
|------|-------------|-------------------|--------|
| `BabySitterBooking_and_BabyMinderEntities` | `Models.Model1.csdl\|...` | **Yes** — `DbContext` constructor `name=BabySitterBooking_and_BabyMinderEntities` | **ACTIVE** |
| `BabySitterBooking_and_BabyMinderEntities1` | `Model1.csdl\|...` (no `Models.` prefix) | **No** — not referenced anywhere | **UNUSED / LEGACY** |

**Evidence:** `ConfigurationManager` is not used anywhere (search returned 0 results). All controllers use `new BabySitterBooking_and_BabyMinderEntities()`. The second connection string is dead config. Recommend removal (C6 implementation).


---

## 9. Code Changes Made

**None.** Phase C was a read-only audit and documentation phase. No source code was modified.

---

## 10. Files Modified

**None.**

---

## 11. Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `PHASE_C_PREFLIGHT.md` | Complete read-only audit findings (C1–C7) | 178 |
| `BACKEND_FRONTEND_CONTRACT.md` | Authoritative API contract for React frontend team | 264 |
| `BACKEND_ANSWERS_FOR_FRONTEND.md` | Direct answers to 10 frontend questions (BE-Q-001 to BE-Q-010) | 203 |
| `PHASE_C_REPORT.md` | This report | — |

---

## 12. API Contract Changes

**None.** No API contracts were changed. This phase documented existing behavior only.

**Explicit statement:** The frontend contracts documented here reflect **actual backend behavior**, not intended behavior. No endpoints were added, removed, or modified.

---

## 13. Backend Answers for Frontend (C7 Summary)

See `BACKEND_ANSWERS_FOR_FRONTEND.md` for full details.

| Question | Answer |
|----------|--------|
| BE-Q-001: Parent login returns? | **Only user data** — no JWT/token/cookie/session |
| BE-Q-002: Babysitter login returns? | **Only user data** — no JWT/token/cookie/session |
| BE-Q-003: Authoritative role strings? | `"Parent"` and `"Sitter"` (exact casing) |
| BE-Q-004: Parent Dashboard summary APIs? | **MISSING** — no single endpoint; frontend must aggregate from `GET api/parent/jobs/{parentId}` |
| BE-Q-005: Babysitter Dashboard summary APIs? | **MISSING** — no single endpoint; frontend must aggregate from `GET api/jobs/sitter/{sitterId}` |
| BE-Q-006: Babysitter search/matching API? | `POST api/matching/filter-sitters` — filters by City, Date, Slots |
| BE-Q-007: Cry detection POST endpoint? | **Yes** — `POST api/cry-detection` (Level required) |
| BE-Q-008: Availability DTO fields? | `AvailabilityDto`: `SitterId`, `Date`, `SlotIds`, `City` (PascalCase) |
| BE-Q-009: Profile/static images served? | **Static files from disk** — `/Images/Parents/{filename}` (relative) |
| BE-Q-010: Logout mechanism? | **No** — logout is purely client-side (clear stored user data) |


---

## 14. Build Verification

```
dotnet build WebApplication2.csproj -c Debug --nologo
```
**Result:**
```
    1 Warning(s)
    0 Error(s)

Time Elapsed 00:00:03.32
```
- **0 errors** — build is green
- **1 warning** — MSB3277 (pre-existing System.Net.Http version conflict from SDK-style reference scheme, introduced in A1, benign)

---

## 15. Remaining Risks

| Risk | Severity | Dependency |
|------|----------|------------|
| No authentication — all endpoints public | Critical | C1 decision |
| Plain-text password storage | Critical | C2 decision |
| No IDOR/ownership validation | Critical | C1 → C3 |
| Fully open CORS | Medium (while API is open) | C4 decision (when auth added) |
| CryAlert `CreatedAt` vs `Timestamp` ordering ambiguity | Low | C5 decision |
| Dead connection string in Web.config | Low | C6 (safe to remove) |

---

## 16. Blocked Decisions

| # | Topic | Why blocked | Options |
|---|-------|-------------|---------|
| C1 | Authentication scheme | Adding auth changes every API response; frontend must be updated | (a) Keep open for FYP demo (b) JWT bearer tokens (no DB schema change) (c) ASP.NET Identity 2.x |
| C2 | Password migration | Hashing existing rows requires user-data migration | (a) No change (b) Hash new registrations only (c) Lazy rehash on login |
| C3 | IDOR protection | Requires authenticated principal to know the real caller | Blocked on C1 |
| C4 | CORS tightening | Safe to keep `*` while API is open; must tighten when auth added | (a) Keep `*` for demo (b) Restrict to frontend origin |
| C5 | CryAlert ordering | Behavior change — need to confirm intended contract | (a) Keep `CreatedAt` (b) Switch to `Timestamp` |

---

## 17. Deferred Work

| Item | Reason |
|------|--------|
| C6 — Remove unused connection string | Safe but deferred; not a security risk, just config hygiene |
| Dashboard summary APIs (Parent/Babysitter) | Not to be built without explicit approval (C7 is verification only) |
| Repository/Service layer | Explicitly out of scope per directive |
| JWT/authentication implementation | Deferred pending C1 decision |
| Password hashing implementation | Deferred pending C2 decision |
| IDOR fixes | Deferred pending C1 → C3 |

---

## Git State

```
Branch:      remediation  (up to date with origin/remediation)
Baseline tag:  fyp-baseline-pre-remediation  (present, untouched)
main / origin/main:  untouched (commit 5cf40d2)

Working tree:
  M Controllers/CryDetectionController.cs   (Phase B)
  M Controllers/MatchingController.cs        (Phase B)
  M Controllers/NotificationsController.cs   (Phase B)
  M Controllers/ReviewController.cs          (Phase B)
  M DTOs/JobDTOs.cs                          (Phase B)
  M WebApplication2.csproj                   (Phase A1)
  ?? BACKEND_ANSWERS_FOR_FRONTEND.md         (Phase C — new)
  ?? BACKEND_FRONTEND_CONTRACT.md            (Phase C — new)
  ?? PHASE_C_PREFLIGHT.md                    (Phase C — new)
  ?? PHASE_C_REPORT.md                       (Phase C — new)
  ?? WebApplication2.csproj.bak              (untracked rollback backup)
```

**No commits made.** Awaiting explicit instruction before committing.

---

## Success Criteria

| Criterion | Status |
|-----------|--------|
| Backend authentication truth is known | ✅ Documented (none exists) |
| Password security status is known | ✅ Documented (plain text) |
| IDOR exposure is mapped | ✅ 16 endpoints documented |
| CORS behavior is understood | ✅ Fully open `*` |
| Cry alert behavior is verified | ✅ `CreatedAt` ordering preserved |
| Connection strings are reconciled | ✅ One active, one dead |
| Frontend receives authoritative API contracts | ✅ 3 documents delivered |
| Build succeeds | ✅ 0 errors |
| No speculative architecture introduced | ✅ None |
| No database changes occur without approval | ✅ None |

---

**Phase C complete. Stopped as required. Awaiting further instructions.**

