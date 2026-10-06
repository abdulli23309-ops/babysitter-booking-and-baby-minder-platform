import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import MonitoringMediaPanel from '../../components/monitoring/MonitoringMediaPanel';
import CryDetector from '../cry/CryDetector';
import DeviceFeedingPoc from './DeviceFeedingPoc';
import DeviceFeedingTelemetry from '../../components/monitoring/DeviceFeedingTelemetry';
import useDeviceFeeding from '../../hooks/useDeviceFeeding';
import { deviceHeartbeat, deviceMedia, deviceStore, stopIndependentSession } from '../../services/independentMonitoringApi';
import styles from './monitor-camera-screen.module.css';

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.Message || error?.response?.data?.message || error?.message || fallback;
const getStatus = (error) => error?.response?.status ?? error?.status;

const REFRESH_MS = 20000;

/**
 * MonitorCameraScreen - Screen 1, the camera sitting in the baby's room.
 *
 * WHY THIS IS ITS OWN SCREEN
 *   This used to live inside PhonePairingConcept, which rendered the PARENT pairing
 *   form and the DEVICE camera from one component. That coupling is why it read as a
 *   wireframe: the live view inherited a page header, a step label, a heading and a
 *   "stop" button, all above the only thing that mattered - the picture of the baby.
 *   Splitting it out lets the camera own the entire viewport.
 *
 * WHAT IT IS
 *   A full-bleed, edge-to-edge cinematic surface. There is exactly ONE feed and no
 *   split screen, no card, no border and no scroll. The only chrome is a single
 *   glowing status badge and one floating action to end the session. This phone is a
 *   one-way camera; the person using it is placing a device in a nursery and walking
 *   away, not operating a console.
 *
 * SECURITY NOTE (do not "improve" this)
 *   This screen is a PUBLISHER: `deviceMedia()` returns a publisher session because
 *   the caller presented an `X-Monitor-Device` credential. The camera/mic controls
 *   inside MonitoringMediaPanel render only because the SERVER said `CanPublish:
 *   true`. That flag is never derived here. If the credential is revoked the server
 *   refuses, and this screen shows the unpaired state rather than continuing.
 */
