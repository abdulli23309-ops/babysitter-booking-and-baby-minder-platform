# Cross-API Merge Audit & Remediation Report
### Babysitter Booking & Baby Minder Platform — Unified Backend (API-C)

**Date:** September 2026  
**Branch:** `api-c-unification-remediation`  
**Base Architecture:** API-C (`WebApplication2`)  
**Reference APIs:** API-A (`Final_year_1_project_Api`), API-B (`Final_year_1_project_Api_zain`)  
**Status:** Audit and Selective Safe Additive Merge Completed

---

## 1. Executive Summary

This report documents the deep, read-only cross-API comparative audit between **API-A**, **API-B**, and **API-C (`WebApplication2`)**, and details the selective, safe, and additive integration of genuinely valuable features and patterns identified from the legacy prototypes into the unified backend.

Every integration followed strict non-breaking constraints:
- Zero existing API-C routes, HTTP verbs, status codes, or response models were broken or altered.
- The existing EDMX / database-first model was kept 100% intact (no raw SQL schema migrations or breaking table modifications).
- Security controls (BCrypt password hashing, opaque session token store in `UserSessions`, `[SessionAuthorize]`, IDOR checks) were fully preserved and enforced.
- All additive features cleanly extend API-C's service layer architecture.

---

## 2. Comprehensive Comparison Matrix

| Feature / Domain Area | API-A (`Final_year_1_project_Api`) | API-B (`Final_year_1_project_Api_zain`) | API-C (`WebApplication2`) Baseline | Final Audit Decision | Action Taken in API-C |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Child `specialNote` field** | Present as `specialNote` string on `Child` entity | Not present (uses `guardian_details`) | Had `SpecialRequirements` in EDMX and DTOs | **MERGE NOW** | Added `SpecialNote` property to `CreateChildDto`, `UpdateChildDto`, and `ChildDto`. Updated `ChildService` to map `SpecialRequirements` to `SpecialNote` and accept both in multipart forms and JSON. |
| **Pre-mutation Validation Ordering** | Missing (adds entity directly to DbContext without checking related state) | Present in `SetAvailability`: strictly validates model, sitter existence, and slot items *before* database mutation | Violated in `JobService.CreateJobForSitter` (inserted job then rolled back if slots empty); missing in `AvailabilityService` (no sitter/slot existence pre-check) | **MERGE NOW** | Restructured `JobService.CreateJobForSitter` to query and validate matching `TimeSlot` coverage *before* creating the `Job` entity, removing dirty insert/delete rollbacks. Added pre-mutation sitter and slot existence validations in `AvailabilityService.SaveAvailability` and `ClearAllAvailability`. |
| **Search Fallback / No-match Behaviour** | Missing (returns empty list) | Present: if no sitters match specific slots and rating=0, falls back to returning active sitters in that city with message | Returned empty array `[]` if no sitter had exact slots on all dates | **MERGE NOW** | Added `EnableFallback` (boolean, default `false`) to `SearchSittersDTO`. When `EnableFallback == true` and no exact slot matches exist, `MatchingService.SearchSitters` falls back to returning active sitters in that city who satisfy the rating and experience filters, preserving the `List<SitterDTO>` response shape. |
| **Recurring Weekly Availability** | Present via `Schedule` entity (`day_of_week`, `time_slot`, `is_available`) | Present via `Schedule` entity (`day`, `start_time`, `end_time`) | Only supported explicit calendar dates (`AvailableDate`) via `SitterAvailability` | **MERGE NOW** (Service-level expansion) & **DOCUMENT ONLY** (Schema) | Created `IRecurringAvailabilityService` and `RecurringAvailabilityService` to expand weekly day-of-week patterns across a 1–12 week window into `SitterAvailability` records. Added `POST api/matching/availability/recurring`. Documented Code-First schema requirements for future migration. |
| **Availability Slot Modeling (`TimeSpan` vs `TimeSlot`)** | Custom string `time_slot` | Custom `TimeSpan` `start_time` / `end_time` columns directly on `Schedule` | Dedicated `TimeSlot` table with `StartTime` / `EndTime` (`TimeSpan`) linked via `JobTimeSlot` & `SitterAvailability` | **SKIP** | API-C's relational normalization (`TimeSlot` entity with `JobTimeSlot` / `SitterAvailability` foreign keys) is strictly superior and prevents data redundancy. |
| **Babysitter `min_child_age` & `max_child_age`** | Present as columns in `Babysitter` table | Present as columns in `Babysitter` table | Absent in `Babysitter` EDMX entity | **DOCUMENT ONLY** | Adding columns requires database schema changes and EDMX regeneration, which violates the zero-schema-change constraint. Documented for Phase 16/17 Code-First migration. |
| **Babysitter & Parent `cnic` field** | Present as column in `Parent` and `Babysitter` tables | Present as column in `Parent` and `Babysitter` tables | Absent in `Parent` and `Babysitter` EDMX entities | **DOCUMENT ONLY** | Requires database schema change. Documented for Phase 16/17 Code-First migration. |
| **Babysitter `gender` & `age` fields** | Present as columns | Present as columns | API-C has `DOB` (DateTime) where age is dynamically computed; gender is not in `Babysitter` EDMX | **DOCUMENT ONLY** | Age is computed dynamically from `DOB`. `Gender` requires schema alteration; documented for Phase 16/17. |
| **Job / Booking Lifecycle** | `Hire` entity (minimal fields, `status` string: "Pending"/"Active") | `Hire` entity (same minimal shape) | Full lifecycle (`Job`, `JobTimeSlot`, `Bid`, `TimeSlot`) with formal `JobStatus` enum | **SKIP** | API-C's model is vastly more comprehensive, relational, and robust. |
| **Bidding System** | Absent | Absent | Fully functional `BidService` with place/accept/reject/withdraw flows | **SKIP** | API-C is the only project with an active bidding system. |
| **Authentication & Password Storage** | Plain-text password compare; no tokens; no authorization | Plain-text password compare; no tokens; no authorization | BCrypt hashing + database-backed opaque bearer token in `UserSessions` + `[SessionAuthorize]` | **SKIP** | API-A/B auth is a critical security vulnerability and cannot be merged. |
| **Controller Architecture** | God `AuthController` (1 controller handling all actions) | God `AuthController` (1 controller handling all actions) | 10 modular domain controllers backed by a clean service layer | **SKIP** | API-C's modular controller + service layer conforms to SOLID and clean architecture principles. |
| **Review & Ratings** | Dead `Rating` entity, never exposed | Dead `Rating` entity, average calculated ad-hoc in search | Fully implemented `ReviewService` with CRUD, bidirectional reviews, and aggregations | **SKIP** | API-C implementation is superior and active. |
| **Notifications** | Absent | Absent | Fully implemented `NotificationService` | **SKIP** | API-C is the only project with notifications. |
| **Baby Monitoring / Cry Detection** | Absent | Absent | Fully implemented `CryAlertService` | **SKIP** | API-C is the only project with baby monitoring. |
| **Image Handling** | Absent (stored as unmanaged filenames) | Absent (stored as unmanaged filenames) | Dedicated `ImageService` with mime validation, GUID renaming, and directory containment checks | **SKIP** | API-C implementation is complete and secure. |

