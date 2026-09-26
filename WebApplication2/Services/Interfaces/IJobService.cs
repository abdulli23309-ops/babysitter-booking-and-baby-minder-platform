using System.Collections.Generic;
using System.Threading.Tasks;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IJobService
    {
        CreateJobResult CreateJobForSitter(CreateJobDto dto);
        ParentJobItemDto GetJobById(int jobId);
        IEnumerable<ParentJobItemDto> GetParentJobs(int parentId);
        IEnumerable<OpenJobListItemDto> GetOpenJobs(string city = null);
        JobDetailsResultDto GetJobDetails(int jobId);
        int ConfirmJobsBulk(int sitterId, List<int> jobIds);
        void ConfirmJob(int jobId, int sitterId);
        JobStatusUpdateResultDto UpdateJobStatus(int jobId, string requestedStatus, string currentRole, int currentUserId);
        IEnumerable<SitterAssignedJobDto> GetSitterJobs(int sitterId);
        ActiveJobResultDto GetActiveJob(string currentRole, int currentUserId, int? requestedBabysitterId);
        (string Message, int Count) TerminateSeries(int jobId, string scope, string currentRole, int currentUserId);

        /// <summary>
        /// Phase 8D — sitter declines a single assigned day of a series.
        /// Requires: Sitter role, that sitter is the assigned one, the day is
        /// still Assigned/Confirmed, and at least 3 hours of notice remain.
        /// Capped at 3 declines per series per sitter. Releases the day back to
        /// Open and notifies both parties.
        /// </summary>
        Task<(bool Success, string Message)> DeclineDayAsync(
            int jobId, int sitterId, string currentRole);

        /// <summary>
        /// Phase 8D — every day of a series, for the pagination sibling list.
        /// Returns null when the caller is not a participant in the series
        /// (neither the owning parent nor an assigned/invited sitter), so the
        /// controller can return 403 rather than leak arbitrary series.
        /// </summary>
        IEnumerable<SeriesSiblingDto> GetSeriesJobs(int seriesId, int currentUserId, string currentRole);
    }
}
