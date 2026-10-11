import styles from './empty-state.module.css';

/**
 * Shared EmptyState (Phase F2 — infrastructure only).
 * Not yet applied to existing pages (deferred to F3/F4).
 */
export default function EmptyState({ icon = '📭', title, description, actionLabel, onAction, children }) {
  return (
    <div className={styles.empty}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {title && <h3 className={styles.title}>{title}</h3>}
      {description && <p className={styles.description}>{description}</p>}
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          style={{
            marginTop: 12,
            padding: '10px 20px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--color-primary, #6C5CE7)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {actionLabel}
        </button>
      )}
      {children}
    </div>
  );
}
