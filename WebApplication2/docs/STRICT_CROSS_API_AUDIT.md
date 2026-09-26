# Strict Cross-API Merge Audit & Gap Analysis Report
### Babysitter Booking & Baby Minder Platform – Unified Backend (`WebApplication2`)

**Author:** Senior .NET Solution Architect / Backend Architect  
**Branch:** `api-c-unification-remediation`  
**Authority Reference:** `UNIFIED_BACKEND_ARCHITECTURE_AND_THREE_API_MERGE_PLANNING_REPORT.md`  
**Date:** September 10, 2026  
**Status:** Step 1 Completed (Read-Only Audit & Matrix Definition)

---

## 1. Executive Summary & Audit Scope

This audit provides a strict, deep, exhaustive comparison of the three legacy and active ASP.NET Web API 2 codebases in the workspace:
- **API-A (`Final_year_1_project_Api`):** Early prototype with monolithic `AuthController`, plain-text credentials, raw entity binding, and recurring availability scheduling.
- **API-B (`Final_year_1_project_Api_zain`):** Refined variant with top-level pre-mutation validation, city-synchronization during availability saving, rating filtering, and search fallback.
- **API-C (`WebApplication2`):** Actively maintained, production-grade unified backend featuring 11 domain controllers, 11 service interfaces and implementations, strongly-typed DTOs, BCrypt authentication, opaque database-backed session tokens, role-based access control (`[SessionAuthorize]`), ownership checks (`ClaimsPrincipalHelper`), soft-deletes, and modular baby monitoring.

### Core Objectives
1. Exhaustively enumerate every controller, action, route, entity, field, DTO, and validation rule across API-A, API-B, and API-C.
2. Produce a side-by-side gap matrix with actionable recommendations:
   - **`MERGE NOW`**: Additive, 100% backward-compatible, zero database/EDMX schema changes, improves API parity or DX.
   - **`DOCUMENT ONLY`**: Valuable domain feature/field that requires altering the database schema or EDMX (deferred to Phase 16/17 Code-First migration due to active schema freeze).
   - **`SKIP`**: Insecure (e.g., plaintext passwords in URLs), obsolete, or architectural anti-pattern superseded by API-C's hardened architecture.

---

## 2. API-A Inventory (`Final_year_1_project_Api`)

### 2.1 Controllers & Endpoints
All functional endpoints in API-A reside in a single monolithic controller: `AuthController` (`RoutePrefix("api/Auth")`). `HomeController` (MVC) and `ValuesController` (Web API boilerplate) are non-functional templates.

| Verb | Route | Action Method | Request Body / Parameters | Response Shape |
|---|---|---|---|---|
| `POST` | `api/Auth/CreateParent` | `CreateParent(Parent parent)` | Body: raw `Parent` entity | `bool` (`true`) |
| `POST` | `api/Auth/CreateBabySitter` | `CreateBabySitter(Babysitter babysitter)` | Body: raw `Babysitter` entity | `bool` (`true`) |
| `GET` | `api/Auth/Login` | `Login(string email, string password, string role)` | Query: `email`, `password`, `role` ("parent"/"babysitter") | Plaintext matched anonymous object `{ id, role, full_name, email }` or 401 |
| `POST` | `api/Auth/SaveWeeklyAvailability` | `SaveWeeklyAvailability(JArray dataList)` | Body: untyped `JArray` of `{ babysitter_id, day_of_week, time_slot }` | `bool` (`true`) |
| `GET` | `api/Auth/SearchBabysitters` | `SearchBabysitters(string city, string startDate, string endDate, string startTime, string endTime, string days = "")` | Query: string parameters | List of anonymous `{ babysitter_id, full_name, city, charges, experience, picture }` |
| `POST` | `api/Auth/SendHireRequest` | `SendHireRequest(Hire hire)` | Body: raw `Hire` entity | `bool` (`true`) |
| `GET` | `api/Auth/GetHireRequests` | `GetHireRequests(int babysitter_id)` | Query: `babysitter_id` | List of `{ hire_id, status, hired_at, parent_name, phone_no }` |
| `GET` | `api/Auth/RespondHire` | `RespondHire(int hire_id, string action)` | Query: `hire_id`, `action` ("Active", etc.) | `bool` (`true`) |
| `GET` | `api/Auth/GetMyJobs` | `GetMyJobs(int parent_id)` | Query: `parent_id` | List of `{ hire_id, status, hired_at, sitter_name, sitter_phone }` |
| `GET` | `api/Auth/GetChildrenByParent` | `GetChildrenByParent(int parent_id)` | Query: `parent_id` | List of `{ child_id, name, date_of_birth, gender, specialNote, picture }` |

