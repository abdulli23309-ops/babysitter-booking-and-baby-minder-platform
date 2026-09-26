import { useLocation, useNavigate } from 'react-router-dom';
import ThemeToggle from '../ui/ThemeToggle';
import { useAuth } from '../../features/auth/AuthContext';
import { getRouteTitle } from './navigation';
import styles from './sticky-header.module.css';

/**
 * Sticky Header — permanently visible, pinned top app bar.
 *
 * Converts the previous scroll-reveal pattern into a global pinned header across
 * the entire application (both Parent and Babysitter views). The header stays
 * fixed at the top of the viewport at all times, with backdrop-blur and an
 * elevated z-index so it floats above scrolling content.
 *
 * It hosts the global controls: the dark mode switch and the hamburger that
 * opens the mobile menu drawer.
 */
export default function StickyHeader({ onOpenMenu, menuOpen = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, isAuthenticated } = useAuth();

  const title = getRouteTitle(location.pathname);

  const handleBrandClick = () => {
    if (!isAuthenticated) {
      navigate('/');
      return;
    }
    navigate(role === 'babysitter' ? '/babysitter-dashboard' : '/parent-dashboard');
  };

  return (
    <header className={styles.header}>
      <nav id="app-navigation" className={styles.inner} aria-label="Primary">
        <button
          type="button"
          className={styles.brand}
          onClick={handleBrandClick}
          aria-label="Little Care — go to dashboard"
        >
          <span className={styles.brandMark} aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="8" />
              <path d="M9 11h.01M15 11h.01" strokeWidth="2.5" />
              <path d="M9.5 15c.8 1 2.2 1 3 0" />
              <path d="M12 4c-.6-.8-1.6-1.2-2.2-.4" />
            </svg>
          </span>
          <span className={styles.brandText}>Little Care</span>
        </button>

        <span className={styles.divider} aria-hidden="true" />
        <span className={styles.title} title={title}>
          {title}
        </span>

        <div className={styles.actions}>
          <ThemeToggle />

          <button
            type="button"
            className={styles.menuButton}
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-controls="app-menu-panel"
            title="Menu"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </nav>
    </header>
  );
}