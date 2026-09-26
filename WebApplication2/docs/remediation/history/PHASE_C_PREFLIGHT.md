# PHASE C PREFLIGHT — READ-ONLY AUDIT FINDINGS

> **Branch:** remediation  
> **Baseline tag:** fyp-baseline-pre-remediation (untouched)  
> **Audit date:** 2026-09-02  
> **Scope:** C1–C7 (Security, Authorization, Contract Verification)  
> **Method:** Full static inspection of all controllers, models, DTOs, config. No code modified in this preflight.

---

## 1. Authentication Findings (C1)

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

## 2. Password Security Findings (C2)

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

## 3. Authorization / IDOR Findings (C3)

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

---

## 4. CORS Findings (C4)

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

## 5. Cry Alert Findings (C5)

**Entity (`Models/CryAlert.cs`):** Both fields exist:
- `Timestamp` (DateTime?) — set by client in the DTO
- `CreatedAt` (DateTime) — database default (`getdate()` per model annotation)

**Current behavior (preserved from Phase B):**
- `POST api/cry-detection` — inserts using `Timestamp`, `Level`, `RoomName`, `JobId`, `ParentId`, `BabysitterId` from DTO. `CreatedAt` is DB-generated.
- `GET api/cry-detection/latest` — orders by **`CreatedAt DESC`** and takes first

**Semantic question for product decision:** "Latest" is currently ordered by server-generated `CreatedAt` (insert time), not client-supplied `Timestamp` (event time). If a batch import or delayed upload occurs, these diverge. **Flagged — requires product decision on authoritative ordering.**

---

## 6. Connection String Findings (C6)

**`Web.config` contains two connection strings:**

| Name | Entity path | Referenced in code | Status |
|------|-------------|-------------------|--------|
| `BabySitterBooking_and_BabyMinderEntities` | `Models.Model1.csdl\|...` | **Yes** — `DbContext` constructor `name=BabySitterBooking_and_BabyMinderEntities` | **ACTIVE** |
| `BabySitterBooking_and_BabyMinderEntities1` | `Model1.csdl\|...` (no `Models.` prefix) | **No** — not referenced anywhere | **UNUSED / LEGACY** |

**Evidence:** `ConfigurationManager` is not used anywhere (search returned 0 results). All controllers use `new BabySitterBooking_and_BabyMinderEntities()`. The second connection string is dead config. Recommend removal (C6 implementation).

---

## 7. Frontend Contract Gaps (C7)

See `BACKEND_FRONTEND_CONTRACT.md` and `BACKEND_ANSWERS_FOR_FRONTEND.md` for the complete picture. Key gaps:

| Gap | Status |
|-----|--------|
| Parent Dashboard summary API | **MISSING** — no single endpoint returns active/upcoming jobs + notification count. `GET api/parent/jobs/{parentId}` returns raw jobs; frontend must compute counts |
| Babysitter Dashboard summary API | **MISSING** — no single endpoint. `GET api/jobs/sitter/{sitterId}` returns jobs; frontend computes |
| Dedicated notifications endpoint | **EXISTS** — `GET api/notifications?userId=&role=` (query params, not route) |
| Search/filter babysitters | **EXISTS** — `POST api/matching/filter-sitters` (filters by city, date, slots) |
| Babysitter profile API | **EXISTS** — `GET api/matching/babysitter/{id}` |
| Cry detection POST | **EXISTS** — `POST api/cry-detection` |
| Cry detection latest | **EXISTS** — `GET api/cry-detection/latest?parentId=` |
| Logout | **MISSING** — no endpoint (no credential to invalidate) |

---

## Preflight Verdict

- **Safe to document only (no implementation):** C1, C2, C3, C4, C5 — all require product/architectural decisions.
- **Safe to implement:** C6 (remove unused connection string — verified unreferenced), C7 (documentation only).
- **Blocked on C1:** C2 (password migration), C3 (IDOR fixes).
- **No regressions from Phase B:** All controllers compile; build is green.

