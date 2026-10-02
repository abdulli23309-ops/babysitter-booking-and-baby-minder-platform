/**
 * MonitoringMediaPanel - the live-video surface for baby monitoring.
 *
 * WHY THIS IS A COMPONENT
 *   The media state has SEVEN genuinely different conditions, and the previous
 *   inline markup could not present them without either faking "LIVE" or
 *   showing a raw error string. Centralising it here means every state has one
 *   honest rendering, reused by both the parent and the sitter screen.
 *
 * THE RULE THIS ENFORCES
 *   "Live" is shown if and only if the provider has genuinely established a
 *   session. The media hook reports readiness ONLY when the server returned a
 *   real, signed media session (MediaSessionService), so this component never
 *   has to guess. With no provider configured the server says
 *   `Configured: false` and this panel says so in words.
 *
 * NEVER rendered here: fake sensor readings, "HD 1080p", a "Secure
 * Connection" badge over a stream that does not exist, or a mock nursery.
 *
 * PROPS
 *   status     - 'idle' | 'loading' | 'ready' | 'unavailable' | 'no-session' |
 *                'denied' | 'error'
 *   media      - the server-issued media DTO (null unless status === 'ready')
 *   canPublish - the SERVER's publish permission (a sitter is always false)
 *   reason     - the server's own human-readable explanation
 *   childName  - used in the empty states so the panel is never context-free
 */
import { useEffect, useState } from 'react';
import styles from './monitoring-media.module.css';

/* Inline icons keep this dependency-free and legible down to 320px. */
const IconCameraOff = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 7.5A2.5 2.5 0 0 1 4.5 5h9A2.5 2.5 0 0 1 16 7.5v7A2.5 2.5 0 0 1 13.5 17h-9A2.5 2.5 0 0 1 2 14.5z" />
    <path d="M16 10.5l5-3v9l-5-3" />
    <path d="M3 3l18 18" />
  </svg>
);
const IconShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
    <path d="M9.5 12.2l1.8 1.8 3.4-3.6" />
  </svg>
);
const IconLock = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);
const IconSpinner = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" aria-hidden="true" className={styles.spin}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);

/* One row of copy per state. Keeping the wording here, rather than inline at
   each call site, is what stops a later edit quietly re-introducing a claim. */
function copyFor({ status, childName, reason }) {
  const who = childName ? ` for ${childName}` : '';
  switch (status) {
    case 'loading':
      return {
        title: 'Connecting to the baby monitor',
        body: 'Checking with the server whether live video is available.',
        tone: 'pending',
      };
    case 'unavailable':
      return {
        title: 'Live video is not configured',
        body: reason
          || `This deployment has no live video provider set up, so no camera feed is available${who}. Monitoring, cry detection and alerts all still work normally.`,
        tone: 'neutral',
      };
    case 'no-session':
      return {
        title: 'Waiting for Child Mode',
        body: reason || 'Live video appears automatically once Child Mode is started on the monitoring phone.',
        tone: 'pending',
      };
    case 'denied':
      return { title: 'Not authorised to view', body: reason || 'You are not authorised to watch this child.', tone: 'blocked' };
    case 'error':
      return { title: 'Live video unavailable', body: reason || 'The live video service could not be reached.', tone: 'blocked' };
    case 'idle':
    default:
      return { title: 'No active monitoring session', body: 'Start Child Mode to monitor this child.', tone: 'neutral' };
  }
}


/* PHASE 12 - MIROTALK MEDIA STATE.
   The previous provider exposed a rich per-participant event API
   (participantJoined, videoConferenceJoined, participantMuted, ...). MiroTalk is
   embedded as an iframe, and a cross-origin iframe deliberately does NOT leak
   that detail back to us - and it should not.

   So this panel no longer claims to know anything about the remote feed that it
   cannot actually observe. It reports only two honest facts:

     'loaded'      - the SFU room page finished loading; this does not prove
                    WebRTC connected or that media is flowing.
     'lost'       - the surrounding monitoring session stopped being healthy,
                    which is Little Care's own heartbeat/polling signal.

   That is a real reduction in what the UI can say, and it is the honest one:
   we no longer label the remote camera as muted/unmuted from data we do not
   have. The device rows below are therefore described by our ROLE (publisher
   publishes, viewer listens) rather than by a guessed per-track state. */
/* How long the SFU surface may take to load before we stop claiming
   "Connecting" and admit the surface did not come up. */
const FRAME_LOAD_TIMEOUT_MS = 15000;

