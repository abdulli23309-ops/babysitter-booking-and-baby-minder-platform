import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import CopyButton from '../../components/ui/CopyButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';

import UserAvatar from '../../components/ui/UserAvatar';
import { API } from '../../services/api';
import { useToast } from '../../components/ui/ToastContext';

const orange = 'var(--color-primary)';

const Icons = {
  chevronBack: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  ),
  locationOutline: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  cashOutline: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
};

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

const calculateAge = (dob) => {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

export default function ActiveJobDetails() {
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const { jobId: routeJobId } = useParams();

  const passedJob = location.state?.job;
  const numericJobId = routeJobId
    ? parseInt(routeJobId, 10)
    : passedJob?.Job_ID ?? passedJob?.jobId ?? null;

  const [job, setJob] = useState(passedJob ?? null);
  const [loading, setLoading] = useState(() => !passedJob && Boolean(numericJobId));

  // Hydrate from the API when no job was passed via navigation state.
  useEffect(() => {
    if (!numericJobId || passedJob) return undefined;
    let isMounted = true;
    (async () => {
      try {
        const data = await API.getJobDetails(numericJobId);
        if (isMounted) setJob(data ?? null);
      } catch (err) {
        if (isMounted) setJob(null);
        const _message = err && err.message ? err.message : 'Something went wrong. Please try again.';
        toast.error(_message);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [numericJobId, passedJob, toast]);

  // ── Sitter review trigger ──
  // The parent ends the session from their own screen. This screen has no
  // push channel, so poll the job status; the moment it flips from
  // 'In Progress' to 'Completed' the sitter is sent to the review screen
  // (same destination the parent lands on: /job-review/:jobId).
  const lastStatusRef = useRef(passedJob?.Status ?? null);
  const isPollingRef = useRef(false);

  const pollNow = useCallback(async () => {
    if (!numericJobId || isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const data = await API.getJobDetails(numericJobId);
      if (!data) return;

      const prev = lastStatusRef.current;
      const next = data?.Status;
      if (next && next !== prev) {
        lastStatusRef.current = next;
        if (prev === 'In Progress' && next === 'Completed') {
          navigate(`/job-review/${numericJobId}`, { state: { job: data } });
          return;
        }
      }

      setJob((prevJob) => ({ ...(prevJob ?? {}), ...data }));
    } catch (err) {
      // Transient network/API error — the next tick retries.
      const _msg = (err && err.message) ? err.message : 'Something went wrong. Please try again.';
      toast.error(_msg);
    } finally {
      isPollingRef.current = false;
    }
  }, [numericJobId, navigate, toast]);

  useEffect(() => {
    if (!numericJobId || job?.Status === 'Completed' || job?.Status === 'Cancelled') {
      return undefined;
    }

    const poll = setInterval(pollNow, 1500);
    return () => {
      clearInterval(poll);
    };
  }, [numericJobId, job?.Status, pollNow]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && job?.Status === 'In Progress') {
        pollNow(); // the same function the interval calls
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [job?.Status, pollNow]);

  const formatTime = (sec) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // Tick clock for the 4-state live timer.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (job?.Status !== 'In Progress' || !job?.SessionStartedAt) return undefined;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.Status, job?.SessionStartedAt]);

  // ── 4-state live timer: READ block + state computation ──
  const status = job?.Status || '';
  const sessionStart = job?.SessionStartedAt ? new Date(job.SessionStartedAt).getTime() : null;
  const now = tick;
  const lastSlotEnd = job?.SlotTimes?.length ? job.SlotTimes[job.SlotTimes.length - 1].EndTime : null;
  const scheduledEnd = (job?.JobDate && lastSlotEnd)
    ? new Date(`${job.JobDate.split('T')[0]}T${lastSlotEnd}`).getTime() : null;

  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const remaining = scheduledEnd != null ? scheduledEnd - now : null;

  let timerDisplay;
  let timerColor;
  let dotColor;
  let timerCaption;
  let exceededBanner;

  if (status !== 'In Progress' || !sessionStart) {
    // State 1 — session not started.
    timerDisplay = 'Session not started';
    timerColor = { color: 'var(--color-text-faint)' };
    dotColor = { background: 'var(--color-text-faint)' };
    timerCaption = 'Waiting for parent to start';
    exceededBanner = null;
  } else if (remaining == null) {
    // Active but no scheduled end available.
    const elapsedSec = Math.floor((now - sessionStart) / 1000);
    timerDisplay = formatTime(elapsedSec);
    timerColor = undefined;
    dotColor = undefined;
    timerCaption = 'Waiting for parent to start';
    exceededBanner = null;
  } else if (remaining > FIFTEEN_MIN_MS) {
    // State 2 — active, more than 15 min remaining.
    const elapsedSec = Math.floor((now - sessionStart) / 1000);
    timerDisplay = formatTime(elapsedSec);
    timerColor = undefined;
    dotColor = undefined;
    timerCaption = `Ends at ${new Date(scheduledEnd).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    exceededBanner = null;
  } else if (remaining >= 0) {
    // State 3 — active, 0–15 min remaining (wrap up soon).
    const elapsedSec = Math.floor((now - sessionStart) / 1000);
    timerDisplay = formatTime(elapsedSec);
    timerColor = undefined;
    dotColor = { background: '#F59E0B' };
    timerCaption = `Ends in ${formatTime(Math.ceil(remaining / 1000))} — wrap up soon`;
    exceededBanner = null;
  } else {
    // State 4 — exceeded scheduled time.
    const overtimeSec = Math.floor((now - scheduledEnd) / 1000);
    timerDisplay = `+${formatTime(overtimeSec)}`;
    timerColor = { color: '#DC2626' };
    dotColor = { background: '#DC2626' };
    timerCaption = 'Session exceeded scheduled time';
    exceededBanner = (
      <div style={{ background: '#DC2626', color: '#fff', padding: '10px 16px', borderRadius: 8, marginTop: 12, fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>
        ⚠ This session is running past its scheduled time. Please end the session as soon as possible.
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingBottom: '100px',
        }}
      >
        <LoadingSpinner size="lg" label="Loading session..." />
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{
        minHeight: '100vh',
        maxWidth: 'var(--shell-max-width, 480px)',
        margin: '0 auto',
        background: 'var(--color-background, var(--color-surface-muted))',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '24px 16px 100px',
        boxSizing: 'border-box',
      }}>
        <EmptyState
          icon="📋"
          title="No Active Job Details"
          description="We couldn't retrieve the session details for this job. It may have ended or been updated."
        >
          <Button
            variant="primary"
            onClick={() => navigate('/babysitter-my-jobs')}
            style={{ marginTop: '12px' }}
          >
            Back to Assigned Jobs
          </Button>
        </EmptyState>
        <BabysitterBottomNav />
      </div>
    );
  }

  // Multi-child fix: the single-child chip is misleading when there are 2+
  // children (it only ever showed the first one) — hide it in that case; the
  // "Caring for N children" line below already lists everyone.
  const childCount = (job.Children ?? job.children ?? []).length;
  const showPrimaryChip = childCount <= 1;
  const childAge = job.ChildAge ?? (job.Child_DOB ? calculateAge(job.Child_DOB) : '?');

  return (
    <div style={{
      minHeight: '100vh',
      maxWidth: 'var(--shell-max-width, 480px)',
      margin: '0 auto',
      background: 'var(--gradient-pastel-soft)',
      paddingBottom: '100px',
      boxSizing: 'border-box',
    }}>
      <div style={{ padding: '24px 16px 100px' }}>
        {/* Top Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '16px',
        }}>
          <BackButton onClick={() => navigate('/babysitter-my-jobs')} />
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--color-text)' }}>
            Active Session
          </h2>
          <div style={{ width: '42px' }} />
        </div>

        {/* ── Job Reference + Copy / Last Updated ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            padding: '10px 14px',
            borderRadius: '14px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            marginBottom: '16px',
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            Job Reference: <strong style={{ color: 'var(--color-text)' }}>#{job.Job_ID ?? '—'}</strong>
          </span>
          <CopyButton value={String(job.Job_ID ?? '')} label="Copy Job Reference" />
        </div>
        <p style={{ margin: '0 0 12px', fontSize: '11px', color: 'var(--color-text-faint)' }}>
          Last updated: {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>

        {/* ── Parent Card ── */}
        <div style={{
          background: 'var(--color-surface)',
          borderRadius: '22px',
          padding: '16px 18px',
          boxShadow: '0 6px 20px rgb(var(--shadow-ink-rgb) / 0.07)',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          marginBottom: '28px',
        }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <UserAvatar
              src={job.ParentPic}
              name={job.ParentName || 'Parent'}
              size={60}
              type="Parents"
              alt="parent"
            />
            <div style={{
              position: 'absolute',
              bottom: '2px',
              right: '2px',
              width: '18px',
              height: '18px',
              background: 'var(--color-success)',
              borderRadius: '50%',
              border: '2px solid var(--glass-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--color-text-inverse)" strokeWidth="1.8">
                <path d="M2 5l2 2.5L8 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          <div>
            <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '16px', color: 'var(--color-text)' }}>
              {job.ParentName || 'Parent'}
            </p>
            <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
              ID: PK-{String(job.Job_ID).padStart(5, '0')}
            </p>
            {showPrimaryChip && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--color-primary-tint-soft)',
                borderRadius: '20px',
                padding: '4px 10px',
              }}>
                <span style={{ fontSize: '14px' }}>☺</span>
                <span style={{ fontSize: '12px', fontWeight: '600', color: orange }}>
                  {job.ChildName || 'Child'} ({childAge}y)
                </span>
              </div>
            )}
            <p style={{
                marginTop: showPrimaryChip ? 6 : 10,
                fontSize: showPrimaryChip ? 13 : 14,
                fontWeight: showPrimaryChip ? 400 : 700,
                color: showPrimaryChip ? 'var(--color-text-muted)' : 'var(--color-primary)',
                background: showPrimaryChip ? 'transparent' : 'var(--color-primary-tint-soft)',
                padding: showPrimaryChip ? 0 : '6px 10px',
                borderRadius: showPrimaryChip ? 0 : 10,
                display: 'inline-block',
              }}>
              {formatChildren(job)}
            </p>
          </div>
        </div>

        {/* ── Live Duration Timer ── */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: '28px',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            width: '290px',
            height: '290px',
            borderRadius: '50%',
            border: '1.5px solid rgba(180,180,200,0.30)',
            pointerEvents: 'none',
          }} />

          <div style={{
            width: '250px',
            height: '250px',
            borderRadius: '50%',
            background: 'var(--color-surface)',
            boxShadow: '0 8px 32px rgb(var(--shadow-ink-rgb) / 0.08)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 1,
          }}>
            <p style={{
              margin: '0 0 8px',
              fontSize: '11px',
              fontWeight: '700',
              color: orange,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
            }}>
              Live Duration
            </p>

            <h1 style={{
              margin: '0 0 12px',
              fontSize: '36px',
              fontWeight: '800',
              color: 'var(--color-text)',
              letterSpacing: '1px',
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'monospace',
              lineHeight: 1,
              ...timerColor,
            }}>
              {timerDisplay}
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: dotColor?.background ?? (sessionStart ? 'var(--color-success)' : 'var(--color-text-faint)'),
                boxShadow: '0 0 0 3px rgb(var(--success-rgb) / 0.2)',
                flexShrink: 0,
              }} />
              <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                {timerCaption}
              </span>
            </div>
          </div>
        </div>
        {exceededBanner}

        {/* ── Info Card ── */}
        <div style={{
          background: 'var(--color-surface)',
          borderRadius: '22px',
          padding: '6px 18px',
          boxShadow: '0 6px 20px rgb(var(--shadow-ink-rgb) / 0.07)',
        }}>
          {/* Location row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            padding: '16px 0',
            borderBottom: '1px solid var(--color-surface-sunken)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'var(--color-info-tint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icons.locationOutline />
            </div>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: '11px', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Location
              </p>
              <p style={{ margin: 0, fontWeight: '600', fontSize: '15px', color: 'var(--color-text)' }}>
                {job.City || 'N/A'}
              </p>
            </div>
          </div>

          {/* Payment row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            padding: '16px 0',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'var(--badge-success-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icons.cashOutline />
            </div>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: '11px', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                SESSION TOTAL
              </p>
              <p style={{ margin: 0, fontWeight: '600', fontSize: '15px', color: 'var(--color-text)' }}>
                PKR {Number(job.Payment ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      <BabysitterBottomNav />
    </div>
  );
}

