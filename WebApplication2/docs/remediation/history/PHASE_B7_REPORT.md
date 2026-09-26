# PHASE B7 REPORT — Backend Input Validation & API Contract Hardening

**Status:** COMPLETE  
**Date:** September 4, 2026  
**Branch:** `remediation` (uncommitted)  
**Baseline Tag:** `fyp-baseline-pre-remediation` (`bc3a8773c899031036d05c441ff286694f894834` — verified untouched)  
**Authentication Engine:** Database-Backed Opaque Session Tokens in `UserSessions` (JWT strictly NOT used)

---

## 1. Executive Summary

Phase B7 implements comprehensive input validation, boundary defense, and API contract hardening across the ASP.NET Web API 5.x / Entity Framework 6 backend for the Babysitter Booking & Baby Minder FYP platform.

Prior to Phase B7, endpoints relied on loose or inconsistent client input parsing, exposing the application to null pointer exceptions (`NullReferenceException`), invalid negative IDs, unconstrained string lengths, invalid ratings, date/time format failures, and path traversal vectors.

Key achievements in Phase B7:
- **Centralized Validation Architecture:** Implemented `Infrastructure/ValidationHelper.cs` providing centralized, reusable validation routines for IDs, required strings, max lengths, email formats, ratings, date/time sequences, roles, and login payloads.
- **Systematic Controller Hardening:** Hardened all 10 controllers (`ParentController`, `BabySitterController`, `ChildrenController`, `JobsController`, `MatchingController`, `NotificationsController`, `ReviewController`, `CryDetectionController`, `AuthController`, `ImageController`) covering every route, parameter, payload, and query parameter.
- **Boundary Defense:** Enforced strict positive integer validation on all route parameters and payload IDs (`id <= 0` immediately returns `400 Bad Request`), defensive null body guards, email RFC compliance, numeric bounds (non-negative rates and experience, ratings between 1 and 5), date/time logic (start time before end time), and path traversal sanitization.
- **Fail-Fast & Zero Leakage:** Invalid inputs are rejected immediately at the perimeter with clear, structured `400 Bad Request` responses before reaching Entity Framework or triggering unhandled server exceptions (500), preventing database connection leaks and information disclosure.
- **100% Automated Runtime Verification:** Designed and executed a comprehensive 52-test automated verification matrix (`B7-T01` through `B7-T52`) against live IIS Express and SQL Server: **52 / 52 PASSED (100% pass rate, 0 failed)**.
- **Zero Constraint Violations:** Git branch `remediation` remains completely uncommitted, baseline tag `fyp-baseline-pre-remediation` is verified untouched, no frontend files were modified, and JWT was strictly not introduced or used.

---

## 2. Centralized Validation Architecture

Centralized validation helper located at `Infrastructure/ValidationHelper.cs`:

| Method | Signature | Purpose & Validation Rules |
| :--- | :--- | :--- |
| `ValidateNotNull` | `(object value, string message)` | Validates that a required request body or object is not null. Returns `400 Bad Request` if null. |
| `ValidateRequiredString` | `(string value, string fieldName, int maxLength = 0)` | Checks for non-null, non-whitespace string, trimming and validating optional upper bound length. |
| `ValidateMaxLength` | `(string value, string fieldName, int maxLength)` | Enforces upper length boundary on optional text fields. |
| `ValidateId` | `(int id, string fieldName = "ID")` | Ensures entity and route IDs are strictly positive integers (`id > 0`). |
| `ValidateCollectionNotNullOrEmpty<T>` | `(ICollection<T> collection, string fieldName)` | Ensures lists/arrays (e.g. `SlotIds`, `JobIds`) are non-null and contain at least one element. |
| `ValidateRange` | `(int value, int min, int max, string fieldName)` | Validates integer values fall within `[min, max]`. |
| `ValidateRange` | `(decimal value, decimal min, decimal max, string fieldName)` | Validates decimal values (e.g. ratings `[1.0, 5.0]`) fall within `[min, max]`. |
| `ValidateNotPastDate` | `(DateTime date, string fieldName)` | Enforces that scheduling dates cannot be in the past. |
| `ValidateNotFutureDate` | `(DateTime date, string fieldName)` | Enforces that historical dates (e.g., DOB) cannot be in the future. |
| `ValidateTimeRange` | `(DateTime start, DateTime end)` | Ensures start time strictly precedes end time (`start < end`). |
| `ValidateRole` | `(string role, params string[] allowedRoles)` | Enforces case-insensitive whitelist validation for roles (`"Parent"`, `"Sitter"`). |
| `ValidateEmail` | `(string email, string fieldName = "Email")` | Validates email syntax via `System.Net.Mail.MailAddress` with exact address matching. |
| `ValidatePassword` | `(string password)` | Enforces presence and maximum length boundary (<= 256 characters). |
| `ValidateLoginInput` | `(string username, string password, string role, string expectedRole)` | Comprehensive credential and role check for authentication endpoints. |

