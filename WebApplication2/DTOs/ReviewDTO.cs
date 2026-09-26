using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class ReviewDTO
    {
        public int Job_ID { get; set; }

        public int Reviewer_ID { get; set; }
        public string ReviewerRole { get; set; }

        public int ReviewFor_ID { get; set; }
        public string ReviewForRole { get; set; }

        public decimal Rating { get; set; }
        public string Comment { get; set; }
    }

    public class UserReviewItemDto
    {
        public decimal Rating { get; set; }
        public string Comment { get; set; }
        public DateTime? CreatedAt { get; set; }
        public string ReviewerName { get; set; }
    }

    /// <summary>
    /// A single review row as returned by GET /api/review/job/{jobId}
    /// (Phase 6.1 mutual reviews). ReviewerRole/ReviewForRole are the
    /// 'Parent' | 'Sitter' display strings from UserRole.ToDisplayString().
    /// </summary>
    public class JobReviewItemDto
    {
        public int Review_ID { get; set; }
        public int? Job_ID { get; set; }

        /// <summary>
        /// Phase 8c: the series this review belongs to. Null for a single-day
        /// job. Set on the row but NOT in the EDMX model (the column is managed
        /// outside it), so it is back-filled by ReviewService with raw SQL.
        /// </summary>
        public int? JobSeries_ID { get; set; }

        public int Reviewer_ID { get; set; }
        public string ReviewerRole { get; set; }

        public int ReviewFor_ID { get; set; }
        public string ReviewForRole { get; set; }

        public decimal Rating { get; set; }
        public string Comment { get; set; }
        public DateTime? CreatedAt { get; set; }
    }

    public class ReviewOperationResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int ReviewId { get; set; }
    }
}
