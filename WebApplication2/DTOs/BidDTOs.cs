using System;
using System.Collections.Generic;

namespace WebApplication2.DTOs
{
    public class PlaceBidDto
    {
        public int JobId { get; set; }
        public int SitterId { get; set; }
        public decimal ProposedPrice { get; set; }
    }

    public class JobBidItemDto
    {
        public int Bid_ID { get; set; }
        public int? Job_ID { get; set; }
        public int? Sitter_ID { get; set; }
        public decimal? ProposedPrice { get; set; }
        public string BidStatus { get; set; }
        public DateTime? BidDate { get; set; }
        public string SitterName { get; set; }
        public string SitterPicture { get; set; }
        public decimal SitterRating { get; set; }
        public decimal? HourlyRate { get; set; }
        public int? ExperienceYears { get; set; }
    }

    public class SitterBidItemDto
    {
        public int Bid_ID { get; set; }
        public int? Job_ID { get; set; }
        public decimal? ProposedPrice { get; set; }
        public string BidStatus { get; set; }
        public DateTime? BidDate { get; set; }
        public string JobTitle { get; set; }
        public DateTime? JobDate { get; set; }
        public string City { get; set; }
        public string JobStatus { get; set; }
        public string ParentName { get; set; }
    }

    /// <summary>
    /// Bid row for a parent's "incoming bids" list (all bids on the parent's jobs).
    /// </summary>
    public class ParentBidItemDto
    {
        public int Bid_ID { get; set; }
        public int? Job_ID { get; set; }
        public string JobTitle { get; set; }
        public int? Sitter_ID { get; set; }
        public string SitterName { get; set; }
        public decimal SitterRating { get; set; }
        public decimal? ProposedPrice { get; set; }
        public string BidStatus { get; set; }
        public DateTime? BidDate { get; set; }
    }

    public class BidOperationResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int BidId { get; set; }
        public int? JobId { get; set; }
        public int? SitterId { get; set; }
    }
}