---

## 3. Implementation Log

### 3.1 Logical Change 1: Add Child `specialNote` Support
- **DTOs Updated:**
  - [`DTOs/CreateChildDto.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/DTOs/CreateChildDto.cs): Added `SpecialNote` to `CreateChildDto` and `ChildDto`.
  - [`DTOs/UpdateChildDTO.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/DTOs/UpdateChildDTO.cs): Added `SpecialNote` to `UpdateChildDto`.
- **Service Updated:**
  - [`Services/Implementations/ChildService.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/Services/Implementations/ChildService.cs):
    - `GetChildrenByParent`: Maps `SpecialNote = c.SpecialRequirements` alongside `SpecialRequirements = c.SpecialRequirements`.
    - `CreateChild`: Inspects `request.Form["SpecialRequirements"] ?? request.Form["specialNote"] ?? request.Form["SpecialNote"]`.
    - `UpdateChild`: Falls back to `dto.SpecialNote` if `dto.SpecialRequirements` is null.
- **Verification:** MSBuild completed with 0 errors, 0 warnings.
- **Git Commit:** `7306037` (`Final merge audit: add child specialNote`)

### 3.2 Logical Change 2: Pre-Mutation Validation Ordering
- **Services Updated:**
  - [`Services/Implementations/JobService.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/Services/Implementations/JobService.cs):
    - Restructured `CreateJobForSitter`: Pre-validates that matching `TimeSlot` IDs exist in the system for the requested time range *prior* to inserting the `Job` entity into the database. Eliminated the dirty insert-then-remove rollback anti-pattern.
  - [`Services/Implementations/AvailabilityService.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/Services/Implementations/AvailabilityService.cs):
    - `SaveAvailability`: Validates sitter existence and active status (`!sitter.IsDeleted`) before executing any database mutations.
    - `SaveAvailability`: Validates that all provided `SlotIds` exist in `TimeSlots` before soft-deleting existing records or inserting new ones.
    - `ClearAllAvailability`: Validates sitter existence before soft-deleting availability records.
- **Verification:** MSBuild completed with 0 errors, 0 warnings.
- **Git Commit:** `0b3df9a` (`Final merge audit: apply pre-mutation validation ordering`)

### 3.3 Logical Change 3: Improve Search Fallback in Matching
- **DTO Updated:**
  - [`DTOs/SearchSittersDTO.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/DTOs/SearchSittersDTO.cs): Added `public bool EnableFallback { get; set; } = false;`.
