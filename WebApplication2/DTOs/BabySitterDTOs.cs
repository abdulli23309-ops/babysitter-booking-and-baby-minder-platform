using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace WebApplication2.DTOs
{
    public class BabysitterRegistrationDTO
    {
        public string FullName { get; set; }
        public string EmailAddress { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }
        public string PhoneNumber { get; set; }
        public DateTime DOB { get; set; }
        public int ExperienceYears { get; set; }
        public decimal HourlyRate { get; set; }
        public string PictureAddress { get; set; }
    }

    public class LoginDTO
    {
        public string Username { get; set; }
        public string Password { get; set; }
        public string Role { get; set; }

    }


    public class SitterEarningsDto
    {
        public decimal totalEarnings { get; set; }
        public int completedJobs { get; set; }
        public int totalHours { get; set; }
        public List<SitterRecentPaymentDto> recentPayments { get; set; }
    }

    public class SitterRecentPaymentDto
    {
        public string parentName { get; set; }
        public decimal? amount { get; set; }
        public string date { get; set; }
    }

    /// <summary>
    /// Additive DTO for the sitter self-update endpoint (PUT api/babysitter/update/{sitterId}).
    /// Only existing Babysitter columns are represented. Password / IsDeleted / Sitter_ID
    /// are intentionally excluded from updates.
    /// </summary>
    public class UpdateSitterDto
    {
        public string FullName { get; set; }
        public string EmailAddress { get; set; }
        public string Username { get; set; }
        public string PhoneNumber { get; set; }
        public string PictureAddress { get; set; }
        public DateTime? DOB { get; set; }
        public int? ExperienceYears { get; set; }
        public decimal? HourlyRate { get; set; }
    }
}