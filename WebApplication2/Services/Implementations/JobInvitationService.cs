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
    public class JobInvitationService : IJobInvitationService, IDisposable
    {
        private const int MaxInvitesPerJob = 5;

        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;
        private readonly INotificationService _notificationService;

        public JobInvitationService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true, notificationService: null)
        {
        }

        public JobInvitationService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false, INotificationService notificationService = null)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
            _notificationService = notificationService ?? new NotificationService();
        }

        // ------------------------------------------------------------------
        // Parent: invite up to MaxInvitesPerJob sitters to an open job
        // ------------------------------------------------------------------
        public InvitationOperationResult Invite(int jobId, InviteSittersDto dto)
        {
            if (dto == null)
                return Fail("Invalid request.");

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (job == null)
                return Fail("Job not found.");

            int jobParentId = job.Parent_ID.HasValue ? job.Parent_ID.Value : 0;
            if (jobParentId != dto.ParentId)
                return Fail("Not your job.");

            if (job.Status != JobStatus.Open.ToDisplayString())
                return Fail("Job is no longer open.");

            if (dto.SitterIds == null || dto.SitterIds.Count == 0)
                return Fail("No sitters selected.");

            int existing = CountInvitationsForJob(jobId);
            int eligible = 0;
            foreach (var sid in dto.SitterIds)
                if (sid > 0 && !ExistsInvitation(jobId, sid))
                    eligible++;

            if (existing + eligible > MaxInvitesPerJob)
                return Fail("Cannot invite more than " + MaxInvitesPerJob + " sitters.");

            var parent = _db.Parents.FirstOrDefault(p => p.Parent_ID == dto.ParentId);
            string parentName = parent != null ? parent.FullName : "A parent";

            foreach (var sitterId in dto.SitterIds)
            {
                if (sitterId <= 0)
                    continue;

                if (ExistsInvitation(jobId, sitterId))
                    continue;

                var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == sitterId && !s.IsDeleted);
                if (sitter == null)
                    continue;

                if (IsLocked(sitterId))
                    continue;

                _db.Database.ExecuteSqlCommand(
                    "INSERT INTO JobInvitation (Job_ID, Sitter_ID, Status, InvitedAt) VALUES (@p0, @p1, @p2, @p3)",
                    jobId, sitterId, "Invited", DateTime.UtcNow);
                _db.SaveChanges();

                // Cascade to siblings of the same series
                var seriesId = job.JobSeries_ID;
                if (seriesId.HasValue)
                {
                    var siblingJobIds = _db.Jobs
                        .Where(j => j.JobSeries_ID == seriesId.Value
                                 && !j.IsDeleted
                                 && j.Job_ID != jobId)
                        .Select(j => j.Job_ID)
                        .ToList();

                    foreach (var sibId in siblingJobIds)
                    {
                        var exists = _db.Database.SqlQuery<int>(
                            "SELECT COUNT(1) FROM JobInvitation WHERE Job_ID = @p0 AND Sitter_ID = @p1",
                            sibId, sitterId).FirstOrDefault();
                        if (exists > 0) continue;

                        _db.Database.ExecuteSqlCommand(
                            "INSERT INTO JobInvitation (Job_ID, Sitter_ID, Status, InvitedAt) " +
                            "VALUES (@p0, @p1, @p2, @p3)",
                            sibId, sitterId, "Invited", DateTime.UtcNow);
                        _db.SaveChanges();
                    }
                }

                _notificationService.CreateNotification(new NotificationDto
                {
                    UserId = sitterId,
                    UserRole = "Sitter",
                    Message = parentName + " invited you to a job: " + job.Title,
                    Type = "InvitationReceived",
                    IsRead = false
                });
            }

            return Ok("Invitations sent.");
        }

        // ------------------------------------------------------------------
        // Parent: list the invitations for one of their jobs
        // ------------------------------------------------------------------
        public List<JobInvitationItemDto> GetInvitationsForJob(int jobId, int currentParentId)
        {
            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (job == null)
                return new List<JobInvitationItemDto>();

            int jobParentId = job.Parent_ID.HasValue ? job.Parent_ID.Value : 0;
            if (jobParentId != currentParentId)
                return new List<JobInvitationItemDto>();

            var rows = _db.Database.SqlQuery<JobInvitationRowDto>(
                "SELECT JobInvitation_ID, Job_ID, Sitter_ID, Status, InvitedAt, RespondedAt " +
                "FROM JobInvitation WHERE Job_ID = @p0",
                jobId).ToList();

            string sitterRole = UserRole.Sitter.ToDisplayString();

            var accepted = new List<JobInvitationItemDto>();
            var invited = new List<JobInvitationItemDto>();
            var other = new List<JobInvitationItemDto>();

            foreach (var r in rows)
            {
                if (!r.Sitter_ID.HasValue)
                    continue;

                var sitter = _db.Babysitters.FirstOrDefault(b => b.Sitter_ID == r.Sitter_ID.Value);
                var rating = sitter != null && !sitter.IsDeleted
                    ? _db.Reviews
                        .Where(rv => !rv.IsDeleted && rv.ReviewFor_ID == r.Sitter_ID.Value && rv.ReviewForRole == sitterRole)
                        .Average(rv => (decimal?)rv.Rating) ?? 0
                    : new decimal(0);

                var item = new JobInvitationItemDto
                {
                    JobInvitation_ID = r.JobInvitation_ID,
                    Job_ID = jobId,
                    Sitter_ID = r.Sitter_ID.Value,
                    SitterName = (sitter != null && !sitter.IsDeleted) ? sitter.FullName : "Deactivated Sitter",
                    SitterPicture = sitter != null ? sitter.PictureAddress : null,
                    SitterRating = rating,
                    Status = r.Status,
                    InvitedAt = r.InvitedAt,
                    RespondedAt = r.RespondedAt
                };

                if (string.Equals(r.Status, "Accepted", StringComparison.OrdinalIgnoreCase)) accepted.Add(item);
                else if (string.Equals(r.Status, "Invited", StringComparison.OrdinalIgnoreCase)) invited.Add(item);
                else other.Add(item);
            }

            // Order: Accepted first, then Invited, then others.
            var result = new List<JobInvitationItemDto>();
            result.AddRange(accepted);
            result.AddRange(invited);
            result.AddRange(other);
            return result;
        }

        // ------------------------------------------------------------------
        // Sitter: list invitations addressed to them (newest first)
        // ------------------------------------------------------------------
        public List<SitterInvitationItemDto> GetInvitationsForSitter(int sitterId)
        {
            // Only genuinely pending invitations are actionable. An invitation
            // whose job has left 'Open' (Assigned / In Progress / Completed /
            // Cancelled) or whose job was soft-deleted must not surface on the
            // sitter's Job Invitations page — those rows previously appeared as
            // "Accepted — waiting for parent to hire" long after the job had
            // already finished. Every column is alias-qualified because both
            // JobInvitation and Job expose Job_ID and Status.
            var rows = _db.Database.SqlQuery<JobInvitationRowDto>(
                "SELECT i.JobInvitation_ID, i.Job_ID, i.Sitter_ID, i.Status, i.InvitedAt, i.RespondedAt " +
                "FROM JobInvitation i " +
                "INNER JOIN Job j ON j.Job_ID = i.Job_ID " +
                "WHERE i.Sitter_ID = @p0 AND i.Status = @p1 AND j.Status = @p2 AND j.IsDeleted = 0 " +
                "ORDER BY i.InvitedAt DESC",
                sitterId, "Invited", JobStatus.Open.ToDisplayString()).ToList();

            var result = new List<SitterInvitationItemDto>();

            foreach (var r in rows)
            {
                var item = new SitterInvitationItemDto
                {
                    JobInvitation_ID = r.JobInvitation_ID,
                    Job_ID = r.Job_ID.HasValue ? r.Job_ID.Value : 0,
                    JobTitle = "Deleted Job",
                    JobDate = null,
                    JobCity = null,
                    JobPayment = 0,
                    ParentName = "Deactivated Parent",
                    Status = r.Status,
                    AcceptedCount = r.Job_ID.HasValue ? CountAcceptedForJob(r.Job_ID.Value) : 0,
                    InvitedAt = r.InvitedAt
                };

                if (r.Job_ID.HasValue)
                {
                    var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == r.Job_ID.Value && !j.IsDeleted);
                    if (job == null) continue;
                    if (string.Equals(job.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
                        continue;

                    item.JobTitle = job.Title;
                    item.JobDate = job.JobDate;
                    item.JobCity = job.City;
                    item.JobPayment = job.Payment.HasValue ? job.Payment.Value : 0;
                    if (job.Parent != null && !job.Parent.IsDeleted)
                    {
                        item.ParentName = job.Parent.FullName;
                        item.ParentPic = job.Parent.PictureAddress;
                    }

                    // Series fields — the sitter list collapses the N per-day
                    // invitations of one series into a single card. The totals use
                    // the same COUNT / SUM shape as JobService.GetSeriesSummary
                    // (which is private to JobService, so the identical logic is
                    // inlined here rather than duplicated into a new helper).
                    item.JobSeries_ID = job.JobSeries_ID;
                    item.SeriesOccurrenceIndex = job.SeriesOccurrenceIndex;
                    if (job.JobSeries_ID.HasValue)
                    {
                        var seriesSiblings = _db.Jobs
                            .Where(j => j.JobSeries_ID == job.JobSeries_ID.Value && !j.IsDeleted)
                            .Select(j => new { j.Payment })
                            .ToList();

                        if (seriesSiblings.Count > 0)
                        {
                            item.SeriesTotalCount = seriesSiblings.Count;
                            item.SeriesTotalPayment = seriesSiblings.Sum(j => j.Payment ?? 0m);
                        }
                    }
                }

                result.Add(item);
            }

            // Populate children for each invitation (Phase 6 — multi-child support).
            // Keyed off the built item (not rows[i]) so the two collections can
            // never drift out of sync if a row is skipped above.
            for (int i = 0; i < result.Count; i++)
            {
                if (result[i].Job_ID > 0)
                {
                    result[i].Children = GetJobChildren(result[i].Job_ID);
                }
            }

            return result;
        }

        // ------------------------------------------------------------------
        // Sitter: accept an invitation (if the job is still open + no conflict)
        // ------------------------------------------------------------------
        public InvitationOperationResult Accept(int invitationId, int currentSitterId)
        {
            var inv = GetInvRow(invitationId);
            if (inv == null || !inv.Sitter_ID.HasValue || inv.Sitter_ID.Value != currentSitterId)
                return Fail("Invitation not found.");

            if (!string.Equals(inv.Status, "Invited", StringComparison.OrdinalIgnoreCase))
                return Fail("Invitation already " + inv.Status + ".");

            if (IsLocked(currentSitterId))
                return Fail("You are temporarily locked out.");

            if (!inv.Job_ID.HasValue)
                return Fail("Job no longer available.");

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == inv.Job_ID.Value && !j.IsDeleted);
            if (job == null)
                return Fail("Job no longer available.");

            if (job.Status != JobStatus.Open.ToDisplayString())
                return Fail("This job was already assigned.");

            var requiredSlots = _db.JobTimeSlots
                .Where(js => js.Job_ID == job.Job_ID && js.Slot_ID.HasValue)
                .Select(js => js.Slot_ID.Value)
                .ToList();

            if (HasConflict(currentSitterId, job.JobDate, requiredSlots))
                return Fail("You already have another booking at this time.");

            _db.Database.ExecuteSqlCommand(
                "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 WHERE JobInvitation_ID = @p2",
                "Accepted", DateTime.UtcNow, invitationId);
            _db.SaveChanges();

            int jobId = inv.Job_ID.Value;
            int sitterId = currentSitterId;
            var anchorJob = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (anchorJob != null && anchorJob.JobSeries_ID.HasValue)
            {
                string newStatus = "Accepted";
                var siblingIds = _db.Jobs
                    .Where(j => j.JobSeries_ID == anchorJob.JobSeries_ID.Value
                             && !j.IsDeleted
                             && j.Job_ID != jobId)
                    .Select(j => j.Job_ID)
                    .ToList();

                foreach (var sibId in siblingIds)
                {
                    _db.Database.ExecuteSqlCommand(
                        "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                        "WHERE Job_ID = @p2 AND Sitter_ID = @p3",
                        newStatus, DateTime.UtcNow, sibId, sitterId);
                    _db.SaveChanges();
                }
            }

            if (job.Parent_ID.HasValue)
            {
                var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == currentSitterId);
                _notificationService.CreateNotification(new NotificationDto
                {
                    UserId = job.Parent_ID.Value,
                    UserRole = "Parent",
                    Message = (sitter != null ? sitter.FullName : "A sitter") + " accepted your invitation for: " + job.Title,
                    Type = "InvitationAccepted",
                    IsRead = false
                });
            }

            return Ok("Invitation accepted.");
        }

        // ------------------------------------------------------------------
        // Sitter: decline an invitation
        // ------------------------------------------------------------------
        public InvitationOperationResult Decline(int invitationId, int currentSitterId)
        {
            var inv = GetInvRow(invitationId);
            if (inv == null || !inv.Sitter_ID.HasValue || inv.Sitter_ID.Value != currentSitterId)
                return Fail("Invitation not found.");

            if (!string.Equals(inv.Status, "Invited", StringComparison.OrdinalIgnoreCase))
                return Fail("Invitation already " + inv.Status + ".");

            var job = inv.Job_ID.HasValue
                ? _db.Jobs.FirstOrDefault(j => j.Job_ID == inv.Job_ID.Value && !j.IsDeleted)
                : null;

            _db.Database.ExecuteSqlCommand(
                "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 WHERE JobInvitation_ID = @p2",
                "Declined", DateTime.UtcNow, invitationId);
            _db.SaveChanges();

            int? nullableJobId = inv.Job_ID;
            int sitterId = currentSitterId;
            if (nullableJobId.HasValue)
            {
                int jobId = nullableJobId.Value;
                var anchorJob = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
                if (anchorJob != null && anchorJob.JobSeries_ID.HasValue)
                {
                    string newStatus = "Declined";
                    var siblingIds = _db.Jobs
                        .Where(j => j.JobSeries_ID == anchorJob.JobSeries_ID.Value
                                 && !j.IsDeleted
                                 && j.Job_ID != jobId)
                        .Select(j => j.Job_ID)
                        .ToList();

                    foreach (var sibId in siblingIds)
                    {
                        _db.Database.ExecuteSqlCommand(
                            "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                            "WHERE Job_ID = @p2 AND Sitter_ID = @p3",
                            newStatus, DateTime.UtcNow, sibId, sitterId);
                        _db.SaveChanges();
                    }
                }
            }

            if (job != null && job.Parent_ID.HasValue)
            {
                var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == currentSitterId);
                _notificationService.CreateNotification(new NotificationDto
                {
                    UserId = job.Parent_ID.Value,
                    UserRole = "Parent",
                    Message = (sitter != null ? sitter.FullName : "A sitter") + " declined your invitation for: " + job.Title,
                    Type = "InvitationDeclined",
                    IsRead = false
                });
            }

            return Ok("Invitation declined.");
        }

        public InvitationOperationResult DeclineByJob(int jobId, int currentSitterId)
        {
            if (jobId <= 0 || currentSitterId <= 0)
                return new InvitationOperationResult { Success = false, Message = "Invalid IDs." };

            var inv = _db.Database.SqlQuery<JobInvitationRowDto>(
                "SELECT JobInvitation_ID, Job_ID, Sitter_ID, Status, InvitedAt, RespondedAt " +
                "FROM JobInvitation WHERE Job_ID = @p0 AND Sitter_ID = @p1",
                jobId, currentSitterId).FirstOrDefault();

            if (inv == null)
                return new InvitationOperationResult { Success = false, Message = "No invitation found for this job." };

            if (!string.Equals(inv.Status, "Invited", StringComparison.OrdinalIgnoreCase))
                return new InvitationOperationResult { Success = false, Message = $"Invitation already {inv.Status}." };

            return Decline(inv.JobInvitation_ID, currentSitterId);
        }

        // ------------------------------------------------------------------
        // Parent: hire one accepted sitter; supersede all other Accepteds
        // ------------------------------------------------------------------
        public InvitationOperationResult Hire(int jobId, HireSitterDto dto)
        {
            if (dto == null)
                return Fail("Invalid request.");

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (job == null)
                return Fail("Job not found.");

            int jobParentId = job.Parent_ID.HasValue ? job.Parent_ID.Value : 0;
            if (jobParentId != dto.ParentId)
                return Fail("Not your job.");

            if (job.Status != JobStatus.Open.ToDisplayString())
                return Fail("Job is not open.");

            var inv = _db.Database.SqlQuery<JobInvitationRowDto>(
                "SELECT JobInvitation_ID, Job_ID, Sitter_ID, Status, InvitedAt, RespondedAt " +
                "FROM JobInvitation WHERE Job_ID = @p0 AND Sitter_ID = @p1 AND Status = @p2",
                jobId, dto.SitterId, "Accepted").FirstOrDefault();

            if (inv == null)
                return Fail("That sitter has not accepted this job.");

            var requiredSlots = _db.JobTimeSlots
                .Where(js => js.Job_ID == job.Job_ID && js.Slot_ID.HasValue)
                .Select(js => js.Slot_ID.Value)
                .ToList();

            if (HasConflict(dto.SitterId, job.JobDate, requiredSlots))
                return Fail("That sitter now has a conflicting booking.");

            // Chosen sitter -> Hired;
            _db.Database.ExecuteSqlCommand(
                "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 WHERE Job_ID = @p2 AND Sitter_ID = @p3",
                "Hired", DateTime.UtcNow, jobId, dto.SitterId);

            // All other Invited AND Accepted for this job -> Superseded
            _db.Database.ExecuteSqlCommand(
                "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                "WHERE Job_ID = @p2 AND Sitter_ID <> @p3 AND (Status = @p4 OR Status = @p5)",
                "Superseded", DateTime.UtcNow, jobId, dto.SitterId, "Accepted", "Invited");

            // Job -> Assigned to the chosen sitter.
            job.Status = JobStatus.Assigned.ToDisplayString();
            job.AssignedSitter_ID = dto.SitterId;

            _db.SaveChanges();

            // Cascade to sibling jobs of the same series
            if (job.JobSeries_ID.HasValue)
            {
                var siblingJobs = _db.Jobs
                    .Where(j => j.JobSeries_ID == job.JobSeries_ID.Value
                             && !j.IsDeleted
                             && j.Job_ID != job.Job_ID)
                    .ToList();

                foreach (var sib in siblingJobs)
                {
                    if (string.Equals(sib.Status, JobStatus.Open.ToDisplayString(),
                                      StringComparison.OrdinalIgnoreCase))
                    {
                        sib.Status = JobStatus.Assigned.ToDisplayString();
                        sib.AssignedSitter_ID = dto.SitterId;
                    }
                }
                _db.SaveChanges();
            }

            var seriesNote = job.JobSeries_ID.HasValue ? " (full series)" : "";
            var hired = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == dto.SitterId);
            _notificationService.CreateNotification(new NotificationDto
            {
                UserId = dto.SitterId,
                UserRole = "Sitter",
                Message = "You have been hired for: " + job.Title + seriesNote,
                Type = "InvitationHired",
                IsRead = false
            });

            var superseded = _db.Database.SqlQuery<SupersededRowDto>(
                "SELECT Sitter_ID FROM JobInvitation WHERE Job_ID = @p0 AND Status = @p1",
                jobId, "Superseded").ToList();

            foreach (var s in superseded)
            {
                if (!s.Sitter_ID.HasValue)
                    continue;

                _notificationService.CreateNotification(new NotificationDto
                {
                    UserId = s.Sitter_ID.Value,
                    UserRole = "Sitter",
                    Message = "Another sitter was hired for: " + job.Title,
                    Type = "InvitationSuperseded",
                    IsRead = false
                });
            }

            return Ok("Sitter hired.");
        }

        // ------------------------------------------------------------------
        // Private Helpers
        // ------------------------------------------------------------------
        private int CountInvitationsForJob(int jobId)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM JobInvitation WHERE Job_ID = @p0",
                jobId).FirstOrDefault();
        }

        private bool ExistsInvitation(int jobId, int sitterId)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM JobInvitation WHERE Job_ID = @p0 AND Sitter_ID = @p1",
                jobId, sitterId).FirstOrDefault() > 0;
        }

        private bool IsLocked(int sitterId)
        {
            var row = _db.Database
                .SqlQuery<SitterLockoutRow>(
                    "SELECT Sitter_ID, SitterLockedUntil FROM Babysitter WHERE Sitter_ID = @p0",
                    sitterId)
                .FirstOrDefault();

            return row != null && row.SitterLockedUntil.HasValue && row.SitterLockedUntil.Value > DateTime.UtcNow;
        }

        private JobInvitationRowDto GetInvRow(int invitationId)
        {
            return _db.Database.SqlQuery<JobInvitationRowDto>(
                "SELECT JobInvitation_ID, Job_ID, Sitter_ID, Status, InvitedAt, RespondedAt " +
                "FROM JobInvitation WHERE JobInvitation_ID = @p0",
                invitationId).FirstOrDefault();
        }

        private int CountAcceptedForJob(int jobId)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM JobInvitation WHERE Job_ID = @p0 AND Status = @p1",
                jobId, "Accepted").FirstOrDefault();
        }

        private bool HasConflict(int sitterId, DateTime? jobDate, List<int> requiredSlotIds)
        {
            if (!jobDate.HasValue || requiredSlotIds == null || !requiredSlotIds.Any())
                return false;

            var conflictSlots = new HashSet<int>(requiredSlotIds);
            int minSlot = requiredSlotIds.Min();
            if (minSlot > 1)
                conflictSlots.Add(minSlot - 1);

            string assignedStatus = JobStatus.Assigned.ToDisplayString();
            string inProgressStatus = JobStatus.InProgress.ToDisplayString();

            return _db.Jobs.Any(j =>
                !j.IsDeleted &&
                j.AssignedSitter_ID == sitterId &&
                (j.Status == assignedStatus || j.Status == inProgressStatus) &&
                DbFunctions.TruncateTime(j.JobDate) == DbFunctions.TruncateTime(jobDate.Value) &&
                _db.JobTimeSlots.Any(js =>
                    js.Job_ID == j.Job_ID &&
                    js.Slot_ID.HasValue &&
                    conflictSlots.Contains(js.Slot_ID.Value))
            );
        }

        private static InvitationOperationResult Fail(string message)
        {
            return new InvitationOperationResult
            {
                Success = false,
                Message = message
            };
        }

        private static InvitationOperationResult Ok(string message, int? id = null)
        {
            return new InvitationOperationResult
            {
                Success = true,
                Message = message,
                JobInvitationId = id
            };
        }

        private List<JobChildDTO> GetJobChildren(int jobId)
        {
            var rows = _db.Database.SqlQuery<JobChildDTO>(
                @"SELECT c.Child_ID, c.ChildName, c.DOB, c.Gender,
                         c.PictureAddress, c.SpecialRequirements
                  FROM JobChildren jc
                  INNER JOIN Child c ON c.Child_ID = jc.Child_ID
                  WHERE jc.Job_ID = @p0
                    AND jc.IsDeleted = 0
                    AND c.IsDeleted = 0
                  ORDER BY jc.JobChild_ID",
                jobId).ToList();

            foreach (var row in rows)
            {
                if (row.DOB.HasValue)
                {
                    var today = DateTime.Today;
                    int age = today.Year - row.DOB.Value.Year;
                    if (today < row.DOB.Value.AddYears(age)) age--;
                    row.ChildAge = age;
                }
            }

            return rows;
        }

        public void Dispose()
        {
            if (_ownsContext)
            {
                _db?.Dispose();
            }
        }
    }
}