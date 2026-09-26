using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class BulkConfirmDto
    {
        public List<int> JobIds { get; set; }
        public int SitterId { get; set; }
    }
}