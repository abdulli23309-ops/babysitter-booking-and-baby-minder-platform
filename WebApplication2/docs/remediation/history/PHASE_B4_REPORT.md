# PHASE B4 — PASSWORD SECURITY & BCrypt MIGRATION REPORT

Project: Babysitter Booking & Baby Minder API (WebApplication2) · Branch: `remediation`
Date: 2026-09-03 · JWT logic (B3-R) untouched · No Authorization/IDOR work (deferred to B5)

---

## 1. Objective

Eliminate plaintext password storage/comparison for Parents and Babysitters by adopting
BCrypt hashing, while keeping all existing accounts working via lazy (on-login) rehash.

## 2. Package

- Installed **BCrypt.Net-Next** (latest stable) via `dotnet add package` into WebApplication2.
- Recorded as a `PackageReference` in `WebApplication2.csproj`; `packages.config` updated for
  tooling parity. Verified the compiled `bin\WebApplication2.dll` references BCrypt.

## 3. Endpoints Modified

| Endpoint | Change |
|---|---|
| `POST api/parent/register` | Hash incoming password with `BCrypt.Net.BCrypt.HashPassword(password)` (default work factor 11) **before** saving the entity |
| `POST api/babysitter/register` | Same |
| `POST api/parent/login` | Verification via `BCrypt.Verify`; legacy plaintext fallback with immediate rehash (below) |
| `POST api/babysitter/login` | Same |

No routes, request DTOs, HTTP verbs, response shapes, or JWT generation were changed.
Token issuance (`JwtTokenGenerator`) is invoked exactly as before, after successful verification.

## 4. Login Verification Logic (Lazy Rehash / Graceful Migration)

Implemented identically in both login endpoints:

1. `BCrypt.Verify(plaintext, storedHash)` → success → proceed (already-hashed account).
2. If Verify fails **and** the stored value is NOT a BCrypt hash (i.e. legacy plaintext row,
   detected by hash-prefix check `$2a$/$2b$/$2y$`):
   compare plaintext equality with the stored legacy value.
   - Match → immediately `HashPassword` the plaintext, update the entity, `SaveChanges()`,
     then proceed with login. The account is silently migrated on first successful login.
   - No match → 401 (unchanged behavior, generic failure).
3. Failure responses remain generic 401 — no username-exists vs wrong-password distinction.

This guarantees zero account breakage: each existing plaintext account converts to a
bcrypt hash the first time its legitimate owner logs in.

## 5. Runtime Verification (live, IIS Express + SQL Server)

| Test | Result |
|---|---|
| Valid Parent login (legacy plaintext account) → 200 + token + expiresAt; DB value converted to 60-char `$2a$11$…` bcrypt hash | ✅ |
| Second login on migrated account (hash path) → 200 | ✅ |
| Valid Babysitter login (legacy account) → 200; rehash confirmed in DB | ✅ |
| Wrong password → 401, no token | ✅ |
| New registration → password stored as bcrypt hash immediately | ✅ |
| JWT still issued correctly; `/api/auth/me` round-trip still works | ✅ |
| Lazy-rehash edge: legacy user logs in once, hash replaces plaintext, same password still logs in | ✅ |

All test rows created during verification (`b4%` usernames) were **deleted** — the database
was restored to its pre-test state (0 remaining test rows). No schema changes; no migrations.

## 6. Security Notes

- BCrypt work factor: library default **11** (~100 ms/verify on dev hardware) — appropriate.
- Real user passwords in the dev DB are now hashed either at registration or on first
  post-deployment login. Optionally a one-time admin script could hash all remaining rows
  (B4b, optional) — not required for correctness.
- Known deferred items remain unchanged: B5 authorization/IDOR, B10 wildcard CORS,
  `debug=true`, generic exception messages that can leak internals (`Login Error: …`).

## 7. Build & Git

- `dotnet build WebApplication2.csproj -c Debug --nologo` → **Build succeeded, 0 Errors, 0 Warnings**.
- Modified: `ParentController.cs`, `BabySitterController.cs`, `WebApplication2.csproj`,
  `packages.config`, `obj/project.assets.json` (generated).
- **Nothing committed** (per standing git discipline); branch/tag state otherwise untouched.

## 8. Scope Boundary

STOPPED as instructed. No B5 (authorization/IDOR), no frontend changes, no commits.
Awaiting explicit approval for Phase B5.
