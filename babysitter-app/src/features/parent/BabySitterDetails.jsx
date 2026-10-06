import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import UserAvatar from '../../components/ui/UserAvatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import AssignedTaskSelector from '../../components/ui/AssignedTaskSelector';
import {
  normalizeTaskIds,
  resolveAssignedTasks,
} from '../../utils/assignedTasks';
import {
  todayISO,
  toDayKey,
  countSelectedWeekdays,
  formatLocalDate,
} from '../../utils/dateUtils';
import styles from './sitter-details.module.css';

function toTime24(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + min + ':00';
}

export default function BabySitterDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, userId } = useAuth();
  const { showToast } = useToast?.() ?? { showToast: () => {} };

  const sitter = location.state?.sitter;

  // Read locked search from localStorage (saved by SearchBabySitter after a successful search)
  const savedSearch = (() => {
    try { return JSON.parse(localStorage.getItem('lastBookingSearch') || 'null'); }
    catch { return null; }
  })();

  const lockedSearch = savedSearch;

  // Phase 8K: if the parent arrived here from "Find Replacement" / "Find a
  // Sitter for This Day" on a series day, the BookingStatus CTA wrote
  // lastBookingSearch with autoSearch + targetJobId. In that case:
  //   - the schedule is derived from the target job, not editable
  //   - submitting INVITES the picked sitter to the existing job
  //   - no new Job row is created
  // autoSearch is required as well as targetJobId: SearchBabySitter strips the
  // flag the moment it auto-fires, so by the time the parent reaches this modal
  // only targetJobId survives — that is the intended signal.
  const replacementFlow = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem('lastBookingSearch') || 'null');
      if (!raw?.targetJobId) return null;
      return raw;
    } catch { return null; }
  })();

  const isReplacement = Boolean(replacementFlow);

  // Booking Modal States
  const [showChildModal, setShowChildModal] = useState(false);
  const [children, setChildren] = useState([]);
  const [selectedChildIds, setSelectedChildIds] = useState([]);
  const [allChildrenSelected, setAllChildrenSelected] = useState(false);
  // Phase 10.0 — "Today's Required Tasks": ids of the predefined tasks the
  // parent wants the babysitter to perform during this booking. Optional —
  // zero tasks is a valid, submittable state.
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [requesting, setRequesting] = useState(false);

  // Safe defaults when parent opens details without searching
  const today = new Date().toISOString().split('T')[0];
  const ls = lockedSearch || {};

  // Phase 8L: these four hold the schedule that is now DISPLAY-ONLY in Step 2.
  // The read-only summary renders the `final*` values derived from
  // lockedSearch, so nothing mutates them any more — the setters are removed.
  // The state itself is kept because the submit handler and the validation
  // block still read availabilityType / startDate / endDate / selectedDays.
  const [availabilityType] = useState(
    ls?.AvailabilityType === 'Repeat Days' ? 'Repeat Days' : 'Single Day'
  );
  const [startDate] = useState(() => ls?.StartDate || todayISO());
  const [endDate] = useState(() => ls?.EndDate || ls?.StartDate || '');
  const [selectedDays] = useState(() => {
    const raw = ls?.SelectedDays ?? [];
    return raw.map(d => toDayKey(d)).filter(Boolean);
  });
  const [scheduleError, setScheduleError] = useState('');

  const finalStart = ls.StartDate || today;
  const finalEnd = ls.EndDate || finalStart;
  const finalStartTime = ls.StartTime || '09:00 AM';
  const finalEndTime = ls.EndTime || '05:00 PM';
  const finalDays = ls.SelectedDays || [];
  const finalAvailType = ls.AvailabilityType || 'One Day';
  const finalAddress = ls.Address || ls.City || 'Not set';
  const finalLat = ls.Latitude || null;
  const finalLng = ls.Longitude || null;
  const finalCity = ls.City || '';

  useEffect(() => {
    let ignore = false;
    async function fetchChildren() {
      if (!userId) return;
      try {
        const data = await API.getChildren(userId);
        if (!ignore && Array.isArray(data)) {
          setChildren(data);
          if (data.length > 0) {
            setSelectedChildIds([data[0].Child_ID ?? data[0].id]);
          }
        }
      } catch {
        // silent catch
      }
    }
    fetchChildren();
    return () => {
      ignore = true;
    };
  }, [userId]);

  if (!sitter) {
    return (
      <div className={styles.detailsContainer}>
        <div className={styles.topBar}>
          <BackButton />
          <h1 className={styles.topTitle}>Caregiver Details</h1>
          <div className={styles.headerSpacer} />
        </div>
        <EmptyState
          title="Caregiver Not Found"
          description="Could not locate the requested babysitter profile."
          actionLabel="Find Babysitters"
          onAction={() => navigate('/search-babysitter')}
        />
        <ParentBottomNav />
      </div>
    );
  }

  const name = sitter.FullName ?? sitter.name ?? 'Verified Caregiver';
  const city = sitter.City ?? sitter.city ?? 'Islamabad';
  const rating = Number(sitter.Rating) || 5.0;
  const rate = sitter.HourlyRate ?? 1200;
  const exp = sitter.ExperienceYears ?? 2;
  const pic = sitter.PictureAddress ?? sitter.profilePicture;
  const bio = sitter.Bio ||
    `${name} is a dedicated and certified childcare specialist with over ${exp} years of hands-on experience in infant care, toddler nutrition, and developmental activities. Trained in pediatric first-aid and CPR.`;
  const phone = sitter.Phone || sitter.PhoneNumber;

  // Phase 10.0 — resolved labels for the booking summary row.
  const summaryTasks = resolveAssignedTasks(selectedTasks);

  const handleHireClick = () => {
    if (children.length === 0) {
      showToast?.('Please register your child profile before booking.', { type: 'warning' });
      navigate('/set-child-profile');
      return;
    }
    setShowChildModal(true);
  };

  const toggleChildSelection = (cid) => {
    // Phase 10.0 — tasks belong to the booking's child context. Any change to
    // the selected child(ren) clears them so a task chosen for one child is
    // never silently submitted for another.
    setSelectedTasks([]);
    // Clicking a child while "All" is on deselects All and picks this one.
    if (allChildrenSelected) {
      setAllChildrenSelected(false);
      setSelectedChildIds([cid]);
      return;
    }

    const already = selectedChildIds.includes(cid);

    if (already) {
      setSelectedChildIds(selectedChildIds.filter((id) => id !== cid));
      return;
    }

    // Cap rule: block if selecting this would equal ALL children.
    if (children.length > 1 && selectedChildIds.length + 1 === children.length) {
      showToast?.(
        "To select every child, use 'Take Care for All Children' above.",
        { type: 'error' }
      );
      return;
    }

    setSelectedChildIds([...selectedChildIds, cid]);
  };

  const handleConfirmBooking = async () => {
    // Phase 8K: skip schedule validation in the replacement flow — the schedule
    // comes from the existing job and the inputs are not rendered.
    if (!isReplacement && availabilityType === 'Repeat Days') {
      if (!startDate || !endDate) {
        setScheduleError('Please set both start and end dates.');
        return;
      }
      if (new Date(endDate) < new Date(startDate)) {
        setScheduleError('End date must be on or after start date.');
        return;
      }
      const days = Math.round(
        (new Date(endDate) - new Date(startDate)) / 86400000
      );
      if (days > 30) {
        setScheduleError('Series cannot exceed 30 days.');
        return;
      }
      if (selectedDays.length === 0) {
        setScheduleError('Select at least one weekday.');
        return;
      }
      const willCreate = countSelectedWeekdays(startDate, endDate, selectedDays);
      if (willCreate === 0) {
        setScheduleError('No matching weekdays in the selected range.');
        return;
      }
    }

    setScheduleError('');

    if (!allChildrenSelected && selectedChildIds.length === 0) {
      showToast?.('Please select at least one child.', { type: 'warning' });
      return;
    }
    setRequesting(true);
    try {
      const sitterId = sitter.Sitter_ID ?? sitter.BabySitter_ID ?? sitter.id;

      // Phase 8K: replacement flow — invite the picked sitter to the EXISTING
      // job (Job 152 in this case) instead of creating a brand-new one.
      // Contract (JobInvitationsController.Invite, PHASE D):
      //   POST /api/jobs/{jobId}/invite   body: { ParentId, SitterIds: [] }
      // ParentId is REQUIRED and must equal the authenticated parent, else 403.
      if (isReplacement) {
        if (!sitterId) {
          showToast?.('Sitter missing.', { type: 'warning' });
          setRequesting(false);
          return;
        }
        const parentId = userId ?? user?.Parent_ID;
        if (!parentId) {
          showToast?.('Could not identify your account.', { type: 'error' });
          setRequesting(false);
          return;
        }
        await API.inviteSitters(replacementFlow.targetJobId, {
          ParentId: parentId,
          SitterIds: [sitterId],
        });
        showToast?.('Replacement request sent.', { type: 'success' });
        setShowChildModal(false);
        // Clear the flow so a later normal booking is not mistaken for one.
        try { localStorage.removeItem('lastBookingSearch'); } catch { /* storage unavailable */ }
        navigate('/my-jobs');
        return;
      }

      const allChildIds = children.map((c) => c.Child_ID ?? c.id).filter(Boolean);

      const finalChildIds = allChildrenSelected
        ? allChildIds
        : selectedChildIds;

      const isMulti = finalChildIds.length > 1;

      // Matches backend CreateJobDto (POST /api/parent/create-job)
      // Pulls from lockedSearch (inherited from Find a Sitter)
      const payload = {
        ParentId: userId ?? user?.Parent_ID,
        ChildId: finalChildIds[0],                     // backend requires one
        SitterId: sitterId,
        City: finalCity || sitter.City || '',
        StartDate: startDate,
        StartTime: toTime24(finalStartTime),
        EndTime: toTime24(finalEndTime),
        Latitude: finalLat,
        Longitude: finalLng,
        IsForAllChildren: isMulti,
        AllChildIds: isMulti ? finalChildIds : [],
        EndDate: availabilityType === 'Repeat Days' ? endDate : startDate,
        AvailabilityType: availabilityType === 'Repeat Days' ? 'Repeat Days' : 'Single Day',
        SelectedDays: availabilityType === 'Repeat Days' ? selectedDays : [],
        // Phase 10.0 — the chosen "Today's Required Tasks" travel with the
        // existing booking payload (validated again on the server).
        AssignedTasks: normalizeTaskIds(selectedTasks),
      };

      const res = await API.createJob(payload);

      showToast?.('Booking request sent. Waiting for confirmation.', { type: 'success' });
      const created = res?.SeriesCount ?? res?.seriesCount ?? 1;
      if (created > 1) {
        showToast?.(`Booking request sent for ${created} dates.`, { type: 'success' });
      } else {
        showToast?.('Booking request sent.', { type: 'success' });
      }

      setShowChildModal(false);
      navigate('/my-jobs');
    } catch (err) {
      showToast?.(err?.message || `Booking request failed for ${name}.`, { type: 'warning' });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className={styles.detailsContainer}>
      {/* Universal Top Bar */}
      <header className={styles.topBar}>
        <BackButton />
        <h1 className={styles.topTitle}>Caregiver Details</h1>
        <div className={styles.headerSpacer} />
      </header>

      {/* Pediatric Hero Section */}
      <section className={styles.heroCard}>
        {/* Perfect 120px Circular Avatar */}
        <div className={styles.avatarContainer}>
          <UserAvatar
            src={pic}
            name={name}
            size={120}
            shape="circle"
            type="Sitters"
            className={styles.pediatricAvatar}
          />
          <div className={styles.trustShieldBadge} title="Verified Pediatric Caregiver">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <h2 className={styles.sitterName}>{name}</h2>
        <span className={styles.cityBadge}>📍 {city}</span>
        <span className={styles.verifiedTag}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Certified Childcare Provider
        </span>
      </section>

      {/* Pediatric Bento Stats Grid */}
      <section className={styles.bentoGrid} aria-label="Caregiver Qualifications">
        {/* Experience Card with Building Block / Teddy Bear Icon */}
        <div className={styles.bentoCard}>
          <div className={`${styles.bentoIconCircle} ${styles.bentoIconTeddy}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="8" height="8" rx="2" />
              <rect x="13" y="3" width="8" height="8" rx="2" />
              <rect x="8" y="13" width="8" height="8" rx="2" />
              <circle cx="7" cy="7" r="1" fill="currentColor" />
              <circle cx="17" cy="7" r="1" fill="currentColor" />
              <circle cx="12" cy="17" r="1" fill="currentColor" />
            </svg>
          </div>
          <span className={styles.bentoValue}>{exp}+ Yrs</span>
          <span className={styles.bentoLabel}>EXPERIENCE</span>
        </div>

        {/* Safety/Certified Shield Card */}
        <div className={styles.bentoCard}>
          <div className={`${styles.bentoIconCircle} ${styles.bentoIconShield}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 11 14 15 10" strokeWidth="2.5" />
            </svg>
          </div>
          <span className={styles.bentoValue}>★ {rating.toFixed(1)}</span>
          <span className={styles.bentoLabel}>SAFETY RATED</span>
        </div>

        {/* Hourly Rate Piggy/Coin Card */}
        <div className={styles.bentoCard}>
          <div className={`${styles.bentoIconCircle} ${styles.bentoIconCoin}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M14.8 9A2 2 0 0 0 13 8h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1-1.8-1" />
              <line x1="12" y1="6" x2="12" y2="8" />
              <line x1="12" y1="16" x2="12" y2="18" />
            </svg>
          </div>
          <span className={styles.bentoValue}>{rate} PKR</span>
          <span className={styles.bentoLabel}>HOURLY RATE</span>
        </div>
      </section>

      {/* About Section */}
      <section className={styles.bioCard}>
        <h3 className={styles.bioTitle}>About {name}</h3>
        <p className={styles.bioText}>{bio}</p>
      </section>

      {/* Direct Contact Card (if available) */}
      {phone && (
        <section className={styles.quickInfoCard}>
          <div>
            <span className={styles.phoneLabel}>Direct Phone</span>
            <a href={`tel:${phone}`} className={styles.phoneLink}>
              📞 {phone}
            </a>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--color-success-strong)', fontWeight: 700 }}>
            Active Line
          </span>
        </section>
      )}

      {/* Pill-shaped Request Booking Action */}
      <div className={styles.bottomActionWrap}>
        <button
          type="button"
          className={styles.requestBookingBtn}
          onClick={handleHireClick}
        >
          <span>Request Booking</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>

      {/* Child Selection Modal */}
      <Modal
        open={showChildModal}
        onClose={() => !requesting && setShowChildModal(false)}
      >
        <div style={{
          background: 'var(--color-surface)',
          border: 'none',
          borderRadius: '24px',
          padding: '20px 16px',
          maxHeight: '82vh',
          overflowY: 'auto',
          boxShadow: 'none',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: 32, marginBottom: 4 }}>⭐</div>
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--color-text)', letterSpacing: '-0.3px' }}>Confirm Booking</h3>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Select a child and confirm your request</p>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Step 1: Select Child for Care</p>
          {children.length > 1 && (
            <button
              type="button"
              onClick={() => {
                // Phase 10.0 — the child context changes here too, so the
                // task selection resets with it.
                setSelectedTasks([]);
                if (allChildrenSelected) {
                  setAllChildrenSelected(false);
                  setSelectedChildIds([]);
                } else {
                  setAllChildrenSelected(true);
                  setSelectedChildIds([]);   // clear any partial selection
                }
              }}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '16px',
                border: allChildrenSelected ? '2px solid #E8622A' : '2px dashed #CBD5E1',
                background: allChildrenSelected ? '#FFF1E7' : '#FFFFFF',
                color: allChildrenSelected ? '#E8622A' : '#64748B',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginBottom: '8px',
                transition: 'all 0.2s ease',
              }}
            >
              🧸 {allChildrenSelected ? 'All Children Selected' : 'Take Care for All Children'}
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', opacity: allChildrenSelected ? 0.5 : 1, transition: 'opacity 0.2s' }}>
            {children.map((child) => {
              const cid = child.Child_ID ?? child.id;
              const cname = child.ChildName ?? child.name ?? 'Child';
              const isSelected = selectedChildIds.includes(cid);
              return (
                <button key={cid} type="button" onClick={() => toggleChildSelection(cid)} disabled={allChildrenSelected} style={{
                  padding: '12px 16px', borderRadius: '16px',
                  border: isSelected ? '2px solid #E8622A' : '2px solid transparent',
                  background: isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
                  boxShadow: isSelected ? '0 4px 12px rgba(232, 98, 42, 0.15)' : 'none',
                  color: isSelected ? '#E8622A' : '#1A1D2E',
                  fontWeight: isSelected ? 700 : 600, fontSize: '14px',
                  textAlign: 'left', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'all 0.2s ease',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: 36, height: 36, borderRadius: '50%', background: isSelected ? '#FFF1E7' : '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🧸</span>
                    {cname}
                  </span>
                  {isSelected && <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-inverse)', fontSize: 12, fontWeight: 700 }}>✓</span>}
                </button>
              );
            })}
          </div>
          {/* Step 2 is ALWAYS read-only (Phase 8L): the parent already chose this
              schedule in the search filters (lockedSearch / lastBookingSearch).
              Re-asking here invited the parent to change dates or weekdays and
              silently diverge from what they searched for. In the replacement
              flow the schedule is additionally fixed by the target job. */}
          <div className="schedule-step">
            <label style={{ fontWeight: 700, display: 'block', marginBottom: 8, fontSize: 13, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              Step 2: Schedule {isReplacement ? '(locked — replacement)' : '(from your search)'}
            </label>

            <div style={{
              background: 'rgb(var(--surface-rgb) / 0.7)',
              borderRadius: 16,
              padding: 14,
              border: '1px solid rgb(var(--primary-rgb) / 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>📅</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Date{finalAvailType === 'Repeat Days' ? 's' : ''}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    {finalAvailType === 'Repeat Days' && finalEnd && finalEnd !== finalStart
                      ? `${formatLocalDate(finalStart)} – ${formatLocalDate(finalEnd)}`
                      : formatLocalDate(finalStart)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>🕒</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Time</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    {finalStartTime} – {finalEndTime}
                  </div>
                </div>
              </div>

              {finalAvailType === 'Repeat Days' && finalDays && finalDays.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span>🔁</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Repeats On</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                      {finalDays.join(' · ')}
                    </div>
                  </div>
                </div>
              )}

              {finalAvailType !== 'Repeat Days' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>📌</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Type</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                      Single Day
                    </div>
                  </div>
                </div>
              )}

              {/* Surface the "creates N bookings" figure that the old editable
                  form computed, so the read-only view loses no information. */}
              {finalAvailType === 'Repeat Days' && finalDays.length > 0 && finalStart && finalEnd && (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                  🔁 Creates {countSelectedWeekdays(finalStart, finalEnd, finalDays)}{' '}
                  bookings ({finalDays.join(', ')}) between {finalStart} and {finalEnd}
                </p>
              )}

              {scheduleError && (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-error)' }}>
                  {scheduleError}
                </p>
              )}
            </div>
          </div>
          {/* Phase 10.0 — Step 3: task allocation. Hidden in the replacement
              flow, where the submit path invites a sitter to an EXISTING job
              and cannot change that job's allocation. Disabled until a child
              is selected so tasks never belong to an ambiguous booking, and
              disabled while a request is in flight. */}
          {!isReplacement && (
            <>
              <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Step 3: Today&apos;s Required Tasks</p>
              <AssignedTaskSelector
                selectedTasks={selectedTasks}
                onChange={setSelectedTasks}
                disabled={requesting || !(allChildrenSelected || selectedChildIds.length > 0)}
              />
            </>
          )}
          {/* Locked Booking Summary Card */}
          <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Step 4: Booking Summary</p>
          <div style={{ background: 'rgb(var(--surface-rgb) / 0.7)', borderRadius: 16, padding: 14, marginBottom: 20, border: '1px solid rgb(var(--primary-rgb) / 0.15)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: 'var(--color-text-muted)', marginBottom: 8 }}>BOOKING SUMMARY (LOCKED FROM YOUR SEARCH)</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span>📅</span>
              <div>
                <div style={{ fontWeight: 600 }}>Schedule</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {finalAvailType === 'One Day' ? finalStart : `${finalStart} → ${finalEnd}`}
                  {finalDays && finalDays.length > 0 ? ` · ${finalDays.join(', ')}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span>⏰</span>
              <div>
                <div style={{ fontWeight: 600 }}>Care Hours</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{finalStartTime} – {finalEndTime}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span>📍</span>
              <div>
                <div style={{ fontWeight: 600 }}>Location</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{finalAddress}</div>
              </div>
            </div>
            {/* Phase 10.0 — the task allocation is echoed in the summary so
                the parent reviews exactly what will be sent. Hidden in the
                replacement flow, which cannot change an existing job's tasks. */}
            {!isReplacement && (
              <div style={{ display: 'flex', gap: 10 }}>
                <span>✅</span>
                <div>
                  <div style={{ fontWeight: 600 }}>Required Tasks</div>
                  {summaryTasks.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>None requested</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                      {summaryTasks.map((task) => (
                        <div key={task.id} style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                          ✓ {task.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button type="button" disabled={requesting} onClick={() => setShowChildModal(false)} style={{ flex: 1, padding: '14px 24px', borderRadius: '999px', background: 'rgb(var(--surface-rgb) / 0.5)', color: 'var(--color-text-secondary)', fontWeight: 700, fontSize: '14px', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}>Cancel</button>
            <button type="button" disabled={requesting} onClick={handleConfirmBooking} style={{ flex: 1, padding: '14px 24px', borderRadius: '999px', background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary) 100%)', color: 'var(--color-text-inverse)', fontWeight: 700, fontSize: '14px', border: 'none', boxShadow: '0 8px 20px rgb(var(--primary-rgb) / 0.3)', cursor: requesting ? 'wait' : 'pointer', opacity: requesting ? 0.7 : 1, transition: 'all 0.2s ease' }}>{requesting ? 'Booking...' : 'Confirm & Send Request'}</button>
          </div>
        </div>
      </Modal>

      <ParentBottomNav />
    </div>
  );
}
