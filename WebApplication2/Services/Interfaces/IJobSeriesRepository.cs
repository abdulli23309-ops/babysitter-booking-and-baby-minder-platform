using System;

namespace WebApplication2.Services.Interfaces
{
    /// <summary>
    /// Phase 1A - typed, parameterized raw-SQL data access for the JobSeries
    /// rule table (the table lives outside the frozen EDMX, same precedent as
    /// JobChildren / JobInvitation / Job.AssignedTasks). Every method runs on
    /// the CALLER'S context so statements enlist in the caller's transaction;
    /// the repository never opens its own context or transaction.
    /// </summary>
    public interface IJobSeriesRepository
    {
        /// <summary>Inserts the series rule row. Throws on duplicate ClientRequestId (2601).</summary>
        void Insert(int jobSeriesId, DateTime startDate, DateTime endDate, string weekdayMask,
                    TimeSpan? startTime, TimeSpan? endTime, string status, string clientRequestId);

        /// <summary>Returns the committed series head for a ClientRequestId, or null.</summary>
        SeriesLookupRow FindByClientRequestId(string clientRequestId);

        /// <summary>Counts materialized occurrences of a series (integrity checks).</summary>
        int CountOccurrences(int jobSeriesId);
    }

    /// <summary>Row projection for raw-SQL lookups (outside the EDMX).</summary>
    public class SeriesLookupRow
    {
        public int JobSeries_ID { get; set; }
        public int HeadJobId { get; set; }
        public int ParentId { get; set; }
        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }
        public int OccurrenceCount { get; set; }
    }
}