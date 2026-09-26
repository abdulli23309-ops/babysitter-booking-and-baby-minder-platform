using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class SearchSittersDTO
    {
        public string City { get; set; }
        public int MinRating { get; set; }
        public int? MinExperienceYears { get; set; }
        public string StartDate { get; set; }
        public string EndDate { get; set; }
        public string StartTime { get; set; }
        public string EndTime { get; set; }

                public List<string> SelectedDays { get; set; }
        public string AvailabilityType { get; set; }
        public bool EnableFallback { get; set; } = false;

        // Geo-matching fields
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
    }
}