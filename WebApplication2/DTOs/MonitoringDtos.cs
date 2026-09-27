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
    /// </summary>
    public class MonitorSessionDto
    {
        public int MonitorSession_ID { get; set; }
        public int Job_ID { get; set; }
        public int Child_ID { get; set; }
        public string Status { get; set; }
        public DateTime StartedAtUtc { get; set; }
        public DateTime? EndedAtUtc { get; set; }
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
}