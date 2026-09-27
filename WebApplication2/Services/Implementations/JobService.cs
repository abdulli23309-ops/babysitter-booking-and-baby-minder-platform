using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Data.Entity;
using System.Linq;
using System.Threading.Tasks;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    public class JobService : IJobService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;
        private readonly INotificationService _notificationService;

        public JobService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true, notificationService: null)
        {
        }

        public JobService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false, INotificationService notificationService = null)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
            _notificationService = notificationService ?? new NotificationService();
        }

        /// <summary>
        /// Resolves the sitter's hourly rate for a specific date: prefers the rate the sitter
        /// set on the availability screen for that date, falling back to the signup default.
        /// Mirrors MatchingService.ResolveRate.
        /// </summary>
        private decimal ResolveRateForDate(Babysitter s, DateTime date)
        {
            var row = _db.SitterAvailabilities
                .Where(a => a.Sitter_ID == s.Sitter_ID
                         && !a.IsDeleted
                         && a.AvailableDate == date
                         && a.HourlyRate != null)
                .OrderByDescending(a => a.Availability_ID)
                .FirstOrDefault();

            if (row != null && row.HourlyRate.HasValue && row.HourlyRate.Value > 0)
                return row.HourlyRate.Value;

            return s.HourlyRate ?? 0;
        }

        /// <summary>
        /// Expands a parent's recurring booking into a concrete list of
        /// dates. Mirrors the day-matching logic in MatchingService so
        /// the series respects the exact same SelectedDays semantics.
        /// Accepts either full weekday names ('Monday') or 3-letter
        /// abbreviations ('Mon'), case-insensitive.
        /// </summary>
        private List<DateTime> ExpandSeriesDates(
            DateTime startDate,
            DateTime endDate,
            List<string> selectedDays)
        {
            var result = new List<DateTime>();
            if (selectedDays == null || selectedDays.Count == 0)
                return result;

            // Guard: don't allow an unbounded loop (e.g. Year 2100).
            if ((endDate - startDate).TotalDays > 365)
                endDate = startDate.AddDays(365);

            var wanted = new HashSet<string>(
                selectedDays.Select(d => (d ?? "").Trim()),
                StringComparer.OrdinalIgnoreCase);

            for (var d = startDate.Date; d <= endDate.Date; d = d.AddDays(1))
            {
                string full = d.DayOfWeek.ToString();   // 'Monday'
                string short3 = d.ToString("ddd");      // 'Mon'
                if (wanted.Contains(full) || wanted.Contains(short3))
                    result.Add(d);
            }
            return result;
        }

        /// <summary>
        /// Phase 8c — total Payment across COMPLETED days in a series.
        ///
        /// The context is passed in rather than using the injected _db, because
        /// GetJobById opens its own short-lived context inside a `using` block
        /// while GetJobDetails uses the injected one. Taking the context keeps
        /// this helper correct for both without duplicating the query.
        ///
        /// Returns null for a single-day job (no series), so the frontend can
        /// distinguish "not a series" from "series with nothing earned yet".
        /// </summary>
        private static decimal? GetSeriesEarnedSoFar(
            BabySitterBooking_and_BabyMinderEntities ctx, int? seriesId)
        {
            if (!seriesId.HasValue) return null;

            // SUM over zero rows is NULL, so a brand-new series reports 0
            // rather than disappearing.
            return ctx.Database
                .SqlQuery<decimal?>(
                    "SELECT SUM(Payment) FROM Job " +
                    "WHERE JobSeries_ID = @p0 AND IsDeleted = 0 " +
                    "  AND Status = 'Completed'",
                    seriesId.Value)
                .FirstOrDefault() ?? 0m;
        }

        public CreateJobResult CreateJobForSitter(CreateJobDto dto)
        {
            if (dto == null)
                throw new ArgumentNullException(nameof(dto));

            if (dto.ParentId <= 0 || dto.SitterId <= 0)
                throw new ArgumentException("Parent ID and Sitter ID must be positive integers.");

            // When NOT booking for all children, ChildId must be positive
            if (!dto.IsForAllChildren && dto.ChildId <= 0)
                throw new ArgumentException("Child ID must be a positive integer.");

            var lockoutRow = _db.Database
                .SqlQuery<SitterLockoutRow>(
                    "SELECT Sitter_ID, SitterLockedUntil FROM Babysitter WHERE Sitter_ID = @p0",
                    dto.SitterId)
                .FirstOrDefault();

            if (lockoutRow != null
                && lockoutRow.SitterLockedUntil.HasValue
                && lockoutRow.SitterLockedUntil.Value > DateTime.UtcNow)
            {
                throw new InvalidOperationException(
                    "This sitter is temporarily unavailable and will resume bookings after " +
                    lockoutRow.SitterLockedUntil.Value.ToString("HH:mm") + " UTC. " +
                    "Please choose another sitter.");
            }

            // 1. Get sitter's hourly rate (must be active)
            var sitter = _db.Babysitters.FirstOrDefault(s => s.Sitter_ID == dto.SitterId && !s.IsDeleted);
            if (sitter == null)
                throw new InvalidOperationException("Sitter not found or inactive.");

            // 2. Determine which children to book for
            List<int> childIdsToBook;
            if (dto.IsForAllChildren && dto.AllChildIds != null && dto.AllChildIds.Count > 0)
            {
                var validChildren = _db.Children
                    .Where(c => dto.AllChildIds.Contains(c.Child_ID) && c.Parent_ID == dto.ParentId && !c.IsDeleted)
                    .Select(c => c.Child_ID)
                    .ToList();
                if (validChildren.Count == 0)
                    throw new InvalidOperationException("No valid children found for this parent.");
                childIdsToBook = validChildren;
            }
            else
            {
                var child = _db.Children.FirstOrDefault(c => c.Child_ID == dto.ChildId && c.Parent_ID == dto.ParentId && !c.IsDeleted);
                if (child == null)
                    throw new InvalidOperationException("Child not found or inactive.");
                childIdsToBook = new List<int> { dto.ChildId };
            }

            decimal hourlyRate = ResolveRateForDate(sitter, dto.StartDate);

            // 3. Calculate total hours based on start & end time
            TimeSpan startTime, endTime;
            if (!TimeSpan.TryParse(dto.StartTime, out startTime) || !TimeSpan.TryParse(dto.EndTime, out endTime))
                throw new ArgumentException("Invalid time format.");

            if (endTime <= startTime)
                throw new ArgumentException("End time must be after start time.");

            double totalHours = (endTime - startTime).TotalHours;
            decimal payment = hourlyRate * (decimal)totalHours;

            // 4. Pre-mutation validation ordering (API-B pattern):
            // Determine and validate which slot IDs cover the requested time range BEFORE creating the job
            var allSlots = _db.TimeSlots.Where(ts => !ts.IsDeleted).ToList();
            var requiredSlotIds = allSlots
                .Where(ts => ts.StartTime.HasValue && ts.EndTime.HasValue &&
                             ts.StartTime.Value < endTime && ts.EndTime.Value > startTime)
                .Select(ts => ts.Slot_ID)
                .ToList();

            if (!requiredSlotIds.Any())
                throw new InvalidOperationException("No suitable time slots found for the given time range.");

            // 5. Determine whether this is a recurring series
            bool isSeries =
                string.Equals(dto.AvailabilityType, "Repeat Days",
                              StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(dto.EndDate)
                && dto.SelectedDays != null
                && dto.SelectedDays.Count > 0;

            var primaryChildId = childIdsToBook[0];
            var primaryChild = _db.Children.FirstOrDefault(c => c.Child_ID == primaryChildId);
            var primaryChildName = primaryChild?.ChildName ?? "Child";

            if (!isSeries)
            {
                var jobTitle = childIdsToBook.Count == 1
                    ? $"Care needed for {primaryChildName} in {dto.City ?? "your city"} on {dto.StartDate:MMM dd}"
                    : $"Care needed for {childIdsToBook.Count} children in {dto.City ?? "your city"} on {dto.StartDate:MMM dd}";

                var job = new Job
                {
                    Parent_ID = dto.ParentId,
                    Child_ID = primaryChildId,          // primary child (backward compatibility)
                    Title = jobTitle,
                    Description = childIdsToBook.Count > 1
                        ? $"Babysitting required for {childIdsToBook.Count} children"
                        : "Babysitting required",
                    JobDate = dto.StartDate,
                    Status = JobStatus.Open.ToDisplayString(),
                    AssignedSitter_ID = null,
                    Payment = payment,
                    City = dto.City ?? "",
                    JobSeries_ID = null,
                    SeriesOccurrenceIndex = 1
                };

                _db.Jobs.Add(job);
                _db.SaveChanges();

                // 5b. Link every child to this single job (JobChildren lives outside
                //     the EDMX, so insert via raw SQL — same pattern as JobInvitation).
                foreach (var childId in childIdsToBook.Distinct())
                {
                    _db.Database.ExecuteSqlCommand(
                        "INSERT INTO JobChildren (Job_ID, Child_ID, IsDeleted) VALUES (@p0, @p1, 0)",
                        job.Job_ID, childId);
                }

                // 6. Create JobTimeSlot entries
                foreach (var slotId in requiredSlotIds)
                {
                    _db.JobTimeSlots.Add(new JobTimeSlot
                    {
                        Job_ID = job.Job_ID,
                        Slot_ID = slotId
                    });
                }

                _db.SaveChanges();

                // 7. Geo-matching: persist job coordinates via raw SQL
                if (dto.Latitude.HasValue && dto.Longitude.HasValue)
                {
                    _db.Database.ExecuteSqlCommand(
                        "UPDATE Job SET Latitude = @p0, Longitude = @p1 WHERE Job_ID = @p2",
                        dto.Latitude.Value, dto.Longitude.Value, job.Job_ID);
                }

                var message = childIdsToBook.Count > 1
                    ? $"Booking request sent for {childIdsToBook.Count} children. The sitter can now accept it."
                    : "Job created successfully. The sitter can now accept it.";

                return new CreateJobResult
                {
                    Success = true,
                    Message = message,
                    JobId = job.Job_ID,
                    JobSeries_ID = null,
                    SeriesCount = 1
                };
            }

            // Series creation path
            DateTime seriesStart = dto.StartDate;
            DateTime seriesEnd;
            if (!DateTime.TryParse(dto.EndDate, out seriesEnd))
                throw new ArgumentException("Invalid series end date format.");

            var seriesDates = ExpandSeriesDates(seriesStart, seriesEnd, dto.SelectedDays);
            if (seriesDates.Count == 0)
                throw new InvalidOperationException("No dates matched the selected weekdays in that range.");

            var titleBase = childIdsToBook.Count == 1
                ? $"Care needed for {primaryChildName} in {dto.City ?? "your city"}"
                : $"Care needed for {childIdsToBook.Count} children in {dto.City ?? "your city"}";

            var firstJob = new Job
            {
                Parent_ID = dto.ParentId,
                Child_ID = primaryChildId,
                Title = $"{titleBase} (Series 1 of {seriesDates.Count})",
                Description = childIdsToBook.Count > 1
                    ? $"Babysitting required for {childIdsToBook.Count} children"
                    : "Babysitting required",
                JobDate = seriesDates[0],
                Status = JobStatus.Open.ToDisplayString(),
                AssignedSitter_ID = null,
                Payment = payment,
                City = dto.City ?? "",
                JobSeries_ID = null,
                SeriesOccurrenceIndex = 1
            };

            _db.Jobs.Add(firstJob);
            _db.SaveChanges();     // now firstJob.Job_ID is populated

            firstJob.JobSeries_ID = firstJob.Job_ID;
            _db.SaveChanges();

            foreach (var childId in childIdsToBook.Distinct())
            {
                _db.Database.ExecuteSqlCommand(
                    "INSERT INTO JobChildren (Job_ID, Child_ID, IsDeleted) VALUES (@p0, @p1, 0)",
                    firstJob.Job_ID, childId);
            }

            foreach (var slotId in requiredSlotIds)
            {
                _db.JobTimeSlots.Add(new JobTimeSlot
                {
                    Job_ID = firstJob.Job_ID,
                    Slot_ID = slotId
                });
            }
            _db.SaveChanges();

            if (dto.Latitude.HasValue && dto.Longitude.HasValue)
            {
                _db.Database.ExecuteSqlCommand(
                    "UPDATE Job SET Latitude = @p0, Longitude = @p1 WHERE Job_ID = @p2",
                    dto.Latitude.Value, dto.Longitude.Value, firstJob.Job_ID);
            }

            for (int i = 1; i < seriesDates.Count; i++)
            {
                var j = new Job
                {
                    Parent_ID = dto.ParentId,
                    Child_ID = primaryChildId,
                    Title = $"{titleBase} (Series {i + 1} of {seriesDates.Count})",
                    Description = childIdsToBook.Count > 1
                        ? $"Babysitting required for {childIdsToBook.Count} children"
                        : "Babysitting required",
                    JobDate = seriesDates[i],
                    Status = JobStatus.Open.ToDisplayString(),
                    AssignedSitter_ID = null,
                    Payment = payment,
                    City = dto.City ?? "",
                    JobSeries_ID = firstJob.Job_ID,
                    SeriesOccurrenceIndex = i + 1
                };

                _db.Jobs.Add(j);
                _db.SaveChanges();

                foreach (var cid in childIdsToBook.Distinct())
                {
                    _db.Database.ExecuteSqlCommand(
                        "INSERT INTO JobChildren (Job_ID, Child_ID, IsDeleted) VALUES (@p0, @p1, 0)",
                        j.Job_ID, cid);
                }

                foreach (var slotId in requiredSlotIds)
                {
                    _db.Database.ExecuteSqlCommand(
                        "INSERT INTO JobTimeSlot (Job_ID, Slot_ID) VALUES (@p0, @p1)",
                        j.Job_ID, slotId);
                }

                if (dto.Latitude.HasValue && dto.Longitude.HasValue)
                {
                    _db.Database.ExecuteSqlCommand(
                        "UPDATE Job SET Latitude = @p0, Longitude = @p1 WHERE Job_ID = @p2",
                        dto.Latitude.Value, dto.Longitude.Value, j.Job_ID);
                }
            }

            return new CreateJobResult
            {
                Success = true,
                Message = $"Series created: {seriesDates.Count} bookings.",
                JobId = firstJob.Job_ID,
                JobSeries_ID = firstJob.Job_ID,
                SeriesCount = seriesDates.Count
            };
        }

        // Lazy expiration: any job still Open/Assigned whose booking window
        // (JobDate + last slot EndTime) has fully passed is auto-cancelled with
        // an audit trail. Runs on read so stale bookings never linger in
        // Upcoming/Open lists. Uses raw SQL (same pattern as the CancellationReason
        // UPDATE used by the session lockout logic below).
        private void ExpireStaleJobs(int? parentId = null, int? sitterId = null)
        {
            var sql = @"
                UPDATE j
                SET j.Status = 'Cancelled',
                    j.CancellationReason = 'Booking window expired without session start',
                    j.CancelledAt = GETUTCDATE()
                FROM Job j
                WHERE j.IsDeleted = 0
                  AND j.Status IN ('Open','Assigned')
                  AND j.JobDate IS NOT NULL
                  AND (@p0 IS NULL OR j.Parent_ID = @p0)
                  AND (@p1 IS NULL OR j.AssignedSitter_ID = @p1)
                  AND DATEADD(
                          MINUTE,
                          DATEDIFF(MINUTE, 0, CAST((
                              SELECT MAX(ts.EndTime)
                              FROM JobTimeSlot jts2
                              INNER JOIN TimeSlot ts ON ts.Slot_ID = jts2.Slot_ID
                              WHERE jts2.Job_ID = j.Job_ID
                          ) AS DATETIME)),
                          CAST(j.JobDate AS DATETIME)
                      ) < GETDATE()";

            _db.Database.ExecuteSqlCommand(sql, parentId, sitterId);
        }

        public ParentJobItemDto GetJobById(int jobId)
        {
            ExpireStaleJobs();

            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            {
                var job = db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
                if (job == null) return null;

                var slotTimes = db.JobTimeSlots
                    .Where(js => js.Job_ID == job.Job_ID)
                    .Select(js => new ParentJobSlotTimeDto { StartTime = js.TimeSlot.StartTime, EndTime = js.TimeSlot.EndTime })
                    .ToList();

                var dto = new ParentJobItemDto
                {
                    Job_ID = job.Job_ID,
                    Parent_ID = job.Parent_ID,
                    Title = job.Title,
                    JobDate = job.JobDate,
                    Status = job.Status,
                    City = job.City,
                    Payment = job.Payment,
                    AssignedSitter_ID = job.AssignedSitter_ID,
                    ChildName = job.Child?.ChildName ?? "Unknown",
                    SitterName = job.Babysitter?.FullName ?? "Unknown",
                    SitterPhone = job.Babysitter?.PhoneNumber,
                    SitterPicture = job.Babysitter?.PictureAddress,
                    SlotTimes = slotTimes,
                    SessionStartedAt = job.SessionStartedAt,
                    SessionEndedAt = job.SessionEndedAt,
                };

                var series = GetSeriesSummary(job.Job_ID, job.JobSeries_ID);
                dto.JobSeries_ID = series.Id;
                dto.SeriesOccurrenceIndex = series.Index;
                dto.SeriesTotalCount = series.Count;
                dto.SeriesTotalPayment = series.TotalPayment;
                // Phase 8c: "Earned so far" across completed days. Uses this
                // method's own short-lived `db` context.
                dto.SeriesEarnedSoFar = GetSeriesEarnedSoFar(db, job.JobSeries_ID);
                dto.SeriesStartDate = series.StartDate;
                dto.SeriesEndDate = series.EndDate;
                dto.SeriesDays = series.Days;

                // Phase 6 multi-child: the parent-side detail must expose every
                // child booked on this job, not just the primary Job.Child_ID.
                dto.Children = GetJobChildren(jobId);

                // Phase 8J: the Job table stores Latitude/Longitude, but the EDMX
                // model does not map these columns, so read them via raw SQL —
                // the identical pattern already used by GetJobDetails above (and
                // by the geo-matching code in MatchingService). The soft-delete
                // filter mirrors the entity query this method already ran, so a
                // deleted job can never surface coordinates.
                dto.Latitude = db.Database.SqlQuery<double?>(
                    "SELECT Latitude FROM Job WHERE Job_ID = @p0 AND IsDeleted = 0", jobId).FirstOrDefault();
                dto.Longitude = db.Database.SqlQuery<double?>(
                    "SELECT Longitude FROM Job WHERE Job_ID = @p0 AND IsDeleted = 0", jobId).FirstOrDefault();

                return dto;
            }
        }

        public IEnumerable<ParentJobItemDto> GetParentJobs(int parentId)
        {
            if (parentId <= 0)
                throw new ArgumentException("Parent ID must be a positive integer.");

            ExpireStaleJobs(parentId: parentId);

            var rawJobs = _db.Jobs
                .Where(j => j.Parent_ID == parentId && !j.IsDeleted)
                .Select(j => new
                {
                    j.Job_ID,
                    j.Parent_ID,
                    j.Title,
                    j.JobDate,
                    j.Status,
                    j.City,
                    j.Payment,
                    j.AssignedSitter_ID,
                    j.SessionStartedAt,
                    j.SessionEndedAt,
                    j.JobSeries_ID,
                    j.SeriesOccurrenceIndex,
                    ChildName = j.Child != null ? (j.Child.IsDeleted ? "Deactivated Child" : j.Child.ChildName) : null,
                    SitterName = j.Babysitter != null ? (j.Babysitter.IsDeleted ? "Deactivated Sitter" : j.Babysitter.FullName) : null,
                    SitterPhone = j.Babysitter != null ? j.Babysitter.PhoneNumber : null,
                    SitterPicture = j.Babysitter != null ? j.Babysitter.PictureAddress : null,
                    SlotTimes = _db.JobTimeSlots
                        .Where(js => js.Job_ID == j.Job_ID)
                        .Select(js => new
                        {
                            StartTime = js.TimeSlot.StartTime,
                            EndTime = js.TimeSlot.EndTime
                        }).ToList()
                })
                .ToList();

            var jobs = rawJobs.Select(j => new ParentJobItemDto
            {
                Job_ID = j.Job_ID,
                Parent_ID = j.Parent_ID,
                Title = j.Title,
                JobDate = j.JobDate,
                Status = j.Status,
                City = j.City,
                Payment = j.Payment,
                AssignedSitter_ID = j.AssignedSitter_ID,
                ChildName = j.ChildName,
                SitterName = j.SitterName,
                SitterPhone = j.SitterPhone,
                SitterPicture = j.SitterPicture,
                SlotTimes = j.SlotTimes.Select(st => new ParentJobSlotTimeDto
                {
                    StartTime = st.StartTime,
                    EndTime = st.EndTime
                }).ToList(),
                SessionStartedAt = j.SessionStartedAt,
                SessionEndedAt = j.SessionEndedAt,
                JobSeries_ID = j.JobSeries_ID,
                SeriesOccurrenceIndex = j.SeriesOccurrenceIndex
            }).ToList();

            // Phase 6 multi-child: attach the full child list per job.
            // Assigned here (not inside the LINQ projection above) because
            // GetJobChildren issues raw SQL and would cause an N+1 query per
            // job. ParentJobItemDto is a reference type, so mutating the
            // materialised elements is visible to the caller.
            foreach (var dto in jobs)
            {
                dto.Children = GetJobChildren(dto.Job_ID);
                var series = GetSeriesSummary(dto.Job_ID, dto.JobSeries_ID);
                dto.SeriesTotalCount = series.Count;
                dto.SeriesTotalPayment = series.TotalPayment;
            }

            return jobs;
        }

        public IEnumerable<OpenJobListItemDto> GetOpenJobs(string city = null)
        {
            string openStatus = JobStatus.Open.ToDisplayString();
            var query = _db.Jobs.Where(j => !j.IsDeleted && j.AssignedSitter_ID == null && j.Status == openStatus && (j.Parent == null || !j.Parent.IsDeleted));

            if (!string.IsNullOrEmpty(city))
            {
                string cityLower = city.Trim().ToLower();
                query = query.Where(j => j.City.ToLower().Trim() == cityLower);
            }

            var jobList = query.ToList();

            string parentRole = UserRole.Parent.ToDisplayString();
            var result = jobList.Select(j => new OpenJobListItemDto
            {
                Job_ID = j.Job_ID,
                Title = j.Title,
                Status = j.Status,
                JobDate = j.JobDate,
                City = j.City,
                Payment = j.Payment,
                ParentAddress = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.Address : null,
                ParentPic = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.PictureAddress : null,
                ParentName = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.FullName : "Deactivated Parent",
                ParentPhone = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.PhoneNumber : null,
                SlotIds = _db.JobTimeSlots
                    .Where(js => js.Job_ID == j.Job_ID)
                    .Select(js => js.Slot_ID)
                    .ToList(),
                Rating = _db.Reviews
                    .Where(r => !r.IsDeleted && r.ReviewFor_ID == j.Parent_ID && r.ReviewForRole == parentRole)
                    .Average(r => (decimal?)r.Rating) ?? 0
            }).ToList();

            return result;
        }

        public JobDetailsResultDto GetJobDetails(int jobId)
        {
            if (jobId <= 0)
                throw new ArgumentException("Job ID must be a positive integer.");

            ExpireStaleJobs();

            var j = _db.Jobs.FirstOrDefault(x => x.Job_ID == jobId && !x.IsDeleted);
            if (j == null)
                return null;

            var currentUserId = ClaimsPrincipalHelper.GetUserId();
            var currentRole = ClaimsPrincipalHelper.GetRole();

            bool isParentOwner = (currentRole == UserRole.Parent.ToDisplayString() && j.Parent_ID == currentUserId);
            bool isAssignedSitter = (currentRole == UserRole.Sitter.ToDisplayString() && j.AssignedSitter_ID == currentUserId);

            // An invited sitter (JobInvitation status 'Invited' or 'Accepted') must be able
            // to see the job so they can decide whether to accept. JobInvitation is not a
            // mapped entity, so query it with raw SQL (same pattern as JobInvitationService).
            bool isInvitedSitter = false;
            if (currentRole == UserRole.Sitter.ToDisplayString())
            {
                int inviteCount = _db.Database.SqlQuery<int>(
                    "SELECT COUNT(1) FROM JobInvitation WHERE Job_ID = @p0 AND Sitter_ID = @p1 AND Status IN ('Invited','Accepted')",
                    jobId, currentUserId).FirstOrDefault();
                isInvitedSitter = inviteCount > 0;
            }

            if (!isParentOwner && !isAssignedSitter && !isInvitedSitter)
            {
                throw new UnauthorizedAccessException("Access denied: you do not have permission to view this job.");
            }

            var slotIds = _db.JobTimeSlots
                .Where(js => js.Job_ID == jobId)
                .Select(js => js.Slot_ID)
                .ToList();
            var slotTimes = _db.JobTimeSlots
                .Where(js => js.Job_ID == jobId)
                .Select(js => new ParentJobSlotTimeDto
                {
                    StartTime = js.TimeSlot.StartTime,
                    EndTime = js.TimeSlot.EndTime
                })
                .ToList();

            string parentRole = UserRole.Parent.ToDisplayString();
            var parentRating = _db.Reviews
                .Where(r => !r.IsDeleted && r.ReviewFor_ID == j.Parent_ID && r.ReviewForRole == parentRole)
                .Average(r => (decimal?)r.Rating) ?? 0;

            int childAge = 0;
            if (j.Child?.DOB != null)
            {
                childAge = DateTime.Now.Year - j.Child.DOB.Year;
                if (DateTime.Now < j.Child.DOB.AddYears(childAge)) childAge--;
            }

            var dto = new JobDetailsResultDto
            {
                Job_ID = j.Job_ID,
                Title = j.Title,
                Description = j.Description,
                JobDate = j.JobDate,
                Status = j.Status,
                City = j.City,
                Payment = j.Payment,
                SlotIds = slotIds,
                SlotTimes = slotTimes,
                ParentName = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.FullName : "Deactivated Parent",
                ParentAddress = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.Address : null,
                ParentPic = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.PictureAddress : null,
                ParentRating = parentRating,
                ChildName = (j.Child != null && !j.Child.IsDeleted) ? j.Child.ChildName : "Unknown Child",
                ChildAge = childAge,
                Gender = (j.Child != null && !j.Child.IsDeleted) ? j.Child.Gender : null,
                PictureAddress = (j.Child != null && !j.Child.IsDeleted) ? j.Child.PictureAddress : null,
                AssignedSitter_ID = j.AssignedSitter_ID,
                Parent_ID = j.Parent_ID,
                SessionStartedAt = j.SessionStartedAt,
                SessionEndedAt = j.SessionEndedAt
            };

            // Phase 6 multi-child: populate the children list
            dto.Children = GetJobChildren(jobId);

            // Get Directions: the Job table stores Latitude/Longitude, but the
            // EDMX model does not map these columns, so read them via raw SQL
            // (same pattern as the geo-matching code in MatchingService).
            dto.Latitude = _db.Database.SqlQuery<double?>(
                "SELECT Latitude FROM Job WHERE Job_ID = @p0", jobId).FirstOrDefault();
            dto.Longitude = _db.Database.SqlQuery<double?>(
                "SELECT Longitude FROM Job WHERE Job_ID = @p0", jobId).FirstOrDefault();

            // Phase 8c: "Earned so far" across completed days of this series.
            // Uses the injected _db (this method has no local context).
            dto.SeriesEarnedSoFar = GetSeriesEarnedSoFar(_db, j.JobSeries_ID);

            // Backward compat: if legacy single-child fields were empty,
            // fill them from the first child (kept for old screens).
            if (dto.Children != null && dto.Children.Count > 0)
            {
                if (string.IsNullOrEmpty(dto.ChildName))
                    dto.ChildName = dto.Children[0].ChildName;
                if (dto.ChildAge == 0 && dto.Children[0].ChildAge.HasValue)
                    dto.ChildAge = dto.Children[0].ChildAge.Value;
                if (string.IsNullOrEmpty(dto.PictureAddress))
                    dto.PictureAddress = dto.Children[0].PictureAddress;
            }

            var series = GetSeriesSummary(j.Job_ID, j.JobSeries_ID);
            dto.JobSeries_ID = series.Id;
            dto.SeriesOccurrenceIndex = series.Index;
            dto.SeriesTotalCount = series.Count;
            dto.SeriesTotalPayment = series.TotalPayment;
            dto.SeriesStartDate = series.StartDate;
            dto.SeriesEndDate = series.EndDate;
            dto.SeriesDays = series.Days;

            return dto;
        }

        public int ConfirmJobsBulk(int sitterId, List<int> jobIds)
        {
            if (sitterId <= 0)
                throw new ArgumentException("Sitter ID must be a positive integer.");
            if (jobIds == null || jobIds.Count == 0)
                throw new ArgumentException("No jobs provided.");

            var sitter = _db.Babysitters.FirstOrDefault(b => b.Sitter_ID == sitterId && !b.IsDeleted);
            if (sitter == null)
                throw new KeyNotFoundException("Sitter not found.");

            string openStatus = JobStatus.Open.ToDisplayString();
            var jobs = _db.Jobs.Where(j => jobIds.Contains(j.Job_ID) && !j.IsDeleted && j.Status == openStatus).ToList();
            if (jobs.Count != jobIds.Count)
                throw new InvalidOperationException("One or more jobs are no longer available.");

            foreach (var job in jobs)
            {
                job.AssignedSitter_ID = sitterId;
                job.Status = JobStatus.Assigned.ToDisplayString();
            }

            _db.SaveChanges();
            return jobs.Count;
        }

        public void ConfirmJob(int jobId, int sitterId)
        {
            if (jobId <= 0 || sitterId <= 0)
                throw new ArgumentException("Job ID and Sitter ID must be positive integers.");

            var sitter = _db.Babysitters.FirstOrDefault(b => b.Sitter_ID == sitterId && !b.IsDeleted);
            if (sitter == null)
                throw new KeyNotFoundException("Sitter not found.");

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (job == null)
                throw new KeyNotFoundException("Job not found.");

            if (job.AssignedSitter_ID != null)
                throw new InvalidOperationException("Job already assigned.");

            job.AssignedSitter_ID = sitterId;
            job.Status = JobStatus.Assigned.ToDisplayString();
            _db.SaveChanges();

            // Phase 6: mark this sitter's invitation as Accepted so the badge turns blue
            _db.Database.ExecuteSqlCommand(
                "UPDATE JobInvitation SET Status = 'Accepted', RespondedAt = @UtcNow " +
                "WHERE Job_ID = @JobId AND Sitter_ID = @SitterId AND Status = 'Invited'",
                new SqlParameter("@UtcNow", DateTime.UtcNow),
                new SqlParameter("@JobId", jobId),
                new SqlParameter("@SitterId", sitterId));
        }

        public JobStatusUpdateResultDto UpdateJobStatus(int jobId, string requestedStatus, string currentRole, int currentUserId)
        {
            if (jobId <= 0)
                throw new ArgumentException("Job ID must be a positive integer.");

            string statusToSet = requestedStatus?.Trim();
            if (string.IsNullOrWhiteSpace(statusToSet))
            {
                statusToSet = JobStatus.InProgress.ToDisplayString();
            }

            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (job == null)
                throw new KeyNotFoundException("Job not found.");

            bool allowed = (currentRole == UserRole.Parent.ToDisplayString() && job.Parent_ID == currentUserId)
                        || (currentRole == UserRole.Sitter.ToDisplayString() && job.AssignedSitter_ID == currentUserId);
            if (!allowed)
                throw new UnauthorizedAccessException("Access denied: only the job's parent or assigned sitter can update its status.");

            // Validate status transitions
            if (string.Equals(statusToSet, JobStatus.SitterArrived.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                // ------------------------------------------------------------------
                // Transition A — Assigned → SitterArrived (sitter side only).
                // The sitter confirms arrival; the session does NOT start yet.
                // The parent must separately trigger In Progress (Transition B).
                // ------------------------------------------------------------------
                if (currentRole != UserRole.Sitter.ToDisplayString() || job.AssignedSitter_ID != currentUserId)
                    throw new UnauthorizedAccessException("Only the assigned babysitter can confirm arrival.");

                if (job.Status != JobStatus.Assigned.ToDisplayString() &&
                    !string.Equals(job.Status, "Confirmed", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("Arrival can only be confirmed for an assigned job.");
                }

                job.Status = JobStatus.SitterArrived.ToDisplayString();
            }
            else if (string.Equals(statusToSet, JobStatus.Cancelled.ToDisplayString(), StringComparison.OrdinalIgnoreCase)
                     && string.Equals(job.Status, JobStatus.SitterArrived.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                // ------------------------------------------------------------------
                // Transition D — SitterArrived → Cancelled (parent or sitter).
                // The parent who booked the sitter must be able to cancel from
                // SitterArrived too (e.g. they changed their mind before starting),
                // not just the sitter backing out because the parent never
                // confirmed. Deliberately placed BEFORE the In Progress branch so
                // the B1/B2 conflict guards (which only apply to starting a session)
                // never run.
                // ------------------------------------------------------------------
                bool isSitter = currentRole == UserRole.Sitter.ToDisplayString()
                    && job.AssignedSitter_ID == currentUserId;
                bool isParent = currentRole == UserRole.Parent.ToDisplayString()
                    && job.Parent_ID == currentUserId;
                if (!isSitter && !isParent)
                {
                    throw new UnauthorizedAccessException(
                        "Only the job's parent or assigned sitter can cancel this booking.");
                }

                job.Status = JobStatus.Cancelled.ToDisplayString();
                _db.SaveChanges();

                // Role-aware audit + notification: either participant may cancel
                // from SitterArrived, so record WHO cancelled and notify only
                // the other party (matches the existing raw-SQL audit pattern).
                string cancelReason = isSitter
                    ? "Sitter cancelled - parent did not confirm arrival"
                    : "Parent cancelled - before session start";

                _db.Database.ExecuteSqlCommand(
                    "UPDATE Job SET CancellationReason = @p0, CancelledAt = @p1 " +
                    "WHERE Job_ID = @p2",
                    cancelReason,
                    DateTime.UtcNow, job.Job_ID);

                if (isSitter && job.Parent_ID.HasValue)
                {
                    // Sitter backed out — tell the parent to rebook.
                    _notificationService.CreateNotification(new NotificationDto
                    {
                        UserId = job.Parent_ID.Value,
                        UserRole = "Parent",
                        Message = "Your babysitter has cancelled the booking because " +
                                  "you did not confirm their arrival. Please rebook.",
                        Type = "SitterCancelledNoConfirm",
                        IsRead = false
                    });
                }
                else if (isParent && job.AssignedSitter_ID.HasValue)
                {
                    // Parent changed their mind before the session started.
                    _notificationService.CreateNotification(new NotificationDto
                    {
                        UserId = job.AssignedSitter_ID.Value,
                        UserRole = "Sitter",
                        Message = "The parent has cancelled this booking before the " +
                                  "session started.",
                        Type = "ParentCancelled",
                        IsRead = false
                    });
                }

                return new JobStatusUpdateResultDto
                {
                    Message = "Booking cancelled.",
                    JobId = job.Job_ID,
                    Status = job.Status,
                    AssignedSitterId = job.AssignedSitter_ID,
                    ParentId = job.Parent_ID
                };
            }
            else if (string.Equals(statusToSet, JobStatus.InProgress.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                if (EnumExtensions.IsTerminalJobStatus(job.Status))
                {
                    throw new InvalidOperationException("Cannot start session: Job has already ended.");
                }
                if (job.AssignedSitter_ID == null)
                {
                    throw new InvalidOperationException("Cannot start session: No babysitter has been assigned to this job.");
                }

                // ------------------------------------------------------------------
                // Role gating for the session start (workflow redesign):
                //   - If the job is SitterArrived, ONLY the parent may start it.
                //   - A sitter can no longer start the session themselves once
                //     arrival has been confirmed (they must wait for the parent).
                // ------------------------------------------------------------------
                bool isParentCaller = currentRole == UserRole.Parent.ToDisplayString();
                bool sitterArrived = string.Equals(job.Status, JobStatus.SitterArrived.ToDisplayString(), StringComparison.OrdinalIgnoreCase);

                if (sitterArrived && !isParentCaller)
                {
                    throw new UnauthorizedAccessException("Only the parent can start the session after arrival is confirmed.");
                }

                // A session that is already in progress is not started again.
                // Do not re-validate the time window for this request.
                if (string.Equals(job.Status, JobStatus.InProgress.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("This session has already started.");
                }

                // Assemble the scheduled window on the Job's calendar day
                // (Pakistan local time). The guard applies only to the first
                // transition into In Progress.
                DateTime pkNow = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
                    DateTime.UtcNow, "Pakistan Standard Time");
                DateTime jobDay = job.JobDate.Date;

                var scheduledSlots = _db.JobTimeSlots
                    .Where(jts => jts.Job_ID == job.Job_ID && jts.Slot_ID != null)
                    .Select(jts => new { jts.TimeSlot.StartTime, jts.TimeSlot.EndTime })
                    .ToList();

                TimeSpan? earliestStart = scheduledSlots
                    .Where(slot => slot.StartTime.HasValue && slot.EndTime.HasValue)
                    .Select(slot => slot.StartTime.Value)
                    .OrderBy(time => time)
                    .FirstOrDefault();
                TimeSpan? latestEnd = scheduledSlots
                    .Where(slot => slot.StartTime.HasValue && slot.EndTime.HasValue)
                    .Select(slot => slot.EndTime.Value)
                    .OrderByDescending(time => time)
                    .FirstOrDefault();

                if (earliestStart.HasValue && latestEnd.HasValue)
                {
                    DateTime windowOpen = jobDay + earliestStart.Value.Add(TimeSpan.FromMinutes(-30));
                    DateTime windowClose = jobDay + latestEnd.Value.Add(TimeSpan.FromMinutes(30));

                    if (pkNow < windowOpen || pkNow > windowClose)
                    {
                        throw new InvalidOperationException(
                            $"This session is scheduled for {earliestStart.Value:hh\\:mm}–{latestEnd.Value:hh\\:mm} " +
                            $"on {jobDay:yyyy-MM-dd} (Pakistan time). You're outside the allowed start window.");
                    }
                }

                // ------------------------------------------------------------------
                // WARNING: Transition C — legacy direct Assigned → In Progress.
                // This bypasses the sitter-arrival + parent-confirmation flow and is
                // kept ONLY as a fallback. It should be REMOVED once the
                // sitter("I have reached") + parent("Start Session") flow is
                // verified end-to-end.
                // ------------------------------------------------------------------

                // ------------------------------------------------------------------
                // Start-session conflict guard.
                // Keyed on the job's ASSIGNED SITTER (not the caller) so a parent-
                // triggered start is guarded exactly like a sitter-triggered one.
                // Raw SQL matches the JobInvitation / UserSessions access pattern
                // already used in this file.
                //
                // DOCUMENTED GAP (B3): availability-clash validation is NOT
                // implemented in this pass — there is no hire-time availability
                // enforcement to reuse, so starting a session whose slot the sitter
                // never published is still permitted.
                // ------------------------------------------------------------------
                int sitterIdForCheck = job.AssignedSitter_ID.Value;

                try
                {
                    // B1: another session belonging to this sitter is still running.
                    int runningElsewhere = _db.Database.SqlQuery<int>(
                        @"SELECT COUNT(1)
                          FROM Job
                          WHERE AssignedSitter_ID = @p0
                            AND Status = 'In Progress'
                            AND Job_ID <> @p1
                            AND IsDeleted = 0",
                        sitterIdForCheck, job.Job_ID).FirstOrDefault();

                    if (runningElsewhere > 0)
                    {
                        throw new InvalidOperationException(
                            "You cannot start a new session while another session is still in progress.");
                    }

                    // B2: 30-minute travel buffer after the most recent completed job.
                    // PREFER the ACTUAL SessionEndedAt (the real end stamped at
                    // In Progress -> Completed). Only fall back to the scheduled
                    // JobDate + last-slot EndTime for legacy rows that predate the
                    // workflow redesign (SessionEndedAt is NULL). Without this, a
                    // parent who ends early (09:12) still computes the scheduled end
                    // (e.g. 16:00) -> DATEDIFF goes negative -> the sitter is told to
                    // "wait 402 more minutes".
                    const string recentCompletionSubquery = @"
                              SELECT COALESCE(
                                         j.SessionEndedAt,
                                         DATEADD(
                                             MINUTE,
                                             DATEDIFF(MINUTE, 0, (
                                                 SELECT MAX(ts.EndTime)
                                                 FROM JobTimeSlot jts
                                                 INNER JOIN TimeSlot ts ON ts.Slot_ID = jts.Slot_ID
                                                 WHERE jts.Job_ID = j.Job_ID
                                                   AND jts.Slot_ID IS NOT NULL
                                             )),
                                             CAST(j.JobDate AS DATETIME)
                                         )
                                     ) AS JobEnd
                              FROM Job j
                              WHERE j.AssignedSitter_ID = @p0
                                AND j.Status = 'Completed'
                                AND j.IsDeleted = 0
                                AND j.JobDate IS NOT NULL";

                    // Two-step (count, then read) so a 'no match' result can never be
                    // confused with a real elapsed-seconds value of zero.
                    int recentCompletions = _db.Database.SqlQuery<int>(
                        "SELECT COUNT(1) FROM (" + recentCompletionSubquery + @") t
                          WHERE t.JobEnd IS NOT NULL
                            AND t.JobEnd > DATEADD(MINUTE, -30, GETDATE())",
                        sitterIdForCheck).FirstOrDefault();

                    if (recentCompletions > 0)
                    {
                        // A matching row is guaranteed, so this scalar cannot be NULL.
                        int secondsSinceLastEnd = _db.Database.SqlQuery<int>(
                            "SELECT TOP 1 DATEDIFF(SECOND, t.JobEnd, GETDATE()) FROM (" + recentCompletionSubquery + @") t
                              WHERE t.JobEnd IS NOT NULL
                                AND t.JobEnd > DATEADD(MINUTE, -30, GETDATE())
                              ORDER BY t.JobEnd DESC",
                            sitterIdForCheck).FirstOrDefault();

                        // Wait time is rounded UP so the sitter is never invited to
                        // retry a moment too early.
                        int remainingMinutes = (int)Math.Ceiling((30 * 60 - secondsSinceLastEnd) / 60.0);
                        if (remainingMinutes < 1)
                        {
                            remainingMinutes = 1;
                        }

                        throw new InvalidOperationException(
                            $"You finished your previous job less than 30 minutes ago. Please wait {remainingMinutes} more minutes.");
                    }
                }
                catch (InvalidOperationException)
                {
                    // Schedule conflict — surfaces as a clean 400 via JobsController.
                    throw;
                }
                catch (Exception ex)
                {
                    // A guard infrastructure failure must not be mistaken for a
                    // status-transition failure; still a 400 per the existing contract.
                    throw new InvalidOperationException("Could not verify your schedule for conflicts. Please try again.", ex);
                }

                job.Status = JobStatus.InProgress.ToDisplayString();
                // Record the actual session start time so live timers are
                // driven by SessionStartedAt, not the scheduled JobDate.
                // Local time (not UtcNow): every other timestamp in this app
                // (JobDate, CreatedAt, CancelledAt) is local, and the JSON is
                // serialised without a "Z" suffix, so a UTC value would be
                // parsed by the browser as local and shift the clock by the
                // timezone offset (PKT = UTC+5).
                job.SessionStartedAt = DateTime.Now;
            }
            else
            {
                if (EnumExtensions.IsTerminalJobStatus(job.Status))
                {
                    throw new InvalidOperationException($"Cannot update status: Job is already {job.Status}.");
                }
                job.Status = statusToSet;
                if (string.Equals(job.Status, JobStatus.Completed.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
                {
                    // Record the actual session end time alongside
                    // SessionStartedAt. Local time — see the note on the
                    // SessionStartedAt assignment above.
                    job.SessionEndedAt = DateTime.Now;
                }
            }

            _db.SaveChanges();

            // Late-cascade check when Completed (Rule F, H, I)
            if (string.Equals(job.Status, JobStatus.Completed.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                string assignedStatus = JobStatus.Assigned.ToDisplayString();

                var nextJob = _db.Jobs
                    .Where(j => !j.IsDeleted
                             && j.AssignedSitter_ID == job.AssignedSitter_ID
                             && j.Job_ID != job.Job_ID
                             && j.Status == assignedStatus
                             && DbFunctions.TruncateTime(j.JobDate) == DbFunctions.TruncateTime(DateTime.Today))
                    .OrderBy(j => j.JobDate)
                    .FirstOrDefault();

                if (nextJob != null)
                {
                    var firstSlotId = _db.JobTimeSlots
                        .Where(js => js.Job_ID == nextJob.Job_ID && js.Slot_ID.HasValue)
                        .Select(js => js.Slot_ID.Value)
                        .OrderBy(id => id)
                        .FirstOrDefault();

                    var firstSlotTime = _db.TimeSlots
                        .Where(ts => ts.Slot_ID == firstSlotId)
                        .Select(ts => ts.StartTime)
                        .FirstOrDefault();

                    var actualEndTime = DateTime.Now.TimeOfDay;
                    if (firstSlotTime.HasValue)
                    {
                        var gap = firstSlotTime.Value - actualEndTime;
                        if (gap < TimeSpan.FromMinutes(30))
                        {
                            nextJob.Status = JobStatus.Cancelled.ToDisplayString();
                            _db.SaveChanges();

                            // Raw SQL for the new columns
                            _db.Database.ExecuteSqlCommand(
                                "UPDATE Job SET CancellationReason = @p0, CancelledAt = @p1 WHERE Job_ID = @p2",
                                "Previous session ran late", DateTime.UtcNow, nextJob.Job_ID);

                            // Lockout: sitter resumes 3 hours from now
                            var lockedUntil = DateTime.UtcNow.AddHours(3);
                            _db.Database.ExecuteSqlCommand(
                                "UPDATE Babysitter SET SitterLockedUntil = @p0 WHERE Sitter_ID = @p1",
                                lockedUntil, nextJob.AssignedSitter_ID);

                            // Notify parent
                            if (nextJob.Parent_ID.HasValue)
                            {
                                _notificationService.CreateNotification(new NotificationDto
                                {
                                    UserId = nextJob.Parent_ID.Value,
                                    UserRole = "Parent",
                                    Message = "Your upcoming booking was cancelled because the previous session ran late. Please rebook.",
                                    Type = "LateCancellation",
                                    IsRead = false
                                });
                            }

                            // Notify sitter
                            if (nextJob.AssignedSitter_ID.HasValue)
                            {
                                _notificationService.CreateNotification(new NotificationDto
                                {
                                    UserId = nextJob.AssignedSitter_ID.Value,
                                    UserRole = "Sitter",
                                    Message = "Your next booking was cancelled. Resume bookings in 3 hours.",
                                    Type = "LateCancellation",
                                    IsRead = false
                                });
                            }
                        }
                    }
                }
            }
            else if (string.Equals(job.Status, JobStatus.Cancelled.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                // Part C: notify on any other job cancellation
                if (job.Parent_ID.HasValue)
                {
                    _notificationService.CreateNotification(new NotificationDto
                    {
                        UserId = job.Parent_ID.Value,
                        UserRole = "Parent",
                        Message = "Your job was cancelled.",
                        Type = "JobCancellation",
                        IsRead = false
                    });
                }

                if (job.AssignedSitter_ID.HasValue)
                {
                    _notificationService.CreateNotification(new NotificationDto
                    {
                        UserId = job.AssignedSitter_ID.Value,
                        UserRole = "Sitter",
                        Message = "Your job assignment was cancelled.",
                        Type = "JobCancellation",
                        IsRead = false
                    });
                }
            }

            // Workflow redesign notifications:
            // - SitterArrived: tell the parent to confirm the session start.
            // - In Progress: tell the sitter the parent confirmed.
            if (string.Equals(job.Status, JobStatus.SitterArrived.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                if (job.Parent_ID.HasValue)
                {
                    _notificationService.CreateNotification(new NotificationDto
                    {
                        UserId = job.Parent_ID.Value,
                        UserRole = "Parent",
                        Message = $"Your babysitter has arrived at {job.City}. Please confirm to start the session.",
                        Type = "SitterArrived",
                        IsRead = false
                    });
                }
            }
            else if (string.Equals(job.Status, JobStatus.InProgress.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                if (job.AssignedSitter_ID.HasValue)
                {
                    _notificationService.CreateNotification(new NotificationDto
                    {
                        UserId = job.AssignedSitter_ID.Value,
                        UserRole = "Sitter",
                        Message = "The parent has confirmed. Session started.",
                        Type = "SessionStarted",
                        IsRead = false
                    });
                }
            }

            return new JobStatusUpdateResultDto
            {
                Message = "Job status updated.",
                JobId = job.Job_ID,
                Status = job.Status,
                AssignedSitterId = job.AssignedSitter_ID,
                ParentId = job.Parent_ID
            };
        }
        /// <summary>
        /// Phase 8D — "Notify Parent I Can't Come".
        ///
        /// A sitter may release ONE day of a series (not the whole series).
        /// Guards, in order:
        ///   1. the job must exist and not be soft-deleted
        ///   2. caller must be a Sitter AND the assigned sitter for that day
        ///   3. the day must still be Assigned / Confirmed
        ///   4. at least 3 hours of notice before the first slot (Pakistan time)
        ///   5. the sitter has not already declined 3 days in this series
        ///
        /// On success the day is released back to Open and both the parent and
        /// the sitter are notified. JobInvitation is not an EDMX entity, so it is
        /// read and written with raw SQL (same pattern as ConfirmJob /
        /// TerminateSeries already in this file).
        /// </summary>
        public Task<(bool Success, string Message)> DeclineDayAsync(
            int jobId, int sitterId, string currentRole)
        {
            if (jobId <= 0)
                return Task.FromResult((false, "Job ID must be a positive integer."));

            // 1 — fetch
            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (job == null)
                return Task.FromResult((false, "Job not found."));

            // 2 — RBAC + IDOR
            if (currentRole != UserRole.Sitter.ToDisplayString()
                || job.AssignedSitter_ID == null
                || job.AssignedSitter_ID.Value != sitterId)
            {
                return Task.FromResult((false, "Not authorized."));
            }

            // 3 — lifecycle state. Only a day that has not started/ended/cancelled
            // can be released; anything else is refused.
            // "Confirmed" is accepted by the frontend and the DB (BookingStatus
            // maps it) but has no JobStatus enum member, so it is matched as a
            // literal here.
            string assigned = JobStatus.Assigned.ToDisplayString();
            string confirmed = "Confirmed";
            if (!string.Equals(job.Status, assigned, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(job.Status, confirmed, StringComparison.OrdinalIgnoreCase))
            {
                return Task.FromResult((false, "This day can no longer be declined."));
            }

            // 4 — 3 hours of notice, Pakistan local time. Mirrors the existing
            // session-window guard in UpdateJobStatus (pkNow conversion above).
            DateTime pkNow = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
                DateTime.UtcNow, "Pakistan Standard Time");

            var scheduledSlots = _db.JobTimeSlots
                .Where(jts => jts.Job_ID == job.Job_ID && jts.Slot_ID != null)
                .Select(jts => new { jts.TimeSlot.StartTime, jts.TimeSlot.EndTime })
                .ToList();

            TimeSpan? earliestStart = scheduledSlots
                .Where(slot => slot.StartTime.HasValue && slot.EndTime.HasValue)
                .Select(slot => slot.StartTime.Value)
                .OrderBy(time => time)
                .FirstOrDefault();

            if (earliestStart.HasValue)
            {
                DateTime jobDay = job.JobDate.Date;
                DateTime slotStart = jobDay + earliestStart.Value;
                DateTime declineCutoff = slotStart.AddHours(-3);

                if (pkNow > declineCutoff)
                {
                    return Task.FromResult((false,
                        "You can only decline at least 3 hours before the session start time."));
                }
            }

            // 5 — frequency cap: max 3 declines per series per sitter.
            // Single-day jobs have no series, so the cap does not apply.
            int declinedCount = 0;
            if (job.JobSeries_ID.HasValue)
            {
                declinedCount = _db.Database
                    .SqlQuery<int>(
                        "SELECT COUNT(1) FROM JobInvitation " +
                        "WHERE Sitter_ID = @p0 AND Status = 'Declined' " +
                        "  AND Job_ID IN (SELECT Job_ID FROM Job " +
                        "                 WHERE JobSeries_ID = @p1 AND IsDeleted = 0)",
                        sitterId, job.JobSeries_ID.Value)
                    .FirstOrDefault();

                if (declinedCount >= 3)
                {
                    return Task.FromResult((false,
                        "You have already declined 3 days in this series."));
                }
            }

            // Capture the values the notifications need BEFORE the release
            // clears AssignedSitter_ID.
            int releasedSitterId = sitterId;
            string sitterName = _db.Babysitters
                .Where(b => b.Sitter_ID == sitterId)
                .Select(b => b.FullName)
                .FirstOrDefault() ?? "Your sitter";
            int? parentId = job.Parent_ID;
            DateTime jobDate = job.JobDate;
            int? occurrenceIndex = job.SeriesOccurrenceIndex;
            int? seriesId = job.JobSeries_ID;
            int seriesTotal = seriesId.HasValue
                ? _db.Jobs.Count(j => j.JobSeries_ID == seriesId.Value && !j.IsDeleted)
                : 0;

            // 6 — release the day back to Open (D2).
            job.Status = JobStatus.Open.ToDisplayString();
            job.AssignedSitter_ID = null;
            _db.SaveChanges();

            // CancellationReason / CancelledAt are not in the EDMX model, so they
            // are written with raw SQL (same pattern as TerminateSeries).
            _db.Database.ExecuteSqlCommand(
                "UPDATE Job SET CancellationReason = @p0, CancelledAt = @p1 WHERE Job_ID = @p2",
                "Sitter unavailable", DateTime.Now, job.Job_ID);

            // Mark the invitation Declined. JobInvitation is not mapped.
            _db.Database.ExecuteSqlCommand(
                "UPDATE JobInvitation SET Status = 'Declined', RespondedAt = @p0 " +
                "WHERE Job_ID = @p1 AND Sitter_ID = @p2",
                DateTime.Now, job.Job_ID, releasedSitterId);

            // 7 — notify the parent (D4 / D3).
            if (parentId.HasValue)
            {
                string dayPart = occurrenceIndex.HasValue
                    ? $" (Day {occurrenceIndex.Value} of {seriesTotal})"
                    : string.Empty;
                _notificationService.CreateNotification(new NotificationDto
                {
                    UserId = parentId.Value,
                    UserRole = "Parent",
                    Message = $"{sitterName} can't come on {jobDate:dd MMM yyyy}{dayPart}. " +
                              "This day is now Open.",
                    Type = "SitterDeclinedDay",
                    IsRead = false
                }, job.Job_ID);
            }

            // 8 — confirm back to the sitter.
            int remaining = 2 - declinedCount;
            _notificationService.CreateNotification(new NotificationDto
            {
                UserId = releasedSitterId,
                UserRole = "Sitter",
                Message = $"You declined {jobDate:dd MMM yyyy}. " +
                          (seriesId.HasValue
                              ? $"{remaining} declines remaining in this series."
                              : "This booking is now open to other sitters."),
                Type = "DayDeclineConfirmed",
                IsRead = false
            }, job.Job_ID);

            return Task.FromResult((true, "Parent notified. Day released back to Open."));
        }

        public IEnumerable<SitterAssignedJobDto> GetSitterJobs(int sitterId)
        {
            if (sitterId <= 0)
                throw new ArgumentException("Sitter ID must be a positive integer.");

            ExpireStaleJobs(sitterId: sitterId);

            string parentRole = UserRole.Parent.ToDisplayString();
            var rawJobs = _db.Jobs
                .Where(j => j.AssignedSitter_ID == sitterId && !j.IsDeleted)
                .Select(j => new
                {
                    j.Job_ID,
                    j.Title,
                    j.JobDate,
                    j.Status,
                    j.Payment,
                    j.City,
                    j.SessionStartedAt,
                    j.SessionEndedAt,
                    j.JobSeries_ID,
                    j.SeriesOccurrenceIndex,
                    ChildName = j.Child != null ? (j.Child.IsDeleted ? "Deactivated Child" : j.Child.ChildName) : null,
                    ChildAge = (j.Child != null && j.Child.DOB != null) ? (DbFunctions.DiffYears(j.Child.DOB, DateTime.Now) ?? 0) : 0,
                    ParentName = j.Parent != null ? (j.Parent.IsDeleted ? "Deactivated Parent" : j.Parent.FullName) : null,
                    ParentPhone = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.PhoneNumber : null,
                    ParentAddress = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.Address : null,
                    ParentPic = (j.Parent != null && !j.Parent.IsDeleted) ? j.Parent.PictureAddress : null,
                    ParentRating = _db.Reviews
                        .Where(r => !r.IsDeleted && r.ReviewFor_ID == j.Parent_ID && r.ReviewForRole == parentRole)
                        .Average(r => (decimal?)r.Rating) ?? 0,
                    SlotTimes = _db.JobTimeSlots
                        .Where(js => js.Job_ID == j.Job_ID)
                        .Select(js => new { StartTime = js.TimeSlot.StartTime, EndTime = js.TimeSlot.EndTime })
                        .ToList()
                })
                .ToList();

            var jobs = rawJobs.Select(j => new SitterAssignedJobDto
            {
                Job_ID = j.Job_ID,
                Title = j.Title,
                JobDate = j.JobDate,
                Status = j.Status,
                Payment = j.Payment,
                City = j.City,
                ChildName = j.ChildName,
                ChildAge = j.ChildAge,
                ParentName = j.ParentName,
                ParentPhone = j.ParentPhone,
                ParentAddress = j.ParentAddress,
                ParentPic = j.ParentPic,
                ParentRating = j.ParentRating,
                SessionStartedAt = j.SessionStartedAt,
                SessionEndedAt = j.SessionEndedAt,
                JobSeries_ID = j.JobSeries_ID,
                SeriesOccurrenceIndex = j.SeriesOccurrenceIndex,
                SlotTimes = j.SlotTimes.Select(st => new ParentJobSlotTimeDto
                {
                    StartTime = st.StartTime,
                    EndTime = st.EndTime
                }).ToList()
            }).ToList();

            // Phase 6 multi-child: attach the full child list per job.
            // Assigned here (not inside the LINQ projection above) because
            // GetJobChildren issues raw SQL and would cause an N+1 query per
            // job that EF6 cannot translate. SitterAssignedJobDto is a
            // reference type, so mutating the materialised elements is
            // visible to the caller.
            foreach (var dto in jobs)
            {
                dto.Children = GetJobChildren(dto.Job_ID);
                var series = GetSeriesSummary(dto.Job_ID, dto.JobSeries_ID);
                dto.SeriesTotalCount = series.Count;
                dto.SeriesTotalPayment = series.TotalPayment;
            }

            return jobs;
        }

        /// <summary>
        /// Gets the currently relevant job for the authenticated user.
        /// </summary>
        /// <remarks>
        /// PURPOSE:
        /// Supplies the frontend with the user's current job state so the
        /// active-job screen can render. Consumed by GET api/jobs/active
        /// (JobsController.GetActiveJobForSitter) and, on the React side, by
        /// the active-job / cry-detection screens.
        ///
        /// BUSINESS RULE — status priority (highest first):
        ///   1. InProgress    — job under way.
        ///   2. SitterArrived — sitter confirmed arrival, parent has not started
        ///      the job yet (Phase 1 Fix A: this state was previously invisible
        ///      here, so the sitter lost sight of the job at the exact moment of
        ///      arrival).
        ///   3. Assigned + today's date — accepted but not yet started.
        ///
        /// SECURITY:
        /// currentUserId comes from the authenticated server session (claims),
        /// never from the client request body. A sitter may only read their own
        /// job (IDOR guard below); a parent only their own jobs.
        ///
        /// IMPORTANT — NOT a monitoring grant:
        /// Returning a job here does NOT authorize Child Monitoring. Future
        /// monitoring authorization (MonitoringAccess) requires ALL of:
        ///   AssignedSitter == currentUser
        ///   AND Job.Status == InProgress
        ///   AND the child belongs to JobChildren(job).
        /// Monitoring must never be authorized from SitterArrived.
        /// </remarks>
        public ActiveJobResultDto GetActiveJob(string currentRole, int currentUserId, int? requestedBabysitterId)
        {
            var query = _db.Jobs.Where(j => !j.IsDeleted);

            string sitterRole = UserRole.Sitter.ToDisplayString();
            string parentRole = UserRole.Parent.ToDisplayString();

            if (currentRole == sitterRole)
            {
                int sitterId = requestedBabysitterId.HasValue && requestedBabysitterId.Value > 0 ? requestedBabysitterId.Value : currentUserId;
                if (sitterId != currentUserId)
                    throw new UnauthorizedAccessException("Access denied: you may only view your own active job.");

                query = query.Where(j => j.AssignedSitter_ID == sitterId);
            }
            else if (currentRole == parentRole)
            {
                query = query.Where(j => j.Parent_ID == currentUserId);
            }
            else
            {
                if (requestedBabysitterId.HasValue && requestedBabysitterId.Value > 0)
                {
                    query = query.Where(j => j.AssignedSitter_ID == requestedBabysitterId.Value);
                }
                else
                {
                    throw new ArgumentException("User identity could not be verified.");
                }
            }

            var today = DateTime.Today;
            string inProgressStatus = JobStatus.InProgress.ToDisplayString();
            // KNOWN DATA CONVENTION CONFLICT (resolved deliberately here):
            // ToDisplayString() renders InProgress as "In Progress" (with a
            // space) and current backend writers (JobService status
            // transitions) store that spelling, but legacy rows already in the
            // database carry the plain enum name "InProgress" (no space) —
            // verified against live data during Phase 1 smoke testing. Both
            // spellings are matched below so neither generation of data
            // disappears from the active-job screen. SQL Server's default
            // collation makes the comparison case-insensitive; only the space
            // differs. Do NOT "simplify" this to one spelling without a data
            // migration AND a review of every other status reader
            // (AvailabilityService, BidService, JobInvitationService,
            // MatchingService all compare Job.Status too).
            string inProgressLegacyStatus = JobStatus.InProgress.ToString();
            string sitterArrivedStatus = JobStatus.SitterArrived.ToDisplayString();
            string assignedStatus = JobStatus.Assigned.ToDisplayString();

            // Which jobs count as "active" (Phase 1 Fix A):
            // - InProgress: always visible, highest priority.
            // - SitterArrived: visible WITHOUT a date window. The sitter has
            //   physically arrived, so the job must stay visible even if it
            //   runs past midnight; it disappears only by transitioning to
            //   InProgress / Completed / Cancelled.
            // - Assigned: only for today's date (existing behaviour preserved),
            //   so stale accepted jobs from previous days do not pollute the
            //   active-job screen.
            //
            // SECURITY NOTE: seeing a SitterArrived job here does NOT grant
            // monitoring permission — monitoring remains restricted to
            // InProgress by its own authorization layer (see method remarks).
            var job = query
                .Where(j =>
                    j.Status == inProgressStatus ||
                    j.Status == inProgressLegacyStatus ||
                    j.Status == sitterArrivedStatus ||
                    (j.Status == assignedStatus && DbFunctions.TruncateTime(j.JobDate) == today))
                // Priority: InProgress (true sorts above false in SQL) then
                // SitterArrived, then most recent job id.
                .OrderByDescending(j => j.Status == inProgressStatus || j.Status == inProgressLegacyStatus)
                .ThenByDescending(j => j.Status == sitterArrivedStatus)
                .ThenByDescending(j => j.Job_ID)
                .FirstOrDefault();

            if (job == null)
                return null;

            int childAge = 0;
            if (job.Child?.DOB != null)
            {
                childAge = DateTime.Now.Year - job.Child.DOB.Year;
                if (DateTime.Now < job.Child.DOB.AddYears(childAge)) childAge--;
            }

            var slotTimes = _db.JobTimeSlots
                .Where(js => js.Job_ID == job.Job_ID)
                .Select(js => new ParentJobSlotTimeDto { StartTime = js.TimeSlot.StartTime, EndTime = js.TimeSlot.EndTime })
                .ToList();

            var slotIds = _db.JobTimeSlots
                .Where(js => js.Job_ID == job.Job_ID)
                .Select(js => js.Slot_ID)
                .ToList();

            var parentRating = _db.Reviews
                .Where(r => !r.IsDeleted && r.ReviewFor_ID == job.Parent_ID && r.ReviewForRole == parentRole)
                .Average(r => (decimal?)r.Rating) ?? 0;

            var sitterRating = _db.Reviews
                .Where(r => !r.IsDeleted && r.ReviewFor_ID == job.AssignedSitter_ID && r.ReviewForRole == sitterRole)
                .Average(r => (decimal?)r.Rating) ?? 0;

            string parentName = (job.Parent != null && !job.Parent.IsDeleted) ? job.Parent.FullName : "Deactivated Parent";
            string childName = (job.Child != null && !job.Child.IsDeleted) ? job.Child.ChildName : "Unknown Child";

            return new ActiveJobResultDto
            {
                Job_ID = job.Job_ID,
                jobId = job.Job_ID,
                Parent_ID = job.Parent_ID,
                parentId = job.Parent_ID,
                Child_ID = job.Child_ID,
                childId = job.Child_ID,
                Title = job.Title,
                Description = job.Description,
                JobDate = job.JobDate,
                Status = job.Status,
                Payment = job.Payment,
                City = job.City,
                ParentName = parentName,
                parentName = parentName,
                ParentAddress = (job.Parent != null && !job.Parent.IsDeleted) ? job.Parent.Address : null,
                ParentPhone = (job.Parent != null && !job.Parent.IsDeleted) ? job.Parent.PhoneNumber : null,
                ParentPic = (job.Parent != null && !job.Parent.IsDeleted) ? job.Parent.PictureAddress : null,
                ParentRating = parentRating,
                ChildName = childName,
                childName = childName,
                ChildAge = childAge,
                Gender = (job.Child != null && !job.Child.IsDeleted) ? job.Child.Gender : null,
                PictureAddress = (job.Child != null && !job.Child.IsDeleted) ? job.Child.PictureAddress : null,
                AssignedSitter_ID = job.AssignedSitter_ID,
                sitterId = job.AssignedSitter_ID,
                SitterName = (job.Babysitter != null && !job.Babysitter.IsDeleted) ? job.Babysitter.FullName : null,
                SitterPicture = (job.Babysitter != null && !job.Babysitter.IsDeleted) ? job.Babysitter.PictureAddress : null,
                SitterPhone = (job.Babysitter != null && !job.Babysitter.IsDeleted) ? job.Babysitter.PhoneNumber : null,
                SitterRating = sitterRating,
                SlotTimes = slotTimes,
                SlotIds = slotIds
            };
        }

        public void Dispose()
        {
            if (_ownsContext)
            {
                _db.Dispose();
            }
            if (_notificationService is IDisposable disposable)
            {
                disposable.Dispose();
            }
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

        /// <summary>
        /// Phase 8D — every non-deleted day of a series, ordered by occurrence.
        ///
        /// /jobs/sitter/{id} only returns jobs ASSIGNED to that sitter, so a
        /// sibling that was cancelled or released back to Open was invisible to
        /// them — the sitter's pagination bar therefore showed fewer days than
        /// the parent's. Both screens now read this single source of truth.
        ///
        /// Returns null when the caller is not a participant: the owning parent,
        /// the assigned sitter, or a sitter who was invited to the series.
        /// Without that check any authenticated user could enumerate arbitrary
        /// series ids and read another family's schedule.
        /// </summary>
        public IEnumerable<SeriesSiblingDto> GetSeriesJobs(
            int seriesId, int currentUserId, string currentRole)
        {
            var seriesJobs = _db.Jobs
                .Where(j => j.JobSeries_ID == seriesId && !j.IsDeleted)
                .ToList();

            if (seriesJobs.Count == 0)
                return null;

            bool isParent = string.Equals(currentRole, "Parent",
                              StringComparison.OrdinalIgnoreCase)
                && seriesJobs.Any(j => j.Parent_ID == currentUserId);

            // Assigned sitter covers the normal case.
            bool isSitter = string.Equals(currentRole, "Sitter",
                              StringComparison.OrdinalIgnoreCase)
                && seriesJobs.Any(j => j.AssignedSitter_ID == currentUserId);

            // An invited-but-not-yet-hired sitter must see the series too,
            // otherwise the bar is empty on a pending series. JobInvitation is
            // not in the EDMX model, so this check is raw SQL (same pattern as
            // the decline-day frequency cap).
            if (!isParent && !isSitter
                && string.Equals(currentRole, "Sitter", StringComparison.OrdinalIgnoreCase))
            {
                var jobIds = seriesJobs.Select(j => j.Job_ID).ToList();
                isSitter = _db.Database
                    .SqlQuery<int>(
                        "SELECT COUNT(1) FROM JobInvitation " +
                        "WHERE Sitter_ID = @p0 AND Job_ID IN (" +
                        string.Join(",", jobIds) + ")",
                        currentUserId)
                    .FirstOrDefault() > 0;
            }

            if (!isParent && !isSitter)
                return null;

            return seriesJobs
                .OrderBy(j => j.SeriesOccurrenceIndex ?? 0)
                .ThenBy(j => j.JobDate)
                .Select(j => new SeriesSiblingDto
                {
                    Job_ID = j.Job_ID,
                    JobSeries_ID = j.JobSeries_ID,
                    SeriesOccurrenceIndex = j.SeriesOccurrenceIndex,
                    JobDate = j.JobDate,
                    Status = j.Status,
                    AssignedSitter_ID = j.AssignedSitter_ID,
                    Parent_ID = j.Parent_ID,
                    SessionStartedAt = j.SessionStartedAt,
                    SessionEndedAt = j.SessionEndedAt,
                    Payment = j.Payment
                })
                .ToList();
        }

        /// <summary>
        /// Returns the recurring-contract summary for the current job and all of
        /// its non-deleted siblings. Date-only weekdays are returned once each
        /// in Monday-through-Sunday order.
        /// </summary>
        private (int? Id, int? Index, int? Count, decimal? TotalPayment,
            DateTime? StartDate, DateTime? EndDate, string[] Days) GetSeriesSummary(
            int jobId, int? seriesId)
        {
            if (!seriesId.HasValue)
                return (null, null, null, null, null, null, new string[0]);

            var siblings = _db.Jobs
                .Where(j => j.JobSeries_ID == seriesId.Value && !j.IsDeleted)
                .Select(j => new { j.Job_ID, j.SeriesOccurrenceIndex, j.Payment, j.JobDate })
                .ToList();

            if (siblings.Count == 0)
                return (null, null, null, null, null, null, new string[0]);

            var own = siblings.FirstOrDefault(j => j.Job_ID == jobId);
            var datedSiblings = siblings
                .Select(j => j.JobDate)
                .ToList();
            var days = siblings
                .Select(j => ((int)j.JobDate.DayOfWeek + 6) % 7)
                .Distinct()
                .OrderBy(day => day)
                .Select(day => new[] { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" }[day])
                .ToArray();

            return (
                seriesId,
                own == null ? (int?)null : own.SeriesOccurrenceIndex,
                siblings.Count,
                siblings.Sum(j => j.Payment ?? 0m),
                datedSiblings.Count == 0 ? (DateTime?)null : datedSiblings.Min(),
                datedSiblings.Count == 0 ? (DateTime?)null : datedSiblings.Max(),
                days);
        }

        /// <summary>
        /// TerminateSeries: terminates the recurring series for the given job.
        /// </summary>
        public (string Message, int Count) TerminateSeries(
            int jobId, string scope, string currentRole, int currentUserId)
        {
            var anchor = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (anchor == null) throw new ArgumentException("Job not found.");
            if (!anchor.JobSeries_ID.HasValue)
                throw new InvalidOperationException("This job is not part of a series.");

            bool isParent = currentRole == UserRole.Parent.ToDisplayString()
                            && anchor.Parent_ID == currentUserId;
            bool isSitter = currentRole == UserRole.Sitter.ToDisplayString()
                            && anchor.AssignedSitter_ID == currentUserId;
            if (!isParent && !isSitter)
                throw new UnauthorizedAccessException(
                    "Only the series parent or assigned sitter can terminate it.");

            string scopeNormalized = (scope ?? "future").Trim().ToLowerInvariant();
            DateTime today = DateTime.Today;

            var seriesJobs = _db.Jobs
                .Where(j => j.JobSeries_ID == anchor.JobSeries_ID.Value && !j.IsDeleted)
                .ToList();

            int affected = 0;
            foreach (var j in seriesJobs)
            {
                bool inScope =
                    scopeNormalized == "all" ||
                    (scopeNormalized == "future" && j.JobDate >= today);
                if (!inScope) continue;
                if (string.Equals(j.Status, "Completed", StringComparison.OrdinalIgnoreCase)) continue;
                if (string.Equals(j.Status, "Cancelled", StringComparison.OrdinalIgnoreCase)) continue;

                int? previousSitter = j.AssignedSitter_ID;
                j.Status = "Cancelled";
                j.CancellationReason = $"Series terminated by {currentRole}";
                j.CancelledAt = DateTime.UtcNow;
                j.AssignedSitter_ID = null;
                affected++;

                if (isParent && previousSitter.HasValue)
                {
                    _notificationService.CreateNotification(new NotificationDto {
                        UserId = previousSitter.Value, UserRole = "Sitter",
                        Message = "A series you were assigned to was terminated by the parent.",
                        Type = "SeriesTerminatedByParent", IsRead = false
                    });
                }
                else if (isSitter && j.Parent_ID.HasValue)
                {
                    _notificationService.CreateNotification(new NotificationDto {
                        UserId = j.Parent_ID.Value, UserRole = "Parent",
                        Message = "Your series booking was terminated by the sitter.",
                        Type = "SeriesTerminatedBySitter", IsRead = false
                    });
                }
            }

            _db.SaveChanges();
            return ($"Series terminated. {affected} bookings cancelled.", affected);
        }
    }
}

