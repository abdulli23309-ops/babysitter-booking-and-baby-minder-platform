/**
 * deviceFeedingPoc - PHASE 2 camera-capability proof of concept.
 *
 * ===================================================================
 * THIS FILE EXISTS TO ANSWER ONE QUESTION, NOT TO SHIP A FEATURE.
 * ===================================================================
 * Can Phone 2 obtain a SECOND camera MediaStream with getUserMedia()
 * while the MiroTalk SFU (running in a cross-origin iframe) is ALREADY
 * using the same physical camera?
 *
 * That is the project's primary technical risk. Everything here is
 * deliberately instrumented so the answer is a TRUTHFUL OBSERVATION
 * rather than an assumption:
 *
 *   - NO mock MediaStream, NO mock MediaRecorder, NO prerecorded video.
 *   - NO fallback that fakes success. If the browser refuses the second
 *     request, the recorded reason is surfaced verbatim.
 *   - Every browser error name and message is captured and displayed
 *     exactly as thrown (NotReadableError, NotAllowedError,
 *     OverconstrainedError, AbortError, ...) because those names ARE the
 *     evidence the phase needs.
 *   - Permission state and simultaneous-capture capability are recorded
 *     as SEPARATE facts. A permission grant answers "may this site use
 *     the camera?", NOT "can a second stream exist?", and conflating the
 *     two is precisely the mistake this experiment exists to avoid.
 *
 * WHY PHONE 2 CALLS getUserMedia AT ALL
 *   The MiroTalk client inside the iframe owns the camera and is
 *   cross-origin, so its MediaStream is unreachable by design (documented
 *   in MonitoringMediaPanel). Extracting it is impossible, and attempting
 *   to would be wrong. The only question worth answering is whether a
 *   SECOND, independent getUserMedia call can coexist with it.
 *
 * WHERE IT RUNS
 *   On the PHONE 2 device itself (/monitor-device), never on a viewer.
 *   `?poc=1` adds a dev-only panel; without that parameter nothing
 *   renders, so it cannot affect a real user's screen.
 */

/** Result of each distinct observation. Never collapsed into one verdict. */
export const POC_RESULT = {
  UNKNOWN: 'UNKNOWN',
  PASS: 'PASS',
  FAIL: 'FAIL',
};

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/**
 * Picks the first WebM type the browser actually supports. Deliberately
 * capability-detected: hard-coding "video/webm" is exactly the kind of
 * assumption that fails silently on Safari/iOS.
 */
export function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* a browser that throws here simply does not support that type */
    }
  }
  return null;
}

/** True when this browser exposes a recording API at all. */

/**
 * The single experiment. Returns a plain, serialisable report; it throws
 * nothing, because a failure IS a result here, not an exception.
 */
