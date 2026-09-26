using System;
using System.Collections.Generic;

namespace WebApplication2.DTOs
{
    public class InviteSittersDto
    {
        public int ParentId { get; set; }
        public List<int> SitterIds { get; set; }
    }

    public class HireSitterDto
    {
        public int ParentId { get; set; }
        public int SitterId { get; set; }
    }

    public class JobInvitationItemDto
    {
        public int JobInvitation_ID { get; set; }
        public int Job_ID { get; set; }
        public int Sitter_ID { get; set; }
        public string SitterName { get; set; }
        public string SitterPicture { get; set; }
        public decimal SitterRating { get; set; }
        public string Status { get; set; }
        public DateTime InvitedAt { get; set; }
        public DateTime? RespondedAt { get; set; }
    }

    public class SitterInvitationItemDto
    {
        public int JobInvitation_ID { get; set; }
        public int Job_ID { get; set; }
        public string JobTitle { get; set; }
        public DateTime? JobDate { get; set; }
        public string JobCity { get; set; }
        public decimal JobPayment { get; set; }
        public string ParentName { get; set; }
        public string ParentPic { get; set; }
        public string Status { get; set; }
        public int AcceptedCount { get; set; }
        public DateTime InvitedAt { get; set; }
        public List<JobChildDTO> Children { get; set; }

        // Phase 8 groundwork — lets the sitter list collapse the N per-day
        // invitations of one recurring series into a single grouped card.
        public int? JobSeries_ID { get; set; }
        public int? SeriesOccurrenceIndex { get; set; }
        public int? SeriesTotalCount { get; set; }
        public decimal? SeriesTotalPayment { get; set; }
    }

    public class InvitationOperationResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int? JobInvitationId { get; set; }
    }

    // ------------------------------------------------------------------
    // Internal row projections for raw-SQL access to the JobInvitation
    // table (exists outside the EDMX; these map the columns we read).
    // ------------------------------------------------------------------
    public class JobInvitationRowDto
    {
        public int JobInvitation_ID { get; set; }
        public int? Job_ID { get; set; }
        public int? Sitter_ID { get; set; }
        public string Status { get; set; }
        public DateTime InvitedAt { get; set; }
        public DateTime? RespondedAt { get; set; }
    }

    public class SitterAcceptedCountRowDto
    {
        public int Cnt { get; set; }
    }

    public class SupersededRowDto
    {
        public int? Sitter_ID { get; set; }
    }
}