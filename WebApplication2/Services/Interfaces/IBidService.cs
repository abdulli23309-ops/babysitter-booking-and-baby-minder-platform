using System.Collections.Generic;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IBidService
    {
        BidOperationResult PlaceBid(PlaceBidDto dto, int currentUserId);
        BidOperationResult AcceptBid(int bidId, int currentUserId);
        BidOperationResult RejectBid(int bidId, int currentUserId);
        BidOperationResult WithdrawBid(int bidId, int currentUserId);
        IEnumerable<JobBidItemDto> GetBidsForJob(int jobId, string currentRole, int currentUserId);
        IEnumerable<ParentBidItemDto> GetBidsForParent(int parentId);
        IEnumerable<SitterBidItemDto> GetBidsForSitter(int sitterId);
    }
}
