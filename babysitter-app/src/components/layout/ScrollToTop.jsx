import { useEffect, useState } from 'react';
import styles from './scroll-to-top.module.css';

const SCROLL_THRESHOLD = 300;

/**
 * ScrollToTop — Phase F-UI-12 (Phase 3, Step 2).
 *
 * Circular button pinned to the bottom-left (offset from the FloatingContact
 * FAB on the right). Only rendered once the user has scrolled past 300px.
 * Uses rAF-throttled passive scroll listener so it never janks the main
 * thread, and honours prefers-reduced-motion via CSS.
 */
export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setVisible(window.scrollY > SCROLL_THRESHOLD);
        raf = 0;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className={styles.toTop}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Scroll back to top"
      title="Back to top"
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
        aria-hidden="true"
      >
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  );
}
