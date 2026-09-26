import { useState } from 'react';
import styles from './cookie-banner.module.css';

const STORAGE_KEY = 'littlecare_cookies_accepted';

/**
 * CookieBanner — Phase 3/4 Batch B, Step 4.
 * Bottom-fixed dismissible banner; "Accept" persists to localStorage.
 */
export default function CookieBanner() {
  // Read localStorage lazily so there is no setState-in-effect and no
  // post-mount flash: the banner simply never mounts if already accepted.
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '1';
    } catch {
      /* storage blocked — show banner each visit */
      return true;
    }
  });

  const handleAccept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className={styles.banner} role="region" aria-label="Cookie notice">
      <p className={styles.text}>
        We use cookies to improve your experience.
      </p>
      <button type="button" className={styles.acceptBtn} onClick={handleAccept}>
        Accept
      </button>
    </div>
  );
}
