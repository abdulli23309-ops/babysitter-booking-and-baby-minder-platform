import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNextSession } from '../../utils/seriesGrouping';
import { formatLocalDate } from '../../utils/dateUtils';
import styles from './my-jobs.module.css';

const formatChildrenShort = (childrenList, maxLen = 2) => {
  const list = childrenList ?? [];
  if (list.length === 0) return '';
  if (list.length === 1) {
    return `👶 Caring for 1 child: ${list[0].ChildName}`;
  }
  if (list.length <= maxLen) {
    return `👶 Caring for ${list.length} children: ${list.map(c => c.ChildName).join(', ')}`;
  }
  return `👶 ${list.slice(0, maxLen).map(c => c.ChildName).join(', ')} + ${list.length - maxLen} more`;
};

// One sibling's scheduled time window (first start → last end), matching the
// aggregate label rendered on the card header.
const siblingTimeLabel = (job) => {
  const slots = job?.SlotTimes ?? [];
  if (slots.length > 0) {
    const first = slots[0];
    const last = slots[slots.length - 1];
    return `${String(first?.StartTime || '').slice(0, 5)}–${String(last?.EndTime || '').slice(0, 5)}`;
  }
  if (job?.StartTime || job?.EndTime) {
    return `${String(job.StartTime || '').slice(0, 5)}–${String(job.EndTime || '').slice(0, 5)}`;
  }
  return null;
};

