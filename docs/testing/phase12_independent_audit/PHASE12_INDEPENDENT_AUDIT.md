# Phase 12 — Independent Audit, Defect Fixes, UI/UX and Cleanup

**Overall: FUNCTIONALLY VERIFIED · Live media EXTERNALLY BLOCKED.**
Baby Monitoring is not declared 100% complete. No real live video or audio was
ever observed, because this repository contains no media-provider credentials.

---

## 1. Independent audit result

This phase re-derived the result from the code, the live database and real
browser sessions rather than trusting the Phase 11 report. That was the right
call: the single most serious defect in the system (cry alerts firing during a
parent pause) was **not** found by any of Phases 1–11, including the 110-test
Phase 9 HTTP suite, because those suites exercised the paused-cry path only
*sequentially* and only checked that the incident was not left active.

I also found uncommitted work in the tree that I did not author (a parallel
Phase 12 pass: `MonitoringScopeGate.cs`, a token-storage change, a nav fix, and
four deleted Markdown files). I reviewed it rather than discarding it. It is
sound, it was present during every verification run below, and one part of it —
adding `/baby-monitoring` to the sitter's Jobs tab — is *required* by my own
route change. It is documented here rather than silently shipped.

## 2. Areas inspected

Backend authorization (`MonitoringAccess`), media issuance, scope discovery, cry
incident lifecycle, escalation claim, pause, DND, guardian invitations, session
lifecycle, heartbeat/connection loss, ops sweep, exception mapping, DI
registration, Web.config, the frozen EDMX and the 7 monitoring tables' live
schema (indexes, keys, uniqueness), the React monitoring surface, routing, the
API layer, all four C# harnesses, the Phase 9 HTTP + browser harnesses, the
Phase 11 suites, and all 53 Markdown files.

## 3. Defects found and fixed

| # | Defect | Severity | How it was found |
|---|---|---|---|
| D1 | **Parent was alerted during an active pause.** A cry during a 150s pause created a *new* incident that escalated to stage 2 and raised 4 notifications. | **CRITICAL** | Live reproduction: notification delta **+4 while paused** |
| D2 | **An already-open incident could escalate during a pause** (race between creation and approval). | HIGH | Same audit; fixed as defence in depth |
| D3 | **Sitter could never see a feed.** "View Child" only fired a toast and the route was parent-only, so it redirected to the sitter dashboard. | HIGH | Browser test: `url=/babysitter-dashboard` |
| D4 | **Co-parent reached an empty screen.** Scope was derived from "jobs I own". | HIGH | Browser test: co-parent scope `NONE` |
| D5 | **Fake hardware controls.** "CAMERA ON / MIC ACTIVE" rendered with no media at all. | MEDIUM | Reading the rendered page text |
| D6 | **Client-declared connection loss.** The heartbeat catch called `setOffline(true)`, directly contradicting its own comment that the server decides this. | MEDIUM | Code read |
| D7 | Duplicate "Live" indicators (header pill + media area). | LOW | UI review |
| D8 | 11 dead CSS classes from the removed mock camera. | LOW | CSS cross-referenced against JSX |

**D1/D2 fix.** `CryIncidentService` refuses a cry claim while an approved,
unexpired pause exists (`CryDetectionPausedException` → HTTP **409**, a state
conflict, not an authorization failure), and the sweeper's claim query excludes
sessions with an active pause. Verified: notification delta **+4 → 0**.

