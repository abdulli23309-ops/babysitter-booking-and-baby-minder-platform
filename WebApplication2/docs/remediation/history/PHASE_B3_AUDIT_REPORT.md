# PHASE B3 — FULL-STACK VERIFICATION & ARCHITECTURE RECONCILIATION AUDIT

> **Phase:** B3 — Authentication Implementation Audit
> **Date:** 2026-09-03
> **Branch:** remediation
> **Baseline tag:** fyp-baseline-pre-remediation
> **Audit mode:** STRICT — read-only. No source, config, database, or package changes performed.
> **Project:** Little Care / Babysitter Booking ASP.NET Web API (.NET Framework 4.7.2, EF6 EDMX Database-First)

---

## 1. Executive Summary

Phase B3 was mandated to implement the **B2-approved JWT Bearer authentication foundation**
(decision **C1**): stateless JWT issuance at login, `Authorization: Bearer <token>` validation,
no database schema changes, no EDMX changes, no new tables, access expiry of 1 hour.

The working tree on branch `remediation` contains a **mix of partial configuration scaffolding,
empty placeholder files, and unrelated controller remediation**. **The authentication foundation
itself is NOT implemented.**

Concretely, the audit found:

1. **The "custom database session" architecture reported by a prior B3 report does not exist.**
   Every file that would implement it is **empty (0 bytes)**:
   - `Controllers/AuthController.cs` — 0 bytes
   - `Models/UserSession.cs` — 0 bytes
   - `Infrastructure/SessionAuthorizeAttribute.cs` — 0 bytes
   - `database/Create_UserSessions.sql` — 0 bytes
   Only `Infrastructure/ClaimsPrincipalHelper.cs` (1,542 bytes) has content — and it is **unreferenced dead code**.
2. **No `UserSessions` table exists in the development database.** Inspected via `sqlcmd`
   (read-only): the database contains exactly the **11 baseline tables**, and `OBJECT_ID('dbo.UserSessions')`
   is `NOT FOUND`.
3. **The EDMX/context was not changed for auth.** `Model1.Context.cs` still exposes **11 DbSets**
   and no `UserSession`; `Model1.edmx` diff is only BOM/encoding removal.
4. **Login endpoints are unchanged from baseline** — they still compare **plaintext passwords**
   (`parent.Password != login.Password`) and return **no token, no session**.
5. **No `[Authorize]` / `[AllowAnonymous]` directives, no JWT generation or validation code,
   no BCrypt, and no token issuance exist anywhere** in the codebase.
6. What *was* changed is out-of-scope for B3 authentication:
   - Web.config gained `JwtSecret/JwtIssuer/JwtAudience/JwtExpiryMinutes/JwtSessionExpiryDays` appSettings (**unused**).
   - packages.config and the csproj were edited to add the JWT NuGet packages (`System.IdentityModel.Tokens.Jwt 6.35.0`, `Microsoft.IdentityModel.Tokens 6.35.0`).
   - The csproj was migrated from legacy `ToolsVersion=15.0` to **SDK-style `net472`**, triggering **142 MSB3277 assembly-binding-conflict warnings**.
   - `CryDetectionController`, `MatchingController`, `NotificationsController`, `ReviewController`, and `JobDTOs.cs`
     contain EF-conversion / N+1 / DTO remediation. These are Phase-C/B9-style changes — **not authentication**.

**Build result:** The project **builds successfully** (`0 errors`) but with **142 MSB3277 warnings**
caused by mixing `packages.config` references with SDK `PackageReference` entries.

**Verdict:** B3 is **NOT COMPLETE**. It neither implements the approved JWT architecture **nor** the
reported (and rejected) custom-session architecture. The authentication foundation is absent.
This materially deviates from B2 decision C1.

---

## 2. B2 Approved Architecture

| Item | B2 Decision (C1) |
|------|------------------|
| Auth type | JWT Bearer |
| NuGet | `System.IdentityModel.Tokens.Jwt`, `Microsoft.Owin.Security.Jwt` (where appropriate) |
| Token format | Signed JWT |
| Validation | Stateless JWT signature validation |
| DB dependency | None (stateless) |
| DB schema impact | None — no new tables |
| EDMX impact | None |
| Claims | `sub`, `role` (Parent/Sitter), `name`, `iat`, `exp`, `iss`, `aud` |
| Expiry | 1 hour |
| Logout | Client-side token discard (stateless) |
| Frontend contract | Login response gains `token` + `expiresAt`; `Authorization: Bearer <token>` |

