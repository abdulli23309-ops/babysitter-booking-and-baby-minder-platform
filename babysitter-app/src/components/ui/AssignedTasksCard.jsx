import { resolveAssignedTasks } from '../../utils/assignedTasks';
import styles from '../../features/parent/live-session.module.css';

/**
 * Phase 10.0 — read-only "Assigned Tasks" card shown on the active-job
 * screens of BOTH roles. The data is whatever the job-details API returned
 * (server-authoritative); this component never edits, toggles or invents
 * anything. Missing/null/malformed payloads resolve to the calm empty state,
 * which is also what historical bookings display.
 *
 * Styling lives in live-session.module.css alongside the SESSION / LOCATION /
 * MONITORING cards so the card inherits the exact same surface language and
 * the flex ordering rules of both screens.
 */
export default function AssignedTasksCard({ assignedTasks }) {
  const tasks = resolveAssignedTasks(assignedTasks);

  return (
    <div className={styles.assignedTasksCard}>
      <div className={styles.assignedTasksHeader}>
        <span className={styles.assignedTasksLabel}>Assigned Tasks</span>
        <span className={styles.assignedTasksHint}>Today&apos;s requested care tasks</span>
      </div>

      {tasks.length === 0 ? (
        <p className={styles.assignedTasksEmpty}>
          No specific tasks requested for this session.
        </p>
      ) : (
        <ul className={styles.assignedTasksList}>
          {tasks.map((task) => (
            <li key={task.id} className={styles.assignedTaskRow}>
              <span className={styles.assignedTaskCheck} aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className={styles.assignedTaskText}>{task.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
