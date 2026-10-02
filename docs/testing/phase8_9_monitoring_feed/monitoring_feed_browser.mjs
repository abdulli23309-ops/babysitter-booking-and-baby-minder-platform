// =====================================================================
// PHASE 8.9 - REAL BROWSER verification of the monitoring-FEED presentation
// ---------------------------------------------------------------------
// WHAT THIS PROVES (and what it refuses to claim)
//   The acceptance criterion for this phase is visual + real media, so this
//   harness drives two REAL Chrome pages against the REAL backend and the REAL
//   8x8.vc (JaaS) room, then inspects the DOM INSIDE the Jitsi iframe.
//
//   It therefore proves:
//     * the publisher and the viewer really join the SAME JaaS room
//     * the viewer really receives the remote video (video element exists,
//       width/height > 0, readyState >= 3, not paused, currentTime advances)
//     * the viewer really receives remote audio
//     * the viewer is NOT presented with a self-view tile (Jitsi's own
//       `#filmstripLocalVideo` node is absent) or a filmstrip / toolbar /
//       participant-count chrome
//     * the publisher's own camera + microphone controls are still present
//     * the exact configuration keys the app sends are on the iframe URL
//     * no horizontal overflow at 320 / 390 / 480 / desktop
//
//   It deliberately does NOT claim anything it did not observe. Every element
//   name asserted below is a real Jitsi DOM id taken from the jitsi-meet
//   sources (LargeVideo.web.tsx, Filmstrip.tsx), so a "participant tile" is
//   only ever reported when Jitsi's own tile markup is actually there.
//
// HOW IT RUNS
//   Identity is injected through the app's OWN session keys, so the real
//   AuthProvider, the real ProtectedRoute and the real media hook all run. No
//   app code is bypassed and no authorization is stubbed.
//
// PRECONDITION
//   * `npm run dev` (Vite) on http://127.0.0.1:5173
//   * IIS Express serving WebApplication2 on https://localhost:44368 with the
//     Web.MonitoringMedia.config JaaS settings
//   * env LITTLECARE_TEST_PARENT_TOKEN / LITTLECARE_TEST_SITTER_TOKEN - live
//     session tokens for an assigned sitter and the job's parent
//   * env LITTLECARE_TEST_JOB_ID / LITTLECARE_TEST_CHILD_ID (default 9001 / 1)
// =====================================================================
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = process.env.LITTLECARE_APP_URL || 'http://127.0.0.1:5173';
const API = process.env.LITTLECARE_API_URL || 'https://localhost:44368/api';
const JOB_ID = Number(process.env.LITTLECARE_TEST_JOB_ID || 9001);
const CHILD_ID = Number(process.env.LITTLECARE_TEST_CHILD_ID || 1);
const PARENT_TOKEN = process.env.LITTLECARE_TEST_PARENT_TOKEN;
const SITTER_TOKEN = process.env.LITTLECARE_TEST_SITTER_TOKEN;
const SHOT_DIR = process.env.LITTLECARE_SHOT_DIR || 'e:\\Fyp Fazooliyaaat\\shots\\phase8_9';
const CHROME = process.env.LITTLECARE_CHROME
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!PARENT_TOKEN || !SITTER_TOKEN) {
  throw new Error('Set LITTLECARE_TEST_PARENT_TOKEN and LITTLECARE_TEST_SITTER_TOKEN (live UserSessions tokens).');
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
mkdirSync(SHOT_DIR, { recursive: true });

let pass = 0; let fail = 0;
const check = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`);
};
const note = (msg) => console.log(`  ....  ${msg}`);

// ---------------------------------------------------------------------
// The remote video acceptance probe, run INSIDE the Jitsi iframe.
// Jitsi renders the dominant/large participant into a real <video id="largeVideo">.
// ---------------------------------------------------------------------
const VIDEO_PROBE = `(() => {
  const v = document.querySelector('#largeVideo');
  const info = {
    present: !!v,
    tag: v ? v.tagName : null,
    width: v ? v.videoWidth : 0,
    height: v ? v.videoHeight : 0,
    readyState: v ? v.readyState : -1,
    paused: v ? v.paused : null,
    currentTime: v ? Number(v.currentTime.toFixed(3)) : -1,
    videoElements: document.querySelectorAll('video').length,
  };
  return info;
})()`;

// Everything Jitsi itself renders. Each key is an id taken from jitsi-meet
// (LargeVideo.web.tsx, Filmstrip.tsx, Thumbnail.tsx).
//
// PHASE 8.9 - EXISTENCE IS NOT VISIBILITY. Jitsi renders several of these
// containers unconditionally and then hides them, so asking "is #remoteVideos
// in the DOM?" would wrongly report a filmstrip that the user cannot see. Every
// element below is therefore measured by its RENDERED BOX, and a "participant
// tile" is only counted when a real `.videocontainer` (Jitsi's own tile class)
// has a non-zero width and height on screen.
const CHROME_PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  // ON SCREEN, not merely laid out. Jitsi keeps hidden containers in the DOM
  // with a real width/height, and it can also park the filmstrip off-viewport
  // with a CSS transform. An element only counts as shown if its box actually
  // intersects the visible frame AND it is not display/visibility/opacity
  // hidden. This is what stops a "participant tile" being reported when the
  // user cannot see one.
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const onScreen = r.width > 1 && r.height > 1
      && r.right > 0 && r.bottom > 0
      && r.left < window.innerWidth && r.top < window.innerHeight
      && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), top: Math.round(r.top),
      onScreen,
      text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
    };
  };
  // PHASE 8.9 - tile counting, done precisely.
  // Jitsi puts the class "videocontainer" on the LARGE video container itself
  // (that element carries id "largeVideoContainer"), so counting every
  // ".videocontainer" would report the single monitor feed as if it were an
  // extra participant tile. A genuine participant tile is a thumbnail, so the
  // large-video container is excluded and only real tiles are counted.
  const allTiles = [...document.querySelectorAll('.videocontainer')];
  const tiles = allTiles.filter((t) => t.id !== 'largeVideoContainer');
  const onScreenTiles = tiles.filter((t) => box(t)?.onScreen);
  // The conference subject header: Jitsi's ConferenceInfoContainer adds the
  // class "visible" ONLY when the label is actually rendered, so
  // ".subject.visible" is the real signal - a bare ".subject" can match an
  // unrelated node and produce a false "the header is showing" reading.
  const subject = q('.subject.visible');
  const toolbarButtons = [...document.querySelectorAll(
    '.toolbox-button, [class*="toolbox"] button, #toolbox button')];
  const audio = [...document.querySelectorAll('audio')];
  return {
    // --- conference chrome, measured as ON SCREEN, not merely present ---
    selfViewTile: box(q('#filmstripLocalVideo'))?.onScreen ?? false,
    filmstripBox: box(q('#filmstrip')),
    remoteVideosBox: box(q('#remoteVideos')),
    toggleFilmstripOnScreen: box(q('#toggleFilmstripButton'))?.onScreen ?? false,
    toolboxBox: box(q('#toolbox')),
    visibleToolbarButtons: toolbarButtons.filter((b) => box(b)?.onScreen).length,
    dominantSpeakerBox: box(q('#dominantSpeaker')),
    // --- the conference subject header: rendered? and what does it say? ---
    subjectRendered: box(subject)?.onScreen ?? false,
    subjectText: (subject?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    // --- participant tiles (Jitsi's own thumbnail tile element) ---
    largeVideoIsAVideocontainer: allTiles.some((t) => t.id === 'largeVideoContainer'),
    tileElements: tiles.length,
    onScreenTileElements: onScreenTiles.length,
    tileSummary: onScreenTiles.map((t) => ({
      id: t.id || null,
      local: t.id?.startsWith('localVideoContainer') ?? false,
      text: (t.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30),
    })),
    localVideoContainer: !!q('#localVideoContainer, [id^="localVideoContainer"]'),
    // --- what must be PRESENT: the single feed surface ---
    largeVideoBox: box(q('#largeVideoContainer')),
    // --- remote audio ---
    audioElements: audio.length,
    audioPlaying: audio.filter((a) => !a.paused && a.readyState >= 2).length,
    audioWithStream: audio.filter((a) => a.srcObject).length,
    // --- the whole visible text of the conference, for a human read ---
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300),

    // --- PHASE 8.9 DIAGNOSTICS -------------------------------------------
    // Enough identity to NAME each element exactly (tag/id/class/parent), so a
    // finding is reported as "this specific node" rather than as a guess.
    diagnostics: {
      subject: (() => {
        if (!subject) return null;
        const p = subject.parentElement;
        return {
          tag: subject.tagName, id: subject.id,
          className: String(subject.className).slice(0, 80),
          parent: p ? { tag: p.tagName, id: p.id, className: String(p.className).slice(0, 60) } : null,
          nodeText: (subject.innerText || '').slice(0, 80),
          box: box(subject),
        };
      })(),
      dominantSpeaker: (() => {
        const ds = q('#dominantSpeaker');
        if (!ds) return null;
        return {
          className: String(ds.className).slice(0, 80),
          box: box(ds),
          children: [...ds.children].map((c) => ({
            tag: c.tagName, id: c.id, className: String(c.className).slice(0, 60),
            nodeText: (c.innerText || '').slice(0, 30),
            box: box(c),
          })),
        };
      })(),
      avatars: [...document.querySelectorAll('.avatar-container, .userAvatar, .userAvatarBadge')]
        .map((a) => ({
          tag: a.tagName, id: a.id, className: String(a.className).slice(0, 50),
          nodeText: (a.innerText || '').slice(0, 20),
          box: box(a),
          parentId: a.parentElement ? a.parentElement.id : null,
        })),
      largeVideoChildren: [...document.querySelectorAll('#largeVideoContainer *')]
        .filter((n) => { const b = box(n); return b && b.onScreen && b.w > 40 && b.h > 40; })
        .slice(0, 12)
        .map((n) => ({
          tag: n.tagName, id: n.id, className: String(n.className).slice(0, 60),
          nodeText: (n.innerText || '').slice(0, 20),
          box: box(n),
        })),
    },
  };
})()`;



// ---------------------------------------------------------------------
// Browser + session plumbing
// ---------------------------------------------------------------------
const SESSION = (userId, role, token) => `(() => {
  localStorage.setItem('userId', ${JSON.stringify(String(userId))});
  localStorage.setItem('role', ${JSON.stringify(role)});
  localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ userId, role }))});
  localStorage.setItem('expiresAt', ${JSON.stringify(new Date(Date.now() + 3 * 864e5).toISOString())});
  sessionStorage.setItem('token', ${JSON.stringify(token)});
  return true;
})()`;

async function openPage(browser, userId, role, token, label) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(SESSION(userId, role, token));
  page.on('console', (m) => {
    const t = m.text();
    if (/error|Error/.test(t) && !/favicon|DevTools|Download the React|ResizeObserver/.test(t)) {
      note(`[${label}] console: ${t.slice(0, 160)}`);
    }
  });
  await page.goto(`${APP}/baby-monitoring`, { waitUntil: 'domcontentloaded' });
  return page;
}

