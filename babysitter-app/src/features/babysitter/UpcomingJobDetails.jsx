import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import UserAvatar from '../../components/ui/UserAvatar';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import styles from './upcoming-job-details.module.css';
import SeriesContractOverview from '../../components/series/SeriesContractOverview';

// Slot-id -> clock time map, mirroring JobDetails.jsx. Required because
// GET /api/jobs/jobdetails/{id} can return SlotIds without SlotTimes.
const SLOT_TIME_MAP = {
  1: { start: '08:00', end: '10:00' },
  2: { start: '10:00', end: '12:00' },
  3: { start: '12:00', end: '14:00' },
  4: { start: '14:00', end: '16:00' },
  5: { start: '16:00', end: '18:00' },
  6: { start: '18:00', end: '20:00' },
  7: { start: '20:00', end: '22:00' },
};

/** Ordered HH:MM slot list — SlotTimes when present, otherwise SlotIds. */
const resolveSlots = (job) => {
  const raw =
    Array.isArray(job?.SlotTimes) && job.SlotTimes.length > 0
      ? job.SlotTimes
          .map((s) => ({ start: s?.StartTime?.substring(0, 5), end: s?.EndTime?.substring(0, 5) }))
          .filter((s) => s.start)
      : Array.isArray(job?.SlotIds) && job.SlotIds.length > 0
      ? job.SlotIds.map((id) => SLOT_TIME_MAP[id]).filter(Boolean)
      : [];
  return raw.slice().sort((a, b) => a.start.localeCompare(b.start));
};

/**
 * Phase 8M: "I have reached — Notify Parent" is only meaningful when the sitter
 * is plausibly at the job site. Enabled from 1 hour before the earliest slot
 * through the end of the scheduled day.
 *
 * Slots are resolved through `resolveSlots` (SlotTimes, else SlotIds) because
 * GET /api/jobs/jobdetails/{id} can return SlotIds WITHOUT SlotTimes — reading
 * job.SlotTimes directly would report "no slots" and fall back to whole-day,
 * quietly opening the window an hour too early.
 *
 * A missing or unparseable JobDate returns true (do not block) so legacy rows
 * with no usable date keep the previous behaviour instead of locking the sitter
 * out of a booking they are standing in front of.
 *
 * All comparisons are local-time, matching formatCountdown() above — never UTC.
 */
const notifyWindowOpen = (job, slots, now = new Date()) => {
  if (!job?.JobDate) return true;
  const dayStart = new Date(job.JobDate);
  if (Number.isNaN(dayStart.getTime())) return true;

  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const list = Array.isArray(slots) ? slots : [];
  if (list.length === 0) {
    return now >= dayStart && now <= dayEnd;
  }

  const parseHM = (v) => {
    const [h, m] = String(v || '00:00').split(':').map(Number);
    return ((h || 0) * 60) + (m || 0);
  };
  const earliest = Math.min(...list.map((s) => parseHM(s?.start)));
  if (!Number.isFinite(earliest)) {
    return now >= dayStart && now <= dayEnd;
  }

  const windowOpen = new Date(dayStart);
  windowOpen.setHours(0, 0, 0, 0);
  windowOpen.setMinutes(earliest - 60);
  return now >= windowOpen && now <= dayEnd;
};

/** When the notify window opens, for the "Available on … from …" helper text. */
const notifyWindowOpensAt = (job, slots) => {
  if (!job?.JobDate) return null;
  const dayStart = new Date(job.JobDate);
  if (Number.isNaN(dayStart.getTime())) return null;

  const list = Array.isArray(slots) ? slots : [];
  if (list.length === 0) return dayStart;

  const parseHM = (v) => {
    const [h, m] = String(v || '00:00').split(':').map(Number);
    return ((h || 0) * 60) + (m || 0);
  };
  const earliest = Math.min(...list.map((s) => parseHM(s?.start)));
  if (!Number.isFinite(earliest)) return dayStart;

  const windowOpen = new Date(dayStart);
  windowOpen.setHours(0, 0, 0, 0);
  windowOpen.setMinutes(earliest - 60);
  return windowOpen;
};

