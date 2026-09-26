import { useState, useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import Button from '../../components/ui/Button';
import BackButton from '../../components/ui/BackButton';
import Modal from '../../components/ui/Modal';
import UserAvatar from '../../components/ui/UserAvatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
// Hero card, info card, action tiles and footer buttons are copied verbatim from
// the caregiver profile screen so both roles share one visual language. Only the
// read-only lock, the PK-#### badge and the parent Children section needed new
// rules, and those live in the shared module imported second.
import styles from '../babysitter/babysitter-profile.module.css';
import childStyles from '../../components/profile/profile-screen.module.css';

const calculateAge = (dob) => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return Math.max(0, age);
};

const formatDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const Icons = {
  mail: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  phone: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  user: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  at: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  ),
  pin: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  calendar: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  star: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  wallet: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  ),
  lock: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
};

/**
 * Unified account profile for both roles (parent + babysitter).
 *
 * The profile is always re-read from the API on mount and whenever the signed-in
 * user changes, so the screen never renders values captured at login time.
 */
export default function ProfileScreen() {
  const navigate = useNavigate();
  const { userId, role, logout, deactivateAccount } = useAuth();
  const toast = useToast();

  const isParent = String(role || '').toLowerCase() === 'parent';

  const [profile, setProfile] = useState(null);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(userId));
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;

    let ignore = false;

    (async () => {
      try {
        const data = isParent
          ? await API.getParentProfile(userId)
          : await API.getSitterProfile(userId);
        if (ignore) return;
        setProfile(data || null);

        if (isParent) {
          try {
            const kids = await API.getChildren(userId);
            if (!ignore) setChildren(Array.isArray(kids) ? kids : []);
          } catch {
            if (!ignore) setChildren([]);
          }
        }
      } catch {
        if (!ignore) setProfile(null);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [isParent, userId]);

  const name = profile?.FullName || (isParent ? 'Parent Account' : 'Caregiver Account');
  const email = profile?.EmailAddress || '';
  const username = profile?.Username || '';
  const phone = profile?.PhoneNumber || '';
  const address = profile?.Address || '';
  const city = profile?.City || '';
  const picture = profile?.PictureAddress || null;
  const dob = profile?.DOB || null;
  const experienceYears = profile?.ExperienceYears;
  const hourlyRate = profile?.HourlyRate;

  const idBadge = userId ? `ID: PK-${String(userId).padStart(4, '0')}` : '';
  const experienceText =
    experienceYears === null || experienceYears === undefined
      ? ''
      : `${experienceYears} ${Number(experienceYears) === 1 ? 'Year' : 'Years'}`;
  const rateText =
    hourlyRate === null || hourlyRate === undefined ? '' : `PKR ${hourlyRate}/hr`;

  const detailRows = isParent
    ? [
        { key: 'name', icon: <Icons.user />, label: 'Full Name', value: name },
        { key: 'email', icon: <Icons.mail />, label: 'Email Address', value: email, locked: true },
        { key: 'username', icon: <Icons.at />, label: 'Username', value: username, locked: true },
        { key: 'phone', icon: <Icons.phone />, label: 'Phone Number', value: phone },
        { key: 'address', icon: <Icons.pin />, label: 'Address', value: address },
      ]
    : [
        { key: 'name', icon: <Icons.user />, label: 'Full Name', value: name },
        { key: 'email', icon: <Icons.mail />, label: 'Email Address', value: email, locked: true },
        { key: 'username', icon: <Icons.at />, label: 'Username', value: username, locked: true },
        { key: 'phone', icon: <Icons.phone />, label: 'Phone Number', value: phone },
        { key: 'dob', icon: <Icons.calendar />, label: 'Date of Birth', value: formatDate(dob) },
        { key: 'experience', icon: <Icons.star />, label: 'Experience', value: experienceText },
        { key: 'rate', icon: <Icons.wallet />, label: 'Hourly Rate', value: rateText },
      ];

  const menuItems = isParent
    ? [
        {
          key: 'children',
          icon: '👶',
          tint: styles.actionIconOrange,
          title: 'Registered Children Profiles',
          subtitle: 'Manage names, ages & care notes',
          route: '/child-profile',
        },
        {
          key: 'bookings',
          icon: '🗓️',
          tint: styles.actionIconPeach,
          title: 'Booking & Invoicing History',
          subtitle: 'Review past and upcoming bookings',
          route: '/my-jobs',
        },
        {
          key: 'cry',
          icon: '🔔',
          tint: styles.actionIconOrange,
          title: 'Acoustic Cry Detector Settings',
          subtitle: 'Tune alerts for your baby monitor',
          route: '/cry-alert',
        },
      ]
    : [
        {
          key: 'ratings',
          icon: '★',
          tint: styles.actionIconOrange,
          title: 'Parent Reviews & Ratings',
          subtitle: 'View feedback & testimonials',
          route: '/ratings',
        },
        {
          key: 'earnings',
          icon: '💰',
          tint: styles.actionIconPeach,
          title: 'Earnings & Payouts',
          subtitle: 'Track session earnings & balance',
          route: '/earnings',
        },
      ];

  const handleEdit = () => navigate(isParent ? '/update-parent-profile' : '/update-profile');

  const handleDeactivate = async () => {
    setIsDeactivating(true);
    try {
      await deactivateAccount(role);
    } catch (err) {
      toast.error(err?.message || 'Network error during deactivation. Please try again.');
      setIsDeactivating(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.profileContainer}>
        <LoadingSpinner size="large" label="Loading your profile…" />
        {isParent ? <ParentBottomNav /> : <BabysitterBottomNav />}
      </div>
    );
  }

  return (
    <div className={styles.profileContainer}>
      <header className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Profile</h1>
        <button
          type="button"
          className={styles.editProfileBtn}
          onClick={handleEdit}
          aria-label="Edit profile"
        >
          Edit Profile
        </button>
      </header>

      {/* Hero — same card as the caregiver screen, only the labels change */}
      <section className={styles.heroCard} aria-label="Profile overview">
        <div className={styles.avatarWrapper}>
          <UserAvatar
            src={picture}
            name={name}
            size={96}
            type={isParent ? 'Parents' : 'Sitters'}
            className={styles.avatarImg}
          />
          <div
            className={styles.verifiedBadge}
            title={isParent ? 'Verified Parent' : 'Verified Caregiver'}
          >
            ✓
          </div>
        </div>

        <div className={styles.nameGroup}>
          <h2 className={styles.caregiverName}>{name}</h2>
          <div className={styles.roleBadgePill}>
            {city && (
              <>
                <span>📍 {city}</span>
                <span>•</span>
              </>
            )}
            <span style={{ color: 'var(--color-primary)' }}>
              ★ 5.0 {isParent ? 'Trusted Parent' : 'Top Caregiver'}
            </span>
          </div>
          {idBadge && <span className={childStyles.idBadge}>{idBadge}</span>}
        </div>

        <div className={styles.statsGrid}>
          {isParent ? (
            <>
              <div className={styles.statPillPeach}>
                <span className={styles.statLabel}>Child Profiles</span>
                <p className={styles.statValueOrange}>{children.length}</p>
              </div>
              <div className={styles.statPillSlate}>
                <span className={styles.statLabel}>Account Type</span>
                <p className={styles.statValueDark}>Parent</p>
              </div>
            </>
          ) : (
            <>
              <div className={styles.statPillPeach}>
                <span className={styles.statLabel}>Hourly Rate</span>
                <p className={styles.statValueOrange}>{rateText || '—'}</p>
              </div>
              <div className={styles.statPillSlate}>
                <span className={styles.statLabel}>Experience</span>
                <p className={styles.statValueDark}>{experienceText || '—'}</p>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Account details — read-only, always freshly fetched */}
      <section className={styles.infoCard} aria-label="Account details">
        {detailRows.map((row, index) => (
          <Fragment key={row.key}>
            {index > 0 && <div className={styles.infoDivider} />}
            <InfoRow icon={row.icon} label={row.label} value={row.value} locked={row.locked} />
          </Fragment>
        ))}
        {!profile && (
          <p className={childStyles.loadError}>
            We could not load your saved details. Please try again later.
          </p>
        )}
      </section>

      {/* Parent only — My Children */}
      {isParent && (
        <section className={childStyles.childrenSection} aria-label="My children">
          <h3 className={childStyles.sectionHeading}>👶 My Children</h3>
          {children.length > 0 ? (
            <>
              <div className={childStyles.childrenList}>
                {children.map((child, index) => (
                  <ChildRow
                    key={child.Child_ID ?? child.ChildId ?? child.child_id ?? child.id ?? index}
                    child={child}
                    onOpen={() => navigate('/update-child-profile', { state: { child } })}
                  />
                ))}
              </div>
              <button
                type="button"
                className={childStyles.addAnotherChild}
                onClick={() => navigate('/set-child-profile')}
              >
                + Add Another Child
              </button>
            </>
          ) : (
            <div className={childStyles.emptyCard}>
              <span className={childStyles.emptyIcon}>👶</span>
              <p className={childStyles.emptyTitle}>No child profiles yet</p>
              <p className={childStyles.emptyText}>
                Add a child profile so caregivers know the age, routine and care notes in advance.
              </p>
              <button
                type="button"
                className={childStyles.addChildBtn}
                onClick={() => navigate('/set-child-profile')}
              >
                + Add Child Profile
              </button>
            </div>
          )}
        </section>
      )}

      {/* Role-specific shortcuts */}
      <section className={styles.actionsSection} aria-label="Profile shortcuts">
        {menuItems.map((item) => (
          <div
            key={item.key}
            className={styles.actionTile}
            role="button"
            tabIndex={0}
            onClick={() => navigate(item.route)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(item.route)}
          >
            <div className={styles.actionTileLeft}>
              <div className={item.tint}>{item.icon}</div>
              <div className={styles.actionTileText}>
                <span className={styles.actionTitle}>{item.title}</span>
                <span className={styles.actionSubtitle}>{item.subtitle}</span>
              </div>
            </div>
            <svg
              className={styles.chevronIcon}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        ))}
      </section>

      <div className={styles.footerActions}>
        <button type="button" className={styles.signOutBtn} onClick={logout}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

      <Modal
        isOpen={showDeactivateModal}
        onClose={() => { if (!isDeactivating) setShowDeactivateModal(false); }}
        title="Deactivate Account?"
      >
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
          Deactivating hides your account and cancels any upcoming bookings immediately. Previous
          records are kept on file. Do you want to continue?
        </p>
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
          <Button
            variant="secondary"
            style={{ flex: 1 }}
            onClick={() => setShowDeactivateModal(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            style={{ flex: 1 }}
            onClick={handleDeactivate}
            loading={isDeactivating}
          >
            Deactivate
          </Button>
        </div>
      </Modal>

      {isParent ? <ParentBottomNav /> : <BabysitterBottomNav />}
    </div>
  );
}

/** Read-only detail row: icon + label + value, with an optional lock glyph. */
function InfoRow({ icon, label, value, locked = false }) {
  return (
    <div className={styles.infoRow}>
      <div className={styles.infoIconWrap}>{icon}</div>
      <div className={styles.infoTextGroup}>
        <span className={styles.infoLabel}>{label}</span>
        <span className={styles.infoValue}>{value || '—'}</span>
      </div>
      {locked && (
        <span className={childStyles.lockIcon} title="Managed by the system">
          <Icons.lock />
        </span>
      )}
    </div>
  );
}

/** One child row inside the parent-only "My Children" section. */
function ChildRow({ child, onOpen }) {
  const childName =
    child.ChildName ?? child.childName ?? child.Name ?? child.name ?? 'Unnamed Child';
  const dobValue = child.DOB ?? child.dob ?? child.DateOfBirth ?? child.dateOfBirth ?? null;
  const rawAge =
    child.ChildAge ?? child.childAge ?? child.age ?? (dobValue ? calculateAge(dobValue) : null);
  const age = Number(rawAge);
  const meta = Number.isFinite(age)
    ? `${age} ${age === 1 ? 'Year' : 'Years'} Old`
    : 'Age not provided';
  const photo =
    child.PictureAddress ?? child.pictureAddress ?? child.Picture ?? child.picture ?? null;

  return (
    <div
      className={childStyles.childRow}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <UserAvatar src={photo} name={childName} size={46} type="Children" />
      <div className={childStyles.childInfo}>
        <span className={childStyles.childName}>{childName}</span>
        <span className={childStyles.childMeta}>{meta}</span>
      </div>
      <span className={childStyles.childChevron}>›</span>
    </div>
  );
}

