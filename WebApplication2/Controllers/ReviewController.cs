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
    [RoutePrefix("api/review")]
    [SessionAuthorize]
    public class ReviewController : ApiController
    {
        private readonly IReviewService _reviewService;

        public ReviewController() : this(new ReviewService())
        {
        }

        public ReviewController(IReviewService reviewService)
        {
            _reviewService = reviewService ?? throw new ArgumentNullException(nameof(reviewService));
        }

        [HttpPost]
        [Route("add")]
        public IHttpActionResult AddReview(ReviewDTO reviewDto)
        {
            if (reviewDto == null)
                return BadRequest("Review data is required.");
            if (reviewDto.Reviewer_ID <= 0 || reviewDto.ReviewFor_ID <= 0)
                return BadRequest("Reviewer and Reviewee IDs must be greater than zero.");
            if (reviewDto.Job_ID < 0)
                return BadRequest("Job ID cannot be negative.");
            if (reviewDto.ReviewerRole != UserRole.Parent.ToDisplayString() && reviewDto.ReviewerRole != UserRole.Sitter.ToDisplayString())
                return BadRequest("ReviewerRole must be 'Parent' or 'Sitter'.");
            if (reviewDto.ReviewForRole != UserRole.Parent.ToDisplayString() && reviewDto.ReviewForRole != UserRole.Sitter.ToDisplayString())
                return BadRequest("ReviewForRole must be 'Parent' or 'Sitter'.");
            if (reviewDto.Rating < 1 || reviewDto.Rating > 5)
                return BadRequest("Rating must be between 1 and 5.");
            if (reviewDto.Comment != null && reviewDto.Comment.Length > 2000)
                return BadRequest("Comment must not exceed 2000 characters.");

            // B5 RBAC/IDOR: the reviewer identity in the body must be the
            // authenticated user, and the role must match the token role.
            var currentUserId = ClaimsPrincipalHelper.GetUserId();
            var currentRole = ClaimsPrincipalHelper.GetRole();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            if (reviewDto.Reviewer_ID != currentUserId ||
                !string.Equals(reviewDto.ReviewerRole, currentRole, StringComparison.OrdinalIgnoreCase))
                return Content(HttpStatusCode.Forbidden, "You can only submit reviews as yourself.");

            try
            {
                var result = _reviewService.AddReview(reviewDto);
                return Ok(new { message = result.Message, success = result.Success });
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            // Phase 8c: the series gate (not-yet-finished, already-reviewed) and
            // the duplicate-series guard throw InvalidOperationException. Without
            // this catch they would fall through to the generic handler below and
            // surface as a 500, instead of the 400 the frontend expects.
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return InternalServerError(ex);
            }
        }

        [HttpGet]
        [AllowAnonymous] // aggregate rating, no personal data — public sitter profiles need it
        [Route("sitter/{sitterId}")]
        public IHttpActionResult GetSitterRating(int sitterId)
        {
            if (sitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");

            try
            {
                var avg = _reviewService.GetSitterRating(sitterId);
                return Ok(avg);
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

        [HttpGet]
        [AllowAnonymous] // aggregate rating, no personal data — public sitter profiles need it
        [Route("parent/{parentId}")]
        public IHttpActionResult GetParentRating(int parentId)
        {
            if (parentId <= 0)
                return BadRequest("Parent ID must be a positive integer.");

            try
            {
                var avgRating = _reviewService.GetParentRating(parentId);
                return Ok(avgRating);
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

        [HttpGet]
        [AllowAnonymous] // aggregate reviews for public profiles
        [Route("user/{userId}/{role}")]
        public IHttpActionResult GetUserReviews(int userId, string role)
        {
            if (userId <= 0)
                return BadRequest("User ID must be a positive integer.");
            if (string.IsNullOrWhiteSpace(role))
                return BadRequest("Role is required.");
            if (!string.Equals(role, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase) && !string.Equals(role, UserRole.Sitter.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
                return BadRequest("Role must be 'Parent' or 'Sitter'.");

            try
            {
                var result = _reviewService.GetUserReviews(userId, role);
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

        /// <summary>
        /// Phase 6.1 mutual reviews: every review on a single job. Session
        /// authorisation is inherited from the controller-level
        /// [SessionAuthorize], so only authenticated participants can read it.
        /// </summary>
        [HttpGet]
        [Route("job/{jobId:int}")]
        public IHttpActionResult GetJobReviews(int jobId)
        {
            if (jobId <= 0)
                return BadRequest("Job ID must be a positive integer.");

            try
            {
                var result = _reviewService.GetJobReviews(jobId);
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


        protected override void Dispose(bool disposing)
        {
            if (disposing && _reviewService is IDisposable disposable)
            {
                disposable.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
