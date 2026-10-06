import { useCallback, useEffect, useRef, useState } from 'react';
import { API } from '../../services/api';
import Modal from '../ui/Modal';
import LoadingSpinner from '../ui/LoadingSpinner';
import styles from './feeding-recordings-panel.module.css';

/**
 * FeedingRecordingsPanel - PHASE 3, the "what has been recorded" surface.
 *
 * WHAT IT IS
 *   A read-only, scrollable history of feeding-video recordings for ONE
 *   authorized (job, child) scope, plus a player for completed clips. It is
 *   consumed by BOTH the Parent Active Job screen and /baby-monitoring, so the
 *   two views cannot drift apart in copy or behaviour.
 *
 * IT CONSUMES EXISTING ENDPOINTS ONLY
 *   GET  /api/independent-monitoring/feeding/history?jobId=&childId=  (list)
 *   GET  /api/independent-monitoring/feeding/video/{publicId}         (bytes)
 *   No new API is introduced, and no recording state is ever invented: every
 *   row rendered here was produced by the proven Phase 1/2 pipeline.
 *
 * AUTHORIZED PLAYBACK (why this is not a <video src>)
 *   The streaming endpoint requires Authorization: Bearer, which a media
 *   element cannot send. So playback is: authenticated fetch (arraybuffer) ->
 *   Blob -> object URL -> <video>, and the object URL is REVOKED on close and
 *   on unmount. The physical path never reaches the client (the server only
 *   ever hands out a relative /api/... PlaybackUrl).
 *
 * THE 403 HONESTY RULE (Decision 1, Phase 3)
 *   MonitoringAccess currently requires the JOB to be In Progress, so history
 *   legitimately answers 403 once the sitting ends. That is rendered as a calm
 *   "not available yet" note - NEVER as fake data, never as an empty "you have
 *   nothing" list, and authorization is not weakened anywhere in this file.
 *   The post-completion history requirement is a tracked BACKEND follow-up.
 *
 * FAILURE ROWS
 *   The endpoint also returns Failed attempts (no PlaybackUrl, IsPlayable
 *   false). They are shown truthfully as failed attempts - a request the
 *   monitor device could not complete is history, not something to hide.
 */

const formatWhen = (iso) => {
  if (!iso) return null;
  try {
    // PHASE 9.7 - TEMPORAL HARD-FIX: this string must contain ONLY the clock
    // time. The 'Z' guard stays so naive UTC timestamps from the API still
    // parse correctly (it affects the HOUR shown, never the date). No day,
    // no month, no year can reach the UI from this function.
    const raw = typeof iso === 'string' && !iso.endsWith('Z') && !iso.includes('+') ? `${iso}Z` : iso;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    // Force explicit time formatting without dates
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return null;
  }
};

const formatDuration = (sec) => (sec != null && sec > 0 ? `${sec} sec` : null);

