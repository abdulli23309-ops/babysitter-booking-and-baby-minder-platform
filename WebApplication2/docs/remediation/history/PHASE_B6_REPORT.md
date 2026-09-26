# PHASE B6 REPORT — Backend Global Soft Delete & Account Lifecycle Integrity

**Status:** COMPLETE  
**Date:** September 4, 2026  
**Branch:** `remediation` (uncommitted)  
**Baseline Tag:** `fyp-baseline-pre-remediation` (`bc3a8773c899031036d05c441ff286694f894834` — verified untouched)  
**Authentication Engine:** Database-Backed Opaque Session Tokens in `UserSessions` (JWT strictly NOT used)

---

## 1. Executive Summary

Phase B6 implements a comprehensive, enterprise-grade Soft-Delete and Account Lifecycle Integrity architecture across the ASP.NET Web API 5.x / Entity Framework 6 backend for the Babysitter Booking & Baby Minder FYP platform. 

Key achievements:
- **Schema & Model Synchronization:** Added `IsDeleted BIT NOT NULL DEFAULT 0` to all 9 approved business entities in SQL Server (`BabySitterBooking and BabyMinder`), synchronized CSDL, SSDL, and MSL mappings in `Model1.edmx`, and updated all corresponding C# POCO classes.
- **Account Deactivation Lifecycle:** Implemented dedicated deactivation endpoints for Parents (`POST/DELETE api/parent/deactivate/{id?}`) and Babysitters (`POST/DELETE api/babysitter/deactivate/{id?}`) featuring atomic database transactions, cascading cancellation of active jobs/bids, soft-deletion of associated children/availabilities, and complete physical revocation of all active sessions in `UserSessions`.
- **Authentication & Authorization Hardening:** Enhanced `SessionAuthorizeAttribute` to actively verify that the account associated with an incoming session token exists and is active (`!IsDeleted`). Attempting to use a token for a deactivated account automatically purges the session and returns `401 Unauthorized`. Hardened login endpoints for Parents and Babysitters to immediately reject deactivated accounts with `401 Unauthorized`.
- **Query Filtering & Historical Preservation:** Added explicit LINQ filtering (`!x.IsDeleted`) across all operational controllers (`JobsController`, `MatchingController`, `ChildrenController`, `ReviewController`, `NotificationsController`, `CryDetectionController`, `ParentController`, `BabySitterController`). Historical jobs, payments, earnings, and reviews are preserved with fallback identifiers (`"Deactivated Parent"`, `"Deleted User"`).
- **Zero Test Residue & Build Verification:** Achieved clean build (0 Errors, 0 Warnings) and verified 100% pass rate across the 22-test automated runtime test matrix (T1–T22) against live IIS Express and SQL Server, with zero leftover test artifacts.

---

## 2. Exact Soft-Delete Entity Matrix

| Entity | Classification | Schema Column | EF Mapped | Primary Operation | Policy Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Parent** | Category A (MUST) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | User account deactivated; preserved for historical job records and reviews. |
| **Babysitter** | Category A (MUST) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | User account deactivated; preserved for earnings and historical reviews. |
| **Child** | Category A (MUST) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | Child profile removed or parent deactivated; preserved for past job audits. |
| **Job** | Category A (MUST) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | Cancelled jobs marked soft-deleted; completed historical jobs preserved. |
| **Review** | Category B (SHOULD) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | Reviews preserved even if reviewer or reviewee is deactivated. |
| **Bid** | Category B (SHOULD) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | Bids on cancelled jobs or deactivated sitters soft-deleted. |
| **Notification** | Category B (SHOULD) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | Cleared notifications soft-deleted rather than purged. |
| **SitterAvailability** | Category B (SHOULD) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | Overwritten or cleared availability grids marked `IsDeleted = true`. |
| **CryAlert** | Category B (SHOULD) | `IsDeleted BIT NOT NULL DEFAULT 0` | Yes (`bool`) | Soft Delete | Baby cry alarm events preserved for historical safety audit logs. |
| **UserSessions** | Category C (SECURITY) | *None* | Yes | Physical Delete | Security token store; immediate physical `DELETE` on logout/deactivation. |
| **JobTimeSlot** | Category D (JUNCTION) | *None* | Yes | Junction Cascade | Pure association link; lifecycle governed by parent `Job.IsDeleted`. |
| **TimeSlot** | Category D (REFERENCE) | *None* | Yes | Read-Only Ref | Static master reference table; never deleted. |

