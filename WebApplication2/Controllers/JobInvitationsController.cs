using System;
using System.Net;
using System.Web.Http;
using System.Web.Http.Cors;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [EnableCors(origins: "*", headers: "*", methods: "*")]
    [RoutePrefix("api/jobs")]
    [SessionAuthorize(Roles = "Parent")]
    public class JobInvitationsController : ApiController
    {
        private readonly IJobInvitationService _svc;

        public JobInvitationsController() : this(new JobInvitationService()) { }

        public JobInvitationsController(IJobInvitationService svc)
        {
            _svc = svc ?? throw new ArgumentNullException(nameof(svc));
        }

        [HttpPost, Route("{jobId}/invite")]
        public IHttpActionResult Invite(int jobId, [FromBody] InviteSittersDto dto)
        {
            if (jobId <= 0) return BadRequest("Job ID must be positive.");
            if (dto == null) return BadRequest("Request body required.");
            var current = ClaimsPrincipalHelper.GetUserId();
            if (current <= 0) return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            if (dto.ParentId != current) return Content(HttpStatusCode.Forbidden, "Not your job.");
            var result = _svc.Invite(jobId, dto);
            if (!result.Success) return BadRequest(result.Message);
            return Ok(new { message = result.Message });
        }

        [HttpGet, Route("{jobId}/invitations")]
        public IHttpActionResult GetInvitations(int jobId)
        {
            if (jobId <= 0) return BadRequest("Job ID must be positive.");
            var current = ClaimsPrincipalHelper.GetUserId();
            if (current <= 0) return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            var list = _svc.GetInvitationsForJob(jobId, current);
            return Ok(list);
        }

        [HttpPost, Route("{jobId}/hire")]
        public IHttpActionResult Hire(int jobId, [FromBody] HireSitterDto dto)
        {
            if (jobId <= 0) return BadRequest("Job ID must be positive.");
            if (dto == null) return BadRequest("Request body required.");
            var current = ClaimsPrincipalHelper.GetUserId();
            if (current <= 0) return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            if (dto.ParentId != current) return Content(HttpStatusCode.Forbidden, "Not your job.");
            var result = _svc.Hire(jobId, dto);
            if (!result.Success) return BadRequest(result.Message);
            return Ok(new { message = result.Message });
        }
    }
}