// Phase F-UI-11 (Phase 1) — Scroll metric helpers for app chrome.
//
// The app shell (#root) is a min-height-constrained container, so scrolling
// currently happens on the document. These helpers read through
// document.scrollingElement and subscribe with capture = true so the chrome
// keeps working even if a later layout promotes #root to the scroller.
//
// Both are rAF-throttled: at most one measurement per animation frame.

/** @returns {{ scrollTop: number, progress: number, scrollable: number }} */
export function readScrollMetrics() {
  const scroller = document.scrollingElement || document.documentElement;
  const scrollTop = Math.max(scroller.scrollTop || window.scrollY || 0, 0);
  const scrollable = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
  const progress = scrollable > 0 ? Math.min(scrollTop / scrollable, 1) : 0;

  return { scrollTop, progress, scrollable };
}

/**
 * Subscribe to scroll/resize with rAF throttling.
 * @param {(metrics: { scrollTop: number, progress: number, scrollable: number }) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeToScroll(handler) {
  let frame = 0;

  const measure = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      handler(readScrollMetrics());
    });
  };

  measure();
  window.addEventListener('scroll', measure, { passive: true, capture: true });
  window.addEventListener('resize', measure, { passive: true });

  return () => {
    window.removeEventListener('scroll', measure, { capture: true });
    window.removeEventListener('resize', measure);
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}