**D3/D4 fix.** Scope discovery now uses `GET /monitoring/accessible-scopes`
(the server's own answer, already `MonitoringAccess`-gated) instead of owned
jobs; `/baby-monitoring` accepts the sitter role; the parent-only family panel is

## 4. UI/UX improvements

- New **`MonitoringMediaPanel`** centralises all seven media states, so "Live" is
  rendered *only* when the server issued a real signed session. Every other
  state is stated in words with a matching tone (pending / neutral / blocked).
- Removed the `LIVE` pill, the `HD 1080p` subtitle, the fake camera/mic toggles
  and 11 dead classes. Replaced with a calm **child-identity header**.
- Styles use the existing token system (`tokens.css`); no new local values.
- Reduced-motion honoured; readable at 320px.
- The sitter's "View Child" is now a real navigation.

## 5. Security result — PASS

No IDOR, no client-supplied identity/approver/duration/stage, no room-name-only
access, no provider secret in React, no token in URL, no interpolated SQL, no
`Child.Parent_ID` as monitoring authority, no exception leakage on new paths.
The token is held in tab-scoped `sessionStorage` and stripped from the persisted
profile blob.

## 6. Database result — PASS (no schema change)

EDMX and live schema compared. `ChildGuardian` has a unique (Child, Parent)
index; `CryAlert` has the escalation-due index; `MonitorSession` has a
*non-unique* (Status, Job_ID, Child_ID) index. All 7 monitoring tables verified.
**No schema change was made** — see the concurrency note.

## 7. Concurrency — VERIFIED (single instance)

`Promise.all`-based, genuinely simultaneous: **17/17**. The in-process gate is
appropriate for a single IIS Express instance and is explicitly documented as
**not** covering a web farm. A farm would additionally need a filtered unique
index on `(Job_ID, Child_ID) WHERE Status='Active'` and a database-level
escalation claim. I deliberately did **not** add a constraint "for appearance";
it is reported as a recommendation, not applied.

## 8. Build, lint and test results

| Suite | Result |
|---|---|
| Backend rebuild | **PASS** |
| `npm run build` | **PASS** |
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| Phase 3 | **42/42** |
| Phase 4 | **60/60** |
| Phase 5/6 | **83/83** |
| Phase 7 | **106/106** |
| Phase 9 HTTP | **110/110** |

## 4a. A crash caught during the audit itself

Worth recording because it shows what the verification suites are actually
worth. The tree contained uncommitted work from a parallel Phase 12 pass that
changed the monitoring screen's scope state to `useState(null)` while leaving
every consumer reading `scope.jobId` — including a dependency array that runs on
the first render. That threw a `TypeError` and blanked the whole screen:
**Phase 9 UI fell from 62 to 22**. It was caught only because the audit re-runs
the full suite instead of trusting a green result from earlier. The fix keeps
`scope` a null-safe object and moves the resets inside the deferred block.

| Phase 9 UI | **62/62** |
| Phase 11 runtime | **33/33** (added E11c) |
| Phase 11 concurrency | **17/17** |
| Phase 12 navigation | **6/6** |

## 9. Test changes made (and why)

Three changes, each justified in-code:

1. `e2e_part4.ps1` — `409` added to the accepted statuses for "cry while paused
   does not stay active". The **intent is unchanged**; 409 is the correct code
   for "detection is suspended", and the assertion still guarantees no active
   incident is produced.
2. `browse_*.mjs` — read the token from `sessionStorage` first. The harness read
   a **legacy** localStorage location the app deliberately no longer uses; the
   product was right, the harness was stale.
3. `p11_runtime.ps1` — my own E11b asserted a cry *during* a pause should open a
   fresh incident, contradicting the frozen rule and mis-citing Phase 7 T7-P34
   (whose cry happens *after* expiry). Split into E11b (refused during) and
   E11c (fresh incident after).

**No frozen C# harness was modified.**

## 10. Cleanup

Removed: 4 large superseded Markdown audit reports (~150 KB of historical
cross-API/blueprint analysis predating monitoring) and 11 dead CSS classes.
Preserved: all `docs/database/*.sql` migrations (required to rebuild the
monitoring schema), all four C# harnesses with READMEs, the Phase 9 and Phase
11/12 verification scripts, and the completion/audit reports.

## 11. Remaining limitations

1. **Live media BLOCKED** — no provider credentials exist.
2. **Multi-instance concurrency NOT VERIFIED**.
3. The sitter's response buttons (Going to Child / View Child / With Child) only
   appear while a cry is active — a reasonable cry-response design, but "View
   Child" arguably belongs in the always-visible monitoring controls.
4. Supervisor decisions still open (DND duration, media provider, offline
   notification behaviour, CDN policy, feeding guardian scope).

## 12. Final status

Functionally verified. **Not 100% complete**, because no real baby video or
audio has ever been seen.

role-gated so a sitter cannot provoke 403s. **No authorization was weakened** —
every action is still re-authorized server-side.
