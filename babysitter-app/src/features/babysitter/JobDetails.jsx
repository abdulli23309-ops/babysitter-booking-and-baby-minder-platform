import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import { API } from '../../services/api';
import UserAvatar from '../../components/ui/UserAvatar';
import styles from './job-details.module.css';
import SeriesContractOverview from '../../components/series/SeriesContractOverview';

const buildImageUrl = (pic) => {
  if (!pic) return null;
  if (pic.startsWith('http') || pic.startsWith('data:')) return pic;
  const parts = pic.split('/');
  if (parts.length === 2) {
    const [type, filename] = parts;
    return `/api/images/${type}/${filename}`;
  }
  return `/api/images/default/${pic}`;
};

const SLOT_TIME_MAP = {
  1: { start: '08:00', end: '10:00' },
  2: { start: '10:00', end: '12:00' },
  3: { start: '12:00', end: '14:00' },
  4: { start: '14:00', end: '16:00' },
  5: { start: '16:00', end: '18:00' },
  6: { start: '18:00', end: '20:00' },
  7: { start: '20:00', end: '22:00' },
};

/**
 * Phase 5.1 fix — the Reject / Confirm pair is ONLY meaningful while the request
 * is still awaiting this sitter's response. Every other lifecycle state
 * (Assigned, Confirmed, In Progress, Completed, Cancelled, Superseded…) must
 * render read-only.
 *
 * The status is normalised first (trim + lowercase + collapse spaces/underscores
 * /hyphens) so 'In Progress', 'InProgress' and 'in-progress' all compare equal to
 * the same bucket, and the whitelist is deliberately closed: anything unknown
 * hides the buttons instead of showing them.
 */
const AWAITING_SITTER_CONFIRMATION = new Set([
  'open',                                   // Open request awaiting a sitter
  'pending',                                // Pending sitter confirmation
  'invited',                                // Invited — awaiting this sitter's reply
  'requested',                              // Request sent to the sitter
  'awaiting confirmation',
  'awaiting sitter confirmation',
  'waiting for sitter confirmation',
  'waiting for your response',              // Copy used by the invitations screen
]);

const normalizeStatus = (status) =>
  String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');

const isAwaitingSitterConfirmation = (status) =>
  AWAITING_SITTER_CONFIRMATION.has(normalizeStatus(status));