- **Service Updated:**
  - [`Services/Implementations/MatchingService.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/Services/Implementations/MatchingService.cs):
    - In `SearchSitters`: If `finalSitters` is empty and `dto.EnableFallback == true`, returns the active sitters in that city meeting the minimum rating and experience requirements (adopting the API-B UX fallback pattern while keeping the `List<SitterDTO>` contract intact).
- **Verification:** MSBuild completed with 0 errors, 0 warnings.
- **Git Commit:** `aab88fd` (`Final merge audit: improve search fallback`)

### 3.4 Logical Change 4: Recurring Weekly Availability Support
- **New Files Created:**
  - [`DTOs/RecurringAvailabilityDto.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/DTOs/RecurringAvailabilityDto.cs): Defines `RecurringAvailabilityDto` and `RecurringAvailabilityResultDto`.
  - [`Services/Interfaces/IRecurringAvailabilityService.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/Services/Interfaces/IRecurringAvailabilityService.cs): Defines `SaveRecurringWeeklyAvailability` and `GetSupportedDaysOfWeek`.
  - [`Services/Implementations/RecurringAvailabilityService.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/Services/Implementations/RecurringAvailabilityService.cs): Implements recurring rule expansion across upcoming weeks into `SitterAvailability` records with full pre-mutation validation.
- **Controllers & Infrastructure Updated:**
  - [`Controllers/MatchingController.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/Controllers/MatchingController.cs): Injected `IRecurringAvailabilityService` via dual constructors and added `POST api/matching/availability/recurring` endpoint.
  - [`Infrastructure/SimpleDependencyResolver.cs`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/Infrastructure/SimpleDependencyResolver.cs): Registered `IRecurringAvailabilityService` and updated `MatchingController` instantiation.
  - [`WebApplication2.csproj`](file:///e:/Fyp%20Fazooliyaaat/Unified%20Backend%20Workspace/WebApplication2/WebApplication2.csproj): Added compile items for the new DTO and Service files.
- **Verification:** MSBuild completed with 0 errors, 0 warnings.
- **Git Commit:** `9dd4f66` (`Final merge audit: add recurring availability support and documentation`)

---

## 4. Remaining Gaps & Blueprint for Future Phases (Phase 16/17)

The following items from API-A/B cannot be safely integrated today because they require database schema modifications or architectural additions outside the scope of this remediation:

### 1. Code-First Unified `Availability` Entity
- **Current State:** API-C uses `SitterAvailability` with `AvailableDate` (`DateTime`). Recurring availability is achieved via service-level date expansion.
- **Target Schema (Code-First EF Core Migration):**
  ```csharp
  public class Availability
  {
      public int Id { get; set; }
      public int BabysitterId { get; set; }
      public DateTime? SpecificDate { get; set; } // null = weekly recurring rule
      public DayOfWeek? DayOfWeek { get; set; }   // null = one-off date
      public TimeSpan StartTime { get; set; }
      public TimeSpan EndTime { get; set; }
      public string City { get; set; }
      public bool IsDeleted { get; set; }
  }
  ```

### 2. Babysitter Profile Enrichment Fields
- **Fields in API-A/B:**
  - `min_child_age` (`int?`), `max_child_age` (`int?`)
  - `cnic` (`string`) on both `Parent` and `Babysitter`
  - `gender` (`string`) on `Babysitter`
- **Target Action:** Add these properties to the Code-First `Parent` and `Babysitter` entities during the Code-First migration phase.

### 3. Babysitting Session Live Duration Tracking
- **Current State:** API-C transitions `Job.Status` to `"In Progress"` on session start, but does not record an actual start/stop timestamp entity.
- **Target Schema:** Introduce `BabysittingSession` (`JobId`, `ActualStartTime`, `ActualEndTime`, `DurationMinutes`) backed by server-authoritative timestamps to power the frontend's live timer screen.

### 4. Admin Module
- **Current State:** Missing in all three legacy APIs.
- **Target Action:** Design `Admin` entity and dashboard endpoints during the dedicated Admin phase.

---

## 5. Verification Sign-Off

- **Rebuild Command:**
  ```powershell
  & "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" WebApplication2.csproj /t:Rebuild /p:Configuration=Debug
  ```
- **Rebuild Output:**
  ```text
  Build succeeded.
      0 Warning(s)
      0 Error(s)
  Time Elapsed 00:00:06.86
  ```
- **Git Status:** Working tree clean.
