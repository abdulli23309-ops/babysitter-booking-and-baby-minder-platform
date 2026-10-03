# Little Care - Babysitter Booking & Baby Minder FYP

An elite, full-featured modern web application connecting verified caregivers with parents, featuring real-time AI acoustic baby cry detection and WebRTC video monitoring.

---

## ðŸš€ Tech Stack & Architecture

- **Frontend Framework:** React 19 + Vite (Fast HMR & Optimized Production Bundles)
- **Routing:** React Router v7 with role-based route protection and 404 catch-all
- **Styling Architecture:** Pure CSS Modules + CSS Custom Properties (`tokens.css`, `globals.css`)
  - **Design System:** Glassmorphism 2.0 (translucent frosted overlays, layered depth, soft drop shadows)
  - **Desktop Constraint:** Centered 480px app-shell frame replicating a native mobile app feel
  - **Zero UI Frameworks:** 0 Tailwind, 0 Bootstrap, 0 external UI bloat
- **Backend Architecture:** ASP.NET Web API 2 on .NET Framework 4.7.2, EF6 Database-First, SQL Server
- **Authentication:** Database-Backed Opaque Session Tokens (No client-side JWT decoding)
- **AI & Real-Time Media:**
  - **Acoustic Cry Detection:** TensorFlow.js (YAMNet) neural graph model with dual spectral frequency fallback
  - **Live Video Monitoring:** Self-hosted MiroTalk SFU over HTTPS
- **PWA Ready:** Installable Progressive Web App with standalone display mode and custom manifest

---

## ðŸ“¦ Project Structure

```
src/
â”œâ”€â”€ app/                  # Application root & role-based ProtectedRoute
â”œâ”€â”€ assets/               # Local static image assets and avatars
â”œâ”€â”€ components/
â”‚   â”œâ”€â”€ layout/           # Shared shell, AppLayout, ParentBottomNav, BabysitterBottomNav
â”‚   â””â”€â”€ ui/               # Reusable Glassmorphic primitives (Button, Input, Modal, Toast, EmptyState)
â”œâ”€â”€ features/
â”‚   â”œâ”€â”€ auth/             # Login, Register, CreateAccount, RoleSelection, Splash, AuthContext
â”‚   â”œâ”€â”€ babysitter/       # Dashboard, My Jobs, Active/Upcoming/Completed details, Earnings
â”‚   â”œâ”€â”€ cry/              # Neural AI Cry Detector with radar animation & oscilloscope
â”‚   â”œâ”€â”€ error/            # NotFoundScreen (404) & global ErrorBoundary
â”‚   â”œâ”€â”€ notifications/    # Parent & Babysitter in-app notification centers
â”‚   â”œâ”€â”€ parent/           # Dashboard, Sitter Search, Booking, Live Monitor, Cry Alerts
â”‚   â””â”€â”€ reviews/          # Post-session rating and review workflows
â”œâ”€â”€ styles/               # Design tokens, global resets, and typography
â”œâ”€â”€ index.css             # Base gradient background & shell layout
â””â”€â”€ main.jsx              # Application bootstrap & entry point
```

---

## ðŸ› ï¸ Getting Started

### 1. Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn

### 2. Installation
Install the project dependencies:
```bash
npm install
```

### 3. Development Server
Start the local Vite development server:
```bash
npm run dev
```
The application will launch locally at `http://localhost:5173`.

### 4. Production Build & Verification
Lint the codebase:
```bash
npm run lint
```

Compile the optimized production bundle:
```bash
npm run build
```

Preview the production build locally:
```bash
npm run preview
```

---

## ðŸ›¡ï¸ License
Developed for Final Year Project (FYP) â€” All rights reserved.



## LAN HTTPS development

**The LAN address is handled automatically. Do not edit an IP address by hand.**

From the repository root, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1
```

That script is the single source of truth for the development LAN/media address. It detects the machine's active LAN IPv4, regenerates the Vite/MiroTalk TLS leaf certificate for that address (signed by the existing, already-trusted local CA), writes `SFU_ANNOUNCED_IP` into the MiroTalk `.env`, writes `MonitoringMediaServerUrl` into `WebApplication2\Web.MonitoringMedia.config`, and starts the services. See `docs/development/LAN_DEVELOPMENT.md` for the full design.

The Vite development server binds to `0.0.0.0` and uses HTTPS with the LAN certificate pair from `E:/MiroTalkPOC/app/ssl/cert.pem` and `key.pem` (the path the script keeps current). Override the paths with `VITE_TLS_CERT` and `VITE_TLS_KEY`. Camera and microphone access on other devices requires a secure origin.

Each demo phone must trust the issuing CA **once**: install `E:/MiroTalkPOC/app/ssl/ca.crt` into the device's trusted root certificate store, then open the frontend and MiroTalk HTTPS URLs and verify that neither shows a certificate warning. Do not bypass a warning or install the leaf certificate as a root - the CA is stable, so a device never needs re-trusting after an IP change.

The local IIS Express API certificate stays on `localhost:44368`; the Node/Vite proxy disables verification for that loopback hop only (`secure: false` in `vite.config.js`), so a trusted API certificate is not required for the proxy.

This repository does not contain certificates or private keys. Certificate trust and the physical two-phone media flow still require verification on the actual demo devices.