---

## 3. Controller Hardening & Contract Defense Matrix

### 3.1 `ParentController.cs`
- `POST /api/parent/register`: Hardened with multipart form validation: checks non-empty `FullName`, `EmailAddress`, `Username`, `Password`; validates email format; caps password length at 256; whitelists file extensions (`.jpg`, `.jpeg`, `.png`).
- `POST /api/parent/login`: Hardened with null body guard and `ValidationHelper.ValidateLoginInput` ensuring valid username, password, and expected role `"Parent"`. Rejects deactivated accounts (`IsDeleted`) with 401.
- `GET /api/parent/children/{parentId}`: Enforces `parentId > 0` before checking parent authorization / IDOR.
- `POST /api/parent/child`: Validates positive `ParentId`, non-empty `ChildName` (<= 150 chars), safe DOB parsing, and whitelisted image file uploads.
- `POST /api/parent/create-job`: Validates non-null `CreateJobDto`, strictly positive IDs (`ParentId > 0`, `SitterId > 0`, `ChildId > 0`), valid start/end times (`StartTime < EndTime`), and time-slot coverage.
- `GET /api/parent/jobs/{parentId}`: Validates `parentId > 0` and enforces IDOR ownership.
- `POST / DELETE /api/parent/deactivate/{id?}`: Validates `id > 0` when supplied and strictly prohibits cross-account deactivation.

### 3.2 `BabySitterController.cs`
- `POST /api/babysitter/register`: Validates required fields, email format, password max length, non-negative hourly rate (`HourlyRate >= 0`), non-negative experience (`ExperienceYears >= 0`), and whitelisted image extensions.
- `POST /api/babysitter/login`: Hardened with null body guard and `ValidationHelper.ValidateLoginInput` ensuring valid credentials and expected role `"Sitter"`. Rejects deactivated accounts (`IsDeleted`) with 401.
- `GET /api/babysitter/earnings/{sitterId}`: Validates `sitterId > 0` and enforces Sitter ownership.
- `POST / DELETE /api/babysitter/deactivate/{id?}`: Validates `id > 0` when supplied and strictly prohibits cross-account deactivation.

### 3.3 `ChildrenController.cs`
- `PUT /api/parent/child/{childId}`: Validates `childId > 0`, non-null multipart request, safe DOB parsing, and image extension whitelisting.
- `DELETE /api/parent/child/{childId}`: Validates `childId > 0`, enforces parent ownership, and marks `IsDeleted = true`.

### 3.4 `JobsController.cs`
- `GET /api/jobs`: Validates optional city parameter and filters unassigned, non-deleted jobs.
- `GET /api/jobs/jobdetails/{jobId}`: Enforces `jobId > 0` returning `400 Bad Request` on non-positive integers.
- `POST /api/jobs/confirm/{jobId}/{sitterId}`: Validates `jobId > 0` and `sitterId > 0`; verifies sitter role and prevents re-assignment of claimed jobs.
- `POST /api/jobs/confirm-bulk`: Validates non-null payload, `SitterId > 0`, non-empty `JobIds` collection, and verifies availability.
- `POST /api/jobs/updateStatus/{jobId}`: Validates `jobId > 0`, non-null body, non-empty status string, and enforces role authorization (Parent or assigned Sitter).
- `GET /api/jobs/sitter/{sitterId}`: Validates `sitterId > 0` and enforces Sitter IDOR.
- `GET /api/jobs/active`: Validates `babysitterId > 0` and enforces Sitter IDOR.

### 3.5 `MatchingController.cs`
- `GET /api/matching/matches/{jobId}`: Validates `jobId > 0` and enforces Parent IDOR.
- `POST /api/matching/availability/save`: Validates non-null body, `SitterId > 0`, non-empty `SlotIds` collection, and enforces Sitter IDOR before applying atomic upsert.
- `POST /api/matching/filter-sitters`: Defensively handles null body; validates bounds: `MinExperience >= 0`, `0 <= MinRating <= 5`.
- `GET /api/matching/availability/{sitterId}`: Validates `sitterId > 0`.
- `DELETE /api/matching/availability/clear/{sitterId}`: Validates `sitterId > 0` and enforces Sitter IDOR.
- `POST /api/matching/search-sitters`: Validates non-null body, `0 <= MinRating <= 5`, non-negative `MinExperienceYears`, valid `StartTime` and `EndTime` (`StartTime < EndTime`), and valid date ranges (`StartDate <= EndDate`).
- `GET /api/matching/jobrequests`: Validates `sitterId > 0` and enforces Sitter IDOR.
- `GET /api/matching/babysitter/{id}`: Validates `id > 0`.

