import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { JitsiMeeting } from '@jitsi/react-sdk';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import styles from './baby-monitoring.module.css';

// ---------- SVG Icons ----------
const Icons = {
  chevronBack: () => (
    <svg width="20" height="20" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="328 112 184 256 328 400" />
    </svg>
  ),
  settings: () => (
    <svg width="20" height="20" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M262.29 192.31a64 64 0 1 0 57.4 57.4 64.13 64.13 0 0 0-57.4-57.4ZM416.39 256a154.34 154.34 0 0 1-1.53 20.79l45.21 35.46a10.81 10.81 0 0 1 2.45 13.75l-42.77 74a10.81 10.81 0 0 1-13.14 4.59l-44.9-18.08a16.11 16.11 0 0 0-15.17 1.75A164.48 164.48 0 0 1 325 400.8a15.94 15.94 0 0 0-8.82 12.14l-6.73 47.89a11.08 11.08 0 0 1-10.68 9.17h-85.54a11.11 11.11 0 0 1-10.69-8.87l-6.72-47.82a16.07 16.07 0 0 0-9-12.22 155.3 155.3 0 0 1-21.46-12.57 16 16 0 0 0-15.11-1.71l-44.89 18.07a10.81 10.81 0 0 1-13.14-4.58l-42.77-74a10.8 10.8 0 0 1 2.45-13.75l38.21-30a16.05 16.05 0 0 0 6-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16 16 0 0 0-6.07-13.94l-38.19-30A10.81 10.81 0 0 1 49.48 186l42.77-74a10.81 10.81 0 0 1 13.14-4.59l44.9 18.08a16.11 16.11 0 0 0 15.17-1.75A164.48 164.48 0 0 1 187 111.2a15.94 15.94 0 0 0 8.82-12.14l6.73-47.89A11.08 11.08 0 0 1 213.23 42h85.54a11.11 11.11 0 0 1 10.69 8.87l6.72 47.82a16.07 16.07 0 0 0 9 12.22 155.3 155.3 0 0 1 21.46 12.57 16 16 0 0 0 15.11 1.71l44.89-18.07a10.81 10.81 0 0 1 13.14 4.58l42.77 74a10.8 10.8 0 0 1-2.45 13.75l-38.21 30a16.05 16.05 0 0 0-6.05 14.08c.33 4.14.55 8.3.55 12.47Z" />
    </svg>
  ),
  videocam: () => (
    <svg width="24" height="24" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M374.79 308.78 457.5 367a16 16 0 0 0 22.5-14.62V159.62A16 16 0 0 0 457.5 145l-82.71 58.22A16 16 0 0 0 368 216.3v79.4a16 16 0 0 0 6.79 13.08Z" />
      <rect x="44" y="144" width="308" height="224" rx="16" ry="16" />
    </svg>
  ),
  mic: () => (
    <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M256 352a96 96 0 0 0 96-96V160a96 96 0 0 0-192 0v96a96 96 0 0 0 96 96Z" />
      <path d="M160 256c0 52.93 43.06 96 96 96s96-43.07 96-96" fill="none" strokeWidth="32"/>
      <line x1="256" y1="352" x2="256" y2="432" strokeWidth="32"/>
      <line x1="192" y1="432" x2="320" y2="432" strokeWidth="32"/>
    </svg>
  ),
  callEnd: () => (
    <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor" stroke="currentColor" strokeWidth="8">
      <path d="M497 370.13c-8.33-16.67-31.9-26.3-31.9-26.3l-86.7-38.87c-18.33-8.34-41.67-.83-51.67 11.67l-37.5 45.84c-62.5-31.67-107.29-78.33-135.42-135.42l45.84-37.5c12.5-10 20-33.33 11.67-51.67l-38.87-86.7S164.78 23.55 148.11 15.22C130.61 6.89 92.78 15.22 92.78 15.22l-72.9 72.9c-11.67 11.67-16.67 27.5-12.5 45 16.67 75 83.33 195 156.25 268.75 73.75 72.92 193.75 139.58 268.75 156.25 17.5 4.17 33.33-.83 45-12.5l72.9-72.9s8.33-37.83 0-54.59Z" />
    </svg>
  ),
  shield: () => (
    <svg width="12" height="12" viewBox="0 0 512 512" fill="white" stroke="white" strokeWidth="8">
      <path d="M256 32 32 144v112c0 121.84 82.08 235.68 224 272 141.92-36.32 224-150.16 224-272V144Z" />
    </svg>
  ),
  thermometer: () => (
    <svg width="12" height="12" viewBox="0 0 512 512" fill="white" stroke="white" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M352 80a80 80 0 0 0-160 0v214.68a144 144 0 1 0 160 0Z" />
      <line x1="256" y1="272" x2="256" y2="416" />
      <circle cx="256" cy="416" r="48" fill="white" stroke="none"/>
    </svg>
  ),
  drop: () => (
    <svg width="12" height="12" viewBox="0 0 512 512" fill="white" stroke="white" strokeWidth="8">
      <path d="M256 32C198 109 128 191.06 128 260a128 128 0 0 0 256 0c0-69-70-151-128-228Z" />
    </svg>
  ),
};

