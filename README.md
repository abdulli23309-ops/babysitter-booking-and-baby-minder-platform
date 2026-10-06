# Little Care — Babysitter Booking & Baby Minder Platform

**Little Care** is a full-stack platform that connects parents who need childcare with babysitters — and goes further with live child monitoring, cry detection, feeding records and session management. Parents search, book and track babysitters; babysitters manage jobs and care sessions; both sides share one server-authoritative source of truth during an active session.

The repository is a monorepo containing the backend API and the React frontend.

---

## Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Frontend Scripts](#frontend-scripts)
- [API Overview](#api-overview)
- [Data Model](#data-model)
- [Security](#security)
- [Testing & Quality](#testing--quality)

---

## Features

### Accounts & Roles
- Two roles: **Parent** and **Babysitter**, with role-protected routes on the frontend and `[SessionAuthorize]` RBAC on every API controller.
- Registration, login, profile management, soft-deactivation.

### Sitter Search & Matching
- Search by city, date range, weekday pattern, time window and minimum rating.
- Availability matching against babysitters' published slots (one-day and recurring weekly availability).
- Optional geo-radius filtering when the parent pins a location on the map (Leaflet).
- Distance calculation, fallback search, sitter lockout during bookings.

### Bookings & Job Lifecycle
- Book for one child or all children at once; single-day bookings or repeating weekday **series**.
- Job status flow: `Open → Assigned → Sitter Arrived → In Progress → Completed / Cancelled`.
- Sitter invitations, bids, bulk confirmation, arrival confirmation and parent-started sessions with a built-in start window and travel-buffer guards.
- **Today's Required Tasks (Task Allocation)** — at booking time the parent picks from a predefined task catalogue (bottle feeding, diaper change, stroller walk, put to sleep, playtime, prepare meals). Tasks are validated server-side, persisted on the job, propagated through its whole lifecycle, and shown read-only to **both** the parent and the babysitter on their active-job screens.

### Live Child Monitoring
- WebRTC video/audio sessions powered by a **MiroTalk SFU** instance.
- **Cry detection** using a YAMNet TensorFlow.js model running in the browser.
- **Feeding recording** — care-action logging with server-side video capture.
- Guardian controls: pause/resume requests, do-not-disturb, end session; sitter-side care-action dashboard.
- Monitoring **device pairing** for an independent baby-monitor device flow.
- Session status, cry alerts and feeding history are all server-driven.

### Reviews, Ratings & Notifications
- End-of-session review flow for both roles, aggregated ratings.
- In-app notifications for invitations, confirmations, cancellations and session events.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, React Router 7, CSS Modules + design tokens, Axios, Leaflet, TensorFlow.js |
| Backend | ASP.NET **Web API 2** on **.NET Framework 4.7.2** (classic `ApiController`, attribute routing) |
| ORM | Entity Framework **6.5.1** with a database-first EDMX model (schema additions via raw SQL) |
| Serialization | Newtonsoft.Json 13 (PascalCase payloads) |
| Database | Microsoft SQL Server |
| Auth | Opaque bearer tokens backed by server-side `UserSessions` rows |
| Real-time media | MiroTalk SFU (WebRTC), served over HTTPS |
| Dev servers | IIS Express (backend, HTTPS :44368) + Vite dev server (frontend, HTTPS :5173) |

---

## Architecture

```
┌──────────────────────────────┐        /api/* proxy        ┌─────────────────────────────────┐
│  babysitter-app (React SPA)  │ ─────────────────────────▶ │  WebApplication2 (Web API 2)    │
│  HTTPS :5173 (Vite)          │   Bearer session token      │  HTTPS :44368 (IIS Express)     │
│  parent + babysitter screens │ ◀───────────────────────── │  Controllers → Services → EF6   │
└──────────────┬───────────────┘      JSON (PascalCase)      └──────────────┬──────────────────┘
               │                                                            │
               │  WebRTC media (MiroTalk SFU :3010)                         │ raw SQL + EDMX
               ▼                                                            ▼
        ┌─────────────┐                                          ┌────────────────────────┐
        │  MiroTalk   │                                          │      SQL Server        │
        │  SFU server │                                          │  BabySitterBooking ... │
        └─────────────┘                                          └────────────────────────┘
```

- The Vite dev server proxies `/api` to the backend, so the browser only ever talks to one origin.
- Auth uses opaque 128-char session tokens; the server resolves identity and role from the token — clients never dictate who they are.
- Tables outside the frozen EDMX (job children, invitations, sessions, geo columns, assigned tasks, monitoring tables…) are accessed through parameterized raw SQL — an established pattern in the service layer.

## Repository Structure

```
.
├── babysitter-app/                 # React + Vite frontend
│   ├── src/
│   │   ├── app/                    # App shell, routes, protected routes
│   │   ├── features/               # Screens (auth, parent, babysitter, monitoring, reviews…)
│   │   ├── components/             # UI, layout and monitoring components (CSS Modules)
│   │   ├── hooks/                  # useMonitoring, useDeviceFeeding, …
│   │   ├── services/               # Axios API client + endpoint wrappers
│   │   ├── styles/                 # Design tokens (tokens.css) + globals
│   │   └── utils/                  # date, image, series and task-catalogue helpers
│   └── public/                     # Static assets (incl. the YAMNet cry-detection model)
├── WebApplication2/                # ASP.NET Web API 2 backend
│   ├── Controllers/                # REST endpoints (auth, parent, jobs, matching, monitoring…)
│   ├── Services/                   # Business logic (JobService, MatchingService, …)
│   ├── DTOs/                       # Request/response contracts
│   ├── Models/                     # EF6 EDMX-generated entities (frozen)
│   ├── Infrastructure/             # RBAC, session auth, validation, task catalogue
│   ├── Enums/                      # JobStatus, UserRole, …
│   └── docs/database/              # Idempotent SQL schema scripts (out-of-EDMX columns)
├── docs/database/                  # SQL scripts for the monitoring/feeding schema phases
└── README.md                       # ← this file
```

---

## Getting Started

### Prerequisites

- Windows with **Visual Studio** (ASP.NET & web development workload) or MSBuild 15+
- **SQL Server** (Express is fine) + SSMS or `sqlcmd`
- **Node.js 18+** (20/22 recommended)
- Chrome/Edge for the local HTTPS dev certificates

### 1. Database

1. Create (or reuse) a SQL Server database — the default name used by the project is `BabySitterBooking and BabyMinder`.
2. Point the connection string at your instance in `WebApplication2/Web.config`:

   ```xml
   <add name="BabySitterBooking_and_BabyMinderEntities"
        connectionString="metadata=res://*/Models.Model1.csdl|...;
        provider connection string='data source=YOUR_SERVER;initial catalog=BabySitterBooking and BabyMinder;
        integrated security=True;trustservercertificate=True;MultipleActiveResultSets=True;App=EntityFramework'"
        providerName="System.Data.EntityClient" />
   ```

3. Create the base schema from the EDMX model (Database-First), then apply the idempotent feature scripts — all are safe to re-run (`IF NOT EXISTS` guards):

   ```
   WebApplication2/docs/database/add_geo_columns.sql
   WebApplication2/docs/database/add_job_invitations.sql
   WebApplication2/docs/database/add_cancellation_and_lockout_columns.sql
   WebApplication2/docs/database/add_assigned_tasks_column.sql
   docs/database/phase2_monitoring_foundation.sql
   docs/database/phase5_6_escalation_scheduler.sql
   docs/database/phase7_guardian_pause_dnd.sql
   docs/database/phase13_independent_monitoring.sql
   docs/database/phase14_feeding_recording.sql
   ```

### 2. Backend

```powershell
# Visual Studio: open WebApplication2\WebApplication2.slnx (or .csproj) and press F5.
# Or build from the CLI:
msbuild WebApplication2\WebApplication2.csproj /p:Configuration=Debug
```

The API must answer on **`https://localhost:44368`** (IIS Express). The frontend proxies `/api` to this address — keep them in sync if you change the port (see `babysitter-app/vite.config.js`).

### 3. Frontend

```powershell
cd babysitter-app
npm install
npm run dev          # https://localhost:5173
```

> The dev server serves **HTTPS** using a local certificate (see `vite.config.js` — `VITE_TLS_KEY` / `VITE_TLS_CERT`, falling back to the MiroTalk SSL cert). Trust the local CA once and both the frontend and the media server work without browser warnings.

> **Note:** on the original development machine a convenience launcher (`start-littlecare-dev.ps1`) exists locally — it detects the LAN IP, regenerates certificates and starts MiroTalk + backend + frontend in one command. It is intentionally not tracked in this repository.

---

## Configuration

| File | Purpose |
|---|---|
| `WebApplication2/Web.config` | Connection strings, CORS origins, session expiry, app settings |
| `WebApplication2/Web.MonitoringMedia.config` | MiroTalk room salt + media server URL (template: `Web.MonitoringMedia.config.example`) |
| `WebApplication2/Web.FeedingVideo.config` | Feeding-video storage settings (template: `Web.FeedingVideo.config.example`) |
| `babysitter-app/vite.config.js` | Dev port, TLS material, `/api` proxy target |
| `babysitter-app/.env` | Optional `VITE_API_BASE` for non-proxied deployments |

---

## Frontend Scripts

```powershell
cd babysitter-app
npm run dev        # Vite dev server (HTTPS :5173)
npm run build      # Production build → dist/
npm run preview    # Preview the production build
npm run lint       # ESLint + CSS-module reference checker
```

---

## API Overview

All endpoints require `Authorization: Bearer <session-token>` except the auth endpoints. Base path: `/api`. Payloads are PascalCase JSON.

| Area | Key endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /parent/login`, `POST /babysitter/login`, `POST /auth/logout` |
| Children | `GET /parent/children/{parentId}`, `POST /parent/child`, `PUT /parent/child/{id}` |
| Search | `POST /matching/search-sitters`, `GET /matching/babysitter/{id}` |
| Booking | `POST /parent/create-job` (accepts `AssignedTasks`), `GET /parent/jobs/{parentId}` |
| Jobs | `GET /jobs/jobdetails/{jobId}` (returns `AssignedTasks`), `POST /jobs/confirm-bulk`, `POST /jobs/updateStatus/{jobId}`, `GET /jobs/active` |
| Invitations / bids | `POST /jobinvitations/...`, `POST /bids/accept/{id}` |
| Reviews | `POST /review/...`, `GET /review/...` |
| Monitoring | session, cry and feeding endpoints under `/monitoring`, `/independentmonitoring`, `/feeding/*` |
| Notifications | `GET /notifications/{userId}` |

The authoritative request/response contracts live next to the code in `WebApplication2/DTOs/`.

---

## Data Model

**Core (EDMX-mapped):** `Parent`, `Babysitter`, `Child`, `Job`, `JobTimeSlot`, `Bid`, `Review`, `Notification`, `SitterAvailability`, `TimeSlot`, `UserSession`.

**Outside the EDMX** (accessed via parameterized raw SQL — scripts listed in [Getting Started](#getting-started)):

- `JobChildren` — multi-child bookings
- `JobInvitation` — sitter invitations per job
- `UserSessions` — opaque token sessions
- `Job.Latitude` / `Job.Longitude` — geo matching
- `Job.AssignedTasks` — JSON array of stable task ids chosen at booking time (e.g. `["bottle-feeding","diaper-change"]`) powering **Today's Required Tasks**
- Monitoring/feeding tables — sessions, cry incidents, escalations, feeding recordings, device pairing

**Job status lifecycle:** `Open → Assigned → Sitter Arrived → In Progress → Completed / Cancelled`.

---

## Security

- Opaque 128-char bearer tokens mapped to `UserSessions` rows — revocable server-side, expiry driven by configuration.
- `[SessionAuthorize]` role gates on controllers plus ownership (IDOR) checks on every job/child/parent resource: a parent only sees their own jobs, a sitter only their assigned or invited ones.
- BCrypt password hashing with automatic upgrade of legacy plaintext hashes on login.
- The server never trusts client-supplied identity or content — `ParentId`, roles and `AssignedTasks` are validated against server-side state and the authoritative task catalogue (unknown task ids are rejected with `400`).
- One global CORS policy driven by `AllowedCorsOrigins` in `Web.config`.

---

## Testing & Quality

- `npm run lint` — ESLint (flat config + React Hooks rules) **and** a custom checker that fails when a `styles.X` reference has no matching CSS-module class.
- `npm run build` — production build gate for the frontend.
- The backend builds clean with MSBuild; endpoint behaviour is verified against the security/authorization matrix (session auth, RBAC, IDOR, payload validation).
- Local end-to-end automation (browser-driven booking → active-session verification) exists on the development machine but is intentionally not tracked in this repository.

---

<p align="center"><b>Little Care — nurturing with love and safety.</b></p>


