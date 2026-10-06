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

/* PHASE 9.3 - THE CARE LOG HAS EXACTLY ONE ACTION.
   "Log Feeding" is the single CTA: one press enters the care note AND (via
   `onRequestRecording`) joins the proven server-side feeding-video workflow
   for the same validated Job+Child scope. The babysitter never sees or
   operates the recording subsystem separately - request semantics, 409
   duplicate protection and server-confirmed completion all stay in
   ActiveJobDetails exactly as before.

   The former standalone "Record Feeding", "Log Nap" and "Diaper Change"
   actions are gone: two feeding-related buttons was always one too many. */
const ACTIONS = [
  { id: 'feeding', label: 'Log Feeding', Icon: BottleIcon, primary: true },
];

const timeLabel = (at) =>
  new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/* The clock is read here, at module scope, rather than inside the component.
   React's purity rule treats `Date.now()` called anywhere in a component body
   as impure - even inside an event handler, because the component function
   must be idempotent. Hoisting the read into a plain module function keeps the
   timestamp genuinely event-time while leaving render pure. */
const stampNow = () => Date.now();

export default function SitterActionDashboard({
  onRequestRecording,
  /* PHASE 3 - the recording action is now a FIVE-STATE machine supplied by
     ActiveJobDetails (the owner of the HTTP call and its completion poll):
       idle       - nothing in flight
       requesting - the POST /feeding/request round-trip is in the air
       requested  - the server ACCEPTED; the monitor device has the work.
                    NOT a success claim - a video exists only after the
                    server confirms Completion.
       completed  - completion CONFIRMED via the history endpoint
       conflict   - 409: another recording is already in flight
       failed     - the request itself failed
     `recordingDetail` carries the honest copy for conflict/failed, and for
     completed it carries the REAL duration reported by the server. */
  recordingState = 'idle',
  recordingDetail = null,
  disabled = false,
  disabledReason = '',
}) {
  /* The session log. Held in component state ONLY - see the header note on
     why nothing here is presented as persisted. Newest first, because the
     thing a sitter just logged is the thing they want to see. */
  const [entries, setEntries] = useState([]);
  /* A monotonic counter rather than a timestamp, for the React key. Reading
     the clock during render would be an impure call, and the timestamp we
     actually display is stamped inside the event handler below - which is a
     legitimate place to read the clock. */
  const nextId = useRef(0);

  /* PHASE 3 - the ONLY derivation needed here: the POST is in flight. The
     other recording states are presentation, driven by `recordingState`. */
  const recordingBusy = recordingState === 'requesting';
  const recordingActive = recordingState === 'requested';

  /* PHASE 9.3 - ONE CARE ACTION. The single "Log Feeding" press performs the
     first two steps of the unified workflow: the care note enters the
     session log, then `onRequestRecording` fires the existing feeding-video
     request for the same validated Job+Child scope. The note is NEVER rolled
     back if that request fails or returns 409 - the status cards below carry
     the server's honest verdict alongside the note that remains logged.
     Nothing here claims recording success; only `recordingState` (driven by
     the server via ActiveJobDetails) ever does that. */
  const logAction = (action) => {
    nextId.current += 1;
    const entry = { id: `${action.id}-${nextId.current}`, label: action.label, at: stampNow() };
    setEntries((prev) => [entry, ...prev]);
    if (onRequestRecording) onRequestRecording();
  };

  return (
    <section className={styles.panel} aria-label="Care actions">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Care log</h3>
        <p className={styles.panelSubtitle}>
          Tap an action to note what you just did.
        </p>
      </header>

      {/* PHASE 9.3 - THE SINGLE CARE LOG CTA. It fills the container width,
          and it carries the recording pipeline's busy/pending states because
          it is the pipeline's only trigger. The button is disabled only for
          the brief POST round-trip (recordingBusy) - never for the device's
          asynchronous record/upload - so the sitter is never blocked while
          the video is being made. */}
      <div className={styles.grid}>
        {ACTIONS.map(({ id, label, Icon, primary }) => (
          <button
            key={id}
            type="button"
            className={styles.action}
            data-primary={primary ? 'true' : 'false'}
            data-recording-active={recordingActive ? 'true' : 'false'}
            onClick={() => logAction({ id, label })}
            /* The request is a real server round-trip, so the button only
               disables itself while that POST is in flight. The recording
               itself stays asynchronous and never blocks this panel. */
            disabled={disabled || recordingBusy}
            aria-disabled={disabled || recordingBusy}
            aria-busy={recordingBusy ? 'true' : 'false'}
          >
            <span className={styles.actionIcon}>
              <Icon />
            </span>
            <span className={styles.actionLabel}>
              {/* Honest, state-aware label: the transient "Requesting…" shows
                  only while the POST is in the air; afterwards the label
                  returns to the care action and the status cards below carry
                  the server's verdict. */}
              {recordingBusy ? 'Requesting…' : label}
            </span>
          </button>
        ))}
      </div>

      {/* ---- PHASE 3 - THE RECORDING STATUS CARD --------------------------
          Every claim here is server-derived; none of it is inferred from a
          local click. "Requested" says exactly that. "Recorded successfully"
          appears ONLY after the history endpoint confirmed Completion for
          this request's own PublicId, and it quotes the REAL server duration.
          The 409 path shows the server's own semantic copy in amber - never
          a green tick, never a generic red shrug. */}
      {recordingState === 'requested' ? (
        <div className={styles.recordingCard} data-tone="active" role="status" aria-live="polite">
          <span className={styles.recordingDot} aria-hidden="true" />
          <div>
            <p className={styles.recordingTitle}>Feeding recording requested.</p>
            <p className={styles.recordingBody}>
              The monitor device is handling the recording.
            </p>
          </div>
        </div>
      ) : recordingState === 'completed' ? (
        <div className={styles.recordingCard} data-tone="success" role="status" aria-live="polite">
          <div>
            <p className={styles.recordingTitle}>✓ Feeding video recorded successfully</p>
            <p className={styles.recordingMeta}>
              {recordingDetail?.durationSeconds != null
                ? `${recordingDetail.durationSeconds} sec · Recorded just now`
                : 'Recorded just now'}
            </p>
          </div>
        </div>
      ) : recordingState === 'conflict' ? (
        <div className={styles.recordingCard} data-tone="conflict" role="status" aria-live="polite">
          <div>
            <p className={styles.recordingTitle}>
              {recordingDetail?.message || 'A feeding video is already being recorded for this child.'}
            </p>
            <p className={styles.recordingBody}>
              It will appear under Feeding Recordings when it finishes.
            </p>
          </div>
        </div>
      ) : recordingState === 'failed' ? (
        <div className={styles.recordingCard} data-tone="error" role="alert">
          <div>
            <p className={styles.recordingTitle}>
              {recordingDetail?.message || 'The feeding video could not be requested.'}
            </p>
            <p className={styles.recordingBody}>Nothing was recorded. Please try again.</p>
          </div>
        </div>
      ) : null}

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
