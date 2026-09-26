# BACKEND ANSWERS FOR FRONTEND

> **Generated:** 2026-09-02  
> **Branch:** remediation  
> **Purpose:** Direct answers to frontend team questions. All answers verified against actual backend code.

---

## BE-Q-001: Does Parent login return JWT, token, cookie, session, or only user data?

**Answer: Only user data.** No JWT, no bearer token, no cookie, no session.

**Code evidence** (`Controllers/ParentController.cs` → `LoginParent`):
```csharp
return Ok(new
{
    message = "Login Successful",
    userId = parent.Parent_ID,
    name = parent.FullName,
    role = "Parent",
    address = parent.Address,
    pictureAddress = parent.PictureAddress
});
```

The response is a plain JSON object. No `Set-Cookie` header is set. No token is generated or stored server-side. The frontend receives user profile data only.

---

## BE-Q-002: Does Babysitter login return JWT, token, cookie, session, or only user data?

**Answer: Only user data.** No JWT, no bearer token, no cookie, no session.

**Code evidence** (`Controllers/BabySitterController.cs` → `LoginBabysitter`):
```csharp
return Ok(new
{
    message = "Login Successful",
    userId = sitter.Sitter_ID,
    name = sitter.FullName,
    role = "Sitter"
});
```

Same pattern as Parent login. The response contains only user identification data. No credential is issued.

---

## BE-Q-003: What exact role strings are authoritative?

**Answer:**
- `"Parent"` — for Parent users
- `"Sitter"` — for Babysitter users (note: NOT "Babysitter")

**Code evidence:**
- ParentController: `if (login.Role != "Parent")` and `role = "Parent"`
- BabysitterController: `if (login.Role != "Sitter")` and `role = "Sitter"`
- ReviewController: `ReviewerRole` and `ReviewForRole` accept `"Parent"` or `"Sitter"`

**Important for frontend:** The login request body must include `Role: "Parent"` or `Role: "Sitter"` exactly. The backend validates this and rejects mismatched roles with `400 Bad Request: "Invalid role for this endpoint"`.

---

## BE-Q-004: Do Parent Dashboard summary APIs exist?

**Answer: No dedicated summary API exists.**

The frontend must aggregate data from multiple endpoints:

| Dashboard Need | Endpoint to Use |
|----------------|-----------------|
| Active/Upcoming jobs | `GET api/parent/jobs/{parentId}` — filter by `Status` and `JobDate` client-side |
| Notifications | `GET api/notifications?userId={parentId}&role=Parent` |
| Child count | `GET api/parent/children/{parentId}` — count client-side |
| Job statistics | Compute from jobs list (no aggregation endpoint) |

There is no single `GET api/parent/dashboard/{parentId}` endpoint.

---

## BE-Q-005: Do Babysitter Dashboard summary APIs exist?

**Answer: No dedicated summary API exists.**

The frontend must aggregate data from multiple endpoints:

| Dashboard Need | Endpoint to Use |
|----------------|-----------------|
| Pending/Active/Completed jobs | `GET api/jobs/sitter/{sitterId}` — filter by `Status` client-side |
| Availability | `GET api/matching/availability/{sitterId}` |
| Notifications | `GET api/notifications?userId={sitterId}&role=Sitter` |
| Earnings | `GET api/babysitter/earnings/{sitterId}` |

There is no single `GET api/babysitter/dashboard/{sitterId}` endpoint.

---

## BE-Q-006: What is the exact babysitter search/matching API?

**Answer:** `POST api/matching/filter-sitters`

**Request body:**
```json
{
  "City": "string",
  "StartDate": "DateTime or null",
  "SlotIds": [1, 2, 3]
}
```

**Response:** `List<Babysitter>` — filtered by City (exact match), Date (via availability join), and Slots.

**Filter capabilities:**
- **City:** Yes (exact match)
- **Date:** Yes (via availability records)
- **Rating:** No (not supported)
- **Experience:** No (not supported)

**Babysitter profile:** `GET api/matching/babysitter/{id}` returns full `Babysitter` entity.

---

## BE-Q-007: Does a cry detection POST endpoint exist?

**Answer: Yes.**

**Route:** `POST api/cry-detection`

**Request body (`CryAlertDto`):**
```json
{
  "Timestamp": "string (ISO date)",
  "Level": "string (required)",
  "JobId": 0,
  "ParentId": 0,
  "BabysitterId": 0
}
```

**Required field:** `Level` (must not be empty/null).

**Response (200):**
```json
{
  "roomName": "string",
  "message": "string"
}
```

**Latest alert polling:** `GET api/cry-detection/latest?parentId={id}` returns the most recent alert (ordered by `CreatedAt DESC`).

---

## BE-Q-008: What exact DTO fields are required for babysitter availability?

**Answer:** `POST api/matching/availability/save`

**Request body (`AvailabilityDto`):**
```json
{
  "SitterId": 0,
  "Date": "DateTime or null",
  "SlotIds": [1, 2, 3],
  "City": "string"
}
```

**Required fields:**
- `SitterId` (int) — must be provided
- `SlotIds` (List<int>) — must be non-empty

**Optional fields:**
- `Date` (DateTime?, nullable)
- `City` (string)

**Exact casing:** `SitterId`, `Date`, `SlotIds`, `City` (PascalCase).

---

## BE-Q-009: How are profile/static images served?

**Answer: Static file serving from disk, NOT through an API endpoint.**

| Aspect | Value |
|--------|-------|
| Storage | `~/Images/Parents/` and `~/Images/Sitters/` on server disk |
| Stored value | Filename only (e.g., `abc-123.jpg`) |
| Retrieval URL | `/Images/Parents/{filename}` (relative) or `https://localhost:44368/Images/Parents/{filename}` (absolute) |
| Default images | `default_parent.jpg`, `default_sitter.jpg` |
| API endpoint | **None** — `ImageController` returns only a placeholder string |

**Frontend recommendation:** Use relative paths (`/Images/...`) instead of hardcoded absolute URLs (`https://localhost:44368/Images/...`) for deployment flexibility.

---

## BE-Q-010: Is there any existing logout mechanism?

**Answer: No.**

There is no logout endpoint. Since login does not issue any credential (no token, no cookie, no session), there is nothing to invalidate on the server side.

**Frontend implication:** Logout is purely a client-side operation — clear the stored user data (userId, name, role) from localStorage/sessionStorage. No backend call is needed or available.

