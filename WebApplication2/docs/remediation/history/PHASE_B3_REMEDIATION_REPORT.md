# PHASE B3-R REMEDIATION REPORT — JWT Authentication Foundation

Date: 2026-09-03
Branch: `remediation` (uncommitted working-tree changes; nothing committed)
Baseline tag: `fyp-baseline-pre-remediation` (untouched)

---

## 1. Objective

B3-R corrected the failed Phase B3 implementation. The independent audit proved the
claimed database-backed opaque-session authentication did not exist in functional form
(empty `AuthController.cs`, `UserSession.cs`, `SessionAuthorizeAttribute.cs`,
`Create_UserSessions.sql`; no `UserSessions` table; no token issuance; no protected
endpoints). B3-R removed the failed session artifacts and implemented the **B2-approved
JWT Bearer architecture**.

## 2. Original Audit Findings Addressed

| Audit finding | Remediation |
|---|---|
| Empty `AuthController.cs` / `UserSession.cs` / `SessionAuthorizeAttribute.cs` / `Create_UserSessions.sql` | Session placeholders deleted; `AuthController.cs` recreated with functional `GET api/auth/me` |
| No token issuance | `JwtTokenGenerator` implemented; both login endpoints issue signed JWTs |
| No protected endpoints | `JwtAuthenticationHandler` (DelegatingHandler) validates `Bearer` tokens; `[Authorize]` enforced on `api/auth/me` |
| 142 MSB3277 warnings | Project/package reconciliation — **now 0 warnings** |
| `bin\Debug\net472` SDK-style output broke IIS layout | `OutputPath=bin\`, `AppendTargetFrameworkToOutputPath=false` |
| Orphaned `ClaimsPrincipalHelper.cs` | Adapted and referenced by `AuthController` (verified live) |
| Mixed packages.config / PackageReference strategy | PackageReference is now the single coherent strategy; legacy `packages\` folder removed (git-ignored artifact) |

## 3. Architecture Implemented

- **JWT Bearer, stateless** — signed HS256 via `System.IdentityModel.Tokens.Jwt` 6.35.0.
- Token transport: `Authorization: Bearer <token>`.
- Expiry: **60 minutes** (`JwtExpiryMinutes` in Web.config).
- Claims: `sub` (user id), `role` (`Parent`/`Sitter`, mapped to `ClaimTypes.Role`),
  `name` (`ClaimTypes.Name`), `nameidentifier` (mapped to `ClaimTypes.NameIdentifier`),
  `jti`, `iat`, `exp`, `iss`, `aud`. No password or sensitive data in claims.
- Issuer/audience/signature/lifetime validated on every request.
- Logout: client-side token discard (stateless). No DB sessions, no revocation.
- Refresh tokens: deferred (per B2).

## 4. Files Changed

| File | Change |
|---|---|
| `Infrastructure/JwtConfiguration.cs` | NEW — reads `JwtSecret`/`JwtIssuer`/`JwtAudience`/`JwtExpiryMinutes` from Web.config appSettings; fails fast if missing; secret never hardcoded in C# |
| `Infrastructure/JwtTokenGenerator.cs` | NEW — issues signed, expiring JWTs (HS256, UTC) |
| `Infrastructure/JwtAuthenticationHandler.cs` | NEW — `DelegatingHandler` validating Bearer tokens; establishes `Thread.CurrentPrincipal` + `HttpContext.Current.User`; 401 on missing/malformed/invalid/expired tokens; wrong scheme ⇒ 401 |
| `Infrastructure/ClaimsPrincipalHelper.cs` | ADAPTED — now used by `AuthController`; reads NameIdentifier/Role/Name from the authenticated principal |
| `Controllers/AuthController.cs` | RECREATED (was empty) — `[Authorize]`, `RoutePrefix("api/auth")`, `GET me` returning `{ userId, role, name }` |
| `Controllers/ParentController.cs` | Login now issues JWT; response adds `token` + `expiresAt`; all legacy fields preserved; routes/DTOs unchanged |
| `Controllers/BabySitterController.cs` | Same contract changes; role claim = `Sitter` |
| `App_Start/WebApiConfig.cs` | Registers `JwtAuthenticationHandler` in the message-handler pipeline |
| `Web.config` | Added `JwtSecret` (dev value only), `JwtIssuer`, `JwtAudience`, `JwtExpiryMinutes=60`; removed stale `SessionExpiryDays` |
| `WebApplication2.csproj` | Reconciled PackageReference strategy; `ExcludeAssets="build"` on DotNetCompilerPlatform (its build targets use CodeTaskFactory, unsupported by dotnet MSBuild); custom `CopyRoslynCompilerFilesToOutputDirectory` target replicates the needed `bin\roslyn` copy; web output path fixed; JWT package added exactly once |

## 5. Files Removed

- `Models/UserSession.cs` (was empty, unapproved)
- `Infrastructure/SessionAuthorizeAttribute.cs` (was empty, unapproved)
- `database/Create_UserSessions.sql` (was empty, unapproved)
- Legacy `packages\` folder (untracked, git-ignored; obsolete packages.config artifact — was polluting `{CandidateAssemblyFiles}` resolution and causing MSB3277)

## 6. Package / Project Configuration

- Single strategy: **PackageReference** (SDK-style csproj retained — it is the currently
  working configuration; the legacy packages.config file remains present but inert).
- `Microsoft.CodeDom.Providers.DotNetCompilerPlatform 2.0.1` with `ExcludeAssets="build"`
  plus an equivalent Copy target (no duplicate references, no CodeTaskFactory).
- **MSB3277 result: 0 warnings (down from 142).** Verified on a clean `bin`/`obj` build.
- JWT dependencies resolve once, through `System.IdentityModel.Tokens.Jwt` 6.35.0.

## 7. JWT Configuration

- `JwtIssuer`: `BabysitterBookingApi`
- `JwtAudience`: `BabysitterBookingClient`
- `JwtExpiryMinutes`: `60`
- `JwtSecret`: present in Web.config (development). **Value intentionally not reproduced
  in this report.** Production must supply the secret via environment-based configuration.

## 8. Login Contract

`POST api/parent/login` (200) now returns all previous fields plus:

```json
{
  "message": "Login Successful",
  "userId": 1,
  "name": "...",
  "role": "Parent",
  "address": "...",
  "pictureAddress": "...",
  "token": "<JWT>",
  "expiresAt": "2026-09-03T18:48:04.0945955Z"
}
```

`POST api/babysitter/login` returns the same shape with `role: "Sitter"` (sitter-specific
legacy fields preserved). Failure remains HTTP 401. Routes, methods, and request DTOs
(`Username`, `Password`, `Role`) are unchanged.

## 9. Authentication Flow

Login → credential check (still plaintext; B4) → `JwtTokenGenerator` issues HS256 JWT →
frontend stores token → sends `Authorization: Bearer <token>` → `JwtAuthenticationHandler`
validates signature/issuer/audience/lifetime → establishes ClaimsPrincipal on
`Thread.CurrentPrincipal` and `HttpContext.Current.User` → `[Authorize]`/`ClaimsPrincipalHelper`
consume the identity → protected endpoint responds.

## 10. Database Impact

**Category A — Zero database change (verified live).**
- `UserSessions` table: **0** (`sys.tables` check run against the live DB).
- Table count unchanged at 11; no schema/EDMX/DbContext/migration changes.

## 11. Build Verification

```
dotnet build WebApplication2.csproj -c Debug --nologo
Build succeeded.
    0 Warning(s)
    0 Error(s)
