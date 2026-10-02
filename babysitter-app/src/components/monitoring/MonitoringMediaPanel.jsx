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
import { useCallback, useMemo, useRef, useState } from 'react';
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


/* PHASE 8.9 - REMOTE MEDIA STATE.
   The two "availability" facts are now kept strictly apart from the two
   "remote participant" facts, because Jitsi's API contract makes them
   different things (verified against jitsi-meet modules/API/API.js):

     videoAvailabilityChanged / audioAvailabilityChanged
         payload is { available } ONLY. It reports THIS client's own capture
         device. For a receive-only viewer that device is muted and may be
         absent, so these events say NOTHING about the baby. Using them to
         describe the remote feed made the panel show "Camera unavailable"
         while the baby's video was actually streaming.

     participantJoined / participantLeft
         payload is { id } - the only way to know a remote participant exists.

     participantMuted
         payload is { id, isMuted, mediaType } with mediaType 'audio'|'video' -
         the only per-remote-participant track signal the external API offers.
         It is the honest source for "the baby's camera/mic is connected". */
const emptyConference = (scopeKey) => ({
  scopeKey,
  status: 'connecting',
  audioMuted: null,
  videoMuted: null,
  // This client's own capture device (meaningful for a publisher only).
  audioAvailable: null,
  videoAvailable: null,
  // The remote participant's tracks, for a receive-only viewer.
  remoteId: null,
  remoteAudioMuted: null,
  remoteVideoMuted: null,
  audioError: false,
  videoError: false,
});

