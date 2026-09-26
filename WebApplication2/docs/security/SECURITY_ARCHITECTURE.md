# Security Architecture — Babysitter Booking & Baby Minder Platform

## 1. Authentication Engine
Authentication uses database-backed opaque session tokens stored in SQL Server table `UserSessions`:
- **Token Generation:** 128-bit cryptographically secure GUIDs formatted as strings (`Guid.NewGuid().ToString()`).
- **Token Storage:** Primary Key in `UserSessions` with `UserId`, `Role`, `CreatedAt`, and `ExpiresAt` (7-day default sliding/fixed expiry).
- **Bearer Extraction:** Incoming HTTP `Authorization: Bearer <token>` header parsed by `SessionAuthorizeAttribute`.
- **Token Revocation:** Logout explicitly deletes the token from `UserSessions`. Soft deactivation deletes all user sessions immediately.
- **JWT Status:** JWT was deliberately dropped in Phase B3 in favor of database-backed opaque sessions for immediate revocation capability and simplicity.

## 2. Authorization & Role-Based Access Control (RBAC)
- Roles: `"Parent"`, `"Sitter"`.
- `[SessionAuthorize(Roles = "Parent")]` enforces parent-only endpoints.
- `[SessionAuthorize(Roles = "Sitter")]` enforces sitter-only endpoints.
- `[SessionAuthorize]` allows authenticated access for either role.
- `[AllowAnonymous]` permits unauthenticated access for registration, login, and public ratings.

## 3. Insecure Direct Object Reference (IDOR) Defense
- Identity is derived strictly from `ClaimsPrincipalHelper.GetUserId()` and `ClaimsPrincipalHelper.GetRole()` populated from the verified database session.
- Client-supplied IDs in URLs or bodies (e.g. `/api/parent/children/{parentId}`, `/api/babysitter/earnings/{sitterId}`) are compared against the authenticated user ID. Mismatches return `403 Forbidden`.

## 4. Perimeter Boundary Validation
- `Infrastructure/ValidationHelper.cs` acts as the first line of defense, checking for null bodies, non-positive IDs, out-of-range numerical values, illegal roles, and invalid date spans.
- Fail-fast rejection with `400 Bad Request` prevents database connection saturation and unhandled 500 exceptions.

## 5. File Upload & Path Traversal Security
- Image serving at `/api/images/{type}/{filename}` strictly rejects any input containing directory traversal patterns (`..`, `/`, `\`).
- File uploads are validated for permitted extensions (`.jpg`, `.jpeg`, `.png`) and saved with unique GUID filenames.
