# Frontend ↔ Backend Integration Matrix
### Babysitter Booking & Baby Minder Platform

**Workspace:** `E:\Fyp Fazooliyaaat\Unified Backend Workspace\`
**Backend (active):** `WebApplication2\` (API-C)
**Frontend (active):** `babysitter-app\` (React + Vite)
**Date:** September 10, 2026
**Status:** Step 2 Complete (Auth migrations applied & verified) — see §4

---

## 1. Status Legend

| Status | Meaning |
|---|---|
| **OK** | Path, method, payload, and auth all match API-C |
| **MISMATCH** | Path or HTTP method is wrong |
| **PAYLOAD** | Property names or shape mismatch vs API-C DTO |
| **AUTH** | Missing or wrong Authorization header |
| **MISSING** | No API-C endpoint exists for this frontend call |
| **ORPHAN** | API-C route with no frontend caller |

---

## 2. Auth Architecture

- **Centralized client:** `src/services/apiClient.js` — single Axios instance with request interceptor that auto-attaches `Authorization: Bearer <token>` from `sessionStorage.js`, and a response interceptor that catches 401 → clears session → redirects to `/login`.
- **Helper layer:** `src/services/api.js` exposes `API.*` methods that route through `apiClient` (`apiGet`, `apiPost`, `apiPut`, `apiDelete`).
- **Base URL:** `import.meta.env.VITE_API_BASE || '/api'` — uses Vite dev proxy (`/api` → `https://localhost:44368`) when no env override is set.
- **Session:** `src/services/sessionStorage.js` stores `userId`, `role`, `user`, `token`, `expiresAt` in `localStorage`.

**Key finding:** Several screens bypass `apiClient` with raw `fetch()` calls that either lack the Bearer token entirely or read `localStorage.getItem('token')` directly instead of using the centralized `getToken()`. These are the primary AUTH-status items below.

---

## 3. Endpoint-by-Endpoint Matrix

### 3.1 Auth & Registration

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Login | `features/auth/login.jsx` | POST | `/api/babysitter/login`, `/api/parent/login` | `api/babysitter/login`, `api/parent/login` | POST | OK | N/A (public) | **OK** |
| Register (parent) | `features/auth/CreateAccount.jsx` | POST | `/api/parent/register` | `api/parent/register` | POST | OK | N/A (public) | **OK** (via `API.registerParent`) |
| Register (sitter) | `features/auth/Register.jsx` | POST | `/api/babysitter/register` | `api/babysitter/register` | POST | OK | N/A (public) | **OK** (via `API.registerSitter`) |

### 3.2 Sitter Availability (PRIORITY)

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Save availability | `features/babysitter/SetAvailability.jsx` | POST | `/api/matching/availability/save` | `api/matching/availability/save` | POST | OK (+ Lat/Lng/Radius) | YES (`API.saveAvailability`) | **OK** |
| Recurring availability | `features/babysitter/SetAvailability.jsx` | POST | `/api/matching/availability/recurring` | `api/matching/availability/recurring` | POST | OK | YES | **OK** |
| Get availability | `API.getSitterAvailability` | GET | `/api/matching/availability/{sitterId}` | `api/matching/availability/{sitterId}` | GET | OK | YES | **OK** |
| Clear availability | `API.clearAllAvailability` | DELETE | `/api/matching/availability/clear/{sitterId}` | `api/matching/availability/clear/{sitterId}` | DELETE | OK | YES | **OK** |

### 3.3 Map (Radius Picker)

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Map tiles | `components/ui/GoogleMapRadiusPicker.jsx` | GET | OpenStreetMap tiles (external) | N/A (external) | N/A | N/A | N/A | **OK** (free, no API key) |
| Geocode (Nominatim) | `GoogleMapRadiusPicker.jsx` | GET | `nominatim.openstreetmap.org` (external) | N/A (external) | N/A | N/A | N/A | **OK** (free) |

**Map implementation:** Despite the filename, the component uses **Leaflet + OpenStreetMap** (free, no billing/API key). `package.json` declares only `leaflet` + `react-leaflet`. Default radius is **3 km**, draggable pin, radius circle, geolocation with fallback, click-to-place — all present. No remediation needed.