### 3.6 `NotificationsController.cs`
- `GET /api/notifications`: Validates `userId > 0`, non-empty `userRole`, and enforces user session match.
- `PUT /api/notifications/{id}/read`: Validates `id > 0` and enforces user session match.
- `DELETE /api/notifications/clear`: Validates `userId > 0`, non-empty `userRole`, and enforces user session match.
- `POST /api/notifications`: Validates non-null body, `UserId > 0`, non-empty `UserRole`, non-empty `Message` (<= 1000 characters).

### 3.7 `ReviewController.cs`
- `POST /api/review/add`: Validates non-null body, positive IDs (`Reviewer_ID > 0`, `ReviewFor_ID > 0`, optional `Job_ID >= 0`), valid role enumerations (`"Parent"`, `"Sitter"`), rating bounds (`1 <= Rating <= 5`), and comment max length (<= 2000 characters).
- `GET /api/review/sitter/{sitterId}`: Validates `sitterId > 0`.
- `GET /api/review/parent/{parentId}`: Validates `parentId > 0`.
- `GET /api/review/user/{userId}/{role}`: Validates `userId > 0`, non-empty `role`, and validates role whitelist (`"Parent"` or `"Sitter"`).

### 3.8 `CryDetectionController.cs`
- `POST /api/cry-detection`: Validates non-null body, positive IDs (`ParentId > 0`, `BabysitterId > 0`, `JobId > 0`), non-empty `Level` (<= 50 chars), RFC/ISO timestamp parsing, and participant authorization.
- `GET /api/cry-detection/latest`: Validates `parentId > 0` when supplied and enforces IDOR.