---

## 3. Entities That Received IsDeleted

All 9 business entities received the column `IsDeleted BIT NOT NULL DEFAULT 0` in SQL Server and `public bool IsDeleted { get; set; }` in their C# POCO classes:
1. `Parent` (`Models/Parent.cs`)
2. `Babysitter` (`Models/Babysitter.cs`)
3. `Child` (`Models/Child.cs`)
4. `Job` (`Models/Job.cs`)
5. `Review` (`Models/Review.cs`)
6. `Bid` (`Models/Bid.cs`)
7. `Notification` (`Models/Notification.cs`)
8. `SitterAvailability` (`Models/SitterAvailability.cs`)
9. `CryAlert` (`Models/CryAlert.cs`)

---

## 4. Entities Intentionally Excluded

1. **`UserSessions`**: As an ephemeral security token store, retaining revoked tokens presents an unnecessary security risk. Physical deletion (`DELETE FROM UserSessions WHERE ...`) guarantees instantaneous, unrecoverable session invalidation.
2. **`JobTimeSlot`**: A pure foreign-key junction table linking `Job` and `TimeSlot`. Its state is governed entirely by the parent `Job`.
3. **`TimeSlot`**: A static reference/lookup table representing master schedule blocks. It contains no tenant or user state.

---

## 5. Database Schema Changes

SQL Server Schema Updates executed on `DESKTOP-UD649GB\SQLEXPRESS` (`BabySitterBooking and BabyMinder`):
```sql
ALTER TABLE [Parent] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_Parent_IsDeleted] DEFAULT (0);
ALTER TABLE [Babysitter] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_Babysitter_IsDeleted] DEFAULT (0);
ALTER TABLE [Child] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_Child_IsDeleted] DEFAULT (0);
ALTER TABLE [Job] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_Job_IsDeleted] DEFAULT (0);
ALTER TABLE [Review] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_Review_IsDeleted] DEFAULT (0);
ALTER TABLE [Bid] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_Bid_IsDeleted] DEFAULT (0);
ALTER TABLE [Notification] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_Notification_IsDeleted] DEFAULT (0);
ALTER TABLE [SitterAvailability] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_SitterAvailability_IsDeleted] DEFAULT (0);
ALTER TABLE [CryAlert] ADD [IsDeleted] BIT NOT NULL CONSTRAINT [DF_CryAlert_IsDeleted] DEFAULT (0);
```
Verification confirmed all pre-existing records across these 9 tables defaulted to `IsDeleted = 0`.

---

## 6. EF/EDMX Changes

`Models/Model1.edmx` was cleanly regenerated and synchronized:
- **SSDL (Storage Schema Definition Language):** Added `<Property Name="IsDeleted" Type="bit" Nullable="false" />` to all 9 entity definitions.
- **CSDL (Conceptual Schema Definition Language):** Added `<Property Name="IsDeleted" Type="Boolean" Nullable="false" />` to all 9 conceptual entity types.
- **MSL (Mapping Specification Language):** Added `<ScalarProperty Name="IsDeleted" ColumnName="IsDeleted" />` within each `<EntityTypeMapping>`.
- **DbContext:** Added constructor overload `public BabySitterBooking_and_BabyMinderEntities(string nameOrConnectionString) : base(nameOrConnectionString)` to `Models/Model1.Context.cs` for robust external connection handling and testing.
- **Resource Embedding:** Executed MSBuild clean to purge cached `obj/Debug/edmxResourcesToEmbed/` files and ensure clean resource embedding in `WebApplication2.dll`.

---

