import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import EmptyState from '../../components/ui/EmptyState';
import { API } from '../../services/api';
import styles from './baby-monitoring.module.css';

// ---------- SVG Icons ----------
const Icons = {
  chevronBack: () => (
    <svg width="24" height="24" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="328 112 184 256 328 400" />
    </svg>
  ),
  bell: () => (
    <svg width="36" height="36" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M427.68 351.43C402 320 383.87 288 383.87 256c0-61.86-38.45-114.15-88.47-140.33A80.45 80.45 0 0 0 256 48a80.45 80.45 0 0 0-39.4 67.67c-50 26.18-88.47 78.47-88.47 140.33 0 32-18.13 64-43.81 95.43A16 16 0 0 0 96 368h320a16 16 0 0 0 11.68-16.57Z" />
      <path d="M192 400a64 64 0 0 0 128 0" />
    </svg>
  ),
  videocam: () => (
    <svg width="20" height="20" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M374.79 308.78 457.5 367a16 16 0 0 0 22.5-14.62V159.62A16 16 0 0 0 457.5 145l-82.71 58.22A16 16 0 0 0 368 216.3v79.4a16 16 0 0 0 6.79 13.08Z" />
      <rect x="44" y="144" width="308" height="224" rx="16" ry="16" />
    </svg>
  ),
  leaveCall: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="23" y1="1" x2="1" y2="23" />
    </svg>
  ),
};

// ---------- Live Camera Preview SVG ----------
const LiveCameraPreview = () => (
  <div style={{ position: 'relative', width: '100%', height: '100%', background: '#dde8ea', overflow: 'hidden' }}>
    <svg width="100%" height="100%" viewBox="0 0 300 180" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
      <rect width="300" height="180" fill="#e8eeef" />
      <rect x="85" y="10" width="130" height="110" rx="6" fill="#b8d8e4" />
      <rect x="95" y="18" width="110" height="94" rx="4" fill="#a0cce0" />
      <ellipse cx="140" cy="72" rx="28" ry="35" fill="#4a9e6a" />
      <ellipse cx="175" cy="78" rx="22" ry="28" fill="#3a8e5a" />
      <ellipse cx="158" cy="65" rx="20" ry="24" fill="#5aae7a" />
      <rect x="55" y="128" width="190" height="42" rx="6" fill="#d4b896" />
      <rect x="58" y="118" width="7" height="52" rx="3" fill="#c4a886" />
      <rect x="235" y="118" width="7" height="52" rx="3" fill="#c4a886" />
      {[70, 88, 106, 124, 142, 160, 178, 196, 214].map((x, i) => (
        <rect key={i} x={x} y={128} width="4" height="36" rx="2" fill="#b89876" />
      ))}
      <rect x="246" y="135" width="30" height="28" rx="5" fill="#e0cbb0" />
    </svg>
    <div style={{
      position: 'absolute', top: '10px', left: '10px',
      background: 'rgb(var(--shadow-ink-rgb) / 0.55)', backdropFilter: 'blur(6px)', borderRadius: '20px',
      padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '6px',
    }}>
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-danger)', display: 'inline-block' }} />
      <span style={{ color: 'var(--color-text-inverse)', fontSize: '11px', fontWeight: '800', letterSpacing: '0.8px' }}>LIVE</span>
    </div>
  </div>
);

export default function ChildCryAlertScreen() {
  const [latestAlert, setLatestAlert] = useState(null);
  const navigate = useNavigate();

  // NOTE: userId is no longer needed here - the server derives the caller from
  // the bearer token, which is exactly the point (no client-supplied parent).

  // ---- PHASE 11: real incident source, no legacy endpoint, no public room ----
  // Replaces a poll of `/cry-detection/latest`, which read the stale EDMX
  // CryAlert mapping and returned a RoomName that this screen then joined on
  // an external room. That was both a false success (the legacy
  // rows were never escalated) and a room-name-only access path.
  //
  // The incident now comes from the same server-authoritative endpoint the rest
  // of monitoring uses, discovered through the guardian-aware scope list. This
  // screen states the incident; the live feed is owned by /baby-monitoring,
  // which asks the server for a media session and fails closed.
  useEffect(() => {
    let mounted = true;
    let scope = null;

    const check = async () => {
      try {
        if (!scope) {
          const scopes = await API.getAccessibleMonitoringScopes();
          if (!scopes?.length) return;
          scope = scopes[0];
        }
        const incident = await API.getCryIncident(scope.JobId, scope.ChildId);
        if (mounted) setLatestAlert(incident || null);
      } catch {
        // Never invent an alert, and never clear a real one on a poll failure.
      }
    };

    check();
    const interval = setInterval(() => {
      if (!document.hidden) check();
    }, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // "View Child" no longer starts an embedded call from a room name. It opens
  // the monitoring screen, which is where the server-issued media session lives.
  const handleJoinCall = () => {
    navigate('/baby-monitoring');
  };

  // Main Cry alert UI
  return (
    <div className={styles.screenContainer}>
      {/* Header */}
      <header className={styles.topNav}>
        <BackButton />
        <h1 className={styles.pageTitle}>Cry Alert</h1>
        <div style={{ width: 42 }} />
      </header>

      {latestAlert ? (
        <div className={styles.alertCard}>
          {/* Bell Icon Circle */}
          <div className={styles.bellCircle}>
            <Icons.bell />
          </div>

          {/* Alert messages with timestamp */}
          <h2 className={styles.alertHeadline}>
            Baby is crying loudly
          </h2>
          <p className={styles.alertSubtext}>
            Urgent acoustic disturbance detected in the nursery
          </p>
          <p className={styles.alertTime}>
            {latestAlert.timestamp ? new Date(latestAlert.timestamp).toLocaleTimeString() : 'Just now'}
          </p>

          {/* 16:9 Live Camera Feed Frame */}
          <div className={styles.cameraFrame} style={{ width: '100%', margin: '0 0 var(--space-4, 16px)' }}>
            <LiveCameraPreview />
          </div>

          {/* Join Call Action */}
          <button
            type="button"
            onClick={handleJoinCall}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              width: '100%',
              padding: '16px 0',
              background: 'var(--color-primary, var(--color-primary))',
              border: 'none',
              borderRadius: 'var(--radius-xl, 16px)',
              fontWeight: '700',
              fontSize: '15px',
              color: 'var(--color-text-inverse)',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgb(var(--primary-rgb) / 0.35)',
              transition: 'transform 0.15s ease',
            }}
          >
            <Icons.videocam />
            Join Video Call
          </button>
        </div>
      ) : (
        <div style={{ padding: 'var(--space-6, 24px) var(--space-4, 16px)' }}>
          <EmptyState
            icon="ðŸ””"
            title="No Recent Alerts"
            description="Your baby is resting peacefully. Nursery acoustic detection is active and standing by."
          />
        </div>
      )}

      {/* Unified Parent Bottom Navigation */}
      <ParentBottomNav />
    </div>
  );
}


