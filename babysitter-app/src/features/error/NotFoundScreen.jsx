import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Button from '../../components/ui/Button';
import styles from './error.module.css';

export default function NotFoundScreen() {
  const navigate = useNavigate();
  const { role, isAuthenticated } = useAuth();

  const handleGoHome = () => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
      return;
    }
    const target = role === 'parent' ? '/parent-dashboard'
      : role === 'babysitter' ? '/babysitter-dashboard'
      : '/';
    navigate(target, { replace: true });
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.code}>404</div>
        <h1 className={styles.title}>Page Not Found</h1>
        <p className={styles.message}>
          Oops! Looks like this page wandered off.
        </p>
        <Button variant="primary" size="lg" onClick={handleGoHome}>
          Take me back to safety
        </Button>
      </div>
    </div>
  );
}

