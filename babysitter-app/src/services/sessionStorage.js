// Session storage abstraction - Phase F1 (Updated for Opaque Tokens)
// Centralizes all reads/writes of the app's session keys so pages stop
// calling localStorage.getItem directly in a scattered manner.
//
// CONSTRAINTS:
// - Database-Backed Opaque Tokens (GUIDs, NOT JWT).
// - No client-side token decoding (treated purely as an opaque string).
// - Stores 'userId', 'role', 'user', and 'token'.

export const SESSION_KEYS = {
  USER_ID: 'userId',
  ROLE: 'role',
  USER: 'user',
  TOKEN: 'token',
  EXPIRES_AT: 'expiresAt',
};

// Existing role strings in the app are lowercase: 'parent' | 'babysitter'
export const ROLES = {
  PARENT: 'parent',
  BABYSITTER: 'babysitter',
};

/** Read the raw numeric user id. Returns null when absent/invalid. */
export function getUserId() {
  const raw = localStorage.getItem(SESSION_KEYS.USER_ID);
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Read the raw role string exactly as stored (no case normalization). */
export function getRole() {
  return localStorage.getItem(SESSION_KEYS.ROLE);
}

/** Read the stored user object (JSON). Returns null when absent/invalid. */
export function getUser() {
  const raw = localStorage.getItem(SESSION_KEYS.USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Read the opaque session token. Returns null when absent. */
export function getToken() {
  return localStorage.getItem(SESSION_KEYS.TOKEN);
}

/** True when an opaque token exists. */
export function hasToken() {
  return Boolean(getToken());
}

/** Purges expired session if expiresAt has passed. */
export function purgeExpiredSession() {
  const expires = localStorage.getItem(SESSION_KEYS.EXPIRES_AT);
  if (expires && new Date(expires).getTime() <= Date.now()) {
    clearSession();
  }
}

/** True when a usable session (numeric id + role + token) exists. */
export function hasSession() {
  purgeExpiredSession();
  return getUserId() !== null && Boolean(getRole());
}

/** Write session values. Accepts { userId, role, user, token, expiresAt } or raw login response. */
export function setSession(data) {
  if (!data) return;

  const userId = data.userId ?? data.UserId ?? data.id ?? data.sitterId;
  const role = data.role ?? data.Role;
  const user = data.user ?? data;
  const token = data.token ?? data.Token ?? data.sessionToken ?? data.SessionToken;
  const expiresAt = data.expiresAt ?? data.ExpiresAt;

  if (userId !== undefined && userId !== null) {
    localStorage.setItem(SESSION_KEYS.USER_ID, String(userId));
  }
  if (role !== undefined && role !== null) {
    localStorage.setItem(SESSION_KEYS.ROLE, String(role).toLowerCase());
  }
  if (user !== undefined && user !== null) {
    localStorage.setItem(SESSION_KEYS.USER, JSON.stringify(user));
  }
  if (token !== undefined && token !== null) {
    localStorage.setItem(SESSION_KEYS.TOKEN, String(token));
  }
  if (expiresAt !== undefined && expiresAt !== null) {
    localStorage.setItem(SESSION_KEYS.EXPIRES_AT, String(expiresAt));
  }
}

/** Clear all session keys (does not touch unrelated localStorage keys). */
export function clearSession() {
  localStorage.removeItem(SESSION_KEYS.USER_ID);
  localStorage.removeItem(SESSION_KEYS.ROLE);
  localStorage.removeItem(SESSION_KEYS.USER);
  localStorage.removeItem(SESSION_KEYS.TOKEN);
  localStorage.removeItem(SESSION_KEYS.EXPIRES_AT);
}

