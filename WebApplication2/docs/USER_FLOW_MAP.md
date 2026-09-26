# USER FLOW MAP
Generated: 2026-09-13 16:32 UTC
Frontend: babysitter-app
Branch: remediation
HEAD: cb8837864076e6c7ee1c9d52c4da60a919926f41

## Summary
- Flows mapped: 26
- Flows with full endpoint coverage: 22
- Flows with missing endpoints: 4
- Frontend API calls with no matching backend route (ORPHAN): 2
- Backend routes never called by the frontend (UNUSED): 15

Route inventory reference: docs/ROUTE_INVENTORY.md. All routes quoted below use the
full `/api/...` form. The frontend `apiClient` uses base `/api` and passes relative
paths (`apiGet('/parent/jobs/1')` â†’ `GET /api/parent/jobs/1`). Auth is an opaque
Bearer token attached by the `apiClient` request interceptor.

## Flow: Parent â€” Register
Actor: Public
Screen: src/features/auth/CreateAccount.jsx

Steps:
  1. Fill register form and submit
     â†’ POST /api/parent/register
     â†’ request:  multipart form (FullName, EmailAddress, Username, Password, PhoneNumber, Address, UseDefaultPicture)
     â†’ response: { message, ... } (auth session issued by server)
  2. Redirect to /login
     â†’ no HTTP call (client-side navigation)

Error handling:
  - 400 â†’ react-toast error (duplicate email/user, invalid email, weak password)
  - 401 â†’ apiClient interceptor clears session + redirects /login
  - 403 â†’ not expected (endpoint is AllowAnonymous)
  - 404 â†’ toast error
  - 5xx â†’ toast error

Endpoint exists in Route Inventory?  yes

## Flow: Parent â€” Login
Actor: Public
Screen: src/features/auth/login.jsx

Steps:
  1. Enter username + password and submit
     â†’ POST /api/parent/login
     â†’ request:  JSON { Username, Password, Role: "Parent" }
     â†’ response: { token, userId, name, role, expiresAt } (persisted via AuthContext/sessionStorage)
  2. Navigate to /main-screen

Error handling:
  - 400 â†’ inline error + toast (bad payload)
  - 401 â†’ inline "Invalid username or password" + toast
  - 403 â†’ not expected (AllowAnonymous)
  - 404 â†’ toast
  - 5xx â†’ "Unable to connect to server" + toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent â€” Add Child
Actor: Parent
Screen: src/features/parent/SetChildProfile.jsx, src/features/parent/ChildProfile.jsx

Steps:
  1. (list existing children)
     â†’ GET /api/parent/children/{parentId}
     â†’ request:  route param parentId
     â†’ response: children array
  2. Submit new child (multipart)
     â†’ POST /api/parent/child
     â†’ request:  multipart/form-data (Content-Type override in API.createChild)
     â†’ response: { message, childId }

Error handling:
  - 400 â†’ toast error (validation)
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ toast error (IDOR/role)
  - 404 â†’ toast
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent — Search for Sitters (map pin + radius)
Actor: Parent
Screen: src/features/parent/SearchBabySitter.jsx

Steps:
  1. Set dates/times/availability type, place a map pin
     -> no HTTP (client-side state; Nominatim forward/reverse geocode for pin text)
  2. Submit search
     -> POST /api/matching/search-sitters
     -> request:  JSON { City, Latitude, Longitude, StartDate, EndDate, StartTime, EndTime, SelectedDays, MinRating, AvailabilityType }
     -> response: SitterDTO[] (incl. DistanceKm, rating)

Error handling:
  - 400 -> toast validation message (backend BadRequest)
  - 401 -> interceptor clears session -> /login
  - 403 -> toast
  - 404 -> "No sitters found for your criteria"
  - 5xx -> "Error: ..." toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent — Book a Sitter (create job from modal)
Actor: Parent
Screen: src/features/parent/BabySitterDetails.jsx

Steps:
  1. Load own children for the modal
     -> GET /api/parent/children/{parentId}
     -> request:  route param parentId
     -> response: children array
  2. Confirm booking
     -> POST /api/parent/create-job
     -> request:  JSON { ParentId, ChildId, SitterId, City, StartDate, StartTime, EndTime, Latitude, Longitude }
     -> response: { message, jobId }
  3. On success -> toast "Booking confirmed ...", navigate /my-jobs