export default function MonitoringMediaPanel({ status, media, canPublish, reason, childName, variant = 'hero' }) {
  // A server-issued token means the provider is configured, not that a media
  // connection has succeeded. Only Jitsi's conference-joined event may promote
  // the UI to Connected/Live; the empty player, timeout and errors stay honest.
  const scopeKey = media ? `${media.MonitorSessionId}:${media.RoomName}` : '';
  const [conference, setConference] = useState(() => emptyConference(''));
  const apiRef = useRef(null);
  const localParticipantIdRef = useRef('');
  const liveConference = conference.scopeKey === scopeKey ? conference : emptyConference(scopeKey);
  const conferenceStatus = liveConference.status;
  /* PHASE 8.9 - EVERY KEY BELOW IS VERIFIED AGAINST THE Jitsi SOURCE.
     configOverwrite maps to jitsi-meet's `config` namespace, which is gated by
     react/features/base/config/configWhitelist.ts. A key that is not on that
     whitelist is silently dropped by Jitsi, so a flag that is merely plausible
     is a flag that does nothing. The audit that produced this object removed
     every key that failed that test (see the JITSI FLAG LEDGER further down). */
  const configOverwrite = useMemo(() => ({
    /* --- JOIN BEHAVIOUR (all whitelisted) ------------------------------- */
    // No prejoin lobby: a monitor must not show a "Join meeting" screen.
    prejoinConfig: { enabled: false },
    // A receive-only viewer stays muted in BOTH directions and is never handed
    // a publish control; the paired device opens with its camera on so the feed
    // is useful immediately. These are `startWith*` (not `startMuted*`) keys.
    startWithAudioMuted: !canPublish,
    startWithVideoMuted: !canPublish,
    disableDeepLinking: true,

    /* --- THE MONITORING-FEED PRESENTATION ------------------------------- */
    // `filmstrip` is a whitelisted NAMESPACE, so all of these are honoured.
    // This is the single most important key for the whole task: the previous
    // build used a non-existent `DISABLE_FILMSTRIP` interface flag, so the
    // filmstrip was never actually suppressed and the feed rendered as a row of
    // participant tiles - the exact "video conference" look being removed.
    filmstrip: {
      // No vertical/horizontal filmstrip at all.
      disabled: true,
      // No floating thumbnails around the large video.
      disableStageFilmstrip: true,
      // No top panel (only relevant while screen sharing, but it is the same
      // conference-layout chrome).
      disableTopPanel: true,
    },
    // There is no grid to fall back to, so the tile/grid metaphor is removed
    // outright rather than merely being unused.
    disableTileView: true,
    // Present the single feed CONTAINED in the frame at its own 16:9 aspect
    // instead of enlarged to cover the frame, which is what crops a camera
    // image and makes the panel read like a meeting stage.
    disableTileEnlargement: true,
    // Explicitly KEEP 1-on-1 mode. With exactly one remote publisher this is
    // the layout that promotes the remote feed to the large surface. (It is the
    // upstream default, but the 8x8.vc tenant config is not ours to trust, so
    // the intent is stated rather than assumed.)
    disable1On1Mode: false,
    // A viewer must not be presented as another person watching the baby. This
    // is the supported, first-class Jitsi control for exactly that, and it only
    // removes the LOCAL self tile - the remote video is untouched. It is
    // deliberately NOT applied to the publisher, who still needs to see their
    // own framing to aim the camera.
    disableSelfView: !canPublish,
    // ...and the viewer must not be able to switch it back on from Jitsi's own
    // settings dialog, which would reintroduce the self tile.
    disableSelfViewSettings: !canPublish,

    /* --- CONFERENCE CHROME / MEETING LANGUAGE -------------------------- */
    // The header's participant counter, subject, timer and quality label are
    // the "this is a meeting" signals. `conferenceInfo` is whitelisted; a label
    // id in neither array is not rendered at all, so listing every id under
    // autoHide empties the header.
    conferenceInfo: {
      alwaysVisible: [],
      autoHide: [
        'subject',
        'conference-timer',
        'participants-count',
        'e2ee',
        'video-quality',
        'insecure-room',
        'highlight-moment',
        'top-panel-toggle',
        'recording',
        'raised-hands-count',
      ],
    },
    hideConferenceSubject: true,
    hideConferenceTimer: true,
    hideRecordingLabel: true,
    hideParticipantsStats: true,
    // Suppresses the dominant-speaker badge that hovers over the toolbox.
    hideDominantSpeakerBadge: true,
    // No participant name labels drawn on the video.
    hideDisplayName: true,
    // No speaker bars / audio-level meters on the tile.
    disableAudioLevels: true,
    // No focus tint, which would otherwise frame the feed like a selected
    // conference participant.
    disableModeratorIndicator: true,
    // Chat, reactions and polls are meeting features with no purpose on a baby
    // monitor, and each is an entry point back into the conference UI.
    disableChat: true,
    disableReactions: true,
    disableReactionsInChat: true,
    disablePolls: true,
    disableProfile: true,
    // No "invite someone" affordance anywhere.
    disableInviteFunctions: true,
    hideAddRoomButton: true,
    // No Jitsi watermark/logo in the corner of the feed. This key is on the
    // *embedded* config whitelist, which is what this app always is; the old
    // interface-level `DEFAULT_LOGO_URL` was not whitelisted and did nothing.
    defaultLogoUrl: '',
  }), [canPublish]);
  /* PHASE 8.9 - interfaceConfig is a SEPARATE namespace from config, gated by its
     own list: react/features/base/config/interfaceConfigWhitelist.ts. It is
     marked deprecated upstream ("no new options should be added here") and most
     of the flags this object used to carry are NOT on that whitelist, which is
     why they had no effect. Every surviving key below is on the whitelist.

     JITSI FLAG LEDGER (what the Phase 8.8 audit found, and why each key moved,
     was replaced or was deleted):

       TOOLBAR_BUTTONS: []              KEPT   - on the interface whitelist. An
                                                    empty list removes the whole
                                                    Jitsi toolbar, so the only
                                                    controls on screen are this
                                                    app's own (see .deviceControls).
       DISABLE_DOMINANT_SPEAKER_INDICATOR KEPT  - on the interface whitelist.
       DISABLE_VIDEO_BACKGROUND: true    KEPT   - on the interface whitelist. It
                                                    is the interface-level twin of
                                                    the config-level
                                                    `disableVideoBackgrounds`; the
                                                    old file had it under the wrong
                                                    namespace (`VIDEO_BACKGROUND`).
       DISABLE_FOCUS_INDICATOR: true     KEPT   - on the interface whitelist,
                                                    but the config-level
                                                    `disableModeratorIndicator`
                                                    above is now the primary
                                                    control and this is redundant
                                                    belt-and-braces.
       SHOW_CHROME_EXTENSION_BANNER:false KEPT  - on the interface whitelist.

       DISABLE_FILMSTRIP: true     REMOVED - not a Jitsi key at all, in either
                                                    namespace. The filmstrip was
                                                    therefore NEVER suppressed,
                                                    which is why the feed looked
                                                    like a conference. Replaced by
                                                    the whitelisted `filmstrip`
                                                    config namespace above.
       VIDEO_BACKGROUND: false     REMOVED - not a real Jitsi key. It was a
                                                    guess at DISABLE_VIDEO_BACKGROUND
                                                    and was doing nothing.
       SHOW_JITSI_WATERMARK /          REMOVED - all four are absent from
       SHOW_WATERMARK_FOR_GUESTS /               interfaceConfigWhitelist, so
       SHOW_BRAND_WATERMARK /                     Jitsi discarded them. The
       SHOW_PROMOTIONAL_CLOSE_PAGE               watermark/logo is now suppressed
                                                    through the whitelisted
                                                    config-level `defaultLogoUrl`.
       DISABLE_RATING                REMOVED - not on the whitelist.
       DEFAULT_LOGO_URL: ''         REMOVED - deprecated; upstream moved it to
                                                    config.js `defaultLogoUrl`,
                                                    which IS whitelisted.
       CONFERENCE_FOOTER_TOGGLE: []  REMOVED - not on the whitelist.
       HIDE_GUESTS_PROFILE_PICTURES  REMOVED - not on the whitelist. The
                                                    avatar concern is handled by
                                                    `hideDisplayName` plus the
                                                    blank displayName below.
       DISABLE_AUDIO_ONLY_BACKGROUND  REMOVED - not on the whitelist.
       DISABLE_PARTICIPANT_JOINER:false REMOVED- not on the whitelist, and it was
                                                    set to its default anyway, so
                                                    it was pure noise.
  */
  const interfaceConfigOverwrite = useMemo(() => ({
    // Removes Jitsi's entire toolbar: no hangup, invite, chat, settings or
    // participants-pane button. This is what stops the panel reading as a call.
    TOOLBAR_BUTTONS: [],
    // No dominant-speaker border/indicator on the video.
    DISABLE_DOMINANT_SPEAKER_INDICATOR: true,
    // PHASE 8.9 - FOUND IN THE REAL BROWSER, NOT GUESSED. A live capture of the
    // viewer iframe showed a 32x28 on-screen label at the top of the feed
    // reading "Performance settings" inside Jitsi's conference-info container
    // (`div#autoHide.subject.visible`). That is Jitsi's VIDEO QUALITY label, and
    // it is conference chrome: it is the only remaining piece of meeting
    // language in the header. `video-quality` cannot be removed from the
    // conferenceInfo.autoHide list (that is a header-CHROME key, a different
    // element), so it is switched off at its own source. This key is on the
    // interfaceConfig whitelist and is honoured in embedded mode.
    VIDEO_QUALITY_LABEL_DISABLED: true,
    // No blurred "video background" behind the large tile, which is otherwise
    // drawn as a soft glowing backdrop - visual noise around the one feed.
    DISABLE_VIDEO_BACKGROUND: true,
    DISABLE_FOCUS_INDICATOR: true,
    // No "install the Chrome extension" nag on first join.
    SHOW_CHROME_EXTENSION_BANNER: false,
  }), []);
  /* PHASE 8.5 - an empty displayName stops Jitsi deriving an initial-based
     avatar from the participant name. The blank string is deliberate; it must
     not be left undefined, or Jitsi falls back to the URL/user id and re-creates
     the same giant avatar. */
  const userInfo = useMemo(() => ({ displayName: ' ' }), []);
  const bindConferenceEvents = useCallback((api) => {
    if (!api) return;
    apiRef.current = api;
    const update = (patch) => setConference((current) => ({
      ...(current.scopeKey === scopeKey ? current : emptyConference(scopeKey)),
      ...patch,
      scopeKey,
    }));
    const readMuteState = (method, key) => {
      try {
        Promise.resolve(api[method]()).then((muted) => update({ [key]: Boolean(muted) })).catch(() => {});
      } catch {
        // A later mute-status event may still report the state.
      }
    };
    const joined = (event = {}) => {
      localParticipantIdRef.current = event.id || '';
      update({ status: 'connected' });
      readMuteState('isAudioMuted', 'audioMuted');
      readMuteState('isVideoMuted', 'videoMuted');
    };
    const left = () => update({ status: 'lost' });
    const failed = () => update({ status: 'error' });
    const audioMuteChanged = ({ muted } = {}) => update({ audioMuted: Boolean(muted) });
    const videoMuteChanged = ({ muted } = {}) => update({ videoMuted: Boolean(muted) });
    /* PHASE 8.9 - these two events report THIS CLIENT'S OWN capture device
       (payload `{ available }`, with NO participant id). Only a publisher has a
       capture device that means anything, so for a viewer they are ignored
       rather than being misreported as the baby's camera/mic. */
    const audioAvailabilityChanged = ({ available } = {}) => {
      if (!canPublish) return;
      update({ audioAvailable: Boolean(available) });
    };
    const videoAvailabilityChanged = ({ available } = {}) => {
      if (!canPublish) return;
      update({ videoAvailable: Boolean(available) });
    };
    /* The remote participant's own tracks: `{ id, isMuted, mediaType }`. */
    const participantMuted = ({ id, isMuted, mediaType } = {}) => {
      if (!id || id === localParticipantIdRef.current) return;
      if (mediaType === 'audio') update({ remoteAudioMuted: Boolean(isMuted) });
      else if (mediaType === 'video') update({ remoteVideoMuted: Boolean(isMuted) });
    };
    const participantJoined = ({ id } = {}) => {
      if (!id || id === localParticipantIdRef.current) return;
      // The first remote participant seen is "the baby" for this panel. Their
      // initial mute state is not reported until a track event arrives, so both
      // facts stay null (= "checking") rather than being guessed.
      setConference((current) => (
        current.scopeKey === scopeKey && current.remoteId
          ? current
          : {
            ...(current.scopeKey === scopeKey ? current : emptyConference(scopeKey)),
            scopeKey,
            remoteId: id,
          }
      ));
    };
    const participantLeft = ({ id } = {}) => {
      if (!id) return;
      setConference((current) => (
        current.scopeKey === scopeKey && current.remoteId === id
          ? { ...current, remoteId: null, remoteAudioMuted: null, remoteVideoMuted: null }
          : current
      ));
    };
    const cameraFailed = () => update({ videoError: true, videoAvailable: false });
    const microphoneFailed = () => update({ audioError: true, audioAvailable: false });
    api.on('videoConferenceJoined', joined);
    api.on('videoConferenceLeft', left);
    api.on('errorOccurred', failed);
    api.on('audioMuteStatusChanged', audioMuteChanged);
    api.on('videoMuteStatusChanged', videoMuteChanged);
    api.on('audioAvailabilityChanged', audioAvailabilityChanged);
    api.on('videoAvailabilityChanged', videoAvailabilityChanged);
    api.on('participantMuted', participantMuted);
    api.on('participantJoined', participantJoined);
    api.on('participantLeft', participantLeft);
    api.on('micError', microphoneFailed);
    api.on('cameraError', cameraFailed);
  }, [canPublish, scopeKey]);
  const markConnectionLost = useCallback(
    () => setConference((current) => ({
      ...(current.scopeKey === scopeKey ? current : emptyConference(scopeKey)),
      scopeKey,
      status: 'lost',
    })),
    [scopeKey],
  );

  const toggleDevice = (kind) => apiRef.current?.executeCommand(kind === 'audio' ? 'toggleAudio' : 'toggleVideo');

  /* PHASE 8.9 - one honest reading per side of the feed.
     A publisher describes its OWN device (its capture availability and mute
     state). A viewer describes the REMOTE participant, which is a different
     question and is answered by different events. Previously both sides were
     computed from the local availability events, which made the viewer report
     its own muted camera as the baby's. */
  const deviceStatus = (kind) => {
    if (conferenceStatus !== 'connected') return 'Connecting';

    if (!canPublish) {
      // --- the viewer is describing the BABY's device ---
      if (!liveConference.remoteId) return 'Checking';
      const muted = kind === 'audio'
        ? liveConference.remoteAudioMuted
        : liveConference.remoteVideoMuted;
      if (muted === true) return 'Unavailable';
      if (muted === false) return 'Connected';
      return 'Checking';
    }

    // --- the publisher is describing its OWN device ---
    const available = liveConference[kind === 'audio' ? 'audioAvailable' : 'videoAvailable'];
    const failedState = liveConference[kind === 'audio' ? 'audioError' : 'videoError'];
    if (failedState || available === false) return 'Unavailable';
    const muted = liveConference[kind === 'audio' ? 'audioMuted' : 'videoMuted'];
    if (muted === true) return 'Muted';
    return available === true && muted === false ? 'Connected' : 'Checking';
  };

  // --- REAL live state: the server issued a signed session -----------------
  if (status === 'ready' && media) {
    const isConnected = conferenceStatus === 'connected';
    const frameClass = variant === 'card' ? `${styles.frame} ${styles.cardFrame}` : styles.frame;
    const audioState = deviceStatus('audio');
    const videoState = deviceStatus('video');
    return (
      <section className={styles.mediaSurface} aria-label="Live monitoring media">
        <div className={frameClass} data-state={conferenceStatus}>
          {/* PHASE 8.9 - this bar is the ONLY thing labelling the video, and it
              is entirely our React markup (Jitsi renders nothing inside the
              iframe any more - no toolbar, no subject, no participant count).
              It therefore carries the whole "this is a baby monitor, not a
              meeting" message: who is being watched, that the feed is live, and
              whether this device is the one holding the camera. */}
          <div className={styles.liveBar} role="status">
            <span className={styles.liveDot} aria-hidden="true" data-connected={isConnected} />
            <span className={styles.liveText}>
              {isConnected ? 'Live' : conferenceStatus === 'lost' ? 'Connection lost' : conferenceStatus === 'error' ? 'Connection error' : 'Connecting'}
            </span>
            <span className={styles.liveDivider} aria-hidden="true" />
            <span className={styles.liveMeta}>
              {/* Deliberately NOT "receive only": that is transport vocabulary
                  and reads as a caller's permissions panel. This says whose
                  camera is on screen, which is what a monitor is about. */}
              {isConnected ? `${childName || 'Baby'}’s camera` : 'Joining the monitoring room'}
            </span>
          </div>
          <div className={styles.player}>
            <JitsiMeeting
              roomName={media.RoomName}
              /* The server supplies the tenant domain and signed JWT. */
              domain={media.Domain}
              jwt={media.Token}
              configOverwrite={configOverwrite}
              interfaceConfigOverwrite={interfaceConfigOverwrite}
              userInfo={userInfo}
              onApiReady={bindConferenceEvents}
              onReadyToClose={markConnectionLost}
              getIFrameRef={(iframe) => {
                if (iframe) {
                  /* PHASE 8.4 - the Jitsi root div is injected with no size, so
                     the iframe alone cannot fill the container. Forcing display
                     and an explicit full size on BOTH the iframe and its parent
                     element removes the empty black gap under the feed. */
                  iframe.style.display = 'block';
                  iframe.style.position = 'absolute';
                  iframe.style.inset = '0';
                  iframe.style.width = '100%';
                  iframe.style.height = '100%';
                  iframe.style.minHeight = '100%';
                  iframe.style.border = 'none';
                  iframe.style.margin = '0';
                  const host = iframe.parentElement;
                  if (host) {
                    host.style.display = 'block';
                    host.style.position = 'absolute';
                    host.style.inset = '0';
                    host.style.width = '100%';
                    host.style.height = '100%';
                    host.style.minHeight = '100%';
                  }
                }
              }}
            />
          </div>
        </div>
        {/* PHASE 8.9 - these are our own facts, derived from the same Jitsi
            events that drive the video, so they describe the REMOTE device for
            a viewer and the LOCAL device for a publisher. The words are
            "Camera"/"Microphone" rather than "Your camera" so the same row is
            truthful on both sides of the feed. */}
        <div className={styles.mediaDetails} aria-label="Camera and microphone status">
          <span className={styles.mediaFact} data-state={videoState.toLowerCase()}>
            <span className={styles.factDot} aria-hidden="true" />
            Camera {videoState.toLowerCase()}
          </span>
          <span className={styles.mediaFact} data-state={audioState.toLowerCase()}>
            <span className={styles.factDot} aria-hidden="true" />
            Microphone {audioState.toLowerCase()}
          </span>
          {/* The one-line statement of what the screen is. Rendered by us, not
              by Jitsi, because Jitsi's own equivalents (the hangup button, the
              participants pane) are exactly the conference chrome being removed.
              "Listening in" is the viewer's role: they are watching a baby, not
              in a meeting. */}
          <span className={styles.mediaFact} data-state={isConnected ? 'connected' : 'checking'}>
            <span className={styles.factDot} aria-hidden="true" />
            {canPublish ? 'Monitoring active' : 'Listening in'}
          </span>
        </div>
        {canPublish ? (
          <div className={styles.deviceControls} aria-label="Monitor device controls">
            <button type="button" className={styles.deviceControl} disabled={!isConnected || liveConference.audioMuted == null} onClick={() => toggleDevice('audio')}>
              {liveConference.audioMuted ? 'Unmute microphone' : 'Mute microphone'}
            </button>
            <button type="button" className={styles.deviceControl} disabled={!isConnected || liveConference.videoMuted == null} onClick={() => toggleDevice('video')}>
              {liveConference.videoMuted ? 'Turn camera on' : 'Turn camera off'}
            </button>
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
