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
    public class AccountService : IAccountService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public AccountService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public AccountService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        public void DeactivateParent(int parentId)
        {
            var parent = _db.Parents.FirstOrDefault(p => p.Parent_ID == parentId);
            if (parent == null)
                throw new KeyNotFoundException("Parent account not found.");

            if (parent.IsDeleted)
                throw new InvalidOperationException("Account is already deactivated.");

            using (var transaction = _db.Database.BeginTransaction())
            {
                try
                {
                    // 1. Soft-delete the Parent account
                    parent.IsDeleted = true;

                    // 2. Soft-delete parent's children
                    var children = _db.Children.Where(c => c.Parent_ID == parentId && !c.IsDeleted).ToList();
                    foreach (var c in children)
                    {
                        c.IsDeleted = true;
                    }

                    // Pre-computed constants for EF6 translation
                    string completedStatus = JobStatus.Completed.ToDisplayString();
                    string cancelledStatus = JobStatus.Cancelled.ToDisplayString();

                    // 3. Cancel active/future jobs (preserve completed/historical)
                    var activeJobs = _db.Jobs
                        .Where(j => j.Parent_ID == parentId && j.Status != completedStatus && j.Status != cancelledStatus && !j.IsDeleted)
                        .ToList();
                    foreach (var job in activeJobs)
                    {
                        job.Status = cancelledStatus;
                    }

                    _db.SaveChanges();

                    // 4. Revoke ALL active sessions for this Parent
                    _db.Database.ExecuteSqlCommand(
                        "DELETE FROM UserSessions WHERE UserId = @p0 AND Role = @p1",
                        parentId, UserRole.Parent.ToDisplayString());

                    transaction.Commit();
                }
                catch
                {
                    transaction.Rollback();
                    throw;
                }
            }
        }

        public void DeactivateSitter(int sitterId)
        {
            var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == sitterId);
            if (sitter == null)
                throw new KeyNotFoundException("Babysitter account not found.");

            if (sitter.IsDeleted)
                throw new InvalidOperationException("Account is already deactivated.");

            using (var transaction = _db.Database.BeginTransaction())
            {
                try
                {
                    // 1. Soft-delete the Babysitter account
                    sitter.IsDeleted = true;

                    // Pre-computed constants for EF6 translation
                    string completedStatus = JobStatus.Completed.ToDisplayString();
                    string cancelledStatus = JobStatus.Cancelled.ToDisplayString();

                    // 2. Cancel active/future jobs where this sitter is assigned (preserve completed/historical)
                    var activeJobs = _db.Jobs
                        .Where(j => j.AssignedSitter_ID == sitterId && j.Status != completedStatus && j.Status != cancelledStatus && !j.IsDeleted)
                        .ToList();
                    foreach (var job in activeJobs)
                    {
                        job.Status = cancelledStatus;
                        job.AssignedSitter_ID = null;
                    }

                    // 3. Soft-delete active bids by this sitter
                    var activeBids = _db.Bids
                        .Where(b => b.Sitter_ID == sitterId && !b.IsDeleted)
                        .ToList();
                    foreach (var bid in activeBids)
                    {
                        bid.IsDeleted = true;
                    }

                    // 4. Soft-delete availability entries
                    var availabilities = _db.SitterAvailabilities
                        .Where(a => a.Sitter_ID == sitterId && !a.IsDeleted)
                        .ToList();
                    foreach (var av in availabilities)
                    {
                        av.IsDeleted = true;
                    }

                    _db.SaveChanges();

                    // 5. Revoke ALL active sessions for this Sitter
                    _db.Database.ExecuteSqlCommand(
                        "DELETE FROM UserSessions WHERE UserId = @p0 AND Role = @p1",
                        sitterId, UserRole.Sitter.ToDisplayString());

                    transaction.Commit();
                }
                catch
                {
                    transaction.Rollback();
                    throw;
                }
            }
        }

        public SitterEarningsDto GetSitterEarnings(int sitterId)
        {
            // Pre-computed constant for EF6 translation (hoisted out of the query)
            string completedStatus = JobStatus.Completed.ToDisplayString();

            var completedJobs = _db.Jobs
                .Where(j => j.AssignedSitter_ID == sitterId && j.Status == completedStatus && !j.IsDeleted)
                .ToList();

            decimal totalEarnings = completedJobs.Sum(j => j.Payment ?? 0);
            int jobCount = completedJobs.Count;

            double totalHours = 0;
            foreach (var job in completedJobs)
            {
                var slots = _db.JobTimeSlots
                    .Where(js => js.Job_ID == job.Job_ID)
                    .Join(_db.TimeSlots, js => js.Slot_ID, ts => ts.Slot_ID, (js, ts) => ts)
                    .ToList();

                foreach (var slot in slots)
                {
                    if (slot.StartTime.HasValue && slot.EndTime.HasValue)
                        totalHours += (slot.EndTime.Value - slot.StartTime.Value).TotalHours;
                }
            }

            var recentPayments = completedJobs
                .OrderByDescending(j => j.JobDate)
                .Take(10)
                .Select(j => new SitterRecentPaymentDto
                {
                    parentName = _db.Parents.Where(p => p.Parent_ID == j.Parent_ID)
                                    .Select(p => p.IsDeleted ? "Deactivated Parent" : p.FullName).FirstOrDefault() ?? "Deactivated Parent",
                    amount = j.Payment,
                    date = j.JobDate.ToString("MMM dd, yyyy • hh:mm tt")
                })
                .ToList();

            return new SitterEarningsDto
            {
                totalEarnings = totalEarnings,
                completedJobs = jobCount,
                totalHours = (int)Math.Round(totalHours, 0),
                recentPayments = recentPayments
            };
        }

        public void UpdateSitter(int sitterId, UpdateSitterDto dto)
        {
            if (sitterId <= 0)
                throw new ArgumentException("Sitter ID must be a positive integer.");
            if (dto == null)
                throw new ArgumentException("Update data is required.");

            var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == sitterId && !s.IsDeleted);
            if (sitter == null)
                throw new ArgumentException("Sitter not found.");

            // Duplicate email / username check (excluding the current sitter) when changed.
            if (dto.EmailAddress != null && dto.EmailAddress != sitter.EmailAddress)
            {
                bool emailTaken = _db.Babysitters.Any(s => s.EmailAddress == dto.EmailAddress && s.Sitter_ID != sitterId);
                if (emailTaken)
                    throw new ArgumentException("A user with this Email already exists.");
            }
            if (dto.Username != null && dto.Username != sitter.Username)
            {
                bool userTaken = _db.Babysitters.Any(s => s.Username == dto.Username && s.Sitter_ID != sitterId);
                if (userTaken)
                    throw new ArgumentException("A user with this Username already exists.");
            }

            if (dto.FullName != null)
                sitter.FullName = dto.FullName;
            if (dto.EmailAddress != null)
                sitter.EmailAddress = dto.EmailAddress;
            if (dto.Username != null)
                sitter.Username = dto.Username;
            if (dto.PhoneNumber != null)
                sitter.PhoneNumber = dto.PhoneNumber;
            if (dto.PictureAddress != null)
                sitter.PictureAddress = dto.PictureAddress;
            if (dto.DOB.HasValue)
                sitter.DOB = dto.DOB.Value;
            if (dto.ExperienceYears.HasValue)
                sitter.ExperienceYears = dto.ExperienceYears;
            if (dto.HourlyRate.HasValue)
                sitter.HourlyRate = dto.HourlyRate;

            _db.SaveChanges();
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