/** "Real children list, falling back to the legacy single-child fields." */
const resolveChildren = (job) => {
  const list = job?.Children ?? job?.children;
  if (Array.isArray(list) && list.length > 0) return list;
  if (job?.ChildName) {
    return [
      { ChildName: job.ChildName, ChildAge: job.ChildAge, PictureAddress: job.PictureAddress },
    ];
  }
  return [];
};

const childCountLabel = (count) => {
  if (count <= 0) return 'No child profile attached';
  if (count === 1) return 'Caring for 1 child';
  return `Caring for ${count} children`;
};

/** "Starts in X hours Y minutes" from JobDate + the earliest slot start. */
const formatCountdown = (jobDate, startTime) => {
  if (!jobDate || !startTime) return null;
  const start = new Date(`${String(jobDate).substring(0, 10)}T${startTime}:00`);
  if (Number.isNaN(start.getTime())) return null;
  const diffMs = start.getTime() - Date.now();
  if (diffMs <= 0) return 'Starting now';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `Starts in ${minutes} minutes`;
  return `Starts in ${hours} hours ${minutes} minutes`;
};

const formatLongDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

/**
 * Phase 8D: is the sitter still allowed to decline this day?
 * D1 — a decline needs at least 3 hours of notice before the earliest slot.
 * Mirrors the server-side guard in JobService.DeclineDayAsync (which converts
 * to Pakistan time); this is only a UX pre-filter, the server is authoritative.
 */
const declineWindowOpen = (job) => {
  if (!job?.JobDate || !Array.isArray(job.SlotTimes) || job.SlotTimes.length === 0) return false;
  const minutes = job.SlotTimes
    .map((s) => String(s.StartTime || '').split(':').map(Number))
    .filter(([h]) => !Number.isNaN(h))
    .map(([h, m]) => (h || 0) * 60 + (m || 0));
  if (!minutes.length) return false;
  const earliest = Math.min(...minutes);
  const start = new Date(job.JobDate);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(earliest);
  return Date.now() < start.getTime() - 3 * 60 * 60 * 1000;
};

