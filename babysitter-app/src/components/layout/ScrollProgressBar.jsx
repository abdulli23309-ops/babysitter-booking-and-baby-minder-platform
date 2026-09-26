import { useEffect, useRef } from 'react';
import { subscribeToScroll } from './scrollMetrics';
import styles from './scroll-progress.module.css';

/**
 * Scroll Progress Bar — Phase F-UI-11 (Phase 1).
 *
 * A 3px bar pinned to the very top of the app shell that fills left-to-right
 * as the reader scrolls. Purely decorative (aria-hidden) and rAF-throttled;
 * it writes straight to the DOM node so scrolling never re-renders React.
 */
export default function ScrollProgressBar() {
  const barRef = useRef(null);

  useEffect(
    () =>
      subscribeToScroll(({ progress }) => {
        const bar = barRef.current;
        if (!bar) return;
        bar.style.transform = `scaleX(${progress})`;
        bar.style.opacity = progress > 0 ? '1' : '0';
      }),
    []
  );

  return (
    <div className={styles.track} aria-hidden="true">
      <span ref={barRef} className={styles.bar} />
    </div>
  );
}