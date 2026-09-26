# B2 — IMPLEMENTATION ROADMAP

> **Phase:** B2 (Planning Only)  
> **Date:** 2026-09-02  
> **Branch:** remediation  
> **Scope:** Phases B3 through B11

---

## Phase B3 — Authentication Foundation

| Aspect | Detail |
|--------|--------|
| **Objective** | Issue JWT bearer tokens at login; validate tokens on protected endpoints |
| **Issues addressed** | No authenticated principal; all endpoints public |
| **Files affected** | `Web.config` (appSettings for JWT secret/expiry), `WebApiConfig.cs`, new `Infrastructure\JwtTokenGenerator.cs`, new `Infrastructure\JwtValidationHandler.cs`, `Controllers\ParentController.cs` (login returns token), `Controllers\BabysitterController.cs` (login returns token), `Global.asax.cs` |
| **Database impact** | **A — No database change** (JWT is stateless) |
| **API contract impact** | Login response gains `token` + `expiresAt` fields; all endpoints require `Authorization` header |
| **Frontend impact** | FRONTEND CHANGE REQUIRED — store token, attach to requests |
| **Dependencies** | None (foundation) |
| **Risks** | Token secret management; clock skew; client token storage |
| **Verification** | Build succeeds; login returns valid JWT; `[Authorize]` endpoint rejects anonymous |
| **Stop condition** | Login returns a token that validates on a protected test endpoint |

---

## Phase B4 — Password Security Migration

| Aspect | Detail |
|--------|--------|
| **Objective** | Replace plain-text password storage with BCrypt hashing; preserve existing user access |
| **Issues addressed** | P0 plain-text passwords |
| **Files affected** | `Controllers\ParentController.cs`, `Controllers\BabysitterController.cs`, new `Services\PasswordHasher.cs`, `Models\Parent.cs` (no schema change), `Models\Babysitter.cs` (no schema change) |
| **Database impact** | **B — Data migration** (lazy: rehash on login). **No schema change** |
| **API contract impact** | **SAFE** — transparent to client |
| **Frontend impact** | **SAFE** — no change |
| **Dependencies** | B3 complete (login flow stable) |
| **Risks** | Legacy detection heuristic; algorithm marker column (optional) |
| **Verification** | New registration stores hash; legacy user login succeeds and rehashes; build passes |
| **Stop condition** | All new passwords hashed; legacy passwords rehash on login |

---

## Phase B5 — Authorization and IDOR Protection

| Aspect | Detail |
|--------|--------|
| **Objective** | Add `[Authorize]` to protected endpoints; enforce resource ownership |
| **Issues addressed** | IDOR on 16+ endpoints; client-supplied IDs trusted |
| **Files affected** | All controllers (add `[Authorize]`), new ownership filter, `Controllers\*.cs` |
| **Database impact** | **A — No database change** |
| **API contract impact** | 401/403 responses standardized |
| **Frontend impact** | FRONTEND CHANGE REQUIRED — handle 401/403 |
| **Dependencies** | B3 (JWT provides `UserId` claim) |
| **Risks** | Breaking public endpoints; ownership check bugs |
| **Verification** | Anonymous → 401; cross-user → 403; owner → 200; build passes |
| **Stop condition** | Every endpoint matches the authorization matrix |

---

## Phase B6 — Booking Conflict and State Integrity

| Aspect | Detail |
|--------|--------|
| **Objective** | Prevent double-booking; validate job state transitions; prevent duplicate bids/reviews/availability |
| **Issues addressed** | Double-booking; invalid state transitions; duplicate records |
| **Files affected** | `Controllers\JobsController.cs`, `Controllers\MatchingController.cs`, `Controllers\ReviewController.cs`, `Controllers\ParentController.cs`, `Controllers\BabysitterController.cs` |
| **Database impact** | **D — Manual production operation** (optional unique indexes) or **A** (application-level only) |
| **API contract impact** | New error responses for conflicts (`409 Conflict`) |
| **Frontend impact** | FRONTEND CHANGE REQUIRED — display conflict messages |
| **Dependencies** | B3 + B5 |
| **Risks** | Race conditions; false positives |
| **Verification** | Overlapping booking rejected; duplicate bid rejected; invalid state transition rejected |
| **Stop condition** | Conflicts return 409; state transitions validated |

---

## Phase B7 — Validation and DTO Boundaries

