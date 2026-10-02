using System;
using System.Collections.Generic;
using System.Configuration;
using System.Diagnostics;
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
    ///   2. The participant role is derived from the authenticated application
    ///      role. A sitter always receives Role=viewer and CanPublish=false;
    ///      JaaS's documented JWT schema has no per-user camera/microphone publish
    ///      claim, so provider-side receive-only enforcement must be verified
    ///      separately and must not be inferred from hidden client controls.
    ///   3. The provider JWT is signed HERE with a private key held only in server
    ///      configuration. It never reaches the browser, the database or a log.
    ///   4. Fail CLOSED. With no provider configured the service returns
    ///      Configured = false plus an explanation. It never invents a domain,
    ///      never falls back to a public room server, and never returns an
    ///      unsigned token.
    ///
    /// PROVIDER CONFIGURATION (all five required, external appSettings)
    ///     MonitoringMediaEnabled    "true" | "false"   master switch
    ///     MonitoringMediaDomain     JaaS host (8x8.vc)
    ///     MonitoringMediaAppId      JaaS tenant namespace and JWT subject
    ///     MonitoringMediaApiKeyId   JaaS JWT header kid
    ///     MonitoringMediaPrivateKey local PEM key, used only for RS256 signing
    /// The private key never leaves this service. JaaS requires iss=chat,
    /// sub=AppId, an AppID-prefixed room and the API key id in the JWT header.
    /// React receives only the server-issued domain, room and signed token.
    /// If any is missing/blank the endpoint answers Configured = false, which is
    /// the intended state until a real provider account is supplied.
    ///
    /// E2E flow: Phone 2 starts MonitorSession -> Phone 2 requests media (server
    /// authorizes and issues a publisher-role token) -> mother/sitter request media
    /// (server authorizes and issues a viewer-role token) -> an unauthorized
    /// user is rejected by MonitoringAccess before any token can exist.
    /// </summary>
    public class MediaSessionService : IDisposable
    {
        private const string KeyEnabled = "MonitoringMediaEnabled";
        private const string KeyDomain = "MonitoringMediaDomain";
        private const string KeyAppId = "MonitoringMediaAppId";
        private const string KeyApiKeyId = "MonitoringMediaApiKeyId";
        private const string KeyPrivateKey = "MonitoringMediaPrivateKey";
        private const string JaasAppId = "vpaas-magic-cookie-a60732c436244ceb82319194c84f2443";
        private const string JaasApiKeyId = JaasAppId + "/d2feb3";

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
        /// shares the monitoring lifecycle instead of creating a second, parallel
        /// video system. Its AppID namespace makes the provider room name valid
        /// for this JaaS tenant; MonitoringAccess remains the authorization gate.
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
            //     The server DTO and JaaS moderator claim are derived from this
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

            // (4) Fail closed when the provider is not configured.
            string domain = ConfigurationManager.AppSettings[KeyDomain];
            string appId = ConfigurationManager.AppSettings[KeyAppId];
            string apiKeyId = ConfigurationManager.AppSettings[KeyApiKeyId];
            string key = ConfigurationManager.AppSettings[KeyPrivateKey];
            bool masterOn = string.Equals(ConfigurationManager.AppSettings[KeyEnabled], "true", StringComparison.OrdinalIgnoreCase);

            // Require the complete tenant tuple; a partial or mismatched config
            // must never mint a token for a different JaaS account.
            if (!masterOn || !string.Equals(domain?.Trim(), "8x8.vc", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(appId?.Trim(), JaasAppId, StringComparison.Ordinal) ||
                !string.Equals(apiKeyId?.Trim(), JaasApiKeyId, StringComparison.Ordinal) ||
                string.IsNullOrWhiteSpace(key))
            {
                dto.Reason = "Live video is not configured on this deployment. " +
                             "Monitoring, cry alerts and pause controls are unaffected.";
                return dto;   // Configured stays false; the UI shows the honest state.
            }

            // (5) Server-side token issuance. The room is namespaced by the
            //     monitoring session so two jobs can never collide in one room.
            dto.Domain = domain.Trim();
            dto.RoomName = BuildRoomName(appId.Trim(), session.MonitorSession_ID);
            dto.Token = BuildToken(GetLogicalRoomName(dto.RoomName), dto.DisplayName, isParent, currentUserId, appId.Trim(), apiKeyId.Trim(), key);

            if (string.IsNullOrEmpty(dto.Token))
            {
                // Signing failed - never hand back a half-valid session.
                dto.Domain = null;
                dto.RoomName = null;
                dto.Reason = "Live video could not be started. Please try again.";
                return dto;
            }

            dto.Configured = true;
            dto.Reason = null;
            return dto;
        }

        /// <summary>Issues a parent-only viewer token for the parent's active independent session.</summary>
        public MonitoringMediaDto GetIndependentParentMedia(int parentId)
        {
            var session = _db.Database.SqlQuery<IndependentMediaRow>(
                @"SELECT TOP 1 s.IndependentMonitoringSession_ID SessionId,s.Parent_ID ParentId,s.Child_ID ChildId,s.RoomName
                  FROM dbo.IndependentMonitoringSession s JOIN dbo.Child c ON c.Child_ID=s.Child_ID AND c.IsDeleted=0
                  WHERE s.Parent_ID=@p0 AND s.Status='Active' AND s.IsDeleted=0
                    AND EXISTS(SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=s.Child_ID AND g.Parent_ID=s.Parent_ID AND g.IsDeleted=0)
                  ORDER BY s.IndependentMonitoringSession_ID DESC", parentId).FirstOrDefault();
            if (session == null) throw new KeyNotFoundException("No authorized active independent monitoring session.");
            return BuildIndependentMedia(session, parentId.ToString(System.Globalization.CultureInfo.InvariantCulture), "Parent", canPublish: false);
        }

        /// <summary>Issues a publisher token only after validating the dedicated device credential.</summary>
        public MonitoringMediaDto GetIndependentDeviceMedia(string credential)
        {
            if (string.IsNullOrWhiteSpace(credential) || credential.Length != 64)
                throw new MonitoringAccessException(MonitoringDenial.InvalidRole);
            string hash;
            using (var sha = SHA256.Create())
                hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(credential))).Replace("-", string.Empty).ToLowerInvariant();
            var session = _db.Database.SqlQuery<IndependentMediaRow>(
                @"SELECT TOP 1 s.IndependentMonitoringSession_ID SessionId,s.Parent_ID ParentId,s.Child_ID ChildId,s.RoomName,
                    d.MonitoringDeviceSession_ID DeviceSessionId
                  FROM dbo.MonitoringDeviceSession d JOIN dbo.IndependentMonitoringSession s ON s.IndependentMonitoringSession_ID=d.IndependentMonitoringSession_ID
                  JOIN dbo.Child c ON c.Child_ID=s.Child_ID AND c.IsDeleted=0 JOIN dbo.Parent p ON p.Parent_ID=s.Parent_ID AND p.IsDeleted=0
                  WHERE d.CredentialHash=@p0 AND d.RevokedAtUtc IS NULL AND d.ExpiresAtUtc>GETUTCDATE() AND s.Status='Active' AND s.IsDeleted=0
                    AND EXISTS(SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=s.Child_ID AND g.Parent_ID=s.Parent_ID AND g.IsDeleted=0)",
                hash).FirstOrDefault();
            if (session == null) throw new MonitoringAccessException(MonitoringDenial.InvalidRole);
            return BuildIndependentMedia(session, "device-" + session.DeviceSessionId.ToString(System.Globalization.CultureInfo.InvariantCulture), "Monitor device", canPublish: true);
        }

        private static MonitoringMediaDto BuildIndependentMedia(IndependentMediaRow session, string userId, string displayName, bool canPublish)
        {
            var dto = new MonitoringMediaDto
            {
                MonitorSessionId = session.SessionId,
                Role = canPublish ? "publisher" : "viewer",
                DisplayName = displayName,
                CanPublish = canPublish,
                Configured = false
            };
            string domain = ConfigurationManager.AppSettings[KeyDomain];
            string appId = ConfigurationManager.AppSettings[KeyAppId];
            string apiKeyId = ConfigurationManager.AppSettings[KeyApiKeyId];
            string key = ConfigurationManager.AppSettings[KeyPrivateKey];
            bool enabled = string.Equals(ConfigurationManager.AppSettings[KeyEnabled], "true", StringComparison.OrdinalIgnoreCase);
            if (!enabled || !string.Equals(domain?.Trim(), "8x8.vc", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(appId?.Trim(), JaasAppId, StringComparison.Ordinal) ||
                !string.Equals(apiKeyId?.Trim(), JaasApiKeyId, StringComparison.Ordinal) || string.IsNullOrWhiteSpace(key))
            {
                dto.Reason = "Live video is not configured on this deployment.";
                return dto;
            }
            dto.Domain = domain.Trim();
            dto.RoomName = appId.Trim() + "/lc-independent-" + session.SessionId;
            dto.Token = BuildToken(GetLogicalRoomName(dto.RoomName), displayName, canPublish,
                int.Parse(userId.StartsWith("device-", StringComparison.Ordinal) ? userId.Substring(7) : userId,
                    System.Globalization.CultureInfo.InvariantCulture), appId.Trim(), apiKeyId.Trim(), key);
            if (string.IsNullOrEmpty(dto.Token))
            {
                dto.Domain = null; dto.RoomName = null; dto.Reason = "Live video could not be started. Please try again.";
                return dto;
            }
            dto.Configured = true;
            return dto;
        }

        private sealed class IndependentMediaRow
        {
            public int SessionId { get; set; }
            public int ParentId { get; set; }
            public int ChildId { get; set; }
            public string RoomName { get; set; }
            public int DeviceSessionId { get; set; }
        }

        private static string GetLogicalRoomName(string namespacedRoomName)
        {
            // JaaS IFrame names retain the AppID prefix; JWT room matching uses only the logical room.
            int separator = namespacedRoomName.IndexOf('/');
            return separator < 0 ? namespacedRoomName : namespacedRoomName.Substring(separator + 1);
        }

        /// <summary>
        /// Room name bound to the monitoring session, derived on the server so a
        /// room can never be guessed from client input. It is NOT authorization:
        /// a room name alone must never grant access, which is why every call
        /// still passes MonitoringAccess first.
        /// </summary>
        private static string BuildRoomName(string appId, int monitorSessionId)
        {
            // Every authorized participant for this MonitorSession must receive
            // the same room identifier. A random suffix per request created a
            // different room for the parent and sitter, preventing them from
            // ever meeting. This identifier is deterministic, but is NOT an
            // authorization secret: MonitoringAccess and the signed provider
            // token are still required on every request.
            return appId + "/lc-monitor-" + monitorSessionId;
        }

        /// <summary>
        /// Signs the provider JWT (RS256) on the server. The caller has already
        /// passed MonitoringAccess and supplies only identity/role derived from
        /// authentication; JaaS gets AppID namespace, short expiry and server
        /// identity claims. Sitter receives the viewer DTO and moderator="false".
        /// JaaS's documented token claims do not themselves restrict camera/mic
        /// publishing for a non-moderator; the UI setting is not that boundary.
        ///
        /// The payload carries no secret beyond the room and the role, and the
        /// private key is used only in memory here. If signing fails the caller
        /// still receives Configured = false rather than a partial token.
        /// </summary>
        private static string BuildToken(string room, string displayName, bool isParent, int userId, string appId, string apiKeyId, string privateKey)
        {
            try
            {
                RSAParameters? parameters;
                if (!TryReadPrivateKey(privateKey, out parameters)) return null;

                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.ImportParameters(parameters.Value);
                    long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                    var header = new { alg = "RS256", kid = apiKeyId, typ = "JWT" };
                    var payload = new
                    {
                        aud = "jitsi",
                        iss = "chat",
                        sub = appId,
                        room = room,
                        exp = now + 3600,
                        nbf = now,
                        context = new
                        {
                            user = new
                            {
                                id = userId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                                name = displayName,
                                // JaaS documents this claim as the string "true"/"false".
                                // A JSON boolean is not equivalent for consumers that
                                // compare the documented string value strictly.
                                moderator = isParent ? "true" : "false"
                            }
                        }
                    };
                    string headerJson = Newtonsoft.Json.JsonConvert.SerializeObject(header);
                    string payloadJson = Newtonsoft.Json.JsonConvert.SerializeObject(payload);
                    string signingInput = B64Url(Encoding.UTF8.GetBytes(headerJson)) + "." +
                                          B64Url(Encoding.UTF8.GetBytes(payloadJson));
                    byte[] signature = rsa.SignData(
                        Encoding.UTF8.GetBytes(signingInput), CryptoConfig.MapNameToOID("SHA256"));
                    return signingInput + "." + B64Url(signature);
                }
            }
            catch (Exception ex)
            {
                // Never surface key/parse detail to the client; log server-side only.
                Trace.TraceError("MediaSessionService: token signing failed ({0}).", ex.GetType().Name);
                return null;
            }
        }


        /// <summary>
        /// Accepts PKCS#8 or PKCS#1 RSA private key PEM text (or raw base64) and
        /// returns the RSA parameters.
        ///
        /// WHY A HAND-ROLLED READER: .NET Framework 4.7.2 has no
        /// RSA.ImportFromPem (that arrived with .NET Core 3.0), and this project
        /// must not take a new dependency just to parse one key. This reads the
        /// standard PKCS#8/PKCS#1 structures and returns false on anything unexpected, so
        /// a malformed key fails CLOSED instead of half-enabling media.
        /// </summary>
        private static bool TryReadPrivateKey(string key, out RSAParameters? result)
        {
            result = null;
            if (string.IsNullOrWhiteSpace(key)) return false;

            string base64 = key.Trim();
            bool isPkcs1 = base64.Contains("-----BEGIN RSA PRIVATE KEY-----");
            bool hasPkcs8Marker = base64.Contains("-----BEGIN PRIVATE KEY-----");
            if (base64.Contains("-----BEGIN") && !isPkcs1 && !hasPkcs8Marker) return false;
            if (base64.Contains("-----BEGIN"))
            {
                var lines = base64.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                    .Where(l => !l.StartsWith("-----")).Select(l => l.Trim());
                base64 = string.Concat(lines);
            }
            if (string.IsNullOrWhiteSpace(base64)) return false;

            byte[] der;
            try { der = Convert.FromBase64String(base64); } catch { return false; }

            try
            {
                byte[] pkcs1 = der;
                if (!isPkcs1)
                {
                    // PKCS#8: SEQUENCE { version INTEGER, algorithm SEQUENCE,
                    // privateKey OCTET STRING }. Advance over every full TLV.
                    int outer = 0, outerLength;
                    byte outerTag;
                    if (!ReadTlv(der, ref outer, out outerTag, out outerLength) || outerTag != 0x30 || outer + outerLength != der.Length) return false;
                    int end = outer + outerLength;
                    int fieldLength;
                    if (!ReadTlv(der, ref outer, out outerTag, out fieldLength) || outerTag != 0x02) return false;
                    outer += fieldLength;
                    if (!ReadTlv(der, ref outer, out outerTag, out fieldLength) || outerTag != 0x30) return false;
                    outer += fieldLength;
                    if (!ReadTlv(der, ref outer, out outerTag, out fieldLength) || outerTag != 0x04 || outer + fieldLength != end) return false;
                    pkcs1 = new byte[fieldLength];
                    Array.Copy(der, outer, pkcs1, 0, fieldLength);
                }

                // PKCS#1: SEQUENCE { version, n, e, d, p, q, dp, dq, qInv }.
                int inner = 0, sequenceLength;
                byte tag;
                if (!ReadTlv(pkcs1, ref inner, out tag, out sequenceLength) || tag != 0x30 || inner + sequenceLength != pkcs1.Length) return false;
                int sequenceEnd = inner + sequenceLength;
                int length;
                var parts = new byte[8][];
                if (!ReadTlv(pkcs1, ref inner, out tag, out length) || tag != 0x02) return false;
                inner += length; // version
                for (int i = 0; i < 8; i++)
                {
                    if (!ReadTlv(pkcs1, ref inner, out tag, out length) || tag != 0x02) return false;
                    parts[i] = new byte[length];
                    Array.Copy(pkcs1, inner, parts[i], 0, length);
                    // DER INTEGERs are signed and commonly have a leading 00
                    // to keep the RSA magnitude positive. RSAParameters expects
                    // unsigned magnitudes without that sign-padding byte.
                    int firstMagnitudeByte = 0;
                    while (firstMagnitudeByte < parts[i].Length - 1 && parts[i][firstMagnitudeByte] == 0)
                        firstMagnitudeByte++;
                    if (firstMagnitudeByte > 0)
                        parts[i] = parts[i].Skip(firstMagnitudeByte).ToArray();
                    inner += length;
                }
                if (inner != sequenceEnd) return false;
                result = new RSAParameters
                {
                    Modulus = parts[0], Exponent = parts[1],
                    D = parts[2], P = parts[3], Q = parts[4],
                    DP = parts[5], DQ = parts[6], InverseQ = parts[7]
                };
                return true;
            }
            catch { return false; }
        }

        /// <summary>Reads one DER tag/length pair and advances the cursor.</summary>
        private static bool ReadTlv(byte[] data, ref int pos, out byte tag, out int length)
        {
            tag = 0; length = 0;
            if (pos + 2 > data.Length) return false;
            tag = data[pos++];
            int first = data[pos++];
            if ((first & 0x80) == 0) { length = first; return pos + length <= data.Length; }
            int n = first & 0x7F;
            if (n == 0 || n > 4 || pos + n > data.Length) return false;
            length = 0;
            for (int i = 0; i < n; i++) length = (length << 8) | data[pos++];
            return length >= 0 && pos + length <= data.Length;
        }

        private static string B64Url(byte[] data)
        {
            return Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        public void Dispose()
        {
            if (_ownsContext && _db != null) _db.Dispose();
        }
    }
}