---

## 3. B3 Actual Implementation (what the working tree actually contains)

The working tree contains **no functional authentication**. The claimed B3 deliverables are empty.

| Claimed B3 deliverable | Actual file state |
|------------------------|-------------------|
| `database/Create_UserSessions.sql` | **0 bytes** (empty) |
| `Models/UserSession.cs` | **0 bytes** (empty) |
| `Models/Model1.edmx` (UserSession entity) | No entity — only BOM removal |
| `Models/Model1.Context.cs` (UserSession DbSet) | No DbSet — 11 unchanged DbSets |
| `Infrastructure/SessionAuthorizeAttribute.cs` | **0 bytes** (empty) |
| `Infrastructure/ClaimsPrincipalHelper.cs` | 1,542 bytes (present but unreferenced) |
| `Controllers/AuthController.cs` | **0 bytes** (empty) |
| `Controllers/ParentController.cs` login | Unchanged: plaintext compare, **no token** |
| `Controllers/BabySitterController.cs` login | Unchanged: plaintext compare, **no token** |
| JWT filter/config/token-generator (`JwtAuthenticationFilter.cs`, `JwtConfiguration.cs`, `JwtTokenGenerator.cs`) | **Do not exist** |
---

## 4. Architecture Comparison Table

| # | Architecture Decision | B2 Approved | B3 Actual | Match? | Impact |
|---|----------------------|-------------|-----------|--------|--------|
| 1 | Authentication type | JWT Bearer | None (login returns user data only) | **CRITICAL** | No auth on any endpoint |
| 2 | Token format | Signed JWT | No token issued | **CRITICAL** | Frontend cannot authenticate |
| 3 | Token validation mechanism | Stateless signature check | None | **CRITICAL** | All endpoints public |
| 4 | Database dependency | Stateless | No session table (empty SQL) | **MINOR** | No DB dependency actually added |
| 5 | Database schema impact | None | None (table never created) | NONE | Aligned, but because nothing was implemented |
| 6 | EDMX impact | None | None (BOM only) | NONE | Aligned |
| 7 | NuGet packages | JWT packages | JWT packages added but **unused**; causes 142 MSB3277 warnings | **MINOR** | Packages present, no code consumes them |
| 8 | Token claims | sub/role/name/iat/exp/iss/aud | None | **CRITICAL** | — |
| 9 | Token expiration | 1 hour | None | **CRITICAL** | — |
| 10 | Logout behavior | Client-side discard | None | **CRITICAL** | — |
| 11 | Token revocation | Stateless (n/a) | None | **CRITICAL** | — |
| 12 | Frontend Authorization header | `Bearer <token>` | No token returned | **CRITICAL/BREAKING** | Frontend expecting token breaks |
| 13 | Scalability | Stateless (scales) | n/a | **CRITICAL** | — |
| 14 | Per-request DB queries | None (stateless) | None | NONE | Aligned (accidentally) |
| 15 | Prod deployment complexity | Low (secret via env) | JWT secret hardcoded config-unused; SDK csproj conflicts | **MINOR** | Config present but dead |
| 16 | Alignment with remediation plan | B3 = auth foundation | Auth foundation absent | **CRITICAL** | Unblocks all downstream (B4/B5/B10) |

**Classification summary:** 9 CRITICAL deviations, 3 MINOR, 4 NONE (of which most "NONE" are only true
because nothing was implemented at all — not because the approved design was honored).

---

## 5. Git State

```
Branch:                remediation
HEAD:                  5cf40d2  (== tag fyp-baseline-pre-remediation, annotated merge commit)
Tag fyp-baseline:      5cf40d2  (UNTouched)
origin/remediation:    5cf40d2  (up to date — B3 work is NOT pushed/committed)
```

