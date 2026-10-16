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

        /// <summary>
        /// Phase 1B/G1: inserts a notification on the CALLER'S context so it
        /// participates in the ambient transaction (raw SQL — same pattern as the
        /// Phase 1A series path). NotificationService (separate per-call context)
        /// is intentionally NOT used inside transactional flows.
        /// CreatedAt uses server local time to match the documented
        /// NotificationService.DateTime.Now convention.
        /// </summary>
        private void InsertNotification(int userId, string userRole, string message, string type)
        {
            _db.Database.ExecuteSqlCommand(
                "INSERT INTO Notification (UserID, UserRole, Message, IsRead, CreatedAt, Type, IsDeleted) " +
                "VALUES (@p0, @p1, @p2, 0, GETDATE(), @p3, 0)",
                userId, userRole, message, type);
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
            // Phase A (post-demo fix): BOTH pending and ACCEPTED invitations
            // surface here while the job is still 'Open'. Accepting a series
            // previously removed every card from this screen (the old query
            // returned only 'Invited'), so an accepted sitter had nowhere to
            // see the state "Accepted — waiting for parent to hire".
            //
            // The j.Status = 'Open' guard remains the terminal-state filter:
            // once the parent hires, the job leaves 'Open' (Assigned / In
            // Progress / Completed / Cancelled) and the rows disappear from
            // this list — the assigned job then appears under My Jobs instead.
            // An accepted row can therefore never linger here long after the
            // job has finished. Every column is alias-qualified because both
            // JobInvitation and Job expose Job_ID and Status.
            var rows = _db.Database.SqlQuery<JobInvitationRowDto>(
                "SELECT i.JobInvitation_ID, i.Job_ID, i.Sitter_ID, i.Status, i.InvitedAt, i.RespondedAt " +
                "FROM JobInvitation i " +
                "INNER JOIN Job j ON j.Job_ID = i.Job_ID " +
                "WHERE i.Sitter_ID = @p0 AND i.Status IN (@p1, @p2) AND j.Status = @p3 AND j.IsDeleted = 0 " +
                "ORDER BY i.InvitedAt DESC",
                sitterId, "Invited", "Accepted", JobStatus.Open.ToDisplayString()).ToList();


            // ------------------------------------------------------------------
            // N+1 elimination (evidence-driven). The profiler measured 4,834 SQL
            // statements for 1,208 rows (~4 per row): each invitation re-queried
            // its job, its accepted count, its series-sibling totals and its
            // children. Those four hot paths now run ONCE each below (chunked to
            // respect SQL Server's 2,100-parameter limit) and the results are
            // joined in memory by key, so the statement count is O(1) in the row
            // count, not O(rows). Every DTO field value, null semantic, ordering,
            // the Invited/Accepted visibility rule, the Open/non-deleted filter,
            // series grouping and per-job child ordering are preserved exactly.
            // ------------------------------------------------------------------
            var jobIds = rows.Where(r => r.Job_ID.HasValue)
                             .Select(r => r.Job_ID.Value).Distinct().ToList();

            // 1) Jobs (+ parent) for every returned invitation id. Eager-loading
            //    the Parent here reproduces the previous lazy-load of job.Parent
            //    with identical null semantics (no parent row => null Parent).
            var jobsById = new Dictionary<int, Job>();
            foreach (var chunk in Chunk(jobIds, 1000))
            {
                var jobs = _db.Jobs.Include(j => j.Parent)
                    .Where(j => chunk.Contains(j.Job_ID) && !j.IsDeleted).ToList();
                foreach (var job in jobs) jobsById[job.Job_ID] = job;
            }

            // 2) Accepted-invitation counts grouped by job id (was: one COUNT per
            //    row via CountAcceptedForJob).
            var acceptedCounts = new Dictionary<int, int>();
            foreach (var chunk in Chunk(jobIds, 1000))
            {
                var part = _db.Database.SqlQuery<AcceptedCountRow>(
                    "SELECT Job_ID, COUNT(*) AS Cnt FROM JobInvitation " +
                    "WHERE Status = @p0 AND Job_ID IN (" + InClause(chunk, 1) + ") " +
                    "GROUP BY Job_ID",
                    BuildParams(chunk, "Accepted")).ToList();
                foreach (var row in part) acceptedCounts[row.Job_ID] = row.Cnt;
            }

            // 3) Sibling-series occurrence count + payment total grouped by series
            //    id (was: one per-row sibling scan). SUM(ISNULL(Payment,0)) mirrors
            //    the previous in-memory Sum(j => j.Payment ?? 0m).
            var seriesIds = jobsById.Values.Where(j => j.JobSeries_ID.HasValue)
                .Select(j => j.JobSeries_ID.Value).Distinct().ToList();
            var seriesTotals = new Dictionary<int, SeriesTotalRow>();
            foreach (var chunk in Chunk(seriesIds, 1000))
            {
                var part = _db.Database.SqlQuery<SeriesTotalRow>(
                    "SELECT JobSeries_ID, COUNT(*) AS Cnt, SUM(ISNULL(Payment, 0)) AS TotalPayment " +
                    "FROM Job WHERE IsDeleted = 0 AND JobSeries_ID IN (" + InClause(chunk, 0) + ") " +
                    "GROUP BY JobSeries_ID",
                    chunk.Cast<object>().ToArray()).ToList();
                foreach (var row in part) seriesTotals[row.JobSeries_ID] = row;
            }

            // 4) Child records grouped by job id (was: GetJobChildren per row).
            //    Ordering by Job_ID then JobChild_ID preserves each job's original
            //    per-job Child_ID order exactly.
            var childrenByJob = new Dictionary<int, List<JobChildDTO>>();
            foreach (var chunk in Chunk(jobIds, 1000))
            {
                var part = _db.Database.SqlQuery<JobChildRow>(
                    "SELECT jc.Job_ID, c.Child_ID, c.ChildName, c.DOB, c.Gender, " +
                    "       c.PictureAddress, c.SpecialRequirements " +
                    "FROM JobChildren jc INNER JOIN Child c ON c.Child_ID = jc.Child_ID " +
                    "WHERE jc.Job_ID IN (" + InClause(chunk, 0) + ") " +
                    "  AND jc.IsDeleted = 0 AND c.IsDeleted = 0 " +
                    "ORDER BY jc.Job_ID, jc.JobChild_ID",
                    chunk.Cast<object>().ToArray()).ToList();
                foreach (var row in part)
                {
                    List<JobChildDTO> list;
                    if (!childrenByJob.TryGetValue(row.Job_ID, out list))
                        childrenByJob[row.Job_ID] = list = new List<JobChildDTO>();
                    var child = new JobChildDTO
                    {
                        Child_ID = row.Child_ID,
                        ChildName = row.ChildName,
                        DOB = row.DOB,
                        Gender = row.Gender,
                        PictureAddress = row.PictureAddress,
                        SpecialRequirements = row.SpecialRequirements
                    };
                    if (child.DOB.HasValue)
                    {
                        var today = DateTime.Today;
                        int age = today.Year - child.DOB.Value.Year;
                        if (today < child.DOB.Value.AddYears(age)) age--;
                        child.ChildAge = age;
                    }
                    list.Add(child);
                }
            }


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
                    AcceptedCount = (r.Job_ID.HasValue && acceptedCounts.ContainsKey(r.Job_ID.Value))
                        ? acceptedCounts[r.Job_ID.Value] : 0,
                    InvitedAt = r.InvitedAt
                };

                Job job;
                if (r.Job_ID.HasValue)
                {
                    // A job absent from jobsById was deleted/non-existent: the old
                    // FirstOrDefault-null path did `continue` here, so skip it too.
                    if (!jobsById.TryGetValue(r.Job_ID.Value, out job))
                        continue;
                    // Preserve the terminal-state skip exactly: a Cancelled job is
                    // dropped from the list.
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

                    // Series fields - the sitter list collapses the N per-day
                    // invitations of one series into a single card. Totals come
                    // from the grouped sibling query above (same COUNT / SUM
                    // shape JobService.GetSeriesSummary uses).
                    item.JobSeries_ID = job.JobSeries_ID;
                    item.SeriesOccurrenceIndex = job.SeriesOccurrenceIndex;
                    SeriesTotalRow total;
                    if (job.JobSeries_ID.HasValue &&
                        seriesTotals.TryGetValue(job.JobSeries_ID.Value, out total) &&
                        total.Cnt > 0)
                    {
                        item.SeriesTotalCount = total.Cnt;
                        item.SeriesTotalPayment = total.TotalPayment;
                    }
                }

                // Children (multi-child support) from the grouped query above. A
                // Job_ID > 0 row always gets a non-null list (empty when the job
                // has no children), matching the previous GetJobChildren result.
                if (item.Job_ID > 0)
                {
                    List<JobChildDTO> children;
                    item.Children = childrenByJob.TryGetValue(item.Job_ID, out children)
                        ? children : new List<JobChildDTO>();
                }

                result.Add(item);
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

            // Phase A (post-demo fix): the accept below cascades to EVERY
            // invitation of this sitter in the series, so the conflict check
            // must cover every OPEN sibling date — not only the anchor the
            // sitter clicked. Without this, a clash on a later occurrence was
            // only discovered later (or never) even though accepting commits
            // the sitter to the whole series.
            if (job.JobSeries_ID.HasValue)
            {
                var clashDate = FindSeriesConflictDate(currentSitterId, job.JobSeries_ID.Value, job.Job_ID);
                if (clashDate != null)
                    return Fail("You already have another booking on " + clashDate +
                                ". Accepting covers every day of this series, so it cannot be accepted.");
            }

            // Phase 1B/G1: atomic accept — anchor, series cascade and notification
            // commit or roll back together. The conditional anchor UPDATE is the
            // concurrency guard: a racing accept/hire blocks on the row lock under
            // READ COMMITTED, and the loser matches zero rows -> conflict response
            // (never a silent no-op success).
            using (var tx = _db.Database.BeginTransaction())
            {
                int anchorRows = _db.Database.ExecuteSqlCommand(
                    "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                    "WHERE JobInvitation_ID = @p2 AND Status = @p3",
                    "Accepted", DateTime.UtcNow, invitationId, "Invited");
                if (anchorRows == 0)
                {
                    tx.Rollback();
                    var current = GetInvRow(invitationId);
                    return Fail("Invitation already " + (current != null ? current.Status : "responded") + ".");
                }

                int jobId = inv.Job_ID.Value;
                var anchorJob = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
                if (anchorJob != null && anchorJob.JobSeries_ID.HasValue)
                {
                    // Identical semantics to the previous per-sibling loop (all of
                    // this sitter's series invitations -> Accepted), as one statement.
                    _db.Database.ExecuteSqlCommand(
                        "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                        "WHERE Job_ID IN (SELECT Job_ID FROM Job WHERE JobSeries_ID = @p2 AND IsDeleted = 0) " +
                        "AND Sitter_ID = @p3",
                        "Accepted", DateTime.UtcNow, anchorJob.JobSeries_ID.Value, currentSitterId);
                }

                if (job.Parent_ID.HasValue)
                {
                    var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == currentSitterId);
                    InsertNotification(job.Parent_ID.Value, "Parent",
                        (sitter != null ? sitter.FullName : "A sitter") + " accepted your invitation for: " + job.Title,
                        "InvitationAccepted");
                }

                tx.Commit();
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

            // Phase 1B/G1: atomic decline — anchor, series cascade and notification
            // commit or roll back together; conditional anchor UPDATE = concurrency guard.
            using (var tx = _db.Database.BeginTransaction())
            {
                int anchorRows = _db.Database.ExecuteSqlCommand(
                    "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                    "WHERE JobInvitation_ID = @p2 AND Status = @p3",
                    "Declined", DateTime.UtcNow, invitationId, "Invited");
                if (anchorRows == 0)
                {
                    tx.Rollback();
                    var current = GetInvRow(invitationId);
                    return Fail("Invitation already " + (current != null ? current.Status : "responded") + ".");
                }

                if (inv.Job_ID.HasValue)
                {
                    var anchorJob = _db.Jobs.FirstOrDefault(j => j.Job_ID == inv.Job_ID.Value && !j.IsDeleted);
                    if (anchorJob != null && anchorJob.JobSeries_ID.HasValue)
                    {
                        _db.Database.ExecuteSqlCommand(
                            "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                            "WHERE Job_ID IN (SELECT Job_ID FROM Job WHERE JobSeries_ID = @p2 AND IsDeleted = 0) " +
                            "AND Sitter_ID = @p3",
                            "Declined", DateTime.UtcNow, anchorJob.JobSeries_ID.Value, currentSitterId);
                    }
                }

                if (job != null && job.Parent_ID.HasValue)
                {
                    var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == currentSitterId);
                    InsertNotification(job.Parent_ID.Value, "Parent",
                        (sitter != null ? sitter.FullName : "A sitter") + " declined your invitation for: " + job.Title,
                        "InvitationDeclined");
                }

                tx.Commit();
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

            // Phase A: hiring cascades assignment across every OPEN sibling of
            // the series, so validate each sibling date — not just the day the
            // parent happened to open. Mirrors the Accept-side series scan.
            if (job.JobSeries_ID.HasValue)
            {
                var clashDate = FindSeriesConflictDate(dto.SitterId, job.JobSeries_ID.Value, job.Job_ID);
                if (clashDate != null)
                    return Fail("That sitter now has a conflicting booking on " + clashDate + ".");
            }

            // Phase 1B/G1: atomic hire — hired/superseded invitations, head + series
            // assignment and ALL notifications commit or roll back together.
            // Conditional UPDATEs are the concurrency guards: a racing hire/accept
            // matches zero rows on the loser -> existing conflict message, never a
            // contradictory assignment or duplicate notification.
            using (var tx = _db.Database.BeginTransaction())
            {
                // Chosen sitter -> Hired (only from Accepted: exactly-once)
                int hiredRows = _db.Database.ExecuteSqlCommand(
                    "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                    "WHERE Job_ID = @p2 AND Sitter_ID = @p3 AND Status = @p4",
                    "Hired", DateTime.UtcNow, jobId, dto.SitterId, "Accepted");
                if (hiredRows == 0)
                {
                    tx.Rollback();
                    return Fail("That sitter has not accepted this job.");
                }

                // All other Invited AND Accepted for this job -> Superseded (unchanged semantics)
                _db.Database.ExecuteSqlCommand(
                    "UPDATE JobInvitation SET Status = @p0, RespondedAt = @p1 " +
                    "WHERE Job_ID = @p2 AND Sitter_ID <> @p3 AND (Status = @p4 OR Status = @p5)",
                    "Superseded", DateTime.UtcNow, jobId, dto.SitterId, "Accepted", "Invited");

                // Job -> Assigned (conditional on Open: stale/repeated hire = conflict)
                int assignedRows = _db.Database.ExecuteSqlCommand(
                    "UPDATE Job SET Status = @p0, AssignedSitter_ID = @p1 WHERE Job_ID = @p2 AND Status = @p3",
                    JobStatus.Assigned.ToDisplayString(), dto.SitterId, jobId, JobStatus.Open.ToDisplayString());
                if (assignedRows == 0)
                {
                    tx.Rollback();
                    return Fail("Job is not open.");
                }

                // Cascade to sibling jobs of the same series (unchanged semantics:
                // only Open, non-deleted siblings are assigned)
                if (job.JobSeries_ID.HasValue)
                {
                    _db.Database.ExecuteSqlCommand(
                        "UPDATE Job SET Status = @p0, AssignedSitter_ID = @p1 " +
                        "WHERE JobSeries_ID = @p2 AND Job_ID <> @p3 AND Status = @p4 AND IsDeleted = 0",
                        JobStatus.Assigned.ToDisplayString(), dto.SitterId,
                        job.JobSeries_ID.Value, jobId, JobStatus.Open.ToDisplayString());
                }

                var seriesNote = job.JobSeries_ID.HasValue ? " (full series)" : "";
                InsertNotification(dto.SitterId, "Sitter",
                    "You have been hired for: " + job.Title + seriesNote, "InvitationHired");

                var superseded = _db.Database.SqlQuery<SupersededRowDto>(
                    "SELECT Sitter_ID FROM JobInvitation WHERE Job_ID = @p0 AND Status = @p1",
                    jobId, "Superseded").ToList();

                foreach (var s in superseded)
                {
                    if (!s.Sitter_ID.HasValue)
                        continue;

                    InsertNotification(s.Sitter_ID.Value, "Sitter",
                        "Another sitter was hired for: " + job.Title, "InvitationSuperseded");
                }

                tx.Commit();
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

        // ------------------------------------------------------------------
        // Batched-query helpers for GetInvitationsForSitter's N+1 fix.
        // ID lists are chunked under SQL Server's 2,100-parameter limit and
        // every value is passed as a positional parameter (@p0, @p1, ...),
        // never concatenated, so no user-controlled text reaches the SQL text.
        // ------------------------------------------------------------------

        /// <summary>Row shape for the grouped accepted-invitation count query.</summary>
        private class AcceptedCountRow
        {
            public int Job_ID { get; set; }
            public int Cnt { get; set; }
        }

        /// <summary>Row shape for the grouped series sibling count/payment query.</summary>
        private class SeriesTotalRow
        {
            public int JobSeries_ID { get; set; }
            public int Cnt { get; set; }
            public decimal TotalPayment { get; set; }
        }

        /// <summary>Row shape for the grouped multi-job child query (Job_ID key).</summary>
        private class JobChildRow
        {
            public int Job_ID { get; set; }
            public int Child_ID { get; set; }
            public string ChildName { get; set; }
            public DateTime? DOB { get; set; }
            public string Gender { get; set; }
            public string PictureAddress { get; set; }
            public string SpecialRequirements { get; set; }
        }

        /// <summary>
        /// Splits a list into fixed-size chunks so a batched IN (...) clause never
        /// exceeds SQL Server's parameter ceiling. Empty input yields no chunks.
        /// </summary>
        private static IEnumerable<List<int>> Chunk(List<int> ids, int size)
        {
            for (int i = 0; i < ids.Count; i += size)
            {
                int take = Math.Min(size, ids.Count - i);
                yield return ids.GetRange(i, take);
            }
        }

        /// <summary>
        /// Builds a positional parameter list "@p0,@p1,..." for a chunk, optionally
        /// preceded by leading fixed parameters (e.g. a status literal) whose count
        /// is <paramref name="leadingCount"/>.
        /// </summary>
        private static string InClause(List<int> ids, int leadingCount)
        {
            var names = new string[ids.Count];
            for (int i = 0; i < ids.Count; i++)
                names[i] = "@p" + (leadingCount + i);
            return string.Join(",", names);
        }

        /// <summary>
        /// Builds the positional parameter array for a chunk: the leading fixed
        /// values first (in order), then the chunk ids.
        /// </summary>
        private static object[] BuildParams(List<int> ids, params object[] leading)
        {
            var args = new object[leading.Length + ids.Count];
            leading.CopyTo(args, 0);
            for (int i = 0; i < ids.Count; i++) args[leading.Length + i] = ids[i];
            return args;
        }

        private int CountAcceptedForJob(int jobId)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM JobInvitation WHERE Job_ID = @p0 AND Status = @p1",
                jobId, "Accepted").FirstOrDefault();
        }

        /// <summary>
        /// Phase A: per-occurrence conflict scan for a series. Returns the first
        /// OPEN sibling date (formatted for the user) where <paramref name="sitterId"/>
        /// already holds an Assigned/In-Progress booking overlapping that
        /// sibling's time slots, or null when every sibling date is clear.
        /// The anchor job is excluded — its own HasConflict call has already run.
        /// Only OPEN siblings are checked because they are the ones Accept/Hire
        /// actually commit; cancelled/completed days cannot conflict.
        /// </summary>
        private string FindSeriesConflictDate(int sitterId, int seriesId, int excludeJobId)
        {
            string openStatus = JobStatus.Open.ToDisplayString();
            var siblings = _db.Jobs
                .Where(j => j.JobSeries_ID == seriesId && !j.IsDeleted &&
                            j.Status == openStatus && j.Job_ID != excludeJobId)
                .Select(j => new { j.Job_ID, j.JobDate })
                .ToList();

            if (siblings.Count == 0) return null;

            var jobIds = siblings.Select(j => j.Job_ID).ToList();
            var slotsByJob = new Dictionary<int, List<int>>();
            var slotRows = _db.JobTimeSlots
                .Where(js => js.Job_ID.HasValue && jobIds.Contains(js.Job_ID.Value) && js.Slot_ID.HasValue)
                .ToList();
            foreach (var row in slotRows)
            {
                int key = row.Job_ID.Value;
                if (!slotsByJob.ContainsKey(key)) slotsByJob[key] = new List<int>();
                slotsByJob[key].Add(row.Slot_ID.Value);
            }

            foreach (var s in siblings)
            {
                List<int> slots;
                if (!slotsByJob.TryGetValue(s.Job_ID, out slots))
                    slots = new List<int>();

                if (HasConflict(sitterId, s.JobDate, slots))
                    return s.JobDate.ToString("ddd, dd MMM yyyy");
            }

            return null;
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