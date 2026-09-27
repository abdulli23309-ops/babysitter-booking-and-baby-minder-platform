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
    [RoutePrefix("api/bids")]
    // CORS (Phase 1 Fix C): intentionally NO per-controller [EnableCors] here.
    // A per-controller attribute would override the single global config-driven
    // policy in WebApiConfig.Register (Web.config key "AllowedCorsOrigins") —
    // that is exactly how wildcard ("*","*","*") CORS survived before Phase 1.
    [SessionAuthorize]
    public class BidsController : ApiController
    {
        private readonly IBidService _bidService;

        public BidsController() : this(new BidService())
        {
        }

        public BidsController(IBidService bidService)
        {
            _bidService = bidService ?? throw new ArgumentNullException(nameof(bidService));
        }

        [HttpPost]
        [Route("place")]
        [SessionAuthorize(Roles = "Sitter")]
        public IHttpActionResult PlaceBid([FromBody] PlaceBidDto dto)
        {
            if (dto == null)
                return BadRequest("Bid data is required.");

            if (dto.JobId <= 0 || dto.SitterId <= 0)
                return BadRequest("Job ID and Sitter ID must be positive integers.");

            if (dto.ProposedPrice <= 0)
                return BadRequest("Proposed price must be greater than zero.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (dto.SitterId != currentUserId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only place bids for your own account.");

            try
            {
                var result = _bidService.PlaceBid(dto, currentUserId);
                return Ok(new
                {
                    message = result.Message,
                    bidId = result.BidId
                });
            }
            catch (KeyNotFoundException ex)
            {
                return Content(HttpStatusCode.NotFound, ex.Message);
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
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpPost]
        [Route("accept/{bidId}")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult AcceptBid(int bidId)
        {
            if (bidId <= 0)
                return BadRequest("Bid ID must be a positive integer.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();

            try
            {
                var result = _bidService.AcceptBid(bidId, currentUserId);
                return Ok(new
                {
                    message = result.Message,
                    bidId = result.BidId,
                    jobId = result.JobId,
                    sitterId = result.SitterId
                });
            }
            catch (KeyNotFoundException ex)
            {
                return Content(HttpStatusCode.NotFound, ex.Message);
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpPost]
        [Route("reject/{bidId}")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult RejectBid(int bidId)
        {
            if (bidId <= 0)
                return BadRequest("Bid ID must be a positive integer.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();

            try
            {
                var result = _bidService.RejectBid(bidId, currentUserId);
                return Ok(new
                {
                    message = result.Message,
                    bidId = result.BidId
                });
            }
            catch (KeyNotFoundException ex)
            {
                return Content(HttpStatusCode.NotFound, ex.Message);
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpPost]
        [Route("withdraw/{bidId}")]
        [SessionAuthorize(Roles = "Sitter")]
        public IHttpActionResult WithdrawBid(int bidId)
        {
            if (bidId <= 0)
                return BadRequest("Bid ID must be a positive integer.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();

            try
            {
                var result = _bidService.WithdrawBid(bidId, currentUserId);
                return Ok(new
                {
                    message = result.Message,
                    bidId = result.BidId
                });
            }
            catch (KeyNotFoundException ex)
            {
                return Content(HttpStatusCode.NotFound, ex.Message);
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpGet]
        [Route("job/{jobId}")]
        public IHttpActionResult GetBidsForJob(int jobId)
        {
            if (jobId <= 0)
                return BadRequest("Job ID must be a positive integer.");

            string role = ClaimsPrincipalHelper.GetRole();
            int currentUserId = ClaimsPrincipalHelper.GetUserId();

            try
            {
                var bids = _bidService.GetBidsForJob(jobId, role, currentUserId);
                return Ok(bids);
            }
            catch (KeyNotFoundException ex)
            {
                return Content(HttpStatusCode.NotFound, ex.Message);
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

        [HttpGet]
        [Route("parent/{parentId}")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetBidsForParent(int parentId)
        {
            if (parentId <= 0)
                return BadRequest("Parent ID must be a positive integer.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (parentId != currentUserId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only view bids on your own jobs.");

            try
            {
                var bids = _bidService.GetBidsForParent(parentId);
                return Ok(bids);
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

        [HttpGet]
        [Route("sitter/{sitterId}")]
        [SessionAuthorize(Roles = "Sitter")]
        public IHttpActionResult GetBidsForSitter(int sitterId)
        {
            if (sitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (sitterId != currentUserId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only view your own bids.");

            try
            {
                var bids = _bidService.GetBidsForSitter(sitterId);
                return Ok(bids);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }
    }
}