// "Wed, Sep 28" — day-of-week + date, used on every expanded day row so the
// history list reads as calendar days rather than bare month/day.
const siblingDayLabel = (job) => {
  if (!job?.JobDate) return 'Flexible';
  return new Date(job.JobDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const siblingDateLabel = (job) => {
  if (!job?.JobDate) return 'Flexible';
  return new Date(job.JobDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * Shared series card for BOTH the parent MyJobs screen and the sitter
 * BabysitterMyJobs screen.
 *
 * mode:
 *   'open'     — no NEXT SESSION highlight
 *   'upcoming' — renders the NEXT SESSION panel above the totals
 *   'history'  — no highlight; drill-down links carry ?series=history so the
 *                destination screen opens in series pagination mode
 */
export default function SeriesCard({ group, viewer = 'parent', seriesStatusLabel, mode = 'open', allSiblings: allSiblingsProp }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const { anchor, jobs, aggregate } = group;
  const { totalCount, children, timeLabel } = aggregate ?? {};
  const perDayPayment = aggregate?.perDayPayment;
  const totalPayment = aggregate?.totalPayment ?? 0;

  const now = new Date();
  const isPast = (d) => d && new Date(d).getTime() < now.getTime();

  const matchesMode = (s) => {
    const st = String(s.Status || '').toLowerCase();
    switch (mode) {
      case 'open':     return st === 'open' || st === 'pending';
      case 'upcoming': return st === 'assigned' && !isPast(s.JobDate);
      case 'history': {
        if (st === 'completed') return true;
        if (st === 'cancelled' || st === 'canceled') return true;
        return false;
      }
      case 'active':
        return st === 'in progress' || st === 'sitterarrived';
      default: return true;
    }
  };

  const visibleSiblings = (jobs ?? []).filter(matchesMode);

  // Phase 8F: how many of the series' days this tab is actually showing.
  // `totalCount` is the series size (SeriesTotalCount on the DTO), which is
  // correct but reads as "22 open days" when only 1 day is open. The header
  // therefore renders "1 of 22 days" whenever the two differ.
  const visibleCount = visibleSiblings.length;

  // Phase 8E: the header range is the WHOLE series, never the tab-filtered
  // subset. Both callers group jobs BY TAB before grouping, so `group.jobs`
  // holds only the siblings that survived the current tab — when that is a
  // single day (e.g. after a sitter declines one day) the card collapsed to one
  // date. `allSiblings` is the full, unfiltered sibling list for the series,
  // passed down from the caller's own list. The "22 days" count was always
  // right (it comes from SeriesTotalCount) — only this range was wrong.
  const rangeSource = allSiblingsProp ?? jobs ?? [];
  const rangeTimes = rangeSource
    .map((j) => (j?.JobDate ? new Date(j.JobDate).getTime() : null))
    .filter((t) => t != null && !Number.isNaN(t));

  const startDate = rangeTimes.length ? new Date(Math.min(...rangeTimes)) : null;
  const endDate = rangeTimes.length ? new Date(Math.max(...rangeTimes)) : null;

  const dateRange = (startDate && endDate &&
                     startDate.getTime() !== endDate.getTime())
    ? `${formatLocalDate(startDate)} – ${formatLocalDate(endDate)}`
    : formatLocalDate(startDate ?? endDate);

  const rowLabel = (s) => {
    const st = String(s.Status || '').toLowerCase();
    if (st === 'completed') return 'Completed';
    if ((st === 'cancelled' || st === 'canceled') && s.CancellationReason)
      return `Cancelled — ${s.CancellationReason}`;
    if (st === 'cancelled' || st === 'canceled') return 'Cancelled';
    if (st === 'assigned') return 'Assigned';
    if (st === 'open') return 'Open';
    return s.Status;
  };

  // History drill-downs open the destination in series pagination mode.
  const seriesQuery = mode === 'history' ? '?series=history' : '';

  // Upcoming tab only: the next session this series is waiting on. Rolls
  // forward automatically as each day completes and leaves the pending set.
  const nextSession = mode === 'upcoming' ? getNextSession(jobs) : null;
  const nextSessionLabel = nextSession
    ? `Day ${nextSession.SeriesOccurrenceIndex ?? '?'} · ${siblingDateLabel(nextSession)}${siblingTimeLabel(nextSession) ? ` · ${siblingTimeLabel(nextSession)}` : ''}`
    : '';

  // History "View Details" must land on the LATEST finished day, not the anchor
  // (earliest sibling) — the anchor is often still Open, so the user would open
  // a detail screen with no session/feedback on it.
  const latestHistory = mode === 'history'
    ? [...(jobs ?? [])].filter(j => {
        const st = String(j.Status || '').toLowerCase();
        return st === 'completed' || st === 'cancelled' || st === 'canceled';
      }).sort((a, b) =>
        new Date(b.JobDate).getTime() - new Date(a.JobDate).getTime()
      )[0]
    : null;

  const detailJobId = mode === 'history'
    ? (latestHistory?.Job_ID ?? latestHistory?.jobId ?? anchor?.Job_ID ?? anchor?.jobId)
    : (anchor?.Job_ID ?? anchor?.jobId);

  // The sitter's three tabs map to three different destination screens. The
  // single-job cards in BabysitterMyJobs already do this correctly:
  //   Requests -> /job-details/:id            (preview, Reject/Confirm)
  //   Upcoming -> /upcoming-job-details/:id   ("Notify Parent" + "Get Directions")
  //   History  -> /completed-job-details/:id  (Job Summary + Session Feedback)
  // Sending an Upcoming/History series card to /job-details dropped the sitter on
  // the read-only preview screen, which renders no action buttons at all once the
  // job is Assigned.
  const handleAnchorClick = () => {
    const targetId = detailJobId;
    if (targetId == null) return;

    if (viewer === 'sitter') {
      if (mode === 'upcoming') {
        navigate(`/upcoming-job-details/${targetId}`, {
          state: { jobId: targetId },
        });
      } else if (mode === 'history') {
        navigate(`/completed-job-details/${targetId}?series=history`, {
          state: { jobId: targetId },
        });
      } else {
        // 'open' / 'active' / default → the preview screen (unchanged)
        navigate(`/job-details/${targetId}${seriesQuery}`, {
          state: { jobId: targetId },
        });
      }
    } else {
      navigate(`/booking-status/${targetId}${seriesQuery}`);
    }
  };

  const handleSiblingClick = (e, job) => {
    e.stopPropagation();
    const targetId = job?.Job_ID ?? job?.jobId;
    if (targetId == null) return;
    if (viewer === 'sitter') {
      if (mode === 'upcoming') {
        navigate(`/upcoming-job-details/${targetId}`, { state: { jobId: targetId } });
      } else if (mode === 'history') {
        navigate(`/completed-job-details/${targetId}?series=history`, { state: { jobId: targetId } });
      } else {
        navigate(`/job-details/${targetId}${seriesQuery}`, { state: { jobId: targetId } });
      }
    } else {
      navigate(`/booking-status/${targetId}${seriesQuery}`);
    }
  };

  if (visibleSiblings.length === 0 && mode !== 'open') {
    return null;
  }

  return (
    <div className={styles.jobCard} onClick={handleAnchorClick} role="button" tabIndex={0}>
      <div className={styles.jobCardHeader} style={{ flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: 'var(--badge-purple-bg, rgba(147, 51, 234, 0.1))',
              color: 'var(--badge-purple-text, #9333ea)',
              width: 'max-content'
            }}
          >
            🔁 Series · {visibleCount === totalCount
              ? `${totalCount} days`
              : `${visibleCount} of ${totalCount} days`} · {seriesStatusLabel}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-strong)', marginTop: 4 }}>
            {dateRange} {timeLabel ? `· ${timeLabel}` : ''}
          </span>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {formatChildrenShort(children)}
          </span>
        </div>
      </div>

      {mode === 'upcoming' && nextSession && (
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgb(var(--primary-rgb) / 0.1)', border: '1px solid rgb(var(--primary-rgb) / 0.2)', marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-primary)', letterSpacing: 0.5, marginBottom: 4 }}>NEXT SESSION</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
            {nextSessionLabel}
          </div>
        </div>
      )}

      <div style={{ margin: '12px 0' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-strong)' }}>
          PKR {Number(totalPayment).toLocaleString()} total
        </div>
        {perDayPayment != null && (
          <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
            (PKR {Number(perDayPayment).toLocaleString()} per day)
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-primary)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          {expanded ? `Collapse ⬆` : `Expand to see all ${totalCount} days ⬇`}
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
          View Details →
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }} onClick={(e) => e.stopPropagation()}>
          {visibleSiblings.map((job) => (
            <div
              key={job.Job_ID ?? job.jobId}
              onClick={(e) => handleSiblingClick(e, job)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--color-surface-sunken)',
                borderRadius: 8,
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              <span>
                <strong>Day {job.SeriesOccurrenceIndex}</strong> · {siblingDayLabel(job)}
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>{rowLabel(job)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

