// DTOs/CryAlertDto.cs
using System;

namespace WebApplication2.DTOs
{
    public class CryAlertDto
    {
        public string Timestamp { get; set; }
        public string Level { get; set; }
        public int? JobId { get; set; }
        public int? ParentId { get; set; }
        public int? BabysitterId { get; set; }
    }

    // This class matches the DB row
    public class CryAlertRecord
    {
        public Guid Id { get; set; }
        public DateTime Timestamp { get; set; }
        public string Level { get; set; }
        public string RoomName { get; set; }
        public int? JobId { get; set; }
        public int? ParentId { get; set; }
        public int? BabysitterId { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class CryAlertResultDto
    {
        public string RoomName { get; set; }
        public string Message { get; set; }
    }

    public class LatestCryAlertDto
    {
        public Guid Id { get; set; }
        public string Timestamp { get; set; }
        public string RoomName { get; set; }
        public string Level { get; set; }
        public int? JobId { get; set; }
        public int? ParentId { get; set; }
        public int? BabysitterId { get; set; }
    }
}
