/**
 * Phase 7 — Family, Pause and DND panel for a parent.
 *
 * WHY THIS IS A STANDALONE PANEL
 *   Phases 3-6 shipped backend-only: no frontend screen consumes the monitoring
 *   session API yet, so there is no existing monitoring surface to extend. This
 *   component is self-contained and takes the monitoring SCOPE (jobId + childId)
 *   as props, so it can be dropped into any parent screen that knows them.
 *
 * SECURITY (the important part)
 *   The UI is NEVER the authorization boundary. Every action calls an endpoint
 *   that re-derives the caller from the bearer token; no Phase 7 request body
 *   has a field for "acting user", "approver", "DND owner", "pause duration" or
 *   "pause expiry". Therefore:
 *     - hiding/disabling a button is PRESENTATION ONLY - it prevents a
 *       confusing click, it is not the rule;
 *     - the server re-checks every rule regardless of what this UI shows;
 *     - the 2:30 countdown is displayed from the server-computed
 *       PauseExpiresAtUtc, never counted down from a client-chosen start.
 *
 * FAILURE BEHAVIOUR
 *   Each call catches its own error and surfaces it. After any action the
 *   affected data is re-fetched from the server, so the UI can never show an
 *   optimistic result that the backend rejected.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import API from '../../services/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import styles from './phase7-family-panel.module.css';

const formatCountdown = (seconds) => {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

const RELATIONS = ['Father', 'Mother', 'Guardian'];

export default function Phase7FamilyPanel({
  jobId,
  childId,
  sessionActive = false,
  pause: pauseState,
  pauseUpdatedAt = 0,
  dndStates = [],
  refreshMonitoring,
}) {
  const { userId } = useAuth();
  const [guardians, setGuardians] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [relation, setRelation] = useState('Father');
  const aliveRef = useRef(true);

  const hasScope = Number(jobId) > 0 && Number(childId) > 0;

  // Countdown mirroring the server value.
  //
  // The SERVER is authoritative: `serverSeconds` is only ever set from a server
  // response, and `serverAt` is the client clock reading at that moment. A 1 Hz
  // tick advances `now` so the label animates between polls, but a pause can
  // never be LENGTHENED by the client - the next poll overwrites both values
  // with the server's, and once they hit zero the label stops.
  const [now, setNow] = useState(0);

  // The parent screen owns pause/DND reads so these facts are fetched once and
  // only after its session poll confirms an Active monitoring session.
  const pause = sessionActive ? pauseState : null;
  const dnd = sessionActive ? dndStates : [];
  const serverSeconds = pause?.SecondsRemaining ?? 0;
  const serverAt = pauseUpdatedAt;

  const loadFamily = useCallback(async (signal) => {
    if (!hasScope || signal?.aborted || !aliveRef.current) return;
    try {
      const [g, inv] = await Promise.all([
        API.getGuardians(jobId, childId, { signal }).catch(() => []),
        API.getMyGuardianInvitations({ signal }).catch(() => []),
      ]);
      if (signal?.aborted || !aliveRef.current) return;
      setGuardians(Array.isArray(g) ? g : []);
      setInvitations(Array.isArray(inv) ? inv : []);
    } catch {
      if (signal?.aborted || !aliveRef.current) return;
      /* non-fatal: the panel simply shows no data */
    }
  }, [jobId, childId, hasScope]);

  useEffect(() => {
    const controller = new AbortController();
    aliveRef.current = true;
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) loadFamily(controller.signal);
    });
    return () => {
      aliveRef.current = false;
      controller.abort();
    };
  }, [loadFamily]);

  useEffect(() => {
    if (!pause?.IsActive) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pause?.IsActive]);

  // Pure derivation from state only - no refs and no clock reads during render.
  const remaining = pause?.IsActive
    ? Math.max(0, serverSeconds - Math.floor((now - serverAt) / 1000))
    : 0;

  const run = async (label, action, after) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
      if (aliveRef.current) setMessage(`${label} — done.`);
    } catch (err) {
      if (aliveRef.current) setMessage(`${label} failed: ${err?.message ?? 'Please try again.'}`);
    } finally {
      // Always re-read server state so a rejected action never leaves the UI
      // showing an optimistic result.
      await after?.();
      if (aliveRef.current) setBusy(false);
    }
  };

  const myDndActive = dnd.find((x) => x.IsCurrentUser && x.IsActive);
  const otherGuardianDnd = dnd.find((x) => !x.IsCurrentUser && x.IsActive);
  const awaitingOther = pause?.Status === 'Requested';
  // Phase 9 fix: the requester must not be offered Approve/Decline on their
  // OWN request. The server already refuses self-approval (403), so those
  // buttons could only ever fail - showing them was misleading. Approve/Decline
  // belong to the other guardian; only the requester may Withdraw.
  const iRequestedPause =
    awaitingOther &&
    pause?.RequestedByParent_ID != null &&
    Number(pause.RequestedByParent_ID) === Number(userId);

  if (!hasScope) return null;

  return (
    <section className={styles.familyPanel} aria-label="Family, pause and do-not-disturb">
      {message ? <p role="status" className={styles.feedback}>{message}</p> : null}

      {/* ---------------- Connected guardians ---------------- */}
      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Family &amp; guardians</h3>
        <ul className={styles.list}>
          {guardians.map((g) => (
            <li className={styles.listItem} key={g.Parent_ID}>
              {g.FullName}
              {g.Relation ? ` (${g.Relation})` : ''}
              {g.IsPrimary ? ' — primary' : ''}
              {g.CanApprovePause ? ' — can approve a pause' : ''}
              {g.IsCurrentUser ? ' — you' : ''}
            </li>
          ))}
          {guardians.length === 0 ? <li className={styles.listItem}>No connected guardians.</li> : null}
        </ul>

        <div className={styles.invitationForm}>
          <label className={styles.fieldLabel} htmlFor="phase7-invite-identifier">Invite the other parent</label>
          <input
            className={styles.field}
            id="phase7-invite-identifier"
            type="text"
            value={identifier}
            placeholder="username or email"
            onChange={(e) => setIdentifier(e.target.value)}
          />
          <label className={styles.fieldLabel} htmlFor="phase7-invite-relation">Relationship</label>
          <select
            className={styles.field}
            id="phase7-invite-relation"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            className={styles.actionButton}
            type="button"
            disabled={busy || identifier.trim() === ''}
            onClick={() => run('Invitation sent', async () => {
              await API.createGuardianInvitation(Number(childId), identifier.trim(), relation);
              setIdentifier('');
            }, loadFamily)}
          >
            Send invitation
          </button>
          <p className={styles.hint}>
            Enter a username or email — never an account id. The other parent accepts
            the invitation from their own account.
          </p>
        </div>
      </article>

      {/* ---------------- Invitations addressed to me ---------------- */}
      {invitations.some((i) => i.Status === 'Pending') ? (
        <article className={styles.card}>
          <h4 className={styles.cardTitle}>Invitations for you</h4>
          <ul className={styles.list}>
            {invitations
              .filter((i) => i.Status === 'Pending')
              .map((i) => (
                <li className={styles.listItem} key={i.GuardianInvitation_ID}>
                  Help monitor {i.ChildName} (invited by {i.InviterName})
                  <button
                    className={styles.actionButton}
                    type="button"
                    disabled={busy}
                    onClick={() => run('Invitation accepted', () =>
                      API.acceptGuardianInvitation(i.GuardianInvitation_ID), loadFamily)}
                  >
                    Accept
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={busy}
                    onClick={() => run('Invitation declined', () =>
                      API.rejectGuardianInvitation(i.GuardianInvitation_ID), loadFamily)}
                  >
                    Decline
                  </button>
                </li>
              ))}
          </ul>
        </article>
      ) : null}

      {/* ---------------- Pause ---------------- */}
      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Monitoring pause</h3>
        {pause?.Status === 'Approved' ? (
          <p role="status">
            {pause.IsActive
              ? `Monitoring temporarily paused by parent — ${formatCountdown(remaining)} remaining.`
              : 'The pause has expired; monitoring has resumed.'}
          </p>
        ) : null}

        {awaitingOther ? (
          <p>
            Waiting for the other guardian to decide
            {pause?.RequestedByName ? ` (requested by ${pause.RequestedByName})` : ''}.
            {/* Phase 9: the requester only ever sees Withdraw. Approve/Decline
                are for the other guardian; the server refuses self-approval. */}
            {iRequestedPause ? (
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={busy}
                onClick={() => run('Request withdrawn', () =>
                    API.cancelPause(pause.MonitoringPause_ID), refreshMonitoring)}
              >
                Withdraw
              </button>
            ) : (
              <>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  disabled={busy}
                  onClick={() => run('Pause approved', () =>
                    API.approvePause(pause.MonitoringPause_ID), refreshMonitoring)}
                >
                  Approve
                </button>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  disabled={busy}
                  onClick={() => run('Pause declined', () =>
                    API.denyPause(pause.MonitoringPause_ID), refreshMonitoring)}
                >
                  Decline
                </button>
              </>
            )}
          </p>
        ) : (
          <button
            className={styles.actionButton}
            type="button"
            disabled={busy}
            onClick={() => run('Pause requested', () =>
              API.requestPause(Number(jobId), Number(childId)), refreshMonitoring)}
          >
            Request a pause
          </button>
        )}
        <p className={styles.hint}>
          A pause lasts exactly 2 minutes 30 seconds and must be approved by the other
          guardian. While it is active no new cry alert is raised for this child, and
          the sitter sees &quot;Monitoring temporarily paused by parent&quot;.
        </p>
      </article>

      {/* ---------------- DND ---------------- */}
      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Do not disturb</h3>
        {myDndActive ? (
          <p role="status">
            DND is on for you until {new Date(myDndActive.DndUntilUtc).toLocaleTimeString()}.
            Alerts are still recorded — you simply will not be rung.
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={busy}
              onClick={() => run('DND turned off', () =>
                API.disableDnd(Number(jobId), Number(childId)), refreshMonitoring)}
            >
              Turn off DND
            </button>
          </p>
        ) : (
          <button
            className={styles.actionButton}
            type="button"
            // The server refuses this when the other parent is already DND; the
            // disabled state only avoids a pointless round trip.
            disabled={busy || Boolean(otherGuardianDnd)}
            onClick={() => run('DND turned on', () =>
              API.enableDnd(Number(jobId), Number(childId)), refreshMonitoring)}
          >
            Turn on DND
          </button>
        )}
        {otherGuardianDnd ? (
          <p className={styles.hint}>
            {otherGuardianDnd.FullName} has DND on, so you stay alertable. Only one
            parent can be on DND for a session at a time.
          </p>
        ) : null}
        <p className={styles.hint}>
          DND never stops a cry alert from being recorded or sent to the other parent.
          It only silences your own sound and vibration.
        </p>
      </article>
    </section>
  );
}
