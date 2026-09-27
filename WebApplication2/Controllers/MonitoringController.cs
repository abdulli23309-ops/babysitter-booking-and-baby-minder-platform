using System;
using System.Diagnostics;
using System.Net;
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

        public MonitoringController() : this(new MonitoringService())
        {
        }

        public MonitoringController(IMonitoringService monitoringService)
        {
            _monitoringService = monitoringService ?? throw new ArgumentNullException(nameof(monitoringService));
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
                    return NotFound();
                default:
                    // InvalidRole / JobNotInProgress / ChildNotInJob /
                    // NotAssignedSitter / NotGuardian / SessionMismatch
                    return Content(HttpStatusCode.Forbidden, ex.Message);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && _monitoringService is IDisposable disposable)
            {
                disposable.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