## 7. Every Controller Modified

1. `ParentController.cs`:
   - Updated `LoginParent`: checks `parent == null || parent.IsDeleted` -> `401 Unauthorized`.
   - Updated `GetChildren`: filters `!c.IsDeleted`.
   - Updated `CreateJobForSitter`: validates child is not deleted (`!child.IsDeleted`) and sitter is active (`!sitter.IsDeleted`).
   - Updated `GetParentJobs`: filters `!j.IsDeleted`; adds fallbacks for deactivated sitter/child.
   - Added `DeactivateParentAccount` (`POST/DELETE api/parent/deactivate/{id?}`): performs atomic soft deletion of parent and children, cancels active jobs, and revokes sessions.
2. `BabySitterController.cs`:
   - Updated `LoginBabysitter`: checks `sitter == null || sitter.IsDeleted` -> `401 Unauthorized`.
   - Updated `GetEarnings`: filters `!j.IsDeleted`; provides safe fallback for deactivated parent (`"Deactivated Parent"`).
   - Added `DeactivateSitterAccount` (`POST/DELETE api/babysitter/deactivate/{id?}`): performs atomic soft deletion of sitter, soft deletion of availabilities and bids, cancels active jobs, and revokes sessions.
3. `ChildrenController.cs`:
   - Updated `UpdateChild`: enforces `!c.IsDeleted` and IDOR ownership.
   - Added `DeleteChild` (`DELETE api/parent/child/{childId}`): performs soft deletion (`child.IsDeleted = true`).
4. `JobsController.cs`:
   - Updated `GetJobs`: filters `!j.IsDeleted && (j.Parent == null || !j.Parent.IsDeleted)` and `!r.IsDeleted` on parent rating.
   - Updated `GetJobDetails`: checks `!j.IsDeleted`; includes safe fallbacks for deactivated parent and child.
   - Updated `ConfirmJobsBulk`: filters `!j.IsDeleted` and verifies sitter is active (`!b.IsDeleted`).
   - Updated `ConfirmJob`: checks `!j.IsDeleted` and verifies sitter is active (`!b.IsDeleted`).
   - Updated `UpdateJobStatus`: verifies `!j.IsDeleted`.
   - Updated `GetSitterJobs`: filters `!j.IsDeleted`; provides safe fallback strings for deactivated parent and child.
   - Updated `GetActiveJobForSitter`: filters `!j.IsDeleted`; provides safe fallbacks.
5. `MatchingController.cs`:
   - Updated `GetMatchingSitters`: filters `!b.IsDeleted`, `!sa.IsDeleted`, `!r.IsDeleted`, `!job.IsDeleted`.
   - Updated `SaveAvailability`: soft-deletes prior slots (`item.IsDeleted = true`) instead of `db.SitterAvailabilities.Remove`.
   - Updated `FilterSitters`: filters `!s.IsDeleted`, `!sa.IsDeleted`, `!r.IsDeleted`.
   - Updated `GetSitterAvailability`: filters `!sa.IsDeleted`.
   - Updated `ClearAllAvailability`: soft-deletes (`sa.IsDeleted = true`) instead of `RemoveRange`.
   - Updated `SearchSitters`: filters `!s.IsDeleted`, `!sa.IsDeleted`, `!r.IsDeleted`, and `!j.IsDeleted` in conflict check.
   - Updated `GetJobRequestsForSitter`: filters `!sa.IsDeleted`, `!j.IsDeleted`, `!Parent.IsDeleted`.
   - Updated `GetBabysitterDetails`: returns `404 NotFound` if `s.IsDeleted`.
6. `NotificationsController.cs`:
   - Updated `GetNotifications`: filters `!n.IsDeleted`.
   - Updated `MarkAsRead`: verifies `!n.IsDeleted`.
   - Updated `ClearAll`: soft-deletes (`n.IsDeleted = true`) instead of `RemoveRange`.
   - Updated `CreateNotification`: explicitly sets `IsDeleted = false`.