const formatTime12 = (time24) => {
  if (!time24) return '';
  const [hour, minute] = time24.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute || 0).padStart(2, '0')} ${period}`;
};

const getTimeRange = (job) => {
  if (job?.SlotTimes && job.SlotTimes.length > 0) {
    const start = job.SlotTimes[0].StartTime?.substring(0, 5);
    const end = job.SlotTimes[job.SlotTimes.length - 1].EndTime?.substring(0, 5);
    return `${formatTime12(start)} – ${formatTime12(end)}`;
  }
  if (job?.SlotIds && job.SlotIds.length > 0) {
    const times = job.SlotIds
      .map((id) => SLOT_TIME_MAP[id])
      .filter(Boolean)
      .sort((a, b) => a.start.localeCompare(b.start));
    if (times.length > 0) {
      return `${formatTime12(times[0].start)} – ${formatTime12(times[times.length - 1].end)}`;
    }
  }
  return 'Flexible / Time not specified';
};


const JobDetails = () => {
  const navigate = useNavigate();
  const { jobId } = useParams();
  const location = useLocation();

  const passedJob = location.state?.job;
  const numericJobId = jobId ? parseInt(jobId, 10) : location.state?.jobId || passedJob?.Job_ID;
  const [job, setJob] = useState(() => passedJob || null);
  const [loading, setLoading] = useState(() => !passedJob && Boolean(numericJobId));
  const [error, setError] = useState(null);
  const [searchParams] = useSearchParams();
  const wantsHistory = searchParams.get('series') === 'history';
  const isCompleted = (job?.Status || '').toLowerCase() === 'completed';

  useEffect(() => {
    if (wantsHistory && isCompleted && job?.Job_ID) {
      navigate(
        `/completed-job-details/${job.Job_ID}?series=history`,
        { replace: true }
      );
    }
  }, [wantsHistory, isCompleted, job?.Job_ID, navigate]);

  useEffect(() => {
    if (!numericJobId) return;

    let isMounted = true;
    (async () => {
      try {
        const data = await API.getJobDetails(numericJobId);
        if (isMounted && data) {
          setJob(data);
          setError(null);
        }
      } catch (err) {
        console.error('Failed to load job details from API:', err);
        if (isMounted) {
          setError(err?.message || 'Could not load job details.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [numericJobId]);

  const handleConfirm = async () => {
    const sitterId = Number(localStorage.getItem('userId'));
    const effectiveJobId = job?.Job_ID || numericJobId;
    if (!effectiveJobId) {
      navigate('/job-request');
      return;
    }
    try {
      if (API.confirmJob) {
        await API.confirmJob(effectiveJobId, sitterId);
      }
    } catch (e) {
      console.warn('API confirm failed, proceeding with client navigation', e);
    }
    navigate('/upcoming-job-details', {
      state: {
        job: {
          ...job,
          Job_ID: effectiveJobId,
          Status: 'Waiting for Parent',
        },
      },
    });
  };

  const handleReject = async () => {
    const effectiveJobId = job?.Job_ID || numericJobId;
    try {
      if (API.rejectJob && effectiveJobId) {
        await API.rejectJob(effectiveJobId);
      }
    } catch (e) {
      console.warn('API reject failed, proceeding with client navigation', e);
    }
    navigate('/job-request');
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.topBar}>
          <BackButton />
          <h1 className={styles.pageTitle}>Job Details</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-tertiary)' }}>
          Loading job details...
        </div>
        <BabysitterBottomNav />
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className={styles.container}>
        <div className={styles.topBar}>
          <BackButton />
          <h1 className={styles.pageTitle}>Job Details</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 16px', color: 'var(--color-text-secondary)' }}>
          <p style={{ fontWeight: 600, fontSize: '15px', color: 'var(--color-error)' }}>{error}</p>
          <button
            type="button"
            className={styles.confirmBtn}
            style={{ marginTop: '16px', width: 'auto', padding: '10px 24px', display: 'inline-block' }}
            onClick={() => navigate('/job-request')}
          >
            Back to Invitations
          </button>
        </div>
        <BabysitterBottomNav />
      </div>
    );
  }

  const parentName = job?.ParentName || 'Parent';
  const rating = Number(job?.ParentRating ?? job?.Rating ?? 0).toFixed(1);
  const locationText = job?.City || job?.ParentAddress || 'Location not specified';
  const rawChildren = Array.isArray(job?.children) && job.children.length > 0
    ? job.children
    : Array.isArray(job?.Children) && job.Children.length > 0
    ? job.Children
    : job?.ChildName
    ? [{ name: job.ChildName, age: job.ChildAge, gender: job.Gender, picture: job.PictureAddress }]
    : [];
  const childrenList = rawChildren;
  const formattedDate = job?.JobDate
    ? new Date(job.JobDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'No date set';
  const timeRange = getTimeRange(job);
  const paymentRate = job?.Payment ?? 0;

  // Phase 5.2 (F3): the sitter's own view — the title reflects the lifecycle stage.
  const normalizedJobStatus = normalizeStatus(job?.Status);
  const pageTitle =
    normalizedJobStatus === 'invited' || normalizedJobStatus === 'accepted'
      ? 'Job Preview'
      : normalizedJobStatus === 'assigned' || normalizedJobStatus === 'in progress'
      ? 'Session Brief'
      : 'Job Details';

  // Phase 5.1 fix: Reject / Confirm are rendered only while the request is still
  // awaiting this sitter's confirmation. Active (Assigned / Confirmed /
  // In Progress), Cancelled and Completed jobs are strictly read-only.
  const showSitterActions = isAwaitingSitterConfirmation(job?.Status);

  return (
    <div className={styles.container}>
      {/* Universal Top Header */}
      <div className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>{pageTitle}</h1>
      </div>

      {/* Parent Information Card */}
      <div className={styles.parentCard}>
        <UserAvatar
          src={job?.ParentPic}
          name={parentName}
          size={52}
          type="Parents"
          alt={parentName}
        />
        <div className={styles.parentInfo}>
          <div className={styles.parentNameRow}>
            <h2 className={styles.parentName}>{parentName}</h2>
            <div className={styles.ratingBadge}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-warning)">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span>{rating} Rating</span>
            </div>
          </div>
          <span className={styles.parentSubtitle}>Member since 2022</span>
          <span className={styles.parentLocation}>📍 {locationText}</span>
        </div>
      </div>

      {/* Child Information Section */}
      <h3 className={styles.sectionTitle}>Child Information</h3>
      {childrenList.length === 0 ? (
        <div className={styles.childCard} style={{ justifyContent: 'center', color: 'var(--color-text-tertiary)' }}>
          <span>No specific child profile attached to this request.</span>
        </div>
      ) : (
        <div className={styles.childList}>
          {childrenList.map((child, idx) => {
            const childName = child?.name || child?.ChildName || 'Child';
            const childAge = child?.age ?? child?.ChildAge ?? '?';
            const childGender = child?.gender || child?.Gender || 'N/A';
            const childPic = child?.picture || child?.PictureAddress;
            return (
              <div key={idx} className={styles.childCard}>
                {childPic ? (
                  <img
                    src={buildImageUrl(childPic)}
                    alt={childName}
                    className={styles.childAvatar}
                    style={{ objectFit: 'cover' }}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className={styles.childAvatar}>
                    {childGender === 'Girl' || childGender === 'Female' ? '👧' : '👦'}
                  </div>
                )}
                <div className={styles.childInfo}>
                  <h4 className={styles.childName}>{childName}</h4>
                  <span className={styles.childMetaText}>Age: {childAge}{Number.isNaN(Number(childAge)) ? '' : ' Years Old'}</span>
                  <span className={styles.childMetaText}>Gender: {childGender}</span>
                  {child.SpecialRequirements && (
                    <div className="childSpecialNote" style={{
                      marginTop: 8,
                      padding: '8px 10px',
                      background: 'rgba(232, 98, 42, 0.08)',
                      borderLeft: '3px solid var(--color-primary, #E8622A)',
                      borderRadius: 6,
                      fontSize: 13,
                      color: 'var(--color-text, #1A1D2E)',
                    }}>
                      <strong style={{ fontSize: 11, textTransform: 'uppercase',
                                      letterSpacing: 0.5 }}>⚠️ Special attention</strong>
                      <p style={{ margin: '4px 0 0', fontSize: 13 }}>
                        {child.SpecialRequirements}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Job Specifics 4-Bento Grid */}
      <h3 className={styles.sectionTitle}>Job Specifics</h3>
      <div className={styles.bentoGrid}>
        {/* Date Bento */}
        <div className={styles.bentoCard}>
          <div className={styles.bentoHeader}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>DATE</span>
          </div>
          <span className={styles.bentoValue}>{formattedDate}</span>
        </div>

        {/* Time Bento */}
        <div className={styles.bentoCard}>
          <div className={styles.bentoHeader}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>TIME</span>
          </div>
          <span className={styles.bentoValue}>{timeRange}</span>
        </div>

        {/* Location Bento */}
        <div className={styles.bentoCard}>
          <div className={styles.bentoHeader}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span>LOCATION</span>
          </div>
          <span className={styles.bentoValue}>{locationText}</span>
        </div>

        {/* Payment Bento */}
        <div className={styles.bentoCard}>
          <div className={styles.bentoHeader}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="12" cy="12" r="2" />
              <path d="M6 12h.01M18 12h.01" />
            </svg>
            <span>PAYMENT</span>
          </div>
          <span className={styles.bentoValue}>PKR {Number(paymentRate).toLocaleString()}</span>
          {(job?.JobSeries_ID != null || job?.SeriesTotalCount > 1) && job?.SeriesTotalPayment != null && (
            <span style={{ display: 'block', marginTop: 4, color: 'var(--color-text-muted)', fontSize: 12 }}>
              per day · PKR {Number(job.SeriesTotalPayment).toLocaleString()} total
            </span>
          )}
        </div>
      </div>

      <SeriesContractOverview job={job} />

      {/* Bottom Action Buttons (Reject & Confirm) — only while the sitter's
          response is still pending (Phase 5.1: hidden for active / cancelled /
          completed jobs). */}
      {showSitterActions && (
        <div className={styles.actionRow}>
          <button type="button" onClick={handleReject} className={styles.rejectBtn}>
            Reject
          </button>
          <button type="button" onClick={handleConfirm} className={styles.confirmBtn}>
            Confirm
          </button>
        </div>
      )}

      <BabysitterBottomNav />
    </div>
  );
};

export default JobDetails;
