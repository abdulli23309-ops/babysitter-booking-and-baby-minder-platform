using System;
using System.Linq;
using WebApplication2.Enums;
using WebApplication2.Models;

namespace WebApplication2.Infrastructure
{
    /// <summary>
    /// Reason a monitoring access check was refused.
    /// Phase 3: every denial corresponds to exactly one HTTP mapping in
    /// MonitoringController (NotFound for *NotFound values, 403 otherwise).
    /// </summary>
    public enum MonitoringDenial
    {
        Allowed = 0,
        InvalidRole,        // 403 - caller role is not Parent/Sitter (or no user id)
        JobNotFound,        // 404 - Job_ID does not exist (or soft-deleted)
        JobNotInProgress,   // 403 - job exists but is not genuinely in progress
        ChildNotFound,      // 404 - Child_ID does not exist (or soft-deleted)
        ChildNotInJob,      // 403 - child exists but is not in JobChildren for this job
        NotAssignedSitter,  // 403 - Sitter is not Job.AssignedSitter_ID
        NotGuardian,        // 403 - Parent has no ChildGuardian row for this child
        SessionNotFound,    // 404 - MonitorSession does not exist (or is not Active on End)
        SessionMismatch,    // 403 - MonitorSession belongs to a different job/child
        IncidentNotFound    // 404 - no ACTIVE cry incident (Open/Acknowledged) exists for this job+child
    }

    /// <summary>
    /// Thrown by MonitoringService when MonitoringAccess.Check returns a denial.
    /// Carries the structured <see cref="Denial"/> so the controller can map it
    /// to an HTTP status without parsing message text. The message itself is a
    /// fixed, user-safe string (no SQL, table names or exception details).
    /// </summary>
    public class MonitoringAccessException : Exception
    {
        public MonitoringDenial Denial { get; }

        public MonitoringAccessException(MonitoringDenial denial)
            : base(GetDefaultMessage(denial))
        {
            Denial = denial;
        }

        private static string GetDefaultMessage(MonitoringDenial denial)
        {
            switch (denial)
            {
                case MonitoringDenial.InvalidRole:
                    return "Your account role cannot perform monitoring actions.";
                case MonitoringDenial.JobNotFound:
                    return "The requested job does not exist.";
                case MonitoringDenial.JobNotInProgress:
                    return "Monitoring can only be used while the job is in progress.";
                case MonitoringDenial.ChildNotFound:
                    return "The requested child does not exist.";
                case MonitoringDenial.ChildNotInJob:
                    return "This child is not part of the selected job.";
                case MonitoringDenial.NotAssignedSitter:
                    return "Only the sitter assigned to this job can monitor it.";
                case MonitoringDenial.NotGuardian:
                    return "You are not an authorized guardian for this child.";
                case MonitoringDenial.SessionNotFound:
                    return "No active monitoring session was found for this job and child.";
                case MonitoringDenial.SessionMismatch:
                    return "The monitoring session does not belong to this job and child.";
                case MonitoringDenial.IncidentNotFound:
                    return "No active cry incident was found for this job and child.";
                default:
                    return "Access to the monitoring session was denied.";
            }
        }
    }

    /// <summary>
    /// Tiny projection used only by MonitoringAccess to read a MonitorSession's
    /// job/child keys. Public with settable properties because EF6 SqlQuery&lt;T&gt;
    /// materializes through reflection (property names match the SQL columns).
    /// </summary>
    public class MonitorSessionKey
    {
        public int Job_ID { get; set; }
        public int Child_ID { get; set; }
    }

