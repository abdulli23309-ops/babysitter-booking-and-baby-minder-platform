import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../../services/api';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { groupJobsBySeries } from '../../utils/seriesGrouping';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastContext';
import UserAvatar from '../../components/ui/UserAvatar';
import styles from './job-request.module.css';

const sortByJobDateDesc = (list) =>
  [...list].sort((a, b) => {
    const da = a.JobDate ? new Date(a.JobDate).getTime() : 0;
    const db = b.JobDate ? new Date(b.JobDate).getTime() : 0;
    if (db !== da) return db - da;
    return (b.Job_ID ?? 0) - (a.Job_ID ?? 0);
  });

// JS getDay(): 0=Sun. Mon-first order to match the UI's weekday chips.
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The recurring pattern actually present in the occurrence dates — "Every Thu"
// for a single-weekday series, otherwise the sorted weekday list. Read back
// from the rows the API returned, never assumed from the request payload.
const weekdayPatternOf = (jobs) => {
  const names = [...new Set(
    jobs
      .map((j) => (j.JobDate ? WEEKDAY_SHORT[new Date(j.JobDate).getDay()] : null))
      .filter(Boolean),
  )].sort((a, b) => WEEKDAY_SHORT.indexOf(a) - WEEKDAY_SHORT.indexOf(b));
  if (names.length === 0) return 'Flexible days';
  if (names.length === 1) return `Every ${names[0]}`;
  return names.join(', ');
};

// Phase A: summarise THIS sitter's invitation rows across the series. The
// backend accept/decline cascades to every sibling row in one transaction, so
// the card reflects the rows it actually received — pending, fully accepted
// (waiting for the parent to hire), or a mixed/stale state.
const seriesInvitationState = (jobs) => {
  if (!Array.isArray(jobs) || jobs.length === 0) return 'pending';
  const statuses = jobs.map((j) => String(j.Status || '').trim().toLowerCase());
  const accepted = statuses.filter((s) => s === 'accepted').length;
  const invited = statuses.filter((s) => s === 'invited').length;
  if (accepted === jobs.length) return 'accepted';
  if (invited === jobs.length) return 'pending';
  return 'mixed';
};

const SERIES_STATE_BADGES = {
  pending: {
    label: 'Awaiting your response',
    bg: 'var(--badge-purple-bg, rgba(147, 51, 234, 0.1))',
    color: 'var(--badge-purple-text, #9333ea)',
    border: '1px solid transparent',
  },
  accepted: {
    label: 'Accepted — waiting for parent',
    bg: 'var(--color-info-tint)',
    color: 'var(--color-info)',
    border: '1px solid var(--color-info-border)',
  },
  mixed: {
    label: 'Mixed response',
    bg: 'var(--color-warning-tint, rgba(217, 119, 6, 0.12))',
    color: 'var(--color-warning-strong)',
    border: '1px solid var(--color-warning-border)',
  },
};