### 3.4 Parent — Search & Jobs

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Search sitters | `features/parent/SearchBabySitter.jsx` | POST | `/api/matching/search-sitters` | `api/matching/search-sitters` | POST | OK (PascalCase) | **PARTIAL** (raw fetch, manual token) | **AUTH** |
| Get open jobs | `API.getJobs` | GET | `/api/jobs?city=` | `api/jobs` | GET | OK | YES | **OK** |
| Job details | `API.getJobDetails` | GET | `/api/jobs/jobdetails/{jobId}` | `api/jobs/jobdetails/{jobId}` | GET | OK | YES | **OK** |
| Matching sitters | `API.getMatchingSitters` | GET | `/api/matching/matches/{jobId}` | `api/matching/matches/{jobId}` | GET | OK | YES | **OK** |
| Get parent jobs | API | GET | `/api/parent/jobs/{parentId}` | `api/parent/jobs/{parentId}` | GET | OK | YES | **OK** |
| Create job | `features/parent/BabySitterDetails.jsx` | POST | `/api/parent/create-job` | `api/parent/create-job` | POST | OK (PascalCase) | YES (`API.createJob` + interceptor) | **OK** |

### 3.5 Parent — Active / Upcoming Job (Session)

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Start session | `features/parent/ParentUpcomingJobScreen.jsx:55` | POST | `/api/jobs/updateStatus/{jobId}` | `api/jobs/updateStatus/{jobId}` | POST | OK | **NO** (raw fetch, no header) | **AUTH** |
| Cancel booking | `features/parent/ParentUpcomingJobScreen.jsx:81` | POST | `/api/jobs/updateStatus/{jobId}` | `api/jobs/updateStatus/{jobId}` | POST | OK | **NO** (raw fetch, no header) | **AUTH** |
| End session | `features/parent/ParentActiveJobScreen.jsx:61` | POST | `/api/jobs/updateStatus/{jobId}` | `api/jobs/updateStatus/{jobId}` | POST | OK | **NO** (raw fetch, no header) | **AUTH** |

### 3.6 Parent — Children

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Create child | `features/parent/SetChildProfile.jsx:43` | POST | `/api/parent/child` | `api/parent/child` | POST | OK (multipart) | **NO** (raw fetch, no header) | **AUTH** |
| Update child | `features/parent/UpdateChildProfileScreen.jsx:41` | PUT | `/api/parent/child/{childId}` | `api/parent/child/{childId}` | PUT | OK (multipart) | **NO** (raw fetch, no header) | **AUTH** |
| Get children | `features/parent/{BabySitterDetails,ChildProfile,ParentActiveJobScreen}.jsx` | GET | `/api/parent/children/{userId}` | `api/parent/children/{parentId}` | GET | OK | **NO** (raw fetch, no header) | **AUTH** |
| Delete child | `features/parent/*` | DELETE | `/api/parent/child/{childId}` | `api/parent/child/{childId}` | DELETE | OK | YES (`apiDelete`) | **OK** |

### 3.7 Notifications

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Get notifications | `features/notifications/ParentNotifications.jsx:67` | GET | `/api/notifications?userId=&userRole=Parent` | `api/notifications` | GET | OK | **PARTIAL** (raw fetch, manual token) | **AUTH** |
| Mark read / Clear all | via `apiGet`/`apiDelete` | PUT/DELETE | `/api/notifications/{id}/read`, `/api/notifications/clear` | matching | PUT/DELETE | OK | YES | **OK** |

### 3.8 Cry Detection

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Post cry alert | `features/cry/CryDetector.jsx` | POST | `/api/cry-detection` | `api/cry-detection` | POST | OK | YES (`apiPost`) | **OK** |
| Latest alert | `features/cry/CryDetector.jsx`, `ChildCryAlertScreen.jsx:76` | GET | `/api/cry-detection/latest?parentId=` | `api/cry-detection/latest` | GET | OK | **NO** (raw fetch, no header) | **AUTH** |