7. `ReviewController.cs`:
   - Updated `AddReview`: validates reviewer and reviewee accounts exist and are active (`!IsDeleted`).
   - Updated `GetSitterRating`: filters `!r.IsDeleted`.
   - Updated `GetParentRating`: filters `!r.IsDeleted`.
   - Updated `GetUserReviews`: filters `!r.IsDeleted`; implements historical fallback `"Deleted User"` if reviewer is soft-deleted.
8. `CryDetectionController.cs`:
   - Updated `PostCryAlert`: sets `IsDeleted = false`.
   - Updated `GetLatest`: filters `!a.IsDeleted`.
9. `AuthController.cs`:
   - Added `DELETE api/auth/logout`: physically purges bearer token from `UserSessions`.
10. `ImageController.cs`:
    - Preserved existing path traversal protection; no DB interaction needed.

---

## 8. Every DELETE Operation Changed

| Controller | Action / Route | Previous Physical Delete | New Soft Delete Implementation |
| :--- | :--- | :--- | :--- |
| `ChildrenController` | `DELETE api/parent/child/{childId}` | *(None - endpoint newly implemented)* | `child.IsDeleted = true; db.SaveChanges()` |
| `MatchingController` | `POST api/matching/availability/save` | `db.SitterAvailabilities.Remove(item)` | `item.IsDeleted = true; db.SaveChanges()` |
| `MatchingController` | `DELETE api/matching/availability/clear/{sitterId}` | `db.SitterAvailabilities.RemoveRange(toDelete)` | `foreach (var sa in toDelete) { sa.IsDeleted = true; } db.SaveChanges()` |
| `NotificationsController` | `DELETE api/notifications/clear` | `db.Notifications.RemoveRange(rows)` | `foreach (var n in rows) { n.IsDeleted = true; } db.SaveChanges()` |
| `ParentController` | `POST/DELETE api/parent/deactivate` | *(None - endpoint newly implemented)* | `parent.IsDeleted = true; children.ForEach(c => c.IsDeleted = true);` |
| `BabySitterController` | `POST/DELETE api/babysitter/deactivate` | *(None - endpoint newly implemented)* | `sitter.IsDeleted = true; avail.ForEach(a => a.IsDeleted = true); bids.ForEach(b => b.IsDeleted = true);` |

---

## 9. Every Physical Delete Intentionally Retained and Why

1. **`AuthController.Logout` (`DELETE api/auth/logout`)**:
   - `DELETE FROM UserSessions WHERE Token = @token`
   - *Reason:* Hard session revocation. A logged-out credential must not exist in memory or database to avoid token hijack or replay.
2. **`ParentController.DeactivateParentAccount`**:
   - `DELETE FROM UserSessions WHERE UserId = @id AND Role = 'Parent'`
   - *Reason:* Immediate session revocation across all devices upon account deactivation.
3. **`BabySitterController.DeactivateSitterAccount`**:
   - `DELETE FROM UserSessions WHERE UserId = @id AND Role = 'Sitter'`
   - *Reason:* Immediate session revocation across all devices upon account deactivation.
4. **`SessionAuthorizeAttribute.OnAuthorization`**:
   - `DELETE FROM UserSessions WHERE Token = @token`
   - *Reason:* Automatic cleanup of stale sessions when an authenticated token belongs to a deactivated user.

---

## 10. Query Filtering Strategy

The system utilizes strict, explicit LINQ query filtering on every read operation rather than dynamic query interception, which can cause subtle side-effects in complex joins and projections in EF6 Database-First EDMX architectures:
- **Direct table reads:** `db.Entity.Where(x => !x.IsDeleted && ...)`
- **Navigational properties:** Handled conditionally in projections:
  `ChildName = j.Child != null ? (j.Child.IsDeleted ? "Deactivated Child" : j.Child.ChildName) : null`
- **Aggregate ratings:** Filtered polymorphically:
  `db.Reviews.Where(r => !r.IsDeleted && r.ReviewFor_ID == id && r.ReviewForRole == role).Average(r => (decimal?)r.Rating) ?? 0`