export default function UpcomingJobDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const { jobId } = useParams();
  const toast = useToast();

  const passedJob = location.state?.job;
  const numericJobId = jobId ? parseInt(jobId, 10) : passedJob?.Job_ID ?? passedJob?.jobId ?? null;

  const [job, setJob] = useState(passedJob ?? null);
  const [loading, setLoading] = useState(() => !passedJob && Boolean(numericJobId));
  const [error, setError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Phase 8D — "Notify Parent I Can't Come" (decline a single series day).
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState('');
  const [cancelError, setCancelError] = useState('');

  // Phase 5.2: this screen is API-driven. `location.state` (handed over by the
  // My Jobs list) is only a first-paint seed — the authoritative record is
  // re-fetched so a hard refresh or deep link still shows real data.
  useEffect(() => {
    if (!numericJobId) return undefined;

    let isMounted = true;
    (async () => {
      try {
        const data = await API.getJobDetails(numericJobId);
        if (isMounted && data) {
          setJob((prev) => ({ ...(prev ?? {}), ...data }));
          setError(null);
        }
      } catch (err) {
        if (isMounted && !passedJob) {
          setError(err?.message || 'Could not load this job.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passedJob is a first-paint seed only
  }, [numericJobId]);

  // D4: Escape closes the arrival modal (unless a start is already in flight).
  useEffect(() => {
    if (!confirmOpen && !showCancelConfirm) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !starting && !cancelling) {
        setConfirmOpen(false);
        setStartError('');
        setShowCancelConfirm(false);
        setCancelError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmOpen, starting, showCancelConfirm, cancelling]);

  // Workflow redesign: an "In Progress" session belongs on the live timer
  // screen — redirect there automatically once the job is loaded.
  useEffect(() => {
    const s = String(job?.Status ?? '').trim().toLowerCase();
    if (s === 'in progress' || s === 'inprogress') {
      navigate('/active-job-details', { state: { job } });
    }
  }, [job, navigate]);

  const closeModal = () => {
    if (starting) return;
    setConfirmOpen(false);
    setStartError('');
  };

  // D3: POST the arrival notice; the session does NOT start here anymore.
  // The parent confirms the session start from their side. Keep the modal
  // open on a conflict (400) so the sitter reads the reason and cannot spam
  // the backend with retry clicks.
  const confirmStart = async () => {
    const targetId = job?.Job_ID ?? numericJobId;
    if (!targetId) return;
    // Phase 8M: re-check the window at the moment of the actual mutation, not
    // just when the modal opened. The modal's confirm button only disables on
    // `starting`, so without this a stale modal could still post SitterArrived
    // for a day whose window is no longer open.
    if (!notifyWindowOpen(job, resolveSlots(job))) {
      setConfirmOpen(false);
      setStartError('That time window has closed. Please reopen this session.');
      return;
    }

    setStarting(true);
    setStartError('');

    try {
      await API.updateJobStatus(targetId, 'SitterArrived');
      setConfirmOpen(false);
      // Update the local copy so the screen switches to the Waiting state
      // (do NOT navigate away — the parent still has to start the session).
      setJob((prev) => ({ ...(prev ?? {}), Status: 'SitterArrived' }));
      toast.success('The parent has been notified that you have arrived.');
    } catch (err) {
      const message =
        (typeof err?.response?.data === 'string' && err.response.data) ||
        err?.response?.data?.message ||
        err?.message ||
        'Could not notify the parent. Please try again.';
      setStartError(String(message));
    } finally {
      setStarting(false);
    }
  };

  // Phase 8D — D3/D4: POST the decline. The day flips back to Open on the
  // server and both the parent and this sitter are notified there; this screen
  // only surfaces the outcome. On a 400 the modal closes and the reason is
  // shown inline so the sitter understands why (past the 3-hour window, or the
  // 3-declines-per-series cap).
  const confirmDecline = async () => {
    const targetId = job?.Job_ID ?? numericJobId;
    if (!targetId) return;

    setDeclining(true);
    setDeclineError('');

    try {
      const res = await API.declineDay(targetId);
      setDeclineOpen(false);
      toast.success(res?.message || 'Parent notified.');
      navigate('/babysitter-my-jobs');
    } catch (err) {
      const message =
        (typeof err?.response?.data === 'string' && err.response.data) ||
        err?.response?.data?.message ||
        err?.message ||
        'Could not notify the parent. Please try again.';
      setDeclineError(String(message));
      setDeclineOpen(false);
    } finally {
      setDeclining(false);
    }
  };

  // Workflow enhancement: the sitter can back out of the waiting state when
  // the parent never confirms the arrival (SitterArrived → Cancelled).
  const handleCancelJob = async () => {
    const targetId = job?.Job_ID ?? numericJobId;
    if (!targetId) return;

    setCancelling(true);
    setCancelError('');
    try {
      await API.updateJobStatus(targetId, 'Cancelled');
      toast.success('Booking cancelled. The parent has been notified.');
      navigate('/babysitter-my-jobs');
    } catch (err) {
      const message =
        (typeof err?.response?.data === 'string' && err.response.data) ||
        err?.response?.data?.message || err?.message ||
        'Could not cancel. Please try again.';
      setCancelError(String(message));
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.topBar}>
          <BackButton />
          <h1 className={styles.pageTitle}>Upcoming Session</h1>
        </div>
        <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center' }}>
          <LoadingSpinner size="lg" label="Loading session details..." />
        </div>
        <BabysitterBottomNav />
      </div>
    );
  }

  if (!job) {
    return (
      <div className={styles.container}>
        <div className={styles.topBar}>
          <BackButton />
          <h1 className={styles.pageTitle}>Upcoming Session</h1>
        </div>
        <EmptyState
          icon="📋"
          title="Session Not Found"
          description={error || "We couldn't retrieve the details for this session."}
        >
          <Button variant="primary" onClick={() => navigate('/babysitter-my-jobs')}>
            Back to My Jobs
          </Button>
        </EmptyState>
        <BabysitterBottomNav />
      </div>
    );
  }

  const slots = resolveSlots(job);
  const children = resolveChildren(job);
  const status = String(job.Status ?? '').trim().toLowerCase();
  const sessionRunning = status === 'in progress' || status === 'inprogress';
  // Workflow redesign: 'SitterArrived' = arrival confirmed, waiting for the
  // parent to start the session. No timer, no start button on this screen.
  const sitterArrived = status === 'sitterarrived';
  const canStart = !sitterArrived && !sessionRunning && (status === 'assigned' || status === 'confirmed');
  // Phase 8M: status alone lets a sitter notify arrival days early. Require the
  // date window too — one hour before the first slot through end of day.
  const notifyOpen = notifyWindowOpen(job, slots);
  const canNotify = canStart && notifyOpen;
  const notifyOpensAt = notifyOpen ? null : notifyWindowOpensAt(job, slots);

  const parentName = job.ParentName || 'Parent';
  // Phase 8N: the 📍 row is the JOB SITE, not the parent's home. The API
  // returns both (City = the booking location, ParentAddress = where the parent
  // lives) and they can be different cities entirely — showing ParentAddress
  // here sent sitters to the wrong place, while Get Directions below used the
  // job's own Latitude/Longitude and pointed at the right one. Prefer City, and
  // surface the parent's home as a secondary line only when the two differ.
  const jobCity = job.City || null;
  const parentHomeAddress = job.ParentAddress || null;
  const locationText = jobCity || parentHomeAddress || 'Address not provided';
  const showParentHomeLine =
    Boolean(parentHomeAddress) && Boolean(jobCity) && parentHomeAddress !== jobCity;
  const parentPhone = job.ParentPhone || null;
  const formattedDate = formatLongDate(job.JobDate);
  const slotWindow = slots.length > 0 ? `${slots[0].start} – ${slots[slots.length - 1].end}` : null;
  const countdownText = formatCountdown(job.JobDate, slots[0]?.start);
  const totalPayment = Number(job.Payment ?? 0);
  const hasCoords = Boolean(job.Latitude) && Boolean(job.Longitude);
  const directionsUrl = hasCoords
    ? `https://www.google.com/maps?q=${job.Latitude},${job.Longitude}`
    : null;

  return (
    <div className={styles.container}>
      {/* C1: sitter-centric header */}
      <div className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Upcoming Session</h1>
      </div>
      <p style={{ margin: '-8px 0 0', fontSize: 13, fontWeight: 600, color: 'var(--color-text-tertiary)' }}>
        Job #{job.Job_ID ?? numericJobId ?? '—'}
        {formattedDate ? ` · ${formattedDate}` : ''}
      </p>

      {/* Workflow redesign: green Waiting state after arrival is confirmed */}
      {sitterArrived && (
        <div
          role="status"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '20px 16px',
            borderRadius: 16,
            background: 'var(--color-success-tint)',
            border: '1.5px solid var(--color-success-border)',
            color: 'var(--color-success-strong)',
            fontSize: 14,
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 40, lineHeight: 1 }}>
            ✅
          </span>
          <span>
            You've notified {parentName}. Waiting for them to confirm and start the session.
          </span>
          <span
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              background: 'rgba(120, 120, 120, 0.18)',
              color: 'var(--color-text-secondary)',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Waiting…
          </span>
          <button
            type="button"
            onClick={() => setShowCancelConfirm(true)}
            style={{
              marginTop: 20,
              padding: '10px 16px',
              background: 'transparent',
              border: '1px solid var(--color-border-strong, #CBD5E1)',
              borderRadius: 12,
              color: 'var(--color-text-tertiary, #64748B)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            Cancel this booking
          </button>
        </div>
      )}

      {/* C2: the single dominant "prepare for session" card */}
      <div className={styles.parentCard}>
        <div className={styles.parentHeaderRow}>
          <UserAvatar src={job.ParentPic} name={parentName} size={60} type="Parents" className={styles.parentAvatar} />
          <div className={styles.parentMeta}>
            <h2 className={styles.parentName}>{parentName}</h2>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
              {countdownText || (sessionRunning ? 'Session in progress' : 'Scheduled session')}
            </span>
          </div>
        </div>

        <div className={styles.detailRow}>
          <div className={styles.detailLeft}>
            <span aria-hidden="true">📍</span>
            <span>Address</span>
          </div>
          <div style={{ textAlign: 'right', minWidth: 0, maxWidth: '58%' }}>
            <span className={styles.detailValue}>
              {locationText}
            </span>
            {showParentHomeLine && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Parent home: {parentHomeAddress}
              </div>
            )}
          </div>
        </div>

        <div className={styles.detailRow}>
          <div className={styles.detailLeft}>
            <span aria-hidden="true">📞</span>
            <span>Contact</span>
          </div>
          {parentPhone ? (
            <a
              href={`tel:${parentPhone}`}
              className={styles.detailValue}
              style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
            >
              {parentPhone}
            </a>
          ) : (
            <span className={styles.detailValue}>Not provided</span>
          )}
        </div>

        <div className={styles.detailRow}>
          <div className={styles.detailLeft}>
            <span aria-hidden="true">👶</span>
            <span>Children</span>
          </div>
          <span className={styles.detailValue}>{childCountLabel(children.length)}</span>
        </div>

        {children.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {children.map((child, idx) => {
              const name = child?.ChildName ?? child?.name ?? `Child ${idx + 1}`;
              const age = child?.ChildAge ?? child?.age;
              return (
                <div key={`${name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <UserAvatar src={child?.PictureAddress} name={name} size={34} type="Child" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                    {name}
                    {age ? ` · ${age}y` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.detailRow}>
          <div className={styles.detailLeft}>
            <span aria-hidden="true">💰</span>
            <span>Rate</span>
          </div>
          <span className={styles.earningsValue}>PKR {Number(totalPayment).toLocaleString()} total</span>
        </div>

        <div className={styles.detailRow}>
          <div className={styles.detailLeft}>
            <span aria-hidden="true">🕒</span>
            <span>Slot window</span>
          </div>
          <span className={styles.detailValue}>{slotWindow || 'Time not specified'}</span>
        </div>
      </div>

      <SeriesContractOverview job={job} />

      {/* C3: sticky actions */}
      <div className={styles.actionSection}>
        <button
          type="button"
          disabled={!canNotify}
          className={canNotify ? styles.startJobBtnActive : styles.startJobBtnDisabled}
          onClick={() => {
            if (!canNotify) return;
            setStartError('');
            setConfirmOpen(true);
          }}
        >
          {sitterArrived ? '✅ Notified — waiting for parent' : 'I have reached — Notify Parent'}
        </button>

        {directionsUrl && (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.messageBtn}
            style={{ textDecoration: 'none' }}
          >
            📍 Get Directions
          </a>
        )}

        {!canNotify && !sitterArrived && (
          <p className={styles.startJobHelper}>
            {!canStart
              ? (sessionRunning
                  ? 'This session is already running.'
                  : 'Available once the parent confirms this booking.')
              : // canStart is true but the date window has not opened yet.
                // Phase 8M: say WHEN it opens, so the sitter is not left
                // wondering why an otherwise-valid booking is blocked.
                (notifyOpensAt
                  ? `Available on ${notifyOpensAt.toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })} from ${notifyOpensAt.toLocaleTimeString([], {
                      hour: '2-digit', minute: '2-digit',
                    })}.`
                  : 'Available on the scheduled day.')}
          </p>
        )}

        {/* Phase 8D — D6: "Notify Parent I Can't Come".
            Gated on the same Assigned/Confirmed states the server accepts, plus
            the D1 3-hour notice window. The 3-declines-per-series cap (D5) is
            server-side only, so a rejection surfaces via declineError. */}
        {declineError && (
          <div
            role="alert"
            style={{
              marginBottom: 10,
              padding: '10px 12px',
              background: '#FEE2E2',
              color: '#991B1B',
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            {declineError}
          </div>
        )}

        {['assigned', 'confirmed'].includes(status) && declineWindowOpen(job) && (
          <button
            type="button"
            onClick={() => { setDeclineError(''); setDeclineOpen(true); }}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
              borderRadius: 12,
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            Notify Parent I Can&apos;t Come
          </button>
        )}
      </div>

      {/* D1/D2: full-screen arrival confirmation modal */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm your arrival"
          onClick={closeModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              borderRadius: 20,
              padding: 24,
              background: 'var(--color-surface)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ textAlign: 'center', fontSize: 40, lineHeight: 1 }} aria-hidden="true">
              ✅
            </div>
            <h2 style={{ margin: '12px 0 8px', fontSize: 19, fontWeight: 800, textAlign: 'center', color: 'var(--color-text)' }}>
              Confirm your arrival
            </h2>
            <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              Notifying the parent that you have arrived at {locationText}.
              They will confirm the session start shortly.
            </p>

            {startError && (
              <div
                role="alert"
                style={{
                  marginBottom: 14,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(220, 38, 38, 0.12)',
                  color: 'var(--color-error, #DC2626)',
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1.45,
                }}
              >
                {startError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                disabled={starting}
                className={styles.startJobBtnActive}
                style={{ opacity: starting ? 0.7 : 1, cursor: starting ? 'not-allowed' : 'pointer' }}
                onClick={confirmStart}
              >
                {starting ? 'Starting…' : "Yes, I'm here"}
              </button>
              <button
                type="button"
                disabled={starting}
                className={styles.startJobBtnDisabled}
                style={{ cursor: starting ? 'not-allowed' : 'pointer' }}
                onClick={closeModal}
              >
                Not yet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 8D — decline confirmation modal. Mirrors the cancel-booking
          modal structure below so the two dialogs look and behave identically. */}
      {declineOpen && (
        <div
          onClick={() => !declining && setDeclineOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFF', maxWidth: 380, width: '90%',
              padding: 24, borderRadius: 20,
              boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>
              Notify Parent You Can&apos;t Come?
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 14,
                        color: 'var(--color-text-secondary, #475569)',
                        lineHeight: 1.5 }}>
              This will release {formatLongDate(job?.JobDate) || 'this day'} from your
              series. The parent will be notified and can book a replacement.
              The rest of the series stays booked.
            </p>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={declining}
                onClick={() => setDeclineOpen(false)}
                style={{
                  flex: 1, padding: 12, borderRadius: 12,
                  background: 'transparent',
                  border: '1px solid var(--color-border-strong, #CBD5E1)',
                  color: 'var(--color-text-primary, #0F172A)',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Never mind
              </button>
              <button
                type="button"
                disabled={declining}
                onClick={confirmDecline}
                style={{
                  flex: 1, padding: 12, borderRadius: 12,
                  background: declining ? '#93C5FD' : 'var(--color-primary, #2563EB)',
                  color: '#FFF', border: 'none',
                  fontSize: 14, fontWeight: 700,
                  cursor: declining ? 'not-allowed' : 'pointer',
                }}
              >
                {declining ? 'Notifying…' : 'Yes, notify parent'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel-booking confirmation modal (waiting-state self-cancel) */}
      {showCancelConfirm && (
        <div
          onClick={() => !cancelling && setShowCancelConfirm(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFF', maxWidth: 380, width: '90%',
              padding: 24, borderRadius: 20,
              boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>
              Cancel this booking?
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 14,
                        color: 'var(--color-text-secondary, #475569)',
                        lineHeight: 1.5 }}>
              The parent will be notified that you could not wait for
              their confirmation. You will not be able to reopen this
              booking once cancelled.
            </p>

            {cancelError && (
              <div style={{
                marginBottom: 16, padding: '10px 12px',
                background: '#FEE2E2', color: '#991B1B',
                borderRadius: 10, fontSize: 13,
              }}>
                {cancelError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => setShowCancelConfirm(false)}
                style={{
                  flex: 1, padding: 12, borderRadius: 12,
                  background: 'transparent',
                  border: '1px solid var(--color-border-strong, #CBD5E1)',
                  color: 'var(--color-text-primary, #0F172A)',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Stay
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancelJob}
                style={{
                  flex: 1, padding: 12, borderRadius: 12,
                  background: cancelling ? '#FCA5A5' : '#DC2626',
                  color: '#FFF', border: 'none',
                  fontSize: 14, fontWeight: 700,
                  cursor: cancelling ? 'not-allowed' : 'pointer',
                }}
              >
                {cancelling ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BabysitterBottomNav />
    </div>
  );
}
