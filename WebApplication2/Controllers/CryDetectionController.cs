using System;
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
    // CORS (Phase 1 Fix C): intentionally NO per-controller [EnableCors] here.
    // A per-controller attribute would override the single global config-driven
    // policy in WebApiConfig.Register (Web.config key "AllowedCorsOrigins") —
    // that is exactly how wildcard ("*","*","*") CORS survived before Phase 1.
    [RoutePrefix("api/cry-detection")]
    [SessionAuthorize]
    public class CryDetectionController : ApiController
    {
        private readonly ICryAlertService _cryAlertService;

        public CryDetectionController() : this(new CryAlertService())
        {
        }

        public CryDetectionController(ICryAlertService cryAlertService)
        {
            _cryAlertService = cryAlertService ?? throw new ArgumentNullException(nameof(cryAlertService));
        }

        // POST api/cry-detection
        [HttpPost]
        [Route("")]
        public IHttpActionResult PostCryAlert([FromBody] CryAlertDto dto)
        {
            if (dto == null)
                return BadRequest("Request body is required.");
            if (dto.ParentId <= 0 || dto.BabysitterId <= 0 || dto.JobId <= 0)
                return BadRequest("ParentId, BabysitterId, and JobId must be positive integers.");
            if (string.IsNullOrWhiteSpace(dto.Level))
                return BadRequest("Level is required.");
            if (dto.Level.Length > 50)
                return BadRequest("Level must not exceed 50 characters.");

            if (string.IsNullOrWhiteSpace(dto.Timestamp) || !DateTime.TryParse(dto.Timestamp, out DateTime parsedTimestamp))
                return BadRequest("A valid Timestamp is required.");

            // B5 IDOR: the alert must reference the authenticated participant.
            var currentUserId = ClaimsPrincipalHelper.GetUserId();
            var currentRole = ClaimsPrincipalHelper.GetRole();
            bool isInvolved =
                (currentRole == UserRole.Parent.ToDisplayString() && dto.ParentId == currentUserId) ||
                (currentRole == UserRole.Sitter.ToDisplayString() && dto.BabysitterId == currentUserId);
            if (!isInvolved)
                return Content(HttpStatusCode.Forbidden, "You can only raise alerts for your own bookings.");

            try
            {
                var result = _cryAlertService.PostCryAlert(dto, currentUserId, currentRole);
                return Ok(new { roomName = result.RoomName, message = result.Message });
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

        // GET api/cry-detection/latest?parentId=34
        [HttpGet]
        [Route("latest")]
        public IHttpActionResult GetLatest(int? parentId = null)
        {
            if (parentId.HasValue && parentId.Value <= 0)
                return BadRequest("Parent ID must be a positive integer.");

            try
            {
                // B5 IDOR: a Parent may only poll their own alerts; a Sitter gets
                // alerts for bookings they are assigned to (via job linkage).
                var currentUserId = ClaimsPrincipalHelper.GetUserId();
                var currentRole = ClaimsPrincipalHelper.GetRole();

                if (currentRole == UserRole.Parent.ToDisplayString())
                {
                    if (parentId.HasValue && parentId.Value != currentUserId)
                        return Content(HttpStatusCode.Forbidden, "You can only view your own alerts.");
                    parentId = currentUserId;
                }

                var alert = _cryAlertService.GetLatestAlert(currentUserId, currentRole, parentId);
                if (alert == null)
                    return NotFound();

                return Ok(new
                {
                    id = alert.Id,
                    timestamp = alert.Timestamp,
                    roomName = alert.RoomName,
                    level = alert.Level,
                    jobId = alert.JobId,
                    parentId = alert.ParentId,
                    babysitterId = alert.BabysitterId
                });
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

        protected override void Dispose(bool disposing)
        {
            if (disposing && _cryAlertService is IDisposable disposable)
            {
                disposable.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
