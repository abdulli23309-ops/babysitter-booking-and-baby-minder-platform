// AuthContext — Phase F1 & F-B6
// Centralized React Context holding the current session state (user id,
// role, user object, token) and a loading flag.
//
// OPAQUE TOKEN AUTH (verified backend Phase B3 & B6 contract):
// - login() captures the backend response { token, userId, name, role }
//   and persists it through the sessionStorage.js abstraction.
// - logout() revokes the server session first (DELETE /api/auth/logout), then
//   clears local state & storage and redirects to /login. Local state is
//   cleared EVEN IF the backend request fails — Phase 1 Fix E.
// - deactivateAccount(roleOverride) issues POST /api/{role}/deactivate,
//   synchronously clears local state, and hard redirects to '/' (Splash).

import { createContext, useContext, useState, useMemo, useCallback } from 'react';
import apiClient from '../../services/apiClient';
import {
  getUserId,
  getRole,
  getUser,
  getToken,
  setSession,
  clearSession,
  purgeExpiredSession,
  ROLES,
} from '../../services/sessionStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [userId, setUserId] = useState(() => {
    purgeExpiredSession();
    return getUserId();
  });
  const [role, setRole] = useState(() => getRole());
  const [user, setUser] = useState(() => getUser());
  const [token, setToken] = useState(() => getToken());
  const [loading] = useState(false);

  const login = useCallback((sessionData) => {
    setSession(sessionData);
    setUserId(getUserId());
    setRole(getRole());
    setUser(getUser());
    setToken(getToken());
  }, []);

  // LOGOUT FLOW (Phase 1 Fix E) — "React logout action → server logout →
  // clear local state → navigate":
  //   1. DELETE /api/auth/logout with the Bearer token (attached by the
  //      apiClient request interceptor). The server deletes the UserSessions
  //      row, so the opaque token dies immediately instead of staying valid
  //      for its full SessionExpiryDays lifetime.
  //   2. Clear all local authentication state (storage + React state).
  //   3. Redirect to /login.
  //
  // PURPOSE: before Phase 1, logout was client-only — the server session
  // survived, so anyone holding the same token stayed logged in.
  //
  // FAILURE / EDGE CASES:
  //   - Network down / server restarting: the request fails, but the finally
  //     block still clears local state and redirects — the UI never leaves
  //     the user apparently logged in on a dead session.
  //   - Token already invalid (401): apiClient's response interceptor clears
  //     the stored session itself; our finally block then finishes the same
  //     cleanup idempotently.
  //   - 5s timeout keeps a hung request from freezing logout indefinitely.
  const logout = useCallback(async () => {
    try {
      if (getToken()) {
        await apiClient.delete('/api/auth/logout', { timeout: 5000 });
      }
    } catch {
      // Intentionally swallowed: local cleanup must proceed regardless of
      // the backend outcome (see FAILURE note above).
    } finally {
      clearSession();
      setUserId(null);
      setRole(null);
      setUser(null);
      setToken(null);
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
  }, []);

  const deactivateAccount = useCallback(async (roleOverride) => {
    const activeRole = (roleOverride || role || '').toLowerCase();
    const endpoint = activeRole === 'sitter' || activeRole === 'babysitter'
      ? '/api/babysitter/deactivate'
      : '/api/parent/deactivate';

    try {
      await apiClient.post(endpoint);
    } catch (err) {
      if (err?.status !== 401 && err?.response?.status !== 401) {
        throw err;
      }
    } finally {
      clearSession();
      setUserId(null);
      setRole(null);
      setUser(null);
      setToken(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    }
  }, [role]);

  const updateSession = useCallback((patch) => {
    setSession(patch);
    setUserId(getUserId());
    setRole(getRole());
    setUser(getUser());
    setToken(getToken());
  }, []);

  const value = useMemo(
    () => ({
      userId,
      role,
      user,
      token,
      loading,
      isAuthenticated: !loading && userId !== null && Boolean(role),
      login,
      logout,
      deactivateAccount,
      updateSession,
      roles: ROLES,
    }),
    [userId, role, user, token, loading, login, logout, deactivateAccount, updateSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hooks may live beside their provider in a single-context file
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return ctx;
}

export default AuthContext;
