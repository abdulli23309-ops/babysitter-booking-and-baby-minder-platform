import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { JitsiMeeting } from '@jitsi/react-sdk';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import MonitoringStatusBar from '../../components/monitoring/MonitoringStatusBar';
import Phase7FamilyPanel from './Phase7FamilyPanel';
import useMonitoring from '../../hooks/useMonitoring';
import useMonitoringMedia from '../../hooks/useMonitoringMedia';
import { useAuth } from '../auth/AuthContext';
import { API } from '../../services/api';
import styles from './baby-monitoring.module.css';


// ---------- SVG Icons ----------
const Icons = {
  chevronBack: () => (
    <svg width="20" height="20" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="328 112 184 256 328 400" />
    </svg>
  ),
  settings: () => (
    <svg width="20" height="20" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M262.29 192.31a64 64 0 1 0 57.4 57.4 64.13 64.13 0 0 0-57.4-57.4ZM416.39 256a154.34 154.34 0 0 1-1.53 20.79l45.21 35.46a10.81 10.81 0 0 1 2.45 13.75l-42.77 74a10.81 10.81 0 0 1-13.14 4.59l-44.9-18.08a16.11 16.11 0 0 0-15.17 1.75A164.48 164.48 0 0 1 325 400.8a15.94 15.94 0 0 0-8.82 12.14l-6.73 47.89a11.08 11.08 0 0 1-10.68 9.17h-85.54a11.11 11.11 0 0 1-10.69-8.87l-6.72-47.82a16.07 16.07 0 0 0-9-12.22 155.3 155.3 0 0 1-21.46-12.57 16 16 0 0 0-15.11-1.71l-44.89 18.07a10.81 10.81 0 0 1-13.14-4.58l-42.77-74a10.8 10.8 0 0 1 2.45-13.75l38.21-30a16.05 16.05 0 0 0 6-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16 16 0 0 0-6.07-13.94l-38.19-30A10.81 10.81 0 0 1 49.48 186l42.77-74a10.81 10.81 0 0 1 13.14-4.59l44.9 18.08a16.11 16.11 0 0 0 15.17-1.75A164.48 164.48 0 0 1 187 111.2a15.94 15.94 0 0 0 8.82-12.14l6.73-47.89A11.08 11.08 0 0 1 213.23 42h85.54a11.11 11.11 0 0 1 10.69 8.87l6.72 47.82a16.07 16.07 0 0 0 9 12.22 155.3 155.3 0 0 1 21.46 12.57 16 16 0 0 0 15.11 1.71l44.89-18.07a10.81 10.81 0 0 1 13.14 4.58l42.77 74a10.8 10.8 0 0 1-2.45 13.75l-38.21 30a16.05 16.05 0 0 0-6.05 14.08c.33 4.14.55 8.3.55 12.47Z" />
    </svg>
  ),
  videocam: () => (
    <svg width="24" height="24" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M374.79 308.78 457.5 367a16 16 0 0 0 22.5-14.62V159.62A16 16 0 0 0 457.5 145l-82.71 58.22A16 16 0 0 0 368 216.3v79.4a16 16 0 0 0 6.79 13.08Z" />
      <rect x="44" y="144" width="308" height="224" rx="16" ry="16" />
    </svg>
  ),
  mic: () => (
    <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M256 352a96 96 0 0 0 96-96V160a96 96 0 0 0-192 0v96a96 96 0 0 0 96 96Z" />
      <path d="M160 256c0 52.93 43.06 96 96 96s96-43.07 96-96" fill="none" strokeWidth="32"/>
      <line x1="256" y1="352" x2="256" y2="432" strokeWidth="32"/>
      <line x1="192" y1="432" x2="320" y2="432" strokeWidth="32"/>
    </svg>
  ),
  callEnd: () => (
    <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor" stroke="currentColor" strokeWidth="8">
      <path d="M497 370.13c-8.33-16.67-31.9-26.3-31.9-26.3l-86.7-38.87c-18.33-8.34-41.67-.83-51.67 11.67l-37.5 45.84c-62.5-31.67-107.29-78.33-135.42-135.42l45.84-37.5c12.5-10 20-33.33 11.67-51.67l-38.87-86.7S164.78 23.55 148.11 15.22C130.61 6.89 92.78 15.22 92.78 15.22l-72.9 72.9c-11.67 11.67-16.67 27.5-12.5 45 16.67 75 83.33 195 156.25 268.75 73.75 72.92 193.75 139.58 268.75 156.25 17.5 4.17 33.33-.83 45-12.5l72.9-72.9s8.33-37.83 0-54.59Z" />
    </svg>
  ),
  shield: () => (
    <svg width="12" height="12" viewBox="0 0 512 512" fill="white" stroke="white" strokeWidth="8">
      <path d="M256 32 32 144v112c0 121.84 82.08 235.68 224 272 141.92-36.32 224-150.16 224-272V144Z" />
    </svg>
  ),
  thermometer: () => (
    <svg width="12" height="12" viewBox="0 0 512 512" fill="white" stroke="white" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M352 80a80 80 0 0 0-160 0v214.68a144 144 0 1 0 160 0Z" />
      <line x1="256" y1="272" x2="256" y2="416" />
      <circle cx="256" cy="416" r="48" fill="white" stroke="none"/>
    </svg>
  ),
  drop: () => (
    <svg width="12" height="12" viewBox="0 0 512 512" fill="white" stroke="white" strokeWidth="8">
      <path d="M256 32C198 109 128 191.06 128 260a128 128 0 0 0 256 0c0-69-70-151-128-228Z" />
    </svg>
  ),
};
// --------------------------------------------------------------------------
// PHASE 11 REMOVAL: NurseryCameraFeed (the static drawn "nursery camera")
// --------------------------------------------------------------------------
// This mock SVG used to render whenever no room was available, underneath a
// "LIVE" badge. It was not merely decorative - it was actively misleading:
//   * the "LIVE" pill and "HD 1080p" subtitle claimed a stream that did not
//     exist,
//   * it drew hard-coded sensor badges (22 C, 45% humidity) that nothing ever
//     measured,
//   * it showed a "Secure Connection" badge while the underlying media was the
//     PUBLIC, unencrypted meet.jit.si room, and
//   * it left the parent believing live video was available, which is exactly
//     the false success state the Phase 10 audit recorded as E5 / PARTIAL.
//
// The monitoring screen now renders the real server-issued player when the
// server confirms a media session, and an explicit "live video unavailable"
// message when it does not. Nothing is faked in between.
// --------------------------------------------------------------------------


