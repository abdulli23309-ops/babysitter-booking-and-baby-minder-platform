import { useCallback, useEffect, useState } from 'react';
import { API } from '../services/api';

/**
 * useMonitoringMedia - Phase 11
 *
 * PURPOSE
 * Fetches the SERVER-ISSUED media session for a monitoring scope and exposes it
 * to the UI. This is the only sanctioned way to obtain a room, because the room
 * and its join path is prepared on the server after MonitoringAccess has
 * approved the caller.
 *
 * WHY THIS EXISTS (and what it replaces)
 * The old code read `location.state?.roomName` - a room name that had been
 * passed around through React Router navigation and ultimately derived from a
 * legacy cry alert. That is a shared secret with no authorization attached, and
 * it is exactly the "room-name-only access" pattern the security audit forbids.
 * The parent monitoring screen now asks the server instead.
 *
 * RULES THIS HOOK ENFORCES
 *   1. The client never invents an address, room or credential. If the server says
 *      `configured: false`, the UI shows an honest "live video unavailable"
 *      message and NOTHING else. It must never fall back to a public room
 *      external public media service.
 *   2. The client never decides its own role. `canPublish` comes from the
 *      server; a sitter is always receive-only.
 *   3. The room description is held in component state only. It is never written
 *      to localStorage/sessionStorage and never logged.
 *   4. A 403/404 means "you are not allowed to watch this baby". The hook
 *      reports that as `denied` so the UI can say so plainly, rather than
 *      pretending the video is merely still loading.
 *
 * PARAMETERS
 *   jobId / childId  - the monitoring scope, or null while unknown.
 *   enabled          - set false to avoid calling before the scope is resolved.
 *
/**
 * PARAMETERS
 *   jobId / childId  - the monitoring scope, or null while unknown.
 *   enabled          - set false to avoid calling before the scope is resolved.
 *   refreshKey       - any value that, when it changes, forces a refetch. Pass the
 *                      monitoring session status so the media request is retried
 *                      the moment Child Mode actually starts. Without this the
 *                      first answer (typically 404 "no active session yet") would
 *                      stick for the rest of the screen's life.
 *
 * RETURNS
 *   { status, media, canPublish, reason, denied, reload }
 *   status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'no-session'
 *           | 'denied' | 'error'
 */
export default function useMonitoringMedia(jobId, childId, enabled = true, refreshKey = null) {
  // ONE piece of state, tagged with the scope it belongs to.
  //
  // WHY TAGGED, AND WHY THERE IS NO STORED 'loading' FLAG
  // Two real problems disappear with this shape:
  //   1. React's set-state-in-effect rule. A stored `status` would have to be
  //      written to 'loading' synchronously at the top of the effect, which
  //      cascades a render. Instead "loading" is DERIVED: we have no result for
  //      the current scope, so we are loading. No setState happens in the effect.
  //   2. Stale scope flashes. If the user switches child, a result tagged with
  //      the previous scope no longer matches and is discarded automatically,
  //      so the previous baby's media can never be shown against the new child.
  const [result, setResult] = useState(null);

  // The scope key identifies WHICH request a result belongs to. It folds in
  // `refreshKey` so a change to the monitoring session status invalidates any
  // previous answer and forces a fresh request (e.g. Child Mode just started).
  const scopeKey =
    enabled && childId ? `${jobId || 0}:${childId}:${refreshKey}` : null;
  const current = result && result.scopeKey === scopeKey ? result : null;

  const load = useCallback(async () => {
    // Nothing to request yet: do not fetch, and do not write state.
    if (!scopeKey) return;
    try {
      const data = await API.getMonitoringMedia(jobId || null, childId);
      // NOTE ON CASING: this API returns PASCAL-CASE JSON (Configured, Reason,
      // RoomId, JoinPath, CanPublish) because that is what the Web API serialiser emits
      // and what the rest of this app already reads (session.Status, d.MonitorSession_ID).
      // Reading data.configured here silently yielded undefined, which made every
      // deployment look unconfigured and showed a generic message instead of the
      // server's real reason. Keep this in step with the DTO field names.
      if (data?.Configured) {
        setResult({ scopeKey, status: 'ready', media: data, reason: '' });
      } else {
        // Server is authoritative: no provider credentials means no video.
        setResult({
          scopeKey,
          status: 'unavailable',
          media: null,
          reason: data?.Reason || 'Live video is unavailable.',
        });
      }
    } catch (err) {
      const code = err?.response?.status ?? err?.status;
      if (code === 403) {
        // 403 means MonitoringAccess genuinely refused this caller. Saying so is
        // correct and is the only "you may not watch this" signal we surface.
        setResult({
          scopeKey,
          status: 'denied',
          media: null,
          reason: 'You are not authorised to view this child.',
        });
      } else if (code === 404) {
        // 404 means no authorized job or independent session was available - NOT
        // an authorization failure. Reporting it as
        // "not authorised" would tell an owner parent they are forbidden from
        // watching their own child, which is both wrong and alarming.
        setResult({
          scopeKey,
          status: 'no-session',
          media: null,
          reason: 'No monitoring session is available for this child yet.',
        });
      } else {
        setResult({
          scopeKey,
          status: 'error',
          media: null,
          reason: 'Could not reach the live video service.',
        });
      }
    }
  // `scopeKey` already folds `refreshKey` in, so depending on scopeKey is
  // sufficient; listing refreshKey again would be redundant (and ESLint is
  // right to say so). Changing the session status changes scopeKey, which
  // re-runs this effect and therefore re-requests the media state.
  }, [scopeKey, jobId, childId]);

  useEffect(() => {
    // `load` is async, but React's set-state-in-effect rule is a static check:
    // calling it directly still looks like a synchronous update during the
    // effect pass. Deferring by one microtask is the pattern already used by
    // useMonitoring.js for the same reason, so both hooks stay consistent.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return {
    // No scope yet => nothing to show. Scope present but no matching result =>
    // a request is genuinely in flight.
    status: scopeKey ? (current?.status ?? 'loading') : 'idle',
    media: current?.media ?? null,
    // The SERVER says whether this participant may publish. Never derive it
    // locally from the user's role - that would be client-side authority.
    canPublish: Boolean(current?.media?.Configured && current?.media?.CanPublish),
    reason: current?.reason ?? '',
    denied: current?.status === 'denied',
    reload: load,
  };
}


