/**
 * independentMonitoringApi - the ONLY API boundary for INDEPENDENT (job-free)
 * Phone-2 monitoring.
 *
 * WHY A SEPARATE MODULE
 * Independent monitoring is a different monitoring CONTEXT from the existing
 * job-based babysitter monitoring, which runs through MonitoringAccess and
 * requires (jobId, childId). Keeping this adapter separate means a change to
 * one context can never silently alter the other, and the job-based contracts
 * in api.js stay untouched.
 *
 * TWO IDENTITIES, TWO TRANSPORTS
 * 1. Parent (Phone 1) - the normal opaque account token, through the shared
 *    apiClient (Bearer header, 401 handling, error normalization).
 * 2. Monitoring device (Phone 2) - a dedicated device credential sent as the
 *    `X-Monitor-Device` header. Phone 2 has no account and no password, so it
 *    must NOT use apiClient: a 401 there means "this pairing is over", not
 *    "log the user out", and apiClient's interceptor would wrongly clear the
 *    session and redirect. Device calls therefore use fetch directly.
 *
 * SECURITY - the device credential
 * Stored in sessionStorage only (tab-scoped, cleared when the device tab
 * closes) and never under the parent's account keys. The spare phone sits in
 * the nursery, so a persistent, script-readable value would outlive the tab and
 * be readable by any other page served to that browser. This mirrors the
 * project's own Phase 12 decision to keep the bearer token in sessionStorage.
 *
 * SECURITY - no client-decided capability
 * A device never sends a childId, a parentId, a role or "canPublish". The
 * server derives the child and parent from the redeemed pairing code, and it
 * derives the media role from which credential was presented.
 */
import { apiGet, apiPost } from './apiClient';

const BASE = '/independent-monitoring';
const API_ROOT = import.meta.env.VITE_API_BASE || '/api';
const DEVICE_HEADER = 'X-Monitor-Device';
const DEVICE_CREDENTIAL_KEY = 'monitorDeviceCredential';
const DEVICE_SESSION_KEY = 'monitorDeviceSession';

/* ------------------------------------------------------------------ */
/* Device credential storage (Phone 2 only)                            */
/* ------------------------------------------------------------------ */

export const deviceStore = {
  getCredential() {
    return sessionStorage.getItem(DEVICE_CREDENTIAL_KEY) || '';
  },
  /** Persists the credential plus the non-secret session summary. */
  save(credential, session) {
    sessionStorage.setItem(DEVICE_CREDENTIAL_KEY, credential);
    if (session) sessionStorage.setItem(DEVICE_SESSION_KEY, JSON.stringify(session));
  },
  getSession() {
    try {
      return JSON.parse(sessionStorage.getItem(DEVICE_SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  },
  clear() {
    sessionStorage.removeItem(DEVICE_CREDENTIAL_KEY);
    sessionStorage.removeItem(DEVICE_SESSION_KEY);
  },
};

/**
 * Device transport. A missing credential fails fast with a 401-shaped error so
 * callers behave the same as a revoked one, and every non-2xx answer produces
 * a plain message that never includes a raw response body.
 */
async function deviceRequest(path, { method = 'GET', body } = {}) {
  const credential = deviceStore.getCredential();
  if (!credential) {
    const err = new Error('This device is not paired yet.');
    err.status = 401;
    throw err;
  }
  let res;
  try {
    res = await fetch(`${API_ROOT}${BASE}${path}`, {
      method,
      headers: {
        [DEVICE_HEADER]: credential,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('The monitoring device could not reach the server.');
    err.status = 0;
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    // The pairing is gone (revoked, expired, or the session was stopped).
    deviceStore.clear();
  }
  if (!res.ok) {
    let message = 'The monitoring device could not complete that request.';
    try {
      const data = await res.json();
      if (data?.message) message = data.message;
    } catch {
      /* keep the generic message */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Parent (Phone 1)                                                     */
/* ------------------------------------------------------------------ */

/** Creates a one-time pairing code for a child the caller guardians. */
export const createPairingCode = (childId) => apiPost(`${BASE}/pairing-codes`, { childId });

export const getIndependentSession = () => apiGet(`${BASE}/session`);

export const stopIndependentSession = () => apiPost(`${BASE}/session/stop`, {});

/**
 * The most recent cry incident, or null when there has never been one.
 * The endpoint returns the full history; the parent view only needs the
 * current one, so the newest (open-first) row is selected here.
 */
export async function getIndependentCry() {
  const rows = await apiGet(`${BASE}/incidents`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

/** Acknowledges the open incident(s) so a later cry raises a fresh one. */
export const resolveIndependentCry = () => apiPost(`${BASE}/cry/resolve`, {});

/** Parent media. The server always issues a VIEWER token on this route. */
export const getIndependentMedia = () => apiGet(`${BASE}/media`);

/* ------------------------------------------------------------------ */
/* Monitoring device (Phone 2)                                          */
/* ------------------------------------------------------------------ */

/** Redeems a pairing code. The server derives child and parent from it. */
export async function pairDevice(code, deviceName) {
  const data = await deviceRequest('/device/pair', {
    method: 'POST',
    body: { code, deviceName: deviceName || 'Monitor device' },
  });
  deviceStore.save(data.deviceCredential, { sessionId: data.sessionId, childId: data.childId });
  return data;
}

export const deviceHeartbeat = () => deviceRequest('/device/heartbeat', { method: 'POST' });

export const deviceSession = () => deviceRequest('/device/session');

/** Server-issued PUBLISHER media session. The role is never chosen here. */
export const deviceMedia = () => deviceRequest('/device/media');

/** Reports a locally detected cry. The server timestamps and dedupes it. */
export const deviceReportCry = () => deviceRequest('/device/cry', { method: 'POST' });
