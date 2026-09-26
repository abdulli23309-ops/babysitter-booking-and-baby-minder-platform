using System;
using WebApplication2.Enums;

namespace WebApplication2.Infrastructure
{
    public static class EnumExtensions
    {
        public static string ToDisplayString(this JobStatus value)
        {
            switch (value)
            {
                case JobStatus.InProgress:
                    return "In Progress";
                default:
                    return value.ToString();
            }
        }

        public static string ToDisplayString(this BidStatus value)
        {
            return value.ToString();
        }

        public static string ToDisplayString(this UserRole value)
        {
            return value.ToString();
        }

        public static string ToDisplayString(this NotificationType value)
        {
            return value == NotificationType.Unknown ? "" : value.ToString();
        }

        public static string ToDisplayString(this AvailabilityType value)
        {
            switch (value)
            {
                case AvailabilityType.OneDay:
                    return "One Day";
                case AvailabilityType.Recurring:
                    return "Recurring";
                default:
                    return value.ToString();
            }
        }

        public static bool IsTerminal(this JobStatus status)
        {
            return status == JobStatus.Completed || status == JobStatus.Cancelled;
        }

        public static bool IsTerminalJobStatus(string status)
        {
            return string.Equals(status, JobStatus.Completed.ToDisplayString(), StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(status, JobStatus.Cancelled.ToDisplayString(), StringComparison.OrdinalIgnoreCase);
        }

        public static TEnum FromDisplayString<TEnum>(string value) where TEnum : struct
        {
            if (typeof(TEnum) == typeof(JobStatus))
                return (TEnum)(object)ParseJobStatus(value);
            if (typeof(TEnum) == typeof(BidStatus))
                return (TEnum)(object)ParseBidStatus(value);
            if (typeof(TEnum) == typeof(UserRole))
                return (TEnum)(object)ParseUserRole(value);
            if (typeof(TEnum) == typeof(NotificationType))
                return (TEnum)(object)ParseNotificationType(value);
            if (typeof(TEnum) == typeof(AvailabilityType))
                return (TEnum)(object)ParseAvailabilityType(value);

            throw new ArgumentException("Unsupported enum type.", nameof(TEnum));
        }

        private static JobStatus ParseJobStatus(string value)
        {
            if (string.Equals(value, "In Progress", StringComparison.OrdinalIgnoreCase))
                return JobStatus.InProgress;
            JobStatus result;
            if (Enum.TryParse(value, true, out result))
                return result;
            throw new ArgumentException("Invalid job status.", nameof(value));
        }

        private static BidStatus ParseBidStatus(string value)
        {
            BidStatus result;
            if (Enum.TryParse(value, true, out result))
                return result;
            throw new ArgumentException("Invalid bid status.", nameof(value));
        }

        private static UserRole ParseUserRole(string value)
        {
            UserRole result;
            if (Enum.TryParse(value, true, out result))
                return result;
            throw new ArgumentException("Invalid user role.", nameof(value));
        }

        private static NotificationType ParseNotificationType(string value)
        {
            if (string.IsNullOrEmpty(value))
                return NotificationType.Unknown;
            NotificationType result;
            if (Enum.TryParse(value, true, out result))
                return result;
            return NotificationType.Unknown;
        }

        private static AvailabilityType ParseAvailabilityType(string value)
        {
            if (string.Equals(value, "One Day", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "OneDay", StringComparison.OrdinalIgnoreCase))
                return AvailabilityType.OneDay;
            if (string.Equals(value, "repeat", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Recurring", StringComparison.OrdinalIgnoreCase))
                return AvailabilityType.Recurring;
            throw new ArgumentException("Invalid availability type.", nameof(value));
        }
    }
}