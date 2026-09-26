using System;
using System.Linq;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    public class CryAlertService : ICryAlertService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public CryAlertService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public CryAlertService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        public CryAlertResultDto PostCryAlert(CryAlertDto dto, int currentUserId, string currentRole)
        {
            if (dto == null)
                throw new ArgumentNullException(nameof(dto));
            if (dto.ParentId <= 0 || dto.BabysitterId <= 0 || dto.JobId <= 0)
                throw new ArgumentException("ParentId, BabysitterId, and JobId must be positive integers.");
            if (string.IsNullOrWhiteSpace(dto.Level))
                throw new ArgumentException("Level is required.");
            if (dto.Level.Length > 50)
                throw new ArgumentException("Level must not exceed 50 characters.");
            if (string.IsNullOrWhiteSpace(dto.Timestamp) || !DateTime.TryParse(dto.Timestamp, out DateTime _))
                throw new ArgumentException("A valid Timestamp is required.");

            bool isInvolved =
                (currentRole == UserRole.Parent.ToDisplayString() && dto.ParentId == currentUserId) ||
                (currentRole == UserRole.Sitter.ToDisplayString() && dto.BabysitterId == currentUserId);
            if (!isInvolved)
                throw new UnauthorizedAccessException("You can only raise alerts for your own bookings.");

            string roomName = $"baby-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid().ToString("N").Substring(0, 6)}";

            var alert = new CryAlert
            {
                Id = Guid.NewGuid(),
                Timestamp = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
                Level = dto.Level.Trim(),
                RoomName = roomName,
                JobId = dto.JobId,
                ParentId = dto.ParentId,
                BabysitterId = dto.BabysitterId,
                IsDeleted = false
            };

            _db.CryAlerts.Add(alert);
            _db.SaveChanges();

            return new CryAlertResultDto
            {
                RoomName = roomName,
                Message = "Alert received"
            };
        }

        public LatestCryAlertDto GetLatestAlert(int currentUserId, string currentRole, int? parentId)
        {
            if (parentId.HasValue && parentId.Value <= 0)
                throw new ArgumentException("Parent ID must be a positive integer.");

            if (currentRole == UserRole.Parent.ToDisplayString())
            {
                if (parentId.HasValue && parentId.Value != currentUserId)
                    throw new UnauthorizedAccessException("You can only view your own alerts.");
                parentId = currentUserId;
            }

            var query = _db.CryAlerts.Where(a => !a.IsDeleted);

            if (currentRole == UserRole.Parent.ToDisplayString())
            {
                query = query.Where(a => a.ParentId == currentUserId);
            }
            else if (currentRole == UserRole.Sitter.ToDisplayString())
            {
                query = query.Where(a => a.BabysitterId == currentUserId);
            }
            else if (parentId.HasValue)
            {
                query = query.Where(a => a.ParentId == parentId.Value);
            }

            var alert = query
                .OrderByDescending(a => a.Timestamp)
                .FirstOrDefault();

            if (alert == null)
                return null;

            return new LatestCryAlertDto
            {
                Id = alert.Id,
                Timestamp = alert.Timestamp.ToString("o"),
                RoomName = alert.RoomName,
                Level = alert.Level,
                JobId = alert.JobId,
                ParentId = alert.ParentId,
                BabysitterId = alert.BabysitterId
            };
        }

        public void Dispose()
        {
            if (_ownsContext)
            {
                _db.Dispose();
            }
        }
    }
}