### 3.9 Reviews, Bids, Images

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Add/get reviews | via `apiPost`/`API.getUserReviews` | POST/GET | `/api/review/*` | matching | POST/GET | OK | YES | **OK** |
| Job requests | `API.getJobRequests` | GET | `/api/matching/jobrequests?sitterId=` | matching | GET | OK | YES | **OK** |
| Bids (place/accept) | via `apiPost` | POST | `/api/bids/place`, `/api/bids/accept/{bidId}` | matching | POST | OK | YES | **OK** |
| Get image | `utils/imageUtils.js` + screens | GET | `/api/images/{type}/{filename}` | matching | GET | OK | N/A (public) | **OK** |

### 3.10 ORPHAN Routes (API-C routes with no frontend caller)

| API-C route | Method | Notes |
|---|---|---|
| `api/matching/search-sitters` (GET) | GET | Additive Round-2 route; frontend uses POST variant |
| `api/matching/search` (GET) | GET | Additive Round-2 route; frontend uses POST variant |

### 3.11 Sitter Profile & Update

| Frontend screen | Frontend file | Method | Frontend path | API-C route | API-C method | Payload match? | Auth header? | Status |
|---|---|---|---|---|---|---|---|---|
| Get sitter profile | `features/babysitter/UpdateProfile.jsx` | GET | `/api/matching/babysitter/{id}` | `api/matching/babysitter/{id}` | GET | OK | N/A (public) | **OK** (via `API.getSitterProfile`) |
| Update sitter profile | `features/babysitter/UpdateProfile.jsx:152` | PUT | `/api/babysitter/update/{sitterId}` | (none) | — | N/A | N/A | **MISSING** — backend exposes no sitter-update route (BabySitterController: register/login/earnings/deactivate only). Document-only; requires new backend endpoint. |

---

## 4. Summary of Findings

| Category | Count | Action |
|---|---|---|
| **OK** (fully matched) | ~33 | Verified |
| **AUTH** (raw fetch bypassing `apiClient`) | 0 | All migrated to `API.*` (Step 2) |
| **PAYLOAD** | 0 | — |
| **MISMATCH** | 0 | — |
| **MISSING** | 1 | `PUT /api/babysitter/update/{id}` — backend has no such route (document-only) |
| **DOCUMENT ONLY** (schema-gated) | 2 | Lat/Lng/RadiusKm persistence; default-avatar seeding — Phase 16/17 |
| **POLLING** | 1 | Set Availability uses 30s; **Step 4** → 5s |

### Files migrated to `API.*` (Step 2 — verified by `npm run lint` + `npm run build`):
1. `src/features/auth/CreateAccount.jsx` — `API.registerSitter` (`POST /api/babysitter/register`)
2. `src/features/auth/Register.jsx` — `API.registerParent` (`POST /api/parent/register`)
3. `src/features/parent/BabySitterDetails.jsx` — `API.createJob` (`POST /api/parent/create-job`)
4. `src/features/parent/BabySitterDetails2.jsx` — added missing `API` import for `API.submitReview`
5. `src/features/babysitter/UpdateProfile.jsx` — `API.getSitterProfile` (`GET /api/matching/babysitter/{id}`)

Previously migrated in earlier rounds (confirmed present): `SearchBabySitter.jsx` (searchSitters), `ParentUpcomingJobScreen.jsx`/`ParentActiveJobScreen.jsx` (updateJobStatus), `SetChildProfile.jsx` (createChild), `UpdateChildProfileScreen.jsx` (updateChild), `ParentNotifications.jsx` (getNotifications), `CryDetector.jsx`/`ChildCryAlertScreen.jsx` (getLatestCryAlert), `ParentDashboard.jsx` (getNotifications).

### `api.js` wrappers added in Round 2 of frontend integration:
- `registerParent(formData)` / `registerSitter(formData)` — public multipart registration
- `getSitterProfile(sitterId)` — public sitter profile GET
- `createJob(payload)` — parent job creation (auth via interceptor)

---

## 5. Constraints Confirmed

- No API-A / API-B modifications.
- No EDMX / schema / migration changes.
- No auth design changes (BCrypt + opaque session tokens preserved).
- No route removals or renames on API-C.
- Frontend fixes are frontend-only (centralize on existing `apiClient`).