Error handling:
  - 400 -> toast error (validation, sitter conflict/Rule C, locked slot)
  - 401 -> interceptor clears session -> /login
  - 403 -> toast "Access denied" (IDOR)
  - 404 -> toast
  - 5xx -> toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent — View My Jobs / Incoming Bids
Actor: Parent
Screen: src/features/parent/MyJobsScreen.jsx

Steps:
  1. Load bookings
     -> GET /api/parent/jobs/{parentId}
     -> request:  route param parentId
     -> response: jobs array (Status = Open/Assigned/In Progress/Completed/Cancelled)
  2. Load incoming bids
     -> GET /api/bids/parent/{parentId}
     -> request:  route param parentId
     -> response: ParentBidItemDto[] (BidId, JobId, SitterName, SitterRating, ProposedPrice, ...)

Error handling:
  - 400 -> toast "Could not load your bookings."
  - 401 -> interceptor clears session -> /login
  - 403 -> toast (bids IDOR)
  - 404 -> toast
  - 5xx -> toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent — Accept Bid
Actor: Parent
Screen: src/features/parent/MyJobsScreen.jsx

Steps:
  1. Click Accept on a bid
     -> POST /api/bids/accept/{bidId}
     -> request:  {} (route param bidId)
     -> response: { message, bidId, jobId, sitterId }
  2. On success -> toast "Bid accepted. The caregiver has been assigned."; refetch jobs + bids

Error handling:
  - 400 -> toast error
  - 401 -> interceptor clears session -> /login
  - 403 -> toast error (IDOR)
  - 404 -> toast
  - 5xx -> toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent — Reject Bid
Actor: Parent
Screen: src/features/parent/MyJobsScreen.jsx

Steps:
  1. Click Reject on a bid
     -> POST /api/bids/reject/{bidId}
     -> request:  {} (route param bidId)
     -> response: { message, ... }
  2. On success -> toast "Bid rejected."; refetch jobs + bids

Error handling:
  - 400 -> toast error
  - 401 -> interceptor clears session -> /login
  - 403 -> toast error
  - 404 -> toast
  - 5xx -> toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent — Start Session
Actor: Parent
Screen: src/features/parent/ParentUpcomingJobScreen.jsx

Steps:
  1. Click "Start Session"
     -> POST /api/jobs/updateStatus/{jobId}
     -> request:  JSON { Status: "In Progress" }
     -> response: { message, jobId, status, assignedSitterId, parentId }
  2. On success -> toast "Babysitting session started!"; navigate /parent-active-job

Error handling:
  - 400 -> toast / ignored (demo bypasses network errors)
  - 401 -> interceptor clears session -> /login
  - 403 -> toast
  - 404 -> toast
  - 5xx -> ignored (functionally moves on)

Endpoint exists in Route Inventory?  yes
## Flow: Parent â€” End Session
Actor: Parent
Screen: src/features/parent/ParentActiveJobScreen.jsx

Steps:
  1. Click "End Session"
     â†’ POST /api/jobs/updateStatus/{jobId}
     â†’ request:  JSON { Status: "Completed" }
     â†’ response: { message, jobId, status, assignedSitterId, parentId }
  2. On success â†’ toast "Babysitting session completed!"; navigate /job-end-review

Error handling:
  - 400 â†’ toast "Could not complete session."
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ toast
  - 404 â†’ toast
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent â€” View Notifications
Actor: Parent
Screen: src/features/notifications/ParentNotifications.jsx, src/features/parent/ParentDashboard.jsx

Steps:
  1. Load notifications
     â†’ GET /api/notifications?userId={id}&userRole=Parent
     â†’ request:  query params userId, userRole
     â†’ response: notification list (Type, Message, IsRead, userRole)
  2. Poll latest cry alert (on notifications screen)
     â†’ GET /api/cry-detection/latest?parentId={id}
     â†’ request:  query param parentId
     â†’ response: { id, timestamp, roomName, level, jobId, parentId, babysitterId } | 404 â†’ null