### 3.9 `AuthController.cs` & `ImageController.cs`
- `GET /api/auth/me`: Validates session existence and returns user principal.
- `DELETE /api/auth/logout`: Extracts Bearer token and safely deletes session row.
- `GET /api/images/{type}/{filename}`: Sanitizes `filename` against path traversal (`..`, `/`, `\`) returning `400 Bad Request` on any traversal pattern.

---

## 4. Automated Verification Matrix Results (52 / 52 PASSED)

The complete test suite was executed against the live application on `http://localhost:44368` and SQL Server `DESKTOP-UD649GB\SQLEXPRESS`:

| Test ID | Category | Description | Status Code | Result |
| :--- | :--- | :--- | :--- | :--- |
| **B7-T01** | Auth Public | Parent Login with null body returns 400 | 400 | **PASS** |
| **B7-T02** | Auth Public | Parent Login with empty username returns 400 | 400 | **PASS** |
| **B7-T03** | Auth Public | Parent Login with empty password returns 400 | 400 | **PASS** |
| **B7-T04** | Auth Public | Parent Login with mismatched role returns 400 | 400 | **PASS** |
| **B7-T05** | Auth Public | Sitter Login with null body returns 400 | 400 | **PASS** |
| **B7-T06** | Auth Public | Sitter Login with empty username returns 400 | 400 | **PASS** |
| **B7-T07** | Auth Public | Sitter Login with empty password returns 400 | 400 | **PASS** |
| **B7-T08** | Auth Public | Sitter Login with mismatched role returns 400 | 400 | **PASS** |
| **B7-T09** | Auth Public | Parent Register with invalid email returns 400 | 400 | **PASS** |
| **B7-T10** | Auth Public | Sitter Register with negative rate returns 400 | 400 | **PASS** |
| **B7-T11** | Auth Public | Sitter Register with negative experience returns 400 | 400 | **PASS** |
| **B7-T12** | Auth Happy | Parent Login with valid credentials returns 200 OK + token | 200 | **PASS** |
| **B7-T13** | Auth Happy | Sitter Login with valid credentials returns 200 OK + token | 200 | **PASS** |
| **B7-T14** | Parent API | Parent children negative ID (`/children/-1`) returns 400 | 400 | **PASS** |
| **B7-T15** | Parent API | Parent jobs negative ID (`/jobs/-1`) returns 400 | 400 | **PASS** |
| **B7-T16** | Parent API | Parent create-job null body returns 400 | 400 | **PASS** |
| **B7-T17** | Parent API | Parent create-job non-positive IDs returns 400 | 400 | **PASS** |
| **B7-T18** | Parent API | Parent child update negative ID (`/child/-1`) returns 400 | 400 | **PASS** |
| **B7-T19** | Parent API | Parent child delete negative ID (`/child/-1`) returns 400 | 400 | **PASS** |
| **B7-T20** | Sitter API | Sitter earnings negative ID (`/earnings/-1`) returns 400 | 400 | **PASS** |
| **B7-T21** | Jobs API | Job details negative ID (`/jobdetails/-1`) returns 400 | 400 | **PASS** |
| **B7-T22** | Jobs API | Job confirm negative IDs (`/confirm/-1/-1`) returns 400 | 400 | **PASS** |
| **B7-T23** | Jobs API | Job confirm-bulk null body returns 400 | 400 | **PASS** |
| **B7-T24** | Jobs API | Job updateStatus negative ID (`/updateStatus/-1`) returns 400 | 400 | **PASS** |
| **B7-T25** | Jobs API | Job updateStatus empty status returns 400 | 400 | **PASS** |
| **B7-T26** | Jobs API | Jobs for sitter negative ID (`/sitter/-1`) returns 400 | 400 | **PASS** |
| **B7-T27** | Jobs API | Jobs active sitter negative ID (`/active?babysitterId=-1`) returns 400 | 400 | **PASS** |
| **B7-T28** | Matching API | Matching matches negative jobId (`/matches/-1`) returns 400 | 400 | **PASS** |
| **B7-T29** | Matching API | Matching save availability null body returns 400 | 400 | **PASS** |
| **B7-T30** | Matching API | Matching save availability empty slotIds returns 400 | 400 | **PASS** |
| **B7-T31** | Matching API | Matching availability negative sitterId returns 400 | 400 | **PASS** |
| **B7-T32** | Matching API | Matching clear availability negative sitterId returns 400 | 400 | **PASS** |
| **B7-T33** | Matching API | Matching search-sitters null body returns 400 | 400 | **PASS** |
| **B7-T34** | Matching API | Matching search-sitters rating > 5 returns 400 | 400 | **PASS** |
| **B7-T35** | Matching API | Matching jobrequests negative sitterId returns 400 | 400 | **PASS** |
| **B7-T36** | Matching API | Matching babysitter details negative ID returns 400 | 400 | **PASS** |
| **B7-T37** | Notif API | Notifications get negative userId returns 400 | 400 | **PASS** |
| **B7-T38** | Notif API | Notifications get empty role returns 400 | 400 | **PASS** |
| **B7-T39** | Notif API | Notifications mark read negative ID returns 400 | 400 | **PASS** |
| **B7-T40** | Notif API | Notifications clear negative userId returns 400 | 400 | **PASS** |
| **B7-T41** | Notif API | Notifications create null body returns 400 | 400 | **PASS** |
| **B7-T42** | Notif API | Notifications create invalid payload returns 400 | 400 | **PASS** |
| **B7-T43** | Review API | Review add null body returns 400 | 400 | **PASS** |
| **B7-T44** | Review API | Review add rating > 5 returns 400 | 400 | **PASS** |
| **B7-T45** | Review API | Review sitter rating negative ID returns 400 | 400 | **PASS** |
| **B7-T46** | Review API | Review parent rating negative ID returns 400 | 400 | **PASS** |
| **B7-T47** | Review API | Review user reviews invalid input returns 400 | 400 | **PASS** |
| **B7-T48** | Cry Alert API | Cry detection alert null body returns 400 | 400 | **PASS** |
| **B7-T49** | Cry Alert API | Cry detection alert invalid timestamp returns 400 | 400 | **PASS** |
| **B7-T50** | Cry Alert API | Cry detection alert negative IDs returns 400 | 400 | **PASS** |
| **B7-T51** | Cry Alert API | Cry detection latest negative parentId returns 400 | 400 | **PASS** |
| **B7-T52** | Security | Image path traversal (`test..jpg`) returns 400 | 400 | **PASS** |

**Total Tests:** 52  
**Passed:** 52 (100%)  
**Failed:** 0 (0%)  

---

## 5. Build & Compilation Verification

```shell
dotnet build WebApplication2.csproj -c Debug --nologo
```
**Result:**
```
  Determining projects to restore...
  All projects are up-to-date for restore.
  WebApplication2 -> E:\FYP Project\FYP Api\Api\WebApplication2\bin\WebApplication2.dll

Build succeeded.
    0 Warning(s)
    0 Error(s)
```

---

## 6. Constraints Verification

1. **Git Commit Status:**
   - Git branch `remediation` has **NOT** been committed (`no changes added to commit`).
2. **Git Baseline Tag:**
   - `git rev-parse fyp-baseline-pre-remediation` -> `bc3a8773c899031036d05c441ff286694f894834` (verified identical to baseline commit).
3. **Frontend Isolation:**
   - Zero modifications to React 19, Vite, CSS, UI, or frontend configuration files.
4. **Authentication Architecture:**
   - JWT was **strictly NOT introduced, restored, or used**.
   - Session authentication remains exclusively powered by database-backed opaque Bearer tokens stored in `UserSessions`.

