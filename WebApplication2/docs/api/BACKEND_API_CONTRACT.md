# BACKEND API CONTRACT — AUTHORITATIVE REFERENCE

> For React frontend team. All fields verified from actual controller code.  
> **Convention:** All JSON fields are **PascalCase** (C# default serialization).  

---

## Authentication Endpoints

### POST api/parent/login
- **Request DTO:** `LoginDTO` { Username, Password, Role }
- **Required:** Username, Password, Role (must equal "Parent")
- **Success (200):** `{ "message": "Login Successful", "userId": int, "name": string, "role": "Parent", "address": string, "pictureAddress": string }`
- **Failure (400):** `"Invalid role for this endpoint"`
- **Failure (401):** `"User not found"` or `"Wrong password"` (plain strings)
- **User ID field:** `userId` | **Name field:** `name` (lowercase)

### POST api/babysitter/login
- **Request DTO:** `LoginDTO` { Username, Password, Role }
- **Required:** Username, Password, Role (must equal "Sitter")
- **Success (200):** `{ "message": "Login Successful", "userId": int, "name": string, "role": "Sitter" }`
- **Failure (400):** `"Invalid role for this endpoint"`
- **Failure (401):** `"User not found"` or `"Wrong password"`
- **Note:** Babysitter response does NOT include `address`/`pictureAddress` (unlike Parent).

---

## Parent Endpoints

### POST api/parent/register — multipart form (FullName, EmailAddress, Username, Password, PhoneNumber, Address, UseDefaultPicture, optional image) → `{ "message": "Parent registered successfully" }`
### GET api/parent/profile/{id} → Parent entity
### GET api/parent/children/{parentId} → Child[]
### POST api/parent/create-job — body { parentId, childId, city, startDate, startTime, endTime, hourlyRate } → `{ "message": "...", "jobId": int }`
### GET api/parent/jobs/{parentId} → Job[] (with child name, sitter details, slot times)

---

## Babysitter Endpoints

### POST api/babysitter/register — multipart form (FullName, EmailAddress, Username, Password, PhoneNumber, DOB, ExperienceYears, HourlyRate, UseDefaultPicture, optional image) → `{ "message": "Babysitter registered successfully" }`
### GET api/babysitter/earnings/{sitterId} → `{ totalEarnings, completedJobs, totalHours, recentPayments[] }`

---

## Jobs Endpoints

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| GET api/jobs | GET | none | Job[] |
| GET api/jobs/{id} | GET | id (URL) | Job |
| PUT api/jobs/{id} | PUT | Job (body) | `{ message }` |
| DELETE api/jobs/{id} | DELETE | id (URL) | `{ message }` |
| GET api/jobs/sitter/{sitterId} | GET | sitterId (URL) | Job[] |
| POST api/jobs/confirm/{jobId}/{sitterId} | POST | jobId, sitterId (URL) | `{ message }` |
| POST api/jobs/updateStatus/{jobId} | POST | `{ status }` | `{ message }` |
| POST api/jobs/bulk-confirm | POST | `{ jobIds[], sitterId }` | `{ message }` |

---

## Matching Endpoints

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| POST api/matching/filter-sitters | POST | filter `{ city, date, slotIds }` | MatchingJobDto[] |
| POST api/matching/availability/save | POST | `{ sitterId, date, slotIds[], city }` | `{ message }` |
| DELETE api/matching/availability/clear/{sitterId} | DELETE | sitterId (URL) | `{ message }` |
| GET api/matching/babysitter/{id} | GET | id (URL) | Babysitter entity |
| GET api/matching/earnings/{sitterId} | GET | sitterId (URL) | earnings object |

**MatchingJobDto fields:** Job_ID, Title, Description, JobDate, City, Payment, Status, RequiredSlotIds[], ParentName, ChildName

---

## Review Endpoints

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| POST api/review/add | POST | `ReviewDTO` | `{ message }` |
| GET api/review/user/{userId}/{role} | GET | userId, role (URL) | Review[] |

**ReviewDTO:** Job_ID, Reviewer_ID, ReviewerRole, ReviewFor_ID, ReviewForRole, Rating, Comment

---

## Notification Endpoints

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| GET api/notifications?userId=&role= | GET | userId, role (query) | NotificationDto[] |
| PUT api/notifications/{id}/read | PUT | id (URL) | `{ message }` |
| DELETE api/notifications/clear?userId=&role= | DELETE | userId, role (query) | `{ message }` |
| POST api/notifications/create | POST | `NotificationDto` | `{ message }` |

**NotificationDto:** NotificationId, UserId, UserRole, Message, IsRead, CreatedAt, Type

---

## Cry Detection Endpoints

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| POST api/cry-detection | POST | `CryAlertDto` | `{ roomName, message }` |
| GET api/cry-detection/latest?parentId= | GET | parentId (query) | `{ timestamp, roomName, level }` |

**CryAlertDto:** Timestamp, Level, JobId, ParentId, BabysitterId

---

## Children & Image Endpoints

### Children: POST api/children/add | PUT api/children/child/{childId}
### Image: POST api/images/upload → `{ fileName }`

**Static images:** Served from `/Images/Parents/`, `/Images/Sitters/`, `/Images/Children/` via IIS static file handler (no API controller for serving).
