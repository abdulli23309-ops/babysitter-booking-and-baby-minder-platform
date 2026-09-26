import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import Button from '../../components/ui/Button';
import styles from '../../components/layout/success-screen.module.css';

export default function JobAcceptedSuccess() {
  const navigate = useNavigate();

  return (
    <div className={styles.successContainer}>
      {/* Animated Glowing Checkmark */}
      <div className={styles.iconWrapper}>
        <div className={styles.iconGlow} />
        <div className={styles.successCircle}>
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>

      {/* Confirmation Titles */}
      <h1 className={styles.title}>Booking Accepted!</h1>
      <p className={styles.description}>
        You have confirmed this babysitting session. The parent has been notified and the job has been scheduled in your calendar.
      </p>

      {/* Reassurance Info Box */}
      <div className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>Confirmed in Active Schedule</span>
        </div>
        <div className={styles.summaryRow}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>Parent Contact Details Enabled</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className={styles.actionStack}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => navigate('/babysitter-my-jobs')}
        >
          View My Schedule
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => navigate('/babysitter-dashboard')}
        >
          Return to Dashboard
        </Button>
      </div>

      <BabysitterBottomNav />
    </div>
  );
}
