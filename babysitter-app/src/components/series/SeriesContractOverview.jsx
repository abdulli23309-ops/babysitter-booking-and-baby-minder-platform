/**
 * Phase 7.3 — Series Contract Overview.
 *
 * ONE shared component, rendered by the parent's `BookingStatus` AND the
 * babysitter's `JobDetails` / `UpcomingJobDetails`, so the two experiences are
 * identical by construction rather than by convention (STEP 4).
 *
 * All derivation lives in `./seriesMetrics` (pure, directly testable
 * functions); this file is presentation only. The component returns null for
 * anything that is not a recurring contract, so single-day bookings are
 * completely unchanged.
 */
import { useState } from 'react';
import { WEEKDAY_KEYS, formatLocalDate } from '../../utils/dateUtils';
import { getSeriesMetrics } from './seriesMetrics';
import styles from './series-contract-overview.module.css';

const formatHours = (hours) => (hours == null ? '—' : String(hours));

export default function SeriesContractOverview({ job, siblings = [] }) {
  const [nowMs] = useState(() => Date.now());
  const metrics = getSeriesMetrics(job);
  const completed = siblings.filter(
    s => String(s.Status || '').toLowerCase() === 'completed');
  const totalCount = job?.SeriesTotalCount ?? siblings.length;
  const hoursPerDay = Number(metrics?.hoursPerDay) || 0;
  const hoursWorked = completed.reduce((sum, s) => {
    if (!s.SessionStartedAt || !s.SessionEndedAt) return sum + hoursPerDay;
    return sum + (new Date(s.SessionEndedAt) - new Date(s.SessionStartedAt)) / 36e5;
  }, 0);
  const hoursRemaining = Math.max(0, hoursPerDay * totalCount - hoursWorked);
  // Phase 8c: prefer the server's authoritative figure — it sums every
  // COMPLETED sibling in the series, including days outside the currently
  // loaded `siblings` list. The client-side sum is only a fallback for when
  // the DTO field is absent (older payload, or a single-day job where the
  // backend returns null).
  const paid = typeof job?.SeriesEarnedSoFar === 'number'
    ? job.SeriesEarnedSoFar
    : completed.reduce(
        (sum, s) => sum + (Number(s.Payment) || 0), 0);
  const remaining = Math.max(
    0, (Number(job?.SeriesTotalPayment) || 0) - paid);
  const nextSession = siblings
    .filter(s => String(s.Status || '').toLowerCase() === 'assigned')
    .filter(s => new Date(s.JobDate).getTime() >= nowMs)
    .sort((a, b) => new Date(a.JobDate) - new Date(b.JobDate))[0];
  // Single-day bookings render nothing at all.
  if (!metrics) return null;

  return (
    <section className={styles.overview} aria-label="Contract overview">
      <h4 className={styles.overviewTitle}>Contract Overview</h4>

      <div className={styles.metricsGrid}>
        <div className={styles.metric}>
          {/* Phase 8G: this grid is SERIES-level data, but it is rendered on a
              per-day screen, so a bare "9 / Total Days" read as "this booking is
              9 days". Show the day position instead: "Day 2 of 9". Falls back
              to the series length when the occurrence index is missing. */}
          <span className={styles.metricValue}>
            {job?.SeriesOccurrenceIndex != null
              ? `${job.SeriesOccurrenceIndex} of ${metrics.totalCount ?? totalCount}`
              : (metrics.totalCount ?? totalCount)}
          </span>
          <span className={styles.metricLabel}>
            {job?.SeriesOccurrenceIndex != null ? 'Day of Series' : 'Series Length'}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{formatHours(metrics.hoursPerDay)}</span>
          <span className={styles.metricLabel}>Hours per Day</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{formatHours(metrics.totalHours)}</span>
          <span className={styles.metricLabel}>Total Hours</span>
        </div>
      </div>

      {metrics.range && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Date Range</span>
          <span className={styles.metaValue}>{metrics.range}</span>
        </div>
      )}

      {metrics.days.length > 0 && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Repeating On</span>
          <div className={styles.dayBadges}>
            {WEEKDAY_KEYS.map((day) => {
              const active = metrics.days.includes(day);
              return (
                <span
                  key={day}
                  className={active ? `${styles.dayBadge} ${styles.dayBadgeActive}` : styles.dayBadge}
                >
                  <span aria-hidden="true">{day.slice(0, 1)}</span>
                  <span className={styles.dayBadgeSr}>{day}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
      {siblings.length > 1 && (
        <div className={styles.progressBlock}>
          <div className={styles.progressRow}>
            <span>Sessions</span>
            <span>{completed.length} of {totalCount} completed</span>
          </div>
          <div className={styles.progressRow}>
            <span>Hours</span>
            <span>{hoursWorked.toFixed(1)}h worked · {hoursRemaining.toFixed(1)}h remaining</span>
          </div>
          <div className={styles.progressRow}>
            <span>Earned so far</span>
            <span>PKR {paid.toLocaleString()} of PKR {Number(job?.SeriesTotalPayment || 0).toLocaleString()}</span>
          </div>
          <div className={styles.progressRow}>
            <span>Remaining</span>
            <span>PKR {remaining.toLocaleString()}</span>
          </div>
          {nextSession && (
            <div className={styles.progressRow}>
              <span>Next session</span>
              <span>Day {nextSession.SeriesOccurrenceIndex} · {formatLocalDate(nextSession.JobDate)}</span>
            </div>
          )}
        </div>
      )}

      {/* Phase 8c: when the full sibling list has not been loaded (siblings is
          empty or a single entry) the block above is hidden — but the running
          total is still meaningful, because the backend sums every COMPLETED
          day in the series regardless of what the client holds. So render the
          Earned-so-far row on its own in that case. */}
      {siblings.length <= 1 && (Number(job?.SeriesTotalPayment) || 0) > 0 && (
        <div className={styles.progressBlock}>
          <div className={styles.progressRow}>
            <span>Earned so far</span>
            <span>PKR {paid.toLocaleString()} of PKR {Number(job.SeriesTotalPayment).toLocaleString()}</span>
          </div>
        </div>
      )}
    </section>
  );
}
