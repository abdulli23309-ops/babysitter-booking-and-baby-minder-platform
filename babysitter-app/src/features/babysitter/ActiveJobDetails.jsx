import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import CopyButton from '../../components/ui/CopyButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';

import UserAvatar from '../../components/ui/UserAvatar';
import SitterMonitoringPanel from '../../components/monitoring/SitterMonitoringPanel';
import MonitoringMediaPanel from '../../components/monitoring/MonitoringMediaPanel';
import useMonitoring from '../../hooks/useMonitoring';
import useMonitoringMedia from '../../hooks/useMonitoringMedia';
import { API } from '../../services/api';
import { useToast } from '../../components/ui/ToastContext';
import { formatLocalDate } from '../../utils/dateUtils';
import styles from '../parent/live-session.module.css';

const Icons = {
  chevronBack: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  ),
  locationOutline: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  cashOutline: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
};

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

const calculateAge = (dob) => {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

export default function ActiveJobDetails() {
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const { jobId: routeJobId } = useParams();

  const passedJob = location.state?.job;
  const numericJobId = routeJobId
    ? parseInt(routeJobId, 10)
    : passedJob?.Job_ID ?? passedJob?.jobId ?? null;

  const [job, setJob] = useState(passedJob ?? null);
  const [loading, setLoading] = useState(() => !passedJob && Boolean(numericJobId));

  // Which child the sitter is monitoring. Monitoring state is per child
  // (Phase 2 architecture), so a multi-child sitting needs an explicit choice.
  // This is a display selection only — it grants nothing; the backend decides
  // whether this sitter may monitor the chosen child.
  const [monitorChildIndex, setMonitorChildIndex] = useState(0);
  const [responding, setResponding] = useState(false);

  // ==================================================================
  // PHASE 8 - child monitoring for the assigned sitter
  // ------------------------------------------------------------------
  // Monitoring is scoped PER CHILD, so with several children the sitter picks
  // which one to watch. The chosen child is the only thing this screen decides;
  // whether they may monitor it at all is decided by the backend
  // (MonitoringAccess: assigned sitter + job In Progress + child in JobChildren),
  // which also auto-starts the session.
  //
  // These hooks MUST stay above every early return below, otherwise the hook
  // order changes between renders (react-hooks/rules-of-hooks).
  const children = job.Children ?? job.children ?? [];
  const monitoredChild = children[monitorChildIndex] ?? null;

  // The children are fixed by the BOOKING (JobChildren) and are only ever
  // REPORTED by this screen. Which child the monitoring phone watches is a
  // monitoring decision, so that choice lives inside the "Child monitoring"
  // block below - not in the general session area.

  const monitoring = useMonitoring({
    jobId: numericJobId,
    childId: monitoredChild?.Child_ID ?? null,
    role: 'sitter',
    autoStart: Boolean(numericJobId && monitoredChild?.Child_ID),
  });

  // PHASE 8.9 - the babysitter's live view of the child, on their Active Job
  // screen. The sitter is a VIEWER, exactly like the parent: the server issues
  // the room with audio=0, video=0 and hide=1 for anyone who is not the
  // publishing parent, so the sitter's browser is never even granted the
  // camera or microphone. Nothing about that role is decided here - this hook
  // only fetches what the server authorised, and the server re-runs
  // MonitoringAccess (assigned sitter + job In Progress + child in
  // JobChildren) on every request.
  //
  // LIFECYCLE GUARD: media is only ever requested, and only ever rendered,
  // while the job is genuinely In Progress AND a child is selected. The moment
  // the job ends or the child selection changes, `enabled` goes false, the hook
  // stops fetching, and the panel below unmounts immediately - which also tears
  // down the iframe and stops the media session.
  const jobIsLive = job?.Status === 'In Progress';
  const mediaChildId = monitoredChild?.Child_ID ?? null;
  const sitterMedia = useMonitoringMedia(
    numericJobId,
    mediaChildId,
    Boolean(numericJobId && mediaChildId && jobIsLive),
    // Re-request as soon as the server-side session state changes, so the feed
    // appears the moment Child Mode actually starts rather than sticking on the
    // first "no active session" answer.
    monitoring.session?.Status ?? null
  );

  // A sitter response is a server action; the refreshed state comes back from
  // the server (the client never flips an incident status itself).
  const respond = async (label, action) => {
    setResponding(true);
    try {
      const ok = await action();
      toast.success(ok ? label : 'That action is no longer available.');
    } finally {
      setResponding(false);
    }
  };


  // Hydrate from the API when no job was passed via navigation state.
  useEffect(() => {
    if (!numericJobId || passedJob) return undefined;
    let isMounted = true;
    (async () => {
      try {
        const data = await API.getJobDetails(numericJobId);
        if (isMounted) setJob(data ?? null);
      } catch (err) {
        if (isMounted) setJob(null);
        const _message = err && err.message ? err.message : 'Something went wrong. Please try again.';
        toast.error(_message);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [numericJobId, passedJob, toast]);

  // ── Sitter review trigger ──
  // The parent ends the session from their own screen. This screen has no
  // push channel, so poll the job status; the moment it flips from
  // 'In Progress' to 'Completed' the sitter is sent to the review screen
  // (same destination the parent lands on: /job-review/:jobId).
  const lastStatusRef = useRef(passedJob?.Status ?? null);
  const isPollingRef = useRef(false);

  const pollNow = useCallback(async () => {
    if (!numericJobId || isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const data = await API.getJobDetails(numericJobId);
      if (!data) return;

      const prev = lastStatusRef.current;
      const next = data?.Status;
      if (next && next !== prev) {
        lastStatusRef.current = next;
        if (prev === 'In Progress' && next === 'Completed') {
          navigate(`/job-review/${numericJobId}`, { state: { job: data } });
          return;
        }
      }

      setJob((prevJob) => ({ ...(prevJob ?? {}), ...data }));
    } catch (err) {
      // Transient network/API error — the next tick retries.
      const _msg = (err && err.message) ? err.message : 'Something went wrong. Please try again.';
      toast.error(_msg);
    } finally {
      isPollingRef.current = false;
    }
  }, [numericJobId, navigate, toast]);

  useEffect(() => {
    if (!numericJobId || job?.Status === 'Completed' || job?.Status === 'Cancelled') {
      return undefined;
    }

    const poll = setInterval(pollNow, 1500);
    return () => {
      clearInterval(poll);
    };
  }, [numericJobId, job?.Status, pollNow]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && job?.Status === 'In Progress') {
        pollNow(); // the same function the interval calls
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [job?.Status, pollNow]);

  const formatTime = (sec) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // Tick clock for the 4-state live timer.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (job?.Status !== 'In Progress' || !job?.SessionStartedAt) return undefined;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.Status, job?.SessionStartedAt]);

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
    timerCaption = 'Waiting for parent to start';
    exceededBanner = null;
  } else if (remaining == null) {
    // Active but no scheduled end available.
    const elapsedSec = Math.floor((now - sessionStart) / 1000);
    timerDisplay = formatTime(elapsedSec);
    timerColor = undefined;
    dotColor = undefined;
    timerCaption = 'Waiting for parent to start';
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

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingBottom: '100px',
        }}
      >
        <LoadingSpinner size="lg" label="Loading session..." />
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{
        minHeight: '100vh',
        maxWidth: 'var(--shell-max-width, 480px)',
        margin: '0 auto',
        background: 'var(--color-background, var(--color-surface-muted))',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '24px 16px 100px',
        boxSizing: 'border-box',
      }}>
        <EmptyState
          icon="📋"
          title="No Active Job Details"
          description="We couldn't retrieve the session details for this job. It may have ended or been updated."
        >
          <Button
            variant="primary"
            onClick={() => navigate('/babysitter-my-jobs')}
            style={{ marginTop: '12px' }}
          >
            Back to Assigned Jobs
          </Button>
        </EmptyState>
        <BabysitterBottomNav />
      </div>
    );
  }

  // Multi-child: the single-child chip is misleading when there are 2+
  // children (it only ever showed the first one), so with several children the
  // dedicated "Children in this session" list above is the one place that names
  // them.
  const childCount = (job.Children ?? job.children ?? []).length;
  const showPrimaryChip = childCount <= 1;
  const childAge = job.ChildAge ?? (job.Child_DOB ? calculateAge(job.Child_DOB) : '?');

  // Session date + booked window. Both come from the job the API already
  // returned (no extra request) and are the SAME two facts the parent's
  // active-session screen shows, so both roles read the session identically.
  const careSlotTimes = Array.isArray(job.SlotTimes) ? job.SlotTimes : [];
  const careTimeRange = careSlotTimes.length > 0
    ? `${String(careSlotTimes[0].StartTime || '').slice(0, 5)} - ${String(careSlotTimes[careSlotTimes.length - 1].EndTime || '').slice(0, 5)}`
    : ((job.StartTime || job.EndTime)
      ? `${String(job.StartTime || '').slice(0, 5)} - ${String(job.EndTime || '').slice(0, 5)}`
      : 'Full session');
  const sessionDateLabel = job.JobDate ? formatLocalDate(job.JobDate) : 'Date unavailable';

  // ==================================================================
  // PHASE 8 - child monitoring for the assigned sitter
  // ------------------------------------------------------------------
  // NOTE: the `children`, `monitoring` and `respond` bindings are declared
  // ABOVE the early returns in this component (see the top of the file) so the
  // hook order never changes between renders.
  return (
    <div className={styles.sessionContainer}>
      <main className={styles.sessionContent}>
        {/* Top Header */}
        <div className={styles.topActions}>
          <button
            type="button"
            onClick={() => navigate('/babysitter-my-jobs')}
            className={styles.backBtn}
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className={styles.screenTitle}>Active Session</h1>
          <div className={styles.headerSpacer} />
        </div>

        {/* ── Children in this session (READ-ONLY) ──
            The booking already established who is being cared for
            (JobChildren), so the general active-session area only REPORTS the
            children. It never asks the sitter to choose one. With a single
            child the existing "Caring for ..." line above already says it, so
            this list is rendered only when there is more than one - exactly the
            case where the old "Child to monitor" dropdown used to appear. */}
        {childCount > 1 ? (
          <div className={styles.sessionChildrenCard}>
            <p className={styles.sessionChildrenLabel}>
              Children in this session ({childCount})
            </p>
            <ul className={styles.sessionChildrenList}>
              {children.map((c, i) => (
                <li key={c.Child_ID ?? i} className={styles.sessionChildRow}>
                  <span aria-hidden="true">👶</span>
                  <span>{c.ChildName ?? `Child ${c.Child_ID}`}</span>
                  {c.ChildAge != null ? (
                    <span className={styles.sessionChildAge}>
                      · {c.ChildAge}y
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ==================================================================
            PHASE 8 - child monitoring, reachable from the normal sitter flow.
            Shows: the parent-approved pause banner, connection-loss warning, and
            the cry alert with the three sitter responses. The sitter has NO
            pause/guardian/DND controls here by design - a pause is a parent
            action, and the sitter only ever sees its effect.

            The monitoring-scope chooser lives INSIDE this block, not in the
            general session area above: monitoring is scoped PER CHILD
            (Phase 2), so which child the monitoring phone watches is a
            monitoring setting rather than a property of the booking. Choosing
            here grants nothing - MonitoringAccess still decides on the server
            whether this sitter may monitor that child. */}
        {childCount > 0 ? (
          <section className={styles.monitoringSection}>
            <h3 className={styles.sectionHeading}>
              Child monitoring
            </h3>
            {childCount > 1 ? (
              <label htmlFor="monitor-child-select">
                Which child is the monitoring phone watching?
                <select
                  id="monitor-child-select"
                  value={String(monitorChildIndex)}
                  onChange={(e) => setMonitorChildIndex(Number(e.target.value))}
                  className={styles.monitorSelect}
                >
                  {children.map((c, i) => (
                    <option key={c.Child_ID} value={String(i)}>
                      {c.ChildName ?? `Child ${c.Child_ID}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {/* PHASE 8.9 - the babysitter's live camera view.
                Two independent guards must both hold before anything mounts:
                  1. the job is In Progress (not Completed/Cancelled/upcoming), and
                  2. a child is actually selected.
                When either fails this whole block is absent from the DOM, so
                the iframe is destroyed rather than merely hidden.
                `canPublish` is hard-coded false: the sitter is a viewer and the
                panel renders NO camera/microphone controls for them. The server
                independently issues this participant a viewer room
                (audio=0, video=0, hide=1), so the restriction does not rest on
                this prop alone. */}
            {jobIsLive && monitoredChild ? (
              <section className={styles.monitoringBlock} aria-label="Live baby monitoring">
                <MonitoringMediaPanel
                  status={sitterMedia.status}
                  media={sitterMedia.media}
                  canPublish={false}
                  reason={sitterMedia.reason}
                  childName={monitoredChild.ChildName}
                  variant="card"
                />
              </section>
            ) : null}

            <SitterMonitoringPanel
              session={monitoring.session}
              incident={monitoring.incident}
              offline={monitoring.offline}
              busy={responding}
              // A paused monitoring session has had its incident cancelled by
              // the backend, so there is normally nothing to respond to; the
              // guard is presentation only and the server refuses regardless.
              canRespond={!monitoring.session?.IsPaused}
              onGoingToChild={() => respond('Marked as going to the child', monitoring.goingToChild)}
              onViewChild={() => {
                // PHASE 12 CORRECTION - this was a dead action.
                // "View Child" only fired toast.info('Opening the child camera
                // view.') and changed nothing on screen, so the sitter was told a
                // camera view was opening when it never did. It is now a real
                // navigation to the monitoring screen.
                //
                // Carry the selected job/child so a sitter with more than one
                // active scope lands on the child whose alert they opened. Route
                // state is only a locator: media and every monitoring action are
                // still authorized again by MonitoringAccess on the server.
                navigate('/baby-monitoring', {
                  state: {
                    jobId: numericJobId,
                    childId: monitoredChild?.Child_ID,
                    childName: monitoredChild?.ChildName ?? null,
                  },
                });
              }}
              onWithChild={() => respond('Marked as with the child', monitoring.withChild)}
            />

            {monitoring.error ? (
              <p role="alert" className={styles.monitorError}>
                {monitoring.error}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ── Job Reference + Copy / Last Updated ── */}
        <div className={styles.jobReference}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            Job Reference: <strong style={{ color: 'var(--color-text)' }}>#{job.Job_ID ?? '—'}</strong>
          </span>
          <CopyButton value={String(job.Job_ID ?? '')} label="Copy Job Reference" />
        </div>
        <p className={styles.lastUpdated}>
          Last updated: {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>

        {/* ── Parent Card ── */}
        <div className={styles.caregiverCard}>
          <div className={styles.avatarWrapper}>
            <UserAvatar
              src={job.ParentPic}
              name={job.ParentName || 'Parent'}
              size={60}
              type="Parents"
              alt="parent"
            />
          </div>

          <div className={styles.caregiverDetails}>
            <p className={styles.caregiverName}>
              {job.ParentName || 'Parent'}
            </p>
            <p className={styles.caregiverId}>
              ID: PK-{String(job.Job_ID).padStart(5, '0')}
            </p>
            {showPrimaryChip && (
              <div className={styles.childPill}>
                <span style={{ fontSize: '14px' }}>☺</span>
                <span>
                  {job.ChildName || 'Child'} ({childAge}y)
                </span>
              </div>
            )}
            {showPrimaryChip && formatChildren(job) ? (
              <p className={styles.profileChildren}>
                {formatChildren(job)}
              </p>
            ) : null}
          </div>
        </div>

        {/* ── Live Duration Timer ── */}
        <div className={styles.durationSection}>
          <div className={styles.ringOuter} />
          <div className={styles.ringInner} />
          <div className={styles.timerDisc}>
            <span className={styles.timerLabel}>Session · Live Duration</span>
            <h1 className={styles.timerDigits} style={timerColor}>
              {timerDisplay}
            </h1>
            <div className={styles.startedStatus}>
              <span className={styles.pulsingDot} style={dotColor} />
              <span>{timerCaption}</span>
            </div>
          </div>
        </div>
        {exceededBanner}

        {/* ── Info Card ── */}
        <div className={styles.infoCard}>
          {/* Session row — the date and booked window. These are the SAME facts
              the parent's active-session screen shows, so both roles describe
              the session identically. */}
          <div className={styles.infoRow}>
            <div className={styles.iconCircleCalendar}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div className={styles.infoTextCol}>
              <p className={styles.infoLabel}>
                Session
              </p>
              <p className={styles.infoValue}>
                {sessionDateLabel} · {careTimeRange}
              </p>
            </div>
          </div>

          {/* Location row */}
          <hr className={styles.cardDivider} />
          <div className={styles.infoRow}>
            <div className={styles.iconCircleLocation}>
              <Icons.locationOutline />
            </div>
            <div className={styles.infoTextCol}>
              <p className={styles.infoLabel}>
                Location
              </p>
              <p className={styles.infoValue}>
                {job.City || 'N/A'}
              </p>
            </div>
          </div>

          {/* Payment row */}
          <hr className={styles.cardDivider} />
          <div className={styles.infoRow}>
            <div className={styles.iconCirclePayment}>
              <Icons.cashOutline />
            </div>
            <div className={styles.infoTextCol}>
              <p className={styles.infoLabel}>
                SESSION TOTAL
              </p>
              <p className={styles.infoValue}>
                PKR {Number(job.Payment ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </main>

      <BabysitterBottomNav />
    </div>
  );
}

