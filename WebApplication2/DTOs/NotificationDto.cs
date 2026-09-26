using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class NotificationDto
    {
        public int NotificationId { get; set; }
        public int UserId { get; set; }
        public string UserRole { get; set; }
        public string Message { get; set; }
        public bool IsRead { get; set; }
        public DateTime CreatedAt { get; set; }
        public string Type { get; set; }

        /// <summary>
        /// Phase 8D: the job this notification is about, so the notification
        /// list can deep-link to the specific day.
        /// The Notification table's Job_ID column is managed OUTSIDE the EDMX
        /// (same precedent as Job.Latitude / Job.Longitude in
        /// docs\database\add_geo_columns.sql), so this property is never
        /// populated by the EF projection. NotificationService reads it back
        /// with a second raw-SQL pass and writes it with ExecuteSqlCommand.
        /// Always null for notifications that have no job context (bids etc).
        /// </summary>
        public int? Job_ID { get; set; }
    }
}