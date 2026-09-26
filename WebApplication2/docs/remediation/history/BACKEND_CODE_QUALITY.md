# BACKEND CODE QUALITY AUDIT

> Read-only audit of controllers, EF usage, error handling, and DTO boundaries.  

---

## 1. Controllers

| Issue | Finding | Severity |
|-------|---------|----------|
| Business logic in controllers | **Yes** — job creation logic (time slot matching, payment calculation) in `ParentController.CreateJob` | HIGH |
| Duplicate code | **Yes** — image upload logic duplicated in `ParentController.RegisterParent` and `BabysitterController.RegisterBabysitter` | MEDIUM |
| Long methods | `CreateJob` (~80 lines), `LoginParent` (~40 lines) | MEDIUM |
| Direct EF access | **All controllers** — no repository/service layer | MEDIUM |
| Missing services | **Yes** — no abstraction for jobs, reviews, notifications | MEDIUM |

---

## 2. Entity Framework Usage

| Issue | Finding | Severity |
|-------|---------|----------|
| N+1 queries | **Fixed in Phase B4** — `GetUserReviews` now uses batched lookups | — |
| Missing `Include()` | Some queries use lazy loading (navigation properties) — may cause N+1 at runtime | MEDIUM |
| Multiple `SaveChanges` | `CreateJob` calls `SaveChanges` 3 times (create job, rollback, add slots) | MEDIUM |
| Context misuse | Each method creates `new DbContext()` in `using` — acceptable for Web API | LOW |
| Async/await | **Not used** — all calls synchronous. Not required by EF6 but could improve throughput | LOW |

---

## 3. Error Handling

| Issue | Finding | Severity |
|-------|---------|----------|
| Try/catch duplication | **Yes** — every controller method wrapped in try/catch returning `BadRequest("... " + ex.Message)` | MEDIUM |
| Silent exceptions | **No** — all exceptions return 400 | — |
| Generic 500 responses | **No** — all errors return 400 with exception message (leaks stack info) | HIGH |
| Logging | **None** — no error logging framework | MEDIUM |

---

## 4. DTO Boundaries

| Issue | Finding | Severity |
|-------|---------|----------|
| Entities returned directly | **Yes** — `GetProfile`, `GetBabysitterDetails`, `GetJobById` return full entities | HIGH |
| Circular references | **Risk** — `Job` has `Babysitter`, `Child`, `Parent` nav properties; may cause JSON loop | MEDIUM |
| Sensitive field exposure | Entities may expose `Password` property if serialized (not currently, but risk) | MEDIUM |
| Over-posting | **Yes** — PUT endpoints accept full entity binding | HIGH |

---

## 5. Naming Consistency

| Aspect | Finding |
|--------|---------|
| Route naming | **Inconsistent** — `create-job` (kebab), `availability/slash`, `filter-sitters` (kebab), `updateStatus` (camelCase) |
| DTO suffix | **Consistent** — all DTOs suffixed with `Dto` or `DTO` (mixed case) |
| Method naming | **Consistent** — PascalCase for controller methods |
| Property naming | **Consistent** — PascalCase for C# properties |

---

## 6. Dead Code

| Item | Finding |
|------|---------|
| `Model1.Designer.cs` | Contains only comments (9 lines) — auto-generated stub, T4 output goes to `Model1.cs` |
| Unused usings | **Removed in Phase B5** — `System.Data.Common.CommandTrees.ExpressionBuilder` removed from MatchingController |
| Commented-out code | Minimal — no large blocks found |
| Obsolete endpoints | None found — all endpoints appear active |

---

## Summary

| Category | Issues |
|----------|--------|
| Controllers | Business logic in controllers, duplicate image upload code, no services |
| EF | Multiple SaveChanges, potential N+1 via lazy loading, no async |
| Error handling | Exception messages leaked, no logging, duplicated try/catch |
| DTOs | Entities returned directly, circular reference risk, over-posting |
| Naming | Route naming inconsistent (kebab vs camelCase vs slash) |

**Phase B improvements applied:**
- N+1 fixed in ReviewController (B4)
- Unused using removed from MatchingController (B5)
- Dynamic GroupBy replaced with strongly-typed DTO (B6)
- Review validation added (B7)
- Null guards added (B8)

**Not yet addressed:** Business logic extraction, error handling standardization, DTO boundaries, logging.
