using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
        public class SitterDTO
    {
        public int Sitter_ID { get; set; }
        public string FullName { get; set; }
        public decimal HourlyRate { get; set; }
        public int ExperienceYears { get; set; }
        public string PictureAddress { get; set; }
        public decimal Rating { get; set; }
        public string EmailAddress { get; set; }
        public string PhoneNumber { get; set; }
        public DateTime? DOB { get; set; }
        public string City { get; set; }
        public string Message { get; set; }
        public double? DistanceKm { get; set; }
        public DateTime? SitterLockedUntil { get; set; }
    }

    public class BidDTO
    {
        public int Bid_ID { get; set; }
        public decimal ProposedPrice { get; set; }
        public string BidStatus { get; set; }
        public SitterDTO Babysitter { get; set; }
    }

    public class JobDTO
    {
        public int Job_ID { get; set; }
        public string Title { get; set; }
        public string Status { get; set; }
        public DateTime? JobDate { get; set; }
        public List<BidDTO> Bids { get; set; }
    }
    public class JobStatusUpdateDto
    {
        public string Status { get; set; }
    }

    /// <summary>
    /// A strongly-typed (non-dynamic) representation of a matched job returned to a sitter.
    /// </summary>
    public class MatchingJobDto
    {
        public int? Job_ID { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public DateTime? JobDate { get; set; }
        public string City { get; set; }
        public decimal? Payment { get; set; }
        public string Status { get; set; }
        public List<int?> RequiredSlotIds { get; set; }
        public string ParentName { get; set; }
        public string ParentPhone { get; set; }
        public string ChildName { get; set; }
    }

    public class OpenJobListItemDto
    {
        public int Job_ID { get; set; }
        public string Title { get; set; }
        public string Status { get; set; }
        public DateTime? JobDate { get; set; }
        public string City { get; set; }
        public decimal? Payment { get; set; }
        public string ParentAddress { get; set; }
        public string ParentPic { get; set; }
        public string ParentName { get; set; }
        public string ParentPhone { get; set; }
        public List<int?> SlotIds { get; set; }
        public decimal Rating { get; set; }
    }

    public class JobChildDTO
    {
        public int Child_ID { get; set; }
        public string ChildName { get; set; }
        public DateTime? DOB { get; set; }
        public int? ChildAge { get; set; }
        public string Gender { get; set; }
        public string PictureAddress { get; set; }
        public string SpecialRequirements { get; set; }
    }

    public class JobDetailsResultDto
    {
        public int Job_ID { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public DateTime? JobDate { get; set; }
        public string Status { get; set; }
        public string City { get; set; }
        public decimal? Payment { get; set; }
        public List<int?> SlotIds { get; set; }
        public List<ParentJobSlotTimeDto> SlotTimes { get; set; }
        public string ParentName { get; set; }
        public string ParentAddress { get; set; }
        public string ParentPic { get; set; }
        public decimal ParentRating { get; set; }
        public string ChildName { get; set; }
        public int ChildAge { get; set; }
        public string Gender { get; set; }
        public string PictureAddress { get; set; }
        public List<JobChildDTO> Children { get; set; }
        public int? AssignedSitter_ID { get; set; }
        public int? Parent_ID { get; set; }
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }

        // Workflow redesign: the timer on active-job screens is driven by
        // this timestamp (set when the parent confirms the session start).
        public DateTime? SessionStartedAt { get; set; }
        public DateTime? SessionEndedAt { get; set; }

        public int? JobSeries_ID { get; set; }
        public int? SeriesOccurrenceIndex { get; set; }
        public int? SeriesTotalCount { get; set; }      // sibling jobs with same series
        public decimal? SeriesTotalPayment { get; set; }
        // Phase 8c: sum of Payment across COMPLETED siblings in this
        // series. Grows as days complete. Used to show "Earned so far:
        // PKR X of PKR Y" on the Job Summary / BookingStatus screens.
        public decimal? SeriesEarnedSoFar { get; set; }
        public DateTime? SeriesStartDate { get; set; }
        public DateTime? SeriesEndDate { get; set; }
        public string[] SeriesDays { get; set; }
    }

    public class SitterAssignedJobDto
    {
        public int Job_ID { get; set; }
        public string Title { get; set; }
        public DateTime? JobDate { get; set; }
        public string Status { get; set; }
        public decimal? Payment { get; set; }
        public string City { get; set; }
        public string ChildName { get; set; }
        public int ChildAge { get; set; }
        public string ParentName { get; set; }
        public string ParentPhone { get; set; }
        public string ParentAddress { get; set; }
        public string ParentPic { get; set; }
        public decimal ParentRating { get; set; }
        public List<ParentJobSlotTimeDto> SlotTimes { get; set; }

        // Phase 6 multi-child: full child list per job (populated by
        // GetJobChildren after the DTO list is materialised).
        public List<JobChildDTO> Children { get; set; }

        // Workflow redesign: the sitter's live-session timer is driven by
        // these timestamps (set when the parent confirms the session start/end).
        public DateTime? SessionStartedAt { get; set; }
        public DateTime? SessionEndedAt { get; set; }

        public int? JobSeries_ID { get; set; }
        public int? SeriesOccurrenceIndex { get; set; }
        public int? SeriesTotalCount { get; set; }      // sibling jobs with same series
        public decimal? SeriesTotalPayment { get; set; }
    }

    public class ActiveJobResultDto
    {
        public int Job_ID { get; set; }
        public int jobId { get; set; }
        public int? Parent_ID { get; set; }
        public int? parentId { get; set; }
        public int? Child_ID { get; set; }
        public int? childId { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public DateTime? JobDate { get; set; }
        public string Status { get; set; }
        public decimal? Payment { get; set; }
        public string City { get; set; }
        public string ParentName { get; set; }
        public string parentName { get; set; }
        public string ParentAddress { get; set; }
        public string ParentPhone { get; set; }
        public string ParentPic { get; set; }
        public decimal ParentRating { get; set; }
        public string ChildName { get; set; }
        public string childName { get; set; }
        public int ChildAge { get; set; }
        public string Gender { get; set; }
        public string PictureAddress { get; set; }
        public int? AssignedSitter_ID { get; set; }
        public int? sitterId { get; set; }
        public string SitterName { get; set; }
        public string SitterPicture { get; set; }
        public string SitterPhone { get; set; }
        public decimal SitterRating { get; set; }
        public List<ParentJobSlotTimeDto> SlotTimes { get; set; }
        public List<int?> SlotIds { get; set; }
    }

    public class JobStatusUpdateResultDto
    {
        public string Message { get; set; }
        public int JobId { get; set; }
        public string Status { get; set; }
        public int? AssignedSitterId { get; set; }
        public int? ParentId { get; set; }
    }

    public class ParentJobItemDto
    {
        public int Job_ID { get; set; }
        public int? Parent_ID { get; set; }
        public string Title { get; set; }
        public DateTime? JobDate { get; set; }
        public string Status { get; set; }
        public string City { get; set; }
        // Phase 8J: geo coords live on the Job table but are managed outside the
        // EDMX (docs\database\add_geo_columns.sql), so they are read via raw SQL.
        // Without these the parent BookingStatus "Find Replacement" CTA cannot
        // prefill the search map or run a radius-filtered search — it wrote
        // null and the map fell back to a hardcoded Islamabad centre.
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
        public decimal? Payment { get; set; }
        public int? AssignedSitter_ID { get; set; }
        public string ChildName { get; set; }
        public string SitterName { get; set; }
        public string SitterPhone { get; set; }
        public string SitterPicture { get; set; }
        public List<ParentJobSlotTimeDto> SlotTimes { get; set; }
        public List<JobChildDTO> Children { get; set; }

        // Workflow redesign: the parent's review screen derives the real
        // session duration from these timestamps (set by the backend at the
        // Assigned -> In Progress / In Progress -> Completed transitions).
        public DateTime? SessionStartedAt { get; set; }
        public DateTime? SessionEndedAt { get; set; }

        // Series fields
        public int? JobSeries_ID { get; set; }
        public int? SeriesOccurrenceIndex { get; set; }
        public int? SeriesTotalCount { get; set; }      // sibling jobs with same series
        public decimal? SeriesTotalPayment { get; set; }
        // Phase 8c: sum of Payment across COMPLETED siblings in this
        // series. Grows as days complete. Used to show "Earned so far:
        // PKR X of PKR Y" on the Job Summary / BookingStatus screens.
        public decimal? SeriesEarnedSoFar { get; set; }
        public DateTime? SeriesStartDate { get; set; }
        public DateTime? SeriesEndDate { get; set; }
        public string[] SeriesDays { get; set; }
    }

    /// <summary>
    /// Phase 8D: one day of a series, for the parent BookingStatus and sitter
    /// CompletedJobDetails pagination bars. Deliberately minimal — this list
    /// only drives the "Day X of N" bar, not a full detail screen.
    /// </summary>
    public class SeriesSiblingDto
    {
        public int Job_ID { get; set; }
        public int? JobSeries_ID { get; set; }
        public int? SeriesOccurrenceIndex { get; set; }
        public DateTime? JobDate { get; set; }
        public string Status { get; set; }
        public int? AssignedSitter_ID { get; set; }
        public int? Parent_ID { get; set; }
        public DateTime? SessionStartedAt { get; set; }
        public DateTime? SessionEndedAt { get; set; }
        public decimal? Payment { get; set; }
    }
}