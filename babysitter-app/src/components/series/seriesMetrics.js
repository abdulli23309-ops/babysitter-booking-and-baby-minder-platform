/**
 * Phase 7.3 — pure series math for the "Contract Overview" block.
 *
 * Deliberately kept out of the component file: it is a plain, dependency-light
 * module of pure functions, which (a) satisfies the repo's
 * react-refresh/only-export-components rule and (b) makes every derivation
 * directly unit-testable without rendering.
 *
 * What the API ships today (GET /api/parent/job/{id} and
 * GET /api/jobs/jobdetails/{id}): JobSeries_ID, SeriesOccurrenceIndex,
 * SeriesTotalCount, SeriesTotalPayment, SeriesStartDate, SeriesEndDate,
 * and SeriesDays.
 */
import { WEEKDAY_KEYS, toDayKey } from '../../utils/dateUtils';

const round1 = (value) => Math.round(value * 10) / 10;

const toPositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/** "08:00" / "08:00:00" / "8:00 AM" -> decimal hours, or null if unparseable. */
const toDecimalHours = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const withMeridiem = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (withMeridiem) {
    const hour24 = (Number(withMeridiem[1]) % 12) + (withMeridiem[3].toUpperCase() === 'PM' ? 12 : 0);
    return hour24 + Number(withMeridiem[2]) / 60;
  }

  const plain = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!plain) return null;
  const hour = Number(plain[1]);
  const minute = Number(plain[2]);
  if (hour > 23 || minute > 59) return null;
  return hour + minute / 60;
};

/**
 * Length of ONE slot in hours. An end earlier than the start is treated as
 * an overnight window (22:00 -> 02:00 = 4h) rather than a negative duration,
 * so a late-night slot can never subtract from the daily total.
 */
const slotDurationHours = (start, end) => {
  const from = toDecimalHours(start);
  const to = toDecimalHours(end);
  if (from == null || to == null) return null;
  const diff = to - from;
  return diff >= 0 ? diff : diff + 24;
};

/**
 * Total committed hours for ONE session day: the sum of every SlotTimes[]
 * entry, falling back to the legacy flat StartTime/EndTime pair.
 * Returns null when no usable time data exists (the UI then shows "—").
 */
export const getHoursPerDay = (job) => {
  const rawSlots = Array.isArray(job?.SlotTimes)
    ? job.SlotTimes
    : Array.isArray(job?.slotTimes)
      ? job.slotTimes
      : null;

  const durations =
    rawSlots && rawSlots.length > 0
      ? rawSlots.map((slot) => slotDurationHours(slot?.StartTime ?? slot?.startTime, slot?.EndTime ?? slot?.endTime))
      : [slotDurationHours(job?.StartTime, job?.EndTime)];

  const usable = durations.filter((hours) => hours != null && hours > 0);
  if (usable.length === 0) return null;
  return round1(usable.reduce((sum, hours) => sum + hours, 0));
};

/**
 * Weekdays of the contract, normalised to the canonical Monday-first keys.
 * SeriesDays is the API field; the aliases keep this helper compatible with
 * older or alternate job payloads.
 */
export const getSeriesDays = (job) => {
  const candidates = [
    job?.SeriesDays,
    job?.SelectedDays,
    job?.RepeatDays,
    job?.RecurringDays,
    job?.SeriesWeekDays,
  ];

  for (const candidate of candidates) {
    const list = Array.isArray(candidate)
      ? candidate
      : typeof candidate === 'string'
        ? candidate.split(',')
        : [];
    const keys = list.map((day) => toDayKey(day)).filter(Boolean);
    if (keys.length > 0) {
      const wanted = new Set(keys);
      return WEEKDAY_KEYS.filter((day) => wanted.has(day));
    }
  }
  return [];
};

/** "23 Oct 2026" — manual YYYY-MM-DD parse so no UTC day-shift occurs. */
const formatShortDate = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parsed = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getSeriesRange = (job) => {
  const start = formatShortDate(job?.SeriesStartDate ?? job?.Series_StartDate ?? job?.SeriesStart);
  const end = formatShortDate(job?.SeriesEndDate ?? job?.Series_EndDate ?? job?.SeriesEnd);
  if (start && end) return start === end ? start : `${start} – ${end}`;
  return null;
};

/**
 * A job belongs to a contract when the API gives it a series id, or when it
 * reports more than one occurrence. Everything else returns null, which is
 * what keeps the whole block hidden for single-day bookings.
 */
export const getSeriesMetrics = (job) => {
  if (!job) return null;
  const seriesId = job.JobSeries_ID ?? job.jobSeriesId;
  const totalCount = toPositiveInt(job.SeriesTotalCount ?? job.seriesTotalCount);
  if (seriesId == null && !(totalCount != null && totalCount > 1)) return null;

  const hoursPerDay = getHoursPerDay(job);
  return {
    totalCount,
    occurrenceIndex: toPositiveInt(job.SeriesOccurrenceIndex ?? job.seriesOccurrenceIndex),
    hoursPerDay,
    // Math: a contract of N days at H hours/day commits N x H hours.
    totalHours: hoursPerDay != null && totalCount != null ? round1(hoursPerDay * totalCount) : null,
    days: getSeriesDays(job),
    range: getSeriesRange(job),
  };
};
