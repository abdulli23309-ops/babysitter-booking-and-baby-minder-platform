using System.Collections.Generic;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    /// <summary>
    /// Service for managing recurring weekly availability patterns (adapted from API-A Schedule model).
    /// Projects weekly day-of-week rules into active availability dates without modifying the underlying EDMX schema.
    /// </summary>
    public interface IRecurringAvailabilityService
    {
        RecurringAvailabilityResultDto SaveRecurringWeeklyAvailability(RecurringAvailabilityDto dto, int currentUserId);
        IEnumerable<string> GetSupportedDaysOfWeek();
    }
}
