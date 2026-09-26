using System;
using System.Net;
using System.Web.Http;
using System.Web.Http.Cors;
using WebApplication2.Infrastructure;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [EnableCors(origins: "*", headers: "*", methods: "*")]
    [RoutePrefix("api/sitter/invitations")]
    [SessionAuthorize(Roles = "Sitter")]
    public class SitterInvitationsController : ApiController
    {
        private readonly IJobInvitationService _svc;

        public SitterInvitationsController() : this(new JobInvitationService()) { }

        public SitterInvitationsController(IJobInvitationService svc)
        {
            _svc = svc ?? throw new ArgumentNullException(nameof(svc));
        }

        [HttpGet, Route("")]
        public IHttpActionResult List()
        {
            var current = ClaimsPrincipalHelper.GetUserId();
            if (current <= 0) return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            var list = _svc.GetInvitationsForSitter(current);
            return Ok(list);
        }

        [HttpPost, Route("{id}/accept")]
        public IHttpActionResult Accept(int id)
        {
            if (id <= 0) return BadRequest("Invitation ID must be positive.");
            var current = ClaimsPrincipalHelper.GetUserId();
            if (current <= 0) return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            var result = _svc.Accept(id, current);
            if (!result.Success) return BadRequest(result.Message);
            return Ok(new { message = result.Message });
        }

        [HttpPost, Route("{id}/decline")]
        public IHttpActionResult Decline(int id)
        {
            if (id <= 0) return BadRequest("Invitation ID must be positive.");
            var current = ClaimsPrincipalHelper.GetUserId();
            if (current <= 0) return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            var result = _svc.Decline(id, current);
            if (!result.Success) return BadRequest(result.Message);
            return Ok(new { message = result.Message });
        }

        [HttpPost, Route("decline-by-job/{jobId}")]
        public IHttpActionResult DeclineByJob(int jobId)
        {
            if (jobId <= 0) return BadRequest("Job ID must be positive.");
            var current = ClaimsPrincipalHelper.GetUserId();
            if (current <= 0) return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            var result = _svc.DeclineByJob(jobId, current);
            if (!result.Success) return BadRequest(result.Message);
            return Ok(new { message = result.Message });
        }
    }
}
