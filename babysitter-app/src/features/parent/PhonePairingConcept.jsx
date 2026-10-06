import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import MonitoringMediaPanel from '../../components/monitoring/MonitoringMediaPanel';
import CryDetector from '../cry/CryDetector';
import { API } from '../../services/api';
import {
  createPairingCode,
  deviceHeartbeat,
  deviceMedia,
  deviceSession,
  deviceStore,
  getIndependentCry,
  getIndependentMedia,
  getIndependentSession,
  pairDevice,
  resolveIndependentCry,
  stopIndependentSession,
} from '../../services/independentMonitoringApi';
import styles from './phone-pairing-concept.module.css';

function getErrorMessage(error, fallback) {
  return error?.response?.data?.Message || error?.response?.data?.message || error?.message || fallback;
}
const getStatus = (error) => error?.response?.status ?? error?.status;

/**
 * `onCredentialChange` (optional - passed only by `MonitorDeviceScreen`) is the
 * PHASE B.1 signal. `deviceStore` is plain sessionStorage, so React cannot
 * observe a credential written from inside this component, and a child's state
 * update never re-renders its parent. The route wrapper renders this form while
 * unpaired and `MonitorCameraScreen` while paired, so it must be told to re-read
 * the store after this component writes (successful pair) or clears (disconnect,
 * 401/403) the credential - otherwise a phone that pairs in place stays on this
 * surface forever, heartbeating but never running the feeding claim loop. The
 * parent route passes no such prop: it owns no device surface.
 */
