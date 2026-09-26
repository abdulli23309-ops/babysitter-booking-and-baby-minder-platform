import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import Button from '../../components/ui/Button';
import BackButton from '../../components/ui/BackButton';
import Modal from '../../components/ui/Modal';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { apiGet } from '../../services/apiClient';
import { getAvatarUrl } from '../../utils/imageUtils';
import styles from './babysitter-profile.module.css';


export default function MyProfile() {
  const navigate = useNavigate();
  const { user, userId, logout, deactivateAccount } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(userId));
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function fetchProfile() {
      if (!userId) return;
      try {
        const data = await apiGet(`/matching/babysitter/${userId}`);
        if (!ignore) {
          setProfile(data);
        }
      } catch {
        // fallback to auth context user
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    fetchProfile();
    return () => {
      ignore = true;
    };
  }, [userId]);

  const name = profile?.FullName ?? user?.name ?? user?.FullName ?? 'Caregiver';
  const email = profile?.EmailAddress ?? user?.email ?? 'sitter@example.com';
  const phone = profile?.PhoneNumber ?? user?.phone ?? '+92 300 1234567';
  const city = profile?.City ?? user?.city ?? 'Islamabad';
  const pic = getAvatarUrl(profile?.PictureAddress ?? user?.profilePicture, 'Sitters');
  const hourlyRate = profile?.HourlyRate ?? null;
  const expYears = profile?.ExperienceYears ?? null;

  const handleDeactivate = async () => {
    setIsDeactivating(true);
    try {
      await deactivateAccount('babysitter');
    } catch (err) {
      toast.error(err?.message || 'Network error during deactivation. Please try again.');
      setIsDeactivating(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.profileContainer} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <LoadingSpinner size="lg" label="Loading caregiver profile..." />
        <BabysitterBottomNav />
      </div>
    );
  }

  return (
    <div className={styles.profileContainer}>
      {/* Top Bar: Clean, Single Header with BackButton and Edit Profile */}
      <header className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Caregiver Profile</h1>
        <button
          type="button"
          onClick={() => navigate('/update-profile')}
          className={styles.editProfileBtn}
          aria-label="Edit Caregiver Profile"
        >
          Edit Profile
        </button>
      </header>

      {/* Hero Profile Card */}
      <section className={styles.heroCard} aria-label="Caregiver Overview">
        <div className={styles.avatarWrapper}>
          {!avatarFailed && pic ? (
            <img
              src={pic}
              alt={name}
              className={styles.avatarImg}
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <div className={styles.avatarFallback}>
              {(name.trim().charAt(0) || 'C').toUpperCase()}
            </div>
          )}
          <div className={styles.verifiedBadge} title="Verified Caregiver">
            ✓
          </div>
        </div>

        <div className={styles.nameGroup}>
          <h2 className={styles.caregiverName}>{name}</h2>
          <div className={styles.roleBadgePill}>
            <span>📍 {city}</span>
            <span>•</span>
            <span style={{ color: 'var(--color-primary)' }}>⭐ 5.0 Top Caregiver</span>
          </div>
        </div>

        {/* Dual Stat Pills */}
        <div className={styles.statsGrid}>
          <div className={styles.statPillPeach}>
            <span className={styles.statLabel}>Hourly Rate</span>
            <p className={styles.statValueOrange}>{hourlyRate != null ? `PKR ${hourlyRate}/hr` : '—'}</p>
          </div>
          <div className={styles.statPillSlate}>
            <span className={styles.statLabel}>Experience</span>
            <p className={styles.statValueDark}>{expYears != null ? `${expYears} ${expYears === 1 ? 'Year' : 'Years'}` : '—'}</p>
          </div>
        </div>
      </section>

      {/* Contact & Account Info Card */}
      <section className={styles.infoCard} aria-label="Contact Information">
        <div className={styles.infoRow}>
          <div className={styles.infoIconWrap}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <div className={styles.infoTextGroup}>
            <span className={styles.infoLabel}>Email Address</span>
            <span className={styles.infoValue}>{email}</span>
          </div>
        </div>

        <div className={styles.infoDivider} />

        <div className={styles.infoRow}>
          <div className={styles.infoIconWrap}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </div>
          <div className={styles.infoTextGroup}>
            <span className={styles.infoLabel}>Phone Number</span>
            <span className={styles.infoValue}>{phone}</span>
          </div>
        </div>
      </section>

      {/* Quick Navigation Action Tiles */}
      <section className={styles.actionsSection} aria-label="Quick Actions">
        <div
          className={styles.actionTile}
          onClick={() => navigate('/ratings')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/ratings')}
        >
          <div className={styles.actionTileLeft}>
            <div className={styles.actionIconOrange}>★</div>
            <div className={styles.actionTileText}>
              <span className={styles.actionTitle}>Parent Reviews &amp; Ratings</span>
              <span className={styles.actionSubtitle}>View feedback &amp; testimonials</span>
            </div>
          </div>
          <svg className={styles.chevronIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        <div
          className={styles.actionTile}
          onClick={() => navigate('/earnings')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/earnings')}
        >
          <div className={styles.actionTileLeft}>
            <div className={styles.actionIconPeach}>💰</div>
            <div className={styles.actionTileText}>
              <span className={styles.actionTitle}>Earnings &amp; Payouts</span>
              <span className={styles.actionSubtitle}>Track session earnings &amp; balance</span>
            </div>
          </div>
          <svg className={styles.chevronIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </section>

      {/* Footer Security Actions */}
      <div className={styles.footerActions}>
        <button
          type="button"
          className={styles.signOutBtn}
          onClick={logout}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign Out
        </button>

        <button
          type="button"
          className={styles.deactivateBtn}
          onClick={() => setShowDeactivateModal(true)}
        >
          Deactivate Account
        </button>
      </div>

      {/* Deactivation Confirmation Modal */}
      <Modal
        isOpen={showDeactivateModal}
        onClose={() => setShowDeactivateModal(false)}
        title="Deactivate Caregiver Account?"
      >
        <p style={{ fontSize: '13.5px', color: 'var(--color-text-tertiary)', lineHeight: 1.5, margin: 0 }}>
          Deactivating your account will remove your profile from active parent searches and cancel any upcoming bookings.
          Are you sure you want to proceed?
        </p>
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
          <Button variant="secondary" onClick={() => setShowDeactivateModal(false)} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDeactivate}
            loading={isDeactivating}
            style={{ flex: 1 }}
          >
            Deactivate
          </Button>
        </div>
      </Modal>

      <BabysitterBottomNav />
    </div>
  );
}
