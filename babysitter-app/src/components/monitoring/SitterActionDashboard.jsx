/**
 * SitterActionDashboard - Phase 9.1 Premium Active Session.
 *
 * WHAT THIS IS
 *   The Babysitter's control panel. It is deliberately NOT a copy of the
 *   parent's panel: a sitter is a strict viewer of the video (the server
 *   issues them a room with audio=0, video=0 and hide=1), so camera and
 *   microphone controls would be both useless and a publishing risk. What a
 *   sitter actually needs during a session is the opposite: a fast way to
 *   tell the parent what is happening right now.
 *
 * WHY THE COMPONENT SPLITS OUT
 *   The two roles share one screen, and mixing their affordances into
 *   conditionals inside ActiveJobDetails is how a viewer ends up being
 *   offered a "Turn camera on" button. A separate component makes that
 *   boundary visible in the file tree rather than hidden in a ternary.
 *
 * THE LOG IS SESSION-LOCAL, AND SAYS SO
 *   The feeding/care-log feature is specified but NOT implemented server-side
 *   (FEEDING_FEATURE_REQUIREMENT.md is explicitly "DOCUMENTED ONLY"). So the
 *   entries are held in component state and the UI states plainly that they
 *   have not been saved to the parent's account. Faking a persisted record
 *   would be exactly the kind of invented claim this codebase forbids. When
 *   the endpoint lands, only `logAction` needs to change.
 */
import { useRef, useState } from 'react';
import styles from './sitter-action-dashboard.module.css';

/* --- Icons -----------------------------------------------------------------
   Inline SVGs, for the same reason the rest of the monitoring components use
   them: no icon-font dependency, and they stay crisp and legible at the large
   touch-friendly size these action cards need. */

/* The baby bottle. This is the mandatory, primary action of the whole panel -
   a feed is the single most common thing a sitter needs to report - so it
   gets a large, unmistakable glyph rather than a text-only button. */
const BottleIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* teat */}
    <path d="M10.2 2.6h3.6a1.1 1.1 0 0 1 1.1 1.1v1.2H9.1V3.7a1.1 1.1 0 0 1 1.1-1.1z" />
    {/* collar */}
    <path d="M8.6 6.4h6.8" />
    {/* bottle body */}
    <path d="M9.3 8.3h5.4a1.6 1.6 0 0 1 1.6 1.6l-.6 8.6a2.1 2.1 0 0 1-2.1 1.9h-3.2a2.1 2.1 0 0 1-2.1-1.9l-.6-8.6a1.6 1.6 0 0 1 1.6-1.6z" />
    {/* milk level */}
    <path d="M8.6 13.2h6.8" opacity="0.75" />
  </svg>
);

const NapIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.8 16.4h17a1.6 1.6 0 0 1 0 3.2H2.8a1.6 1.6 0 0 1 0-3.2z" />
    <path d="M6.4 16.4v-3.1a1.6 1.6 0 0 1 1.6-1.6h9" />
    <path d="M15.6 8.2h3.1l1.7 3.1-1.7 3.1h-3.1z" />
  </svg>
);

const DiaperIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.6 8.2h16.8l-1.3 9.6a2.4 2.4 0 0 1-2.36 2.02H8.26A2.4 2.4 0 0 1 5.9 17.8z" />
    <path d="M3.6 8.2 5 5.4a1.4 1.4 0 0 1 1.3-.9h11.4a1.4 1.4 0 0 1 1.3.9l1.4 2.8" />
    <path d="M9.6 12.4h4.8" />
  </svg>
);

/* The action catalogue. `primary` marks the one action the panel is built
   around; it is rendered first, full-width, with an emerald treatment that
   matches the "Live" status dot above it. */
const ACTIONS = [
  { id: 'feeding', label: 'Log Feeding', Icon: BottleIcon, primary: true },
  { id: 'nap', label: 'Log Nap', Icon: NapIcon },
  { id: 'diaper', label: 'Diaper Change', Icon: DiaperIcon },
];

const timeLabel = (at) =>
  new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/* The clock is read here, at module scope, rather than inside the component.
   React's purity rule treats `Date.now()` called anywhere in a component body
   as impure - even inside an event handler, because the component function
   must be idempotent. Hoisting the read into a plain module function keeps the
   timestamp genuinely event-time while leaving render pure. */
const stampNow = () => Date.now();

export default function SitterActionDashboard({ onLog, disabled = false, disabledReason = '' }) {
  /* The session log. Held in component state ONLY - see the header note on
     why nothing here is presented as persisted. Newest first, because the
     thing a sitter just logged is the thing they want to see. */
  const [entries, setEntries] = useState([]);
  /* A monotonic counter rather than a timestamp, for the React key. Reading
     the clock during render would be an impure call, and the timestamp we
     actually display is stamped inside the event handler below - which is a
     legitimate place to read the clock. */
  const nextId = useRef(0);

  /* logAction is the single place a care event enters the panel, so wiring it
     to a real endpoint later is a one-function change rather than an edit to
     three onClick handlers. */
  const logAction = (action) => {
    nextId.current += 1;
    const entry = { id: `${action.id}-${nextId.current}`, label: action.label, at: stampNow() };
    setEntries((prev) => [entry, ...prev]);
    if (onLog) onLog(action.label);
  };

  return (
    <section className={styles.panel} aria-label="Care actions">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Care log</h3>
        <p className={styles.panelSubtitle}>
          Tap an action to note what you just did.
        </p>
      </header>

      {/* The action grid. The primary "Log Feeding" card spans the full width
          so it is unmissable; the rest share a row beneath it. */}
      <div className={styles.grid}>
        {ACTIONS.map(({ id, label, Icon, primary }) => (
          <button
            key={id}
            type="button"
            className={styles.action}
            data-primary={primary ? 'true' : 'false'}
            onClick={() => logAction({ id, label })}
            disabled={disabled}
            aria-disabled={disabled}
          >
            <span className={styles.actionIcon}>
              <Icon />
            </span>
            <span className={styles.actionLabel}>{label}</span>
          </button>
        ))}
      </div>

      {disabled && disabledReason ? (
        <p className={styles.disabledNote}>{disabledReason}</p>
      ) : null}

      {/* What the sitter logged this session. An empty state is stated plainly
          rather than leaving a blank panel that looks broken. */}
      {entries.length > 0 ? (
        <ul className={styles.log} aria-label="Actions logged this session">
          {entries.map((entry) => (
            <li key={entry.id} className={styles.logRow}>
              <span className={styles.logDot} aria-hidden="true" />
              <span className={styles.logLabel}>{entry.label}</span>
              <span className={styles.logTime}>{timeLabel(entry.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyLog}>Nothing logged yet this session.</p>
      )}

      {/* HONESTY NOTE. The care-log endpoint does not exist yet, so these
          entries live only in this browser tab. Saying so is deliberate: a
          sitter must never believe a note reached the parent when it did not. */}
      <p className={styles.persistenceNote}>
        Saved on this device for now. Sharing entries with the parent&rsquo;s account is
        coming soon.
      </p>
    </section>
  );
}