### 2.2 Entities & Fields (EF6 Database-First EDMX)
- **`Parent`:** `parent_id` (PK), `full_name`, `email`, `password`, `cnic`, `phone_no`, `address`, `picture`.
- **`Babysitter`:** `babysitter_id` (PK), `full_name`, `email`, `password`, `cnic`, `phone_no`, `date_of_birth`, `gender`, `experience`, `city`, `address`, `min_child_age`, `max_child_age`, `charges`, `picture`.
- **`Child`:** `child_id` (PK), `parent_id` (FK), `name`, `date_of_birth`, `gender`, `specialNote`, `guardian_details`, `guardian_contact`, `relation`, `picture`.
- **`Hire`:** `hire_id` (PK), `parent_id` (FK), `babysitter_id` (FK), `status`, `hired_at`, `start_time`, `end_time`, `selected_days`.
- **`Schedule`:** `schedule_id` (PK), `babysitter_id` (FK), `day_of_week`, `time_slot`, `specific_date`, `is_available`, `amount`.
- **`Rating`:** `rating_id` (PK), `parent_id` (FK), `babysitter_id` (FK), `rating1`, `review_text`, `rated_by` (Unused in endpoints).

---

## 3. API-B Inventory (`Final_year_1_project_Api_zain`)

### 3.1 Controllers & Endpoints
Similar to API-A, API-B uses a single `AuthController` (`RoutePrefix("api/Auth")`):

| Verb | Route | Action Method | Request Body / Parameters | Response Shape |
|---|---|---|---|---|
| `POST` | `api/Auth/CreateParent` | `CreateParent(Parent parent)` | Body: raw `Parent` entity | `bool` (`true`) |
| `POST` | `api/Auth/CreateBabySitter` | `CreateBabySitter(Babysitter babysitter)` | Body: raw `Babysitter` entity | `bool` (`true`) |
| `POST` | `api/Auth/CreateChildProfileParentSide` | `CreateChildProfileParentSide(Child child)` | Body: raw `Child` entity | `bool` (`true`) |
| `GET` | `api/Auth/Login` | `Login(string email, string password, string role)` | Query: `email`, `password`, `role` | `{ role, user: { ... } }` or 204 NoContent |
| `GET` | `api/Auth/SearchBabysitters` | `SearchBabysitters(string city, string availabilityType, DateTime startDate, DateTime endDate, string days, TimeSpan startTime, TimeSpan endTime, int rating = 0)` | Query: typed query parameters | List of `{ babysitter_id, full_name, charges, experience, picture, city, phone_no, gender, age, AvgRating, [Message] }` |
| `POST` | `api/Auth/SetAvailability` | `SetAvailability(SetAvailabiltyModel model)` | Body: `{ babysitter_id, city, slots: [{ day, start_time, end_time }] }` | `{ message, city, insertedCount, saveResult, [warnings] }` |

### 3.2 Entities & DTOs
- **`Babysitter`:** Adds `age` (`int?`), preserves `min_child_age`, `max_child_age`, `charges`, `city`.
- **`Child`:** Adds `age` (`int?`), omits `specialNote`.
- **`Schedule`:** `schedule_id`, `babysitter_id`, `day`, `start_time` (`TimeSpan?`), `end_time` (`TimeSpan?`).
- **`SetAvailabiltyModel`:** `babysitter_id` (`int`), `city` (`string`), `slots` (`List<AvailabilitySlot>`).
- **`AvailabilitySlot`:** `day` (`string`), `start_time` (`string`), `end_time` (`string`).

### 3.3 Key Business Rules & Validation Patterns
1. **Top-Level Pre-Mutation Validations:** Pre-validates model non-null, ID > 0, non-empty city, and slot existence before querying or mutating DB.
2. **City Synchronization:** Saves/updates `babysitter.city = model.city` whenever availability is saved.
3. **Flexible Day Format Matching:** Matches both full day names (`"Monday"`) and short day names (`"Mon"`).
4. **Search Fallback with User Notification:** When zero sitters match the schedule slots, returns active sitters in the city with `Message = "Schedule not found, showing all babysitters"`.

---

## 4. API-C Inventory (`WebApplication2`)