    /// <summary>
    /// CENTRALIZED monitoring authorization (Phase 3).
    /// Every monitoring endpoint must call <see cref="Check"/> before reading or
    /// writing MonitorSession state - controllers and services must never
    /// re-implement any part of this chain.
    ///
    /// All access rules live here, in one place, as one ordered decision:
    ///   1. Caller must be an authenticated Parent or Sitter (InvalidRole).
    ///   2. Job must exist (JobNotFound, 404).
    ///   3. Job must be genuinely in progress (JobNotInProgress). BOTH legacy
    ///      status spellings "InProgress" and "In Progress" are accepted
    ///      (Phase 1 finding; data is NOT migrated this phase). A NULL status
    ///      is NOT in progress.
    ///   4. Identity, BEFORE any child detail, so unauthorized callers cannot
    ///      probe children: Sitter must be the job's AssignedSitter_ID
    ///      (NotAssignedSitter); Parent must have a ChildGuardian row for the
    ///      requested child (NotGuardian - this also covers non-existent child
    ///      ids, which then never leak existence to unauthorized parents).
    ///   5. Child must exist (ChildNotFound) - only reached by an authorized
    ///      identity, so the 404 is safe to reveal.
    ///   6. Child must belong to the job via JobChildren (ChildNotInJob).
    ///      JobChildren is intentionally NOT in the EDMX, so this is raw SQL.
    ///   7. If a MonitorSession id was supplied it must exist (SessionNotFound)
    ///      and belong to the same job + child (SessionMismatch). Defense in
    ///      depth for future endpoints that accept a session id directly.
    ///
    /// The method is a PURE DECISION FUNCTION: it only reads, never writes and
    /// never throws MonitoringAccessException. The calling service converts a
    /// denial into an exception and records the SessionAccessDenied audit event.
    /// That keeps this class trivially unit-testable and keeps audit policy with
    /// the lifecycle code that owns MonitorEvent.
    ///
    /// MonitorSession, MonitorEvent, ChildGuardian and JobChildren are not in
    /// Model1.edmx (Phase 2 froze the EDMX), so every query here is parameterized
    /// raw SQL via DbContext.Database.SqlQuery - the approved approach.
    /// </summary>
    public static class MonitoringAccess
    {
        /// <summary>
        /// Runs the full monitoring authorization chain for the given
        /// job + child (+ optional session) on the caller's behalf.
        /// Returns <see cref="MonitoringDenial.Allowed"/> only when every rule passes.
        /// </summary>
        public static MonitoringDenial Check(
            BabySitterBooking_and_BabyMinderEntities db,
            int currentUserId,
            string currentRole,
            int jobId,
            int childId,
            int? monitorSessionId = null)
        {
            if (db == null)
                throw new ArgumentNullException(nameof(db));

            // Rule 1: role - session tokens only ever carry Parent/Sitter, but the
            // check is repeated here so this method is safe standalone (defense in depth).
            bool isParent = string.Equals(currentRole, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase);
            bool isSitter = string.Equals(currentRole, UserRole.Sitter.ToDisplayString(), StringComparison.OrdinalIgnoreCase);
            if (currentUserId <= 0 || (!isParent && !isSitter))
                return MonitoringDenial.InvalidRole;

            // Rule 2: job exists (soft-deleted jobs are invisible to monitoring).
            int jobCount = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM Job WHERE Job_ID = @p0 AND IsDeleted = 0",
                jobId).Single();
            if (jobCount == 0)
                return MonitoringDenial.JobNotFound;

            // Rule 3: job is genuinely in progress (both spellings, see summary).
            string status = db.Database.SqlQuery<string>(
                "SELECT Status FROM Job WHERE Job_ID = @p0 AND IsDeleted = 0",
                jobId).FirstOrDefault();
            if (!IsInProgressStatus(status))
                return MonitoringDenial.JobNotInProgress;

            // Rule 4: identity before any child-specific detail (see summary).
            if (isSitter)
            {
                int assignedCount = db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM Job WHERE Job_ID = @p0 AND AssignedSitter_ID = @p1 AND IsDeleted = 0",
                    jobId, currentUserId).Single();
                if (assignedCount == 0)
                    return MonitoringDenial.NotAssignedSitter;
            }
            else
            {
                int guardianCount = db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = @p0 AND Parent_ID = @p1 AND IsDeleted = 0",
                    childId, currentUserId).Single();
                if (guardianCount == 0)
                    return MonitoringDenial.NotGuardian;
            }

            // Rule 5: child exists (only reachable by an authorized identity).
            int childCount = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM Child WHERE Child_ID = @p0 AND IsDeleted = 0",
                childId).Single();
            if (childCount == 0)
                return MonitoringDenial.ChildNotFound;

            // Rule 6: membership of the child in the job - raw SQL because
            // JobChildren is intentionally absent from Model1.edmx.
            int membershipCount = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM JobChildren WHERE Job_ID = @p0 AND Child_ID = @p1 AND IsDeleted = 0",
                jobId, childId).Single();
            if (membershipCount == 0)
                return MonitoringDenial.ChildNotInJob;

            // Rule 7: optional session must exist and belong to this job + child.
            if (monitorSessionId.HasValue)
            {
                var sessionKey = db.Database.SqlQuery<MonitorSessionKey>(
                    "SELECT Job_ID, Child_ID FROM MonitorSession WHERE MonitorSession_ID = @p0 AND IsDeleted = 0",
                    monitorSessionId.Value).FirstOrDefault();
                if (sessionKey == null)
                    return MonitoringDenial.SessionNotFound;
                if (sessionKey.Job_ID != jobId || sessionKey.Child_ID != childId)
                    return MonitoringDenial.SessionMismatch;
            }

            return MonitoringDenial.Allowed;
        }

        /// <summary>
        /// Status normalization for "job is actively in progress".
        /// Accepts BOTH real-world spellings found in this database
        /// ("InProgress" legacy rows and "In Progress" display code), trimmed
        /// and case-insensitive. NULL / empty / any other status = false.
        /// </summary>
        public static bool IsInProgressStatus(string status)
        {
            if (string.IsNullOrWhiteSpace(status))
                return false;

            string normalized = status.Trim();
            return string.Equals(normalized, "InProgress", StringComparison.OrdinalIgnoreCase)
                || string.Equals(normalized, "In Progress", StringComparison.OrdinalIgnoreCase);
        }
    }
}

