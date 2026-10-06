using System;
using System.Collections.Generic;
using System.Data.Entity;
using System.Diagnostics;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    /// <summary>
    /// Phase 7 - guardian connection, parent pause and parent DND.
    ///
    /// WHAT THIS SERVICE IS
    ///   Three features that all sit on top of the frozen Phase 3-6 monitoring
    ///   boundary and share one authorization chain (MonitoringAccess) and one
    ///   audit writer (MonitorEvent):
    ///     1. GuardianInvitation -> ChildGuardian (connecting a second parent,
    ///        e.g. a Father, to a child the primary parent already owns)
    ///     2. MonitoringPause    (a parent asks to pause monitoring; a DIFFERENT
    ///        authorized guardian approves it for exactly 150 seconds)
    ///     3. MonitoringDnd      (per-parent Do-Not-Disturb, presentation only)
    ///
    /// SECURITY RULES ENFORCED HERE (never delegated to the client)
    ///   * The acting user is the token's user. No DTO carries an acting-user,
    ///     approver, DND-owner, duration or expiry field, so a hostile client
    ///     cannot select any of them - the fields simply do not exist.
    ///   * All timestamps are server UTC. The pause expiry is always
    ///     now + 150 seconds; it is never read from a request.
    ///   * An invitation target is resolved from the unique Parent.Username /
    ///     Parent.EmailAddress, never from a client-supplied Parent_ID.
    ///   * Pause approval requires ChildGuardian.CanApprovePause = 1 AND a
    ///     different user from the requester (no self-approval).
    ///   * DND mutual exclusion is guaranteed by a TRANSACTION that locks the
    ///     MonitorSession row, not by a disabled UI button.
    ///   * Guardians are resolved ONLY through ChildGuardian. Child.Parent_ID
    ///     is legacy profile data and is not monitoring authorization.
    ///
    /// NO TIMERS
    ///   Pause expiry and DND expiry are DERIVED on read from the persisted UTC
    ///   columns. There is no background job, no Task.Delay and no cache, so an
    ///   AppPool recycle cannot lose or duplicate a pause. An Approved pause
    ///   whose window has passed is lazily moved to Expired the next time it is
    ///   read (GET pause, or the monitoring poll that fills the session DTO).
    ///
    /// PAUSE vs CONNECTION LOSS (deliberate separation)
    ///   A pause NEVER ends or pauses a MonitorSession, never stops heartbeats
    ///   and never changes the Phase 4 connection derivation. It only cancels
    ///   the CRY INCIDENT, through the existing Phase 5/6 cancellation path, so
    ///   a paused incident can never resume and a cry after the pause creates a
    ///   brand new T+0 incident (dedupe only covers Open/Acknowledged).
    /// </summary>
    public class GuardianConnectionService : IGuardianConnectionService, IDisposable
    {
        // ---- invitation states ----
        public const string InvitationPending = "Pending";
        public const string InvitationAccepted = "Accepted";
        public const string InvitationRejected = "Rejected";
        public const string InvitationCancelled = "Cancelled";
        public const string InvitationExpired = "Expired";

        // ---- pause states ----
        public const string PauseRequested = "Requested";
        public const string PauseApproved = "Approved";
        public const string PauseDenied = "Denied";
        public const string PauseExpired = "Expired";
        public const string PauseCancelled = "Cancelled";

        /// <summary>
        /// The frozen Phase 7 business rule: an approved pause is EXACTLY
        /// 2 minutes 30 seconds. This constant is the only place the duration
        /// exists; no request field can influence it.
        /// </summary>
        public const int PauseDurationSeconds = 150;

        /// <summary>
        /// Bounded DND window. The product has no existing DND duration (Phase 2
        /// only stored the column without logic), so Phase 7 fixes a sensible
        /// server-side maximum: one hour. The client cannot extend or shorten it.
        /// </summary>
        public const int DndDurationSeconds = 3600;

        /// <summary>
        /// How long an unanswered invitation stays offerable. Keeps a stale
        /// invitation from becoming a permanent authorization surface.
        /// </summary>
        public const int InvitationExpiryHours = 72;

        /// <summary>
        /// Guardian relations that may approve a pause. These are the values the
        /// application ALREADY uses on Child.GuardianRelation in the live
        /// database ("Mother", "Father", "Guardian"), so no new gender or account
        /// concept is invented. An accepted guardian with one of these relations
        /// receives CanApprovePause = 1; the service still refuses self-approval
        /// separately, so a lone "Father" can never approve his own request.
        /// </summary>
        private static readonly string[] PauseCapableRelations = { "Father", "Mother", "Guardian" };

        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public GuardianConnectionService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public GuardianConnectionService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        // =================================================================
        // GUARDIAN CONNECTION - INVITATION
        // =================================================================

        /// <summary>
        /// Creates a Pending invitation. Authorization: the inviter must be an
        /// active guardian of the target child (ChildGuardian), so nobody can
        /// invite strangers to a child they do not control. The inviter id is
        /// read from the token, never from the request.
        /// </summary>
        public GuardianInvitationDto CreateInvitation(
            int childId, string identifier, string relation, int currentUserId, string currentRole)
        {
            if (childId <= 0)
                throw new ArgumentException("ChildId must be a positive integer.");
            if (string.IsNullOrWhiteSpace(identifier))
                throw new ArgumentException("Identifier (username or email) is required.");

            RequireParentRole(currentUserId, currentRole);
            var nowUtc = DateTime.UtcNow;

            // The inviter must already be a guardian of this child.
            RequireGuardian(childId, currentUserId);

            var child = _db.Database.SqlQuery<ChildRow>(
                "SELECT Child_ID, ChildName FROM Child WHERE Child_ID = @p0 AND IsDeleted = 0",
                childId).FirstOrDefault();
            if (child == null)
                throw new MonitoringAccessException(MonitoringDenial.ChildNotFound);

            string trimmed = identifier.Trim();
            string identifierType;

            // SECURITY: the target is resolved from the account's UNIQUE
            // Username / EmailAddress. A Parent_ID is never accepted here - an
            // internal id must not be the user-facing connection mechanism.
            var byUsername = _db.Database.SqlQuery<ParentRow>(
                "SELECT Parent_ID, FullName, Username, EmailAddress FROM Parent " +
                "WHERE Username = @p0 AND IsDeleted = 0", trimmed).FirstOrDefault();
            var byEmail = _db.Database.SqlQuery<ParentRow>(
                "SELECT Parent_ID, FullName, Username, EmailAddress FROM Parent " +
                "WHERE EmailAddress = @p0 AND IsDeleted = 0", trimmed).FirstOrDefault();

            if (byUsername == null && byEmail == null)
                throw new InvalidOperationException("No active parent account matches that username or email.");
            if (byUsername != null && byEmail != null && byUsername.Parent_ID != byEmail.Parent_ID)
                throw new InvalidOperationException("That identifier matches more than one account.");

            ParentRow target = byUsername ?? byEmail;
            identifierType = byUsername != null ? "Username" : "Email";

            if (target.Parent_ID == currentUserId)
                throw new InvalidOperationException("You cannot invite your own account.");

            // Already connected? (active relationship only - a soft-deleted row
            // is a REMOVED relationship and may be re-invited.)
            bool alreadyGuardian = _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = @p0 AND Parent_ID = @p1 AND IsDeleted = 0",
                childId, target.Parent_ID).Single() > 0;
            if (alreadyGuardian)
                throw new InvalidOperationException("That account is already a guardian of this child.");

            // Duplicate PENDING invitation for the same (child, invitee).
            bool alreadyPending = _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM GuardianInvitation WHERE Child_ID = @p0 AND InvitedParent_ID = @p1 " +
                "AND Status = 'Pending' AND IsDeleted = 0", childId, target.Parent_ID).Single() > 0;
            if (alreadyPending)
                throw new InvalidOperationException("An invitation for that account is already pending for this child.");

            string relationValue = NormalizeRelation(relation);

            // A secure random token is generated and immediately hashed. The
            // PLAINTEXT is never stored, never logged and never audited - only
            // the hash below is persisted, so the stored value cannot be used to
            // accept the invitation.
            string tokenHash = HashToken(GenerateToken());

            int invitationId = _db.Database.SqlQuery<int>(
                "INSERT INTO GuardianInvitation " +
                "(Child_ID, InvitedByParent_ID, InvitedParent_ID, IdentifierType, IdentifierValue, " +
                " TokenHash, Status, CreatedAtUtc, ExpiresAtUtc, Relation, IsDeleted) " +
                "VALUES (@p0, @p1, @p2, @p3, @p4, @p5, 'Pending', @p6, @p7, @p8, 0); " +
                "SELECT CAST(SCOPE_IDENTITY() AS INT);",
                childId, currentUserId, target.Parent_ID, identifierType, trimmed,
                tokenHash, nowUtc, nowUtc.AddHours(InvitationExpiryHours),
                (object)relationValue ?? DBNull.Value).Single();

            WriteAudit(childId, "GuardianInvitationCreated", currentUserId, currentRole,
                "{\"invitationId\":" + invitationId + ",\"childId\":" + childId + "}");
            NotifyGuardian(target.Parent_ID, currentUserId, "GuardianInvitation",
                "You have been invited to help monitor a child on Little Care. Open Family to accept or decline.");

            Trace.TraceInformation(
                "GuardianConnectionService: guardian invitation {0} created for child {1} (invitee {2}).",
                invitationId, childId, target.Parent_ID);

            return ReadInvitationRow(invitationId, currentUserId);
        }

        /// <summary>
        /// Only the AUTHENTICATED account's invitations. The invitee id comes from
        /// the token, so a client cannot pass a parentId/userId filter and read
        /// somebody else's invitations.
        /// </summary>
        public IEnumerable<GuardianInvitationDto> GetInvitationsForCurrentUser(int currentUserId, string currentRole)
        {
            RequireParentRole(currentUserId, currentRole);
            var nowUtc = DateTime.UtcNow;

            var rows = _db.Database.SqlQuery<InvitationRow>(
                "SELECT GuardianInvitation_ID, Child_ID, InvitedByParent_ID, InvitedParent_ID, IdentifierType, " +
                "       Status, CreatedAtUtc, ExpiresAtUtc, DecidedAtUtc, Relation " +
                "FROM GuardianInvitation WHERE InvitedParent_ID = @p0 AND IsDeleted = 0 " +
                "ORDER BY CreatedAtUtc DESC, GuardianInvitation_ID DESC",
                currentUserId).ToList();

            var result = new List<GuardianInvitationDto>();
            foreach (var r in rows)
            {
                // Lazy expiry, no timer: an unanswered invitation past its window
                // becomes Expired the moment anybody looks at it.
                if (string.Equals(r.Status, InvitationPending, StringComparison.OrdinalIgnoreCase)
                    && r.ExpiresAtUtc <= nowUtc)
                {
                    MarkInvitationExpired(r.GuardianInvitation_ID, nowUtc);
                    r.Status = InvitationExpired;
                }
                result.Add(MapInvitation(r));
            }
            return result;
        }

        /// <summary>
        /// ATOMIC acceptance. One transaction covers BOTH the ChildGuardian insert
        /// and the invitation status change, so the relationship and the closed
        /// invitation can never disagree: a crash (or any validation failure)
        /// rolls back both and the invitation stays Pending.
        ///
        /// Checks, all server-side: the invitation belongs to the CALLER, is
        /// Pending, has not expired, the child and the inviter are still live,
        /// and no active relationship already exists.
        /// </summary>
        public GuardianInvitationDto AcceptInvitation(int invitationId, int currentUserId, string currentRole)
        {
            if (invitationId <= 0)
                throw new ArgumentException("Invitation id must be a positive integer.");
            RequireParentRole(currentUserId, currentRole);

            var nowUtc = DateTime.UtcNow;
            var existingTransaction = _db.Database.CurrentTransaction;
            DbContextTransaction tx = null;
            try
            {
                if (existingTransaction == null)
                    tx = _db.Database.BeginTransaction();

                var row = ReadInvitationForUpdate(invitationId, existingTransaction != null);
                if (row == null)
                    throw new KeyNotFoundException("Invitation not found.");

                // Ownership: the invitation is addressed to THIS account only.
                if (row.InvitedParent_ID != currentUserId)
                    throw new UnauthorizedAccessException("This invitation belongs to another account.");
                if (!string.Equals(row.Status, InvitationPending, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("This invitation is no longer pending.");
                if (row.ExpiresAtUtc <= nowUtc)
                {
                    MarkInvitationExpired(invitationId, nowUtc);
                    if (tx != null) tx.Commit();
                    throw new InvalidOperationException("This invitation has expired.");
                }

                int childId = row.Child_ID;

                bool childAlive = _db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM Child WHERE Child_ID = @p0 AND IsDeleted = 0", childId).Single() > 0;
                if (!childAlive)
                    throw new InvalidOperationException("The child this invitation refers to no longer exists.");
                bool inviterAlive = _db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM Parent WHERE Parent_ID = @p0 AND IsDeleted = 0",
                    row.InvitedByParent_ID).Single() > 0;
                if (!inviterAlive)
                    throw new InvalidOperationException("The account that sent this invitation is no longer active.");

                bool alreadyGuardian = _db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = @p0 AND Parent_ID = @p1 AND IsDeleted = 0",
                    childId, currentUserId).Single() > 0;
                if (alreadyGuardian)
                    throw new InvalidOperationException("You are already a guardian of this child.");

                // CanApprovePause is assigned SERVER-SIDE from the relation the
                // invitation carries. The client never sets this capability, and
                // an unknown relation gets 0 (cannot approve). Self-approval is
                // separately impossible (Approver != Requester is re-checked on
                // every approval), so even a capable lone guardian cannot approve
                // their own request.
                bool canApprove = PauseCapableRelations.Any(
                    r => string.Equals(r, row.Relation, StringComparison.OrdinalIgnoreCase));

                _db.Database.ExecuteSqlCommand(
                    "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, CreatedAt, IsDeleted) " +
                    "VALUES (@p0, @p1, @p2, 0, @p3, @p4, 0)",
                    childId, currentUserId, (object)row.Relation ?? (object)DBNull.Value,
                    canApprove, nowUtc);

                int updated = _db.Database.ExecuteSqlCommand(
                    "UPDATE GuardianInvitation SET Status = 'Accepted', DecidedAtUtc = @p0, DecidedByParent_ID = @p1 " +
                    "WHERE GuardianInvitation_ID = @p2 AND Status = 'Pending' AND IsDeleted = 0",
                    nowUtc, currentUserId, invitationId);
                if (updated == 0)
                    throw new InvalidOperationException("This invitation is no longer pending.");

                if (tx != null) tx.Commit();

                WriteAudit(childId, "GuardianInvitationAccepted", currentUserId, currentRole,
                    "{\"invitationId\":" + invitationId + ",\"childId\":" + childId + "}");
                NotifyGuardian(row.InvitedByParent_ID, currentUserId, "GuardianInvitationAccepted",
                    "A guardian invitation was accepted. You can now share monitoring duties for this child.");

                return ReadInvitationRow(invitationId, currentUserId);
            }
            catch
            {
                if (tx != null)
                {
                    try { tx.Rollback(); }
                    catch (Exception rollbackEx) { Trace.TraceError("GuardianConnectionService: accept rollback failed: {0}", rollbackEx); }
                }
                throw;
            }
            finally
            {
                if (tx != null) tx.Dispose();
            }
        }

        /// <summary>Rejects a Pending invitation addressed to the caller.</summary>
        public GuardianInvitationDto RejectInvitation(int invitationId, int currentUserId, string currentRole)
        {
            return DecideInvitation(invitationId, currentUserId, currentRole,
                InvitationRejected, "GuardianInvitationRejected", "Invitation declined.");
        }

        /// <summary>The inviter withdraws a Pending invitation they created.</summary>
        public GuardianInvitationDto CancelInvitation(int invitationId, int currentUserId, string currentRole)
        {
            return DecideInvitation(invitationId, currentUserId, currentRole,
                InvitationCancelled, "GuardianInvitationCancelled", "Invitation withdrawn.");
        }

        /// <summary>
        /// Shared Pending-invitation transition for Rejected / Cancelled.
        /// Ownership differs by intent: an invitee may reject an invitation
        /// addressed to them, while only the INVITER may cancel one they sent.
        /// Neither transition touches ChildGuardian - a rejected or withdrawn
        /// invitation never created a relationship.
        /// </summary>
        private GuardianInvitationDto DecideInvitation(
            int invitationId, int currentUserId, string currentRole,
            string newStatus, string auditEvent, string notifyText)
        {
            if (invitationId <= 0)
                throw new ArgumentException("Invitation id must be a positive integer.");
            RequireParentRole(currentUserId, currentRole);

            var row = ReadInvitationRowForCaller(invitationId);
            if (row == null)
                throw new KeyNotFoundException("Invitation not found.");

            bool isInvitee = row.InvitedParent_ID == currentUserId;
            bool isInviter = row.InvitedByParent_ID == currentUserId;
            if (!isInvitee && !isInviter)
                throw new UnauthorizedAccessException("This invitation belongs to another account.");
            // Only the inviter may withdraw; an invitee declines instead.
            if (string.Equals(newStatus, InvitationCancelled, StringComparison.OrdinalIgnoreCase) && !isInviter)
                throw new UnauthorizedAccessException("Only the account that sent this invitation can withdraw it.");

            if (!string.Equals(row.Status, InvitationPending, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("This invitation is no longer pending.");

            var nowUtc = DateTime.UtcNow;
            int updated = _db.Database.ExecuteSqlCommand(
                "UPDATE GuardianInvitation SET Status = @p0, DecidedAtUtc = @p1, DecidedByParent_ID = @p2 " +
                "WHERE GuardianInvitation_ID = @p3 AND Status = 'Pending' AND IsDeleted = 0",
                newStatus, nowUtc, currentUserId, invitationId);
            if (updated == 0)
                throw new InvalidOperationException("This invitation is no longer pending.");

            WriteAudit(row.Child_ID, auditEvent, currentUserId, currentRole,
                "{\"invitationId\":" + invitationId + ",\"childId\":" + row.Child_ID + "}");

            int otherParty = isInviter ? row.InvitedParent_ID : row.InvitedByParent_ID;
            NotifyGuardian(otherParty, currentUserId, auditEvent, notifyText);

            return ReadInvitationRow(invitationId, currentUserId);
        }

        /// <summary>
        /// Connected guardians of a child. Source of truth is ChildGuardian ONLY -
        /// Child.Parent_ID is legacy profile data and is never merged in, so the
        /// list always matches what MonitoringAccess will actually authorize.
        /// </summary>
        public IEnumerable<GuardianDto> GetGuardians(int jobId, int childId, int currentUserId, string currentRole)
        {
            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId);
            if (denial != MonitoringDenial.Allowed)
                throw new MonitoringAccessException(denial);

            var rows = _db.Database.SqlQuery<GuardianRow>(
                "SELECT g.Parent_ID, p.FullName, g.Relation, g.IsPrimary, g.CanApprovePause " +
                "FROM ChildGuardian g " +
                "LEFT JOIN Parent p ON p.Parent_ID = g.Parent_ID AND p.IsDeleted = 0 " +
                "WHERE g.Child_ID = @p0 AND g.IsDeleted = 0 " +
                "ORDER BY g.IsPrimary DESC, p.FullName",
                childId).ToList();

            var result = new List<GuardianDto>();
            foreach (var r in rows)
            {
                // A soft-deleted parent account is not an active guardian; the
                // relationship row stays for history but is not reported.
                if (string.IsNullOrEmpty(r.FullName))
                    continue;
                result.Add(new GuardianDto
                {
                    Parent_ID = r.Parent_ID,
                    FullName = r.FullName,
                    Relation = r.Relation,
                    IsPrimary = r.IsPrimary,
                    CanApprovePause = r.CanApprovePause,
                    IsCurrentUser = r.Parent_ID == currentUserId
                });
            }
            return result;
        }

        // =================================================================
        // PARENT PAUSE
        // Request -> (other guardian approves) -> exactly 150s -> Expired
        // =================================================================

        /// <summary>
        /// Records a pause REQUEST with NO immediate effect. Monitoring keeps
        /// running and no incident is cancelled until a DIFFERENT authorized
        /// guardian approves; that two-party rule is what makes a pause a
        /// shared decision rather than a self-service mute.
        /// </summary>
        public MonitoringPauseDto RequestPause(int jobId, int childId, int currentUserId, string currentRole)
        {
            var session = RequireParentForActiveMonitoring(jobId, childId, currentUserId, currentRole);
            var nowUtc = DateTime.UtcNow;

            // A second open episode (Requested, or an Approved pause still inside
            // its window) is refused so one session never has competing pauses.
            ResolvePauseExpiry(session.MonitorSession_ID, nowUtc);
            int openEpisodes = _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitoringPause WHERE MonitorSession_ID = @p0 AND IsDeleted = 0 " +
                "AND (Status = 'Requested' OR (Status = 'Approved' AND (PauseExpiresAtUtc IS NULL OR PauseExpiresAtUtc > @p1)))",
                session.MonitorSession_ID, nowUtc).Single();
            if (openEpisodes > 0)
                throw new InvalidOperationException("A pause request is already open for this monitoring session.");

            int pauseId = _db.Database.SqlQuery<int>(
                "INSERT INTO MonitoringPause " +
                "(MonitorSession_ID, Job_ID, Child_ID, RequestedByParent_ID, Status, RequestedAtUtc, IsDeleted) " +
                "VALUES (@p0, @p1, @p2, @p3, 'Requested', @p4, 0); " +
                "SELECT CAST(SCOPE_IDENTITY() AS INT);",
                session.MonitorSession_ID, jobId, childId, currentUserId, nowUtc).Single();

            WriteAudit(childId, "PauseRequested", currentUserId, currentRole,
                "{\"pauseId\":" + pauseId + ",\"jobId\":" + jobId + ",\"childId\":" + childId +
                ",\"sessionId\":" + session.MonitorSession_ID + "}");

            foreach (int guardianId in GuardianParentIds(childId))
            {
                if (guardianId != currentUserId)
                    NotifyGuardian(guardianId, currentUserId, "PauseRequested",
                        "A parent requested to pause monitoring for this child. Open Monitoring to approve or decline.");
            }

            return ReadPauseRow(pauseId, currentUserId);
        }

        /// <summary>
        /// Approves a Pending pause. Every rule is enforced here, server-side:
        /// the caller is an active guardian of THAT child, holds
        /// ChildGuardian.CanApprovePause = 1, is NOT the requester, and the
        /// job/session/child are still valid.
        ///
        /// The window is ALWAYS exactly 150 seconds from server UTC now. No
        /// request field can change it - a client asking for 30 seconds, 5
        /// minutes or a chosen instant has no such field to set.
        ///
        /// SIDE EFFECT (Phase 5/6 reuse, no second incident system): the
        /// session's active cry incident is cancelled through the existing
        /// cancellation path with reason ParentPauseApproved, which clears
        /// NextEscalationDueAt so the scheduler can never claim it again.
        /// Because dedupe only covers Open/Acknowledged, a cry after the pause
        /// starts a brand new T+0 incident.
        /// </summary>
        public MonitoringPauseDto ApprovePause(int pauseId, int currentUserId, string currentRole)
        {
            RequireParentRole(currentUserId, currentRole);

            var scope = ReadPauseRowForCaller(pauseId);
            if (scope == null)
                throw new KeyNotFoundException("Pause request not found.");

            // Cry creation and escalation delivery use the same per-scope gate.
            // Re-read and re-check the request only after entering it so the
            // approval plus incident cancellation is ordered against those paths.
            using (MonitoringScopeGate.Enter(scope.Job_ID, scope.Child_ID))
            {
                return ApprovePauseInScope(pauseId, currentUserId, currentRole);
            }
        }

        private MonitoringPauseDto ApprovePauseInScope(int pauseId, int currentUserId, string currentRole)
        {
            RequireParentRole(currentUserId, currentRole);

            var nowUtc = DateTime.UtcNow;
            var row = ReadPauseRowForCaller(pauseId);
            if (row == null)
                throw new KeyNotFoundException("Pause request not found.");
            if (!string.Equals(row.Status, PauseRequested, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("This pause request is no longer pending.");

            // Self-approval is impossible even for a capable guardian.
            if (row.RequestedByParent_ID == currentUserId)
                throw new UnauthorizedAccessException("You cannot approve your own pause request.");

            // The approver must be a live guardian of the SAME child holding the
            // pause capability, resolved through ChildGuardian only.
            var session = RequireParentForActiveMonitoring(row.Job_ID, row.Child_ID, currentUserId, currentRole);
            if (!HasPauseApprovalCapability(row.Child_ID, currentUserId))
                throw new UnauthorizedAccessException("You are not authorized to approve a monitoring pause.");

            int updated = _db.Database.ExecuteSqlCommand(
                "UPDATE MonitoringPause SET Status = 'Approved', DecidedAtUtc = @p0, DecidedByParent_ID = @p1, " +
                "       PauseStartUtc = @p0, PauseExpiresAtUtc = @p2 " +
                "WHERE MonitoringPause_ID = @p3 AND Status = 'Requested' AND IsDeleted = 0",
                nowUtc, currentUserId, nowUtc.AddSeconds(PauseDurationSeconds), pauseId);
            if (updated == 0)
                throw new InvalidOperationException("This pause request is no longer pending.");

            WriteAudit(row.Child_ID, "PauseApproved", currentUserId, currentRole,
                "{\"pauseId\":" + pauseId + ",\"sessionId\":" + session.MonitorSession_ID +
                ",\"durationSeconds\":" + PauseDurationSeconds + "}");

            // Stop the cry escalation through the EXISTING Phase 5/6 path.
            CryIncidentService.CancelIncidentsForSession(
                _db, session.MonitorSession_ID,
                CryIncidentService.CancelParentPauseApproved, currentUserId, currentRole);

            NotifyGuardian(row.RequestedByParent_ID, currentUserId, "PauseApproved",
                "Your pause request was approved. Monitoring is paused for 2 minutes 30 seconds.");

            return ReadPauseRow(pauseId, currentUserId);
        }

        /// <summary>
        /// Denies a Pending pause. Same approver rules as ApprovePause. A denial
        /// NEVER touches CryAlert - the incident keeps escalating exactly as it
        /// would have, because nothing was paused.
        /// </summary>
        public MonitoringPauseDto DenyPause(int pauseId, int currentUserId, string currentRole)
        {
            RequireParentRole(currentUserId, currentRole);

            var nowUtc = DateTime.UtcNow;
            var row = ReadPauseRowForCaller(pauseId);
            if (row == null)
                throw new KeyNotFoundException("Pause request not found.");
            if (!string.Equals(row.Status, PauseRequested, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("This pause request is no longer pending.");
            if (row.RequestedByParent_ID == currentUserId)
                throw new UnauthorizedAccessException("You cannot decide your own pause request.");

            var session = RequireParentForActiveMonitoring(row.Job_ID, row.Child_ID, currentUserId, currentRole);
            if (!HasPauseApprovalCapability(row.Child_ID, currentUserId))
                throw new UnauthorizedAccessException("You are not authorized to decide a monitoring pause.");

            int updated = _db.Database.ExecuteSqlCommand(
                "UPDATE MonitoringPause SET Status = 'Denied', DecidedAtUtc = @p0, DecidedByParent_ID = @p1, " +
                "       DecidedReason = @p2 " +
                "WHERE MonitoringPause_ID = @p3 AND Status = 'Requested' AND IsDeleted = 0",
                nowUtc, currentUserId, "Declined by the other guardian.", pauseId);
            if (updated == 0)
                throw new InvalidOperationException("This pause request is no longer pending.");

            WriteAudit(row.Child_ID, "PauseDenied", currentUserId, currentRole,
                "{\"pauseId\":" + pauseId + ",\"sessionId\":" + session.MonitorSession_ID + "}");

            NotifyGuardian(row.RequestedByParent_ID, currentUserId, "PauseDenied",
                "Your pause request was declined. Monitoring continues as normal.");

            return ReadPauseRow(pauseId, currentUserId);
        }

        /// <summary>
        /// The requester withdraws their OWN Pending request only. An already
        /// APPROVED pause is deliberately NOT cancellable this way: Phase 7
        /// defines no early-resume operation, and letting the requester shorten
        /// an approved window would let them decide their own pause outcome.
        /// </summary>
        public MonitoringPauseDto CancelPause(int pauseId, int currentUserId, string currentRole)
        {
            RequireParentRole(currentUserId, currentRole);

            var nowUtc = DateTime.UtcNow;
            var row = ReadPauseRowForCaller(pauseId);
            if (row == null)
                throw new KeyNotFoundException("Pause request not found.");
            if (row.RequestedByParent_ID != currentUserId)
                throw new UnauthorizedAccessException("You can only cancel your own pause request.");
            if (!string.Equals(row.Status, PauseRequested, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Only a pending pause request can be cancelled.");

            int updated = _db.Database.ExecuteSqlCommand(
                "UPDATE MonitoringPause SET Status = 'Cancelled', DecidedAtUtc = @p0, DecidedByParent_ID = @p1 " +
                "WHERE MonitoringPause_ID = @p2 AND Status = 'Requested' AND IsDeleted = 0",
                nowUtc, currentUserId, pauseId);
            if (updated == 0)
                throw new InvalidOperationException("Only a pending pause request can be cancelled.");

            WriteAudit(row.Child_ID, "PauseCancelled", currentUserId, currentRole,
                "{\"pauseId\":" + pauseId + ",\"sessionId\":" + row.MonitorSession_ID + "}");

            return ReadPauseRow(pauseId, currentUserId);
        }

        /// <summary>
        /// Current pause state, resolving Approved -> Expired lazily when the
        /// window has passed. No timer is involved: the truth is the persisted
        /// PauseExpiresAtUtc compared against server UTC on every read.
        /// </summary>
        public MonitoringPauseDto GetPause(int jobId, int childId, int currentUserId, string currentRole)
        {
            var session = RequireParentForActiveMonitoring(jobId, childId, currentUserId, currentRole);
            ResolvePauseExpiry(session.MonitorSession_ID, DateTime.UtcNow);

            int? latest = _db.Database.SqlQuery<int?>(
                "SELECT TOP (1) MonitoringPause_ID FROM MonitoringPause " +
                "WHERE MonitorSession_ID = @p0 AND IsDeleted = 0 ORDER BY MonitoringPause_ID DESC",
                session.MonitorSession_ID).SingleOrDefault();
            if (!latest.HasValue)
                return null;
            return ReadPauseRow(latest.Value, currentUserId);
        }

        // =================================================================
        // PARENT DND  (presentation only - never touches the incident)
        // =================================================================

        /// <summary>
        /// Enables the CALLER's own DND for a bounded, server-chosen window.
        ///
        /// MUTUAL EXCLUSION IS A DATABASE INVARIANT, NOT A UI RULE. The whole
        /// check-then-write runs inside one transaction that first takes an
        /// UPDATE lock on the MonitorSession row (UPDLOCK, HOLDLOCK). That row is
        /// the single deterministic serialization point for the monitoring
        /// context: if Mother and Father submit simultaneously, the loser BLOCKS
        /// on the lock, and once the winner commits the loser's re-read sees the
        /// freshly inserted active DND and is refused. Exactly one can win.
        ///
        /// DND IS PRESENTATION ONLY. It never modifies CryAlert, EscalationStage,
        /// NextEscalationDueAt or the scheduler, and it never suppresses the
        /// persisted Notification row. A parent with DND still receives and can
        /// still read their alert; the client simply does not ring for them.
        /// </summary>
        public MonitoringDndDto EnableDnd(int jobId, int childId, int currentUserId, string currentRole)
        {
            var session = RequireParentForActiveMonitoring(jobId, childId, currentUserId, currentRole);
            var nowUtc = DateTime.UtcNow;
            var dndUntilUtc = nowUtc.AddSeconds(DndDurationSeconds);

            var existingTransaction = _db.Database.CurrentTransaction;
            DbContextTransaction tx = null;
            try
            {
                if (existingTransaction == null)
                    tx = _db.Database.BeginTransaction();

                // ---- the serialization point ----
                int lockedSession = _db.Database.SqlQuery<int>(
                    "SELECT MonitorSession_ID FROM MonitorSession WITH (UPDLOCK, HOLDLOCK) " +
                    "WHERE MonitorSession_ID = @p0 AND IsDeleted = 0",
                    session.MonitorSession_ID).SingleOrDefault();
                if (lockedSession == 0)
                    throw new MonitoringAccessException(MonitoringDenial.SessionNotFound);

                // Re-check under the lock: another guardian already DND?
                int conflicting = _db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM MonitoringDnd WITH (UPDLOCK, HOLDLOCK) " +
                    "WHERE MonitorSession_ID = @p0 AND UserId <> @p1 AND IsDeleted = 0 " +
                    "AND DndUntilUtc > @p2 AND CancelledAtUtc IS NULL",
                    session.MonitorSession_ID, currentUserId, nowUtc).Single();
                if (conflicting > 0)
                {
                    // Audited denial: the other parent stays reachable for alerts.
                    WriteAudit(childId, "DndDenied", currentUserId, currentRole,
                        "{\"sessionId\":" + session.MonitorSession_ID + ",\"reason\":\"AnotherParentAlreadyDnd\"}");
                    throw new InvalidOperationException(
                        "Another guardian already has Do Not Disturb active for this monitoring session.");
                }

                // Re-enabling replaces our own previous window (idempotent).
                _db.Database.ExecuteSqlCommand(
                    "UPDATE MonitoringDnd SET CancelledAtUtc = @p0 " +
                    "WHERE MonitorSession_ID = @p1 AND UserId = @p2 AND IsDeleted = 0 AND CancelledAtUtc IS NULL",
                    nowUtc, session.MonitorSession_ID, currentUserId);

                int dndId = _db.Database.SqlQuery<int>(
                    "INSERT INTO MonitoringDnd " +
                    "(MonitorSession_ID, Job_ID, Child_ID, UserId, Role, DndUntilUtc, IsDeleted) " +
                    "VALUES (@p0, @p1, @p2, @p3, 'Parent', @p4, 0); " +
                    "SELECT CAST(SCOPE_IDENTITY() AS INT);",
                    session.MonitorSession_ID, jobId, childId, currentUserId, dndUntilUtc).Single();

                if (tx != null) tx.Commit();

                WriteAudit(childId, "DndEnabled", currentUserId, currentRole,
                    "{\"sessionId\":" + session.MonitorSession_ID + ",\"dndId\":" + dndId +
                    ",\"untilUtc\":\"" + dndUntilUtc.ToString("o") + "\"}");

                return ReadDndRow(dndId, currentUserId);
            }
            catch
            {
                if (tx != null)
                {
                    try { tx.Rollback(); }
                    catch (Exception rollbackEx) { Trace.TraceError("GuardianConnectionService: DND rollback failed: {0}", rollbackEx); }
                }
                throw;
            }
            finally
            {
                if (tx != null) tx.Dispose();
            }
        }

        /// <summary>
        /// Disables the CALLER's own DND. The owner is the token's user, so a
        /// client can never switch off somebody else's DND. The row is soft-
        /// cancelled (CancelledAtUtc) and kept, because the history matters.
        /// </summary>
        public MonitoringDndDto DisableDnd(int jobId, int childId, int currentUserId, string currentRole)
        {
            var session = RequireParentForActiveMonitoring(jobId, childId, currentUserId, currentRole);
            var nowUtc = DateTime.UtcNow;

            int affected = _db.Database.ExecuteSqlCommand(
                "UPDATE MonitoringDnd SET CancelledAtUtc = @p0 " +
                "WHERE MonitorSession_ID = @p1 AND UserId = @p2 AND IsDeleted = 0 AND CancelledAtUtc IS NULL",
                nowUtc, session.MonitorSession_ID, currentUserId);
            if (affected == 0)
                throw new InvalidOperationException("You do not have an active Do Not Disturb for this session.");

            WriteAudit(childId, "DndDisabled", currentUserId, currentRole,
                "{\"sessionId\":" + session.MonitorSession_ID + "}");

            int? latest = _db.Database.SqlQuery<int?>(
                "SELECT TOP (1) MonitoringDnd_ID FROM MonitoringDnd " +
                "WHERE MonitorSession_ID = @p0 AND UserId = @p1 AND IsDeleted = 0 " +
                "ORDER BY MonitoringDnd_ID DESC",
                session.MonitorSession_ID, currentUserId).Single();
            return latest.HasValue ? ReadDndRow(latest.Value, currentUserId) : null;
        }

        /// <summary>
        /// DND state of the session's guardians. Expired rows stay in the database
        /// as history but are reported IsActive=false, so no cleanup job is
        /// needed and nothing is ever deleted.
        /// </summary>
        public IEnumerable<MonitoringDndDto> GetDndStates(int jobId, int childId, int currentUserId, string currentRole)
        {
            var session = RequireParentForActiveMonitoring(jobId, childId, currentUserId, currentRole);
            var nowUtc = DateTime.UtcNow;

            var rows = _db.Database.SqlQuery<DndRow>(
                "SELECT d.MonitoringDnd_ID, d.MonitorSession_ID, d.UserId, d.Role, d.DndUntilUtc, " +
                "       d.CancelledAtUtc, p.FullName " +
                "FROM MonitoringDnd d " +
                "LEFT JOIN Parent p ON p.Parent_ID = d.UserId AND p.IsDeleted = 0 " +
                "WHERE d.MonitorSession_ID = @p0 AND d.IsDeleted = 0 " +
                "ORDER BY d.MonitoringDnd_ID DESC",
                session.MonitorSession_ID).ToList();

            var result = new List<MonitoringDndDto>();
            foreach (var r in rows)
            {
                result.Add(new MonitoringDndDto
                {
                    MonitoringDnd_ID = r.MonitoringDnd_ID,
                    MonitorSession_ID = r.MonitorSession_ID,
                    UserId = r.UserId,
                    FullName = r.FullName,
                    Role = r.Role,
                    DndUntilUtc = r.DndUntilUtc,
                    IsActive = r.CancelledAtUtc == null && r.DndUntilUtc > nowUtc,
                    IsCurrentUser = r.UserId == currentUserId
                });
            }
            return result;
        }

        // =================================================================
        // LIFECYCLE HOOK (called by MonitoringService / JobService)
        // =================================================================

        /// <summary>
        /// When a session ENDS or its job becomes terminal, Phase 7 state must
        /// not be able to resurrect monitoring later:
        ///   * a Requested pause becomes Cancelled, so it can NEVER be approved
        ///     once the sitting is over;
        ///   * an Approved pause stops being active immediately;
        ///   * DND is neutralised (the session itself is gone, so DND is moot).
        /// Idempotent and best-effort - a failure here must never undo the
        /// session end that the caller already performed.
        /// </summary>
        public void InvalidateForTerminalSession(int monitorSessionId, int actorUserId, string actorRole)
        {
            try
            {
                var nowUtc = DateTime.UtcNow;
                _db.Database.ExecuteSqlCommand(
                    "UPDATE MonitoringPause SET Status = 'Cancelled', DecidedAtUtc = @p0, DecidedByParent_ID = @p1 " +
                    "WHERE MonitorSession_ID = @p2 AND IsDeleted = 0 AND Status = 'Requested'",
                    nowUtc, actorUserId, monitorSessionId);
                _db.Database.ExecuteSqlCommand(
                    "UPDATE MonitoringPause SET Status = 'Expired', DecidedAtUtc = @p0, DecidedByParent_ID = @p1 " +
                    "WHERE MonitorSession_ID = @p2 AND IsDeleted = 0 AND Status = 'Approved'",
                    nowUtc, actorUserId, monitorSessionId);
                _db.Database.ExecuteSqlCommand(
                    "UPDATE MonitoringDnd SET CancelledAtUtc = @p0 " +
                    "WHERE MonitorSession_ID = @p1 AND IsDeleted = 0 AND CancelledAtUtc IS NULL",
                    nowUtc, monitorSessionId);
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "GuardianConnectionService: could not invalidate Phase 7 state for session {0}: {1}",
                    monitorSessionId, ex);
            }
        }

        // =================================================================
        // SHARED AUTHORIZATION / VALIDATION HELPERS
        // =================================================================

        /// <summary>
        /// Phase 7 is PARENT-ONLY for pause and DND: a sitter may neither
        /// request, approve, deny nor cancel a parent pause, nor touch parent
        /// DND. The sitter only READS the resulting paused state through the
        /// existing GET session endpoint.
        /// </summary>
        private static void RequireParentRole(int currentUserId, string currentRole)
        {
            if (currentUserId <= 0 ||
                !string.Equals(currentRole, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                throw new MonitoringAccessException(MonitoringDenial.InvalidRole);
            }
        }

        /// <summary>
        /// The full Phase 3 chain, plus the Active-session requirement: a pause
        /// or DND is meaningless without a live monitoring session, and using the
        /// SAME MonitoringAccess.Check keeps one authorization implementation for
        /// every monitoring entry point (Phase 3 rule - never duplicate it here).
        /// </summary>
        private SessionRow RequireParentForActiveMonitoring(int jobId, int childId, int currentUserId, string currentRole)
        {
            if (jobId <= 0 || childId <= 0)
                throw new ArgumentException("JobId and ChildId must be positive integers.");
            RequireParentRole(currentUserId, currentRole);

            // NOTE: SingleOrDefault, NOT Single. A job/child with no Active session
            // returns ZERO rows, and Single() would throw "Sequence contains no
            // elements" - turning a clean 404 denial into a 500. The null result
            // is what makes MonitoringAccess report the real denial below.
            int? sessionId = _db.Database.SqlQuery<int?>(
                "SELECT TOP (1) MonitorSession_ID FROM MonitorSession " +
                "WHERE Job_ID = @p0 AND Child_ID = @p1 AND Status = 'Active' AND IsDeleted = 0 " +
                "ORDER BY StartedAtUtc DESC, MonitorSession_ID DESC",
                jobId, childId).SingleOrDefault();

            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId, sessionId);
            if (denial != MonitoringDenial.Allowed)
                throw new MonitoringAccessException(denial);
            if (!sessionId.HasValue)
                throw new MonitoringAccessException(MonitoringDenial.SessionNotFound);

            return new SessionRow
            {
                MonitorSession_ID = sessionId.Value,
                Job_ID = jobId,
                Child_ID = childId
            };
        }

        /// <summary>Guardian check used by invitation creation (ChildGuardian only).</summary>
        private void RequireGuardian(int childId, int parentId)
        {
            int count = _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = @p0 AND Parent_ID = @p1 AND IsDeleted = 0",
                childId, parentId).Single();
            if (count == 0)
                throw new UnauthorizedAccessException("You are not a guardian of this child.");
        }

        /// <summary>
        /// Pause approval requires BOTH an active guardian row AND
        /// CanApprovePause = 1, resolved through ChildGuardian only. The flag is
        /// assigned server-side when the guardian is connected, and can never be
        /// set by a client.
        /// </summary>
        private bool HasPauseApprovalCapability(int childId, int parentId)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = @p0 AND Parent_ID = @p1 " +
                "AND CanApprovePause = 1 AND IsDeleted = 0", childId, parentId).Single() > 0;
        }

        /// <summary>Active guardian ids of a child - ChildGuardian is the only source.</summary>
        private List<int> GuardianParentIds(int childId)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT DISTINCT Parent_ID FROM ChildGuardian WHERE Child_ID = @p0 AND IsDeleted = 0",
                childId).ToList();
        }

        /// <summary>
        /// Lazily moves Approved -> Expired for a session whose window has passed.
        /// There is NO timer: the persisted PauseExpiresAtUtc compared against
        /// server UTC on every read is the single source of truth, so an AppPool
        /// recycle cannot keep a pause alive and a late poll still expires it.
        /// </summary>
        private void ResolvePauseExpiry(int monitorSessionId, DateTime nowUtc)
        {
            int expired = _db.Database.ExecuteSqlCommand(
                "UPDATE MonitoringPause SET Status = 'Expired' " +
                "WHERE MonitorSession_ID = @p0 AND IsDeleted = 0 AND Status = 'Approved' " +
                "AND PauseExpiresAtUtc IS NOT NULL AND PauseExpiresAtUtc <= @p1",
                monitorSessionId, nowUtc);
            if (expired > 0)
                WriteAudit(null, "PauseExpired", 0, "Server",
                    "{\"sessionId\":" + monitorSessionId + ",\"expiredCount\":" + expired + "}");
        }

        private void MarkInvitationExpired(int invitationId, DateTime nowUtc)
        {
            _db.Database.ExecuteSqlCommand(
                "UPDATE GuardianInvitation SET Status = 'Expired', DecidedAtUtc = @p0 " +
                "WHERE GuardianInvitation_ID = @p1 AND Status = 'Pending' AND IsDeleted = 0",
                nowUtc, invitationId);
        }

        private InvitationRow ReadInvitationRowForCaller(int invitationId)
        {
            return _db.Database.SqlQuery<InvitationRow>(
                "SELECT GuardianInvitation_ID, Child_ID, InvitedByParent_ID, InvitedParent_ID, IdentifierType, " +
                "       Status, CreatedAtUtc, ExpiresAtUtc, DecidedAtUtc, Relation " +
                "FROM GuardianInvitation WHERE GuardianInvitation_ID = @p0 AND IsDeleted = 0",
                invitationId).FirstOrDefault();
        }

        /// <summary>
        /// Reads an invitation for the transactional accept. When the caller
        /// opened its own transaction we take an UPDATE lock on the invitation
        /// row so two concurrent accepts cannot both insert a guardian.
        /// </summary>
        private InvitationRow ReadInvitationForUpdate(int invitationId, bool insideTransaction)
        {
            string sql =
                "SELECT GuardianInvitation_ID, Child_ID, InvitedByParent_ID, InvitedParent_ID, IdentifierType, " +
                "       Status, CreatedAtUtc, ExpiresAtUtc, DecidedAtUtc, Relation " +
                "FROM GuardianInvitation " +
                (insideTransaction ? "WITH (UPDLOCK, HOLDLOCK) " : string.Empty) +
                "WHERE GuardianInvitation_ID = @p0 AND IsDeleted = 0";
            return _db.Database.SqlQuery<InvitationRow>(sql, invitationId).FirstOrDefault();
        }

        private GuardianInvitationDto ReadInvitationRow(int invitationId, int viewerId)
        {
            var row = ReadInvitationRowForCaller(invitationId);
            return row == null ? null : MapInvitation(row, viewerId);
        }

        private GuardianInvitationDto MapInvitation(InvitationRow r, int viewerId = 0)
        {
            return new GuardianInvitationDto
            {
                GuardianInvitation_ID = r.GuardianInvitation_ID,
                Child_ID = r.Child_ID,
                ChildName = _db.Database.SqlQuery<string>(
                    "SELECT ChildName FROM Child WHERE Child_ID = @p0 AND IsDeleted = 0", r.Child_ID).FirstOrDefault(),
                InvitedByParent_ID = r.InvitedByParent_ID,
                InviterName = _db.Database.SqlQuery<string>(
                    "SELECT FullName FROM Parent WHERE Parent_ID = @p0", r.InvitedByParent_ID).FirstOrDefault(),
                IdentifierType = r.IdentifierType,
                Status = r.Status,
                Relation = r.Relation,
                CreatedAtUtc = r.CreatedAtUtc,
                ExpiresAtUtc = r.ExpiresAtUtc,
                DecidedAtUtc = r.DecidedAtUtc,
                IsExpired = string.Equals(r.Status, InvitationPending, StringComparison.OrdinalIgnoreCase)
                            && r.ExpiresAtUtc <= DateTime.UtcNow
            };
        }

        private PauseRow ReadPauseRowForCaller(int pauseId)
        {
            return _db.Database.SqlQuery<PauseRow>(
                "SELECT MonitoringPause_ID, MonitorSession_ID, Job_ID, Child_ID, RequestedByParent_ID, Status, " +
                "       RequestedAtUtc, DecidedAtUtc, DecidedByParent_ID, PauseStartUtc, PauseExpiresAtUtc, DecidedReason " +
                "FROM MonitoringPause WHERE MonitoringPause_ID = @p0 AND IsDeleted = 0",
                pauseId).FirstOrDefault();
        }

        private MonitoringPauseDto ReadPauseRow(int pauseId, int viewerId)
        {
            var r = ReadPauseRowForCaller(pauseId);
            if (r == null) return null;
            bool approved = string.Equals(r.Status, PauseApproved, StringComparison.OrdinalIgnoreCase);
            return new MonitoringPauseDto
            {
                MonitoringPause_ID = r.MonitoringPause_ID,
                MonitorSession_ID = r.MonitorSession_ID,
                Job_ID = r.Job_ID,
                Child_ID = r.Child_ID,
                RequestedByParent_ID = r.RequestedByParent_ID,
                RequestedByName = _db.Database.SqlQuery<string>(
                    "SELECT FullName FROM Parent WHERE Parent_ID = @p0", r.RequestedByParent_ID).FirstOrDefault(),
                Status = r.Status,
                RequestedAtUtc = r.RequestedAtUtc,
                DecidedAtUtc = r.DecidedAtUtc,
                DecidedByParent_ID = r.DecidedByParent_ID,
                DecidedByName = r.DecidedByParent_ID.HasValue
                    ? _db.Database.SqlQuery<string>(
                        "SELECT FullName FROM Parent WHERE Parent_ID = @p0", r.DecidedByParent_ID.Value).FirstOrDefault()
                    : null,
                PauseStartUtc = r.PauseStartUtc,
                PauseExpiresAtUtc = r.PauseExpiresAtUtc,
                DecidedReason = r.DecidedReason,
                IsActive = approved && r.PauseExpiresAtUtc.HasValue && r.PauseExpiresAtUtc.Value > DateTime.UtcNow,
                SecondsRemaining = (approved && r.PauseExpiresAtUtc.HasValue)
                    ? (int)Math.Max(0, Math.Round((r.PauseExpiresAtUtc.Value - DateTime.UtcNow).TotalSeconds))
                    : (int?)null
            };
        }

        private MonitoringDndDto ReadDndRow(int dndId, int viewerId)
        {
            var r = _db.Database.SqlQuery<DndRow>(
                "SELECT d.MonitoringDnd_ID, d.MonitorSession_ID, d.UserId, d.Role, d.DndUntilUtc, " +
                "       d.CancelledAtUtc, p.FullName " +
                "FROM MonitoringDnd d LEFT JOIN Parent p ON p.Parent_ID = d.UserId AND p.IsDeleted = 0 " +
                "WHERE d.MonitoringDnd_ID = @p0 AND d.IsDeleted = 0", dndId).FirstOrDefault();
            if (r == null) return null;
            return new MonitoringDndDto
            {
                MonitoringDnd_ID = r.MonitoringDnd_ID,
                MonitorSession_ID = r.MonitorSession_ID,
                UserId = r.UserId,
                FullName = r.FullName,
                Role = r.Role,
                DndUntilUtc = r.DndUntilUtc,
                IsActive = r.CancelledAtUtc == null && r.DndUntilUtc > DateTime.UtcNow,
                IsCurrentUser = r.UserId == viewerId
            };
        }

        // =================================================================
        // AUDIT / NOTIFICATION / TOKEN
        // =================================================================

        /// <summary>
        /// Appends one MonitorEvent row (the Phase 2 append-only audit table).
        /// The payload NEVER contains a bearer token, the invitation token or
        /// its hash, a password, a room name or personal data - only ids and
        /// the server's own numbers. Server-side transitions pass actor 0 /
        /// "Server", exactly like the Phase 5/6 sweeper does.
        /// </summary>
        private void WriteAudit(int? childId, string eventType, int actorUserId, string actorRole, string payloadJson)
        {
            _db.Database.ExecuteSqlCommand(
                "INSERT INTO MonitorEvent (Job_ID, Child_ID, IncidentId, EventType, ActorUserId, ActorRole, AtUtc, PayloadJson) " +
                "VALUES (NULL, @p0, NULL, @p1, @p2, @p3, @p4, @p5)",
                (object)childId ?? (object)DBNull.Value, eventType,
                actorUserId > 0 ? (object)actorUserId : (object)DBNull.Value,
                string.IsNullOrWhiteSpace(actorRole) ? "Server" : actorRole,
                DateTime.UtcNow, (object)payloadJson ?? (object)DBNull.Value);
        }

        /// <summary>
        /// Persisted notification for a guardian (the frontend polls the existing
        /// Notification table). DND NEVER suppresses this - a parent with DND
        /// still has the row waiting in their inbox; only the ringing/sound is
        /// suppressed client-side.
        /// </summary>
        private void NotifyGuardian(int userId, int actorUserId, string type, string message)
        {
            if (userId <= 0 || userId == actorUserId) return;
            _db.Database.ExecuteSqlCommand(
                "INSERT INTO Notification (UserID, UserRole, Message, IsRead, CreatedAt, Type, IsDeleted) " +
                "VALUES (@p0, 'Parent', @p1, 0, GETDATE(), @p2, 0)",
                userId, message, type);
        }

        /// <summary>
        /// Normalizes a submitted relation against the values the application
        /// ALREADY uses on Child.GuardianRelation ("Mother", "Father",
        /// "Guardian"). Anything unknown becomes "Guardian" (which may approve
        /// a pause but is not a new gender/account concept).
        /// </summary>
        private static string NormalizeRelation(string relation)
        {
            if (string.IsNullOrWhiteSpace(relation)) return "Guardian";
            string trimmed = relation.Trim();
            foreach (string known in PauseCapableRelations)
            {
                if (string.Equals(known, trimmed, StringComparison.OrdinalIgnoreCase))
                    return known;
            }
            return "Guardian";
        }

        /// <summary>
        /// Cryptographically random invitation token (32 bytes from the OS RNG,
        /// Base64url-encoded). It is hashed immediately and then discarded - it is
        /// never persisted, logged or audited, so the stored TokenHash cannot be
        /// reversed into a usable token.
        /// </summary>
        private static string GenerateToken()
        {
            var bytes = new byte[32];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }
            return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        private static string HashToken(string token)
        {
            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(token ?? string.Empty));
                var sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        public void Dispose()
        {
            if (_ownsContext) _db.Dispose();
        }

        // ---------------------------------------------------------------------
        // Raw-SQL projection types. These Phase 7 tables are intentionally NOT
        // mapped in the frozen Model1.edmx, so every read uses a private
        // projection class - the same pattern MonitorSession / CryAlert /
        // ChildGuardian already use in Phases 2-6.
        // ---------------------------------------------------------------------
        private class SessionRow
        {
            public int MonitorSession_ID { get; set; }
            public int Job_ID { get; set; }
            public int Child_ID { get; set; }
        }

        private class ChildRow
        {
            public int Child_ID { get; set; }
            public string ChildName { get; set; }
        }

        private class ParentRow
        {
            public int Parent_ID { get; set; }
            public string FullName { get; set; }
            public string Username { get; set; }
            public string EmailAddress { get; set; }
        }

        private class InvitationRow
        {
            public int GuardianInvitation_ID { get; set; }
            public int Child_ID { get; set; }
            public int InvitedByParent_ID { get; set; }
            public int InvitedParent_ID { get; set; }
            public string IdentifierType { get; set; }
            public string Status { get; set; }
            public DateTime CreatedAtUtc { get; set; }
            public DateTime ExpiresAtUtc { get; set; }
            public DateTime? DecidedAtUtc { get; set; }
            public string Relation { get; set; }
        }

        private class PauseRow
        {
            public int MonitoringPause_ID { get; set; }
            public int MonitorSession_ID { get; set; }
            public int Job_ID { get; set; }
            public int Child_ID { get; set; }
            public int RequestedByParent_ID { get; set; }
            public string Status { get; set; }
            public DateTime RequestedAtUtc { get; set; }
            public DateTime? DecidedAtUtc { get; set; }
            public int? DecidedByParent_ID { get; set; }
            public DateTime? PauseStartUtc { get; set; }
            public DateTime? PauseExpiresAtUtc { get; set; }
            public string DecidedReason { get; set; }
        }

        private class DndRow
        {
            public int MonitoringDnd_ID { get; set; }
            public int MonitorSession_ID { get; set; }
            public int UserId { get; set; }
            public string Role { get; set; }
            public DateTime DndUntilUtc { get; set; }
            public DateTime? CancelledAtUtc { get; set; }
            public string FullName { get; set; }
        }

        private class GuardianRow
        {
            public int Parent_ID { get; set; }
            public string FullName { get; set; }
            public string Relation { get; set; }
            public bool IsPrimary { get; set; }
            public bool CanApprovePause { get; set; }
        }
    }
}
