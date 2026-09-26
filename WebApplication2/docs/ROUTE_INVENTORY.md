# ROUTE INVENTORY
Generated: 2026-09-13 16:22 UTC
Backend: WebApplication2
Branch: api-c-unification-remediation
HEAD: 2422b95c7c89603bd890c02a2fb9aa48218b63d3

## Summary
- Controllers parsed: 11
- Endpoints total: 54
- Protected by [SessionAuthorize]: 44
- Anonymous: 8
- Sitter-only: 10
- Parent-only: 13

Note: 2 endpoints on ImageController are entirely public (no [SessionAuthorize], no [AllowAnonymous]) and are counted in neither "Protected" nor "Anonymous".

## AuthController  (prefix: api/auth)
Class-level `[SessionAuthorize]` (no role restriction).

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| GET | /api/auth/me | Session | — (no body) | `{userId, role, name}` | Returns the authenticated principal's context; 401 if token invalid. |
| DELETE | /api/auth/logout | Session | Bearer token header | `{message}` | Deletes the session token row; idempotent. |

## ParentController  (prefix: api/parent)
Class-level `[SessionAuthorize(Roles="Parent")]`; register/login are `[AllowAnonymous]` overrides.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| POST | /api/parent/register | Anonymous | multipart form (FullName, EmailAddress, Username, Password, PhoneNumber, Address, UseDefaultPicture) | `{message, ...}` | Public parent registration (BCrypt + session). |
| POST | /api/parent/login | Anonymous | `LoginDTO` (JSON body) | `{...}` | Public parent login; issues opaque session token. |
| GET | /api/parent/children/{parentId} | Session (Parent) | route param `parentId` | children list | Lists a parent's children; IDOR guarded. |
| POST | /api/parent/child | Session (Parent) | multipart form | `{message, childId}` | Create child from multipart form. |
| POST | /api/parent/child/json, /api/parent/child/create | Session (Parent) | `CreateChildDto` (JSON body) | `{message, childId}` | Create child via JSON body; aliased routes. |
| PUT | /api/parent/child/{childId} | Session (Parent) | multipart form + route param | `{message, childId}` | Update an existing child. |
| POST | /api/parent/create-job | Session (Parent) | `CreateJobDto` (JSON body) | `{message, jobId}` | Create a job for a target sitter; IDOR + conflict check. |
| GET | /api/parent/jobs/{parentId} | Session (Parent) | route param `parentId` | jobs list | Lists a parent's own jobs; IDOR guarded. |
| POST, DELETE | /api/parent/deactivate/{id:int?} | Session (Parent) | route param `id` (optional) | `{message}` | Deactivate parent account; revokes sessions; IDOR guarded. |

## BabySitterController  (prefix: api/babysitter)
Class-level `[SessionAuthorize(Roles="Sitter")]`; register/login are `[AllowAnonymous]` overrides.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| POST | /api/babysitter/register | Anonymous | multipart form (FullName, Email, Username, Password, Phone, DOB, ExperienceYears, HourlyRate, UseDefaultPicture) | `{message, ...}` | Public sitter registration. |
| GET | /api/babysitter/earnings/{sitterId} | Session (Sitter) | route param | earnings DTO | Sitter's total/paid earnings. |
| POST | /api/babysitter/login | Anonymous | `LoginDTO` (JSON body) | `{...}` | Public sitter login; issues session token. |
| POST, DELETE | /api/babysitter/deactivate/{id:int?} | Session (Sitter) | route param `id` (optional) | `{message}` | Deactivate sitter account; revoke sessions. |
| PUT | /api/babysitter/update/{sitterId} | Session (Sitter) | `UpdateSitterDto` (JSON body) | `{message="Profile updated."}` | Sitter self-update of existing profile columns; IDOR guarded. |

## BidsController  (prefix: api/bids)
Class-level `[SessionAuthorize]` (no role); role enforced per action.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| POST | /api/bids/place | Session (Sitter) | `PlaceBidDto` (JSON body) | `{message, bidId}` | Sitter places a bid on a job; notifies parent. |
| POST | /api/bids/accept/{bidId} | Session (Parent) | route param | `{message, bidId, jobId, sitterId}` | Parent accepts a bid → assigns job. |
| POST | /api/bids/reject/{bidId} | Session (Parent) | route param | `{message,...}` | Parent rejects a bid. |
| POST | /api/bids/withdraw/{bidId} | Session (Sitter) | route param | `{message, bidId}` | Sitter withdraws their own bid. |
| GET | /api/bids/job/{jobId} | Session (any role) | route param | bid list | Lists bids for a specific job. |
| GET | /api/bids/parent/{parentId} | Session (Parent) | route param | `ParentBidItemDto[]` | Lists bids on a parent's jobs; IDOR guarded. |
| GET | /api/bids/sitter/{sitterId} | Session (Sitter) | route param | bid list | Lists a sitter's own bids; IDOR guarded. |

## ChildrenController  (prefix: api/parent — shares prefix with ParentController)
Class-level `[SessionAuthorize(Roles="Parent")]`.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| PUT | /api/parent/child/{childId} | Session (Parent) | multipart form + route param | `{message, childId}` | Update a child (multipart). |
| DELETE | /api/parent/child/{childId} | Session (Parent) | route param | `{message}` | Soft-delete a child. |

