import { useNavigate, useLocation } from 'react-router-dom';
import styles from './bottom-nav.module.css';

const Icons = {
  dashboard: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  jobs: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  schedule: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  earnings: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="12" y1="9" x2="16" y2="9" />
      <path d="M16 15h.01" />
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
  { icon: 'dashboard', label: 'Dashboard', route: '/babysitter-dashboard', matches: ['/babysitter-dashboard', '/menu'] },
  { icon: 'jobs', label: 'Jobs', route: '/job-request', matches: ['/job-request', '/babysitter-my-jobs', '/active-job-details', '/upcoming-job-details', '/completed-job-details', '/job-details'] },
  { icon: 'schedule', label: 'Schedule', route: '/set-availability', matches: ['/set-availability'] },
  { icon: 'earnings', label: 'Earnings', route: '/earnings', matches: ['/earnings'] },
  { icon: 'profile', label: 'Profile', route: '/my-profile', matches: ['/my-profile', '/update-profile', '/ratings'] },
];

export default function BabysitterBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav aria-label="Babysitter navigation" className={styles.bottomNav}>
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

