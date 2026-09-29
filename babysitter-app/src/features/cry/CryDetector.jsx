import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import BackButton from '../../components/ui/BackButton';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { apiGet } from '../../services/apiClient';
import { API } from '../../services/api';
import styles from './cry-detector.module.css';

/* ================================================================
   CryDetector — Phase F5 Modernized UI with Preserved ML Engine
   TensorFlow.js (YAMNet) & Web Audio Frequency Fallback
================================================================ */

const YAMNET_MODEL_URL = '/yamnet/model.json';
const YAMNET_CSV_URL   = '/yamnet/yamnet_class_map.csv';
const CRY_LABELS       = ['baby cry', 'infant cry', 'crying', 'sobbing', 'whimper', 'babbling'];

const INITIAL_SECONDS  = 15;
const FAST_SECONDS     = 5;
const SILENCE_CHECKS   = 6;
const CHECK_MS         = 500;
const DB_THRESHOLD     = -15;
const RATIO_THRESHOLD  = 0.65;
const SILENCE_FLOOR    = -40;

function WaveformCanvas({ analyserRef, mode }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw() {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const analyser = analyserRef.current;
      let waveData;
      if (analyser) {
        const td = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(td);
        const step = Math.floor(td.length / 100);
        waveData = Array.from({ length: 100 }, (_, i) => td[i * step] ?? 128);
      } else {
        waveData = new Array(100).fill(128);
      }

      const color = mode === 'ml' ? '#E8622A' : mode === 'fallback' ? '#F39C12' : '#8E9AAF';
      const step = W / waveData.length;
      const mid = H / 2;

      // Glow line
      ctx.strokeStyle = color + '44';
      ctx.lineWidth = 4;
      ctx.beginPath();
      waveData.forEach((v, i) => {
        const x = i * step;
        const y = mid + ((v - 128) / 128) * (mid * 0.85);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Main line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      waveData.forEach((v, i) => {
        const x = i * step;
        const y = mid + ((v - 128) / 128) * (mid * 0.85);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyserRef, mode]);

  return (
    <canvas
      ref={canvasRef}
      width={440}
      height={64}
      style={{ display: 'block', width: '100%', height: 64, borderRadius: 8 }}
    />
  );
}

export default function CryDetector() {
  const navigate = useNavigate();

  const [isListening, setIsListening] = useState(false);
  const [mode, setMode] = useState('idle');
  const [statusText, setStatusText] = useState('Press Start to initiate acoustic baby cry monitoring.');
  const [alertCount, setAlertCount] = useState(0);
  const [logEntries, setLogEntries] = useState([]);
  const [metrics, setMetrics] = useState({ db: null, intensity: null, conf: null, label: null });
  const [timer, setTimer] = useState({ elapsed: 0, required: INITIAL_SECONDS, active: false, fastMode: false });

  const [activeJob, setActiveJob] = useState(null);


  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  const analyserRef     = useRef(null);
  const audioCtxRef     = useRef(null);
  const mlCtxRef        = useRef(null);
  const scriptNodeRef   = useRef(null);
  const streamRef       = useRef(null);
  const yamnetModelRef  = useRef(null);
  const classMapRef     = useRef(null);
  const audioBufRef     = useRef(new Float32Array(15600));
  const audioBufIdxRef  = useRef(0);
  const tickTimerRef    = useRef(null);
  const cryStartRef     = useRef(null);
  const fastModeRef     = useRef(false);
  const silenceCountRef = useRef(0);
  const modeRef         = useRef('idle');
  const tickRef         = useRef(null);

  const addLog = useCallback((msg) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogEntries((prev) => [{ msg, time }, ...prev].slice(0, 6));
  }, []);

  // Fetch active job on mount
  useEffect(() => {
    const sitterId = Number(localStorage.getItem('userId'));
    if (!sitterId) return;

    const fetchActiveJob = async () => {
      try {
        const data = await apiGet(`/jobs/active?babysitterId=${sitterId}`);
        if (data) {
          setActiveJob(data);
          addLog('Active job synchronized for session monitoring');
        }
      } catch {
        // Silently handle 401/404 or network errors to prevent console spam
      }
    };
    fetchActiveJob();
  }, [addLog]);

  // ---- PHASE 11: resolve the MONITORING SCOPE, not the legacy child column ----
  // A cry incident is per (job, child), and MonitoringAccess treats the job's
  // children as authoritative through the JobChildren table.
  //
  // /api/jobs/active reports `childId` from the LEGACY `Job.Child_ID` column
  // (JobService maps Child_ID = job.Child_ID), which can be null on jobs created
  // before that column was populated and can disagree with JobChildren. Using it
  // here would risk reporting a cry against a child the caller is not authorized
  // to monitor - or against no child at all.
  //
  // So the scope is resolved from GET /api/monitoring/accessible-scopes, which
  // returns (job, child) pairs the SERVER says this sitter may monitor right now
  // (AssignedSitter, InProgress, joined through JobChildren). That is the same
  // authority the cry endpoint enforces, so what we report is exactly what we
  // are allowed to report. We never guess, and never fall back to children[0].
  const [monitorScope, setMonitorScope] = useState(null);

  useEffect(() => {
    if (!activeJob?.jobId) return undefined;
    let cancelled = false;

    const resolveScope = async () => {
      try {
        const scopes = await API.getAccessibleMonitoringScopes();
        if (cancelled) return;
        // Match on the job we are actually monitoring. If a sitter is assigned
        // to more than one InProgress job, only that job's children are valid.
        const match = (scopes || []).find(
          (s) => Number(s.JobId) === Number(activeJob.jobId),
        );
        setMonitorScope(match || null);
        if (!match) {
          addLog('No monitorable child found for this job');
        }
      } catch {
        if (!cancelled) setMonitorScope(null);
      }
    };

    resolveScope();
    return () => {
      cancelled = true;
    };
  }, [activeJob?.jobId, addLog]);

  const stopListening = useCallback(() => {
    clearTimeout(tickTimerRef.current);
    if (scriptNodeRef.current) scriptNodeRef.current.disconnect();
    if (mlCtxRef.current?.state !== 'closed') mlCtxRef.current?.close();
    if (audioCtxRef.current?.state !== 'closed') audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    analyserRef.current = null;
    setIsListening(false);
    setMode('idle');
    modeRef.current = 'idle';
    cryStartRef.current = null;
    fastModeRef.current = false;
    silenceCountRef.current = 0;
    setTimer({ elapsed: 0, required: INITIAL_SECONDS, active: false, fastMode: false });
    setStatusText('Press Start to initiate acoustic baby cry monitoring.');
    setMetrics({ db: null, intensity: null, conf: null, label: null });
    addLog('Acoustic monitoring stopped');
  }, [addLog]);

  const sendAlert = useCallback(async () => {
    setAlertCount((prev) => prev + 1);
    addLog('CRITICAL: Infant cry verified - reporting to monitoring');

    // The scope must be one the SERVER says this sitter may monitor. If we
    // could not resolve it (no active job, job not InProgress, or no child
    // linked through JobChildren) we stop here and say so plainly. Guessing a
    // child id would either report against the wrong baby or be rejected, and
    // reporting a cry we cannot attribute is worse than reporting nothing.
    if (!monitorScope?.JobId || !monitorScope?.ChildId) {
      setStatusText('Cry detected, but no active monitoring session is available to report it.');
      addLog('No monitorable scope available - cry not reported');
      return;
    }

    try {
      // ---- PHASE 11: the ONE cry pipeline ----
      // This used to POST /cry-detection and, on any 200, declare
      //   "Parent connected. Video call stream open."
      // That was false on both counts: the legacy endpoint inserts through the
      // STALE EDMX CryAlert mapping with NextEscalationDueAt = NULL, so the
      // sweeper could never escalate it and NOBODY was ever notified; and it
      // then opened the PUBLIC meet.jit.si room from a locally generated
      // roomName. It also sent client-supplied parentId/babysitterId, which the
      // security audit flags as a client-controlled identity.
      //
      // Now the detector only submits a CLAIM. The server is authoritative for
      // incident creation, T+5 sitter alert, T+15 parent escalation,
      // acknowledgement, resolution and dedupe. No identity is supplied by the
      // client - it comes from the bearer token.
      //
      // The response's Reused flag tells us the incident was already open, which
      // is what stops a continuously-firing YAMNet model creating an alert storm.
      const data = await API.reportCry(monitorScope.JobId, monitorScope.ChildId);

      stopListening();

      if (data?.Reused) {
        setStatusText('Cry still ongoing - the existing incident was updated.');
        addLog('Existing cry incident reused (deduplicated)');
      } else {
        setStatusText('Cry reported. The sitter has been alerted.');
        addLog('Cry incident created; escalation is now server-controlled');
      }
    } catch (err) {
      // Phase 12: the server refuses a cry claim while a parent pause is active
      // and answers 409 with { error: 'paused' }. That is a normal, expected
      // state - not a failure - so the detector must say so plainly instead of
      // claiming the network is broken. This keeps Phone 2 honest during the
      // 150-second window without touching the frozen business rule.
      const code = err?.response?.status ?? err?.status;
      if (code === 409) {
        setStatusText('Cry detection is paused by a parent right now.');
        addLog('Cry not reported: a parent pause is active');
        // Keep listening: detection resumes automatically when the pause expires.
        return;
      }
      setStatusText('Could not reach the server to report the cry.');
      addLog('Network error dispatching cry alert');
    }
  }, [monitorScope, addLog, stopListening]);

  // TensorFlow & YAMNet loaders (unchanged)
  function loadTFJS() {
    return new Promise((resolve, reject) => {
      if (window.tf?.loadGraphModel) {
        resolve(window.tf);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        setTimeout(() => {
          window.tf?.loadGraphModel ? resolve(window.tf) : reject(new Error('TF.js missing after load'));
        }, 200);
      };
      script.onerror = () => reject(new Error('TF.js script failed to load'));
      document.head.appendChild(script);
    });
  }

  async function loadYAMNet() {
    const probe = await fetch(YAMNET_MODEL_URL, { method: 'HEAD' }).catch(() => null);
    if (!probe?.ok) throw new Error('model.json not found at ' + YAMNET_MODEL_URL);
    await loadTFJS();
    yamnetModelRef.current = await window.tf.loadGraphModel(YAMNET_MODEL_URL);
    const csvRes = await fetch(YAMNET_CSV_URL);
    if (!csvRes.ok) throw new Error('class map CSV not found');
    const csv = await csvRes.text();
    const map = {};
    csv.split('\n').slice(1).forEach((row) => {
      const p = row.split(',');
      if (p.length >= 3) map[parseInt(p[0].trim(), 10)] = p[2].trim().replace(/"/g, '');
    });
    classMapRef.current = map;
  }

  function setupMLAudio(stream) {
    const ctx = new AudioContext({ sampleRate: 16000 });
    mlCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 3;
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    scriptNodeRef.current = sp;
    audioBufIdxRef.current = 0;
    source.connect(gain);
    gain.connect(sp);
    sp.connect(ctx.destination);
    sp.onaudioprocess = (e) => {
      const inp = e.inputBuffer.getChannelData(0);
      const len = inp.length;
      if (len >= 15600) {
        audioBufRef.current.set(inp.subarray(len - 15600));
      } else {
        audioBufRef.current.copyWithin(0, len);
        audioBufRef.current.set(inp, 15600 - len);
      }
      audioBufIdxRef.current = 15600;
    };
  }

  function predictCryML() {
    if (!yamnetModelRef.current || !classMapRef.current || audioBufIdxRef.current < 15600) {
      return { isCry: false };
    }
    try {
      const tf = window.tf;
      const buffer = audioBufRef.current.slice(0, 15600);
      if (buffer.every((v) => v === 0)) return { isCry: false };
      const tensor = tf.tensor1d(buffer);
      const output = yamnetModelRef.current.predict(tensor);
      const scoresTensor = Array.isArray(output) ? output[0] : output;
      const data = scoresTensor.dataSync();
      const maxIdx = data.indexOf(Math.max(...data));
      const label = classMapRef.current[maxIdx];
      const conf = data[maxIdx];
      tensor.dispose();
      Array.isArray(output) ? output.forEach((t) => t.dispose()) : output.dispose();
      const isCry = CRY_LABELS.some((l) => label?.toLowerCase().includes(l)) && conf >= 0.4;
      return { isCry, conf, label };
    } catch (e) {
      console.warn('ML predict error', e);
      return { isCry: false };
    }
  }

  function getCryMetrics() {
    const analyser = analyserRef.current;
    if (!analyser) return null;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const sr = audioCtxRef.current?.sampleRate || 44100;
    const bw = sr / analyser.fftSize;
    const lo = Math.floor(300 / bw);
    const hi = Math.floor(600 / bw);
    const tlo = Math.floor(80 / bw);
    const thi = Math.floor(4000 / bw);
    let cE = 0;
    let tE = 0;
    let cC = 0;
    let tC = 0;
    for (let i = lo; i <= hi; i++) {
      cE += data[i] * data[i];
      cC++;
    }
    for (let i = tlo; i <= thi; i++) {
      tE += data[i] * data[i];
      tC++;
    }
    const avgC = cC ? cE / cC : 0;
    const avgT = tC ? tE / tC : 0;
    return {
      cryDB: 10 * Math.log10(avgC / 255 + 1e-10),
      totalDB: 10 * Math.log10(avgT / 255 + 1e-10),
      ratio: avgT ? avgC / avgT : 0,
    };
  }

  const tick = useCallback(() => {
    const m = getCryMetrics();
    let isCry = false;
    let conf = null;
    let label = null;

    if (modeRef.current === 'ml') {
      const res = predictCryML();
      isCry = res.isCry;
      conf = res.conf;
      label = res.label;
      if (m?.totalDB < SILENCE_FLOOR) isCry = false;
    } else if (modeRef.current === 'fallback') {
      if (m && m.totalDB >= SILENCE_FLOOR && m.cryDB > DB_THRESHOLD && m.ratio >= RATIO_THRESHOLD) {
        isCry = true;
      }
    }

    setMetrics({
      db: m?.totalDB != null ? m.totalDB.toFixed(1) : null,
      intensity: m?.ratio != null ? Math.round(m.ratio * 100) : null,
      conf: conf != null ? Math.round(conf * 100) : null,
      label: label || null,
    });

    if (isCry) {
      silenceCountRef.current = 0;
      if (!cryStartRef.current) {
        cryStartRef.current = Date.now();
        setStatusText('⚠️ Infant crying detected — validating duration…');
        addLog('Infant cry pattern recognized');
      } else {
        const elapsed = (Date.now() - cryStartRef.current) / 1000;
        const required = fastModeRef.current ? FAST_SECONDS : INITIAL_SECONDS;
        setTimer({ elapsed, required, active: true, fastMode: fastModeRef.current });
        setStatusText(
          `Crying sustained for ${elapsed.toFixed(0)}s${fastModeRef.current ? ' (Fast Mode ⚡)' : ''}`
        );
        if (elapsed >= required) {
          sendAlert();
          fastModeRef.current = true;
          cryStartRef.current = Date.now();
        }
      }
    } else {
      silenceCountRef.current++;
      if (silenceCountRef.current >= SILENCE_CHECKS) {
        cryStartRef.current = null;
        fastModeRef.current = false;
        silenceCountRef.current = 0;
        setTimer({ elapsed: 0, required: INITIAL_SECONDS, active: false, fastMode: false });
        setStatusText('Acoustic environment calm · Listening for infant sounds…');
      } else if (cryStartRef.current) {
        const elapsed = (Date.now() - cryStartRef.current) / 1000;
        setStatusText(`Pause detected (${silenceCountRef.current}/${SILENCE_CHECKS}) · ${elapsed.toFixed(0)}s elapsed`);
      }
    }
    tickTimerRef.current = setTimeout(() => {
      tickRef.current?.();
    }, CHECK_MS);
  }, [addLog, sendAlert]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  async function startListening() {
    setMicPermissionDenied(false);
    setMode('loading');
    modeRef.current = 'loading';
    setStatusText('Initializing microphone hardware…');

    try {
      let str;
      try {
        str = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch {
        str = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = str;

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(str);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const gain = ctx.createGain();
      gain.gain.value = 2.5;
      source.connect(gain);
      gain.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      try {
        setupMLAudio(str);
        await loadYAMNet();
        setMode('ml');
        modeRef.current = 'ml';
        setStatusText('Neural YAMNet model listening for infant cries…');
        addLog('YAMNet neural model activated');
      } catch (e) {
        console.warn('YAMNet fallback mode:', e.message);
        setMode('fallback');
        modeRef.current = 'fallback';
        setStatusText('Acoustic frequency fallback listening…');
        addLog('Frequency spectral analyzer activated');
      }

      setIsListening(true);
      tick();
    } catch (err) {
      console.error('Microphone error', err);
      setMicPermissionDenied(true);
      setStatusText('Microphone permission denied.');
      setMode('idle');
      modeRef.current = 'idle';
      addLog('Error: mic permission denied');
    }
  }

  useEffect(() => {
    return () => clearTimeout(tickTimerRef.current);
  }, []);

  // ---- PHASE 11: the emergency "video call" view is REMOVED ----
  // This screen used to swap itself for a Jitsi meeting on a room name the
  // DEVICE invented, hosted on the public meet.jit.si, labelled "LIVE VIDEO
  // CONNECTION". That was wrong three times over:
  //   * the room was not authorised by anything - any name that reached the
  //     browser was a way in,
  //   * meet.jit.si is an uncontrolled public host, so the badge overstated
  //     the security of the call, and
  //   * it fired on a cry DETECTION, which inverted the whole design: cry
  //     detection is an ADDITIONAL capability, not the thing that starts the
  //     camera. The feed must be continuous while monitoring is active.
  //
  // Live video now lives in one place - /baby-monitoring - which requests a
  // server-issued, MonitoringAccess-gated media session. This screen keeps its
  // actual job: running YAMNet locally and reporting a cry claim to the server.
  // The jitsiRoom / inCall state is gone with the view.

  // Permission Denied View
  if (micPermissionDenied) {
    return (
      <div className={styles.cryContainer}>
        <div className={styles.topBar}>
          <BackButton />
          <h1 className={styles.pageTitle}>Microphone Permissions</h1>
          <div style={{ width: 42 }} />
        </div>

        <EmptyState
          title="Microphone Access Required"
          description="Baby Minder requires microphone access to process acoustic soundwaves and detect infant cries in real-time."
          actionLabel="Grant Microphone Permission"
          onAction={startListening}
        />
      </div>
    );
  }

  const isAlarmed = timer.active && timer.elapsed > 2;

  return (
    <div className={`${styles.cryContainer} ${isAlarmed ? styles.cryContainerAlarmed : ''}`}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <BackButton
          onClick={() => {
            stopListening();
            navigate(-1);
          }}
          ariaLabel="Back"
        />
        <h1 className={styles.pageTitle}>AI Cry Minder</h1>
        <div style={{ width: 42 }} />
      </div>

      {/* Hero Radar & Status Card */}
      <section className={`${styles.radarCard} ${isAlarmed ? styles.radarCardAlarmed : ''}`}>
        {/* Radar concentric ripple effect */}
        <div className={`${styles.radarWrapper} ${isListening ? styles.radarActive : ''}`}>
          <div className={styles.radarRing1} />
          <div className={styles.radarRing2} />
          <div className={styles.radarRing3} />
          <div className={`${styles.radarCenter} ${isAlarmed ? styles.radarCenterAlarmed : ''}`}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
        </div>

        {/* Dynamic Status Pill */}
        <div>
          {isAlarmed ? (
            <span className={`${styles.statusBadge} ${styles.statusCry}`}>
              🚨 CRY DETECTED!
            </span>
          ) : isListening ? (
            <span className={`${styles.statusBadge} ${styles.statusListening}`}>
              ● {mode === 'ml' ? 'Neural YAMNet Active' : 'Frequency Fallback Active'}
            </span>
          ) : (
            <span className={`${styles.statusBadge} ${styles.statusCalm}`}>
              Standby Mode
            </span>
          )}
        </div>

        <p className={styles.statusText}>{statusText}</p>

        {/* Real-time Oscilloscope Waveform */}
        <div className={styles.waveformBox}>
          <WaveformCanvas analyserRef={analyserRef} mode={mode} />
        </div>
      </section>

      {/* Cry Duration Progress Bar (when cry detected) */}
      {timer.active && (
        <section className={styles.timerCard}>
          <div className={styles.timerHeader}>
            <span>{timer.fastMode ? '⚡ Sustained Cry (Fast Alert Mode)' : 'Infant Cry Duration'}</span>
            <span style={{ color: 'var(--color-primary)' }}>
              {timer.elapsed.toFixed(0)}s / {timer.required}s
            </span>
          </div>
          <div className={styles.timerBarTrack}>
            <div
              className={styles.timerBarFill}
              style={{ width: `${Math.min(100, (timer.elapsed / timer.required) * 100)}%` }}
            />
          </div>
        </section>
      )}

      {/* 4-Bento Metrics Grid */}
      <section className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Sound Level</span>
          <p className={styles.metricVal}>
            {metrics.db != null ? `${metrics.db} dB` : '—'}
          </p>
          <span className={styles.metricSub}>Ambient volume</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Cry Ratio</span>
          <p className={styles.metricVal}>
            {metrics.intensity != null ? `${metrics.intensity}%` : '—'}
          </p>
          <span className={styles.metricSub}>300–600 Hz band</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>ML Confidence</span>
          <p className={styles.metricVal}>
            {metrics.conf != null ? `${metrics.conf}%` : '—'}
          </p>
          <span className={styles.metricSub}>YAMNet threshold</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Acoustic Class</span>
          <p className={styles.metricVal} style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {metrics.label || 'None'}
          </p>
          <span className={styles.metricSub}>Classification</span>
        </div>
      </section>

      {/* Session Alert Count Banner */}
      {alertCount > 0 && (
        <div style={{
          background: 'var(--badge-warning-bg)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
            🚨 {alertCount} Alert{alertCount !== 1 ? 's' : ''} sent to parent
          </span>
          <button
            type="button"
            onClick={() => setAlertCount(0)}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 700, cursor: 'pointer', fontSize: '12px' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Activity Log */}
      {logEntries.length > 0 && (
        <section className={styles.logCard}>
          <h3 className={styles.logTitle}>Monitoring Event Log</h3>
          <div className={styles.logList}>
            {logEntries.map((e, i) => (
              <div key={i} className={styles.logItem}>
                <span>{e.msg}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{e.time}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Primary Listen Action */}
      <div style={{ marginTop: 'auto', paddingTop: 'var(--space-2)' }}>
        {isListening ? (
          <Button
            variant="danger"
            size="lg"
            fullWidth
            onClick={stopListening}
          >
            Stop Cry Monitoring
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={startListening}
          >
            Start Cry Monitoring
          </Button>
        )}
      </div>
    </div>
  );
}

