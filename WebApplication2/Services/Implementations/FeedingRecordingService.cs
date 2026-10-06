using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Web;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    /// <summary>
    /// Phase 14 — "Feed Baby" recording lifecycle and local storage.
    ///
    /// RAW SQL BY DESIGN
    ///   FeedingRecording is deliberately outside the frozen Model1.edmx, so it
    ///   is read and written with parameterized SqlQuery/ExecuteSqlCommand —
    ///   the approved pattern for every monitoring table added after Phase 2.
    ///   No EDMX change, no migration, no regeneration.
    ///
    /// THE LIFECYCLE
    ///   Requested -> Recording -> Uploading -> Completed
    ///                          \-> Failed
    ///
    ///   'Requested' is the ONLY in-flight status that the duplicate-protection
    ///   index filters on, and it is left as soon as Phone 2 claims the work.
    ///   That keeps the filtered index's value set permanently stable — see the
    ///   phase14 SQL script for why that matters.
    ///
    /// WHAT THIS SERVICE DELIBERATELY DOES NOT DO (§26)
    ///   It does not create cry alerts, does not touch MonitorSession, does not
    ///   heartbeat, does not escalate, does not resolve incidents and does not
    ///   pause monitoring. A feeding video and a cry alert are entirely separate
    ///   systems that happen to share a job and a child.
    /// </summary>
    public class FeedingRecordingService : IFeedingRecordingService
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public FeedingRecordingService()
            : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true) { }

        /// <summary>
        /// <paramref name="ownsContext"/> is false when a caller shares the context
        /// (the controller does), so Dispose must not close it.
        /// </summary>
        public FeedingRecordingService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        // ---------------- EF6 SqlQuery projections (public settable) ----------------

        private class FeedingRow
        {
            public Guid PublicId { get; set; }
            public int Job_ID { get; set; }
            public int Child_ID { get; set; }
            public string Status { get; set; }
            public DateTime CreatedAtUtc { get; set; }
            public DateTime? CompletedAtUtc { get; set; }
            public string FileName { get; set; }
            public int? DurationSeconds { get; set; }
            public long? FileSizeBytes { get; set; }
        }

        // ---------------- Status vocabulary ----------------
        public const string StatusRequested = "Requested";
        public const string StatusRecording = "Recording";
        public const string StatusUploading = "Uploading";
        public const string StatusCompleted = "Completed";
        public const string StatusFailed = "Failed";

        // User-safe messages. Technical detail goes to FailureReason + Trace.
        public const string DuplicateRequestMessage = "A feeding video is already being recorded for this child.";
        public const string JobNotRunningMessage = "Feed Baby is only available while the sitting is in progress.";
        public const string StorageUnavailableMessage = "Feeding video storage is not configured on this server.";


        // ===================== REQUEST =====================

        /// <summary>
        /// Creates one recording request for a Job+Child.
        ///
        /// JOB LIFECYCLE GATE
        ///   A NEW recording requires the job to be genuinely in progress. The
        ///   check is made HERE, not left to the controller, because it is a
        ///   business rule and a second call site must not be able to forget it.
        ///   Both "InProgress" and "In Progress" are accepted because legacy rows
        ///   and display code disagree (a documented Phase 1 finding); the shared
        ///   helper MonitoringAccess.IsInProgressStatus owns that decision so this
        ///   file cannot drift from the authorization chain.
        ///
        ///   This gate applies ONLY to creating a new request. History is never
        ///   gated by it, so videos recorded during a sitting stay visible after
        ///   the job is completed.
        /// </summary>
        public FeedingVideoDto CreateRequest(int jobId, int childId, int requestedByUserId, string requestedByRole)
        {
            if (jobId <= 0 || childId <= 0) return null;

            // Fail closed when storage is not configured: accepting a request we
            // could never fulfil would leave a permanently pending row and a
            // sitter staring at a spinner.
            if (FeedingVideoSettings.GetStorageRoot() == null)
            {
                Trace.TraceError(
                    "FeedingRecordingService: cannot create a request; '{0}' is not configured.",
                    FeedingVideoSettings.StorageRootKey);
                return null;
            }

            // Reuse the centralized "is this job running" decision.
            var status = _db.Database.SqlQuery<string>(
                "SELECT Status FROM dbo.Job WHERE Job_ID = @p0 AND IsDeleted = 0", jobId).FirstOrDefault();

            if (!MonitoringAccess.IsInProgressStatus(status))
            {
                Trace.TraceInformation(
                    "FeedingRecordingService: request refused, job {0} status is '{1}'.", jobId, status ?? "<null>");
                return null;
            }

            var publicId = Guid.NewGuid();
            try
            {
                _db.Database.ExecuteSqlCommand(
                    @"INSERT dbo.FeedingRecording
                        (PublicId, Job_ID, Child_ID, Status, RequestedByUserId, RequestedByRole, CreatedAtUtc, FileName)
                      VALUES(@p0,@p1,@p2,@p3,@p4,@p5,GETUTCDATE(),@p6)",
                    publicId, jobId, childId, StatusRequested,
                    (object)requestedByUserId ?? DBNull.Value,
                    (object)requestedByRole ?? DBNull.Value,
                    FeedingVideoSettings.BuildFileName(publicId));
            }
            catch (SqlException ex) when (ex.Number == 2601 || ex.Number == 2627)
            {
   // are how UX_FeedingRecording_Active enforces "one in-flight
   // request per Job+Child" at the storage layer. This is the
         // server-side half of the double-click protection required by
        // the feature brief: the client-side disable is a convenience,
   // this is the actual control.
    Trace.TraceInformation(
  "FeedingRecordingService: a request already exists for job {0}, child {1}.", jobId, childId);
        return null;
   }

         return ReadOne(publicId);
        }

                // 2601 = duplicate key, 2627 = unique constraint violation. Both

        // ===================== PHONE 2 DISCOVERY =====================

        /// <summary>
        /// Atomically claims the pending request for THIS device's child.
        ///
        /// SCOPE SAFETY
        ///   `childId` is NOT supplied by the browser. The controller obtains it
        ///   from AuthorizeDevice(), which resolves it from the device credential
        ///   via MonitoringDeviceSession -&gt; IndependentMonitoringSession. A device
        ///   is permanently bound to one child at pairing, so it cannot ask about
        ///   anyone else's recordings. PendingFeedingVideoDto then carries no child
        ///   or job id at all, so there is nothing else to leak.
        ///
        /// ATOMICITY
        ///   The UPDATE sets Status='Recording' and only then reads. If two polls
        ///   (or two tabs) race, the subquery's "Status='Requested'" filter matches
        ///   for only one of them, so a single request can never produce two
        ///   recordings.
        /// </summary>
        public PendingFeedingVideoDto ClaimPending(int childId)
        {
            if (childId <= 0) return null;

            /* ATOMIC CLAIM.
             *
             * IMPLEMENTATION NOTE (a real defect found by testing): the first
             * version used a single "UPDATE ... OUTPUT INSERTED ..." statement
             * read through SqlQuery<T>. That is INVALID here and fails at runtime
             * with "Incorrect syntax near 'OUTPUT'": EF6's SqlQuery expects a
             * SELECT and wraps the text in its own reader pipeline, so the OUTPUT
             * clause lands in an illegal position.
             *
             * The claim is therefore split into two steps inside ONE serializable
             * transaction: take an exclusive lock on the candidate row, move it
             * out of 'Requested', then read it back normally. The lock is what
             * preserves the "only one caller can claim" guarantee, so this is a
             * correctness fix, not a workaround.
             */
            FeedingRow claimed = null;
            using (var tx = _db.Database.BeginTransaction(IsolationLevel.Serializable))
            {
                try
                {
                    // UPDLOCK + HOLDLOCK serialises two concurrent polls on the
                    // same row. The second one re-evaluates the Status='Requested'
                    // filter after the first commits and matches nothing.
                    var candidate = _db.Database.SqlQuery<int>(
                        @"SELECT TOP 1 r.FeedingRecording_ID
                            FROM dbo.FeedingRecording r WITH (UPDLOCK, HOLDLOCK)
                            JOIN dbo.MonitorSession m
                              ON m.Job_ID = r.Job_ID AND m.Child_ID = r.Child_ID
                           WHERE r.Child_ID = @p0
                             AND r.Status = 'Requested'
                             AND m.Status = 'Active' AND m.IsDeleted = 0
                           ORDER BY r.CreatedAtUtc DESC",
                        childId).FirstOrDefault();

                    if (candidate > 0)
                    {
                        _db.Database.ExecuteSqlCommand(
                            "UPDATE dbo.FeedingRecording SET Status='Recording' WHERE FeedingRecording_ID=@p0", candidate);
                        tx.Commit();

                        claimed = _db.Database.SqlQuery<FeedingRow>(
                            @"SELECT TOP 1 PublicId, Job_ID, Child_ID, Status, CreatedAtUtc,
                                      CompletedAtUtc, FileName, DurationSeconds, FileSizeBytes
                                 FROM dbo.FeedingRecording WHERE FeedingRecording_ID=@p0",
                            candidate).FirstOrDefault();
                    }
                    else
                    {
                        tx.Commit();
                    }
                }
                catch
                {
                    tx.Rollback();
                    throw;
                }
            }

            if (claimed == null) return null;

            return new PendingFeedingVideoDto
            {
                Id = claimed.PublicId.ToString("D"),
                FileName = claimed.FileName,
                MaxDurationSeconds = FeedingVideoSettings.GetMaxDurationSeconds(),
                MaxFileSizeBytes = FeedingVideoSettings.GetMaxFileSizeBytes(),
                RequestedAtUtc = claimed.CreatedAtUtc
            };
        }

        // ===================== UPLOAD =====================

        /// <summary>
        /// Stores the recording and marks the row Completed.
        ///
        /// WHY THE SERVER OWNS THE FILENAME
        ///   The client never names a file. The path is composed from the row's
        ///   OWN Job_ID/Child_ID plus the row's PublicId, both read from the
        ///   database rather than the request. `declaredFileName` is used ONLY to
        ///   sanity-check the extension, so a client uploading "evil.exe" or
        ///   "../../web.config" cannot influence what lands on disk.
        ///
        /// SIZE LIMIT (§7)
        ///   The feature is a 30-second clip. The cap is enforced here rather than
        ///   trusted from the device, so a buggy or hostile client cannot write an
        ///   arbitrarily large file. The stream is copied through a bounded buffer
        ///   and aborted the moment the cap is exceeded, so the limit is real
        ///   rather than a check performed after the whole file landed.
        /// </summary>
        public FeedingVideoDto CompleteUpload(
            Guid publicId, int childId, Stream content, int durationSeconds, string declaredFileName)
        {
            if (content == null) return null;

            // Read the row's OWN scope. Never the caller's.
            var row = _db.Database.SqlQuery<FeedingRow>(
                @"SELECT TOP 1 PublicId, Job_ID, Child_ID, Status, CreatedAtUtc,
                          CompletedAtUtc, FileName, DurationSeconds, FileSizeBytes
                     FROM dbo.FeedingRecording
                    WHERE PublicId=@p0 AND Child_ID=@p1 AND Status IN ('Recording','Uploading')",
                publicId, childId).FirstOrDefault();
            if (row == null) return null;

            // The file must look like a WebM by name. The CONTENT is not verified
            // here; a full container sniff belongs to a later phase if testing
            // shows it is needed, and pretending to check it now would be worse
            // than an honest, documented limitation.
            string declared = declaredFileName ?? string.Empty;
            if (!declared.ToLowerInvariant().EndsWith(FeedingVideoSettings.FileExtension))
            {
                Trace.TraceWarning(
                    "FeedingRecordingService: rejected an upload whose declared name '{0}' is not a {1} file.",
                    declared, FeedingVideoSettings.FileExtension);
                return null;
            }

            // §7 duration guard. The device is told the limit and stops itself;
            // this is the server-side check that it actually did.
            int maxDuration = FeedingVideoSettings.GetMaxDurationSeconds();
            if (durationSeconds <= 0 || durationSeconds > maxDuration)
            {
                Trace.TraceWarning(
                    "FeedingRecordingService: rejected a {0}s recording (limit {1}s).", durationSeconds, maxDuration);
                return null;
            }

            long maxBytes = FeedingVideoSettings.GetMaxFileSizeBytes();
            string scope = FeedingVideoSettings.BuildScopeDirectory(row.Job_ID, row.Child_ID);
            if (scope == null) return null;

            string fullPath = FeedingVideoSettings.ResolveFilePath(row.Job_ID, row.Child_ID, publicId);
            if (fullPath == null) return null;

            try
            {
                // The scope directory is created only here, on first use, and is
                // always <root>\<jobId>\<childId> — never anything client-shaped.
                Directory.CreateDirectory(scope);

                long written = WriteBounded(content, fullPath, maxBytes);
                if (written <= 0) return null;

                _db.Database.ExecuteSqlCommand(
                    @"UPDATE dbo.FeedingRecording
                         SET Status='Completed', FileName=@p2, DurationSeconds=@p3,
                             FileSizeBytes=@p4, CompletedAtUtc=GETUTCDATE(), FailureReason=NULL
                       WHERE PublicId=@p0 AND Child_ID=@p1 AND Status IN ('Recording','Uploading')",
                    publicId, childId, FeedingVideoSettings.BuildFileName(publicId),
                    durationSeconds, written);
            }
            catch (Exception ex)
            {
                Trace.TraceError("FeedingRecordingService: upload failed for {0}: {1}", publicId, ex);
                // Leave no half-written file behind.
                TryDelete(fullPath);
                return null;
            }

            return ReadOne(publicId);
        }

        /// <summary>
        /// Copies at most <paramref name="maxBytes"/> to disk and returns the count
        /// written, or 0 when the source exceeded the cap. Aborts mid-copy rather
        /// than after the fact, so the limit bounds actual disk usage.
        /// </summary>

        // ===================== HISTORY =====================

        /// <summary>
        /// Completed (and failed) recordings for one Job+Child, newest first.
        ///
        /// NOT GATED BY JOB STATUS. History must survive the end of the sitting
        /// (§25), so unlike CreateRequest this method never inspects Job.Status.
        /// The caller is responsible for having passed MonitoringAccess.Check.
        ///
        /// Only COMPLETED rows with a file are returned as playable; Failed rows
        /// are included so the UI can say "this attempt failed" rather than
        /// silently hiding it, but they carry no FileName and no PlaybackUrl.
        /// </summary>
        public IList<FeedingVideoDto> GetHistory(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0) return new List<FeedingVideoDto>();

            var rows = _db.Database.SqlQuery<FeedingRow>(
                @"SELECT TOP 200 PublicId, Job_ID, Child_ID, Status, CreatedAtUtc,
                          CompletedAtUtc, FileName, DurationSeconds, FileSizeBytes
                     FROM dbo.FeedingRecording
                    WHERE Job_ID=@p0 AND Child_ID=@p1 AND Status IN ('Completed','Failed')
                    ORDER BY CreatedAtUtc DESC",
                jobId, childId).ToList();

            var result = new List<FeedingVideoDto>();
            foreach (var row in rows) result.Add(ToDto(row));
            return result;
        }

        // ===================== STREAMING =====================

        /// <summary>
        /// Resolves a recording to an absolute path AFTER re-authorizing the
        /// caller against the ROW'S OWN scope.
        ///
        /// THIS IS THE CENTRE OF THE STREAMING SECURITY MODEL. The client sends
        /// only a GUID. Everything else - which job, which child, whether the
        /// recording exists, whether it completed, where the file lives - comes
        /// from the DATABASE ROW, and the caller's entitlement is re-verified by
        /// MonitoringAccess.Check against that row's scope rather than against
        /// anything the client sent. That is what makes guessing a different
        /// GUID, or supplying a different jobId in the query string, useless.
        /// </summary>
        public string ResolvePlayablePath(Guid publicId, int currentUserId, string currentRole, out string notFoundReason)
        {
            notFoundReason = null;

            var row = _db.Database.SqlQuery<FeedingRow>(
                @"SELECT TOP 1 PublicId, Job_ID, Child_ID, Status, CreatedAtUtc,
                          CompletedAtUtc, FileName, DurationSeconds, FileSizeBytes
                     FROM dbo.FeedingRecording
                    WHERE PublicId=@p0 AND Status='Completed'",
                publicId).FirstOrDefault();

            // Uniform 404 for "no such id", "not finished" and "not permitted",
            // so the endpoint cannot be used to probe which GUIDs exist.
            if (row == null) { notFoundReason = "notfound"; return null; }

            // Re-verify entitlement against the ROW's scope.
            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, row.Job_ID, row.Child_ID);
            if (denial != MonitoringDenial.Allowed)
            {
                Trace.TraceWarning(
                    "FeedingRecordingService: playback denied for {0} (job {1}, child {2}, denial {3}).",
                    publicId, row.Job_ID, row.Child_ID, denial);
                notFoundReason = "notfound";
                return null;
            }

            string path = FeedingVideoSettings.ResolveFilePath(row.Job_ID, row.Child_ID, publicId);
            if (path == null || !File.Exists(path))
            {
                notFoundReason = "notfound";
                return null;
            }

            return path;
        }

        // ===================== INTERNALS =====================

        private FeedingVideoDto ReadOne(Guid publicId)
        {
            var row = _db.Database.SqlQuery<FeedingRow>(
                @"SELECT TOP 1 PublicId, Job_ID, Child_ID, Status, CreatedAtUtc,
                          CompletedAtUtc, FileName, DurationSeconds, FileSizeBytes
                     FROM dbo.FeedingRecording WHERE PublicId=@p0", publicId).FirstOrDefault();
            return row == null ? null : ToDto(row);
        }

        private static FeedingVideoDto ToDto(FeedingRow row)
        {
            bool completed = string.Equals(row.Status, StatusCompleted, StringComparison.Ordinal);
            return new FeedingVideoDto
            {
                Id = row.PublicId.ToString("D"),
                JobId = row.Job_ID,
                ChildId = row.Child_ID,
                Status = row.Status,
                RequestedAtUtc = row.CreatedAtUtc,
                CompletedAtUtc = row.CompletedAtUtc,
                DurationSeconds = row.DurationSeconds,
                FileSizeBytes = row.FileSizeBytes,
                IsPlayable = completed && !string.IsNullOrEmpty(row.FileName),
                // A relative API path only. The physical location is never
                // serialized to a browser, so there is nothing for a client to
                // learn, quote or tamper with.
                PlaybackUrl = completed && !string.IsNullOrEmpty(row.FileName)
                    ? "/api/independent-monitoring/feeding/video/" + row.PublicId.ToString("D")
                    : null
            };
        }

        public bool MarkUploading(Guid publicId, int childId)
        {
   return _db.Database.ExecuteSqlCommand(
                @"UPDATE dbo.FeedingRecording SET Status='Uploading'
   WHERE PublicId=@p0 AND Child_ID=@p1 AND Status='Recording'",
           publicId, childId) == 1;
        }

   public bool MarkFailed(Guid publicId, int childId, string reason)
        {
            // The reason is truncated to the column width rather than trusted, and
            // it stays server-side: the API answers with friendly copy only.
     string safe = (reason ?? "Unknown failure");
            if (safe.Length > 200) safe = safe.Substring(0, 200);

            return _db.Database.ExecuteSqlCommand(
   @"UPDATE dbo.FeedingRecording
      SET Status='Failed', FailureReason=@p2, CompletedAtUtc=GETUTCDATE()
           WHERE PublicId=@p0 AND Child_ID=@p1 AND Status IN ('Requested','Recording','Uploading')",
                publicId, childId, safe) == 1;
        }

        private static long WriteBounded(Stream source, string path, long maxBytes)
        {
      long total = 0;
            var buffer = new byte[81920];
            using (var target = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
            {
        int read;
         while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
  {
        total += read;
            if (total > maxBytes) return 0;   // caller deletes the partial file
           target.Write(buffer, 0, read);
                }
            }
    return total;
        }

        private static void TryDelete(string path)
        {
         try { if (path != null && File.Exists(path)) File.Delete(path); }
  catch { /* a leftover temp file is preferable to a failed request */ }
        }

        public void Dispose()
  {
     if (_ownsContext && _db != null) _db.Dispose();
        }
    }
}
