using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class CreateJobDto
    {
                public int ParentId { get; set; }
        public int SitterId { get; set; }
        public int ChildId { get; set; }
        public string City { get; set; }
        public DateTime StartDate { get; set; }   // the job date (same as search start date for one-day)
        public string StartTime { get; set; }     // "HH:mm"
        public string EndTime { get; set; }

        // Geo-matching fields (persisted via raw SQL — not part of the EDMX)
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }

        // When true, AllChildIds are processed (one Job per child) instead of just ChildId
        public bool IsForAllChildren { get; set; }

        // List of child IDs to book for when IsForAllChildren = true
        public List<int> AllChildIds { get; set; } = new List<int>();

        public string AvailabilityType { get; set; }     // 'One Day' | 'Repeat Days'
        public string EndDate { get; set; }              // 'YYYY-MM-DD' (only for series)
        public List<string> SelectedDays { get; set; }   // ['Mon','Tue',...]
    }

    public class CreateJobResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int JobId { get; set; }
        public int? JobSeries_ID { get; set; }
        public int SeriesCount { get; set; }   // how many jobs were created
    }

    public class ParentJobSlotTimeDto
    {
        public TimeSpan? StartTime { get; set; }
        public TimeSpan? EndTime { get; set; }
    }

    public class TerminateSeriesDto
    {
        public string Scope { get; set; }   // 'future' | 'all'
    }
}
