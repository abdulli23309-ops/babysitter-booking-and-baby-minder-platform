# PHASE B2 REPORT — Architecture Decisions & Implementation Planning

> **Phase:** B2 (Planning Only)  
> **Date:** 2026-09-02  
> **Branch:** remediation  
> **Baseline tag:** fyp-baseline-pre-remediation  
> **Scope:** Analyze decisions C1–C6; produce implementation roadmap B3–B11  
> **Constraint:** No source code modified — documentation only

---

## 1. Objective

Phase B2 establishes the architectural foundation for all backend remediation (B3 onward) by:

1. Analyzing six critical architecture decisions (C1–C6) against the actual source code
2. Recommending stack-compatible solutions for authentication, passwords, authorization, CORS, frontend compatibility, and CryAlert semantics
3. Producing a phased implementation roadmap (B3–B11) with dependencies and verification steps
4. Mapping every endpoint's authorization requirements
5. Analyzing database impact and frontend impact

This is a **planning-only phase**. No NuGet packages installed, no controllers modified, no database changes.

---

## 2. Files Inspected (Source of Truth)

| File | Purpose |
|------|---------|
| `Web.config` | Connection strings, appSettings, authentication mode (`None`) |
| `Global.asax.cs` | Application startup — no auth middleware registered |
| `App_Start/WebApiConfig.cs` | Route config, CORS (`*`,`*`,`*`) |
| `packages.config` | Current NuGet dependencies (no auth packages) |
| `Models/Model1.Context.cs` | EDMX Database-First DbContext (11 DbSets) |
| `Controllers/ParentController.cs` | Login, registration, jobs, children |
| `Controllers/BabysitterController.cs` | Login, registration, earnings |
| `Controllers/JobsController.cs` | Job CRUD, status, confirmation |
| `Controllers/MatchingController.cs` | Sitter search, availability |
| `Controllers/ReviewController.cs` | Reviews with N+1 pattern |
| `Controllers/NotificationsController.cs` | EF LINQ (converted in Phase B) |
| `Controllers/CryDetectionController.cs` | EF LINQ (converted in Phase B) |
| `Controllers/ChildrenController.cs` | Child CRUD |
| `Controllers/ImageController.cs` | Image serving |
| All 8 forensic documents (B1) | Evidence base |

---

## 3. Architecture Decisions

### C1 — Authentication Architecture
**Recommendation: JWT Bearer Authentication** via `System.IdentityModel.Tokens.Jwt`

| Option | Verdict | Reason |
|--------|---------|--------|
| A: JWT Bearer | ✅ **Recommended** | Stateless, stack-compatible, industry standard for SPA + separate API |
| B: Cookie Auth | Rejected | Cross-origin complexity with Vite dev server; browser-specific |
| C: Custom DB Token | Rejected | Requires schema change; reinvents JWT |

**Key design decisions:**
- NuGet: `System.IdentityModel.Tokens.Jwt` (v5.6.0+), `Microsoft.Owin.Security.Jwt` (v4.2.0+)
- Token claims: `sub` (userId), `role` ("Parent"/"Sitter"), `name`, `iat`, `exp`, `iss`, `aud`
- Expiry: **1 hour** (configurable in Web.config)
- Refresh tokens: **Deferred** (short expiry + re-login acceptable for FYP)
- Secret storage: `Web.config` appSettings (dev); environment variable (prod)
- Login response gains `token` + `expiresAt` fields (**FRONTEND CHANGE REQUIRED**)

### C2 — Password Migration Strategy
**Recommendation: Lazy Migration on Successful Login** via `BCrypt.Net-Next`

| Option | Verdict | Reason |
|--------|---------|--------|
| A: Forced Reset | Rejected | Locks out all users; requires email infrastructure |
| B: Lazy Migration | ✅ **Recommended** | Zero disruption, no schema change, no frontend change |
| C: One-time Migration | Rejected | Partial-migration risk; no advantage over lazy |
| D: Hybrid | Rejected | Over-engineered for FYP |

