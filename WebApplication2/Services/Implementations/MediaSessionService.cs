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
            if (childId <= 0)
                throw new ArgumentException("childId must be a positive integer.");

            bool isParent = string.Equals(currentRole, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase);
            if (jobId > 0)
            {
                // Prefer the job scope whenever it is authorized and has an
                // active MonitorSession. This keeps the sitter and parent in
                // the existing canonical (job, child) room.
                var jobDenial = MonitoringAccess.Check(_db, currentUserId, currentRole, jobId, childId);
                if (jobDenial == MonitoringDenial.Allowed)
                {
                    var session = _db.Database.SqlQuery<ActiveSessionRow>(
                        "SELECT TOP 1 MonitorSession_ID FROM MonitorSession " +
                        "WHERE Job_ID = @p0 AND Child_ID = @p1 AND Status = 'Active' AND IsDeleted = 0 " +
                        "ORDER BY MonitorSession_ID DESC", jobId, childId).FirstOrDefault();

                    if (session != null)
                    {
                        var jobMedia = CreateMediaDto(session.MonitorSession_ID, isParent);
                        PopulateMiroTalkMedia(jobMedia, ScopeCanonical, session.MonitorSession_ID, jobId, childId);
                        return jobMedia;
                    }

                    if (!isParent)
                    {
                        // The assigned sitter remains a passive viewer when the
                        // job is active but has not acquired a MonitorSession.
                        // This is the same child-keyed room the parent fallback
                        // uses; job authorization above remains mandatory.
                        var sitterMedia = CreateMediaDto(0, isParent: false);
                        PopulateMiroTalkMedia(sitterMedia, ScopeIndependent, 0, 0, childId);
                        return sitterMedia;
                    }
                }
                else if (!isParent)
                {
                    throw new MonitoringAccessException(jobDenial);
                }
            }
            else if (!isParent)
            {
                throw new MonitoringAccessException(MonitoringDenial.JobNotFound);
            }

            // A parent may fall back only after proving the independent
            // ChildGuardian relationship. This covers a missing/non-active job
            // and a job that has no active MonitorSession without granting a
            // sitter access to the independent scope.
            var independentDenial = MonitoringAccess.CheckIndependentParent(
                _db, currentUserId, currentRole, childId);
            if (independentDenial != MonitoringDenial.Allowed)
                throw new MonitoringAccessException(independentDenial);

            var independentSession = GetOrCreateIndependentSession(currentUserId, childId);
            var dto = CreateMediaDto(independentSession.SessionId, isParent);
            PopulateMiroTalkMedia(dto, ScopeIndependent, independentSession.SessionId, 0, childId);
            return dto;
        }

        private MonitoringMediaDto CreateMediaDto(int sessionId, bool isParent)
        {
            return new MonitoringMediaDto
            {
                MonitorSessionId = sessionId,
                Role = isParent ? "publisher" : "viewer",
                DisplayName = isParent ? "Parent" : "Babysitter",
                CanPublish = isParent,
                Configured = false
            };
        }

        private IndependentMediaRow GetOrCreateIndependentSession(int parentId, int childId)
        {
            using (var transaction = _db.Database.BeginTransaction(System.Data.IsolationLevel.Serializable))
            {
                var active = _db.Database.SqlQuery<IndependentMediaRow>(
                    @"SELECT TOP 1 IndependentMonitoringSession_ID SessionId,Parent_ID ParentId,Child_ID ChildId,0 JobId
                      FROM dbo.IndependentMonitoringSession WITH (UPDLOCK,HOLDLOCK)
                      WHERE Parent_ID=@p0 AND Status='Active' AND IsDeleted=0
                      ORDER BY IndependentMonitoringSession_ID DESC", parentId).FirstOrDefault();

                if (active != null)
                {
                    if (active.ChildId != childId)
                        throw new KeyNotFoundException("An independent monitoring session is already active for another child.");
                    transaction.Commit();
                    return active;
                }

                DateTime now = DateTime.UtcNow;
                int sessionId = _db.Database.SqlQuery<int>(
                    @"INSERT dbo.IndependentMonitoringSession(Parent_ID,Child_ID,RoomName,Status,StartedAtUtc)
                      VALUES(@p0,@p1,@p2,'Active',@p3); SELECT CAST(SCOPE_IDENTITY() AS INT);",
                    parentId, childId, "pending-independent-" + Guid.NewGuid().ToString("N").Substring(0, 12), now).Single();
                transaction.Commit();
                return new IndependentMediaRow { SessionId = sessionId, ParentId = parentId, ChildId = childId, JobId = 0 };
            }
        }

        /// <summary>
        /// Issues the independent PARENT's join path for the active session.
        /// The parent joins as a PUBLISHER (CanPublish=true): on this flow the
        /// parent phone is a full participant that both watches the child's room
        /// and transmits its own camera/microphone back into it. The query below
        /// has already proven the caller is a guardian of this child
        /// (ChildGuardian EXISTS clause), so no further restriction applies.
        /// Job_ID plays no part: when no job-linked MonitorSession exists the
        /// room is derived from the standalone INDEPENDENT scope (childId).
        /// </summary>
        public MonitoringMediaDto GetIndependentParentMedia(int parentId)
        {
            var session = _db.Database.SqlQuery<IndependentMediaRow>(
                @"SELECT TOP 1 s.IndependentMonitoringSession_ID SessionId,s.Parent_ID ParentId,s.Child_ID ChildId,
                    ISNULL((SELECT TOP 1 m.Job_ID FROM dbo.MonitorSession m
                             WHERE m.Child_ID=s.Child_ID AND m.Status='Active' AND m.IsDeleted=0
                             ORDER BY m.MonitorSession_ID DESC),0) JobId
                  FROM dbo.IndependentMonitoringSession s JOIN dbo.Child c ON c.Child_ID=s.Child_ID AND c.IsDeleted=0
                  WHERE s.Parent_ID=@p0 AND s.Status='Active' AND s.IsDeleted=0
                    AND EXISTS(SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=s.Child_ID AND g.Parent_ID=s.Parent_ID AND g.IsDeleted=0)
                  ORDER BY s.IndependentMonitoringSession_ID DESC", parentId).FirstOrDefault();
            if (session == null) throw new KeyNotFoundException("No authorized active independent monitoring session.");
            // Publisher on BOTH independent nodes (Phase: independent stream
            // routing). Node 3 (/independent-monitoring) must transmit its own
            // video back into the same room it receives from Node 1, so the
            // parent is issued a publisher session here. The JOINING device
            // (Node 1) receives its publisher session from
            // GetIndependentDeviceMedia; both land in the SAME room below.
            return BuildIndependentMedia(session, "Parent", canPublish: true);
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
                    d.MonitoringDeviceSession_ID DeviceSessionId,
                    ISNULL((SELECT TOP 1 m.Job_ID FROM dbo.MonitorSession m
                             WHERE m.Child_ID=s.Child_ID AND m.Status='Active' AND m.IsDeleted=0
                             ORDER BY m.MonitorSession_ID DESC),0) JobId
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
            // SINGLE ROOM, NO JOB REQUIRED. When the child has an ACTIVE
            // job-linked MonitorSession, JobId > 0 and the room is the canonical
            // (jobId, childId) room, so these participants still meet the
            // Babysitter in the same place as before (room unification). When
            // there is NO job - the normal standalone case for this flow - the
            // caller passes JobId = 0 and the room falls back to the INDEPENDENT
            // scope keyed on (childId), which parent and device derive
            // identically without any MonitorSession row.
            //
            // WHY THIS USED TO FAIL CLOSED ("Configured: false"): the fallback
            // used to receive ScopeCanonical ("scope"), which DeriveRoomId does
            // not recognise, so it returned null and PopulateMiroTalkMedia
            // reported "Live video is not configured on this deployment" purely
            // because no Job existed. The independent scope never requires a job.
            PopulateMiroTalkMedia(dto, ScopeIndependent, session.SessionId, session.JobId, session.ChildId);
            return dto;
        }

        private sealed class IndependentMediaRow
        {
            public int SessionId { get; set; }
            public int ParentId { get; set; }
            public int ChildId { get; set; }
            public int DeviceSessionId { get; set; }

            /// <summary>
            /// The ACTIVE job-linked monitoring session for this child, used ONLY
            /// to derive the canonical room id (single room). 0 when no active
            /// MonitorSession exists - the normal standalone case - in which case
            /// the room is derived from the INDEPENDENT scope keyed on Child_ID.
            /// The independent flow never requires a Job_ID.
            /// </summary>
            public int JobId { get; set; }
        }

        private static bool PopulateMiroTalkMedia(MonitoringMediaDto dto, string scope, int sessionId)
        {
            return PopulateMiroTalkMedia(dto, scope, sessionId, 0, 0);
        }

        /// <summary>
        /// Issues the room/join path for one participant.
        ///
        /// SINGLE ROOM, ASYMMETRIC ROLES: three resolution steps, in order:
        ///   1. (jobId, childId) both positive -> the CANONICAL scope room
        ///      (lc-m-{jobId}-{childId}-{hex8}). Every participant of one job
        ///      monitoring session shares it, so the Babysitter, Parent and the
        ///      monitor device land in the SAME room.
        ///   2. jobId == 0 with the INDEPENDENT scope -> the standalone
        ///      independent room (lc-i-{childId}-{hex8}). No job and no
        ///      MonitorSession row is required; parent and device both key on
        ///      the child they share, so they still land in the SAME room.
        ///   3. Otherwise -> the legacy session-scoped derivation. Unknown
        ///      scopes fail closed (null) rather than inventing a room.
        /// </summary>
        private static bool PopulateMiroTalkMedia(MonitoringMediaDto dto, string scope, int sessionId, int jobId, int childId)
        {
            string serverUrl = GetConfiguredMiroTalkServerUrl();
            string salt = ConfigurationManager.AppSettings[KeyRoomSalt];
            bool enabled = string.Equals(ConfigurationManager.AppSettings[KeyEnabled], "true", StringComparison.OrdinalIgnoreCase);
            string roomId = null;
            if (enabled && serverUrl != null && !string.IsNullOrWhiteSpace(salt) && salt.Length >= 32)
            {
                if (jobId > 0 && childId > 0)
                {
                    // Unified canonical room: every participant of the same
                    // (job, child) - Babysitter, Parent, paired device - meets here.
                    roomId = DeriveCanonicalRoomId(jobId, childId, salt);
                }
                else if (string.Equals(scope, ScopeIndependent, StringComparison.Ordinal) && childId > 0)
                {
                    // STANDALONE INDEPENDENT SCOPE: no Job_ID exists, so key the
                    // room on the child both participants share. The parent
                    // (bearer) and the device (X-Monitor-Device credential)
                    // authorize against the SAME IndependentMonitoringSession and
                    // therefore resolve the SAME Child_ID, hence the SAME room -
                    // with no MonitorSession row and no Job anywhere.
                    roomId = DeriveIndependentRoomId(childId, salt);
                }
                else
                {
                    // Legacy session-scoped fallback. Unknown scopes still fail
                    // closed here (DeriveRoomId returns null) rather than guess.
                    roomId = DeriveRoomId(scope, sessionId, salt);
                }
            }

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
            // MiroTalk's supported direct-join `hide` option hides this local
            // participant's own tile. Use it for viewers so the parent sees
            // only the monitor device's actual camera feed, while keeping the
            // publisher's local preview available on Phone 2.
            string hideSelf = canPublish ? "0" : "1";
            // ASYMMETRIC ROLES - lock the viewer out of publishing.
            // audio=0/video=0 only sets the INITIAL state; the viewer could still
            // click their own mute/camera buttons and start publishing. These two
            // MiroTalk parameters are enforced by the SFU for the whole session
            // (verified present in this deployment's app/src/Server.js), so a
            // Babysitter stays receive-only even if the UI offers the controls.
            // Publishers are unaffected and keep full media rights.
            string cantPublish = canPublish ? "0" : "1";
            // embed=1 opts this room into the Little Care embed bridge that
            // ships with our own self-hosted deployment (public/js/
            // littlecare-embed.js). It hides the SFU's conference chrome and
            // accepts real control commands from the parent. It is inert on
            // any other join, so a normal MiroTalk room is unaffected.
            return "/join/?room=" + Uri.EscapeDataString(roomId) +
                "&roomPassword=0&name=" + Uri.EscapeDataString(displayName ?? string.Empty) +
                "&audio=" + audio + "&video=" + video +
                "&screen=0&hide=" + hideSelf + "&notify=0&chat=0&duration=unlimited" +
                "&audio_cant_unmute=" + cantPublish + "&video_cant_unhide=" + cantPublish +
                "&isPresenter=" + (canPublish ? "1" : "0") +
                "&embed=1";
        }
        // Room derivation helpers are shared by job-linked and independent
        // monitoring issuance. They have no database or client-side state.

        /// <summary>Room scope for a job-linked MonitorSession room.</summary>
        internal const string ScopeJob = "job";

        /// <summary>Room scope for an independent MonitoringSession room.</summary>
        internal const string ScopeIndependent = "independent";

        /// <summary>
        /// Canonical room scope (SINGLE ROOM, ASYMMETRIC ROLES).
        ///
        /// PHASE - The job-linked Babysitter room (lc-m-) and the independent
        /// monitor-device room (lc-i-) used to be DIFFERENT rooms, so the
        /// Babysitter and the monitor device could never see each other even
        /// though both were authorized for the same job and child.
        ///
        /// The monitoring scope (job + child) - NOT the credential - is now the
        /// single room identity. Every authorized participant of one scope
        /// resolves to the SAME canonical room, and the ASYMMETRIC permission
        /// is carried by CanPublish/Role in the DTO and by the MiroTalk join
        /// parameters, not by the room id.
        ///
        /// SECURITY - what is deliberately NOT changed:
        ///   * IndependentMonitoringController.AuthorizeDevice and the SHA-256
        ///     CredentialHash check are UNTOUCHED. A device still must present
        ///     its own 64-character credential, and an account bearer is still
        ///     refused on device routes. Only the ROOM IDENTIFIER is unified.
        ///   * The room id is still an HMAC over server-only salt, so it is
        ///     still unguessable and still carries no personal data.
        ///   * The room id is NOT authorization. MonitoringAccess remains the
        ///     only gate for who may request media at all.
        /// </summary>
        internal const string ScopeCanonical = "scope";

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
        /// Derives the ONE canonical room for a monitoring SCOPE (job + child).
        ///
        /// SINGLE ROOM, ASYMMETRIC ROLES. Every authorized participant of the
        /// same (jobId, childId) - the Babysitter, the Parent and the paired
        /// monitor device - resolves to the same room id here, so they meet.
        ///
        /// FORMAT  lc-m-{jobId}-{childId}-{hex8}
        /// e.g.     lc-m-157-27-3f9a1c07
        ///
        /// WHY STILL HMAC'd (and not just the raw ids):
        ///   jobId and childId are small sequential integers. Emitting them
        ///   plainly would let anyone who can reach the SFU enumerate another
        ///   family's room by counting. The keyed digest removes that, exactly
        ///   as the previous session-scoped derivation did, and keeps the room
        ///   free of anything personal.
        ///
        /// WHY THE SESSION ID IS GONE:
        ///   The old derivation keyed on the session id, which is WHY the
        ///   job-linked session (MonitorSession 485) and the independent session
        ///   (IndependentMonitoringSession 38) produced lc-m-485-* and lc-i-38-*.
        ///   The two participants therefore never shared a room. Both now key
        ///   on the scope they genuinely share.
        ///
        /// DETERMINISM: a pure function of (jobId, childId, salt). No clock, no
        /// randomness, no GUID and no database, so the Babysitter's browser and
        /// the monitor device independently compute the SAME room with no extra
        /// round trip. The salt must stay stable while a session is active.
        ///
        /// SECURITY: the salt is used only as an HMAC key - never returned,
        /// never logged, never placed in a DTO or a URL. This is a room
        /// IDENTIFIER, not a capability: MonitoringAccess still decides who may
        /// ask for media at all, and the device SHA-256 credential check is
        /// still required on the device route.
        ///
        /// Returns null when either id is invalid or the salt is absent - the
        /// caller must then fail closed rather than fall back to a guessable room.
        /// </summary>
        internal static string DeriveCanonicalRoomId(int jobId, int childId, string salt)
        {
            if (jobId <= 0 || childId <= 0 || string.IsNullOrWhiteSpace(salt)) return null;

            var inv = System.Globalization.CultureInfo.InvariantCulture;
            string message = ScopeCanonical + ":" + jobId.ToString(inv) + ":" + childId.ToString(inv);
            byte[] key = Encoding.UTF8.GetBytes(salt);
            byte[] digest;
            using (var hmac = new HMACSHA256(key))
            {
                digest = hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
            }

            var hex = new StringBuilder(8);
            for (int i = 0; i < 4; i++) hex.Append(digest[i].ToString("x2", inv));
            return "lc-m-" + jobId.ToString(inv) + "-" + childId.ToString(inv) + "-" + hex.ToString();
        }

        /// <summary>
        /// Derives the canonical room for the STANDALONE INDEPENDENT scope - the
        /// case where no Job_ID exists at all.
        ///
        /// FORMAT  lc-i-{childId}-{hex8}
        /// e.g.    lc-i-27-3f9a1c07
        ///
        /// WHY THE CHILD (AND NOT THE SESSION OR THE JOB):
        /// The independent flow is defined by the absence of a job, so the room
        /// must key on something both of its participants genuinely share: the
        /// Child_ID. The Parent route (GET /independent-monitoring/media) and the
        /// device route (GET /independent-monitoring/device/media) both resolve
        /// the SAME Child_ID through the SAME IndependentMonitoringSession, so
        /// they compute the SAME room with no extra round trip. Keying on the
        /// session id would split the room the moment a session is restarted,
        /// and keying on a job is exactly what this scope cannot do.
        ///
        /// WHY STILL HMAC'd: childId is a small sequential integer. Emitting it
        /// plainly would let anyone who reaches the SFU enumerate another
        /// family's room by counting; the keyed digest removes that, exactly as
        /// DeriveCanonicalRoomId does, and keeps the room free of personal data.
        ///
        /// DETERMINISM: a pure function of (childId, salt) - no clock, no
        /// randomness, no GUID and no database. The salt must stay stable while
        /// a session is active. The salt is used only as an HMAC key: never
        /// returned, never logged, never placed in a DTO or a URL.
        ///
        /// Returns null when childId is invalid or the salt is absent - the
        /// caller must then fail closed rather than fall back to a guessable room.
        /// </summary>
        internal static string DeriveIndependentRoomId(int childId, string salt)
        {
            if (childId <= 0 || string.IsNullOrWhiteSpace(salt)) return null;

            var inv = System.Globalization.CultureInfo.InvariantCulture;
            string message = ScopeIndependent + ":" + childId.ToString(inv);
            byte[] key = Encoding.UTF8.GetBytes(salt);
            byte[] digest;
            using (var hmac = new HMACSHA256(key))
            {
                digest = hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
            }

            var hex = new StringBuilder(8);
            for (int i = 0; i < 4; i++) hex.Append(digest[i].ToString("x2", inv));
            return "lc-i-" + childId.ToString(inv) + "-" + hex.ToString();
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
