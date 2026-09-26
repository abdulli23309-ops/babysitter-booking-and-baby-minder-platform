import styles from './button.module.css';

/**
 * Shared Button (Phase F2 & Phase F-FIX).
 *
 * Props:
 *  - variant: 'primary' | 'secondary' | 'outlined' | 'danger'
 *  - size: 'sm' | 'md' | 'lg'
 *  - block: full-width
 *  - fullWidth: alias for block (destructured to avoid DOM prop warning)
 *  - loading: shows spinner and disables
 *  - all native <button> props passthrough
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  fullWidth = false,
  loading = false,
  disabled,
  children,
  className,
  ...rest
}) {
  const isFullWidth = block || fullWidth;

  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    isFullWidth ? styles.block : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

