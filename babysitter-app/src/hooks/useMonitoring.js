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
const CRY_POLL_INITIAL_MS = 5000;
const CRY_POLL_MAX_MS = 60000;

/* PHASE 9.2 - how many CONSECUTIVE session reads must fail before this client
 * will admit it cannot reach the API at all. At 5s per poll that is ~15s of
 * sustained failure, which is long enough to ride out a proxy hiccup and short
 * enough that a genuinely dead network is reported promptly.
 *
 * This is about REACHING THE SERVER. It is deliberately NOT a statement about the
 * video feed: nothing in this file may describe the nursery camera. */
const CONSECUTIVE_POLL_FAILURES_BEFORE_OFFLINE = 3;

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

  /* PHASE 9.2 - POLLING IS DIAGNOSTIC, NOT AUTHORITATIVE.
   *
   * Background read failures are logged and never become a video/transport
   * verdict. `offline` is retained only as an API reachability diagnostic for
   * administrative surfaces; the live media panel does not consume it. MiroTalk
   * WebSocket and producer/consumer transport events are the only inputs to the
   * feed's reconnecting state.
   *
   * The bug this fixes, observed live: the session poll ran every 5s and its
   * nested cry read failed, so `setError`/`setOffline` fired repeatedly while the
   * MiroTalk consumer had in fact attached and video was rendering. The user was
   * told "We lost the connection to the nursery camera" over a healthy stream.
   *
   * Two consequences of the split below:
   *   - a failed background read is logged (console) and otherwise IGNORED;
   *   - transient session-read failures may set `offline` after a threshold;
   *     this means only "API reads are failing" and is never passed as media
   *     transport state. A successful session read clears the diagnostic.
   */
  const consecutivePollFailuresRef = useRef(0);
  const cryRetryDelayRef = useRef(CRY_POLL_INITIAL_MS);
  const nextCryPollAtRef = useRef(0);

  // Guards every async continuation so a slow response cannot update state
  // after unmount or after the scope changed.
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);
  const scopeRef = useRef(`${jobId}:${childId}`);

  /* Console-only reporter for background reads. Kept in one place so every
     polling failure is diagnosable in the field without ever reaching the UI. */
  const logPollFailure = useCallback((resource, err) => {
    const status = statusOf(err) ?? 'network';
    console.warn(
      `[monitoring] background read "${resource}" failed (${status}). ` +
      'This does not affect the video feed and does not change the UI connection state.',
      err?.message ?? err,
    );
  }, []);

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
      // A successful read clears the only connectivity claim we are allowed to
      // make about ourselves.
      consecutivePollFailuresRef.current = 0;
      setError('');
      setOffline(false);

      // ---------------------------------------------------------------
      // PHASE 9.2 - THE CRY READ IS PURELY A BACKGROUND READ.
      // ---------------------------------------------------------------
      // It used to write `error` on any non-404 failure, which painted the
      // "Connection problem" banner over a perfectly healthy video feed. Now:
      //   - every failure is logged and otherwise ignored;
      //   - the previously-known incident is LEFT ALONE, because a failed read
      //     tells us nothing new about whether a baby is crying, and blanking
      //     an open alert would hide a real safety event;
      //   - a success writes the incident, including a legitimate `null`
      //     ("no incident"), because the backend now returns 200 with a null
      //     body instead of a 404 for that case.
      if (Date.now() >= nextCryPollAtRef.current) {
        try {
          const c = await API.getCryIncident(jobId, childId);
          if (aliveRef.current) setIncident(c ?? null);
          cryRetryDelayRef.current = CRY_POLL_INITIAL_MS;
          nextCryPollAtRef.current = Date.now() + CRY_POLL_INITIAL_MS;
        } catch (err) {
          logPollFailure('cry-incident', err);
          if (statusOf(err) === 404 && aliveRef.current) {
            // A 404 can only mean that the requested scope is absent; it must
            // never become an unhandled rejection or a video connection state.
            setIncident(null);
          }
          const retryDelay = cryRetryDelayRef.current;
          nextCryPollAtRef.current = Date.now() + retryDelay;
          cryRetryDelayRef.current = Math.min(retryDelay * 2, CRY_POLL_MAX_MS);
        }
      }
    } catch (err) {
      if (!aliveRef.current) return;

      const status = statusOf(err);
      consecutivePollFailuresRef.current += 1;

      if (status === 404) {
        // The initial state is already "not started". Preserve any last good
        // session data so a failed background read cannot disturb a live feed.
        consecutivePollFailuresRef.current = 0;
      } else if (status === 403) {
        // Log the background-read refusal without replacing the last known
        // session or painting a REST error over a live media surface.
        logPollFailure('session', err);
      } else if (status === 401) {
        // The API client's 401 handler owns re-authentication. Do not translate
        // this background poll into a camera/transport status.
        logPollFailure('session', err);
      } else {
        /* TRANSIENT: 5xx, timeout, offline radio, proxy hiccup.
         *
         * THRESHOLDED AND NARROWLY WORDED. One failed request is not evidence of
         * anything, so nothing is shown until the session read has failed
         * CONSECUTIVELY. Only then is `offline` set, and it means precisely "this
         * browser cannot reach the API" - never "the nursery camera is gone".
         */
        logPollFailure('session', err);
        if (consecutivePollFailuresRef.current >= CONSECUTIVE_POLL_FAILURES_BEFORE_OFFLINE) {
          setOffline(true);
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [jobId, childId, scopeOk, logPollFailure]);

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
      cryRetryDelayRef.current = CRY_POLL_INITIAL_MS;
      nextCryPollAtRef.current = 0;
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
      } catch (err) {
        logPollFailure('heartbeat', err);
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
  }, [jobId, childId, scopeOk, session?.Status, logPollFailure]);

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
    /* PHASE 9.2 - NAMED FOR WHAT IT ACTUALLY MEANS.
     * `offline` is retained for compatibility with existing consumers, but it
     * now means only "this browser lost contact with the API for several
     * consecutive polls". It is NOT a verdict on the video feed.
     *
   * Anything that describes the camera must read `MonitoringMediaPanel`'s own
     * transport state instead, which is driven exclusively by SFU WebSocket and
     * producer/consumer transport events. */
    offline,
    /* Explicit alias, so a new consumer cannot accidentally read `offline` as a
     * claim about the nursery camera. Prefer this name. */
    apiReachable: !offline,
    /* `error` is now reserved for verdicts the SERVER actually returned about
     * ACCESS (401/403) or for user-initiated action failures. A failed background
     * read never lands here. */
    error,
    start,
    end,
    refresh,
    goingToChild,
    withChild,
  };
}

