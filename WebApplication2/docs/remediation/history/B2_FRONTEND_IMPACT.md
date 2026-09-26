# B2 — FRONTEND IMPACT ANALYSIS

> **Phase:** B2 (Planning Only)
> **Date:** 2026-09-02
> **Branch:** remediation
> **Purpose:** Classify every planned backend change by its impact on the React frontend

---

## Classification Definitions

| Classification | Meaning | Frontend Action |
|----------------|---------|-----------------|
| **SAFE** | No frontend change needed | None |
| **FRONTEND CHANGE REQUIRED** | Backend contract preserved but new fields/headers expected | Update API service layer |
| **BREAKING** | Existing contract changes; frontend will break without updates | Mandatory frontend rewrite of affected flows |

---

## Authentication Changes (B3)

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| Login response gains `token` (string) and `expiresAt` (ISO 8601) fields | **FRONTEND CHANGE REQUIRED** | Store token in localStorage/sessionStorage; include in all future requests via `Authorization: Bearer <token>` header |
| Login success HTTP status stays 200 | **SAFE** | None |
| Login failure stays 401 | **SAFE** | None |
| Registration response unchanged | **SAFE** | None |
| New 401 response on protected endpoints when no/invalid token | **FRONTEND CHANGE REQUIRED** | Redirect to login screen on 401 |
| New 403 response on ownership/role violation | **FRONTEND CHANGE REQUIRED** | Show "Access denied" / "Insufficient permissions" UI |

---

## Password Security Changes (B4)

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| Password hashing is transparent (same login request/response) | **SAFE** | None |
| Registration stores hash instead of plain text | **SAFE** | None |
| Existing users continue to log in | **SAFE** | None |

---

## Authorization Changes (B5)

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| All endpoints require `Authorization` header | **FRONTEND CHANGE REQUIRED** | Attach bearer token to every API call (axios interceptor or fetch wrapper) |
| Public endpoints remain public (login, register, filter-sitters, babysitter/{id}, reviews/user) | **SAFE** | None for public pages |
| Cross-user ID manipulation returns 403 | **SAFE** (defensive) | None; UI already scoped per-user |

---

## Booking/State Integrity Changes (B6)

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| Double-booking prevented (409 Conflict on overlap) | **FRONTEND CHANGE REQUIRED** | Handle 409; show "Sitter no longer available" message |
| Invalid state transition returns 400/409 | **FRONTEND CHANGE REQUIRED** | Display error message; refresh job state |
| Duplicate bid prevented | **FRONTEND CHANGE REQUIRED** | Disable bid button after submission; handle 409 |
| Duplicate review prevented | **FRONTEND CHANGE REQUIRED** | Handle 409; show "Already reviewed" |
| Duplicate availability prevented | **SAFE** (idempotent upsert) | None |

---

## Validation Changes (B7)

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| Review rating outside 1-5 returns 400 | **FRONTEND CHANGE REQUIRED** | Display validation error; keep form data |
| Required fields missing returns 400 | **FRONTEND CHANGE REQUIRED** | Display field-level errors |
| Date/time format invalid returns 400 | **FRONTEND CHANGE REQUIRED** | Display parse error |

---

## Error Handling Changes (B8)

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| Error response shape standardized to `{ message, statusCode }` | **FRONTEND CHANGE REQUIRED** | Update error parsing to read `message` field (if not already) |
| No stack traces in production | **SAFE** | None |
| Server-side logging added | **SAFE** | None |

---

## Performance Changes (B9)

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| N+1 queries eliminated | **SAFE** | None (same response, faster) |
| Dead code removed | **SAFE** | None |

---

## CORS / File Upload Changes (B10)

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| CORS origin restricted to configured value | **FRONTEND CHANGE REQUIRED** | Ensure deployed frontend origin matches backend config; dev proxy unaffected |
| CORS credentials enabled | **FRONTEND CHANGE REQUIRED** | `withCredentials: true` (axios) or `credentials: 'include'` (fetch) |
| File size limit enforced | **FRONTEND CHANGE REQUIRED** | Show "File too large" on 413 |
| File type validation tightened | **SAFE** (already validated) | None |

---

## Critical Frontend Contracts Preserved

These existing contracts **will NOT change** in any phase:

| Contract | Current Value | Status |
|----------|---------------|--------|
| Parent login route | `POST api/parent/login` | Preserved |
| Babysitter login route | `POST api/babysitter/login` | Preserved |
| Login request DTO | `{ Username, Password, Role }` | Preserved |
| User ID field name | `userId` | Preserved (also in token claim) |
| Role field name | `role` | Preserved |
| All existing route paths | — | Preserved (no renames) |
| HTTP methods per endpoint | — | Preserved |
| PascalCase response fields | `Job_ID`, `Title`, etc. | Preserved |
| Image serving path | `/Images/...` (static) | Preserved |

---

## Summary Impact Matrix

| Phase | SAFE | FRONTEND CHANGE REQUIRED | BREAKING |
|-------|------|--------------------------|----------|
| B3 Authentication | 3 | 4 | 0 |
| B4 Passwords | 4 | 0 | 0 |
| B5 Authorization | 2 | 2 | 0 |
| B6 Booking Integrity | 2 | 4 | 0 |
| B7 Validation | 0 | 3 | 0 |
| B8 Error Handling | 3 | 1 | 0 |
| B9 Performance | 2 | 0 | 0 |
| B10 CORS/Upload | 1 | 3 | 0 |
| **Total** | **17** | **17** | **0** |

**Zero breaking changes.** All frontend impacts are additive (new fields, new headers, new error codes) — no existing contracts are removed or renamed.

---

## Frontend Service Layer Changes Required

The React frontend will need updates in these areas:

1. **API client / axios instance** — Add request interceptor to attach `Authorization: Bearer <token>` header; add response interceptor to handle 401 (redirect to login).

2. **Auth context / localStorage** — Store `token` and `expiresAt` on login; clear on logout/expiry.

3. **Error handling** — Read `message` field from error responses; handle 403 (forbidden), 409 (conflict), 413 (file too large).

4. **Form validation feedback** — Display server-side validation errors (rating range, required fields, date format).

5. **Booking flow** — Handle 409 on double-booking; disable submit buttons to prevent duplicates.

6. **CORS credentials** — Enable `withCredentials` once CORS is tightened.

