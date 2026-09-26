import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { useToast } from '../../components/ui/ToastContext';
import { getAvatarUrl } from '../../utils/imageUtils';
import { API } from '../../services/api';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import styles from './live-session.module.css';
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


export default function ParentActiveJobScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { jobId: routeJobId } = useParams();
  const toast = useToast();

  const passedJob = location.state?.job;
  const numericJobId = routeJobId
    ? parseInt(routeJobId, 10)
    : passedJob?.Job_ID ?? passedJob?.jobId ?? null;

  const [job, setJob] = useState(passedJob ?? null);
  const [loading, setLoading] = useState(() => !passedJob && Boolean(numericJobId));

  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(null);
  const [imgError, setImgError] = useState(false);

  // Hydrate from the API: location.state.job is only a fast-paint
  // snapshot (it can be stale, e.g. missing SessionStartedAt), so
  // always refresh from the API when the URL has a job id.
  useEffect(() => {
    if (!numericJobId) return undefined;
    let isMounted = true;
    (async () => {
      try {
        const data = await API.getJobDetails(numericJobId);
        if (isMounted) {
          setJob((prev) => ({ ...(prev || {}), ...(data || {}) }));
        }
      } catch {
        if (isMounted) setJob(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [numericJobId]);

  const formatTime = (totalSeconds) => {
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // Tick clock for the 4-state live timer.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (job?.Status !== 'In Progress' || !job?.SessionStartedAt) return undefined;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.Status, job?.SessionStartedAt]);

  const handleEndSession = async (jobId) => {
    setEnding(true);
    setEndError(null);
    try {
      await API.updateJobStatus(jobId, 'Completed');
      toast.success('Babysitting session completed!');
      navigate(`/job-review/${jobId}`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 400 || status === 500 || status === 504) {
        setEndError('Could not end session. Please try again.');
      } else {
        setEndError('Something went wrong. Please try again.');
      }
    } finally {
      setEnding(false);
    }
  };

  // ── 4-state live timer: READ block + state computation ──
  const status = job?.Status || '';
  const sessionStart = job?.SessionStartedAt ? new Date(job.SessionStartedAt).getTime() : null;
  const now = tick;
  const lastSlotEnd = job?.SlotTimes?.length ? job.SlotTimes[job.SlotTimes.length - 1].EndTime : null;
  const scheduledEnd = (job?.JobDate && lastSlotEnd)
    ? new Date(`${job.JobDate.split('T')[0]}T${lastSlotEnd}`).getTime() : null;

  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const remaining = scheduledEnd != null ? scheduledEnd - now : null;

  let timerDisplay;
  let timerColor;
  let dotColor;
  let timerCaption;
  let exceededBanner;

  if (status !== 'In Progress' || !sessionStart) {
    // State 1 — session not started.
    timerDisplay = 'Session not started';
    timerColor = { color: 'var(--color-text-faint)' };
    dotColor = { background: 'var(--color-text-faint)' };
    timerCaption = '';
    exceededBanner = null;
  } else if (remaining == null) {
    // Active but no scheduled end available — show elapsed, no end-time caption.
    const elapsedSec = Math.floor((now - sessionStart) / 1000);
    timerDisplay = formatTime(elapsedSec);
    timerColor = undefined;
    dotColor = undefined;
    timerCaption = 'Ends at —';
    exceededBanner = null;
  } else if (remaining > FIFTEEN_MIN_MS) {
    // State 2 — active, more than 15 min remaining.
    const elapsedSec = Math.floor((now - sessionStart) / 1000);
    timerDisplay = formatTime(elapsedSec);
    timerColor = undefined;
    dotColor = undefined;
    timerCaption = `Ends at ${new Date(scheduledEnd).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    exceededBanner = null;
  } else if (remaining >= 0) {
    // State 3 — active, 0–15 min remaining (wrap up soon).
    const elapsedSec = Math.floor((now - sessionStart) / 1000);
    timerDisplay = formatTime(elapsedSec);
    timerColor = undefined;
    dotColor = { background: '#F59E0B' };
    timerCaption = `Ends in ${formatTime(Math.ceil(remaining / 1000))} — wrap up soon`;
    exceededBanner = null;
  } else {
    // State 4 — exceeded scheduled time.
    const overtimeSec = Math.floor((now - scheduledEnd) / 1000);
    timerDisplay = `+${formatTime(overtimeSec)}`;
    timerColor = { color: '#DC2626' };
    dotColor = { background: '#DC2626' };
    timerCaption = 'Session exceeded scheduled time';
    exceededBanner = (
      <div style={{ background: '#DC2626', color: '#fff', padding: '10px 16px', borderRadius: 8, marginTop: 12, fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>
        ⚠ This session is running past its scheduled time. Please end the session as soon as possible.
      </div>
    );
  }

  // Guard: no job to display yet (fetch failed, no id in URL,
  // or navigation lost state). Never crash the whole screen.
  if (!job) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        padding: 24,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 42 }}>🔍</div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          No active session found
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
          This job may have ended or the link is stale.
        </p>
        <button
          type="button"
          onClick={() => navigate('/my-jobs')}
          style={{
            marginTop: 8,
            padding: '10px 18px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--color-primary)',
            color: 'var(--color-text-inverse)',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Back to My Jobs
        </button>
      </div>
    );
  }

  const sitterName = job.SitterName || 'Caregiver';
  const childName = job.ChildName || 'Child';
  const childAge = job.ChildAge;
  // Multi-child: hide the single-child chip when 2+ children are booked,
  // and let the formatChildren line below take over, highlighted.
  const childCount = (job.Children ?? job.children ?? []).length;
  const showPrimaryChip = childCount <= 1;
  const locationName = job.City || 'Location unavailable';
  const sitterIdText = job.SitterCode || `ID: PK-${String(job.Job_ID ?? 0).padStart(5, '0')}`;

  const resolvedAvatar = getAvatarUrl(job.SitterPicture, 'Sitters');

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <LoadingSpinner size="lg" label="Loading session..." />
      </div>
    );
  }

  if (!job) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          No active session found. Go back to your jobs and open an active booking.
        </p>
        <Button variant="primary" onClick={() => navigate('/my-jobs')}>
          Back to My Jobs
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.sessionContainer}>
      {/* ── Header Actions (Back & End Session option) ── */}
      <div className={styles.topActions}>
        <button
          type="button"
          onClick={() => navigate('/my-jobs')}
          className={styles.backBtn}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setShowEndConfirm(true)}
          className={styles.endSessionPill}
        >
          End Session
        </button>
      </div>

      {/* ── Caregiver Banner Card ── */}
      <div className={styles.caregiverCard}>
        <div className={styles.avatarWrapper}>
          {!imgError ? (
            <img
              src={resolvedAvatar}
              alt={sitterName}
              className={styles.avatarImg}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className={styles.avatarFallback}>
              {sitterName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className={styles.verifiedBadge}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-inverse)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <div className={styles.caregiverDetails}>
          <h2 className={styles.caregiverName}>{sitterName}</h2>
          <span className={styles.caregiverId}>{sitterIdText}</span>
          {showPrimaryChip && (
            <div className={styles.childPill}>
              <span>👶</span>
              <span>{childName}{childAge != null ? ` (${childAge}y)` : ''}</span>
            </div>
          )}
          <p style={{
            marginTop: showPrimaryChip ? 6 : 10,
            fontSize: showPrimaryChip ? 13 : 14,
            fontWeight: showPrimaryChip ? 400 : 700,
            color: showPrimaryChip ? 'var(--color-text-muted)' : 'var(--color-primary)',
            background: showPrimaryChip ? 'transparent' : 'var(--color-primary-tint-soft)',
            padding: showPrimaryChip ? 0 : '6px 10px',
            borderRadius: showPrimaryChip ? 0 : 10,
            display: 'inline-block',
          }}>
            {formatChildren(job)}
          </p>
        </div>
      </div>

      {/* ── 4-State Live Duration Widget ── */}
      <div className={styles.durationSection}>
        <div className={styles.ringOuter} />
        <div className={styles.ringInner} />
        <div className={styles.timerDisc}>
          <span className={styles.timerLabel}>Live Duration</span>
          <h1 className={styles.timerDigits} style={timerColor}>
            {timerDisplay}
          </h1>
          <div className={styles.startedStatus}>
            <span
              className={styles.pulsingDot}
              style={dotColor}
            />
            <span>{timerCaption}</span>
          </div>
        </div>
      </div>
      {exceededBanner}

      {/* ── Location & Payment Info Card ── */}
      <div className={styles.infoCard}>
        {/* Location Row */}
        <div className={styles.infoRow}>
          <div className={styles.iconCircleLocation}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className={styles.infoTextCol}>
            <span className={styles.infoLabel}>Location</span>
            <span className={styles.infoValue}>{locationName}</span>
          </div>
        </div>

        <hr className={styles.cardDivider} />

        {/* Payment Row */}
        <div className={styles.infoRow}>
          <div className={styles.iconCirclePayment}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="12" cy="12" r="3" />
              <path d="M6 12h.01M18 12h.01" />
            </svg>
          </div>
          <div className={styles.infoTextCol}>
            <span className={styles.infoLabel}>SESSION TOTAL</span>
            <span className={styles.infoValue}>PKR {Number(job.Payment ?? 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* ── Shared Parent Bottom Navigation ── */}
      <ParentBottomNav />

      {/* ── End Confirmation Modal ── */}
      <Modal
        open={showEndConfirm}
        variant="compact"
        onClose={() => { setShowEndConfirm(false); setEndError(null); }}
      >
        <h3>End Session?</h3>
        <p>
          End this session with {sitterName}? You&apos;ll be prompted to leave a review.
        </p>
        {endError && (
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#dc2626', lineHeight: '1.4', fontWeight: 500 }}>
            {endError}
          </p>
        )}
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button variant="secondary" fullWidth onClick={() => setShowEndConfirm(false)}>
            Stay
          </Button>
          <Button
            variant="danger"
            fullWidth
            loading={ending}
            onClick={() => { if (job?.Job_ID) handleEndSession(job.Job_ID); }}
          >
            End &amp; Review
          </Button>
        </div>
      </Modal>
    </div>
  );
}
