using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Web;
using System.Web.Http;
using System.Web.Http.Cors;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [RoutePrefix("api/parent")]
    // CORS (Phase 1 Fix C): intentionally NO per-controller [EnableCors] here.
    // A per-controller attribute would override the single global config-driven
    // policy in WebApiConfig.Register (Web.config key "AllowedCorsOrigins") —
    // that is exactly how wildcard ("*","*","*") CORS survived before Phase 1.
    [SessionAuthorize(Roles = "Parent")]
    public class ChildrenController : ApiController
    {
        private readonly IChildService _childService;

        public ChildrenController() : this(new ChildService())
        {
        }

        public ChildrenController(IChildService childService)
        {
            _childService = childService ?? throw new ArgumentNullException(nameof(childService));
        }

        // ---------------- UPDATE CHILD (multipart) ----------------
        [HttpPut]
        [Route("child/{childId}")]
        public IHttpActionResult UpdateChild(int childId)
        {
            if (childId <= 0)
                return BadRequest("Child ID must be a positive integer.");

            var currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");

            var httpRequest = HttpContext.Current.Request;
            if (httpRequest == null || httpRequest.Form == null)
                return BadRequest("Request body is required.");

            try
            {
                var result = _childService.UpdateChild(childId, httpRequest, currentUserId);
                return Ok(new { message = "Child updated successfully", childId = result.ChildId });
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
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        // ---------------- B6: SOFT DELETE CHILD ----------------
        [HttpDelete]
        [Route("child/{childId}")]
        public IHttpActionResult DeleteChild(int childId)
        {
            if (childId <= 0)
                return BadRequest("Child ID must be a positive integer.");

            var currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");

            try
            {
                _childService.DeleteChild(childId, currentUserId);
                return Ok(new { message = "Child deleted successfully." });
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }
    }
}
