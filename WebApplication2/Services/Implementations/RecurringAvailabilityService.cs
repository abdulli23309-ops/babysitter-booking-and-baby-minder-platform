using System;
using System.Collections.Generic;
using System.Linq;
using WebApplication2.DTOs;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    /// <summary>
    /// Service for managing recurring weekly availability patterns (adapted from API-A Schedule model).
    ///
    /// ARCHITECTURE NOTE & FUTURE CODE-FIRST MIGRATION TODO:
    /// In API-A, recurring availability was represented via a 'Schedule' entity with 'day_of_week' (string)
    /// and 'time_slot' (string). In API-C, availability is modeled via 'SitterAvailability' with 'AvailableDate' (DateTime).
    ///
    /// Per Section 22 of the Architecture Report:
    /// TODO (Phase 16/17 Code-First Migration):
    /// In the target Code-First 'Availability' table, introduce:
    ///   - Nullable<DateTime> SpecificDate { get; set; } (for one-off date availability)
    ///   - Nullable<DayOfWeek> DayOfWeek { get; set; } (for native recurring weekly rules)
    ///
    /// CURRENT SAFE ADDITIVE IMPLEMENTATION:
    /// Without changing the current EDMX database-first schema, this service projects recurring weekly
    /// rules (e.g. "Every Monday and Wednesday") into actual calendar dates across the configured projection
    /// window (1-12 weeks ahead) and persists them using the existing SitterAvailability store.
    /// This gives the frontend recurring availability capability immediately with zero database disruption.
    /// </summary>
    public class RecurringAvailabilityService : IRecurringAvailabilityService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly IAvailabilityService _availabilityService;
        private readonly bool _ownsContext;

        private static readonly Dictionary<string, DayOfWeek> DayOfWeekMap = new Dictionary<string, DayOfWeek>(StringComparer.OrdinalIgnoreCase)
        {
            { "Sunday", DayOfWeek.Sunday },
            { "Sun", DayOfWeek.Sunday },
            { "Monday", DayOfWeek.Monday },
            { "Mon", DayOfWeek.Monday },
            { "Tuesday", DayOfWeek.Tuesday },
            { "Tue", DayOfWeek.Tuesday },
            { "Wednesday", DayOfWeek.Wednesday },
            { "Wed", DayOfWeek.Wednesday },
            { "Thursday", DayOfWeek.Thursday },
            { "Thu", DayOfWeek.Thursday },
            { "Friday", DayOfWeek.Friday },
            { "Fri", DayOfWeek.Friday },
            { "Saturday", DayOfWeek.Saturday },
            { "Sat", DayOfWeek.Saturday }
        };

        public RecurringAvailabilityService()
            : this(new BabySitterBooking_and_BabyMinderEntities(), new AvailabilityService(), ownsContext: true)
        {
        }

        public RecurringAvailabilityService(BabySitterBooking_and_BabyMinderEntities db, IAvailabilityService availabilityService, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _availabilityService = availabilityService ?? throw new ArgumentNullException(nameof(availabilityService));
            _ownsContext = ownsContext;
        }

        public IEnumerable<string> GetSupportedDaysOfWeek()
        {
            return new[] { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" };
        }

        public RecurringAvailabilityResultDto SaveRecurringWeeklyAvailability(RecurringAvailabilityDto dto, int currentUserId)
        {
            if (dto == null)
                throw new ArgumentNullException(nameof(dto));

            if (dto.SitterId <= 0)
                throw new ArgumentException("Sitter ID must be a positive integer.", nameof(dto));

            if (dto.SitterId != currentUserId)
                throw new UnauthorizedAccessException("Access denied: you may only configure availability for your own account.");

            if (dto.DaysOfWeek == null || dto.DaysOfWeek.Count == 0)
                throw new ArgumentException("At least one day of the week must be specified.", nameof(dto));

            if (dto.SlotIds == null || dto.SlotIds.Count == 0)
                throw new ArgumentException("At least one time slot ID must be selected.", nameof(dto));

            // Pre-mutation validation ordering:
            // 1. Verify babysitter exists and is active
            var sitter = _db.Babysitters.FirstOrDefault(b => b.Sitter_ID == dto.SitterId && !b.IsDeleted);
            if (sitter == null)
                throw new KeyNotFoundException("Babysitter not found or inactive.");

            // 2. Validate all slot IDs exist
            var validSlotIds = _db.TimeSlots
                .Where(ts => !ts.IsDeleted)
                .Select(ts => ts.Slot_ID)
                .ToList();
            var invalidSlots = dto.SlotIds.Where(id => !validSlotIds.Contains(id)).ToList();
            if (invalidSlots.Any())
                throw new ArgumentException($"One or more time slot IDs are invalid: {string.Join(", ", invalidSlots)}", nameof(dto));

            // 3. Parse target days of week
            var targetDays = new HashSet<DayOfWeek>();
            foreach (var dayStr in dto.DaysOfWeek)
            {
                if (string.IsNullOrWhiteSpace(dayStr) || !DayOfWeekMap.TryGetValue(dayStr.Trim(), out var dayOfWeek))
                    throw new ArgumentException($"Invalid day of week: '{dayStr}'. Expected Monday, Tuesday, etc.", nameof(dto));

                targetDays.Add(dayOfWeek);
            }

            // 4. Calculate projection window
            DateTime startDate = (dto.StartDate.HasValue ? dto.StartDate.Value.Date : DateTime.Today);
            if (startDate < DateTime.Today)
                startDate = DateTime.Today;

            int weeksAhead = Math.Max(1, Math.Min(dto.WeeksAhead, 12)); // Clamp between 1 and 12 weeks
            DateTime maxEndDate = startDate.AddDays(weeksAhead * 7);
            DateTime endDate = dto.EndDate.HasValue && dto.EndDate.Value.Date < maxEndDate
                ? dto.EndDate.Value.Date
                : maxEndDate;

            if (endDate < startDate)
                throw new ArgumentException("EndDate cannot be earlier than StartDate.", nameof(dto));

            // 5. Expand recurring days into concrete dates
            var matchingDates = new List<DateTime>();
            for (DateTime curr = startDate; curr <= endDate; curr = curr.AddDays(1))
            {
                if (targetDays.Contains(curr.DayOfWeek))
                {
                    matchingDates.Add(curr);
                }
            }

            if (!matchingDates.Any())
            {
                return new RecurringAvailabilityResultDto
                {
                    Success = true,
                    Message = "No dates matched the requested day criteria within the projection window.",
                    TotalDatesGenerated = 0,
                    TotalSlotsCreated = 0
                };
            }

            // 6. Persist availability for each expanded date
            string city = !string.IsNullOrWhiteSpace(dto.City) 
                ? dto.City.Trim() 
                : (_db.SitterAvailabilities.Where(sa => sa.Sitter_ID == dto.SitterId && !sa.IsDeleted && !string.IsNullOrEmpty(sa.City)).Select(sa => sa.City).FirstOrDefault() ?? string.Empty);
            int totalSlotsCreated = 0;
            var generatedDateStrings = new List<string>();

            foreach (var date in matchingDates)
            {
                _availabilityService.SaveAvailability(new AvailabilityDto
                {
                    SitterId = dto.SitterId,
                    Date = date,
                    SlotIds = dto.SlotIds,
                    City = city
                });

                totalSlotsCreated += dto.SlotIds.Count;
                generatedDateStrings.Add(date.ToString("yyyy-MM-dd (dddd)"));
            }

            return new RecurringAvailabilityResultDto
            {
                Success = true,
                Message = $"Recurring availability successfully applied across {matchingDates.Count} date(s).",
                TotalDatesGenerated = matchingDates.Count,
                TotalSlotsCreated = totalSlotsCreated,
                GeneratedDates = generatedDateStrings
            };
        }

        public void Dispose()
        {
            if (_ownsContext)
            {
                _db.Dispose();
                if (_availabilityService is IDisposable disposableAvailability)
                {
                    disposableAvailability.Dispose();
                }
            }
        }
    }
}


