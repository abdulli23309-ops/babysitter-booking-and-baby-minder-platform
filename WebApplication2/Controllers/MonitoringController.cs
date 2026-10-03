using System;
using System.Collections.Generic;
using System.Configuration;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Text;
using System.Web.Http;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    // CORS (Phase 1 Fix C): intentionally NO per-controller [EnableCors] here -
    // a per-controller attribute would replace the single global config-driven
    // policy in WebApiConfig.Register.
    [RoutePrefix("api/monitoring")]
    [SessionAuthorize]
    public class MonitoringController : ApiController
    {
        private readonly IMonitoringService _monitoringService;
        private readonly ICryIncidentService _cryIncidentService;
        private readonly IGuardianConnectionService _guardianConnectionService;

        public MonitoringController()
            : this(new MonitoringService(), new CryIncidentService(), new GuardianConnectionService())
        {
        }

        // Kept for compatibility with the Phase 3/4 verification harnesses, which
        // construct the controller with a single (shared-context) session service.
        public MonitoringController(IMonitoringService monitoringService)
            : this(monitoringService, new CryIncidentService(), new GuardianConnectionService())
        {
        }

        public MonitoringController(IMonitoringService monitoringService, ICryIncidentService cryIncidentService)
            : this(monitoringService, cryIncidentService, new GuardianConnectionService())
        {
        }

        public MonitoringController(
            IMonitoringService monitoringService,
            ICryIncidentService cryIncidentService,
            IGuardianConnectionService guardianConnectionService)
        {
            _monitoringService = monitoringService ?? throw new ArgumentNullException(nameof(monitoringService));
            _cryIncidentService = cryIncidentService ?? throw new ArgumentNullException(nameof(cryIncidentService));
            _guardianConnectionService = guardianConnectionService
                ?? throw new ArgumentNullException(nameof(guardianConnectionService));
        }

        // POST api/monitoring/session/start   body: { "jobId": 171, "childId": 27 }
        // Creates (or idempotently returns) the Active session for ONE child of
        // the job. Requires [SessionAuthorize] (401 without a valid token) and the
        // centralized MonitoringAccess chain (403/404 on denial).
        [HttpPost]
        [Route("session/start")]
        public IHttpActionResult StartSession([FromBody] StartMonitoringSessionRequest request)
        {
            if (request == null)
                return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            try
            {
                var session = _monitoringService.StartSession(
                    request.JobId,
                    request.ChildId,
                    ClaimsPrincipalHelper.GetUserId(),
                    ClaimsPrincipalHelper.GetRole());
                return Ok(session);
            }
            catch (MonitoringAccessException ex)
            {
                return MonitoringError(ex);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                // SECURITY (Phase 1 Fix B): never send exception details to the
                // API client - messages can leak SQL text, table/column names or
                // connection strings. Full details go to the server trace log only.
                Trace.TraceError(
                    "MonitoringController: start failed for job {0}, child {1}: {2}",
                    request.JobId, request.ChildId, ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while starting the monitoring session.");
            }
        }

        // POST api/monitoring/session/heartbeat   body: { "jobId": 171, "childId": 27 }
        // Phase 4: proves the monitoring phone/browser is still talking to the
        // server. The client sends ONLY job + child; the caller identity comes
        // from the bearer token ([SessionAuthorize]) and the timestamp is SERVER
        // UTC time - there is no sessionId, role or heartbeatUtc field to forge.
        // Authorization is the exact Phase 3 MonitoringAccess chain (implemented
        // once in the service, nothing duplicated here): job InProgress (both
        // spellings), assigned-sitter/guardian, JobChildren membership and an
        // existing Active MonitorSession. A heartbeat never creates, extends or
        // reopens a session and never changes Job status.
        [HttpPost]
        [Route("session/heartbeat")]
        public IHttpActionResult Heartbeat([FromBody] HeartbeatMonitoringRequest request)
        {
            if (request == null)
                return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            try
            {
                var result = _monitoringService.SendHeartbeat(
                    request.JobId,
                    request.ChildId,
                    ClaimsPrincipalHelper.GetUserId(),
                    ClaimsPrincipalHelper.GetRole());
                return Ok(result);
            }
            catch (MonitoringAccessException ex)
            {
                return MonitoringError(ex);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                // SECURITY (Phase 1 Fix B): no exception details to the client.
                Trace.TraceError(
                    "MonitoringController: heartbeat failed for job {0}, child {1}: {2}",
                    request.JobId, request.ChildId, ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while recording the monitoring heartbeat.");
            }
        }

        // GET api/monitoring/session?jobId=171&childId=27
        // Returns the latest session for the child (Active, or Ended after end so
        // clients can display state); 404 when no session exists at all.
        [HttpGet]
        [Route("session")]
        public IHttpActionResult GetSession(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0)
                return BadRequest("jobId and childId must be positive integers.");

            try
            {
                var session = _monitoringService.GetSession(
                    jobId,
                    childId,
                    ClaimsPrincipalHelper.GetUserId(),
                    ClaimsPrincipalHelper.GetRole());
                if (session == null)
                    return NotFound();
                return Ok(session);
            }
            catch (MonitoringAccessException ex)
            {
                return MonitoringError(ex);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "MonitoringController: get failed for job {0}, child {1}: {2}",
                    jobId, childId, ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while reading the monitoring session.");
            }
        }

        // POST api/monitoring/session/end   body: { "jobId": 171, "childId": 27 }
        // Ends the Active session for the child (Status='Ended', EndedAtUtc=UTC now).
        // Clients pass job + child, never raw session ids, so a session cannot be
        // ended by id guessing (IDOR). 404 when no Active session exists.
        [HttpPost]
        [Route("session/end")]
        public IHttpActionResult EndSession([FromBody] EndMonitoringSessionRequest request)
        {
            if (request == null)
                return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            try
            {
                var session = _monitoringService.EndSession(
                    request.JobId,
                    request.ChildId,
                    ClaimsPrincipalHelper.GetUserId(),
                    ClaimsPrincipalHelper.GetRole());
                return Ok(session);
            }
            catch (MonitoringAccessException ex)
            {
                return MonitoringError(ex);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                Trace.TraceError(
                    "MonitoringController: end failed for job {0}, child {1}: {2}",
                    request.JobId, request.ChildId, ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while ending the monitoring session.");
            }
        }

        // =================================================================
        // PHASE 5 + 6 — CRY INCIDENT ENDPOINTS
        // -----------------------------------------------------------------
        // The client (YAMNet detector running in the monitoring page) reports
        // "cry detected"; the SERVER owns creation time, escalation stage,
        // deadlines, deduplication, acknowledgement, resolution and cancellation.
        // Every endpoint below runs the same centralized MonitoringAccess chain,
        // takes the caller identity from the bearer token and passes ONLY job +
        // child from the body.
        //
        // SECURITY BOUNDARY — CRY *DETECTION* IS A MONITOR-DEVICE-ONLY ACTION.
        // MonitoringAccess deliberately admits BOTH the guardian and the assigned
        // sitter as legitimate monitoring participants, so on its own it can NOT
        // distinguish "may watch this child" from "may report that this child is
        // crying". Reporting a cry creates a CryAlert incident that pages the
        // sitter and escalates to the parent, so a forged report is a safety-
        // relevant action, not a read. CreateCryIncident therefore refuses every
        // ordinary account bearer token outright and accepts only the dedicated
        // monitoring-device credential (X-Monitor-Device), which is issued at
        // pairing time and validated by the same rules as the independent flow:
        // hashed credential, not revoked, not expired, session Active, and the
        // device's child must match the requested child.
        //
        // The job-scoped device credential is PHASE-BOUNDARY-DEFERRED: the
        // existing MonitoringDeviceSession table is bound by a NOT NULL foreign
        // key to IndependentMonitoringSession, and that table has no Job_ID, so
        // reusing it here would require new tables/columns (forbidden by the
        // "no schema change" rule). Until that phase lands, the correct and
        // secure behaviour is to fail closed for everyone on this endpoint.
        //
        // NOTE - CryAlert *viewing* and the sitter *response* endpoints below
        // are deliberately NOT restricted. Receiving an alert, and answering
        // "I'm going to the child" / "With child", are the sitter's actual job.
        // Only the act of DETECTING and creating the incident is restricted.
        // =================================================================

        // POST api/monitoring/cry   body: { "jobId": 171, "childId": 27 }
        // Creates the cry incident for the ACTIVE session of this child, or
        // returns the already-open incident (dedupe: one active incident per
        // job+child+session, so a repeatedly firing detector cannot create a
        // burst of incidents or an escalation storm).
        [HttpPost]
        [Route("cry")]
        public IHttpActionResult CreateCryIncident([FromBody] CryIncidentRequest request)
        {
            if (request == null)
                return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            // Fail closed for ordinary accounts. MonitoringAccess cannot express
            // "may detect" (it answers "may observe"), so this check deliberately
            // runs BEFORE it: a caller must present a valid, unrevoked, unexpired
            // monitoring-device credential whose child matches the requested
            // child. A parent or sitter bearer token - or any other authenticated
            // user - is refused here, so hiding the detector in the UI is a
            // convenience rather than the security control.
            //
            // The job-scoped device credential is deferred (see the note above);
            // until it exists this endpoint admits no one, which is the intended
            // secure state rather than a temporary loophole.
            if (!TryAuthorizeMonitorDeviceCry(request.ChildId, out string cryDenial))
                return Content(HttpStatusCode.Forbidden, cryDenial);

            return CryAction(
                () => _cryIncidentService.CreateIncident(
                    request.JobId, request.ChildId, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()),
                "create failed for job " + request.JobId + ", child " + request.ChildId);
        }

        /// <summary>
        /// Validates the dedicated monitoring-device credential for a cry report.
        ///
        /// A normal account bearer must never double as a Phone-2 credential, so
        /// the presence of an Authorization header is an immediate refusal - the
        /// same identity separation IndependentMonitoringController.AuthorizeDevice
        /// enforces. The credential itself is compared by SHA-256 hash, and the
        /// session must still be Active, the device unrevoked and unexpired, and
        /// bound to the same child being reported. The job/child relationship is
        /// then re-checked by the normal MonitoringAccess chain inside CryAction,
        /// so a device credential still cannot be used to reach another family.
        /// </summary>
        private bool TryAuthorizeMonitorDeviceCry(int childId, out string denial)
        {
            denial = null;

            if (Request == null)
            {
                denial = "Cry detection is only available to an authorised monitoring device.";
                return false;
            }

            // An ordinary account session is never a device credential.
            if (Request.Headers.Authorization != null)
            {
                denial = "Cry detection is only available to an authorised monitoring device.";
                return false;
            }

            IEnumerable<string> values;
            if (!Request.Headers.TryGetValues("X-Monitor-Device", out values))
            {
                denial = "Cry detection is only available to an authorised monitoring device.";
                return false;
            }

            string token = values.FirstOrDefault();
            if (string.IsNullOrWhiteSpace(token) || token.Length != 64)
            {
                denial = "Cry detection is only available to an authorised monitoring device.";
                return false;
            }

            string hash;
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                hash = BitConverter.ToString(
                    sha.ComputeHash(Encoding.UTF8.GetBytes(token)))
                    .Replace("-", string.Empty).ToLowerInvariant();
            }

            int matching;
            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            {
                // Same validity rules as the independent device flow, plus the
                // explicit child match so one device cannot report another child.
                matching = db.Database.SqlQuery<int>(
                    @"SELECT COUNT(*) FROM dbo.MonitoringDeviceSession d
                      JOIN dbo.IndependentMonitoringSession s
                        ON s.IndependentMonitoringSession_ID = d.IndependentMonitoringSession_ID
                      JOIN dbo.Child c ON c.Child_ID = s.Child_ID AND c.IsDeleted = 0
                      WHERE d.CredentialHash = @p0
                        AND d.RevokedAtUtc IS NULL
                        AND d.ExpiresAtUtc > GETUTCDATE()
                        AND s.Status = 'Active'
                        AND s.IsDeleted = 0
                        AND s.Child_ID = @p1", hash, childId).Single();
            }

            if (matching == 0)
            {
                // One message for every failure so the endpoint cannot be used to
                // probe whether a credential exists or which child it belongs to.
                denial = "Cry detection is only available to an authorised monitoring device.";
                return false;
            }

            return true;
        }

        // GET api/monitoring/cry?jobId=171&childId=27
        // Returns the ACTIVE incident (escalation running) or the latest incident
        // as history. This is also the "view child" read: looking at the incident
        // NEVER changes the escalation timeline, so View Child is a pure read and
        // deliberately has no state-changing endpoint. It also drives the
        // sweep-on-poll fallback for the caller's own session.
        [HttpGet]
        [Route("cry")]
        public IHttpActionResult GetCryIncident(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0)
                return BadRequest("jobId and childId must be positive integers.");

            return CryAction(
                () => _cryIncidentService.GetIncident(
                    jobId, childId, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()),
                "read failed for job " + jobId + ", child " + childId);
        }

        // POST api/monitoring/cry/going-to-child   body: { "jobId": 171, "childId": 27 }
        // Sitter action "I'm going to the child": acknowledges the incident and
        // postpones the PARENT escalation to max(created+15s, response+10s).
        // Repeated calls are idempotent — the deadline is never extended twice.
        [HttpPost]
        [Route("cry/going-to-child")]
        public IHttpActionResult SitterGoingToChild([FromBody] CryIncidentRequest request)
        {
            if (request == null)
                return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            return CryAction(
                () => _cryIncidentService.SitterGoingToChild(
                    request.JobId, request.ChildId, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()),
                "going-to-child failed for job " + request.JobId + ", child " + request.ChildId);
        }

        // POST api/monitoring/cry/with-child   body: { "jobId": 171, "childId": 27 }
        // Sitter action "with child": resolves the incident (terminal) and stops all
        // further escalation. Resolving twice is a no-op, and a cancelled incident
        // can never be resolved (400).
        [HttpPost]
        [Route("cry/with-child")]
        public IHttpActionResult SitterWithChild([FromBody] CryIncidentRequest request)
        {
            if (request == null)
                return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            return CryAction(
                () => _cryIncidentService.SitterWithChild(
                    request.JobId, request.ChildId, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()),
                "with-child failed for job " + request.JobId + ", child " + request.ChildId);
        }

        /// <summary>
        /// Shared, thin execution wrapper for the cry actions: one place that maps
        /// the service's exception contract to HTTP statuses (403/404 for access
        /// denials via MonitoringError, 400 for bad input / illegal state change)
        /// and that never leaks exception details to the client (Phase 1 Fix B).
        /// </summary>
        private IHttpActionResult CryAction(Func<CryIncidentDto> action, string failureMessage)
        {
            try
            {
                return Ok(action());
            }
            catch (MonitoringAccessException ex)
            {
                return MonitoringError(ex);
            }
            catch (CryIncidentService.CryDetectionPausedException ex)
            {
                // Phase 12: a cry claim arrived while an approved parent pause is
                // active. This is a STATE conflict, not an authorization failure,
                // so 409 (not 403) is returned and the message explains what is
                // actually happening instead of surfacing a generic error.
                return Content(HttpStatusCode.Conflict, new
                {
                    error = "paused",
                    message = ex.Message,
                    pauseExpiresAtUtc = ex.PauseExpiresAtUtc
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                // Domain state conflict (e.g. "a cancelled incident cannot be resolved").
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                Trace.TraceError("MonitoringController: cry " + failureMessage + ": {0}", ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while processing the cry incident.");
            }
        }

        // POST api/monitoring/ops/sweep?max=50     header: X-Ops-Sweep-Key: <MonitoringOpsSweepKey>
        // OPERATIONS-ONLY escalation sweeper. It claims and processes every cry
        // alert that is due, so it must NOT be reachable by ordinary parents or
        // sitters (it would touch other tenants' incidents). Protection:
        //   * [AllowAnonymous] removes the user-token requirement on purpose — the
        //     caller is an operator/SQL Agent, not a signed-in user;
        //   * the shared secret from Web.config MonitoringOpsSweepKey is required
        //     in the X-Ops-Sweep-Key header and compared in constant time;
        //   * FAIL CLOSED (503) when no key is configured on the server.
        // The endpoint is idempotent for an already-processed stage thanks to the
        // atomic claim, so calling it every minute (or twice at once) is safe.
        [HttpPost]
        [Route("ops/sweep")]
        [AllowAnonymous]
        public IHttpActionResult OpsSweep(int max = 50)
        {
            string configuredKey = ConfigurationManager.AppSettings["MonitoringOpsSweepKey"];
            if (string.IsNullOrWhiteSpace(configuredKey))
            {
                // Fail closed: a deployment without the key must not expose the sweeper.
                return Content(HttpStatusCode.ServiceUnavailable,
                    "The escalation sweeper is not configured on this server.");
            }

            IEnumerable<string> providedValues;
            string providedKey = Request.Headers.TryGetValues("X-Ops-Sweep-Key", out providedValues)
                ? providedValues.FirstOrDefault()
                : null;

            if (string.IsNullOrEmpty(providedKey) || !FixedTimeEquals(providedKey, configuredKey))
            {
                // Never hint at the expected value or whether it was "close".
                return Content(HttpStatusCode.Unauthorized,
                    "A valid X-Ops-Sweep-Key header is required.");
            }

            if (max <= 0)
                return BadRequest("max must be a positive integer.");

            try
            {
                return Ok(_cryIncidentService.ProcessDueEscalations(max));
            }
            catch (Exception ex)
            {
                Trace.TraceError("MonitoringController: ops sweep failed: {0}", ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while processing due escalations.");
            }
        }

        /// <summary>
        /// Constant-time string comparison for the ops key. A plain string compare
        /// stops at the first differing character, which leaks the secret through
        /// response timing; this version mixes every byte before deciding.
        /// </summary>
        private static bool FixedTimeEquals(string left, string right)
        {
            byte[] a = Encoding.UTF8.GetBytes(left ?? string.Empty);
            byte[] b = Encoding.UTF8.GetBytes(right ?? string.Empty);
            int diff = a.Length ^ b.Length;
            for (int i = 0; i < a.Length && i < b.Length; i++)
                diff |= a[i] ^ b[i];
            return diff == 0;
        }

        // =================================================================
        // PHASE 7 - GUARDIAN CONNECTION / PARENT PAUSE / PARENT DND
        // ---------------------------------------------------------------------
        // Every endpoint below is [SessionAuthorize] and takes the acting user
        // ONLY from the bearer token via ClaimsPrincipalHelper. No Phase 7
        // request DTO carries an acting user, an approver, a DND owner, a
        // duration or an expiry, so a hostile client has no field it could
        // forge - the rule is structural, not a check.
        //
        // The controller stays THIN: it validates the body shape, calls the
        // service and maps exceptions to HTTP. All authorization lives in the
        // service (MonitoringAccess + the guardian rules).
        // =================================================================

        // POST api/monitoring/guardian-invitations
        // body: { "childId": 27, "identifier": "father.username", "relation": "Father" }
        // INPUT: child + the invitee's username/email. NEVER a Parent_ID.
        // IDENTITY: the inviter is the token's user.
        // OUTPUT 200: the created Pending invitation (no token, no hash).
        // FAILURES: 400 invalid body / no matching account / self-invite /
        //           duplicate guardian / duplicate pending invitation,
        //           403 not a guardian of that child, 404 unknown child.
        [HttpPost]
        [Route("guardian-invitations")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult CreateGuardianInvitation([FromBody] CreateGuardianInvitationRequest request)
        {
            if (request == null)
                return BadRequest("Request body is required.");
            if (request.ChildId <= 0)
                return BadRequest("ChildId must be a positive integer.");

            return FamilyAction(() => _guardianConnectionService.CreateInvitation(
                request.ChildId, request.Identifier, request.Relation,
                ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // GET api/monitoring/guardian-invitations
        // Returns ONLY the authenticated account's invitations. There is no
        // parentId/userId query parameter on purpose: one parent can never list
        // another parent's invitations.
        [HttpGet]
        [Route("guardian-invitations")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetGuardianInvitations()
        {
            return FamilyAction(() => _guardianConnectionService.GetInvitationsForCurrentUser(
                ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // POST api/monitoring/guardian-invitations/{id}/accept
        // Atomic: the ChildGuardian row and the Accepted status are written in
        // one transaction. Ownership is enforced server-side - the invitation
        // must be addressed to the CALLER.
        [HttpPost]
        [Route("guardian-invitations/{id:int}/accept")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult AcceptGuardianInvitation(int id)
        {
            return FamilyAction(() => _guardianConnectionService.AcceptInvitation(
                id, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // POST api/monitoring/guardian-invitations/{id}/reject
        [HttpPost]
        [Route("guardian-invitations/{id:int}/reject")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult RejectGuardianInvitation(int id)
        {
            return FamilyAction(() => _guardianConnectionService.RejectInvitation(
                id, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // DELETE api/monitoring/guardian-invitations/{id}
        // Only the account that SENT the invitation may withdraw it.
        [HttpDelete]
        [Route("guardian-invitations/{id:int}")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult CancelGuardianInvitation(int id)
        {
            return FamilyAction(() => _guardianConnectionService.CancelInvitation(
                id, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // GET api/monitoring/guardians?jobId=&childId=
        // Connected guardians of a child, read from ChildGuardian only.
        [HttpGet]
        [Route("guardians")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetGuardians(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0)
                return BadRequest("jobId and childId must be positive integers.");

            return FamilyAction(() => _guardianConnectionService.GetGuardians(
                jobId, childId, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // POST api/monitoring/pause   body: { "jobId": 171, "childId": 29 }
        // Records a REQUEST only. No incident is cancelled and monitoring keeps
        // running until a DIFFERENT guardian with CanApprovePause approves.
        [HttpPost]
        [Route("pause")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult RequestPause([FromBody] MonitoringPauseRequest request)
        {
            if (request == null) return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            return FamilyAction(() => _guardianConnectionService.RequestPause(
                request.JobId, request.ChildId,
                ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // POST api/monitoring/pause/{id}/approve
        // The window is ALWAYS exactly 150 seconds, computed by the server. The
        // approver must be a different guardian holding CanApprovePause.
        // Side effect: the active cry incident is cancelled (ParentPauseApproved).
        [HttpPost]
        [Route("pause/{id:int}/approve")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult ApprovePause(int id)
        {
            return FamilyAction(() => _guardianConnectionService.ApprovePause(
                id, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // POST api/monitoring/pause/{id}/deny  (never touches CryAlert)
        [HttpPost]
        [Route("pause/{id:int}/deny")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult DenyPause(int id)
        {
            return FamilyAction(() => _guardianConnectionService.DenyPause(
                id, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // DELETE api/monitoring/pause/{id}  (own PENDING request only)
        [HttpDelete]
        [Route("pause/{id:int}")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult CancelPause(int id)
        {
            return FamilyAction(() => _guardianConnectionService.CancelPause(
                id, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // GET api/monitoring/pause?jobId=&childId=
        // Resolves Approved -> Expired lazily when the window has passed.
        [HttpGet]
        [Route("pause")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetPause(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0)
                return BadRequest("jobId and childId must be positive integers.");

            return FamilyAction(() => _guardianConnectionService.GetPause(
                jobId, childId, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // POST api/monitoring/dnd   body: { "jobId": 171, "childId": 29 }
        // Enables the CALLER's own DND for a server-chosen bounded window. The
        // owner is the token's user: there is no UserId field to forge. Refused
        // when another guardian already has DND on this session (enforced by a
        // transaction, not by the UI). NEVER suppresses a Notification and
        // NEVER touches the cry incident.
        [HttpPost]
        [Route("dnd")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult EnableDnd([FromBody] MonitoringDndRequest request)
        {
            if (request == null) return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            return FamilyAction(() => _guardianConnectionService.EnableDnd(
                request.JobId, request.ChildId,
                ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // DELETE api/monitoring/dnd  - the caller's own DND only.
        [HttpDelete]
        [Route("dnd")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult DisableDnd([FromBody] MonitoringDndRequest request)
        {
            if (request == null) return BadRequest("Request body is required.");
            if (request.JobId <= 0 || request.ChildId <= 0)
                return BadRequest("JobId and ChildId must be positive integers.");

            return FamilyAction(() => _guardianConnectionService.DisableDnd(
                request.JobId, request.ChildId,
                ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // GET api/monitoring/dnd?jobId=&childId=  (expired DND reads as inactive)
        [HttpGet]
        [Route("dnd")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetDndStates(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0)
                return BadRequest("jobId and childId must be positive integers.");

            return FamilyAction(() => _guardianConnectionService.GetDndStates(
                jobId, childId, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
        }

        // =====================================================================
        // PHASE 11 - MEDIA (live baby video) and guardian-aware DISCOVERY
        // =====================================================================
        // Both are thin wrappers. Neither makes an authorization decision of its
        // own: they delegate to MonitoringAccess inside the service, so
        // "who may watch this baby" stays answerable in exactly one place.

        // GET api/monitoring/media?jobId=&childId=
        //
        // PURPOSE       Issue (or refuse) a server-signed media session for one
        //               monitoring scope, so the browser never holds a provider
        //               secret and never decides that a room exists.
        // AUTH          [SessionAuthorize]; MonitoringAccess decides the caller.
        //               The participant role is derived server-side, so a sitter
        //               is always receive-only.
        // REQUEST       jobId, childId (scope only - no actor, no role, no token).
        // RESPONSE      MonitoringMediaDto. Configured=false + Reason is a valid,
        //               expected 200 while no provider credentials exist; the UI
        //               then shows an honest "live video unavailable" state.
        // FAILURE       400 bad ids, 403/404 when MonitoringAccess denies,
        //               404 when there is no ACTIVE monitoring session.
        // STATE IMPACT  None - creates no session and writes nothing.
        [HttpGet]
        [Route("media")]
        [SessionAuthorize]
        public IHttpActionResult GetMonitoringMedia(int jobId, int childId)
        {
            if (jobId <= 0 || childId <= 0)
                return BadRequest("jobId and childId must be positive integers.");

            var media = new MediaSessionService();
            try
            {
                return Ok(media.GetMediaSession(jobId, childId,
                    ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
            }
            catch (MonitoringAccessException ex) { return MonitoringError(ex); }
            catch (KeyNotFoundException) { return NotFound(); }
            catch (ArgumentException ex) { return BadRequest(ex.Message); }
            catch (Exception ex)
            {
                Trace.TraceError("MonitoringController: media request failed: {0}", ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while preparing the live video session.");
            }
            finally { media.Dispose(); }
        }

        // GET api/monitoring/accessible-scopes
        //
        // PURPOSE       Tell the UI which (job, child) pairs THIS user may monitor
        //               right now. This fixes the co-parent gap: a guardian of
        //               another parent's child is authorized by MonitoringAccess,
        //               but the old screen could only discover jobs it owned.
        // AUTH          [SessionAuthorize]. DISCOVERY ONLY - it grants nothing.
        // REQUEST       none (the caller comes from the bearer token).
        // RESPONSE      AccessibleMonitoringScopeDto[].
        // FAILURE       400 when the authenticated id is missing.
        // STATE IMPACT  None - read-only.
        [HttpGet]
        [Route("accessible-scopes")]
        [SessionAuthorize]
        public IHttpActionResult GetAccessibleScopes()
        {
            var service = new AccessibleScopeService();
            try
            {
                return Ok(service.GetAccessibleScopes(
                    ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()));
            }
            catch (ArgumentException ex) { return BadRequest(ex.Message); }
            catch (Exception ex)
            {
                Trace.TraceError("MonitoringController: accessible scopes failed: {0}", ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while loading your monitoring sessions.");
            }
            finally { service.Dispose(); }
        }

        /// <summary>
        /// Phase 7 execution wrapper: one place that maps the guardian/pause/DND
        /// service contract to HTTP status. 403 for access denials, 404 for a
        /// missing target, 400 for a business-rule or validation refusal, and a
        /// generic 500 that never leaks exception details (Phase 1 Fix B).
        /// </summary>
        private IHttpActionResult FamilyAction<T>(Func<T> action)
        {
            try
            {
                return Ok(action());
            }
            catch (MonitoringAccessException ex)
            {
                return MonitoringError(ex);
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                // Business-rule refusal: self-invite, duplicate relationship,
                // self-approval, another parent already DND, ...
                return Content(HttpStatusCode.BadRequest, ex.Message);
            }
            catch (Exception ex)
            {
                Trace.TraceError("MonitoringController: phase 7 family/pause/dnd action failed: {0}", ex);
                return Content(HttpStatusCode.InternalServerError,
                    "A server error occurred while processing the request.");
            }
        }

        /// <summary>
        /// Maps a structured monitoring denial to its HTTP status:
        /// *NotFound denials are true 404s; everything else is 403 Forbidden.
        /// The message is the fixed, user-safe text from MonitoringAccessException.
        /// </summary>
        private IHttpActionResult MonitoringError(MonitoringAccessException ex)
        {
            switch (ex.Denial)
            {
                case MonitoringDenial.JobNotFound:
                case MonitoringDenial.ChildNotFound:
                case MonitoringDenial.SessionNotFound:
                case MonitoringDenial.IncidentNotFound:
                    return NotFound();
                default:
                    // InvalidRole / JobNotInProgress / ChildNotInJob /
                    // NotAssignedSitter / NotGuardian / SessionMismatch
                    return Content(HttpStatusCode.Forbidden, ex.Message);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (_monitoringService is IDisposable monitoring)
                    monitoring.Dispose();
                if (_cryIncidentService is IDisposable incidents)
                    incidents.Dispose();
                if (_guardianConnectionService is IDisposable guardians)
                    guardians.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