export default function PhonePairingConcept({ initialView = 'parent', onCredentialChange }) {
  const { userId } = useAuth();
  // PHASE 8.9 - `view` was state only so the removed Parent/Monitor tabs could
  // flip it. Which side of the screen this is now comes from the ROUTE
  // (`initialView`), which is the only thing that ever selected it, so it is
  // derived rather than stored. That also removes a state variable that could
  // disagree with the URL.
  const view = initialView;
  const [children, setChildren] = useState([]);
  const [childId, setChildId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pin, setPin] = useState('');
  const [credential, setCredential] = useState(() => deviceStore.getCredential() || '');
  const [parentSession, setParentSession] = useState(null);
  const [deviceSessionInfo, setDeviceSessionInfo] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [media, setMedia] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (view !== 'parent' || !userId) return undefined;
    let alive = true;
    API.getChildren(userId).then((rows) => {
      if (!alive) return;
      const list = Array.isArray(rows) ? rows : [];
      setChildren(list);
      setChildId((current) => current || String(list[0]?.Child_ID || list[0]?.ChildId || ''));
    }).catch((error) => { if (alive) setMessage(getErrorMessage(error, 'Could not load children.')); });
    return () => { alive = false; };
  }, [view, userId]);

  const refreshParent = useCallback(async () => {
    try {
      const session = await getIndependentSession();
      setParentSession(session);
      const latestIncident = await getIndependentCry().catch((error) => {
        if (getStatus(error) === 404) return null;
        throw error;
      });
      setIncidents(latestIncident ? [latestIncident] : []);
      if (session?.Status === 'Active' && session?.DeviceAuthorized) {
        const nextMedia = await getIndependentMedia();
        setMedia(nextMedia);
      } else {
        setMedia(null);
      }
    } catch (error) {
      if (getStatus(error) === 404) {
        setParentSession(null);
        setMedia(null);
      } else {
        setMessage(getErrorMessage(error, 'Could not refresh monitoring status.'));
      }
    }
  }, []);

  useEffect(() => {
    if (view !== 'parent') return undefined;
    // The first poll is deferred out of the effect body: this synchronizes with
    // an EXTERNAL system (the API), so it is not a derived render value, and
    // calling it inline would setState synchronously during the effect pass.
    // This is the same pattern useMonitoring and BabyMonitoringScreen use.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) refreshParent();
    });
    const timer = window.setInterval(refreshParent, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [view, refreshParent]);

  useEffect(() => {
    if (view !== 'monitor' || !credential) return undefined;
    let alive = true;
    const refreshDevice = async () => {
      try {
        const nextSession = await deviceSession();
        if (!alive) return;
        setDeviceSessionInfo(nextSession);
        await deviceHeartbeat();
        if (!alive) return;
        const nextMedia = await deviceMedia();
        if (alive) setMedia(nextMedia);
      } catch (error) {
        if (!alive) return;
        setMedia(null);
        setMessage(getErrorMessage(error, 'This monitor device is no longer authorized.'));
        if ([401, 403].includes(getStatus(error))) {
          deviceStore.clear();
          setCredential('');
          setDeviceSessionInfo(null);
          // PHASE B.1 - credential gone; let the route wrapper re-read it.
          onCredentialChange?.();
        }
      }
    };
    refreshDevice();
    const timer = window.setInterval(refreshDevice, 20000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [view, credential, onCredentialChange]);

  const generateCode = async () => {
    if (!childId) return;
    setBusy(true); setMessage(''); setPairingCode('');
    try {
      const result = await createPairingCode(Number(childId));
      setPairingCode(result.code);
    } catch (error) { setMessage(getErrorMessage(error, 'A pairing code could not be created.')); }
    finally { setBusy(false); }
  };

  const submitPin = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      const normalizedCode = pin.replace(/\s+/g, '').trim().toUpperCase();
      await pairDevice(normalizedCode);
      setCredential(deviceStore.getCredential());
      // PHASE B.1 - the credential is now in sessionStorage, which this form's
      // own state cannot surface to its parent. Signal the route wrapper so it
      // re-reads the store and replaces this form with the production camera
      // screen - the surface that owns the feeding claim loop.
      onCredentialChange?.();
      setPin('');
      setMessage('Device paired. Allow camera and microphone access when the browser asks.');
    } catch (error) { setMessage(getErrorMessage(error, 'The code is invalid or expired.')); }
    finally { setBusy(false); }
  };

  const stopMonitoring = async () => {
    setBusy(true); setMessage('');
    try { await stopIndependentSession(); await refreshParent(); }
    catch (error) { setMessage(getErrorMessage(error, 'Monitoring could not be stopped.')); }
    finally { setBusy(false); }
  };

  const resolveIncident = async () => {
    try { await resolveIndependentCry(); await refreshParent(); }
    catch (error) { setMessage(getErrorMessage(error, 'The alert could not be resolved.')); }
  };

  const disconnectDevice = () => {
    deviceStore.clear();
    setCredential('');
    // PHASE B.1 - credential cleared; let the route wrapper re-read it, so the
    // two-state branch above can never disagree with the store.
    onCredentialChange?.();
    setDeviceSessionInfo(null);
    setMedia(null);
    setMessage('This phone is disconnected. Stop the monitoring session on Phone 1 to revoke the pairing.');
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        {/* PHASE 8.6 - UX copy pass. The header is the first thing seen on both
            pairing routes, so it is reduced to three short lines: an eyebrow, a
            two-word title, and one sentence of support. Longer phrasing pushed
            the tabs and the video below the fold on a phone. The "LITTLE CARE"
            wordmark was also dropped here because the app shell already carries
            the brand, so repeating it in an eyebrow was redundant. */}
        <p className={styles.eyebrow}>DEVICE SETUP</p>
        <h1>{view === 'parent' ? 'Pair Monitor' : 'Camera Mode'}</h1>
        <p>{view === 'parent' ? 'Connect a secondary device to watch over your child.' : 'Position this device securely. It acts as a one-way camera.'}</p>
      </header>

      {/* PHASE 8.9 - the "Parent phone" / "Monitor device" segmented control was
          removed from the Parent's UI. This screen is reached by a ROUTE
          (/independent-monitoring for the parent, /monitor-device for the
          device), so the tabs were duplicate navigation: they offered a second
          way into a screen the user had already chosen, and on a phone they
          pushed the pairing code and the live view below the fold. The two
          flows remain fully reachable by their own routes. */}

      {view === 'parent' ? (
        <section className={styles.parentPanel}>
          {/* PHASE 8.5 - the step label, heading and child summary were loose
              siblings inheriting the panel's line-height, which visually
              collapsed them together. A single flex column with a real gap gives
              each element its own rhythm. */}
          <div className={styles.panelHeader}>
            <span className={styles.step}>PARENT PHONE</span>
            <h2>{parentSession?.Status === 'Active' ? 'Baby monitor' : 'Pair a monitor phone'}</h2>
          </div>
          {parentSession?.Status === 'Active' ? (
            <>
              <div className={styles.activeSummary}>
                <strong>{parentSession.ChildName ? `Baby ${parentSession.ChildName}` : 'Monitoring session'}</strong>
                <span className={styles.activeStatus}><span aria-hidden="true" />Monitoring active</span>
                <span className={styles.deviceStatus} data-connected={Boolean(parentSession.DeviceConnected)}>
                  <span aria-hidden="true" />
                  {parentSession.DeviceConnected ? 'Monitor phone connected' : 'Waiting for the monitor phone'}
                </span>
              </div>
              <MonitoringMediaPanel status={media?.Configured ? 'ready' : media ? 'unavailable' : 'loading'} media={media?.Configured ? media : null} canPublish={Boolean(media?.CanPublish)} reason={media?.Reason} childName={parentSession.ChildName} variant="card" />
              <div className={styles.incidents} aria-live="polite">
                {incidents.filter((incident) => incident.IsOpen ?? !incident.ResolvedAtUtc).map((incident) => (
                  <div className={styles.incident} key={incident.IncidentId}>
                    <span>Baby cry detected · {new Date(incident.DetectedAtUtc).toLocaleTimeString()}</span>
                    <button type="button" onClick={resolveIncident}>Mark resolved</button>
                  </div>
                ))}
              </div>
              <button className={styles.primaryButton} type="button" onClick={stopMonitoring} disabled={busy}>Stop monitoring</button>
            </>
          ) : (
            <>
              <p>Choose a child and show the temporary code on this phone. It expires after five minutes and works once.</p>
              <label htmlFor="monitor-child">Child</label>
              <select id="monitor-child" value={childId} onChange={(event) => setChildId(event.target.value)} disabled={!children.length}>
                {children.map((child) => <option key={child.Child_ID || child.ChildId} value={child.Child_ID || child.ChildId}>{child.ChildName || child.Name || 'Child'}</option>)}
              </select>
              {pairingCode && <output className={styles.code} aria-label="Pairing code">{pairingCode}</output>}
              <button className={styles.primaryButton} type="button" onClick={generateCode} disabled={busy || !childId}>{busy ? 'Creating…' : pairingCode ? 'Generate a new code' : 'Generate pairing code'}</button>
              {pairingCode && <p className={styles.footnote}>Enter this code on Phone 2 within five minutes. Creating another code invalidates this one.</p>}
            </>
          )}
        </section>
      ) : (
        <section className={styles.monitorPanel}>
          {/* PHASE 8.5 - the "LC" mark is removed entirely. It was our own
              element, not the media surface's, and sat directly above the video reading as
              leftover pre-join branding. */}
          <span className={styles.step}>PHONE 2</span>
          <h2>{credential ? 'Monitor device paired' : 'Connect this phone'}</h2>
          {credential ? (
            <>
              <p className={styles.deviceActiveStatus} role="status">
                {deviceSessionInfo?.status === 'Active' ? 'Monitoring active on this device' : 'Checking monitor session'}
              </p>
              <MonitoringMediaPanel status={media?.Configured ? 'ready' : media ? 'unavailable' : 'loading'} media={media?.Configured ? media : null} canPublish={Boolean(media?.CanPublish)} reason={media?.Reason} variant="card" />
              <button className={styles.disconnectButton} type="button" onClick={disconnectDevice}>
                Stop monitoring on this phone
              </button>
              <CryDetector independent embedded />
            </>
          ) : (
            <>
              <p>Enter the one-time code shown in the parent app.</p>
              <form className={styles.pinForm} onSubmit={submitPin}>
                <label htmlFor="pairing-pin">Pairing code</label>
                <input id="pairing-pin" inputMode="text" autoComplete="one-time-code" maxLength={10} minLength={10} value={pin} onChange={(event) => { setPin(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase()); setMessage(''); }} placeholder="10 characters" />
                <button className={styles.monitorButton} type="submit" disabled={pin.length !== 10 || busy}>{busy ? 'Pairing…' : 'Pair this phone'}</button>
              </form>
            </>
          )}
        </section>
      )}
      {message && <p className={styles.message} role="status">{message}</p>}
    </main>
  );
}
