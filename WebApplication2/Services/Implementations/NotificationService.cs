using System;
using System.Collections.Generic;
using System.Linq;
using WebApplication2.DTOs;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    public class NotificationService : INotificationService, IDisposable
    {
        /// <summary>
        /// Phase 8D: projection target for the raw-SQL Job_ID back-fill in
        /// GetNotifications. Notification.Job_ID is not part of the EDMX model,
        /// so EF cannot select it — this row type lets SqlQuery materialise it.
        /// </summary>
        private class NotificationJobIdRow
        {
            public int Notification_ID { get; set; }
            public int? Job_ID { get; set; }
        }

        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public NotificationService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public NotificationService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        public IEnumerable<NotificationDto> GetNotifications(int userId, string userRole)
        {
            if (userId <= 0)
                throw new ArgumentException("User ID must be a positive integer.");
            if (string.IsNullOrWhiteSpace(userRole))
                throw new ArgumentException("User role is required.");

            var result = _db.Notifications
                .Where(n => !n.IsDeleted && n.UserID == userId && n.UserRole == userRole)
                .OrderByDescending(n => n.CreatedAt)
                .Select(n => new NotificationDto
                {
                    NotificationId = n.Notification_ID,
                    UserId = n.UserID,
                    UserRole = n.UserRole,
                    Message = n.Message,
                    IsRead = n.IsRead ?? false,
                    CreatedAt = n.CreatedAt ?? default(DateTime),
                    Type = n.Type ?? "",
                })
                .ToList();
            // Phase 8D — raw-SQL back-fill of Notification.Job_ID.
            // The Notification.Job_ID column lives outside the EDMX model (same
            // precedent as Job.Latitude / Job.Longitude, see
            // docs\database\add_geo_columns.sql), so the EF projection above
            // cannot read it. Without this pass the notification list can never
            // deep-link to the specific day a notification is about.
            var jobIdMap = _db.Database
                .SqlQuery<NotificationJobIdRow>(
                    "SELECT Notification_ID, Job_ID FROM Notification " +
                    "WHERE UserID = @p0 AND Job_ID IS NOT NULL", userId)
                .ToDictionary(r => r.Notification_ID, r => (int?)r.Job_ID);

            foreach (var dto in result)
            {
                int? mappedJobId;
                dto.Job_ID = jobIdMap.TryGetValue(dto.NotificationId, out mappedJobId)
                    ? mappedJobId
                    : null;
            }

            return result;

        }

        public void MarkAsRead(int notificationId, int currentUserId, string currentRole)
        {
            if (notificationId <= 0)
                throw new ArgumentException("Notification ID must be a positive integer.");

            var notification = _db.Notifications.FirstOrDefault(n => n.Notification_ID == notificationId && !n.IsDeleted);
            if (notification != null)
            {
                if (notification.UserID != currentUserId ||
                    !string.Equals(notification.UserRole, currentRole, StringComparison.OrdinalIgnoreCase))
                    throw new UnauthorizedAccessException("You are not allowed to modify this notification.");

                notification.IsRead = true;
                _db.SaveChanges();
            }
        }

        public void ClearAll(int userId, string userRole)
        {
            if (userId <= 0)
                throw new ArgumentException("User ID must be a positive integer.");
            if (string.IsNullOrWhiteSpace(userRole))
                throw new ArgumentException("User role is required.");

            var rows = _db.Notifications
                .Where(n => !n.IsDeleted && n.UserID == userId && n.UserRole == userRole)
                .ToList();

            foreach (var n in rows)
            {
                n.IsDeleted = true;
            }
            _db.SaveChanges();
        }

        public void CreateNotification(NotificationDto dto, int? jobId = null)
        {
            if (dto == null)
                throw new ArgumentNullException(nameof(dto));
            if (dto.UserId <= 0)
                throw new ArgumentException("User ID must be a positive integer.");
            if (string.IsNullOrWhiteSpace(dto.UserRole))
                throw new ArgumentException("User role is required.");
            if (string.IsNullOrWhiteSpace(dto.Message))
                throw new ArgumentException("Notification message is required.");
            if (dto.Message.Length > 1000)
                throw new ArgumentException("Notification message must not exceed 1000 characters.");

            var notification = new Notification
            {
                UserID = dto.UserId,
                UserRole = dto.UserRole,
                Message = dto.Message,
                Type = dto.Type ?? "",
                IsDeleted = false,

                // Stage 4 / Part 0 fix: this insert used to leave both columns
                // NULL. CreatedAt drives the ORDER BY in GetNotifications(), and
                // in SQL Server a NULL sorts as the OLDEST row under
                // "ORDER BY CreatedAt DESC", so every freshly written
                // notification (e.g. the Stage 3 TerminateSeries cascade) sank to
                // the bottom of the parent's / sitter's notification list.
                // IsRead = NULL also defeated any `WHERE IsRead = 0` unread filter.
                //
                // DateTime.Now (deliberately NOT UtcNow) matches the existing
                // "fix NULL issue" convention already used in this codebase for
                // entity timestamps that are rendered straight to the user — see
                // ParentController (UserSessions.CreatedAt) and ReviewService
                // (Review.CreatedAt). Notification rows are stored and displayed
                // on the Pakistan (UTC+5) clock, so stamping UTC here would render
                // every new notification 5 hours in the past.
                //
                // CreatedAt is always server-stamped: no caller supplies one today
                // (POST api/notifications never sends it).
                CreatedAt = DateTime.Now,
                IsRead = dto.IsRead
            };
            _db.Notifications.Add(notification);
            _db.SaveChanges();

            // Phase 8D: Job_ID is not in the EDMX model, so it cannot be set on
            // the entity above. Back-fill it with a raw-SQL UPDATE now that
            // SaveChanges has produced the identity value.
            if (jobId.HasValue)
            {
                _db.Database.ExecuteSqlCommand(
                    "UPDATE Notification SET Job_ID = @p0 WHERE Notification_ID = @p1",
                    jobId.Value,
                    notification.Notification_ID);
            }
        }

        public void Dispose()
        {
            if (_ownsContext)
            {
                _db.Dispose();
            }
        }
    }
}
