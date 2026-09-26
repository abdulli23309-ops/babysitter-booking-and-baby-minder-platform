# F1 BACKEND ANSWERS — Frontend F1 Questions Answered from Backend Source

> **Date:** 2026-09-02  
> **Branch:** remediation  
> **Purpose:** Authoritative answers to frontend F1 blocking questions, derived from actual backend source code inspection.

---

## Q1 — Exact Login DTO Response Shape

### Parent Login
```text
Endpoint:       POST api/parent/login
HTTP method:    POST
Request DTO:    LoginDTO { Username, Password, Role }
Required fields: Username, Password, Role (must be "Parent")
Response status: 200 OK (success) / 400 BadRequest / 401 Unauthorized
Response JSON fields:
  {
    "message": "Login Successful",
    "userId": 1,
    "name": "Parent FullName",
    "role": "Parent",
    "address": "Parent Address",
    "pictureAddress": "filename.jpg"
  }
User ID field:      userId (camelCase)
Name field:         name (camelCase)
Email field:        NOT RETURNED
Phone field:        NOT RETURNED
Profile image field: pictureAddress (camelCase)
Other fields:       message, role, address
```

### Babysitter Login
```text
Endpoint:       POST api/babysitter/login
HTTP method:    POST
Request DTO:    LoginDTO { Username, Password, Role }
Required fields: Username, Password, Role (must be "Sitter")
Response status: 200 OK (success) / 400 BadRequest / 401 Unauthorized
Response JSON fields:
  {
    "message": "Login Successful",
    "userId": 1,
    "name": "Sitter FullName",
    "role": "Sitter"
  }
User ID field:      userId (camelCase)
Name field:         name (camelCase)
Email field:        NOT RETURNED
Phone field:        NOT RETURNED
Profile image field: NOT RETURNED
Other fields:       message, role
```

### Key Differences
- **Parent** returns `address` and `pictureAddress`; **Babysitter** does not.
- Both return `userId` (canonical ID field) — **frontend can rely on this single field**.
- Field names are **camelCase** (default JSON serialization for anonymous objects in this project).
- **Code:** `Controllers/ParentController.cs` → `LoginParent`, `Controllers/BabysitterController.cs` → `LoginBabysitter`


## Q2 — Canonical Backend Role Strings

```text
ANSWER:
  - Parent login requires Role = "Parent"
  - Babysitter login requires Role = "Sitter"
  - Review roles use "Parent" and "Sitter" (ReviewerRole, ReviewForRole)
  - Notification roles use "Parent" and "Sitter" (UserRole)
```

**Evidence:**
- `ParentController.cs`: `if (login.Role != "Parent")`
- `BabysitterController.cs`: `if (login.Role != "Sitter")`
- `ReviewController.cs`: validates `ReviewerRole` ∈ {"Parent", "Sitter"}
- `NotificationsController.cs`: accepts `role` param (expected "Parent" or "Sitter")

**FRONTEND ACTION REQUIRED:**
- Frontend login payload must send `"Parent"` for parent login and `"Sitter"` for babysitter login.
- The endpoint itself determines the user type; the Role field is validated but redundant (the URL prefix already implies the role).
- **Canonical vocabulary:** `"Parent"` and `"Sitter"` (NOT "Babysitter").

---

## Q3 — Authentication/Session Strategy

```text
ANSWER:
  Authentication mechanism:     NONE
  Credential issued at login:   NONE (returns user data only)
  Credential transport:          N/A
  Token expiry:                  N/A
  Refresh strategy:              N/A
  Server-side session:           NONE

  Current backend trust model:   Fully anonymous — all endpoints publicly accessible
  Anonymous API access:          YES — no authentication required
  Client-supplied IDs trusted:   YES — all IDs in URL/body are trusted without validation
```

**Evidence:**
- No `[Authorize]` attribute on any controller (searched all 9 controllers).
- No OWIN/ASP.NET Identity middleware in `Global.asax.cs`.
- No JWT/bearer token configuration in `Web.config` or `WebApiConfig.cs`.
- Login returns a plain object — no `Set-Cookie`, no token header.
- `Web.config` has no `<authentication>` element.

**FRONTEND ACTION REQUIRED:**
- Frontend currently has no token to store/send. This is the current contract.
- **Security note:** Without authentication, the frontend cannot securely enforce data isolation. This is a backend architectural gap (see C1).

---

## Q4 — Authorization Enforcement

```text
ANSWER:
  - No [Authorize] attributes exist anywhere.
  - No [AllowAnonymous] attributes exist (all endpoints are implicitly anonymous).
  - No custom authorization filters exist.
  - IDOR risk is pervasive — 16 endpoints trust client-supplied IDs.
```