| Aspect | Detail |
|--------|--------|
| **Objective** | Strengthen server-side validation; ensure DTOs carry explicit validation rules |
| **Issues addressed** | Minimal validation; over-posting risk |
| **Files affected** | `DTOs\*.cs`, `Controllers\*.cs` (check `ModelState.IsValid`) |
| **Database impact** | **A — No database change** |
| **API contract impact** | 400 with validation messages |
| **Frontend impact** | FRONTEND CHANGE REQUIRED — display field-level errors |
| **Dependencies** | None |
| **Risks** | Over-validating; breaking existing valid payloads |
| **Verification** | Invalid input → 400; valid input → proceeds; build passes |
| **Stop condition** | All POST/PUT endpoints validate required fields + bounds |

---

## Phase B8 — Error Handling and Logging

| Aspect | Detail |
|--------|--------|
| **Objective** | Standardize error responses; remove swallowed exceptions; prevent stack-trace leakage |
| **Issues addressed** | Inconsistent errors; leaked exception details; silent failures |
| **Files affected** | New `Infrastructure\ExceptionHandler.cs`, `Controllers\*.cs`, `Global.asax.cs` |
| **Database impact** | **A — No database change** |
| **API contract impact** | Consistent error shape: `{ "message": "...", "statusCode": NNN }` |
| **Frontend impact** | **SAFE** (message field preserved) |
| **Dependencies** | None |
| **Risks** | Losing debug info (mitigate with server-side logging) |
| **Verification** | No stack traces in production errors; build passes |
| **Stop condition** | All errors return consistent shape |

---

## Phase B9 — Performance and Code Quality

| Aspect | Detail |
|--------|--------|
| **Objective** | Fix N+1 queries; remove dead code; optimize hot paths |
| **Issues addressed** | N+1 in `GetUserReviews`, `GetEarnings`, `GetJobDetails`; dead usings |
| **Files affected** | `Controllers\ReviewController.cs`, `Controllers\BabysitterController.cs`, `Controllers\JobsController.cs`, `Controllers\MatchingController.cs` |
| **Database impact** | **A — No database change** |
| **API contract impact** | **SAFE** (same output, faster) |
| **Frontend impact** | **SAFE** |
| **Dependencies** | None |
| **Risks** | Changing query shape; breaking projections |
| **Verification** | Same output; fewer DB round-trips; build passes |
| **Stop condition** | N+1 queries eliminated |

---

## Phase B10 — CORS and File Upload Security

| Aspect | Detail |
|--------|--------|
| **Objective** | Tighten CORS for production; harden image upload validation |
| **Issues addressed** | Wildcard CORS; file upload risks |
| **Files affected** | `WebApiConfig.cs`, `Web.config`, `Controllers\ImageController.cs`, `Controllers\ParentController.cs`, `Controllers\BabysitterController.cs` |
| **Database impact** | **A — No database change** |
| **API contract impact** | **SAFE** (CORS is transport-layer) |
| **Frontend impact** | FRONTEND CHANGE REQUIRED if origin must be registered |
| **Dependencies** | B3 (CORS must allow credentials with JWT) |
| **Risks** | Blocking legitimate frontend origin |
| **Verification** | Configured origin succeeds; other blocked; oversized file rejected |
| **Stop condition** | CORS allows only configured origins + credentials |

---

## Phase B11 — Regression Testing and Final Verification

| Aspect | Detail |
|--------|--------|
| **Objective** | Verify all remediation phases; confirm build; document remaining gaps |
| **Issues addressed** | Regression risk from B3–B10 changes |
| **Files affected** | All changed controllers; build verification |
| **Database impact** | **A — No database change** |
| **API contract impact** | Final verification of all contracts |
| **Frontend impact** | Final confirmation of frontend impact list |
| **Dependencies** | B3–B10 all complete |
| **Risks** | Undetected regression in edge cases |
| **Verification** | Full build green; manual endpoint tracing; review git diff |
| **Stop condition** | Build green; all B-items verified |

---

## Dependency Graph

```
B3 (Auth Foundation)
├── B4 (Password Migration)
├── B5 (Authorization/IDOR)
│   └── B6 (Booking Integrity)
└── B10 (CORS hardening)

B7 (Validation) ── independent ──┤
B8 (Error Handling) ── independent ─┤── B11 (Regression)
B9 (Performance) ── independent ──┘
```

**Critical path:** B3 → B5 → B6 → B11  
**Parallelizable:** B4, B7, B8, B9 (can run alongside B3-B6)