export default function MonitorCameraScreen() {
  const [credential, setCredential] = useState(() => deviceStore.getCredential() || '');
  const [media, setMedia] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [transport, setTransport] = useState(null);
  const mountedRef = useRef(true);

  /* PHASE 2 - DEV-ONLY CAMERA CAPABILITY PANEL.
   *
   * Gated on the `poc=1` query parameter, so it renders NOTHING in normal use
   * and cannot appear on a real user's phone. It exists to answer one question:
   * can a second getUserMedia() stream coexist with the MiroTalk camera?
   *
   * It is placed HERE, inside the camera screen, deliberately: the experiment
   * is only meaningful while MiroTalk is actively using the camera, and this is
   * the screen where that is true.
   */
  const [searchParams] = useSearchParams();
  const pocEnabled = searchParams.get('poc') === '1';

  /* PHASE 3 - PRODUCTION FEEDING TELEMETRY.
   *
   * The proven Phase 2 claim -> record -> upload pipeline (deviceFeedingPoc.js,
   * unchanged) is now driven continuously by this hook, and its honest state
   * is surfaced as ONE thin glass pill at the top edge of the stage. It is
   * declared with the other hooks (before the unpaired early return) so the
   * hook order never changes, and it never touches MiroTalk: the recorder
   * performs its own independent getUserMedia exactly as Phase 2 proved. */
  const feeding = useDeviceFeeding({ credential });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshMedia = useCallback(async () => {
    /* PHASE B.1 - LIVENESS STAMP (same API, same interval, no new loop).
     *
     * POST /device/heartbeat is the ONLY route that writes
     * MonitoringDeviceSession.LastSeenAtUtc and IndependentMonitoringSession
     * .LastDeviceSeenAtUtc, and the parent's "monitor phone connected" flag is
     * derived from a beat inside the last 45 seconds. Before this screen
     * existed the pairing surface was the only component sending it, on its own
     * 20 s timer; now that the paired phone transitions HERE, that beat has to
     * ride along - otherwise fixing the surface switch would silently regress
     * the parent's connection indicator. So the SAME exported deviceHeartbeat()
     * call is made on the SAME 20 s REFRESH_MS interval this screen already
     * runs: one heartbeat implementation, one cadence, no second timer.
     *
     * Best-effort by design: `deviceMedia` below remains the authority on
     * whether the pairing is still valid (the screen's own contract), so a
     * failed beat must never blank a working feed. A genuinely revoked pairing
     * still 401s on the very next deviceMedia() call and is handled by the
     * existing catch unchanged. */
    try { await deviceHeartbeat(); } catch { /* liveness is best-effort */ }

    try {
      const next = await deviceMedia();
      if (!mountedRef.current) return;
      setMedia(next);
      setDeviceStatus(next?.CanPublish ? 'Active' : 'Pending');
      setError('');
    } catch (err) {
      if (!mountedRef.current) return;
      setMedia(null);
      setError(getErrorMessage(err, 'This monitor device is no longer authorized.'));
      // 401/403 mean the pairing is gone. independentMonitoringApi clears the
      // credential itself on those statuses; this clears the UI copy too, so the
      // screen stops implying it is still transmitting.
      if ([401, 403].includes(getStatus(err))) {
        deviceStore.clear();
        setCredential('');
        setDeviceStatus(null);
      }
    }
  }, []);

  useEffect(() => {
    if (!credential) return undefined;

    /* PHASE 9.3 - the first fetch is deferred out of the effect body.
     * `refreshMedia` writes state, so calling it synchronously during the effect
     * pass cascades a render. Deferring by one microtask is the pattern already
     * used by useMonitoring and PhonePairingConcept for exactly this reason, so
     * this screen stays consistent with the rest of the app. */
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) refreshMedia();
    });

    const timer = window.setInterval(refreshMedia, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [credential, refreshMedia]);

  const endSession = async () => {
    setBusy(true);
    try {
      await stopIndependentSession();
      deviceStore.clear();
      setCredential('');
      setMedia(null);
    } catch (err) {
      if (mountedRef.current) setError(getErrorMessage(err, 'Monitoring could not be stopped.'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  /* ---- Derived, never stored ------------------------------------------
     One decision, one truth. The badge reads this and nothing else, so it can
     never disagree with the surface underneath it. */
  const configured = Boolean(media?.Configured);
  const publishing = transport === 'connected' || transport === 'connecting';
  const lost = transport === 'failed';

  if (!credential) {
    return (
      <div className={styles.screen} data-state="unpaired">
        <div className={styles.centeredNotice}>
          <span className={styles.noticeGlyph} aria-hidden="true" />
          <h1 className={styles.noticeTitle}>Camera is not paired</h1>
          <p className={styles.noticeBody}>
            This phone needs a pairing code from the parent app before it can watch over the nursery.
          </p>
          <a className={styles.noticeLink} href="/monitor-device">Pair this device</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen} data-state={lost ? 'lost' : publishing ? 'live' : 'opening'}>
      {/* The live feed and its status stay together in the rounded media card. */}
      <div className={styles.stage}>
        <MonitoringMediaPanel
          status={configured ? 'ready' : media ? 'unavailable' : 'loading'}
          media={configured ? media : null}
          canPublish={Boolean(media?.CanPublish)}
          reason={media?.Reason}
          variant="cinema"
          onTransportChange={setTransport}
        />
        <div
          className={styles.badge}
          data-live={publishing && !lost ? 'true' : 'false'}
          data-lost={lost ? 'true' : 'false'}
          role="status"
        >
          <span className={styles.badgeDot} aria-hidden="true" />
          <span className={styles.badgeText}>
            {lost ? 'Connection lost' : publishing ? 'Live · Transmitting' : 'Opening camera…'}
          </span>
        </div>

        {/* PHASE 3 - feeding-recorder telemetry. One glass pill on the top
            edge of the stage; hidden entirely while the recorder is idle.
            Purely informational (pointer-events: none), so it can never
            intercept a tap meant for the MiroTalk surface underneath. */}
        <DeviceFeedingTelemetry
          phase={feeding.phase}
          elapsed={feeding.elapsed}
          result={feeding.result}
          failure={feeding.failure}
        />
        {error ? <p className={styles.errorToast} role="alert">{error}</p> : null}
      </div>

      {/* PHASE 9.3 - CRY DETECTION IS RESTORED.
       *
       * RESTORATION NOTE (a regression, not a redesign).
       *   The previous Phase 9.3 pass extracted this camera out of
       *   PhonePairingConcept, which previously rendered
       *   `<CryDetector independent embedded />` directly beneath the feed. That
       *   extraction dropped it, which removed the single most important function
       *   this device performs: it is the ONLY participant that can DETECT a cry.
       *
       *   Detection cannot simply move to the parent's phone. `POST /monitoring/cry`
       *   requires an `X-Monitor-Device` credential and refuses any ordinary
       *   account bearer (§5.3 of the audit) - so if it is lost here, cry alerting
       *   is lost entirely.
       *
       * WHY IT LIVES UNDER THE FEED AND NOT OVER IT.
       *   The detector shows a live radar, a status line, a timer and a waveform.
       *   Overlaying that on top of the camera would obscure the baby, which is
       *   the one thing this device exists to watch. Sitting it directly beneath
       *   keeps both fully legible, and on a phone the pair scrolls together so
       *   the operator sees picture + alert in one glance.
       *
       * `embedded` switches CryDetector to its compact presentation, which is the
       * same component the pairing screen used - so this is a restoration to the
       * previous behaviour, not a new variant.
       *
       * `independent` is required: it routes a confirmed cry through
       * `deviceReportCry()`, which sends the DEVICE credential. Without it the
       * detector would try to report against a job scope it has no identity in.
       */}
      <div className={styles.cryDock}>
        <CryDetector independent embedded />
      </div>

      {/* PHASE 2 - renders only with ?poc=1. See the comment at its gate. */}
      {pocEnabled ? <DeviceFeedingPoc /> : null}

      <div className={styles.actionArea}>
        <button
          type="button"
          className={styles.fab}
          onClick={endSession}
          disabled={busy}
          aria-label="End monitoring"
        >
          <span className={styles.fabIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </span>
          <span className={styles.fabText}>{busy ? 'Ending…' : 'End Monitoring'}</span>
        </button>
      </div>

      {/* Non-visual state hook for diagnostics; carries no user-facing claim. */}
      <span className={styles.deviceState} hidden data-status={deviceStatus ?? ''} />
    </div>
  );
}
