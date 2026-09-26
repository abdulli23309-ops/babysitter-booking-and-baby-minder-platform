using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class CreateChildDto
    {
        public int ParentId { get; set; }
        public string ChildName { get; set; }
        public DateTime DOB { get; set; }
        public string Gender { get; set; }
        public string SpecialRequirements { get; set; }
        public string SpecialNote { get; set; }
        public string PictureAddress { get; set; }
        public string GuardianName { get; set; }
        public string GuardianRelation { get; set; }
        public string GuardianContact { get; set; }
    }

    public class ChildDto
    {
        public int Child_ID { get; set; }
        public int? Parent_ID { get; set; }
        public string ChildName { get; set; }
        public DateTime? DOB { get; set; }
        public string Gender { get; set; }
        public string SpecialRequirements { get; set; }
        public string SpecialNote { get; set; }
        public string PictureAddress { get; set; }
        public string GuardianName { get; set; }
        public string GuardianRelation { get; set; }
        public string GuardianContact { get; set; }
    }

    public class ChildOperationResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int ChildId { get; set; }
    }
}