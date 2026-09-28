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
  const sessionActive = session?.Status === 'Active';
  const urgent = isActiveIncident(incident);
  const connectionLost = sessionActive && !offline
    && (session.ParentConnection === 'Lost' || session.SitterConnection === 'Lost');

  return (
    <section className={styles.panel} aria-label="Child monitoring">
      {/* Pause is a PARENT action. The sitter only ever sees the resulting
          state through the existing session endpoint - there is deliberately no
          sitter pause endpoint, and this component exposes no pause controls. */}
      <SitterPausedBanner session={session} />

      {connectionLost ? (
        <div role="alert" className={styles.warnBox}>
          <strong>Child Monitoring Connection Lost</strong>
          <p>
            We cannot currently confirm the connection to the monitoring session. The
            session is still active on our side - this does not mean monitoring has
            stopped, and it does not confirm the child&apos;s status. It will
            reconnect automatically once the connection returns.
          </p>
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
