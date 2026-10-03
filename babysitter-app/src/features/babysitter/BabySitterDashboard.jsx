import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import { useAuth } from '../auth/AuthContext';
import { apiGet } from '../../services/apiClient';
import styles from './babysitter-dashboard.module.css';

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

export default function BabySitterDashboard() {
  const navigate = useNavigate();
  const { user, userId } = useAuth();

  const [jobRequestCount, setJobRequestCount] = useState(0);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [dbAvatar, setDbAvatar] = useState(null);
  const [imgError, setImgError] = useState(false);

  const sitterName = user?.name ?? user?.FullName ?? user?.Username ?? 'Babysitter';
  const sitterAvatar = buildImageUrl(dbAvatar || user?.profilePicture || user?.PictureAddress) || null;
  const avatarSrc = sitterAvatar;

  useEffect(() => {
    let ignore = false;
    async function fetchDashboardData() {
      if (!userId) return;
      try {
        const reqData = await apiGet(`/matching/jobrequests?sitterId=${userId}`);
        if (!ignore) {
          setJobRequestCount(Array.isArray(reqData) ? reqData.length : 0);
        }
      } catch {
        // Fallback gracefully
      }

      try {
        const earnData = await apiGet(`/babysitter/earnings/${userId}`);
        if (!ignore) {
          setTotalEarnings(earnData?.totalEarnings ?? earnData?.balance ?? 0);
        }
      } catch {
        // Fallback gracefully
      }

      try {
        const profileData = await apiGet(`/matching/babysitter/${userId}`);
        if (!ignore && profileData?.PictureAddress) {
          setDbAvatar(profileData.PictureAddress);
        }
      } catch {
        // Fallback gracefully
      }
    }

    fetchDashboardData();
    return () => {
      ignore = true;
    };
  }, [userId]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className={styles.dashboardContainer}>
      {/* Top Bar */}
      <header className={styles.header}>
        <div className={styles.greetingSection}>
          <span className={styles.greetingSub}>{getGreeting()}</span>
          <h1 className={styles.greetingName}>{sitterName} 👋</h1>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate('/babysitter-notifications')}
            aria-label="Notifications"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {jobRequestCount > 0 && <span className={styles.pulseDot} />}
          </button>
          <button
            type="button"
            className={styles.avatarBtn}
            onClick={() => navigate('/my-profile')}
            aria-label="Babysitter Profile"
          >
            {avatarSrc && !imgError ? (
              <img
                src={avatarSrc}
                alt={sitterName}
                className={styles.avatarImg}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className={styles.avatarFallback}>
                {(sitterName.trim().charAt(0) || 'B').toUpperCase()}
              </div>
            )}
          </button>
        </div>
      </header>

      {/* Hero Bento: Live Earnings Glance */}
      <section className={styles.earningsCard}>
        <div className={styles.earningsGlow} />
        <p className={styles.earningsLabel}>Current Balance & Earnings</p>
        <h2 className={styles.earningsAmount}>
          PKR {totalEarnings.toLocaleString()}
        </h2>
        <div className={styles.earningsRow}>
          <span className={styles.earningsTrend}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
            Payouts Verified
          </span>
          <button
            type="button"
            className={styles.viewEarningsBtn}
            onClick={() => navigate('/earnings')}
          >
            Details →
          </button>
        </div>
      </section>

      {/* Bento Grid */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-text)' }}>
            Care Operations
          </h3>
        </div>

        <div className={styles.bentoGrid}>
          {/* Bento 1: Job Requests */}
          <div
            className={styles.bentoCard}
            onClick={() => navigate('/job-request')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/job-request')}
          >
            <div className={styles.bentoTop}>
              <div className={styles.bentoIconWrapper} style={{ background: 'var(--badge-warning-bg)', color: 'var(--color-primary)' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
              </div>
              {jobRequestCount > 0 && (
                <span className={styles.badgePill} style={{ background: 'var(--color-danger)', color: 'var(--color-text-inverse)' }}>
                  {jobRequestCount} New
                </span>
              )}
            </div>
            <div className={styles.bentoBottom}>
              <h4 className={styles.bentoCardTitle}>Job Requests</h4>
              <p className={styles.bentoCardSubtitle}>Incoming bookings</p>
            </div>
          </div>

          {/* Bento 2: Active / Scheduled Jobs */}
          <div
            className={styles.bentoCard}
            onClick={() => navigate('/babysitter-my-jobs')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/babysitter-my-jobs')}
          >
            <div className={styles.bentoTop}>
              <div className={styles.bentoIconWrapper} style={{ background: 'var(--badge-success-bg)', color: 'var(--badge-success-text)' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <span className={styles.badgePill} style={{ background: 'var(--badge-success-bg)', color: 'var(--badge-success-text)' }}>
                Active
              </span>
            </div>
            <div className={styles.bentoBottom}>
              <h4 className={styles.bentoCardTitle}>My Schedule</h4>
              <p className={styles.bentoCardSubtitle}>Assigned jobs</p>
            </div>
          </div>

          {/* Bento 3: Set Availability */}
          <div
            className={styles.bentoCard}
            onClick={() => navigate('/set-availability')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/set-availability')}
          >
            <div className={styles.bentoTop}>
              <div className={styles.bentoIconWrapper} style={{ background: 'var(--badge-info-bg)', color: 'var(--badge-info-text)' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <span className={styles.badgePill} style={{ background: 'var(--badge-info-bg)', color: 'var(--badge-info-text)' }}>
                7 Days
              </span>
            </div>
            <div className={styles.bentoBottom}>
              <h4 className={styles.bentoCardTitle}>Availability</h4>
              <p className={styles.bentoCardSubtitle}>Time slot picker</p>
            </div>
          </div>

          {/* Bento 4: Ratings & Reviews */}
          <div
            className={styles.bentoCard}
            onClick={() => navigate('/ratings')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/ratings')}
          >
            <div className={styles.bentoTop}>
              <div className={styles.bentoIconWrapper} style={{ background: 'var(--badge-purple-bg)', color: 'var(--badge-purple-text)' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <span className={styles.badgePill} style={{ background: 'var(--color-warning-tint)', color: 'var(--color-warning-strong)' }}>
                ★ 5.0
              </span>
            </div>
            <div className={styles.bentoBottom}>
              <h4 className={styles.bentoCardTitle}>Parent Reviews</h4>
              <p className={styles.bentoCardSubtitle}>Feedback & stars</p>
            </div>
          </div>
        </div>
      </section>

      {/* Additional Tools */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-text)' }}>
            Assistant Tools
          </h3>
        </div>

        <div className={styles.toolsList}>
          {/* The "AI Baby Cry Detector" tool was REMOVED for the sitter.
              Cry DETECTION belongs to the monitor device (Phone 2) alone: the
              server refuses a cry report from any ordinary account bearer, so
              this entry could only ever have opened a screen that cannot report
              anything. Offering it was a false capability.

              This is a UI removal, not the security control - the backend
              restriction on POST /monitoring/cry is what actually enforces it.
              Receiving a CryAlert, and answering it, remain available to the
              sitter through the active-job monitoring screen. */}

          <div
            className={styles.toolItem}
            onClick={() => navigate('/my-profile')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/my-profile')}
          >
            <div className={styles.toolItemLeft}>
              <div className={styles.toolIcon} style={{ background: 'var(--badge-info-bg)', color: 'var(--badge-info-text)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <h4 className={styles.toolTitle}>Caregiver Profile & Bio</h4>
                <p className={styles.toolDesc}>Hourly rate, certifications, picture</p>
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </div>
      </section>

      <BabysitterBottomNav />
    </div>
  );
}

