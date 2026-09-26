import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import UserAvatar from '../../components/ui/UserAvatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import styles from './profile-screen.module.css';

export default function ParentProfileScreen() {
  const navigate = useNavigate();
  const { user, logout, deactivateAccount } = useAuth();
  const toast = useToast();

  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

  const name = user?.name ?? user?.FullName ?? user?.Username ?? 'Parent User';
  const email = user?.email ?? user?.Email ?? 'parent@example.com';
  const phone = user?.phone ?? user?.PhoneNumber ?? '+92 300 0000000';
  const city = user?.city ?? user?.City ?? 'Islamabad';

  // Phase 5.1 fix — the parent login response (POST /api/parent/login) returns the
  // avatar as camelCase `pictureAddress`. This screen only looked for
  // `PictureAddress`/`profilePicture`, so every avatar missed its image and fell
  // back to the initial letter ('B' in QA). Every known spelling is now honoured.
  //
  // The raw address is passed to <UserAvatar>, which resolves it through the
  // shared `getAvatarUrl` helper — the single-source-of-truth buildImageUrl() that
  // maps 'Parents/{file}.jpg' to '/api/images/Parents/{file}.jpg'. <UserAvatar>
  // also owns the onError fallback, so the letter is used ONLY when
  // PictureAddress is null or the image fails to load.
  const parentData = user ?? {};
  const avatar =
    parentData.pictureAddress ??
    parentData.PictureAddress ??
    parentData.profilePicture ??
    parentData.ProfilePicture ??
    parentData.Picture ??
    null;

  const handleDeactivate = async () => {
    setIsDeactivating(true);
    try {
      await deactivateAccount('parent');
    } catch (err) {
      toast.error(err?.message || 'Network error during deactivation. Please try again.');
      setIsDeactivating(false);
    }
  };

  return (
    <div className={styles.profileContainer}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Account Profile</h1>
        {/* Entry point for the editable profile screen. The former 42px spacer div was
            load-bearing only for symmetry, so it is replaced (marginLeft:auto keeps the
            button hard-right without disturbing the back button + title). */}
        <button
          type="button"
          onClick={() => navigate('/update-parent-profile')}
          aria-label="Edit Parent Profile"
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            background: 'var(--color-primary-tint)',
            color: 'var(--color-primary)',
            border: 'none',
            borderRadius: '20px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          Edit Profile
        </button>
      </div>

      {/* Hero Card */}
      <section className={styles.profileHeroCard}>
        <div className={styles.avatarWrap}>
          <UserAvatar
            src={avatar}
            name={name}
            size={72}
            type="Parents"
            className={styles.avatarImg}
          />
        </div>
        <div>
          <h2 className={styles.profileName}>{name}</h2>
          <span className={styles.roleBadge}>Verified Parent</span>
        </div>
      </section>

      {/* Details Card */}
      <section className={styles.infoCard}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Email Address</span>
          <span className={styles.infoValue}>{email}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Phone Number</span>
          <span className={styles.infoValue}>{phone}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Primary City</span>
          <span className={styles.infoValue}>{city}</span>
        </div>
      </section>

      {/* Menu Actions */}
      <section className={styles.menuCard}>
        <div
          className={styles.menuItem}
          onClick={() => navigate('/child-profile')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/child-profile')}
        >
          <div className={styles.menuItemLeft}>
            <span>👶</span>
            <span>Registered Children Profiles</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        <div
          className={styles.menuItem}
          onClick={() => navigate('/my-jobs')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/my-jobs')}
        >
          <div className={styles.menuItemLeft}>
            <span>🗓️</span>
            <span>Booking & Invoicing History</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        <div
          className={styles.menuItem}
          onClick={() => navigate('/cry-alert')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/cry-alert')}
        >
          <div className={styles.menuItemLeft}>
            <span>🔔</span>
            <span>Acoustic Cry Detector Settings</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </section>

      {/* Sign Out Button */}
      <div style={{ marginTop: 'var(--space-2)' }}>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={logout}
        >
          Sign Out of Account
        </Button>
      </div>

      {/* Danger Zone: Account Deactivation */}
      <section className={styles.dangerZone}>
        <div className={styles.dangerZoneHeader}>
          <span className={styles.dangerZoneIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <h3 className={styles.dangerZoneTitle}>Danger Zone</h3>
        </div>
        <p className={styles.dangerZoneDescription}>
          Permanently deactivate your account. This cancels active babysitting requests and logs you out immediately.
        </p>
        <div className={styles.dangerBtn}>
          <Button
            variant="danger"
            size="md"
            fullWidth
            onClick={() => setShowDeactivateModal(true)}
          >
            Deactivate Account
          </Button>
        </div>
      </section>

      {/* Deactivation Confirmation Modal */}
      <Modal
        isOpen={showDeactivateModal}
        onClose={() => !isDeactivating && setShowDeactivateModal(false)}
        title="Deactivate Account?"
      >
        <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 'var(--line-height-normal)' }}>
          This action will permanently deactivate your account, cancel active bookings, and log you out. Historical records will be retained. Do you wish to proceed?
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            variant="secondary"
            fullWidth
            disabled={isDeactivating}
            onClick={() => setShowDeactivateModal(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            fullWidth
            loading={isDeactivating}
            onClick={handleDeactivate}
          >
            Yes, Deactivate
          </Button>
        </div>
      </Modal>

      <ParentBottomNav />
    </div>
  );
}
