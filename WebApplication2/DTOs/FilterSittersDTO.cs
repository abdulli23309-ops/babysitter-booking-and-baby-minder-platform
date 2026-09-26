using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class FilterSittersDTO
    {
        public int JobId { get; set; }

        public decimal? MinRating { get; set; }
        public int? MinExperience { get; set; }

        public List<int> SlotIds { get; set; }   // from grid
        public DateTime? Date { get; set; } // selected date

        public string City { get; set; } = string.Empty;
    }
}