- **B3 changes are UNCOMMITTED** — everything is dirty working-tree changes.
- Tracked files modified (13): `WebApiConfig.cs`, `BabySitterController.cs`, `CryDetectionController.cs`,
  `MatchingController.cs`, `NotificationsController.cs`, `ParentController.cs`, `ReviewController.cs`,
  `DTOs/JobDTOs.cs`, `Models/Model1.Context.cs`, `Models/Model1.edmx`, `Web.config`,
  `WebApplication2.csproj`, `packages.config`.
- Untracked files include the B2 documents, `Controllers/AuthController.cs` (0B),
  `Infrastructure/` (empty attribute + ClaimsPrincipalHelper), `Models/UserSession.cs` (0B),
  `database/Create_UserSessions.sql` (0B), `WebApplication2.csproj.bak`.
---

## 6. File-by-File Audit

| File | Why it changed | Auth behavior it implements | Matches B2? | Security/arch concern |
|------|----------------|-----------------------------|-------------|----------------------|
| `Web.config` | Added JWT/session appSettings (JwtSecret, JwtIssuer, JwtAudience, JwtExpiryMinutes=60, SessionExpiryDays=7) | None — settings are dead/unused | NO | Hardcoded dev secret; wildcard CORS `*` remains; `<compilation debug="true">` |
| `packages.config` | Added `Microsoft.IdentityModel.Tokens 6.35.0`, `System.IdentityModel.Tokens.Jwt 6.35.0` | None (no code) | PARTIAL (packages added) | Unused deps; duplicated via csproj PackageReference |
| `WebApplication2.csproj` | Migrated legacy→SDK-style; added PackageReference JWT | None | NO | 142 MSB3277 assembly binding conflicts |
| `Models/Model1.Context.cs` | BOM/newline only | None | N/A | No UserSession entity |
| `Models/Model1.edmx` | BOM/encoding only | None | N/A | No UserSession mapping |
| `Controllers/ParentController.cs` | BOM/newline only | **Plaintext login, no token** | NO | Plaintext password compare (P0) |
| `Controllers/BabySitterController.cs` | BOM/newline only | **Plaintext login, no token** | NO | Plaintext password compare (P0) |
| `App_Start/WebApiConfig.cs` | BOM only | None | NO | Wildcard CORS |
| `CryDetectionController.cs` | SqlConnection→EF DbContext | None (not auth) | n/a | Out-of-B3-scope |
| `NotificationsController.cs` | SqlConnection→EF DbContext + validation | None (not auth) | n/a | Out-of-B3-scope |
| `MatchingController.cs` | `List<object>`→`List<MatchingJobDto>` | None (not auth) | n/a | Out-of-B3-scope |
| `ReviewController.cs` | N+1 fix, validation, null guards | None (not auth) | n/a | Out-of-B3-scope |
| `DTOs/JobDTOs.cs` | Added `MatchingJobDto` | None (not auth) | n/a | Out-of-B3-scope |
| `Controllers/AuthController.cs` | Untracked | **EMPTY (0 bytes)** | NO | No `/api/auth/me`, no logout |
| `Models/UserSession.cs` | Untracked | **EMPTY (0 bytes)** | NO | — |
| `Infrastructure/SessionAuthorizeAttribute.cs` | Untracked | **EMPTY (0 bytes)** | NO | — |
| `Infrastructure/ClaimsPrincipalHelper.cs` | Untracked | Reads claims from `Thread.CurrentPrincipal`/`HttpContext.User` | NO | Unreferenced; no principal is ever set |
| `database/Create_UserSessions.sql` | Untracked | **EMPTY (0 bytes)** | NO | Table not created |

---

## 7. Database Reality Check (read-only, no modifications)

Connection: `DESKTOP-UD649GB\SQLEXPRESS`, DB `BabySitterBooking and BabyMinder` (integrated security, `-C` trust).

Result:

```
IF OBJECT_ID('dbo.UserSessions','U')  →  NOT FOUND
SELECT COUNT(*) FROM sys.tables       →  11
```

Tables present (11): `Babysitter, Bid, Child, CryAlert, Job, JobTimeSlot, Notification, Parent,
Review, SitterAvailability, TimeSlot`.

