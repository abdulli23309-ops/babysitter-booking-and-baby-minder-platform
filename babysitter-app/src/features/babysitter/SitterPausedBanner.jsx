/**
 * Phase 7 — sitter banner for an approved parent pause.
 *
 * WHY THE SITTER GETS NO PAUSE ENDPOINT
 *   Pause is a PARENT-only feature. The sitter may not request, approve, deny
 *   or cancel it, and this component deliberately renders NO controls. The
 *   banner is driven entirely by the `IsPaused` / `PauseSecondsRemaining`
 *   fields the backend already returns from the EXISTING monitoring session
 *   endpoint (GET api/monitoring/session) - there is no sitter pause API.
 *
 * SECURITY / AUTHORITATIVE VALUES
 *   The server is the source of truth. This component never decides whether a
 *   pause is active, how long it lasts, or who requested it - it only renders
 *   what the server said. A pause is NOT a connection loss and NOT a session
 *   end: the session stays Active and heartbeats keep being recorded, so this
 *   banner must not be used to stop the video or the heartbeat.
 *
 * USAGE
 *   <SitterPausedBanner session={session} />
 *   where `session` is the MonitorSessionDto from the session GET. When the
 *   object is null the component renders nothing.
 */
import { useEffect, useState } from 'react';

const formatCountdown = (seconds) => {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

export default function SitterPausedBanner({ session }) {
  // Countdown mirroring the server value.
  //
  // The server is authoritative: `serverSeconds` only ever comes from a server
  // response. `elapsed` counts the seconds since that value was applied and is
  // reset whenever a new poll delivers a different one, so the label animates
  // between polls but a stale page can never EXTEND the pause.
  const [serverSeconds, setServerSeconds] = useState(session?.PauseSecondsRemaining ?? 0);
  const [elapsed, setElapsed] = useState(0);

  // React's supported "adjust state when a prop changes" pattern: re-anchor as
  // soon as a different server value arrives, without an extra render pass.
  if ((session?.PauseSecondsRemaining ?? 0) !== serverSeconds) {
    setServerSeconds(session?.PauseSecondsRemaining ?? 0);
    setElapsed(0);
  }

  useEffect(() => {
    if (!session?.IsPaused) return undefined;
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [session?.IsPaused]);

  if (!session?.IsPaused) return null;

  // Pure derivation from state only - no refs and no clock reads during render.
  const remaining = Math.max(0, serverSeconds - elapsed);

  return (
    <div role="status" aria-live="polite">
      <strong>Monitoring temporarily paused by parent</strong>
      <span> — resumes in {formatCountdown(remaining)}</span>
      <p>
        The session is still active and the camera is still available. Cry detection
        and escalation are paused, and any alert raised before the pause has been
        cancelled.
      </p>
    </div>
  );
}
