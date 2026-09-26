# API Contract — Babysitter Booking & Baby Minder Platform

## 1. Overview
All endpoints accept and return JSON unless explicitly noted (e.g. multipart/form-data for registration/image upload). All authenticated requests require the header:
`Authorization: Bearer <token>`
where `<token>` is the 32-character opaque GUID returned upon successful login.

## 2. Complete Endpoint Inventory (41 Endpoints)

### 1. Authentication (`api/auth`)
- `GET /api/auth/me` — [SessionAuthorize] Retrieves authenticated user session principal and profile summary.
- `DELETE /api/auth/logout` — [SessionAuthorize] Invalidates the current session token in `UserSessions`.

### 2. Parent Management (`api/parent`)
- `POST /api/parent/register` — [AllowAnonymous] Multipart form registration for parents.
- `POST /api/parent/login` — [AllowAnonymous] Authenticates parent credentials and returns session token.
- `GET /api/parent/children/{parentId}` — [SessionAuthorize(Roles="Parent")] Returns children for parent. Enforces IDOR.
- `POST /api/parent/child` — [SessionAuthorize(Roles="Parent")] Multipart creation of child record.
- `POST /api/parent/create-job` — [SessionAuthorize(Roles="Parent")] Creates a job booking.
- `GET /api/parent/jobs/{parentId}` — [SessionAuthorize(Roles="Parent")] Returns jobs created by parent. Enforces IDOR.
- `DELETE /api/parent/deactivate/{id?}` — [SessionAuthorize(Roles="Parent")] Soft-deactivates parent account (`IsDeleted = true`).

### 3. Babysitter Management (`api/babysitter`)
- `POST /api/babysitter/register` — [AllowAnonymous] Multipart form registration for babysitters.
- `POST /api/babysitter/login` — [AllowAnonymous] Authenticates babysitter credentials and returns session token.
- `GET /api/babysitter/earnings/{sitterId}` — [SessionAuthorize(Roles="Sitter")] Retrieves aggregated earnings. Enforces IDOR.
- `DELETE /api/babysitter/deactivate/{id?}` — [SessionAuthorize(Roles="Sitter")] Soft-deactivates babysitter account.

### 4. Children Management (`api/parent`)
- `PUT /api/parent/child/{childId}` — [SessionAuthorize(Roles="Parent")] Updates child details.
- `DELETE /api/parent/child/{childId}` — [SessionAuthorize(Roles="Parent")] Soft-deletes child record.

### 5. Jobs Management (`api/jobs`)
- `GET /api/jobs/` — [SessionAuthorize] Returns open, unassigned jobs (optional `?city=` query filter).
- `GET /api/jobs/jobdetails/{jobId}` — [SessionAuthorize] Returns full details of a specific job.
- `POST /api/jobs/confirm-bulk` — [SessionAuthorize(Roles="Sitter")] Confirms multiple jobs atomically.
- `POST /api/jobs/confirm/{jobId}/{sitterId}` — [SessionAuthorize(Roles="Sitter")] Claims and confirms a job.
- `POST /api/jobs/updateStatus/{jobId}` — [SessionAuthorize] Updates job status (`Accepted`, `Completed`, `Cancelled`).
- `GET /api/jobs/sitter/{sitterId}` — [SessionAuthorize(Roles="Sitter")] Returns all jobs assigned to sitter. Enforces IDOR.
- `GET /api/jobs/active` — [SessionAuthorize(Roles="Sitter")] Returns currently active ongoing job for sitter.

### 6. Matching & Availability (`api/matching`)
- `GET /api/matching/matches/{jobId}` — [SessionAuthorize(Roles="Parent")] Matches sitters to a parent's job.
- `POST /api/matching/availability/save` — [SessionAuthorize(Roles="Sitter")] Saves sitter availability time slots.
- `POST /api/matching/filter-sitters` — [SessionAuthorize] Filters sitters by experience, rating, and city.
- `GET /api/matching/availability/{sitterId}` — [SessionAuthorize] Retrieves availability slots for sitter.
- `DELETE /api/matching/availability/clear/{sitterId}` — [SessionAuthorize(Roles="Sitter")] Clears all availability slots.
- `POST /api/matching/search-sitters` — [SessionAuthorize] Advanced search with date/time constraints.
- `GET /api/matching/jobrequests` — [SessionAuthorize(Roles="Sitter")] Returns job requests awaiting sitter response.
- `GET /api/matching/babysitter/{id}` — [AllowAnonymous] Public profile details for a babysitter.

### 7. Notifications (`api/notifications`)
- `GET /api/notifications/` — [SessionAuthorize] Retrieves unread notifications (`?userId=&userRole=`).
- `PUT /api/notifications/{id}/read` — [SessionAuthorize] Marks notification as read.
- `DELETE /api/notifications/clear` — [SessionAuthorize] Clears notifications for user.
- `POST /api/notifications/` — [SessionAuthorize] Creates a new notification.

### 8. Reviews (`api/review`)
- `POST /api/review/add` — [SessionAuthorize] Adds a polymorphic review for Parent or Sitter.
- `GET /api/review/sitter/{sitterId}` — [AllowAnonymous] Aggregated rating average for sitter.
- `GET /api/review/parent/{parentId}` — [AllowAnonymous] Aggregated rating average for parent.
- `GET /api/review/user/{userId}/{role}` — [AllowAnonymous] All reviews for user with reviewer names.

### 9. Cry Detection & Monitoring (`api/cry-detection`)
- `POST /api/cry-detection/` — [SessionAuthorize] Records a cry detection event and creates Jitsi room.
- `GET /api/cry-detection/latest` — [SessionAuthorize] Polls the latest cry alert (`?parentId=`).

### 10. Image Serving (`api/images`)
- `GET /api/images/{type}/{filename}` — Public. Serves uploaded avatars and certificates. Enforces path traversal sanitization.
