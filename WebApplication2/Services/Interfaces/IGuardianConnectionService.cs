using System;
using System.Collections.Generic;
using WebApplication2.DTOs;
using WebApplication2.Models;

namespace WebApplication2.Services.Interfaces
{
    // =====================================================================
    // PHASE 7 - GUARDIAN CONNECTION / PARENT PAUSE / PARENT DND
    // ---------------------------------------------------------------------
    // Invitation lifecycle:
    //   GuardianInvitation (Pending, addressed to an account)
    //        v ACCEPT (one transaction)
    //   ChildGuardian (the ONLY monitoring authorization source)
    //        v
    //   MonitoringAccess -> MonitoringPause / MonitoringDnd
    //
    // All three features live in ONE service because they share the same
    // authorization chain (MonitoringAccess) and the same audit writer
    // (MonitorEvent). Splitting them would duplicate that chain, which is
    // exactly what Phase 3 forbade.
    //
    // UNIVERSAL RULE for every method below: the acting user comes from the
    // authenticated token, never from the request. There is no parameter or DTO
    // field for "acting user", "approver", "DND owner", "pause duration" or
    // "pause expiry" - a hostile client cannot supply any of them.
    // =====================================================================
    public interface IGuardianConnectionService
    {
        // ---- guardian connection (invitation) ----

        /// <summary>
        /// Creates a Pending invitation for a child, on behalf of the
        /// authenticated parent. The invitee is resolved SERVER-SIDE from the
        /// submitted username/email (an internal Parent_ID is never accepted as
        /// the target). Rejects: self-invite, inactive target, an already
        /// connected guardian, and a duplicate Pending invitation for the same
        /// (child, invitee).
        /// </summary>
        GuardianInvitationDto CreateInvitation(
            int childId, string identifier, string relation, int currentUserId, string currentRole);

        /// <summary>
        /// Invitations addressed to the AUTHENTICATED account only. A parentId /
        /// userId filter is never accepted from the client, so one parent can
        /// never list another parent's invitations.
        /// </summary>
        IEnumerable<GuardianInvitationDto> GetInvitationsForCurrentUser(int currentUserId, string currentRole);

        /// <summary>
        /// Accepts an invitation ATOMICALLY: inside one transaction it verifies
        /// ownership (the invitation must belong to the caller), Pending status,
        /// non-expiry, a live child and inviter, and no existing relationship -
        /// then inserts the ChildGuardian row AND marks the invitation
        /// Accepted. Any failure rolls back BOTH, so a guardian relationship can
        /// never exist without its invitation being closed, and vice versa.
        /// </summary>
        GuardianInvitationDto AcceptInvitation(int invitationId, int currentUserId, string currentRole);

        /// <summary>Rejects an invitation owned by the caller.</summary>
        GuardianInvitationDto RejectInvitation(int invitationId, int currentUserId, string currentRole);

        /// <summary>Inviter cancels a Pending invitation they created.</summary>
        GuardianInvitationDto CancelInvitation(int invitationId, int currentUserId, string currentRole);

        /// <summary>
        /// Connected guardians of a child, from ChildGuardian only (never
        /// Child.Parent_ID).
        /// </summary>
        IEnumerable<GuardianDto> GetGuardians(int jobId, int childId, int currentUserId, string currentRole);

        // ---- parent pause (request -> approve/deny -> exactly 150s -> expiry) ----

        /// <summary>
        /// Records a pause REQUEST. This has NO immediate effect: no incident is
        /// cancelled and monitoring continues until a DIFFERENT authorized
        /// guardian approves it. The requester id comes from the token.
        /// </summary>
        MonitoringPauseDto RequestPause(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>
        /// Approves a Pending pause. Server-side rules, all enforced here and
        /// never taken from the client: the caller is an active guardian of that
        /// child, holds ChildGuardian.CanApprovePause = 1, is NOT the requester,
        /// and the job/session/child are still valid. The approval window is
        /// ALWAYS exactly 150 seconds, computed from server UTC now; the client
        /// cannot ask for 30s, 5 minutes or a chosen instant.
        /// On approval it reuses the Phase 5/6 cancellation path so the active
        /// cry incident is cancelled (reason ParentPauseApproved) and can never
        /// resume.
        /// </summary>
        MonitoringPauseDto ApprovePause(int pauseId, int currentUserId, string currentRole);

        /// <summary>Denies a Pending pause. Never touches CryAlert.</summary>
        MonitoringPauseDto DenyPause(int pauseId, int currentUserId, string currentRole);

        /// <summary>
        /// The requester withdraws their OWN Pending request. An already
        /// APPROVED pause is deliberately NOT cancellable this way - Phase 7
        /// defines no early-resume operation.
        /// </summary>
        MonitoringPauseDto CancelPause(int pauseId, int currentUserId, string currentRole);

        /// <summary>
        /// Current pause state for a session, resolving Approved -> Expired
        /// lazily when PauseExpiresAtUtc has passed. There is no timer.
        /// </summary>
        MonitoringPauseDto GetPause(int jobId, int childId, int currentUserId, string currentRole);

        // ---- parent DND (presentation only, mutually exclusive) ----

        /// <summary>
        /// Enables the CALLER's own DND for a bounded, server-chosen window.
        /// Refuses when another guardian already has active DND on the same
        /// session; that exclusion is guaranteed by a transaction that locks the
        /// MonitorSession row (UPDLOCK, HOLDLOCK), not by the UI.
        /// DND never touches CryAlert, Notification or MonitorEvent.
        /// </summary>
        MonitoringDndDto EnableDnd(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>Disables the CALLER's own DND. Never another parent's.</summary>
        MonitoringDndDto DisableDnd(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>DND state of the session's guardians; expired = inactive.</summary>
        IEnumerable<MonitoringDndDto> GetDndStates(int jobId, int childId, int currentUserId, string currentRole);

        // ---- lifecycle hooks used by MonitoringService / JobService ----

        /// <summary>
        /// Phase 7 lifecycle teardown: when a session ENDS or a job becomes
        /// terminal, a Pending pause must never be approvable later and an
        /// Approved pause must stop being active. Called from the existing
        /// Phase 3/5/6 hooks; best-effort and idempotent.
        /// </summary>
        void InvalidateForTerminalSession(int monitorSessionId, int actorUserId, string actorRole);
    }
}