import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { apiGet } from '../../services/apiClient';
import { API } from '../../services/api';
import UserAvatar from '../../components/ui/UserAvatar';
import styles from './my-jobs.module.css';
import { groupJobsBySeries, seriesStatusLabel } from '../../utils/seriesGrouping';
import SeriesCard from './SeriesCard';

const formatChildrenShort = (job, maxLen = 2) => {
  const list = job?.Children ?? job?.children ?? [];
  if (list.length === 0) {
    return job?.ChildName ? `👶 Caring for: ${job.ChildName}` : '';
  }
  if (list.length === 1) {
    return `👶 Caring for: ${list[0].ChildName}`;
  }
  if (list.length <= maxLen) {
    return `👶 Caring for ${list.length} children: ${list.map(c => c.ChildName).join(', ')}`;
  }
  return `👶 ${list.slice(0, maxLen).map(c => c.ChildName).join(', ')} + ${list.length - maxLen} more`;
};

// Every tab renders most-recent-first: JobDate DESC, tie-broken by Job_ID DESC
// (newer ID first). Copies the array, so the `jobs` state is never mutated.
const sortByJobDateDesc = (list) =>
  [...list].sort((a, b) => {
    const da = a.JobDate ? new Date(a.JobDate).getTime() : 0;
    const db = b.JobDate ? new Date(b.JobDate).getTime() : 0;
    if (db !== da) return db - da;
    return (b.Job_ID ?? 0) - (a.Job_ID ?? 0);
  });

// History is the one bucket where JobDate DESC is the wrong key: a job booked
// earlier can be completed later, so the most recently finished session sinks
// to the bottom. Sort by SessionEndedAt DESC, then JobDate DESC, then Job_ID DESC.
// `SessionEndedAt` comes straight from the parent jobs DTO (no client math).
const sortByCompletedDesc = (list) =>
  [...list].sort((a, b) => {
    const ea = a.SessionEndedAt ? new Date(a.SessionEndedAt).getTime() : 0;
    const eb = b.SessionEndedAt ? new Date(b.SessionEndedAt).getTime() : 0;
    if (eb !== ea) return eb - ea;
    const da = a.JobDate ? new Date(a.JobDate).getTime() : 0;
    const db = b.JobDate ? new Date(b.JobDate).getTime() : 0;
    if (db !== da) return db - da;
    return (b.Job_ID ?? 0) - (a.Job_ID ?? 0);
  });




/**
 * Phase 5.1 fix — strict job-status bucketing.
 *
 * The backend ships lifecycle strings such as 'Open', 'Assigned', 'In Progress'
 * (also seen as 'InProgress' in some payloads), 'Confirmed', 'Completed' and
 * 'Cancelled'. Raw `===` string comparison against a couple of them let a
 * cancelled / completed job leak into the Active feed (e.g. Job #96).
 *
 * Every status is normalised once (trim, lowercase, strip spaces/underscores/
 * hyphens) and bucketed with CLOSED whitelists. `isHistoryJob` is evaluated
 * first and OR-ed out of every other predicate, so a Cancelled or Completed job
 * is guaranteed to land in History only.
 */
const normalizeStatus = (status) =>
  String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const ACTIVE_STATUSES = new Set(['inprogress', 'confirmed', 'sitterarrived']); // work happening now
const UPCOMING_STATUSES = new Set(['assigned']); // hired, not started yet
const OPEN_STATUSES = new Set(['open', 'pending']); // awaiting a sitter / bids
const HISTORY_STATUSES = new Set(['completed', 'cancelled', 'canceled']); // terminal

const getJobStatus = (job) => normalizeStatus(job?.Status ?? job?.status);
const isHistoryJob = (job) => HISTORY_STATUSES.has(getJobStatus(job));
const isActiveJob = (job) => !isHistoryJob(job) && ACTIVE_STATUSES.has(getJobStatus(job));
const isUpcomingJob = (job) => !isHistoryJob(job) && UPCOMING_STATUSES.has(getJobStatus(job));
const isOpenJob = (job) => !isHistoryJob(job) && OPEN_STATUSES.has(getJobStatus(job));

