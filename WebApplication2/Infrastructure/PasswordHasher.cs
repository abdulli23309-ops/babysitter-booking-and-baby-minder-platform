using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using WebApplication2.Enums;
using WebApplication2.Models;

namespace WebApplication2.Infrastructure
{
    public class PasswordVerificationResult
    {
        public bool IsValid { get; }
        public bool NeedsUpgrade { get; }

        public PasswordVerificationResult(bool isValid, bool needsUpgrade)
        {
            IsValid = isValid;
            NeedsUpgrade = isValid && needsUpgrade;
        }

        public static PasswordVerificationResult Failed => new PasswordVerificationResult(false, false);
        public static PasswordVerificationResult Success => new PasswordVerificationResult(true, false);
        public static PasswordVerificationResult SuccessNeedsUpgrade => new PasswordVerificationResult(true, true);
    }

    public static class PasswordHasher
    {
        /// <summary>
        /// Hashes a plain text password using BCrypt.
        /// </summary>
        public static string HashPassword(string plainPassword)
        {
            return BCrypt.Net.BCrypt.HashPassword(plainPassword ?? string.Empty);
        }

        /// <summary>
        /// Verifies a password against a stored hash with support for:
        /// 1. BCrypt hashes (starting with $2)
        /// 2. Legacy SHA-256 hashes (Base64 44-char or hex 64-char) -> flags NeedsUpgrade
        /// 3. Legacy plaintext passwords -> flags NeedsUpgrade
        /// </summary>
        public static PasswordVerificationResult VerifyPassword(string plainPassword, string storedHash)
        {
            if (string.IsNullOrEmpty(storedHash))
                return PasswordVerificationResult.Failed;

            string candidate = plainPassword ?? string.Empty;

            // 1. Stored hash starts with $2 -> BCrypt
            if (storedHash.StartsWith("$2"))
            {
                try
                {
                    bool matches = BCrypt.Net.BCrypt.Verify(candidate, storedHash);
                    return matches ? PasswordVerificationResult.Success : PasswordVerificationResult.Failed;
                }
                catch
                {
                    return PasswordVerificationResult.Failed;
                }
            }

            // 2. Legacy SHA-256 (Base64 44-char)
            string base64Sha = ComputeSha256Base64(candidate);
            if (string.Equals(storedHash, base64Sha, StringComparison.Ordinal))
            {
                return PasswordVerificationResult.SuccessNeedsUpgrade;
            }

            // Legacy SHA-256 (Hex 64-char)
            string hexSha = ComputeSha256Hex(candidate);
            if (string.Equals(storedHash, hexSha, StringComparison.OrdinalIgnoreCase))
            {
                return PasswordVerificationResult.SuccessNeedsUpgrade;
            }

            // 3. Legacy plaintext fallback
            if (string.Equals(storedHash, candidate, StringComparison.Ordinal))
            {
                return PasswordVerificationResult.SuccessNeedsUpgrade;
            }

            return PasswordVerificationResult.Failed;
        }

        /// <summary>
        /// Updates the stored password for the given user and role to a new BCrypt hash.
        /// </summary>
        public static bool UpgradePassword(int userId, string role, string newBcryptHash)
        {
            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            {
                return UpgradePassword(db, userId, role, newBcryptHash);
            }
        }

        /// <summary>
        /// Updates the stored password for the given user and role within an existing DbContext.
        /// </summary>
        public static bool UpgradePassword(BabySitterBooking_and_BabyMinderEntities db, int userId, string role, string newBcryptHash)
        {
            if (db == null || userId <= 0 || string.IsNullOrWhiteSpace(role) || string.IsNullOrWhiteSpace(newBcryptHash))
                return false;

            if (string.Equals(role, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                var parent = db.Parents.FirstOrDefault(p => p.Parent_ID == userId && !p.IsDeleted);
                if (parent != null)
                {
                    parent.Password = newBcryptHash;
                    db.SaveChanges();
                    return true;
                }
            }
            else if (string.Equals(role, UserRole.Sitter.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
            {
                var sitter = db.Babysitters.FirstOrDefault(s => s.Sitter_ID == userId && !s.IsDeleted);
                if (sitter != null)
                {
                    sitter.Password = newBcryptHash;
                    db.SaveChanges();
                    return true;
                }
            }

            return false;
        }

        private static string ComputeSha256Base64(string input)
        {
            using (var sha256 = SHA256.Create())
            {
                var hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(input));
                return Convert.ToBase64String(hashBytes);
            }
        }

        private static string ComputeSha256Hex(string input)
        {
            using (var sha256 = SHA256.Create())
            {
                var hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(input));
                var sb = new StringBuilder(hashBytes.Length * 2);
                foreach (byte b in hashBytes)
                {
                    sb.Append(b.ToString("x2"));
                }
                return sb.ToString();
            }
        }
    }
}
