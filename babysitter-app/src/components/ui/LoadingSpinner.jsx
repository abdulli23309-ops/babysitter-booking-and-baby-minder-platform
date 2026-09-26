import styles from './loading-spinner.module.css';

/**
 * Shared LoadingSpinner (Phase F2 — infrastructure only).
 * Not yet applied to existing pages (deferred to F3/F4).
 */
export default function LoadingSpinner({ size = 32, color = 'primary', className }) {
  return (
    <div
      className={[styles.container, className || ''].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <span
        className={[styles.spinner, styles[color] || ''].filter(Boolean).join(' ')}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    </div>
  );
}
