using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    

    public class UpdateChildDto
    {
        public string ChildName { get; set; }
        public string DOB { get; set; }
        public string Gender { get; set; }
        public string SpecialRequirements { get; set; }
        public string SpecialNote { get; set; }
        public string PictureAddress { get; set; }
        public string GuardianName { get; set; }
        public string GuardianRelation { get; set; }
        public string GuardianContact { get; set; }
    }
}