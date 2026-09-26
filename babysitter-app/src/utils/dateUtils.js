/**
 * Date helpers — Stage 4 (recurring bookings).
 *
 * Pakistan is UTC+5 (no DST), so the shortcut
 * `new Date().toISOString().slice(0, 10)` reports YESTERDAY for every local
 * time before 05:00. Every date this app sends to the backend (`StartDate` /
 * `EndDate`) is a calendar date in the parent's local timezone, so it has to be
 * built from the local calendar parts never from the UTC clock.
 */

/**
 * The canonical three-letter weekday keys, Monday-first (UI order).
 * The backend's `JobService.ExpandSeriesDates()` accepts these abbreviations
 * as well as full names ('Monday'), case-insensitively.
 */
export const WEEKDAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Today's calendar date in the user's LOCAL timezone, as `YYYY-MM-DD`.
 * Safe to use as the default for a native `<input type="date">`.
 */
export function todayISO() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

/**
 * Shifts a `YYYY-MM-DD` string by whole calendar days and returns the same
 * format. Local-midnight based, so it never drifts across a timezone boundary.
 * Returns '' when the input is missing/unparseable.
 */
export function addDaysISO(isoDate, days) {
  if (!isoDate) return '';
  const base = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return '';
  base.setDate(base.getDate() + Number(days || 0));
  const localMidnight = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
  return localMidnight.toISOString().slice(0, 10);
}

/**
 * Whole calendar days between two `YYYY-MM-DD` strings (`to` minus `from`).
 * Returns NaN when either value is missing/unparseable, and a negative number
 * when `to` precedes `from`.
 *
 * Both values are parsed as local midnight so the DST-free arithmetic cannot
 * drift across a timezone boundary.
 */
export function daysBetweenISO(from, to) {
  if (!from || !to) return NaN;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return NaN;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/**
 * Normalises 'Monday' / 'Mon' / 'MONDAY' / 'mon' to the 3-letter chip key
 * ('Mon'). Returns null when the value is not a recognisable weekday.
 *
 * Exists because `SearchBabySitter` stores FULL day names in
 * `localStorage.lastBookingSearch.SelectedDays`, while the chips in the booking
 * modal are keyed on the 3-letter form.
 */
export function toDayKey(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const short = raw.slice(0, 3);
  return WEEKDAY_KEYS.find((day) => day.toLowerCase() === short) ?? null;
}

/**
 * How many of `dayKeys` fall inside [startISO, endISO], inclusive.
 *
 * Mirrors `JobService.ExpandSeriesDates()` (same inclusive range, same
 * weekday matching) so the booking modal can warn the parent BEFORE the
 * backend rejects the request with "No dates matched the selected weekdays".
 */
export function countSelectedWeekdays(startISO, endISO, dayKeys) {
  if (!startISO || !endISO || !Array.isArray(dayKeys) || dayKeys.length === 0) return 0;

  const span = daysBetweenISO(startISO, endISO);
  if (Number.isNaN(span) || span < 0) return 0;

  const wanted = new Set(dayKeys.map((day) => String(day).slice(0, 3).toLowerCase()));
  const cursor = new Date(`${startISO}T00:00:00`);

  let count = 0;
  // `span` is already bounded by the caller; the extra guard keeps this loop
  // from running away if it is ever called with an unbounded range.
  for (let i = 0; i <= Math.min(span, 365); i += 1) {
    const dayIndex = (cursor.getDay() + 6) % 7; // JS: 0=Sun -> Mon-first index
    if (wanted.has(WEEKDAY_KEYS[dayIndex].toLowerCase())) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Returns a local-calendar YYYY-MM-DD key for an API or user-entered date.
 * Avoids toISOString() for values that represent a calendar date.
 */
export const toLocalDateKey = (input) => {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Formats an API date using the local calendar day rather than UTC. */
export const formatLocalDate = (input, opts = {}) => {
  if (!input) return '';
  return new Date(input).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', ...opts,
  });
};

/**
 * Checks whether the current local time is inside the schedule's grace window.
 * Jobs without a date or slot times remain permissive for legacy compatibility.
 */
/** Returns the user-facing start-window explanation for a scheduled job. */
export const getSessionWindowReason = (job) => {
  if (!job?.JobDate || !Array.isArray(job.SlotTimes) || job.SlotTimes.length === 0) return '';

  const parseHM = (value) => {
    const [h, m] = String(value || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const mins = job.SlotTimes.map((slot) => [parseHM(slot.StartTime), parseHM(slot.EndTime)]);
  const earliest = Math.min(...mins.map(([start]) => start));
  const latest = Math.max(...mins.map(([, end]) => end));
  const formatMins = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const date = new Date(job.JobDate);
  if (Number.isNaN(date.getTime())) return '';
  const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Session window is ${formatMins(earliest)}–${formatMins(latest)} on ${dateLabel}. Available to start within 30 minutes of these times.`;
};

export const isWithinSessionWindow = (job, now = new Date()) => {
  if (!job?.JobDate) return true;
  const slots = Array.isArray(job.SlotTimes) ? job.SlotTimes : [];
  if (slots.length === 0) return true;

  const parseHM = (value) => {
    const [h, m] = String(value || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const mins = slots.map((slot) => [parseHM(slot.StartTime), parseHM(slot.EndTime)]);
  const earliest = Math.min(...mins.map(([start]) => start));
  const latest = Math.max(...mins.map(([, end]) => end));
  const jobDay = new Date(job.JobDate);
  if (Number.isNaN(jobDay.getTime())) return true;
  jobDay.setHours(0, 0, 0, 0);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const sameDay = now.getFullYear() === jobDay.getFullYear()
    && now.getMonth() === jobDay.getMonth()
    && now.getDate() === jobDay.getDate();

  return sameDay && nowMins >= earliest - 30 && nowMins <= latest + 30;
};
