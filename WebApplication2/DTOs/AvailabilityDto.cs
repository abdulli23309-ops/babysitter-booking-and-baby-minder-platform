using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class AvailabilityDto
    {
        public int SitterId { get; set; }
        public DateTime? Date { get; set; }
        public List<int> SlotIds { get; set; }
        public string City { get; set; }

                // Geo-matching fields (persisted via raw SQL — not part of the EDMX)
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
        public double? RadiusKm { get; set; }

        // Optional per-availability rate; null = use Babysitter.HourlyRate default
        public decimal? HourlyRate { get; set; }
    }

    /// <summary>
    /// Coordinates returned by raw-SQL geo queries.
    /// Column names match the SELECT projection exactly.
    /// </summary>
    public class SitterAvailabilityCoordsDto
    {
        public int Availability_ID { get; set; }
        public int? Sitter_ID { get; set; }
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
        public double? RadiusKm { get; set; }
    }

        public class SitterAvailabilityItemDto
    {
        public int Availability_ID { get; set; }
        public int? Sitter_ID { get; set; }
        public DateTime? AvailableDate { get; set; }
        public int? Slot_ID { get; set; }
        public string City { get; set; }

        // Geo-matching fields (persisted via raw SQL in SaveAvailability —
        // columns exist in the DB but are NOT mapped on the EDMX SitterAvailability entity,
        // so they cannot be included in the EF LINQ .Select projection and are instead
        // hydrated here via GetAvailabilityLocations' raw-SQL query).
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
        public double? RadiusKm { get; set; }

                public bool IsLocked { get; set; }
        public int? LockedByJobId { get; set; }

        // Per-availability rate (null = falls back to Babysitter.HourlyRate on client)
        public decimal? HourlyRate { get; set; }
    }

    /// <summary>
    /// One booked (job date, time slot) pair for this sitter, taken from an
    /// Assigned / InProgress job. Returned alongside the availability rows so the
    /// client can derive weekday+slot locks without needing an exact-date match.
    /// </summary>
    public class BookedSlotDto
    {
        public DateTime JobDate { get; set; }
        public int Slot_ID { get; set; }
    }

    /// <summary>
    /// Response of GET /matching/availability/{sitterId}.
    ///   Items       — the sitter's future availability rows (each still carries its
    ///                 date-exact IsLocked / LockedByJobId for backward compatibility).
    ///   BookedSlots — the raw booked set (date + slot). The Set Availability grid
    ///                 renders one representative date per weekday, so it locks a
    ///                 whole (weekday, slot) cell when ANY booked date in the next
    ///                 4 weeks falls on that weekday+slot.
    /// </summary>
    public class SitterAvailabilityResponseDto
    {
        public List<SitterAvailabilityItemDto> Items { get; set; }
        public List<BookedSlotDto> BookedSlots { get; set; }
    }

    /// <summary>
    /// Job coordinates returned by raw-SQL geo queries.
    /// Column names match the SELECT projection exactly.
    /// </summary>
    public class JobCoordsDto
    {
        public int Job_ID { get; set; }
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
    }

    public class SitterLockoutRow
    {
        public int Sitter_ID { get; set; }
        public DateTime? SitterLockedUntil { get; set; }
    }

    public class MatchingSitterResultDto
    {
        public int Sitter_ID { get; set; }
        public string FullName { get; set; }
        public decimal? HourlyRate { get; set; }
        public int? ExperienceYears { get; set; }
        public string PictureAddress { get; set; }
        public decimal Rating { get; set; }
    }
}