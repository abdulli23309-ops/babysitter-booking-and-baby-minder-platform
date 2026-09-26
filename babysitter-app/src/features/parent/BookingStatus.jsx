import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import UserAvatar from '../../components/ui/UserAvatar';
import { useToast } from '../../components/ui/ToastContext';
import { apiGet, apiPost } from '../../services/apiClient';
import { API } from '../../services/api';
import { useAuth } from '../auth/AuthContext';
import styles from './booking-status.module.css';
import SeriesPaginationBar from '../../components/series/SeriesPaginationBar';
import SeriesContractOverview from '../../components/series/SeriesContractOverview';
import SeriesRollup from '../../components/series/SeriesRollup';
import { isSeriesTerminal } from '../../utils/seriesStatus';
const formatChildren = (job) => {
  const list = job?.Children ?? job?.children ?? [];
  if (list.length === 0) {
    return job?.ChildName ? `👶 Caring for: ${job.ChildName}` : '';
  }
  if (list.length === 1) {
    return `👶 Caring for: ${list[0].ChildName}`;
  }
  return `👶 Caring for ${list.length} children: ${list.map(c => c.ChildName).join(', ')}`;
};

// Status badge lookup. Keys are normalised (lowercased, whitespace/underscore/
// hyphen stripped) so 'In Progress', 'InProgress' and 'in-progress' all match,
// and 'Cancelled' / 'CANCELED' both resolve to the grey Cancelled badge.
const STATUS_BADGES = {
  open: { label: 'Waiting for Babysitter Confirmation', color: 'orange', icon: '⏳' },
  assigned: { label: 'Sitter Confirmed — Awaiting Start', color: 'blue', icon: '✅' },
  confirmed: { label: 'Sitter Confirmed — Awaiting Start', color: 'blue', icon: '✅' },
  sitterarrived: { label: 'Babysitter Has Arrived', color: 'orange', icon: '🟠' },
  inprogress: { label: 'Session In Progress', color: 'green', icon: '🟢' },
  completed: { label: 'Completed', color: 'rgba(34, 197, 94, 0.7)', icon: '🎉' },
  cancelled: { label: 'Cancelled', color: 'grey', icon: '❌' },
  canceled: { label: 'Cancelled', color: 'grey', icon: '❌' },
};

const getStatusBadge = (status) => {
  const raw = (status ?? '').toString().trim();
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');

  // Unknown / unmapped statuses fall through to grey with the RAW status text.
  // Never assume 'Open' — that produced a false "Waiting for Babysitter
  // Confirmation" badge for cancelled jobs whose status did not arrive.
  return STATUS_BADGES[key] ?? { label: raw || 'Unknown', color: 'grey', icon: '❓' };
};

