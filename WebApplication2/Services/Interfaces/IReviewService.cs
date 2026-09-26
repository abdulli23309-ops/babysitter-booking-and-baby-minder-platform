using System.Collections.Generic;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IReviewService
    {
        ReviewOperationResult AddReview(ReviewDTO reviewDto);
        decimal GetSitterRating(int sitterId);
        decimal GetParentRating(int parentId);
        IEnumerable<UserReviewItemDto> GetUserReviews(int userId, string role);
        /// <summary>
        /// Both reviews (Parent -> Sitter and Sitter -> Parent) for one job,
        /// so each participant can render their own and the counterpart's.
        /// </summary>
        IEnumerable<JobReviewItemDto> GetJobReviews(int jobId);

    }
}
