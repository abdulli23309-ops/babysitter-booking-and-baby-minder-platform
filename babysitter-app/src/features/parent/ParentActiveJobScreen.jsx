import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { useToast } from '../../components/ui/ToastContext';
import { getAvatarUrl } from '../../utils/imageUtils';
import { API } from '../../services/api';
import useMonitoring from '../../hooks/useMonitoring';
import MonitoringStatusBar from '../../components/monitoring/MonitoringStatusBar';
import FeedingRecordingsPanel from '../../components/monitoring/FeedingRecordingsPanel';
import { formatLocalDate } from '../../utils/dateUtils';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import AssignedTasksCard from '../../components/ui/AssignedTasksCard';
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

  // ==================================================================
  // Children are fixed by the BOOKING (JobChildren)
  // ------------------------------------------------------------------
  // This screen only ever REPORTS them. The parent is never asked to re-select
  // which child the sitter is caring for, and monitoring scope is chosen inside
  // the monitoring flow, never here.
  //
  // These declarations and the hook below MUST stay above every early return,
  // otherwise the hook order changes between renders
  // (react-hooks/rules-of-hooks).
  const sessionChildren = job?.Children ?? job?.children ?? [];
  const monitorChildId = sessionChildren[0]?.Child_ID ?? null;
  const monitorChildName = sessionChildren[0]?.ChildName ?? job?.ChildName ?? null;

  // CHILD MONITORING is a SEPARATE fact from the babysitting session: the
  // session stays In Progress while the monitoring connection can be Lost,
  // paused, or not started at all. This shared hook reads it from the server, so
  // the two states can be shown apart instead of the parent having to leave the
  // session screen to find out. autoStart is deliberately OFF: this screen never
  // creates a monitoring session, it only reports the one the monitoring flow
  // owns.
  const monitoring = useMonitoring({
    jobId: numericJobId,
    childId: monitorChildId,
    role: 'parent',
  });

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
      <div className={styles.exceededBanner}>
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
  // Multi-child: with 2+ children a single-child chip would only ever name the
  // first one, so the dedicated "Children in this session" list below is the one
  // place that names them all.
  const childCount = sessionChildren.length;
  const showPrimaryChip = childCount <= 1;
  const locationName = job.City || 'Location unavailable';
  const sitterIdText = job.SitterCode || `ID: PK-${String(job.Job_ID ?? 0).padStart(5, '0')}`;

  // Session date + booked window: the same two facts the sitter's
  // active-session screen shows, taken from the job the API already returned.
  const careSlotTimes = Array.isArray(job.SlotTimes) ? job.SlotTimes : [];
  const careTimeRange = careSlotTimes.length > 0
    ? `${String(careSlotTimes[0].StartTime || '').slice(0, 5)} - ${String(careSlotTimes[careSlotTimes.length - 1].EndTime || '').slice(0, 5)}`
    : ((job.StartTime || job.EndTime)
      ? `${String(job.StartTime || '').slice(0, 5)} - ${String(job.EndTime || '').slice(0, 5)}`
      : 'Full session');
  const sessionDateLabel = job.JobDate ? formatLocalDate(job.JobDate) : 'Date unavailable';

  const resolvedAvatar = getAvatarUrl(job.SitterPicture, 'Sitters');

  // Phase 8: the monitoring entry point needs the real Child_ID. It comes from
  // the job's own child list (resolved above, before the early returns) - never
  // from a URL or a guess. With several children the first is offered; the
  // monitoring flow itself owns any per-child choice.
  const openMonitoring = () => {
    if (!monitorChildId) return;
    navigate('/baby-monitoring', {
      state: {
        jobId: job.Job_ID ?? job.jobId,
        childId: monitorChildId,
        childName: monitorChildName ?? childName,
      },
    });
  };

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
        <h1 className={styles.screenTitle}>Active Session</h1>
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
          {/* PHASE 9.4 - a NULL picture used to render <img src={null}>,
              whose load-error event never fires reliably in browsers, so a
              missing photo showed a broken image instead of the initial.
              The initial fallback now applies whenever there is no usable
              URL (and still after a real 404). */}
          {resolvedAvatar && !imgError ? (
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
          {/* Single-child line only: with 2+ children the dedicated
              "Children in this session" list below is the one place that names
              them, so the same list is never stated twice. */}
          {showPrimaryChip && formatChildren(job) ? (
            <p style={{
              marginTop: 6,
              fontSize: 13,
              fontWeight: 400,
              color: 'var(--color-text-muted)',
              background: 'transparent',
              padding: 0,
              borderRadius: 0,
              display: 'inline-block',
            }}>
              {formatChildren(job)}
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Children in this session (READ-ONLY) ──
          The booking already established who is being cared for, so the parent
          is never asked to pick a child on this screen. With one child the chip
          on the caregiver card above already names them, so this list is
          rendered only when there is more than one. */}
      {sessionChildren.length > 1 ? (
        <div className={styles.sessionChildrenCard}>
          <p className={styles.sessionChildrenLabel}>
            Children in this session ({sessionChildren.length})
          </p>
          <ul className={styles.sessionChildrenList}>
            {sessionChildren.map((c, i) => (
              <li key={c.Child_ID ?? i} className={styles.sessionChildRow}>
                <span aria-hidden="true">👶</span>
                <span>{c.ChildName ?? `Child ${c.Child_ID}`}</span>
                {c.ChildAge != null ? (
                  <span className={styles.sessionChildAge}>· {c.ChildAge}y</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── 4-State Live Duration Widget ── */}
      <div className={styles.durationSection}>
        <div className={styles.ringOuter} />
        <div className={styles.ringInner} />
        <div className={styles.timerDisc}>
          <span className={styles.timerLabel}>Session · Live Duration</span>
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

      {/* ── CHILD MONITORING — a SEPARATE fact from the session above ──
          The clock above describes the BABYSITTING session. This block describes
          the monitoring session and its connection, which the server reports
          independently: a lost monitoring connection is never the end of the
          babysitting session, and nothing here can change the job status. */}
      {monitorChildId ? (
        monitoring.error ? (
          <p
            role="alert"
            className={`${styles.monitoringSummary} ${styles.monitorError}`}
          >
            {monitoring.error}
          </p>
        ) : (
          <MonitoringStatusBar
            className={styles.monitoringSummary}
            session={monitoring.session}
            incident={monitoring.incident}
            offline={monitoring.offline}
            // This screen reads ONLY the monitoring session, never the Phase 7
            // pause/DND surface, so it must not claim "Not paused".
            showPauseAndDnd={false}
          />
        )
      ) : null}

      {/* ── Location & Payment Info Card ── */}
      <div className={styles.infoCard}>
        {/* Session Row — the date and booked window. The same two facts the
            sitter's active-session screen shows, so both roles read the session
            identically. */}
        <div className={styles.infoRow}>
          <div className={styles.iconCircleCalendar}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className={styles.infoTextCol}>
            <span className={styles.infoLabel}>SESSION</span>
            <span className={styles.infoValue}>{sessionDateLabel} · {careTimeRange}</span>
          </div>
        </div>

        <hr className={styles.cardDivider} />

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

        {/* ==================================================================
            PHASE 8 - E1 entry point into child monitoring.
            This is the link that makes monitoring reachable through the normal
            parent journey (active booking -> monitoring) instead of only from a
            dashboard tile. The (job, child) scope travels as route STATE rather
            than URL query parameters, because the monitoring endpoints are
            already authenticated and the server resolves everything else itself.
            No token, room id or other sensitive value is ever put in the URL. */}
        <div className={styles.infoRow}>
          <div className={styles.infoTextCol}>
            <button
              type="button"
              onClick={openMonitoring}
              disabled={!monitorChildId}
              style={{
                width: '100%',
                minHeight: 48,
                marginTop: 4,
                borderRadius: 12,
                border: '1px solid var(--color-primary)',
                background: 'var(--color-primary)',
                color: 'var(--color-text-inverse)',
                fontSize: 15,
                fontWeight: 700,
                cursor: monitorChildId ? 'pointer' : 'not-allowed',
                opacity: monitorChildId ? 1 : 0.6,
              }}
            >
              Open child monitoring
            </button>
            <span className={styles.infoLabel} style={{ marginTop: 8 }}>
              {monitorChildId
                ? `Live status, cry alerts, pause and do-not-disturb for ${monitorChildName ?? childName}.`
                : 'Monitoring becomes available once this booking has a child attached.'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Phase 10.0 — ASSIGNED TASKS (read-only) ─
          The exact allocation the parent selected at booking time, returned
          server-side by the job-details endpoint. Sits directly below the
          session/monitoring card and above the bottom navigation. Missing or
          NULL task data resolves to the calm empty state. */}
      <AssignedTasksCard assignedTasks={job.AssignedTasks ?? job.assignedTasks} />

      {/* ── PHASE 3: FEEDING RECORDINGS (cinematic history, mandate C) ──
          A distinct section below the session cards, consuming the EXISTING
          /feeding/history + /feeding/video endpoints. No new backend, no
          invented rows: every card is a real FeedingRecording. Playback runs
          through the panel's authenticated blob fetch (the endpoint demands a
          bearer header a <video src> cannot send). Rendered only when the
          booking actually resolved a child - an absent scope must not produce
          a request that would only 400/403. */}
      {monitorChildId ? (
        <FeedingRecordingsPanel
          jobId={job.Job_ID ?? job.jobId}
          childId={monitorChildId}
          className={styles.feedingRecordingsSection}
        />
      ) : null}

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
