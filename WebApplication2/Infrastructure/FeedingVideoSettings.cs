using System;
using System.Configuration;
using System.Diagnostics;
using System.IO;

namespace WebApplication2.Infrastructure
{
    /// <summary>
    /// Phase 14 — configuration and SAFE PATH construction for feeding videos.
    ///
    /// WHY A CENTRAL CLASS (mirrors SessionSettings)
    ///   The storage root and the safety limits are business rules, read from
    ///   exactly one place so no service can invent a second value, and so
    ///   changing Web.config changes behaviour everywhere.
    ///
    /// WHY STORAGE IS OUTSIDE THE WEB ROOT
    ///   The storage root is "E:\feeding ababy video", kept outside the web
    ///   root deliberately: the folder is never served statically, so there is
    ///   no IIS path through which a file could be fetched without passing
    ///   FeedingRecordingService's authorization check. Only the API reads it.
    ///
    /// FAIL CLOSED
    ///   A missing or blank root disables the feature (returns null) and logs a
    ///   warning. It never falls back to a guess and never falls back to a path
    ///   inside the application. The same rule MediaSessionService applies to a
    ///   missing SFU URL.
    ///
    /// PATH SAFETY
    ///   BuildScopeDirectory accepts ONLY two positive integers and composes the
    ///   path itself. No caller supplies a path, filename or folder name, so a
    ///   traversal string has nowhere to enter the system.
    /// </summary>
    public static class FeedingVideoSettings
    {
        /// <summary>appSettings key holding the storage root (e.g. E:\feeding ababy video).</summary>
        public const string StorageRootKey = "FeedingVideoStorageRoot";

        /// <summary>appSettings key holding the maximum recording length, in seconds.</summary>
        public const string MaxDurationSecondsKey = "FeedingVideoMaxDurationSeconds";

        /// <summary>appSettings key holding the maximum accepted upload size, in bytes.</summary>
        public const string MaxFileSizeBytesKey = "FeedingVideoMaxFileSizeBytes";

        /// <summary>The feature's 30-second limit, per the Phase 14 requirement.</summary>
        public const int DefaultMaxDurationSeconds = 30;

        /// <summary>
        /// 12 MB. Generous headroom for a 30-second 360p WebM, and a real
        /// ceiling: a hostile client cannot stream an unbounded file into disk.
        /// </summary>
        public const long DefaultMaxFileSizeBytes = 12L * 1024L * 1024L;

        /// <summary>
        /// The one and only allowed container. The client negotiates a supported
        /// MediaRecorder type, but the SERVER decides what it keeps.
        /// </summary>
        public const string FileExtension = ".webm";

        /// <summary>Storage root, or null when unset (feature disabled).</summary>
        public static string GetStorageRoot()
        {
            string configured = ConfigurationManager.AppSettings[StorageRootKey];
            if (string.IsNullOrWhiteSpace(configured))
            {
                Trace.TraceWarning(
                    "FeedingVideoSettings: appSettings '{0}' is not configured. " +
                    "The Feed Baby feature is disabled until it is set.",
                    StorageRootKey);
                return null;
            }

            try
            {
                // Trim a trailing separator so Path.Combine never doubles it.
                return configured.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            }
            catch (Exception ex)
            {
                Trace.TraceError("FeedingVideoSettings: storage root could not be read: {0}", ex);
                return null;
            }
        }

        public static int GetMaxDurationSeconds()
        {
            int value;
            var configured = ConfigurationManager.AppSettings[MaxDurationSecondsKey];
            // Clamped to the 30-second ceiling: configuration may tighten the
            // limit but must never be able to raise it beyond the feature spec.
            if (int.TryParse(configured, out value) && value > 0 && value <= DefaultMaxDurationSeconds)
            {
                return value;
            }

            if (!string.IsNullOrWhiteSpace(configured))
            {
                Trace.TraceWarning(
                    "FeedingVideoSettings: '{0}' = '{1}' is invalid; using {2}.",
                    MaxDurationSecondsKey, configured, DefaultMaxDurationSeconds);
            }
            return DefaultMaxDurationSeconds;
        }

        public static long GetMaxFileSizeBytes()
        {
            long value;
            var configured = ConfigurationManager.AppSettings[MaxFileSizeBytesKey];
            if (long.TryParse(configured, out value) && value > 0)
            {
                return value;
            }

            if (!string.IsNullOrWhiteSpace(configured))
            {
                Trace.TraceWarning(
                    "FeedingVideoSettings: '{0}' = '{1}' is invalid; using {2}.",
                    MaxFileSizeBytesKey, configured, DefaultMaxFileSizeBytes);
            }
            return DefaultMaxFileSizeBytes;
        }
        /// <summary>
        /// The server-generated filename for a recording. Built from the GUID
        /// alone, so a filename can never contain a name, a job id or any other
        /// personal data. The client supplies only the GUID, and only to match an
        /// upload to its row.
        /// </summary>
        public static string BuildFileName(Guid publicId) => publicId.ToString("D") + FileExtension;

        /// <summary>
        /// Composes &lt;root&gt;\&lt;jobId&gt;\&lt;childId&gt; and VERIFIES the result is
        /// still inside the root. Returns null on any problem; callers must treat
        /// null as "storage unavailable" rather than substituting a default.
        /// </summary>
        public static string BuildScopeDirectory(int jobId, int childId)
        {
            string root = GetStorageRoot();
            if (root == null) return null;

            // The ONLY two values that shape the path, both positive integers the
            // server already authorized. There is no string input, so no
            // traversal string can ever reach Path.Combine.
            if (jobId <= 0 || childId <= 0) return null;

            try
            {
                string scope = Path.Combine(root, jobId.ToString(), childId.ToString());

                // Containment check. GetFullPath resolves any ".." before the
                // comparison, so an escaping path fails here even if the integer
                // composition above were ever changed.
                string fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)
                                  + Path.DirectorySeparatorChar;
                string fullScope = Path.GetFullPath(scope);

                if (!fullScope.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
                {
                    Trace.TraceError(
                        "FeedingVideoSettings: refusing a scope path outside the storage root. Job {0}, Child {1}.",
                        jobId, childId);
                    return null;
                }

                return fullScope;
            }
            catch (Exception ex)
            {
                Trace.TraceError("FeedingVideoSettings: could not build the scope path: {0}", ex);
                return null;
            }
        }

        /// <summary>
        /// Full path of one recording file. Takes the GUID, never a filename from
        /// a client, so a caller cannot ask for "../web.config" or an absolute
        /// path: Guid.TryParseExact simply fails and the method returns null.
        /// </summary>
        public static string ResolveFilePath(int jobId, int childId, Guid publicId)
        {
            string scope = BuildScopeDirectory(jobId, childId);
            if (scope == null) return null;

            try
            {
                return Path.Combine(scope, BuildFileName(publicId));
            }
            catch (Exception ex)
            {
                Trace.TraceError("FeedingVideoSettings: could not resolve a file path: {0}", ex);
                return null;
            }
        }
    }
}
