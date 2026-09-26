import { useCallback } from 'react';
import { useAuth } from '../../features/auth/AuthContext';
import { useToast } from '../ui/ToastContext';
import styles from './fab.module.css';

const SUPPORT_HREF = 'mailto:support@littlecare.app?subject=Little%20Care%20Support%20Request';

/**
 * FloatingContactButton — Phase F-UI-12 / Step 4.
 *
 * A persistent FAB pinned to the viewport bottom-right. It uses the help/chat
 * icon and either opens a mailto link (primary action) or triggers a toast
 * ("Support chat coming soon!") on the secondary action. It lives above the
 * toast viewport (z-index 1300 vs 1200) and has safe-area padding so it never
 * overlaps the soft keyboard bar on modern phones. It is hidden for guest
 * users who are not yet authenticated.
 */
export default function FloatingContactButton() {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();

  const handleSecondary = useCallback(() => {
    addToast({
      type: 'info',
      title: 'Support chat coming soon!',
      message: 'Our care team will be online shortly. Need help now? Email support@littlecare.app',
      duration: 6000,
    });
  }, [addToast]);

  if (!isAuthenticated) return null;

  return (
    <div className={styles.fabWrap} aria-hidden="false">
      {/* Primary FAB — help/chat, opens support email */}
      <a
        href={SUPPORT_HREF}
        className={styles.fab}
        aria-label="Contact support"
        title="Contact support"
        rel="noopener"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
          <circle cx="12" cy="17" r="2.5" fill="currentColor" stroke="none" />
        </svg>
      </a>

      {/* Secondary round FAB — info toast action */}
      <button
        type="button"
        className={[styles.fab, styles.fabSecondary].filter(Boolean).join(' ')}
        aria-label="Support chat coming soon"
        title="Support chat coming soon"
        onClick={handleSecondary}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    </div>
  );
}