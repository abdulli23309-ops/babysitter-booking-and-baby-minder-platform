import { useNavigate, useLocation } from 'react-router-dom';
import styles from './bottom-nav.module.css';

const Icons = {
  home: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  jobs: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  monitor: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-4" />
      <path d="M22 6l-6 6-4-4-8 8" />
    </svg>
  ),
  profile: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    </svg>
  ),
};

const tabs = [
  { icon: 'home', label: 'Home', route: '/parent-dashboard', matches: ['/parent-dashboard', '/main-screen', '/parent-home'] },
  { icon: 'jobs', label: 'Jobs', route: '/my-jobs', matches: ['/my-jobs', '/parent-active-job', '/parent-upcoming-job', '/parent-my-jobs'] },
  { icon: 'monitor', label: 'Monitor', route: '/baby-monitoring', matches: ['/baby-monitoring', '/cry-alert', '/child-cry-alert'] },
  { icon: 'profile', label: 'Profile', route: '/my-profile', matches: ['/my-profile', '/child-profile', '/set-child-profile', '/update-child-profile'] },
];

export default function ParentBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav aria-label="Parent navigation" className={styles.bottomNav}>
      {tabs.map((item) => {
        const isActive = item.matches.some(
          (path) => location.pathname === path || location.pathname.startsWith(path + '/')
        );
        const IconComp = Icons[item.icon];

        return (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.route)}
            className={`${styles.navButton} ${isActive ? styles.navButtonActive : ''}`}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className={styles.navIconWrapper}>
              <IconComp />
            </span>
            <span className={styles.navLabel}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

