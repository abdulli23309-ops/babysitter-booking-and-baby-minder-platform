import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import CopyButton from '../../components/ui/CopyButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';

import UserAvatar from '../../components/ui/UserAvatar';
import SitterMonitoringPanel from '../../components/monitoring/SitterMonitoringPanel';
import MonitoringMediaPanel from '../../components/monitoring/MonitoringMediaPanel';
import LiveMediaStage from '../../components/monitoring/LiveMediaStage';
import SitterActionDashboard from '../../components/monitoring/SitterActionDashboard';
import ParentSessionControls from '../../components/monitoring/ParentSessionControls';
import useMonitoring from '../../hooks/useMonitoring';
import useMonitoringMedia from '../../hooks/useMonitoringMedia';
import { API } from '../../services/api';
import { useToast } from '../../components/ui/ToastContext';
import { useAuth } from '../auth/AuthContext';
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

  /* PHASE 9.1 - ROLE-AWARE SCREEN.
     One Active Session screen now serves BOTH roles. The role comes from the
     auth context (the SERVER's own login verdict), never from a route name or
     a prop, and it decides which control panel renders beneath the video.
     `role` is stored lower-case by AuthContext ('parent' | 'babysitter'), so it
     is normalised once here into the two shapes the JSX branches on. */
  const { role } = useAuth();
  const isParent = String(role || '').toLowerCase() === 'parent';

  /* PHASE 9.1 - THE MONITORED CHILD IS RESOLVED, NOT CHOSEN.
     The old screen asked "Which child is the monitoring phone watching?" in a
     <select> and kept the answer in local state. That implied an authority the
     user does not have: choosing a child grants nothing, because the SERVER
     re-runs MonitoringAccess on every single request and will refuse a scope
     the caller is not entitled to.

     So the selection is now derived from server-issued state:
       1. `?childId=` in the URL, when another screen linked here directly
          (this is a LOCATOR only - still re-authorised server-side);
       2. otherwise the first child on the booking, which is the only child in
          the single-child case that used to need the dropdown at all.
     The header states the resolved child; there is nothing to tap. */
  const childParam = Number(location.search?.includes('childId=')
    ? new URLSearchParams(location.search).get('childId')
    : null) || Number(location.state?.childId) || null;

  const [responding, setResponding] = useState(false);

  /* Parent-side action busy flags. Separate from `responding` (which is the
     sitter's cry-response flag) so the two panels can never show each other's
     spinner. */
  const [pausing, setPausing] = useState(false);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [ending, setEnding] = useState(false);

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
  /* The booking's children. Memoised because it feeds the useMemo below: an
     inline `?? []` would allocate a new array every render and defeat the
     memo entirely. */
  const children = useMemo(
    () => job?.Children ?? job?.children ?? [],
    [job]
  );

  /* PHASE 9.1 - the resolved monitored child (see the note above). A `childId`
     from the URL wins when it matches a child on THIS booking; otherwise we
     fall back to the first child. A stale or foreign childId therefore can
     never produce a blank header - it just falls back, and the server would
     refuse it anyway. */
  const monitoredChild = useMemo(() => {
    if (children.length === 0) return null;
    if (childParam) {
      const match = children.find((c) => Number(c.Child_ID ?? c.ChildId) === childParam);
      if (match) return match;
    }
    return children[0];
  }, [children, childParam]);

  // The children are fixed by the BOOKING (JobChildren) and are only ever
  // REPORTED by this screen. Which child the monitoring phone watches is now
  // RESOLVED server-side (see above), not picked from a dropdown.

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

  /* ==================================================================
     PHASE 9.1 - PARENT ACTIONS

     Each of these calls a REAL endpoint and reports whatever the server
     actually said. None of them optimistically flips local state to look
     like it worked: `pauseRequested` is only set after the server accepted
     the pause request, because requesting a pause does NOT pause anything
     on its own - a second guardian has to approve it.
     ================================================================== */
  const requestPause = async () => {
    if (!numericJobId || !mediaChildId) return;
    setPausing(true);
    try {
      await API.requestPause(numericJobId, mediaChildId);
      setPauseRequested(true);
      toast.success('Pause requested. Another guardian must approve it before alerts pause.');
    } catch (err) {
      toast.error(err?.message || 'We could not request that pause.');
    } finally {
      setPausing(false);
    }
  };

  const endSession = async () => {
    if (!numericJobId || !mediaChildId) return;
    setEnding(true);
    try {
      /* Ending the monitoring session is the honest way to stop the feed.
         The server also cancels any still-open cry incident as part of this
         call, so this is not merely a client-side teardown. */
      await API.endMonitoringSession(numericJobId, mediaChildId);
      toast.success('Monitoring session ended.');
      navigate('/babysitter-my-jobs');
    } catch (err) {
      toast.error(err?.message || 'We could not end the session. Please try again.');
    } finally {
      setEnding(false);
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
            PHASE 9.1 - THE UNIFIED MONITORING STAGE + ROLE PANELS.

            Structure of this block, top to bottom:
              1. LiveMediaStage  - the deep-navy glassmorphic video card with a
                                   STATIC "Monitoring {child}" header and the
                                   single consolidated status pill.
              2. The role panel   - ParentSessionControls for a parent,
                                   SitterActionDashboard for a sitter. Never
                                   both, and never neither.

            The old "Which child is the monitoring phone watching?" <select> is
            GONE. It implied the user could choose a monitoring scope, which
            they cannot: the child is resolved from the session, and the server
            re-runs MonitoringAccess on every request regardless. */}
        {childCount > 0 ? (
          <section className={styles.monitoringSection}>
            {jobIsLive && monitoredChild ? (
              <LiveMediaStage
                childName={monitoredChild.ChildName}
                childCount={childCount}
              >
                <MonitoringMediaPanel
                  status={sitterMedia.status}
                  media={sitterMedia.media}
                  /* PHASE 9.1 - canPublish is the SERVER's answer, not a role
                     guess. A sitter is always a viewer, and a parent on the
                     monitoring phone is only a publisher if the server issued
                     it a publishing room. */
                  canPublish={isParent && sitterMedia.canPublish}
                  reason={sitterMedia.reason}
                  childName={monitoredChild.ChildName}
                  variant="stage"
                />
              </LiveMediaStage>
            ) : null}

            {/* ---- ROLE PANEL -------------------------------------------------
                Strict role branching. The parent gets security/decision
                controls; the sitter gets the care-action dashboard and no
                media controls at all, because a sitter is a strict viewer and
                offering them a camera button would invite exactly the
                publishing path the server forbids. */}
            {isParent ? (
              <ParentSessionControls
                onPause={requestPause}
                onEndSession={endSession}
                sitterPhone={job.SitterPhone ?? null}
                pausing={pausing}
                ending={ending}
                pauseRequested={pauseRequested}
              />
            ) : (
              <SitterActionDashboard
                onLog={(label) => toast.success(`${label} logged.`)}
                /* Actions only mean something while a session is genuinely
                   running, and the panel says why rather than going dead
                   silently. */
                disabled={!jobIsLive}
                disabledReason={
                  jobIsLive
                    ? ''
                    : 'Care actions become available once this session is in progress.'
                }
              />
            )}

            {/* ---- SITTER-ONLY MONITORING STATE ------------------------------
                The pause banner and the cry alert belong to the sitter only:
                the parent is not the recipient of a cry response, and a parent
                reading "I'm going to the child" options would be confusing at
                best. The parent sees the effects of those states on their own
                monitoring screen instead. */}
            {!isParent ? (
              <>
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
              </>
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

