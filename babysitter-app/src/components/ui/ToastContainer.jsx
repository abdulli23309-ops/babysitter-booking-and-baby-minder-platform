import Toast from './Toast';
import styles from './toast.module.css';

/**
 * Renders the stack of active toasts (Phase F2A).
 * Timers live in ToastContext; this component is presentational.
 */
export default function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div className={styles.viewport} aria-label="Notifications">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