export default function MonitoringMediaPanel({ status, media, canPublish, reason, childName, variant = 'hero' }) {
  // The room is SERVER-DERIVED. The browser never builds it, never picks it and
  // never sees the salt; it only concatenates the address and join path the
  // backend authorised for this specific session.
  const scopeKey = media ? `${media.MonitorSessionId}:${media.RoomId}` : '';
  const frameSrc = media && media.ServerUrl && media.JoinPath ? `${media.ServerUrl}${media.JoinPath}` : '';

  /* The "connecting" state is DERIVED rather than stored, which is what the
     project already does in useMonitoringMedia: we have no load confirmation
     for the CURRENT frame yet, so we are connecting. Writing 'connecting' in an
     effect would cascade a render for a value we can compute anyway. */
  const [loadedScopeKey, setLoadedScopeKey] = useState(null);
  const frameLoaded = loadedScopeKey === scopeKey && Boolean(frameSrc);

  useEffect(() => {
    if (!frameSrc) return undefined;
    // If the surface never loads we stop claiming "Connecting" and admit the
    // surface did not come up, rather than showing an endless spinner.
    const timer = setTimeout(() => setLoadedScopeKey(`error:${scopeKey}`), FRAME_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [frameSrc, scopeKey]);

  const conferenceStatus = !frameSrc
    ? 'error'
    : frameLoaded
      ? 'loaded'
      : loadedScopeKey === `error:${scopeKey}`
        ? 'error'
        : 'connecting';
  // --- REAL live state: the server issued an authorised media session -------
  if (status === 'ready' && media) {
    const frameClass = variant === 'card' ? `${styles.frame} ${styles.cardFrame}` : styles.frame;
    /* A publisher is the device holding the camera, so its rows describe THIS
       client. A viewer only receives, so we must not imply it controls a
       camera it does not have. Both readings are true on their own side. */
    const rowState = 'checking';
    return (
      <section className={styles.mediaSurface} aria-label="Live monitoring media">
        <div className={frameClass} data-state={conferenceStatus}>
          {/* This bar is the ONLY thing labelling the video, and it is entirely
              our React markup. It carries the whole "this is a baby monitor, not
              a meeting" message: who is being watched, that the feed is live, and
              whether this device is the one holding the camera. */}
          <div className={styles.liveBar} role="status">
            <span className={styles.liveDot} aria-hidden="true" data-connected="false" />
            <span className={styles.liveText}>
              {conferenceStatus === 'error' ? 'Room unavailable' : frameLoaded ? 'Room loaded' : 'Opening room'}
            </span>
            <span className={styles.liveDivider} aria-hidden="true" />
            <span className={styles.liveMeta}>
              {/* Deliberately NOT "receive only": that is transport vocabulary
                  and reads as a caller's permissions panel. This says whose
                  camera is on screen, which is what a monitor is about. */}
              {frameLoaded ? 'Media status is not available here' : 'Opening the monitoring room'}
            </span>
          </div>
          {frameSrc ? (
            /* The media surface itself. The SFU is a separate origin on purpose:
               it can neither read our DOM nor our session, and we cannot read
               its internals. Only the server decides which room this is. The
               `allow` list is what permits the SFU to ask for the camera and
               microphone - it grants the PERMISSION PROMPT, nothing more. */
            <iframe
              key={frameSrc}
              className={styles.frameElement}
              title={`Live monitoring media${childName ? ` for ${childName}` : ''}`}
              src={frameSrc}
              allow={canPublish
                ? 'camera; microphone; fullscreen; display-capture; autoplay'
                : 'fullscreen; autoplay'}
              allowFullScreen
              referrerPolicy="no-referrer"
              onLoad={() => setLoadedScopeKey(scopeKey)}
            />
          ) : (
            /* Server said Configured but gave us no address/room. Say so rather
               than render an empty black box that looks like a dead camera. */
            <div className={styles.player} data-state="error" role="status">
              <p className={styles.emptyBody}>Live video could not be prepared. Please try again.</p>
            </div>
          )}
        </div>
        {/* These rows describe OUR OWN ROLE, which the server derived. They are
            not a claim about the remote feed: a cross-origin surface cannot tell
            us whether the baby's camera is momentarily muted, and we will not
            invent that. */}
        <div className={styles.mediaDetails} aria-label="Camera and microphone status">
          <span className={styles.mediaFact} data-state={rowState}>
            <span className={styles.factDot} aria-hidden="true" />
            {canPublish ? 'Publisher role' : 'Viewer role'}
          </span>
          <span className={styles.mediaFact} data-state={rowState}>
            <span className={styles.factDot} aria-hidden="true" />
            {canPublish ? 'Camera and microphone permission available' : 'Camera and microphone disabled'}
          </span>
          {/* The one-line statement of what the screen is, rendered by us.
              "Listening in" is the viewer's role: they are watching a baby, not
              in a meeting. */}
          <span className={styles.mediaFact} data-state={rowState}>
            <span className={styles.factDot} aria-hidden="true" />
            {frameLoaded ? 'Monitoring room page loaded' : 'Monitoring room opening'}
          </span>
        </div>
        {/* Device controls are NOT rendered here. Mute/unmute is now performed
            by the SFU's own in-frame toolbar, because we can no longer reach
            across the origin boundary to command it. Rendering a second,
            non-functional copy would be a lie. */}
      </section>
    );
  }

  // --- Honest empty state ---------------------------------------------------
  const { title, body, tone } = copyFor({ status, childName, reason });
  return (
    <div className={styles.frame} data-tone={tone}>
      <div className={styles.empty} role="status" aria-live="polite">
        <div className={styles.emptyIcon} aria-hidden="true">
          {status === 'loading' ? <IconSpinner /> : status === 'denied' ? <IconLock /> : <IconCameraOff />}
        </div>
        <p className={styles.emptyTitle}>{title}</p>
        <p className={styles.emptyBody}>{body}</p>
        {/* This note describes the DESIGN (access is authorised per child), not a
            claim about a particular stream, so it stays true in every state. */}
        <p className={styles.emptyNote}>
          <IconShield />
          <span>Video access is authorised per child and never open to other families.</span>
        </p>
      </div>
    </div>
  );
}

