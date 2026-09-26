# Database Setup & Configuration Guide

## 1. SQL Server Configuration
- Database Engine: Microsoft SQL Server 2019 / 2022 / Express
- Initial Catalog: `BabySitterBooking and BabyMinder`
- Authentication: Windows Authentication (`Integrated Security=True`) or SQL Authentication.

## 2. Canonical Schema Scripts
Located in repository root `database/`:
1. `database/SQLQuery for fyp.sql`: Base schema definition (Parents, Babysitters, Children, Jobs, JobTimeSlots, Bids, Reviews, CryAlerts, Notifications).
2. `database/Create_UserSessions.sql`: Creates the `UserSessions` session token management table:
```sql
CREATE TABLE UserSessions (
    Token NVARCHAR(128) PRIMARY KEY,
    UserId INT NOT NULL,
    Role NVARCHAR(50) NOT NULL,
    CreatedAt DATETIME NOT NULL,
    ExpiresAt DATETIME NOT NULL
);
```

## 3. Entity Framework 6 Integration
- Architecture: Database-First EDMX (`Models/Model1.edmx`).
- Connection String configured in `Web.config` under `BabySitterBooking_and_BabyMinderEntities`.
- Entity soft deletion is supported via `IsDeleted BIT NOT NULL DEFAULT 0` across all major entities.