- **Search & Conflict Queries:** Exclude soft-deleted jobs and availabilities in conflict checking:
  `!j.IsDeleted && (j.Status == "Assigned" || j.Status == "In Progress")`

---

## 11. Historical Data Policy

Historical financial and review records are strictly preserved:
1. **Completed Jobs (`Status = 'Completed'`):** Completed jobs are never soft-deleted when a parent or sitter deactivates their account. They remain with `Status = 'Completed'` and `IsDeleted = false`.
2. **Earnings Inquiries:** When a sitter views past earnings (`GET api/babysitter/earnings/{id}`), completed jobs associated with deactivated parents continue to be calculated in total earnings and total hours. The parent's display name falls back gracefully to `"Deactivated Parent"`.
3. **Reviews & Ratings:** Past reviews submitted by or received by deactivated accounts remain in the database with `IsDeleted = false`. In public profile review histories (`GET api/review/user/{id}/{role}`), if the author of a review has deactivated their account, their name renders as `"Deleted User"`, while preserving the rating score, comment text, and timestamp.

---

## 12. Parent Account Deactivation Lifecycle

**Endpoints:** `POST api/parent/deactivate/{id?}` and `DELETE api/parent/deactivate/{id?}`  
**Authorization:** `[SessionAuthorize(Roles = "Parent")]`  
**Execution Steps:**
1. **Identity & RBAC:** Extracts `currentUserId` from validated claims. If `{id}` is provided, verifies `id == currentUserId`; rejects mismatches with `403 Forbidden` (IDOR defense).
2. **Transaction Scope:** Opens `db.Database.BeginTransaction()`.
3. **Parent Soft-Delete:** Sets `parent.IsDeleted = true`.
4. **Cascade Children:** Queries all children belonging to parent (`c.Parent_ID == currentUserId && !c.IsDeleted`) and sets `c.IsDeleted = true`.
5. **Active Job Cancellation:** Identifies open/assigned jobs (`j.Parent_ID == currentUserId && j.Status != "Completed" && j.Status != "Cancelled" && !j.IsDeleted`). Sets `j.Status = "Cancelled"`, `j.IsDeleted = true`.
6. **Session Revocation:** Executes raw SQL `DELETE FROM UserSessions WHERE UserId = @currentUserId AND Role = 'Parent'`.
7. **Commit:** Commits transaction. Subsequent calls with previous tokens immediately return `401 Unauthorized`.

---

## 13. Babysitter Account Deactivation Lifecycle

**Endpoints:** `POST api/babysitter/deactivate/{id?}` and `DELETE api/babysitter/deactivate/{id?}`  
**Authorization:** `[SessionAuthorize(Roles = "Sitter")]`  
**Execution Steps:**
1. **Identity & RBAC:** Extracts `currentUserId` from claims. If `{id}` is provided, verifies `id == currentUserId`; rejects mismatches with `403 Forbidden`.
2. **Transaction Scope:** Opens `db.Database.BeginTransaction()`.
3. **Sitter Soft-Delete:** Sets `sitter.IsDeleted = true`.
4. **Cascade Availability:** Sets `sa.IsDeleted = true` for all active availability records.
5. **Cascade Bids:** Sets `b.IsDeleted = true` for all active bids placed by this sitter.
6. **Active Job Cancellation:** Identifies assigned jobs (`j.AssignedSitter_ID == currentUserId && j.Status != "Completed" && j.Status != "Cancelled"`). Sets `j.Status = "Cancelled"`, `j.AssignedSitter_ID = null`.
7. **Session Revocation:** Executes `DELETE FROM UserSessions WHERE UserId = @currentUserId AND Role = 'Sitter'`.
8. **Commit:** Commits transaction. The sitter is instantaneously removed from matching/search APIs.

---

## 14. Active Job Handling Policy