### 4.1 Architecture & Layers
- **Controllers (11):** `AuthController`, `ParentController`, `BabySitterController`, `ChildrenController`, `JobsController`, `MatchingController`, `BidsController`, `ReviewController`, `NotificationsController`, `CryDetectionController`, `ImageController`.
- **Services (11):** `IAccountService`, `IAvailabilityService`, `IBidService`, `IChildService`, `ICryAlertService`, `IImageService`, `IJobService`, `IMatchingService`, `INotificationService`, `IRecurringAvailabilityService`, `IReviewService`.
- **Infrastructure:** `SessionAuthorizeAttribute`, `ClaimsPrincipalHelper`, `ValidationHelper`, `PasswordHasher` (BCrypt + legacy SHA-256 fallback), `SimpleDependencyResolver`.
- **Database (EF6 EDMX):** `Parent`, `Babysitter`, `Child`, `Job`, `JobTimeSlot`, `TimeSlot`, `SitterAvailability`, `Bid`, `Review`, `Notification`, `CryAlert`, `UserSession`.

---

## 5. Comprehensive Gap & Comparison Matrix

| Feature / Endpoint / Field / Rule | API-A | API-B | API-C | API-C Equivalent / Mapping | Recommendation | Justification |
|---|:---:|:---:|:---:|---|:---:|---|
| **Child `SpecialNote` / `specialNote`** | Y | N | Y | Added alias property `SpecialNote` on DTOs and mapped in `ChildService` | **ALREADY MERGED** | Merged in Commit `7306037`. Fully backward-compatible. |
| **Child `GuardianContact` in `ChildDto`** | Y | Y | N | `Child` entity has `GuardianContact`, but `ChildDto` omitted it | **MERGE NOW** | Safe, additive property addition to `ChildDto` and `ChildService.GetChildrenByParent`. |
| **Pre-Mutation Validation Ordering** | N | Y | Y | Refactored `JobService.CreateJobForSitter` & `AvailabilityService.SaveAvailability` | **ALREADY MERGED** | Merged in Commit `0b3df9a`. Validates slot IDs and sitter existence before mutating DB state. |
| **Search Fallback Flag & Logic** | N | Y | Y | Added `EnableFallback` on `SearchSittersDTO` and fallback search in `MatchingService` | **ALREADY MERGED** | Merged in Commit `aab88fd`. Prevents empty search results when requested. |
| **Sitter Search Fallback Notification Message** | N | Y | N | API-B returns `Message = "Schedule not found, showing all babysitters"` | **MERGE NOW** | Add `public string Message { get; set; }` to `SitterDTO` so clients receive explicit fallback notice. |
| **Sitter Search Result `City` property** | Y | Y | N | `SitterDTO` returned during search and filter omitted `City` property | **MERGE NOW** | Add `public string City { get; set; }` to `SitterDTO`. Populated from availability or search criteria. |
| **Flexible Day Matching (Full & Short Day Names)** | N | Y | Partial | `MatchingService.SearchSitters` checked exact `date.DayOfWeek.ToString()` | **MERGE NOW** | Refactor day comparison in `MatchingService.SearchSitters` to match `"Monday"`, `"Mon"`, and case-insensitive variations. |
| **Parent Phone in Job Requests (`MatchingJobDto`)** | Y | N | N | API-A `GetHireRequests` returned parent `phone_no`. API-C `MatchingJobDto` omitted it | **MERGE NOW** | Add `public string ParentPhone { get; set; }` to `MatchingJobDto` populated from `job.Parent.PhoneNumber`. |
| **Parent Phone in Open Jobs (`OpenJobListItemDto`)** | N | N | N | Open job list omitted parent contact information | **MERGE NOW** | Add `public string ParentPhone { get; set; }` to `OpenJobListItemDto` populated from `job.Parent.PhoneNumber`. |
| **Additive `GET` Search Endpoint** | Y | Y | N | API-C only supported `POST api/matching/search-sitters`. API-A/B used `GET` | **MERGE NOW** | Add `[HttpGet] [Route("search-sitters")]` and `[HttpGet] [Route("search")]` to `MatchingController` with query param binding. |
| **Recurring Weekly Availability Support** | Y | N | Y | `POST api/matching/availability/recurring` via `IRecurringAvailabilityService` | **ALREADY MERGED** | Merged in Commit `9dd4f66`. Expands weekly day-of-week slots across multiple weeks safely. |
| **Direct JSON Child Creation** | N | Y | N | API-C `POST api/parent/child` only accepted multipart form-data | **MERGE NOW** | Add additive support in `ParentController` for JSON-bound `CreateChildDto` or fallback JSON parsing when multipart form is empty. |
| **Babysitter `MinChildAge` / `MaxChildAge`** | Y | Y | N | Missing from API-C EDMX `Babysitter` table | **DOCUMENT ONLY** | Schema column addition required. Deferred to Phase 16/17 Code-First migration. |
| **Babysitter `City` Column** | Y | Y | N | API-C stores city on `SitterAvailability.City` and `Job.City`, not on `Babysitter` table | **DOCUMENT ONLY** | Schema column addition required. Deferred to Phase 16/17 Code-First migration. |
| **Babysitter & Parent `CNIC` Column** | Y | Y | N | Missing from API-C EDMX `Babysitter` and `Parent` tables | **DOCUMENT ONLY** | Schema column addition required. Deferred to Phase 16/17 Code-First migration. |
| **Babysitter `Address` Column** | Y | Y | N | Missing from API-C EDMX `Babysitter` table | **DOCUMENT ONLY** | Schema column addition required. Deferred to Phase 16/17 Code-First migration. |
| **Babysitter & Child `Age` Column** | N | Y | N | Stored `age` column in API-B vs calculated DOB | **DOCUMENT ONLY** | In API-C, age is dynamically calculated from `DOB`. Schema addition deferred. |
| **Live `BabysittingSession` Duration Tracking** | N | N | N | Universal gap across all three APIs | **DOCUMENT ONLY** | Requires new database table and dedicated session tracking architecture. |
| **Admin Module & Moderation** | N | N | N | Universal gap across all three APIs | **DOCUMENT ONLY** | Requires new entity, roles, and administrative endpoints. |
| **Plain-text `GET api/Auth/Login`** | Y | Y | N | API-A/B passed plaintext passwords in GET query parameters | **SKIP** | Insecure anti-pattern. Exposes passwords in browser history, logs, and headers. |
| **Raw Entity Mutation Endpoints** | Y | Y | N | `CreateParent(Parent)`, `CreateBabySitter(Babysitter)` | **SKIP** | Insecure. Bypasses password hashing, session tokens, and input validation. |
| **Untyped `JArray` Availability (`SaveWeeklyAvailability`)** | Y | N | N | Untyped dynamic JSON array | **SKIP** | Superseded by strongly-typed `POST api/matching/availability/recurring`. |
| **Embedded `TimeSpan` in Schedule (`Schedule.start_time`)** | N | Y | N | API-B embedded `TimeSpan` without relational slot table | **SKIP** | Inferior to API-C's normalized `TimeSlot` relational model. |
| **Unauthenticated Endpoints (No Session/Role Check)** | Y | Y | N | API-A/B endpoints lacked any authorization or identity derivation | **SKIP** | Insecure. Violates principle of least privilege and allows total IDOR. |

