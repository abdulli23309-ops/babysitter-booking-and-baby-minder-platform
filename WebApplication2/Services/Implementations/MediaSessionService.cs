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
    ///   2. The participant ROLE is derived from the authenticated role on the
    ///      server. A sitter is ALWAYS receive-only; the client cannot ask to
    ///      publish.
    ///   3. The provider JWT is signed HERE with a private key held only in server
    ///      configuration. It never reaches the browser, the database or a log.
    ///   4. Fail CLOSED. With no provider configured the service returns
    ///      Configured = false plus an explanation. It never invents a domain,
    ///      never falls back to a public room server, and never returns an
    ///      unsigned token.
    ///
    /// PROVIDER CONFIGURATION (all three required, Web.config appSettings)
    ///     MonitoringMediaEnabled    "true" | "false"   master switch
    ///     MonitoringMediaDomain     tenant host, e.g. "meet.example.com"
    ///     MonitoringMediaPrivateKey RSA private key (PEM or base64 PKCS#8) used
    ///                                only to sign short-lived RS256 JWTs
    /// If any is missing/blank the endpoint answers Configured = false, which is
    /// the intended state until a real provider account is supplied.
    ///
    /// E2E flow: Phone 2 starts MonitorSession -> Phone 2 requests media (server
    /// authorizes and issues a publisher token) -> mother/sitter request media
    /// (server authorizes, issues a receive-only viewer token) -> an unauthorized
    /// user is rejected by MonitoringAccess before any token can exist.
    /// </summary>
    public class MediaSessionService : IDisposable
    {
        private const string KeyEnabled = "MonitoringMediaEnabled";
        private const string KeyDomain = "MonitoringMediaDomain";
        private const string KeyPrivateKey = "MonitoringMediaPrivateKey";

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
        /// video system. No new entity and no new lifecycle is introduced.
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
            //     on the baby-side device) and the sitter are DIFFERENT people,
            //     so only a parent may publish; a sitter is always receive-only.
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
            string key = ConfigurationManager.AppSettings[KeyPrivateKey];
            bool masterOn = string.Equals(ConfigurationManager.AppSettings[KeyEnabled], "true", StringComparison.OrdinalIgnoreCase);

            if (!masterOn || string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(key))
            {
                dto.Reason = "Live video is not configured on this deployment. " +
                             "Monitoring, cry alerts and pause controls are unaffected.";
                return dto;   // Configured stays false; the UI shows the honest state.
            }

            // (5) Server-side token issuance. The room is namespaced by the
            //     monitoring session so two jobs can never collide in one room.
            dto.Domain = domain.Trim();
            dto.RoomName = BuildRoomName(session.MonitorSession_ID);
            dto.Token = BuildToken(dto.RoomName, dto.DisplayName, dto.Role, currentUserId, key);

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


        /// <summary>
        /// Room name bound to the monitoring session, derived on the server so a
        /// room can never be guessed from client input. It is NOT authorization:
        /// a room name alone must never grant access, which is why every call
        /// still passes MonitoringAccess first.
        /// </summary>
        private static string BuildRoomName(int monitorSessionId)
        {
            // Every authorized participant for this MonitorSession must receive
            // the same room identifier. A random suffix per request created a
            // different room for the parent and sitter, preventing them from
            // ever meeting. This identifier is deterministic, but is NOT an
            // authorization secret: MonitoringAccess and the signed provider
            // token are still required on every request.
            return "lc-monitor-" + monitorSessionId;
        }

        /// <summary>
        /// Signs the provider JWT (RS256) on the server.
        ///
        /// The payload carries no secret beyond the room and the role, and the
        /// private key is used only in memory here. If signing fails the caller
        /// still receives Configured = false rather than a partial token.
        /// </summary>
        private static string BuildToken(string room, string displayName, string role, int userId, string privateKey)
        {
            try
            {
                RSAParameters? parameters;
                if (!TryReadPrivateKey(privateKey, out parameters)) return null;

                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.ImportParameters(parameters.Value);
                    long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                    string header = "{\"alg\":\"RS256\",\"typ\":\"JWT\"}";
                    string payload = "{\"aud\":\"jitsi\",\"iss\":\"little-care\"" +
                                      ",\"sub\":\"lc-" + userId + "\"" +
                                      ",\"room\":\"" + room + "\"" +
                                      ",\"role\":\"" + role + "\"" +
                                      ",\"name\":\"" + displayName + "\"" +
                                      ",\"exp\":" + (now + 3600) +
                                      ",\"iat\":" + now + "}";
                    string signingInput = B64Url(Encoding.UTF8.GetBytes(header)) + "." +
                                          B64Url(Encoding.UTF8.GetBytes(payload));
                    byte[] signature = rsa.SignData(
                        Encoding.UTF8.GetBytes(signingInput), CryptoConfig.MapNameToOID("SHA256"));
                    return signingInput + "." + B64Url(signature);
                }
            }
            catch (Exception ex)
            {
                // Never surface key/parse detail to the client; log server-side only.
                Trace.TraceError("MediaSessionService: failed to sign media token: {0}", ex);
                return null;
            }
        }


        /// <summary>
        /// Accepts a PKCS#8 RSA private key as PEM text or as raw base64 and
        /// returns the RSA parameters.
        ///
        /// WHY A HAND-ROLLED READER: .NET Framework 4.7.2 has no
        /// RSA.ImportFromPem (that arrived with .NET Core 3.0), and this project
        /// must not take a new dependency just to parse one key. This reads the
        /// standard PKCS#8 structure and returns false on anything unexpected, so
        /// a malformed key fails CLOSED instead of half-enabling media.
        /// </summary>
        private static bool TryReadPrivateKey(string key, out RSAParameters? result)
        {
            result = null;
            if (string.IsNullOrWhiteSpace(key)) return false;

            string base64 = key.Trim();
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
                // PKCS#8: SEQUENCE { version, AlgorithmIdentifier, OCTET STRING }
                int pos = 0, length;
                byte tag;
                if (!ReadTlv(der, ref pos, out tag, out length)) return false;   // outer SEQUENCE
                if (!ReadTlv(der, ref pos, out tag, out length)) return false;   // version
                if (!ReadTlv(der, ref pos, out tag, out length)) return false;   // algorithm id
                if (!ReadTlv(der, ref pos, out tag, out length)) return false;   // alg body
                pos += length;
                if (!ReadTlv(der, ref pos, out tag, out length)) return false;   // OCTET STRING
                byte[] pkcs1 = new byte[length];
                Array.Copy(der, pos, pkcs1, 0, length);

                // PKCS#1: SEQUENCE { version, n, e, d, p, q, dp, dq, qInv }
                int inner = 0;
                if (!ReadTlv(pkcs1, ref inner, out tag, out length)) return false;
                var parts = new byte[8][];
                for (int i = 0; i < 8; i++)
                {
                    if (!ReadTlv(pkcs1, ref inner, out tag, out length)) return false;
                    parts[i] = new byte[length];
                    Array.Copy(pkcs1, inner, parts[i], 0, length);
                    inner += length;
                }
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
            return pos + length <= data.Length;
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
