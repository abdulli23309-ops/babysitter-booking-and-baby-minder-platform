// Phase 10.0 — Task Allocation ("Today's Required Tasks").
//
// The single frontend catalogue of bookable care tasks. Stable ids are what
// travel in the booking payload and over the API; labels are display-only.
// The ids MUST stay in sync with the server's authoritative catalogue
// (WebApplication2/Infrastructure/AssignedTaskCatalog.cs), which validates
// every incoming list before anything is persisted.

export const AVAILABLE_TASKS = [
  { id: 'bottle-feeding', label: 'Bottle Feeding' },
  { id: 'diaper-change', label: 'Diaper Change' },
  { id: 'stroller-walk', label: 'Stroller Walk' },
  { id: 'put-to-sleep', label: 'Put to Sleep' },
  { id: 'playtime', label: 'Playtime' },
  { id: 'prepare-meals', label: 'Prepare Meals' },
];

const KNOWN_IDS = new Set(AVAILABLE_TASKS.map((task) => task.id));

const LABELS_BY_ID = new Map(AVAILABLE_TASKS.map((task) => [task.id, task.label]));

/** Display label for a known id, or null for anything unknown. */
export function resolveTaskLabel(id) {
  return typeof id === 'string' ? LABELS_BY_ID.get(id) ?? null : null;
}

/**
 * Defensively turns any value into a clean list of known task ids:
 * non-arrays become [], non-string/unknown entries are dropped, duplicates
 * are removed. Used both before submitting a booking and when reading a job
 * back from the API, so malformed data can never break a screen.
 */
export function normalizeTaskIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim().toLowerCase();
    if (!KNOWN_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Resolves a raw API task list into [{ id, label }] for rendering.
 * Returns [] for undefined/null/malformed payloads (older jobs, missing
 * fields), so historical bookings simply render the empty state.
 */
export function resolveAssignedTasks(value) {
  return normalizeTaskIds(value)
    .map((id) => ({ id, label: LABELS_BY_ID.get(id) }))
    .filter((task) => Boolean(task.label));
}