export default function BabyMonitoringScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId, role } = useAuth();

  // Monitoring scope. Phase 8 makes this screen a real consumer of the
  // monitoring API, which is scoped PER CHILD, so the (job, child) pair has to
  // be known. It arrives either as route state (from the active job screen /
  // a notification) or, as a fallback, from the parent's most recent In Progress
  // job. Nothing is guessed: without a scope the screen says so rather than
  // inventing a child.
  const stateJobId = location.state?.jobId ?? location.state?.Job_ID ?? null;
  const stateChildId = location.state?.childId ?? location.state?.Child_ID ?? null;
  const [scope, setScope] = useState({
    jobId: stateJobId,
    childId: stateChildId,
    childName: location.state?.childName ?? null,
  });
  // Only actually "loading" when we still have to LOOK the scope up.
  const [scopeLoading, setScopeLoading] = useState(!stateJobId && !stateChildId);

  // Fallback: derive the scope from the parent's In Progress job so the screen
  // is reachable from the dashboard even without deep-link state.
  useEffect(() => {
    if (stateJobId) return;
    let cancelled = false;
    // Deferred out of the effect body: this synchronizes with an external
    // system (the API), it is not a derived render value.
    Promise.resolve().then(async () => {
      try {
        const jobs = await API.getParentJobs(userId);
        const list = Array.isArray(jobs) ? jobs : [];
        // Phase 9 fix: the backend actually stores "InProgress" (no space),
        // while this comparison used to require "In Progress". It therefore
        // never matched and silently fell through to `list[0]` - typically a
        // COMPLETED job - so the monitoring screen opened against a finished
        // job and reported "Monitoring not started".
        // Same normalisation convention as MyJobsScreen: trim, lowercase and
        // strip spaces/underscores/hyphens so both spellings compare equal.
        const isInProgress = (status) =>
          String(status ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '') === 'inprogress';
        // Only a genuinely in-progress job may define the scope. Picking an
        // arbitrary job would show monitoring for work that is not running.
        const active = list.find((j) => isInProgress(j?.Status)) ?? null;
        if (cancelled || !active) return;
        const children = Array.isArray(active.Children) ? active.Children : [];
        const child = children[0] ?? null;
        if (!child?.Child_ID) return;
        setScope({
          jobId: active.Job_ID ?? active.jobId,
          childId: child.Child_ID,
          childName: child.ChildName ?? null,
        });
      } catch {
        // A failure here just means no scope could be derived; the screen
        // renders its own explanatory empty state below.
      } finally {
        if (!cancelled) setScopeLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [stateJobId, userId]);

  // One hook owns session start, heartbeat, escalation polling and pause
  // resolution for the whole screen.
  const monitoring = useMonitoring({
    jobId: scope.jobId,
    childId: scope.childId,
    role,
  });
  const { session, incident, offline, error, start, starting } = monitoring;

  // Phase 7 pause + DND read for this scope. Both are parent-only surfaces and
  // both are only ever DISPLAYED from server state; the panel issues the
  // mutations and re-reads afterwards.
  const [pause, setPause] = useState(null);
  const [dndStates, setDndStates] = useState([]);

  const refreshPauseAndDnd = useCallback(async () => {
    if (!scope.jobId || !scope.childId) return;
    try {
      const [p, d] = await Promise.all([
        API.getPause(scope.jobId, scope.childId).catch(() => null),
        API.getDndStates(scope.jobId, scope.childId).catch(() => []),
      ]);
      setPause(p ?? null);
      setDndStates(Array.isArray(d) ? d : []);
    } catch {
      /* keep the last known values; the server stays authoritative */
    }
  }, [scope.jobId, scope.childId]);

  // Re-read whenever the server says the pause state may have moved (a fresh
  // poll) so the countdown and the pending-approval row never go stale. Deferred
  // out of the effect body because this synchronizes with an external system.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) refreshPauseAndDnd();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshPauseAndDnd, session?.IsPaused, pause?.Status]);

  // ---- PHASE 11: media is SERVER-ISSUED, never client-derived ----
  // This used to read `location.state?.roomName`, i.e. a room name handed to the
  // browser through React Router navigation (originally derived from a legacy
  // cry alert). A room name is a routing detail, not a capability: anyone who
  // learned it could join, and nothing on the server had checked. The room and
  // the provider JWT are now minted by the server AFTER MonitoringAccess
  // approves this caller, and `canPublish` is the server's answer, not ours.
  //
  // While no media provider is configured the server replies Configured=false
  // and the screen below shows an honest "live video unavailable" panel. It
  // deliberately renders NO video and no placeholder "camera", because a mock
  // feed under a LIVE badge is a false success state.
  // The session status is the refresh key: the media endpoint only answers for an
  // ACTIVE monitoring session, so Child Mode starting (or ending) is exactly when
  // the media answer changes. Without this the first 404 would stick forever and
  // the parent would be told the stream never became available.
  const media = useMonitoringMedia(
    scope.jobId,
    scope.childId,
    !scopeLoading,
    session?.Status ?? 'none',
  );

  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);


  return (
    <div className={styles.screenContainer}>
      {/* Top Bar */}
      <header className={styles.topNav}>
        <BackButton />
        <h1 className={styles.pageTitle}>Baby Monitor</h1>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Settings"
          onClick={() => navigate('/parent-dashboard')}
        >
          <Icons.settings />
        </button>
      </header>

      {/* Live Badge & Subtitle */}
      <div className={styles.statusHeader}>
        {/* PHASE 11: the "LIVE" pill is shown ONLY when the server has issued a
            real media session. A static LIVE badge over an unavailable
            camera is a false success state, so it is now conditional. */}
        {media.status === 'ready' ? (
          <div className={styles.livePill}>
            <span className={styles.liveBeacon} aria-hidden="true" />
            <span className={styles.liveTag}>LIVE</span>
          </div>
        ) : null}
        {/*
          PHASE 11: this subtitle used to read "Nursery - HD 1080p"
          unconditionally. That is a media CLAIM - it asserted a resolution and a
          live stream that may not exist. It now states the child, and states the
          media state the server actually reported, so "live video" and
          "receive only" are only ever shown when they are true.
        */}
        <p className={styles.locationSubtitle}>
          {scope.childName || 'Child'}
          {media.status === 'ready' ? ' - live video' : ''}
          {media.status === 'ready' && !media.canPublish ? ' - receive only' : ''}
          {media.status === 'unavailable' ? ' - live video not configured' : ''}
          {media.status === 'no-session' ? ' - awaiting Child Mode' : ''}
          {media.status === 'denied' ? ' - not authorised to view' : ''}
        </p>
      </div>

      {/* ---- Phase 8: real, server-driven monitoring state ----
          Previously this screen rendered a static "LIVE" pill over a mock camera
          feed with no backend state at all. Session, connection, pause, alert and
          DND are now shown as SEPARATE facts (they can be true/false
          independently), each derived from the server. */}
      {scopeLoading ? (
        <p role="status" className={styles.monitorNote}>
          Loading your active monitoring session…
        </p>
      ) : !scope.jobId || !scope.childId ? (
        <p role="status" className={styles.monitorNote}>
          No active babysitting session to monitor right now. Start a booking to use
          child monitoring.
        </p>
      ) : (
        <>
          <MonitoringStatusBar
            session={session}
            incident={incident}
            pause={pause}
            dndStates={dndStates}
            offline={offline}
            currentUserId={userId}
          />

          {error ? (
            <p role="alert" className={styles.monitorError}>
              {error}
            </p>
          ) : null}

          {/* Starting a session is a server action. The backend is idempotent:
              it returns the existing Active session rather than creating a
              second one, and refuses anyone who is not an authorized guardian
              or sitter. */}
          {session?.Status !== 'Active' ? (
            <button
              type="button"
              className={styles.startMonitorBtn}
              disabled={starting}
              onClick={start}
            >
              {starting ? 'Starting monitoring…' : 'Start monitoring this child'}
            </button>
          ) : null}

          {scope.childName ? (
            <p className={styles.monitorNote}>
              Monitoring scope: job {scope.jobId}, child {scope.childName}.
            </p>
          ) : null}
        </>
      )}

      {/* ---- PHASE 11: honest media surface ----
          Three genuinely different states, each stated in words rather than
          implied by a colour:
            ready        - the server issued a real session; render the player
            unavailable  - the server says no provider is configured
            denied       - MonitoringAccess refused this caller
          The mock <NurseryCameraFeed /> is deliberately NOT rendered as a
          fallback. A drawn nursery under a "LIVE" badge tells the parent a feed
          exists when none does, which is the false success state the Phase 10
          audit flagged. */}
      {media.status === 'ready' && media.media ? (
        <div className={styles.cameraFrame}>
          {/*
            PHASE 11 SECURITY FIX: `domain` used to be the hard-coded public
            "meet.jit.si", which let anyone who guessed a room name join an
            unencrypted, uncontrolled public host - exactly the "room-name-only
            access" the audit forbids. The tenant host now comes from the server
            (Web.config MonitoringMediaDomain) and the request is authenticated
            with a short-lived server-signed JWT. `canPublish` is the server's
            answer, so a sitter is never offered a publish control.
          */}
          <JitsiMeeting
            roomName={media.media.RoomName}
            domain={media.media.Domain}
            jwt={media.media.Token}
            configOverwrite={{
              startWithAudioMuted: !media.canPublish,
              startWithVideoMuted: !media.canPublish,
              // A receive-only viewer must not be offered a publish button.
              ...(media.canPublish
                ? {}
                : { startAudioMuted: true, startVideoMuted: true }),
              disableDeepLinking: true,
            }}
            interfaceConfigOverwrite={{
              SHOW_JITSI_WATERMARK: false,
              SHOW_WATERMARK_FOR_GUESTS: false,
              TOOLBAR_BUTTONS: media.canPublish
                ? ['microphone', 'camera', 'fullscreen', 'hangup']
                : ['fullscreen', 'hangup'],   // sitter: no mic, no camera
            }}
            getIFrameRef={(iframe) => {
              if (iframe) {
                iframe.style.height = '100%';
                iframe.style.width = '100%';
                iframe.style.border = 'none';
              }
            }}
          />
        </div>
      ) : (
        <div className={styles.cameraFrame}>
          <p role="status" className={styles.mediaNote}>
            {media.status === 'loading' && 'Connecting to the live baby monitor...'}
            {media.status === 'unavailable' &&
              (media.reason ||
                'Live video is not configured on this deployment. Monitoring status, cry alerts and the pause controls above are fully active.')}
            {media.status === 'denied' && media.reason}
            {media.status === 'no-session' && media.reason}
            {media.status === 'error' && media.reason}
            {media.status === 'idle' &&
              'Start Child Mode on the monitoring phone to see live video here.'}
          </p>
        </div>
      )}

      {/* Hardware / Session Controls */}
      <div className={styles.controlsRow}>
        {/* Camera toggle */}
        <div className={styles.controlItem}>
          <button
            type="button"
            onClick={() => setCameraOn(!cameraOn)}
            className={`${styles.controlBtn} ${cameraOn ? styles.controlBtnDefault : styles.controlBtnDanger}`}
            aria-label={cameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
          >
            <Icons.videocam />
          </button>
          <span className={styles.controlLabel}>{cameraOn ? 'Camera On' : 'Camera Off'}</span>
        </div>

        {/* Mic toggle */}
        <div className={styles.controlItem}>
          <button
            type="button"
            onClick={() => setMicOn(!micOn)}
            className={`${styles.controlBtn} ${micOn ? styles.controlBtnPrimary : styles.controlBtnDefault}`}
            aria-label={micOn ? 'Mute Microphone' : 'Unmute Microphone'}
          >
            <Icons.mic />
          </button>
          <span className={styles.controlLabel}>{micOn ? 'Mic Active' : 'Mic Muted'}</span>
        </div>

        {/* End / Return */}
        <div className={styles.controlItem}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className={`${styles.controlBtn} ${styles.controlBtnDanger}`}
            aria-label="Exit Monitor"
          >
            <Icons.callEnd />
          </button>
          <span className={styles.controlLabel}>Exit</span>
        </div>
      </div>

      {/* Phase 7 family surface, now reachable from the normal parent journey
          instead of being a standalone component. It is parent-only and is
          rendered only when a real (job, child) scope exists, because every
          guardian/pause/DND endpoint is scoped per child. */}
      {scope.jobId && scope.childId ? (
        <Phase7FamilyPanel jobId={scope.jobId} childId={scope.childId} />
      ) : null}

      {/* Bottom Navigation */}
      <ParentBottomNav />
    </div>
  );
}

