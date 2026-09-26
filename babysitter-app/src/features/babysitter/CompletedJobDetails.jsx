import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import UserAvatar from '../../components/ui/UserAvatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import styles from './completed-job-details.module.css';
import SeriesContractOverview from '../../components/series/SeriesContractOverview';
import SeriesRollup from '../../components/series/SeriesRollup';
import { isSeriesTerminal } from '../../utils/seriesStatus';
import SeriesPaginationBar from '../../components/series/SeriesPaginationBar';

const Icons = {
  calendarOutline: () => (
    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  timeOutline: () => (
    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  locationOutline: () => (
    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  happyOutline: () => (
    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
  cashOutline: () => (
    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <line x1="6" y1="6" x2="6" y2="6.01" />
    </svg>
  ),
  walletOutline: () => (
    <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="12" y1="9" x2="16" y2="9" />
      <path d="M16 15h.01" />
    </svg>
  ),
};

export default function CompletedJobDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const { jobId } = useParams();
  const toast = useToast();
  const { role } = useAuth();

  const passedJob = location.state?.job;
  const numericJobId = jobId ? parseInt(jobId, 10) : passedJob?.Job_ID ?? passedJob?.jobId ?? null;

  const [job, setJob] = useState(passedJob ?? null);
  const [loading, setLoading] = useState(() => !passedJob && Boolean(numericJobId));
  const [jobReviews, setJobReviews] = useState([]);
  const [searchParams] = useSearchParams();
  const wantsHistory = searchParams.get('series') === 'history';
  const [siblings, setSiblings] = useState([]);
  // Phase 8c Feature 3: the UNFILTERED list of every day in the series.
  // `siblings` is pre-filtered to completed/cancelled days for the pagination
  // bar, so it cannot answer "is the whole series finished?" — testing that
  // against it would always say yes, and the rollup would list only the
  // terminal subset instead of every day.
  const [seriesDays, setSeriesDays] = useState([]);
  // Phase 8E: the URL is the single source of truth for which day is on screen.
  // Derived rather than held in state, so Prev/Next can navigate() and the
  // fetch effects below re-run for the new day — a refresh, bookmark or share
  // of /completed-job-details/151?series=history opens Day 2, not Day 1.
  //
  // This route is also reachable WITHOUT an :jobId (the bare
  // /completed-job-details entry point passes the job via location.state), so
  // fall back to that rather than going null.
  const activeJobId = numericJobId != null ? Number(numericJobId) : null;

  useEffect(() => {
    if (!wantsHistory || !job?.JobSeries_ID) return;
    let ignore = false;
    (async () => {
      try {
        // Phase 8D: read the whole series, not /jobs/sitter/{userId}. That
        // endpoint only returns days ASSIGNED to this sitter, so a sibling that
        // was cancelled or released back to Open was missing and the pagination
        // bar showed fewer days than the parent's.
        const data = await API.getSeriesJobs(job.JobSeries_ID);
        const list = Array.isArray(data) ? data : [];
        // Phase 8c Feature 3: keep the full series for the rollup + the
        // terminal check; `siblings` stays terminal-only for pagination.
        setSeriesDays(list);
        const filtered = list
          .filter(j => {
            const st = String(j.Status || '').toLowerCase();
            return st === 'completed'
                || st === 'cancelled'
                || st === 'canceled';
          })
          .sort((a, b) =>
            new Date(a.JobDate).getTime() - new Date(b.JobDate).getTime());
        if (!ignore) setSiblings(filtered);
      } catch { /* ignore */ }
    })();
    return () => { ignore = true; };
  }, [wantsHistory, job?.JobSeries_ID]);

  // Phase 5.2: hydrate from the API so a deep link (/completed-job-details/:jobId)
  // or a hard refresh shows real data instead of falling back to an empty state.
  //
  // Phase 8D: keyed on activeJobId, NOT numericJobId. numericJobId is derived
  // from the URL param, which never changes when the sitter pages between
  // siblings — so the bar updated activeJobId but this effect never re-ran and
  // the screen stayed stuck on the originally-seeded day.
  useEffect(() => {
    if (!activeJobId) return undefined;

    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        const data = await API.getJobDetails(activeJobId);
        if (isMounted) {
          // Replace wholesale rather than merging. The previous seed merged
          // ({ ...prev, ...data }) so fields unique to the old day — sitter
          // name, session timestamps, slot times — survived onto the new one.
          setJob(data);
          setJobReviews([]);
        }
      } catch (err) {
        if (isMounted) {
          setJob(null);
          if (!passedJob) {
            toast.error(err?.message || 'Could not load this job.');
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passedJob is a first-paint seed only
  }, [activeJobId]);

  // Phase 6.1 mutual reviews: every review attached to this job, so the sitter
  // can see their own feedback next to the parent's.
  //
  // Phase 8D: keyed on activeJobId, not numericJobId, for the same reason as
  // the job fetch above — otherwise paginating left the PREVIOUS day's reviews
  // on screen.
  useEffect(() => {
    if (!activeJobId) return undefined;

    let isMounted = true;
    (async () => {
      try {
        const data = await API.getReviewsForJob(activeJobId);
        if (isMounted) setJobReviews(Array.isArray(data) ? data : []);
      } catch {
        // A missing reviews table row is not an error — render the empty state.
        if (isMounted) setJobReviews([]);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [activeJobId]);

  // Phase 8D: derive the usable sibling list during render instead of
  // resetting it inside an effect (which triggers a cascading render). When
  // the active day has no series — or history mode is off — the previous
  // series' siblings must not remain visible, or the bar would keep paging a
  // list that no longer contains the active job.
  const visibleSiblings = (wantsHistory && job?.JobSeries_ID) ? siblings : [];

  if (loading) {
    return (
      <div className={styles.emptyScreen}>
        <LoadingSpinner size="lg" label="Loading job summary..." />
        <BabysitterBottomNav />
      </div>
    );
  }

  if (!job) {
    return (
      <div className={styles.emptyScreen}>
        <EmptyState
          icon="🏁"
          title="No Completed Job Found"
          description="We couldn't retrieve historical details for this completed babysitting session."
        >
          <Button variant="primary" onClick={() => navigate("/babysitter-my-jobs")}>
            Back to Assigned Jobs
          </Button>
        </EmptyState>
        <BabysitterBottomNav />
      </div>
    );
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'Completed Date';
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const slots = Array.isArray(job.SlotTimes) ? job.SlotTimes : [];
  const timeRange = slots.length > 0
    ? `${slots[0].StartTime?.substring(0, 5)} - ${slots[slots.length - 1].EndTime?.substring(0, 5)}`
    : 'Full Session';

  const formatChildren = (job) => {
    const list = job?.Children ?? job?.children ?? [];
    if (list.length === 0) {
      return job?.ChildName ? `👶 Caring for: ${job.ChildName}` : '';
    }
    if (list.length === 1) {
      return `👶 Caring for: ${list[0].ChildName}`;
    }
    return `👶 Caring for ${list.length} children: ${list.map(c => c.ChildName).join(', ')}`;
  };
  const childValue = formatChildren(job);

  const totalPayment = Number(job.Payment ?? 0);
  const isSeries = job?.JobSeries_ID != null || (job?.SeriesTotalCount ?? 0) > 1;
  const seriesTotalPayment = Number(job?.SeriesTotalPayment ?? 0);

  // Status-aware badge: reflect Job.Status truthfully instead of hard-coding
  // "Job Completed" (a cancelled job must not claim to be completed).
  const normalizedStatus = (job?.Status || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  const isCancelled = normalizedStatus === 'cancelled' || normalizedStatus === 'canceled';
  const badgeLabel = isCancelled ? 'Job Cancelled' : 'Job Completed';
  const badgeSubtext = isCancelled
    ? 'This job was cancelled before or during the session.'
    : 'This job has been successfully completed and archived.';

  // Phase 8B parity: actual session clock times + worked hours, mirrored from
  // the parent BookingStatus history screen. Hidden when the job was never
  // actually started.
  const sessionStartedAt = job.SessionStartedAt ?? null;
  const sessionEndedAt = job.SessionEndedAt ?? null;
  const fmtClock = (v) => (v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null);
  const workedHours = (sessionStartedAt && sessionEndedAt)
    ? ((new Date(sessionEndedAt).getTime() - new Date(sessionStartedAt).getTime()) / 36e5)
        .toFixed(2).replace(/\.00$/, '')
    : null;
  const sessionLabel = sessionStartedAt
    ? `${fmtClock(sessionStartedAt)} — ${fmtClock(sessionEndedAt) ?? '—'}`
      + (workedHours != null ? ` · ${workedHours} hours worked` : '')
    : null;

  const rows = [
    { icon: 'calendarOutline', label: 'Date', value: formatDate(job.JobDate) },
    { icon: 'timeOutline', label: 'Time', value: timeRange },
    ...(sessionLabel ? [{ icon: 'timeOutline', label: 'Session', value: sessionLabel }] : []),
    { icon: 'locationOutline', label: 'Location', value: job.City || job.ParentAddress || 'Not provided' },
    { icon: 'happyOutline', label: 'Child', value: childValue },
    { icon: 'cashOutline', label: 'Session Amount', value: `PKR ${totalPayment.toLocaleString()}` },
    {
      icon: 'walletOutline',
      label: isSeries ? 'Total Earned (this day)' : 'Total Earned',
      value: isSeries
        ? `PKR ${totalPayment.toLocaleString()} · of PKR ${seriesTotalPayment.toLocaleString()} series total`
        : `PKR ${totalPayment.toLocaleString()}`,
      isSuccess: true,
      last: true,
    },
  ];

  // Phase 6.1 mutual reviews — split this job's reviews by author role.
  const normalizedRole = (role || '').toLowerCase();
  const isSitter = normalizedRole === 'sitter' || normalizedRole === 'babysitter';
  const yourRole = isSitter ? 'Sitter' : 'Parent';
  const theirRole = isSitter ? 'Parent' : 'Sitter';
  const yourReview = jobReviews.find((r) => r.ReviewerRole === yourRole);
  const theirReview = jobReviews.find((r) => r.ReviewerRole === theirRole);

  // Phase 8c Feature 3: show the whole-series rollup once every day is
  // terminal. Requires siblings to be loaded, so a non-history visit (where
  // siblings are never fetched) keeps the per-day layout.
  const isSeriesComplete =
    job?.JobSeries_ID != null
    && Array.isArray(seriesDays)
    && seriesDays.length > 0
    && isSeriesTerminal(job, seriesDays);

  return (
    <div className={styles.jobScreen}>
      <div className={styles.content}>
        {/* Header — exactly ONE back control (left-aligned), matching
            JobDetails.jsx / ActiveJobDetails.jsx. An explicit target is used
            instead of navigate(-1) so the destination is deterministic. */}
        <header className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BackButton onClick={() => navigate('/babysitter-my-jobs')} />
            <h1 className={styles.headerTitle} style={{ margin: 0 }}>Job Summary</h1>
          </div>
        </header>

        {/* Phase 8c Feature 3: once every day in the series is terminal, show
            the whole booking at a glance instead of paging day by day. The
            header above and the Session Feedback card below stay outside. */}
        {isSeriesComplete ? (
          <SeriesRollup job={job} siblings={seriesDays} viewer="sitter" />
        ) : (
          <>

        {/* Status Badge Card (92px stats row) */}
        <section className={styles.statusCard}>
          <div className={isCancelled ? styles.statusBadgeCancelled : styles.statusBadge}>
            <span className={isCancelled ? styles.statusBadgeTextCancelled : styles.statusBadgeText}>{badgeLabel}</span>
          </div>
          <p className={styles.statusDesc}>
            {badgeSubtext}</p>
        </section>

        <section className={styles.scheduleCard} aria-label="Care schedule">
          <div className={styles.scheduleHeader}>
            <div className={styles.scheduleDateBlock}>
              <span className={styles.scheduleDateIcon} aria-hidden="true">📅</span>
              <div>
                <div className={styles.scheduleEyebrow}>Care Schedule</div>
                <div className={styles.scheduleDate}>
                  {job?.JobDate
                    ? new Date(job.JobDate).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'long', year: 'numeric'
                      })
                    : 'Date to be confirmed'}
                </div>
              </div>
            </div>
            {job?.JobSeries_ID != null && job?.SeriesOccurrenceIndex != null && job?.SeriesTotalCount != null && (
              <span className={styles.seriesPill}>
                🔁 Series: {job.SeriesOccurrenceIndex} of {job.SeriesTotalCount}
              </span>
            )}
          </div>

          <div className={styles.scheduleDivider} />

          {(Array.isArray(job?.SlotTimes) && job.SlotTimes.length > 0) ? (
            <ul className={styles.slotList}>
              {job.SlotTimes.map((slot, i) => {
                const fmt = (t) => {
                  if (!t) return null;
                  const [hStr, mStr] = String(t).split(':');
                  const h = Number(hStr);
                  const m = mStr ?? '00';
                  const meridiem = h >= 12 ? 'PM' : 'AM';
                  const h12 = h % 12 === 0 ? 12 : h % 12;
                  return { time: `${h12}:${m}`, meridiem };
                };
                const s = fmt(slot.StartTime);
                const e = fmt(slot.EndTime);
                return (
                  <li key={i} className={styles.slotRow}>
                    <span className={styles.slotIcon} aria-hidden="true">🕒</span>
                    {s && (
                      <span className={styles.slotTime}>
                        {s.time}<span className={styles.slotMeridiem}>{s.meridiem}</span>
                      </span>
                    )}
                    {e && (
                      <>
                        <span className={styles.slotDash} aria-hidden="true">—</span>
                        <span className={styles.slotTime}>
                          {e.time}<span className={styles.slotMeridiem}>{e.meridiem}</span>
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.scheduleEmpty}>
              Time slots for this session have not been set yet.
            </p>
          )}
        </section>

        <SeriesContractOverview job={job} siblings={siblings} />

        {wantsHistory && visibleSiblings.length > 1 && (
          <SeriesPaginationBar
            currentIndex={visibleSiblings.findIndex(
              s => String(s.Job_ID ?? s.jobId) === String(activeJobId))}
            totalCount={visibleSiblings.length}
            onPrev={() => {
              const idx = visibleSiblings.findIndex(
                s => String(s.Job_ID ?? s.jobId) === String(activeJobId));
              if (idx > 0) {
                const p = visibleSiblings[idx - 1];
                navigate(`/completed-job-details/${p.Job_ID ?? p.jobId}?series=history`);
              }
            }}
            onNext={() => {
              const idx = visibleSiblings.findIndex(
                s => String(s.Job_ID ?? s.jobId) === String(activeJobId));
              if (idx >= 0 && idx < visibleSiblings.length - 1) {
                const n = visibleSiblings[idx + 1];
                navigate(`/completed-job-details/${n.Job_ID ?? n.jobId}?series=history`);
              }
            }}
          />
        )}

        {/* Parent Details Card */}
        <section className={styles.parentCard}>
          <div className={styles.parentRow}>
            <div className={styles.avatarWrap}>
              {/* Real DB image, else a WhatsApp-style initial fallback */}
              <UserAvatar
                src={job.ParentPic}
                name={job.ParentName || 'Parent'}
                size={60}
                type="Parents"
                className={styles.avatarImg}
              />
            </div>
            <div>
              <p className={styles.parentName}>{job.ParentName || 'Parent'}</p>
              <div className={styles.ratingRow}>
                <span className={styles.ratingStar}>★ {Number(job.ParentRating ?? 5).toFixed(1)}</span>
                <span className={styles.ratingDot}>•</span>
                <span className={styles.parentId}>ID: {job.Parent_ID ? `PK-${job.Parent_ID}` : 'N/A'}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Job Details Rows */}
        <section className={styles.detailsCard}>
          {rows.map((r) => {
            const IconRenderer = Icons[r.icon];
            return (
              <div key={r.label} className={styles.detailRow}>
                <div className={styles.detailRowLeft}>
                  {IconRenderer ? <IconRenderer /> : null}
                  <span className={styles.detailLabel}>{r.label}</span>
                </div>
                <span className={`${styles.detailValue} ${r.isSuccess ? styles.detailValueSuccess : ''}`}>
                  {r.value}
                </span>
              </div>
            );
          })}
        </section>
          </>
        )}

        {/* Phase 6.1: Session Feedback — the sitter's review and the parent's */}
        <div className={styles.reviewsCard}>
          <h3 className={styles.reviewsHeading}>Session Feedback</h3>

          <div className={styles.reviewBlock}>
            <div className={styles.reviewHeader}>
              <span className={styles.reviewWho}>Their Review</span>
              {theirReview ? (
                <span className={styles.reviewStars}>
                  {'★'.repeat(Math.round(theirReview.Rating))}
                  {'☆'.repeat(5 - Math.round(theirReview.Rating))}
                </span>
              ) : null}
            </div>
            <p className={styles.reviewText}>
              {theirReview?.Comment
                ? theirReview.Comment
                : <em>No review left yet.</em>}
            </p>
          </div>

          <div className={styles.reviewBlock}>
            <div className={styles.reviewHeader}>
              <span className={styles.reviewWho}>Your Review</span>
              {yourReview ? (
                <span className={styles.reviewStars}>
                  {'★'.repeat(Math.round(yourReview.Rating))}
                  {'☆'.repeat(5 - Math.round(yourReview.Rating))}
                </span>
              ) : null}
            </div>
            <p className={styles.reviewText}>
              {yourReview?.Comment
                ? yourReview.Comment
                : <em>You haven&apos;t left a review for this session.</em>}
            </p>
          </div>
        </div>
      </div>
      <BabysitterBottomNav />
    </div>
    );
}
