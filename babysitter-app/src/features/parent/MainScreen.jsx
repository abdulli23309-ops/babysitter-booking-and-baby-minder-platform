import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';

const orange = 'var(--color-primary)';

/* ── SVG Icons ──────────────────────────── */
const Icons = {
  playCircleOutline: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M8 5.14v14.72a1 1 0 0 0 1.5.86l11-7.36a1 1 0 0 0 0-1.72l-11-7.36A1 1 0 0 0 8 5.14z" />
    </svg>
  ),
  videocamOutline: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-surface-inverse)" strokeWidth="2">
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
  personOutline: () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  jobsOutline: () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <circle cx="12" cy="14" r="1.5" fill="var(--color-info)" stroke="none" />
    </svg>
  ),
  sitterProfileOutline: () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-purple)" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 10h8M8 14h5" />
      <circle cx="17" cy="17" r="4" fill="var(--badge-purple-bg)" stroke="var(--color-purple)" />
      <path d="M15.5 17h3M17 15.5v3" strokeWidth="1.8" />
    </svg>
  ),
};

/* ── Pulse Dot ── */
const pulseDotStyles = `
  @keyframes pulse-ring {
    0% { transform: scale(1); opacity: 1; }
    100% { transform: scale(2.4); opacity: 0; }
  }
  .pulse-dot {
    position: relative;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-danger);
    flex-shrink: 0;
  }
  .pulse-dot::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--color-danger);
    animation: pulse-ring 1.4s infinite;
  }
`;

const PulseDot = () => (
  <>
    <style>{pulseDotStyles}</style>
    <div className="pulse-dot" />
  </>
);

/* ── Quick Action Item ── */
const QuickAction = ({ iconEl, iconBg, title, subtitle, onClick, last }) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      padding: '16px 0',
      borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)',
      cursor: 'pointer',
    }}
  >
    <div
      style={{
        width: '52px',
        height: '52px',
        borderRadius: '16px',
        background: iconBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {iconEl}
    </div>
    <div>
      <p style={{ margin: 0, fontWeight: 800, fontSize: '15px', color: 'var(--color-text)' }}>{title}</p>
      <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>{subtitle}</p>
    </div>
  </div>
);

/* ── Main Component ── */
const MainScreen = () => {
  const navigate = useNavigate();

  // ----- Load logged‑in user data -----
  const [userData] = useState(() => {
    try {
      const userStr = localStorage.getItem('user');
      return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      console.error('Failed to parse user data', e);
      return null;
    }
  });

  const [greeting] = useState(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning,';
    if (h < 17) return 'Good Afternoon,';
    return 'Good Evening,';
  });

  const parentName = userData?.name || userData?.FullName || 'Parent';
  const parentPic = userData?.pictureAddress || userData?.PictureAddress || null;

  const buildImageUrl = (pic) => {
    if (!pic) return null;
    if (pic.startsWith('http') || pic.startsWith('data:')) return pic;
    const parts = pic.split('/');
    if (parts.length === 2) {
      const [type, filename] = parts;
      return `/api/images/${type}/${filename}`;
    }
    return `/api/images/default/${pic}`;
  };

  const avatarUrl = buildImageUrl(parentPic);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--gradient-pastel-soft)',
        paddingBottom: '100px',
        fontFamily: "'Nunito', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '48px 24px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', margin: 0, fontWeight: 600 }}>{greeting}</p>
          <h2 style={{ margin: 0, fontWeight: 900, fontSize: '26px', color: 'var(--color-text)' }}>{parentName}</h2>
        </div>
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            overflow: 'hidden',
            border: '3px solid var(--glass-border)',
            boxShadow: '0 4px 12px rgb(var(--shadow-ink-rgb) / 0.15)',
            background: '#c9a87c',
            flexShrink: 0,
          }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={parentName}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-inverse)',
                fontWeight: 800,
                fontSize: '20px',
              }}
            >
              {parentName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Monitor Card */}
      <div style={{ padding: '8px 16px' }}>
        <div
          onClick={() => navigate('/monitor')}
          style={{
            background: orange,
            padding: '20px',
            borderRadius: '24px',
            color: 'var(--color-text-inverse)',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 8px 30px rgb(var(--primary-rgb) / 0.45)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '-30px',
              right: '-30px',
              width: '120px',
              height: '120px',
              background: 'rgb(var(--edge-rgb) / 0.08)',
              borderRadius: '50%',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '-40px',
              right: '20px',
              width: '100px',
              height: '100px',
              background: 'rgb(var(--edge-rgb) / 0.06)',
              borderRadius: '50%',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgb(var(--edge-rgb) / 0.2)',
                padding: '6px 14px',
                borderRadius: '20px',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              <PulseDot />
              LIVE NOW
            </div>
            <div
              style={{
                width: '40px',
                height: '40px',
                background: 'rgb(var(--edge-rgb) / 0.2)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icons.videocamOutline />
            </div>
          </div>
          <h2 style={{ fontSize: '28px', fontWeight: 900, margin: '0 0 4px', lineHeight: 1.1 }}>Monitor Child</h2>
          <p style={{ fontSize: '13px', opacity: 0.85, margin: '0 0 16px' }}>Watch your little one in real-time</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/monitor');
            }}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '50px',
              border: 'none',
              background: 'var(--color-surface)',
              color: orange,
              fontWeight: 800,
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.5px',
            }}
          >
            <Icons.playCircleOutline /> START VIEWING
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ padding: '20px 20px 0' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '14px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-text)' }}>Quick Actions</h3>
          <span
            style={{ color: orange, cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}
            onClick={() => navigate('/parent-dashboard')}
          >
            View All
          </span>
        </div>
        <div
          style={{
            background: 'var(--color-surface)',
            borderRadius: '24px',
            padding: '4px 16px',
            boxShadow: '0 4px 20px rgb(var(--shadow-ink-rgb) / 0.06)',
          }}
        >
          <QuickAction
            iconEl={<Icons.personOutline />}
            iconBg="var(--color-primary-tint)"
            title="View Child"
            subtitle="Activity logs & stats"
            onClick={() => navigate('/child-job-profile')}
          />
          <QuickAction
            iconEl={<Icons.jobsOutline />}
            iconBg="var(--color-info-tint)"
            title="My Jobs"
            subtitle="Upcoming care sessions"
            onClick={() => navigate('/my-jobs')}
          />
          <QuickAction
            iconEl={<Icons.sitterProfileOutline />}
            iconBg="var(--color-primary-tint)"
            title="Sitter Profile"
            subtitle="Manage caregiver info"
            onClick={() => navigate('/sitter-profile')}
            last
          />
        </div>
      </div>

      {/* Shared Parent Bottom Navigation */}
      <ParentBottomNav />
    </div>
  );
};

export default MainScreen;

