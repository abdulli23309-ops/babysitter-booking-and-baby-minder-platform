using System;
using System.Collections.Generic;
using System.Net;
using System.Web.Http;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [RoutePrefix("api/notifications")]
    [SessionAuthorize]
    public class NotificationsController : ApiController
    {
        private readonly INotificationService _notificationService;

        public NotificationsController() : this(new NotificationService())
        {
        }

        public NotificationsController(INotificationService notificationService)
        {
            _notificationService = notificationService ?? throw new ArgumentNullException(nameof(notificationService));
        }

        // GET api/notifications?userId=9&userRole=Parent
        [HttpGet]
        [Route("")]
        public IHttpActionResult GetNotifications(int userId, string userRole)
        {
            if (userId <= 0)
                return BadRequest("User ID must be a positive integer.");
            if (string.IsNullOrWhiteSpace(userRole))
                return BadRequest("User role is required.");

            // B5 RBAC/IDOR: a user may only read their own notifications, and the
            // requested role must match the authenticated role.
            var currentUserId = ClaimsPrincipalHelper.GetUserId();
            var currentRole = ClaimsPrincipalHelper.GetRole();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            if (userId != currentUserId || !string.Equals(userRole, currentRole, StringComparison.OrdinalIgnoreCase))
                return Content(HttpStatusCode.Forbidden, "You are not allowed to access these notifications.");

            var list = _notificationService.GetNotifications(userId, userRole);
            return Ok(list);
        }

        // PUT api/notifications/5/read
        [HttpPut]
        [Route("{id}/read")]
        public IHttpActionResult MarkAsRead(int id)
        {
            if (id <= 0)
                return BadRequest("Notification ID must be a positive integer.");

            // B5 IDOR: a user may only mark their own notification as read.
            var currentUserId = ClaimsPrincipalHelper.GetUserId();
            var currentRole = ClaimsPrincipalHelper.GetRole();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");

            try
            {
                _notificationService.MarkAsRead(id, currentUserId, currentRole);
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }

            // Idempotent: always return NoContent, matching the previous SQL UPDATE behaviour.
            return StatusCode(HttpStatusCode.NoContent);
        }

        // DELETE api/notifications/clear?userId=9&userRole=Parent
        [HttpDelete]
        [Route("clear")]
        public IHttpActionResult ClearAll(int userId, string userRole)
        {
            if (userId <= 0)
                return BadRequest("User ID must be a positive integer.");
            if (string.IsNullOrWhiteSpace(userRole))
                return BadRequest("User role is required.");

            // B5 RBAC/IDOR: a user may only clear their own notifications.
            var currentUserId = ClaimsPrincipalHelper.GetUserId();
            var currentRole = ClaimsPrincipalHelper.GetRole();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");
            if (userId != currentUserId || !string.Equals(userRole, currentRole, StringComparison.OrdinalIgnoreCase))
                return Content(HttpStatusCode.Forbidden, "You are not allowed to clear these notifications.");

            try
            {
                _notificationService.ClearAll(userId, userRole);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }

            return StatusCode(HttpStatusCode.NoContent);
        }

        // POST api/notifications  (internal use)
        [HttpPost]
        [Route("")]
        public IHttpActionResult CreateNotification([FromBody] NotificationDto dto)
        {
            if (dto == null)
                return BadRequest("Request body is required.");
            if (dto.UserId <= 0)
                return BadRequest("User ID must be a positive integer.");
            if (string.IsNullOrWhiteSpace(dto.UserRole))
                return BadRequest("User role is required.");
            if (string.IsNullOrWhiteSpace(dto.Message))
                return BadRequest("Notification message is required.");
            if (dto.Message.Length > 1000)
                return BadRequest("Notification message must not exceed 1000 characters.");

            try
            {
                _notificationService.CreateNotification(dto);
                return Ok();
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && _notificationService is IDisposable disposable)
            {
                disposable.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