Error handling:
  - 400 â†’ toast
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ toast (RBAC/IDOR)
  - 404 â†’ treated as "no alert yet" (returns null, no error UI)
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes

## Flow: Parent â€” View Earnings
Actor: Parent
Screen: n/a
Status: NOT FOUND IN FRONTEND â€” there is no parent earnings endpoint or parent earnings screen. Earnings are a Sitter-only concept (GET /api/babysitter/earnings/{sitterId}).

Endpoint exists in Route Inventory?  no (no such parent route)

## Flow: Sitter â€” Register
Actor: Sitter
Screen: src/features/auth/Register.jsx

Steps:
  1. Fill register form and submit
     â†’ POST /api/babysitter/register
     â†’ request:  multipart form (FullName, Email, Username, Password, PhoneNumber, DOB, ExperienceYears, HourlyRate, UseDefaultPicture)
     â†’ response: { message, ... } (auth session issued)
  2. Redirect to /login

Error handling:
  - 400 â†’ toast error (duplicate email/user, negative rate/exp)
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ not expected (AllowAnonymous)
  - 404 â†’ toast
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes

## Flow: Sitter â€” Login
Actor: Sitter
Screen: src/features/auth/login.jsx

Steps:
  1. Enter username + password (role = babysitter) and submit
     â†’ POST /api/babysitter/login
     â†’ request:  JSON { Username, Password, Role: "Sitter" }
     â†’ response: { token, userId, name, role, expiresAt }
  2. Navigate to /babysitter-dashboard

Error handling:
  - 400 â†’ inline error + toast
  - 401 â†’ inline "Invalid username or password" + toast
  - 403 â†’ not expected (AllowAnonymous)
  - 404 â†’ toast
  - 5xx â†’ "Unable to connect to server" + toast

Endpoint exists in Route Inventory?  yes

## Flow: Sitter â€” Set Availability (weekly grid + map pin + radius + hourly rate)
Actor: Sitter
Screen: src/features/babysitter/SetAvailability.jsx

Steps:
  1. Load own profile (for lockout + hourly rate)
     â†’ GET /api/matching/babysitter/{sitterId}
     â†’ request:  route param sitterId
     â†’ response: SitterDTO{ Sitter_ID, HourlyRate, ..., SitterLockedUntil }
  2. Load existing availability (hydrates grid + map pin/radius)
     â†’ GET /api/matching/availability/{sitterId}
     â†’ request:  route param sitterId
     â†’ response: rows incl. AvailableDate, Slot_ID, Latitude, Longitude, RadiusKm, IsLocked, LockedByJobId
  3. Save weekly availability
     â†’ POST /api/matching/availability/save
     â†’ request:  JSON { SitterId, Date, SlotIds[], City, Latitude, Longitude, RadiusKm }
     â†’ response: { message }
  4. On save â†’ toast "Availability saved"; auto-refresh list every 5s via the same GET

Error handling:
  - 400 â†’ toast (locked-slot rejection Rule A, validation)
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ toast "You can only manage your own availability." (IDOR)
  - 404 â†’ toast
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes (profile GET Anonymous; availability GET/Save are Session/Sitter)

## Flow: Sitter â€” View Job Requests
Actor: Sitter
Screen: src/features/babysitter/JobRequest.jsx

Steps:
  1. Load job requests
     â†’ GET /api/matching/jobrequests?sitterId={sitterId}
     â†’ request:  query param sitterId
     â†’ response: matched job-request list
  2. Accept jobs in bulk
     â†’ POST /api/jobs/confirm-bulk
     â†’ request:  JSON { JobIds[], SitterId }
     â†’ response: { message }

Error handling:
  - 400 â†’ toast error
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ toast "Access denied" (IDOR)
  - 404 â†’ toast
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes

## Flow: Sitter â€” Place Bid
Actor: Sitter
Screen: n/a (no wiring found)
Status: NOT FOUND IN FRONTEND â€” the sitter flow submits job requests via GET /api/matching/jobrequests and accepts via POST /api/jobs/confirm (ConfirmJob/confirmJobsBulk). No component calls API.placeBid or POST /api/bids/place. (Backend endpoint exists but is unused by the frontend.)

