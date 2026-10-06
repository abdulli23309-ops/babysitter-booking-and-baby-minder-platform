import { useState } from 'react';
import { deviceStore } from '../../services/independentMonitoringApi';
import {
  POC_RESULT,
  claimPending,
  runCameraExperiment,
  uploadRecording,
} from '../../services/deviceFeedingPoc';
import styles from './device-feeding-poc.module.css';

/**
 * One result line. Declared at MODULE scope, not inside DeviceFeedingPoc:
 * defining a component during render makes React unmount and remount it on
 * every parent render, which would destroy the `<pre>` scroll position and the
 * results tree mid-experiment.
 */
function ResultRow({ label, value }) {
  const tone = value === 'PASS' ? 'ok' : value === 'FAIL' ? 'bad' : 'none';
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value} data-tone={tone}>{value}</span>
    </div>
  );
}

/**
 * DeviceFeedingPoc - PHASE 2 camera-capability panel.
 *
 * DEV ONLY. It renders nothing at all unless the URL carries ?poc=1, so it
 * cannot appear on a real user's phone.
 *
 * IT DISPLAYS OBSERVATIONS, NOT A SINGLE VERDICT. Every line is an independent
 * measurement, because the whole point of the phase is to keep "permission was
 * granted" and "a second stream was actually provided" separate. A screen that
 * said only "camera: OK" would have hidden the exact ambiguity this experiment
 * exists to resolve.
 *
 * It also never invents a success: a failed getUserMedia shows the browser's
 * own error name and message verbatim.
 */
export default function DeviceFeedingPoc() {
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [miroTalkConfirmed, setMiroTalkConfirmed] = useState(false);

  const run = async () => {
    setRunning(true);
    setReport(null);
    try {
      // Ask the existing Phase 1 backend whether there is work to do. If a
      // sitter has pressed Feed Baby, this claims it and yields the PublicId
      // the upload must reference. If not, the operator can still run the
      // camera capability test on its own.
      let pending = null;
      try {
        pending = await claimPending({ credential: deviceStore.getCredential() });
      } catch (err) {
        // A device that cannot claim work can still PROVE the camera question,
        // so this is recorded, not fatal.
        setReport({ phase: 'pending-unavailable', errorName: err?.name, errorMessage: err?.message });
      }

      const result = await runCameraExperiment({
        durationMs: 30000,
        onPhase: setReport,
      });

      // Record whether MiroTalk was observed running during the test. The
      // operator asserts this; the code must not claim it automatically.
      result.miroTalkActive = miroTalkConfirmed ? POC_RESULT.PASS : POC_RESULT.UNKNOWN;
      result.requestedPublicId = pending?.Id || null;
      setReport(result);

      // Upload ONLY a real, non-zero blob. No fallback path exists.
      if (result.blob && result.blob.size > 0 && pending?.Id) {
        const upload = await uploadRecording({
          blob: result.blob,
          publicId: pending.Id,
          durationSeconds: Math.round(result.elapsedMs / 1000),
          credential: deviceStore.getCredential(),
        });
        setReport({ ...result, upload });
      } else if (!pending?.Id) {
        setReport({
          ...result,
          upload: {
            attempted: false,
            ok: null,
            error: 'No pending Phase 1 request, so there is no PublicId to upload against. '
              + 'Press Feed Baby on the sitter device, then run this test again.',
          },
        });
      }
    } catch (err) {
      setReport({ phase: 'crashed', errorName: err?.name, errorMessage: err?.message });
    } finally {
      setRunning(false);
    }
  };


  return (
    <div className={styles.panel} data-testid="device-feeding-poc">
      <p className={styles.title}>Recording capability test (Phase 2)</p>

      <label className={styles.confirm}>
        <input
          type="checkbox"
          checked={miroTalkConfirmed}
          onChange={(e) => setMiroTalkConfirmed(e.target.checked)}
        />
        MiroTalk camera is currently running on this device
      </label>

      <button type="button" className={styles.run} onClick={run} disabled={running}>
        {running ? 'Running 30s experiment...' : 'Run camera capability test'}
      </button>

      {report && (
        <div className={styles.results}>
          <ResultRow label="Camera permission" value={report.cameraPermission || POC_RESULT.UNKNOWN} />
          <ResultRow label="MiroTalk active" value={report.miroTalkActive || POC_RESULT.UNKNOWN} />
          <ResultRow label="Second getUserMedia" value={report.secondGetUserMedia || POC_RESULT.UNKNOWN} />
          <ResultRow label="Second video track" value={report.secondVideoTrack || POC_RESULT.UNKNOWN} />
          <ResultRow label="WebM MIME found" value={report.mimeTypeFound || POC_RESULT.UNKNOWN} />
          <ResultRow label="MediaRecorder" value={report.mediaRecorder || POC_RESULT.UNKNOWN} />
          <ResultRow label="Data received" value={report.dataReceived || POC_RESULT.UNKNOWN} />
          <ResultRow label="Recording" value={report.recording || POC_RESULT.UNKNOWN} />
          <ResultRow label="WebM Blob" value={report.webmBlob || POC_RESULT.UNKNOWN} />
          <ResultRow label="Upload" value={report.upload ? (report.upload.ok === null ? 'n/a' : report.upload.ok ? 'PASS' : 'FAIL') : POC_RESULT.UNKNOWN} />
          <ResultRow label="Cleanup" value={report.cleanup || POC_RESULT.UNKNOWN} />

          <pre className={styles.raw}>
            {JSON.stringify({
              phase: report.phase,
              elapsedMs: report.elapsedMs,
              blobSizeBytes: report.blobSizeBytes,
              blobType: report.blobType,
              mimeType: report.mimeType,
              chunks: report.chunks,
              trackSettings: report.trackSettings,
              errorName: report.errorName,
              errorMessage: report.errorMessage,
              upload: report.upload,
              userAgent: report.userAgent,
              secureContext: report.secureContext,
            }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
