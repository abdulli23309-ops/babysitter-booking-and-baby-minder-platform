import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import styles from './fab.module.css';

export default function FloatingContactButton() {
  const navigate = useNavigate();
  const { isAuthenticated, role } = useAuth();
  const normalizedRole = String(role || '').toLowerCase();
  const destination = isAuthenticated
    ? normalizedRole === 'parent'
      ? '/independent-monitoring'
      : normalizedRole === 'babysitter' || normalizedRole === 'sitter'
        ? '/baby-monitoring'
        : '/monitor-device'
    : '/monitor-device';
  const label = !isAuthenticated || !['parent', 'babysitter', 'sitter'].includes(normalizedRole)
    ? 'Open monitor device setup'
    : normalizedRole === 'parent'
      ? 'Open independent monitoring'
      : 'Open baby monitoring';

  return (
    <div className={styles.fabWrap}>
      <button
        type="button"
        className={styles.fab}
        aria-label={label}
        title={label}
        onClick={() => navigate(destination)}
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
          {normalizedRole === 'parent' && isAuthenticated ? (
            <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="m9 12 2 2 4-4" /></>
          ) : normalizedRole === 'babysitter' || normalizedRole === 'sitter' ? (
            <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></>
          ) : (
            <><rect x="3" y="7" width="13" height="10" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></>
          )}
        </svg>
      </button>
    </div>
  );
}
