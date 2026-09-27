using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    /// <summary>
    /// MonitorSession lifecycle (Phase 3): one Active session PER CHILD of a job.
    /// All three methods run the centralized MonitoringAccess authorization chain
    /// before touching session state and write MonitorEvent audit entries.
    /// The authenticated caller is passed in explicitly (same pattern as
    /// ICryAlertService) so the service never depends on ambient principal state.
    /// </summary>
    public interface IMonitoringService
    {
        /// <summary>
        /// Starts (or idempotently returns) the Active session for job + child.
        /// Throws MonitoringAccessException when access is denied or ids are invalid.
        /// </summary>
        MonitorSessionDto StartSession(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>
        /// Returns the latest session for job + child (Active, or Ended so clients
        /// can display state after end), or null when no session row exists.
        /// Throws MonitoringAccessException when access is denied.
        /// </summary>
        MonitorSessionDto GetSession(int jobId, int childId, int currentUserId, string currentRole);

        /// <summary>
        /// Ends the Active session for job + child (Status='Ended', EndedAtUtc=UTC now).
        /// Throws MonitoringAccessException when access is denied or no Active session exists.
        /// </summary>
        MonitorSessionDto EndSession(int jobId, int childId, int currentUserId, string currentRole);
    }
}