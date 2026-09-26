# BACKEND SECURITY AUDIT — FORENSIC FINDINGS

> Read-only audit. No code modified. Evidence from actual source inspection.  

---

## 1. Authentication

| Item | Finding | Severity |
|------|---------|----------|
| Mechanism | **None** — no JWT, no cookie, no forms auth, no Identity | CRITICAL |
| Credential issued | **None** — login returns user data only | CRITICAL |
| `[Authorize]` usage | **0** across all controllers | CRITICAL |
| Token validation | N/A | — |
| Role validation | Client-supplied `Role` field checked against literal strings "Parent"/"Sitter" | HIGH |

**Trust model:** Anonymous API. No authenticated principal exists.

---

## 2. Authorization (IDOR Matrix)

| Endpoint | Resource ID | Ownership Check | Risk |
|----------|-------------|-----------------|------|
| POST api/parent/create-job | parentId, childId (body) | None | CRITICAL |
| GET api/parent/jobs/{parentId} | parentId (URL) | None | HIGH |
| GET api/parent/children/{parentId} | parentId (URL) | None | HIGH |
| PUT api/children/child/{childId} | childId (URL) | None | HIGH |
| GET api/babysitter/earnings/{sitterId} | sitterId (URL) | None | HIGH |
| GET api/notifications?userId= | userId (query) | None | HIGH |
| PUT api/notifications/{id}/read | id (URL) | None | HIGH |
| DELETE api/notifications/clear | userId (query) | None | HIGH |
| POST api/cry-detection | parentId (body) | None | HIGH |
| GET api/cry-detection/latest | parentId (query) | None | HIGH |
| POST api/review/add | Reviewer_ID, ReviewFor_ID (body) | None | HIGH |
| GET api/review/user/{userId} | userId (URL) | None | MEDIUM |
| POST api/matching/availability/save | sitterId (body) | None | HIGH |
| DELETE api/matching/availability/clear/{sitterId} | sitterId (URL) | None | HIGH |
| POST api/jobs/confirm/{jobId}/{sitterId} | jobId, sitterId (URL) | None | CRITICAL |
| POST api/jobs/updateStatus/{jobId} | jobId (URL) | None | HIGH |
| POST api/jobs/bulk-confirm | sitterId (body) | None | CRITICAL |

**Blocker:** No trustworthy authenticated principal exists. Ownership cannot be enforced without authentication (C1 dependency).

---

## 3. Password Security

| Item | Finding | Severity |
|------|---------|----------|
| Storage | **Plain text** — `Parent.Password`, `Babysitter.Password` stored as-is | CRITICAL |
| Registration | Password stored directly from form/JSON, no hashing | CRITICAL |
| Comparison | **Equality operator** (`!=`) — plain string comparison | CRITICAL |
| Salt | None | CRITICAL |
| Algorithm | None | CRITICAL |
| Exposure | Login response does NOT return password (good) | — |

**Migration blocker:** Hashing existing passwords requires one-time data migration or lazy rehash. Cannot silently overwrite without locking out users.

---

## 4. Input Validation

| Item | Finding | Severity |
|------|---------|----------|
| ModelState validation | **None** — no `ModelState.IsValid` checks anywhere | HIGH |
| Null handling | Minimal — some `??` defaults, some `TryParse` | MEDIUM |
| Over-posting | **Risk** — full entity binding in PUT endpoints (e.g., `UpdateJob` accepts full Job entity) | HIGH |
| SQL injection | **None in code** — all queries use EF LINQ or parameterized ADO.NET (Phase B converted to LINQ) | — |
| Rating bounds | Validated 1-5 (Phase B7) | — |

---

## 5. Sensitive Data Exposure

| Item | Finding | Severity |
|------|---------|----------|
| Password in response | **No** — login does not return password | — |
| Email exposure | `GetBabysitterDetails` returns `EmailAddress` | MEDIUM |
| Address exposure | Login returns `address` | LOW |
| Phone exposure | `GetParentJobs` returns `SitterPhone` | LOW |
| Internal IDs | Exposed in URLs and bodies (standard for API) | INFO |

---

## 6. CORS

| Item | Finding | Severity |
|------|---------|----------|
| Origins | `*` (any) | HIGH (when auth added) |
| Headers | `*` (any) | MEDIUM |
| Methods | `*` (any) | MEDIUM |
| Credentials | `SupportsCredentials` not set | — |
| Production-safe | **No** — wildcard CORS only safe while API is fully open | MEDIUM |

---

## 7. Error Handling

| Item | Finding | Severity |
|------|---------|----------|
| Stack traces | Exposed — `return BadRequest("... " + ex.Message)` leaks exception details | HIGH |
| Swallowed exceptions | **No** — all exceptions return 400 with message | — |
| Inconsistent responses | Mixed: some return `Ok(new {...})`, some return plain strings, some `BadRequest` | MEDIUM |
| Logging | **None** — no error logging anywhere | MEDIUM |

---

## 8. File Upload Security

| Item | Finding | Severity |
|------|---------|----------|
| Extension validation | **Yes** — only `.jpg`, `.jpeg`, `.png` allowed | — |
| MIME validation | **No** — only extension checked | MEDIUM |
| File size limit | **No** — no `ContentLength` max check | MEDIUM |
| Filename generation | `Guid.NewGuid()` — safe, no path traversal | — |
| Path traversal | **Prevented** — `Path.GetExtension` + GUID filename | — |

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 8 (auth none, IDOR, passwords, over-posting) |
| HIGH | 10 (validation, CORS, error leak) |
| MEDIUM | 6 (MIME, file size, logging, response consistency) |
| LOW | 2 (address, phone) |

**Top priorities:** Authentication → Password hashing → IDOR protection → Validation → Error handling.
