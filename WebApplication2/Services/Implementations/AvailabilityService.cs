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
    public class AvailabilityService : IAvailabilityService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public AvailabilityService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public AvailabilityService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        public void SaveAvailability(AvailabilityDto dto)
        {
            if (dto == null)
                throw new ArgumentNullException(nameof(dto));
            if (dto.SitterId <= 0)
                throw new ArgumentException("Sitter ID must be a positive integer.", nameof(dto));
            if (dto.SlotIds == null || dto.SlotIds.Count == 0)
                throw new ArgumentException("At least one slot ID is required.", nameof(dto));

            // Pre-mutation validation ordering (API-B pattern):
            // 1. Verify sitter exists and is not deleted
            var sitter = _db.Babysitters.FirstOrDefault(b => b.Sitter_ID == dto.SitterId && !b.IsDeleted);
            if (sitter == null)
                throw new KeyNotFoundException("Babysitter not found or inactive.");

            // 2. Verify all slot IDs exist in the system
            var validSlotIds = _db.TimeSlots
                .Where(ts => !ts.IsDeleted)
                .Select(ts => ts.Slot_ID)
                .ToList();
            var invalidSlots = dto.SlotIds.Where(id => !validSlotIds.Contains(id)).ToList();
            if (invalidSlots.Any())
                throw new ArgumentException($"One or more time slot IDs are invalid: {string.Join(", ", invalidSlots)}", nameof(dto));

            // Rule A: reject any slot that already has an Assigned or InProgress job for this sitter
            string assignedStatus   = JobStatus.Assigned.ToDisplayString();
            string inProgressStatus = JobStatus.InProgress.ToDisplayString();

            var lockedSlots = (from j in _db.Jobs
                               join js in _db.JobTimeSlots on j.Job_ID equals js.Job_ID
                               where !j.IsDeleted
                                  && j.AssignedSitter_ID == dto.SitterId
                                  && (j.Status == assignedStatus || j.Status == inProgressStatus)
                                  && DbFunctions.TruncateTime(j.JobDate) == DbFunctions.TruncateTime(dto.Date)
                                  && js.Slot_ID.HasValue
                                  && dto.SlotIds.Contains(js.Slot_ID.Value)
                               select js.Slot_ID.Value)
                              .Distinct()
                              .ToList();

            if (lockedSlots.Any())
                throw new InvalidOperationException(
                    "One or more selected slots are already booked: slot " +
                    string.Join(", ", lockedSlots) +
                    ". Please remove them and try again.");

            // 3. Soft-delete existing availability for this sitter on this date
            // so re-saving always reflects the latest grid without losing audit
            var existing = _db.SitterAvailabilities
                .Where(sa => sa.Sitter_ID == dto.SitterId && !sa.IsDeleted && DbFunctions.TruncateTime(sa.AvailableDate) == DbFunctions.TruncateTime(dto.Date))
                .ToList();

            foreach (var item in existing)
            {
                item.IsDeleted = true;
            }

            // 4. Insert fresh rows
            var newRows = new List<SitterAvailability>();
            foreach (var slotId in dto.SlotIds)
            {
                                var row = new SitterAvailability
                {
                    Sitter_ID = dto.SitterId,
                    AvailableDate = dto.Date,
                    Slot_ID = slotId,
                    City = (dto.City ?? "").Trim(),
                    HourlyRate = dto.HourlyRate,
                    IsDeleted = false
                };
                _db.SitterAvailabilities.Add(row);
                newRows.Add(row);
            }

            _db.SaveChanges();

            // 5. Persist geo coordinates via RAW SQL (columns not in the EDMX).
            //    Uses .Value per the EF6 nullable-parameter guidance.
            if (dto.Latitude.HasValue && dto.Longitude.HasValue && dto.RadiusKm.HasValue && newRows.Any())
            {
                foreach (var row in newRows)
                {
                    _db.Database.ExecuteSqlCommand(
                        "UPDATE SitterAvailability SET Latitude = @p0, Longitude = @p1, RadiusKm = @p2 WHERE Availability_ID = @p3",
                        dto.Latitude.Value, dto.Longitude.Value, dto.RadiusKm.Value, row.Availability_ID);
                }
            }
        }

        public IEnumerable<SitterAvailabilityItemDto> GetSitterAvailability(int sitterId)
        {
            var today = DateTime.Today;
            var result = _db.SitterAvailabilities
                .Where(sa => sa.Sitter_ID == sitterId && !sa.IsDeleted)
                .Where(sa => sa.Sitter_ID == sitterId
                          && !sa.IsDeleted
                          && DbFunctions.TruncateTime(sa.AvailableDate) >= today)
                .OrderBy(sa => sa.Availability_ID)
                                .Select(sa => new SitterAvailabilityItemDto
                {
                    Availability_ID = sa.Availability_ID,
                    Sitter_ID = sa.Sitter_ID,
                    AvailableDate = sa.AvailableDate,
                    Slot_ID = sa.Slot_ID,
                    City = sa.City,
                    HourlyRate = sa.HourlyRate
                })
                .ToList();

            string assignedStatus   = JobStatus.Assigned.ToDisplayString();
            string inProgressStatus = JobStatus.InProgress.ToDisplayString();

            var booked = (from j in _db.Jobs
                          join js in _db.JobTimeSlots on j.Job_ID equals js.Job_ID
                          where !j.IsDeleted
                             && j.AssignedSitter_ID == sitterId
                             && (j.Status == assignedStatus || j.Status == inProgressStatus)
                             && js.Slot_ID.HasValue
                          select new { j.Job_ID, JobDate = DbFunctions.TruncateTime(j.JobDate), SlotId = js.Slot_ID.Value })
                         .ToList();

                        foreach (var row in result)
            {
                var match = booked.FirstOrDefault(b =>
                    b.JobDate?.Date == row.AvailableDate?.Date &&
                    b.SlotId == row.Slot_ID);
                if (match != null)
                {
                    row.IsLocked = true;
                    row.LockedByJobId = match.Job_ID;
                }
            }

            // Enrich with geo coordinates (Latitude / Longitude / RadiusKm).
            // These columns exist in the SQL DB (added via raw SQL in SaveAvailability)
            // but are NOT mapped on the EDMX SitterAvailability entity, so they cannot
            // be included in the EF LINQ .Select projection above. We retrieve them via
            // the existing raw-SQL GetAvailabilityLocations helper and merge by Availability_ID,
            // ensuring the GET endpoint payload carries the saved pin + radius back to the client.
            var coords = GetAvailabilityLocations(result.Select(r => r.Availability_ID).ToList());
            foreach (var row in result)
            {
                if (coords.TryGetValue(row.Availability_ID, out var c))
                {
                    row.Latitude  = c.Latitude;
                    row.Longitude = c.Longitude;
                    row.RadiusKm  = c.RadiusKm;
                }
            }

            return result;
        }

        public int ClearAllAvailability(int sitterId)
        {
            if (sitterId <= 0)
                throw new ArgumentException("Sitter ID must be a positive integer.", nameof(sitterId));

            // Pre-mutation validation ordering (API-B pattern):
            var sitter = _db.Babysitters.FirstOrDefault(b => b.Sitter_ID == sitterId && !b.IsDeleted);
            if (sitter == null)
                throw new ArgumentException("Babysitter not found or inactive.", nameof(sitterId));

            var today = DateTime.Today;
            var toDelete = _db.SitterAvailabilities
                .Where(sa => sa.Sitter_ID == sitterId
                          && !sa.IsDeleted
                          && DbFunctions.TruncateTime(sa.AvailableDate) >= today)
                .ToList();

            string assignedStatus   = JobStatus.Assigned.ToDisplayString();
            string inProgressStatus = JobStatus.InProgress.ToDisplayString();

            var booked = (from j in _db.Jobs
                          join js in _db.JobTimeSlots on j.Job_ID equals js.Job_ID
                          where !j.IsDeleted
                             && j.AssignedSitter_ID == sitterId
                             && (j.Status == assignedStatus || j.Status == inProgressStatus)
                             && js.Slot_ID.HasValue
                          select new { j.Job_ID, JobDate = DbFunctions.TruncateTime(j.JobDate), SlotId = js.Slot_ID.Value })
                         .ToList();

            int deletedCount = 0;
            foreach (var sa in toDelete)
            {
                bool isLocked = booked.Any(b =>
                    b.JobDate?.Date == sa.AvailableDate?.Date &&
                    b.SlotId == sa.Slot_ID);

                if (isLocked)
                    continue;

                sa.IsDeleted = true;
                deletedCount++;
            }

            _db.SaveChanges();
            return deletedCount;
        }

                public Dictionary<int, SitterAvailabilityCoordsDto> GetAvailabilityLocations(IEnumerable<int> availabilityIds)
        {
            var ids = availabilityIds.Distinct().ToList();
            if (!ids.Any())
                return new Dictionary<int, SitterAvailabilityCoordsDto>();

            var pars = ids.Select((id, i) =>
            {
                var p = new System.Data.SqlClient.SqlParameter("@p" + i, id);
                return p;
            }).ToArray();

            var inList = string.Join(",", pars.Select(p => p.ParameterName));
            var sql = "SELECT Availability_ID, Latitude, Longitude, RadiusKm FROM SitterAvailability WHERE Availability_ID IN (" + inList + ")";

            var rows = _db.Database.SqlQuery<SitterAvailabilityCoordsDto>(sql, pars).ToList();
            return rows.ToDictionary(r => r.Availability_ID, r => r);
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