- **Completed Jobs:** Untouched. Preserved for billing and platform records.
- **In-Progress / Assigned Jobs on Parent Deactivation:** Status updated to `"Cancelled"` and `IsDeleted = true`. Assigned sitters are notified (via soft-deleted jobs filtered from active feeds).
- **Assigned Jobs on Sitter Deactivation:** Status updated to `"Cancelled"`, `AssignedSitter_ID = null`.

---

## 15. Session Revocation Behavior

All session revocation is immediate and database-enforced:
- **On Account Deactivation:** All rows matching `UserId` and `Role` in `UserSessions` are deleted.
- **On Explicit Logout (`DELETE api/auth/logout`):** The specific token is deleted from `UserSessions`.
- **On Authorize Interception:** If a valid token exists in `UserSessions` but the user account is flagged with `IsDeleted = true`, the session row is immediately deleted and `401 Unauthorized` is returned.

---

## 16. SessionAuthorize Deleted-Account Protection

`Infrastructure/SessionAuthorizeAttribute.cs` was enhanced:
```csharp
// B6: Verify associated account exists and has NOT been soft-deleted
if (role == "Parent")
{
    var parent = db.Parents.FirstOrDefault(p => p.Parent_ID == userId);
    if (parent == null || parent.IsDeleted)
    {
        db.Database.ExecuteSqlCommand("DELETE FROM UserSessions WHERE Token = @p0", token);
        actionContext.Response = CreateJsonResponse(actionContext, HttpStatusCode.Unauthorized, 
            new { message = "Account has been deactivated or deleted." });
        return;
    }
}
else if (role == "Sitter")
{
    var sitter = db.Babysitters.FirstOrDefault(s => s.Sitter_ID == userId);
    if (sitter == null || sitter.IsDeleted)
    {
        db.Database.ExecuteSqlCommand("DELETE FROM UserSessions WHERE Token = @p0", token);
        actionContext.Response = CreateJsonResponse(actionContext, HttpStatusCode.Unauthorized, 
            new { message = "Account has been deactivated or deleted." });
        return;
    }
}
```

---

## 17. Login Protection for Deleted Accounts

In `ParentController.LoginParent` and `BabySitterController.LoginBabysitter`:
- Checks `parent == null || parent.IsDeleted` / `sitter == null || sitter.IsDeleted`.
- If `IsDeleted == true`, immediately returns `Content(HttpStatusCode.Unauthorized, "Account has been deactivated.")`.
- No new sessions can be issued to deactivated accounts.

---

## 18. DTO / API Compatibility Changes

No existing frontend contracts were broken:
- All DTO schemas preserved.
- Added safe fallbacks (`"Deactivated Parent"`, `"Deleted User"`) in string fields so mobile/web clients do not encounter null reference exceptions.

---

## 19. RBAC Compatibility

Role-Based Access Control verified:
- Parent endpoints (`[SessionAuthorize(Roles = "Parent")]`) reject Sitter tokens with `403 Forbidden`.
- Sitter endpoints (`[SessionAuthorize(Roles = "Sitter")]`) reject Parent tokens with `403 Forbidden`.

---

## 20. IDOR Compatibility

Insecure Direct Object Reference defenses verified:
- Cross-account deactivation (`api/parent/deactivate/999`) returns `403 Forbidden`.
- Cross-account child access (`api/parent/children/999`) returns `403 Forbidden`.
- Cross-account job confirmations and updates return `403 Forbidden`.

---

## 21. Build Results

Command:
`dotnet clean WebApplication2.csproj --nologo; dotnet build WebApplication2.csproj -c Debug --nologo`

Result:
```
Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed: 00:00:03.08
```

---

## 22. Runtime Test Matrix

Automated test matrix executed against live IIS Express (`http://localhost:44368`) and SQL Server (`DESKTOP-UD649GB\SQLEXPRESS`):

