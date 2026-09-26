import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import EmptyState from '../../components/ui/EmptyState';
import UserAvatar from '../../components/ui/UserAvatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { apiPost, apiGet } from '../../services/apiClient';
import { isSeriesTerminal } from '../../utils/seriesStatus';
import styles from './review-screen.module.css';

// Duration comes straight from the backend session timestamps — there is no
// mock fallback. '—' is rendered when the backend has no timestamps at all.
const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

/** Format a backend ISO timestamp as a wall-clock time, e.g. "6:00 PM". */
const formatClockTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

export default function JobEndReviewScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId, role } = useAuth();
  const toast = useToast();

  const { job: stateJob, elapsedSeconds: stateElapsed, sitterId: passedSitterId } = location.state || {};
  const { jobId: urlJobId } = useParams();
  const [fetchedJob, setFetchedJob] = useState(null);

  // Role branching. The app stores lowercase role strings ('parent' |
  // 'babysitter' — see sessionStorage.ROLES), so both spellings are accepted.
  const normalizedRole = (role || '').toLowerCase();
  const isSitter = normalizedRole === 'sitter' || normalizedRole === 'babysitter';
  const homeRoute = isSitter ? '/babysitter-my-jobs' : '/my-jobs';

  // Hydrate from API when navigated by URL (:jobId) without state.
  // /parent/job/{id} is Parent-exclusive (RBAC), so a sitter hydrates from
  // /jobs/jobdetails/{id}, which returns ParentName, the session timestamps
  // and the full children list for either role.
  useEffect(() => {
    if (stateJob || !urlJobId) return undefined;
    let mounted = true;
    (async () => {
      try {
        const endpoint = isSitter ? `/jobs/jobdetails/${urlJobId}` : `/parent/job/${urlJobId}`;
        const data = await apiGet(endpoint);
        if (mounted) setFetchedJob(data ?? null);
      } catch {
        if (mounted) setFetchedJob(null);
      }
    })();
    return () => { mounted = false; };
  }, [urlJobId, stateJob, isSitter]);

  const job = stateJob ?? fetchedJob;

  // Phase 8c: for a series, reviews open only once EVERY day is done. Load the
  // sibling list so the screen can tell the user why the form is closed instead
  // of submitting and getting a 400. A single-day job never calls this.
  const [seriesSiblings, setSeriesSiblings] = useState([]);
  useEffect(() => {
    const seriesId = job?.JobSeries_ID;
    if (!seriesId) return undefined;
    let mounted = true;
    (async () => {
      try {
        const data = await apiGet(`/jobs/series/${seriesId}`);
        if (mounted) setSeriesSiblings(Array.isArray(data) ? data : []);
      } catch {
        // Series data unavailable — isSeriesTerminal falls back to this day's
        // own status, which is the safe default.
        if (mounted) setSeriesSiblings([]);
      }
    })();
    return () => { mounted = false; };
  }, [job?.JobSeries_ID]);

  // Phase 8c: has THIS user already reviewed this series? The list is series
  // scoped, so any review by (userId, role) means the one-per-series limit is
  // used up and the form must not be offered.
  const [existingSeriesReviews, setExistingSeriesReviews] = useState([]);
  useEffect(() => {
    if (!job?.Job_ID) return undefined;
    let mounted = true;
    (async () => {
      try {
        const data = await apiGet(`/review/job/${job.Job_ID}`);
        if (mounted) setExistingSeriesReviews(Array.isArray(data) ? data : []);
      } catch {
        if (mounted) setExistingSeriesReviews([]);
      }
    })();
    return () => { mounted = false; };
  }, [job?.Job_ID]);

  const seriesTerminal = isSeriesTerminal(job, seriesSiblings);
  const alreadyReviewed = job?.JobSeries_ID
    ? existingSeriesReviews.some(
        (r) => String(r.Reviewer_ID) === String(userId)
          && String(r?.ReviewerRole || '').toLowerCase() === normalizedRole
      )
    : false;
  const canReview = seriesTerminal && !alreadyReviewed;

  // Real session duration — no mock value. Prefer the elapsed seconds handed
  // over by the End Session flow, otherwise derive them from the backend
  // timestamps (SessionStartedAt -> SessionEndedAt).
  // `nowMs` is captured once per mount for the "end timestamp missing" case.
  const [nowMs] = useState(() => Date.now());
  let elapsedSeconds = stateElapsed;
  if (!elapsedSeconds && job) {
    const startMs = job.SessionStartedAt ? new Date(job.SessionStartedAt).getTime() : null;
    const endMs = job.SessionEndedAt ? new Date(job.SessionEndedAt).getTime() : null;
    if (startMs && endMs && endMs > startMs) {
      elapsedSeconds = Math.floor((endMs - startMs) / 1000);
    } else if (startMs) {
      // Edge case: end timestamp missing — compute up to mount time.
      elapsedSeconds = Math.floor((nowMs - startMs) / 1000);
    }
  }
  const durationText = formatDuration(elapsedSeconds);

  const startTimeText = formatClockTime(job?.SessionStartedAt);
  const endTimeText = formatClockTime(job?.SessionEndedAt);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const sitterId = passedSitterId ?? job?.AssignedSitter_ID ?? job?.sitter?.id ?? null;
  const isSitterDeactivated = job?.IsSitterDeleted || (!job?.SitterName && !sitterId);
  const sitterName = isSitterDeactivated
    ? 'Deactivated Caregiver'
    : (job?.SitterName ?? job?.sitter?.name ?? 'Assigned Babysitter');

  // The sitter reviews the parent; the parent reviews the caregiver.
  const counterpartLabel = isSitter ? 'PARENT' : 'BABY SITTER';
  const counterpartName = isSitter ? (job?.ParentName ?? 'Parent') : sitterName;
  const counterpartDeactivated = isSitter
    ? (!job?.Parent_ID || job?.ParentName === 'Deactivated Parent')
    : (isSitterDeactivated && !sitterId);

  // Pictures come back on the DTO already prefixed ("Sitters/x.jpg" /
  // "Parents/y.jpg"), so getAvatarUrl resolves them as-is. `type` is only the
  // fallback folder for bare filenames.
  const counterpartPic = isSitter
    ? (job?.ParentPic ?? job?.ParentPicture ?? null)
    : (job?.SitterPicture ?? null);
  const counterpartType = isSitter ? 'Parents' : 'Sitters';

  // Children — always shown, for both roles.
  const children = job?.Children ?? job?.children ?? [];
  const childrenText = children.length === 0
    ? (job?.ChildName ?? 'Child')
    : children.map((c) => c.ChildName).join(', ');

  // Earnings: only the sitter earns — the parent paid for the session.
  const showEarnings = isSitter;
  const earningsText = `PKR ${Number(job?.Payment ?? 0).toLocaleString()}`;

  const handleSubmit = async () => {
    // Phase 8c: the form is hidden unless canReview, but guard anyway so the
    // action cannot be triggered from a stale render.
    if (!canReview) {
      toast.warning(alreadyReviewed
        ? 'You have already reviewed this series.'
        : 'Reviews open once every day of this series is completed or cancelled.');
      return;
    }
    if (rating === 0) {
      toast.warning('Please select a star rating.');
      return;
    }
    if (counterpartDeactivated) {
      toast.error(isSitter
        ? 'Parent information is unavailable for deactivated accounts.'
        : 'Caregiver information is unavailable for deactivated accounts.');
      return;
    }

    // The backend enforces that Reviewer_ID/ReviewerRole match the session
    // token, and that the reviewee is the counterpart on this booking.
    const reviewForId = isSitter ? job?.Parent_ID : sitterId;
    if (!reviewForId) {
      toast.error('Review target is unavailable for this booking.');
      return;
    }

    setSubmitting(true);
    try {
      await apiPost('/review/add', {
        Job_ID: job?.Job_ID,
        Reviewer_ID: userId,
        ReviewerRole: isSitter ? 'Sitter' : 'Parent',
        ReviewFor_ID: reviewForId,
        ReviewForRole: isSitter ? 'Parent' : 'Sitter',
        Rating: rating,
        Comment: comment.trim() || (isSitter ? 'Great family to work with!' : 'Great babysitting service!'),
      });

      toast.success('Thank you! Your review has been published.');
      navigate(homeRoute);
    } catch (err) {
      toast.error(err.message || 'Could not submit review.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!job) {
    return (
      <div className={styles.reviewContainer}>
        <div className={styles.topBar}>
          <BackButton onClick={() => navigate(homeRoute)} />
          <h1 className={styles.pageTitle}>Review</h1>
          <div style={{ width: 42 }} />
        </div>
        <EmptyState
          title="No Session to Review"
          description="We could not find the completed job details."
          actionLabel={isSitter ? 'Go to My Jobs' : 'Go to My Bookings'}
          onAction={() => navigate(homeRoute)}
        />
        {isSitter ? <BabysitterBottomNav /> : <ParentBottomNav />}
      </div>
    );
  }

  return (
    <div className={styles.reviewContainer}>
      {/* Top Bar with Universal BackButton */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <BackButton onClick={() => navigate(homeRoute)} />
          <h1 className={styles.pageTitle}>Job Summary</h1>
        </div>
      </header>

      <div className={styles.summaryCard}>
        {/* Header */}
        <div className={styles.headerBlock}>
          <div className={styles.checkBadge}>✓</div>
          <h1 className={styles.completedTitle}>Job Completed</h1>
          <p className={styles.completedSubtitle}>
            {isSitter
              ? 'Great job! Here is your session summary.'
              : 'Great job! Here is your summary.'}
          </p>
        </div>

        {/* Duration — big */}
        <div className={styles.durationBlock}>
          <span className={styles.durationLabel}>DURATION</span>
          <div className={styles.durationValue}>{durationText}</div>
        </div>

        {/* Participants */}
        <div className={styles.participantsList}>
          <div className={styles.participantRow}>
            <UserAvatar
              src={counterpartPic}
              name={counterpartName}
              size={40}
              type={counterpartType}
              className={styles.participantIcon}
            />
            <div>
              <div className={styles.participantLabel}>{counterpartLabel}</div>
              <div className={styles.participantName}>
                {counterpartName}
                {counterpartDeactivated && (
                  <span className={styles.participantBadge}>(Inactive)</span>
                )}
              </div>
            </div>
          </div>
          <div className={styles.participantRow}>
            <span className={styles.participantIcon}>👶</span>
            <div>
              <div className={styles.participantLabel}>
                {children.length === 1 ? 'CHILD' : 'CHILDREN'}
              </div>
              <div className={styles.participantName}>{childrenText}</div>
            </div>
          </div>
        </div>

        {/* Time split */}
        <div className={styles.timeSplit}>
          <span className={styles.timeCell}>
            <span className={styles.timeLabel}>Start</span>
            <span className={styles.timeValue}>{startTimeText}</span>
          </span>
          <span className={styles.timeDivider} />
          <span className={styles.timeCell}>
            <span className={styles.timeLabel}>End</span>
            <span className={styles.timeValue}>{endTimeText}</span>
          </span>
        </div>

        {/* Earnings — sitter only (the parent paid, they did not earn) */}
        {showEarnings && (
          <div className={styles.earningsRow}>
            <span className={styles.earningsLabel}>Total Earnings</span>
            <span className={styles.earningsValue}>{earningsText}</span>
          </div>
        )}

        {/* Phase 8c: rating + comment + submit are only available once the whole
            series is finished, and only once per reviewer. The job summary above
            still renders — only the review action is withheld. */}
        {!canReview ? (
          <div className={styles.reviewSection}>
            <h3 className={styles.reviewHeading}>
              {alreadyReviewed ? 'Review already submitted' : 'Reviews not open yet'}
            </h3>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
              {alreadyReviewed
                ? 'You have already reviewed this series. Thank you — one review covers the whole booking.'
                : 'Reviews open once every day of this series is completed or cancelled.'}
            </p>
          </div>
        ) : (
        <>
        {/* Rating */}
        <div className={styles.reviewSection}>
          <h3 className={styles.reviewHeading}>
            {isSitter
              ? 'How was the parent and children?'
              : 'How was your care experience?'}
          </h3>
          <div className={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => {
              const isFilled = star <= rating;
              return (
                <button
                  key={star}
                  type="button"
                  className={`${styles.starBtn} ${isFilled ? styles.starBtnActive : ''}`}
                  onClick={() => setRating(star)}
                  aria-label={`${star} star`}
                >
                  <svg width="34" height="34" viewBox="0 0 24 24" fill={isFilled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
              );
            })}
          </div>
          <textarea
            id="review-feedback-input"
            className={styles.reviewTextarea}
            aria-label={isSitter ? 'Share your experience with this family' : 'Share your feedback'}
            placeholder={
              isSitter
                ? 'Share your experience with this family (optional)'
                : 'Share your feedback (optional)'
            }
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        {/* Submit Review CTA Button */}
        <button
          type="button"
          className={styles.submitBtn}
          disabled={submitting || counterpartDeactivated}
          onClick={handleSubmit}
        >
          <span>
            {submitting
              ? 'Submitting...'
              : counterpartDeactivated
                ? (isSitter ? 'Parent Deactivated' : 'Caregiver Deactivated')
                : 'Submit Review'}
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
        </>
        )}
      </div>

      {isSitter ? <BabysitterBottomNav /> : <ParentBottomNav />}
    </div>
  );
}