```
MSB3277: eliminated (was 142). Clean rebuild from empty `bin`/`obj`.

## 12. Runtime Verification (live IIS Express + SQL Server, port 44368)

| # | Test | Result |
|---|---|---|
| 1 | Valid Parent login | ✅ 200; legacy fields + `token` + `expiresAt`; role=Parent (credentials never exposed) |
| 2 | Invalid Parent login (nonexistent user) | ✅ 401, no token |
| 3 | Valid Babysitter login | ✅ 200; `token` + `expiresAt`; role=Sitter |
| 4 | JWT structure | ✅ 3 segments; `exp`-`iat` = exactly 60 minutes; expected claims present |
| 5 | `GET api/auth/me` — no token | ✅ 401 |
| 6 | `me` — invalid/garbage token | ✅ 401 |
| 7 | `me` — valid token | ✅ 200 `{"userId":1,"role":"Parent","name":...}`; server-issued token round-trip works |
| — | `me` — wrong scheme (`Basic abcdef`) | ✅ 401 |
| 8 | Expired token (hand-crafted, correctly signed, `exp` in past) | ✅ 401 |

**Not tested / limitations:** IIS worker-process restart mid-token-lifetime and clock-skew
edge cases not exercised. No token revocation exists (by design — stateless JWT).

## 13. Known Limitations / Deferred Work

- **B4:** passwords still compared in plaintext; BCrypt migration pending.
- **B5:** authorization matrix / IDOR / ownership enforcement not yet applied; only the
  authentication foundation exists. Generic 401 messages still leak username-exists vs wrong-password.
- **B6:** booking/bid/review integrity unchanged.
- **B7:** broad validation refactor deferred.
- **B8:** global exception handling deferred (login `catch` still returns ex.Message).
- **B9:** performance deferred.
- **B10:** CORS still wildcard `*`; hardening deferred. `compilation debug="true"` still set.
- `packages.config` still exists on disk (inert); optional cleanup later.
- Production secret management (environment variables) must be configured at deployment.

## 14. Final Architecture Compliance

**YES — B3 now matches the B2-approved architecture.** Evidence: JWT Bearer with HS256
signature, issuer/audience/lifetime validation (Tests 5–8), 60-minute configurable expiry
(Test 4), required claims (Test 4/7), stateless model with no `UserSessions` table
(Database Reality Check), login contract additions (Test 1/3), and zero database/EDMX
schema changes.

---
**STOP — awaiting explicit approval.** No commit made. B4/B5 and frontend changes not started.

