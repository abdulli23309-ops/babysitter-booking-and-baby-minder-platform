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

        // Phase 7 - pause summary for the SITTER.
        // A parent can ask for the monitoring of a child to be paused, which the
        // other parent must approve. While that pause is APPROVED and unexpired
        // the sitter UI must show "Monitoring temporarily paused by parent".
        //
        // IMPORTANT: a pause is NOT a connection loss and NOT a session end. The
        // session stays Active, heartbeats keep being recorded and
        // ParentConnection/SitterConnection keep being derived exactly as in
        // Phase 4 - only the CRY ESCALATION is suspended. That is why this is
        // three extra descriptive fields rather than a new status.
        public bool IsPaused { get; set; }
        public DateTime? PauseExpiresAtUtc { get; set; }
        public int? PauseSecondsRemaining { get; set; }
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

    // =====================================================================
    // PHASE 7 - GUARDIAN CONNECTION / PARENT PAUSE / PARENT DND CONTRACTS
    // ---------------------------------------------------------------------
    // Same rules as Phase 5/6: these DTOs mirror database column names so the
    // raw-SQL readers materialize them directly, and NO response ever carries a
    // bearer token, a password, a session token, the media room name, or the
    // GuardianInvitation.TokenHash.
    //
    // KEY SECURITY PROPERTY of the Phase 7 REQUESTS: they carry SCOPE ONLY.
    // There is deliberately no field for the acting user, the approver, the DND
    // owner, the pause duration or the pause expiry, so a client physically
    // cannot select whose DND it is, who approves, or how long a pause lasts.
    // All of that is derived server-side from the bearer token and server UTC.
    // =====================================================================

    /// <summary>
    /// POST api/monitoring/guardian-invitations body.
    /// ChildId = the child the invitee should become a guardian of.
    /// Identifier = the invitee's USERNAME or EMAIL, never a Parent_ID: an
    /// internal id must not be the user-facing connection mechanism, and
    /// Username/EmailAddress are the account's existing UNIQUE fields. The
    /// service resolves it to a Parent server-side and keeps the raw string for
    /// audit only. Optional Relation ("Father"/"Mother"/"Guardian") decides
    /// whether the accepted guardian may approve a pause.
    /// </summary>
    public class CreateGuardianInvitationRequest
    {
        public int ChildId { get; set; }
        public string Identifier { get; set; }
        public string Relation { get; set; }
    }

    /// <summary>
    /// One invitation as seen by its INVITEE (GET guardian-invitations).
    /// The plaintext token is NEVER returned and TokenHash is NEVER returned:
    /// the invitee already knows the invitation exists because it is addressed
    /// to the authenticated account, so no secret has to travel to the client.
    /// </summary>
    public class GuardianInvitationDto
    {
        public int GuardianInvitation_ID { get; set; }
        public int Child_ID { get; set; }
        public string ChildName { get; set; }
        public int InvitedByParent_ID { get; set; }
        public string InviterName { get; set; }
        public string IdentifierType { get; set; }
        public string Status { get; set; }
        public string Relation { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public DateTime ExpiresAtUtc { get; set; }
        public DateTime? DecidedAtUtc { get; set; }
        public bool IsExpired { get; set; }
    }

    /// <summary>
    /// One connected guardian of a child (GET guardians).
    /// Source of truth is ChildGuardian, NOT Child.Parent_ID. Only the fields
    /// the family UI needs are exposed: never an email, phone number, password
    /// or invitation hash. CanApprovePause tells the UI whether this guardian
    /// may approve a pause request.
    /// </summary>
    public class GuardianDto
    {
        public int Parent_ID { get; set; }
        public string FullName { get; set; }
        public string Relation { get; set; }
        public bool IsPrimary { get; set; }
        public bool CanApprovePause { get; set; }
        public bool IsCurrentUser { get; set; }
    }

    /// <summary>
    /// POST / DELETE / GET api/monitoring/pause body: scope only.
    /// There is intentionally no RequestedByParentId, no duration, no
    /// PauseStartUtc, no PauseExpiresAtUtc and no approver field - every one of
    /// those is server-derived.
    /// </summary>
    public class MonitoringPauseRequest
    {
        public int JobId { get; set; }
        public int ChildId { get; set; }
    }

    /// <summary>
    /// Current/most recent pause state of one monitoring session.
    /// Returned to parents, and surfaced to the SITTER through the existing
    /// MonitorSessionDto so the sitter UI can render
    /// "Monitoring temporarily paused by parent" - there is no sitter-specific
    /// pause endpoint. The countdown is driven by PauseExpiresAtUtc, which the
    /// server computed at approval; the client never supplies it.
    /// </summary>
    public class MonitoringPauseDto
    {
        public int MonitoringPause_ID { get; set; }
        public int MonitorSession_ID { get; set; }
        public int Job_ID { get; set; }
        public int Child_ID { get; set; }
        public int RequestedByParent_ID { get; set; }
        public string RequestedByName { get; set; }
        public string Status { get; set; }
        public DateTime RequestedAtUtc { get; set; }
        public DateTime? DecidedAtUtc { get; set; }
        public int? DecidedByParent_ID { get; set; }
        public string DecidedByName { get; set; }
        public DateTime? PauseStartUtc { get; set; }
        public DateTime? PauseExpiresAtUtc { get; set; }
        public string DecidedReason { get; set; }

        // Derived on read, never stored: true only while an APPROVED pause is
        // still inside its window. The sitter UI keys off this.
        public bool IsActive { get; set; }
        public int? SecondsRemaining { get; set; }
    }

    /// <summary>
    /// POST / DELETE / GET api/monitoring/dnd body: scope only.
    /// No UserId, no ParentId, no Role and no DndUntilUtc: the owner is the
    /// authenticated token's user and the expiry is computed by the server, so
    /// a client can neither set DND for somebody else nor make it unbounded.
    /// </summary>
    public class MonitoringDndRequest
    {
        public int JobId { get; set; }
        public int ChildId { get; set; }
    }

    /// <summary>
    /// One user's DND state for a monitoring session.
    /// DndUntilUtc is only meaningful while IsActive is true; expired rows stay
    /// in the database as history and are reported as inactive.
    /// </summary>
    public class MonitoringDndDto
    {
        public int MonitoringDnd_ID { get; set; }
        public int MonitorSession_ID { get; set; }
        public int UserId { get; set; }
        public string FullName { get; set; }
        public string Role { get; set; }
        public DateTime DndUntilUtc { get; set; }
        public bool IsActive { get; set; }
        public bool IsCurrentUser { get; set; }
    }
}