// ---------- Nursery Camera Scene ----------
const NurseryCameraFeed = () => (
  <div style={{ position: 'relative', width: '100%', height: '100%', background: '#e8e0d8', overflow: 'hidden' }}>
    <svg width="100%" height="100%" viewBox="0 0 360 230" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
      <rect width="360" height="230" fill="#f0ece6" />
      <rect x="0" y="175" width="360" height="55" fill="#ddd5c8" />
      <rect x="0" y="0" width="360" height="175" fill="#f5f1ec" />

      {/* Wall art frame 1 */}
      <rect x="100" y="18" width="65" height="82" rx="4" fill="#c8a87a" />
      <rect x="105" y="23" width="55" height="72" rx="3" fill="#e8d9c4" />
      <ellipse cx="132" cy="52" rx="12" ry="16" fill="#c8956a" opacity="0.7"/>
      <rect x="128" y="62" width="4" height="20" rx="2" fill="#c8956a" opacity="0.7"/>
      <rect x="136" y="62" width="4" height="20" rx="2" fill="#c8956a" opacity="0.7"/>
      <ellipse cx="132" cy="42" rx="7" ry="9" fill="#c8956a" opacity="0.7"/>
      <rect x="130" y="33" width="3" height="8" rx="1" fill="#c8956a" opacity="0.7"/>

      {/* Wall art frame 2 */}
      <rect x="185" y="18" width="65" height="82" rx="4" fill="#c8a87a" />
      <rect x="190" y="23" width="55" height="72" rx="3" fill="#e8d9c4" />
      <circle cx="217" cy="55" r="18" fill="none" stroke="#c8956a" strokeWidth="2" opacity="0.6"/>
      <circle cx="217" cy="55" r="10" fill="none" stroke="#c8956a" strokeWidth="1.5" opacity="0.6"/>
      <circle cx="217" cy="55" r="4" fill="#c8956a" opacity="0.5"/>
      {[0,60,120,180,240,300].map((a, i) => (
        <ellipse key={i} cx={217 + 18*Math.cos(a*Math.PI/180)} cy={55 + 18*Math.sin(a*Math.PI/180)} rx="4" ry="6"
          transform={`rotate(${a}, ${217 + 18*Math.cos(a*Math.PI/180)}, ${55 + 18*Math.sin(a*Math.PI/180)})`}
          fill="#c8956a" opacity="0.4"/>
      ))}

      {/* Dresser right */}
      <rect x="295" y="80" width="65" height="110" rx="6" fill="#c4a472" />
      <rect x="300" y="86" width="55" height="48" rx="4" fill="#d4b482" />
      <rect x="300" y="140" width="55" height="44" rx="4" fill="#d4b482" />
      <circle cx="327" cy="112" r="4" fill="#a08050" />
      <circle cx="327" cy="163" r="4" fill="#a08050" />
      <rect x="300" y="68" width="20" height="14" rx="3" fill="#d4c4a8" />
      <rect x="326" y="62" width="12" height="20" rx="3" fill="#e8d4b8" />
      <rect x="342" y="66" width="14" height="16" rx="3" fill="#c8b890" />

      {/* Plant left */}
      <rect x="18" y="158" width="20" height="20" rx="4" fill="#8B6914" />
      <ellipse cx="28" cy="155" rx="28" ry="22" fill="#3a7a3a" />
      <ellipse cx="15" cy="148" rx="18" ry="14" fill="#4a8a4a" />
      <ellipse cx="42" cy="148" rx="16" ry="12" fill="#2a6a2a" />
      <ellipse cx="28" cy="138" rx="12" ry="16" fill="#3a7a3a" />

      {/* Crib */}
      <rect x="68" y="108" width="220" height="75" rx="8" fill="#d4b896" />
      <rect x="73" y="148" width="210" height="28" rx="4" fill="#e8ddd0" />
      <rect x="68" y="140" width="220" height="10" rx="4" fill="#c4a880" />
      <rect x="62" y="100" width="14" height="90" rx="6" fill="#c4a880" />
      <rect x="280" y="100" width="14" height="90" rx="6" fill="#c4a880" />
      {Array.from({length: 14}, (_, i) => (
        <rect key={i} x={80 + i * 15} y={112} width="5" height="62" rx="2.5" fill="#c8ac86" />
      ))}
      <rect x="68" y="185" width="10" height="20" rx="4" fill="#b89870" />
      <rect x="278" y="185" width="10" height="20" rx="4" fill="#b89870" />
      <ellipse cx="178" cy="204" rx="100" ry="6" fill="#00000015"/>
    </svg>

    {/* Overlaid sensor badges */}
    <div className={styles.sensorOverlay}>
      <div className={styles.sensorBadge}>
        <Icons.thermometer />
        <span>22°C</span>
      </div>
      <div className={styles.sensorBadge}>
        <Icons.drop />
        <span>45%</span>
      </div>
    </div>

    <div className={styles.secureBadge}>
      <Icons.shield />
      <span>Secure Connection</span>
    </div>
  </div>
);

