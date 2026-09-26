# System Architecture — Babysitter Booking & Baby Minder Backend

## 1. Overview
The Babysitter Booking & Baby Minder Platform backend is an enterprise monolithic REST API built on **ASP.NET Web API 5.x** running on **.NET Framework 4.7.2**, interfacing with **SQL Server** via **Entity Framework 6 (EF6 Database-First)**.

## 2. Technology Stack
- **Framework:** ASP.NET Web API 5.x / .NET Framework 4.7.2
- **Data Access:** Entity Framework 6.5.1 (EDMX Database-First Architecture)
- **Database Engine:** Microsoft SQL Server
- **Hosting / Web Server:** Microsoft IIS / IIS Express (Port 44368)
- **Security & Session Engine:** Database-Backed Opaque Session Tokens (`UserSessions` table)
- **Password Hashing:** BCrypt.Net-Next (WorkFactor = 11)
- **Serialization:** Newtonsoft.Json 13.0.3

## 3. Layered Design
```
┌─────────────────────────────────────────────────────────────┐
│                 Client Layer (React 19 / Vite)              │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / JSON
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          Perimeter Security & Session Filter                │
│    [SessionAuthorize] Attribute -> UserSessions Table       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│           Fail-Fast Perimeter Validation                    │
│             ValidationHelper.cs Engine                      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Controllers (10)                       │
│    AuthController, ParentController, BabySitterController,  │
│    ChildrenController, JobsController, MatchingController,  │
│    NotificationsController, ReviewController,               │
│    CryDetectionController, ImageController                  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                DTOs (Request & Response)                    │
│      Isolated Contract Boundary from Raw Database Models    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Entity Framework 6 (EDMX)                     │
│    Model1.edmx -> SQL Server Database Context               │
└─────────────────────────────────────────────────────────────┘
```

## 4. Key Architectural Patterns
1. **Perimeter Defense:** All incoming inputs are checked before reaching the database via `ValidationHelper.cs`, preventing unhandled 500 exceptions and database connection leaks.
2. **Session-Based Opaque Bearer Tokens:** Authentication avoids JWT in favor of stateful, revokable database tokens stored in `UserSessions`. Revocation is immediate upon logout or account soft deletion.
3. **IDOR Prevention:** Route IDs and request IDs are validated against the authenticated `ClaimsPrincipal` derived from the session token.
4. **Soft Deletion (`IsDeleted`):** Entities (Parents, Babysitters, Children, Jobs, Reviews, CryAlerts) are marked `IsDeleted = true` instead of physical deletion to preserve historical referential integrity.