## CryDetectionController  (prefix: api/cry-detection)
Class-level `[SessionAuthorize]` (no role); role enforced in code.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| POST | /api/cry-detection | Session (any) | `CryAlertDto` (JSON body) | `{roomName, message}` | Raise a cry alert; IDOR-guarded to the involved booking. |
| GET | /api/cry-detection/latest | Session (any) | query `parentId` (optional) | `{id, timestamp, roomName, level, jobId, parentId, babysitterId}` | Poll latest alert; 404 if none. |

## ImageController  (prefix: api/images)
No `[SessionAuthorize]` and no `[AllowAnonymous]` — public.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| GET | /api/images/{type}/{filename}, /api/images/default/{type}/{filename} | None (public) | route params | image bytes | Resolve + serve an image by type/name. |
| GET | /api/images/{filename}, /api/images/default/{filename} | None (public) | route param | image bytes | Serve a root image (default type). |

## JobsController  (prefix: api/jobs)
Class-level `[SessionAuthorize]` (no role); role/RBAC enforced in code.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| GET | /api/jobs | Session (any) | query `city` (optional) | open jobs list | Lists open (unassigned) jobs with slot IDs. |
| GET | /api/jobs/jobdetails/{jobId} | Session (any) | route param | job details DTO | Details for one job; 404 if missing. |
| POST | /api/jobs/confirm-bulk | Session (any; Sitter-enforced) | `BulkConfirmDto` | `{message}` | Bulk-confirm jobs for a sitter. |
| POST | /api/jobs/confirm/{jobId}/{sitterId} | Session (any; Sitter-enforced) | route params | `{message}` | Sitter accepts a job. |
| POST | /api/jobs/updateStatus/{jobId}, /api/jobs/start-session/{jobId}, /api/jobs/start/{jobId} | Session (role-based in code) | `JobStatusUpdateDto` (optional body) | `{message, jobId, status, assignedSitterId, parentId}` | Update job status; role + transition checks. |
| GET | /api/jobs/sitter/{sitterId} | Session (Sitter) | route param | jobs list | Lists a sitter's own assigned jobs; IDOR guarded. |
| GET | /api/jobs/active | Session (any) | query `babysitterId` (optional) | active job DTO | Active job for the current sitter (or babysitterId). |

## MatchingController  (prefix: api/matching)
Class-level `[SessionAuthorize]` (no role); role enforced per action; one public profile endpoint.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| GET | /api/matching/matches/{jobId} | Session (Parent) | route param | sitter list | Get matching sitters for a job. |
| POST | /api/matching/availability/save | Session (Sitter) | `AvailabilityDto` | `{message}` | Save sitter availability (rejects locked slots). |
| POST | /api/matching/availability/recurring | Session (Sitter) | `RecurringAvailabilityDto` | result | Save recurring weekly availability. |
| POST | /api/matching/filter-sitters | Session (any) | `FilterSittersDTO` | sitter list | Filter sitters by city/experience/rating. |
| GET | /api/matching/availability/{sitterId} | Session (any) | route param | availability rows | Get sitter availability (includes IsLocked). |
| DELETE | /api/matching/availability/clear/{sitterId} | Session (Sitter) | route param | `{message}` | Clear sitter availability. |
| POST | /api/matching/search-sitters | Session (any) | `SearchSittersDTO` (JSON body) | sitter list | Geo + slot match search with fallback. |
| GET | /api/matching/search-sitters, /api/matching/search | Session (any) | `SearchSittersDTO` (FromUri) | sitter list | Same as POST search via query binding. |
| GET | /api/matching/jobrequests | Session (Sitter) | query `sitterId` | job request list | Job requests for a sitter; IDOR guarded. |
| GET | /api/matching/babysitter/{id} | Anonymous | route param | `SitterDTO` | Public sitter profile (includes SitterLockedUntil). |

## NotificationsController  (prefix: api/notifications)
Class-level `[SessionAuthorize]` (no role); role/RBAC enforced in code.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| GET | /api/notifications | Session (any) | query `userId`, `userRole` | notification list | List current user's notifications; IDOR guarded. |
| PUT | /api/notifications/{id}/read | Session (any) | route param | 204 NoContent | Mark one notification as read (idempotent). |
| DELETE | /api/notifications/clear | Session (any) | query `userId`, `userRole` | 204 NoContent | Clear current user's notifications. |
| POST | /api/notifications | Session (any) | `NotificationDto` (JSON body) | 200 OK | Create a notification (internal use). |

## ReviewController  (prefix: api/review)
Class-level `[SessionAuthorize]` (no role); add is role-checked in code; sitter/parent/user are public.

| Method | Route | Auth | Request | Response | Description |
|--------|-------|------|---------|----------|-------------|
| POST | /api/review/add | Session (role-checked in code) | `ReviewDTO` (JSON body) | `{message, success}` | Submit a review; RBAC/IDOR-guarded. |
| GET | /api/review/sitter/{sitterId} | Anonymous | route param | average rating | Public aggregate sitter rating. |
| GET | /api/review/parent/{parentId} | Anonymous | route param | average rating | Public aggregate parent rating. |
| GET | /api/review/user/{userId}/{role} | Anonymous | route params | reviews list | Public aggregate reviews for a user. |