### Authorization Matrix (high-risk endpoints)

| Endpoint | Auth | Role | IDOR Risk | Protection |
|----------|------|------|-----------|------------|

## Q5 — Login Failure Semantics

```text
ANSWER:
  Scenario: Invalid username
    HTTP Status: 401 Unauthorized
    Response body: "User not found" (plain string)

  Scenario: Invalid password
    HTTP Status: 401 Unauthorized
    Response body: "Wrong password" (plain string)

  Scenario: Missing fields (login object is null)
    HTTP Status: 400 BadRequest
    Response body: "Login details missing"

  Scenario: Invalid role (e.g., "Sitter" on parent endpoint)
    HTTP Status: 400 BadRequest
    Response body: "Invalid role for this endpoint"

  Scenario: Server exception
    HTTP Status: 400 BadRequest
    Response body: "Login Error: {exception.Message}"
```

**FRONTEND ACTION REQUIRED:**
- Frontend must handle 401 (string body) for invalid credentials.
- Frontend must handle 400 (string body) for missing fields / invalid role.
- **Note:** Error responses are plain strings, not JSON objects. Do not assume `{ "message": "..." }` for errors.

---

## Q6 — Static Image/Media Serving

```text
ANSWER:
  Physical storage:     ~/Images/Parents/ and ~/Images/Sitters/ (server-relative paths)
  URL generation:       Stored as filename only (e.g., "guid.jpg") in Parent.PictureAddress / Babysitter.PictureAddress
  Public access:        /Images/... is served as static file (IIS default behavior)
  API endpoint:         GET api/images/parent/{id} and GET api/images/sitter/{id} (ImageController)
  Relative paths:       YES — /Images/Parents/filename.jpg works
```

**Evidence:**
- `ImageController.cs`: `GetParentImage(int id)` returns `PhysicalFile(path, "image/jpeg")`
- `ParentController.cs`: saves to `Server.MapPath("~/Images/Parents/")`, stores filename in DB
- `BabysitterController.cs`: saves to `Server.MapPath("~/Images/Sitters/")`, stores filename in DB
- Default image: `default_parent.jpg` / `default_sitter.jpg`

**FRONTEND ACTION REQUIRED:**
- Frontend should use relative URLs: `/Images/Parents/{pictureAddress}` or `/Images/Sitters/{pictureAddress}`.
- The absolute `https://localhost:44368/Images/...` references should be replaced with relative `/Images/...`.
- **Production note:** Static file serving depends on IIS configuration; the `/Images` folder must be deployed.

---

## Q7 — ID Data Types

```text
ANSWER:
  Parent_ID:        int (NOT NULL, IDENTITY)
  Babysitter_ID:    int (NOT NULL, IDENTITY) — named Sitter_ID in some contexts
  Job_ID:           int (NOT NULL, IDENTITY)
  Child_ID:         int (NOT NULL, IDENTITY)
  Review_ID:        int (NOT NULL, IDENTITY)
  Notification_ID:  int (NOT NULL, IDENTITY)
  Bid_ID:           int (NOT NULL, IDENTITY)
  Slot_ID:          int (NOT NULL)
  CryAlert.Id:      uniqueidentifier (Guid)
```

**Evidence:** All entity models (`Models/*.cs`) use `int` for IDs with `[Key]` and identity annotations. `CryAlert` uses `Guid Id`.

**FRONTEND ACTION REQUIRED:**
- `number(localStorage.getItem('userId'))` is **safe** for all int IDs.
- JavaScript `Number` can precisely represent all 32-bit integers (up to 2^53), so no precision loss for typical ID ranges.
- **Exception:** `CryAlert.Id` is a `Guid` (string in JS) — do not convert to Number.

| POST api/parent/create-job | None | None | CRITICAL | None |
| GET api/parent/jobs/{parentId} | None | None | HIGH | None |
| GET api/parent/children/{parentId} | None | None | HIGH | None |
| PUT api/children/child/{childId} | None | None | HIGH | None |
| GET api/babysitter/earnings/{sitterId} | None | None | HIGH | None |
| GET api/notifications | None | None | HIGH | None |
| POST api/cry-detection | None | None | HIGH | None |
| POST api/jobs/confirm/{jobId}/{sitterId} | None | None | CRITICAL | None |
| POST api/matching/availability/save | None | None | HIGH | None |

**FRONTEND ACTION REQUIRED:**
- Frontend cannot rely on backend to filter data by ownership. Any client-side filtering is cosmetic, not security.
- **Dependency:** Authorization cannot be enforced without first implementing authentication (C1).