- **`UserSessions` does not exist.**
- No columns, PK, or indexes can be documented because the table is absent.
- `Model1.Context.cs` (11 DbSets) matches the actual 11 tables — **EDMX ↔ DB consistent, and neither contains UserSessions**.
- `Create_UserSessions.sql` is empty; it was not executed (and must not be).
---

## 8. Runtime Verification

**Build first:**

```
dotnet / MSBuild  →  0 errors, 142 warnings (MSB3277 assembly-binding conflicts)
Output: WebApplication2/bin/Debug/net472/WebApplication2.dll
```

**Safe runtime auth-flow testing was not performed** because:

1. **Login issues no credential.** `POST api/parent/login` / `api/babysitter/login` still validate a
   plaintext password and return `userId/name/role` with **no token and no expiry** — there is nothing to
   present to a protected endpoint.
2. **No protected endpoint exists.** There is no `[Authorize]` and no `GET api/auth/me` / `DELETE api/auth/logout`
   (AuthController is empty). Therefore 401/403/expiry/revocation flows cannot be exercised.
3. Hosting the app for live HTTP tests was avoided under the strict read-only constraint, and would
   add no signal given (1)–(2).

**Logout:** not implementable — no session store, no JWT, no endpoint.

---

## 9. Security Review of the Current State

Because B3 did not implement authentication, the "custom session" security audit is largely about a
**non-existent** subsystem, plus the pre-existing vulnerabilities B3 was meant to fix.

| # | Concern | Status | Class |
|---|---------|--------|-------|
| 1 | Token generation entropy | N/A — no tokens generated | **P0** (feature absent) |
| 2 | GUID tokens unpredictable | N/A — no tokens | Informational |
| 3 | Tokens stored plaintext | N/A | Informational |
| 4 | Authorization header parsing | Not implemented | **P0** |
| 5 | Malformed header fail-safe | Not implemented | **P0** |
| 6 | Expired token rejection | Not implemented | **P0** |
| 7 | Role checks | Not implemented (no claims) | **P0** |
| 8 | AllowAnonymous behavior | Not implemented / not needed (all public) | **P1** |
| 9 | Thread.CurrentPrincipal assignment | ClaimsPrincipalHelper reads it but nothing sets it | **P1** |
| 10 | HttpContext.Current.User assignment | Not set anywhere | **P1** |
| 11 | Request property trust downstream | n/a | Informational |
| 12 | Session query efficiency | n/a (no table) | Informational |
| 13 | Expired session accumulation | n/a (no table) | Informational |
| 14 | Logout of expired token | n/a | Informational |
| 15 | Concurrent sessions | n/a | Informational |
| 16 | Session fixation | n/a | Informational |
| 17 | Role change → existing sessions | n/a | Informational |
| 18 | User deletion invalidates sessions | n/a | Informational |
| 19 | Timing/enumeration issues | n/a | Informational |
| — | **Plaintext password storage + plaintext compare at login** | **Present, unchanged from baseline** | **P0** |
| — | Wildcard CORS `*` | Present | **P1** |
| — | `<compilation debug="true">` in Web.config | Present | **P1** |
| — | 142 MSB3277 build warnings (mixed reference styles) | Present | **P2** |
---

## 10. Frontend Compatibility

| Question | Finding |
|----------|---------|
| Actual login response shape | `{ message, userId, name, role [, address, pictureAddress] }` — **no token/expiresAt** |
| Matches B2 expected contract? | **NO** — B2 C5 requires `token` + `expiresAt` |
| Required frontend changes | Frontend must receive a token; none is provided |
| `Authorization: Bearer <token>` header | Cannot work — no token is ever issued |
| Frontend must know token type (JWT vs opaque)? | Moot — no token at all |
| `expiresAt` returned consistently? | No |
| Logout endpoint integration | `DELETE api/auth/logout` does not exist |
| Current frontend assumptions valid? | **NO** — any frontend expecting credentials fails |

**Classification: BREAKING** (not merely "frontend change required") — because the backend issues no
credential at all, so the agreed API contract cannot be satisfied.

---

## 11. Scope Compliance (Phase B3 requirements)

