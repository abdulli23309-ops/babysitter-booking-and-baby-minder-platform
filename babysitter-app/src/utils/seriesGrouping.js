export const groupJobsBySeries = (jobs) => {
  if (!Array.isArray(jobs)) return [];

  const groups = new Map();
  const order = [];

  for (const job of jobs) {
    const sid = job?.JobSeries_ID;
    if (sid == null) {
      // single-day job -> keep as its own card
      order.push({ type: 'single', job });
      continue;
    }
    if (!groups.has(sid)) {
      groups.set(sid, []);
      order.push({ type: 'series', seriesId: sid }); // placeholder
    }
    groups.get(sid).push(job);
  }

  return order.map((entry) => {
    if (entry.type === 'single') return entry;
    const siblings = groups.get(entry.seriesId) ?? [];
    
    // Sort siblings by SeriesOccurrenceIndex for the drill-down
    siblings.sort((a, b) => (a.SeriesOccurrenceIndex || 0) - (b.SeriesOccurrenceIndex || 0));

    return {
      type: 'series',
      seriesId: entry.seriesId,
      jobs: siblings,
      anchor: siblings[0],                       // first job in input order
      aggregate: summarizeSeries(siblings),
    };
  });
};

// Derive display-level facts from N sibling jobs.
const summarizeSeries = (siblings) => {
  // dates
  const dates = siblings
    .map(j => j.JobDate ? new Date(j.JobDate).getTime() : null)
    .filter(t => t != null);
  const startDate = dates.length ? new Date(Math.min(...dates)) : null;
  const endDate   = dates.length ? new Date(Math.max(...dates)) : null;

  // total: prefer SeriesTotalCount / SeriesTotalPayment from any sibling
  const sample = siblings[0] ?? {};
  const totalCount = sample.SeriesTotalCount ?? siblings.length;
  const totalPayment = sample.SeriesTotalPayment ??
    siblings.reduce((s, j) => s + (Number(j.Payment) || 0), 0);
  const perDayPayment = sample.Payment ?? null;

  // status rollup: highest-priority state wins
  const statuses = siblings.map(j => (j.Status || '').toLowerCase());
  let status;
  if (statuses.some(s => s.includes('progress')))      status = 'In Progress';
  else if (statuses.some(s => s.includes('arrived')))  status = 'In Progress';
  else if (statuses.some(s => s.includes('assigned'))) status = 'Assigned';
  else if (statuses.every(s => s.includes('completed'))) status = 'Completed';
  else if (statuses.every(s => s.includes('cancelled'))) status = 'Cancelled';
  else if (statuses.every(s => s.includes('open')))    status = 'Open';
  else status = 'Mixed';

  // children (should be identical across siblings, take from any)
  const children = sample.Children ?? sample.children ?? [];

  // time window
  const slotTimes = sample.SlotTimes ?? [];
  const firstSlot = slotTimes[0];
  const lastSlot  = slotTimes[slotTimes.length - 1];
  const timeLabel = firstSlot && lastSlot
    ? `${String(firstSlot.StartTime || '').slice(0,5)}—${String(lastSlot.EndTime || '').slice(0,5)}`
    : (sample.StartTime || sample.EndTime
        ? `${String(sample.StartTime || '').slice(0,5)}—${String(sample.EndTime || '').slice(0,5)}`
        : null);

  return { startDate, endDate, totalCount, totalPayment, perDayPayment,
           status, children, timeLabel };
};

// Is this sibling already done (terminal state)? Terminal siblings never
// qualify as the "next" session.
const isTerminalStatus = (job) => {
  const s = (job?.Status || '').toString().toLowerCase();
  return s.includes('completed') || s.includes('cancelled') || s.includes('canceled');
};

/**
 * The NEXT session of a series — shared by the parent MyJobs screen and the
 * sitter BabysitterMyJobs screen so both highlight block derive it identically.
 *
 * Rule: the smallest JobDate on/after today among siblings that are NOT
 * Completed / Cancelled. If every remaining sibling is past-dated, fall back to
 * the smallest JobDate that is still Open / Assigned. Returns null when the
 * whole series is terminal (no highlight block is rendered in that case).
 */
export const getNextSession = (siblings, now = new Date()) => {
  if (!Array.isArray(siblings) || siblings.length === 0) return null;

  const pending = siblings.filter((job) => !isTerminalStatus(job));
  if (pending.length === 0) return null;

  const timed = pending
    .map((job) => ({ job, time: job?.JobDate ? new Date(job.JobDate).getTime() : null }))
    .filter((entry) => entry.time != null && !Number.isNaN(entry.time));

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const upcoming = timed
    .filter((entry) => entry.time >= today.getTime())
    .sort((a, b) => a.time - b.time);
  if (upcoming.length > 0) return upcoming[0].job;

  const pastDated = [...timed].sort((a, b) => a.time - b.time);
  if (pastDated.length > 0) return pastDated[0].job;

  // No usable dates on any sibling — still surface the first pending day.
  return pending[0];
};

// Human-friendly status label used by the parent Open tab.
export const seriesStatusLabel = (group) => {
  const jobs = group?.jobs ?? [];
  const sts = jobs.map(j => String(j.Status || '').toLowerCase());
  if (sts.length === 0) return 'Open';
  if (sts.every(s => s === 'completed')) return 'Completed';
  if (sts.every(s => s === 'cancelled' || s === 'canceled'))
    return 'Cancelled';

  const hasActive = sts.some(s =>
    s === 'in progress' || s === 'sitterarrived');
  const hasCompleted = sts.some(s => s === 'completed');
  const hasAssigned = sts.some(s => s === 'assigned');
  const hasOpen = sts.some(s => s === 'open');

  if (hasActive) return 'In progress';
  if (hasCompleted && (hasOpen || hasAssigned)) return 'In progress';
  if (hasCompleted && !hasOpen && !hasAssigned) return 'Completed';
  if (hasAssigned) return 'Assigned';
  if (hasOpen) return 'Awaiting sitter';
  // Nothing has been claimed yet: every day is still an open invitation, so the
  // series is waiting on a sitter — not a genuinely "Mixed" state.
  const awaitingSet = new Set(['invited', 'open', 'pending']);
  if (sts.length > 0 && sts.every(s => awaitingSet.has(s))) return 'Awaiting sitter';
  return 'Mixed';
};


