using System;
using System.Collections.Generic;
using System.Configuration;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;

namespace WebApplication2.Services.Implementations
{
    /// <summary>
    /// Phase 11 - server-side media session issuance for child monitoring.
    ///
    /// WHY THIS EXISTS
    /// The monitoring WORKFLOW (session, cry, escalation, pause, DND) was verified
    /// working at the end of Phase 10, but "live baby video" was not. The only
    /// media identifier in the system was MonitorSession.RoomName, a "pending-*"
    /// placeholder, and React could receive a room name through route state. A
    /// room name handed to the browser is a shared secret with no authorization
    /// behind it, so that is not a safe media design.
    ///
    /// SECURITY MODEL (do not weaken)
    ///   1. The caller must first pass the CENTRALIZED chain MonitoringAccess
    ///      (job InProgress, identity via assigned sitter OR ChildGuardian, child
    ///      in JobChildren). Media adds no authorization rules of its own.
    ///   2. Participant role and display name are derived from the authenticated
    ///      application role or validated independent-device credential.
    ///   3. Room IDs use the configured server-only HMAC salt and are never stored.
    ///   4. Fail CLOSED. Invalid or missing HTTPS configuration produces no room
    ///      or join path. There is no fallback media provider.
    /// </summary>
    public class MediaSessionService : IDisposable
    {
        private const string KeyEnabled = "MonitoringMediaEnabled";
        private const string KeyServerUrl = "MonitoringMediaServerUrl";
        private const string KeyRoomSalt = "MonitoringMediaRoomSalt";

        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public MediaSessionService()
            : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true) { }

        /// <summary>
        /// <paramref name="ownsContext"/> is false when a caller shares the
        /// context (the harnesses do this), so Dispose must not close it.
        /// </summary>
        public MediaSessionService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        /// <summary>Flat projection for SqlQuery (EF6 needs a public settable type).</summary>
        private class ActiveSessionRow
        {
            public int MonitorSession_ID { get; set; }
        }

        /// <summary>
        /// Issues (or refuses) a media session for one monitoring scope.
        ///
        /// The room is derived from the ALREADY EXISTING MonitorSession, so media
        /// shares the monitoring lifecycle. MonitoringAccess remains the
        /// authorization gate; a room identifier is not authorization.
        /// </summary>
        /// <param name="jobId">Job being monitored.</param>
        /// <param name="childId">Child within that job.</param>
        /// <param name="currentUserId">Authenticated user id (never from the body).</param>
        /// <param name="currentRole">Authenticated role (never from the body).</param>
        /// <exception cref="MonitoringAccessException">
        /// Thrown when the caller is not authorized. Callers map it to 403/404
        /// exactly like every other monitoring endpoint.
        /// </exception>
        public MonitoringMediaDto GetMediaSession(int jobId, int childId, int currentUserId, string currentRole)
        {
            if (jobId <= 0 || childId <= 0)
                throw new ArgumentException("jobId and childId must be positive integers.");

            // (1) CENTRALIZED authorization - media adds no rules of its own.
            var denial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId);
            if (denial != MonitoringDenial.Allowed)
                throw new MonitoringAccessException(denial);

            // (2) Anchor media to the existing ACTIVE monitoring session.
            var session = _db.Database.SqlQuery<ActiveSessionRow>(
                "SELECT TOP 1 MonitorSession_ID FROM MonitorSession " +
                "WHERE Job_ID = @p0 AND Child_ID = @p1 AND Status = 'Active' AND IsDeleted = 0 " +
                "ORDER BY MonitorSession_ID DESC", jobId, childId).FirstOrDefault();

            if (session == null)
                throw new KeyNotFoundException("No active monitoring session for this job and child.");

            // (3) Role derived server-side. The monitoring phone (a parent acting
            //     on the baby-side device) and the sitter are DIFFERENT people.
            //     The server DTO and MiroTalk initial media settings are derived from this
            //     authenticated role; the browser cannot request a different role.
            bool isParent = string.Equals(currentRole, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase);

            var dto = new MonitoringMediaDto
            {
                MonitorSessionId = session.MonitorSession_ID,
                Role = isParent ? "publisher" : "viewer",
                DisplayName = isParent ? "Parent" : "Babysitter",
                CanPublish = isParent,
                Configured = false
            };

