using System;

namespace WebApplication2.DTOs
{
    /// <summary>
    /// Phase 14 — "Feed Baby" request body.
    ///
    /// SCOPE ONLY, exactly like every other monitoring request in this project.
    /// There is deliberately no ParentId, BabysitterId, UserId or Role field:
    /// the caller is taken from the bearer token by ClaimsPrincipalHelper, and
    /// permission is decided by MonitoringAccess.Check. A body field the server
    /// would have to ignore is a field an attacker can set, so there are none.
    /// </summary>
    public class FeedingRecordingRequest
    {
        public int JobId { get; set; }
        public int ChildId { get; set; }
    }

    /// <summary>
    /// Phase 14 — one row of feeding-video history.
    ///
    /// SECURITY: this shape deliberately contains NO FileName and no filesystem
    /// path of any kind. Playback is exposed only as the relative
    /// <see cref="PlaybackUrl"/>, which the client appends to the API base and
    /// which the streaming endpoint re-authorizes. A client can never name a
    /// file, so a path-traversal payload has nothing to attach to.
    /// </summary>
    public class FeedingVideoDto
    {
        /// <summary>Public handle. A GUID; the only identifier the browser sees.</summary>
        public string Id { get; set; }

        public int JobId { get; set; }
        public int ChildId { get; set; }

        /// <summary>Requested | Recording | Uploading | Completed | Failed.</summary>
        public string Status { get; set; }

        /// <summary>When the sitter pressed Feed Baby (UTC).</summary>
        public DateTime RequestedAtUtc { get; set; }

        /// <summary>When the recording finished, or null if it never did.</summary>
        public DateTime? CompletedAtUtc { get; set; }

        /// <summary>Seconds recorded. Null until the device reports it.</summary>
        public int? DurationSeconds { get; set; }

        public long? FileSizeBytes { get; set; }

        /// <summary>True only when a file exists AND the row is Completed.</summary>
        public bool IsPlayable { get; set; }

        /// <summary>
        /// Relative API path, e.g.
        /// "/api/independent-monitoring/feeding/video/{guid}". Never absolute.
        /// </summary>
        public string PlaybackUrl { get; set; }
    }

    /// <summary>
    /// Phase 14 — Phone 2 reporting that it could not record.
    ///
    /// The <see cref="Reason"/> is TECHNICAL and is stored server-side only. It is
    /// never echoed back to a sitter or a parent: the API answers with friendly
    /// copy while this string lives in FeedingRecording.FailureReason and the
    /// server trace. That is what keeps "NotReadableError: camera in use" out of
    /// a parent's face while remaining available for diagnosis.
    /// </summary>
    public class FeedingFailureRequest
    {
        public string RecordingId { get; set; }
        public string Reason { get; set; }
    }

    /// <summary>
    /// Phase 14 — the answer to "does Phone 2 have work to do?".
    ///
    /// Deliberately minimal. Phone 2 already knows its own child from the
    /// credential, so this carries no child/job identifiers at all: a device can
    /// only ever learn about a request that was already resolved to its own
    /// child on the server. That removes a whole class of "device asks about
    /// someone else's child" bugs at the type level rather than by validation.
    /// </summary>
    public class PendingFeedingVideoDto
    {
        public string Id { get; set; }

        /// <summary>Server-generated target filename. The device must use this.</summary>
        public string FileName { get; set; }

        /// <summary>Hard cap in seconds. The server rejects anything longer.</summary>
        public int MaxDurationSeconds { get; set; }

        /// <summary>Server cap on upload size in bytes, for the client to check early.</summary>
        public long MaxFileSizeBytes { get; set; }

        public DateTime RequestedAtUtc { get; set; }
    }
}