**Migration logic:**
- Detect hash via BCrypt prefix (`$2a$`, `$2b$`)
- Legacy login: compare plain text → if valid, hash and save → issue token
- New registration: always hash
- Failed login: generic `"Invalid username or password"` (don't reveal which field)
- **No database schema change** — same `Password` column

### C3 — Authorization Model
**Recommendation: Role-Based Authorization with Resource Ownership**

- Apply `[Authorize]` globally; `[AllowAnonymous]` only on login/register
- Roles: `"Parent"`, `"Sitter"` (canonical strings from login/token claims)
- Ownership: extract `userId` from token claim → compare to URL/body `parentId`/`sitterId`
- Mismatch → `403 Forbidden`; anonymous → `401 Unauthorized`
- Full matrix in `B2_AUTHORIZATION_MATRIX.md`

### C4 — CORS Policy
**Recommendation: Environment-Specific CORS**

| Environment | Origins | Credentials |

---

## 4. Recommended Authentication Approach

**JWT Bearer Authentication** — stateless, embedded claims, no server-side session storage.

**Pipeline:** OWIN middleware (`Microsoft.Owin.Security.Jwt`) OR custom `DelegatingHandler` / `IAuthenticationFilter` — decision deferred to B3 implementation.

**Secret management:**
- Development: hardcoded in `Web.config` appSettings (flagged for prod)
- Production: document requirement for environment variable

---

## 5. Password Migration Strategy

**Lazy BCrypt migration** — transparent to users and frontend.

**Algorithm:** `BCrypt.Net-Next` (.NET Framework 4.7.2 compatible, auto-salting, prefix marker).

**Database impact:** None (same column stores hash after migration).

---

## 6. Authorization Strategy

Global `[Authorize]` + `[AllowAnonymous]` on public endpoints. Resource ownership enforced by comparing token `sub` claim to resource-scoped IDs.

**Dependency:** Requires B3 (JWT) to provide trustworthy `UserId` claim.

---

## 7. API Compatibility Risks

| Risk | Mitigation |
|------|------------|
| Frontend breaks when endpoints require auth | Coordinate B3 with frontend team; frontend must store/send token |
| CORS blocks frontend origin | Configure frontend origin in Web.config before B3 deployment |
| Existing localStorage `userId` usage | Token `sub` claim provides same userId; frontend impact is additive |

---

## 8. Database Impact

| Remediation | Database Impact |
|-------------|-----------------|
| JWT authentication | **A — No change** (stateless) |
| Password hashing (lazy) | **B — Data migration only** (no schema change) |
| Authorization | **A — No change** |
| Booking conflict prevention | **A** (application-level) or **D** (optional unique indexes — manual) |
| Validation | **A — No change** |
| Error handling | **A — No change** |
| Performance | **A — No change** |
| CORS | **A — No change** |

**No EDMX changes. No schema migrations. No stored procedures.**

---

## 9. Implementation Roadmap

| Phase | Objective | Dependencies |
|-------|-----------|--------------|
| **B3** | Authentication Foundation (JWT issuance + validation) | None (foundation) |
| **B4** | Password Security Migration (lazy BCrypt) | B3 |
| **B5** | Authorization and IDOR Protection | B3 |
| **B6** | Booking Conflict and State Integrity | B3 + B5 |
| **B7** | Validation and DTO Boundaries | None (parallelizable) |
| **B8** | Error Handling and Logging | None (parallelizable) |
| **B9** | Performance and Code Quality (N+1, dead code) | None (parallelizable) |
| **B10** | CORS and File Upload Security | B3 |
| **B11** | Regression Testing and Final Verification | B3–B10 |

**Critical path:** B3 → B5 → B6 → B11  
**Parallelizable:** B4, B7, B8, B9

---

## 10. Unresolved Decisions

| Topic | Options | Recommended |
|-------|---------|-------------|
| JWT delivery mechanism | OWIN middleware vs custom `DelegatingHandler` vs `IAuthenticationFilter` | Defer to B3 — OWIN is standard |
| Refresh tokens | Implement now vs defer | Defer (short expiry sufficient for FYP) |
| Production JWT secret | Environment variable vs Azure Key Vault | Document env var; Key Vault is future |
| Booking conflict enforcement | Application-level only vs DB unique indexes | Application-level (no schema change) |

---

## 11. Recommended Next Phase

**B3 — Authentication Foundation**

The foundation that unblocks all other security work (B4 password migration, B5 authorization, B10 CORS hardening). Without B3, there is no trustworthy principal to enforce ownership or issue credentials.

**Pre-conditions for B3:**
- Frontend team notified that login response will gain `token` + `expiresAt` fields
- Frontend team prepared to store token and attach `Authorization: Bearer` header
- Decision on JWT delivery mechanism (OWIN vs handler) confirmed

---

## 12. Verification Evidence

| Check | Result |
|-------|--------|
| Forensic documents (8) read | ✅ All 8 reviewed |
| Web.config inspected | ✅ Auth mode = None; 2 connection strings (1 dead) |
| Global.asax.cs inspected | ✅ No auth startup |
| WebApiConfig.cs inspected | ✅ Wildcard CORS; attribute routing |
| packages.config inspected | ✅ No auth packages present |
| All controllers inspected | ✅ 9 controllers, 30+ endpoints catalogued |
| Models/Model1.Context.cs inspected | ✅ EDMX Database-First, 11 DbSets |
| Authorization matrix | ✅ Complete (B2_AUTHORIZATION_MATRIX.md) |
| Frontend impact matrix | ✅ Complete (B2_FRONTEND_IMPACT.md) |
| Database impact | ✅ No schema changes required (B2_DATABASE_IMPACT.md) |

---

## 13. Documents Created in Phase B2

| Document | Size | Purpose |
|----------|------|---------|
| `B2_ARCHITECTURE_DECISIONS.md` | 15.5 KB | C1–C6 analysis, options, recommendations |
| `B2_AUTHORIZATION_MATRIX.md` | 8.2 KB | Complete endpoint authorization matrix |
| `B2_IMPLEMENTATION_ROADMAP.md` | 8.9 KB | B3–B11 roadmap with dependencies |
| `B2_FRONTEND_IMPACT.md` | 7.2 KB | Frontend impact classification |
| `B2_DATABASE_IMPACT.md` | 6.5 KB | Database impact analysis |
| `PHASE_B2_REPORT.md` | (this file) | Consolidated planning report |

---

## Git State (Unchanged)

```
Branch:      remediation  (up to date)
Baseline tag: fyp-baseline-pre-remediation  (untouched)
main:        untouched
```

**No source code modified. No database modified. No packages installed. No commits made.**

---

**Phase B2 complete. Stopped as required. Awaiting explicit approval before B3 implementation.**
