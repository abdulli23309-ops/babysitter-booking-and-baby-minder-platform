export default function SeriesPaginationBar({ currentIndex, totalCount, onPrev, onNext }) {
  // Callers pass a 0-based Array.findIndex result. findIndex returns -1 when
  // the active job is not present in the sibling list (e.g. it is not in a
  // completed/cancelled state, or the list has not loaded yet). Without this
  // clamp the label rendered "Day -1 of 3".
  const safeIndex = (Number.isInteger(currentIndex)
    && currentIndex >= 0
    && currentIndex < totalCount) ? currentIndex : 0;
  // Display is 1-based, but the disabled checks below must use the 0-based
  // safeIndex — previously they compared the raw index against 1, which
  // disabled "Prev" on the first day and enabled "Next" on the last.
  const displayIndex = safeIndex + 1;
  const canPrev = safeIndex > 0;
  const canNext = safeIndex < totalCount - 1;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--color-surface)', borderRadius: 16, boxShadow: '0 4px 16px rgb(var(--ink-rgb) / 0.04)', border: '1px solid var(--color-border-subtle)', marginTop: 12, marginBottom: 16 }}>
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev}
        style={{
          background: 'transparent',
          border: 'none',
          color: canPrev ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
          fontWeight: 700,
          fontSize: 14,
          cursor: canPrev ? 'pointer' : 'not-allowed',
          padding: '8px 12px'
        }}
      >
        ← Prev
      </button>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
        Day {displayIndex} of {totalCount}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        style={{
          background: 'transparent',
          border: 'none',
          color: canNext ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
          fontWeight: 700,
          fontSize: 14,
          cursor: canNext ? 'pointer' : 'not-allowed',
          padding: '8px 12px'
        }}
      >
        Next →
      </button>
    </div>
  );
}

