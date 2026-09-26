import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import Button from '../../components/ui/Button';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import styles from './notifications.module.css';

/**
 * Phase 8H — route each notification to the screen it is actually about.
 *
 * Notification.Job_ID (added in Phase 8D) is the deep-link key, but it is only
 * populated on notifications created AFTER that change — every legacy row is
 * NULL, so the `!jid` fallbacks below carry the old behaviour rather than
 * navigating to `/booking-status/undefined`.
 */
const notificationRoute = (n, role) => {
  const jid = n?.Job_ID ?? n?.jobId ?? n?.jobID ?? null;
  const type = String(n?.Type ?? n?.type ?? '').trim();

  if (role === 'Parent') {
    if (!jid) return '/my-jobs';
    // SitterArrived / SessionStarted are the two types whose landing screen is
    // not the per-job page; everything else is that day's BookingStatus.
    if (type === 'SitterArrived') return '/parent-active-job';
    return `/booking-status/${jid}`;
  }

  // Sitter
  if (!jid) return '/babysitter-my-jobs';
  if (type === 'InvitationReceived') return `/job-details/${jid}`;
  if (type === 'DayDeclineConfirmed') return '/babysitter-my-jobs';
  if (type === 'SitterArrived') return `/upcoming-job-details/${jid}`;
  return `/babysitter-my-jobs`;
};

export default function ParentNotifications() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const toast = useToast();

  const [notifications, setNotifications] = useState([]);

  const [latestCryRoom, setLatestCryRoom] = useState(null);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!userId) return;
      try {
        const data = await API.getNotifications(userId, 'Parent');
        if (!ignore && Array.isArray(data) && data.length > 0) {
          const mapped = data.map((n, idx) => {
            const id = n.Notification_ID ?? n.NotificationId ?? n.id ?? `pnotif-${idx}`;
            const title = n.Title ?? n.title ?? 'Platform Alert';
            const body = n.Message ?? n.message ?? n.text ?? '';
            const time = n.CreatedAt
              ? new Date(n.CreatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'Recent';

            return {
              id,
              title,
              time,
              message: body,
              type: n.type ?? n.Type,
              // Phase 8H: the raw payload fields notificationRoute needs. The
              // mapped shape only kept `type`, so Job_ID was being dropped
              // before it could be used for a deep link.
              rawType: n.Type ?? n.type,
              jobId: n.Job_ID ?? n.jobId ?? n.jobID ?? null,
              iconType: 'bell',
              actionType: 'view_details',
              actionLabel: 'View Details',
              targetRoute: notificationRoute(n, 'Parent'),
            };
          });
          setNotifications(mapped);
        }
      } catch {
        // silent fallback
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [userId]);

  // Poll for latest cry alert
  useEffect(() => {
    let mounted = true;
    const checkCryAlert = async () => {
      try {
        const data = await API.getLatestCryAlert(userId);
        if (data && mounted && (data.roomName || data.RoomName)) {
          setLatestCryRoom(data.roomName ?? data.RoomName);
        }
      } catch {
        // silent polling catch
      }
    };

    checkCryAlert();
    const interval = setInterval(() => {
      if (document.hidden) return;
      checkCryAlert();
    }, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [userId]);

  const handleClearNotifications = () => {
    setNotifications([]);
    toast.info('Notifications cleared');
  };

  const renderIcon = (type) => {
    switch (type) {
      case 'play':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <polygon points="10 8 16 12 10 16" fill="var(--color-primary)" stroke="var(--color-primary)" />
          </svg>
        );
      case 'briefcase':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
        );
      case 'bell':
      default:
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        );
    }
  };

  return (
    <div className={styles.notifContainer}>
      {/* TASK A: Header Construction */}
      <div className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Notifications</h1>
        <button
          type="button"
          className={styles.clearBtn}
          onClick={handleClearNotifications}
          aria-label="Clear Notifications"
        >
          Clear Notifications
        </button>
      </div>

      {/* Urgent Cry Alert Banner */}
      {latestCryRoom && (
        <section className={styles.cryAlertCard}>
          <div className={styles.cryAlertHeader}>
            <span className={styles.alertPulseDot} />
            <span>CRITICAL NURSERY CRY ALERT</span>
          </div>
          <p className={styles.cryAlertText}>
            Acoustic infant distress sound detected by AI Cry Minder. Tap below to launch live secure video monitoring feed immediately.
          </p>
          <Button
            variant="danger"
            size="md"
            fullWidth
            onClick={() => navigate('/baby-monitoring', { state: { roomName: latestCryRoom } })}
          >
            Launch Live Camera Feed
          </Button>
        </section>
      )}

      {/* TASK B: Notifications List */}
      <section className={styles.notifList} aria-label="Notifications list">
        {notifications.length === 0 ? (
          <div className={styles.emptyCard}>
            <div className={styles.emptyIconWrap}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h2 className={styles.emptyTitle}>No Notifications Yet</h2>
            <p className={styles.emptyDesc}>You have no unread notifications or sound alerts at this time.</p>
          </div>
        ) : (
          notifications.map((item) => {
            const isPeachWrapper = item.iconType === 'briefcase' || item.iconType === 'bell';
            const isLateCancellation = item.type === 'LateCancellation' || item.Type === 'LateCancellation';
            const cardClass = isLateCancellation ? `${styles.card} ${styles.lateCancellationItem}` : styles.card;
            const iconWrapClass = isPeachWrapper ? styles.iconWrapperPeach : styles.iconWrapper;

            return (
              <div key={item.id} className={cardClass}>
                {isLateCancellation && (
                  <span className={styles.lateBadge}>⚠️ Late cancellation</span>
                )}
                <div className={styles.cardTopRow}>
                  <div className={styles.cardHeaderLeft}>
                    <div className={iconWrapClass}>
                      {renderIcon(item.iconType)}
                    </div>
                    <h2 className={styles.cardTitle}>{item.title}</h2>
                  </div>
                  <span className={styles.cardTime}>{item.time}</span>
                </div>

                <p className={styles.cardMessage}>{item.message}</p>

                <div className={styles.cardActionsEnd}>
                  <button
                    type="button"
                    className={styles.btnOutlineOrange}
                    onClick={() => navigate(item.targetRoute || '/my-jobs')}
                  >
                    {item.actionLabel || 'View Details'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>

      <ParentBottomNav />
    </div>
  );
}
