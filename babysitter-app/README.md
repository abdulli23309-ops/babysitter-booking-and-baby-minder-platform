# Little Care - Babysitter Booking & Baby Minder FYP

An elite, full-featured modern web application connecting verified caregivers with parents, featuring real-time AI acoustic baby cry detection and WebRTC video monitoring.

---

## 🚀 Tech Stack & Architecture

- **Frontend Framework:** React 19 + Vite (Fast HMR & Optimized Production Bundles)
- **Routing:** React Router v7 with role-based route protection and 404 catch-all
- **Styling Architecture:** Pure CSS Modules + CSS Custom Properties (`tokens.css`, `globals.css`)
  - **Design System:** Glassmorphism 2.0 (translucent frosted overlays, layered depth, soft drop shadows)
  - **Desktop Constraint:** Centered 480px app-shell frame replicating a native mobile app feel
  - **Zero UI Frameworks:** 0 Tailwind, 0 Bootstrap, 0 external UI bloat
- **Backend Architecture:** ASP.NET Core Web API
- **Authentication:** Database-Backed Opaque Session Tokens (No client-side JWT decoding)
- **AI & Real-Time Media:**
  - **Acoustic Cry Detection:** TensorFlow.js (YAMNet) neural graph model with dual spectral frequency fallback
  - **Live Video Monitoring:** WebRTC Video via Jitsi Meet SDK (`@jitsi/react-sdk`)
- **PWA Ready:** Installable Progressive Web App with standalone display mode and custom manifest

---

## 📦 Project Structure

```
src/
├── app/                  # Application root & role-based ProtectedRoute
├── assets/               # Local static image assets and avatars
├── components/
│   ├── layout/           # Shared shell, AppLayout, ParentBottomNav, BabysitterBottomNav
│   └── ui/               # Reusable Glassmorphic primitives (Button, Input, Modal, Toast, EmptyState)
├── features/
│   ├── auth/             # Login, Register, CreateAccount, RoleSelection, Splash, AuthContext
│   ├── babysitter/       # Dashboard, My Jobs, Active/Upcoming/Completed details, Earnings
│   ├── cry/              # Neural AI Cry Detector with radar animation & oscilloscope
│   ├── error/            # NotFoundScreen (404) & global ErrorBoundary
│   ├── notifications/    # Parent & Babysitter in-app notification centers
│   ├── parent/           # Dashboard, Sitter Search, Booking, Live Monitor, Cry Alerts
│   └── reviews/          # Post-session rating and review workflows
├── styles/               # Design tokens, global resets, and typography
├── index.css             # Base gradient background & shell layout
└── main.jsx              # Application bootstrap & entry point
```

---

## 🛠️ Getting Started

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

## 🛡️ License
Developed for Final Year Project (FYP) — All rights reserved.

