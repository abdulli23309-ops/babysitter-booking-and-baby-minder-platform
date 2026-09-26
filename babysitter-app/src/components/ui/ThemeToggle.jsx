import { useTheme } from './ThemeContext';
import styles from './theme-toggle.module.css';

const SunIcon = () => (
  <svg viewBox="0 0 24 24" role="presentation" focusable="false">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" role="presentation" focusable="false">
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
);

/**
 * Dark mode toggle — Phase F-UI-11 (Phase 1).
 *
 * Implemented as a real switch (role="switch" + aria-checked) so assistive
 * technology announces the current theme state rather than a bare button.
 * The visible label is supplied by the parent (see MobileMenu), keeping this
 * component reusable as an icon-only control inside the sticky header.
 */
export default function ThemeToggle({ className = '' }) {
  const { isDark, toggleTheme } = useTheme();
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      className={[styles.toggle, className].filter(Boolean).join(' ')}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      <span className={styles.icon} aria-hidden="true">
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
}