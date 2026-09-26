import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * ThemeContext — Phase F-UI-11 (Phase 1), re-based by the Phase 5.2 Theme Default Override.
 *
 * Contract:
 *  - The *resolved* theme ('light' | 'dark') is written to
 *    <html data-theme="..."> so every CSS variable in styles/tokens.css
 *    switches without any per-component dark rules.
 *  - The app DEFAULTS TO LIGHT MODE. The OS/System preference
 *    ('prefers-color-scheme') is deliberately NOT consulted anymore, so users on
 *    dark-themed operating systems still start in light mode.
 *  - Dark mode is strictly opt-in: only an explicit toggle writes 'dark' to
 *    localStorage, and that persisted value is what re-applies dark mode on
 *    reload.
 *  - The same storage key is read by the pre-paint bootstrap script in
 *    index.html, so there is never a flash of the wrong theme (no FOUC).
 *  - localStorage access is fully guarded: private-mode browsers fall back
 *    to the in-memory preference instead of throwing.
 */

const STORAGE_KEY = 'littlecare:theme';

const ThemeContext = createContext(null);

/**
 * Read the persisted preference. Only an explicit 'dark' opt-in is honoured;
 * everything else (no value, an invalid value, or the legacy 'system' value
 * written by pre-5.2 builds) resolves to 'light'.
 */
function readStoredPreference() {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark') return 'dark';
  } catch {
    // Blocked storage (private mode / disabled cookies) — fall back to light.
  }
  return 'light';
}

/**
 * Resolve a preference to a concrete theme. There is intentionally no OS
 * fallback: light is the app default, dark only ever comes from an explicit
 * user choice.
 */
function resolveTheme(preference) {
  return preference === 'dark' ? 'dark' : 'light';
}

function persistPreference(preference) {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Non-fatal: the session keeps the in-memory preference.
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;

  // Keep the mobile browser UI bar in sync with the active theme.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0E1119' : '#E8622A');
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readStoredPreference);
  const [theme, setTheme] = useState(() => resolveTheme(readStoredPreference()));

  // Reflect the resolved theme onto <html> on mount and on every change.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setThemePreference = useCallback((next) => {
    // Only 'dark' is an opt-in; every other value is normalised to 'light'.
    const safe = next === 'dark' ? 'dark' : 'light';
    persistPreference(safe);
    setPreference(safe);
    setTheme(resolveTheme(safe));
  }, []);

  const toggleTheme = useCallback(() => {
    // A manual toggle pins an explicit choice — that is what users expect
    // from a physical-looking switch.
    setThemePreference(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setThemePreference]);

  const value = useMemo(
    () => ({
      theme,
      preference,
      isDark: theme === 'dark',
      setThemePreference,
      toggleTheme,
    }),
    [theme, preference, setThemePreference, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is intentionally colocated with its provider (same pattern as AuthContext / ToastContext)
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>.');
  }
  return ctx;
}

export default ThemeContext;