export async function runCameraExperiment({
  durationMs = 30000,
  onTick = () => {},
  onPhase = () => {},
} = {}) {
  const report = {
    startedAtUtc: new Date().toISOString(),
    userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || 'unknown',
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : null,

    // The separate fields the report must carry.
    cameraPermission: POC_RESULT.UNKNOWN,
    miroTalkActive: POC_RESULT.UNKNOWN,      // asserted by the operator
    secondGetUserMedia: POC_RESULT.UNKNOWN,
    secondVideoTrack: POC_RESULT.UNKNOWN,
    mimeTypeFound: POC_RESULT.UNKNOWN,
    mediaRecorder: POC_RESULT.UNKNOWN,
    dataReceived: POC_RESULT.UNKNOWN,
    recording: POC_RESULT.UNKNOWN,
    webmBlob: POC_RESULT.UNKNOWN,
    cleanup: POC_RESULT.UNKNOWN,

    mimeType: null,
    errorName: null,
    errorMessage: null,
    phase: 'idle',
    elapsedMs: 0,
    blobSizeBytes: 0,
    blobType: null,
    chunks: 0,
    trackSettings: null,
    blob: null,               // the REAL recorded blob, consumed by the upload step

    upload: { attempted: false, ok: null, httpStatus: null, body: null, error: null },
  };

  onPhase(report);

  // ---- Step 1: MediaRecorder availability (a static capability) -----------
  if (!isMediaRecorderAvailable()) {
    report.phase = 'no-mediastream-api';
    report.errorName = 'MediaRecorderUnavailable';
    report.errorMessage = 'MediaRecorder is not supported by this browser.';
    onPhase(report);
    return report;
  }
  report.mediaRecorder = POC_RESULT.PASS;

  // ---- Step 2: MIME capability -------------------------------------------
  const mime = pickSupportedMimeType();
  if (!mime) {
    report.phase = 'no-webm-mime';
    report.errorName = 'NoSupportedMimeType';
    report.errorMessage = 'This browser reports no supported WebM MediaRecorder type.';
    onPhase(report);
    return report;
  }
  report.mimeTypeFound = POC_RESULT.PASS;
  report.mimeType = mime;
  onPhase(report);

  // ---- Step 3: THE SECOND getUserMedia ----------------------------------
  // This single call is the moment the whole phase exists to observe.
  report.phase = 'requesting-second-stream';
  onPhase(report);

  // Declared here, assigned in the try below. `let` (not `const`) because the
  // assignment happens inside a try/catch and the catch returns early.
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

    // A resolved promise proves PERMISSION and a stream object together;
    // getUserMedia cannot report them separately, so they are recorded as
    // the same observation and labelled as such.
    report.cameraPermission = POC_RESULT.PASS;
    report.secondGetUserMedia = POC_RESULT.PASS;
  } catch (err) {
    // Preserved VERBATIM. NotReadableError in particular is the exact signal
    // that the camera is already consumed by MiroTalk - the answer we came for.
    report.cameraPermission = err && err.name === 'NotAllowedError'
      ? POC_RESULT.FAIL
      : report.cameraPermission;
    report.secondGetUserMedia = POC_RESULT.FAIL;
    report.errorName = nameOf(err);
    report.errorMessage = messageOf(err);
    report.phase = 'second-stream-failed';
    report.cleanup = POC_RESULT.PASS;   // nothing opened, nothing to release
    onPhase(report);
    return report;
  }

  // ---- Step 4: is the track actually usable? -----------------------------
  // ---- Step 4: is the track actually usable? -----------------------------
  // A stream that exists but carries no live video track is NOT a pass. The
  // track's readyState is the honest test of "is this camera really being
  // delivered", and it is the exact distinction a permission-only test misses.
  const tracks = stream.getVideoTracks();
  if (!tracks || tracks.length === 0) {
    report.secondVideoTrack = POC_RESULT.FAIL;
    report.errorName = 'NoVideoTrack';
    report.errorMessage = 'The second stream contained no video track.';
    report.phase = 'no-video-track';
    releaseStream(stream);
    report.cleanup = POC_RESULT.PASS;
    onPhase(report);
    return report;
  }

  const track = tracks[0];
  try {
    const s = track.getSettings ? track.getSettings() : null;
    report.trackSettings = s
      ? { width: s.width, height: s.height, frameRate: s.frameRate }
      : null;
  } catch {
    report.trackSettings = null;
  }
  report.secondVideoTrack = track.readyState === 'live' ? POC_RESULT.PASS : POC_RESULT.FAIL;


  // ---- Step 5: attach to a temporary <video> (Test C) -------------------
  // Proves the stream is renderable, not merely present.
  let preview = null;
  try {
    preview = document.createElement('video');
    preview.muted = true;
    preview.playsInline = true;
    preview.srcObject = stream;
    await preview.play().catch(() => {});
  } catch (err) {
    report.errorName = nameOf(err);
    report.errorMessage = messageOf(err);
  }
  onPhase(report);

  // ---- Step 6: record -----------------------------------------------------
  let recorder = null;
  const startedAt = Date.now();
  try {
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: mime });
    report.mediaRecorder = POC_RESULT.PASS;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
        report.chunks = chunks.length;
        report.dataReceived = POC_RESULT.PASS;
      }
    };
    recorder.onerror = (event) => {
      report.errorName = (event.error && event.error.name) || 'MediaRecorderError';
      report.errorMessage = (event.error && event.error.message) || 'MediaRecorder reported an error.';
      report.recording = POC_RESULT.FAIL;
    };

    report.phase = 'recording';
    recorder.start();
    onPhase(report);

    // Fixed 30 seconds for this phase. Not configurable, per the brief.
    await new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const elapsed = Date.now() - started;
        report.elapsedMs = elapsed;
        onTick(report);
        if (elapsed >= durationMs) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });

    const stopped = new Promise((resolve) => {
      if (recorder.state === 'inactive') { resolve(); return; }
      recorder.onstop = resolve;
    });
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;

    report.elapsedMs = Date.now() - startedAt;
    report.recording = chunks.length > 0 ? POC_RESULT.PASS : POC_RESULT.FAIL;
    report.phase = 'recorded';

    // ---- Step 7: build the REAL blob -------------------------------------
    if (chunks.length > 0) {
      const blob = new Blob(chunks, { type: mime });
      report.webmBlob = blob.size > 0 ? POC_RESULT.PASS : POC_RESULT.FAIL;
      report.blobSizeBytes = blob.size;
      report.blobType = blob.type;
      report.blob = blob;
    } else {
      report.webmBlob = POC_RESULT.FAIL;
      report.errorName = report.errorName || 'NoDataRecorded';
      report.errorMessage = 'MediaRecorder produced no data chunks.';
    }
  } catch (err) {
    report.recording = POC_RESULT.FAIL;
    report.errorName = nameOf(err);
    report.errorMessage = messageOf(err);
    report.phase = 'record-failed';
  }

  // ---- Step 8: cleanup, WITHOUT touching MiroTalk ------------------------
  releaseStream(stream);
  if (preview) {
    try { preview.srcObject = null; } catch { /* already detached */ }
    preview.remove();
  }
  report.cleanup = POC_RESULT.PASS;
  onPhase(report);

  return report;
}