const SeriesRequestCard = ({ group, isBusy, handleAccept, handleDecline }) => {
  const [expanded, setExpanded] = useState(false);
  const { anchor, jobs, aggregate } = group;
  const { totalCount, startDate, endDate, totalPayment, perDayPayment, children, timeLabel } = aggregate;
  const startStr = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Flexible';
  const endStr = endDate ? endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const dateRange = endStr && endStr !== startStr ? `${startStr} - ${endStr}` : startStr;

  const state = seriesInvitationState(jobs);
  const badge = SERIES_STATE_BADGES[state];
  const hasInvited = jobs.some((j) => String(j.Status || '').toLowerCase() === 'invited');
  const panelId = `series-occurrences-${group.seriesId}`;
  const isAnchorPending = isBusy && isBusy === anchor?.JobInvitation_ID;
  const parentName = anchor?.ParentName || 'A parent';

  return (
    <article className={styles.requestCard} aria-label={`Series from ${parentName}, ${dateRange}, ${weekdayPatternOf(jobs)}`}>
      <div className={styles.seriesSummary}>
        <span className={styles.seriesBadge} style={{ background: badge.bg, color: badge.color, border: badge.border }}>
          🔁 Series · {totalCount} days · {badge.label}
        </span>
        <span className={styles.seriesParent}>👤 {parentName}</span>
        <span className={styles.seriesMeta}>
          {weekdayPatternOf(jobs)} · {dateRange}{timeLabel ? ` · ${timeLabel}` : ''}
        </span>
        <span className={styles.seriesMeta}>👶 {children?.map((c) => c.ChildName).join(', ') ?? 'Children'}</span>
        <div className={styles.seriesPaymentBlock}>
          <div className={styles.seriesTotal}>PKR {Number(totalPayment).toLocaleString()} total</div>
          {perDayPayment != null && (
            <div className={styles.seriesPerDay}>(PKR {Number(perDayPayment).toLocaleString()} per day)</div>
          )}
        </div>
      </div>

      {hasInvited ? (
        <div className={styles.requestActions}>
          <button
            type="button"
            disabled={isBusy}
            className={styles.btnPrimary}
            aria-label={`Accept series: ${dateRange}, ${totalCount} days`}
            onClick={() => handleAccept(anchor.JobInvitation_ID, { isSeries: true })}
          >
            {isAnchorPending ? 'Accepting…' : 'Accept series'}
          </button>
          <button
            type="button"
            disabled={isBusy}
            className={styles.btnOutlineRed}
            aria-label={`Decline series: ${dateRange}, ${totalCount} days`}
            onClick={() => handleDecline(anchor.JobInvitation_ID, { isSeries: true, days: jobs.length })}
          >
            {isAnchorPending ? 'Declining…' : 'Decline series'}
          </button>
        </div>
      ) : (
        <p className={styles.acceptedNote} role="status">
          ✅ {state === 'accepted'
            ? 'Accepted — waiting for the parent to hire you. These days appear under My Jobs once hired.'
            : 'No action needed on this series right now.'}
        </p>
      )}

      <button
        type="button"
        className={styles.expandToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} occurrence list for series ${dateRange}`}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? `Collapse ${totalCount} days ⬆` : `Expand to see all ${totalCount} days ⬇`}
      </button>

      {expanded && (
        <div id={panelId} className={styles.occurrenceList} role="list" aria-label={`Occurrences of the series ${dateRange}`}>
          {jobs.map((inv) => (
            <div
              key={inv.JobInvitation_ID}
              role="listitem"
              className={styles.occurrenceRow}
              aria-label={`Day ${inv.SeriesOccurrenceIndex ?? ''} ${inv.JobDate ? new Date(inv.JobDate).toDateString() : 'flexible'}, ${inv.Status}`}
            >
              <div className={styles.occurrenceInfo}>
                <span className={styles.occurrenceDate}>
                  Day {inv.SeriesOccurrenceIndex} · {inv.JobDate
                    ? new Date(inv.JobDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                    : 'Flexible'}
                </span>
                <span className={styles.occurrenceStatus} data-status={String(inv.Status || '').toLowerCase()}>
                  {inv.Status === 'Accepted' ? 'Accepted' : inv.Status === 'Invited' ? 'Awaiting response' : inv.Status}
                </span>
              </div>
              <span className={styles.occurrencePay}>PKR {Number(inv.JobPayment || 0).toLocaleString()}</span>
            </div>
          ))}
          <p className={styles.occurrenceHint}>
            Accepting or declining applies to every day shown above — one series-wide action.
          </p>
        </div>
      )}
    </article>
  );
};
function formatChildren(job) {
  const list = job?.Children ?? job?.children ?? [];
  if (list.length === 0) {
    return job?.ChildName ? `👶 Caring for: ${job.ChildName}` : '';
  }
  if (list.length === 1) {
    return `👶 Caring for: ${list[0].ChildName}`;
  }
  return `👶 Caring for ${list.length} children: ${list.map(c => c.ChildName).join(', ')}`;
}



function getStatusBadge(status) {
  switch (status) {
    case 'Invited':
      return { label: 'Waiting for your response', bg: 'var(--color-primary-tint-light)', color: 'var(--color-warning-strong)', border: 'var(--color-warning-border)' };
    case 'Accepted':
      return { label: 'Accepted — waiting for parent to hire', bg: 'var(--color-info-tint)', color: 'var(--color-info)', border: 'var(--color-info-border)' };
    case 'Hired':
      return { label: 'You have been hired', bg: 'var(--color-success-tint)', color: 'var(--color-success-strong)', border: 'var(--color-success-border)' };
    // Phase 5.1 fix: the "Another sitter was hired" status line was removed from
    // the invitation cards. A superseded invitation now renders NO badge at all
    // (see the `badge &&` guard in the card markup below) to declutter the list.
    case 'Superseded':
      return null;
    default:
      return { label: status || 'Pending', bg: 'var(--color-surface-sunken)', color: 'var(--color-text-tertiary)', border: 'var(--color-border-strong)' };
  }
}

export default function JobRequest() {
  const navigate = useNavigate();
  const toast = useToast();

  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Phase A: a FAILED fetch must never masquerade as an empty invitation list.
  // `loadError` drives a dedicated error panel/banner with a retry control;
  // an error also never overwrites data we already have (stale list > fake empty).
  const [loadError, setLoadError] = useState(null);

  const loadInvitations = useCallback(async (silent = false) => {
    try {
      const data = await API.getSitterInvitations();
      setInvitations(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      const message = err?.message || 'Could not load invitations.';
      if (!silent) {
        toast.error(message);
      }
      setLoadError(message);
    }
  }, [toast]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      try {
        const data = await API.getSitterInvitations();
        if (!ignore) {
          setInvitations(Array.isArray(data) ? data : []);
          setLoadError(null);
        }
      } catch (err) {
        if (!ignore) {
          setLoadError(err?.message || 'Could not load invitations.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();

    const pollInterval = setInterval(() => {
      if (ignore) return;
      API.getSitterInvitations()
        .then((data) => {
          if (!ignore && Array.isArray(data)) {
            setInvitations(data);
            setLoadError(null);
          }
        })
        .catch((err) => {
          // Background poll failures keep the last good list on screen and only
          // surface a quiet "couldn't refresh" banner — never an empty list.
          if (!ignore) {
            setLoadError(err?.message || 'Could not refresh invitations.');
          }
        });
    }, 5000);

    return () => {
      ignore = true;
      clearInterval(pollInterval);
    };
  }, [toast]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadInvitations(false);
    setTimeout(() => setRefreshing(false), 500);
  };

  // Series-wide accept (backend cascades to every sibling row in one
  // transaction). The action label on the card says so. `actionId` also acts
  // as a global lock so no second action can start while one is pending.
  const handleAccept = async (invitationId) => {
    if (actionId != null) return;
    setActionId(invitationId);
    try {
      await API.acceptInvitation(invitationId);
      toast.success('Series accepted! Waiting for the parent to hire.');
      await loadInvitations(true);
    } catch (err) {
      toast.error(err?.message || 'Failed to accept invitation.');
      await loadInvitations(true); // re-sync: the server may have partially changed state before the error
    } finally {
      setActionId(null);
    }
  };

  const handleDecline = async (invitationId, options = {}) => {
    if (actionId != null) return;
    // Consequential, series-wide action: confirm before firing the cascade.
    if (options.isSeries) {
      const confirmed = window.confirm(
        `Decline this entire series? This declines all ${options.days ?? 'listed'} day(s) and cannot be undone.`,
      );
      if (!confirmed) return;
    }
    setActionId(invitationId);
    try {
      await API.declineInvitation(invitationId);
      toast.info('Invitation declined.');
      await loadInvitations(true);
    } catch (err) {
      toast.error(err?.message || 'Failed to decline invitation.');
      await loadInvitations(true);
    } finally {
      setActionId(null);
    }
  };

  const sortedInvitations = sortByJobDateDesc(invitations);
  const groupedInvitations = groupJobsBySeries(sortedInvitations);

  return (
    <div className={styles.requestContainer}>
      <header className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Job Invitations</h1>
        <div className={styles.topBarRight}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleRefresh}
            aria-label="Refresh invitations"
            title="Refresh"
          >
            <svg
              width="18"
              height="18"
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
        </div>
      </header>

      <section className={styles.titleArea}>
        <p className={styles.subtitle}>Invitations sent directly to you by parents</p>
      </section>

      {loading ? (
        <div style={{ padding: 'var(--space-8) 0', display: 'flex', justifyContent: 'center' }}>
          <LoadingSpinner size="lg" label="Checking new invitations..." />
        </div>
      ) : loadError && invitations.length === 0 ? (
        /* Phase A: a failed fetch is an ERROR, not an empty list. */
        <div className={styles.errorPanel} role="alert">
          <div className={styles.errorTitle}>⚠️ Couldn&apos;t load your invitations</div>
          <p className={styles.errorText}>{loadError}</p>
          <button type="button" className={styles.retryBtn} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : invitations.length === 0 ? (
        <EmptyState
          title="No Invitations Yet"
          description="You currently have no direct job invitations from parents. New invitations will appear here."
          actionLabel="Set Availability"
          onAction={() => navigate('/set-availability')}
        />
      ) : (
        <div className={styles.requestsList}>
          {loadError && (
            /* Background refresh failed but we still have data: keep the list
               and say so — never replace it with an empty state. */
            <div className={styles.refreshBanner} role="status">
              <span>⚠️ Couldn&apos;t refresh — showing your last loaded invitations.</span>
              <button type="button" className={styles.retryBtn} onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
          {groupedInvitations.map((groupItem) => {
            if (groupItem.type === 'series') {
              return (
                <SeriesRequestCard
                  key={`group-${groupItem.seriesId}`}
                  group={groupItem}
                  isBusy={actionId}
                  handleAccept={handleAccept}
                  handleDecline={handleDecline}
                />
              );
            }

            const invitation = groupItem.job;
            // Global lock: while ANY action is pending, every action button on
            // the screen is disabled so duplicate requests cannot race.
            const isThisPending = actionId === invitation.JobInvitation_ID;
            const isBusy = actionId != null;
            const badge = getStatusBadge(invitation.Status);
            const dateStr = invitation.JobDate
              ? new Date(invitation.JobDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'Flexible date';

            return (
              <div
                key={invitation.JobInvitation_ID}
                className={styles.requestCard}
                onClick={() => {
                  if (invitation.Job_ID) {
                    navigate(`/job-details/${invitation.Job_ID}`, {
                      state: { jobId: invitation.Job_ID },
                    });
                  }
                }}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.parentInfo}>
                    <UserAvatar
                      src={invitation.ParentPicture || invitation.ParentPic || invitation.PictureAddress}
                      name={invitation.ParentName || 'Parent'}
                      size={44}
                      type="Parents"
                      alt={invitation.ParentName || 'Parent'}
                    />
                    <div>
                      <h3 className={styles.parentNameText}>{invitation.JobTitle}</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                        {formatChildren(invitation)}
                      </p>
                      <span className={styles.parentSubText}>
                        👤 {invitation.ParentName || 'Parent'} • 📍 {invitation.JobCity || 'City'}
                      </span>
                    </div>
                  </div>
                  <span className={styles.paymentPill}>
                    PKR {Number(invitation.JobPayment || 0).toLocaleString()}
                  </span>
                </div>

                <div className={styles.detailsBox}>
                  <div className={styles.cardDetailsList}>
                    <div className={styles.detailRow}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <span><strong>Date:</strong> {dateStr}</span>
                    </div>
                    <div className={styles.detailRow}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span><strong>City:</strong> {invitation.JobCity || 'Not specified'}</span>
                    </div>
                    {/* Phase 5.1 fix: the status line is skipped entirely when the
                        invitation has no badge (e.g. a superseded invitation). */}
                    {badge && (
                      <div className={styles.detailRow}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '3px 10px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          {badge.label}
                        </span>
                      </div>
                    )}
                    {invitation.Status === 'Invited' && invitation.AcceptedCount > 1 && (
                      <div className={styles.detailRow}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '3px 10px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: 'var(--color-danger-tint)',
                            color: 'var(--color-danger-strong)',
                            border: '1px solid var(--color-danger-border-strong)',
                          }}
                        >
                          ⚠ {invitation.AcceptedCount} sitter(s) already accepted
                        </span>
                      </div>
                    )}
                  </div>

                  {invitation.Status === 'Invited' && (
                    <div className={styles.cardActionRow}>
                      <Button
                        variant="secondary"
                        size="md"
                        fullWidth
                        disabled={isBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDecline(invitation.JobInvitation_ID);
                        }}
                      >
                        Decline
                      </Button>
                      <Button
                        variant="primary"
                        size="md"
                        fullWidth
                        loading={isThisPending}
                        disabled={isBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAccept(invitation.JobInvitation_ID);
                        }}
                      >
                        Accept
                      </Button>
                    </div>
                  )}
                  {invitation.Status === 'Accepted' && (
                    <p className={styles.acceptedNote} role="status">
                      ✅ Accepted — waiting for the parent to hire you. This day appears under My Jobs once hired.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BabysitterBottomNav />
    </div>
  );
}