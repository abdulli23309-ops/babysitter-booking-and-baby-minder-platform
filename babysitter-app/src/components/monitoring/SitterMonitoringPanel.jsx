/**
 * SitterMonitoringPanel - the sitter's half of child monitoring (Phase 8).
 *
 * WHY A SEPARATE COMPONENT
 *   The sitter and the parent share the same backend state (session,
 *   heartbeat, incident, pause) but need DIFFERENT affordances:
 *     - the sitter may respond to a cry (Going to Child / View Child / With
 *       Child) but may NEVER request, approve, deny or cancel a parent pause;
 *     - the sitter has no guardian/pause/DND management surface at all;
 *     - the sitter must be able to see a pause and keep viewing the camera.
 *   Putting this in its own component guarantees those boundaries are visible in
 *   the code rather than hidden behind conditionals in a shared screen.
 *
 * BACKEND IS AUTHORITATIVE
 *   Every state shown here comes from useMonitoring, which only sends
 *   { jobId, childId }. This component never computes when T+5 or T+15 fires,
 *   never expires a pause, and never marks the connection lost. In particular
 *   the urgent alert block disappears only because the server says the
 *   incident is Resolved or Cancelled.
 *
 * CONNECTION-LOSS WORDING
 *   The warning deliberately does NOT say the child is safe and does NOT say
 *   monitoring stopped. It reports that we cannot currently confirm the link -
 *   the server still considers the session Active.
 */
// SitterPausedBanner was built in Phase 7 and is intentionally MOUNTED here
// (rather than duplicated) so the sitter sees the pause through the normal
// active-job journey.
import { useState } from 'react';
import SitterPausedBanner from '../../features/babysitter/SitterPausedBanner.jsx';
import styles from './sitter-monitoring.module.css';

const isActiveIncident = (incident) => {
  const s = String(incident?.Status || '').toLowerCase();
  return s === 'open' || s === 'acknowledged';
};

export default function SitterMonitoringPanel({
  session,
  incident,
  offline,
  onGoingToChild,
  onWithChild,
  onViewChild,
  busy = false,
  canRespond = true,
}) {
  const [dismissedConnectionKey, setDismissedConnectionKey] = useState('');
  const sessionActive = session?.Status === 'Active';
  const urgent = isActiveIncident(incident);
  // `!offline` is deliberate and easy to misread. `offline` means WE cannot reach
  // the server, so ParentConnection/SitterConnection are stale or unknown and
  // asserting "connection lost" from them would be a client-side guess. The
  // banner is therefore shown only when we CAN reach the server AND the server
  // itself says a participant has gone quiet (Phase 4 stale-heartbeat rule).
  const connectionLost = sessionActive && !offline
    && (session.ParentConnection === 'Lost' || session.SitterConnection === 'Lost');

  const connectionKey = [
    session?.MonitorSession_ID ?? '',
    session?.ParentConnection === 'Lost' ? session.ParentHeartbeatUtc ?? '' : '',
    session?.SitterConnection === 'Lost' ? session.SitterHeartbeatUtc ?? '' : '',
  ].join('|');

  return (
    <section className={styles.panel} aria-label="Child monitoring">
      {/* Pause is a PARENT action. The sitter only ever sees the resulting
          state through the existing session endpoint - there is deliberately no
          sitter pause endpoint, and this component exposes no pause controls. */}
      <SitterPausedBanner session={session} />

      {connectionLost && dismissedConnectionKey !== connectionKey ? (
        <div role="alert" className={styles.warnBox}>
          <div className={styles.warnContent}>
            <span className={styles.warnDot} aria-hidden="true" />
            <div>
              <strong>Child monitoring connection lost</strong>
              <p>
                The session remains active. We cannot currently confirm the monitoring
                connection; status will update automatically when it returns.
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.dismissWarning}
            aria-label="Dismiss connection warning"
            onClick={() => setDismissedConnectionKey(connectionKey)}
          >
            ×
          </button>
        </div>
      ) : null}

      {urgent ? (
        <div role="alert" className={styles.alertBox}>
          <strong>
            {incident?.SitterResponse === 'GoingToChild'
              ? 'You told us you are going to the child'
              : 'Your baby may need attention'}
          </strong>
          <p>
            A cry was detected during this monitored session. The parents are notified
            automatically if you do not respond.
          </p>

          {canRespond ? (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryAction}
                disabled={busy}
                onClick={onGoingToChild}
              >
                I&apos;m going to the child
              </button>
              <button
                type="button"
                className={styles.secondaryAction}
                disabled={busy}
                onClick={onViewChild}
              >
                View child
              </button>
              <button
                type="button"
                className={styles.secondaryAction}
                disabled={busy}
                onClick={onWithChild}
              >
                With child
              </button>
            </div>
          ) : (
            <p className={styles.mutedNote}>
              Monitoring is paused, so you cannot respond to this alert right now.
            </p>
          )}
        </div>
      ) : null}

      {!urgent && !sessionActive ? (
        <p className={styles.mutedNote}>
          Monitoring has not started for this child. Start it from your active job.
        </p>
      ) : null}
    </section>
  );
}
