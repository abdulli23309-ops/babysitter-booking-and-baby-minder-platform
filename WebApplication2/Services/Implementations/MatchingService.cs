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
    public class MatchingService : IMatchingService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public MatchingService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public MatchingService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        public IEnumerable<MatchingSitterResultDto> GetMatchingSitters(int jobId, int currentUserId)
        {
            var job = _db.Jobs.FirstOrDefault(j => j.Job_ID == jobId && !j.IsDeleted);
            if (job == null)
                throw new KeyNotFoundException("Job not found.");

            if (job.Parent_ID != currentUserId)
                throw new UnauthorizedAccessException("You are not allowed to access this job.");

            string jobCity = (job.City ?? "").Trim().ToLower();

            var jobSlotIds = _db.JobTimeSlots
                .Where(js => js.Job_ID == jobId)
                .Select(js => js.Slot_ID)
                .ToList();

            // Pre-computed constants for EF6 translation
            string sitterRole = UserRole.Sitter.ToDisplayString();

            var result = (
                from b in _db.Babysitters
                join sa in _db.SitterAvailabilities on b.Sitter_ID equals sa.Sitter_ID
                where !b.IsDeleted
                   && !sa.IsDeleted
                   && sa.AvailableDate == job.JobDate
                   && jobSlotIds.Contains(sa.Slot_ID)
                   && sa.City.Trim().ToLower() == jobCity
                select new MatchingSitterResultDto
                {
                    Sitter_ID = b.Sitter_ID,
                    FullName = b.FullName,
                    HourlyRate = b.HourlyRate,
                    ExperienceYears = b.ExperienceYears,
                    PictureAddress = b.PictureAddress,
                    Rating = _db.Reviews
                        .Where(r => !r.IsDeleted && r.ReviewFor_ID == b.Sitter_ID && r.ReviewForRole == sitterRole)
                        .Average(r => (decimal?)r.Rating) ?? 0
                }
            ).Distinct().ToList();

            return result;
        }

        public List<SitterDTO> FilterSitters(FilterSittersDTO filter)
        {
            if (filter == null)
                filter = new FilterSittersDTO();

            var query = _db.Babysitters.Where(s => !s.IsDeleted);

            if (filter.MinExperience.HasValue)
                query = query.Where(s => s.ExperienceYears >= filter.MinExperience);

            if (!string.IsNullOrEmpty(filter.City))
            {
                string city = filter.City.ToLower().Trim();
                query = query.Where(s => _db.SitterAvailabilities
                    .Any(sa => !sa.IsDeleted && sa.Sitter_ID == s.Sitter_ID &&
                               sa.City.ToLower().Trim() == city));
            }

            // Pre-computed constants for EF6 translation
            string sitterRole = UserRole.Sitter.ToDisplayString();

            var sitters = query.ToList().Select(s => new SitterDTO
            {
                Sitter_ID = s.Sitter_ID,
                FullName = s.FullName,
                HourlyRate = s.HourlyRate ?? 0,
                ExperienceYears = s.ExperienceYears ?? 0,
                PictureAddress = s.PictureAddress,
                City = filter.City,
                Rating = _db.Reviews
                    .Where(r => !r.IsDeleted && r.ReviewFor_ID == s.Sitter_ID && r.ReviewForRole == sitterRole)
                    .Average(r => (decimal?)r.Rating) ?? 0
            }).ToList();

            if (filter.MinRating.HasValue)
                sitters = sitters.Where(s => s.Rating >= filter.MinRating).ToList();

            return sitters;
        }

        public List<SitterDTO> SearchSitters(SearchSittersDTO dto)
        {
            if (dto == null)
                throw new ArgumentNullException(nameof(dto));

            TimeSpan startTimeParsed = TimeSpan.Parse(dto.StartTime.Trim());
            TimeSpan endTimeParsed = TimeSpan.Parse(dto.EndTime.Trim());
            DateTime startDate = DateTime.Parse(dto.StartDate);
            DateTime endDate = DateTime.Parse(dto.EndDate);

            var query = _db.Babysitters.Where(s => !s.IsDeleted);

            if (dto.MinExperienceYears.HasValue)
                query = query.Where(s => s.ExperienceYears >= dto.MinExperienceYears);

            bool hasGeo = dto.Latitude.HasValue && dto.Longitude.HasValue;

            if (!hasGeo && !string.IsNullOrEmpty(dto.City))
            {
                string cityLower = dto.City.ToLower().Trim();
                query = query.Where(s => _db.SitterAvailabilities
                    .Any(sa => !sa.IsDeleted && sa.Sitter_ID == s.Sitter_ID &&
                               sa.City.ToLower().Trim() == cityLower));
            }

            // Pre-computed constants for EF6 translation
            string sitterRole = UserRole.Sitter.ToDisplayString();

            var sitters = query.ToList().Select(s => new SitterDTO
            {
                Sitter_ID = s.Sitter_ID,
                FullName = s.FullName,
                HourlyRate = ResolveRate(s, dto),
                ExperienceYears = s.ExperienceYears ?? 0,
                PictureAddress = s.PictureAddress,
                City = dto.City,
                Rating = _db.Reviews
                    .Where(r => !r.IsDeleted && r.ReviewFor_ID == s.Sitter_ID && r.ReviewForRole == sitterRole)
                    .Average(r => (decimal?)r.Rating) ?? 0
            }).Where(s => s.Rating >= dto.MinRating).ToList();

            // Rule G: exclude locked sitters from search
            var candidateIds = sitters.Select(s => s.Sitter_ID).ToList();
            if (candidateIds.Any())
            {
                var idList = string.Join(",", candidateIds);
                var lockedRows = _db.Database
                    .SqlQuery<SitterLockoutRow>(
                        "SELECT Sitter_ID, SitterLockedUntil FROM Babysitter WHERE Sitter_ID IN (" + idList + ")")
                    .ToList();

                var lockedNow = new HashSet<int>(lockedRows
                    .Where(r => r.SitterLockedUntil.HasValue && r.SitterLockedUntil.Value > DateTime.UtcNow)
                    .Select(r => r.Sitter_ID));

                if (lockedNow.Any())
                    sitters = sitters.Where(s => !lockedNow.Contains(s.Sitter_ID)).ToList();
            }

            if (!sitters.Any())
                return new List<SitterDTO>();

            // Exclude soft-deleted/retired slots (e.g. the legacy 18:00-20:00 and
            // 20:00-22:00 rows). Without this filter the All(...) availability test
            // below demands availability rows for slots nobody can select any more.
            var allTimeSlots = _db.TimeSlots.Where(ts => !ts.IsDeleted).ToList();
            var requiredSlotIds = allTimeSlots
                .Where(ts => ts.StartTime.HasValue && ts.EndTime.HasValue &&
                             ts.StartTime.Value < endTimeParsed && ts.EndTime.Value > startTimeParsed)
                .Select(ts => ts.Slot_ID)
                .ToList();

            if (!requiredSlotIds.Any())
                return new List<SitterDTO>();

            var datesToCheck = new List<DateTime>();

            if (string.Equals(dto.AvailabilityType, AvailabilityType.OneDay.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                datesToCheck.Add(startDate);
            }
            else
            {
                for (var date = startDate; date <= endDate; date = date.AddDays(1))
                {
                    string dayFull = date.DayOfWeek.ToString();
                    string dayShort = date.ToString("ddd");
                    if (dto.SelectedDays != null && dto.SelectedDays.Any(d =>
                        string.Equals(d.Trim(), dayFull, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(d.Trim(), dayShort, StringComparison.OrdinalIgnoreCase)))
                    {
                        datesToCheck.Add(date);
                    }
                }
            }

            if (!datesToCheck.Any())
                return new List<SitterDTO>();

            var finalSitters = sitters.Where(s =>
            {
                foreach (var date in datesToCheck)
                {
                    var availableSlotIds = _db.SitterAvailabilities
                        .Where(sa => !sa.IsDeleted &&
                                     sa.Sitter_ID == s.Sitter_ID &&
                                     DbFunctions.TruncateTime(sa.AvailableDate) == date.Date &&
                                     (hasGeo || sa.City.ToLower().Trim() == dto.City.ToLower().Trim()))
                        .Select(sa => sa.Slot_ID)
                        .ToList();

                    if (!requiredSlotIds.All(id => availableSlotIds.Contains(id)))
                        continue;   // this date does not qualify, try the next

                    if (HasConflictingJobs(s.Sitter_ID, date, requiredSlotIds, requireCommuteBuffer: true))
                        continue;   // this date has a conflict, try the next

                    return true;    // at least one qualifying date is enough
                }
                return false;
            }).ToList();

            // ─── Geo-matching radius filter (raw SQL — coordinates live outside the EDMX) ─────
            // Rules (documented in GEO_MATCHING_REPORT.md):
            //  1. Sitter with no availability rows / no geo data        → kept, DistanceKm = null
            //  2. Sitter with rows but none carrying coordinates        → kept, DistanceKm = null
            //  3. Sitter with coords: kept only if at least ONE row's
            //     radius circle contains the parent point. DistanceKm   = shortest matching distance.
            //  4. Sitter with coords but ALL rows having RadiusKm null  → kept, DistanceKm = null
            if (dto.Latitude.HasValue && dto.Longitude.HasValue && finalSitters.Any())
            {
                var sitterIds = finalSitters.Select(s => s.Sitter_ID).ToList();
                var idList = string.Join(",", sitterIds);
                var cityEscaped = (dto.City ?? "").Replace("'", "''").Trim().ToLower();

                var sql = "SELECT Availability_ID, Sitter_ID, Latitude, Longitude, RadiusKm FROM SitterAvailability " +
                          "WHERE IsDeleted = 0 AND Sitter_ID IN (" + idList + ")";

                if (!hasGeo)
                {
                    sql += " AND LOWER(LTRIM(RTRIM(City))) = '" + cityEscaped + "'";
                }

                var geoRows = _db.Database.SqlQuery<SitterAvailabilityCoordsDto>(sql).ToList();

                var geoBySitter = geoRows
                    .Where(g => g.Sitter_ID.HasValue)
                    .GroupBy(g => g.Sitter_ID.Value)
                    .ToDictionary(g => g.Key, g => g.ToList());

                finalSitters = finalSitters.Where(s =>
                {
                    List<SitterAvailabilityCoordsDto> rows;
                    if (!geoBySitter.TryGetValue(s.Sitter_ID, out rows) || rows.Count == 0)
                        return true; // rule 1

                    var withCoords = rows.Where(r => r.Latitude.HasValue && r.Longitude.HasValue).ToList();
                    if (withCoords.Count == 0)
                        return true; // rule 2

                    double? shortest = null;
                    foreach (var r in withCoords)
                    {
                        var dist = GeoHelper.HaversineDistanceKm(
                            dto.Latitude.Value, dto.Longitude.Value,
                            r.Latitude.Value, r.Longitude.Value);

                        if (r.RadiusKm.HasValue && dist <= r.RadiusKm.Value &&
                            (!shortest.HasValue || dist < shortest.Value))
                            shortest = dist;
                    }

                    if (shortest.HasValue)
                    {
                        s.DistanceKm = Math.Round(shortest.Value, 2);
                        return true; // rule 3
                    }

                    return withCoords.Any(r => !r.RadiusKm.HasValue); // rule 4
                }).ToList();
            }

            // API-B Fallback pattern: If no exact schedule/slot match is found and fallback is requested,
            // return sitters in that city who meet the rating and experience requirements with a notification message.
            if (!finalSitters.Any() && dto.EnableFallback && sitters.Any())
            {
                foreach (var s in sitters)
                {
                    s.Message = "Schedule not found, showing all babysitters";
                }
                return sitters;
            }

            return finalSitters;
        }

        public List<MatchingJobDto> GetJobRequestsForSitter(int sitterId)
        {
            var availability = _db.SitterAvailabilities
                .Where(sa => sa.Sitter_ID == sitterId && !sa.IsDeleted)
                .Select(sa => new { sa.AvailableDate, sa.Slot_ID, sa.City })
                .ToList();

            var availabilityGroups = availability
                .GroupBy(a => new { a.AvailableDate, a.City })
                .Select(g => new
                {
                    Date = g.Key.AvailableDate,
                    City = g.Key.City,
                    SlotIds = g.Select(x => x.Slot_ID).ToList()
                })
                .ToList();

            // Pre-computed constant for EF6 translation
            string openStatus = JobStatus.Open.ToDisplayString();

            // Geo data for this sitter's availability rows (outside the EDMX — raw SQL)
            var availRows = _db.Database.SqlQuery<SitterAvailabilityCoordsDto>(
                "SELECT Availability_ID, Sitter_ID, Latitude, Longitude, RadiusKm " +
                "FROM SitterAvailability WHERE IsDeleted = 0 AND Sitter_ID = @p0",
                sitterId).ToList();

            var matchingJobs = new List<MatchingJobDto>();

            foreach (var avail in availabilityGroups)
            {
                // No city clause in the query itself — geo/city decided in memory below
                var jobsOnDate = _db.Jobs
                    .Where(j => !j.IsDeleted
                             && (j.Parent == null || !j.Parent.IsDeleted)
                             && j.Status == openStatus
                             && DbFunctions.TruncateTime(j.JobDate) == DbFunctions.TruncateTime(avail.Date))
                    .ToList();

                var matchingJobsForThisDate = jobsOnDate.Where(job =>
                {
                    // Find geo for the job
                    var jg = _db.Database.SqlQuery<JobCoordsDto>(
                        "SELECT Job_ID, Latitude, Longitude FROM Job WHERE Job_ID = @p0",
                        job.Job_ID).FirstOrDefault();

                    // Find geo for the sitter's availability on this date
                    var availOnDate = availRows
                        .Where(a => a.Sitter_ID == sitterId
                                 && a.Latitude.HasValue
                                 && a.Longitude.HasValue
                                 && a.RadiusKm.HasValue)
                        .ToList();

                    // If both sides have coordinates, use radius match
                    if (jg != null && jg.Latitude.HasValue && jg.Longitude.HasValue
                        && availOnDate.Any())
                    {
                        foreach (var a in availOnDate)
                        {
                            var dist = GeoHelper.HaversineDistanceKm(
                                a.Latitude.Value, a.Longitude.Value,
                                jg.Latitude.Value, jg.Longitude.Value);
                            if (dist <= a.RadiusKm.Value)
                                return true;
                        }
                        return false;
                    }

                    // Fallback: keep existing city string comparison only when
                    // coordinates are missing on either side
                    return string.Equals(
                        (job.City ?? "").Trim(),
                        (avail.City ?? "").Trim(),
                        StringComparison.OrdinalIgnoreCase);
                }).ToList();

                foreach (var job in matchingJobsForThisDate)
                {
                    var jobSlotIds = _db.JobTimeSlots
                        .Where(js => js.Job_ID == job.Job_ID)
                        .Select(js => js.Slot_ID)
                        .ToList();

                    bool allSlotsAvailable = jobSlotIds.All(slot => avail.SlotIds.Contains(slot));
                    if (allSlotsAvailable)
                    {
                        matchingJobs.Add(new MatchingJobDto
                        {
                            Job_ID = job.Job_ID,
                            Title = job.Title,
                            Description = job.Description,
                            JobDate = job.JobDate,
                            City = job.City,
                            Payment = job.Payment,
                            Status = job.Status,
                            RequiredSlotIds = jobSlotIds,
                            ParentName = (job.Parent != null && !job.Parent.IsDeleted) ? job.Parent.FullName : "Deactivated Parent",
                            ParentPhone = (job.Parent != null && !job.Parent.IsDeleted) ? job.Parent.PhoneNumber : null,
                            ChildName = (job.Child != null && !job.Child.IsDeleted) ? job.Child.ChildName : "Unknown Child"
                        });
                    }
                }
            }

            var result = matchingJobs.GroupBy(j => j.Job_ID).Select(g => g.First()).ToList();
            return result;
        }

        public SitterDTO GetBabysitterDetails(int id)
        {
            var s = _db.Babysitters.FirstOrDefault(b => b.Sitter_ID == id && !b.IsDeleted);
            if (s == null) return null;

            // Pre-computed constant for EF6 translation
            string sitterRole = UserRole.Sitter.ToDisplayString();

            var dto = new SitterDTO
            {
                Sitter_ID = s.Sitter_ID,
                FullName = s.FullName,
                HourlyRate = s.HourlyRate ?? 0,
                ExperienceYears = s.ExperienceYears ?? 0,
                PictureAddress = s.PictureAddress,
                EmailAddress = s.EmailAddress,
                PhoneNumber = s.PhoneNumber,
                DOB = s.DOB,
                Rating = _db.Reviews
                    .Where(r => !r.IsDeleted && r.ReviewFor_ID == s.Sitter_ID && r.ReviewForRole == sitterRole)
                    .Average(r => (decimal?)r.Rating) ?? 0
            };

            var lockoutRow = _db.Database
                .SqlQuery<SitterLockoutRow>(
                    "SELECT Sitter_ID, SitterLockedUntil FROM Babysitter WHERE Sitter_ID = @p0",
                    id)
                .FirstOrDefault();

            if (lockoutRow != null)
                dto.SitterLockedUntil = lockoutRow.SitterLockedUntil;

            return dto;
        }

        private bool HasConflictingJobs(int sitterId, DateTime date, List<int> requiredSlotIds, bool requireCommuteBuffer = true)
        {
            var conflictSlots = new HashSet<int>(requiredSlotIds);

            if (requireCommuteBuffer && requiredSlotIds.Any())
            {
                int minSlot = requiredSlotIds.Min();
                if (minSlot > 1)
                    conflictSlots.Add(minSlot - 1);
            }

            // Pre-computed constants for EF6 translation
            string assignedStatus = JobStatus.Assigned.ToDisplayString();
            string inProgressStatus = JobStatus.InProgress.ToDisplayString();

            bool hasConflict = _db.Jobs.Any(j =>
                !j.IsDeleted &&
                j.AssignedSitter_ID == sitterId &&
                (j.Status == assignedStatus || j.Status == inProgressStatus) &&
                DbFunctions.TruncateTime(j.JobDate) == DbFunctions.TruncateTime(date) &&
                _db.JobTimeSlots.Any(js =>
                    js.Job_ID == j.Job_ID &&
                    js.Slot_ID.HasValue &&
                    conflictSlots.Contains(js.Slot_ID.Value)
                )
            );

            return hasConflict;
        }

        /// <summary>
        /// Resolves the hourly rate a parent should see for this sitter.
        /// Prefers the most recent live SitterAvailability row whose
        /// AvailableDate falls inside the requested [StartDate, EndDate]
        /// window (that is the rate the sitter set on Set Availability),
        /// and falls back to the sitter's own default signup rate when no
        /// dated rate exists. Read fresh on every search — never cached.
        /// </summary>
        private decimal ResolveRate(Babysitter s, SearchSittersDTO dto)
        {
            if (s == null)
                return 0;

            DateTime rangeStart;
            DateTime rangeEnd;

            if (dto == null || !DateTime.TryParse(dto.StartDate, out rangeStart))
                rangeStart = DateTime.MinValue;

            if (dto == null || !DateTime.TryParse(dto.EndDate, out rangeEnd))
                rangeEnd = rangeStart;

            var sitterId = s.Sitter_ID;

            var row = _db.SitterAvailabilities
                .Where(a => a.Sitter_ID == sitterId
                         && !a.IsDeleted
                         && a.AvailableDate >= rangeStart
                         && a.AvailableDate <= rangeEnd
                         && a.HourlyRate != null)
                .OrderByDescending(a => a.Availability_ID)
                .FirstOrDefault();

            if (row != null && row.HourlyRate.HasValue && row.HourlyRate.Value > 0)
                return row.HourlyRate.Value;

            // Fall back to the sitter's default signup rate.
            return s.HourlyRate ?? 0;
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