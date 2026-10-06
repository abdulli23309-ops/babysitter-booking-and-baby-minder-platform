import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './modal.module.css';

/**
 * Accessible Modal (Phase F2 — infrastructure only).
 * Not yet applied to existing pages (deferred to F3/F4).
 *
 * PHASE 9.4 — PORTAL TO <body>.
 * The overlay used to render inline where the <Modal> was declared. Several
 * consumers sit inside elements with `backdrop-filter` / `transform` (e.g. the
 * Feeding Recordings glass panel), which makes those ancestors the containing
 * block for `position: fixed` children - so the overlay only covered the
 * panel's own box and the PAGE behind it (headings, eyebrow text) painted
 * straight through around/over the dialog. Rendering through a portal puts the
 * overlay directly under <body>, immune to any ancestor stacking context.
 *
 * Accessibility:
 *  - role="dialog" + aria-modal="true"
 *  - Focus is trapped inside while open
 *  - Escape key closes
 *  - Focus moves to the dialog on open and returns to the trigger on close
 */
export default function Modal({ open, onClose, labelledBy, variant = 'default', children }) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;

    const dialog = dialogRef.current;
    if (dialog) dialog.focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialog) {
        // Simple focus trap: cycle among focusable descendants.
        const focusables = dialog.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = overflow;
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  /* PHASE 9.4 - variant-aware shell class. 'player' stacks on top of the
     default .modal (padding + wider max-width + anchor for the floating
     close button) so shared styling is never duplicated. */
  const shellClass = [
    variant === 'compact' ? styles.modalCompact : styles.modal,
    variant === 'player' ? styles.modalPlayer : '',
  ].filter(Boolean).join(' ');

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={shellClass}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
