# B2 — DATABASE IMPACT ANALYSIS

> **Phase:** B2 (Planning Only)
> **Date:** 2026-09-02
> **Branch:** remediation
> **Purpose:** Identify database impact for every proposed remediation

---

## Impact Categories

| Category | Definition |
|----------|------------|
| **A — No database change** | Code-only change; schema untouched |
| **B — Data migration** | Existing data must be transformed |
| **C — Schema change** | New columns/tables/constraints required |
| **D — Manual production operation** | Requires DBA/admin intervention |

---

## Authentication (B3)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| JWT token generation | None | A | Tokens are stateless; generated/validated in memory |
| JWT validation middleware | None | A | OWIN/message handler only |
| Claims storage (userId, role) | None | A | Derived from login lookup; not persisted |
| `[Authorize]` attributes | None | A | Declarative; no schema impact |

**Conclusion:** JWT authentication requires **zero database changes**.

---

## Password Security (B4)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| Hash new passwords | None | A | Application-layer hashing before storage |
| Hash existing passwords (lazy migration) | **Data migration** | B | On successful login with legacy plain-text password, hash and overwrite `Password` column |
| `Password` column schema | None | A | Column already `nvarchar`; stores hash string (same length or shorter) |
| Algorithm marker (optional) | **Schema change** | C | Add `PasswordHashVersion` column to distinguish legacy vs. migrated (recommended: store prefix in hash via BCrypt — no column needed) |

**Recommendation:** Use **BCrypt.Net-Next** which embeds algorithm/version/salt in the hash string. No schema change required. Lazy migration is a **data migration (B)** — existing rows are updated on next successful login.

**Risk:** Users who never log in again remain as plain-text. Acceptable for FYP; document as known limitation.

---

## Authorization (B5)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| `[Authorize]` attributes | None | A | Declarative |
| Resource ownership checks | None | A | Compare authenticated principal's ID to route/body ID |
| Role-based access | None | A | Role from token claim |

**Conclusion:** Authorization requires **zero database changes**.

---

## Booking/State Integrity (B6)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| Double-booking prevention | None | A | Application-layer query: check for overlapping `JobTimeSlot` + `SitterAvailability` before confirming |
| Job state transition validation | None | A | Validate current status before allowing transition (e.g., only `Open` → `Assigned` → `Completed`) |
| Duplicate bid prevention | None | A | Check existing `Bid` rows for same `Sitter_ID` + `Job_ID` before insert |
| Duplicate review prevention | None | A | Check existing `Review` rows for same `Reviewer_ID` + `Job_ID` + `ReviewFor_ID` |
| Duplicate availability | None | A | Upsert logic (delete existing + re-insert, or check before insert) |

**Conclusion:** All integrity checks are **application-layer (A)**. No schema changes. Existing data is not modified.

---

## Validation (B7)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| Review rating range (1-5) | None | A | Server-side check before insert |
| Required field validation | None | A | Null/whitespace checks |
| Date/time format validation | None | A | `TryParse` checks |

**Conclusion:** Validation requires **zero database changes**.

---

## Error Handling (B8)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| Standardized error responses | None | A | Application-layer formatting |
| Server-side logging | None | A | Log to file/event log (no DB) |

**Conclusion:** Error handling requires **zero database changes**.

---

## Performance (B9)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| N+1 query elimination | None | A | Use `Include()` or batched lookups |
| Dead code removal | None | A | Code-only |

**Conclusion:** Performance improvements require **zero database changes**.

---

## CORS / File Upload (B10)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| CORS origin restriction | None | A | Config in `WebApiConfig.cs` / `Web.config` |
| File size limit | None | A | `maxRequestLength` in `Web.config` |
| File type validation | None | A | Extension whitelist check |

**Conclusion:** CORS/upload changes require **zero database changes**.

---

## Connection String Cleanup (C6)

| Remediation | Impact | Category | Details |
|-------------|--------|----------|---------|
| Remove unused `...Entities1` connection string | None | A | Config-only; no code references it |

**Conclusion:** Config-only change; **zero database impact**.

---

## Summary

| Category | Count | Items |
|----------|-------|-------|
| **A — No database change** | 18 | JWT auth, authorization, all validation, error handling, performance, CORS, connection string cleanup |
| **B — Data migration** | 1 | Password lazy migration (existing plain-text passwords hashed on next login) |
| **C — Schema change** | 0 | None required (BCrypt embeds metadata in hash string) |
| **D — Manual production operation** | 0 | None required |

**Overall database impact: MINIMAL.** Only one data migration (password hashing), which is non-destructive and lazy. No schema changes. No new tables. No EDMX modifications.

---

## Database Schema Preservation

The following database elements are **explicitly NOT modified**:

- No new tables
- No new columns (except optional `PasswordHashVersion` — not recommended)
- No new stored procedures, functions, views, or triggers
- No foreign key changes
- No index changes (performance tuning via query optimization only)
- No data deletion
- No EDMX regeneration

The existing `Password` column (type `nvarchar`) continues to store password data — now hashed instead of plain text. Column length is unchanged.

