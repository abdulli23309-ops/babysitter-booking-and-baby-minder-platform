/**
 * useMonitoring - the SINGLE polling owner for child monitoring (Phase 8).
 *
 * WHY ONE HOOK
 *   Phases 3-7 were backend-only, so each screen would otherwise invent its own
 *   timer, session fetch and error handling. This hook is the one place that:
 *     - starts a monitoring session (idempotently - the backend returns the
 *       existing Active session rather than creating a second one),
 *     - heartbeats on its own interval (Phase 4: proof the participant is still
 *       reachable, and the only way connection loss is ever detected),
 *     - polls the session, which also drives the Phase 5/6 escalation
 *       sweep-on-poll and the Phase 7 pause state, so ONE request per tick
 *       renders the whole monitoring view,
 *     - polls the cry incident so escalation state is displayed from the server,
 *     - clears everything on unmount and on scope change.
 *
 * BACKEND IS AUTHORITATIVE
 *   This hook never decides authorization, never computes T+5/T+15, never
 *   expires a pause and never marks a connection lost. It only sends
 *   { jobId, childId } and renders what comes back - "Connected"/"Lost",
 *   "paused" and "escalated" are all server verdicts.
 *
 * ROLE BEHAVIOUR
 *   `role` comes from the authenticated session. A parent may also use the
 *   Phase 7 guardian/pause/DND surface; a sitter must not, which is why
 *   `isParent` is derived here instead of being guessed inside a component.
 *
 * ERROR SEMANTICS (no exception text ever reaches the user)
 *   401 -> session died; the caller should send the user back to login.
 *   403 -> not authorized for this child (e.g. not a ChildGuardian).
 *   404 -> no session / no incident yet: a normal "not started" state, never a
 *          blocking error screen.
 *   409/422/5xx/network -> transient; keep the last good state and retry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import API from '../services/api.js';

// The heartbeat interval must stay comfortably BELOW the server's
// MonitoringHeartbeatTimeoutSeconds (Web.config default 15s) so a healthy
// client is never reported as Lost. The session poll is a full round trip that
// also drives the escalation sweep, so it runs a little less often.
const HEARTBEAT_MS = 8000;
const SESSION_POLL_MS = 5000;

const statusOf = (err) => err?.response?.status ?? null;

const describeError = (err) => {
  const s = statusOf(err);
  if (s === 401) return 'Your session has expired. Please sign in again.';
  if (s === 403) return 'You are not allowed to monitor this child.';
  if (s === 404) return 'Monitoring is not available for this child yet.';
  if (s === 409) return 'Monitoring is no longer available. Please refresh.';
  if (s === 422) return 'That monitoring action is not valid right now.';
  if (s >= 500) return 'Monitoring is temporarily unavailable. Retrying.';
  return 'Connection problem. Retrying.';
};

export default function useMonitoring({ jobId, childId, role, autoStart = false }) {
  const scopeOk = Number(jobId) > 0 && Number(childId) > 0;
  const isParent = String(role || '').toLowerCase() === 'parent';

  const [session, setSession] = useState(null);
  const [incident, setIncident] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);

  // Guards every async continuation so a slow response cannot update state
  // after unmount or after the scope changed.
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);
  const scopeRef = useRef(`${jobId}:${childId}`);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!scopeOk || inFlightRef.current) return; // never stack overlapping polls
    inFlightRef.current = true;
    try {
      const s = await API.getMonitoringSession(jobId, childId);
      if (!aliveRef.current) return;
      setSession(s ?? null);
      setError('');
      setOffline(false);

      // The incident is a separate resource. 404 just means "no alert yet",
      // which is a NORMAL state and must not be surfaced as an error.
      try {
        const c = await API.getCryIncident(jobId, childId);
        if (aliveRef.current) setIncident(c ?? null);
      } catch (err) {
        if (!aliveRef.current) return;
        setIncident(null);
        if (statusOf(err) !== 404) setError(describeError(err));
      }
    } catch (err) {
      if (!aliveRef.current) return;
      if (statusOf(err) === 404) {
        // This (job, child) has no session yet -> "not started", not an error.
        setSession(null);
        setError('');
      } else if (statusOf(err) === 403) {
        setSession(null);
        setError(describeError(err));
      } else {
        setError(describeError(err));
        setOffline(true);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [jobId, childId, scopeOk]);

  // Reset everything when the monitoring scope changes, so state belonging to
  // a previous child can never be shown for a new one.
  useEffect(() => {
    const key = `${jobId}:${childId}`;
    if (scopeRef.current !== key) {
      scopeRef.current = key;
      setSession(null);
      setIncident(null);
      setError('');
      setOffline(false);
    }
  }, [jobId, childId]);

  const start = useCallback(async () => {
    if (!scopeOk || starting) return false;
    setStarting(true);
    setError('');
    try {
      const s = await API.startMonitoringSession(jobId, childId);
      if (aliveRef.current) setSession(s ?? null);
      await refresh();
      return true;
    } catch (err) {
      if (aliveRef.current) setError(describeError(err));
      return false;
    } finally {
      if (aliveRef.current) setStarting(false);
    }
  }, [jobId, childId, scopeOk, starting, refresh]);

  const end = useCallback(async () => {
    if (!scopeOk) return false;
    setError('');
    try {
      await API.endMonitoringSession(jobId, childId);
      if (aliveRef.current) {
        setSession(null);
        setIncident(null);
      }
      return true;
    } catch (err) {
      if (aliveRef.current) setError(describeError(err));
      return false;
    }
  }, [jobId, childId, scopeOk]);

  // ---- Sitter responses: the UI only reflects the refreshed server state ----
  const goingToChild = useCallback(async () => {
    try {
      await API.sitterGoingToChild(jobId, childId);
      await refresh();
      return true;
    } catch (err) {
      if (aliveRef.current) setError(describeError(err));
      return false;
    }
  }, [jobId, childId, refresh]);

  const withChild = useCallback(async () => {
    try {
      await API.sitterWithChild(jobId, childId);
      await refresh();
      return true;
    } catch (err) {
      if (aliveRef.current) setError(describeError(err));
      return false;
    }
  }, [jobId, childId, refresh]);

  // ---- optional auto-start, used by the sitter monitoring entry point ----
  useEffect(() => {
    if (!scopeOk || !autoStart || session) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) start();
    });
    return () => {
      cancelled = true;
    };
  }, [scopeOk, autoStart, session, start]);

  // ---- heartbeat (Phase 4). Only while the session is Active. ----
  useEffect(() => {
    if (!scopeOk || session?.Status !== 'Active') return undefined;
    const beat = async () => {
      try {
        await API.sendMonitoringHeartbeat(jobId, childId);
        if (aliveRef.current) setOffline(false);
      } catch {
        // PHASE 12 CORRECTION.
        //
        // This block used to call setOffline(true), which contradicted the
        // comment directly above it: a failed beat does NOT mean the child
        // monitor is disconnected. The SERVER decides that, by comparing its own
        // clock against the last stamp IT recorded (Phase 4). A heartbeat can
        // legitimately fail - a transient 500, a proxy hiccup, a lost network for
        // one request - and turning that into a client-declared "Connection
        // problem" is exactly the "frontend is authoritative" mistake this
        // project forbids.
        //
        // The session poll (below) still sets `offline` for a genuine network
        // failure, and even then the wording is "cannot reach the server" rather
        // than a claim about the child's camera. So: swallow the error here and
        // let the next successful poll or beat clear the flag.
      }
    };
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [jobId, childId, scopeOk, session?.Status]);

  // ---- polling: the session GET also sweeps escalation and expires pauses ----
  useEffect(() => {
    if (!scopeOk) return undefined;
    const t = setInterval(refresh, SESSION_POLL_MS);
    return () => clearInterval(t);
  }, [refresh, scopeOk]);

  return {
    scopeOk,
    isParent,
    session,
    incident,
    starting,
    offline,
    error,
    start,
    end,
    refresh,
    goingToChild,
    withChild,
  };
}

