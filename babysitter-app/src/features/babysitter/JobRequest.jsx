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

const SeriesRequestCard = ({ group, isActionPending, handleAccept, handleDecline }) => {
  const [expanded, setExpanded] = useState(false);
  const { anchor, jobs, aggregate } = group;
  const { totalCount, startDate, endDate, totalPayment, perDayPayment, children, timeLabel } = aggregate;
  const startStr = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Flexible';
  const endStr = endDate ? endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const dateRange = endStr && endStr !== startStr ? `${startStr} - ${endStr}` : startStr;
  return (
    <div className={styles.requestCard}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'var(--badge-purple-bg, rgba(147, 51, 234, 0.1))', color: 'var(--badge-purple-text, #9333ea)', width: 'max-content' }}>
          🔁 Series · {totalCount} days · Invited
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-strong)', marginTop: 4 }}>{dateRange} {timeLabel ? `· ${timeLabel}` : ''}</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>👶 {children?.map(c => c.ChildName).join(', ') ?? 'Children'}</span>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-strong)' }}>PKR {Number(totalPayment).toLocaleString()} total</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>(PKR {Number(perDayPayment).toLocaleString()} per day)</div>
        </div>
      </div>
      <div className={styles.requestActions}>
        <button type="button" disabled={isActionPending} className={styles.btnPrimary} onClick={() => handleAccept(anchor.JobInvitation_ID)}>{isActionPending ? 'Processing…' : 'Accept entire series'}</button>
        <button type="button" disabled={isActionPending} className={styles.btnOutlineRed} onClick={() => handleDecline(anchor.JobInvitation_ID)}>Decline entire series</button>
      </div>
      <button type="button" onClick={() => setExpanded(!expanded)} style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginTop: 12, display: 'flex' }}>
        {expanded ? 'Collapse ⬆' : `Expand to see all ${totalCount} days ⬇`}
      </button>
      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.map(inv => (
            <div key={inv.JobInvitation_ID} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-surface-sunken)', padding: '12px', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Day {inv.SeriesOccurrenceIndex} · {inv.JobDate ? new Date(inv.JobDate).toLocaleDateString() : 'Flexible'}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{inv.Status}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={styles.btnPrimary} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => handleAccept(inv.JobInvitation_ID)}>Accept</button>
                <button type="button" className={styles.btnOutlineRed} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => handleDecline(inv.JobInvitation_ID)}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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

  const loadInvitations = useCallback(async (silent = false) => {
    try {
      const data = await API.getSitterInvitations();
      setInvitations(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) {
        toast.error(err?.message || 'Could not load invitations.');
      }
      setInvitations([]);
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
        }
      } catch (err) {
        if (!ignore) {
          toast.error(err?.message || 'Could not load invitations.');
          setInvitations([]);
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
          }
        })
        .catch(() => {
          /* silent */
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

  const handleAccept = async (invitationId) => {
    setActionId(invitationId);
    try {
      await API.acceptInvitation(invitationId);
      toast.success('Invitation accepted! Waiting for the parent to hire.');
      await loadInvitations(true);
    } catch (err) {
      toast.error(err?.message || 'Failed to accept invitation.');
    } finally {
      setActionId(null);
    }
  };

  const handleDecline = async (invitationId) => {
    setActionId(invitationId);
    try {
      await API.declineInvitation(invitationId);
      toast.info('Invitation declined.');
      await loadInvitations(true);
    } catch (err) {
      toast.error(err?.message || 'Failed to decline invitation.');
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
      ) : invitations.length === 0 ? (
        <EmptyState
          title="No Pending Invitations"
          description="You currently have no direct job invitations from parents."
          actionLabel="Set Availability"
          onAction={() => navigate('/set-availability')}
        />
      ) : (
        <div className={styles.requestsList}>
          {groupedInvitations.map((groupItem) => {
            if (groupItem.type === 'series') {
              return (
                <SeriesRequestCard
                  key={`group-${groupItem.seriesId}`}
                  group={groupItem}
                  isActionPending={actionId === groupItem.anchor?.JobInvitation_ID}
                  handleAccept={handleAccept}
                  handleDecline={handleDecline}
                  navigate={navigate}
                />
              );
            }

            const invitation = groupItem.job;
            const isActionPending = actionId === invitation.JobInvitation_ID;
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
                        disabled={isActionPending}
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
                        loading={isActionPending}
                        disabled={isActionPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAccept(invitation.JobInvitation_ID);
                        }}
                      >
                        Accept
                      </Button>
                    </div>
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