/**
 * MonitoringStatusBar - renders the FIVE DISTINCT monitoring facts (Phase 8).
 *
 * WHY SEPARATE, NOT ONE BOOLEAN
 *   A "monitoring on/off" flag would be wrong and unsafe: a session can be
 *   Active while the connection is Lost, while a pause is Approved, and while a
 *   cry incident sits at the parent-escalation stage. Those are independent
 *   server facts, so each gets its own labelled row:
 *     1. SESSION    - not started / active / ended
 *     2. CONNECTION - Connected / Lost, per participant (Phase 4)
 *     3. PAUSE      - none / pending approval / active + countdown (Phase 7)
 *     4. ALERT      - cry incident state (Phase 5/6)
 *     5. DND        - own state, and whether the other parent is DND
 *
 * SEPARATE FROM THE BABYSITTING SESSION
 *   A babysitting session and a child-monitoring session are DIFFERENT facts: a
 *   job can be In Progress while its monitoring session has never started, is
 *   paused, or has lost its connection. Nothing in this component describes the
 *   babysitting session, so a lost monitoring connection can never be read as
 *   "the babysitting job ended". The two screens that show both (the parent's
 *   and the sitter's active-session screens) render the session clock and this
 *   bar as two separate blocks, and this bar's heading names the monitoring
 *   fact explicitly.
 *
 * BACKEND IS AUTHORITATIVE
 *   Every word below is derived from server values:
 *     - "Connection lost" comes from ParentConnection/SitterConnection, which
 *       the SERVER derives from its own clock. The client never times out
 *       anything locally.
 *     - Alert wording comes from the server's Status / EscalationStage /
 *       SitterResponse. The numeric stage is never shown and no T+5/T+15
 *       arithmetic exists in React.
 *     - The pause countdown renders the server's SecondsRemaining and is
 *       re-read every poll, so client clock skew changes nothing.
 *
 * ACCESSIBILITY: every state is a text label (never colour alone) and the
 * alert row is a live region.
 */
import styles from './monitoring-status.module.css';

// Phase 5/6 incident wording. Stage numbers are internal and never shown; the
// user only ever sees what the state means for them.
const describeIncident = (incident) => {
  if (!incident) return { tone: 'ok', text: 'No active alert' };
  const status = String(incident.Status || '').toLowerCase();
  if (status === 'cancelled') {
    return { tone: 'muted', text: 'Alert cancelled — no further action' };
  }
  if (status === 'resolved') {
    return { tone: 'ok', text: 'Resolved — sitter is with the child' };
  }
  if (incident.SitterResponse === 'GoingToChild') {
    return { tone: 'warn', text: 'Sitter is going to the child' };
  }
  if (Number(incident.EscalationStage) >= 2) {
    return { tone: 'alert', text: 'Parents have been notified — please check on your child' };
  }
  if (Number(incident.EscalationStage) >= 1) {
    return { tone: 'warn', text: 'Sitter has been alerted' };
  }
  return { tone: 'alert', text: 'Cry detected — the sitter is being alerted' };
};

const describeSession = (session, offline) => {
  if (!session) return { tone: 'muted', text: 'Monitoring not started' };
  if (session.Status === 'Ended') return { tone: 'muted', text: 'Monitoring session ended' };
  if (offline) return { tone: 'warn', text: 'Monitoring active — waiting for the server' };
  return { tone: 'ok', text: 'Monitoring active' };
};

const describeConnection = (session, offline) => {
  if (!session || session.Status !== 'Active') return null;
  if (offline) {
    return { tone: 'warn', text: 'Waiting for the monitoring server — status may be out of date' };
  }
  const side = (label, state) => `${label}: ${state === 'Lost' ? 'Connection lost' : 'Connected'}`;
  const anyLost = session.ParentConnection === 'Lost' || session.SitterConnection === 'Lost';
  return {
    tone: anyLost ? 'warn' : 'ok',
    text: `${side('Your side', session.ParentConnection)} · ${side('Sitter', session.SitterConnection)}`,
  };
};

const formatPause = (seconds) => {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function MonitoringStatusBar({
  session,
  incident,
  pause,
  dndStates = [],
  offline = false,
  currentUserId = null,
  className = '',
  // Some screens (e.g. the parent's active-session screen) read ONLY the
  // monitoring session and never the Phase 7 pause/DND surface. They pass false
  // here, because rendering "Not paused" without ever having asked the server
  // would be a claim this client cannot support.
  showPauseAndDnd = true,
}) {
  const sessionState = describeSession(session, offline);
  const connectionState = describeConnection(session, offline);
  const incidentState = describeIncident(incident);

  // "Paused" is only ever true because the SERVER says so (IsPaused comes from
  // the session DTO, and the pause row is re-read on every poll).
  const pauseActive = Boolean(session?.IsPaused);
  const pausePending = pause?.Status === 'Requested';

  const myDnd = dndStates.find((d) => d.UserId === currentUserId && d.IsActive);
  const otherDnd = dndStates.find((d) => d.UserId !== currentUserId && d.IsActive);

  return (
    <div className={[styles.bar, className].filter(Boolean).join(' ')} aria-label="Child monitoring status">
      <ul className={styles.list}>
        <li className={styles.row} data-tone={sessionState.tone}>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.label}>Status</span>
          <span className={styles.value}>{sessionState.text}</span>
        </li>

        {connectionState ? (
          <li className={styles.row} data-tone={connectionState.tone}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.label}>Connection</span>
            <span className={styles.value}>{connectionState.text}</span>
          </li>
        ) : null}

        {showPauseAndDnd ? (
          <li
            className={styles.row}
            data-tone={pauseActive || pausePending ? 'warn' : 'muted'}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.label}>Pause</span>
            <span className={styles.value}>
              {pauseActive
                ? `Monitoring temporarily paused by parent — ${formatPause(
                    session.PauseSecondsRemaining,
                  )} remaining`
                : pausePending
                  ? 'Pause request pending approval'
                  : 'Not paused'}
            </span>
          </li>
        ) : null}

        <li className={styles.row} data-tone={incidentState.tone} aria-live="polite">
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.label}>Alert</span>
          <span className={styles.value}>{incidentState.text}</span>
        </li>

        {showPauseAndDnd && dndStates.length ? (
          <li className={styles.row} data-tone={myDnd ? 'muted' : 'ok'}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.label}>Do not disturb</span>
            <span className={styles.value}>
              {myDnd
                ? 'On for you — alerts are still recorded, you will not be rung'
                : otherDnd
                  ? `Off for you — ${otherDnd.FullName || 'the other guardian'} has DND on`
                  : 'Off for you'}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

