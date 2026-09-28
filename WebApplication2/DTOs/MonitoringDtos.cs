using System;

namespace WebApplication2.DTOs
{
    /// <summary>
    /// MonitorSession lifecycle DTO returned by the three monitoring endpoints.
    /// Property names intentionally match the Phase 2 database columns so the
    /// raw-SQL reader (SELECT ... FROM MonitorSession) can materialize this type
    /// directly and the future frontend sees the documented schema names.
    /// RoomName is deliberately NOT part of this DTO: the media room is reserved
    /// for a later phase and must not be exposed (Phase 2 DDL: "no room
    /// exposure through APIs").
    ///
    /// Phase 4 (presence): the raw participant heartbeat stamps are exposed to
    /// the authorized polling client plus the connection state each stamp
    /// derives to ("Connected" / "Lost"). The state is computed on every read
    /// from server UTC time vs MonitoringHeartbeatTimeoutSeconds - it is never
    /// stored as a column and there is no separate connection table.
    /// </summary>
    public class MonitorSessionDto
    {
        public int MonitorSession_ID { get; set; }
        public int Job_ID { get; set; }
        public int Child_ID { get; set; }
        public string Status { get; set; }
        public DateTime StartedAtUtc { get; set; }
        public DateTime? EndedAtUtc { get; set; }

        // Phase 4 - two independent participant connections of THIS session.
        // NULL stamp = that participant has never sent a heartbeat yet.
        public DateTime? ParentHeartbeatUtc { get; set; }
        public DateTime? SitterHeartbeatUtc { get; set; }
        public string ParentConnection { get; set; }   // "Connected" | "Lost"
        public string SitterConnection { get; set; }   // "Connected" | "Lost"
    }

    /// <summary>
    /// Request body for POST api/monitoring/session/start.
    /// Identifies the sitting (job) and the ONE monitored child of that job.
    /// </summary>
    public class StartMonitoringSessionRequest
    {
        public int JobId { get; set; }
        public int ChildId { get; set; }
    }

    /// <summary>
    /// Request body for POST api/monitoring/session/end.
    /// Same job + child identification as start; the server resolves the
    /// Active session, so clients never pass raw session ids (avoids IDOR).
    /// </summary>
    public class EndMonitoringSessionRequest
    {
        public int JobId { get; set; }
        public int ChildId { get; set; }
    }

    /// <summary>
    /// Request body for POST api/monitoring/session/heartbeat (Phase 4).
    /// Deliberately ONLY job + child: the caller is identified by the bearer
    /// token (SessionAuthorize) and the heartbeat column is chosen from that
    /// authenticated role, so the body can never select "Parent" vs "Sitter"
    /// and can never carry a forged timestamp - there is no such field, and
    /// any extra JSON properties (heartbeatUtc, role, sessionId, ...) are
    /// silently ignored by the model binder. Server UTC time is authoritative.
    /// </summary>
    public class HeartbeatMonitoringRequest
    {
        public int JobId { get; set; }
        public int ChildId { get; set; }
    }

    /// <summary>
    /// Minimal heartbeat acknowledgement (Phase 4). Carries only an ok flag and
    /// the authoritative server UTC clock - no RoomName, no tokens, no session
    /// ids or other database internals (response hygiene rule from Phase 3).
    /// </summary>
    public class HeartbeatResponse
    {
        public bool Ok { get; set; }
        public DateTime ServerTimeUtc { get; set; }
    }

    // =====================================================================
    // PHASE 5 + 6 - CRY INCIDENT (CryAlert) CONTRACTS
    // ---------------------------------------------------------------------
    // The incident IS the existing CryAlert row (extended in Phase 2). These
    // DTOs intentionally mirror the database column names so the raw-SQL
    // reader (SELECT ... FROM CryAlert) materializes them directly and the
    // documented schema names stay visible to the frontend.
    //
    // Exposed fields are ONLY the lifecycle state the monitoring screens
    // need: no RoomName, no credentials, no personal data.
    // =====================================================================

    /// <summary>
    /// Request body shared by every Phase 5/6 cry action
    /// (create / get / going-to-child / with-child).
    /// Deliberately ONLY job + child: the caller identity comes from the bearer
    /// token, and the server resolves the ACTIVE MonitorSession, the assigned
    /// sitter, the guardians and every timestamp itself. A client can therefore
    /// never point an incident at another session, choose a stage, backdate a
    /// heartbeat of the timeline or fake an acknowledgement.
    /// </summary>
    public class CryIncidentRequest
    {
        public int JobId { get; set; }
        public int ChildId { get; set; }
    }

    /// <summary>
    /// One cry incident as returned to an authorized participant.
    /// Status values: Open (detected, escalating) / Acknowledged (sitter
    /// responded) / Resolved (sitter with child) / Cancelled (terminal, see
    /// CancellationReason). EscalationStage: 0 = sitter alert pending,
    /// 1 = sitter alerted (or responded), 2 = parents escalated (final stage).
    /// NextEscalationDueAt is the authoritative server UTC deadline of the NEXT
    /// escalation step (NULL = nothing further scheduled).
    /// Reused=true means a duplicate cry report was de-duplicated into this
    /// already-open incident instead of creating a second row.
    /// </summary>
    public class CryIncidentDto
    {
        public Guid Id { get; set; }
        public int Job_ID { get; set; }
        public int Child_ID { get; set; }
        public int? MonitorSession_ID { get; set; }
        public string Status { get; set; }
        public int EscalationStage { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public DateTime? NextEscalationDueAt { get; set; }
        public DateTime? AcknowledgedAt { get; set; }
        public int? AcknowledgedByUserId { get; set; }
        public string SitterResponse { get; set; }
        public DateTime? RespondedAt { get; set; }
        public DateTime? ResolvedAtUtc { get; set; }
        public DateTime? CancelledAtUtc { get; set; }
        public string CancellationReason { get; set; }
        public bool Reused { get; set; }
    }

    /// <summary>
    /// Result of one escalation sweep (ops endpoint / sweep-on-poll).
    /// Counts only - it never reveals which users were notified.
    /// ServerTimeUtc is the clock the sweep used (the same clock the database
    /// compares NextEscalationDueAt against).
    /// </summary>
    public class SweepResultDto
    {
        public int Claimed { get; set; }
        public int SitterAlerts { get; set; }
        public int ParentEscalations { get; set; }
        public int AutoCancelled { get; set; }
        public DateTime ServerTimeUtc { get; set; }
    }
}