---

## 6. Actionable Implementation Plan for Step 2

### Items to Implement in Step 2 (`MERGE NOW`):
1. **Child DTO Enhancement:**
   - Add `public string GuardianContact { get; set; }` to `ChildDto` in `DTOs/CreateChildDto.cs`.
   - Update `ChildService.GetChildrenByParent` to project `GuardianContact = c.GuardianContact`.
2. **Matching & Search DTO Enhancements:**
   - Add `public string City { get; set; }` and `public string Message { get; set; }` to `SitterDTO` in `DTOs/JobDTOs.cs`.
   - Add `public string ParentPhone { get; set; }` to `MatchingJobDto` and `OpenJobListItemDto` in `DTOs/JobDTOs.cs`.
   - Update `MatchingService.GetJobRequestsForSitter` to project `ParentPhone`.
   - Update `JobService.GetOpenJobs` to project `ParentPhone`.
   - Update `MatchingService.SearchSitters` to populate `City` on `SitterDTO` and populate `Message` when fallback occurs.
3. **Flexible Day Name Parsing:**
   - In `MatchingService.SearchSitters`, support matching full day names (`"Monday"`), 3-letter abbreviations (`"Mon"`), and case-insensitive values.
4. **Additive GET Search Endpoint:**
   - In `MatchingController.cs`, add `[HttpGet] [Route("search-sitters")]` and `[HttpGet] [Route("search")]` supporting query parameters mapped to `SearchSittersDTO`.
5. **Additive JSON Child Creation:**
   - In `ParentController.cs`, support JSON body binding for child creation when requests are sent as `application/json`.

