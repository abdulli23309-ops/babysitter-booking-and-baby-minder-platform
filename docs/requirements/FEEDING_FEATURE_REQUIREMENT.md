# Feeding Feature — Frozen Requirement (Phase 10)

**Status: DOCUMENTED ONLY. NOT IMPLEMENTED.**

Phase 10 records this requirement so that the next stage can design it correctly.
No table, endpoint, screen or service was created for feeding, and nothing in the
current implementation was changed to accommodate it.

Classification in `REQUIREMENTS_MATRIX.md`: **FE1–FE7, FE10 = MODIFY**,
**FE8 = REMOVE**, **FE9 = RESEARCH**.

---

## 1. Actors

| Actor | Role in feeding | Is it a system user? |
|---|---|---|
| **Babysitter** | Starts and stops feeding | Yes — existing `Sitter` role |
| **Mother** | Receives the alert, views the live feed, views history | Yes — existing `Parent` role, resolved through `ChildGuardian` |
| **Parent Phone 2** | The physical monitoring phone: runs the monitor, hosts the live feed, exposes the "Baby Is Fed" control | **No.** It is a device/actuator, never a login, never a notification recipient |

> Parent Phone 2 must not be modelled as an account. It is a *device* attached to a
> monitoring session. This is the single most important design constraint, because
> modelling it as a user would create a second identity and authorization system.

---

## 2. Start

The babysitter presses **"Baby Is Fed"** on Parent Phone 2.

* This is a deliberate sitter action, not a detection and not a timeout.
* The action creates a feeding record bound to the **current** `(job, child)` —
  i.e. the same `MonitorSession` scope used by the existing monitoring feature.

## 3. Video

* Parent Phone 2 continues to monitor and stream the baby's live video
  **while** feeding.
* **Feeding does not stop or replace normal monitoring.** The two are concurrent
  states of the same session.
* Implementation note: feeding must reuse the existing monitoring/media path. It
  must **not** introduce a second, unrelated video system.

## 4. Mother

On feeding start the mother receives an **ALERT**:

> "Babysitter is feeding your child now."

She can then view the live baby video coming from Parent Phone 2.

* Delivery reuses the existing persisted `Notification` table and the existing
  guardian fan-out (from `ChildGuardian`).
* Do not build a new notification subsystem for this feature.

## 5. Feeding history

At minimum, persist:

| Field | Notes |
|---|---|
| Child | `Child_ID` |
| Job | `Job_ID` |
| Babysitter | `BabysitterId` |
| Feeding start time | UTC |
| Feeding end time | UTC, null while in progress |
| Feeding status | `InProgress` / `Completed` |
| Created / updated timestamps | UTC |

Parent-facing history must provide:

* the **number of feeds today**
* the **feeding time history**

The babysitter must also be able to view the feeding history.

## 6. End

The babysitter **explicitly ends** the feeding state using the appropriate
feeding-stop action.

> **Do not invent an arbitrary timeout.** There is no time-based auto-stop. A feed
> ends when the sitter ends it. (Contrast with the 150-second monitoring pause,
> whose duration *is* a fixed business rule — feeding deliberately is not one.)

## 7. Connection loss

If Parent Phone 2 loses connection:

* **Do not** automatically mark the feeding as completed.
* The feeding record stays **`InProgress`**.
* The existing monitoring connection-loss state is shown.
* Feeding can be continued or stopped after reconnection.

This reuses the current heartbeat/connection-loss model (heartbeat staleness →
`Lost`, session stays `Active`). Feeding must inherit that behaviour rather than
defining a separate one.

## 8. Recording — explicitly out of scope

* **Do NOT implement video recording.**
* **Do NOT implement video file storage.**

No recording or media-file concept should be carried into the future design for
this feature. This is classified **REMOVE** in the matrix.

## 9. Guardian scope for the initial release

In scope: **Babysitter, Mother, Parent Phone 2**.
Deferred: **Father / other guardians**.

> The existing general guardian architecture must **not** be deleted or modified
> to accommodate this feature. The feeding scope restriction is a *presentation and
> alerting* rule layered on top of the existing `ChildGuardian` relationships, not a
> change to them. This is classified **RESEARCH** because the correct long-term
> answer (whether feeding visibility should follow the general guardian model) has
> not been decided by the supervisor.

---

## 10. Design guidance for the next stage

1. **Reuse, do not rebuild.** Feeding is a new *state* on the existing monitoring
   session, not a new subsystem. It should add roughly one table, a few endpoints,
   and a UI control.
2. **Server-authoritative timing.** Start/end timestamps and the `InProgress`
   status must come from the server, exactly as the monitoring session does today.
   The client may not set them.
3. **Device, not user.** Parent Phone 2 needs a device/session association, but it
   must not enter the `UserSessions`/roles/authorization model.
4. **No timeout.** Enforce the explicit-stop rule; do not add a hidden expiry.
5. **Media remains a prerequisite.** Feeding's live video depends on the same
   unconfigured media stack as monitoring. Feeding cannot be demonstrated before
   real media credentials exist. Treat it as blocked on X5 in the matrix.
6. **Do not weaken `MonitoringAccess`.** Feeding endpoints must run the same
   access chain (guardian or assigned sitter, job `InProgress`, child in
   `JobChildren`, valid session) before any feeding-specific rule.
