import styles from './live-media-stage.module.css';

/**
 * LiveMediaStage - Phase 9.1 Premium Active Session.
 *
 * The single glassmorphic media container for the Active Session screen.
 * It replaces the old "Which child is the monitoring phone watching?"
 * <select> plus a loose media div with a static, elegant header.
 */

/**
 * LiveMediaStage - the premium, edge-to-edge media card.
 *
 * WHY THIS IS A COMPONENT
 *   The container carries two real decisions, so it is worth one component
 *   rather than markup that is re-typed (and re-styled) at each call site:
 *
 *     1. THE CHILD HEADER IS DERIVED, NEVER CHOSEN. The previous <select>
 *        asked "which child is the monitoring phone watching?" and stored
 *        the answer in local state. That implied authority the user does not
 *        have: picking a child in a dropdown grants nothing, because the
 *        SERVER re-runs MonitoringAccess on every request. Rendering the
 *        RESOLVED child as static text is both more honest and one fewer
 *        control on a screen someone uses one-handed.
 *
 *     2. THE STATUS IS CONSOLIDATED HERE. The three redundant error strings
 *        are gone; MonitoringMediaPanel (variant="stage") renders exactly
 *        one floating glass pill over the video, so the user reads one word
 *        in one place instead of racing three.
 *
 * PROPS
 *   childName  - the RESOLVED monitoring child (never a user choice)
 *   childCount - how many children the booking covers, so the header can say
 *                "and 1 more" instead of silently hiding a sibling
 *   children   - forwarded to MonitoringMediaPanel untouched
 */
export default function LiveMediaStage({ childName, childCount = 1, children }) {
  const extras = Math.max(childCount - 1, 0);

  return (
    <section className={styles.stage} aria-label="Live baby monitoring">
      {/* The static header. No dropdown, no chooser: the child is whatever the
          server authorised for this session, and that is what we say. */}
      <header className={styles.stageHeader}>
        <span className={styles.stageHeaderIcon} aria-hidden="true">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
          </svg>
        </span>
        <h3 className={styles.stageHeaderText}>
          <span className={styles.stageHeaderLabel}>Monitoring</span>
          <span className={styles.stageHeaderName}>
            {childName || 'your child'}
            {extras > 0 ? (
              <span className={styles.stageHeaderMore}> and {extras} more</span>
            ) : null}
          </span>
        </h3>
      </header>

      {/* The deep-navy video card. MonitoringMediaPanel supplies the single
          floating status pill and the premium "Awaiting video feed..."
          fallback for a broken or hung surface. */}
      <div className={styles.stageCard}>{children}</div>
    </section>
  );
}