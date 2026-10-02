using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    /// <summary>
    /// Phase 5 + 6 — cry incident lifecycle on the EXISTING CryAlert table
    /// (raw SQL only: the Phase 2 escalation columns are deliberately not part
    /// of the frozen Model1.edmx).
    ///
    /// WHY THE SERVER OWNS THE TIMELINE
    ///   The client may only say "cry detected". Creation time, escalation
    ///   stage, deadlines, acknowledgement, resolution and cancellation are all
    ///   derived server-side from the server UTC clock, because a client could
    ///   otherwise backdate a report, skip the sitter stage or suppress the
    ///   parent escalation. The request DTOs carry nothing but job + child.
    ///
    /// WHY DEDUPLICATION EXISTS
    ///   A cry detector fires repeatedly while the baby keeps crying. Without
    ///   dedupe one event would create a burst of incidents and the parent
    ///   would receive an escalation storm. RULE: at most ONE active incident
    ///   (Status Open or Acknowledged) per (Job, Child, MonitorSession); a new
    ///   report for that session returns the existing incident instead of
    ///   inserting a second row.
    ///
    /// WHY NextEscalationDueAt EXISTS / WHY NO IN-MEMORY TIMERS
    ///   The escalation plan is PERSISTED (EscalationStage +
    ///   NextEscalationDueAt) so it survives AppPool recycle, IIS restart and
    ///   application restart. Timer / Task.Delay / Thread.Sleep / MemoryCache /
    ///   static dictionaries are deliberately NOT used: they lose the plan on
    ///   restart and would fire once per instance. A scheduler (SQL Agent, or
    ///   the sweep-on-poll fallback) only ASKS "which alerts are due at or
    ///   before NOW?"; a late run is acceptable because NextEscalationDueAt —
    ///   not the scheduler's clock — is authoritative.
    ///
    /// WHY ATOMIC CLAIMING
    ///   Two sweepers may run at the same time (multiple app instances, ops
    ///   endpoint racing the polling fallback). The claim is ONE SQL batch that
    ///   locks the due row (UPDLOCK, READPAST) and advances BOTH
    ///   EscalationStage and NextEscalationDueAt in the same UPDATE, so the
    ///   second sweeper either skips the locked row or re-reads it after the
    ///   first claim committed — where it no longer matches "due at or before
    ///   now". Exactly one worker processes a given stage.
    ///
    /// Notifications are PERSISTENT rows in the existing Notification table
    /// (the frontend polls), and MonitorEvent audits are append-only.
    /// </summary>
    public class CryIncidentService : ICryIncidentService, IDisposable
    {
        // ---- documented status model (no extra states invented) ----
        public const string StatusOpen = "Open";                    // detected, escalation running
        public const string StatusAcknowledged = "Acknowledged";     // sitter responded (GoingToChild)
        public const string StatusResolved = "Resolved";              // sitter is with the child (terminal)
        public const string StatusCancelled = "Cancelled";             // lifecycle ended it (terminal)

        // ---- sitter responses ----
        public const string ResponseGoingToChild = "GoingToChild";
        public const string ResponseWithChild = "WithChild";

        // ---- cancellation reasons (stored verbatim in CancellationReason) ----
        public const string CancelJobCancelled = "JobCancelled";
        public const string CancelJobCompleted = "JobCompleted";
        public const string CancelSessionEnded = "MonitoringSessionEnded";
        public const string CancelJobNotInProgress = "JobNotInProgress";

        // Phase 7: an APPROVED parent pause stops cry escalation for its session.
        // Reuses the exact Phase 5/6 cancellation path, so a paused incident can
        // never resume and a cry after the pause naturally starts a fresh T+0 row
        // (dedupe only covers Open/Acknowledged incidents).
        public const string CancelParentPauseApproved = "ParentPauseApproved";

        /// <summary>
        /// Thrown when a cry claim arrives while an APPROVED, unexpired parent
        /// pause is active for the session.
        ///
        /// WHY THIS EXISTS (Phase 12 independent audit)
        /// The frozen business rule is "during a pause, cry detection is
        /// suspended". Approving a pause correctly CANCELS the incident that was
        /// already open, so nothing escalates for THAT incident. But the detector
        /// on Phone 2 keeps running, so the very next "cry detected" claim opened
        /// a brand-new incident which then escalated normally: a live audit
        /// observed the parent being alerted 4 times and the incident reaching
        /// EscalationStage 2 while the pause was still Approved with ~120s left.
        /// A pause that still lets the phone ring is not a pause.
        ///
        /// This is a distinct exception rather than a MonitoringDenial because it
        /// is a STATE conflict, not an authorization failure: the caller may
        /// perfectly well be an authorized sitter, the request simply arrives at
        /// a moment when detection is suspended. The controller maps it to 409 so
        /// the UI can say "cry detection is paused" rather than showing an error.
        /// </summary>
        public class CryDetectionPausedException : Exception
        {
            public DateTime? PauseExpiresAtUtc { get; }

            public CryDetectionPausedException(DateTime? pauseExpiresAtUtc)
                : base("Cry detection is suspended while a parent pause is active.")
            {
                PauseExpiresAtUtc = pauseExpiresAtUtc;
            }
        }

        /// <summary>
        /// Returns the expiry of the session's currently active pause, or null
        /// when detection is running normally.
        ///
        /// The status filter is deliberately 'Approved' only. A 'Requested' pause
        /// has not taken effect yet (the other guardian still has to approve it),
        /// and a 'Cancelled'/'Expired' pause must never suppress detection.
        /// Expiry is compared against the SERVER clock so the rule survives an
        /// app-pool recycle and needs no background timer.
        /// </summary>
        private DateTime? ActivePauseExpiry(int sessionId, DateTime nowUtc)
        {
            var row = _db.Database.SqlQuery<ActivePauseWindowRow>(
                "SELECT TOP (1) PauseExpiresAtUtc FROM MonitoringPause " +
                "WHERE MonitorSession_ID = @p0 AND IsDeleted = 0 AND Status = 'Approved' " +
                "AND PauseExpiresAtUtc IS NOT NULL AND PauseExpiresAtUtc > @p1 " +
                "ORDER BY MonitoringPause_ID DESC", sessionId, nowUtc)
                .FirstOrDefault();
            return row?.PauseExpiresAtUtc;
        }

        /// <summary>Projection for the active-pause lookup.</summary>
        private class ActivePauseWindowRow
        {
            public DateTime? PauseExpiresAtUtc { get; set; }
        }

        // ---- timing (frozen Phase 5/6 spec; all server-side UTC) ----
        private const int SitterAlertDelaySeconds = 5;         // T+5   -> sitter alert
        private const int ParentEscalationDelaySeconds = 15;   // T+15  -> parent escalation
        private const int SitterResponsePostponeSeconds = 10;  // respond -> parent deadline +10s
        private const int StageSitterAlert = 1;                // sitter notified
        private const int StageParentEscalated = 2;            // parents notified (final stage)
        private const int MaxSweepBatch = 200;                 // one ops call is bounded
        private const int PollSweepBatch = 20;                 // polling fallback batch

        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public CryIncidentService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public CryIncidentService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        // =================================================================
        // PUBLIC LIFECYCLE
        // =================================================================

        /// <summary>
        /// Creates the incident for the ACTIVE session of job + child.
        ///
        /// AUTHORIZATION: the centralized MonitoringAccess chain (job exists,
        /// job InProgress, assigned sitter / guardian, child in JobChildren,
        /// session belongs to job+child) — identical to every other monitoring
        /// entry point. An ACTIVE MonitorSession is required, so a caller cannot
        /// invent a cry incident for a job that is not being monitored.
        ///
        /// DEDUPLICATION: when an Open/Acknowledged incident already exists for
        /// the same (Job, Child, MonitorSession) it is returned with
        /// Reused=true and NOTHING is written — no second incident row, no second
        /// T+5 schedule and no extra audit row. The original deadline keeps
        /// running, so repeated "cry detected" reports cannot postpone or
        /// multiply escalation.
        ///
        /// T+0 fields: Status=Open, EscalationStage=0,
        /// NextEscalationDueAt = CreatedAt + 5s (stage 1 = sitter alert).
        /// </summary>
        public CryIncidentDto CreateIncident(int jobId, int childId, int currentUserId, string currentRole)
        {
            ValidateIds(jobId, childId);

            int? sessionId = FindActiveSessionId(jobId, childId);
            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId, sessionId);
            if (denial != MonitoringDenial.Allowed)
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, denial);
                throw new MonitoringAccessException(denial);
            }
            // A cry incident is meaningless without the live session that links
            // it to the monitored child (Phase 2 FK design).
            if (!sessionId.HasValue)
                throw new MonitoringAccessException(MonitoringDenial.SessionNotFound);

            // ---- ATOMIC DEDUPE (Phase 11 concurrency fix) -------------------
            // The check below used to be a plain SELECT followed by an INSERT.
            // Four SIMULTANEOUS "cry detected" reports (a detector firing on a
            // loop, or several participants reporting at once) could all read
            // "no open incident" before any of them inserted, producing FOUR
            // incidents and therefore four independent T+5/T+15 escalation
            // chains. The Phase 11 concurrency run reproduced exactly that.
            //
            // WHY A PROCESS GATE AND NOT Database.BeginTransaction()
            // The Phase 5/6 and Phase 7 harnesses call these services on a context
            // that is already inside a transaction, and EF6's EntityClient refuses
            // nested transactions, so opening one here breaks the frozen suites.
            // MonitoringScopeGate gives the same mutual exclusion without
            // needing a transaction. The shared gate also orders pause approval
            // and escalation delivery against this re-check and insert. This is
            // IN-PROCESS exclusion; a multi-instance deployment
            // would additionally want a filtered unique index on
            // (MonitorSession_ID) WHERE Status IN ('Open','Acknowledged').
            var gateLease = MonitoringScopeGate.Enter(jobId, childId);
            try
            {
                // Session end shares this gate. Re-check the lifecycle anchor
                // after acquiring it so a report that waited behind EndSession
                // cannot create an incident for a closed session.
                var currentSessionId = FindActiveSessionId(jobId, childId);
                if (!currentSessionId.HasValue || currentSessionId.Value != sessionId.Value)
                    throw new MonitoringAccessException(MonitoringDenial.SessionNotFound);

                // PHASE 12: refuse to open an incident while a parent pause is
                // active. Checked INSIDE the gate so it is evaluated against the
                // same session row the insert would use, and read from the
                // persisted pause + server clock (no timer, lazy expiry).
                var pauseUntil = ActivePauseExpiry(sessionId.Value, DateTime.UtcNow);
                if (pauseUntil.HasValue)
                    throw new CryDetectionPausedException(pauseUntil.Value);

                var existing = ReadIncident(
                    "WHERE JobId = @p0 AND Child_ID = @p1 AND MonitorSession_ID = @p2 AND IsDeleted = 0 " +
                    "AND Status IN ('Open','Acknowledged') ORDER BY CreatedAt DESC",
                    jobId, childId, sessionId.Value);
                if (existing != null)
                    return ToDto(existing, reused: true);

                var nowUtc = DateTime.UtcNow;                                  // server authority = T+0
                var dueAtUtc = nowUtc.AddSeconds(SitterAlertDelaySeconds);     // T+5

                // ParentId / BabysitterId are the pre-existing informational columns.
                // The AUTHORITATIVE guardian list is resolved at escalation time from
                // ChildGuardian (see EscalateToParents). Both values are read from the
                // database — never from the request body — so a caller cannot point an
                // incident at somebody else's family.
                var keys = _db.Database.SqlQuery<JobChildKeyRow>(
                    "SELECT c.Parent_ID, j.AssignedSitter_ID FROM Child c CROSS JOIN Job j " +
                    "WHERE c.Child_ID = @p0 AND j.Job_ID = @p1",
                    childId, jobId).FirstOrDefault();

                var incidentId = Guid.NewGuid();
                _db.Database.ExecuteSqlCommand(
                    "INSERT INTO CryAlert (Id, Timestamp, Level, RoomName, JobId, ParentId, BabysitterId, CreatedAt, " +
                    "                      IsDeleted, Child_ID, MonitorSession_ID, Status, EscalationStage, NextEscalationDueAt) " +
                    "VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, 0, @p8, @p9, @p10, 0, @p11)",
                    incidentId,
                    nowUtc,                                     // Timestamp: legacy detection column (UTC)
                    "Cry",                                      // Level: detector label, no personal data
                    RoomNamePlaceholder(),                      // RoomName: NOT NULL legacy column, never exposed
                    jobId,
                    (object)(keys == null ? (int?)null : keys.Parent_ID) ?? DBNull.Value,
                    (object)(keys == null ? (int?)null : keys.AssignedSitter_ID) ?? DBNull.Value,
                    nowUtc,                                     // CreatedAt doubles as the incident start (T+0)
                    childId,
                    sessionId.Value,
                    StatusOpen,
                    dueAtUtc);

                WriteAudit(incidentId, jobId, childId, "CryIncidentCreated", currentUserId, RoleName(currentRole),
                    "{\"sessionId\":" + sessionId.Value + ",\"stage\":0,\"dueInSeconds\":" + SitterAlertDelaySeconds + "}");

                return ToDto(ReadIncidentById(incidentId), reused: false);
            }
            finally
            {
                gateLease.Dispose();
            }
        }

        /// <summary>
        /// Reads the incident of this job + child: the ACTIVE one when escalation
        /// is still running, otherwise the latest incident (history view, e.g. the
        /// Resolved/Cancelled outcome after the sitting).
        ///
        /// View Child ("look at the camera") is NOT a state-changing action and
        /// therefore has no dedicated endpoint: this read is the only thing a
        /// view does, and it never touches EscalationStage, NextEscalationDueAt,
        /// Status or any timestamp. Reading must never postpone or suppress an
        /// escalation.
        ///
        /// SWEEP-ON-POLL FALLBACK: before answering, this call processes any due
        /// escalation of the caller's own session, so the workflow still advances
        /// when no SQL Agent schedule is deployed.
        /// </summary>
        public CryIncidentDto GetIncident(int jobId, int childId, int currentUserId, string currentRole)
        {
            ValidateIds(jobId, childId);

            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId);
            if (denial != MonitoringDenial.Allowed)
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, denial);
                throw new MonitoringAccessException(denial);
            }

            int? activeSessionId = FindActiveSessionId(jobId, childId);
            if (activeSessionId.HasValue)
            {
                try
                {
                    ProcessDueForSession(activeSessionId.Value);
                }
                catch (Exception ex)
                {
                    // Best-effort: a sweep failure must never break the read that
                    // triggered it (the client still receives the incident state).
                    Trace.TraceError(
                        "CryIncidentService: sweep-on-poll failed for session {0}: {1}", activeSessionId.Value, ex);
                }
            }

            var incident = ReadIncident(
                "WHERE JobId = @p0 AND Child_ID = @p1 AND IsDeleted = 0 " +
                "ORDER BY CASE WHEN Status IN ('Open','Acknowledged') THEN 0 ELSE 1 END, CreatedAt DESC",
                jobId, childId);
            if (incident == null)
                throw new MonitoringAccessException(MonitoringDenial.IncidentNotFound);

            return ToDto(incident, reused: false);
        }

        /// <summary>
        /// Sitter action "I'm going to the child".
        ///
        /// Writes: SitterResponse=GoingToChild, RespondedAt=UTC now,
        /// AcknowledgedAt/AcknowledgedByUserId (set once, never overwritten),
        /// Status=Acknowledged.
        ///
        /// POSTPONEMENT (frozen rule): the PARENT escalation moves to
        /// max(incident start + 15s, response + 10s) — i.e. exactly ten seconds
        /// after the sitter's response whenever that is the later of the two.
        /// Taking the maximum keeps a very early response from escalating the
        /// parents BEFORE the normal T+15 deadline.
        ///
        /// Repeated calls are idempotent: the second response returns the incident
        /// unchanged (the deadline is NOT extended again and RespondedAt is not
        /// moved), so a sitter can never postpone escalation indefinitely.
        ///
        /// Sitter-only: a guardian satisfies MonitoringAccess as Parent, so the
        /// role is verified explicitly — a parent must never "respond" on the
        /// sitter's behalf and thereby move the deadline.
        /// </summary>
        public CryIncidentDto SitterGoingToChild(int jobId, int childId, int currentUserId, string currentRole)
        {
            ValidateIds(jobId, childId);

            int? sessionId = FindActiveSessionId(jobId, childId);
            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId, sessionId);
            if (denial != MonitoringDenial.Allowed)
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, denial);
                throw new MonitoringAccessException(denial);
            }
            if (!IsSitter(currentRole))
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, MonitoringDenial.InvalidRole);
                throw new MonitoringAccessException(MonitoringDenial.InvalidRole);
            }
            if (!sessionId.HasValue)
                throw new MonitoringAccessException(MonitoringDenial.SessionNotFound);

            var incident = ReadIncident(
                "WHERE MonitorSession_ID = @p0 AND IsDeleted = 0 AND Status IN ('Open','Acknowledged') " +
                "ORDER BY CreatedAt DESC",
                sessionId.Value);
            if (incident == null)
                throw new MonitoringAccessException(MonitoringDenial.IncidentNotFound);

            // Idempotent: only the FIRST response postpones anything.
            if (string.Equals(incident.SitterResponse, ResponseGoingToChild, StringComparison.OrdinalIgnoreCase))
                return ToDto(incident, reused: true);

            var nowUtc = DateTime.UtcNow;
            int nextStage = incident.EscalationStage < StageSitterAlert ? StageSitterAlert : incident.EscalationStage;
            DateTime? nextDueUtc = incident.EscalationStage >= StageParentEscalated
                ? (DateTime?)null                               // parents already escalated: nothing left to postpone
                : ComputeParentEscalationDue(incident.CreatedAt ?? nowUtc, nowUtc);

            int rows = _db.Database.ExecuteSqlCommand(
                "UPDATE CryAlert SET Status = @p0, SitterResponse = @p1, RespondedAt = @p2, " +
                "       AcknowledgedAt = ISNULL(AcknowledgedAt, @p2), " +
                "       AcknowledgedByUserId = ISNULL(AcknowledgedByUserId, @p3), " +
                "       EscalationStage = @p4, NextEscalationDueAt = @p5 " +
                "WHERE Id = @p6 AND IsDeleted = 0 AND Status IN ('Open','Acknowledged')",
                StatusAcknowledged, ResponseGoingToChild, nowUtc, currentUserId, nextStage,
                (object)nextDueUtc ?? DBNull.Value, incident.Id);
            if (rows == 0)
                throw new MonitoringAccessException(MonitoringDenial.IncidentNotFound); // resolved/cancelled meanwhile

            WriteAudit(incident.Id, jobId, childId, "SitterGoingToChild", currentUserId, RoleName(currentRole),
                "{\"stage\":" + nextStage + ",\"postponedSeconds\":" + SitterResponsePostponeSeconds + "}");

            return ToDto(ReadIncidentById(incident.Id), reused: false);
        }

        /// <summary>
        /// Sitter action "with child" — resolves the ACTIVE incident:
        /// Status=Resolved, ResolvedAtUtc=UTC now, NextEscalationDueAt=NULL, so no
        /// escalation can ever fire afterwards. The MonitorSession is NOT touched
        /// (the sitting continues; only the incident ends).
        ///
        /// IDEMPOTENT for terminal success: calling it on an already-resolved
        /// incident returns that incident unchanged — the resolution timestamp is
        /// not moved and no second audit row is written. A CANCELLED incident can
        /// never be resolved (400): cancellation is terminal and must not be
        /// rewritten into a success.
        ///
        /// Sitter-only (see SitterGoingToChild for why the role is re-checked).
        /// </summary>
        public CryIncidentDto SitterWithChild(int jobId, int childId, int currentUserId, string currentRole)
        {
            ValidateIds(jobId, childId);

            // Session is optional here: an incident stays readable/resolvable while
            // the job is still In Progress even if the session already ended (the
            // session-end hook cancels such incidents, which then surface as 400).
            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId);
            if (denial != MonitoringDenial.Allowed)
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, denial);
                throw new MonitoringAccessException(denial);
            }
            if (!IsSitter(currentRole))
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, MonitoringDenial.InvalidRole);
                throw new MonitoringAccessException(MonitoringDenial.InvalidRole);
            }

            var incident = ReadIncident(
                "WHERE JobId = @p0 AND Child_ID = @p1 AND IsDeleted = 0 " +
                "ORDER BY CASE WHEN Status IN ('Open','Acknowledged') THEN 0 ELSE 1 END, CreatedAt DESC",
                jobId, childId);
            if (incident == null)
                throw new MonitoringAccessException(MonitoringDenial.IncidentNotFound);

            if (string.Equals(incident.Status, StatusResolved, StringComparison.OrdinalIgnoreCase))
                return ToDto(incident, reused: true);                       // already resolved: no-op

            if (!IsActiveStatus(incident.Status))
                throw new InvalidOperationException(
                    "This cry incident was cancelled and cannot be resolved.");

            var nowUtc = DateTime.UtcNow;
            _db.Database.ExecuteSqlCommand(
                "UPDATE CryAlert SET Status = @p0, ResolvedAtUtc = @p1, NextEscalationDueAt = NULL, " +
                "       SitterResponse = @p2, RespondedAt = ISNULL(RespondedAt, @p1), " +
                "       AcknowledgedAt = ISNULL(AcknowledgedAt, @p1), " +
                "       AcknowledgedByUserId = ISNULL(AcknowledgedByUserId, @p3) " +
                "WHERE Id = @p4 AND IsDeleted = 0 AND Status IN ('Open','Acknowledged')",
                StatusResolved, nowUtc, ResponseWithChild, currentUserId, incident.Id);

            WriteAudit(incident.Id, jobId, childId, "IncidentResolved", currentUserId, RoleName(currentRole),
                "{\"stage\":" + incident.EscalationStage + "}");

            return ToDto(ReadIncidentById(incident.Id), reused: false);
        }

        // =================================================================
        // SCHEDULER / SWEEP ENTRY POINTS (no in-memory timers anywhere)
        // =================================================================

        /// <summary>
        /// Claims and processes every alert that is due (NextEscalationDueAt at or
        /// before the database's UTC clock). Called by POST api/monitoring/ops/sweep
        /// and suitable as a SQL Agent step target. Bounded by <paramref name="max"/>
        /// so one call cannot run unbounded.
        ///
        /// TIMING HONESTY: a periodic scheduler cannot guarantee the exact second of
        /// T+5 / T+15 — a run at T+5.8 is normal and acceptable. The authoritative
        /// deadline is the database column NextEscalationDueAt; "due" simply means
        /// "not yet processed".
        /// </summary>
        public SweepResultDto ProcessDueEscalations(int max = 50)
        {
            int batch = max <= 0 ? 50 : (max > MaxSweepBatch ? MaxSweepBatch : max);
            return RunSweep(null, batch);
        }

        /// <summary>
        /// Sweep limited to ONE session (sweep-on-poll fallback used by the
        /// authorized GET endpoints). Same claim mechanism, so it can safely run
        /// next to SQL Agent.
        /// </summary>
        public SweepResultDto ProcessDueForSession(int monitorSessionId)
        {
            return RunSweep(monitorSessionId, PollSweepBatch);
        }

        private SweepResultDto RunSweep(int? monitorSessionId, int batch)
        {
            var result = new SweepResultDto { ServerTimeUtc = DateTime.UtcNow };
            for (int i = 0; i < batch; i++)
            {
                var claimed = ClaimNextDue(monitorSessionId ?? -1);
                if (claimed == null)
                    break;                          // nothing due (or nothing left)
                result.Claimed++;
                ProcessClaimed(claimed, result);
            }
            return result;
        }

        /// <summary>
        /// ATOMIC CLAIM of the next due escalation.
        ///
        /// ONE batch, three statements, executed as a single unit:
        ///   1) SELECT TOP (1) ... WITH (UPDLOCK, READPAST) picks a row that is
        ///      still escalation-eligible and due and takes an update lock on it.
        ///      READPAST makes a concurrent sweeper SKIP a row another claimer
        ///      already holds instead of blocking on it.
        ///   2) UPDATE advances EscalationStage (0→1 sitter alert, 1→2 parent
        ///      escalation) and moves NextEscalationDueAt forward (stage 1 → T+15
        ///      or response+10s, stage 2 → NULL). The row therefore no longer
        ///      matches "due at or before now", so it cannot be claimed twice —
        ///      not even by a sweeper that started at the same instant and only
        ///      re-read the row after this batch committed.
        ///   3) SELECT returns the claimed row so the caller can notify.
        ///
        /// Nothing about the claim lives in application memory: it works across
        /// AppPool recycles, restarts and multiple application instances.
        /// </summary>
        private ClaimedIncidentRow ClaimNextDue(int monitorSessionIdOrMinusOne)
        {
            const string sql = @"
DECLARE @claimId UNIQUEIDENTIFIER;

SELECT TOP (1) @claimId = Id
FROM dbo.CryAlert WITH (UPDLOCK, READPAST)
WHERE IsDeleted = 0
  AND Status IN ('Open','Acknowledged')
  AND NextEscalationDueAt IS NOT NULL
  AND NextEscalationDueAt <= GETUTCDATE()
  AND (@p0 = -1 OR MonitorSession_ID = @p0)
  -- Phase 12 defence in depth: an incident must NEVER escalate while an
  -- approved, unexpired parent pause is active for its session. Approving a
  -- pause already cancels the open incident, so this normally matches nothing;
  -- it exists for the window where an incident was created a moment before the
  -- pause was approved. Without it, that incident rang the parent's phone during
  -- a pause - reproduced live before this clause existed. The comparison is
  -- against GETUTCDATE() (server clock) and needs no timer.
  AND NOT EXISTS (
      SELECT 1 FROM dbo.MonitoringPause mp
      WHERE mp.MonitorSession_ID = dbo.CryAlert.MonitorSession_ID
        AND mp.IsDeleted = 0
        AND mp.Status = 'Approved'
        AND mp.PauseExpiresAtUtc IS NOT NULL
        AND mp.PauseExpiresAtUtc > GETUTCDATE())
ORDER BY NextEscalationDueAt;

UPDATE dbo.CryAlert
SET EscalationStage = CASE WHEN EscalationStage = 0 THEN 1 ELSE 2 END,
    NextEscalationDueAt = CASE
        WHEN EscalationStage >= 1 THEN NULL
        WHEN RespondedAt IS NOT NULL AND DATEADD(SECOND, 10, RespondedAt) > DATEADD(SECOND, 15, CreatedAt)
            THEN DATEADD(SECOND, 10, RespondedAt)
        ELSE DATEADD(SECOND, 15, CreatedAt) END
WHERE Id = @claimId;

SELECT Id, JobId, Child_ID, MonitorSession_ID, Status, EscalationStage, NextEscalationDueAt, BabysitterId
FROM dbo.CryAlert
WHERE Id = @claimId;";

            return _db.Database.SqlQuery<ClaimedIncidentRow>(sql, monitorSessionIdOrMinusOne).FirstOrDefault();
        }

        /// <summary>
        /// Processes ONE already-claimed escalation step.
        ///
        /// STEP 1 — AUTHORITATIVE RE-CHECK (what stops a stale escalation): the
        /// claim may happen moments before the session is ended or the job is
        /// cancelled/completed, so job status and session status are re-read
        /// BEFORE anything is written. If either is gone the incident is
        /// cancelled (JobCompleted / JobCancelled / JobNotInProgress /
        /// MonitoringSessionEnded), NextEscalationDueAt is cleared and NOTHING is
        /// notified — the escalation dies instead of reaching a parent whose
        /// sitting already finished.
        ///
        /// STEP 2 — notify exactly one stage:
        ///   stage 1 → the ASSIGNED sitter ("Baby may need attention")
        ///   stage 2 → every active guardian from ChildGuardian. If no active
        ///             guardian row exists, nobody is notified; Child.Parent_ID
        ///             is legacy profile data and is never monitoring authority.
        /// Both are PERSISTENT Notification rows (the frontend polls).
        ///
        /// STEP 3 — audit: EscalationClaimed plus SitterAlerted / ParentEscalated.
        /// The action audits double as the dedupe guard: if one exists already for
        /// this incident the notification is skipped, so even a replayed claim
        /// cannot notify twice. Payloads hold no tokens, credentials, room names
        /// or personal data.
        /// </summary>
        private void ProcessClaimed(ClaimedIncidentRow claimed, SweepResultDto result)
        {
            if (claimed.JobId == null || claimed.Child_ID == null || claimed.MonitorSession_ID == null)
                return;

            // Session/pause state changes share this scope gate with incident
            // creation and pause approval. The row claim stays a short atomic
            // SQL statement; delivery is serialized with approval so a claimed
            // pre-pause alert cannot ring during the pause window.
            using (MonitoringScopeGate.Enter(claimed.JobId.Value, claimed.Child_ID.Value))
            {
                int stillActive = _db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM CryAlert WHERE Id = @p0 AND IsDeleted = 0 " +
                    "AND Status IN ('Open','Acknowledged')", claimed.Id).Single();
                if (stillActive == 0)
                    return; // another scope transition (for example pause approval) cancelled it

                if (ActivePauseExpiry(claimed.MonitorSession_ID.Value, DateTime.UtcNow).HasValue)
                    return; // fail closed if a persisted pause is active after the claim

                ProcessClaimedInScope(claimed, result);
            }
        }

        private void ProcessClaimedInScope(ClaimedIncidentRow claimed, SweepResultDto result)
        {

            int jobId = claimed.JobId.Value;
            int childId = claimed.Child_ID.Value;

            string cancelReason = DetermineCancellationReason(claimed);
            if (cancelReason != null)
            {
                MarkCancelled(claimed.Id, cancelReason);
                WriteAudit(claimed.Id, jobId, childId, "IncidentCancelled", 0, "Server",
                    "{\"reason\":\"" + cancelReason + "\",\"cause\":\"EscalationAborted\"}");
                result.AutoCancelled++;
                return;
            }

            WriteAudit(claimed.Id, jobId, childId, "EscalationClaimed", 0, "Server",
                "{\"stage\":" + claimed.EscalationStage + ",\"status\":\"" + claimed.Status + "\"}");

            if (claimed.EscalationStage == StageSitterAlert)
            {
                if (HasAudit(claimed.Id, "SitterAlerted"))
                    return;                                   // this incident was already alerted
                int? sitterId = claimed.BabysitterId ?? ReadAssignedSitterId(jobId);
                if (sitterId.HasValue && sitterId.Value > 0)
                {
                    InsertNotification(sitterId.Value, UserRole.Sitter.ToDisplayString(),
                        "Baby may need attention. A cry was detected during the monitored session " +
                        "(job " + jobId + ", child " + childId + ").",
                        "CryAlertSitter", jobId);
                }
                WriteAudit(claimed.Id, jobId, childId, "SitterAlerted", 0, "Server",
                    "{\"stage\":" + StageSitterAlert + "}");
                result.SitterAlerts++;
            }
            else
            {
                if (HasAudit(claimed.Id, "ParentEscalated"))
                    return;
                var guardianIds = ReadGuardianParentIds(childId);
                foreach (int guardianId in guardianIds)
                {
                    InsertNotification(guardianId, UserRole.Parent.ToDisplayString(),
                        "Cry detected during the monitored session (job " + jobId + ", child " + childId +
                        "). The sitter has been alerted. Please check on your child.",
                        "CryAlertParent", jobId);
                }
                WriteAudit(claimed.Id, jobId, childId, "ParentEscalated", 0, "Server",
                    "{\"stage\":" + StageParentEscalated + ",\"guardianCount\":" + guardianIds.Count + "}");
                result.ParentEscalations++;
            }
        }

        /// <summary>
        /// Decides whether a claimed escalation must be CANCELLED instead of
        /// processed; returns null when it may proceed.
        /// RULE (frozen): the job lifecycle is authoritative over monitoring — as
        /// soon as the job is no longer In Progress, or the session is no longer
        /// Active, no new cry escalation is allowed regardless of what
        /// NextEscalationDueAt said.
        /// </summary>
        private string DetermineCancellationReason(ClaimedIncidentRow claimed)
        {
            // Escalations always belong to a session (Phase 5/6 rows). A row
            // without one cannot be validated against a live sitting, so it is
            // never escalated.
            if (!claimed.MonitorSession_ID.HasValue)
                return CancelSessionEnded;

            var state = ReadJobAndSessionState(claimed.JobId.Value, claimed.MonitorSession_ID.Value);
            if (state == null || !MonitoringAccess.IsInProgressStatus(state.JobStatus))
                return state == null ? CancelJobNotInProgress : ReasonForJobStatus(state.JobStatus);
            if (!string.Equals(state.SessionStatus, "Active", StringComparison.OrdinalIgnoreCase))
                return CancelSessionEnded;
            return null;
        }

        /// <summary>Maps the job's current status to the documented cancel reason.</summary>
        private static string ReasonForJobStatus(string jobStatus)
        {
            if (string.Equals(jobStatus, JobStatus.Completed.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
                return CancelJobCompleted;
            if (string.Equals(jobStatus, JobStatus.Cancelled.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
                return CancelJobCancelled;
            return CancelJobNotInProgress;
        }

        // =================================================================
        // CROSS-SERVICE HOOKS (called by MonitoringService and JobService)
        // =================================================================

        /// <summary>
        /// Sweep-on-poll helper for services that already own an EF context
        /// (MonitoringService.GetSession). Uses the SAME atomic claim as the ops
        /// endpoint, so it is safe to run next to a SQL Agent schedule.
        /// </summary>
        public static SweepResultDto SweepForSession(BabySitterBooking_and_BabyMinderEntities db, int monitorSessionId)
        {
            return new CryIncidentService(db, ownsContext: false).ProcessDueForSession(monitorSessionId);
        }

        /// <summary>
        /// Cancels the still-active incident(s) of ONE MonitorSession.
        /// Used when a session is explicitly ended (reason MonitoringSessionEnded),
        /// so nothing keeps escalating against a session that no longer exists.
        /// Already-created notifications are NOT deleted (they stay as history);
        /// only the future escalation is stopped.
        /// </summary>
        public static int CancelIncidentsForSession(
            BabySitterBooking_and_BabyMinderEntities db, int monitorSessionId, string reason, int actorUserId, string actorRole)
        {
            if (db == null) throw new ArgumentNullException(nameof(db));

            var service = new CryIncidentService(db, ownsContext: false);
            var ids = db.Database.SqlQuery<Guid>(
                "SELECT Id FROM CryAlert WHERE MonitorSession_ID = @p0 AND IsDeleted = 0 " +
                "AND Status IN ('Open','Acknowledged')",
                monitorSessionId).ToList();

            int cancelled = 0;
            foreach (Guid id in ids)
                cancelled += service.CancelIncidentInternal(id, reason, actorUserId, actorRole);
            return cancelled;
        }

        /// <summary>
        /// The job is no longer In Progress (Cancelled or Completed):
        ///   1) end every Active session of the job (the sitting is over — a
        ///      session must never stay Active after that), and
        ///   2) cancel its still-active incidents with the given reason.
        /// Notifications that were already created stay in the database as
        /// historical records — only FUTURE escalation is stopped.
        /// </summary>
        public static int CancelForJobNoLongerInProgress(
            BabySitterBooking_and_BabyMinderEntities db, int jobId, string reason, int actorUserId, string actorRole)
        {
            if (db == null) throw new ArgumentNullException(nameof(db));

            var service = new CryIncidentService(db, ownsContext: false);
            var nowUtc = DateTime.UtcNow;

            // 1) End the Active session(s) of this job.
            var sessionIds = db.Database.SqlQuery<int>(
                "SELECT MonitorSession_ID FROM MonitorSession WHERE Job_ID = @p0 AND Status = 'Active' AND IsDeleted = 0",
                jobId).ToList();
            foreach (int sessionId in sessionIds)
            {
                int ended = db.Database.ExecuteSqlCommand(
                    "UPDATE MonitorSession SET Status = 'Ended', EndedAtUtc = @p0 " +
                    "WHERE MonitorSession_ID = @p1 AND Status = 'Active' AND IsDeleted = 0",
                    nowUtc, sessionId);
                if (ended > 0)
                {
                    service.WriteAudit(null, jobId, null, "MonitoringSessionAutoEnded", actorUserId, actorRole,
                        "{\"sessionId\":" + sessionId + ",\"reason\":\"" + reason + "\"}");
                }
            }

            // 2) Cancel the active incidents (by Job so a row whose session was
            //    already ended is still caught).
            var incidentIds = db.Database.SqlQuery<Guid>(
                "SELECT Id FROM CryAlert WHERE JobId = @p0 AND IsDeleted = 0 AND Status IN ('Open','Acknowledged')",
                jobId).ToList();
            int cancelled = 0;
            foreach (Guid id in incidentIds)
                cancelled += service.CancelIncidentInternal(id, reason, actorUserId, actorRole);
            return cancelled;
        }

        /// <summary>
        /// Cancels ONE incident (Open/Acknowledged → Cancelled) and audits it.
        /// Resolved and Cancelled rows are NEVER rewritten: resolution and
        /// cancellation are both terminal, and a cancelled incident never resumes.
        /// </summary>
        private int CancelIncidentInternal(Guid incidentId, string reason, int actorUserId, string actorRole)
        {
            var incident = ReadIncidentById(incidentId);
            if (incident == null || !IsActiveStatus(incident.Status))
                return 0;

            int rows = MarkCancelled(incidentId, reason);
            if (rows == 0)
                return 0;

            WriteAudit(incidentId, incident.JobId, incident.Child_ID, "IncidentCancelled", actorUserId, actorRole,
                "{\"reason\":\"" + reason + "\"}");
            return 1;
        }

        /// <summary>
        /// Terminal cancellation write (guarded: only an ACTIVE row can be
        /// cancelled, so a resolved incident is never downgraded and a repeated
        /// cancellation is a no-op).
        /// </summary>
        private int MarkCancelled(Guid incidentId, string reason)
        {
            return _db.Database.ExecuteSqlCommand(
                "UPDATE CryAlert SET Status = @p0, CancelledAtUtc = @p1, CancellationReason = @p2, " +
                "       NextEscalationDueAt = NULL " +
                "WHERE Id = @p3 AND IsDeleted = 0 AND Status IN ('Open','Acknowledged')",
                StatusCancelled, DateTime.UtcNow, reason, incidentId);
        }

        // =================================================================
        // PRIVATE HELPERS (raw SQL only: the Phase 2 escalation columns are
        // deliberately not part of the frozen EDMX model, so EF entities cannot
        // represent them).
        // =================================================================

        /// <summary>Full incident row. Every column is selected because EF's
        /// SqlQuery requires a column for each property of the projection type.</summary>
        private class IncidentRow
        {
            public Guid Id { get; set; }
            public int? JobId { get; set; }
            public int? Child_ID { get; set; }
            public int? MonitorSession_ID { get; set; }
            public string Status { get; set; }
            public int EscalationStage { get; set; }
            public DateTime? CreatedAt { get; set; }
            public DateTime? NextEscalationDueAt { get; set; }
            public DateTime? AcknowledgedAt { get; set; }
            public int? AcknowledgedByUserId { get; set; }
            public string SitterResponse { get; set; }
            public DateTime? RespondedAt { get; set; }
            public DateTime? ResolvedAtUtc { get; set; }
            public DateTime? CancelledAtUtc { get; set; }
            public string CancellationReason { get; set; }
            public int? BabysitterId { get; set; }
        }

        /// <summary>Row returned by the atomic claim batch.</summary>
        private class ClaimedIncidentRow
        {
            public Guid Id { get; set; }
            public int? JobId { get; set; }
            public int? Child_ID { get; set; }
            public int? MonitorSession_ID { get; set; }
            public string Status { get; set; }
            public int EscalationStage { get; set; }
            public DateTime? NextEscalationDueAt { get; set; }
            public int? BabysitterId { get; set; }
        }

        private class JobChildKeyRow
        {
            public int? Parent_ID { get; set; }
            public int? AssignedSitter_ID { get; set; }
        }

        private class JobSessionStateRow
        {
            public string JobStatus { get; set; }
            public string SessionStatus { get; set; }
        }

        private class SessionIdRow
        {
            public int MonitorSession_ID { get; set; }
        }

        private class SitterIdRow
        {
            public int? AssignedSitter_ID { get; set; }
        }

        private const string IncidentColumns =
            "Id, JobId, Child_ID, MonitorSession_ID, Status, EscalationStage, CreatedAt, NextEscalationDueAt, " +
            "AcknowledgedAt, AcknowledgedByUserId, SitterResponse, RespondedAt, ResolvedAtUtc, CancelledAtUtc, " +
            "CancellationReason, BabysitterId";

        private IncidentRow ReadIncident(string whereAndOrder, params object[] args)
        {
            return _db.Database.SqlQuery<IncidentRow>(
                "SELECT " + IncidentColumns + " FROM CryAlert " + whereAndOrder, args).FirstOrDefault();
        }

        private IncidentRow ReadIncidentById(Guid incidentId)
        {
            return ReadIncident("WHERE Id = @p0", incidentId);
        }

        /// <summary>Maps the raw row to the public contract (never exposes
        /// RoomName, ParentId/BabysitterId or any other internal column).</summary>
        private static CryIncidentDto ToDto(IncidentRow row, bool reused)
        {
            return new CryIncidentDto
            {
                Id = row.Id,
                Job_ID = row.JobId ?? 0,
                Child_ID = row.Child_ID ?? 0,
                MonitorSession_ID = row.MonitorSession_ID,
                Status = row.Status,
                EscalationStage = row.EscalationStage,
                CreatedAtUtc = row.CreatedAt ?? default(DateTime),
                NextEscalationDueAt = row.NextEscalationDueAt,
                AcknowledgedAt = row.AcknowledgedAt,
                AcknowledgedByUserId = row.AcknowledgedByUserId,
                SitterResponse = row.SitterResponse,
                RespondedAt = row.RespondedAt,
                ResolvedAtUtc = row.ResolvedAtUtc,
                CancelledAtUtc = row.CancelledAtUtc,
                CancellationReason = row.CancellationReason,
                Reused = reused
            };
        }

        /// <summary>The ONE Active session of this job + child, if any.</summary>
        private int? FindActiveSessionId(int jobId, int childId)
        {
            var row = _db.Database.SqlQuery<SessionIdRow>(
                "SELECT TOP (1) MonitorSession_ID FROM MonitorSession " +
                "WHERE Job_ID = @p0 AND Child_ID = @p1 AND Status = 'Active' AND IsDeleted = 0 " +
                "ORDER BY MonitorSession_ID DESC",
                jobId, childId).FirstOrDefault();
            return row == null ? (int?)null : row.MonitorSession_ID;
        }

        /// <summary>
        /// Job + session status for the authoritative pre-notification re-check
        /// (see ProcessClaimed). Null when the job row is gone / soft-deleted.
        /// </summary>
        private JobSessionStateRow ReadJobAndSessionState(int jobId, int sessionId)
        {
            return _db.Database.SqlQuery<JobSessionStateRow>(
                "SELECT j.Status AS JobStatus, s.Status AS SessionStatus " +
                "FROM Job j LEFT JOIN MonitorSession s ON s.MonitorSession_ID = @p1 " +
                "WHERE j.Job_ID = @p0 AND j.IsDeleted = 0",
                jobId, sessionId).FirstOrDefault();
        }

        private int? ReadAssignedSitterId(int jobId)
        {
            var row = _db.Database.SqlQuery<SitterIdRow>(
                "SELECT AssignedSitter_ID FROM Job WHERE Job_ID = @p0 AND IsDeleted = 0", jobId).FirstOrDefault();
            return row == null ? (int?)null : row.AssignedSitter_ID;
        }

        /// <summary>
        /// Authorized guardians of the child for the PARENT ESCALATION fan-out.
        ///
        /// SECURITY (Phase 7, MANDATORY): ChildGuardian is the ONE and ONLY source
        /// of authorized monitoring recipients. A row is counted when
        ///   ChildGuardian.Child_ID = @childId AND IsDeleted = 0.
        ///
        /// The previous implementation fell back to Child.Parent_ID when no
        /// ChildGuardian row existed. That was a genuine authorization defect: it
        /// re-introduced the very legacy relationship that the frozen Phase 3
        /// MonitoringAccess chain deliberately refuses to trust (Rule 4 resolves
        /// guardians ONLY through ChildGuardian), so the ESCALATION path could
        /// notify a parent who was not an authorized guardian while every other
        /// monitoring entry point rejected the same person with NotGuardian. That
        /// inconsistency is now removed.
        ///
        /// Consequence (intended, and covered by the Phase 7 harness): a parent who
        /// appears only in Child.Parent_ID and has no active ChildGuardian row does
        /// NOT receive the parent escalation. The correct fix is to connect them as
        /// a guardian (docs/database/phase7_guardian_pause_dnd.sql backfills the
        /// legacy owners), never to silently notify them from the owner column.
        ///
        /// CryAlert.ParentId (a legacy column from the original detection code) is
        /// likewise NEVER used as a guardian set.
        /// </summary>
        private List<int> ReadGuardianParentIds(int childId)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT DISTINCT Parent_ID FROM ChildGuardian WHERE Child_ID = @p0 AND IsDeleted = 0",
                childId).ToList();
        }

        /// <summary>
        /// Persistent notification row in the EXISTING Notification table (the
        /// frontend polls it — an escalation that only lived in memory would be
        /// lost on restart). CreatedAt uses the local clock exactly like
        /// NotificationService.CreateNotification so the inbox still sorts and
        /// displays correctly; escalation MATH uses the UTC columns on CryAlert.
        /// Raw SQL because Notification.Job_ID is outside the EDMX model.
        /// The message contains only the incident's job/child ids and a human
        /// action sentence — no names, addresses, tokens or personal data.
        /// </summary>
        private void InsertNotification(int userId, string userRole, string message, string type, int jobId)
        {
            _db.Database.ExecuteSqlCommand(
                "INSERT INTO Notification (UserID, UserRole, Message, IsRead, CreatedAt, Type, IsDeleted, Job_ID) " +
                "VALUES (@p0, @p1, @p2, 0, @p3, @p4, 0, @p5)",
                userId, userRole, message, DateTime.Now, type, jobId);
        }

        /// <summary>
        /// Stage dedupe guard: has this incident already produced the given audit
        /// row? The append-only MonitorEvent table is the memory, so "notify once
        /// per stage" needs no extra column and no in-memory state.
        /// </summary>
        private bool HasAudit(Guid incidentId, string eventType)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE IncidentId = @p0 AND EventType = @p1",
                incidentId, eventType).Single() > 0;
        }

        /// <summary>
        /// Append-only MonitorEvent audit (Phase 2: INSERT-ONLY, no UPDATE/DELETE).
        /// IncidentId links the row to the CryAlert incident. ActorUserId = 0 with
        /// ActorRole "Server" marks a server-side step (escalation claim, automatic
        /// cancellation); user actions record the real id/role. Payloads never
        /// contain tokens, passwords, room names, media credentials or personal data.
        /// </summary>
        private void WriteAudit(Guid? incidentId, int? jobId, int? childId, string eventType,
            int actorUserId, string actorRole, string payloadJson)
        {
            _db.Database.ExecuteSqlCommand(
                "INSERT INTO MonitorEvent (Job_ID, Child_ID, IncidentId, EventType, ActorUserId, ActorRole, AtUtc, PayloadJson) " +
                "VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)",
                (object)jobId ?? DBNull.Value,
                (object)childId ?? DBNull.Value,
                (object)incidentId ?? DBNull.Value,
                eventType,
                actorUserId,
                (object)actorRole ?? DBNull.Value,
                DateTime.UtcNow,
                (object)payloadJson ?? DBNull.Value);
        }

        /// <summary>
        /// SessionAccessDenied audit for a refused cry request. Best-effort by
        /// design (mirrors Phase 3/4): a failed audit write must never mask the
        /// original denial — the caller still receives their 403/404.
        /// </summary>
        private void AuditAccessDenied(int jobId, int childId, int actorUserId, string actorRole, MonitoringDenial denial)
        {
            try
            {
                WriteAudit(null, jobId, childId, "SessionAccessDenied", actorUserId, actorRole,
                    "{\"reason\":\"" + denial + "\"}");
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "CryIncidentService: could not record SessionAccessDenied for job {0}, child {1}, user {2}: {3}",
                    jobId, childId, actorUserId, ex);
            }
        }

        private static void ValidateIds(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0)
                throw new ArgumentException("JobId and ChildId must be positive integers.");
        }

        private static bool IsSitter(string role)
        {
            return string.Equals(role, UserRole.Sitter.ToDisplayString(), StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsActiveStatus(string status)
        {
            return string.Equals(status, StatusOpen, StringComparison.OrdinalIgnoreCase)
                || string.Equals(status, StatusAcknowledged, StringComparison.OrdinalIgnoreCase);
        }

        private static string RoleName(string role)
        {
            return string.IsNullOrWhiteSpace(role) ? "Unknown" : role.Trim();
        }

        /// <summary>
        /// Parent escalation deadline after a sitter response:
        /// max(incident start + 15s, response + 10s).
        /// The "+10 seconds from the response" rule is applied exactly once (the
        /// caller refuses to postpone a second time); taking the MAX keeps a very
        /// early response from escalating the parents BEFORE the normal T+15
        /// deadline, so the frozen timeline is never shortened by a fast tap.
        /// </summary>
        private static DateTime ComputeParentEscalationDue(DateTime incidentStartUtc, DateTime respondedAtUtc)
        {
            DateTime normal = incidentStartUtc.AddSeconds(ParentEscalationDelaySeconds);
            DateTime postponed = respondedAtUtc.AddSeconds(SitterResponsePostponeSeconds);
            return postponed > normal ? postponed : normal;
        }

        /// <summary>
        /// RoomName is NOT NULL in the legacy CryAlert schema, but the media room
        /// belongs to a later phase: store a non-committal placeholder which is
        /// never returned by any API and never logged.
        /// </summary>
        private static string RoomNamePlaceholder()
        {
            return "pending-" + Guid.NewGuid().ToString("N").Substring(0, 12);
        }

        public void Dispose()
        {
            if (_ownsContext)
            {
                _db.Dispose();
            }
        }
    }
}






