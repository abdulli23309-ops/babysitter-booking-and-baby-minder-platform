using System;

namespace WebApplication2.DTOs
{
    /// <summary>
    /// GET /api/monitoring/media?jobId=&amp;childId= response.
    ///
    /// DESIGN RULE (Phase 11): the React app must NEVER be handed a provider
    /// secret, and must never decide whether a media session exists. This DTO is
    /// the ONLY thing the browser receives about media, and it is produced by the
    /// server AFTER MonitoringAccess has approved the caller.
    ///
    /// When no media provider is configured, the server still answers 200 with
    /// <see cref="Configured"/> = false and an explicit <see cref="Reason"/>. The
    /// UI then shows an honest "live video unavailable" state. The server never
    /// fabricates a room, and never returns a token it did not sign.
    /// </summary>
    public class MonitoringMediaDto
    {
        /// <summary>
        /// True only when a provider is fully configured AND the server issued a
        /// real session. False means "do not show any video UI".
        /// </summary>
        public bool Configured { get; set; }

        /// <summary>User-facing explanation when <see cref="Configured"/> is false.</summary>
        public string Reason { get; set; }

        /// <summary>Provider host (e.g. "meet.example.com"). Null when not configured.</summary>
        public string Domain { get; set; }

        /// <summary>
        /// Provider room identifier, namespaced with the JaaS AppID and anchored
        /// to this session. It is routing data only, never authorization.
        /// </summary>
        public string RoomName { get; set; }

        /// <summary>
        /// Server-signed provider JWT. Generated ONLY on the server; never stored
        /// in the database, never placed in a URL, never logged.
        /// </summary>
        public string Token { get; set; }

        /// <summary>Server-derived participant role: "publisher" or "viewer".</summary>
        public string Role { get; set; }

        /// <summary>Participant display name shown in the provider UI.</summary>
        public string DisplayName { get; set; }

        /// <summary>False for viewers (sitter/mother): they cannot publish media.</summary>
        public bool CanPublish { get; set; }

        /// <summary>The monitoring session this media session is anchored to.</summary>
        public int MonitorSessionId { get; set; }
    }
}
