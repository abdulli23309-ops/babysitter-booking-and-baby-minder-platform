# B2 — ARCHITECTURE DECISIONS

> **Phase:** B2 (Planning Only)  
> **Date:** 2026-09-02  
> **Branch:** remediation  
> **Source of truth:** Actual source code inspection (Web.config, Global.asax.cs, WebApiConfig.cs, packages.config, all controllers)

---

## C1 — AUTHENTICATION ARCHITECTURE

### Problem
The backend has **no authentication**. Login returns user data only (userId, name, role) with no credential issued. All 16+ endpoints are publicly accessible. The React frontend is a separate repository using Vite with a dev proxy.

### Constraints
- ASP.NET Web API 5.3 on .NET Framework 4.7.2
- Separate frontend/backend repositories
- No EF Core, no ASP.NET Core
- Must work with existing EDMX Database-First architecture
- Must preserve existing API contracts where possible

### Options Considered

#### Option A: JWT Bearer Authentication
**Mechanism:** Server issues a signed JSON Web Token at login. Client sends `Authorization: Bearer <token>` on subsequent requests. Server validates token via OWIN middleware or message handler.

| Aspect | Evaluation |
|--------|------------|
| Compatibility | Compatible via `System.IdentityModel.Tokens.Jwt` NuGet |
| Security | Industry standard, stateless, signed, expirable |
| Frontend integration | React stores token in localStorage/sessionStorage, sends in header |
| Complexity | Medium — requires token generation, validation middleware, secret management |
| Deployment | No server-side session storage needed |
| CORS implications | Requires specific origin (wildcard incompatible with credentials) |
| Logout behavior | Client-side token discard (stateless) |
| Token expiry | Configurable (recommend 1-2 hours) |
| Refresh strategy | Optional (defer to B4+) |
| Role claims | Embed role as claim |
| User ID claims | Embed userId as claim |

#### Option B: Cookie Authentication
**Mechanism:** Server issues an encrypted cookie via `Set-Cookie` header. Browser auto-sends on subsequent requests.

| Aspect | Evaluation |
|--------|------------|
| Compatibility | Native to ASP.NET (Forms Auth or OWIN Cookie Auth) |
| Security | Secure with `HttpOnly`, `Secure`, `SameSite` flags |
| Frontend integration | Requires `withCredentials: true` in React; cookie domain must match API domain |
| Complexity | Low-Medium |
| Deployment | Requires same-origin or carefully configured CORS + cookie domains |
| CORS implications | `SameSite=Lax` blocks cross-origin API calls |
| Logout behavior | Server can invalidate cookie |
| Token expiry | Sliding expiration supported |
| Role claims | Via `ClaimsIdentity` |
| User ID claims | Via `ClaimsIdentity` |

**Drawback:** Cookie auth assumes browser-based consumers. A separate React frontend on a different origin (Vite dev server) requires complex CORS + cookie configuration. Less suitable for potential future mobile/API consumers.

#### Option C: Custom Token (Database-Stored)
**Mechanism:** Server generates random token, stores in DB with expiry, returns to client. Client sends token in header. Server validates against DB.

| Aspect | Evaluation |
|--------|------------|
| Compatibility | Works with any stack |
| Security | Requires secure random generation, DB storage, cleanup job |
| Frontend integration | Same as JWT |
| Complexity | High — custom token table, validation middleware, cleanup |
| Deployment | Requires DB schema change (new table) |
| Logout behavior | Server can delete token |
| Token expiry | Manual cleanup or query-time check |

**Drawback:** Requires database schema change (forbidden without approval), more infrastructure than JWT, reinvents the wheel.

### Recommendation: **Option A — JWT Bearer Authentication**

**Reasoning:**
1. **Industry standard for SPA + API separation** — React frontend + separate Web API is the canonical JWT use case.
2. **Stateless** — no server-side session storage, no DB schema change for token storage.
3. **Stack-compatible** — `System.IdentityModel.Tokens.Jwt` works with .NET Framework 4.7.2 and ASP.NET Web API 5.
4. **Flexible claims** — userId, role, name embedded in token; no extra DB lookups for auth.
5. **Future-proof** — works for web, mobile, and third-party API consumers.

### Implementation Consequences

| Area | Detail |
|------|--------|
| Required NuGet packages | `System.IdentityModel.Tokens.Jwt` (v5.6.0+), `Microsoft.Owin.Security.Jwt` (v4.2.0+) |
| Configuration location | `Web.config` `<appSettings>` for JWT secret, issuer, audience, expiry |
| Authentication pipeline location | OWIN middleware (`Microsoft.Owin.Security.Jwt`) OR custom `DelegatingHandler` / `IAuthenticationFilter` |
| Token generation location | New `AuthController` or extend existing login methods |
| Token validation location | OWIN pipeline or global `IAuthenticationFilter` |
| Claims structure | `sub` (userId), `role` ("Parent"/"Sitter"), `name`, `iat`, `exp`, `iss`, `aud` |
| Expiry duration | **1 hour** for access token (configurable in Web.config) |
| Refresh token decision | **Defer to Phase B4+** — short expiry + re-login acceptable for FYP |
| Secret storage strategy | **Development:** `Web.config` appSettings. **Production:** Environment variable |
| Development configuration | Hardcoded secret in Web.config (flagged for production hardening) |
| Production configuration | Secret from environment variable; document the requirement |

