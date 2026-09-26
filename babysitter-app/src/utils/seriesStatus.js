// Phase 8c: one review per SERIES rather than one per day.
//
// A series is TERMINAL when every sibling is Completed / Cancelled / Canceled,
// OR is past its date. A past-dated Open/Assigned day can never resolve — the
// date has passed — so counting it as blocking would strand the series' reviews
// forever. That is the realistic case: a sitter declines a day, the parent never
// books a replacement, and the series ends with one permanently Open sibling.
//
// This mirrors the backend's IsSeriesTerminal() in ReviewService, including its
// use of today-in-Pakistan-time as the boundary. The DB server clock is already
// Pakistan local, so plain local-midnight here agrees with GETDATE() there.
export const isSeriesTerminal = (job, siblings) => {
  const TERMINAL = new Set(['completed', 'cancelled', 'canceled']);
  const jobIsTerminal = () => TERMINAL.has(String(job?.Status || '').toLowerCase());

  // Single-day job, or no series id: fall back to this day's own status.
  if (!job?.JobSeries_ID) return jobIsTerminal();

  // No sibling data available — we cannot prove the series is finished, so
  // treat the current day as the only evidence we have.
  if (!Array.isArray(siblings) || siblings.length === 0) return jobIsTerminal();

  // Local midnight today; JobDate is a date-only column, so comparing
  // date-only values avoids a same-day "not yet finished" false positive.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return siblings.every((s) => {
    const st = String(s?.Status || '').toLowerCase();
    if (TERMINAL.has(st)) return true;

    // Not terminal — does it still have a chance to run?
    if (!s?.JobDate) return false;
    const d = new Date(s.JobDate);
    if (Number.isNaN(d.getTime())) return false;
    d.setHours(0, 0, 0, 0);
    return d.getTime() < today.getTime();
  });
};
