import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import EmptyState from '../../components/ui/EmptyState';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import styles from './notifications.module.css';

/**
 * Phase 8H — route each notification to the screen it is actually about.
 *
 * Notification.Job_ID (added in Phase 8D) is the deep-link key, but it is only
 * populated on notifications created AFTER that change — every legacy row is
 * NULL, so the `!jid` fallback carries the old behaviour rather than navigating
 * to `/job-details/undefined`.
 */
const notificationRoute = (n) => {
  const jid = n?.Job_ID ?? n?.jobId ?? n?.jobID ?? null;
  const type = String(n?.Type ?? n?.type ?? '').trim();

  if (!jid) return '/babysitter-my-jobs';
  if (type === 'InvitationReceived') return `/job-details/${jid}`;
  // A decline confirmation means the day is GONE — land on the list, not the
  // job page (which would now show a rebooked day that isn't ours).
  if (type === 'DayDeclineConfirmed') return '/babysitter-my-jobs';
  if (type === 'SitterArrived') return `/upcoming-job-details/${jid}`;
  return `/babysitter-my-jobs`;
};

export default function BabysitterNotifications() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const toast = useToast();

  // No mock data. Notifications come ONLY from the API.
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(userId));

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!userId) {
        if (!ignore) setLoading(false);
        return;
      }
      try {
        const data = await API.getNotifications(userId, 'Sitter');
        if (!ignore) setNotifications(Array.isArray(data) ? data : []);
      } catch {
        if (!ignore) {
          toast.error('Could not load notifications.');
          setNotifications([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [userId, toast]);

  return (
    <div className={styles.notifContainer}>
      {/* Top Bar: Frame 15 BackButton, centered title, circular options button */}
      <header className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Notifications</h1>
        <div style={{ width: 42 }} />
      </header>

      {/* Notifications List (Frame 15) */}
      <section className={styles.notifList} aria-label="Notifications List">
        {loading ? (
          <div style={{ padding: '40px 0', display: 'flex', justifyContent: 'center' }}>
            <LoadingSpinner size="lg" label="Loading notifications..." />
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="No notifications yet"
            description="Job requests, matches, and session updates will appear here."
          />
        ) : (
          notifications.map((item) => (
            <div key={item.id ?? `${item.title}-${item.time}`} className={styles.card}>
              {/* Top Row: Icon, Title & Time */}
              <div className={styles.cardTopRow}>
                <div className={styles.cardHeaderLeft}>
                  <div className={styles.iconWrapper} aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </div>
                  <h2 className={styles.cardTitle}>{item.Title ?? item.title ?? 'Notification'}</h2>
                </div>
                <span className={styles.cardTime}>{item.time ?? 'Recent'}</span>
              </div>

              {/* Middle Row: Message */}
              <p className={styles.cardMessage}>{item.Message ?? item.message ?? ''}</p>

              {/* Bottom Row: Action */}
              <div className={styles.cardActionsEnd}>
                <button
                  type="button"
                  className={styles.btnOutlineOrange}
                  onClick={() => navigate(notificationRoute(item))}
                >
                  View Details
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <BabysitterBottomNav />
    </div>
  );
}