### Login Response Change (FRONTEND CHANGE REQUIRED)

**Current:**
```json
{ "message": "Login Successful", "userId": 1, "name": "...", "role": "Parent" }
```

**Proposed (B3):**
```json
{ "message": "Login Successful", "userId": 1, "name": "...", "role": "Parent", "token": "eyJ...", "expiresAt": "2026-09-02T13:00:00Z" }
```


---

## C2 — PASSWORD MIGRATION STRATEGY

### Problem
Passwords are stored in **plain text** and compared with `==`. Existing users have plain-text passwords in the database. Hashing must not lock out existing users.

### Constraints
- Database-First EDMX (schema changes require approval)
- No silent account lockout
- Existing frontend login contract must remain functional
- .NET Framework 4.7.2 compatible hashing

### Options Considered

#### Option A: Immediate Forced Password Reset
**Mechanism:** Hash all existing passwords with a one-time script. Users must reset password on next login.

| Aspect | Evaluation |
|--------|------------|
| Security | All passwords hashed immediately |
| User experience | All existing users locked out until reset |
| Database impact | Data migration (UPDATE all password rows) |
| Frontend impact | Requires password reset flow (not built) |

**Drawback:** Locks out all existing users. Requires building a password reset flow (email infrastructure). Unacceptable for FYP.

#### Option B: Lazy Migration on Successful Login
**Mechanism:** Detect if stored password is plain text (no hash prefix). On successful plain-text comparison, hash the password and replace it. New registrations always hash.

| Aspect | Evaluation |
|--------|------------|
| Security | Gradually migrates all active users |
| User experience | Zero disruption — existing users log in normally |
| Database impact | **None** — same column, just different content |
| Frontend impact | None — login contract unchanged |
| Detection method | Hash prefix marker (e.g., `$2a$` for bcrypt) or length check |

**Drawback:** Inactive users remain plain text indefinitely. Acceptable for FYP.

#### Option C: One-Time Database Migration
**Mechanism:** Run a script to hash all existing passwords at once.

| Aspect | Evaluation |
|--------|------------|
| Security | All passwords hashed immediately |
| User experience | No user action required |
| Database impact | Data migration (UPDATE all rows) |
| Risk | If script fails mid-way, partial migration; rollback complex |

**Drawback:** Requires careful transaction handling. Risk of partial migration. No real advantage over lazy migration for FYP.

#### Option D: Hybrid (Lazy + Forced Reset for Admin)
**Mechanism:** Lazy migration for regular users, forced reset for admin/privileged accounts.

| Aspect | Evaluation |
|--------|------------|
| Complexity | High — two code paths |
| Benefit | Marginal for FYP (no admin role exists) |

**Drawback:** Over-engineered for current requirements.

### Recommendation: **Option B — Lazy Migration on Successful Login**

**Reasoning:**
1. **Zero user disruption** — existing users log in normally, migration is invisible.
2. **No database schema change** — same `Password` column stores either plain text or hash.
3. **No frontend change** — login contract identical.
4. **Self-healing** — every active user gets migrated on next login.
5. **Stack-compatible** — `BCrypt.Net-Next` or `Rfc2898DeriveBytes` (PBKDF2) both work with .NET Framework 4.7.2.

### Implementation Detail

**Hashing algorithm:** `BCrypt.Net-Next` (NuGet, .NET Framework 4.7.2 compatible) — includes salt automatically, prefix `$2a$`.

**Detection logic:**
```csharp
bool IsHashed(string storedPassword) => storedPassword.StartsWith("$2a$") || storedPassword.StartsWith("$2b$");
```

**Migration flow on login:**
1. Look up user by username.
2. If `IsHashed(storedPassword)`:
   - Verify with `BCrypt.Verify(plainPassword, storedPassword)`.
   - If valid → issue token.
3. If NOT hashed (legacy plain text):
   - Compare `storedPassword == plainPassword`.
   - If valid → hash with `BCrypt.HashPassword(plainPassword)`, save to DB, issue token.
   - If invalid → reject.

**New registration:** Always hash with `BCrypt.HashPassword(password)` before storing.

