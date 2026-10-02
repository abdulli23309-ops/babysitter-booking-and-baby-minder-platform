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
import { useEffect, useRef, useState } from 'react';
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
  const frameOrigin = media && media.ServerUrl ? new URL(media.ServerUrl).origin : '';

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

  /* ---- Native controls, backed by the real media layer -------------------
     The SFU runs on a different origin, so this app cannot reach into it and
     cannot simply call its API. What it CAN do is talk to the embed bridge
     that ships with our own self-hosted deployment, which is loaded only
     because the server put ?embed=1 in the join path.

     The bridge does not simulate anything: it clicks the SFU's own
     start/stop audio and video buttons and reports the resulting true track
     state back. Until that bridge has actually answered, `bridgeReady` is
     false and the controls render DISABLED. We would rather show a control
     that is visibly unavailable than a button that silently does nothing. */
  const [mediaState, setMediaState] = useState({ audio: false, video: false });
  const [bridgeReady, setBridgeReady] = useState(false);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!frameLoaded || !frameOrigin) return undefined;
    const onMessage = (event) => {
      // Only the SFU origin may drive these controls.
      if (event.origin !== frameOrigin) return;
      if (!event.data || event.data.type !== 'littlecare:state') return;
      setMediaState({ audio: Boolean(event.data.audio), video: Boolean(event.data.video) });
      setBridgeReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameLoaded, frameOrigin]);

  const sendCommand = (action) => {
    const target = frameRef.current?.contentWindow;
    if (!target) return;
    // postMessage to the SFU origin, never '*'.
    target.postMessage({ type: 'littlecare:command', action }, frameOrigin);
  };

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
    /* These states are OURS. They deliberately describe the monitoring
       session, not the SFU: the user should never see two competing
       "connecting / unavailable" messages, and must never see raw provider
       vocabulary inside the feed. */
    const stateLabel = !frameSrc
      ? 'Preparing live video'
      : conferenceStatus === 'error'
        ? 'Connection lost'
        : frameLoaded
          ? 'Monitoring active'
          : 'Opening monitoring room';
    return (
      <section className={styles.mediaSurface} aria-label="Live monitoring media">
        <div className={frameClass} data-state={conferenceStatus}>
          {frameSrc ? (
            /* The media surface. The SFU is a separate origin on purpose: it
               can neither read our DOM nor our session. The join URL carries
               ?embed=1, which makes the SFU hide its own conference chrome and
               accept the control commands below. The `allow` list is what lets
               the SFU ask for camera and microphone - it grants the permission
               PROMPT only. A viewer is not granted camera/microphone at all,
               so the parent's browser is never prompted to publish. */
            <iframe
              key={frameSrc}
              ref={frameRef}
              className={styles.frameElement}
              title={`Live monitoring media${childName ? ` for ${childName}` : ''}`}
              src={frameSrc}
              allow={canPublish ? 'camera; microphone; fullscreen; autoplay' : 'fullscreen; autoplay'}
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

        {/* ONE honest status line, owned by Little Care. */}
        <div className={styles.liveBar} role="status">
          <span
            className={styles.liveDot}
            aria-hidden="true"
            data-connected={frameLoaded ? 'true' : 'false'}
          />
          <span className={styles.liveText}>{stateLabel}</span>
          <span className={styles.liveDivider} aria-hidden="true" />
          <span className={styles.liveMeta}>
            {canPublish ? `${childName || 'Baby'}’s camera` : 'Listening in'}
          </span>
        </div>

        {/* Native Little Care controls, in the document flow BELOW the video.
            Only the publisher gets them: a viewer has no camera or microphone
            to control, and offering those buttons to a parent would invite
            exactly the accidental publishing this design forbids. */}
        {canPublish ? (
          <div className={styles.mediaControls} aria-label="Monitor device controls">
            <button
              type="button"
              className={styles.mediaControl}
              data-on={mediaState.video ? 'true' : 'false'}
              disabled={!bridgeReady}
              aria-pressed={mediaState.video}
              onClick={() => sendCommand('toggleVideo')}
            >
              {mediaState.video ? 'Turn camera off' : 'Turn camera on'}
            </button>
            <button
              type="button"
              className={styles.mediaControl}
              data-on={mediaState.audio ? 'true' : 'false'}
              disabled={!bridgeReady}
              aria-pressed={mediaState.audio}
              onClick={() => sendCommand('toggleAudio')}
            >
              {mediaState.audio ? 'Mute microphone' : 'Unmute microphone'}
            </button>
            {!bridgeReady ? (
              <span className={styles.mediaControlNote}>Preparing device controls…</span>
            ) : null}
          </div>
        ) : null}
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

