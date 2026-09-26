using System.Collections.Generic;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface INotificationService
    {
        IEnumerable<NotificationDto> GetNotifications(int userId, string userRole);
        void MarkAsRead(int notificationId, int currentUserId, string currentRole);
        void ClearAll(int userId, string userRole);
        /// <summary>
        /// Phase 8D: <paramref name="jobId"/> is optional and is written with a
        /// raw-SQL UPDATE after the insert, because Notification.Job_ID lives
        /// outside the EDMX model. Pass null for job-less notifications (bids).
        /// </summary>

        void CreateNotification(NotificationDto dto, int? jobId = null);
    }
}
