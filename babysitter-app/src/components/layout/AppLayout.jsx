import { useCallback, useState } from 'react';
import MobileMenu from './MobileMenu';
import ScrollProgressBar from './ScrollProgressBar';
import StickyHeader from './StickyHeader';
import FloatingContactButton from './FloatingContactButton';
import CookieBanner from './CookieBanner';
import styles from './app-layout.module.css';

/**
 * AppLayout — Phase F-UI-11 (Phase 1) + F-UI-12 (Step 4).
 *
 * Owns the global app chrome for the 480px shell:
 *  - two keyboard "skip to content" escape hatches (visually hidden until focused)
 *  - the scroll progress bar
 *  - the scroll-revealed sticky header (brand, page title, dark mode, menu)
 *  - the mobile menu drawer
 *  - the floating contact button (FAB) — pinned above the toast viewport
 *  - the <main> landmark that the skip links target
 *
 * Screen content is untouched: each screen keeps its own in-content top bar.
 */
export default function AppLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to main content
      </a>
      <a className={styles.skipLink} href="#app-navigation">
        Skip to navigation
      </a>

      <ScrollProgressBar />
      <StickyHeader onOpenMenu={openMenu} menuOpen={menuOpen} />
      <MobileMenu open={menuOpen} onClose={closeMenu} />
      <FloatingContactButton />
      <CookieBanner />

      <main id="main-content" tabIndex={-1} className={styles.content}>
        {children}
      </main>
    </div>
  );
}


