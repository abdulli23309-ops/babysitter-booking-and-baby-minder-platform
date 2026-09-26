import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import Button from '../../components/ui/Button';
import styles from '../../components/layout/success-screen.module.css';

export default function JobRequestedSuccess() {
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
      <h1 className={styles.title}>Booking Requested!</h1>
      <p className={styles.description}>
        Your babysitting request has been sent to the caregiver. You will receive an immediate notification as soon as they accept.
      </p>

      {/* Reassurance Info Box */}
      <div className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>Caregiver Alert Sent via Platform</span>
        </div>
        <div className={styles.summaryRow}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>Track Status in Booking History</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className={styles.actionStack}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => navigate('/my-jobs')}
        >
          View My Bookings
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => navigate('/parent-dashboard')}
        >
          Return to Dashboard
        </Button>
      </div>

      <ParentBottomNav />
    </div>
  );
}