export default function BookingStatus() {
  const { jobId: routeJobId } = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isSeriesHistory = searchParams.get('series') === 'history';
  const navigate = useNavigate();
  const toast = useToast();
  const { role, userId } = useAuth();

  // Phase 8E: the URL is the single source of truth for which day is on screen.
  // Derived from the route param rather than held in state, so paging with
  // navigate() re-renders with a new activeJobId, the fetch effect below re-runs
  // for the new day, and a refresh / bookmark / share lands on the same day
  // instead of snapping back to Day 1.
  const activeJobId = routeJobId != null ? Number(routeJobId) : null;
  // Phase 8E: the auto-jump to the latest completed day must fire ONCE, on the
  // initial anchor. Previously the guard compared activeJobId to routeJobId,
  // which stopped it re-firing after the user paged away. With activeJobId now
  // derived from routeJobId that comparison is always true, so the guard would
  // never stop the jump — remember the first id instead.
  const anchorJobIdRef = useRef(routeJobId);
  const [job, setJob] = useState(null);
  const [siblings, setSiblings] = useState([]);
  // Phase 8c Feature 3: the UNFILTERED list of every day in the series.
  // `siblings` is pre-filtered to completed/cancelled days for the pagination
  // bar, so it cannot answer "is the whole series finished?" — testing that
  // against it would always say yes, and the rollup would list only the
  // terminal subset instead of every day.
  const [seriesDays, setSeriesDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [startError, setStartError] = useState('');
  const [jobReviews, setJobReviews] = useState([]);

  useEffect(() => {
    let ignore = false;
    async function fetchJob() {
      try {
        setLoading(true);
        const data = await apiGet(`/parent/job/${activeJobId}`);
        if (!ignore) {
          if (isSeriesHistory && data?.JobSeries_ID && siblings.length === 0) {
             // Phase 8D: read the whole series from the shared endpoint so this
             // screen and the sitter's CompletedJobDetails paginate over an
             // identical sibling list. Previously the parent pulled every one of
             // their own jobs and filtered client-side, which is more data and
             // could drift from the sitter's view.
             const allSeriesJobs = await API.getSeriesJobs(data.JobSeries_ID);
             const list = Array.isArray(allSeriesJobs) ? allSeriesJobs : [];
             // Phase 8c Feature 3: keep the full series for the rollup + the
             // terminal check; `siblings` stays terminal-only for pagination.
             setSeriesDays(list);
             const s = list
               .filter(j => {
                 const st = String(j.Status || '').toLowerCase();
                 return st === 'completed' || st === 'cancelled' || st === 'canceled';
               })
               .sort((a,b) => new Date(a.JobDate || 0) - new Date(b.JobDate || 0));
             setSiblings(s);
             // Phase 8E: fire the jump only while the URL still shows the ORIGINAL
             // anchor. Comparing against anchorJobIdRef (not routeJobId) keeps
             // this one-shot: once the user pages to another day the URL no
             // longer matches the anchor, so we stop redirecting them.
             if (s.length > 0 && String(routeJobId) === String(anchorJobIdRef.current)) {
                const latest = s[s.length - 1];
                const latestId = Number(latest.Job_ID ?? latest.jobId);
                if (Number.isFinite(latestId) && latestId !== activeJobId) {
                   navigate(`/booking-status/${latestId}?series=history`);
                   return; // the new route drives a fresh fetch
                }
             }
          }
          setJob(data);
        }
      } catch (err) {
        if (!ignore) {
          const message = err?.response?.data?.message || err?.message || 'Could not load booking details.';
          toast.error(message);
          navigate('/my-jobs');
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    if (activeJobId) fetchJob();
    return () => { ignore = true; };
  }, [activeJobId, navigate, toast, isSeriesHistory, siblings.length, routeJobId, userId]);

  // Workflow redesign (Option A): once the session is In Progress, this
  // screen hands over to the live session view.
  useEffect(() => {
    const s = (job?.Status || '').toString().trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (s === 'inprogress') {
      navigate('/parent-active-job', { state: { job } });
    }
  }, [job, navigate]);

  // Phase 6.1 mutual reviews: only a completed session has reviews to show.
  const reviewJobId = job?.Job_ID ?? activeJobId;
  const isCompleted = (job?.Status || '').toString().trim().toLowerCase().replace(/[\s_-]+/g, '') === 'completed';

  useEffect(() => {
    if (!reviewJobId || !isCompleted) return undefined;

    let isMounted = true;
    (async () => {
      try {
        const data = await API.getReviewsForJob(reviewJobId);
        if (isMounted) setJobReviews(Array.isArray(data) ? data : []);
      } catch {
        // No reviews yet is a valid state — render the empty placeholders.
        if (isMounted) setJobReviews([]);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [reviewJobId, isCompleted]);

  // Workflow redesign: the parent confirms the sitter's arrival and starts
  // the session. 400 responses (conflict guards) show as a red banner.
  const handleStartSession = async () => {
    const targetId = job?.Job_ID ?? activeJobId;
    if (!targetId) return;

    setStarting(true);
    setStartError('');
    try {
      await apiPost(`/jobs/updateStatus/${targetId}`, { Status: 'In Progress' });
      toast.success('Session started!');
      navigate(`/parent-active-job/${targetId}`, { state: { job } });
    } catch (err) {
      const message =
        (typeof err?.response?.data === 'string' && err.response.data) ||
        err?.response?.data?.message ||
        err?.message ||
        'Could not start the session. Please try again.';
      setStartError(String(message));
    } finally {
      setStarting(false);
    }
  };

  const handleCancelJob = async () => {
    const targetId = job?.Job_ID ?? activeJobId;
    if (!targetId) return;

    setCancelling(true);
    try {
      await apiPost(`/jobs/updateStatus/${targetId}`, { Status: 'Cancelled' });
      toast.info('Booking has been cancelled.');
      navigate('/my-jobs');
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not cancel the booking.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--gradient-auth-pastel)' }}>
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', background: 'var(--gradient-auth-pastel)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--color-text)' }}>Booking Not Found</h2>
        <p style={{ margin: '8px 0 24px', color: 'var(--color-text-tertiary)' }}>We couldn't find details for this booking.</p>
        <button
          type="button"
          onClick={() => navigate('/my-jobs')}
          style={{ padding: '12px 24px', borderRadius: 999, border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          Back to My Jobs
        </button>
      </div>
    );
  }

  // Source of truth for the badge. Do NOT coerce a missing/blank status into
  // 'Open' — that default was the reason a Cancelled job could render the
  // orange "Waiting for Babysitter Confirmation" badge.
  const currentStatus = (job.Status || '').toString().trim();
  const badge = getStatusBadge(currentStatus);
  // Workflow redesign: 'SitterArrived' = sitter on-site, parent must confirm.
  const sitterArrived = currentStatus.toLowerCase() === 'sitterarrived';

  // Phase 8G: a series day with no assigned sitter — either it was never hired
  // (plain Open) or a sitter declined it (Open with CancellationReason =
  // 'Sitter unavailable'). Both need a CTA to find someone for THAT day.
  // A single-day booking is deliberately excluded: it never had a series to
  // break, and the parent's own booking flow already covers it.
  const isSeriesDay =
    job?.JobSeries_ID != null || (job?.SeriesTotalCount ?? 0) > 1;

  const wasDeclined = isSeriesDay
    && currentStatus.toLowerCase() === 'open'
    && String(job?.CancellationReason || '')
        .toLowerCase().includes('sitter unavailable');

  const isOpenSeriesDay = isSeriesDay
    && (currentStatus.toLowerCase() === 'open'
        || currentStatus.toLowerCase() === 'pending');

  // Phase 8G: a declined day is not merely "waiting for confirmation" — the
  // sitter has explicitly backed out, so the badge must say so and point at
  // the recovery action. Every other status keeps the existing badge.
  const badgeLabelOverride = wasDeclined
    ? 'Sitter Unavailable — Find Replacement'
    : badge.label;

  const badgeSubtextOverride = wasDeclined
    ? 'This sitter can no longer make this day. Search for a replacement.'
    : null;

  // A real sitter is shown only when one is actually assigned with a real name.
  // Never render fake placeholders like 'Assigned Babysitter' / 'Unknown' / 'Caregiver'.
  const rawSitterName = job.SitterName ?? job.sitterName ?? null;
  const hasSitter = job.AssignedSitter_ID != null
    && rawSitterName
    && rawSitterName !== 'Unknown'
    && rawSitterName !== 'Assigned Babysitter';

  // Phase 6.1 mutual reviews — the parent authors the 'Parent' review.
  const normalizedRole = (role || '').toLowerCase();
  const isSitter = normalizedRole === 'sitter' || normalizedRole === 'babysitter';
  const yourRole = isSitter ? 'Sitter' : 'Parent';
  const theirRole = isSitter ? 'Parent' : 'Sitter';
  // Phase 8B parity: actual session times, so the parent history screen shows
  // what the sitter's Job Summary already showed.
  const careSlots = Array.isArray(job.SlotTimes) ? job.SlotTimes : [];
  const careTimeRange = careSlots.length > 0
    ? `${String(careSlots[0].StartTime || '').slice(0, 5)} - ${String(careSlots[careSlots.length - 1].EndTime || '').slice(0, 5)}`
    : ((job.StartTime || job.EndTime)
      ? `${String(job.StartTime || '').slice(0, 5)} - ${String(job.EndTime || '').slice(0, 5)}`
      : 'Full Session');

  const sessionStartedAt = job.SessionStartedAt ?? null;
  const sessionEndedAt = job.SessionEndedAt ?? null;
  const fmtClock = (v) => v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const workedHours = (sessionStartedAt && sessionEndedAt)
    ? ((new Date(sessionEndedAt).getTime() - new Date(sessionStartedAt).getTime()) / 36e5)
        .toFixed(2).replace(/\.00$/, '')
    : null;
  const sessionLabel = fmtClock(sessionStartedAt)
    ? `${fmtClock(sessionStartedAt)} — ${fmtClock(sessionEndedAt) ?? '—'}`
      + (workedHours != null ? ` · ${workedHours} hours worked` : '')
    : '';

  const yourReview = jobReviews.find((r) => r.ReviewerRole === yourRole);
  const theirReview = jobReviews.find((r) => r.ReviewerRole === theirRole);

  // Phase 8c Feature 3: show the whole-series rollup once every day is
  // terminal. Requires siblings to be loaded, so a non-history visit (where
  // siblings are never fetched) keeps the per-day layout.
  const isSeriesComplete =
    job?.JobSeries_ID != null
    && Array.isArray(seriesDays)
    && seriesDays.length > 0
    && isSeriesTerminal(job, seriesDays);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gradient-auth-pastel)', paddingBottom: 100 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <BackButton />
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--color-text)', flex: 1, textAlign: 'center' }}>Booking Status</h1>
          <div style={{ width: 40 }} />
        </div>
        {/* Phase 8c Feature 3: once every day in the series is terminal, the
            whole booking is readable at a glance, so swap the one-day-at-a-time
            layout (hero, sitter card, contract overview, pagination bar, care
            schedule, per-day CTAs) for the series rollup. The header above and
            the Session Feedback card below stay outside the branch. */}
        {isSeriesComplete ? (
          <SeriesRollup job={job} siblings={seriesDays} viewer="parent" />
        ) : (
          <>

        <div style={{ background: 'var(--color-surface)', borderRadius: 24, padding: 24, marginBottom: 16, boxShadow: '0 8px 24px rgb(var(--info-rgb) / 0.08)', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{badge.icon}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: badge.color, marginBottom: 4 }}>{badgeLabelOverride}</div>
          {badgeSubtextOverride && (
            <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>
              {badgeSubtextOverride}
            </p>
          )}
          <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Job #{job.Job_ID ?? activeJobId} · {job.ChildName ?? 'Child'}</div>
          {formatChildren(job) && (
            <p style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>
              {formatChildren(job)}
            </p>
          )}
        </div>
        <div style={{ background: 'var(--color-surface)', borderRadius: 20, padding: 16, marginBottom: 16, boxShadow: '0 4px 16px rgb(var(--ink-rgb) / 0.04)', border: '1px solid var(--color-border-subtle)' }}>
          {hasSitter ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <UserAvatar src={job.SitterPicture} name={job.SitterName} size={56} type="Sitters" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{job.SitterName}</div>
                {job.SitterPhone && (
                  <a href={`tel:${job.SitterPhone}`} style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600, marginTop: 2, display: 'inline-block' }}>
                    📞 {job.SitterPhone}
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.noSitterPlaceholder}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
              </svg>
              <span>{currentStatus.toLowerCase() === 'cancelled' || currentStatus.toLowerCase() === 'canceled' ? 'No sitter was assigned' : 'No sitter assigned yet'}</span>
            </div>
          )}
        </div>

        <SeriesContractOverview job={job} siblings={siblings} />
        {isSeriesHistory && siblings.length > 0 && (
          <SeriesPaginationBar
            currentIndex={siblings.findIndex(
              s => String(s.Job_ID ?? s.jobId) === String(activeJobId)
            )}
            totalCount={siblings.length}
            onPrev={() => {
              const idx = siblings.findIndex(
                s => String(s.Job_ID ?? s.jobId) === String(activeJobId)
              );
              if (idx > 0) {
                const prev = siblings[idx - 1];
                navigate(`/booking-status/${prev.Job_ID ?? prev.jobId}?series=history`);
              }
            }}
            onNext={() => {
              const idx = siblings.findIndex(
                s => String(s.Job_ID ?? s.jobId) === String(activeJobId)
              );
              if (idx >= 0 && idx < siblings.length - 1) {
                const next = siblings[idx + 1];
                navigate(`/booking-status/${next.Job_ID ?? next.jobId}?series=history`);
              }
            }}
          />
        )}

        {/* Phase 8C: /parent-upcoming-job (ParentUpcomingJobScreen) was routed in
            App.jsx but had ZERO callers, so the parent could never reach its
            "Start Session Now" / "Cancel Booking" actions. Offer it on an
            Assigned/Confirmed booking, which is exactly the state that screen
            is designed for. */}
        {(currentStatus.toLowerCase() === 'assigned'
          || currentStatus.toLowerCase() === 'confirmed') && (
          <button
            type="button"
            onClick={() => navigate('/parent-upcoming-job', { state: { job } })}
            style={{
              width: '100%',
              padding: '14px 18px',
              borderRadius: 18,
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-text-inverse)',
              fontWeight: 800,
              fontSize: 15,
              cursor: 'pointer',
              boxShadow: '0 6px 18px rgb(var(--primary-rgb) / 0.25)',
              marginBottom: 12,
            }}
          >
            Manage Session →
          </button>
        )}

        {/* Phase 8G (C + A): ANY series day with no sitter needs a way to find
            one for that day — either it was declined (→ "Find Replacement") or
            it is simply still un-hired (→ "Find a Sitter for This Day"). The
            stored search is scoped to THIS day's date + slots; SearchBabySitter
            hydrates its form from lastBookingSearch on mount. */}
        {isOpenSeriesDay && (
          <button
            type="button"
            onClick={() => {
              // Phase 8I: derive the window from the job's REAL slots. The old
              // code read slots[0].StartTime and fell back to a 9-hour
              // '08:00 AM'–'05:00 PM' default, so a parent with no SlotTimes in
              // the response got a search far wider than the booking.
              const rawSlots = Array.isArray(job.SlotTimes) ? job.SlotTimes
                : Array.isArray(job.slots) ? job.slots
                : [];
              const parsedSlots = rawSlots
                .map((s) => {
                  const start = String(s?.StartTime || s?.start || '').slice(0, 5);
                  const end = String(s?.EndTime || s?.end || '').slice(0, 5);
                  if (!start && !end) return null;
                  return { start, end };
                })
                .filter(Boolean);

              let startTime = '';
              let endTime = '';
              if (parsedSlots.length > 0) {
                // Earliest slot start, latest slot end — the actual booked window.
                const sortedByStart = [...parsedSlots].sort((a, b) => a.start.localeCompare(b.start));
                startTime = sortedByStart[0].start;
                const allEnds = parsedSlots.map((s) => s.end).filter(Boolean).sort();
                endTime = allEnds[allEnds.length - 1] || '';
              }
              // Fallback: the job's own scalar StartTime / EndTime.
              if (!startTime && job.StartTime) startTime = String(job.StartTime).slice(0, 5);
              if (!endTime && job.EndTime) endTime = String(job.EndTime).slice(0, 5);
              // Last resort: keep the old defaults so the search still fires.
              if (!startTime) startTime = '08:00';
              if (!endTime) endTime = '17:00';

              // Job location — required for radius filtering AND for centring
              // the search map on the booking site rather than on the parent's
              // saved home. Strictly numeric so an empty string never becomes 0.
              const jobLat = typeof job.Latitude === 'number' ? job.Latitude
                : typeof job.latitude === 'number' ? job.latitude
                : null;
              const jobLng = typeof job.Longitude === 'number' ? job.Longitude
                : typeof job.longitude === 'number' ? job.longitude
                : null;

              try {
                localStorage.setItem('lastBookingSearch', JSON.stringify({
                  StartDate: job.JobDate,
                  EndDate: job.JobDate,
                  // HH:mm (24-hour). readStoredSearch().toTwelveHour() normalises
                  // this to the form's 12-hour state on read.
                  StartTime: startTime,
                  EndTime: endTime,
                  SelectedDays: [],
                  AvailabilityType: 'One Day',
                  City: job.City || '',
                  // Phase 8I: drop the rating filter for the auto-search. The
                  // parent's stored MinRating (default 4) silently excluded most
                  // sitters and made the CTA return []. Date/time/city are kept
                  // intact — the parent still needs THIS slot in THIS city.
                  MinRating: 0,
                  Latitude: jobLat,
                  Longitude: jobLng,
                  // Phase 8H: SearchBabySitter fires the search once on arrival
                  // and immediately strips this flag, so a later manual visit to
                  // the same screen does not re-fire.
                  autoSearch: true,
                  // Phase 8K: tells the booking modal to INVITE the picked sitter
                  // to THIS existing job rather than create a brand-new one. A
                  // replacement must land on the declined day, not a duplicate.
                  targetJobId: job.Job_ID,
                }));
              } catch { /* storage full or unavailable */ }
              navigate('/search-babysitter');
            }}
            style={{
              width: '100%',
              padding: '14px 18px',
              borderRadius: 18,
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-text-inverse)',
              fontWeight: 800,
              fontSize: 15,
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            {wasDeclined ? 'Find Replacement →' : 'Find a Sitter for This Day →'}
          </button>
        )}

        {/* Workflow redesign: SitterArrived banner — parent must confirm */}
        {sitterArrived && (
          <div
            style={{
              background: 'var(--color-surface)',
              borderRadius: 20,
              padding: 20,
              marginBottom: 16,
              border: '1.5px solid rgba(234, 88, 12, 0.35)',
              boxShadow: '0 4px 16px rgb(var(--ink-rgb) / 0.04)',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(234, 88, 12, 0.15)',
                color: '#EA580C',
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              🟠 Babysitter Has Arrived
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              {job.SitterName || 'Your babysitter'} has reached your location at {job.City || 'your address'}.
              Please confirm the arrival to start the session.
            </p>
          </div>
        )}

        {/* Workflow redesign: primary "Start Session" action */}
        {sitterArrived && (
          <button
            type="button"
            disabled={starting}
            onClick={handleStartSession}
            style={{
              width: '100%',
              padding: '14px 18px',
              borderRadius: 18,
              border: 'none',
              background: starting ? 'rgba(22, 163, 74, 0.6)' : 'var(--color-success-strong, #16A34A)',
              color: 'var(--color-text-inverse)',
              fontWeight: 800,
              fontSize: 15,
              cursor: starting ? 'not-allowed' : 'pointer',
              boxShadow: '0 6px 18px rgba(22, 163, 74, 0.25)',
              marginBottom: 12,
            }}
          >
            {starting ? 'Starting…' : '▶ Start Session'}
          </button>
        )}
        {sitterArrived && (
          <button
            type="button"
            disabled={cancelling}
            onClick={handleCancelJob}
            style={{
              width: '100%',
              padding: '12px 18px',
              borderRadius: 18,
              border: '1.5px solid var(--color-border-subtle)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              fontWeight: 700,
              fontSize: 14,
              cursor: cancelling ? 'not-allowed' : 'pointer',
              marginBottom: 16,
            }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel Job'}
          </button>
        )}
        {startError && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 14,
              background: 'rgba(220, 38, 38, 0.12)',
              color: 'var(--color-error, #DC2626)',
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1.45,
            }}
          >
            {startError}
          </div>
        )}

        <div style={{ background: 'var(--color-surface)', borderRadius: 20, padding: 20, boxShadow: '0 4px 16px rgb(var(--ink-rgb) / 0.04)', border: '1px solid var(--color-border-subtle)', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 14 }}>Booking Details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {job.Title && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span>📝</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>Title</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{job.Title}</div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>📅</span>
              <div>
                <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>Date</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                  {job.JobDate
                    ? new Date(job.JobDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                    : 'Date to be confirmed'}
                </div>
              </div>
            </div>
            {careTimeRange && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>🕒</span>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>Time</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{careTimeRange}</div>
                </div>
              </div>
            )}
            {sessionStartedAt && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span>⏱️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>Session</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{sessionLabel}</div>
                </div>
              </div>
            )}
            {job.City && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>📍</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>City</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{job.City}</div>
                </div>
                {job.Latitude != null && job.Longitude != null && (
                  <a
                    href={`https://www.google.com/maps?q=${job.Latitude},${job.Longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--color-primary)',
                      textDecoration: 'none',
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: 'var(--color-primary-tint)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Directions →
                  </a>
                )}
              </div>
            )}
            {job.Payment != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>💰</span>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>Session Amount</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-success-strong)' }}>PKR {Number(job.Payment).toLocaleString()}</div>
                </div>
              </div>
            )}
            {job.JobSeries_ID != null && job.SeriesTotalPayment != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>🧾</span>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>
                    {job.SeriesOccurrenceIndex != null && job.SeriesTotalCount != null
                      ? `Series Total · Day ${job.SeriesOccurrenceIndex} of ${job.SeriesTotalCount}`
                      : 'Series Total'}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>PKR {Number(job.SeriesTotalPayment).toLocaleString()}</div>
                </div>
              </div>
            )}
            {Array.isArray(job.Children) && job.Children.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span>👶</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>
                    {job.Children.length === 1 ? 'Child' : `Children (${job.Children.length})`}
                  </div>
                  {job.Children.map((c, idx) => (
                    <div key={c.Child_ID ?? idx} style={{ fontSize: 13, color: 'var(--color-text)', marginTop: idx === 0 ? 2 : 4 }}>
                      <span style={{ fontWeight: 600 }}>{c.ChildName}</span>
                      {c.ChildAge != null && <span style={{ color: 'var(--color-text-muted)' }}> · {c.ChildAge}y</span>}
                      {c.SpecialRequirements && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>
                          ⚠️ {c.SpecialRequirements}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : job.ChildName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>👶</span>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 600 }}>Child</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{job.ChildName}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Parent-side live tracking entry point — only while the session runs.
            Deliberately read-only status info otherwise (no sitter-side actions). */}
        {(currentStatus.toLowerCase() === 'in progress' || currentStatus.toLowerCase() === 'inprogress') && (
          <button
            type="button"
            onClick={() => navigate('/parent-active-job', { state: { job } })}
            style={{
              width: '100%',
              padding: '14px 18px',
              borderRadius: 18,
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-text-inverse)',
              fontWeight: 700,
              fontSize: 15,
              cursor: 'pointer',
              boxShadow: '0 6px 18px rgb(var(--primary-rgb) / 0.25)',
            }}
          >
            Track Live Session →
          </button>
        )}
          </>
        )}

        {/* Phase 6.1: Session Feedback — only a completed session has mutual
            reviews, so the card is gated on the status as well as the fetch. */}
        {isCompleted && (
          <div className={styles.reviewsCard}>
            <h3 className={styles.reviewsHeading}>Session Feedback</h3>

            <div className={styles.reviewBlock}>
              <div className={styles.reviewHeader}>
                <span className={styles.reviewWho}>Their Review</span>
                {theirReview ? (
                  <span className={styles.reviewStars}>
                    {'★'.repeat(Math.round(theirReview.Rating))}
                    {'☆'.repeat(5 - Math.round(theirReview.Rating))}
                  </span>
                ) : null}
              </div>
              <p className={styles.reviewText}>
                {theirReview?.Comment
                  ? theirReview.Comment
                  : <em>No review left yet.</em>}
              </p>
            </div>

            <div className={styles.reviewBlock}>
              <div className={styles.reviewHeader}>
                <span className={styles.reviewWho}>Your Review</span>
                {yourReview ? (
                  <span className={styles.reviewStars}>
                    {'★'.repeat(Math.round(yourReview.Rating))}
                    {'☆'.repeat(5 - Math.round(yourReview.Rating))}
                  </span>
                ) : null}
              </div>
              <p className={styles.reviewText}>
                {yourReview?.Comment
                  ? yourReview.Comment
                  : <em>You haven&apos;t left a review for this session.</em>}
              </p>
            </div>
          </div>
        )}
      </div>
      <ParentBottomNav />
    </div>
  );
}