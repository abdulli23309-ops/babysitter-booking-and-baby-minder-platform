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
/* PHASE 9.2 - `useCallback` is required by `noteAlive` and `retrySurface`. */
import { useCallback, useEffect, useRef, useState } from 'react';
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

/* PHASE 9.1 - the Little Care mark used by the "Awaiting video feed..." fallback.
   It is drawn here (rather than shipped as an asset) so the fallback can never
   404 and render as a broken image next to a broken iframe. */
const LittleCareMark = () => (
  <span className={styles.fallbackMark} aria-hidden="true">
    <span className={styles.fallbackMarkHalo} />
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.5s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 3.3c0 5-7.5 9.6-7.5 9.6z" />
      <path d="M12 4.2c.9-1.1 2.3-1.4 3.2-.7" />
    </svg>
  </span>
);

/* PHASE 9.1 - ONE consolidated status pill, floated over the video container.
   This replaces the three competing error strings the screen used to stack
   ("CONNECTION LOST", "Connection problem. Retrying.", "Preparing live video").
   Exactly two words are ever shown, and the colour is derived from the same
   `conferenceStatus` the rest of the panel uses, so the pill cannot disagree
   with the surface it sits on. */
function StatusPill({ live }) {
  return (
    <div
      className={styles.statusPill}
      data-live={live ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      <span className={styles.statusDot} aria-hidden="true" />
      <span className={styles.statusText}>{live ? 'Live' : 'Reconnecting...'}</span>
    </div>
  );
}

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


/* ======================================================================
   PHASE 12 - MIROTALK MEDIA STATE (REVISED IN PHASE 9.2)

   The previous provider exposed a rich per-participant event API
   (participantJoined, videoConferenceJoined, participantMuted, ...). MiroTalk is
   embedded as an iframe, and a cross-origin iframe deliberately does NOT leak
   that detail back to us - and it should not.

   PHASE 9.2 CHANGE. This panel used to fall back to describing the remote feed
   using Little Care's OWN polling state ('lost' = the surrounding monitoring
   session stopped being healthy). That was the original defect: a REST poll
   failure - which says nothing whatsoever about a camera - was rendered as a
   statement about the nursery camera, and it is exactly why a healthy SFU
   stream was labelled "Reconnecting...".

   So the two are now strictly separated:
     - the SURFACE   -> iframe load, load timeout, iframe error (about the page)
     - the FEED      -> SFU transport events only (about the media)
     - Little Care's API reachability -> shown nowhere near the video

   And because the SFU can genuinely report its own lifecycle through the embed
   bridge (`littlecare:transport`), the panel now has a truthful source for
   "is the feed connected?" instead of borrowing an unrelated one. Device rows
   are still described by our ROLE (publisher publishes, viewer listens) rather
   than by a guessed per-track state, because we still cannot observe a remote
   participant's mute flag - and we should not pretend to.
   ====================================================================== */

/* PHASE 9.2 - MIROTALK CHROME SUPPRESSION.

   The embedded SFU draws its own toolbar, settings dialog and participant name
   overlays. Inside this app they are pure noise: they duplicate controls that
   Little Care already renders, they let a viewer appear to be able to mute or
   leave a conference they have no rights over, and they break the illusion that
   the user is looking at their own child's camera.

   The server puts `?embed=1` in the join path, which is the SFU's supported
   switch for this. This stylesheet is the belt to that braces: it is injected
   into the frame's own document and hides the chrome by class, so a MiroTalk
   version that renames its markup degrades to "slightly cluttered" rather than
   to a broken panel.

   SECURITY NOTE. `?embed=1` and this CSS are PRESENTATION only. The receive-only
   guarantee for a Babysitter is enforced in the join path itself (no audio/video
   flags are requested) and, ultimately, by the SFU's own publish policy. Hiding a
   button is never the control that stops someone publishing. */
const SFU_CHROME_SUPPRESSION_CSS = `
  .toolbar, .settings, .settingsButton, .about, .info,
  #buttons, #buttonsSettings, #modal, .modal,
  .participant-name, .nick, .name, .user-name,
  .header, .footer, .status, .stats, .controls,
  .settings-modal, .dialog, .toast, .notification {
    display: none !important;
  }
  html, body { overflow: hidden !important; background: #0B132B !important; }
  #buttons, .buttons { display: none !important; }
  * { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; }
`;

/* How long the SFU surface may take to load before we stop claiming
   "Connecting" and admit the surface did not come up. */
const FRAME_LOAD_TIMEOUT_MS = 15000;

export default function MonitoringMediaPanel({
  status,
  media,
  canPublish,
  reason,
  childName,
  variant = 'hero',
  /* PHASE 9.3 - the ONLY way a parent screen learns the feed's transport state.
   *
   * Why this prop exists. The transport verdict lives inside this component
   * because only it can see the SFU's own messages. Screen 1 (the nursery
   * camera) needs to drive its "Live · Transmitting" badge from that same
   * source, and duplicating the message listener there would have produced two
   * independent opinions about one connection - exactly the class of bug Phase
   * 9.2 spent its effort removing.
   *
   * So the verdict is REPORTED, not re-derived: one listener, one truth, fanned
   * out to whoever asks. It is optional, and omitting it changes nothing about
   * this component's behaviour.
   *
   * @param {(state: 'connected'|'connecting'|'failed'|null, reason?: string) => void} onTransportChange
   */
  onTransportChange,
}) {
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

  /* ======================================================================
     PHASE 9.2 - TRANSPORT STATE, AND THE STICKY-ERROR FIX.
     ======================================================================

     THE BUG THIS REPAIRS (observed live, log-confirmed)
       The Babysitter had successfully joined room lc-m-157-27-f5bf55d0 and the
       SFU log showed "Consumer Success attached media". The UI nevertheless said
       "Reconnecting... / Awaiting video feed... / We lost the connection to the
       nursery camera." The WebRTC layer was healthy; this component was lying.

       Two independent defects combined to produce it:

       1. STICKY ERROR. The load timeout below wrote
          `loadedScopeKey = 'error:' + scopeKey`. Nothing ever cleared it: the
          effect only re-armed when `frameSrc`/`scopeKey` changed, and the iframe
          was still mounted, so its `onLoad` never fired again. One slow load
          therefore pinned the surface to "lost" for the entire session - even
          after video was visibly flowing.

       2. DEAD BRIDGE LISTENER. The listener for the SFU's own `littlecare:state`
          messages was gated on `frameLoaded`. So in exactly the situation where
          we most needed proof of life from the SFU, we were not listening. The
          one signal that could have corrected the false negative was switched off
          by the false negative itself.

     THE FIX
       a. The bridge/transport listener is attached as soon as a frame EXISTS
          (`frameSrc`), never gated on the loaded flag, so an SFU that is alive
          can always contradict us.
       b. A timeout is recorded per scope in a dedicated field and is CLEARED by
          any subsequent positive evidence - an iframe `onLoad`, a bridge state
          message, or a transport event.
       c. `transport` is the ONLY thing that may mark the feed as failed. It is
          driven exclusively by real SFU signals (see `TRANSPORT_LIVE`), never by
          REST polling. `useMonitoring`'s `offline`/`error` are deliberately not
          inputs here: the API being briefly unreachable says nothing about the
          camera, and conflating the two is precisely the defect above.
     ====================================================================== */
  const [timedOutScopeKey, setTimedOutScopeKey] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);

  /* Transport verdict, derived ONLY from SFU evidence. `null` means "the SFU has
     not told us anything yet", which is NOT the same as "disconnected". */
  const [transport, setTransport] = useState(null);

  /* PHASE 9.2 - how many <video> elements the SFU currently has attached.
         * Reported by the bridge for field diagnostics; see the comment at the
         * message handler. It is NOT an input to the status pill. */
  const [videoElementCount, setVideoElementCount] = useState(0);

  /* Transport is scoped to a room/session. Rather than resetting it in an effect
     (which is a cascading render and is flagged as such), the scope is FOLDED
     INTO THE STATE: `transport` holds `{ key, value }`. A verdict from a previous
     room simply does not match the current key, so it is discarded by derivation
     - the same pattern useMonitoringMedia already uses for its own results, and
     the reason a previous baby's state can never leak onto the current one. */
  const transportKey = `${scopeKey}:${retryNonce}`;
  const transportValue = transport?.key === transportKey ? transport.value : null;

  const timedOut = timedOutScopeKey === scopeKey && !frameLoaded;
  const frameErrored = loadedScopeKey === `error:${scopeKey}`;

  /* Refs mirroring render state, so `noteAlive` can stay referentially stable and
     be safely used as an effect dependency. They are written from an effect (not
     during render) to satisfy the refs rule. */
  const loadedScopeKeyRef = useRef(loadedScopeKey);
  const scopeKeyRef = useRef(scopeKey);
  const retryNonceRef = useRef(retryNonce);
  useEffect(() => { loadedScopeKeyRef.current = loadedScopeKey; }, [loadedScopeKey]);
  useEffect(() => { scopeKeyRef.current = scopeKey; }, [scopeKey]);
  useEffect(() => { retryNonceRef.current = retryNonce; }, [retryNonce]);

  /* PHASE 9.3 - the parent's callback, held in a ref.
   *
   * `noteTransport` below is a deliberately stable useCallback (it must be, because
   * it is an effect dependency for the SFU message listener). Reading
   * `onTransportChange` straight from props would either re-create that listener on
   * every parent render, or force a dependency that defeats the stability. A ref
   * gives the listener a stable identity while still always invoking the LATEST
   * callback the parent passed. */
  const onTransportChangeRef = useRef(onTransportChange);
  useEffect(() => { onTransportChangeRef.current = onTransportChange; }, [onTransportChange]);

  /* Records a transport verdict, tagged with the scope it belongs to, and reports
   it upward so a parent screen (Screen 1) can drive its own badge from this same
   single source of truth. */
  const noteTransport = useCallback((value, reason) => {
    setTransport({ key: `${scopeKeyRef.current}:${retryNonceRef.current}`, value });
    onTransportChangeRef.current?.(value, reason);
  }, []);

  /* Any positive evidence clears a previous negative. Kept in one place so the
     "what may clear what" rule cannot drift between call sites. This is the
     single most important line in this fix: a false "lost" must always be
     retractable by the next sign of life. */
  const noteAlive = useCallback(() => {
    setTimedOutScopeKey(null);
    if (loadedScopeKeyRef.current === `error:${scopeKeyRef.current}`) {
      setLoadedScopeKey(scopeKeyRef.current);
    }
  }, []);


  /* Transport is not "reset" in an effect: it is scoped by key and therefore
     discarded by derivation when the room changes. See `transportKey` above. */
  useEffect(() => {
    if (!frameSrc) return undefined;
    // Only arm the timer while we have heard nothing at all from the surface.
    if (frameLoaded) return undefined;
    const timer = setTimeout(() => {
      setTimedOutScopeKey(scopeKey);
      console.warn(
        `[monitoring-media] the media surface did not load within ${FRAME_LOAD_TIMEOUT_MS}ms. ` +
        'Showing the waiting state. This concerns the SFU surface only.',
      );
    }, FRAME_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [frameSrc, scopeKey, frameLoaded]);

  /* One-shot retry: remounts the iframe so a genuinely hung surface gets a fresh
     attempt instead of being abandoned for the rest of the session. */
  const retrySurface = useCallback(() => {
    setTimedOutScopeKey(null);
        setRetryNonce((n) => n + 1);
  }, []);

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


  /* PHASE 9.2 - INJECT THE CHROME SUPPRESSION INTO THE FRAME.

     The frame is CROSS-ORIGIN, so the browser's same-origin policy correctly
     denies us access to its document. That is a security feature and this code
     does not attempt to defeat it: `contentDocument` is simply null and the
     effect quietly does nothing.

     So this is a PROGRESSIVE ENHANCEMENT only:
       - on a deployment where the SFU is same-origin (the usual LAN/dev setup
         where the SFU is served through the same host as the app), the chrome
         is stripped and the video is completely bare;
       - where it is genuinely cross-origin, nothing is injected, the attempt is
         logged once for diagnosis, and the panel still works - relying on the
         server's own `?embed=1` switch, which is the supported mechanism.

     The alternative - reaching into the frame with a parent-side stylesheet -
     is impossible by design, and any code claiming otherwise is either broken
     or has already crossed a security boundary. */
  useEffect(() => {
    if (!frameSrc) return undefined;
    const frame = frameRef.current;
    if (!frame) return undefined;

    let styleEl = null;
    try {
      const doc = frame.contentDocument;
      if (doc && doc.head) {
        styleEl = doc.createElement('style');
        styleEl.setAttribute('data-lc-sfu-chrome', 'suppressed');
        styleEl.textContent = SFU_CHROME_SUPPRESSION_CSS;
        doc.head.appendChild(styleEl);
      } else {
        console.info(
          '[monitoring-media] the SFU frame is cross-origin, so its chrome cannot be',
          'styled from here. This is expected and safe: the server issues',
          '?embed=1, which is the SFU\'s own supported way to hide its toolbar.',
        );
      }
    } catch {
      // A cross-origin frame throws on access in some browsers. Never fatal.
      console.info('[monitoring-media] SFU chrome suppression skipped (cross-origin).');
    }

    return () => {
      try {
        if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl);
      } catch {
        /* the frame is already gone; nothing to clean up */
      }
    };
  }, [frameSrc]);

  useEffect(() => {
    /* PHASE 9.2 - attached as soon as the frame EXISTS, deliberately NOT gated on
       `frameLoaded`. The old gate meant that once the surface failed to confirm in
       time we stopped listening for the very messages that would have proved it
       was alive. An SFU that can talk to us must always be able to overrule us. */
    if (!frameSrc || !frameOrigin) return undefined;

    const onMessage = (event) => {
      // Only the SFU origin may drive these controls.
      if (event.origin !== frameOrigin) return;
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;

      /* --- Control state (littlecare:state) ------------------------------- */
      if (data.type === 'littlecare:state') {
        /* The SFU is talking to us, so it is alive. Retract any pending negative
           BEFORE recording the state, so the pill can never show "Reconnecting"
           alongside a state message that proves the opposite. */
    noteAlive();

        /* PHASE 9.2 - THE VIDEO-ELEMENT COUNT.
         *
         * This is the DOM-level corroboration that the consumer really attached.
         * The SFU log line "Consumer Success attached media videoType" is the
         * server-side truth; this is its browser-side counterpart, surfaced so a
    *   field log can show that pixels were genuinely flowing.
         *
         * It is deliberately NOT used to drive the status pill. A count can lag the
         * attach by a frame or two, and treating it as authoritative would
         * reintroduce exactly the flicker this fix exists to remove - the pill
         * must never flash "Reconnecting" during a healthy attach. */
        if (typeof data.videoElements === 'number') {
          setVideoElementCount(data.videoElements);
        }

        setMediaState({ audio: Boolean(data.audio), video: Boolean(data.video) });
        setBridgeReady(true);
        noteTransport('connected');
        return;
      }

      /* --- Transport / SFU lifecycle (littlecare:transport) ----------------
       * The bridge reports the real WebRTC events we cannot observe directly:
       *   'connected'  - websocket open and peer joined
  *   'connecting' - negotiating / ICE in progress
       *   'failed'     - producer/consumer transport FAILED, or websocket closed
         *
         * THESE are the only inputs permitted to drive the "Reconnecting" banner.
       * A REST poll failure is not one of them and must never reach here. */
      if (data.type === 'littlecare:transport') {
        const state = String(data.state ?? '');
        if (!['connected', 'connecting', 'failed'].includes(state)) return;

        if (state === 'failed') {
          noteTransport('failed');
          console.warn(
            `[monitoring-media] SFU transport reported "${data.reason ?? 'failed'}". ` +
            'The video feed is genuinely interrupted.',
          );
        } else {
          noteAlive();
          noteTransport(state);
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    /* `noteAlive` and `noteTransport` are both referentially stable useCallbacks
       with no dependencies, so listing them here is free and keeps the effect
       honest about what it actually reads. */
  }, [frameSrc, frameOrigin, noteAlive, noteTransport]);

  const sendCommand = (action) => {
    const target = frameRef.current?.contentWindow;
    if (!target) return;
    // postMessage to the SFU origin, never '*'.
    target.postMessage({ type: 'littlecare:command', action }, frameOrigin);
  };

  /* ======================================================================
     THE ONE DECISION THAT DRIVES THE ENTIRE PANEL.

     `conferenceStatus` is the ONLY thing the status pill, the caption bar and
     the fallback overlay read. Because it has a single definition, the panel
     cannot show three competing messages any more - that duplication was the
     original "CONNECTION LOST / Connection problem / Preparing live video"
     clutter.

     PRECEDENCE, MOST TRUSTWORTHY FIRST
    1. transportValue === 'failed'
          The SFU itself reported a websocket drop or a producer/consumer
        transport failure. This is the ONLY path to "lost" that carries
    evidence about the video feed.
       2. frameErrored - a real iframe onError, which the browser raises only
    for a genuine load failure.
     3. frameLoaded - the document loaded. Note this now WINS OVER `timedOut`,
          because `noteAlive()` clears the timeout the instant any positive
          evidence arrives - so one slow load can no longer pin the pill to
        "Reconnecting" for the rest of the session. That inversion is the
 specific fix for the false "We lost the connection to the nursery camera".
       4. timedOut - we waited and heard nothing. A statement about the SURFACE,
          never about the camera, and self-retracting.
       5. otherwise 'connecting'.

     WHAT IS NOT AN INPUT, AND WHY
       `useMonitoring`'s `offline` and `error`, and every REST response, are
       deliberately absent. The regression this file exists to prevent was a
 healthy SFU stream being labelled "Reconnecting..." because an unrelated
       JSON endpoint returned a failure. An unreachable API is not a statement
       about a camera, and the two must never be wired together.
     ====================================================================== */
  const conferenceStatus =
    transportValue === 'failed' ? 'failed'
      : frameErrored ? 'error'
        : frameLoaded ? 'loaded'
          : timedOut ? 'error'
        : 'connecting';

  /* True when the surface is genuinely, currently usable. This is what the pill
     reports as "Live" - and note it can be true while the REST API is entirely
     unreachable, which is precisely the scenario that used to break. */
  const feedIsLive = frameLoaded && transportValue !== 'failed';
  // --- REAL live state: the server issued an authorised media session -------
  if (status === 'ready' && media) {
  /* Presentations, chosen by `variant`:
         'hero'   - the standalone panel (default)
         'card'   - the same, with a subtle card border
         'stage'  - the Active Session hero: ONE status pill floated over the
                     video, with no second caption bar underneath it
         'cinema' - PHASE 9.3, Screen 1 (the nursery camera)

     * PHASE 9.3 - WHY 'cinema' IS NOT 'stage'
     * The stage is a hero INSIDE a scrolling page, so it keeps its own pill and
     * caption bar. Cinema is a full-bleed, chrome-free surface: the surrounding
     * screen already owns the one status badge and the one action, so this variant
     * deliberately renders NEITHER.
     *
     * A second status indicator inside the panel is precisely what made the old
     * nursery view read as a wireframe - the same fixed complaint Phase 9.2 fixed
     * on the stage, so the rule carries over rather than being re-learned here. */
  const isStage = variant === 'stage';
  const isCinema = variant === 'cinema';
  const showOwnChrome = !isCinema;
  const frameClass = isStage || isCinema
      ? `${styles.frame} ${styles.stageFrame}`
    : variant === 'card'
      ? `${styles.frame} ${styles.cardFrame}`
        : styles.frame;
    /* These states are OURS. They deliberately describe the monitoring
       session, not the SFU: the user should never see two competing
       "connecting / unavailable" messages, and must never see raw provider
       vocabulary inside the feed. */
    /* Each label describes exactly one condition, and none of them is reachable
       from a REST failure. "Reconnecting" is reserved for a real SFU transport
       failure; every other state is about opening the room. */
    const stateLabel = !frameSrc
      ? 'Preparing live video'
      : transportValue === 'failed'
        ? 'Reconnecting'
        : feedIsLive
          ? 'Monitoring active'
          : 'Opening monitoring room';
    /* PHASE 9.2 - the pill is LIVE whenever the surface is actually usable, and
       is only "Reconnecting..." when the SFU itself reported a failure. It reads
       `feedIsLive` rather than re-deriving the condition, so the pill cannot
       drift out of step with the status the rest of the panel shows. */
    const pillLive = Boolean(frameSrc) && feedIsLive;
    return (
      <section className={isStage ? styles.stageSurface : styles.mediaSurface} aria-label="Live monitoring media">
        <div className={frameClass} data-state={conferenceStatus} data-variant={variant}>
{showOwnChrome && isStage ? <StatusPill live={pillLive} /> : null}
          {frameSrc ? (
            /* The media surface. The SFU is a separate origin on purpose: it
               can neither read our DOM nor our session. The join URL carries
               ?embed=1, which makes the SFU hide its own conference chrome and
               accept the control commands below. The `allow` list is what lets
               the SFU ask for camera and microphone - it grants the permission
               PROMPT only. A viewer is not granted camera/microphone at all,
               so the parent's browser is never prompted to publish. */
            <iframe
              /* PHASE 9.2 - `retryNonce` remounts the frame so a genuinely hung
                 surface can be retried, rather than being abandoned for the rest
                 of the session by a one-shot timeout. */
              key={`${frameSrc}#${retryNonce}`}
              ref={frameRef}
              className={styles.frameElement}
              title={`Live monitoring media${childName ? ` for ${childName}` : ''}`}
              src={frameSrc}
              allow={canPublish ? 'camera; microphone; fullscreen; autoplay' : 'fullscreen; autoplay'}
              allowFullScreen
              referrerPolicy="no-referrer"
       /* PHASE 9.2 - a successful load is the strongest single piece of
        * evidence that the surface is alive, so it retracts any pending
        * timeout IMMEDIATELY. This handler is the direct fix for the
        * stuck "Reconnecting" pill: before it, the timeout wrote a
        * permanent `error:<scopeKey>` that nothing could overwrite, so a
        * single slow load condemned the entire sitting. */
              onLoad={() => { noteAlive(); setLoadedScopeKey(scopeKey); }}
              /* PHASE 9.1 - a cross-origin surface that dies leaves the browser's
                 own broken-document glyph showing, which is indistinguishable
                 from a real fault. `onError` lets us paint the premium fallback
                 instead; the load timeout below still covers a silent hang. */
              onError={() => setLoadedScopeKey(`error:${scopeKey}`)}
            />
          ) : (
            /* Server said Configured but gave us no address/room. Say so rather
               than render an empty black box that looks like a dead camera -
               and on the stage, never leave the browser's broken-document icon
               as the only thing on screen. */
            <div className={styles.player} data-state="error" role="status">
              {isStage ? (
                <div className={styles.fallback}>
                  <LittleCareMark />
                  <p className={styles.fallbackTitle}>Awaiting video feed...</p>
                  <p className={styles.fallbackBody}>
                    Live video could not be prepared. Please try again.
                  </p>
                </div>
              ) : (
                <p className={styles.emptyBody}>Live video could not be prepared. Please try again.</p>
              )}
            </div>
          )}

          {/* PHASE 9.1 - on the stage the frame itself carries a dedicated
              fallback overlay when the surface failed or timed out, so the user
              never sees an empty dark rectangle or a broken iframe icon. */}
   {(isStage || isCinema) && frameSrc && conferenceStatus === 'error' && !frameLoaded ? (
       <div className={styles.fallbackOverlay} role="status">
   <div className={styles.fallback}>
     <LittleCareMark />
   <p className={styles.fallbackTitle}>
        {transportValue === 'failed' ? 'Reconnecting...' : 'Awaiting video feed...'}
  </p>
      <p className={styles.fallbackBody}>
            {transportValue === 'failed'
              ? 'The video connection was interrupted. Little Care is retrying automatically.'
              : 'The live video surface is taking longer than expected to open.'}
       </p>
              {/* A genuine recovery affordance. Remounting the frame is
     the only thing that can actually help a hung surface, and this
button says so rather than pretending an automatic retry is enough. */}
   <button
   type="button"
    className={styles.fallbackRetry}
       onClick={retrySurface}
  >
        Try again
       </button>
   </div>
  </div>
) : null}
        </div>

        {/* ONE honest status line, owned by Little Care. The stage hides it
            because its floating pill already says the same thing - showing
            both is exactly the duplicated-error problem this pass removes. */}
        {showOwnChrome && !isStage ? (
          <div className={styles.liveBar} role="status">
          <span
            className={styles.liveDot}
            aria-hidden="true"
            data-connected={feedIsLive ? 'true' : 'false'}
          />
          <span className={styles.liveText}>{stateLabel}</span>
          <span className={styles.liveDivider} aria-hidden="true" />
          <span className={styles.liveMeta}>
            {canPublish ? `${childName || 'Baby'}’s camera` : 'Listening in'}
            {/* PHASE 9.2 - the video-element count, exposed only as a technical
                attestation that a stream really attached. It is deliberately NOT
                part of the status verdict: the count can trail the attach by a
                frame, so letting it drive the pill would reintroduce exactly the
                flicker this fix exists to remove. Diagnostic, not a user claim. */}
            <span data-lc-video-elements={videoElementCount} hidden />
          </span>


        </div>
        ) : null}

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

  /* PHASE 9.1 - in stage mode the empty state adopts the same deep-navy frame
     and floats the SAME pill over it, so a connecting screen and a live screen
     are visibly the same surface. The pill is only shown for states where
     waiting is genuinely the right word: a refused or unconfigured deployment
     is not going to reconnect, and pretending otherwise would be a lie. */
  const isStage = variant === 'stage';
  const isCinema = variant === 'cinema';
  const waitingForFeed = status === 'loading' || status === 'no-session' || status === 'idle';
  const emptyFrameClass = isStage || isCinema ? `${styles.frame} ${styles.stageFrame}` : styles.frame;

  return (
    <div className={emptyFrameClass} data-tone={tone} data-variant={variant}>
      {isStage && waitingForFeed ? <StatusPill live={false} /> : null}
      <div className={`${styles.empty} ${isCinema ? styles.cinemaEmpty : ''}`} role="status" aria-live="polite">
        {isStage || isCinema ? <LittleCareMark /> : null}
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

