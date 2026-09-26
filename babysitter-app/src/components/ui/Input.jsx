import styles from './input.module.css';

/**
 * Shared Input with label + inline validation (Phase F2 — infrastructure only).
 * Not yet applied to existing pages (deferred to F3/F4).
 */
export default function Input({
  label,
  error,
  hint,
  id,
  className,
  ...rest
}) {
  // Fall back to a generated id when callers don't provide one, so the
  // <label htmlFor> association (accessibility) always works.
  const inputId = id || rest.name || undefined;

  return (
    <div className={[styles.field, className || ''].filter(Boolean).join(' ')}>
      {label && (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={[styles.input, error ? styles.invalid : ''].filter(Boolean).join(' ')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        {...rest}
      />
      {error && (
        <span id={inputId ? `${inputId}-error` : undefined} className={styles.error} role="alert">
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={inputId ? `${inputId}-hint` : undefined} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