| Test ID | Test Category | Test Description | Result | Details |
| :--- | :--- | :--- | :--- | :--- |
| **T1** | Schema | IsDeleted exists on all approved entities | **PASS** | All 9 approved entities verified; UserSessions excluded. |
| **T2** | Schema | Existing baseline records default to IsDeleted = 0 | **PASS** | 0 non-zero records in baseline data. |
| **T3** | Operations | Active Parent functions normally | **PASS** | Login 200, access own children returned 200. |
| **T4** | Operations | Active Babysitter functions normally | **PASS** | Login 200, access earnings returned 200. |
| **T5** | Operations | Queries exclude soft-deleted records | **PASS** | Active child included, soft-deleted child excluded. |
| **T6** | Soft Delete | Non-account entity (Child) soft deleted | **PASS** | Row physically exists, IsDeleted=1, excluded from GET. |
| **T7** | Parent Deact | Create isolated test account | **PASS** | HTTP 200 OK. |
| **T8** | Parent Deact | Login and obtain opaque token | **PASS** | Token issued; UserID authenticated. |
| **T9** | Parent Deact | Create multiple active sessions | **PASS** | Active sessions verified in database. |
| **T10** | Parent Deact | Lifecycle verification | **PASS** | Soft-deleted in DB, sessions revoked, old token 401, login rejected 401. |
| **T11** | Sitter Deact | Create isolated test account | **PASS** | HTTP 200 OK. |
| **T12** | Sitter Deact | Login and obtain opaque token | **PASS** | Token issued; Sitter authenticated. |
| **T13** | Sitter Deact | Lifecycle verification | **PASS** | Sitter soft-deleted, availability soft-deleted, sessions revoked, search excluded. |
| **T14** | Historical | Completed jobs preserved | **PASS** | Historical job intact with Status=Completed and IsDeleted=0. |
| **T15** | Historical | Preserved relationships queryable | **PASS** | Earnings parentName: 'Deactivated Parent', review: 'Deleted User'. |
| **T16** | Security | Cross-account deactivation blocked | **PASS** | Attempt to deactivate foreign ID resulted in HTTP 403. |
| **T17** | Security | Wrong role deactivation blocked | **PASS** | Sitter calling Parent endpoint resulted in HTTP 403. |
| **T18** | Security | Missing token blocked | **PASS** | Unauthenticated request resulted in HTTP 401. |
| **T19** | Regression | RBAC role restrictions enforced | **PASS** | Parent calling Sitter-only endpoint returned HTTP 403. |
| **T20** | Regression | IDOR protection enforced | **PASS** | Parent accessing unauthorized resource returned HTTP 403. |
| **T21** | Regression | BCrypt password verification succeeds | **PASS** | Login returned HTTP 200 OK. |
| **T22** | Regression | Logout physically revokes session token | **PASS** | Token removed from DB, post-logout call returned HTTP 401. |

**Matrix Summary: 22 Tests Total | 22 Passed | 0 Failed**

---

## 23. Database Verification

- **Pre-B6 Database Backup:** Confirmed created at `e:\FYP Project\documentations\FYP-Backups\Babysitter-Booking\Database\BabySitterBooking_BabyMinder_PreB6_2026-09-04.bak`.
- **Database Connection:** Verified via SQL Server Management & ADO.NET (`Server=DESKTOP-UD649GB\SQLEXPRESS;Database=BabySitterBooking and BabyMinder;Integrated Security=True;`).

---

## 24. Test Data Cleanup Results

