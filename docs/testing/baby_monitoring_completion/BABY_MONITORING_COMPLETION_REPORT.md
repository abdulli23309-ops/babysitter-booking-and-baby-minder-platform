# Baby Monitoring — Phase 11 Completion Report

**Status: PARTIAL.** The monitoring workflow, security model, co-parent access and
concurrency are verified and green. **Live baby video remains BLOCKED** because the
repository contains no legitimate media-provider credentials. No credentials were
invented, and no completion is claimed for a stream that was never seen.

---

## 1. Starting state

Phase 11 was already half-done but left the tree in a non-building state: `CryDetector.jsx`
had lost its `useCallback` terminator during earlier line-range editing, called
`API.reportCry` without importing `API`, and had a `domain="meet.jit.si"` value plus a
"Parent connected. Video call stream open." false success. That work was recovered, not
discarded.

## 2. Bugs found and fixed in this phase

| # | Defect | Severity | Evidence |
|---|---|---|---|
| B1 | **Duplicate cry incidents under concurrency.** 4 simultaneous `POST /cry` produced **4 separate incidents** (4 independent T+5/T+15 chains). | HIGH | `p11_concurrency.mjs` before fix: 4 distinct ids, `reused=0` |
| B2 | **Duplicate monitoring sessions under concurrency.** 6 simultaneous `session/start` produced **3 Active MonitorSessions** (377, 376, 378) for one (job, child). | HIGH | same run, `ids=377\|376\|378` |
| B3 | Media 404 ("no active session yet") was reported to the owner parent as **"You are not authorised to view this child."** | HIGH | Phase 9 UI `E5-ui` failure; page text showed the false denial |
| B4 | No media retry, so the first 404 stuck for the life of the screen. | MEDIUM | `useMonitoringMedia` had no refresh key |
| B5 | **PascalCase/camelCase mismatch.** The media hook read `data.configured` but the API returns `Configured`, so the server's real reason was never shown. | MEDIUM | caught by `E5-ui`; server returned the correct reason that the UI discarded |
| B6 | `LEFT JOIN` produced `NULL MonitorSession_ID` into a non-nullable `int` → **500** whenever a second job had no live session. | MEDIUM | co-parent discovery 500 while sitter 200 |
| B7 | Static "LIVE" pill and "HD 1080p" subtitle claimed a stream that never existed. | MEDIUM | `BabyMonitoringScreen` |
| B8 | Mock `NurseryCameraFeed` rendered with hard-coded 22 °C / 45% readings and a false "Secure Connection" badge over a public unencrypted room. | MEDIUM | removed |

**Root cause of B1/B2:** both were read-then-insert with no mutual exclusion. Sequential
testing could never surface them. Fixed with a per-scope `SemaphoreSlim` gate and a
re-check inside it. A database transaction was tried first and **rejected**: the Phase 3/5/6/7
harnesses call these services on a context already inside a transaction and EF6's
EntityClient refuses nested transactions — it crashed all four suites. The process gate
fixes the race with no schema change and no nested transaction.

**B3 note:** fixing B2 also fixed the "connection Lost" symptom seen in the concurrency run,
because heartbeats were being split across the three duplicate session rows.

## 3. Legacy cry path — REMOVED

Second pipeline deleted end-to-end, verified by a repository-wide re-scan:

- `Controllers/CryDetectionController.cs` (`api/cry-detection`) — **deleted**
- `Services/Implementations/CryAlertService.cs`, `Services/Interfaces/ICryAlertService.cs` — **deleted**
- `DTOs/CryAlertDto.cs` — **deleted** (legacy-only; the active pipeline uses `MonitoringDtos`)
- `SimpleDependencyResolver` — both registrations removed
- `WebApplication2.csproj` — 4 `Compile` entries removed; empty `Views\CryDetection\` removed
- `api.js` `getLatestCryAlert` — **removed**

**Deliberately preserved:** `CryIncidentService`, `ICryIncidentService`, the `CryAlert`
**table**, and the frozen EDMX `CryAlert` mapping (`Model1.Context.cs`). The active pipeline

## 4. Co-parent monitoring — PASS

`AccessibleScopeService` (new) resolves authority through `ChildGuardian` for parents and
`AssignedSitter_ID` for sitters, joined via `JobChildren`, filtered to InProgress. It is
**discovery only**; every real action still runs `MonitoringAccess.Check`.

| Caller | Result |
|---|---|
| Owner parent | 2 scopes, `Via=Guardian` |
| **Co-parent** | **2 scopes, `Via=Guardian`** (was 0 — the Phase 9/10 gap) |
| Sitter | 1 scope, `Via=AssignedSitter` |
| Unauthorised parent | 0 scopes; 403 on session, guardians and media |

## 5. Media architecture

`GET /api/monitoring/media?jobId=&childId=` → `MediaSessionService`:

1. `MonitoringAccess.Check` **first** — media adds no authorization rules.
2. Anchored to the existing **Active MonitorSession** (no new entity, no second lifecycle).
3. Role derived **server-side**: parent → `publisher`, sitter → `viewer` / `CanPublish=false`.
4. JWT signed **on the server** (RS256, 1-hour expiry) with a key in `Web.config` only.
5. **Fails closed**: missing config ⇒ `200 { Configured: false, Reason }`, no domain, room or token.

Config keys (`Web.config`): `MonitoringMediaEnabled` (`false`), `MonitoringMediaDomain` (empty),
`MonitoringMediaPrivateKey` (empty). **No credentials invented.**

## 6. MEDIA CREDENTIAL BLOCKER

```
BLOCKER: No media-provider credentials exist in this repository.
What is missing:  a tenant Jitsi/JaaS domain, an appId, and its RSA private key.
Why required:     the provider token and host must be server-issued and tenant-specific.
Implemented:      full server-side issuance, role derivation, fail-closed config, and a
                  client that renders the real server state (never a fake feed).