/** Wait until this page's own live bar reports a genuinely joined conference.
    NOTE: the live label is rendered with `text-transform: uppercase`, so
    innerText yields "LIVE" and the match must be case-insensitive. */
async function waitForLive(page, timeout = 75000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText || '');
    if (/\blive\b/i.test(text)) return true;
    await sleep(1000);
  }
  return false;
}

/** The Jitsi iframe is the child frame whose DOM carries Jitsi's own ids. */
async function jitsiFrame(page, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      try {
        const has = await f.evaluate(() => !!document.querySelector('#largeVideoContainer, #largeVideo, #filmstrip, #remoteVideos'));
        if (has) return f;
      } catch { /* not reachable yet; keep polling */ }
    }
    await sleep(1000);
  }
  return null;
}

async function iframeSrc(page) {
  return page.evaluate(() => {
    const ifr = [...document.querySelectorAll('iframe')]
      .find((f) => /8x8\.vc|jit\.si/.test(f.src || ''));
    return ifr ? ifr.src : null;
  });
}

/**
 * PHASE 8.9 - the Jitsi iframe is RE-CREATED during a session (the React SDK
 * re-mounts it when the media scope or config identity changes), so a Frame
 * handle captured earlier goes stale and puppeteer throws
 * "Attempted to use detached Frame". Every in-frame read therefore re-resolves
 * the frame immediately before use and retries once on a detached frame,
 * instead of trusting a handle captured minutes earlier.
 */