| B3 Requirement | Status |
|----------------|--------|
| Authentication foundation implemented | **NOT COMPLETE** |
| Login issues a credential | **NOT COMPLETE** (no credential) |
| Credential validates on a protected endpoint | **NOT COMPLETE** (no protected endpoint) |
| Build succeeds | **COMPLETE** (0 errors, 142 warnings) |
| No database schema changes | **DEVIATED** (schema unchanged, but empty SQL implies intent to deviate; none executed) |
| JWT architecture (per B2) | **DEVIATED** (JWT packages/config present, but no JWT code) |

**B3 is NOT complete.** It cannot be marked complete merely because authentication "works" — it does not.

---

## 12. Deviations from B2

| Deviation | Class |
|-----------|-------|
| Approved JWT code never written (no generation, no validation, no filter) | **CRITICAL** |
| Login issues no credential | **CRITICAL** |
| Empty placeholder files misrepresent a "session implementation" | **CRITICAL** |
| CSProj migrated to SDK-style with conflicting reference styles (142 warnings) | **MINOR** |
| JWT packages added but unused; secret hardcoded and unused in Web.config | **MINOR** |
| ClaimsPrincipalHelper added as orphaned/dead code | **MINOR** |
| Out-of-scope controller remediation mixed into the same uncommitted change set | **MINOR** |

---

## 13. Risks

- **P0 — No authentication:** every API endpoint (30+) is publicly accessible; a prior claim of
  "auth implemented" is not supported by the working tree.
- **P0 — Plaintext passwords** compared at login and (per baseline) stored in plaintext.
- **P1 — Wildcard CORS + debug compilation.**
- **P2 — Build fragility:** 142 MSB3277 warnings; risky SDK conversion of a `.NET Framework` EDMX app
  bundled into an unrelated change set.
- **Process risk:** an empty `AuthController/UserSession/SessionAuthorize` + empty SQL strongly suggests
  a report was produced for work that was not actually done. This must be corrected before proceeding.
---

## 14. Recommended Decision

**Option B — REVERT B3 AND IMPLEMENT THE APPROVED JWT ARCHITECTURE (or its clean equivalent).**

However, the revert should be **surgical**, not wholesale:

- **Keep / retain:** the JWT NuGet packages and the JWT appSettings scaffolding are consistent with
  B2 C1 and can be reused. The SDK-style csproj may be kept **only** if the MSB3277 conflict is resolved;
  otherwise restore from `WebApplication2.csproj.bak`.
- **Remove:** the empty `AuthController.cs`, `UserSession.cs`, `SessionAuthorizeAttribute.cs`,
  and `Create_UserSessions.sql` (they implement the explicitly-rejected Option C custom-session approach).
- **Implement per B2 C1:** JWT issuance at login, a stateless bearer validation handler/filter,
  `[Authorize(Roles=...)]`, `AllowAnonymous` on login/register, claims `sub/role/name/iat/exp/iss/aud`,
  1-hour expiry, dev secret via Web.config / production via environment variable.
- **Do not** create a `UserSessions` table (violates B2 C1 constraint).

**Rationale:** B2 explicitly rejected Option C (custom DB token) as "reinvents JWT" and "requires schema
change." The current empty session scaffolding points at exactly that rejected design. JWT is the
industry-standard, stateless, stack-compatible choice for this SPA + separate API, requires no schema
change, and preserves the EDMX Database-First architecture.

---

## 15. Proposed Next Action (requires explicit approval — not executed here)

1. Decide & approve the architecture (recommended: JWT per B2).
2. Create a new commit/PR that:
   - Removes the empty session placeholders.
   - Finalizes one consistent reference style in the csproj (resolve MSB3277).
   - Implements JWT login issuance in `ParentController`/`BabySitterController` (and a centralized AuthController).
   - Adds a bearer validation handler/attribute.
   - Adds login response fields `token` + `expiresAt`.
3. Set explicit CORS origins and `AllowAnonymous` on login/register (B10 synergy).
4. Then proceed to **B4 (password hashing)** and **B5 (authorization/IDOR)**.

> **Constraints honored:** no source, config, database, or package files were modified by this audit;
> no commits made; no database altered; no NuGet packages installed.