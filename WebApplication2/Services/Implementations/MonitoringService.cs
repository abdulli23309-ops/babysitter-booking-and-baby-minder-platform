using System;
using System.Diagnostics;
using System.Linq;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    /// <summary>
    /// MonitorSession lifecycle (Phase 3): Start / Get / End, one Active session
    /// PER CHILD of a job. Raw-SQL only - MonitorSession/MonitorEvent/JobChildren/
    /// ChildGuardian are intentionally not in Model1.edmx (frozen by Phase 2).
    /// Pattern follows CryAlertService (dual ctor, context ownership flag,
    /// Trace.TraceError logging, caller identity passed in explicitly).
    /// </summary>
    public class MonitoringService : IMonitoringService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public MonitoringService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public MonitoringService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        public MonitorSessionDto StartSession(int jobId, int childId, int currentUserId, string currentRole)
        {
            ValidateIds(jobId, childId);

            // Phase 3: EVERY monitoring entry point goes through the central check.
            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId);
            if (denial != MonitoringDenial.Allowed)
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, denial);
                throw new MonitoringAccessException(denial);
            }

            // Duplicate-active-session guard: exactly ONE Active session per
            // (job, child). A retry gets the existing session back instead of a
            // second row - start is idempotent while a session is Active.
            int? activeSessionId = FindActiveSessionId(jobId, childId);
            if (activeSessionId.HasValue)
                return GetSessionById(activeSessionId.Value);

            // RoomName is NOT NULL in the Phase 2 schema but the media layer is a
            // later phase: store a non-committal placeholder. It is never returned
            // by this API and never logged (Phase 2 DDL: "no room exposure").
            string roomName = "pending-" + Guid.NewGuid().ToString("N").Substring(0, 12);
            var startedAtUtc = DateTime.UtcNow;

            int newSessionId = _db.Database.SqlQuery<int>(
                @"INSERT INTO MonitorSession (Job_ID, Child_ID, RoomName, Status, StartedAtUtc)
                  VALUES (@p0, @p1, @p2, 'Active', @p3);
                  SELECT CAST(SCOPE_IDENTITY() AS INT);",
                jobId, childId, roomName, startedAtUtc).Single();

            // Audit: append-only MonitorEvent (Phase 2 schema). Deliberately no
            // surrounding transaction here: the service may run on a context that
            // already participates in an outer transaction (test harnesses), and a
            // failed audit write surfaces as a 500 that the idempotent start guard
            // heals on the next retry. Documented Phase 3 limitation.
            WriteAudit(jobId, childId, "SessionStarted", currentUserId, currentRole,
                "{\"sessionId\":" + newSessionId + "}");

            return GetSessionById(newSessionId);
        }

        public MonitorSessionDto GetSession(int jobId, int childId, int currentUserId, string currentRole)
        {
            ValidateIds(jobId, childId);

            // Latest session (Active or already Ended) so clients can display
            // state after end; null when this (job, child) never had a session.
            int? sessionId = FindLatestSessionId(jobId, childId);

            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId, sessionId);
            if (denial != MonitoringDenial.Allowed)
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, denial);
                throw new MonitoringAccessException(denial);
            }

            if (!sessionId.HasValue)
                return null; // controller maps to 404

            return GetSessionById(sessionId.Value);
        }

        public MonitorSessionDto EndSession(int jobId, int childId, int currentUserId, string currentRole)
        {
            ValidateIds(jobId, childId);

            int? sessionId = FindActiveSessionId(jobId, childId);

            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId, sessionId);
            if (denial != MonitoringDenial.Allowed)
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, denial);
                throw new MonitoringAccessException(denial);
            }

            if (!sessionId.HasValue)
                throw new MonitoringAccessException(MonitoringDenial.SessionNotFound);

            // Guarded UPDATE: only an Active row can transition to Ended, so a
            // concurrent double-end affects exactly one request (rows == 1) and
            // the loser receives SessionNotFound. The row is kept (never deleted)
            // so audit/history stays intact; EndedAtUtc is UTC by contract.
            var endedAtUtc = DateTime.UtcNow;
            int rows = _db.Database.ExecuteSqlCommand(
                "UPDATE MonitorSession SET Status = 'Ended', EndedAtUtc = @p0 " +
                "WHERE MonitorSession_ID = @p1 AND Status = 'Active' AND IsDeleted = 0",
                endedAtUtc, sessionId.Value);
            if (rows == 0)
                throw new MonitoringAccessException(MonitoringDenial.SessionNotFound);

            WriteAudit(jobId, childId, "SessionEnded", currentUserId, currentRole,
                "{\"sessionId\":" + sessionId.Value + "}");

            return GetSessionById(sessionId.Value);
        }

        // ---------------------------------------------------------------------
        // Private helpers - all raw SQL (Phase 2 freeze: no EDMX changes).
        // ---------------------------------------------------------------------

        private static void ValidateIds(int jobId, int childId)
        {
            if (jobId <= 0)
                throw new ArgumentException("JobId must be a positive integer.");
            if (childId <= 0)
                throw new ArgumentException("ChildId must be a positive integer.");
        }

        /// <summary>The Active session id for (job, child), or null. Supports the duplicate-start guard and End.</summary>
        private int? FindActiveSessionId(int jobId, int childId)
        {
            // SqlQuery of int?: an empty sequence (no Active row) yields null, never 0.
            return _db.Database.SqlQuery<int?>(
                "SELECT MonitorSession_ID FROM MonitorSession " +
                "WHERE Job_ID = @p0 AND Child_ID = @p1 AND Status = 'Active' AND IsDeleted = 0",
                jobId, childId).FirstOrDefault();
        }

        /// <summary>The most recent session id for (job, child) of ANY status, or null. Supports Get.</summary>
        private int? FindLatestSessionId(int jobId, int childId)
        {
            return _db.Database.SqlQuery<int?>(
                "SELECT TOP 1 MonitorSession_ID FROM MonitorSession " +
                "WHERE Job_ID = @p0 AND Child_ID = @p1 AND IsDeleted = 0 " +
                "ORDER BY MonitorSession_ID DESC",
                jobId, childId).FirstOrDefault();
        }

        /// <summary>Reads a MonitorSession row as the public DTO (RoomName deliberately excluded).</summary>
        private MonitorSessionDto GetSessionById(int monitorSessionId)
        {
            return _db.Database.SqlQuery<MonitorSessionDto>(
                "SELECT MonitorSession_ID, Job_ID, Child_ID, Status, StartedAtUtc, EndedAtUtc " +
                "FROM MonitorSession WHERE MonitorSession_ID = @p0 AND IsDeleted = 0",
                monitorSessionId).FirstOrDefault();
        }

        /// <summary>
        /// Append-only MonitorEvent audit write (Phase 2: INSERT-ONLY, no UPDATE/DELETE).
        /// Payloads are minimal and contain no tokens, passwords, room names or
        /// personal data (Phase 2 DDL security rule).
        /// </summary>
        private void WriteAudit(int? jobId, int? childId, string eventType, int actorUserId, string actorRole, string payloadJson)
        {
            _db.Database.ExecuteSqlCommand(
                "INSERT INTO MonitorEvent (Job_ID, Child_ID, EventType, ActorUserId, ActorRole, AtUtc, PayloadJson) " +
                "VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)",
                (object)jobId ?? DBNull.Value,
                (object)childId ?? DBNull.Value,
                eventType,
                actorUserId,
                (object)actorRole ?? DBNull.Value,
                DateTime.UtcNow,
                (object)payloadJson ?? DBNull.Value);
        }

        /// <summary>
        /// Records a SessionAccessDenied MonitorEvent for a refused request.
        /// Best-effort by design: a failed audit write must never mask the
        /// original denial (the caller still gets their 403/404) - full details
        /// of any audit failure go to the server trace log instead.
        /// </summary>
        private void AuditAccessDenied(int jobId, int childId, int actorUserId, string actorRole, MonitoringDenial denial)
        {
            try
            {
                WriteAudit(jobId, childId, "SessionAccessDenied", actorUserId, actorRole,
                    "{\"reason\":\"" + denial + "\"}");
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "MonitoringService: could not record SessionAccessDenied for job {0}, child {1}, user {2}: {3}",
                    jobId, childId, actorUserId, ex);
            }
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