Executed cleanup targeting all test records with prefix `b6%`:
```sql
DELETE FROM UserSessions WHERE Token LIKE 'b6%' OR UserId IN (SELECT Parent_ID FROM Parent WHERE Username LIKE 'b6%') OR UserId IN (SELECT Sitter_ID FROM Babysitter WHERE Username LIKE 'b6%');
DELETE FROM CryAlert WHERE ParentId IN (SELECT Parent_ID FROM Parent WHERE Username LIKE 'b6%');
DELETE FROM Review WHERE Reviewer_ID IN (SELECT Parent_ID FROM Parent WHERE Username LIKE 'b6%') OR ReviewFor_ID IN (SELECT Parent_ID FROM Parent WHERE Username LIKE 'b6%') OR Reviewer_ID IN (SELECT Sitter_ID FROM Babysitter WHERE Username LIKE 'b6%') OR ReviewFor_ID IN (SELECT Sitter_ID FROM Babysitter WHERE Username LIKE 'b6%');
DELETE FROM Notification WHERE UserID IN (SELECT Parent_ID FROM Parent WHERE Username LIKE 'b6%') OR UserID IN (SELECT Sitter_ID FROM Babysitter WHERE Username LIKE 'b6%');
DELETE FROM SitterAvailability WHERE Sitter_ID IN (SELECT Sitter_ID FROM Babysitter WHERE Username LIKE 'b6%');
DELETE FROM Bid WHERE Sitter_ID IN (SELECT Sitter_ID FROM Babysitter WHERE Username LIKE 'b6%') OR Job_ID IN (SELECT Job_ID FROM Job WHERE Title LIKE 'b6%');
DELETE FROM JobTimeSlot WHERE Job_ID IN (SELECT Job_ID FROM Job WHERE Title LIKE 'b6%');
DELETE FROM Job WHERE Title LIKE 'b6%' OR Parent_ID IN (SELECT Parent_ID FROM Parent WHERE Username LIKE 'b6%');
DELETE FROM Child WHERE ChildName LIKE 'b6%' OR Parent_ID IN (SELECT Parent_ID FROM Parent WHERE Username LIKE 'b6%');
DELETE FROM Parent WHERE Username LIKE 'b6%';
DELETE FROM Babysitter WHERE Username LIKE 'b6%';
```
Verification Query:
```sql
SELECT COUNT(*) FROM Parent WHERE Username LIKE 'b6%'
-- Result: 0
SELECT COUNT(*) FROM Babysitter WHERE Username LIKE 'b6%'
-- Result: 0
SELECT COUNT(*) FROM Child WHERE ChildName LIKE 'b6%'
-- Result: 0
SELECT COUNT(*) FROM Job WHERE Title LIKE 'b6%'
-- Result: 0
SELECT COUNT(*) FROM UserSessions WHERE Token LIKE 'b6%'
-- Result: 0
```
Total remaining test records: **0**.

---

## 25. Git Status

- **Current Branch:** `remediation`
- **Head Commit:** `5cf40d2eae940bc906758e8a0abdfcdbf9e87288`
- **Baseline Tag:** `fyp-baseline-pre-remediation` (`bc3a8773c899031036d05c441ff286694f894834`) — **UNTOUCHED**
- **Commit Status:** **NO COMMITS MADE** (Strict adherence to branch remediation uncommitted mandate)

---

## 26. Files Modified

### Modified Existing Codebase Files:
- `Controllers/ParentController.cs`
- `Controllers/BabySitterController.cs`
- `Controllers/ChildrenController.cs`
- `Controllers/JobsController.cs`
- `Controllers/MatchingController.cs`
- `Controllers/NotificationsController.cs`
- `Controllers/ReviewController.cs`
- `Controllers/CryDetectionController.cs`
- `Infrastructure/SessionAuthorizeAttribute.cs`
- `Models/Model1.edmx`
- `Models/Model1.Context.cs`
- `Models/Parent.cs`
- `Models/Babysitter.cs`
- `Models/Child.cs`
- `Models/Job.cs`
- `Models/Review.cs`
- `Models/Bid.cs`
- `Models/Notification.cs`
- `Models/SitterAvailability.cs`
- `Models/CryAlert.cs`

### Added Backend Files (untracked):
- `Controllers/AuthController.cs` (logout endpoint)
- `PHASE_B6_REPORT.md`

---

## 27. Known Limitations / Deferred Items

- React frontend UI does not yet expose the account deactivation settings button (this is reserved for future Frontend phases; backend APIs are 100% prepared and verified).
- Physical purge/anonymization policies for GDPR compliance (e.g. permanent deletion after 7 years) are deferred to post-MVP operations.

---

## 28. Explicit Confirmation

**JWT was not introduced or used.**
All authentication is handled strictly via database-backed opaque bearer session tokens stored and validated in the `UserSessions` table.
