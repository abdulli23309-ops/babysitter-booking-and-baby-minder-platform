using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Web.Http;

namespace WebApplication2.Infrastructure
{
    public static class ValidationHelper
    {
        public static HttpResponseException ValidateNotNull(object value, string message = "Request body is required.")
        {
            if (value == null)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, message));
            return null;
        }

        public static HttpResponseException ValidateRequiredString(string value, string fieldName, int maxLength = 0)
        {
            if (string.IsNullOrWhiteSpace(value))
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} is required."));
            if (maxLength > 0 && value.Length > maxLength)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} must not exceed {maxLength} characters."));
            return null;
        }

        public static HttpResponseException ValidateMaxLength(string value, string fieldName, int maxLength)
        {
            if (value != null && value.Length > maxLength)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} must not exceed {maxLength} characters."));
            return null;
        }

        public static HttpResponseException ValidateId(int id, string fieldName = "ID")
        {
            if (id <= 0)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} must be a valid positive number."));
            return null;
        }

        public static HttpResponseException ValidateCollectionNotNullOrEmpty<T>(ICollection<T> collection, string fieldName)
        {
            if (collection == null || collection.Count == 0)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} is required and must not be empty."));
            return null;
        }

        public static HttpResponseException ValidateRange(int value, int min, int max, string fieldName)
        {
            if (value < min || value > max)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} must be between {min} and {max}."));
            return null;
        }

        public static HttpResponseException ValidateRange(decimal value, decimal min, decimal max, string fieldName)
        {
            if (value < min || value > max)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} must be between {min} and {max}."));
            return null;
        }

        public static HttpResponseException ValidateNotPastDate(DateTime date, string fieldName)
        {
            if (date.Date < DateTime.UtcNow.Date)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} cannot be in the past."));
            return null;
        }

        public static HttpResponseException ValidateNotFutureDate(DateTime date, string fieldName)
        {
            if (date.Date > DateTime.UtcNow.Date)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} cannot be in the future."));
            return null;
        }

        public static HttpResponseException ValidateTimeRange(DateTime start, DateTime end)
        {
            if (start >= end)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, "Start time must be before end time."));
            return null;
        }

        public static HttpResponseException ValidateRole(string role, params string[] allowedRoles)
        {
            if (string.IsNullOrWhiteSpace(role))
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, "Role is required."));
            if (!allowedRoles.Contains(role, StringComparer.OrdinalIgnoreCase))
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"Invalid role. Allowed roles: {string.Join(", ", allowedRoles)}."));
            return null;
        }

        public static HttpResponseException ValidateEmail(string email, string fieldName = "Email")
        {
            if (string.IsNullOrWhiteSpace(email))
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} is required."));
            try
            {
                var addr = new System.Net.Mail.MailAddress(email);
                if (addr.Address != email)
                    return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} format is invalid."));
            }
            catch
            {
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, $"{fieldName} format is invalid."));
            }
            return null;
        }

        public static HttpResponseException ValidatePassword(string password)
        {
            if (string.IsNullOrWhiteSpace(password))
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, "Password is required."));
            if (password.Length > 256)
                return new HttpResponseException(Request(HttpStatusCode.BadRequest, "Password must not exceed 256 characters."));
            return null;
        }

        public static (bool IsValid, string ErrorMessage) ValidateLoginInput(string username, string password, string role, string expectedRole)
        {
            if (string.IsNullOrWhiteSpace(username))
                return (false, "Username is required.");
            if (username.Length > 150)
                return (false, "Username must not exceed 150 characters.");
            if (string.IsNullOrWhiteSpace(password))
                return (false, "Password is required.");
            if (password.Length > 256)
                return (false, "Password must not exceed 256 characters.");
            if (!string.IsNullOrEmpty(role) && !string.Equals(role, expectedRole, StringComparison.OrdinalIgnoreCase))
                return (false, $"Invalid role. Expected '{expectedRole}'.");
            return (true, null);
        }

        public static HttpResponseMessage Request(HttpStatusCode status, string message)
        {
            return new HttpResponseMessage(status)
            {
                Content = new StringContent($"{{\"message\":\"{message}\"}}", System.Text.Encoding.UTF8, "application/json")
            };
        }

        public static void ThrowIfError(this HttpResponseException ex)
        {
            if (ex != null)
                throw ex;
        }
    }
}
