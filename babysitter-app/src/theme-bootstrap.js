// Theme bootstrap (Phase F-UI-11 / CSP hardening): applies the persisted light/dark
// preference BEFORE first paint so there is never a theme flash (FOUC).
// Extracted to an external module to comply with strict Content Security Policies (no inline scripts).
// Must stay in sync with STORAGE_KEY in src/components/ui/ThemeContext.jsx.
// THEME DEFAULT OVERRIDE (Phase 5.2): the app now DEFAULTS TO LIGHT MODE on
// every first visit and deliberately IGNORES the OS/System preference — there is
// no `prefers-color-scheme` fallback anymore. Dark mode is strictly opt-in: it is
// applied only when the user has explicitly chosen it with the in-app toggle
// (which persists 'dark' in localStorage).
try {
  const stored = window.localStorage.getItem('littlecare:theme');
  // Anything other than an explicit 'dark' opt-in resolves to light, including
  // a missing value and the legacy 'system' value written by older builds.
  const resolved = stored === 'dark' ? 'dark' : 'light';
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
} catch {
  document.documentElement.setAttribute('data-theme', 'light');
}