export default function MyJobsScreen() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const toast = useToast();

  const [selectedTab, setSelectedTab] = useState('active');
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(userId));
  const [refreshing, setRefreshing] = useState(false);
  const [bids, setBids] = useState([]);
  const [expandedBids, setExpandedBids] = useState({});
  const [bidActionLoading, setBidActionLoading] = useState(null);

  const fetchJobs = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await apiGet(`/parent/jobs/${userId}`);
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message || 'Could not load your bookings.');
    } finally {
      setLoading(false);
    }
  }, [userId, toast]);

  const fetchBids = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await API.getBidsForParent(userId);
      setBids(Array.isArray(data) ? data : []);
    } catch {
      setBids([]); // bids are supplementary; the jobs list already reports load errors
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let ignore = false;
    (async () => {
      try {
        const data = await API.getBidsForParent(userId);
        if (!ignore) setBids(Array.isArray(data) ? data : []);
      } catch {
        if (!ignore) setBids([]);
      }
    })();
  }, [userId]);

  const handleRefresh = async () => {
    toast.info('Refreshing bookings...');
    setRefreshing(true);
    await Promise.all([fetchJobs(), fetchBids()]);
    setTimeout(() => setRefreshing(false), 500);
  };

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!userId) {
        setLoading(false);
        return;
      }
      try {
        const data = await apiGet(`/parent/jobs/${userId}`);
        if (!ignore) {
          setJobs(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!ignore) {
          toast.error(err.message || 'Could not load your bookings.');
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

  // Phase 8E: full sibling list per series, so SeriesCard can show the true
  // date range even when only 1 day is visible in the current tab. The buckets
  // below filter BY TAB before grouping, so a group's own `jobs` can be a
  // single day (e.g. a series where the sitter declined one occurrence).
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

  // Phase 5.1: strict, mutually exclusive buckets — History is evaluated first,
  // so a Cancelled / Completed job can never surface in Active, Open or Upcoming.
  const activeJobs = sortByJobDateDesc(jobs.filter(isActiveJob));
  const upcomingJobs = groupJobsBySeries(sortByJobDateDesc(jobs.filter(isUpcomingJob)));
  const historyJobs = groupJobsBySeries(sortByCompletedDesc(jobs.filter(isHistoryJob)));
  const openJobs = groupJobsBySeries(sortByJobDateDesc(jobs.filter(isOpenJob)));

  // SeriesCard's `mode` drives the NEXT SESSION highlight and the
  // ?series=history link. The Active tab is never grouped, so it never applies.
  const seriesCardMode =
    selectedTab === 'upcoming' ? 'upcoming' : selectedTab === 'history' ? 'history' : 'open';

  const getVisibleJobs = () => {
    switch (selectedTab) {
      case 'active': return activeJobs;
      case 'upcoming': return upcomingJobs;
      case 'history': return historyJobs;
      case 'open': return openJobs;
      default: return [];
    }
  };

  const toggleBids = (id) => setExpandedBids((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleBidAction = async (bidId, action) => {
    setBidActionLoading(bidId);
    try {
      if (action === 'accept') {
        await API.acceptBid(bidId);
        toast.success('Bid accepted. The caregiver has been assigned.');
      } else {
        await API.rejectBid(bidId);
        toast.info('Bid rejected.');
      }
      await Promise.all([fetchBids(), fetchJobs()]);
    } catch (err) {
      toast.error(err?.message || 'Bid action failed.');
    } finally {
      setBidActionLoading(null);
    }
  };

  // Single source of truth for opening a booking. The card body AND the card's
  // action button both call this, so the two can never diverge. There is NO
  // placeholder-route fallback — /babysitter-details-2 is gone from this file.
  const handleJobClick = (job) => {
    const targetId = job?.Job_ID ?? job?.jobId;
    if (targetId == null) return; // nothing addressable — stay put
    if (job?.Status === 'SitterArrived') {
      navigate(`/booking-status/${targetId}`);
      return;
    }
    navigate(`/booking-status/${targetId}`);
  };

  const visibleJobs = getVisibleJobs();

  return (
    <div className={styles.jobsContainer}>
      {/* Top Bar with BackButton, Title, Refresh */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <BackButton />
          <h1 className={styles.title}>My Bookings</h1>
        </div>
        <button
          type="button"
          className={styles.filterBtn}
          onClick={handleRefresh}
          aria-label="Refresh bookings"
          title="Refresh"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transition: 'transform 0.5s ease',
              transform: refreshing ? 'rotate(360deg)' : 'none',
            }}
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </header>

      {/* Pill Tab Switcher */}
      <nav className={styles.segmentedContainer} aria-label="Bookings Filter Tabs">
        <button
          type="button"
          className={`${styles.segmentedTab} ${selectedTab === 'active' ? styles.segmentedTabActive : ''}`}
          onClick={() => setSelectedTab('active')}
        >
          <span>Active</span>
          <span className={styles.tabBadge}>{activeJobs.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.segmentedTab} ${selectedTab === 'open' ? styles.segmentedTabActive : ''}`}
          onClick={() => setSelectedTab('open')}
        >
          <span>Open</span>
          <span className={styles.tabBadge}>{openJobs.length}</span>
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
          <LoadingSpinner size="lg" label="Loading bookings..." />
        </div>
      ) : visibleJobs.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyCircle} aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <h3 className={styles.emptyTitle}>No {selectedTab} bookings</h3>
          <p className={styles.emptySubtitle}>
            {selectedTab === 'active'
              ? 'You have no active babysitting sessions in progress.'
              : selectedTab === 'upcoming'
              ? 'You have no upcoming confirmed bookings scheduled.'
              : selectedTab === 'open'
              ? 'You have no open bookings waiting for caregiver bids.'
              : 'You have no past booking records yet.'}
          </p>
          <button
            type="button"
            className={styles.emptyAction}
            onClick={() => navigate('/search-babysitter')}
          >
            Find Babysitter
          </button>
        </div>
      ) : (
        <div className={styles.jobsList}>
          {visibleJobs.map((item, idx) => {
            // A bucket entry is either a single job ({type:'single'}) or a
            // series group ({type:'series'}) produced by groupJobsBySeries.
            // Series render as one SeriesCard; singles keep the card below.
            if (item?.type === 'series') {
              return (
                <SeriesCard
                  key={item.seriesId}
                  group={item}
                  seriesStatusLabel={seriesStatusLabel(item)}
                  viewer="parent"
                  mode={seriesCardMode}
                  allSiblings={seriesSiblingsMap.get(item.seriesId) ?? item.jobs}
                />
              );
            }
            const job = item?.type === 'single' ? item.job : item;
            if (!job) return null;
            const jobId = job.Job_ID ?? job.jobId ?? idx;
            const isSitterDeleted = job.IsSitterDeleted || (job.Status === 'Completed' && !job.SitterName && !job.AssignedSitter_ID);
            const rawSitterName = job.SitterName ?? job.sitter?.name ?? job.sitterName;
            // Only treat as "has sitter" when one is actually assigned AND we have a real name.
            // Never render fake placeholders like 'Assigned Babysitter' / 'Unknown'.
            const hasSitter = job.AssignedSitter_ID != null
              && rawSitterName
              && rawSitterName !== 'Unknown';
            const sitterName = isSitterDeleted ? 'Deactivated Caregiver' : rawSitterName;
            const childListing = formatChildrenShort(job);
            const dateStr = job.JobDate
              ? new Date(job.JobDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'Scheduled';
            const timeRange = job.SlotTimes?.length
              ? `${job.SlotTimes[0].StartTime?.substring(0, 5)} - ${job.SlotTimes[job.SlotTimes.length - 1].EndTime?.substring(0, 5)}`
              : job.StartTime && job.EndTime
              ? `${job.StartTime?.substring(0, 5)} - ${job.EndTime?.substring(0, 5)}`
              : 'Scheduled Hours';
            const jobBids = bids.filter((b) => b.Job_ID === (job.Job_ID ?? job.jobId));

            return (
              <div
                key={jobId}
                className={styles.jobCard}
                onClick={() => handleJobClick(job)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleJobClick(job)}
              >
                <div className={styles.jobCardHeader}>
                  <div className={styles.sitterInfo}>
                    {hasSitter ? (
                      <>
                        <UserAvatar
                          src={job.SitterPicture ?? job.sitter?.picture}
                          name={sitterName}
                          size={48}
                          type="Sitters"
                          alt={sitterName}
                        />
                        <div className={styles.sitterText}>
                          <h3 className={styles.sitterName}>{sitterName}</h3>
                          <span className={styles.childTag}>{childListing}</span>
                        </div>
                      </>
                    ) : isSitterDeleted ? (
                      <>
                        <UserAvatar name="Deactivated Caregiver" size={48} type="Sitters" />
                        <div className={styles.sitterText}>
                          <h3 className={styles.sitterName}>
                            Deactivated Caregiver
                            <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginLeft: '6px', fontWeight: 'normal' }}>
                              (Inactive)
                            </span>
                          </h3>
                          <span className={styles.childTag}>{childListing}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.emptyAvatarPlaceholder}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
                          </svg>
                        </div>
                        <div className={styles.sitterText}>
                          <span className={styles.sitterNameMuted}>
                            {job.Status === 'Cancelled' ? 'No sitter assigned' : 'Awaiting sitter'}
                          </span>
                          <span className={styles.childTag}>{childListing}</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div>
                    {getJobStatus(job) === 'inprogress' ? (
                      <span className={styles.statusActive}>
                        <span className={styles.pulsingDot} />
                        In Progress
                      </span>
                    ) : getJobStatus(job) === 'assigned' ? (
                      <span className={styles.statusUpcoming}>
                        Confirmed
                      </span>
                    ) : getJobStatus(job) === 'confirmed' ? (
                      <span className={styles.statusActive}>
                        Confirmed
                      </span>
                    ) : getJobStatus(job) === 'open' || getJobStatus(job) === 'pending' ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 10px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: 'rgb(var(--primary-rgb) / 0.1)',
                          color: 'var(--color-primary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Open
                      </span>
                    ) : getJobStatus(job) === 'cancelled' ? (
                      <span className={styles.statusCancelled}>
                        Cancelled
                      </span>
                    ) : (
                      <span className={styles.statusCompleted}>
                        {job.Status ?? 'Completed'}
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.detailsStrip}>
                  <div className={styles.stripItem}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{dateStr}</span>
                  </div>
                  <span className={styles.stripDivider}>•</span>
                  <div className={styles.stripItem}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>{timeRange}</span>
                  </div>
                </div>

                <button
                  type="button"
                  className={`${styles.cardActionBtn} ${selectedTab === 'active' ? styles.cardActionBtnPrimary : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleJobClick(job);
                  }}
                >
                  <span>{selectedTab === 'active' ? 'Live Session Tracking >' : 'View Booking Details →'}</span>
                </button>

                {/* Incoming Bids — only for Open jobs that have received at least one bid */}
                {isOpenJob(job) && jobBids.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      borderTop: '1px dashed var(--color-border-subtle)',
                      paddingTop: 10,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => toggleBids(jobId)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'rgb(var(--primary-rgb) / 0.06)',
                        border: 'none',
                        borderRadius: 10,
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--color-primary)',
                      }}
                    >
                      <span>Incoming Bids ({jobBids.length})</span>
                      <span aria-hidden="true">{expandedBids[jobId] ? '▲' : '▼'}</span>
                    </button>

                    {expandedBids[jobId] &&
                      jobBids.map((bid) => (
                        <div
                          key={bid.Bid_ID}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            marginTop: 8,
                            padding: '10px 12px',
                            background: 'var(--color-surface)',
                            border: '1px solid var(--color-surface-sunken)',
                            borderRadius: 12,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 700,
                                color: 'var(--color-text)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {bid.SitterName ?? 'Babysitter'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                              ★ {bid.SitterRating > 0 ? Number(bid.SitterRating).toFixed(1) : 'New'}
                              {' · '}
                              PKR {bid.ProposedPrice != null ? Number(bid.ProposedPrice).toLocaleString() : '—'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <button
                              type="button"
                              disabled={bidActionLoading === bid.Bid_ID}
                              onClick={() => handleBidAction(bid.Bid_ID, 'accept')}
                              style={{
                                padding: '7px 14px',
                                borderRadius: 999,
                                border: 'none',
                                fontWeight: 700,
                                fontSize: 12,
                                cursor: bidActionLoading === bid.Bid_ID ? 'not-allowed' : 'pointer',
                                background: 'var(--color-success-strong)',
                                color: 'var(--color-text-inverse)',
                                opacity: bidActionLoading === bid.Bid_ID ? 0.6 : 1,
                              }}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={bidActionLoading === bid.Bid_ID}
                              onClick={() => handleBidAction(bid.Bid_ID, 'reject')}
                              style={{
                                padding: '7px 14px',
                                borderRadius: 999,
                                border: 'none',
                                fontWeight: 700,
                                fontSize: 12,
                                cursor: bidActionLoading === bid.Bid_ID ? 'not-allowed' : 'pointer',
                                background: 'var(--color-danger-strong)',
                                color: 'var(--color-text-inverse)',
                                opacity: bidActionLoading === bid.Bid_ID ? 0.6 : 1,
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ParentBottomNav />
    </div>
  );
}

