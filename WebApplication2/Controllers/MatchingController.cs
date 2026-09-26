using System;
using System.Collections.Generic;
using System.Net;
using System.Web.Http;
using System.Web.Http.Cors;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [RoutePrefix("api/matching")]
    [EnableCors(origins: "*", headers: "*", methods: "*")]
    [SessionAuthorize]
    public class MatchingController : ApiController
    {
        private readonly IAvailabilityService _availabilityService;
        private readonly IMatchingService _matchingService;
        private readonly IRecurringAvailabilityService _recurringAvailabilityService;

        public MatchingController() : this(new AvailabilityService(), new MatchingService(), new RecurringAvailabilityService())
        {
        }

        public MatchingController(IAvailabilityService availabilityService, IMatchingService matchingService)
            : this(availabilityService, matchingService, new RecurringAvailabilityService())
        {
        }

        public MatchingController(IAvailabilityService availabilityService, IMatchingService matchingService, IRecurringAvailabilityService recurringAvailabilityService)
        {
            _availabilityService = availabilityService ?? throw new ArgumentNullException(nameof(availabilityService));
            _matchingService = matchingService ?? throw new ArgumentNullException(nameof(matchingService));
            _recurringAvailabilityService = recurringAvailabilityService ?? throw new ArgumentNullException(nameof(recurringAvailabilityService));
        }

        // ── GET matching sitters for a job ────────────────────────────────────
        [HttpGet]
        [Route("matches/{jobId}")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetMatchingSitters(int jobId)
        {
            if (jobId <= 0)
                return BadRequest("Job ID must be a positive integer.");

            try
            {
                int currentUserId = ClaimsPrincipalHelper.GetUserId();
                var result = _matchingService.GetMatchingSitters(jobId, currentUserId);
                return Ok(result);
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

        // ── POST save sitter availability ──────────────────────────────────────
        // Body: { sitterId, date, slotIds: [1,2,3], city }
        [HttpPost]
        [Route("availability/save")]
        [SessionAuthorize(Roles = "Sitter")]
        public IHttpActionResult SaveAvailability([FromBody] AvailabilityDto dto)
        {
            if (dto == null)
                return BadRequest("Request body is required.");
            if (dto.SitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");
            if (dto.SlotIds == null || dto.SlotIds.Count == 0)
                return BadRequest("At least one slot ID is required.");

            // B5 IDOR: a Sitter may only manage their own availability.
            if (dto.SitterId != ClaimsPrincipalHelper.GetUserId())
                return Content(HttpStatusCode.Forbidden, "You can only manage your own availability.");

            try
            {
                _availabilityService.SaveAvailability(dto);
                return Ok(new { message = "Availability saved." });
            }
            catch (Exception ex)
            {
                string msg = ex.Message;
                if (ex.InnerException != null)
                {
                    msg += " | Inner: " + ex.InnerException.Message;
                    if (ex.InnerException.InnerException != null)
                        msg += " | Inner2: " + ex.InnerException.InnerException.Message;
                }
                return BadRequest("Error: " + msg);
            }
        }

        // ── POST save recurring weekly availability (API-A Schedule concept) ────
        // Body: { sitterId, daysOfWeek: ["Monday", "Wednesday"], slotIds: [1,2,3], city, weeksAhead: 4 }
        [HttpPost]
        [Route("availability/recurring")]
        [SessionAuthorize(Roles = "Sitter")]
        public IHttpActionResult SaveRecurringAvailability([FromBody] RecurringAvailabilityDto dto)
        {
            if (dto == null)
                return BadRequest("Request body is required.");
            if (dto.SitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");
            if (dto.DaysOfWeek == null || dto.DaysOfWeek.Count == 0)
                return BadRequest("At least one day of the week must be specified.");
            if (dto.SlotIds == null || dto.SlotIds.Count == 0)
                return BadRequest("At least one slot ID is required.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (dto.SitterId != currentUserId)
                return Content(HttpStatusCode.Forbidden, "You can only manage your own availability.");

            try
            {
                var result = _recurringAvailabilityService.SaveRecurringWeeklyAvailability(dto, currentUserId);
                return Ok(result);
            }
            catch (KeyNotFoundException ex)
            {
                return Content(HttpStatusCode.NotFound, ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error saving recurring availability: " + ex.Message);
            }
        }

        // ── POST filter sitters by city + experience ───────────────────────────
        [HttpPost]
        [Route("filter-sitters")]
        public IHttpActionResult FilterSitters([FromBody] FilterSittersDTO filter)
        {
            if (filter == null)
                filter = new FilterSittersDTO();

            if (filter.MinExperience.HasValue && filter.MinExperience.Value < 0)
                return BadRequest("MinExperience cannot be negative.");
            if (filter.MinRating.HasValue && (filter.MinRating.Value < 0 || filter.MinRating.Value > 5))
                return BadRequest("MinRating must be between 0 and 5.");

            try
            {
                var sitters = _matchingService.FilterSitters(filter);
                return Ok(sitters);
            }
            catch (Exception ex)
            {
                return BadRequest(ex.Message);
            }
        }

        [HttpGet]
        [Route("availability/{sitterId}")]
        public IHttpActionResult GetSitterAvailability(int sitterId)
        {
            if (sitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");

            try
            {
                var rows = _availabilityService.GetSitterAvailability(sitterId);
                return Ok(rows);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpDelete]
        [Route("availability/clear/{sitterId}")]
        [SessionAuthorize(Roles = "Sitter")]
        public IHttpActionResult ClearAllAvailability(int sitterId)
        {
            if (sitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");

            try
            {
                // B5 IDOR: a Sitter may only clear their own availability.
                if (sitterId != ClaimsPrincipalHelper.GetUserId())
                    return Content(HttpStatusCode.Forbidden, "You can only clear your own availability.");

                _availabilityService.ClearAllAvailability(sitterId);
                return Ok(new { message = "All availability cleared." });
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpPost]
        [Route("search-sitters")]
        public IHttpActionResult SearchSitters([FromBody] SearchSittersDTO dto)
        {
            if (dto == null)
                return BadRequest("Request body is required.");

            try
            {
                // --- Validate inputs ---
                if (dto.MinRating < 0 || dto.MinRating > 5)
                    return BadRequest("MinRating must be between 0 and 5.");
                if (dto.MinExperienceYears.HasValue && dto.MinExperienceYears.Value < 0)
                    return BadRequest("MinExperienceYears cannot be negative.");
                if (string.IsNullOrWhiteSpace(dto.StartTime) || string.IsNullOrWhiteSpace(dto.EndTime))
                    return BadRequest("StartTime and EndTime are required.");

                TimeSpan startTimeParsed, endTimeParsed;
                if (!TimeSpan.TryParse(dto.StartTime.Trim(), out startTimeParsed))
                    return BadRequest($"Invalid StartTime format: '{dto.StartTime}'. Expected HH:mm.");
                if (!TimeSpan.TryParse(dto.EndTime.Trim(), out endTimeParsed))
                    return BadRequest($"Invalid EndTime format: '{dto.EndTime}'. Expected HH:mm.");

                if (startTimeParsed >= endTimeParsed)
                    return BadRequest("StartTime must be before EndTime.");

                if (!DateTime.TryParse(dto.StartDate, out DateTime startDate))
                    return BadRequest($"Invalid StartDate: '{dto.StartDate}'.");
                if (!DateTime.TryParse(dto.EndDate, out DateTime endDate))
                    return BadRequest($"Invalid EndDate: '{dto.EndDate}'.");

                if (startDate > endDate)
                    return BadRequest("StartDate must be before or equal to EndDate.");

                var finalSitters = _matchingService.SearchSitters(dto);
                return Ok(finalSitters);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpGet]
        [Route("search-sitters")]
        [Route("search")]
        public IHttpActionResult SearchSittersGet([FromUri] SearchSittersDTO dto)
        {
            if (dto == null)
                return BadRequest("Search parameters are required.");

            return SearchSitters(dto);
        }

        // GET api/matching/jobrequests?sitterId=20
        [HttpGet]
        [Route("jobrequests")]
        [SessionAuthorize(Roles = "Sitter")]
        public IHttpActionResult GetJobRequestsForSitter(int sitterId)
        {
            if (sitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");

            try
            {
                // B5 IDOR: a Sitter may only view their own job requests.
                if (sitterId != ClaimsPrincipalHelper.GetUserId())
                    return Content(HttpStatusCode.Forbidden, "You can only view your own job requests.");

                var result = _matchingService.GetJobRequestsForSitter(sitterId);
                return Ok(result);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpGet]
        [Route("babysitter/{id}")]
        [AllowAnonymous] // public sitter profile
        public IHttpActionResult GetBabysitterDetails(int id)
        {
            if (id <= 0)
                return BadRequest("Babysitter ID must be a positive integer.");

            var dto = _matchingService.GetBabysitterDetails(id);
            if (dto == null) return NotFound();

            return Ok(dto);
        }
    }
}
