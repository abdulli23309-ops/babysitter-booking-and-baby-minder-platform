import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import UserAvatar from '../../components/ui/UserAvatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { apiGet } from '../../services/apiClient';
import API from '../../services/api';
import { groupJobsBySeries, seriesStatusLabel } from '../../utils/seriesGrouping';
import SeriesCard from '../parent/SeriesCard';
import styles from './babysitter-jobs.module.css';

// Every tab renders most-recent-first: JobDate DESC, then Job_ID DESC.

// Every tab renders most-recent-first: JobDate DESC, tie-broken by Job_ID DESC.
// Copies the list, so React state is never mutated in place.
const sortByJobDateDesc = (list) =>
  [...list].sort((a, b) => {
    const da = a.JobDate ? new Date(a.JobDate).getTime() : 0;
    const db = b.JobDate ? new Date(b.JobDate).getTime() : 0;
    if (db !== da) return db - da;
    return (b.Job_ID ?? 0) - (a.Job_ID ?? 0);
  });

/**
 * Phase 9 fix — job status must be compared case/whitespace-insensitively.
 *
 * The API returns the live status as "InProgress" (no space) for a running
 * session, but this screen bucketed and routed on the literal "In Progress".
 * An in-progress job therefore matched NEITHER the Active bucket ("In Progress")
 * NOR History (completed/cancelled only), so the sitter's Active Jobs tab read
 * 0 and their running session was unreachable from My Jobs.
 *
 * Uses the same convention as MyJobsScreen: trim, lowercase and strip
 * spaces/underscores/hyphens, so "In Progress", "InProgress" and "in-progress"
 * all compare equal.
 */
const normalizeJobStatus = (status) =>
  String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const ACTIVE_JOB_STATUSES = new Set(['inprogress', 'sitterarrived']);
const UPCOMING_JOB_STATUSES = new Set(['assigned', 'confirmed']);
const HISTORY_JOB_STATUSES = new Set(['completed', 'cancelled', 'canceled']);

// Multi-child support: render the real child list from job.Children, falling
// back to the legacy single-child ChildName/ChildAge columns when absent.
const formatChildrenCard = (job) => {
  const list = job?.Children ?? job?.children ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    return job?.ChildName
      ? `${job.ChildName}${job.ChildAge ? ` (${job.ChildAge}y)` : ''}`
      : 'Child';
  }
  if (list.length === 1) {
    const c = list[0];
    return `${c.ChildName ?? 'Child'}${c.ChildAge != null ? ` (${c.ChildAge}y)` : ''}`;
  }
  return `${list.length} children: ${list.map((c) => c.ChildName ?? 'Child').join(', ')}`;
};

