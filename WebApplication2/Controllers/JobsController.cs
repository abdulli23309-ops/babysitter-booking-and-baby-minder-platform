using System;
using System.Collections.Generic;
using System.Net;
using System.Web.Http;
using System.Web.Http.Cors;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [RoutePrefix("api/jobs")]
    [EnableCors(origins: "*", headers: "*", methods: "*")]
    [SessionAuthorize] // B5: all job endpoints require a valid session token (both roles may browse open jobs)
    public class JobsController : ApiController
    {
        private readonly IJobService _jobService;

        public JobsController() : this(new JobService())
        {
        }

        public JobsController(IJobService jobService)
        {
            _jobService = jobService ?? throw new ArgumentNullException(nameof(jobService));
        }

        // ── GET /api/jobs?city=Islamabad ──────────────────────────────────────
        // Returns only unassigned (open) jobs, each with their full SlotIds array.
        [HttpGet]
        [Route("")]
        public IHttpActionResult GetJobs(string city = null)
        {
            try
            {
                var result = _jobService.GetOpenJobs(city);
                return Ok(result);
            }
            catch (Exception ex)
            {
                return InternalServerError(ex);
            }
        }

        // ── GET /api/jobs/jobdetails/{jobId} ──────────────────────────────────
        [HttpGet]
        [Route("jobdetails/{jobId}")]
        public IHttpActionResult GetJobDetails(int jobId)
        {
            if (jobId <= 0)
                return BadRequest("Job ID must be a positive integer.");

            try
            {
                var details = _jobService.GetJobDetails(jobId);
                if (details == null)
                    return NotFound();

                return Ok(details);
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return InternalServerError(ex);
            }
        }

        [HttpPost]
        [Route("confirm-bulk")]
        public IHttpActionResult ConfirmJobsBulk([FromBody] BulkConfirmDto dto)
        {
            if (dto == null)
                return BadRequest("Request body is required.");
            if (dto.SitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");
            if (dto.JobIds == null || dto.JobIds.Count == 0)
                return BadRequest("No jobs provided.");

            // B5 RBAC + IDOR: only Sitters may confirm jobs, and only for themselves.
            if (ClaimsPrincipalHelper.GetRole() != UserRole.Sitter.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != dto.SitterId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only confirm jobs for your own account.");

            try
            {
                int confirmedCount = _jobService.ConfirmJobsBulk(dto.SitterId, dto.JobIds);
                return Ok(new { message = $"{confirmedCount} jobs confirmed." });
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest(ex.Message);
            }
        }

        // ── POST /api/jobs/confirm/{jobId}/{sitterId} ─────────────────────────
        // Called when a sitter accepts a job
        [HttpPost]
        [Route("confirm/{jobId}/{sitterId}")]
        public IHttpActionResult ConfirmJob(int jobId, int sitterId)
        {
            if (jobId <= 0 || sitterId <= 0)
                return BadRequest("Job ID and Sitter ID must be positive integers.");

            try
            {
                // B5 RBAC + IDOR: a Sitter may only accept a job for themselves.
                if (ClaimsPrincipalHelper.GetRole() != UserRole.Sitter.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != sitterId)
                    return Content(HttpStatusCode.Forbidden, "Access denied: you may only confirm jobs for your own account.");

                _jobService.ConfirmJob(jobId, sitterId);
                return Ok(new { message = "Job confirmed." });
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest(ex.Message);
            }
        }

        [HttpPost]
        [Route("updateStatus/{jobId}")]
        [Route("start-session/{jobId}")]
        [Route("start/{jobId}")]
        public IHttpActionResult UpdateJobStatus(int jobId, [FromBody] JobStatusUpdateDto dto)
        {
            if (jobId <= 0)
                return BadRequest("Job ID must be a positive integer.");

            var role = ClaimsPrincipalHelper.GetRole();
            var userId = ClaimsPrincipalHelper.GetUserId();

            try
            {
                var result = _jobService.UpdateJobStatus(jobId, dto?.Status, role, userId);
                return Ok(new
                {
                    message = result.Message,
                    jobId = result.JobId,
                    status = result.Status,
                    assignedSitterId = result.AssignedSitterId,
                    parentId = result.ParentId
                });
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest(ex.Message);
            }
        }

        [HttpGet]
        [Route("sitter/{sitterId}")]
        public IHttpActionResult GetSitterJobs(int sitterId)
        {
            if (sitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");

            // B5 IDOR: a Sitter may only list their own assigned jobs.
            if (ClaimsPrincipalHelper.GetRole() != UserRole.Sitter.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != sitterId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only view your own jobs.");

            try
            {
                var jobs = _jobService.GetSitterJobs(sitterId);
                return Ok(jobs);
            }
            catch (Exception ex)
            {
                return BadRequest(ex.Message);
            }
        }

        // GET api/jobs/active
        // GET api/jobs/active?babysitterId=19
        [HttpGet]
        [Route("active")]
        public IHttpActionResult GetActiveJobForSitter(int? babysitterId = null)
        {
            try
            {
                var role = ClaimsPrincipalHelper.GetRole();
                var currentUserId = ClaimsPrincipalHelper.GetUserId();

                var activeJob = _jobService.GetActiveJob(role, currentUserId, babysitterId);
                if (activeJob == null)
                    return NotFound();

                return Ok(activeJob);
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return InternalServerError(ex);
            }
        }

        // ── GET /api/jobs/series/{seriesId} ─────────────────────────────────
        // Phase 8D: every day of a series, for the pagination sibling list.
        // Sits under the controller-level [SessionAuthorize]; participation in
        // the series is enforced by the service (returns null -> 403 here).
        [HttpGet]
        [Route("series/{seriesId}")]
        public IHttpActionResult GetSeriesJobs(int seriesId)
        {
            if (seriesId <= 0)
                return BadRequest("Series ID must be a positive integer.");

            var role = ClaimsPrincipalHelper.GetRole();
            var userId = ClaimsPrincipalHelper.GetUserId();

            try
            {
                var result = _jobService.GetSeriesJobs(seriesId, userId, role);
                if (result == null)
                    return Content(HttpStatusCode.Forbidden, "Not your series.");
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return InternalServerError(ex);
            }
        }

        // ── POST /api/jobs/decline-day/{jobId} ──────────────────────────────────
        // Phase 8D: a sitter releases ONE assigned day of a series back to Open.
        // Only the assigned sitter may call it (B5 RBAC + IDOR), and the service
        // enforces the 3-hour notice window and the 3-declines-per-series cap.
        [HttpPost]
        [Route("decline-day/{jobId}")]
        public IHttpActionResult DeclineDay(int jobId)
        {
            if (jobId <= 0)
                return BadRequest("Job ID must be a positive integer.");

            var role = ClaimsPrincipalHelper.GetRole();
            var userId = ClaimsPrincipalHelper.GetUserId();

            try
            {
                var result = _jobService.DeclineDayAsync(jobId, userId, role).Result;
                if (!result.Success)
                    return BadRequest(result.Message);
                return Ok(new { message = result.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest(ex.Message);
            }
        }


        // POST /api/jobs/terminate-series/{jobId}
        [HttpPost]
        [Route("terminate-series/{jobId}")]
        public IHttpActionResult TerminateSeries(int jobId, [FromBody] TerminateSeriesDto dto)
        {
            if (jobId <= 0) return BadRequest("Job ID must be a positive integer.");
            if (dto == null) return BadRequest("Body is required.");

            var role = ClaimsPrincipalHelper.GetRole();
            var userId = ClaimsPrincipalHelper.GetUserId();

            try
            {
                var result = _jobService.TerminateSeries(jobId, dto.Scope, role, userId);
                return Ok(new { message = result.Message, cancelledCount = result.Count });
            }
            catch (UnauthorizedAccessException ex)
                { return Content(HttpStatusCode.Forbidden, ex.Message); }
            catch (InvalidOperationException ex)
                { return BadRequest(ex.Message); }
            catch (ArgumentException ex)
                { return BadRequest(ex.Message); }
        }
    }

}