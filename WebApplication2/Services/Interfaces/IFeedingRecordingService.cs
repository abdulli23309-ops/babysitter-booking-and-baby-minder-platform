using System;
using System.Collections.Generic;
using System.IO;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    /// <summary>
    /// Phase 14 — "Feed Baby" 30-second recording metadata.
    ///
    /// WHAT THIS SERVICE IS (and is not)
    ///   It owns the REQUEST LIFECYCLE and the FILESYSTEM layout. It does NOT
    ///   record anything: capture happens on Phone 2 with MediaRecorder, because
    ///   Phone 2 is the device that physically owns the camera. It also does not
    ///   touch monitoring: a feeding video never creates a cry alert, never moves
    ///   MonitorSession, and never affects escalation (§26 of the feature brief).
    ///
    /// AUTHORIZATION
    ///   Every method that accepts a (jobId, childId) pair is expected to have
    ///   ALREADY passed MonitoringAccess.Check in the controller. The service
    ///   re-checks the job status itself where a new request is created, because
    ///   "is this job still running" is a business rule and must not depend on the
    ///   caller remembering to check.
    /// </summary>
    public interface IFeedingRecordingService : IDisposable
    {
        /// <summary>
        /// Creates a new recording request. Returns the created row, or null when
        /// one is already in flight for this Job+Child.
        ///
        /// The duplicate check is enforced by the
        /// UX_FeedingRecording_Active filtered unique index, so it holds even
        /// against two simultaneous requests. A SQL duplicate-key failure is
        /// translated into "null" rather than surfacing as a 500.
        /// </summary>
        FeedingVideoDto CreateRequest(int jobId, int childId, int requestedByUserId, string requestedByRole);

        /// <summary>
        /// The pending request for a child, claimed atomically for THIS device, or
        /// null when there is nothing to do. Claiming moves the row out of
        /// 'Requested' so a second poll cannot pick up the same work.
        /// </summary>
        PendingFeedingVideoDto ClaimPending(int childId);

        /// <summary>
        /// Moves a claimed request on to 'Uploading', so the sitter sees an
        /// accurate state instead of a request that appears to hang at
        /// 'Recording'.
        /// </summary>
        bool MarkUploading(Guid publicId, int childId);

        /// <summary>
        /// Finalises a recording: writes the file under the scope directory and
        /// marks the row Completed. Returns the stored path to the caller for
        /// immediate verification, never to the browser.
        /// </summary>
        FeedingVideoDto CompleteUpload(
            Guid publicId,
            int childId,
            Stream content,
            int durationSeconds,
            string declaredFileName);

        /// <summary>Marks a request Failed with a server-side reason.</summary>
        bool MarkFailed(Guid publicId, int childId, string reason);

        /// <summary>
        /// Completed recordings for one Job+Child, newest first. Callers MUST have
        /// passed MonitoringAccess.Check for that scope first.
        /// </summary>
        IList<FeedingVideoDto> GetHistory(int jobId, int childId);

        /// <summary>
        /// Resolves a completed recording to an absolute file path after
        /// re-authorizing the caller against the row's OWN Job+Child — never the
        /// scope the client supplied. Returns null when the row is missing, not
        /// completed, or the file is absent from disk.
        /// </summary>
        string ResolvePlayablePath(Guid publicId, int currentUserId, string currentRole, out string notFoundReason);
    }
}
