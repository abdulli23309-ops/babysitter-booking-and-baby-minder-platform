using System;
using System.Configuration;
using System.Diagnostics;

namespace WebApplication2.Infrastructure
{
    /// <summary>
    /// Central reader for the session-expiry business rule (Phase 1 Fix F).
    ///
    /// SERVICE RESPONSIBILITY:
    /// Single source of truth for how long a login session (UserSessions row)
    /// remains valid. Every server-side session creation path must use this
    /// class instead of a hardcoded number such as AddDays(7).
    ///
    /// CONFIGURATION:
    /// Reads the "SessionExpiryDays" key from Web.config &lt;appSettings&gt;.
    /// The value there is authoritative: change Web.config, restart the site,
    /// and new sessions use the new lifetime. Existing sessions keep the
    /// expiry that was stamped when they were created.
    ///
    /// USED BY:
    /// AuthController.Login, ParentController.Login, BabySitterController.Login
    /// (all INSERT INTO UserSessions call sites).
    ///
    /// IMPORTANT:
    /// Do not replace this with a hardcoded number and do not create a second
    /// configuration system. If session lifetime must change, edit Web.config.
    /// </summary>
    public static class SessionSettings
    {
        /// <summary>
        /// appSettings key defined in Web.config &lt;appSettings&gt;.
        /// </summary>
        public const string SessionExpiryDaysKey = "SessionExpiryDays";

        /// <summary>
        /// Safety net used only when the appSettings key is missing or is not
        /// a positive integer. Login must never hard-fail because of a config
        /// typo, so the fallback keeps sessions working and a warning is
        /// written to the server trace log instead.
        /// </summary>
        public const int FallbackSessionExpiryDays = 7;

        /// <summary>
        /// Gets the configured number of days a session stays valid.
        /// </summary>
        /// <returns>Positive day count from Web.config, or the fallback.</returns>
        public static int GetSessionExpiryDays()
        {
            string configuredValue = ConfigurationManager.AppSettings[SessionExpiryDaysKey];

            int expiryDays;
            if (int.TryParse(configuredValue, out expiryDays) && expiryDays > 0)
            {
                return expiryDays;
            }

            // EDGE CASE: key missing, empty, zero, negative or non-numeric.
            // Fall back safely and make the problem visible to the operator.
            Trace.TraceWarning(
                "SessionSettings: appSettings '{0}' is missing or invalid (value: {1}). " +
                "Falling back to {2} days. Fix Web.config to change session lifetime.",
                SessionExpiryDaysKey,
                configuredValue ?? "<null>",
                FallbackSessionExpiryDays);

            return FallbackSessionExpiryDays;
        }

        /// <summary>
        /// Computes the UTC expiry timestamp for a session created right now.
        /// </summary>
        /// <remarks>
        /// All session expiry math goes through here so that exactly one place
        /// decides when a session dies. SessionAuthorizeAttribute enforces the
        /// complementary rule: a session is rejected once ExpiresAt &lt;= UtcNow.
        /// </remarks>
        public static DateTime GetSessionExpiryUtc()
        {
            return DateTime.UtcNow.AddDays(GetSessionExpiryDays());
        }
    }
}