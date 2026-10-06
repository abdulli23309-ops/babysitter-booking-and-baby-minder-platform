import styles from './device-feeding-telemetry.module.css';

/**
 * DeviceFeedingTelemetry - PHASE 3 status strip for Phone 2.
 *
 * WHERE IT SITS AND WHY
 *   A single glassmorphic pill anchored to the TOP EDGE of the camera stage
 *   (MonitorCameraScreen's .stage, which is position:relative). It floats
 *   ABOVE the MiroTalk surface without altering a single pixel of the feed's
 *   own layout - no iframe, no provider config, no MonitoringMediaPanel
 *   change. It is informational only: it renders no controls, so a nursery
 *   phone can be glanced at and nothing can be fat-fingered.
 *
 * STATES (all values come from useDeviceFeeding - the component never
 * invents a status):
 *   idle       -> renders nothing at all (unobtrusive by default)
 *   pending    -> "Pending recording request detected"
 *   recording  -> "● Recording [MM:SS]" with a live elapsed counter
 *   uploading  -> "Uploading recording..."
 *   completed  -> "✓ Recording complete (Status: Uploaded, Duration: 30s)"
 *   failed     -> "Recording/Upload failed" + the honest reason
 *
 * ACCESSIBILITY
 *   role="status" + aria-live="polite": the state is announced as text, never
 *   by colour or animation alone.
 */

const formatClock = (totalSeconds) => {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export default function DeviceFeedingTelemetry({ phase, elapsed, result, failure }) {
  if (!phase || phase === 'idle') return null;

  let tone;
  let text;

  if (phase === 'pending') {
    tone = 'detected';
    text = 'Pending recording request detected';
  } else if (phase === 'recording') {
    tone = 'recording';
    text = `● Recording [${formatClock(elapsed)}]`;
  } else if (phase === 'uploading') {
    tone = 'uploading';
    text = 'Uploading recording...';
  } else if (phase === 'completed') {
    tone = 'done';
    const seconds = result?.durationSeconds ?? 0;
    text = `✓ Recording complete (Status: Uploaded, Duration: ${seconds}s)`;
  } else if (phase === 'failed') {
    tone = 'failed';
    text = 'Recording/Upload failed';
  } else {
    return null;
  }

  return (
    <div className={styles.telemetry} data-tone={tone} role="status" aria-live="polite">
      <span className={styles.pip} aria-hidden="true" />
      <span className={styles.text}>{text}</span>
      {phase === 'failed' && failure ? (
        <span className={styles.detail}>{failure}</span>
      ) : null}
    </div>
  );
}
