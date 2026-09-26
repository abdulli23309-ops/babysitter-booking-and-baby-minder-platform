using System;
using System.Collections.Generic;
using System.Linq;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    public class ReviewService : IReviewService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public ReviewService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public ReviewService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        public ReviewOperationResult AddReview(ReviewDTO reviewDto)
        {
            if (reviewDto == null)
                throw new ArgumentNullException(nameof(reviewDto));

            if (reviewDto.Reviewer_ID <= 0 || reviewDto.ReviewFor_ID <= 0)
                throw new ArgumentException("Reviewer and Reviewee IDs must be greater than zero.");

            if (reviewDto.Job_ID < 0)
                throw new ArgumentException("Job ID cannot be negative.");

            if (reviewDto.ReviewerRole != UserRole.Parent.ToDisplayString() && reviewDto.ReviewerRole != UserRole.Sitter.ToDisplayString())
                throw new ArgumentException("ReviewerRole must be 'Parent' or 'Sitter'.");

            if (reviewDto.ReviewForRole != UserRole.Parent.ToDisplayString() && reviewDto.ReviewForRole != UserRole.Sitter.ToDisplayString())
                throw new ArgumentException("ReviewForRole must be 'Parent' or 'Sitter'.");

            if (reviewDto.Rating < 1 || reviewDto.Rating > 5)
                throw new ArgumentException("Rating must be between 1 and 5.");

            if (reviewDto.Comment != null && reviewDto.Comment.Length > 2000)
                throw new ArgumentException("Comment must not exceed 2000 characters.");

            if (reviewDto.ReviewerRole == UserRole.Parent.ToDisplayString())
            {
                var p = _db.Parents.FirstOrDefault(x => x.Parent_ID == reviewDto.Reviewer_ID && !x.IsDeleted);
                if (p == null)
                    throw new UnauthorizedAccessException("Account is deactivated or not found.");
            }
            else if (reviewDto.ReviewerRole == UserRole.Sitter.ToDisplayString())
            {
                var s = _db.Babysitters.FirstOrDefault(x => x.Sitter_ID == reviewDto.Reviewer_ID && !x.IsDeleted);
                if (s == null)
                    throw new UnauthorizedAccessException("Account is deactivated or not found.");
            }

            if (reviewDto.ReviewForRole == UserRole.Parent.ToDisplayString())
            {
                var p = _db.Parents.FirstOrDefault(x => x.Parent_ID == reviewDto.ReviewFor_ID && !x.IsDeleted);
                if (p == null)
                    throw new ArgumentException("Target parent account is deactivated or not found.");
            }
            else if (reviewDto.ReviewForRole == UserRole.Sitter.ToDisplayString())
            {
                var s = _db.Babysitters.FirstOrDefault(x => x.Sitter_ID == reviewDto.ReviewFor_ID && !x.IsDeleted);
                if (s == null)
                    throw new ArgumentException("Target sitter account is deactivated or not found.");
            }

            var review = new Review
            {
                Job_ID = reviewDto.Job_ID > 0 ? (int?)reviewDto.Job_ID : null,
                Reviewer_ID = reviewDto.Reviewer_ID,
                ReviewerRole = reviewDto.ReviewerRole,
                ReviewFor_ID = reviewDto.ReviewFor_ID,
                ReviewForRole = reviewDto.ReviewForRole,
                Rating = reviewDto.Rating,
                Comment = reviewDto.Comment,
                CreatedAt = DateTime.Now,
                IsDeleted = false
            };

            // Phase 8c: one review per SERIES, not per day. For a series job the
            // review is attributed to the whole series, is only submittable once
            // every day is Completed/Cancelled, and may be submitted once per
            // (series, reviewer). Single-day jobs (JobSeries_ID null) keep the
            // existing per-job behaviour untouched.
            int? seriesId = null;
            if (reviewDto.Job_ID > 0)
            {
                seriesId = _db.Jobs
                    .Where(j => j.Job_ID == reviewDto.Job_ID)
                    .Select(j => (int?)j.JobSeries_ID)
                    .FirstOrDefault();
            }

            if (seriesId.HasValue)
            {
                if (!IsSeriesTerminal(seriesId.Value))
                    throw new InvalidOperationException(
                        "This series isn't finished yet. You can review once every day is done or cancelled.");

                // JobSeries_ID is not in the EDMX model, so this duplicate check
                // is raw SQL (same pattern as the Notification.Job_ID back-fill).
                var alreadyReviewed = _db.Database.SqlQuery<int>(
                    "SELECT COUNT(1) FROM Review " +
                    "WHERE JobSeries_ID = @p0 AND Reviewer_ID = @p1 " +
                    "  AND ReviewerRole = @p2 AND IsDeleted = 0",
                    seriesId.Value, reviewDto.Reviewer_ID, reviewDto.ReviewerRole)
                    .FirstOrDefault();

                if (alreadyReviewed > 0)
                    throw new InvalidOperationException("You've already reviewed this series.");
            }

            _db.Reviews.Add(review);
            _db.SaveChanges();

            if (seriesId.HasValue)
            {
                // Back-fill the series id now that SaveChanges has produced the
                // identity value. Job_ID is kept on the row for audit — it
                // records which day the reviewer happened to be on.
                _db.Database.ExecuteSqlCommand(
                    "UPDATE Review SET JobSeries_ID = @p0 WHERE Review_ID = @p1",
                    seriesId.Value, review.Review_ID);
            }

            return new ReviewOperationResult
            {
                Success = true,
                Message = "Review Added Successfully",
                ReviewId = review.Review_ID
            };
        }

        /// <summary>
        /// Phase 8c: a series is terminal when no sibling is still in an active
        /// state. Cancelled days do not block — that is how a partially
        /// cancelled series can still be reviewed once the rest have run.
        ///
        /// A past-dated Open/Assigned day also does not block: the date has
        /// passed, so that day can never resolve itself and would otherwise
        /// strand the whole series' reviews forever. This is the realistic
        /// case — a sitter declines a day, the parent never books a
        /// replacement, and the series ends with one permanently Open sibling.
        ///
        /// Read with raw SQL because Job.Status is free-text. The DB server
        /// clock is already Pakistan local time, so GETDATE() is the correct
        /// boundary (same assumption as the session-window guard in JobService).
        /// </summary>
        private bool IsSeriesTerminal(int seriesId)
        {
            var activeCount = _db.Database.SqlQuery<int>(
                "SELECT COUNT(1) FROM Job " +
                "WHERE JobSeries_ID = @p0 AND IsDeleted = 0 " +
                "  AND Status NOT IN ('Completed','Cancelled','Canceled') " +
                "  AND JobDate >= CONVERT(DATE, GETDATE())",
                seriesId).FirstOrDefault();

            return activeCount == 0;
        }

        public decimal GetSitterRating(int sitterId)
        {
            if (sitterId <= 0)
                throw new ArgumentException("Sitter ID must be a positive integer.");

            var avg = _db.Reviews
                .Where(r => !r.IsDeleted && r.ReviewFor_ID == sitterId && r.ReviewForRole == UserRole.Sitter.ToDisplayString())
                .Average(r => (decimal?)r.Rating) ?? 0;

            return avg;
        }

        public decimal GetParentRating(int parentId)
        {
            if (parentId <= 0)
                throw new ArgumentException("Parent ID must be a positive integer.");

            var avgRating = _db.Reviews
                .Where(r => !r.IsDeleted && r.ReviewFor_ID == parentId && r.ReviewForRole == UserRole.Parent.ToDisplayString())
                .Average(r => (decimal?)r.Rating) ?? 0;

            return avgRating;
        }

        public IEnumerable<UserReviewItemDto> GetUserReviews(int userId, string role)
        {
            if (userId <= 0)
                throw new ArgumentException("User ID must be a positive integer.");

            if (string.IsNullOrWhiteSpace(role))
                throw new ArgumentException("Role is required.");

            if (!string.Equals(role, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(role, UserRole.Sitter.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Role must be 'Parent' or 'Sitter'.");

            var reviews = _db.Reviews
                .Where(r => !r.IsDeleted && r.ReviewFor_ID == userId && r.ReviewForRole == role)
                .ToList();

            var parentIds = reviews.Where(r => r.ReviewerRole == UserRole.Parent.ToDisplayString()).Select(r => r.Reviewer_ID).Distinct().ToList();
            var sitterIds = reviews.Where(r => r.ReviewerRole == UserRole.Sitter.ToDisplayString()).Select(r => r.Reviewer_ID).Distinct().ToList();

            var parentNames = _db.Parents
                .Where(p => parentIds.Contains(p.Parent_ID))
                .ToDictionary(p => p.Parent_ID, p => p.IsDeleted ? "Deleted User" : p.FullName);

            var sitterNames = _db.Babysitters
                .Where(b => sitterIds.Contains(b.Sitter_ID))
                .ToDictionary(b => b.Sitter_ID, b => b.IsDeleted ? "Deleted User" : b.FullName);

            return reviews
                .Select(r => new UserReviewItemDto
                {
                    Rating = r.Rating,
                    Comment = r.Comment,
                    CreatedAt = r.CreatedAt,
                    ReviewerName = r.ReviewerRole == UserRole.Parent.ToDisplayString()
                        ? (parentNames.TryGetValue(r.Reviewer_ID, out var parentName) ? parentName : "Deleted User")
                        : (sitterNames.TryGetValue(r.Reviewer_ID, out var sitterName) ? sitterName : "Deleted User")
                })
                .ToList();
        }

        /// <summary>
        /// All non-deleted reviews attached to a single job (Phase 6.1 mutual
        /// reviews). The job's own participants are the only legitimate
        /// consumers, so callers must be authenticated.
        /// </summary>
        public IEnumerable<JobReviewItemDto> GetJobReviews(int jobId)
        {
            if (jobId <= 0)
                throw new ArgumentException("Job ID must be a positive integer.");

            // Phase 8c: for a series job return EVERY review of that series, so
            // any day of the series shows the same single pair of reviews. A
            // single-day job keeps returning only its own rows.
            var seriesId = _db.Jobs
                .Where(j => j.Job_ID == jobId)
                .Select(j => (int?)j.JobSeries_ID)
                .FirstOrDefault();

            if (seriesId.HasValue)
            {
                // Read with raw SQL: JobSeries_ID is not mapped by the EDMX, so
                // the EF projection cannot filter on it.
                return _db.Database
                    .SqlQuery<JobReviewItemDto>(
                        "SELECT Review_ID, Job_ID, JobSeries_ID, Reviewer_ID, ReviewerRole, " +
                        "       ReviewFor_ID, ReviewForRole, Rating, Comment, CreatedAt " +
                        "FROM Review " +
                        "WHERE JobSeries_ID = @p0 AND IsDeleted = 0 " +
                        "ORDER BY CreatedAt",
                        seriesId.Value)
                    .ToList();
            }

            return _db.Reviews
                .Where(r => !r.IsDeleted && r.Job_ID == jobId)
                .OrderBy(r => r.CreatedAt)
                .Select(r => new JobReviewItemDto
                {
                    Review_ID = r.Review_ID,
                    Job_ID = r.Job_ID,
                    Reviewer_ID = r.Reviewer_ID,
                    ReviewerRole = r.ReviewerRole,
                    ReviewFor_ID = r.ReviewFor_ID,
                    ReviewForRole = r.ReviewForRole,
                    Rating = r.Rating,
                    Comment = r.Comment,
                    CreatedAt = r.CreatedAt
                })
                .ToList();
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
