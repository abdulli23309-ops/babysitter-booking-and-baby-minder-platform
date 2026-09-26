# BACKEND MASTER BACKLOG — Prioritized Issue Register

> **Date:** 2026-09-02  
> **Branch:** remediation  
> **Purpose:** Every identified issue with ID, severity, evidence, and recommended remediation.

---

## AUTH — Authentication & Authorization

| ID | Severity | Area | Problem | Impact | Recommended Remediation | Frontend Impact | Dependency |
|----|----------|------|---------|--------|------------------------|-----------------|------------|
| AUTH-001 | P0 Critical | Auth | No authentication mechanism — all endpoints open | Any caller can access any endpoint | Implement stateless JWT bearer token validation (stack-native, no Identity framework) | Frontend must store/send token in Authorization header | None |
| AUTH-002 | P0 Critical | Auth | Plain-text password storage and comparison | Full credential exposure on DB breach | Implement password hashing (BCrypt/PBKDF2) with lazy rehash on login | None (transparent to frontend) | AUTH-001 |
| AUTH-003 | P0 Critical | IDOR | No ownership validation on any endpoint — 16 endpoints trust client IDs | Any user can read/modify any other user's data | Add ownership validation after auth is implemented; compare resource OwnerID to authenticated principal | None (transparent) | AUTH-001 |
| AUTH-004 | P1 High | Auth | Login accepts client-supplied Role string | Caller can assert any role | Role is determined by endpoint (URL prefix); Role field is redundant but validated. Consider removing reliance on client role | Frontend must still send correct role string | AUTH-001 |

---

## SEC — Security

| ID | Severity | Area | Problem | Impact | Recommended Remediation | Frontend Impact | Dependency |
|----|----------|------|---------|--------|------------------------|-----------------|------------|
| SEC-001 | P1 High | CORS | Fully open CORS (`*`, `*`, `*`) | Accepts requests from any origin | Tighten to specific frontend origins; add credentials support when auth is added | None (for dev); must match prod origin | AUTH-001 |
| SEC-002 | P1 High | Error Handling | Exception messages returned to client (`"Login Error: " + ex.Message`) | Potential information leakage | Return generic error messages; log details server-side | None | None |
| SEC-003 | P1 High | Sensitive Data | Login returns `address`, `pictureAddress` in parent response | PII exposure | Review which fields are necessary; consider separate profile endpoint | None | None |
| SEC-004 | P2 Medium | Input Validation | Review payload lacks validation beyond required fields | Invalid ratings, negative prices possible | Add range validation (Rating 1-5, positive prices, valid dates) | Frontend should mirror validation | None |
| SEC-005 | P2 Medium | File Upload | Image upload validates extension but not MIME type | Potential malicious file upload | Add MIME type validation; enforce size limits | None | None |

---

## API — Contract & Behavior

| ID | Severity | Area | Problem | Impact | Recommended Remediation | Frontend Impact | Dependency |
|----|----------|------|---------|--------|------------------------|-----------------|------------|
| API-001 | P2 Medium | Contract | Error responses are plain strings, not JSON | Frontend cannot parse errors consistently | Standardize error response shape (e.g., `{ "error": "message" }`) | Frontend must adopt new error shape | None |
| API-002 | P2 Medium | Contract | `GET api/notifications` uses query params (`?userId=&role=`), not route | Inconsistent with REST conventions | Document as current contract; consider route-based version in future | None | None |
| API-003 | P2 Medium | Dashboard | No single Parent Dashboard summary API | Frontend must compute counts from raw jobs list | Create `/api/parent/dashboard/{parentId}` returning aggregated stats | New frontend consumer | AUTH-001 |
| API-004 | P2 Medium | Dashboard | No single Babysitter Dashboard summary API | Frontend must compute counts from raw jobs list | Create `/api/babysitter/dashboard/{sitterId}` returning aggregated stats | New frontend consumer | AUTH-001 |


## DATA — Integrity

| ID | Severity | Area | Problem | Impact | Recommended Remediation | Frontend Impact | Dependency |
|----|----------|------|---------|--------|------------------------|-----------------|------------|
| DATA-001 | P1 High | Booking | No overlapping booking conflict detection for same sitter | Sitter could be double-booked for overlapping time slots | Add conflict check in job acceptance/confirmation: reject if sitter has overlapping confirmed job | None | None |
| DATA-002 | P2 Medium | Job State | Job status transitions not validated (e.g., Completed → Open) | Invalid state machine transitions possible | Add state transition validation (define allowed transitions) | None | None |
| DATA-003 | P2 Medium | CryAlert | `GetLatest` orders by `CreatedAt` (insert time) not `Timestamp` (event time) | "Latest" may not reflect actual latest event for delayed uploads | Clarify product intent; switch to `Timestamp` if event-time is authoritative | None | Product decision |

---

## CODE — Quality

| ID | Severity | Area | Problem | Impact | Recommended Remediation | Frontend Impact | Dependency |
|----|----------|------|---------|--------|------------------------|-----------------|------------|
| CODE-001 | P2 Medium | EF | N+1 queries in `ReviewController.GetUserReviews` (reviewer lookups) | Performance degradation with many reviews | Use batched lookups or joins | None | None |
| CODE-002 | P2 Medium | EF | `BabysitterController.GetEarnings` has N+1 in recentPayments loop | Performance issue | Pre-fetch parent names in single query | None | None |
| CODE-003 | P3 Low | Config | Duplicate connection string (`...Entities1`) unused | Confusion, maintenance burden | Remove dead connection string | None | None |
| CODE-004 | P3 Low | CORS | Global CORS in WebApiConfig AND per-controller attributes (redundant) | Maintenance confusion | Remove global CORS; keep per-controller (or vice versa) | None | None |

---

## MEDIA — File Handling

| ID | Severity | Area | Problem | Impact | Recommended Remediation | Frontend Impact | Dependency |
|----|----------|------|---------|--------|------------------------|-----------------|------------|
| MEDIA-001 | P2 Medium | Upload | Image upload filename uses GUID but original name not sanitized | Low risk (GUID used), but extension validation is extension-only | Add MIME validation; consider size limits | None | None |
| MEDIA-002 | P3 Low | Serving | ImageController returns 404 with plain string for missing images | Inconsistent error shape | Return standardized error shape | None | None |

---

## Summary Counts

| Severity | Count |
|----------|-------|
| P0 Critical | 3 (AUTH-001, AUTH-002, AUTH-003) |
| P1 High | 5 (AUTH-004, SEC-001, SEC-002, SEC-003, DATA-001) |
| P2 Medium | 8 (SEC-004, SEC-005, API-001-004, DATA-002, DATA-003, CODE-001, CODE-002, MEDIA-001) |
| P3 Low | 3 (CODE-003, CODE-004, MEDIA-002) |
