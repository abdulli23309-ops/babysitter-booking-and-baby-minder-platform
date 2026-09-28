using System;
using System.Configuration;
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
    /// MonitorSession lifecycle (Phase 3): Start / Get / End, one Active session
    /// PER CHILD of a job. Raw-SQL only - MonitorSession/MonitorEvent/JobChildren/
    /// ChildGuardian are intentionally not in Model1.edmx (frozen by Phase 2).
    /// Pattern follows CryAlertService (dual ctor, context ownership flag,
    /// Trace.TraceError logging, caller identity passed in explicitly).
    ///
    /// Phase 4 - heartbeat & connection-loss detection (E2E flow, documentation
    /// requirement):
    ///   Authenticated user
    ///           ↓ MonitoringAccess.Check (same chain for every entry point)
    ///   Active MonitorSession (job + child)
    ///           ↓ SendHeartbeat (POST session/heartbeat, client sends job+child only)
    ///   Server UTC timestamp (ParentHeartbeatUtc / SitterHeartbeatUtc by token role)
    ///           ↓ stale check on the next authorized GET poll (sweep-on-poll)
    ///   ConnectionLost / ConnectionRestored (MonitorEvent, transitions only)
    ///
    /// Key rules: heartbeat ≠ session lifecycle (it can never create, extend,
    /// end or reopen a session and never changes Job status), heartbeat ≠ cry
    /// detection (no cry/escalation is started here), there is no background
    /// timer (the server never claims the exact disconnect moment - it only
    /// judges "no beat within MonitoringHeartbeatTimeoutSeconds"), and a lost
    /// connection of ONE participant never ends the session while the other
    /// participant is still fine (parent and sitter are independent).
    ///
    /// Phase 5/6 hooks (cry escalation):
    ///   * EndSession cancels the session's still-active cry incidents
    ///     (reason MonitoringSessionEnded) — an incident must not keep escalating
    ///     against a session that no longer exists.
    ///   * GetSession also runs the sweep-on-poll escalation fallback for its own
    ///     session, so the T+5 / T+15 timeline advances without SQL Agent.
    /// See CryIncidentService for the incident lifecycle, the persisted schedule
    /// (NextEscalationDueAt) and the atomic claim that prevents duplicate
    /// escalations.
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

        // ---------------------------------------------------------------------
        // Phase 4 - connection state constants (DERIVED, never persisted).
        // The server computes Connected/Lost from "now - last heartbeat vs
        // MonitoringHeartbeatTimeoutSeconds" on every read. There is no
        // Connection table, no status column change and no state machine:
        // the MonitorSession itself stays Active even while a participant's
        // connection is Lost (temporary network loss must not kill a session).
        // ---------------------------------------------------------------------
        private const string ConnectionConnected = "Connected";
        private const string ConnectionLost = "Lost";

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

            // Phase 4 sweep-on-poll: this authorized GET is also the lightweight
            // stale-heartbeat check (NO background timer exists anywhere). It
            // detects browser closed / phone off / network gone / page stopped
            // beating purely from the absence of fresh timestamps, and audits
            // at most one ConnectionLost per side per staleness episode. Only an
            // ACTIVE session has live participant connections to lose - an Ended
            // session is never swept and never re-audited.
            int? activeSessionId = FindActiveSessionId(jobId, childId);
            if (activeSessionId.HasValue)
            {
                SweepConnections(jobId, childId, activeSessionId.Value);

                // Phase 5/6 sweep-on-poll fallback: this authorized poll also drives
                // the due cry escalations of THIS session, so the escalation timeline
                // still advances when no SQL Agent schedule is deployed. It uses the
                // same atomic claim as the ops endpoint (safe if both run at once)
                // and is best-effort, so polling never breaks on a sweep failure.
                try
                {
                    CryIncidentService.SweepForSession(_db, activeSessionId.Value);
                }
                catch (Exception ex)
                {
                    Trace.TraceError(
                        "MonitoringService: cry escalation sweep failed for session {0}: {1}",
                        activeSessionId.Value, ex);
                }
            }

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

            // Phase 5/6: a session that no longer exists must not keep feeding a cry
            // escalation. Cancelling (never deleting) keeps the incident, its
            // notifications and its audit trail as history while clearing
            // NextEscalationDueAt, so the sweeper can never fire for this session
            // again. Best-effort: a failure here must not undo the session end — the
            // escalation sweep independently re-checks the session state before it
            // notifies anybody.
            try
            {
                CryIncidentService.CancelIncidentsForSession(
                    _db, sessionId.Value, CryIncidentService.CancelSessionEnded, currentUserId, currentRole);
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "MonitoringService: could not cancel cry incidents for ended session {0}: {1}",
                    sessionId.Value, ex);
            }

            // Phase 7: once the session is over, a pending pause must never be
            // approvable later and an approved pause must stop being active -
            // otherwise stale Phase 7 state could "resurrect" monitoring for a
            // sitting that no longer exists. Idempotent and best-effort.
            try
            {
                new GuardianConnectionService(_db, ownsContext: false)
                    .InvalidateForTerminalSession(sessionId.Value, currentUserId, currentRole);
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "MonitoringService: could not invalidate Phase 7 state for ended session {0}: {1}",
                    sessionId.Value, ex);
            }

            return GetSessionById(sessionId.Value);
        }

        // ---------------------------------------------------------------------
        // Phase 4 - heartbeat entry point
        // ---------------------------------------------------------------------

        /// <summary>
        /// Records one heartbeat for the authenticated participant on the ACTIVE
        /// MonitorSession of job + child.
        ///
        /// What a heartbeat IS: proof that this monitoring participant is still
        /// communicating. It stamps one UTC column and, only when appropriate,
        /// audits the Lost → Connected transition.
        ///
        /// What a heartbeat IS NOT (lifecycle rules): it never creates a
        /// MonitorSession, never extends or reopens an Ended session (guarded by
        /// the Status='Active' UPDATE), never bypasses authorization, never
        /// changes Job status, never starts cry detection and never triggers
        /// parent escalation.
        ///
        /// Security: authorization is the centralized MonitoringAccess chain
        /// (identical to start/get/end - nothing duplicated here); WHICH column
        /// is stamped comes only from the authenticated role in the token, never
        /// from the request body; the timestamp is server UTC time, so a client
        /// cannot backdate a beat to fake a healthy connection (the request DTO
        /// has no timestamp/role/sessionId fields at all).
        ///
        /// Audit policy: ordinary beats update the timestamp ONLY - no
        /// MonitorEvent row (a beat every few seconds would otherwise grow the
        /// append-only audit table forever). Only the meaningful transition
        /// Lost → Connected is audited (ConnectionRestored); Connected → Lost is
        /// audited by SweepConnections during the next authorized GET poll.
        /// </summary>
        public HeartbeatResponse SendHeartbeat(int jobId, int childId, int currentUserId, string currentRole)
        {
            ValidateIds(jobId, childId);

            // Active session first (same pattern as End): when no Active session
            // exists the id stays null, but the full authorization chain STILL
            // runs first, so unauthorized callers get 403 + audit instead of
            // learning session state from the 404 (leak prevention).
            int? sessionId = FindActiveSessionId(jobId, childId);

            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId, sessionId);
            if (denial != MonitoringDenial.Allowed)
            {
                AuditAccessDenied(jobId, childId, currentUserId, currentRole, denial);
                throw new MonitoringAccessException(denial);
            }

            // Ended/never-started session: 404. The heartbeat does NOT reopen it.
            if (!sessionId.HasValue)
                throw new MonitoringAccessException(MonitoringDenial.SessionNotFound);

            // Column choice comes ONLY from the authenticated role. Both names are
            // compile-time constants (never client input) - the value stays safely
            // parameterized below.
            bool isSitter = string.Equals(currentRole, UserRole.Sitter.ToDisplayString(), StringComparison.OrdinalIgnoreCase);
            string heartbeatColumn = isSitter ? "SitterHeartbeatUtc" : "ParentHeartbeatUtc";
            string side = isSitter ? "Sitter" : "Parent";

            // Read the PREVIOUS stamp BEFORE overwriting so the Lost → Connected
            // transition can be detected (the only case this beat audits).
            DateTime? previousUtc = _db.Database.SqlQuery<DateTime?>(
                "SELECT " + heartbeatColumn + " FROM MonitorSession WHERE MonitorSession_ID = @p0 AND IsDeleted = 0",
                sessionId.Value).FirstOrDefault();

            var serverUtc = DateTime.UtcNow; // authoritative clock (UTC)
            int rows = _db.Database.ExecuteSqlCommand(
                "UPDATE MonitorSession SET " + heartbeatColumn + " = @p0 " +
                "WHERE MonitorSession_ID = @p1 AND Status = 'Active' AND IsDeleted = 0",
                serverUtc, sessionId.Value);
            if (rows == 0)
                throw new MonitoringAccessException(MonitoringDenial.SessionNotFound); // ended concurrently

            // Lost → Connected: a previous beat existed AND already exceeded the
            // timeout. A first-ever beat connects silently (nothing to "restore",
            // so no audit spam for brand-new sessions).
            if (previousUtc.HasValue && IsStale(previousUtc.Value, serverUtc, GetHeartbeatTimeout()))
            {
                WriteAudit(jobId, childId, "ConnectionRestored", currentUserId, currentRole,
                    "{\"side\":\"" + side + "\",\"sessionId\":" + sessionId.Value + "}");
            }

            return new HeartbeatResponse { Ok = true, ServerTimeUtc = serverUtc };
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

        /// <summary>
        /// Reads a MonitorSession row as the public DTO (RoomName deliberately
        /// excluded) and derives the Phase 4 connection state for BOTH
        /// participants of this one session from the raw heartbeat stamps just
        /// read. Derivation clock is server UTC time; the "Lost/Connected"
        /// decision is never stored, so it can never go out of sync with the
        /// configured timeout.
        /// </summary>
        private MonitorSessionDto GetSessionById(int monitorSessionId)
        {
            var dto = _db.Database.SqlQuery<MonitorSessionDto>(
                "SELECT MonitorSession_ID, Job_ID, Child_ID, Status, StartedAtUtc, EndedAtUtc, " +
                "ParentHeartbeatUtc, SitterHeartbeatUtc " +
                "FROM MonitorSession WHERE MonitorSession_ID = @p0 AND IsDeleted = 0",
                monitorSessionId).FirstOrDefault();

            if (dto != null)
            {
                var nowUtc = DateTime.UtcNow;
                var timeout = GetHeartbeatTimeout();
                dto.ParentConnection = DeriveConnection(dto.ParentHeartbeatUtc, nowUtc, timeout);
                dto.SitterConnection = DeriveConnection(dto.SitterHeartbeatUtc, nowUtc, timeout);

                // Phase 7: surface the APPROVED pause to BOTH participants through
                // this existing endpoint, so the sitter UI can render
                // "Monitoring temporarily paused by parent" without a sitter-specific
                // pause endpoint. Read-only: it does not start, extend or end the
                // pause, and it deliberately does NOT touch the Phase 4 connection
                // derivation above - a pause is not a connection loss.
                ApplyPauseState(dto, nowUtc);
            }
            return dto;
        }

        /// <summary>
        /// Phase 7 pause summary on the session DTO.
        ///
        /// A pause is derived from the persisted MonitoringPause row, never from
        /// any timer: an Approved pause whose PauseExpiresAtUtc has passed is
        /// resolved to Expired right here (lazily, on read) and then reports
        /// IsPaused=false, so an expired pause can never keep suppressing cry
        /// detection even if nobody called the pause endpoint.
        ///
        /// Best-effort: a failure here must never break the session read, which
        /// the client needs for heartbeat/connection state.
        /// </summary>
        private void ApplyPauseState(MonitorSessionDto dto, DateTime nowUtc)
        {
            try
            {
                int expired = _db.Database.ExecuteSqlCommand(
                    "UPDATE MonitoringPause SET Status = 'Expired' " +
                    "WHERE MonitorSession_ID = @p0 AND IsDeleted = 0 AND Status = 'Approved' " +
                    "AND PauseExpiresAtUtc IS NOT NULL AND PauseExpiresAtUtc <= @p1",
                    dto.MonitorSession_ID, nowUtc);
                if (expired > 0)
                {
                    WriteAudit(dto.Job_ID, dto.Child_ID, "PauseExpired", 0, "Server",
                        "{\"sessionId\":" + dto.MonitorSession_ID + ",\"expiredCount\":" + expired + "}");
                }

                var active = _db.Database.SqlQuery<ActivePauseRow>(
                    "SELECT TOP (1) PauseExpiresAtUtc FROM MonitoringPause " +
                    "WHERE MonitorSession_ID = @p0 AND IsDeleted = 0 AND Status = 'Approved' " +
                    "AND PauseExpiresAtUtc IS NOT NULL AND PauseExpiresAtUtc > @p1",
                    dto.MonitorSession_ID, nowUtc).FirstOrDefault();

                if (active != null)
                {
                    dto.IsPaused = true;
                    dto.PauseExpiresAtUtc = active.PauseExpiresAtUtc;
                    dto.PauseSecondsRemaining =
                        (int)Math.Max(0, Math.Round((active.PauseExpiresAtUtc - nowUtc).TotalSeconds));
                }
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "MonitoringService: could not read Phase 7 pause state for session {0}: {1}",
                    dto.MonitorSession_ID, ex);
            }
        }

        private class ActivePauseRow
        {
            public DateTime PauseExpiresAtUtc { get; set; }
        }

        // ---------------------------------------------------------------------
        // Phase 4 - connection-loss detection (sweep-on-poll, no timers)
        // ---------------------------------------------------------------------

        /// <summary>
        /// Timeout rule as CONFIGURATION (Web.config MonitoringHeartbeatTimeoutSeconds),
        /// default 15s when the key is missing or invalid - no magic numbers are
        /// scattered through the code. A heartbeat older than this window is
        /// stale, i.e. that participant's connection is considered LOST:
        /// "if the server has not received a heartbeat within the timeout, the
        /// connection is lost". The server does NOT and CANNOT know the exact
        /// moment a device disconnected - it only knows the last time it HEARD
        /// from the participant and judges at the moment of each authorized poll.
        /// </summary>
        private static TimeSpan GetHeartbeatTimeout()
        {
            const int defaultSeconds = 15;
            int seconds = defaultSeconds;
            string raw = ConfigurationManager.AppSettings["MonitoringHeartbeatTimeoutSeconds"];
            int parsed;
            if (!string.IsNullOrWhiteSpace(raw) && int.TryParse(raw.Trim(), out parsed) && parsed > 0)
                seconds = parsed;
            return TimeSpan.FromSeconds(seconds);
        }

        private static bool IsStale(DateTime lastHeartbeatUtc, DateTime nowUtc, TimeSpan timeout)
        {
            return nowUtc - lastHeartbeatUtc > timeout;
        }

        /// <summary>
        /// Derived presence of ONE participant - never persisted, recomputed on
        /// every read: fresh beat (within timeout) = Connected, otherwise Lost.
        /// NULL = never beaten = by definition not connected (a simple two-state
        /// model for the client; no third "Unknown" state to keep the contract
        /// easy to explain and test).
        /// </summary>
        private static string DeriveConnection(DateTime? lastHeartbeatUtc, DateTime nowUtc, TimeSpan timeout)
        {
            if (!lastHeartbeatUtc.HasValue)
                return ConnectionLost;
            return IsStale(lastHeartbeatUtc.Value, nowUtc, timeout) ? ConnectionLost : ConnectionConnected;
        }

        /// <summary>
        /// Sweep-on-poll (Phase 4): runs inside the authorized GetSession GET
        /// and checks BOTH participant connections of the Active session for
        /// staleness - browser closed, phone powered off, network gone, crashed
        /// tab or a page that simply stopped beating all look the same: no new
        /// timestamp. No background service, no timer, no in-memory state: the
        /// append-only MonitorEvent table itself remembers what was already
        /// reported (dedupe in SweepSide), so repeated polls never duplicate
        /// audits. The two connections are independent - losing one side never
        /// suppresses or audits the other side.
        /// </summary>
        private void SweepConnections(int jobId, int childId, int monitorSessionId)
        {
            SweepSide(jobId, childId, monitorSessionId, "ParentHeartbeatUtc", "Parent");
            SweepSide(jobId, childId, monitorSessionId, "SitterHeartbeatUtc", "Sitter");
        }

        /// <summary>Staleness check for ONE of the two independent connections.</summary>
        private void SweepSide(int jobId, int childId, int monitorSessionId, string heartbeatColumn, string side)
        {
            DateTime? lastBeatUtc = _db.Database.SqlQuery<DateTime?>(
                "SELECT " + heartbeatColumn + " FROM MonitorSession WHERE MonitorSession_ID = @p0 AND IsDeleted = 0",
                monitorSessionId).FirstOrDefault();

            // Never beaten = nothing was ever connected, so there is no
            // Connected → Lost transition to audit (a future first beat simply
            // connects). Keeps brand-new sessions free of bogus ConnectionLost rows.
            if (!lastBeatUtc.HasValue)
                return;

            if (!IsStale(lastBeatUtc.Value, DateTime.UtcNow, GetHeartbeatTimeout()))
                return; // healthy - the common path is two tiny reads and nothing else

            // Duplicate-poll guard: exactly ONE ConnectionLost per side per
            // staleness episode. The episode memory is the timestamp itself -
            // a NEWER heartbeat starts a new episode (its stamp post-dates any
            // previous ConnectionLost row for that side), while repeated polls
            // of the SAME stale beat keep matching here and stay silent. Uses
            // only the append-only MonitorEvent table - no extra column, no
            // in-memory state, no state machine to drift out of sync.
            int alreadyReported = _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent " +
                "WHERE Job_ID = @p0 AND Child_ID = @p1 AND EventType = 'ConnectionLost' " +
                "AND ActorRole = @p2 AND AtUtc >= @p3",
                jobId, childId, side, lastBeatUtc.Value).Single();
            if (alreadyReported > 0)
                return;

            // Best-effort: a failed audit must never break the GET poll that
            // triggered the sweep (the client still receives the session state).
            // ActorUserId = 0 marks "detected by the server" (the participant is
            // by definition not talking, so there is no human actor to record);
            // ActorRole carries WHICH of the two connections was lost. The
            // payload holds no secrets, room names or personal data.
            try
            {
                WriteAudit(jobId, childId, "ConnectionLost", 0, side,
                    "{\"side\":\"" + side + "\",\"sessionId\":" + monitorSessionId +
                    ",\"lastHeartbeatUtc\":\"" + lastBeatUtc.Value.ToString("o") +
                    "\",\"timeoutSeconds\":" + (int)GetHeartbeatTimeout().TotalSeconds + "}");
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "MonitoringService: could not record ConnectionLost for job {0}, child {1}, side {2}: {3}",
                    jobId, childId, side, ex);
            }
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