export default function BabysitterMyJobs() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const toast = useToast();

  const [selectedTab, setSelectedTab] = useState('active');
  const [jobs, setJobs] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(userId));

  const fetchJobs = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const data = await apiGet(`/jobs/sitter/${userId}`);
      setJobs(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Could not load your assigned jobs.');
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!userId) {
        setLoading(false);
        return;
      }
      try {
        const data = await apiGet(`/jobs/sitter/${userId}`);
        if (!ignore) {
          setJobs(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!ignore) {
          toast.error('Could not load your assigned jobs.');
          setJobs([]);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [userId, toast]);

  // Fetch sitter invitations (pending requests) alongside jobs.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await API.getSitterInvitations();
        if (mounted) setInvitations(Array.isArray(data) ? data : []);
      } catch {
        if (mounted) setInvitations([]);
      }
    })();
    return () => { mounted = false; };
  }, [userId]);

  // Phase 8E: full sibling list per series, so SeriesCard can show the true
  // date range even when only 1 day is visible in the current tab. The buckets
  // below filter BY TAB before grouping, so a group's own `jobs` can be a
  // single day — the common case once a sitter declines one occurrence of a
  // series and only the remaining days are still Assigned.
  const seriesSiblingsMap = useMemo(() => {
    const map = new Map();
    (jobs ?? []).forEach((j) => {
      const sid = j?.JobSeries_ID;
      if (sid == null) return;
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid).push(j);
    });
    return map;
  }, [jobs]);

  const activeJobs = sortByJobDateDesc(
    jobs.filter((j) => ACTIVE_JOB_STATUSES.has(normalizeJobStatus(j.Status)))
  );
  const upcomingJobs = groupJobsBySeries(sortByJobDateDesc(
    jobs.filter((j) => UPCOMING_JOB_STATUSES.has(normalizeJobStatus(j.Status)))
  ));
  const historyJobs = groupJobsBySeries(sortByJobDateDesc(
    jobs.filter((j) => HISTORY_JOB_STATUSES.has(normalizeJobStatus(j.Status)))
  ));

  // Pending requests: invitations that are still "invited" (not yet accepted/rejected).
  // The sitter-invitation DTO names the job's fields JobTitle / JobCity / JobPayment,
  // so normalise them onto the names the job card already reads (Title / City /
  // Payment). Without this the card rendered "AMOUNT: PKR 0" and the hard-coded
  // 'Islamabad' location fallback.
  const pendingRequests = groupJobsBySeries(
    invitations
      .filter((i) => (i.Status || '').toLowerCase() === 'invited')
      .map((i) => ({
        ...i,
        Payment: i.JobPayment ?? 0,
        Title: i.JobTitle ?? i.Title,
        City: i.JobCity ?? i.City,
        ParentName: i.ParentName,
        ParentPic: i.ParentPic ?? i.ParentPicture ?? null,
      }))
  );

  const displayedMode = selectedTab === 'upcoming'
    ? 'upcoming'
    : selectedTab === 'history'
    ? 'history'
    : 'open';

  const displayedJobs =
    selectedTab === 'active'
      ? activeJobs
      : selectedTab === 'upcoming'
      ? upcomingJobs
      : selectedTab === 'history'
      ? historyJobs
      : pendingRequests;

  const handleJobClick = (job) => {
    const targetJobId = job.Job_ID ?? job.jobId;
    const st = normalizeJobStatus(job.Status);
    if (st === 'sitterarrived') {
      navigate(
        targetJobId != null ? `/upcoming-job-details/${targetJobId}` : '/upcoming-job-details',
        { state: { job } }
      );
    } else if (st === 'inprogress') {
      navigate('/active-job-details', { state: { job } });
    } else if (UPCOMING_JOB_STATUSES.has(st)) {
      // 'Confirmed' previously fell through to the completed screen (bug).
      navigate(
        targetJobId != null ? `/upcoming-job-details/${targetJobId}` : '/upcoming-job-details',
        { state: { job } }
      );
    } else if (job.Status === 'Invited') {
      // Pending invitation: the Accept / Reject screen. Invitations used to
      // fall through to the completed screen (bug) because they were not
      // branched on. This mirrors how /job-request opens an invitation card.
      navigate(
        targetJobId != null ? `/job-details/${targetJobId}` : '/job-details',
        { state: { job } }
      );
    } else {
      navigate(
        targetJobId != null ? `/completed-job-details/${targetJobId}` : '/completed-job-details',
        { state: { job } }
      );
    }
  };

  return (
    <div className={styles.jobsContainer}>
      {/* Top Header Bar with Universal BackButton and Filter */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <BackButton />
          <h1 className={styles.title}>My Jobs</h1>
        </div>
        <button
          type="button"
          className={styles.filterBtn}
          onClick={fetchJobs}
          aria-label="Refresh jobs"
          title="Refresh"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </header>

      {/* Segmented Pill Tabs Switcher (Mockup Frame 119) */}
      <nav className={styles.segmentedContainer} aria-label="Jobs Filter Tabs">
        <button
          type="button"
          className={`${styles.segmentedTab} ${selectedTab === 'active' ? styles.segmentedTabActive : ''}`}
          onClick={() => setSelectedTab('active')}
        >
          <span>Active Jobs</span>
          <span className={styles.tabBadge}>{activeJobs.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.segmentedTab} ${selectedTab === 'requests' ? styles.segmentedTabActive : ''}`}
          onClick={() => setSelectedTab('requests')}
        >
          <span>Requests</span>
          <span className={styles.tabBadge}>{pendingRequests.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.segmentedTab} ${selectedTab === 'upcoming' ? styles.segmentedTabActive : ''}`}
          onClick={() => setSelectedTab('upcoming')}
        >
          <span>Upcoming</span>
          <span className={styles.tabBadge}>{upcomingJobs.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.segmentedTab} ${selectedTab === 'history' ? styles.segmentedTabActive : ''}`}
          onClick={() => setSelectedTab('history')}
        >
          <span>History</span>
          <span className={styles.tabBadge}>{historyJobs.length}</span>
        </button>
      </nav>

      {/* Content */}
      {loading ? (
        <div style={{ padding: '40px 0', display: 'flex', justifyContent: 'center' }}>
          <LoadingSpinner size="lg" label="Loading schedule..." />
        </div>
      ) : displayedJobs.length === 0 ? (
        <EmptyState
          title={
            selectedTab === 'active'
              ? 'No active babysitting sessions'
              : selectedTab === 'upcoming'
              ? 'No upcoming bookings scheduled'
              : selectedTab === 'history'
              ? 'No past job records found'
              : 'No new requests'
          }
          description={
            selectedTab === 'upcoming'
              ? 'Check incoming Job Requests to accept new bookings.'
              : selectedTab === 'requests'
              ? 'New booking requests from parents will appear here.'
              : 'Your scheduled and completed bookings will appear here.'
          }
          actionLabel={selectedTab === 'upcoming' ? 'View Requests' : undefined}
          onAction={selectedTab === 'upcoming' ? () => navigate('/job-request') : undefined}
        />
      ) : (
        <div className={styles.jobsList}>
          {displayedJobs.map((item) => {
            if (item.type === 'series') {
              return (
                <SeriesCard
                  key={`series-${item.seriesId}`}
                  group={item}
                  seriesStatusLabel={seriesStatusLabel(item)}
                  viewer="sitter"
                  mode={displayedMode}
                  allSiblings={seriesSiblingsMap.get(item.seriesId) ?? item.jobs}
                />
              );
            }

            const job = item.job ?? item;
            const dateStr = job.JobDate
              ? new Date(job.JobDate).toLocaleDateString('en-US', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : 'Scheduled Date';

            const timeRange = selectedTab === 'history' && job.SessionStartedAt && job.SessionEndedAt
              ? (() => {
                  const worked = (new Date(job.SessionEndedAt) - new Date(job.SessionStartedAt)) / 36e5;
                  const formattedWorked = worked.toFixed(2).replace(/\.00$/, '');
                  const startStr = new Date(job.SessionStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const endStr = new Date(job.SessionEndedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return `${startStr} — ${endStr} · ${formattedWorked} hours worked`;
                })()
              : job.SlotTimes?.length
              ? `${job.SlotTimes[0].StartTime?.substring(0, 5)} - ${job.SlotTimes[job.SlotTimes.length - 1].EndTime?.substring(0, 5)}`
              : job.StartTime && job.EndTime
              ? `${job.StartTime?.substring(0, 5)} - ${job.EndTime?.substring(0, 5)}`
              : 'Flexible Hours';

            const isDeactivated = job.IsParentDeleted || job.ParentName === 'Deactivated Parent';
            const parentName = isDeactivated
              ? 'Deactivated Parent'
              : (job.ParentName ?? job.parent?.name ?? 'Parent Client');
            // Invitations carry the job's amount as JobPayment, so fall back to
            // it when Payment is absent (see the pendingRequests normalisation
            // above) — otherwise the AMOUNT cell read "PKR 0".
            const payment = job.Payment ?? job.JobPayment ?? 0;
            // Pluralise the child label to match the value rendered by
            // formatChildrenCard (e.g. "CHILDREN: 3 children: A, B, C").
            const childCount = (job.Children ?? job.children ?? []).length || (job.ChildName ? 1 : 0);
            const childLabel = childCount > 1 ? 'CHILDREN:' : 'CHILD:';
            const location = job.Address ?? job.City ?? 'Islamabad';
            const jobIdFormatted = `PK-${String(job.Job_ID || 100).padStart(4, '0')}`;

            return (
              <div
                key={job.Job_ID}
                className={styles.jobCard}
              >
                {/* Header: Avatar, Name + ID, Status Badge */}
                <div className={styles.cardHeader}>
                  <div className={styles.userInfo}>
                    <UserAvatar
                      src={job.ParentPic || job.ParentPicture || job.PictureAddress}
                      name={parentName}
                      size={48}
                      type="Parents"
                      className={styles.avatarImg}
                    />
                    <div className={styles.userMeta}>
                      <h3 className={styles.userName}>{parentName}</h3>
                      <span className={styles.userIdText}>ID: {jobIdFormatted}</span>
                    </div>
                  </div>

                  {ACTIVE_JOB_STATUSES.has(normalizeJobStatus(job.Status)) ? (
                    <span className={styles.badgeActive}>
                      <span className={styles.pulsingDot} />
                      Active
                    </span>
                  ) : UPCOMING_JOB_STATUSES.has(normalizeJobStatus(job.Status)) ? (
                    <span className={styles.badgeUpcoming}>
                      Upcoming
                    </span>
                  ) : HISTORY_JOB_STATUSES.has(normalizeJobStatus(job.Status)) ? (
                    <span className={styles.badgeCompleted}>
                      Completed
                    </span>
                  ) : (
                    <span className={styles.badgeCancelled}>
                      {job.Status}
                    </span>
                  )}
                </div>

                {/* Meta details list matching Frame 119 */}
                <div className={styles.metaList}>
                  <div className={styles.metaRow}>
                    <span>👶</span>
                    <span className={styles.metaLabel}>{childLabel}</span>
                    <span className={styles.metaValue}>
                      {formatChildrenCard(job)}
                    </span>
                  </div>

                  <div className={styles.metaRow}>
                    <span>💵</span>
                    <span className={styles.metaLabel}>AMOUNT:</span>
                    <span className={styles.metaValue}>
                      PKR {Number(payment).toLocaleString()}
                    </span>
                  </div>

                  <div className={styles.metaRow}>
                    <span>📍</span>
                    <span className={styles.metaLabel}>LOCATION:</span>
                    <span className={styles.metaValue}>{location}</span>
                  </div>

                  <div className={styles.metaRow}>
                    <span>📅</span>
                    <span className={styles.metaLabel}>SCHEDULE:</span>
                    <span className={styles.metaValue}>{dateStr}, {timeRange}</span>
                  </div>
                </div>

                {/* Action button row matching Frame 119 */}
                {selectedTab === 'active' ? (
                  <button
                    type="button"
                    className={styles.primaryActionBtn}
                    onClick={() => handleJobClick(job)}
                  >
                    <span>View Details</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ) : selectedTab === 'upcoming' ? (
                  <button
                    type="button"
                    className={styles.outlineActionBtn}
                    onClick={() => handleJobClick(job)}
                  >
                    <span>View Details</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                ) : (
                  <div className={styles.historyFooterRow}>
                    <div className={styles.historyPaymentInfo}>
                      <span className={styles.historyPaymentLabel}>Total Earnings</span>
                      <span className={styles.historyPaymentAmount}>PKR {payment.toLocaleString()}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.historyActionBtn}
                      onClick={() => handleJobClick(job)}
                    >
                      <span>View Details</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <BabysitterBottomNav />
    </div>
  );
}

