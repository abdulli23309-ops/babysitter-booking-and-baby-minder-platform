import { useId, useState } from 'react';
import styles from './faq-accordion.module.css';

/**
 * FaqAccordion — Phase 3/4 Batch A, Step 2.
 *
 * Accessible expandable FAQ list. Grid-template-rows transition gives a smooth
 * height animation without JS measurement.
 */
export default function FaqAccordion({ items }) {
  const [openIndex, setOpenIndex] = useState(-1);
  const baseId = useId();

  return (
    <div className={styles.list}>
      {items.map((item, i) => {
        const expanded = openIndex === i;
        const panelId = `${baseId}-panel-${i}`;
        const btnId = `${baseId}-btn-${i}`;
        return (
          <div key={item.q} className={styles.item}>
            <button
              type="button"
              id={btnId}
              className={styles.trigger}
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpenIndex(expanded ? -1 : i)}
            >
              <span>{item.q}</span>
              <svg
                className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div id={panelId} role="region" aria-labelledby={btnId} className={styles.panel}>
              <div className={styles.panelInner}>
                <p className={styles.answer}>{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
