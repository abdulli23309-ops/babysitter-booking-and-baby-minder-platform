using System;
using System.Collections.Generic;
using System.Linq;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;

namespace WebApplication2.Services.Implementations
{
    /// <summary>
    /// Phase 11 - guardian-aware DISCOVERY of monitorable (job, child) pairs.
    ///
    /// PROBLEM SOLVED
    /// Phase 9/10 recorded (D4/G5): a co-parent guardian is fully authorized by
    /// MonitoringAccess, but the UI could not find the job because it only listed
    /// jobs the caller OWNS. The fix must not weaken the B5 IDOR rule on
    /// "you may only list your own jobs", and must not touch MonitoringAccess.
    ///
    /// DESIGN
    /// This is a separate, purpose-built read that asks a different question:
    /// "which (job, child) pairs may THIS user monitor right now?" It resolves
    /// parents through ChildGuardian (never Child.Parent_ID) and sitters through
    /// Job.AssignedSitter_ID, i.e. exactly the two identities MonitoringAccess
    /// accepts. It is DISCOVERY ONLY: starting a session, sending a heartbeat,
    /// reporting a cry, pausing or requesting media all still call
    /// MonitoringAccess.Check, so this endpoint can never be used to reach data
    /// the caller could not already reach.
    ///
    /// Only jobs whose status is genuinely in progress are returned, reusing
    /// MonitoringAccess.IsInProgressStatus so the legacy "In Progress" spelling is
    /// accepted WITHOUT introducing a third variant.
    /// </summary>
    public class AccessibleScopeService : IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public AccessibleScopeService()
            : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true) { }

        public AccessibleScopeService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        /// <summary>
        /// Returns every in-progress (job, child) pair the caller may monitor.
        /// </summary>
        /// <param name="currentUserId">Authenticated user id (never from the body).</param>
        /// <param name="currentRole">Authenticated role (never from the body).</param>
        public IEnumerable<AccessibleMonitoringScopeDto> GetAccessibleScopes(int currentUserId, string currentRole)
        {
            if (currentUserId <= 0)
                throw new ArgumentException("An authenticated user id is required.");

            bool isParent = string.Equals(currentRole, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase);
            bool isSitter = string.Equals(currentRole, UserRole.Sitter.ToDisplayString(), StringComparison.OrdinalIgnoreCase);

            if (!isParent && !isSitter)
                return new List<AccessibleMonitoringScopeDto>();

            // Authority is expressed with the SAME two rules MonitoringAccess uses:
            //   parent -> ChildGuardian (never Child.Parent_ID)
            //   sitter -> Job.AssignedSitter_ID
            // MonitoringPause, MonitoringDnd, MonitorSession and JobChildren are
            // intentionally absent from Model1.edmx, so this is parameterized raw
            // SQL - the same approved approach used by the monitoring services.
            const string sql = @"
SELECT DISTINCT j.Job_ID, jc.Child_ID, c.ChildName, j.Status,
       ISNULL(ms.MonitorSession_ID, 0) AS MonitorSession_ID
FROM Job j
JOIN JobChildren jc ON jc.Job_ID = j.Job_ID AND jc.IsDeleted = 0
JOIN Child c        ON c.Child_ID = jc.Child_ID  AND c.IsDeleted = 0
LEFT JOIN MonitorSession ms
       ON ms.Job_ID = j.Job_ID AND ms.Child_ID = jc.Child_ID
      AND ms.Status = 'Active' AND ms.IsDeleted = 0
WHERE j.IsDeleted = 0
  AND LOWER(REPLACE(REPLACE(REPLACE(ISNULL(j.Status,''),' ',''),'-',''),'_','')) = 'inprogress'
  AND (
        (@p1 = 1 AND EXISTS (SELECT 1 FROM ChildGuardian cg
                            WHERE cg.Child_ID = jc.Child_ID AND cg.Parent_ID = @p0 AND cg.IsDeleted = 0))
     OR (@p1 = 0 AND j.AssignedSitter_ID = @p0)
      )";

            // NOTE: ISNULL(ms.MonitorSession_ID, 0) in the SQL is REQUIRED, not
            // cosmetic. The LEFT JOIN yields NULL for a job that has no active
            // session yet, and mapping DBNull onto the non-nullable `int` makes
            // EF6 throw during materialisation - a 500 that only appears once a
            // second job without a live session exists, which is why the very
            // first runtime check of this endpoint is what caught it.
            var rows = _db.Database.SqlQuery<AccessibleScopeRow>(sql, currentUserId, isParent ? 1 : 0);
            return rows.Select(r => new AccessibleMonitoringScopeDto
            {
                JobId = r.Job_ID,
                ChildId = r.Child_ID,
                ChildName = r.ChildName,
                JobStatus = r.Status,
                Via = isParent ? "Guardian" : "AssignedSitter",
                HasActiveSession = r.MonitorSession_ID > 0
            })
            // Most useful first: a live session, then the newest job.
            .OrderByDescending(s => s.HasActiveSession)
            .ThenByDescending(s => s.JobId)
            .ToList();
        }

        /// <summary>
        /// NOTE: the SQL projection is <see cref="AccessibleScopeRow"/> in the
        /// DTO namespace, not a nested type, because EF6's SqlQuery needs a
        /// publicly constructible type. See that class for the full explanation.
        /// </summary>
        public void Dispose()
        {
            if (_ownsContext && _db != null) _db.Dispose();
        }
    }
}
