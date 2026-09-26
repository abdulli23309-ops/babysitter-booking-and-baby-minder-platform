import { formatLocalDate } from '../../utils/dateUtils';
import SeriesContractOverview from './SeriesContractOverview';
import styles from './series-rollup.module.css';

/**
 * Phase 8c Feature 3 — the whole-series view, shown once every day in a series
 * is terminal (completed, cancelled, or simply past its date). Replaces the
 * one-day-at-a-time layout so a finished 22-day booking can be read at a glance
 * instead of paged through.
 *
 * Purely presentational: the caller decides WHEN to render it. Reviews are
 * deliberately NOT rendered here — the caller keeps its own Session Feedback
 * card outside this component, so the review gate and this rollup stay
 * independent of each other.
 */

/** Status -> pill class + label. Unknown statuses fall back to the raw text. */
const STATUS_PILL = {
  completed: { cls: 'pillCompleted', label: 'Completed' },
  cancelled: { cls: 'pillCancelled', label: 'Cancelled' },
  canceled: { cls: 'pillCancelled', label: 'Cancelled' },
  assigned: { cls: 'pillPending', label: 'Assigned' },
  confirmed: { cls: 'pillPending', label: 'Assigned' },
  open: { cls: 'pillNeutral', label: 'Open' },
  pending: { cls: 'pillNeutral', label: 'Pending' },
  'in progress': { cls: 'pillActive', label: 'In Progress' },
  inprogress: { cls: 'pillActive', label: 'In Progress' },
  sitterarrived: { cls: 'pillActive', label: 'Sitter Arrived' },
};

const pillFor = (status) => {
  const key = String(status || '').trim().toLowerCase();
  return STATUS_PILL[key] ?? { cls: 'pillNeutral', label: key || 'Unknown' };
};

export default function SeriesRollup({ job, siblings = [], viewer = 'parent' }) {
  // Order by occurrence so Day 1 is always first, falling back to date for rows
  // whose index is missing.
  const days = [...(Array.isArray(siblings) ? siblings : [])].sort((a, b) => {
    const ai = a?.SeriesOccurrenceIndex;
    const bi = b?.SeriesOccurrenceIndex;
    if (ai != null && bi != null && ai !== bi) return ai - bi;
    return new Date(a?.JobDate || 0).getTime() - new Date(b?.JobDate || 0).getTime();
  });

  const dated = days.filter((d) => d?.JobDate);
  const first = dated[0] ?? null;
  const last = dated[dated.length - 1] ?? null;
  const range = first && last
    ? (first.Job_ID === last.Job_ID
        ? formatLocalDate(first.JobDate)
        : `${formatLocalDate(first.JobDate)} – ${formatLocalDate(last.JobDate)}`)
    : 'Dates unavailable';

  const dayCount = days.length || job?.SeriesTotalCount || 0;
  const completedCount = days.filter(
    (d) => String(d?.Status || '').toLowerCase() === 'completed').length;

  return (
    <div className={styles.rollup}>
      <div className={styles.hero}>
        <span className={styles.heroIcon} aria-hidden="true">🏆</span>
        <div className={styles.heroText}>
          <h2 className={styles.heroTitle}>Series Complete</h2>
          <p className={styles.heroMeta}>
            {dayCount} {dayCount === 1 ? 'day' : 'days'} · {range}
            {completedCount > 0 ? ` · ${completedCount} completed` : ''}
          </p>
        </div>
      </div>

      <SeriesContractOverview job={job} siblings={siblings} />

      {days.length > 0 && (
        <section
          className={styles.list}
          aria-label={viewer === 'sitter' ? 'Days you worked' : 'Days in this series'}
        >
          <h3 className={styles.listTitle}>Every day in this series</h3>
          <div className={styles.listHeader} aria-hidden="true">
            <span>Day</span>
            <span>Date</span>
            <span>Status</span>
          </div>
          <div className={styles.listScroll}>
            {days.map((d) => {
              const pill = pillFor(d?.Status);
              const idx = d?.SeriesOccurrenceIndex;
              return (
                <div className={styles.row} key={d?.Job_ID ?? d?.jobId ?? d?.JobDate}>
                  <span className={styles.rowDay}>
                    {idx != null ? `Day ${idx}` : '—'}
                  </span>
                  <span className={styles.rowDate}>
                    {d?.JobDate ? formatLocalDate(d.JobDate) : '—'}
                  </span>
                  <span className={styles.pill + ' ' + styles[pill.cls]}>
                    {pill.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
