// token-map.mjs — Phase F-UI-11 / 1.5 data table for tokenize-colors.mjs.
//
// Each group maps one or more color literals to token(s) per semantic slot:
//   fg   = text / icon color      bg = background / background-color
//   bd   = border / outline       sh = box-shadow / text-shadow
//   tint = local custom properties (--gradient-* helpers)
//   any  = fallback for every slot
//   alpha= channel-token shorthand -> rgb(var(--<name>-rgb) / <original alpha>)
//
// `$A` inside a target is replaced with the literal's own alpha value, which
// keeps light-mode rendering identical while dark mode swaps the channels.

export const GROUPS = [
  // ---- White: surfaces, text on saturated fills, glass edges ----
  {
    c: ['#ffffff', '#fff'],
    bg: 'var(--color-surface)',
    fg: 'var(--color-text-inverse)',
    bd: 'var(--glass-border)',
    sh: 'rgb(var(--surface-rgb) / 0.5)',
  },
  {
    c: [
      'rgba(255,255,255,$A)',
      'rgba(255,255,255,0.9)',
      'rgba(255,255,255,0.88)',
      'rgba(255,255,255,0.85)',
      'rgba(255,255,255,0.8)',
      'rgba(255,255,255,0.75)',
      'rgba(255,255,255,0.6)',
    ],
    when: (a) => a >= 0.5,
    bg: 'rgb(var(--surface-rgb) / $A)',
    sh: 'rgb(var(--surface-rgb) / $A)',
    fg: 'var(--color-text-inverse)',
    bd: 'var(--glass-border)',
  },
  {
    c: [
      'rgba(255,255,255,$A)',
      'rgba(255,255,255,0.25)',
      'rgba(255,255,255,0.2)',
      'rgba(255,255,255,0.18)',
      'rgba(255,255,255,0.12)',
    ],
    when: (a) => a < 0.5,
    bg: 'rgb(var(--edge-rgb) / $A)',
    bd: 'rgb(var(--edge-rgb) / $A)',
    sh: 'rgb(var(--edge-rgb) / $A)',
    fg: 'var(--color-text-inverse)',
  },

  // ---- Ink / text ramp (consolidates 6 near-identical dark inks) ----
  {
    c: ['#1a1d2e', '#111827', '#0f172a', '#1e293b', '#2d3748', '#334155'],
    fg: 'var(--color-text)',
    bg: 'var(--color-surface-inverse)',
    bd: 'var(--color-border-strong)',
  },
  { c: ['#5a6072', '#475569', '#4b5563', '#4a5568', '#6b7280'], any: 'var(--color-text-secondary)' },
  { c: ['#64748b'], any: 'var(--color-text-tertiary)' },
  { c: ['#94a3b8', '#9ca3af'], any: 'var(--color-text-faint)' },
  { c: ['#8e9aaf', '#666'], any: 'var(--color-text-muted)' },

  // ---- Light neutral surfaces & explicit borders ----
  { c: ['#f8fafc'], any: 'var(--color-surface-muted)' },
  { c: ['#f7f9fc'], any: 'var(--color-surface-alt)' },
  {
    c: ['#f1f5f9', '#f3f4f6', '#e5e7eb', '#eaecef', '#ebf0f5', '#e6e6e6'],
    any: 'var(--color-surface-sunken)',
    bg: 'var(--color-surface-sunken)',
    bd: 'var(--color-surface-sunken)',
  },
  {
    c: ['#e2e8f0'],
    bg: 'var(--color-surface-sunken)',
    bd: 'var(--color-border-subtle)',
    fg: 'var(--color-text-faint)',
  },
  {
    c: ['#cbd5e1', '#d1d5db', '#ccc', '#ddd'],
    bd: 'var(--color-border-strong)',
    fg: 'var(--color-text-faint)',
  },
  { c: ['#a8a8a8'], bg: 'var(--color-text-faint)' },
// ---- Brand ----
  { c: ['#e8622a', '#ff6b4a'], any: 'var(--color-primary)' },
  { c: ['#d4541f'], any: 'var(--color-primary-hover)' },
  { c: ['#e05822', '#c35420', '#d5541e'], any: 'var(--color-primary-active)' },
  {
    c: ['#fff5ee', '#feece5', '#fff3eb', '#fff0e6', '#fff4ec', '#ffe4d6', '#ffd9cc', '#ffedd5'],
    bg: 'var(--color-primary-tint)',
    bd: 'var(--color-primary-soft-strong)',
    sh: 'rgb(var(--primary-rgb) / 0.12)',
  },
  { c: ['#fff7ed'], any: 'var(--color-primary-tint-light)' },
  { c: ['#fff5ef'], bg: 'var(--color-primary-tint-soft)' },

  // ---- Success ----
  { c: ['#16a34a', '#059669'], any: 'var(--color-success-strong)' },
  { c: ['#22c55e', '#10b981', '#4ade80'], any: 'var(--color-success)' },
  { c: ['#dcfce7', '#ecfdf5', '#f0fdf4'], any: 'var(--color-success-tint)', bg: 'var(--color-success-tint)' },
  { c: ['#e8f8f0', '#e8f7ee'], bg: 'var(--badge-success-bg)' },
  { c: ['#bbf7d0', '#a7f3d0', '#86efac'], bd: 'var(--color-success-border)' },
  { c: ['#1e824c'], fg: 'var(--badge-success-text)' },

  // ---- Warning / amber ----
  { c: ['#f59e0b'], any: 'var(--color-warning)' },
  { c: ['#d97706', '#b45309', '#7c2d12', '#c2410c'], any: 'var(--color-warning-strong)' },
  { c: ['#fef3c7', '#fff8e6'], bg: 'var(--color-warning-tint)' },
  { c: ['#fde68a', '#fed7aa'], bd: 'var(--color-warning-border)' },

  // ---- Danger ----
  { c: ['#dc2626', '#e11d48', '#b91c1c', '#991b1b'], any: 'var(--color-danger-strong)' },
  { c: ['#ef4444', '#f87171'], any: 'var(--color-danger)' },
  { c: ['#fef2f2', '#fff5f5', '#fdecef', '#fff1f2', '#ffe4e6', '#fee2e2'], bg: 'var(--color-danger-tint)' },
  { c: ['#fecaca', '#fca5a5', '#fda4af'], bd: 'var(--color-danger-border-strong)' },

  // ---- Info / blue / indigo ----
  { c: ['#0284c7'], any: 'var(--color-info-strong)' },
  { c: ['#2563eb', '#6366f1'], any: 'var(--color-info)' },
  { c: ['#eff6ff', '#eef4fd', '#e0f2fe', '#eef4ff', '#ebf2fc', '#e2eefb'], any: 'var(--color-info-tint)', bg: 'var(--color-info-tint)' },
  { c: ['#dbeafe'], bd: 'var(--color-info-border)' },

  // ---- Pastel gradient stops (standalone bg use, e.g. auth/gradient screens) ----
  { c: ['#f5eefb', '#f5ecf8'], bg: 'var(--badge-purple-bg)' },

  { c: ['#fbd5e5'], bg: 'var(--color-pastel-coral-soft)' },
  { c: ['#e6dcf5'], bg: 'var(--color-pastel-lavender)' },
  { c: ['#cce6ff'], bg: 'var(--color-pastel-sky)' },

  // ---- Media canvases (intentionally black in both themes) ----
  { c: ['#000000', '#000'], any: 'var(--color-media-canvas)' },

  // ---- Alpha-composed families: channel token + the declaration's own alpha ----
  { c: ['rgba(26,29,46,$A)', 'rgba(15,23,42,$A)'], alpha: 'ink', bd: 'var(--color-border)' },
  { c: ['rgba(0,0,0,$A)'], alpha: 'shadow-ink', bd: 'var(--color-border)' },
  { c: ['rgba(232,98,42,$A)'], alpha: 'primary' },
  { c: ['rgba(22,163,74,$A)', 'rgba(34,197,94,$A)', 'rgba(16,185,129,$A)'], alpha: 'success' },
  { c: ['rgba(220,38,38,$A)', 'rgba(239,68,68,$A)', 'rgba(225,29,72,$A)'], alpha: 'danger' },
  { c: ['rgba(163,177,198,$A)'], alpha: 'neu-soft' },
  {
    c: ['rgba(190,170,210,$A)', 'rgba(185,160,210,$A)', 'rgba(220,205,235,$A)', 'rgba(225,215,240,$A)'],
    alpha: 'purple',
  },

  // ---- Additions discovered by the dry-run report ----
  { c: ['rgba(2,132,199,$A)'], alpha: 'info' },
  { c: ['#c24d1b'], any: 'var(--color-primary-active)' },
  { c: ['#bbf7d0', '#a7f3d0'], bg: 'var(--color-success-tint)', bd: 'var(--color-success-border)' },
  { c: ['#fee2e2'], bg: 'var(--color-danger-tint)', bd: 'var(--color-danger-border-strong)' },
  { c: ['#1e824c'], any: 'var(--badge-success-text)' },
  { c: ['#e8f8f0', '#e8f7ee'], any: 'var(--badge-success-bg)' },
  { c: ['#f5eefb', '#f5ecf8'], any: 'var(--badge-purple-bg)' },
  { c: ['#8c7a70'], any: 'var(--color-text-warm)'
  },

  // ---- Phase F-UI-11 / 1.6 — inline (JSX) palette additions ----
  { c: ['#1a1a1a', '#1a1a2e', '#333', '#222'], fg: 'var(--color-text)', bg: 'var(--color-surface-inverse)', bd: 'var(--color-border-strong)' },
  { c: ['#2a2a2a'], fg: 'var(--color-text)', bg: 'var(--color-surface-inverse)' },
  { c: ['#555', '#888', '#999'], any: 'var(--color-text-muted)' },
  { c: ['#aaa', '#bbb'], any: 'var(--color-text-faint)' },
  { c: ['#ff4d4d', '#e74c3c'], any: 'var(--color-danger)' },
  { c: ['#27ae60'], any: 'var(--color-success)' },
  { c: ['#3b82f6'], any: 'var(--color-info)' },
  { c: ['#f39c12', '#ff9800'], any: 'var(--color-warning)' },
  { c: ['#ea580c', '#f57c00', '#9a3412'], any: 'var(--color-warning-strong)' },
  { c: ['#ff6a00'], any: 'var(--color-primary)' },
  { c: ['#7c3aed'], any: 'var(--badge-purple-text)' },
  { c: ['#f5f3ff'], any: 'var(--badge-purple-bg)' },
  { c: ['#eef2ff', '#ebf5ff'], any: 'var(--color-info-tint)' },
  { c: ['#93c5fd'], any: 'var(--color-info-border)' },
  { c: ['#fdba74'], any: 'var(--color-warning-border)' },
  { c: ['#fffbeb'], any: 'var(--color-warning-tint)' },
  { c: ['#fff1e7', '#ffe0cc', '#fde4ec'], any: 'var(--color-primary-tint)' },
  { c: ['#fafbfd'], any: 'var(--color-surface-muted)' },
  { c: ['#eef2f7', '#f5f5f5'], any: 'var(--color-surface-sunken)' },
  { c: ['#f0f0f0'], bg: 'var(--color-surface-sunken)', bd: 'var(--color-border)' },
  { c: ['rgba(39,174,96,$A)'], alpha: 'success'
  },
];

// Whole-value rules: declarations whose *entire* value is a known token.
export const VALUE_RULES = [
  {
    v: 'linear-gradient(160deg,#fbd5e5 0%,#e6dcf5 45%,#cce6ff 100%)',
    to: 'var(--gradient-auth-pastel)',
  },
  {
    v: 'linear-gradient(160deg, #f9cfe0 0%, #e8d6f0 40%, #ccd8f5 100%)',
    to: 'var(--gradient-pastel-soft)',
  },
  {
    v: 'linear-gradient(170deg, #f5c6d6 0%, #c8d8e8 100%)',
    to: 'var(--gradient-pastel-soft)',
  },
];