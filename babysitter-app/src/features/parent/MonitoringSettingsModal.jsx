/**
 * MonitoringSettingsModal - PHASE 9.2.
 *
 * WHY THE ADMINISTRATIVE SURFACE MOVED OUT OF THE MAIN FLOW
 *   The "Family & guardians", "Monitoring pause" and "Do not disturb" cards are
 *   real, useful and parent-only - but they are ADMINISTRATION, not monitoring.
 *   Sitting them in the main column pushed the video far enough down that the
 *   thing the parent opened the app to see was below the fold, next to a wall of
 *   controls they almost never touch during a sitting.
 *
 *   So the main screen keeps ONE thing prominent (the feed and its single status
 *   pill) and everything else moves behind the gear icon they already had. This
 *   component is a thin MODAL SHELL: it owns the dialog semantics, the heading
 * and the focus behaviour, then renders `Phase7FamilyPanel` untouched.
 *
 * WHY IT RENDERS Phase7FamilyPanel VERBATIM
 *   Phase7FamilyPanel is the tested implementation of the guardian/pause/DND
 *   rules, including its own polling, its "hide a button is presentation only,
 *   never the rule" discipline, and its refusal to count a pause down from a
 *   client-chosen start. Re-implementing that here would risk reintroducing a
 *   client-authority bug in exchange for a layout change. So the content is
 *   moved, not rewritten.
 *
 * ACCESSIBILITY
 *   Built on the shared <Modal>, which supplies role="dialog", aria-modal, the
 *   focus trap, Escape-to-close, focus restore, and the body scroll lock. This
 *   component only adds the heading (referenced by aria-labelledby) and a
 *   close affordance.
 *
 * PROPS
 *   open                 - whether the dialog is shown.
 *   onClose              - called by the close button, Escape, or backdrop.
 *   role                 - 'parent' | 'babysitter'. The family surface is
 *                          PARENT-ONLY (every guardian/pause/DND endpoint is
 *                          guarded by [SessionAuthorize(Roles = "Parent")]), so a
 *                          sitter opening this modal is told the truth instead of
 *                          being shown buttons that would only ever 403.
 *   children             - the panels to render inside the dialog body.
 */
import { useId } from 'react';
import Modal from '../../components/ui/Modal';
import styles from './monitoring-settings-modal.module.css';

export default function MonitoringSettingsModal({ open, onClose, role, children }) {
  const headingId = useId();
  const isParent = role === 'parent';

  return (
    <Modal open={open} onClose={onClose} labelledBy={headingId}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 id={headingId} className={styles.title}>Monitoring settings</h2>
            <p className={styles.subtitle}>
              Guardians, pauses and do-not-disturb for this child.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close monitoring settings"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className={styles.body}>
          {isParent ? children : (
            /* Honest, and it names the real constraint rather than saying
               "not allowed": the family surface is a parent capability. */
            <div className={styles.notice}>
              <p className={styles.noticeTitle}>Guardian settings are managed by the parents</p>
              <p className={styles.noticeBody}>
                Adding or approving guardians, pausing monitoring and setting
                do-not-disturb are actions taken by a parent or guardian of this
                child. Your access to this session is the live view and the cry
                alerts you need to act on.
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}