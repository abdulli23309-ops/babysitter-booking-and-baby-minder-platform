using System;
using System.Collections.Generic;

namespace WebApplication2.DTOs
{
    /// <summary>
    /// Raw SQL projection for the guardian-aware scope query.
    ///
    /// WHY THIS IS A PUBLIC TOP-LEVEL TYPE
    /// EF6's <c>Database.SqlQuery&lt;T&gt;</c> materialises rows by building a
    /// compiled expression over T, which requires T to be publicly constructible.
    /// A private nested class compiles but fails at RUNTIME with a 500, which is
    /// exactly the kind of "builds fine, breaks in production" defect this audit
    /// is meant to catch. Keep this type public and top-level.
    /// </summary>
    public class AccessibleScopeRow
    {
        public int Job_ID { get; set; }
        public int Child_ID { get; set; }
        public string ChildName { get; set; }
        public string Status { get; set; }
        public int MonitorSession_ID { get; set; }
    }

    /// <summary>
    /// One (job, child) monitoring pair the caller may currently monitor.
    ///
    /// WHY THIS EXISTS (Phase 11, co-parent gap)
    /// Phase 9 proved that a co-parent guardian IS authorized by the backend, but
    /// could not reach the monitoring screen: the frontend discovered its scope
    /// from "jobs I own", which excludes a job owned by the other parent. The
    /// correct fix is a proper DISCOVERY endpoint - not a relaxation of any
    /// authorization check.
    ///
    /// This DTO is a discovery result, not a grant. Every actual monitoring action
    /// (start / heartbeat / cry / pause / media) still runs the full
    /// <c>MonitoringAccess</c> chain before anything happens. The endpoint
    /// therefore cannot be used to reach anything the caller could not already
    /// reach; it only tells the UI what to render.
    /// </summary>
    public class AccessibleMonitoringScopeDto
    {
        public int JobId { get; set; }
        public int ChildId { get; set; }
        public string ChildName { get; set; }
        public string JobStatus { get; set; }

        /// <summary>"Guardian" or "AssignedSitter" - how this caller is authorized.</summary>
        public string Via { get; set; }

        /// <summary>
        /// True when a monitoring session is already Active for this pair, so the
        /// UI can show "connected" without inventing it.
        /// </summary>
        public bool HasActiveSession { get; set; }
    }
}
