import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import UserAvatar from '../../components/ui/UserAvatar';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import {
  formatLocalDate,
  isWithinSessionWindow,
  getSessionWindowReason,
} from '../../utils/dateUtils';
import styles from './job-tracking.module.css';

export default function ParentUpcomingJobScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { jobId: routeJobId } = useParams();
  const toast = useToast();

  const passedJob = location.state?.job;
  const numericJobId = routeJobId
    ? parseInt(routeJobId, 10)
    : passedJob?.Job_ID ?? passedJob?.jobId ?? null;

  const [job, setJob] = useState(passedJob ?? null);
  const [loading, setLoading] = useState(() => !passedJob && Boolean(numericJobId));

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Hydrate from the API when no job was passed via navigation state.
  useEffect(() => {
    if (!numericJobId || passedJob) return undefined;
    let isMounted = true;
    (async () => {
      try {
        const data = await API.getJobDetails(numericJobId);
        if (isMounted) setJob(data ?? null);
      } catch {
        if (isMounted) setJob(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [numericJobId, passedJob]);

  const isSitterDeactivated = job.IsSitterDeleted || (!job.SitterName && !job.AssignedSitter_ID);
  const sitterName = isSitterDeactivated
    ? 'Deactivated Caregiver'
    : (job.SitterName ?? job.sitter?.name ?? 'Assigned Caregiver');
  const sitterPic = job.SitterPicture ?? job.sitter?.picture ?? null;
  const childName = job.ChildName ?? job.child?.name ?? 'Child';
  const locationText = job.City ?? job.city ?? 'Location unavailable';
  const paymentRate = job.Payment ?? job.payment ?? 0;
  const dateStr = job.JobDate
    ? formatLocalDate(job.JobDate, { weekday: 'long' })
    : 'Scheduled date';

  const sessionWindowOpen = isWithinSessionWindow(job);
  const sessionWindowReason =
    getSessionWindowReason(job) || 'The session start window is not currently available.';
  const timeRange = job.SlotTimes?.length
    ? `${job.SlotTimes[0].StartTime?.substring(0, 5)} - ${job.SlotTimes[job.SlotTimes.length - 1].EndTime?.substring(0, 5)}`
    : 'Schedule pending';

  const handleStartSession = async () => {
    if (!sessionWindowOpen) {
      toast.error(sessionWindowReason);
      return;
    }
    try {
      if (job?.Job_ID) {
        await API.updateJobStatus(job.Job_ID, 'In Progress');
      }
    } catch {
      toast.error('Could not start the session. Please try again.');
      return;
    } finally {
      toast.success('Babysitting session started!');
      navigate('/parent-active-job', {
        state: {
          job: {
            ...job,
            Status: 'In Progress',
          }
        }
      });
    }
  };

  const handleCancelBooking = async () => {
    setCancelling(true);
    try {
      await API.updateJobStatus(job.Job_ID, 'Cancelled');
      toast.info('Booking has been cancelled.');
      navigate('/my-jobs');
    } catch {
      toast.error('Failed to cancel booking.');
    } finally {
      setCancelling(false);
      setShowCancelModal(false);
    }
  };

  return (
    <div className={styles.trackingContainer}>
      {loading ? (
        <div style={{ padding: '40px 0', display: 'flex', justifyContent: 'center', width: '100%' }}>
          <LoadingSpinner size="lg" label="Loading booking..." />
        </div>
      ) : null}

      {!loading && !job ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', width: '100%' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            No booking details available. Go back to your jobs and select an upcoming booking.
          </p>
          <Button variant="primary" onClick={() => navigate('/my-jobs')}>
            Back to My Jobs
          </Button>
        </div>
      ) : null}

      {!loading && job && (
      <>

      {/* Top Bar */}
      <div className={styles.topBar}>
        <BackButton onClick={() => navigate('/my-jobs')} />
        <h1 className={styles.pageTitle}>Upcoming Booking</h1>
        <div style={{ width: 40 }} />
      </div>

      {/* Sitter Banner */}
      <div className={styles.sitterBannerCard}>
        <UserAvatar
          src={sitterPic}
          name={sitterName}
          size={56}
          shape="circle"
          type="Sitters"
          className={styles.sitterAvatar}
        />
        <div className={styles.sitterBannerText}>
          <h2 className={styles.sitterName}>{sitterName}</h2>
          <span className={styles.sitterIdText}>📍 {locationText}</span>
        </div>
        <span className={styles.childBadge}>
          👶 {childName}
        </span>
      </div>

      {/* Schedule Info Card */}
      <section style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-md)',
            background: 'var(--badge-info-bg)',
            color: 'var(--badge-info-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Scheduled Date</span>
            <p style={{ margin: 0, fontWeight: 700, color: 'var(--color-text)' }}>{dateStr}</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-md)',
            background: 'var(--badge-purple-bg)',
            color: 'var(--badge-purple-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Care Hours</span>
            <p style={{ margin: 0, fontWeight: 700, color: 'var(--color-text)' }}>{timeRange}</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-primary-soft)',
            color: 'var(--color-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Agreed Rate</span>
            <p style={{ margin: 0, fontWeight: 700, color: 'var(--color-text)' }}>PKR {paymentRate}/hr</p>
          </div>
        </div>
      </section>

      {/* Action Buttons */}
      <div style={{ marginTop: 'auto', paddingTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {!isSitterDeactivated && (
          <>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!sessionWindowOpen}
              title={!sessionWindowOpen ? sessionWindowReason : undefined}
              onClick={handleStartSession}
            >
              Start Session Now
            </Button>
            {!sessionWindowOpen && (
              <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>
                {sessionWindowReason}
              </p>
            )}
          </>
        )}
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => setShowCancelModal(true)}
        >
          Cancel Booking
        </Button>
      </div>

      {/* Cancel Confirmation Modal */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => !cancelling && setShowCancelModal(false)}
        title="Cancel Upcoming Booking?"
      >
        <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Are you sure you want to cancel this booking scheduled with {sitterName}? This will notify the caregiver.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="secondary" fullWidth disabled={cancelling} onClick={() => setShowCancelModal(false)}>
            Keep Booking
          </Button>
          <Button variant="danger" fullWidth loading={cancelling} onClick={handleCancelBooking}>
            Yes, Cancel
          </Button>
        </div>
      </Modal>

      </>
      )}

      <ParentBottomNav />
    </div>
  );
}