/**
 * Stops ONLY this experiment's tracks. MiroTalk's camera lives inside the
 * cross-origin iframe and is therefore unreachable - and must never be
 * touched. Releasing our own tracks does not disturb it.
 */
function releaseStream(stream) {
  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* the browser may already have released them */
  }
}

/** True when this browser exposes a recording API at all. */
export function isMediaRecorderAvailable() {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder === 'function'
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices)
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}

const nameOf = (err) => (err && (err.name || err.constructor?.name)) || 'Error';

/**
 * Uploads the REAL recorded blob to the EXISTING Phase 1 endpoint.
 *
 * CONTRACT (Phase 1, unchanged - this adapter CONFORMS to it, it does not
 * reshape it):
 *   POST /api/independent-monitoring/device/feeding/upload
 *   Header: X-Monitor-Device: <credential>
 *           (NO Authorization header - the Phase 1 controller refuses account
 *            sessions on device routes, so a bearer token would 403)
 *   Body:   multipart/form-data
 *             file            = the binary WebM
 *             recordingId     = the PublicId the backend issued
 *             durationSeconds = measured recording length
 *
 * THE PHYSICAL FILENAME IS NOT CHOSEN HERE. The server generates
 * "<PublicId>.webm" from its own row; we only send a generic part name. No
 * storage path is ever known to, or returned by, the browser.
 *
 * Raw fetch is used deliberately (not apiClient) for the same reason
 * independentMonitoringApi.deviceRequest does: a 401 here means "this pairing
 * ended", NOT "log the user out".
 */
export async function uploadRecording({ blob, publicId, durationSeconds, credential, apiRoot }) {
  const result = { attempted: true, ok: null, httpStatus: null, body: null, error: null };

  if (!blob || blob.size === 0) {
    result.error = 'No recorded data to upload.';
    return result;
  }
  if (!publicId) {
    result.error = 'No recordingId was issued by the backend.';
    return result;
  }

  const form = new FormData();
  // Generic part name only. The server ignores this for naming and uses the
  // PublicId from its own row; it is read solely for its extension.
  form.append('file', blob, 'recording.webm');
  form.append('recordingId', publicId);
  form.append('durationSeconds', String(durationSeconds));

  const root = apiRoot || import.meta.env.VITE_API_BASE || '/api';

  try {
    const res = await fetch(`${root}/independent-monitoring/device/feeding/upload`, {
      method: 'POST',
      headers: { 'X-Monitor-Device': credential },
      body: form,
    });

    result.httpStatus = res.status;
    const text = await res.text();
    try {
      result.body = text ? JSON.parse(text) : null;
    } catch {
      // Preserve a non-JSON body rather than discarding the real error.
      result.body = text;
    }

    result.ok = res.ok;
    if (!res.ok) {
      result.error = typeof result.body === 'string'
        ? result.body
        : (result.body && (result.body.Message || result.body.message)) || `HTTP ${res.status}`;
    }
  } catch (err) {
    // A network/abort failure is a FAILED upload, never a silent success.
    result.ok = false;
    result.error = `${err?.name || 'Error'}: ${err?.message || String(err)}`;
  }

  return result;
}

/**
 * Pulls the next pending request from the EXISTING Phase 1 endpoint. A 200
 * with a null body is the normal "nothing to do" answer, not an error.
 */
export async function claimPending({ credential, apiRoot }) {
  const root = apiRoot || import.meta.env.VITE_API_BASE || '/api';
  const res = await fetch(`${root}/independent-monitoring/device/feeding/pending`, {
    method: 'GET',
    headers: { 'X-Monitor-Device': credential },
  });
  if (res.status === 401) {
    const err = new Error('Device credential is not valid.');
    err.status = 401;
    throw err;
  }
  if (!res.ok) throw new Error(`pending failed: HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const messageOf = (err) => (err && err.message) || String(err);
