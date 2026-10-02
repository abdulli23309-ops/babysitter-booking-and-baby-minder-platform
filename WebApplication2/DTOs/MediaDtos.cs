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
    /// PROVIDER: self-hosted MiroTalk SFU. The browser receives the SFU
    /// address, the server-derived room, and a pre-encoded join path. It
    /// receives NO token and NO signing material: a MiroTalk room is created
    /// implicitly by the first participant to join, so authorisation comes
    /// from Little Care BEFORE these values are ever issued.
    ///
    /// When no media provider is configured, the server still answers 200 with
    /// <see cref="Configured"/> = false and an explicit <see cref="Reason"/>.
    /// The UI then shows an honest "live video unavailable" state. The server
    /// never fabricates a room and never returns an unauthorised session.
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

        /// <summary>
        /// Base address of the MiroTalk SFU, e.g. "https://192.168.1.2:3010".
        /// Browser-reachable and not a secret.
        /// </summary>
        public string ServerUrl { get; set; }

        /// <summary>
        /// Server-derived room identifier, e.g. "lc-i-1042-5d5f4f94". Derived
        /// from the monitoring session id using a keyed digest so it cannot be
        /// guessed. It is ROUTING DATA ONLY and is never authorization on its
        /// own: every request re-runs MonitoringAccess first.
        /// </summary>
        public string RoomId { get; set; }

        /// <summary>
        /// Pre-encoded, server-composed path for the media surface, e.g.
        /// "/join/?room=lc-i-1042-5d5f4f94&amp;name=Parent". The browser uses
        /// ServerUrl + JoinPath as the iframe source. The display name is
        /// URL-encoded HERE, on the server, so the client never builds it.
        /// </summary>
        public string JoinPath { get; set; }

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
