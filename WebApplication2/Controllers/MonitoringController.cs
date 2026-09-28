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
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    // CORS (Phase 1 Fix C): intentionally NO per-controller [EnableCors] here -
    // a per-controller attribute would replace the single global config-driven
    // policy in WebApiConfig.Register (same rule as CryDetectionController).
    [RoutePrefix("api/monitoring")]
    [SessionAuthorize]
    public class MonitoringController : ApiController
    {
        private readonly IMonitoringService _monitoringService;
        private readonly ICryIncidentService _cryIncidentService;

        public MonitoringController() : this(new MonitoringService(), new CryIncidentService())
        {
        }

        // Kept for compatibility with the Phase 3/4 verification harnesses, which
        // construct the controller with a single (shared-context) session service.
        public MonitoringController(IMonitoringService monitoringService)
            : this(monitoringService, new CryIncidentService())
        {
        }

        public MonitoringController(IMonitoringService monitoringService, ICryIncidentService cryIncidentService)
        {
            _monitoringService = monitoringService ?? throw new ArgumentNullException(nameof(monitoringService));
            _cryIncidentService = cryIncidentService ?? throw new ArgumentNullException(nameof(cryIncidentService));
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

            return CryAction(
                () => _cryIncidentService.CreateIncident(
                    request.JobId, request.ChildId, ClaimsPrincipalHelper.GetUserId(), ClaimsPrincipalHelper.GetRole()),
                "create failed for job " + request.JobId + ", child " + request.ChildId);
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
            }
            base.Dispose(disposing);
        }
    }
}