export default function BabyMonitoringScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const roomName = location.state?.roomName;

  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  return (
    <div className={styles.screenContainer}>
      {/* Top Bar */}
      <header className={styles.topNav}>
        <BackButton />
        <h1 className={styles.pageTitle}>Baby Monitor</h1>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Settings"
          onClick={() => navigate('/parent-dashboard')}
        >
          <Icons.settings />
        </button>
      </header>

      {/* Live Badge & Subtitle */}
      <div className={styles.statusHeader}>
        <div className={styles.livePill}>
          <span className={styles.liveBeacon} aria-hidden="true" />
          <span className={styles.liveTag}>LIVE</span>
        </div>
        <p className={styles.locationSubtitle}>Nursery · HD 1080p</p>
      </div>

      {/* 16:9 Responsive Glassmorphic Camera Frame */}
      <div className={styles.cameraFrame}>
        {roomName ? (
          <JitsiMeeting
            roomName={roomName}
            domain="meet.jit.si"
            configOverwrite={{
              startWithAudioMuted: !micOn,
              startWithVideoMuted: !cameraOn,
              disableDeepLinking: true,
            }}
            interfaceConfigOverwrite={{
              SHOW_JITSI_WATERMARK: false,
              SHOW_WATERMARK_FOR_GUESTS: false,
              TOOLBAR_BUTTONS: ['microphone', 'camera', 'fullscreen', 'hangup'],
            }}
            getIFrameRef={(iframe) => {
              if (iframe) {
                iframe.style.height = '100%';
                iframe.style.width = '100%';
                iframe.style.border = 'none';
              }
            }}
          />
        ) : (
          <NurseryCameraFeed />
        )}
      </div>

      {/* Hardware / Session Controls */}
      <div className={styles.controlsRow}>
        {/* Camera toggle */}
        <div className={styles.controlItem}>
          <button
            type="button"
            onClick={() => setCameraOn(!cameraOn)}
            className={`${styles.controlBtn} ${cameraOn ? styles.controlBtnDefault : styles.controlBtnDanger}`}
            aria-label={cameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
          >
            <Icons.videocam />
          </button>
          <span className={styles.controlLabel}>{cameraOn ? 'Camera On' : 'Camera Off'}</span>
        </div>

        {/* Mic toggle */}
        <div className={styles.controlItem}>
          <button
            type="button"
            onClick={() => setMicOn(!micOn)}
            className={`${styles.controlBtn} ${micOn ? styles.controlBtnPrimary : styles.controlBtnDefault}`}
            aria-label={micOn ? 'Mute Microphone' : 'Unmute Microphone'}
          >
            <Icons.mic />
          </button>
          <span className={styles.controlLabel}>{micOn ? 'Mic Active' : 'Mic Muted'}</span>
        </div>

        {/* End / Return */}
        <div className={styles.controlItem}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className={`${styles.controlBtn} ${styles.controlBtnDanger}`}
            aria-label="Exit Monitor"
          >
            <Icons.callEnd />
          </button>
          <span className={styles.controlLabel}>Exit</span>
        </div>
      </div>

      {/* Bottom Navigation */}
      <ParentBottomNav />
    </div>
  );
}

