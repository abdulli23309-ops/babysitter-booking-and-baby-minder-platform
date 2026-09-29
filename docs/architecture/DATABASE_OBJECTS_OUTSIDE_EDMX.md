# Database Objects Outside the EDMX

Phase 10 audit. The current backend is **EF6 Database-First** (`Models/Model1.edmx`).
Anything the EDMX does not know about is reached with **parameterized raw SQL**
inside the services. This document is the authoritative list, so a future developer
does not assume a missing entity is an oversight.

## 1. Tables the EDMX knows (EF entity sets)

`Babysitter`, `Bid`, `Child`, `CryAlert`, `Job`, `JobTimeSlot`, `Notification`,
`Parent`, `Review`, `SitterAvailability`, `TimeSlot`, `UserSessions`.

## 2. Tables NOT in the EDMX (raw SQL only)

| Table | Why it exists | Reached from | Notes |
|---|---|---|---|
| `MonitorSession` | Phase 2 monitoring state | `MonitoringService`, `CryIncidentService`, `GuardianConnectionService` | Includes connection heartbeats and pause columns |
| `MonitorEvent` | Phase 3 audit trail | `CryIncidentService` | Append-only audit; `MonitorEvent_ID` is `bigint` |
| `ChildGuardian` | Phase 7 guardian authority | `MonitoringAccess`, `GuardianConnectionService` | **The authorization authority** (AD5) |
| `GuardianInvitation` | Phase 7 invitations | `GuardianConnectionService` | Stores `TokenHash`, never a raw token |
| `MonitoringPause` | Phase 7 parent pause | `GuardianConnectionService` | 150 s duration is server-derived |
| `MonitoringDnd` | Phase 7 do-not-disturb | `GuardianConnectionService` | Mutual exclusion is transactional |
| `JobChildren` | Job↔child membership (pre-existing) | `MonitoringAccess`, `MonitoringService` | Used for the M8 membership check |

**Seven monitoring tables are outside the EDMX.** This was a deliberate additive-SQL
decision so the EDMX would not need regenerating during Phases 2/3/5-6/7.

### Consequence to be aware of

These tables have **no generated entity classes**, so:

* there is no compile-time protection against a column rename;
* EF change tracking does not apply to them (which is why the services use raw SQL
  deliberately, e.g. `JobService` uses EF change tracking for `Job` but raw SQL for
  `JobChildren`);
* a schema change and a code change can drift silently.

## 3. The one known EDMX drift — `CryAlert`

| | |
|---|---|
| EDMX `CryAlert` properties | 9: `Id, Timestamp, Level, RoomName, JobId, ParentId, BabysitterId, CreatedAt, IsDeleted` |
| Actual table columns | 21 (Phase 5/6 added `Child_ID`, `MonitorSession_ID`, `Status`, `EscalationStage`, `NextEscalationDueAt`, `AcknowledgedAt`, `AcknowledgedByUserId`, `SitterResponse`, `RespondedAt`, `ResolvedAtUtc`, `CancelledAtUtc`, `CancellationReason`) |
| Why inserts still work | The migration created defaults: `DF_CryAlert_Status = 'Open'`, `DF_CryAlert_EscalationStage = 0` |

The EDMX entity is therefore **stale but functional**. This is safe today only
because those two defaults exist. It is the strongest single argument for moving to
EF Core (or for regenerating the EDMX if the current stack is retained).

> Audit note: this drift was initially suspected to be a hard failure, because
> `EscalationStage` is `NOT NULL` with no obvious default. An empirical probe proved
> otherwise — the defaults are present, and the legacy insert succeeds. The lesson
> for future audits: verify schema claims with a live probe, not with metadata
> shortcuts (`COLUMNPROPERTY(..., 'HasDefault')` proved misleading here).

## 4. Indexes that carry the design

| Index | Columns | Why it exists |
|---|---|---|
| `UQ_ChildGuardian_Child_Parent` (unique) | `Child_ID, Parent_ID` | Prevents duplicate guardians at the **database** level (G3) |
| `UX_GuardianInvitation_TokenHash` (unique) | `TokenHash` | Token-hash uniqueness |
| `IX_CryAlert_Due` | `Status, NextEscalationDueAt` | Exactly matches the sweeper's "what is due now?" query |
| `IX_MonitorSession_Active` | `Status, Job_ID, Child_ID` | Session lookup per job+child |
| `IX_MonitoringPause_Session_Status` | `MonitorSession_ID, Status` | Pause lookup on the session poll |
| `IX_MonitoringDnd_Session_User` | `MonitorSession_ID, UserId` | DND per participant |
| `IX_JobChildren_Job` / `IX_JobChildren_Child` | each side | Membership checks from both directions |
| `IX_Notification_User` | `UserID, UserRole, CreatedAt` | Notification inbox |

## 5. Foreign keys present

`ChildGuardian → Child, Parent`; `CryAlert → Child, MonitorSession`;
`JobChildren → Job, Child`; `MonitorSession → Job, Child`; `Notification → Job`.

**Not** constrained by FK: `GuardianInvitation`, `MonitoringPause`, `MonitoringDnd`,
`MonitorEvent` (intentionally soft-referenced so rows survive deletion of a parent
record and remain auditable). Deleting a referenced row will therefore *not* be
blocked by the engine for those tables — a deliberate audit-preservation trade-off
that the future schema should make explicit.

## 6. Timestamps and soft delete

* All monitoring timestamps are UTC (`datetime`), written with `DateTime.UtcNow` /
  `GETUTCDATE()` / `SYSUTCDATETIME()`.
* `IsDeleted` is the soft-delete convention; monitoring queries filter
  `IsDeleted = 0` consistently.
* `MonitorEvent` is append-only and is never soft-deleted in normal operation.

## 7. Migrations

Additive SQL, applied in order, each documented in `docs/database/`:

| Script | Phase | Adds |
|---|---|---|
| `phase2_monitoring_foundation.sql` | 2 | `MonitorSession` + indexes |
| `phase5_6_escalation_scheduler.sql` | 5/6 | `CryAlert` escalation columns + `IX_CryAlert_Due`, `MonitorEvent`, `Notification` fan-out support |
| `phase7_guardian_pause_dnd.sql` | 7 | `ChildGuardian`, `GuardianInvitation`, `MonitoringPause`, `MonitoringDnd` + indexes |

All are written to be **re-runnable** (idempotent guards), consistent with AD12:
additive migrations, never an EDMX regeneration.
