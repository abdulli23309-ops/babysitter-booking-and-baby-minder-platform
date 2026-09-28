using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    /// <summary>
    /// Phase 5 + 6 — cry incident lifecycle. The incident IS the existing
    /// CryAlert row (extended in Phase 2): no MonitoringIncident table exists.
    ///
    /// END-TO-END FLOW (authoritative):
    ///   YAMNet/client reports cry
    ///        ↓
    ///   Backend validates Job + Child + Active MonitorSession + caller (MonitoringAccess)
    ///        ↓
    ///   CryAlert created at T+0 (Status=Open, EscalationStage=0, NextEscalationDueAt=T+5)
    ///        ↓
    ///   Scheduler/sweep atomically claims the due alert
    ///        ↓
    ///   T+5  → sitter notification ("Baby may need attention"), stage=1, due=T+15
    ///        ↓
    ///   T+15 → parent/guardian notification, stage=2, due=NULL
    ///        ↓
    ///   Sitter response (GoingToChild) → parent deadline = max(T+15, respond+10s)
    ///        ↓
    ///   Resolved (with child) or Cancelled (session ended / job cancelled or completed)
    ///
    /// Every escalation step re-validates that the job is still In Progress and
    /// the MonitorSession still Active before anything is written — the job
    /// lifecycle is AUTHORITATIVE over monitoring, so a stale due time can never
    /// produce a notification after the sitting has ended.
    ///
    /// All methods take the authenticated caller explicitly (same pattern as
    /// ICryAlertService / IMonitoringService) and re-use the centralized
    /// MonitoringAccess chain — no authorization logic is duplicated here.
    /// </summary>
    public interface ICryIncidentService
    {
        /// <summary>
        /// Creates the cry incident for the ACTIVE session of job + child, or
        /// returns the already-open incident when the same session reports cry
        /// again (deduplication). Requires an Active MonitorSession.
        /// Throws MonitoringAccessException when access is denied / no session.
        /// </summary>
        CryIncidentDto CreateIncident(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>
        /// Returns the ACTIVE incident (Open/Acknowledged) or, when none is
        /// active, the latest incident of this job + child (history view).
        /// Also processes any due escalation of this session first, so a polling
        /// client makes the escalation happen even without SQL Agent
        /// ("sweep-on-poll" fallback). Throws IncidentNotFound when the job+child
        /// never had an incident.
        /// </summary>
        CryIncidentDto GetIncident(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>
        /// Assigned sitter reports "I'm going to the child":
        /// SitterResponse=GoingToChild, RespondedAt/AcknowledgedAt=UTC now,
        /// Status=Acknowledged, and the PARENT escalation is postponed to
        /// max(CreatedAt+15s, RespondedAt+10s). Repeated calls never extend the
        /// deadline again. Sitter-only (403 otherwise).
        /// </summary>
        CryIncidentDto SitterGoingToChild(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>
        /// Assigned sitter reports "with child" → Status=Resolved,
        /// ResolvedAtUtc=UTC now, no further escalation. Calling it again on an
        /// already-resolved incident returns the same incident unchanged (never
        /// re-resolves, never audits twice). Sitter-only.
        /// </summary>
        CryIncidentDto SitterWithChild(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>
        /// Operations sweep: claims and processes ALL due escalations (used by
        /// POST api/monitoring/ops/sweep and SQL Agent). No timers involved.
        /// </summary>
        SweepResultDto ProcessDueEscalations(int max = 50);

        /// <summary>
        /// Sweep limited to ONE MonitorSession (used as the sweep-on-poll
        /// fallback from the authorized GET endpoints).
        /// </summary>
        SweepResultDto ProcessDueForSession(int monitorSessionId);
    }
}