Endpoint exists in Route Inventory?  yes (backend) / no frontend caller

## Flow: Sitter â€” Accept Job (equivalent to accept flow)
Actor: Sitter
Screen: src/features/babysitter/JobDetails.jsx

Steps:
  1. Load job details
     â†’ GET /api/jobs/jobdetails/{jobId}
     â†’ request:  route param jobId
     â†’ response: job details DTO
  2. Confirm (accept) the job
     â†’ POST /api/jobs/confirm/{jobId}/{sitterId}
     â†’ request:  route params jobId, sitterId
     â†’ response: { message = "Job confirmed." }

Error handling:
  - 400 â†’ toast error
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ toast "Access denied" (Sitter-only + IDOR)
  - 404 â†’ toast (KeyNotFoundException â†’ NotFound)
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes
## Flow: Sitter â€” Reject Job
Actor: Sitter
Screen: src/features/babysitter/JobDetails.jsx, src/features/babysitter/JobRequest.jsx
Status: ORPHAN ROUTE â€” calls API.rejectJob â†’ POST /api/matching/reject?jobId={jobId} which does NOT exist in the Route Inventory. (Backend rejects a job via POST /api/jobs/updateStatus/{jobId} with a status; the /matching/reject route has no matching controller action.)

Endpoint exists in Route Inventory?  no (ORPHAN)

## Flow: Sitter â€” View Earnings
Actor: Sitter
Screen: src/features/babysitter/Earnings.jsx, src/features/babysitter/BabySitterDashboard.jsx

Steps:
  1. Load earnings
     â†’ GET /api/babysitter/earnings/{sitterId}
     â†’ request:  route param sitterId
     â†’ response: { totalEarnings, balance } (frontend reads earnData?.totalEarnings ?? earnData?.balance)

Error handling:
  - 400 â†’ toast / balance fallback (Earnings.jsx uses 58425 fallback)
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ toast
  - 404 â†’ toast
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes

## Flow: Sitter â€” Update Profile
Actor: Sitter
Screen: src/features/babysitter/UpdateProfile.jsx

Steps:
  1. Load current profile
     â†’ GET /api/matching/babysitter/{sitterId}
     â†’ request:  route param sitterId
     â†’ response: SitterDTO (incl. HourlyRate, EmailAddress, DOB, PhoneNumber, ExperienceYears, PictureAddress)
  2. Submit updates
     â†’ PUT /api/babysitter/update/{sitterId}
     â†’ request:  JSON UpdateSitterDto (FullName, EmailAddress, Username, PhoneNumber, PictureAddress, DOB, ExperienceYears, HourlyRate) â€” nullable subset
     â†’ response: { message = "Profile updated." }

Error handling:
  - 400 â†’ toast error
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ toast "Access denied: you may only update your own profile." (IDOR)
  - 404 â†’ toast
  - 5xx â†’ toast

Endpoint exists in Route Inventory?  yes

## Flow: Sitter â€” Handle Lockout State
Actor: Sitter
Screen: src/features/babysitter/SetAvailability.jsx

Steps:
  1. On mount load own profile
     â†’ GET /api/matching/babysitter/{sitterId}
     â†’ request:  route param sitterId
     â†’ response: SitterDTO.SitterLockedUntil (nullable)
  2. If SitterLockedUntil > now â†’ render lockout banner, disable Save, disable grid cells
     â†’ no additional HTTP call

Error handling:
  - 400 â†’ no banner (silent catch)
  - 401 â†’ interceptor clears session â†’ /login
  - 403 â†’ no banner
  - 404 â†’ no banner (field absent â†’ banner hidden)
  - 5xx â†’ no banner (silent catch)

Endpoint exists in Route Inventory?  yes

## Flow: Sitter â€” View Notifications
Actor: Sitter
Screen: n/a
Status: NOT FOUND IN FRONTEND â€” the only notifications screen found is ParentNotifications.jsx (Parent). No sitter notifications screen calls GET /api/notifications with UserRole=Sitter.

Endpoint exists in Route Inventory?  yes (backend) / no frontend sitter caller