**Failed login:** Return `401 Unauthorized` with generic message `"Invalid username or password"` (don't reveal which field was wrong).

**Algorithm marker:** BCrypt's `$2a$` prefix serves as the marker — no extra column needed.


---

## C3 — AUTHORIZATION MODEL

### Problem
16+ endpoints expose user-scoped resources with no ownership validation. Without authentication, there is no trustworthy principal to enforce ownership.

### Recommendation: **Role-Based Authorization with Resource Ownership**

**Mechanism:**
- Apply `[Authorize]` globally (via `WebApiConfig` or `Global.asax`).
- Allow anonymous access only to login/register endpoints via `[AllowAnonymous]`.
- Use a custom `AuthorizationFilter` or inline checks to enforce resource ownership.

### Role Definitions
| Role String | Source | Endpoints |
|-------------|--------|-----------|
| `"Parent"` | Login response, token claim | ParentController, ChildrenController, JobsController (create/view) |
| `"Sitter"` | Login response, token claim | BabysitterController, MatchingController, JobsController (confirm) |

### Ownership Enforcement Pattern
For resource-scoped endpoints (e.g., `GET api/parent/jobs/{parentId}`):
1. Extract `userId` from authenticated principal (token claim).
2. Compare `userId` to `parentId` in URL/body.
3. If mismatch → return `403 Forbidden`.

### Complete Authorization Matrix

See `B2_AUTHORIZATION_MATRIX.md` for the full endpoint-by-endpoint matrix.

---

## C4 — CORS POLICY

### Problem
Current CORS is wildcard (`*`, `*`, `*`). This is safe only while the API is fully open (no auth). Once JWT is added with the `Authorization` header, wildcard origin is incompatible with credentials.

### Recommendation: **Environment-Specific CORS**

**Development:**
- Origins: `http://localhost:5173` (Vite default), `http://localhost:3000` (CRA fallback)
- Headers: `*`
- Methods: `*`
- Credentials: **Required** (for `Authorization` header to work with specific origin)

**Production:**
- Origins: `<frontend-production-url>` (document as placeholder)
- Headers: `*`
- Methods: `*`
- Credentials: **Required**

**Configuration location:** `WebApiConfig.cs` — read origins from `Web.config` appSettings (configurable per environment).

**Migration note:** When JWT is implemented, CORS must be updated simultaneously. Wildcard + credentials is rejected by browsers.

---

## C5 — API BACKWARD COMPATIBILITY

### Frontend Impact Matrix

| Backend Change | Classification | Frontend Action Required |
|----------------|----------------|-------------------------|
| Login response gains `token` + `expiresAt` fields | **FRONTEND CHANGE REQUIRED** | Store token, send in `Authorization` header |
| Registration response unchanged | **SAFE** | None |
| All endpoints require `Authorization` header | **FRONTEND CHANGE REQUIRED** | Attach token to all API calls |
| `[AllowAnonymous]` on login/register | **SAFE** | None |
| Error responses standardized (401/403) | **FRONTEND CHANGE REQUIRED** | Handle 401 (redirect to login), 403 (show forbidden) |
| CORS origin restricted | **FRONTEND CHANGE REQUIRED** | Ensure frontend origin matches configured origin |
| Password hashing (lazy) | **SAFE** | None (transparent) |
| Review validation (400 on bad input) | **FRONTEND CHANGE REQUIRED** | Display validation messages |
| Null guards (no behavior change) | **SAFE** | None |

### Critical Frontend Contracts to Preserve
1. **Login route & method:** `POST api/parent/login`, `POST api/babysitter/login` — unchanged.
2. **Login request DTO:** `{ Username, Password, Role }` — unchanged.
3. **User ID field name:** `userId` — preserved in token claim and response.
4. **Role field name:** `role` — preserved.
5. **All existing routes** — preserved (no renames).

---

## C6 — CRY ALERT "LATEST" SEMANTICS

### Problem
`CryDetectionController.GetLatest` orders by `CreatedAt DESC` (server insert time), not `Timestamp` (client-reported event time). These can diverge if alerts are uploaded in batch or with delay.

### Options

| Option | Semantics | Risk |
|--------|-----------|------|
| A: Order by `CreatedAt` | Latest database insertion | Delayed uploads appear "older" |
| B: Order by `Timestamp` | Latest actual cry event | Client can manipulate timestamp |

### Recommendation: **Option A — Order by `CreatedAt` (current behavior preserved)**

**Reasoning:**
1. **Server-authoritative** — `CreatedAt` is DB-generated (`getdate()`), cannot be manipulated by client.
2. **Consistent with audit trail** — insertion order is the canonical "when did we learn about this" timestamp.
3. **No behavior change** — preserves current contract; no frontend impact.
4. **Client `Timestamp` is auxiliary metadata** — useful for display but not for ordering.

**Documentation note:** The `Timestamp` field in the DTO should be documented as "event time reported by client device" while `CreatedAt` is "server receipt time." The API returns both; the frontend can display `Timestamp` but the ordering is by `CreatedAt`.

---

## Summary of Recommendations

| Decision | Recommendation |
|----------|----------------|
| C1 Authentication | **JWT Bearer Authentication** via `System.IdentityModel.Tokens.Jwt` |
| C2 Password Migration | **Lazy migration on login** via `BCrypt.Net-Next` |
| C3 Authorization | **Role-based `[Authorize]` + resource ownership checks** |
| C4 CORS | **Environment-specific origins** (dev: localhost, prod: configured) |
| C5 Frontend Impact | Login response changes (token added); all endpoints require auth header |
| C6 CryAlert Ordering | **Preserve `CreatedAt` ordering** (server-authoritative) |

