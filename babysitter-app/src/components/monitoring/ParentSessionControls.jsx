/**
 * ParentSessionControls - Phase 9.1 Premium Active Session.
 *
 * WHAT THIS IS
 *   The Parent's half of the Active Session screen. The two roles share one
 *   screen, but they never share controls: a parent is a security/decision
 *   surface (pause, reach the sitter, end the session) while a sitter is a
 *   reporting surface. Keeping the parent's buttons in their own component is
 *   what guarantees a sitter is never offered "End Session".
 *
 * EVERY ACTION IS A REAL SERVER CALL
 *   None of these buttons is decorative and none of them invents a local
 *   state change. Pause calls the real pause endpoint (which requires a
 *   second guardian to approve - the server owns that), and End Session calls
 *   the real session-end endpoint, which also cancels open cry incidents. If
 *   the server refuses, this component reports the refusal; it never
 *   optimistically flips a button to look like it worked.
 *
 * The cyan accent is the parent's signature on this screen, deliberately
 * distinct from the emerald "Live" dot and the sitter's dark action cards.
 */
import styles from './parent-session-controls.module.css';

const PauseIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6.5" y="5" width="4" height="14" rx="1.4" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.4" />
  </svg>
);

const CallIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 16.4v2.6a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.8-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 3 4.8 1.8 1.8 0 0 1 4.8 3h2.6a1.8 1.8 0 0 1 1.8 1.6c.1.9.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14.4 14.4 0 0 0 5.4 5.4l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.6.5 2.5.6a1.8 1.8 0 0 1 1.8 1.8z" />
  </svg>
);

const EndIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.5 6.5a9 9 0 1 1-2.2 6.6" />
    <path d="M3.2 12.9h4.1" />
    <path d="M4.3 8.9l3 4" />
  </svg>
);

export default function ParentSessionControls({
  onPause,
  onEndSession,
  sitterPhone,
  pausing = false,
  ending = false,
  pauseRequested = false,
}) {
  /* "Call Babysitter" is only offered when the server actually returned a
     number. Rendering a dead tel: link that dials nothing is worse than not
     offering the action at all. */
  const canCall = Boolean(sitterPhone);

  return (
    <section className={styles.panel} aria-label="Session controls">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Session controls</h3>
        <p className={styles.panelSubtitle}>
          Pause alerts, reach your sitter, or wrap up the session.
        </p>
      </header>

      <div className={styles.actions}>
        {/* PRIMARY - cyan. Pausing asks the OTHER guardian to approve; it never
            pauses monitoring on its own, and the label says so. */}
        <button
          type="button"
          className={styles.action}
          data-tone="primary"
          onClick={onPause}
          disabled={pausing || pauseRequested}
          aria-disabled={pausing || pauseRequested}
        >
          <span className={styles.actionIcon}>
            <PauseIcon />
          </span>
          <span className={styles.actionLabel}>
            {pauseRequested ? 'Pause requested' : pausing ? 'Requesting...' : 'Pause Monitoring'}
          </span>
        </button>

        {/* SECONDARY - a real tel: link when the number is known, and simply
            not rendered when it is not. */}
        {canCall ? (
          <a className={styles.action} data-tone="secondary" href={`tel:${sitterPhone}`}>
            <span className={styles.actionIcon}>
              <CallIcon />
            </span>
            <span className={styles.actionLabel}>Call Babysitter</span>
          </a>
        ) : null}

        {/* DESTRUCTIVE - red. Ending the session also cancels any open cry
            incident server-side, so it is visually separated from the others. */}
        <button
          type="button"
          className={styles.action}
          data-tone="danger"
          onClick={onEndSession}
          disabled={ending}
          aria-disabled={ending}
        >
          <span className={styles.actionIcon}>
            <EndIcon />
          </span>
          <span className={styles.actionLabel}>
            {ending ? 'Ending...' : 'End Session'}
          </span>
        </button>
      </div>

      {/* When no sitter number came back, say why the call button is absent
          rather than letting the row look accidentally incomplete. */}
      {!canCall ? (
        <p className={styles.note}>
          A sitter contact number was not provided for this booking, so calling is
          unavailable here.
        </p>
      ) : null}
    </section>
  );
}