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
import { useCallback, useMemo, useState } from 'react';
import { JitsiMeeting } from '@jitsi/react-sdk';
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


export default function MonitoringMediaPanel({ status, media, canPublish, reason, childName }) {
  // A server-issued token means the provider is configured, not that a media
  // connection has succeeded. Only Jitsi's conference-joined event may promote
  // the UI to Connected/Live; the empty player, timeout and errors stay honest.
  const scopeKey = media ? `${media.MonitorSessionId}:${media.RoomName}` : '';
  const [conference, setConference] = useState({ scopeKey: '', status: 'connecting' });
  const conferenceStatus = conference.scopeKey === scopeKey ? conference.status : 'connecting';
  const configOverwrite = useMemo(() => ({
    // A receive-only viewer starts muted in BOTH directions and is never
    // handed a publish control.
    startWithAudioMuted: !canPublish,
    startWithVideoMuted: !canPublish,
    prejoinPageEnabled: false,
    disableDeepLinking: true,
  }), [canPublish]);
  const interfaceConfigOverwrite = useMemo(() => ({
    SHOW_JITSI_WATERMARK: false,
    SHOW_WATERMARK_FOR_GUESTS: false,
    TOOLBAR_BUTTONS: [],
  }), []);
  const bindConferenceEvents = useCallback((api) => {
    if (!api) return;
    const update = (nextStatus) => setConference({ scopeKey, status: nextStatus });
    const joined = () => update('connected');
    const left = () => update('lost');
    const failed = () => update('error');
    api.on('videoConferenceJoined', joined);
    api.on('videoConferenceLeft', left);
    api.on('errorOccurred', failed);
  }, [scopeKey]);
  const markConnectionLost = useCallback(
    () => setConference({ scopeKey, status: 'lost' }),
    [scopeKey],
  );

  // --- REAL live state: the server issued a signed session -----------------
  if (status === 'ready' && media) {
    const isConnected = conferenceStatus === 'connected';
    return (
      <div className={styles.frame} data-state={conferenceStatus}>
        <div className={styles.liveBar} role="status">
          <span className={styles.liveDot} aria-hidden="true" data-connected={isConnected} />
          <span className={styles.liveText}>
            {isConnected ? 'Live' : conferenceStatus === 'lost' ? 'Connection lost' : conferenceStatus === 'error' ? 'Connection error' : 'Connecting'}
          </span>
          <span className={styles.liveDivider} aria-hidden="true" />
          <span className={styles.liveMeta}>
            {isConnected ? (canPublish ? 'Camera and microphone connected' : 'Receive only') : 'Waiting for the media service to connect'}
          </span>
        </div>
        <div className={styles.player}>
          <JitsiMeeting
            roomName={media.RoomName}
            /* The domain is supplied by the server (Web.config MonitoringMediaDomain).
               It used to be the hard-coded public "meet.jit.si", which meant anyone
               who guessed a room name could join an unencrypted, uncontrolled public
               host. The tenant host plus a server-signed JWT is the fix, and the
               private key never leaves the server. */
            domain={media.Domain}
            jwt={media.Token}
            configOverwrite={configOverwrite}
            interfaceConfigOverwrite={interfaceConfigOverwrite}
            onApiReady={bindConferenceEvents}
            onReadyToClose={markConnectionLost}
            getIFrameRef={(iframe) => {
              if (iframe) {
                iframe.style.height = '100%';
                iframe.style.width = '100%';
                iframe.style.border = 'none';
              }
            }}
          />
        </div>
      </div>
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
