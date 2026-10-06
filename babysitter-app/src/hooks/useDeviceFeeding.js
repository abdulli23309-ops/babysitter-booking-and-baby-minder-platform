import { useCallback, useEffect, useRef, useState } from 'react';
import {
  claimPending,
  runCameraExperiment,
  uploadRecording,
} from '../services/deviceFeedingPoc';

/**
 * useDeviceFeeding - PHASE 3 production feeding-recorder for Phone 2.
 *
 * REUSES THE PROVEN PHASE 2 PIPELINE - NOTHING IS REINVENTED
 *   claimPending()          GET  /device/feeding/pending   (atomic claim)
 *   runCameraExperiment()   the real second-getUserMedia + MediaRecorder run
 *   uploadRecording()       POST /device/feeding/upload    (multipart WebM)
 *   deviceFeedingPoc.js itself is NOT modified; this hook only drives it.
 *
 * THE PHASES THIS HOOK EXPOSES (what DeviceFeedingTelemetry renders)
 *   idle       - nothing to do; polling quietly every few seconds
 *   pending    - the server just handed us a claim ("pending request detected")
 *   recording  - MediaRecorder is running; `elapsed` counts seconds
 *   uploading  - the 30s clip is in flight to /device/feeding/upload
 *   completed  - server accepted the upload; `result.durationSeconds` is REAL
 *   failed     - capture or upload failed; `failure` carries the honest reason
 *
 * WHY A FAILURE IS ALSO REPORTED TO THE SERVER
 *   If the device claims a request and then cannot record, the row stays
 *   'Requested' forever and the UX_FeedingRecording_Active index blocks every
 *   future request for that child. POST /device/feeding/fail (Phase 1, already
 *   proven server-side) moves the row to 'Failed' and releases the slot. This
 *   hook calls it with the SAME X-Monitor-Device credential style as the
 *   proven upload path - raw fetch, never apiClient, because a device 401
 *   means "pairing ended", NOT "log the account out".
 *
 * IT NEVER TOUCHES MIROTALK
 *   The experiment performs an independent getUserMedia alongside the SFU
 *   (the exact question Phase 2 physically proved) and releases every track
 *   it opens. No iframe, no provider config and no media panel are touched.
 */

const POLL_MS = 5000;
const RECORD_MS = 30000;
const API_ROOT = () => import.meta.env.VITE_API_BASE || '/api';

/** Honest, server-releasing failure report. Never throws - it is telemetry. */
async function reportDeviceFailure({ credential, recordingId, reason }) {
  if (!credential || !recordingId) return;
  let safe = reason || 'Unknown failure';
  if (safe.length > 200) safe = safe.slice(0, 200);
  try {
    await fetch(`${API_ROOT()}/independent-monitoring/device/feeding/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Monitor-Device': credential },
      body: JSON.stringify({ RecordingId: recordingId, Reason: safe }),
    });
  } catch {
    /* The local phase already says "failed"; a lost report must not crash
       the camera screen. The server's own lifecycle still bounds the row. */
  }
}

export default function useDeviceFeeding({ credential }) {
  const [phase, setPhase] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);   // { durationSeconds, publicId }
  const [failure, setFailure] = useState(null); // honest reason string

  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const publicIdRef = useRef(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const failClaim = useCallback(async (recordingId, reason) => {
    await reportDeviceFailure({ credential, recordingId, reason });
    if (!mountedRef.current) return;
    setFailure(reason);
    setPhase('failed');
  }, [credential]);

  const runOne = useCallback(async () => {
    if (!credential || busyRef.current) return;
    busyRef.current = true;
    try {
      // 1 - Ask the proven Phase 1 endpoint whether there is work. A 200 with
      //     a null body is the NORMAL "nothing to do" answer.
      let pending = null;
      try {
        pending = await claimPending({ credential });
      } catch {
        // A revoked pairing surfaces through media refresh elsewhere; the
        // recorder simply stays idle rather than claiming work it cannot do.
        return;
      }

      if (!pending?.Id) return;
      if (!mountedRef.current) return;

      // 2 - Claimed. From here the server row is 'Recording'; either a real
      //     upload or an honest /fail must follow.
      publicIdRef.current = pending.Id;
      setFailure(null);
      setResult(null);
      setElapsed(0);
      setPhase('pending');

      startedAtRef.current = Date.now();
      setPhase('recording');

      // 2b - Local elapsed ticker so the overlay can show [MM:SS] truthfully.
      const ticker = window.setInterval(() => {
        if (mountedRef.current) {
          setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      }, 1000);

      let report;
      try {
        report = await runCameraExperiment({ durationMs: RECORD_MS });
      } finally {
        window.clearInterval(ticker);
      }

      const recorded = report?.blob && report.blob.size > 0;
      if (!recorded) {
        const reason = report?.errorName
          ? `${report.errorName}: ${report.errorMessage || 'recording failed'}`
          : 'Recording produced no data.';
        await failClaim(publicIdRef.current, reason);
        return;
      }

      // 3 - Upload through the proven multipart contract.
      const durationSeconds = Math.round((report.elapsedMs ?? RECORD_MS) / 1000);
      setElapsed(durationSeconds);
      setPhase('uploading');
      const upload = await uploadRecording({
        blob: report.blob,
        publicId: pending.Id,
        durationSeconds,
        credential,
      });

      if (!mountedRef.current) return;

      if (upload?.ok) {
        setResult({ durationSeconds, publicId: pending.Id });
        setPhase('completed');
      } else {
        await failClaim(pending.Id, upload?.error || 'Upload failed.');
      }
    } catch (err) {
      // Unexpected crash (never seen in Phase 2 runs, but honesty over silence).
      if (mountedRef.current && publicIdRef.current) {
        await failClaim(publicIdRef.current, `${err?.name || 'Error'}: ${err?.message || err}`);
      }
    } finally {
      busyRef.current = false;
    }
  }, [credential, failClaim]);

  // Quiet polling loop. Skipped while a recording/upload is in flight, and
  // torn down on unmount (the interval is cleared; the guard stops any
  // in-flight tick from writing to an unmounted component).
  useEffect(() => {
    if (!credential) return undefined;
    const timer = window.setInterval(() => { runOne(); }, POLL_MS);
    // One early attempt so an already-waiting request is picked up fast.
    const kick = window.setTimeout(() => { runOne(); }, 400);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(kick);
    };
  }, [credential, runOne]);

  return { phase, elapsed, result, failure };
}