async function probeFrame(page, script, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const frame = await jitsiFrame(page, 20000);
    if (!frame) return null;
    try {
      return await frame.evaluate(script);
    } catch (err) {
      if (!/detached|session closed|Execution context/i.test(String(err && err.message))) throw err;
      await sleep(1500);
    }
  }
  return null;
}

console.log('=== PHASE 8.9 MONITORING FEED - REAL BROWSER ===');
console.log(`App ${APP}   job ${JOB_ID}   child ${CHILD_ID}`);

// ---- 0. Confirm both identities are authorised for the same room -----------
const mediaOf = async (token) => {
  const r = await fetch(`${API}/monitoring/media?jobId=${JOB_ID}&childId=${CHILD_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const mediaParent = await mediaOf(PARENT_TOKEN);
const mediaSitter = await mediaOf(SITTER_TOKEN);
check('server issues a real JaaS session for the parent',
  mediaParent.status === 200 && mediaParent.body?.Configured === true,
  `status=${mediaParent.status} configured=${mediaParent.body?.Configured}`);
check('server issues a real JaaS session for the sitter',
  mediaSitter.status === 200 && mediaSitter.body?.Configured === true,
  `status=${mediaSitter.status} configured=${mediaSitter.body?.Configured}`);
check('parent is the PUBLISHER (CanPublish=true)',
  mediaParent.body?.CanPublish === true && mediaParent.body?.Role === 'publisher',
  `role=${mediaParent.body?.Role} canPublish=${mediaParent.body?.CanPublish}`);
check('sitter is receive-only VIEWER (CanPublish=false)',
  mediaSitter.body?.CanPublish === false && mediaSitter.body?.Role === 'viewer',
  `role=${mediaSitter.body?.Role} canPublish=${mediaSitter.body?.CanPublish}`);
check('both roles are issued the SAME JaaS room',
  mediaParent.body?.RoomName === mediaSitter.body?.RoomName,
  `${mediaParent.body?.RoomName} vs ${mediaSitter.body?.RoomName}`);

// ---------------------------------------------------------------------
// 1. LAUNCH - fake capture devices so the publisher really produces a stream
// ---------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.LITTLECARE_HEADFUL === '1' ? false : true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-certificate-errors',
    '--allow-insecure-localhost',
    '--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:5173',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});
console.log(`Chrome: ${await browser.version()}`);

let publisher = null;
let viewer = null;
const artifacts = {};
try {
  // ---- 2. PUBLISHER (parent) joins first ----------------------------------
  publisher = await openPage(browser, 3, 'parent', PARENT_TOKEN, 'publisher');
  const pubLive = await waitForLive(publisher);
  check('publisher (parent) joins the monitoring room', pubLive,
    pubLive ? '' : (await publisher.evaluate(() => document.body.innerText)).slice(0, 200));

  const pubIframe = await jitsiFrame(publisher);
  check('publisher has a live Jitsi iframe', !!pubIframe, pubIframe ? pubIframe.url().slice(0, 80) : 'no frame');
  const pubSrc = await iframeSrc(publisher);
  check('publisher iframe keeps its own camera (config.disableSelfView=false)',
    !!pubSrc && /disableSelfView=false/.test(decodeURIComponent(pubSrc)),
    pubSrc ? decodeURIComponent(pubSrc).split('?').slice(1).join('?').slice(0, 220) : 'no src');

  // The publisher must still be able to control its own camera and microphone:
  // these are OUR buttons, not Jitsi's toolbar, which is why hiding the Jitsi
  // toolbar does not cost the publisher anything.
  const pubControls = await publisher.evaluate(() => {
    const text = document.body.innerText;
    return {
      mute: [...document.querySelectorAll('button')].some((b) => /mute microphone/i.test(b.textContent)),
      camera: [...document.querySelectorAll('button')].some((b) => /turn camera (on|off)/i.test(b.textContent)),
      cameraConnected: /camera connected/i.test(text),
      micConnected: /microphone connected/i.test(text),
      monitoringActive: /monitoring active/i.test(text),
    };
  });
  check('publisher still has a microphone control', pubControls.mute === true);
  check('publisher still has a camera control', pubControls.camera === true);
  check('publisher sees its own camera as connected', pubControls.cameraConnected === true);
  check('publisher sees the microphone as connected', pubControls.micConnected === true);
  check('publisher UI says "Monitoring active" (not "Listening in")',
    pubControls.monitoringActive === true);

  {
    const pubChrome = await probeFrame(publisher, CHROME_PROBE);
    artifacts.publisherChromeEarly = pubChrome;
    if (pubChrome) {
      note(`publisher iframe text: ${pubChrome.bodyText.slice(0, 160)}`);
      console.log(`      publisher self-view tile on screen: ${pubChrome.selfViewTile}`);
      console.log(`      publisher #toolbox box            : ${JSON.stringify(pubChrome.toolboxBox)}`);
      check('publisher iframe has NO on-screen Jitsi toolbar (TOOLBAR_BUTTONS=[])',
        !pubChrome.toolboxBox?.onScreen && pubChrome.visibleToolbarButtons === 0,
        `toolbox=${JSON.stringify(pubChrome.toolboxBox)} buttons=${pubChrome.visibleToolbarButtons}`);
    } else {
      check('publisher iframe DOM reachable', false, 'no frame');
    }
  }

  // ---- 3. VIEWER (sitter) joins the SAME room -----------------------------
  viewer = await openPage(browser, 4, 'babysitter', SITTER_TOKEN, 'viewer');
  const viewLive = await waitForLive(viewer);
  check('viewer (sitter) joins the monitoring room', viewLive,
    viewLive ? '' : (await viewer.evaluate(() => document.body.innerText)).slice(0, 200));

  const viewIframe = await jitsiFrame(viewer);
  check('viewer has a live Jitsi iframe', !!viewIframe, viewIframe ? viewIframe.url().slice(0, 80) : 'no frame');

  const viewSrc = await iframeSrc(viewer);
  artifacts.viewerIframeSrc = viewSrc;
  const decoded = viewSrc ? decodeURIComponent(viewSrc) : '';
  check('viewer iframe carries the server-issued JWT', /(\?|&)jwt=/.test(decoded), decoded.slice(0, 60));
  check('viewer joins the SAME room as the publisher',
    !!decoded && !!mediaSitter.body?.RoomName
      && decoded.includes(encodeURIComponent(mediaSitter.body.RoomName).replace(/%2F/gi, '/')),
    mediaSitter.body?.RoomName);
  // The keys that were added/changed in this phase, verified as actually SENT.
  // NOTE ON NESTED KEYS: the external API serialises a nested config object as
  // `config.<key>=<json>`, e.g. `config.filmstrip={"disabled":true,...}`. The
  // value must therefore be JSON-parsed rather than string-compared.
  const paramOf = (name) => {
    const m = new RegExp(`[?&]${name.replace('.', '\\.')}=([^&]*)`).exec(decoded);
    return m ? m[1] : null;
  };
  const jsonParamOf = (name) => {
    const raw = paramOf(name);
    try { return raw === null ? null : JSON.parse(raw); } catch { return null; }
  };
  for (const [key, expected] of [
    ['disableSelfView', 'true'],
    ['disableSelfViewSettings', 'true'],
    ['disableTileView', 'true'],
    ['disableTileEnlargement', 'true'],
    ['hideParticipantsStats', 'true'],
    ['hideConferenceSubject', 'true'],
    ['hideConferenceTimer', 'true'],
    ['hideDisplayName', 'true'],
    ['disableAudioLevels', 'true'],
    ['startWithVideoMuted', 'true'],
    ['startWithAudioMuted', 'true'],
  ]) {
    check(`viewer iframe sends config.${key}=${expected}`,
      paramOf(`config.${key}`) === expected, `got ${paramOf(`config.${key}`)}`);
  }
  const filmstripCfg = jsonParamOf('config.filmstrip');
  check('viewer iframe sends config.filmstrip.disabled=true',
    filmstripCfg?.disabled === true, JSON.stringify(filmstripCfg));
  check('viewer iframe sends config.filmstrip.disableStageFilmstrip=true',
    filmstripCfg?.disableStageFilmstrip === true);
  check('viewer iframe sends config.filmstrip.disableTopPanel=true',
    filmstripCfg?.disableTopPanel === true);
  const prejoinCfg = jsonParamOf('config.prejoinConfig');
  check('viewer iframe disables the prejoin lobby',
    prejoinCfg?.enabled === false, JSON.stringify(prejoinCfg));
  const confInfo = jsonParamOf('config.conferenceInfo');
  check('viewer iframe empties the conference-info header (incl. participants-count)',
    confInfo?.alwaysVisible?.length === 0 && confInfo?.autoHide?.includes('participants-count'),
    JSON.stringify(confInfo?.autoHide?.slice(0, 3)));
  check('viewer iframe removes the Jitsi toolbar (interfaceConfig.TOOLBAR_BUTTONS=[])',
    decoded.includes('TOOLBAR_BUTTONS=[]'));
  check('viewer iframe carries NO publish-enabling start flags',
    paramOf('config.startWithVideoMuted') === 'true' && paramOf('config.startWithAudioMuted') === 'true');
  check('viewer iframe does NOT send the retired no-op DISABLE_FILMSTRIP flag',
    !decoded.includes('DISABLE_FILMSTRIP'), 'retired key absent');
  check('viewer iframe does NOT send the retired interface flag SHOW_JITSI_WATERMARK',
    !decoded.includes('SHOW_JITSI_WATERMARK'), 'retired key absent');
  check('viewer iframe does NOT send the retired interface flag DEFAULT_LOGO_URL',
    !decoded.includes('DEFAULT_LOGO_URL'), 'retired key absent');
  check('viewer iframe does NOT send the retired interface flag VIDEO_BACKGROUND',
    !decoded.includes('interfaceConfig.VIDEO_BACKGROUND='), 'retired key absent');
  check('viewer iframe suppresses the watermark via the whitelisted config key',
    paramOf('config.defaultLogoUrl') === '""', `got ${paramOf('config.defaultLogoUrl')}`);


  // -------------------------------------------------------------------
  // 4. PRESENTATION: the viewer's screen must read as ONE monitor feed
  // -------------------------------------------------------------------
  // The presentation probe is taken in section 5a, once the remote video is
  // proven flowing, so that Jitsi's transient loading placeholders (the centred
  // avatar it shows for a moment while a track attaches) cannot be mistaken for
  // a permanent conference layout.
  // The viewer's on-screen wording is asserted in section 5b for the same
  // reason: a "Camera connected" claim only means something once the remote
  // media is actually arriving.


  // -------------------------------------------------------------------
  // 5. REMOTE VIDEO EVIDENCE - the real acceptance criterion
  // -------------------------------------------------------------------
  // PHASE 8.9 - WAIT FOR THE STREAM, DO NOT SNAPSHOT IT TOO EARLY.
  // The first run sampled 6 s after the viewer joined and caught `#largeVideo`
  // still holding the LOCAL (muted) track: width 0, readyState 0. That is the
  // normal startup window, not a fault, and asserting on it would report a
  // false failure. The publisher's media has to be negotiated and started
  // first, so this polls until the remote track is genuinely running.
  const flowing = await (async () => {
    const deadline = Date.now() + 60000;
    let last = null;
    while (Date.now() < deadline) {
      last = await probeFrame(viewer, VIDEO_PROBE);
      if (last && last.present && last.width > 0 && last.readyState >= 3 && !last.paused) return last;
      await sleep(1500);
    }
    return last;
  })();
  check('remote video reaches a flowing state (width>0 && readyState>=3 && playing)',
    !!flowing && flowing.width > 0 && flowing.readyState >= 3 && flowing.paused === false,
    JSON.stringify(flowing));

  // -------------------------------------------------------------------
  // 5a. PRESENTATION, read in the settled state (media is flowing)
  // -------------------------------------------------------------------
  const viewChrome = await probeFrame(viewer, CHROME_PROBE);
  artifacts.viewerChrome = viewChrome;
  if (viewChrome) {
    console.log('  --- inside the viewer Jitsi iframe (measured, not assumed) ---');
    console.log(`      self-view tile on screen     : ${viewChrome.selfViewTile}`);
    console.log(`      #filmstrip box               : ${JSON.stringify(viewChrome.filmstripBox)}`);
    console.log(`      #remoteVideos box            : ${JSON.stringify(viewChrome.remoteVideosBox)}`);
    console.log(`      filmstrip toggle on screen   : ${viewChrome.toggleFilmstripOnScreen}`);
    console.log(`      #toolbox box                 : ${JSON.stringify(viewChrome.toolboxBox)}`);
    console.log(`      on-screen toolbar buttons    : ${viewChrome.visibleToolbarButtons}`);
    console.log(`      #dominantSpeaker box         : ${JSON.stringify(viewChrome.dominantSpeakerBox)}`);
    console.log(`      subject header rendered      : ${viewChrome.subjectRendered} text="${viewChrome.subjectText}"`);
    console.log(`      .videocontainer elements     : ${viewChrome.tileElements} (on screen ${viewChrome.onScreenTileElements})`);
    console.log(`      on-screen tiles              : ${JSON.stringify(viewChrome.tileSummary)}`);
    console.log(`      local video container        : ${viewChrome.localVideoContainer}`);
    console.log(`      #largeVideoContainer box     : ${JSON.stringify(viewChrome.largeVideoBox)}`);
    console.log(`      visible text                 : "${viewChrome.bodyText.slice(0, 180)}"`);
    console.log('      --- diagnostics (exact node identity) ---');
    console.log(`      subject : ${JSON.stringify(viewChrome.diagnostics?.subject)}`);
    console.log(`      domSpkr : ${JSON.stringify(viewChrome.diagnostics?.dominantSpeaker)}`);
    console.log(`      avatars : ${JSON.stringify(viewChrome.diagnostics?.avatars)}`);
    console.log(`      inFeed  : ${JSON.stringify(viewChrome.diagnostics?.largeVideoChildren)}`);

    check('viewer has NO on-screen self-view tile inside Jitsi',
      viewChrome.selfViewTile === false, `onScreen=${viewChrome.selfViewTile}`);
    check('viewer shows ZERO on-screen participant tiles',
      viewChrome.onScreenTileElements === 0,
      `${viewChrome.tileElements} in DOM, ${viewChrome.onScreenTileElements} on screen `
      + JSON.stringify(viewChrome.tileSummary));
    check('viewer has NO on-screen filmstrip toggle button',
      viewChrome.toggleFilmstripOnScreen === false);
    check('viewer has NO on-screen Jitsi toolbar',
      !viewChrome.toolboxBox?.onScreen && viewChrome.visibleToolbarButtons === 0,
      `toolbox=${JSON.stringify(viewChrome.toolboxBox)} buttons=${viewChrome.visibleToolbarButtons}`);
    check('viewer has NO on-screen dominant-speaker indicator/avatar',
      !viewChrome.dominantSpeakerBox?.onScreen,
      JSON.stringify(viewChrome.dominantSpeakerBox));
    check('viewer has NO rendered conference header label (subject/timer/count/quality)',
      viewChrome.subjectRendered === false,
      `text="${viewChrome.subjectText}"`);
    check('the single feed surface is present and fills the frame (#largeVideoContainer)',
      viewChrome.largeVideoBox?.onScreen === true
        && viewChrome.largeVideoBox.w > 200 && viewChrome.largeVideoBox.h > 100,
      JSON.stringify(viewChrome.largeVideoBox));
    // The feed must be filled by the remote video and nothing else: no avatar
    // plate, no presence message, no name label drawn on top of the picture.
    const feedNodes = viewChrome.diagnostics?.largeVideoChildren || [];
    check('the ONLY picture in the feed is the remote <video id="largeVideo">',
      feedNodes.filter((n) => n.tag === 'VIDEO' && n.id === 'largeVideo').length === 1
      && !feedNodes.some((n) => /avatar|uservatar/i.test(String(n.className) + n.id)),
      JSON.stringify(feedNodes.map((n) => `${n.tag}#${n.id || n.className || '-'}`)));
  } else {
    check('viewer Jitsi iframe DOM reachable', false, 'iframe not found');
  }

  const v1 = await probeFrame(viewer, VIDEO_PROBE);
  await sleep(3000);
  const v2 = await probeFrame(viewer, VIDEO_PROBE);
  artifacts.remoteVideo = { flowing, v1, v2 };
  console.log('  --- REMOTE VIDEO EVIDENCE (viewer #largeVideo) ---');
  console.log(`      flowing: ${JSON.stringify(flowing)}`);
  console.log(`      pass 1:  ${JSON.stringify(v1)}`);
  console.log(`      pass 2:  ${JSON.stringify(v2)}`);
  check('remote video element EXISTS inside the viewer', v1.present === true);
  check('remote video width  > 0', v1.width > 0, `width=${v1.width}`);
  check('remote video height > 0', v1.height > 0, `height=${v1.height}`);
  check('remote video readyState >= 3', v2.readyState >= 3, `readyState=${v2.readyState}`);
  check('remote video is NOT paused', v2.paused === false, `paused=${v2.paused}`);
  check('remote video currentTime ADVANCES',
    v2.currentTime > v1.currentTime, `${v1.currentTime} -> ${v2.currentTime}`);
  // -------------------------------------------------------------------
  // 5b. THE VIEWER'S OWN SURFACE, read AFTER the feed is proven flowing
  // -------------------------------------------------------------------
  // Re-read now rather than earlier: "Camera connected" is only a truthful
  // claim once the remote track is actually delivering frames. The device
  // facts are SCOPED TO THE MEDIA PANEL - MonitoringStatusBar legitimately says
  // "Monitoring active" because that is the SERVER's session status, a
  // different fact from the media role.
  const viewUi = await viewer.evaluate(() => {
    const text = document.body.innerText;
    const panel = document.querySelector('section[aria-label="Live monitoring media"]');
    const panelText = panel ? panel.innerText : '';
    const facts = [...(panel ? panel.querySelectorAll('[aria-label="Camera and microphone status"] > span') : [])]
      .map((s) => s.textContent.trim());
    return {
      title: /Baby Monitor/.test(text),
      live: /\blive\b/i.test(panelText),
      facts,
      cameraFact: facts.find((f) => /^Camera/i.test(f)) || null,
      micFact: facts.find((f) => /^Microphone/i.test(f)) || null,
      roleFact: facts.find((f) => /listening in|monitoring active/i.test(f)) || null,
      deviceButtons: [...document.querySelectorAll('button')]
        .map((b) => b.textContent.trim())
        .filter((t) => /mute microphone|unmute microphone|turn camera/i.test(t)),
      meetingWords: /\bparticipants?\b|\bmeeting\b|\binvite\b/i.test(text),
      babyNameInFeed: /[A-Za-z]+’s camera/.test(text),
    };
  });
  artifacts.viewerUi = viewUi;
  console.log(`      viewer media facts: ${JSON.stringify(viewUi.facts)}`);
  check('viewer screen is titled "Baby Monitor"', viewUi.title === true);
  check('viewer feed bar says LIVE', viewUi.live === true);
  check('viewer feed names the baby ("<name>’s camera")', viewUi.babyNameInFeed === true);
  check('viewer camera fact rendered as "Camera connected"',
    /^Camera connected$/i.test(viewUi.cameraFact || ''), String(viewUi.cameraFact));
  check('viewer microphone fact rendered as "Microphone connected"',
    /^Microphone connected$/i.test(viewUi.micFact || ''), String(viewUi.micFact));
  check('viewer media panel states its role as "Listening in" (not "Monitoring active")',
    /^Listening in$/i.test(viewUi.roleFact || ''), String(viewUi.roleFact));
  check('viewer is offered NO camera/microphone control',
    viewUi.deviceButtons.length === 0, JSON.stringify(viewUi.deviceButtons));
  check('viewer surface contains NO meeting/participant vocabulary',
    viewUi.meetingWords === false);



  // -------------------------------------------------------------------
  // 5c. PUBLISHER RE-CHECKED once the whole conference is actually running
  // -------------------------------------------------------------------
  // The publisher's own UI is what carries its camera state (the Jitsi toolbar
  // is intentionally gone), so the publisher-side claim is proved through the
  // app's own controls and device facts, not through a Jitsi self tile. The
  // self-tile reading is still captured and reported, because with
  // `filmstrip.disabled` Jitsi does not lay one out for the publisher either -
  // that is an observed consequence, not an assumption, and it is reported in
  // the write-up as a known limitation.
  const pubChromeLate = await probeFrame(publisher, CHROME_PROBE);
  artifacts.publisherChrome = pubChromeLate;
  const pubUiLate = await publisher.evaluate(() => {
    const panel = document.querySelector('section[aria-label="Live monitoring media"]');
    const facts = [...(panel ? panel.querySelectorAll('[aria-label="Camera and microphone status"] > span') : [])]
      .map((s) => s.textContent.trim());
    return {
      facts,
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim())
        .filter((t) => /mute microphone|unmute microphone|turn camera/i.test(t)),
    };
  });
  artifacts.publisherUi = pubUiLate;
  console.log(`      publisher media facts (late): ${JSON.stringify(pubUiLate.facts)}`);
  console.log(`      publisher buttons   (late): ${JSON.stringify(pubUiLate.buttons)}`);
  console.log(`      publisher self tile  (late): ${pubChromeLate?.selfViewTile}`);
  check('publisher still shows "Camera connected" for its own device while live',
    /^Camera connected$/i.test(pubUiLate.facts.find((f) => /^Camera/i.test(f)) || ''),
    JSON.stringify(pubUiLate.facts));
  check('publisher still shows "Microphone connected" for its own device while live',
    /^Microphone connected$/i.test(pubUiLate.facts.find((f) => /^Microphone/i.test(f)) || ''),
    JSON.stringify(pubUiLate.facts));
  check('publisher still has BOTH device controls while live',
    pubUiLate.buttons.length === 2, JSON.stringify(pubUiLate.buttons));
  check('publisher is still told "Monitoring active" while live',
    pubUiLate.facts.some((f) => /^Monitoring active$/i.test(f)), JSON.stringify(pubUiLate.facts));

  // -------------------------------------------------------------------
  // 6. REMOTE AUDIO EVIDENCE - read in the settled state
  // -------------------------------------------------------------------
  // Sampled after the video is proven flowing, and the in-frame <audio>
  // elements are re-read here: during the join window Jitsi has created the
  // elements but has not yet attached a MediaStream, so an earlier sample
  // reported "0 playing" even though audio was about to arrive.
  const audioLate = await probeFrame(viewer, `(() => {
    const audio = [...document.querySelectorAll('audio')];
    return {
      elements: audio.length,
      playing: audio.filter((a) => !a.paused && a.readyState >= 2).length,
      withStream: audio.filter((a) => a.srcObject).length,
      readyStates: audio.map((a) => a.readyState).slice(0, 8),
    };
  })()`);
  artifacts.remoteAudio = audioLate;
  console.log(`      <audio> (settled): ${JSON.stringify(audioLate)}`);
  check('viewer Remote Audio: an <audio> element is attached to a live MediaStream',
    !!audioLate && audioLate.withStream > 0, JSON.stringify(audioLate));
  check('viewer Remote Audio: at least one <audio> is playing (not paused, readyState>=2)',
    !!audioLate && audioLate.playing > 0, JSON.stringify(audioLate));

  const remoteAudio = await viewer.evaluate(() => {
    const text = document.body.innerText;
    return {
      micConnected: /microphone connected/i.test(text),
      micUnavailable: /microphone unavailable/i.test(text),
    };
  });
  check('app reports remote audio available (Microphone connected)',
    remoteAudio.micConnected === true, JSON.stringify(remoteAudio));
  check('no microphone permission regression on the viewer',
    remoteAudio.micUnavailable === false);

  await viewer.screenshot({ path: `${SHOT_DIR}\\viewer_390.png` });
  await publisher.screenshot({ path: `${SHOT_DIR}\\publisher_390.png` });

  // -------------------------------------------------------------------
  // 7. RESPONSIVE SWEEP (our UI, not the iframe)
  // -------------------------------------------------------------------
  console.log('  --- RESPONSIVE (viewer) ---');
  for (const [w, h] of [[320, 640], [390, 844], [480, 900], [1280, 900]]) {
    await viewer.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 900, hasTouch: w < 900 });
    await sleep(1200);
    const m = await viewer.evaluate(() => {
      const el = document.documentElement;
      const frame = document.querySelector('section[aria-label="Live monitoring media"] > div');
      const rect = frame ? frame.getBoundingClientRect() : null;
      // The PILLS themselves: direct children of the fact row, not the 7px dots
      // inside them (measuring a descendant was what produced the bogus "7px").
      const pills = [...document.querySelectorAll(
        '[aria-label="Camera and microphone status"] > span')];
      const visiblePills = pills.filter((p) => p.getBoundingClientRect().height > 1);
      return {
        docWidth: el.scrollWidth,
        viewport: el.clientWidth,
        horizontalOverflow: el.scrollWidth > el.clientWidth + 1,
        frameRect: rect
          ? { w: rect.width, h: rect.height, right: Math.round(rect.right), bottom: Math.round(rect.bottom) }
          : null,
        minTouch: Math.round(Math.min(...visiblePills.map((p) => p.getBoundingClientRect().height), 999)),
        pillCount: visiblePills.length,
      };
    });
    const ratio = m.frameRect ? (m.frameRect.w / m.frameRect.h) : 0;
    check(`${w}px: no horizontal overflow`, m.horizontalOverflow === false,
      `scrollWidth=${m.docWidth} clientWidth=${m.viewport}`);
    check(`${w}px: feed fits the viewport (no clipping)`,
      !!m.frameRect && m.frameRect.right <= m.viewport + 1,
      JSON.stringify(m.frameRect));
    check(`${w}px: feed is 16:9`,
      Math.abs(ratio - 16 / 9) < 0.01, `ratio=${ratio.toFixed(4)}`);
    check(`${w}px: status pills are >= 44px tall`,
      m.minTouch >= 44 && m.pillCount >= 3, `min=${m.minTouch} pills=${m.pillCount}`);
    await viewer.screenshot({ path: `${SHOT_DIR}\\viewer_${w}.png` });
  }


  // -------------------------------------------------------------------
  // 8. INDEPENDENT (Phone-2) MONITORING IS UNTOUCHED - device = publisher,
  //    parent = viewer, on the independent route.
  // -------------------------------------------------------------------
  const pair = await fetch(`${API}/independent-monitoring/pairing-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PARENT_TOKEN}` },
    body: JSON.stringify({ ChildId: CHILD_ID }),
  });
  const pairBody = await pair.json().catch(() => null);
  // 409 is the CORRECT answer when an independent session is already running:
  // the server allows exactly one at a time (asserted in the Phase 13 harness).
  // Treating 409 as a failure would be asserting the opposite of the rule.
  check('independent monitoring pairing guard still holds (200 = new code, 409 = one session already active)',
    pair.status === 200 || pair.status === 409,
    `status=${pair.status} code=${pairBody?.code ? 'issued' : 'none'}`);
  if (pair.status === 200 && pairBody?.code) {
    const redeem = await fetch(`${API}/independent-monitoring/device/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Code: pairBody.code }),
    });
    const redeemBody = await redeem.json().catch(() => null);
    check('independent device pairing still redeems (device = publisher credential)',
      redeem.status === 200 && !!redeemBody?.deviceCredential, `status=${redeem.status}`);
    if (redeemBody?.deviceCredential) {
      const devSession = await fetch(`${API}/independent-monitoring/device/session`, {
        headers: { 'X-Monitor-Device': redeemBody.deviceCredential },
      });
      check('independent device credential still reads its session',
        devSession.status === 200, `status=${devSession.status}`);
      // Do not leave a dangling independent session running.
      await fetch(`${API}/independent-monitoring/device/stop`, {
        method: 'POST',
        headers: { 'X-Monitor-Device': redeemBody.deviceCredential },
      }).catch(() => {});
    }
  }

  writeFileSync(`${SHOT_DIR}\\evidence.json`, JSON.stringify(artifacts, null, 2));
} catch (err) {
  fail++;
  console.error(`\n  FATAL  ${err && err.stack ? err.stack : err}`);
} finally {
  await viewer?.close().catch(() => {});
  await publisher?.close().catch(() => {});
  await browser.close().catch(() => {});
}

console.log(`\nFEED RESULT: ${pass} passed, ${fail} failed`);
console.log(`Screenshots + evidence: ${SHOT_DIR}`);
process.exit(fail === 0 ? 0 : 1);
