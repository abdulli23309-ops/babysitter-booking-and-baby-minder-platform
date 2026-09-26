# B2 — AUTHORIZATION MATRIX

> **Phase:** B2 (Planning Only)
> **Date:** 2026-09-02
> **Branch:** remediation
> **Scope:** Every endpoint across all 9 controllers
> **Trust model (current):** No authenticated principal — all IDs are client-supplied and trusted.
> **Trust model (post-B3):** JWT bearer token provides authenticated `UserId` + `Role`.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔓 | Currently public (no auth) |
| 🔒 | Requires authentication post-B3 |
| 👤 | Resource ownership check required (caller must own the resource) |
| 🎭 | Role restriction (Parent-only or Sitter-only) |

---

## ParentController (`api/parent`)
## ReviewController (`api/review`)

| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 25 | `add` | POST | 🔓 | 🔒 | Either | `token.UserId == dto.Reviewer_ID` | User posts own review |
| 26 | `user/{userId}/{role}` | GET | 🔓 | 🔓 Public | — | — | View reviews (public) |

---

## NotificationsController (`api/notifications`)

| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 27 | `GET` (query: userId, role) | GET | 🔓 | 🔒 | Either | `token.UserId == userId` | User views own notifications |
| 28 | `{id}/read` | PUT | 🔓 | 🔒 | Either | `token.UserId == notification.UserID` | User marks own notification read |
| 29 | `clear` (query: userId) | DELETE | 🔓 | 🔒 | Either | `token.UserId == userId` | User clears own notifications |
| 30 | `POST` (create) | POST | 🔓 | 🔒 | Either | `token.UserId == dto.UserID` | System creates notification for user |

---

## CryDetectionController (`api/cry-detection`)

| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 31 | `POST` (create alert) | POST | 🔓 | 🔒 | Sitter | `token.UserId == dto.BabysitterId` | Sitter posts alert for own session |
| 32 | `latest` (query: parentId) | GET | 🔓 | 🔒 | Parent | `token.UserId == parentId` | Parent views own latest alert |

---

## ChildrenController (`api/children`)

| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 33 | `POST` (add child) | POST | 🔓 | 🔒 | Parent | `token.UserId == dto.ParentId` | Parent adds own child |
| 34 | `child/{childId}` | PUT | 🔓 | 🔒 | Parent | `token.UserId == child.Parent_ID` | Parent updates own child |

---

## ImageController (`api/images`)

| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 35 | `POST` (upload) | POST | 🔓 | 🔒 | Either | `token.UserId == dto.UserId` | User uploads own image |

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Total endpoints | 35 |
| Public (no auth) | 7 (register ×2, login ×2, filter-sitters, babysitter/{id}, reviews/user) |
| Authenticated (any role) | 28 |
| Parent-only | 12 |
| Sitter-only | 13 |
| Either role (ownership-based) | 3 |

---

## Ownership Enforcement Patterns

### Pattern 1 — URL ID matches token
```csharp
// GET api/parent/profile/{parentId}
if (parentId != int.Parse(User.Identity.Name)) // or token.UserId
    return Forbidden();
```

### Pattern 2 — Body ID matches token
```csharp
// POST api/parent/create-job
if (dto.ParentId != token.UserId)
    return Forbidden();
```

### Pattern 3 — Resource ownership lookup
```csharp
// GET api/jobs/details/{jobId}
var job = db.Jobs.Find(jobId);
if (job == null) return NotFound();
if (job.Parent_ID != token.UserId && job.AssignedSitter_ID != token.UserId)
    return Forbidden();
```

### Pattern 4 — Role gate
```csharp
// All BabysitterController endpoints
[Authorize(Roles = "Sitter")]
```

---

## Failure Semantics

| Scenario | HTTP Status | Response |
|----------|-------------|----------|
| No token / invalid token | 401 Unauthorized | `{ "message": "Authentication required" }` |
| Valid token, wrong role | 403 Forbidden | `{ "message": "Insufficient permissions" }` |
| Valid token, wrong ownership | 403 Forbidden | `{ "message": "Access denied" }` |
| Resource not found | 404 NotFound | `{ "message": "Resource not found" }` |


| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 1 | `register` | POST | 🔓 | 🔓 Public | — | — | No auth needed to register |
| 2 | `login` | POST | 🔓 | 🔓 Public | — | — | Returns JWT token post-B3 |
| 3 | `profile/{parentId}` | GET | 🔓 | 🔒 | Parent | `token.UserId == parentId` | Parents view own profile |
| 4 | `profile/{parentId}` | PUT | 🔓 | 🔒 | Parent | `token.UserId == parentId` | Parents edit own profile |
| 5 | `children/{parentId}` | GET | 🔓 | 🔒 | Parent | `token.UserId == parentId` | Parents view own children |
| 6 | `jobs/{parentId}` | GET | 🔓 | 🔒 | Parent | `token.UserId == parentId` | Parents view own jobs |
| 7 | `create-job` | POST | 🔓 | 🔒 | Parent | `token.UserId == dto.ParentId` | Parent creates job for self |
| 8 | `notifications/{parentId}` | GET | 🔓 | 🔒 | Parent | `token.UserId == parentId` | Parents view own notifications |

---

## BabysitterController (`api/babysitter`)

| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 9 | `register` | POST | 🔓 | 🔓 Public | — | — | No auth needed |
| 10 | `login` | POST | 🔓 | 🔓 Public | — | — | Returns JWT token post-B3 |
| 11 | `profile/{sitterId}` | GET | 🔓 | 🔒 | Sitter | `token.UserId == sitterId` | Sitter views own profile |
| 12 | `profile/{sitterId}` | PUT | 🔓 | 🔒 | Sitter | `token.UserId == sitterId` | Sitter edits own profile |
| 13 | `earnings/{sitterId}` | GET | 🔓 | 🔒 | Sitter | `token.UserId == sitterId` | Sitter views own earnings |

---

## JobsController (`api/jobs`)

| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 14 | `sitter/{sitterId}` | GET | 🔓 | 🔒 | Sitter | `token.UserId == sitterId` | Sitter views assigned jobs |
| 15 | `details/{jobId}` | GET | 🔓 | 🔒 | Either | `token.UserId == job.Parent_ID OR job.AssignedSitter_ID` | Owner (parent or assigned sitter) only |
| 16 | `confirm/{jobId}/{sitterId}` | POST | 🔓 | 🔒 | Sitter | `token.UserId == sitterId` | Sitter confirms own acceptance |
| 17 | `updateStatus/{jobId}` | POST | 🔓 | 🔒 | Either | `token.UserId == job.Parent_ID OR job.AssignedSitter_ID` | Owner only |
| 18 | `bulk-confirm` | POST | 🔓 | 🔒 | Sitter | `token.UserId == dto.SitterId` | Sitter bulk-confirms own |

---

## MatchingController (`api/matching`)

| # | Endpoint | Method | Current | Post-B3 Auth | Role | Ownership Rule | Notes |
|---|----------|--------|---------|--------------|------|----------------|-------|
| 19 | `filter-sitters` | POST | 🔓 | 🔓 Public | — | — | Browse sitters (public catalog) |
| 20 | `babysitter/{id}` | GET | 🔓 | 🔓 Public | — | — | View sitter profile (public) |
| 21 | `availability/save` | POST | 🔓 | 🔒 | Sitter | `token.UserId == dto.SitterId` | Sitter saves own availability |
| 22 | `availability/clear/{sitterId}` | DELETE | 🔓 | 🔒 | Sitter | `token.UserId == sitterId` | Sitter clears own availability |
| 23 | `availability/{sitterId}` | GET | 🔓 | 🔒 | Sitter | `token.UserId == sitterId` | Sitter views own availability |
| 24 | `matched-jobs/{sitterId}` | GET | 🔓 | 🔒 | Sitter | `token.UserId == sitterId` | Sitter views matched jobs |
