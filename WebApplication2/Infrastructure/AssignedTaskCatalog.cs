using System;
using System.Collections.Generic;
using System.Linq;

namespace WebApplication2.Infrastructure
{
    /// <summary>
    /// Phase 10.0 — the single authoritative catalogue of bookable care tasks
    /// ("Today's Required Tasks"). The browser is never trusted: every incoming
    /// list is validated against these stable identifiers before anything is
    /// persisted, duplicates are removed, and null/empty input is handled safely.
    ///
    /// The identifiers MUST stay in sync with the frontend display catalogue
    /// (babysitter-app/src/utils/assignedTasks.js). Labels live only on the
    /// frontend; the server stores and returns identifiers.
    /// </summary>
    public static class AssignedTaskCatalog
    {
        /// <summary>
        /// Canonical, ordered list of allowed task identifiers.
        /// </summary>
        public static readonly IReadOnlyList<string> AllowedIds = new[]
        {
            "bottle-feeding",
            "diaper-change",
            "stroller-walk",
            "put-to-sleep",
            "playtime",
            "prepare-meals"
        };

        /// <summary>
        /// Validates and normalizes an incoming task list.
        /// - null / empty input  -> empty list (zero tasks is a valid booking)
        /// - null or blank entries are skipped safely
        /// - surrounding whitespace and casing are normalized
        /// - duplicates are removed (first occurrence wins, order preserved)
        /// - UNKNOWN identifiers are rejected with ArgumentException so a
        ///   forged payload can never persist an arbitrary task name
        /// </summary>
        public static List<string> Normalize(IEnumerable<string> requested)
        {
            var normalized = new List<string>();
            if (requested == null)
                return normalized;

            foreach (var raw in requested)
            {
                if (raw == null)
                    continue;

                var id = raw.Trim().ToLowerInvariant();
                if (id.Length == 0)
                    continue;

                if (!AllowedIds.Contains(id))
                    throw new ArgumentException(
                        "Unknown task identifier: '" + raw.Trim() + "'. Valid tasks are: " +
                        string.Join(", ", AllowedIds) + ".");

                if (!normalized.Contains(id))
                    normalized.Add(id);
            }

            return normalized;
        }

        /// <summary>
        /// Deserializes the stored representation back into a task list.
        /// NULL (historical jobs), empty, or malformed values all degrade to an
        /// empty list so legacy bookings keep opening normally.
        /// </summary>
        public static List<string> Deserialize(string storedValue)
        {
            if (string.IsNullOrWhiteSpace(storedValue))
                return new List<string>();

            try
            {
                var parsed = Newtonsoft.Json.JsonConvert.DeserializeObject<List<string>>(storedValue);
                return parsed == null
                    ? new List<string>()
                    : parsed.Where(id => !string.IsNullOrWhiteSpace(id)).ToList();
            }
            catch (Newtonsoft.Json.JsonException)
            {
                // Corrupt or hand-edited data must never break the active-job screen.
                return new List<string>();
            }
        }
    }
}