            PopulateMiroTalkMedia(dto, ScopeJob, session.MonitorSession_ID);
            return dto;
        }

        /// <summary>Issues a parent-only viewer join path for the active independent session.</summary>
        public MonitoringMediaDto GetIndependentParentMedia(int parentId)
        {
            var session = _db.Database.SqlQuery<IndependentMediaRow>(
                @"SELECT TOP 1 s.IndependentMonitoringSession_ID SessionId,s.Parent_ID ParentId,s.Child_ID ChildId
                  FROM dbo.IndependentMonitoringSession s JOIN dbo.Child c ON c.Child_ID=s.Child_ID AND c.IsDeleted=0
                  WHERE s.Parent_ID=@p0 AND s.Status='Active' AND s.IsDeleted=0
                    AND EXISTS(SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=s.Child_ID AND g.Parent_ID=s.Parent_ID AND g.IsDeleted=0)
                  ORDER BY s.IndependentMonitoringSession_ID DESC", parentId).FirstOrDefault();
            if (session == null) throw new KeyNotFoundException("No authorized active independent monitoring session.");
            return BuildIndependentMedia(session, "Parent", canPublish: false);
        }

        /// <summary>Issues a publisher join path only after validating the dedicated device credential.</summary>
        public MonitoringMediaDto GetIndependentDeviceMedia(string credential)
        {
            if (string.IsNullOrWhiteSpace(credential) || credential.Length != 64)
                throw new MonitoringAccessException(MonitoringDenial.InvalidRole);
            string hash;
            using (var sha = SHA256.Create())
                hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(credential))).Replace("-", string.Empty).ToLowerInvariant();
            var session = _db.Database.SqlQuery<IndependentMediaRow>(
                @"SELECT TOP 1 s.IndependentMonitoringSession_ID SessionId,s.Parent_ID ParentId,s.Child_ID ChildId,
                    d.MonitoringDeviceSession_ID DeviceSessionId
                  FROM dbo.MonitoringDeviceSession d JOIN dbo.IndependentMonitoringSession s ON s.IndependentMonitoringSession_ID=d.IndependentMonitoringSession_ID
                  JOIN dbo.Child c ON c.Child_ID=s.Child_ID AND c.IsDeleted=0 JOIN dbo.Parent p ON p.Parent_ID=s.Parent_ID AND p.IsDeleted=0
                  WHERE d.CredentialHash=@p0 AND d.RevokedAtUtc IS NULL AND d.ExpiresAtUtc>GETUTCDATE() AND s.Status='Active' AND s.IsDeleted=0
                    AND EXISTS(SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=s.Child_ID AND g.Parent_ID=s.Parent_ID AND g.IsDeleted=0)",
                hash).FirstOrDefault();
            if (session == null) throw new MonitoringAccessException(MonitoringDenial.InvalidRole);
            return BuildIndependentMedia(session, "Monitor device", canPublish: true);
        }

        private static MonitoringMediaDto BuildIndependentMedia(IndependentMediaRow session, string displayName, bool canPublish)
        {
            var dto = new MonitoringMediaDto
            {
                MonitorSessionId = session.SessionId,
                Role = canPublish ? "publisher" : "viewer",
                DisplayName = displayName,
                CanPublish = canPublish,
                Configured = false
            };
            PopulateMiroTalkMedia(dto, ScopeIndependent, session.SessionId);
            return dto;
        }

        private sealed class IndependentMediaRow
        {
            public int SessionId { get; set; }
            public int ParentId { get; set; }
            public int ChildId { get; set; }
            public int DeviceSessionId { get; set; }
        }

        private static bool PopulateMiroTalkMedia(MonitoringMediaDto dto, string scope, int sessionId)
        {
            string serverUrl = GetConfiguredMiroTalkServerUrl();
            string salt = ConfigurationManager.AppSettings[KeyRoomSalt];
            bool enabled = string.Equals(ConfigurationManager.AppSettings[KeyEnabled], "true", StringComparison.OrdinalIgnoreCase);
            string roomId = enabled && serverUrl != null && !string.IsNullOrWhiteSpace(salt) && salt.Length >= 32
                ? DeriveRoomId(scope, sessionId, salt)
                : null;

            if (roomId == null)
            {
                dto.Configured = false;
                dto.ServerUrl = null;
                dto.RoomId = null;
                dto.JoinPath = null;
                dto.Reason = "Live video is not configured on this deployment.";
                return false;
            }

            dto.ServerUrl = serverUrl;
            dto.RoomId = roomId;
            dto.JoinPath = BuildJoinPath(roomId, dto.DisplayName, dto.CanPublish);
            dto.Configured = true;
            dto.Reason = null;
            return true;
        }

        private static string GetConfiguredMiroTalkServerUrl()
        {
            string value = NormalizeServerUrl(ConfigurationManager.AppSettings[KeyServerUrl]);
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) ||
                !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
                !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) ||
                !string.IsNullOrEmpty(uri.Fragment) || !string.Equals(uri.AbsolutePath, "/", StringComparison.Ordinal))
                return null;

            return uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
        }

        /// <summary>
        /// MiroTalk's direct join endpoint accepts the room and initial media
        /// preferences as query parameters. Only the server-derived room and
        /// display name are included; no provider API secret or salt is sent.
        /// </summary>
        private static string BuildJoinPath(string roomId, string displayName, bool canPublish)
        {
            string audio = canPublish ? "1" : "0";
            string video = canPublish ? "1" : "0";
            return "/join/?room=" + Uri.EscapeDataString(roomId) +
                "&roomPassword=0&name=" + Uri.EscapeDataString(displayName ?? string.Empty) +
                "&audio=" + audio + "&video=" + video +
                "&screen=0&hide=0&notify=0&chat=0&duration=unlimited";
        }
        // Room derivation helpers are shared by job-linked and independent
        // monitoring issuance. They have no database or client-side state.

        /// <summary>Room scope for a job-linked MonitorSession room.</summary>
        internal const string ScopeJob = "job";

        /// <summary>Room scope for an independent MonitoringSession room.</summary>
        internal const string ScopeIndependent = "independent";

        /// <summary>
        /// True only when the self-hosted MiroTalk SFU is fully configured:
        /// the master switch is on, a server URL is present, and a room salt
        /// is present. An incomplete configuration is NOT an error - media
        /// simply fails closed instead, so a missing setting can never produce a
        /// half-configured or guessable room.
        /// Never throws and never returns configuration values.
        /// </summary>
        internal static bool IsMiroTalkConfigured()
        {
            string salt = ConfigurationManager.AppSettings[KeyRoomSalt];
            return string.Equals(ConfigurationManager.AppSettings[KeyEnabled], "true", StringComparison.OrdinalIgnoreCase)
                && GetConfiguredMiroTalkServerUrl() != null
                && !string.IsNullOrWhiteSpace(salt) && salt.Length >= 32;
        }

        /// <summary>
        /// Normalizes the configured SFU address: trims whitespace and removes
        /// trailing slashes. HTTPS is enforced by GetConfiguredMiroTalkServerUrl.
        /// </summary>
        internal static string NormalizeServerUrl(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;
            return value.Trim().TrimEnd('/');
        }

        /// <summary>
        /// Derives the MiroTalk room identifier for a monitoring session.
        ///
        /// FORMAT  lc-{m|i}-{sessionId}-{hex8}
        ///   job-linked    -> lc-m-1042-3f9a1c07
        ///   independent   -> lc-i-1042-a83d17ef
        ///
        /// hex8 is the first 8 LOWERCASE hex characters of
        /// HMAC-SHA256(salt, "{scope}:{sessionId}").
        ///
        /// WHY HMAC: the session id alone would be enumerable, letting anyone
        /// guess another family's room. A keyed digest removes that without
        /// storing anything new in the database.
        ///
        /// DETERMINISM: this is a pure function of (scope, sessionId, salt).
        /// It uses no clock, no randomness, no GUID and no database, so both
        /// participants independently compute the SAME room for a session.
        /// The salt must therefore stay stable while a session is active.
        ///
        /// SECURITY: the salt is read here and used only as an HMAC key. It is
        /// never returned, never logged, never placed in a DTO or a URL, and
        /// the room id carries no personal information.
        ///
        /// Returns null when the salt is absent - the caller must then fail
        /// closed rather than fall back to a guessable room.
        /// </summary>
        internal static string DeriveRoomId(string scope, int sessionId, string salt)
        {
            if (string.IsNullOrWhiteSpace(scope) || string.IsNullOrWhiteSpace(salt)) return null;
            string prefix;
            if (string.Equals(scope, ScopeJob, StringComparison.Ordinal)) prefix = "lc-m-";
            else if (string.Equals(scope, ScopeIndependent, StringComparison.Ordinal)) prefix = "lc-i-";
            else return null;   // unknown scope: fail closed, never guess a prefix.

            string message = scope + ":" + sessionId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            byte[] key = Encoding.UTF8.GetBytes(salt);
            byte[] digest;
            using (var hmac = new HMACSHA256(key))
            {
                digest = hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
            }
            // Exactly 8 lowercase hex characters, taken from the digest itself
            // so the result is stable across runtimes (no culture formatting).
            var hex = new StringBuilder(8);
            for (int i = 0; i < 4; i++) hex.Append(digest[i].ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
            return prefix + sessionId.ToString(System.Globalization.CultureInfo.InvariantCulture) + "-" + hex.ToString();
        }

        /// <summary>
        /// Derives the room id using the configured server-side salt.
        /// </summary>
        internal static string DeriveRoomId(string scope, int sessionId)
        {
            return DeriveRoomId(scope, sessionId, ConfigurationManager.AppSettings[KeyRoomSalt]);
        }

        public void Dispose()
        {
            if (_ownsContext && _db != null) _db.Dispose();
        }
    }
}
