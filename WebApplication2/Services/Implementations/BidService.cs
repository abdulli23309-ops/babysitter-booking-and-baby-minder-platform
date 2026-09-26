using System;
using System.Collections.Generic;
using System.Data.Entity;
using System.Linq;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    public class BidService : IBidService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;
        private readonly INotificationService _notificationService;

        public BidService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public BidService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false, INotificationService notificationService = null)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
            _notificationService = notificationService ?? new NotificationService();
        }

        public BidOperationResult PlaceBid(PlaceBidDto dto, int currentUserId)
        {
            if (dto == null)
                throw new ArgumentNullException(nameof(dto));

            if (dto.JobId <= 0 || dto.SitterId <= 0)
                throw new ArgumentException("Job ID and Sitter ID must be positive integers.");

            if (dto.ProposedPrice <= 0)
                throw new ArgumentException("Proposed price must be greater than zero.");

            if (dto.SitterId != currentUserId)
                throw new UnauthorizedAccessException("Access denied: you may only place bids for your own account.");

            var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == dto.SitterId && !s.IsDeleted);
            if (sitter == null)
                throw new KeyNotFoundException("Sitter not found or inactive.");

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == dto.JobId && !j.IsDeleted);
            if (job == null)
                throw new KeyNotFoundException("Job not found.");

            if (job.Status != JobStatus.Open.ToDisplayString())
                throw new InvalidOperationException("Job is not open for bidding.");

            bool alreadyHasActiveBid = _db.Bids.Any(b =>
                b.Job_ID == dto.JobId &&
                b.Sitter_ID == dto.SitterId &&
                !b.IsDeleted &&
                (b.BidStatus == BidStatus.Pending.ToDisplayString() || b.BidStatus == BidStatus.Accepted.ToDisplayString()));

            if (alreadyHasActiveBid)
                throw new InvalidOperationException("You already have an active bid for this job.");

            var bid = new Bid
            {
                Job_ID = dto.JobId,
                Sitter_ID = dto.SitterId,
                ProposedPrice = dto.ProposedPrice,
                BidStatus = BidStatus.Pending.ToDisplayString(),
                BidDate = DateTime.Now,
                IsDeleted = false
            };

            _db.Bids.Add(bid);
            _db.SaveChanges();

            // Notify the job's parent about the incoming bid
            if (job.Parent_ID.HasValue)
            {
                _notificationService.CreateNotification(new NotificationDto
                {
                    UserId = job.Parent_ID.Value,
                    UserRole = "Parent",
                    Message = $"{sitter.FullName} placed a bid of PKR {bid.ProposedPrice} on your job: {job.Title}",
                    Type = "BidUpdate",
                    IsRead = false
                });
            }

            return new BidOperationResult
            {
                Success = true,
                Message = "Bid placed successfully.",
                BidId = bid.Bid_ID,
                JobId = job.Job_ID,
                SitterId = sitter.Sitter_ID
            };
        }

        public BidOperationResult AcceptBid(int bidId, int currentUserId)
        {
            if (bidId <= 0)
                throw new ArgumentException("Bid ID must be a positive integer.");

            var bid = _db.Bids.FirstOrDefault(b => b.Bid_ID == bidId && !b.IsDeleted);
            if (bid == null)
                throw new KeyNotFoundException("Bid not found.");

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == bid.Job_ID && !j.IsDeleted);
            if (job == null)
                throw new KeyNotFoundException("Associated job not found.");

            if (job.Parent_ID != currentUserId)
                throw new UnauthorizedAccessException("Access denied: you may only accept bids for your own jobs.");

            if (bid.BidStatus != BidStatus.Pending.ToDisplayString())
                throw new InvalidOperationException($"Cannot accept bid with status '{bid.BidStatus}'.");

            if (job.Status != JobStatus.Open.ToDisplayString())
                throw new InvalidOperationException("Job is no longer open.");

            // Rule D: block acceptance if the sitter already has an overlapping
            // assigned or in-progress job (commute buffer included).
            var slotIds = _db.JobTimeSlots
                .Where(js => js.Job_ID == job.Job_ID && js.Slot_ID.HasValue)
                .Select(js => js.Slot_ID.Value)
                .ToList();

            var conflictSlots = new HashSet<int>(slotIds);
            if (slotIds.Any())
            {
                int minSlot = slotIds.Min();
                if (minSlot > 1) conflictSlots.Add(minSlot - 1);
            }

            string assignedStatus   = JobStatus.Assigned.ToDisplayString();
            string inProgressStatus = JobStatus.InProgress.ToDisplayString();

            bool conflict = _db.Jobs.Any(j =>
                !j.IsDeleted &&
                j.Job_ID != job.Job_ID &&
                j.AssignedSitter_ID == bid.Sitter_ID &&
                (j.Status == assignedStatus || j.Status == inProgressStatus) &&
                DbFunctions.TruncateTime(j.JobDate) == DbFunctions.TruncateTime(job.JobDate) &&
                _db.JobTimeSlots.Any(js =>
                    js.Job_ID == j.Job_ID &&
                    js.Slot_ID.HasValue &&
                    conflictSlots.Contains(js.Slot_ID.Value))
            );

            if (conflict)
                throw new InvalidOperationException(
                    "This sitter already has another booking that overlaps this time. " +
                    "Cannot accept this bid.");

            bid.BidStatus = BidStatus.Accepted.ToDisplayString();
            job.AssignedSitter_ID = bid.Sitter_ID;
            job.Status = JobStatus.Assigned.ToDisplayString();
            if (bid.ProposedPrice.HasValue && bid.ProposedPrice.Value > 0)
            {
                job.Payment = bid.ProposedPrice.Value;
            }

            var otherBids = _db.Bids
                .Where(b => b.Job_ID == job.Job_ID && b.Bid_ID != bid.Bid_ID && !b.IsDeleted && b.BidStatus == BidStatus.Pending.ToDisplayString())
                .ToList();

            foreach (var other in otherBids)
            {
                other.BidStatus = BidStatus.Rejected.ToDisplayString();
            }

            _db.SaveChanges();

            return new BidOperationResult
            {
                Success = true,
                Message = "Bid accepted and sitter assigned to job.",
                BidId = bid.Bid_ID,
                JobId = job.Job_ID,
                SitterId = bid.Sitter_ID
            };
        }

        public BidOperationResult RejectBid(int bidId, int currentUserId)
        {
            if (bidId <= 0)
                throw new ArgumentException("Bid ID must be a positive integer.");

            var bid = _db.Bids.FirstOrDefault(b => b.Bid_ID == bidId && !b.IsDeleted);
            if (bid == null)
                throw new KeyNotFoundException("Bid not found.");

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == bid.Job_ID && !j.IsDeleted);
            if (job == null)
                throw new KeyNotFoundException("Associated job not found.");

            if (job.Parent_ID != currentUserId)
                throw new UnauthorizedAccessException("Access denied: you may only reject bids for your own jobs.");

            if (bid.BidStatus != BidStatus.Pending.ToDisplayString())
                throw new InvalidOperationException($"Cannot reject bid with status '{bid.BidStatus}'.");

            bid.BidStatus = BidStatus.Rejected.ToDisplayString();
            _db.SaveChanges();

            return new BidOperationResult
            {
                Success = true,
                Message = "Bid rejected.",
                BidId = bid.Bid_ID,
                JobId = job.Job_ID,
                SitterId = bid.Sitter_ID
            };
        }

        public BidOperationResult WithdrawBid(int bidId, int currentUserId)
        {
            if (bidId <= 0)
                throw new ArgumentException("Bid ID must be a positive integer.");

            var bid = _db.Bids.FirstOrDefault(b => b.Bid_ID == bidId && !b.IsDeleted);
            if (bid == null)
                throw new KeyNotFoundException("Bid not found.");

            if (bid.Sitter_ID != currentUserId)
                throw new UnauthorizedAccessException("Access denied: you may only withdraw your own bids.");

            if (bid.BidStatus == BidStatus.Accepted.ToDisplayString())
                throw new InvalidOperationException("Cannot withdraw an accepted bid.");

            if (bid.BidStatus == BidStatus.Withdrawn.ToDisplayString())
                throw new InvalidOperationException("Bid is already withdrawn.");

            bid.BidStatus = BidStatus.Withdrawn.ToDisplayString();
            _db.SaveChanges();

            return new BidOperationResult
            {
                Success = true,
                Message = "Bid withdrawn successfully.",
                BidId = bid.Bid_ID,
                JobId = bid.Job_ID,
                SitterId = bid.Sitter_ID
            };
        }

        public IEnumerable<JobBidItemDto> GetBidsForJob(int jobId, string currentRole, int currentUserId)
        {
            if (jobId <= 0)
                throw new ArgumentException("Job ID must be a positive integer.");

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (job == null)
                throw new KeyNotFoundException("Job not found.");

            if (currentRole == UserRole.Parent.ToDisplayString() && job.Parent_ID != currentUserId)
                throw new UnauthorizedAccessException("Access denied: you may only view bids for your own jobs.");

            var query = _db.Bids.Where(b => b.Job_ID == jobId && !b.IsDeleted);
            if (currentRole == UserRole.Sitter.ToDisplayString())
            {
                query = query.Where(b => b.Sitter_ID == currentUserId);
            }

            var rawList = query
                .OrderByDescending(b => b.BidDate)
                .Select(b => new
                {
                    b.Bid_ID,
                    b.Job_ID,
                    b.Sitter_ID,
                    b.ProposedPrice,
                    b.BidStatus,
                    b.BidDate,
                    SitterName = b.Babysitter != null && !b.Babysitter.IsDeleted ? b.Babysitter.FullName : "Deactivated Sitter",
                    SitterPicture = b.Babysitter != null && !b.Babysitter.IsDeleted ? b.Babysitter.PictureAddress : null,
                    HourlyRate = b.Babysitter != null && !b.Babysitter.IsDeleted ? b.Babysitter.HourlyRate : null,
                    ExperienceYears = b.Babysitter != null && !b.Babysitter.IsDeleted ? b.Babysitter.ExperienceYears : null,
                    SitterRating = _db.Reviews
                        .Where(r => !r.IsDeleted && r.ReviewFor_ID == b.Sitter_ID && r.ReviewForRole == UserRole.Sitter.ToDisplayString())
                        .Average(r => (decimal?)r.Rating) ?? 0
                })
                .ToList();

            return rawList.Select(x => new JobBidItemDto
            {
                Bid_ID = x.Bid_ID,
                Job_ID = x.Job_ID,
                Sitter_ID = x.Sitter_ID,
                ProposedPrice = x.ProposedPrice,
                BidStatus = x.BidStatus,
                BidDate = x.BidDate,
                SitterName = x.SitterName,
                SitterPicture = x.SitterPicture,
                SitterRating = x.SitterRating,
                HourlyRate = x.HourlyRate,
                ExperienceYears = x.ExperienceYears
            }).ToList();
        }

        public IEnumerable<ParentBidItemDto> GetBidsForParent(int parentId)
        {
            if (parentId <= 0)
                throw new ArgumentException("Parent ID must be a positive integer.");

            // Pre-computed constants for EF6 translation
            string sitterRole = UserRole.Sitter.ToDisplayString();
            string deactivatedName = "Deactivated Sitter";

            var rawList = _db.Bids
                .Where(b => !b.IsDeleted
                         && b.Job != null
                         && !b.Job.IsDeleted
                         && b.Job.Parent_ID == parentId)
                .OrderByDescending(b => b.BidDate)
                .Select(b => new
                {
                    b.Bid_ID,
                    b.Job_ID,
                    JobTitle = b.Job.Title,
                    b.Sitter_ID,
                    SitterName = b.Babysitter != null && !b.Babysitter.IsDeleted ? b.Babysitter.FullName : deactivatedName,
                    ProposedPrice = b.ProposedPrice,
                    b.BidStatus,
                    b.BidDate,
                    SitterRating = _db.Reviews
                        .Where(r => !r.IsDeleted && r.ReviewFor_ID == b.Sitter_ID && r.ReviewForRole == sitterRole)
                        .Average(r => (decimal?)r.Rating) ?? 0
                })
                .ToList();

            return rawList.Select(x => new ParentBidItemDto
            {
                Bid_ID = x.Bid_ID,
                Job_ID = x.Job_ID,
                JobTitle = x.JobTitle,
                Sitter_ID = x.Sitter_ID,
                SitterName = x.SitterName,
                SitterRating = x.SitterRating,
                ProposedPrice = x.ProposedPrice,
                BidStatus = x.BidStatus,
                BidDate = x.BidDate
            }).ToList();
        }

        public IEnumerable<SitterBidItemDto> GetBidsForSitter(int sitterId)
        {
            if (sitterId <= 0)
                throw new ArgumentException("Sitter ID must be a positive integer.");

            var rawList = _db.Bids
                .Where(b => b.Sitter_ID == sitterId && !b.IsDeleted)
                .OrderByDescending(b => b.BidDate)
                .Select(b => new
                {
                    b.Bid_ID,
                    b.Job_ID,
                    b.ProposedPrice,
                    b.BidStatus,
                    b.BidDate,
                    JobTitle = b.Job != null && !b.Job.IsDeleted ? b.Job.Title : "Deleted Job",
                    JobDate = b.Job != null && !b.Job.IsDeleted ? (DateTime?)b.Job.JobDate : null,
                    City = b.Job != null && !b.Job.IsDeleted ? b.Job.City : null,
                    JobStatus = b.Job != null && !b.Job.IsDeleted ? b.Job.Status : null,
                    ParentName = b.Job != null && b.Job.Parent != null && !b.Job.Parent.IsDeleted ? b.Job.Parent.FullName : "Deactivated Parent"
                })
                .ToList();

            return rawList.Select(x => new SitterBidItemDto
            {
                Bid_ID = x.Bid_ID,
                Job_ID = x.Job_ID,
                ProposedPrice = x.ProposedPrice,
                BidStatus = x.BidStatus,
                BidDate = x.BidDate,
                JobTitle = x.JobTitle,
                JobDate = x.JobDate,
                City = x.City,
                JobStatus = x.JobStatus,
                ParentName = x.ParentName
            }).ToList();
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