Verified:         authorization, role derivation, 403 for outsiders, no token/room leakage,
                  and honest "not configured" UI — all runtime-verified.
NOT verified:     actual video/audio capture, transport, playback, or receive-only
                  enforcement in the provider. No browser camera was exercised, because no
                  provider exists.
Manual action:    obtain a provider account, then set the three Web.config values.
```

## 7. Concurrency — VERIFIED (single instance)

`p11_concurrency.mjs` uses `Promise.all()`, so requests are genuinely simultaneous.
**17/17 pass.** Before the fix it exposed B1 and B2.

Also proven: one incident under 4 concurrent cries (3 `Reused`); one session under 6
concurrent starts; heartbeats converge; unauthorised start/cry/heartbeat/media all 403;

## 8. Regression results (all re-run after the concurrency fixes)

| Suite | Result |
|---|---|
| Phase 3 | **42/42** |
| Phase 4 | **60/60** |
| Phase 5/6 | **83/83** |
| Phase 7 | **106/106** |
| Phase 9 HTTP | **110/110** |
| Phase 9 UI | **62/62** (baseline 60; 0 failures) |
| Phase 11 runtime | **32/32** |
| Phase 11 concurrency | **17/17** |

Backend build, `npm run build` and `npm run lint` all pass. **No frozen test was modified.**

**Two stale expectations were corrected in my own new Phase 11 suite, not in the frozen suites:**
- E9 assumed the sitter reads the pause endpoint. It does not — `GET /pause` is deliberately
  parent-only (403); the sitter sees `IsPaused` on the session. Corrected to assert via the
  session. No product code changed.
- E11 assumed a cry during a pause creates no new incident. **Phase 7 test T7-P34 explicitly
  locks "a cry after the pause creates a NEW incident, not a resume."** The implemented
  behaviour is intentional; the expectation was corrected to assert escalation was suspended
  and the incident cancelled, and that a later cry opens a *fresh* incident.

## 9. Runtime scenarios (32/32)

E1 start · E2 sitter enters · E3 incident · E22 idempotent start · E23 dedupe · E4 T+5
persisted · E5 going-to-child · E6 parent reads incident · E7 pause request · E8 co-parent
approves · E9 sitter sees pause · E12 DND · E13 DND per-parent · E14 heartbeat ·
E15/E28 heartbeat does not end session · E10 pause = 150 s · E11/E11b pause semantics ·
E16 guardian list · E17/E17b/E17c unauthorised denied · E18/E18b/E18c co-parent ·
E2b sitter scope · E20 parent publisher · E19 sitter receive-only · E19b media 403 ·
E25 legacy path 404.

## 10. Security verification

Clean scan: no `meet.jit.si` value, no `/cry-detection` caller, no client-supplied
actor/approver/parent/duration/stage, no provider secret in React, no interpolated SQL
(fully parameterised), no `Child.Parent_ID` used as monitoring authority, no room-name-only
access, no token in URL or `localStorage`, no exception leakage on the new endpoints.

`BabyMonitoringScreen` / `CryDetector` still use `children[0]` when deriving *display scope*
from a job. This is pre-existing Phase 8/9 code, is guarded (`if (!child?.Child_ID) return`),
and is **not** an authorization fallback — every action re-checks `MonitoringAccess`. It was
left alone deliberately, since changing it would risk the Phase 9 UI baseline.

## 11. Database state

Monitoring tables reset to zero rows (`MonitorSession`, `MonitorEvent`, `CryAlert`,
`MonitoringPause`, `MonitoringDnd`). Legitimate application data was not touched.
`ChildGuardian=31` and `Notification=183` are higher than the Phase 10 baseline (29 / 81)
because the Phase 9/10/11 harnesses create guardians and notifications as real application
behaviour; these are legitimate rows and were intentionally left in place.

## 12. Remaining limitations

1. **Live media unverified** (see §6) — the only true blocker.
2. **Multi-instance concurrency unverified** (§7).
3. Frontend scope discovery on the monitoring screen still walks owned jobs; a co-parent
   deep-links in but has no dashboard entry point. Discovery is fixed on the API and used by
   the cry banner and detector; the parent dashboard wiring is still outstanding.
4. Legacy controllers elsewhere still return raw `ex.Message` (pre-existing, classified
   MODIFY for the future backend).

## 13. Final status

Baby Monitoring is **not complete** while live media cannot be shown. Everything the
environment genuinely permits has been implemented, verified and left in a clean, buildable,
committed state. The next step is supplying legitimate media credentials and re-running
E18/E19/E20 with real camera capture.

no token or room leaked while unconfigured.

**NOT VERIFIED:** multi-instance / web-farm contention. There is a single IIS Express
instance. The gate is in-process; a farm would additionally want a filtered unique index on
`(Job_ID, Child_ID) WHERE Status='Active'` — deliberately **not** added, as that is a schema
change beyond this task's scope.

writes that table with parameterised raw SQL. `CryDetector`'s YAMNet screen and its
`/cry-detector` route were **kept** — that is the legitimate Phone 2 device surface; only its
broken endpoint was removed.

Runtime proof: `GET /api/cry-detection/latest` now returns **404** (test `E25`).