## Flow: Cross-cutting â€” Session Expiry / 401 Handling
Actor: All
Screen: src/services/apiClient.js (response interceptor)
Steps:
  1. Any authenticated call returns 401
     â†’ interceptor: clearSession(); redirect to /login (if not already there)

Error handling:
  - 401 â†’ global: clear session + hard redirect /login (applies to every flow above)

Endpoint exists in Route Inventory?  yes (behaviour, not a route)

## Flow: Cross-cutting â€” Logout
Actor: All
Screen: src/features/auth/AuthContext.jsx (logout), ParentProfileScreen.jsx, babysitterprofilescreen.jsx
Steps:
  1. User taps Logout
     â†’ clearSession() (localStorage) + redirect /login
     â†’ NOTE: this is client-side only; DELETE /api/auth/logout is NOT called by the frontend.

Error handling:
  - n/a (no HTTP call)

Endpoint exists in Route Inventory?  backend route exists (DELETE /api/auth/logout) but frontend does NOT call it (UNUSED)

## Flow: Cross-cutting â€” Image Loading
Actor: All
Screen: src/utils/imageUtils.js, many screens (src={...buildImageUrl... })
Steps:
  1. <img src="/api/images/{type}/{filename}"> or "/api/images/default/{type}/{filename}"
     â†’ GET /api/images/{type}/{filename}, GET /api/images/default/{type}/{filename} (or {filename} forms)
     â†’ response: image bytes (Content-Type from mime); 404 when missing

Error handling:
  - 404 â†’ browser shows broken image (frontend does not handle)
  - others â†’ broken image

Endpoint exists in Route Inventory?  yes

## ORPHAN Calls (frontend calls, no backend route)
| Frontend file | Method | Path | Note |
|---------------|--------|------|------|
| src/services/api.js:18 (used by JobDetails.jsx:124, JobRequest.jsx:171) | POST | /api/matching/reject?jobId={jobId} | API.rejectJob targets this route; not present in Route Inventory. Backend job-reject is instead POST /api/jobs/updateStatus/{jobId}. |
| src/services/api.js:101 (used by BabySitterDetails2.jsx:32) | POST | /api/reviews | API.submitReview targets /reviews; the inventory route is POST /api/review/add (JobEndReviewScreen.jsx:65 uses the correct /review/add). |

## UNUSED Routes (backend routes, no frontend caller)
| Controller | Method | Route | Note |
|------------|--------|-------|------|
| AuthController | GET | /api/auth/me | No frontend caller (session is restored from localStorage, not verified via /me). |
| AuthController | DELETE | /api/auth/logout | Logout is client-side only (AuthContext.clearSession); endpoint not called. |
| JobsController | GET | /api/jobs | API.getJobs wrapper defined; no component caller. |
| MatchingController | GET | /api/matching/matches/{jobId} | API.getMatchingSitters wrapper defined; no component caller. |
| MatchingController | POST | /api/matching/availability/recurring | No frontend caller (SetAvailability references "recurring" only as label text). |
| MatchingController | POST | /api/matching/filter-sitters | No frontend caller. |
| MatchingController | GET | /api/matching/search-sitters, /api/matching/search | GET search variant unused; frontend uses POST /api/matching/search-sitters. |
| MatchingController | DELETE | /api/matching/availability/clear/{sitterId} | API.clearAllAvailability wrapper defined; no component caller. |
| BidsController | POST | /api/bids/place | No frontend caller (sitter uses confirm/confirm-bulk instead). |
| NotificationsController | POST | /api/notifications | Internal use only (e.g., BidService); no frontend caller. |
| NotificationsController | PUT | /api/notifications/{id}/read | API.markNotificationRead wrapper defined; no component caller. |
| NotificationsController | DELETE | /api/notifications/clear | handleClearNotifications clears localStorage only; API.clearNotifications not called. |
| ParentController | DELETE | /api/parent/child/{childId} | API.deleteChild wrapper defined; no component caller. |
| ReviewController | GET | /api/review/sitter/{sitterId} | No frontend caller (Ratings uses /review/user/{userId}/{role}). |
| ReviewController | GET | /api/review/parent/{parentId} | No frontend caller. |
