using System;
using System.Data;
using System.Data.SqlClient;
using System.Data.Entity;
using System.Linq;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    /// <summary>
    /// Phase 1A - raw-SQL JobSeries data access. Constructed with the SAME
    /// BabySitterBooking_and_BabyMinderEntities instance as the caller, so every
    /// ExecuteSqlCommand/SqlQuery enlists in the caller's Database transaction
    /// (EF6 current-transaction enlistment). This repository NEVER opens its own
    /// context or transaction and NEVER uses NotificationService (which owns a
    /// separate per-call context).
    /// </summary>
    public class JobSeriesRepository : IJobSeriesRepository
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;

        public JobSeriesRepository(BabySitterBooking_and_BabyMinderEntities db)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
        }

        public void Insert(int jobSeriesId, DateTime startDate, DateTime endDate, string weekdayMask,
                           TimeSpan? startTime, TimeSpan? endTime, string status, string clientRequestId)
        {
            _db.Database.ExecuteSqlCommand(
                "INSERT INTO JobSeries (JobSeries_ID, StartDate, EndDate, WeekdayMask, StartTime, EndTime, Status, MaterializedThrough, ClientRequestId) " +
                "VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p2, @p7)",
                new SqlParameter("@p0", SqlDbType.Int) { Value = jobSeriesId },
                new SqlParameter("@p1", SqlDbType.Date) { Value = startDate },
                new SqlParameter("@p2", SqlDbType.Date) { Value = endDate },
                new SqlParameter("@p3", SqlDbType.NVarChar, 64) { Value = weekdayMask },
                new SqlParameter("@p4", SqlDbType.Time) { Value = (object)startTime ?? DBNull.Value },
                new SqlParameter("@p5", SqlDbType.Time) { Value = (object)endTime ?? DBNull.Value },
                new SqlParameter("@p6", SqlDbType.NVarChar, 20) { Value = status },
                new SqlParameter("@p7", SqlDbType.NVarChar, 64)
                {
                    Value = (object)clientRequestId ?? DBNull.Value
                });
        }

        public SeriesLookupRow FindByClientRequestId(string clientRequestId)
        {
            if (string.IsNullOrWhiteSpace(clientRequestId)) return null;
            return _db.Database.SqlQuery<SeriesLookupRow>(
                "SELECT js.JobSeries_ID, js.JobSeries_ID AS HeadJobId, j.Parent_ID AS ParentId, js.StartDate, js.EndDate, " +
                "(SELECT COUNT(1) FROM Job WHERE JobSeries_ID = js.JobSeries_ID AND IsDeleted = 0) AS OccurrenceCount " +
                "FROM JobSeries js JOIN Job j ON j.Job_ID = js.JobSeries_ID " +
                "WHERE js.ClientRequestId = @p0",
                new SqlParameter("@p0", SqlDbType.NVarChar, 64) { Value = clientRequestId })
                .FirstOrDefault();
        }

        public int CountOccurrences(int jobSeriesId)
        {
            return _db.Database.SqlQuery<int>(
                "SELECT COUNT(1) FROM Job WHERE JobSeries_ID = @p0 AND IsDeleted = 0",
                new SqlParameter("@p0", SqlDbType.Int) { Value = jobSeriesId })
                .FirstOrDefault();
        }
    }
}
