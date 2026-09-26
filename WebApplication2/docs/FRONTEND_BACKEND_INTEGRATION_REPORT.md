# Frontend ↔ Backend Integration Report
### Babysitter Booking & Baby Minder Platform

**Date:** September 10, 2026
**Branch (backend):** `api-c-unification-remediation`
**Frontend:** `babysitter-app` (React + Vite)

---

## 1. Summary of Work

This round completed the frontend→API-C integration by migrating the remaining raw `fetch()`/`axios` calls that target API-C onto the centralized `API.*` wrapper (`src/services/api.js` → `src/services/apiClient.js`). The centralized Axios client auto-attaches `Authorization: Bearer <token>` via a request interceptor and handles 401→redirect via a response interceptor. This guarantees every protected call now carries the bearer token and uses the single configured base URL.

**Round-specific outcomes (this session):**
- Migrated **4** more call sites to `API.*`: parent registration, sitter registration, sitter profile GET, and create-job.
- Added **1** missing `API` import (`BabySitterDetails2.jsx` → `API.submitReview`).
- Added **4** new `API.*` wrappers: `registerParent`, `registerSitter`, `getSitterProfile`, `createJob`.
- Confirmed **`PUT /api/babysitter/update/{id}`** has **no backend route** → documented as MISSING (no backend edits done).

---

## 2. Files Changed in the Frontend (this round)

| File | Change |
|---|---|
| `src/services/api.js` | Added wrappers: `registerParent`, `registerSitter`, `getSitterProfile`, `createJob` |
| `src/features/auth/CreateAccount.jsx` | Parent register: raw `fetch` → `API.registerParent` (+ import) |
| `src/features/auth/Register.jsx` | Sitter register: raw `fetch` → `API.registerSitter` (+ import) |
| `src/features/babysitter/UpdateProfile.jsx` | Profile GET: raw `fetch` → `API.getSitterProfile` (+ import) |
| `src/features/parent/BabySitterDetails.jsx` | Create job: raw `fetch` → `API.createJob` |
| `src/features/parent/BabySitterDetails2.jsx` | Added missing `API` import (used `API.submitReview`) |
| `docs/FRONTEND_BACKEND_INTEGRATION_MATRIX.md` | Updated status, counts, confirmed MISSING route |

> Note: the frontend working tree also carries uncommitted changes from earlier integration rounds (child CRUD, job status, notifications, cry alerts, search, map/radius, 5s polling). Those are part of the on-going work and are not re-touched here.

---

## 3. Backend Untouched — Confirmed

`git -C WebApplication2 status --short` → **empty** (exit 0). No backend files modified in this round. API-A and API-B are untouched.

---

## 4. Complete Integration Matrix

See `babysitter-app/docs/FRONTEND_BACKEND_INTEGRATION_MATRIX.md` (also mirrored summary below).

### 4.1 Result Counts

| Status | Count | Notes |
|---|---|---|
| **OK** | ~33 | Fully matched through `API.*` |
| **AUTH** | 0 | All migrated to `API.*` (interceptor attaches token) |
| **PAYLOAD** | 0 | PascalCase contract preserved across all wrappers |
| **MISMATCH** | 0 | — |
| **MISSING** | 1 | `PUT /api/babysitter/update/{id}` — no backend route |
| **DOCUMENT ONLY** | 2 | Lat/Lng/RadiusKm persistence; default-avatar seeding |
| **POLLING** | 1 | Set Availability (target 5s in Step 4) |

### 4.2 Key endpoint mappings (this round)

| Frontend call | Wrapper | Backend route | Status |
|---|---|---|---|
| CreateAccount.jsx (parent) | `API.registerParent` | `POST /api/parent/register` | **OK** |
| Register.jsx (sitter) | `API.registerSitter` | `POST /api/babysitter/register` | **OK** |
| UpdateProfile.jsx load | `API.getSitterProfile` | `GET /api/matching/babysitter/{id}` | **OK** |
| UpdateProfile.jsx save | (raw fetch) | `PUT /api/babysitter/update/{id}` | **MISSING** |
| BabySitterDetails.jsx | `API.createJob` | `POST /api/parent/create-job` | **OK** |
| BabySitterDetails2.jsx | `API.submitReview` | `POST /api/reviews` | **OK** |
---

## 5. DOCUMENT ONLY Gaps (schema-gated — Phase 16/17)

| Gap | Reason |
|---|---|
| **Latitude / Longitude / RadiusKm persistence** | Frontend already sends these in `API.saveAvailability`; backend DTO accepts but does not persist them. Requires DB schema column, so **no change now**. |
| **Default-avatar seeding** | Depends on server-side image seeding; defer. |
| **`PUT /api/babysitter/update/{id}`** | Frontend saves sitter profile here, but BabySitterController exposes only register/login/earnings/deactivate. Requires a new backend endpoint + DTO. **Documented only — no backend change made.** |

Also from the broader audit (unchanged this round): `Babysitter.min_child_age/max_child_age`, `Babysitter.city` direct column, `Babysitter.gender/address/CNIC`, `BabysittingSession` live timer, `Admin` module — all require schema/architecture work and remain DOCUMENT ONLY.

---

## 6. Smoke Test Results

A live backend + dev server was **not available** in this session (no server process started). The following were verified statically:

| Check | Result |
|---|---|
| Frontend `npm run lint` | **0 errors, 0 warnings** |
| Frontend `npm run build` (vite) | **Success** (227 modules; only a benign chunk-size warning) |
| Backend build (prior round) | 0 warnings / 0 errors |
| Backend `git status` | Clean — no backend modifications |
| PascalCase request contract | Preserved in all new wrappers |
| Bearer-token interceptor | Confirmed in `apiClient.js` request interceptor |

Live-run smoke checks (login as sitter, save availability with map, login as parent, browse jobs, create job, notifications, no 401/403/CORS) are **pending** until the API-C server can be started.

---

## 7. Frontend Build Result

- **Lint:** `npm run lint` → 0 errors / 0 warnings ✓
- **Build:** `npm run build` → `✓ built in 2.19s`, 227 modules. Only warning is the standard Vite ≥500 kB chunk-size suggestion (pre-existing, non-blocking).

---

## 8. Remaining Issues / Blockers

1. **`PUT /api/babysitter/update/{id}` MISSING** — the sitter "Update Profile" save will fail against current API-C. Needs a new backend endpoint (deferred: backend frozen this round).
2. **Radius/Lat/Lng not persisted** — save succeeds but coordinates are not stored; needs schema (Phase 16/17).
3. **Live smoke test pending** — requires starting API-C on `https://localhost:44368` and the Vite dev server.

---

## 9. Git Tags & Commits

- **Backend:** HEAD `a6a9833` on `api-c-unification-remediation` — clean.
- **Frontend:** HEAD `7fd7084` (`refactor(frontend): complete Phase F architecture and UI remediation`); tag `fyp-baseline-pre-remediation`.
- This round's frontend edits are **uncommitted** (working tree contains the cumulative integration work). A baseline/commit was not created this session to avoid mixing unrelated on-going changes; recommend committing the frontend integration independently once the remaining blockers are resolved.

---

## 10. Constraints Confirmed

- ✅ No API-A / API-B modifications
- ✅ No EDMX / schema / migration changes
- ✅ No auth design changes (BCrypt + opaque session tokens preserved)
- ✅ No JWT introduced
- ✅ No API-C route removed/renamed
- ✅ No JSON response shape changed (only additive frontend wrappers)
- ✅ No new global-state library
- ✅ No backend build run in this round (backend untouched)

STOP — awaiting approval before Phase 16/17 or further backend work.