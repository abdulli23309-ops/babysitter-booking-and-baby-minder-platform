using System;
using System.Collections.Generic;

namespace WebApplication2.DTOs
{
    /// <summary>
    /// DTO for configuring recurring weekly availability (imported from API-A Schedule concept).
    /// Allows a babysitter to declare weekly recurring days and time slots.
    /// </summary>
    public class RecurringAvailabilityDto
    {
        public int SitterId { get; set; }

        /// <summary>
        /// Day names to repeat, e.g. ["Monday", "Wednesday", "Friday"].
        /// </summary>
        public List<string> DaysOfWeek { get; set; } = new List<string>();

        /// <summary>
        /// TimeSlot IDs available on the specified days.
        /// </summary>
        public List<int> SlotIds { get; set; } = new List<int>();

        /// <summary>
        /// Operating city for this availability schedule.
        /// </summary>
        public string City { get; set; } = string.Empty;

        /// <summary>
        /// Optional start date. Defaults to today if omitted.
        /// </summary>
        public DateTime? StartDate { get; set; }

        /// <summary>
        /// Optional end date cap.
        /// </summary>
        public DateTime? EndDate { get; set; }

        /// <summary>
        /// Number of weeks ahead to project recurring availability (default: 4, min: 1, max: 12).
        /// </summary>
        public int WeeksAhead { get; set; } = 4;
    }

    /// <summary>
    /// Response model returned after saving recurring availability.
    /// </summary>
    public class RecurringAvailabilityResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int TotalDatesGenerated { get; set; }
        public int TotalSlotsCreated { get; set; }
        public List<string> GeneratedDates { get; set; } = new List<string>();
    }
}