export default function FeedingRecordingsPanel({ jobId, childId, className = '' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // null = reachable, 'forbidden' = server said 403 (job no longer in
  // progress / not authorized), 'error' = transient failure.
  const [blocked, setBlocked] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Player state. `active` is the row being watched; `src` is the object URL
  // that MUST be revoked whenever it changes or the panel unmounts.
  const [active, setActive] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const srcRef = useRef(null);

  const revokeSrc = useCallback(() => {
    if (srcRef.current) {
      URL.revokeObjectURL(srcRef.current);
      srcRef.current = null;
    }
    setVideoSrc(null);
  }, []);

  useEffect(() => {
    if (!jobId || !childId) return undefined;
    // NOTE (react-hooks/set-state-in-effect): no setState runs synchronously
    // in this effect body - every write happens after the `await`, i.e. in the
    // async continuation. The render's `!hasScope` branch already covers the
    // no-scope case without needing a state reset here.
    let cancelled = false;
    (async () => {
      try {
        const data = await API.getFeedingHistory(jobId, childId);
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
        setBlocked(null);
      } catch (err) {
        if (cancelled) return;
        const status = err?.status ?? err?.originalError?.response?.status ?? null;
        if (status === 403 || status === 401) {
          // Not an error to shout about: the current backend rule keeps
          // history closed once the job leaves "In Progress". Say so calmly.
          setBlocked('forbidden');
          setRows([]);
        } else {
          setBlocked('error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId, childId, refreshTick]);

  // Revocation on unmount / scope change: leak-free by construction.
  useEffect(() => () => { if (srcRef.current) URL.revokeObjectURL(srcRef.current); }, []);

  const openPlayer = useCallback(async (row) => {
    if (!row?.PlaybackUrl) return;
    revokeSrc();
    setActive(row);
    setVideoLoading(true);
    setVideoError(null);
    try {
      const bytes = await API.getFeedingVideoBlob(row.PlaybackUrl);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
      srcRef.current = url;
      setVideoSrc(url);
    } catch (err) {
      const status = err?.status ?? err?.originalError?.response?.status ?? null;
      setVideoError(
        status === 403 || status === 404
          ? 'This video is not available for your account.'
          : 'The video could not be loaded. Please try again.'
      );
    } finally {
      setVideoLoading(false);
    }
  }, [revokeSrc]);

  const closePlayer = useCallback(() => {
    revokeSrc();
    setActive(null);
    setVideoError(null);
  }, [revokeSrc]);

  const hasScope = Boolean(jobId && childId);

  return (
    <section className={`${styles.panel} ${className}`.trim()} aria-label="Feeding recordings">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Recorded</p>
          <h2 className={styles.title}>Feeding Recordings</h2>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => setRefreshTick((t) => t + 1)}
          disabled={loading || !hasScope}
          aria-label="Refresh feeding recordings"
        >
          Refresh
        </button>
      </header>

      <div className={styles.rule} aria-hidden="true" />

      {!hasScope ? (
        <p className={styles.note}>No active session to show recordings for.</p>
      ) : loading ? (
        <div className={styles.loading}>
          <LoadingSpinner size={24} />
        </div>
      ) : blocked === 'forbidden' ? (
        // Decision 1: honest, calm, non-fake. This is the CURRENT backend
        // rule (job must be In Progress), not an "empty history".
        <p className={styles.note}>
          Feeding history is available while the babysitting session is in progress.
        </p>
      ) : blocked === 'error' ? (
        <p className={styles.noteError} role="alert">
          Feeding history could not be loaded right now.
        </p>
      ) : rows.length === 0 ? (
        <p className={styles.note}>No feeding recordings yet for this session.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => {
            const when = formatWhen(row.CompletedAtUtc ?? row.RequestedAtUtc);
            const duration = formatDuration(row.DurationSeconds);
            const failed = row.Status === 'Failed';
            return (
              <li key={row.Id} className={styles.card} data-failed={failed ? 'true' : 'false'}>
                {/* PHASE 9.8: the cheap green dot ('●' glyph) is gone - a sleek
                    video-camera glyph (lucide-style 18px strokes, inline SVG so
                    no icon dependency is added) sits in a soft peach premium
                    container. aria-hidden: the row text already says
                    "Recorded" / "Attempt failed". */}
                <div className={styles.cardIcon} aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="6" width="14" height="12" rx="2" />
                    <path d="m16 11 6-3.5v9L16 13" />
                  </svg>
                </div>
                <div className={styles.cardBody}>
                  <p className={styles.cardWhen}>{when ?? 'Unknown time'}</p>
                  <p className={styles.cardMeta}>
                    {duration ? `${duration} · ` : ''}
                    {failed ? 'Attempt failed' : row.Status === 'Completed' ? 'Recorded' : row.Status}
                  </p>
                </div>
                {row.IsPlayable && row.PlaybackUrl ? (
                  /* PHASE 9.9 - icon-only minimalist control: the visible label
                     is gone (assistive tech keeps it via aria-label/title), so
                     the row's right edge is a pure 38px circle. */
                  <button
                    type="button"
                    className={styles.play}
                    onClick={() => openPlayer(row)}
                    aria-label="View feeding video"
                    title="View Feeding Video"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <polygon points="8 5 19 12 8 19" />
                    </svg>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* ---- Player modal: authenticated bytes only, object URL revoked on
              close (and again on unmount as a belt-and-braces guard).
              PHASE 9.4: variant="player" gives this dialog a strict 24px
              interior padding and a 640px shell, so the <video> stays inside
              its container; the textual Close button is replaced by a circular
              floating ✕ pinned to the modal's top-right corner. ---- */}
      <Modal
        open={Boolean(active)}
        onClose={closePlayer}
        variant="player"
        labelledBy="feeding-player-title"
      >
        <div className={styles.playerShell}>
          <button
            type="button"
            className={styles.playerClose}
            onClick={closePlayer}
            aria-label="Close video player"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <p className={styles.playerTitle} id="feeding-player-title">Feeding video</p>
          {videoLoading ? (
            <div className={styles.playerLoading}>
              <LoadingSpinner size={36} />
            </div>
          ) : videoError ? (
            <p className={styles.playerError} role="alert">{videoError}</p>
          ) : videoSrc ? (
            <video
              className={styles.playerVideo}
              src={videoSrc}
              controls
              autoPlay
              playsInline
              onError={() => setVideoError('The video could not be played in this browser.')}
            />
          ) : null}
        </div>
      </Modal>
    </section>
  );
}
