import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import MonitoringMediaPanel from '../../components/monitoring/MonitoringMediaPanel';
import CryDetector from '../cry/CryDetector';
import { API } from '../../services/api';
import {
  createPairingCode,
  deviceHeartbeat,
  deviceMedia,
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

export default function PhonePairingConcept({ initialView = 'parent' }) {
  const { userId } = useAuth();
  const [view, setView] = useState(initialView);
  const [children, setChildren] = useState([]);
  const [childId, setChildId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pin, setPin] = useState('');
  const [credential, setCredential] = useState(() => deviceStore.getCredential() || '');
  const [parentSession, setParentSession] = useState(null);
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
        await deviceHeartbeat();
        const nextMedia = await deviceMedia();
        if (alive) setMedia(nextMedia);
      } catch (error) {
        if (!alive) return;
        setMedia(null);
        setMessage(getErrorMessage(error, 'This monitor device is no longer authorized.'));
        if (getStatus(error) === 403) {
          deviceStore.clear();
          setCredential('');
        }
      }
    };
    refreshDevice();
    const timer = window.setInterval(refreshDevice, 20000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [view, credential]);

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
      await pairDevice(pin.trim().toUpperCase());
      setCredential(deviceStore.getCredential());
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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>LITTLE CARE · DEVICE SETUP</p>
        <h1>{view === 'parent' ? 'Independent baby monitoring' : 'Monitor device'}</h1>
        <p>{view === 'parent' ? 'Pair a separate phone to watch over your child without a babysitter booking.' : 'This phone can monitor one child after the parent pairs it.'}</p>
      </header>

      {initialView !== 'monitor' && (
        <div className={styles.viewSwitch} role="tablist" aria-label="Monitoring device setup">
          <button type="button" role="tab" aria-selected={view === 'parent'} className={view === 'parent' ? styles.selectedTab : styles.tab} onClick={() => { setView('parent'); setMessage(''); }}>Parent phone</button>
          <button type="button" role="tab" aria-selected={view === 'monitor'} className={view === 'monitor' ? styles.selectedTab : styles.tab} onClick={() => { setView('monitor'); setMessage(''); }}>Monitor device</button>
        </div>
      )}

      {view === 'parent' ? (
        <section className={styles.parentPanel}>
          <span className={styles.step}>PARENT PHONE</span>
          <h2>{parentSession?.Status === 'Active' ? 'Monitoring session' : 'Pair a monitor phone'}</h2>
          {parentSession?.Status === 'Active' ? (
            <>
              <p>{parentSession.DeviceConnected ? 'Monitor phone connected' : 'Waiting for the monitor phone to reconnect'}</p>
              <MonitoringMediaPanel status={media?.Configured ? 'ready' : media ? 'unavailable' : 'loading'} media={media?.Configured ? media : null} canPublish={false} reason={media?.Reason} childName={children.find((child) => Number(child.Child_ID) === Number(parentSession.ChildId))?.ChildName} />
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
              {pairingCode && <output className={styles.code} aria-label="Pairing code">{pairingCode.split('').map((character, index) => <span key={`${index}-${character}`}>{character}</span>)}</output>}
              <button className={styles.primaryButton} type="button" onClick={generateCode} disabled={busy || !childId}>{busy ? 'Creating…' : pairingCode ? 'Generate a new code' : 'Generate pairing code'}</button>
              {pairingCode && <p className={styles.footnote}>Enter this code on Phone 2 within five minutes. Creating another code invalidates this one.</p>}
            </>
          )}
        </section>
      ) : (
        <section className={styles.monitorPanel}>
          <span className={styles.monitorMark} aria-hidden="true">LC</span>
          <span className={styles.step}>PHONE 2</span>
          <h2>{credential ? 'Monitor device paired' : 'Connect this phone'}</h2>
          {credential ? (
            <>
              <MonitoringMediaPanel status={media?.Configured ? 'ready' : media ? 'unavailable' : 'loading'} media={media?.Configured ? media : null} canPublish={Boolean(media?.CanPublish)} reason={media?.Reason} />
              <CryDetector independent embedded />
            </>
          ) : (
            <>
              <p>Enter the one-time code shown in the parent app.</p>
              <form className={styles.pinForm} onSubmit={submitPin}>
                <label htmlFor="pairing-pin">Pairing code</label>
                <input id="pairing-pin" inputMode="text" autoComplete="one-time-code" maxLength={10} minLength={10} value={pin} onChange={(event) => { setPin(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 10)); setMessage(''); }} placeholder="10 characters" />
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
