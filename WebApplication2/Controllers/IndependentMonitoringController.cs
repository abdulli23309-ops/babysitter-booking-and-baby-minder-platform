using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Web.Http;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Implementations;

namespace WebApplication2.Controllers
{
    /// <summary>
    /// Separate authorization boundary for Phone-2 monitoring. Parent routes use
    /// the normal opaque account session; device routes accept only the dedicated
    /// X-Monitor-Device credential and never consult MonitoringAccess/job data.
    /// </summary>
    [RoutePrefix("api/independent-monitoring")]
    public sealed class IndependentMonitoringController : ApiController
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db = new BabySitterBooking_and_BabyMinderEntities();
        private static readonly char[] CodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ".ToCharArray();

        // Uniform error for every redemption failure. Never distinguishes
        // "no such code", "already redeemed", "expired" or "not a guardian",
        // so the endpoint cannot be used to enumerate valid codes or children.
        private const string InvalidCodeMessage = "The pairing code is invalid or expired.";

        // A matched pairing code may be attempted at most this many times
        // before it is revoked. The 5-minute TTL and the ~50-bit code are the
        // real defence; this is a hard stop on top of them.
        private const int MaxPairingAttempts = 5;

        [HttpPost, Route("pairing-codes"), SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult CreatePairingCode([FromBody] IndependentPairingCodeRequest request)
        {
            if (request == null || request.ChildId <= 0) return BadRequest("A valid child is required.");
            int parentId = ClaimsPrincipalHelper.GetUserId();
            try
            {
                // ChildGuardian is the ONLY monitoring authority in this system
                // (frozen Phase 3/7 rule). The legacy Child.Parent_ID column is
                // deliberately NOT accepted here: a column that every other
                // monitoring entry point refuses to trust must not become a
                // second way in. Phase 7 backfilled ChildGuardian from
                // Child.Parent_ID, so real owners keep working, and a co-parent
                // guardian gets access for the first time.
                bool authorized = _db.Database.SqlQuery<int>(
                    @"SELECT COUNT(1) FROM dbo.Child c WHERE c.Child_ID=@p0 AND c.IsDeleted=0
                      AND EXISTS (SELECT 1 FROM dbo.ChildGuardian g
                          WHERE g.Child_ID=c.Child_ID AND g.Parent_ID=@p1 AND g.IsDeleted=0)",
                    request.ChildId, parentId).Single() > 0;
                if (!authorized) return Content(HttpStatusCode.NotFound, "Unable to create a pairing code for this child.");

                bool active = _db.Database.SqlQuery<int>(
                    "SELECT COUNT(1) FROM dbo.IndependentMonitoringSession WHERE Parent_ID=@p0 AND Status='Active' AND IsDeleted=0", parentId).Single() > 0;
                if (active) return Content(HttpStatusCode.Conflict, "Stop the active monitoring session before pairing another device.");

                string code = GenerateCode();
                string hash = Hash(code);
                DateTime now = DateTime.UtcNow;
                using (var tx = _db.Database.BeginTransaction(IsolationLevel.Serializable))
                {
                    _db.Database.ExecuteSqlCommand(
                        "UPDATE dbo.MonitoringPairingCode SET IsRevoked=1 WHERE Parent_ID=@p0 AND RedeemedAtUtc IS NULL AND IsRevoked=0", parentId);
                    _db.Database.ExecuteSqlCommand(
                        @"INSERT dbo.MonitoringPairingCode(Parent_ID,Child_ID,CodeHash,CreatedAtUtc,ExpiresAtUtc)
                          VALUES(@p0,@p1,@p2,@p3,@p4)", parentId, request.ChildId, hash, now, now.AddMinutes(5));
                    tx.Commit();
                }
                return Ok(new { code, expiresAtUtc = now.AddMinutes(5) });
            }
            catch (Exception ex)
            {
                Trace.TraceError("Independent monitoring code creation failed: {0}", ex);
                return Content(HttpStatusCode.InternalServerError, "A pairing code could not be created.");
            }
        }

        [HttpPost, Route("device/pair")]
        public IHttpActionResult RedeemPairingCode([FromBody] IndependentPairingRedeemRequest request)
        {
            string normalized = NormalizeCode(request?.Code);
            if (normalized.Length != 10) return Content(HttpStatusCode.BadRequest, "The pairing code is invalid or expired.");
            string credential = RandomHex(32);
            DateTime now = DateTime.UtcNow;
            try
            {
                using (var tx = _db.Database.BeginTransaction(IsolationLevel.Serializable))
                {
                    var pairing = _db.Database.SqlQuery<PairingRow>(
                        @"SELECT TOP 1 MonitoringPairingCode_ID,Parent_ID,Child_ID,AttemptCount FROM dbo.MonitoringPairingCode WITH (UPDLOCK,HOLDLOCK)
                          WHERE CodeHash=@p0 AND IsRevoked=0 AND RedeemedAtUtc IS NULL AND ExpiresAtUtc>@p1",
                        Hash(normalized), now).FirstOrDefault();
                    if (pairing == null) return Content(HttpStatusCode.BadRequest, InvalidCodeMessage);

                    // Defence in depth against a leaked/observed code being
                    // brute-forced. The primary protections are the 10-character
                    // code (~50 bits, 32-symbol alphabet) and the 5-minute TTL;
                    // this cap bounds how often a *known* code may be attempted.
                    // Counter is bumped inside the same SERIALIZABLE transaction
                    // that performs the redemption, so parallel attempts cannot
                    // slip past the limit.
                    if (pairing.AttemptCount >= MaxPairingAttempts)
                    {
                        _db.Database.ExecuteSqlCommand(
                            "UPDATE dbo.MonitoringPairingCode SET IsRevoked=1 WHERE MonitoringPairingCode_ID=@p0 AND RedeemedAtUtc IS NULL",
                            pairing.MonitoringPairingCode_ID);
                        tx.Commit();
                        return Content(HttpStatusCode.BadRequest, InvalidCodeMessage);
                    }
                    _db.Database.ExecuteSqlCommand(
                        "UPDATE dbo.MonitoringPairingCode SET AttemptCount=AttemptCount+1 WHERE MonitoringPairingCode_ID=@p0",
                        pairing.MonitoringPairingCode_ID);

                    bool authorized = _db.Database.SqlQuery<int>(
                        @"SELECT COUNT(1) FROM dbo.Child c WHERE c.Child_ID=@p0 AND c.IsDeleted=0
                          AND EXISTS (SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=c.Child_ID AND g.Parent_ID=@p1 AND g.IsDeleted=0)",
                        pairing.Child_ID, pairing.Parent_ID).Single() > 0;
                    if (!authorized) return Content(HttpStatusCode.BadRequest, "The pairing code is invalid or expired.");

                    int sessionId = _db.Database.SqlQuery<int>(
                        @"INSERT dbo.IndependentMonitoringSession(Parent_ID,Child_ID,RoomName,Status,StartedAtUtc,LastDeviceSeenAtUtc)
                          VALUES(@p0,@p1,@p2,'Active',@p3,@p3); SELECT CAST(SCOPE_IDENTITY() AS INT);",
                        pairing.Parent_ID, pairing.Child_ID, "pending-independent-" + Guid.NewGuid().ToString("N").Substring(0, 12), now).Single();
                    _db.Database.ExecuteSqlCommand(
                        @"INSERT dbo.MonitoringDeviceSession(IndependentMonitoringSession_ID,CredentialHash,CreatedAtUtc,ExpiresAtUtc,LastSeenAtUtc)
                          VALUES(@p0,@p1,@p2,@p3,@p2)", sessionId, Hash(credential), now, now.AddDays(30));
                    int redeemed = _db.Database.ExecuteSqlCommand(
                        "UPDATE dbo.MonitoringPairingCode SET RedeemedAtUtc=@p0 WHERE MonitoringPairingCode_ID=@p1 AND RedeemedAtUtc IS NULL AND IsRevoked=0",
                        now, pairing.MonitoringPairingCode_ID);
                    if (redeemed != 1) throw new InvalidOperationException("Pairing code was already redeemed.");
                    tx.Commit();
                    return Ok(new { deviceCredential = credential, sessionId, childId = pairing.Child_ID, expiresAtUtc = now.AddDays(30) });
                }
            }
            catch (System.Data.SqlClient.SqlException ex)
            {
                Trace.TraceError("Independent monitoring pairing rejected by database constraint ({0}).", ex.Number);
                return Content(HttpStatusCode.Conflict, "This parent already has an active independent monitoring session.");
            }
            catch (Exception ex)
            {
                Trace.TraceError("Independent monitoring pairing failed: {0}", ex);
                return Content(HttpStatusCode.BadRequest, "The pairing code is invalid or expired.");
            }
        }

        [HttpPost, Route("device/heartbeat")]
        public IHttpActionResult DeviceHeartbeat()
        {
            var device = AuthorizeDevice();
            if (device == null) return Unauthorized();
            DateTime now = DateTime.UtcNow;
            _db.Database.ExecuteSqlCommand(
                @"UPDATE dbo.MonitoringDeviceSession SET LastSeenAtUtc=@p0 WHERE MonitoringDeviceSession_ID=@p1;
                  UPDATE dbo.IndependentMonitoringSession SET LastDeviceSeenAtUtc=@p0 WHERE IndependentMonitoringSession_ID=@p2 AND Status='Active'",
                now, device.DeviceSessionId, device.SessionId);
            return Ok(new { connected = true, lastSeenAtUtc = now });
        }

        [HttpPost, Route("device/cry")]
        public IHttpActionResult ReportCry()
        {
            var device = AuthorizeDevice();
            if (device == null) return Unauthorized();
            DateTime now = DateTime.UtcNow;
            try
            {
                // Atomic dedupe: one open incident per independent session. A
                // continuously crying baby re-reports constantly, and without
                // this the parent would get an alert storm. The unique filtered
                // index IX_IndependentCryEvent_Session_Open is the real
                // guarantee; UPDLOCK/HOLDLOCK makes the check-then-insert a
                // single serialised unit so parallel reports cannot both insert.
                //
                // The parent is alerted through the EXISTING Notification table,
                // which the parent inbox already polls - this reuses the delivery
                // channel that already works for job-based cry alerts instead of
                // inventing a second inbox.
                //
                // Job_ID is confirmed NULLABLE in this database (sys.columns
                // is_nullable = 1, and FK__Notificat__Job permits NULL), so an
                // independent alert is written with Job_ID = NULL: it is jobless
                // and must not imply a booking.
                //
                // The fan-out is ChildGuardian ONLY. There is no sitter in this
                // context, so no sitter notification can be produced by this
                // path at all, and it is written only on FIRST insert, so a
                // re-firing detector never produces an alert storm.
                long id;
                using (var tx = _db.Database.BeginTransaction(IsolationLevel.Serializable))
                {
                    id = _db.Database.SqlQuery<long>(
                        @"IF EXISTS (SELECT 1 FROM dbo.IndependentCryEvent WITH (UPDLOCK,HOLDLOCK)
                                      WHERE IndependentMonitoringSession_ID=@p0 AND ResolvedAtUtc IS NULL)
                            SELECT TOP 1 IndependentCryEvent_ID FROM dbo.IndependentCryEvent WHERE IndependentMonitoringSession_ID=@p0 AND ResolvedAtUtc IS NULL;
                          ELSE BEGIN
                            INSERT dbo.IndependentCryEvent(IndependentMonitoringSession_ID,Parent_ID,Child_ID,DetectedAtUtc) VALUES(@p0,@p1,@p2,@p3);
                            -- Capture the incident identity BEFORE the notification
                            -- insert: SCOPE_IDENTITY() otherwise returns the LAST
                            -- identity generated in this scope, which would be the
                            -- Notification row and silently report the wrong id.
                            DECLARE @incidentId BIGINT = CAST(SCOPE_IDENTITY() AS BIGINT);
                            INSERT dbo.Notification(UserID,UserRole,Message,IsRead,CreatedAt,Type,IsDeleted,Job_ID)
                            SELECT g.Parent_ID,'Parent',@p4,0,GETDATE(),'CryAlertParent',0,NULL
                            FROM dbo.ChildGuardian g WHERE g.Child_ID=@p2 AND g.IsDeleted=0;
                            SELECT @incidentId;
                          END",
                        device.SessionId, device.ParentId, device.ChildId, now,
                        "Cry detected by the monitoring device. Please check on your child.").Single();
                    tx.Commit();
                }
                return Ok(new { incidentId = id, status = "Open" });
            }
            catch (System.Data.SqlClient.SqlException ex) when (ex.Number == 2601 || ex.Number == 2627)
            {
                long existing = _db.Database.SqlQuery<long>(
                    "SELECT TOP 1 IndependentCryEvent_ID FROM dbo.IndependentCryEvent WHERE IndependentMonitoringSession_ID=@p0 AND ResolvedAtUtc IS NULL",
                    device.SessionId).FirstOrDefault();
                return Ok(new { incidentId = existing, status = "Open", reused = true });
            }
            catch (Exception ex)
            {
                Trace.TraceError("Independent cry report failed: {0}", ex);
                return Content(HttpStatusCode.InternalServerError, "The monitoring event could not be recorded.");
            }
        }

        [HttpGet, Route("device/session")]
        public IHttpActionResult GetDeviceSession()
        {
            var device = AuthorizeDevice();
            if (device == null) return Unauthorized();
            return Ok(new { sessionId = device.SessionId, childId = device.ChildId, status = "Active", lastSeenAtUtc = device.LastSeenAtUtc });
        }

        [HttpGet, Route("device/media")]
        public IHttpActionResult GetDeviceMedia()
        {
            // An account (bearer) token must never be usable here: this route is
            // the PUBLISHER side, and publisher rights belong to the paired
            // device only. A parent account asking for it is a privilege
            // confusion, so it is refused outright rather than downgraded.
            if (Request.Headers.Authorization != null)
                return Content(HttpStatusCode.Forbidden, "Account sessions cannot use monitor-device endpoints.");

            // Resolve the device FIRST, with exactly the same rule as every other
            // device route. A missing, revoked or expired credential is an
            // AUTHENTICATION failure (401), not an authorization one, so the
            // device client can tell "not paired / pairing ended" (clear the
            // credential, show the pair screen) apart from a genuine refusal.
            var device = AuthorizeDevice();
            if (device == null) return Unauthorized();

            var media = new MediaSessionService(_db, ownsContext: false);
            try
            {
                var token = Request.Headers.GetValues("X-Monitor-Device").FirstOrDefault();
                return Ok(media.GetIndependentDeviceMedia(token));
            }
            catch (MonitoringAccessException) { return Unauthorized(); }
            catch (KeyNotFoundException) { return Unauthorized(); }
            catch (Exception ex) { Trace.TraceError("Independent device media request failed: {0}", ex); return Content(HttpStatusCode.InternalServerError, "Live video could not be prepared."); }
        }

        [HttpGet, Route("session"), SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetParentSession()
        {
            int parentId = ClaimsPrincipalHelper.GetUserId();
            var row = _db.Database.SqlQuery<ParentSessionRow>(
                @"SELECT TOP 1 s.IndependentMonitoringSession_ID SessionId,s.Child_ID ChildId,c.ChildName,s.Status,s.StartedAtUtc,s.LastDeviceSeenAtUtc,
                    CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.MonitoringDeviceSession d WHERE d.IndependentMonitoringSession_ID=s.IndependentMonitoringSession_ID AND d.RevokedAtUtc IS NULL AND d.ExpiresAtUtc>GETUTCDATE()) THEN 1 ELSE 0 END AS bit) DeviceAuthorized
                    ,CASE WHEN s.Status='Active' AND s.LastDeviceSeenAtUtc>=DATEADD(SECOND,-45,GETUTCDATE()) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END DeviceConnected
                  FROM dbo.IndependentMonitoringSession s
                  JOIN dbo.Child c ON c.Child_ID=s.Child_ID AND c.IsDeleted=0
                  WHERE s.Parent_ID=@p0 AND s.IsDeleted=0
                    AND EXISTS(SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=s.Child_ID AND g.Parent_ID=s.Parent_ID AND g.IsDeleted=0)
                  ORDER BY s.IndependentMonitoringSession_ID DESC", parentId).FirstOrDefault();
            return row == null ? (IHttpActionResult)NotFound() : Ok(row);
        }

        /// <summary>
        /// GET api/independent-monitoring/incidents
        ///
        /// Every cry incident recorded for THIS parent's independent sessions,
        /// newest first. The caller must be an authorized ChildGuardian of the
        /// incident's child, so a co-parent guardian sees the alerts too and an
        /// unrelated parent gets an empty list rather than somebody else's data.
        ///
        /// This is the independent-context equivalent of GET
        /// api/monitoring/cry?jobId=&amp;childId=. It is deliberately a separate
        /// route: the job flow's incident is scheduled against a sitter and a
        /// job, which is exactly what an independent session does not have.
        /// </summary>
        [HttpGet, Route("incidents"), SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetParentIncidents()
        {
            int parentId = ClaimsPrincipalHelper.GetUserId();
            var rows = _db.Database.SqlQuery<ParentCryRow>(
                @"SELECT e.IndependentCryEvent_ID IncidentId, e.Child_ID ChildId, c.ChildName,
                     e.DetectedAtUtc, e.ResolvedAtUtc,
                     CAST(CASE WHEN e.ResolvedAtUtc IS NULL THEN 1 ELSE 0 END AS bit) IsOpen
                   FROM dbo.IndependentCryEvent e
                   JOIN dbo.IndependentMonitoringSession s ON s.IndependentMonitoringSession_ID=e.IndependentMonitoringSession_ID
                   JOIN dbo.Child c ON c.Child_ID=e.Child_ID AND c.IsDeleted=0
                   WHERE s.Parent_ID=@p0 AND s.IsDeleted=0
                     AND EXISTS (SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=e.Child_ID AND g.Parent_ID=@p0 AND g.IsDeleted=0)
                   ORDER BY CASE WHEN e.ResolvedAtUtc IS NULL THEN 0 ELSE 1 END, e.DetectedAtUtc DESC",
                parentId).ToList();
            return Ok(rows);
        }

        /// <summary>
        /// POST api/independent-monitoring/cry/resolve
        ///
        /// Parent-only acknowledgement that the current cry incident is over.
        /// Closes the OPEN incident so the device can raise a FRESH one if the
        /// baby starts crying again (dedupe only covers unresolved events), and
        /// stops the alert from looking permanently active in the UI.
        ///
        /// Scoped to the caller's own sessions AND re-checked against the
        /// ChildGuardian relationship, so guessing an incident id is not even
        /// required or possible: the caller never names an incident.
        /// </summary>
        [HttpPost, Route("cry/resolve"), SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult ResolveOpenIncidents()
        {
            int parentId = ClaimsPrincipalHelper.GetUserId();
            DateTime now = DateTime.UtcNow;
            int resolved = _db.Database.ExecuteSqlCommand(
                @"UPDATE e SET ResolvedAtUtc=@p0
                  FROM dbo.IndependentCryEvent e
                  JOIN dbo.IndependentMonitoringSession s ON s.IndependentMonitoringSession_ID=e.IndependentMonitoringSession_ID
                  WHERE s.Parent_ID=@p1 AND s.IsDeleted=0 AND e.ResolvedAtUtc IS NULL
                    AND EXISTS (SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=e.Child_ID AND g.Parent_ID=@p1 AND g.IsDeleted=0)",
                now, parentId);
            return Ok(new { resolved });
        }

        /// <summary>
        /// POST api/independent-monitoring/incidents/{id}/resolve
        ///
        /// Parent-only acknowledgement that a cry incident is over. Closes it so
        /// the detector can raise a FRESH incident if the baby starts crying
        /// again (dedupe only covers unresolved events). The incident id is
        /// re-authorized against the caller's guardian relationship, so guessing
        /// another parent's incident id resolves nothing.
        /// </summary>
        [HttpPost, Route("incidents/{id:long}/resolve"), SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult ResolveIncident(long id)
        {
            int parentId = ClaimsPrincipalHelper.GetUserId();
            DateTime now = DateTime.UtcNow;
            int resolved = _db.Database.ExecuteSqlCommand(
                @"UPDATE e SET ResolvedAtUtc=@p0
                  FROM dbo.IndependentCryEvent e
                  JOIN dbo.IndependentMonitoringSession s ON s.IndependentMonitoringSession_ID=e.IndependentMonitoringSession_ID
                  WHERE e.IndependentCryEvent_ID=@p2 AND s.Parent_ID=@p1 AND s.IsDeleted=0
                    AND EXISTS (SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=e.Child_ID AND g.Parent_ID=@p1 AND g.IsDeleted=0)",
                now, parentId, id);
            return Ok(new { resolved });
        }

        [HttpGet, Route("media"), SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetParentMedia()
        {
            var media = new MediaSessionService(_db, ownsContext: false);
            try { return Ok(media.GetIndependentParentMedia(ClaimsPrincipalHelper.GetUserId())); }
            catch (MonitoringAccessException ex) { return Content(HttpStatusCode.Forbidden, ex.Message); }
            catch (System.Collections.Generic.KeyNotFoundException) { return NotFound(); }
            catch (Exception ex) { Trace.TraceError("Independent parent media request failed: {0}", ex); return Content(HttpStatusCode.InternalServerError, "Live video could not be prepared."); }
        }

        [HttpPost, Route("session/stop"), SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult StopParentSession()
        {
            int parentId = ClaimsPrincipalHelper.GetUserId();
            DateTime now = DateTime.UtcNow;
            int changed;
            using (var tx = _db.Database.BeginTransaction(IsolationLevel.Serializable))
            {
                changed = _db.Database.ExecuteSqlCommand(
                    @"UPDATE s SET Status='Ended',EndedAtUtc=@p0
                      FROM dbo.IndependentMonitoringSession s WHERE s.Parent_ID=@p1 AND s.Status='Active' AND s.IsDeleted=0",
                    now, parentId);
                _db.Database.ExecuteSqlCommand(
                    @"UPDATE d SET RevokedAtUtc=@p0 FROM dbo.MonitoringDeviceSession d
                      JOIN dbo.IndependentMonitoringSession s ON s.IndependentMonitoringSession_ID=d.IndependentMonitoringSession_ID
                      WHERE s.Parent_ID=@p1 AND d.RevokedAtUtc IS NULL", now, parentId);
                _db.Database.ExecuteSqlCommand(
                    @"UPDATE e SET ResolvedAtUtc=@p0 FROM dbo.IndependentCryEvent e
                      JOIN dbo.IndependentMonitoringSession s ON s.IndependentMonitoringSession_ID=e.IndependentMonitoringSession_ID
                      WHERE s.Parent_ID=@p1 AND e.ResolvedAtUtc IS NULL", now, parentId);
                tx.Commit();
            }
            return Ok(new { stopped = true, affected = changed });
        }

        // =====================================================================
        // PHASE 14 — FEED BABY (30-second video recording)
        // -----------------------------------------------------------------
        // Two IDENTITY DOMAINS in one controller, because they describe ONE
        // feature with two participants:
        //   ACCOUNT (Bearer)            the sitter/parent who asks
        //   DEVICE  (X-Monitor-Device)  Phone 2, which owns the camera
        //
        // Every route is thin: validate shape, run the authorization chain,
        // delegate to FeedingRecordingService, map to a status. No business
        // rules and no SQL live here.
        //
        // THE SITTER'S PHONE IS NEVER USED AS A CAMERA. There is no getUserMedia
        // on any account-facing route, and the device routes refuse an
        // Authorization header outright, so a sitter cannot be talked into
        // activating their own camera by this feature.
        // =====================================================================

        /// <summary>
        /// POST feeding/request  (bearer)
        /// Asks Phone 2 to record a 30-second feeding video for this Job+Child.
        /// The standard monitoring chain runs first, so an authorized sitter OR a
        /// guardian may call it and nobody else. The "still in progress" job gate
        /// is applied inside the service so a future call site cannot forget it.
        /// </summary>
        [HttpPost, Route("feeding/request"), SessionAuthorize]
        public IHttpActionResult RequestFeedingVideo([FromBody] FeedingRecordingRequest request)
        {
            if (request == null || request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("A job and a child are required.");

            try
            {
                var denial = MonitoringAccess.Check(
                    _db, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole(),
                    request.JobId, request.ChildId);
                if (denial != MonitoringDenial.Allowed) return MonitoringContent(denial);
            }
            catch (Exception ex)
            {
                Trace.TraceError("Feeding request authorization failed: {0}", ex);
                return Content(HttpStatusCode.InternalServerError, "The feeding video could not be requested.");
            }

            using (var service = new FeedingRecordingService(_db, ownsContext: false))
            {
                var created = service.CreateRequest(
                    request.JobId, request.ChildId,
                    ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole());

                if (created != null) return Ok(created);

                // null is ambiguous by design (duplicate vs. job finished vs.
                // storage unconfigured), so tell the user which without leaking
                // anything an unauthorized caller could use.
                var jobStatus = _db.Database.SqlQuery<string>(
                    "SELECT Status FROM dbo.Job WHERE Job_ID = @p0 AND IsDeleted = 0", request.JobId).FirstOrDefault();

                if (!MonitoringAccess.IsInProgressStatus(jobStatus))
                    return Content(HttpStatusCode.Conflict, FeedingRecordingService.JobNotRunningMessage);

                if (FeedingVideoSettings.GetStorageRoot() == null)
                    return Content(HttpStatusCode.ServiceUnavailable, FeedingRecordingService.StorageUnavailableMessage);

                // 409 is the honest answer for the case that matters: the sitter
                // already asked (§13 double-click protection).
                return Content(HttpStatusCode.Conflict, FeedingRecordingService.DuplicateRequestMessage);
            }
        }

        /// <summary>
        /// GET device/feeding/pending  (device)
        /// Phone 2 asks whether it has work to do. The claim is atomic, so a
        /// second poll never returns the same request and one request can never
        /// produce two recordings.
        /// </summary>
        [HttpGet, Route("device/feeding/pending")]
        public IHttpActionResult GetPendingFeedingVideo()
        {
            if (Request.Headers.Authorization != null)
                return Content(HttpStatusCode.Forbidden, "Account sessions cannot use monitor-device endpoints.");

            var device = AuthorizeDevice();
            if (device == null) return Unauthorized();

            using (var service = new FeedingRecordingService(_db, ownsContext: false))
            {
                // childId comes from the DEVICE CREDENTIAL, never the request.
                // 200 with a null body means "nothing to do", which is the normal
                // state between recordings and therefore NOT an error.
                return Ok(service.ClaimPending(device.ChildId));
            }
        }

                /// <summary>
        /// GET feeding/history?jobId=&childId=  (bearer)
        /// Completed feeding videos, newest first. NOT gated by job status, so
        /// history outlives the sitting (§25).
        /// </summary>
        [HttpGet, Route("feeding/history"), SessionAuthorize]
        public IHttpActionResult GetFeedingHistory(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0) return BadRequest("A job and a child are required.");

            var denial = MonitoringAccess.Check(
                _db, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole(), jobId, childId);
            if (denial != MonitoringDenial.Allowed) return MonitoringContent(denial);

            using (var service = new FeedingRecordingService(_db, ownsContext: false))
            {
                return Ok(service.GetHistory(jobId, childId));
            }
        }

        /// <summary>
        /// GET feeding/video/{publicId}  (bearer)
        /// Streams one completed recording.
        ///
        /// The client supplies ONLY a GUID. The job, child and file location all
        /// come from the database row, and entitlement is re-verified against
        /// THAT row's scope — so supplying a different jobId, or guessing a GUID,
        /// achieves nothing. The physical path is never returned, only streamed.
        ///
        /// Mirrors the ImageController pattern: FileStream + StreamContent +
        /// explicit content type, so the file is never buffered into memory and
        /// the storage folder is never exposed as a static directory.
        /// </summary>
        [HttpGet, Route("feeding/video/{publicId}"), SessionAuthorize]
        public HttpResponseMessage GetFeedingVideo(string publicId)
        {
            Guid id;
            if (!Guid.TryParseExact(publicId ?? string.Empty, "D", out id))
                return new HttpResponseMessage(HttpStatusCode.NotFound);

            using (var service = new FeedingRecordingService(_db, ownsContext: false))
            {
                string reason;
                string path = service.ResolvePlayablePath(
                    id, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole(), out reason);

                // One uniform answer for "unknown id", "not finished" and "not
                // permitted", so the endpoint cannot be used to discover which
                // recordings exist.
                if (path == null) return new HttpResponseMessage(HttpStatusCode.NotFound);

                try
                {
                    var response = new HttpResponseMessage(HttpStatusCode.OK);
                    response.Content = new StreamContent(
                        new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read));
                    response.Content.Headers.ContentType = new MediaTypeHeaderValue("video/webm");

                    // Only the filename: no path, no directory, nothing a client
                    // could reuse as a filesystem hint.
                    response.Content.Headers.ContentDisposition =
                        new ContentDispositionHeaderValue("inline") { FileName = id.ToString("D") + ".webm" };
                    return response;
                }
                catch (Exception ex)
                {
                    Trace.TraceError("Feeding video stream failed for {0}: {1}", id, ex);
                    return new HttpResponseMessage(HttpStatusCode.NotFound);
                }
            }
        }

                /// <summary>
        /// POST device/feeding/upload  (device)
        /// Phone 2 sends the finished 30-second clip.
        ///
        /// multipart/form-data with `recordingId` and `durationSeconds` fields
        /// plus the `file` part, mirroring the existing image-upload convention.
        /// The filename on disk is generated SERVER-SIDE from the row's PublicId;
        /// the client-declared name is only checked for its extension.
        /// </summary>
        [HttpPost, Route("device/feeding/upload")]
        public IHttpActionResult UploadFeedingVideo()
        {
            if (Request.Headers.Authorization != null)
                return Content(HttpStatusCode.Forbidden, "Account sessions cannot use monitor-device endpoints.");

            var device = AuthorizeDevice();
            if (device == null) return Unauthorized();

            var files = System.Web.HttpContext.Current.Request.Files;
            if (files == null || files.Count == 0) return BadRequest("No recording was received.");

            var file = files[0];
            var form = System.Web.HttpContext.Current.Request.Form;

            Guid id;
            if (!Guid.TryParseExact(form["recordingId"] ?? string.Empty, "D", out id))
                return BadRequest("A valid recording id is required.");

            int duration;
            if (!int.TryParse(form["durationSeconds"], out duration) || duration <= 0)
                return BadRequest("A valid recording duration is required.");

            try
            {
                using (var service = new FeedingRecordingService(_db, ownsContext: false))
                {
                    // Mark 'Uploading' first so the sitter's status is accurate
                    // while the bytes are in flight, rather than appearing stuck.
                    service.MarkUploading(id, device.ChildId);

                    using (var stream = file.InputStream)
                    {
                        var done = service.CompleteUpload(id, device.ChildId, stream, duration, file.FileName);
                        if (done != null) return Ok(done);
                    }
                }
            }
            catch (Exception ex)
            {
                Trace.TraceError("Feeding video upload failed for {0}: {1}", id, ex);
            }

            // Friendly copy only. The technical reason stays in the log and, for
            // an in-flight request, in FeedingRecording.FailureReason.
            return Content(HttpStatusCode.BadRequest, "The feeding video could not be saved.");
        }

        /// <summary>
        /// POST device/feeding/fail  (device)
        /// Phone 2 reports it could not record (permission denied, MediaRecorder
        /// unsupported, camera busy, ...). Moves the request to Failed so the
        /// sitter's wait ends with a clear message instead of spinning forever.
        /// </summary>
        [HttpPost, Route("device/feeding/fail")]
        public IHttpActionResult FailFeedingVideo([FromBody] FeedingFailureRequest request)
        {
            if (Request.Headers.Authorization != null)
                return Content(HttpStatusCode.Forbidden, "Account sessions cannot use monitor-device endpoints.");

            var device = AuthorizeDevice();
            if (device == null) return Unauthorized();

            if (request == null) return BadRequest("A recording id is required.");
            Guid id;
            if (!Guid.TryParseExact(request.RecordingId ?? string.Empty, "D", out id))
                return BadRequest("A valid recording id is required.");

        using (var service = new FeedingRecordingService(_db, ownsContext: false))
            {
    // The reason is stored server-side and never echoed to a sitter,
         // so technical detail cannot leak to an end user.
      if (service.MarkFailed(id, device.ChildId, request.Reason))
        {
return Ok(new { failed = true });
    }
         return BadRequest("No recording is waiting to be failed.");
          }
        }

        /// <summary>Maps a monitoring denial to its HTTP status (403/404).</summary>
        private IHttpActionResult MonitoringContent(MonitoringDenial denial)
        {
            switch (denial)
            {
                case MonitoringDenial.JobNotFound:
                case MonitoringDenial.ChildNotFound:
                case MonitoringDenial.SessionNotFound:
                case MonitoringDenial.IncidentNotFound:
                    return NotFound();
                default:
                    return Content(HttpStatusCode.Forbidden,
                        "You are not allowed to view feeding videos for this child.");
            }
        }

        private DeviceRow AuthorizeDevice()
        {
            // Device routes are a separate identity boundary. A normal account
            // bearer must never double as a Phone-2 credential, even if a
            // caller also supplies the device header.
            if (Request.Headers.Authorization != null) return null;
            IEnumerable<string> values;
            if (!Request.Headers.TryGetValues("X-Monitor-Device", out values)) return null;
            string token = values.FirstOrDefault();
            if (string.IsNullOrWhiteSpace(token) || token.Length != 64) return null;
            return _db.Database.SqlQuery<DeviceRow>(
                @"SELECT TOP 1 d.MonitoringDeviceSession_ID DeviceSessionId,d.IndependentMonitoringSession_ID SessionId,
                    s.Parent_ID ParentId,s.Child_ID ChildId,d.LastSeenAtUtc
                  FROM dbo.MonitoringDeviceSession d JOIN dbo.IndependentMonitoringSession s ON s.IndependentMonitoringSession_ID=d.IndependentMonitoringSession_ID
                  JOIN dbo.Child c ON c.Child_ID=s.Child_ID AND c.IsDeleted=0
                  JOIN dbo.Parent p ON p.Parent_ID=s.Parent_ID AND p.IsDeleted=0
                  WHERE d.CredentialHash=@p0 AND d.RevokedAtUtc IS NULL AND d.ExpiresAtUtc>GETUTCDATE() AND s.Status='Active' AND s.IsDeleted=0
                    AND EXISTS(SELECT 1 FROM dbo.ChildGuardian g WHERE g.Child_ID=s.Child_ID AND g.Parent_ID=s.Parent_ID AND g.IsDeleted=0)",
                Hash(token)).FirstOrDefault();
        }

        private static string GenerateCode()
        {
            var result = new StringBuilder(10);
            byte[] bytes = new byte[10];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            foreach (byte value in bytes) result.Append(CodeAlphabet[value % CodeAlphabet.Length]);
            return result.ToString();
        }
        private static string NormalizeCode(string value) => (value ?? string.Empty).Replace("-", string.Empty).Replace(" ", string.Empty).Trim().ToUpperInvariant();
        private static string RandomHex(int bytesCount) { var b = new byte[bytesCount]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b); return BitConverter.ToString(b).Replace("-", string.Empty).ToLowerInvariant(); }
        private static string Hash(string value) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", string.Empty).ToLowerInvariant(); }

        protected override void Dispose(bool disposing) { if (disposing) _db.Dispose(); base.Dispose(disposing); }
        private sealed class PairingRow { public int MonitoringPairingCode_ID { get; set; } public int Parent_ID { get; set; } public int Child_ID { get; set; } public int AttemptCount { get; set; } }
        private sealed class DeviceRow { public int DeviceSessionId { get; set; } public int SessionId { get; set; } public int ParentId { get; set; } public int ChildId { get; set; } public DateTime? LastSeenAtUtc { get; set; } }
        private sealed class ParentCryRow { public long IncidentId { get; set; } public int ChildId { get; set; } public string ChildName { get; set; } public DateTime DetectedAtUtc { get; set; } public DateTime? ResolvedAtUtc { get; set; } public bool IsOpen { get; set; } }
        private sealed class ParentSessionRow { public int SessionId { get; set; } public int ChildId { get; set; } public string ChildName { get; set; } public string Status { get; set; } public DateTime StartedAtUtc { get; set; } public DateTime? LastDeviceSeenAtUtc { get; set; } public bool DeviceAuthorized { get; set; } public bool DeviceConnected { get; set; } }
    }
}
