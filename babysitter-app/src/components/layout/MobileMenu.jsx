import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import ThemeToggle from '../ui/ThemeToggle';
import { getNavItems } from './navigation';
import styles from './mobile-menu.module.css';

const ICONS = {
  home: (
    <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
    </>
  ),
  login: (
    <>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </>
  ),
  userPlus: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      <line x1="19" y1="8" x2="19" y2="16" />
      <line x1="15" y1="12" x2="23" y2="12" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ),
  child: (
    <>
      <circle cx="12" cy="13" r="8" />
      <circle cx="9.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <path d="M9.5 15.5c1.5 1.2 3.5 1.2 5 0" />
      <path d="M12 5c-.7-.9-1.8-1.2-2.3-.4" />
    </>
  ),
  camera: (
    <>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <polygon points="16 10 22 6 22 18 16 14" />
    </>
  ),
  wave: <path d="M2 12h3l2-5 3 10 3-7 2 4h7" />,
  wallet: (
    <>
      <rect x="2" y="5" width="20" height="15" rx="2" />
      <path d="M2 10h20" />
      <circle cx="17" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  star: <polygon points="12 2 15 9 22 9 16 14 19 21 12 17 5 21 8 14 2 9 9 9" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.4c-.7.3-1.1.9-1.1 1.7" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
};

/**
 * Mobile Menu drawer — Phase F-UI-11 (Phase 1).
 *
 * A role-aware navigation overlay for the 480px shell. Accessibility contract:
 *  - Rendered as role="dialog" aria-modal="true" with a labelled close button.
 *  - Escape closes; Tab is trapped inside the panel; focus moves into the panel
 *    on open and is restored to the trigger on close.
 *  - Body scroll is locked (with scrollbar-width compensation) while open.
 *  - When closed the overlay is visibility:hidden, so nothing inside it is
 *    reachable by keyboard or assistive technology.
 */
export default function MobileMenu({ open, onClose }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { role, isAuthenticated, logout } = useAuth();

  const items = getNavItems(role, isAuthenticated);

  // Any navigation dismisses the drawer.
  useEffect(() => {
    onClose();
  }, [location.pathname, onClose]);

  // Scroll lock, Escape handling, focus trap and focus restoration.
  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const { overflow, paddingRight } = document.body.style;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    if (closeRef.current) closeRef.current.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusables = panel.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [open, onClose]);

  const handleBackdropMouseDown = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  const handleLogout = () => {
    onClose();
    logout();
  };

  return (
    <div
      className={[styles.overlay, open ? styles.overlayOpen : ''].filter(Boolean).join(' ')}
      onMouseDown={handleBackdropMouseDown}
      role="presentation"
    >
      <div className={styles.shell}>
        <aside
          id="app-menu-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          className={[styles.panel, open ? styles.panelOpen : ''].filter(Boolean).join(' ')}
        >
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Menu</span>
            <button
              ref={closeRef}
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close navigation menu"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <line x1="5" y1="5" x2="19" y2="19" />
                <line x1="19" y1="5" x2="5" y2="19" />
              </svg>
            </button>
          </div>

          <nav className={styles.nav} aria-label="Site">
            <ul className={styles.list}>
              {items.map((item) => {
                const isActive = location.pathname === item.route;

                return (
                  <li key={item.id}>
                    <Link
                      to={item.route}
                      onClick={onClose}
                      className={[styles.item, isActive ? styles.itemActive : ''].filter(Boolean).join(' ')}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className={styles.itemIcon} aria-hidden="true">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          {ICONS[item.icon] || ICONS.home}
                        </svg>
                      </span>
                      <span className={styles.itemLabel}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className={styles.footer}>
            <div className={styles.themeRow}>
              <span className={styles.themeLabel}>Dark mode</span>
              <ThemeToggle />
            </div>

            {isAuthenticated ? (
              <button type="button" className={styles.logoutButton} onClick={handleLogout}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Log out
              </button>
            ) : (
              <button
                type="button"
                className={styles.logoutButton}
                onClick={() => {
                  onClose();
                  navigate('/login');
                }}
              >
                Sign in to your account
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

