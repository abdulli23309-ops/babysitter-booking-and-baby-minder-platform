import { AVAILABLE_TASKS } from '../../utils/assignedTasks';
import styles from './assigned-task-selector.module.css';

/**
 * Phase 10.0 — "Today's Required Tasks" selector.
 *
 * The browser's native checkbox is kept for semantics/keyboard/screen-reader
 * support but hidden with .srOnly; the visible control is a custom check
 * box drawn inside a fully clickable row. Selection is controlled entirely
 * by the caller's `selectedTasks` state — zero, one or many tasks are valid.
 */
export default function AssignedTaskSelector({
  tasks = AVAILABLE_TASKS,
  selectedTasks = [],
  onChange,
  disabled = false,
}) {
  const toggleTask = (id) => {
    if (disabled || typeof onChange !== 'function') return;
    const isSelected = selectedTasks.includes(id);
    const next = isSelected
      ? selectedTasks.filter((taskId) => taskId !== id)
      : [...selectedTasks, id];
    onChange(next);
  };

  return (
    <div className={styles.selectorCard}>
      <div className={styles.headerRow}>
        <div className={styles.headerText}>
          <p className={styles.heading}>Today&apos;s Required Tasks</p>
          <p className={styles.subtitle}>
            Choose what you&apos;d like the babysitter to focus on during this session.
          </p>
        </div>
        <span className={styles.optionalBadge}>OPTIONAL</span>
      </div>

      <ul className={styles.taskList}>
        {tasks.map((task) => {
          const isSelected = selectedTasks.includes(task.id);
          const optionClass = [
            styles.taskOption,
            isSelected ? styles.selected : '',
            disabled ? styles.disabledClass : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li key={task.id}>
              <label className={optionClass}>
                <input
                  type="checkbox"
                  className={styles.srOnly}
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => toggleTask(task.id)}
                />
                <span className={styles.customBox} aria-hidden="true">
                  <svg
                    className={styles.checkIcon}
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
                <span className={styles.taskLabel}>{task.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
