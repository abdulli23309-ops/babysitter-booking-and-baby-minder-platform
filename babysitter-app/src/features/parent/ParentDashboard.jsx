import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import { useAuth } from '../auth/AuthContext';
import { API } from '../../services/api';
import styles from './parent-dashboard.module.css';

const menuItems = [
  {
    id: 'find-sitter',
    title: 'Find Sitter',
    subtitle: 'Find a new babysitter',
    route: '/search-babysitter',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    ),
  },
  {
    id: 'my-jobs',
    title: 'My Jobs',
    subtitle: 'Manage active listings',
    route: '/my-jobs',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <rect x="7" y="7.5" width="2" height="2" fill="currentColor" />
        <line x1="12" y1="8.5" x2="16.5" y2="8.5" />
        <rect x="7" y="11" width="2" height="2" fill="currentColor" />
        <line x1="12" y1="12" x2="16.5" y2="12" />
        <rect x="7" y="14.5" width="2" height="2" fill="currentColor" />
        <line x1="12" y1="15.5" x2="16.5" y2="15.5" />
      </svg>
    ),
  },
  {
    id: 'view-child-profile',
    title: 'View Child Profile',
    subtitle: 'Medical info & habits',
    route: '/child-profile',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="13" r="8" />
        <circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none" />
        <path d="M9.5 15.5c.7.8 1.8.8 2.5 0" />
        <path d="M12 5c-.7-.9-1.8-1.2-2.3-.4" />
      </svg>
    ),
  },
  {
    id: 'live-monitoring',
    title: 'Live Baby Monitoring',
    subtitle: 'Real-time camera feed',
    route: '/baby-monitoring',
    hasCameraDot: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="14" height="12" rx="2" />
        <polygon points="16 10 22 6 22 18 16 14" />
      </svg>
    ),
  },
  {
    id: 'independent-monitoring',
    title: 'Set Up Monitor Phone',
    subtitle: 'Monitor your child without a booking',
    route: '/independent-monitoring',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="2.5" width="12" height="19" rx="2" />
        <path d="M10 18h4" />
        <path d="M9 9h6M9 12h6" />
      </svg>
    ),
  },
  {
    id: 'set-child-profile',
    title: 'Set Child Profile',
    subtitle: 'Add or edit child details',
    route: '/set-child-profile',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2.5" />
        <path d="M5 11h14" />
        <path d="M12 7.5v6" />
        <path d="M9 19.5l3-6 3 6" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'cry-alert',
    title: 'Cry Alert Screen',
    subtitle: 'Sound detection settings',
    route: '/cry-alert',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        <line x1="3" y1="10" x2="1.5" y2="10" />
        <line x1="22.5" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'babysitter-profile',
    title: 'Babysitter Profile',
    subtitle: 'View hired professionals',
    route: '/search-babysitter',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M9 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
        <path d="M6 16v-1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" />
        <line x1="14" y1="9" x2="18" y2="9" />
        <line x1="14" y1="13" x2="18" y2="13" />
      </svg>
    ),
  },
];

export default function ParentDashboard() {
  const navigate = useNavigate();
  const { user, userId } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const parentName = user?.name ?? user?.FullName ?? user?.Username ?? 'Sarah';

  useEffect(() => {
    let ignore = false;
    async function fetchUnread() {
      if (!userId) return;
      try {
        const data = await API.getNotifications(userId, 'Parent');
        if (!ignore && Array.isArray(data)) {
          const unread = data.filter((n) => !n.IsRead && !n.isRead).length;
          setUnreadCount(unread);
        }
      } catch {
        // silent catch
      }
    }

    fetchUnread();
    return () => {
      ignore = true;
    };
  }, [userId]);

  return (
    <div className={styles.dashboardContainer}>
      {/* Top Brand Header */}
      <header className={styles.brandHeader}>
        <div className={styles.brandLeft}>
          <div className={styles.brandLogo}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8" />
              <path d="M9 11h.01M15 11h.01" strokeWidth="2.5" />
              <path d="M9.5 15c.8 1 2.2 1 3 0" />
              <path d="M12 4c-.6-.8-1.6-1.2-2.2-.4" />
            </svg>
          </div>
          <span className={styles.brandName}>Little Care</span>
        </div>

        <button
          type="button"
          className={styles.bellBtn}
          onClick={() => navigate('/parent-notifications')}
          aria-label="Notifications"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && <span className={styles.bellDot} />}
        </button>
      </header>

      {/* Heading Section */}
      <section className={styles.titleSection}>
        <h1 className={styles.pageTitle}>Parent Dashboard</h1>
        <p className={styles.pageSubtitle}>Welcome back, {parentName}</p>
      </section>

      {/* 7 Vertical Menu Cards */}
      <main className={styles.cardsList} role="list">
        {menuItems.map((item) => (
          <div
            key={item.id}
            className={styles.menuCard}
            onClick={() => navigate(item.route)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(item.route);
              }
            }}
          >
            <div className={styles.cardLeft}>
              <div className={styles.iconCircle}>
                {item.icon}
                {item.hasCameraDot && <span className={styles.cameraDot} />}
              </div>
              <div className={styles.cardText}>
                <h2 className={styles.cardTitle}>{item.title}</h2>
                <p className={styles.cardSubtitle}>{item.subtitle}</p>
              </div>
            </div>

            <svg
              className={styles.chevronIcon}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        ))}
      </main>

      <ParentBottomNav />
    </div>
  );
}
