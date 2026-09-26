# BACKEND ↔ FRONTEND API CONTRACT

> **Generated:** 2026-09-02  
> **Branch:** remediation  
> **Purpose:** Authoritative reference for the React frontend team.  
> **Convention:** All field names are PascalCase (C# JSON serializer default). Routes are case-insensitive.  
> **Base URL (dev):** `https://localhost:44368/` (IIS Express)  
> **Frontend dev proxy:** React/Vite proxies `/api/...` to the backend base URL.

---

## 1. AUTHENTICATION CONTRACT

### Parent Login
| Item | Value |
|------|-------|
| Route | `POST api/parent/login` |
| Method | POST |
| Request body | `LoginDTO`: `{ Username: string, Password: string, Role: string }` |
| Response (200) | `{ message, userId, name, role: "Parent", address, pictureAddress }` |
| Response (400) | `"Invalid role for this endpoint"` (if Role != "Parent") |
| Response (401) | `"User not found"` or `"Wrong password"` |
| Auth credential | **None** — only user data returned |

### Babysitter Login
| Item | Value |
|------|-------|
| Route | `POST api/babysitter/login` |
| Method | POST |
| Request body | `LoginDTO`: `{ Username: string, Password: string, Role: string }` |
| Response (200) | `{ message, userId, name, role: "Sitter" }` |
| Response (400) | `"Invalid role for this endpoint"` (if Role != "Sitter") |
| Response (401) | `"User not found"` or `"Wrong password"` |
| Auth credential | **None** — only user data returned |

### Logout
**Does not exist.** No credential is issued at login; nothing to invalidate.

### Role strings (authoritative)
- `"Parent"` — Parent user role
- `"Sitter"` — Babysitter user role (note: NOT "Babysitter")

---

## 2. AUTHORIZATION CONTRACT

### Current state: **No authorization enforced.**
All endpoints are publicly accessible. No `[Authorize]` attributes. No token validation.

### Parent capabilities (by convention, not enforcement)
- Register, Login
- CRUD on own Children
- Create/Read Jobs
- Accept bids, Confirm sitter
- Post/Read Reviews
- Create/Read Notifications (CryAlert)

### Babysitter capabilities (by convention, not enforcement)
- Register, Login
- Read/Update own Availability
- Place Bids on jobs
- Confirm/Update jobs assigned to them
- Read own Earnings
- Post/Read Reviews
- Create/Read Notifications (CryAlert)

### Public endpoints (no identity required — all endpoints are effectively public)
- All `GET` endpoints (readable by anyone)
- All `POST/PUT/DELETE` endpoints (writable by anyone)

### Authorization not yet implemented
- No authenticated principal

---

## 3. DASHBOARD API AVAILABILITY

### Parent Dashboard
| Requirement | Status | Details |
|-------------|--------|---------|
| Active jobs | **PARTIAL** | `GET api/parent/jobs/{parentId}` returns all jobs with status. Frontend must filter "Active"/"In Progress" |
| Upcoming jobs | **PARTIAL** | Same endpoint — filter by `JobDate` in future |
| Notifications | **EXISTS** | `GET api/notifications?userId={parentId}&role=Parent` |
| Child count | **MISSING** | No single count endpoint. Use `GET api/parent/children/{parentId}` and count client-side |
| Job statistics | **MISSING** | No aggregation endpoint. Frontend must compute from jobs list |

### Babysitter Dashboard
| Requirement | Status | Details |
|-------------|--------|---------|
| Pending job requests | **PARTIAL** | `GET api/jobs/sitter/{sitterId}` returns jobs; frontend filters by status |
| Active jobs | **PARTIAL** | Same endpoint |
| Completed jobs | **PARTIAL** | Same endpoint — filter by `Status == "Completed"` |
| Availability | **EXISTS** | `GET api/matching/availability/{sitterId}` |
| Notifications | **EXISTS** | `GET api/notifications?userId={sitterId}&role=Sitter` |

**Note:** No dedicated dashboard summary endpoints exist. Frontend must aggregate from the listed endpoints.

---

## 4. BABYSITTER SEARCH/MATCHING CONTRACT

### Search/Filter Sitters
| Item | Value |
|------|-------|
| Route | `POST api/matching/filter-sitters` |
| Method | POST |
| Request body | `{ City: string, StartDate: DateTime?, SlotIds: List<int> }` |
| Response | `List<Babysitter>` — matches by City (exact), Date (availability), and Slots |
| Frontend filter capability | **City** (yes), **Date** (yes, via availability), **Rating** (no), **Experience** (no) |

### Babysitter Profile
| Item | Value |
|------|-------|
| Route | `GET api/matching/babysitter/{id}` |
| Method | GET |
| Response | Single `Babysitter` entity (full details including EmailAddress, PhoneNumber) |

### Babysitter Jobs (for sitter dashboard)
| Item | Value |
|------|-------|
| Route | `GET api/jobs/sitter/{sitterId}` |
| Method | GET |
| Response | `List<object>` with job details, bids, child info, slot times |

### Bid Operations
| Item | Value |
|------|-------|
| Place bid | `POST api/jobs/place-bid` — body: `{ JobId, SitterId, ProposedPrice, Status }` |
| Accept bid | `POST api/jobs/{jobId}/bids/{bidId}/accept` |
| Job details with bids | `GET api/jobs/{jobId}` |

---

## 5. CRY DETECTION CONTRACT

### Create Alert
| Item | Value |
|------|-------|
| Route | `POST api/cry-detection` |
| Method | POST |
| Request body | `CryAlertDto`: `{ Timestamp: string, Level: string, JobId: int?, ParentId: int?, BabysitterId: int? }` |
| Required fields | `Level` (required). `Timestamp`, `RoomName`, `JobId`, `ParentId`, `BabysitterId` optional |
| Response (200) | `{ roomName, message }` — confirmation with generated message |
| Response (400) | If `Level` is missing/empty |

### Latest Alert
| Item | Value |
|------|-------|
| Route | `GET api/cry-detection/latest` |
| Method | GET |
| Query param | `parentId: int` |
| Response (200) | `{ timestamp, roomName, level }` — the most recent alert (ordered by `CreatedAt DESC`) |
| Response (404) | If no alerts exist for this parent |

### Alert reception mechanism
**Polling only.** The frontend must poll `GET api/cry-detection/latest?parentId={id}` periodically. No WebSocket/SSE/push mechanism exists. No notification integration.

- No ownership validation
- No role-based access control

---

## 6. AVAILABILITY CONTRACT

### Save Availability
| Item | Value |
|------|-------|
| Route | `POST api/matching/availability/save` |
| Method | POST |
| Request body | `AvailabilityDto`: `{ SitterId: int, Date: DateTime?, SlotIds: List<int>, City: string }` |
| Required fields | `SitterId`, `SlotIds` |
| Response (200) | `{ message }` — "Availability saved successfully." |
| Response (400) | If `SitterId` or `SlotIds` missing |

### Get Availability
| Item | Value |
|------|-------|
| Route | `GET api/matching/availability/{sitterId}` |
| Method | GET |
| Response | `List<SitterAvailability>` — all saved availability records |

### Clear Availability
| Item | Value |
|------|-------|
| Route | `DELETE api/matching/availability/clear/{sitterId}` |
| Method | DELETE |
| Response (200) | `{ message }` — "Availability cleared." |

### DTO field names (exact casing)
- `SitterId` (int)
- `Date` (DateTime?, nullable)
- `SlotIds` (List<int>)
- `City` (string)

### Time Slots (reference data)
| Item | Value |
|------|-------|
| Route | `GET api/matching/timeslots` |
| Method | GET |
| Response | `List<TimeSlot>` — `{ Slot_ID, Day, StartTime, EndTime }` |

---

## 7. IMAGE / STATIC FILE CONTRACT

### How profile images are served
**Static file serving from disk**, NOT through an API endpoint.

| Aspect | Value |
|--------|-------|
| Storage path | `~/Images/Parents/` and `~/Images/Sitters/` (server disk) |
| Stored value | Filename only (e.g., `abc-123.jpg` or `default_parent.jpg`) |
| Retrieval URL | `https://localhost:44368/Images/Parents/{filename}` (absolute) or `/Images/Parents/{filename}` (relative) |
| Default images | `default_parent.jpg` (Parents), `default_sitter.jpg` (Sitters) |
| API endpoint | **None** — `ImageController` exists but only returns a placeholder string |

### Known frontend issue
The frontend contains two hardcoded absolute references to `https://localhost:44368/Images/...`. These should be made relative (`/Images/...`) for deployment flexibility. The backend supports relative paths via IIS static file handling.

### Upload mechanism
- **Registration:** Multipart form upload (`UseDefaultPicture` flag + file)
- **No separate upload endpoint** — images are uploaded only during registration


---

## 8. COMPLETE ENDPOINT INVENTORY

| Controller | Route | Method | Auth | Role | Request | Response | Notes |
|------------|-------|--------|------|------|---------|----------|-------|
| ParentController | api/parent/register | POST | None | Any | Multipart form (FullName, EmailAddress, Username, Password, PhoneNumber, Address, UseDefaultPicture) | `{ message }` | File upload |
| ParentController | api/parent/login | POST | None | Any | `{ Username, Password, Role }` | `{ message, userId, name, role, address, pictureAddress }` | Role must be "Parent" |
| ParentController | api/parent/children/{parentId} | GET | None | Any | URL `parentId` | `List<Child>` | |
| ParentController | api/parent/children | POST | None | Any | `{ Parent_ID, ChildName, DOB }` | `{ message, childId }` | |
| ParentController | api/parent/child/{childId} | PUT | None | Any | URL `childId`, body `{ ChildName, DOB }` | `{ message }` | |
| ParentController | api/parent/create-job | POST | None | Any | `{ ParentId, ChildId, City, StartDate, StartTime, EndTime, HourlyRate }` | `{ message, jobId }` | Body-trusted |
| ParentController | api/parent/jobs/{parentId} | GET | None | Any | URL `parentId` | `List<object>` (jobs with child, sitter, slots) | |
| BabysitterController | api/babysitter/register | POST | None | Any | Multipart form (FullName, EmailAddress, Username, Password, PhoneNumber, DOB, ExperienceYears, HourlyRate, UseDefaultPicture) | `{ message }` | File upload |
| BabysitterController | api/babysitter/login | POST | None | Any | `{ Username, Password, Role }` | `{ message, userId, name, role }` | Role must be "Sitter" |
| BabysitterController | api/babysitter/earnings/{sitterId} | GET | None | Any | URL `sitterId` | `{ totalEarnings, completedJobs, totalHours, recentPayments }` | |
| JobsController | api/jobs/{jobId} | GET | None | Any | URL `jobId` | Job object with Bids | |
| JobsController | api/jobs/sitter/{sitterId} | GET | None | Any | URL `sitterId` | `List<object>` (jobs with bids, child, slots) | |
| JobsController | api/jobs/place-bid | POST | None | Any | `{ JobId, SitterId, ProposedPrice, Status }` | `{ message }` | |
| JobsController | api/jobs/{jobId}/bids/{bidId}/accept | POST | None | Any | URL `jobId`, `bidId` | `{ message }` | |
| JobsController | api/jobs/confirm/{jobId}/{sitterId} | POST | None | Any | URL `jobId`, `sitterId` | `{ message }` | |
| JobsController | api/jobs/updateStatus/{jobId} | POST | None | Any | URL `jobId`, body `{ Status }` | `{ message }` | |
| MatchingController | api/matching/filter-sitters | POST | None | Any | `{ City, StartDate, SlotIds }` | `List<Babysitter>` | |
| MatchingController | api/matching/babysitter/{id} | GET | None | Any | URL `id` | `Babysitter` entity | |
| MatchingController | api/matching/availability/save | POST | None | Any | `{ SitterId, Date, SlotIds, City }` | `{ message }` | |
| MatchingController | api/matching/availability/{sitterId} | GET | None | Any | URL `sitterId` | `List<SitterAvailability>` | |
| MatchingController | api/matching/availability/clear/{sitterId} | DELETE | None | Any | URL `sitterId` | `{ message }` | |
| MatchingController | api/matching/timeslots | GET | None | Any | None | `List<TimeSlot>` | |
| ReviewController | api/review/add | POST | None | Any | `{ Job_ID, Reviewer_ID, ReviewerRole, ReviewFor_ID, ReviewForRole, Rating, Comment }` | `{ message, reviewId }` | Validates Rating 1-5 |
| ReviewController | api/review/user/{userId}/{role} | GET | None | Any | URL `userId`, `role` | `List<object>` (reviews with reviewer name) | |
| NotificationsController | api/notifications | GET | None | Any | Query `userId`, `role` | `List<Notification>` | |
| NotificationsController | api/notifications/{id}/read | PUT | None | Any | URL `id` | 204 NoContent | Idempotent |
| NotificationsController | api/notifications/clear | DELETE | None | Any | Query `userId` | 204 NoContent | Idempotent |
| NotificationsController | api/notifications/create | POST | None | Any | `{ UserID, UserRole, Message, Type }` | `{ message, notificationId }` | |
| CryDetectionController | api/cry-detection | POST | None | Any | `{ Timestamp, Level, JobId, ParentId, BabysitterId }` | `{ roomName, message }` | Level required |
| CryDetectionController | api/cry-detection/latest | GET | None | Any | Query `parentId` | `{ timestamp, roomName, level }` | Ordered by CreatedAt DESC |
| ImageController | api/image | GET | None | Any | None | `"Image endpoint. Use /Images/... for actual files."` | Placeholder only |

**Total: 30 endpoints across 9 controllers.**

