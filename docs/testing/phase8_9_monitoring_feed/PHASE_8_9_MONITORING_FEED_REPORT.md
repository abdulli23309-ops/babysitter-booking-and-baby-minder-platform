# PHASE 8.9 — BABY MONITOR AS A MONITORING FEED (not a video conference)

**Result: 89 passed, 0 failed** in the real-browser harness, against the real
backend, the real `8x8.vc` (JaaS) room, and real WebRTC media.
Harness: `monitoring_feed_browser.mjs` · Log: `run_acceptance.log` · Screenshots +
`evidence.json`: `e:\Fyp Fazooliyaaat\shots\phase8_9\`

This is **presentation only**. `MonitoringAccess`, `MediaSessionService`, JWT
issuance/claims, role derivation, device credentials, the database,
`CryIncidentService`, pairing tables, the independent Phone-2 flow and the job
monitoring business rules were **not modified**.

---

## A. What was changed

Only two source files:

| File | Change |
|---|---|
| `babysitter-app/src/components/monitoring/MonitoringMediaPanel.jsx` | Jitsi configuration rebuilt against the Jitsi whitelists; remote-media facts corrected; live bar and status pills re-worded for a monitor |
| `babysitter-app/src/components/monitoring/monitoring-media.module.css` | Status pills raised to a 44px touch target (and kept ≥44px in the ≤360px rules) |

**One genuine correctness fix, found by real browser testing (§B4).** The panel
was reporting the *viewer's own* capture device as if it were the baby's:

* Jitsi's `videoAvailabilityChanged` / `audioAvailabilityChanged` events carry a
  payload of **`{ available }` only — there is no participant id** (verified in
  `modules/API/API.js`, `notifyVideoAvailabilityChanged`).
* The old code read `({ available, id })` and, because `id` is always
  `undefined`, fell through to `canPublish && (!id || …)`. For a viewer that
  expression is `false`, so the viewer's **own muted camera** was stored as
  `remoteVideoAvailable`.
* Observed live failure: the viewer showed **“Camera unavailable”** while the
  baby's video was actually streaming.

Fix: availability events are now applied **only** for a publisher (they describe
that client's own device), and a viewer's camera/microphone facts are derived
from the only participant-level signals the external API offers —
`participantJoined` / `participantLeft` (`{ id }`) and `participantMuted`
(`{ id, isMuted, mediaType }`).

---

## B. Which Jitsi flags were added / removed, and why

### B1. The rule used

Jitsi **silently discards any key that is not on a whitelist**. This is not
documentation folklore; it is enforced in source:


### B2. Root cause of the "conference" look

`DISABLE_FILMSTRIP: true` was in `interfaceConfigOverwrite`. **It is not a Jitsi
key in either namespace** — it was not on the interface whitelist, so Jitsi
discarded it. The filmstrip was therefore **never suppressed**, which is precisely
why the feed rendered as a row of participant tiles. The same is true of
`VIDEO_BACKGROUND`, which was a guess at `DISABLE_VIDEO_BACKGROUND`.

### B3. Flag ledger

**REMOVED — not on the interfaceConfig whitelist (so all were no-ops):**
`DISABLE_FILMSTRIP`, `VIDEO_BACKGROUND`, `SHOW_JITSI_WATERMARK`,
`SHOW_WATERMARK_FOR_GUESTS`, `SHOW_BRAND_WATERMARK`, `SHOW_PROMOTIONAL_CLOSE_PAGE`,
`DISABLE_RATING`, `DEFAULT_LOGO_URL` (deprecated → moved to `config.defaultLogoUrl`),
`CONFERENCE_FOOTER_TOGGLE`, `HIDE_GUESTS_PROFILE_PICTURES`,
`DISABLE_AUDIO_ONLY_BACKGROUND`, `DISABLE_PARTICIPANT_JOINER` (also set to its
default). Also removed `config.toolbar: false`, which is not a Jitsi key either.

**KEPT — on the interfaceConfig whitelist:**
`TOOLBAR_BUTTONS: []`, `DISABLE_DOMINANT_SPEAKER_INDICATOR`,
`DISABLE_VIDEO_BACKGROUND`, `DISABLE_FOCUS_INDICATOR`,
`SHOW_CHROME_EXTENSION_BANNER`, and (added) `VIDEO_QUALITY_LABEL_DISABLED`.

**ADDED to `configOverwrite` (all on the config whitelist):**

| Key | Controls | Why |
|---|---|---|
| `filmstrip: { disabled, disableStageFilmstrip, disableTopPanel }` | the thumbnail strip | **The fix for §B2.** Whitelisted as a namespace, so all three sub-keys apply |
| `disableSelfView: !canPublish` | the local self-view tile | Viewer must not appear as a second person watching the baby. Does not touch remote media. Not applied to the publisher |
| `disableSelfViewSettings: !canPublish` | the settings toggle that re-enables it | Otherwise the viewer can switch the self tile back on |
| `disableTileView` | the grid/tile layout | Removes the grid metaphor outright rather than leaving it unused |
| `disableTileEnlargement` | crop-to-fill vs contain | Contains the feed at its own aspect instead of cropping a camera image |
| `conferenceInfo: { alwaysVisible: [], autoHide: [...] }` | the header label group | Header chrome, including `participants-count` |
| `hideConferenceSubject` / `hideConferenceTimer` / `hideRecordingLabel` / `hideParticipantsStats` | those header labels | meeting language |
| `hideDominantSpeakerBadge` | the name badge over the video | meeting language |
| `hideDisplayName` | name labels drawn on the tile | meeting language |
| `disableAudioLevels` | speaker-level meters on tiles | meeting language |
| `disableModeratorIndicator` | the “focus” tint on the tile | frames the feed like a selected conference participant |
| `disableChat`, `disableReactions`, `disableReactionsInChat`, `disablePolls`, `disableProfile` | meeting features | no purpose on a monitor; each is a route back into the conference UI |
| `disableInviteFunctions`, `hideAddRoomButton` | invite affordances | meeting language |
| `defaultLogoUrl: ''` | the Jitsi watermark | replaces the dead `DEFAULT_LOGO_URL`; only reachable in the **embedded** config whitelist |
| `disable1On1Mode: false` | keep 1-on-1 mode | states intent explicitly rather than trusting tenant config; it is what promotes the single remote feed to the large surface |

**UNCHANGED (already correct):** `prejoinConfig.enabled`, `startWithAudioMuted`,
`startWithVideoMuted`, `disableDeepLinking`.

### B4. Flag added *because real browser testing found it*

The live iframe capture showed a 32×28 on-screen label reading
**“Performance settings”** inside Jitsi’s conference-info container
(`div#autoHide.subject.visible`). That is the **video-quality label**, and it was
the last remaining piece of meeting language in the header. `video-quality` in the
`conferenceInfo.autoHide` array does not remove it (that is a header-*chrome* key,
a different element), so it is disabled at its own source with the whitelisted
`interfaceConfig.VIDEO_QUALITY_LABEL_DISABLED: true`. After the fix the same node
measures `w: 0, text: ""`, i.e. it renders nothing.

### B5. Proof the flags actually reach Jitsi

`@jitsi/react-sdk` passes them on the iframe URL, and the harness parses that URL
(21 assertions). Note that a **nested** config object is serialised as JSON, e.g.
`config.filmstrip={"disabled":true,…}` — the first harness run “failed” these
checks only because it string-compared against `filmstrip.disabled=true`.

---

## C. React UI vs Jitsi iframe UI

**React (this app) — everything the user reads:**
the `LIVE` bar and the baby’s name, the “Camera / Microphone / Listening in” pills,
the publisher’s Mute-microphone / Turn-camera-off buttons, the empty-state
copy, the `MonitoringStatusBar`, the child header, the Exit button, the bottom
nav and the FAB.

**Jitsi iframe — after this phase:** the **remote video only**. Measured
on-screen contents of `#largeVideoContainer`:
`#etherpad`, `#largeVideoBackgroundContainer`, `#largeVideoWrapper`,

---

## D. Job-linked real-browser result (parent publisher + sitter viewer)

`GET /api/monitoring/media?jobId=9001&childId=1` — **same room for both**:
`vpaas-magic-cookie-…/lc-monitor-481`.
Parent → `role=publisher, CanPublish=true`; sitter → `role=viewer,
CanPublish=false`. Both loaded the server-issued JWT, same room, no room/token
mismatch. The server-issued participant count is unchanged and correct (two
participants); what changed is that the count is no longer *displayed*.

Viewer, measured inside the iframe: **0** on-screen `.videocontainer` tiles, no
self-view tile, no filmstrip toggle, no toolbar (0 on-screen buttons), no
dominant-speaker/avatar, no rendered header label. Publisher: both device
controls present, `Camera connected` / `Microphone connected` / `Monitoring active`.

## E. Independent (Phone-2) real-browser result

`POST /api/independent-monitoring/pairing-codes` returns **409** — the correct
answer, since the Phase 13 rule allows exactly one independent session at a time
and one is already active; the guard is intact. `MonitoringMediaPanel` is shared
with `PhonePairingConcept` and therefore received the same presentation, which is
the intended outcome; no independent route, table, device credential or
authorisation rule was touched. Full device-side pairing redemption was **not**
re-run in this session (doing so would have stopped a session that is currently
live) — the Phase 13 harness remains the authority for that flow.

## F. Remote video evidence (viewer, `<video id="largeVideo">`)

| Criterion | Measured |
|---|---|
| element exists | `true` (`VIDEO`) |
| width > 0 | `240` (earlier run: `320`) |
| height > 0 | `135` (earlier run: `180`) |
| readyState ≥ 3 | `4` |
| paused | `false` |
| currentTime advances | `5.454 → 8.458` (earlier run `71.258 → 74.267`) |

## G. Remote audio evidence (viewer)

`<audio>` elements: `45` total, **`withStream: 1`, `playing: 1`**,
`readyStates: [4,4,4,4,4,4,4,4]`. The app reports **“Microphone connected”**,
and **“Microphone unavailable” never appears** — no media-permission regression.

## H. Responsive results (viewer)

| Width | Overflow | Feed box | 16:9 | Pills |
|---|---|---|---|---|
| 320 | none (`scrollWidth 320 = clientWidth 320`) | 320×180, right edge 320 | 1.7778 | 44px × 3 |
| 390 | none | 390×219.375, right edge 390 | 1.7778 | 44px × 3 |
| 480 | none | 480×270, right edge 480 | 1.7778 | 44px × 3 |
| 1280 | none | 480×270, centred | 1.7778 | 44px × 3 |

No video clipping; the feed is never covered by our own controls. **One
observation, not introduced by this phase:** at 320px the app-wide

---

## J. Jitsi limitations that prevent a perfect single-feed presentation

1. **A large initial avatar can appear on the *publisher’s* screen.** With
   `filmstrip.disabled`, Jitsi does not lay out a self-view tile for the
   publisher either, so the large surface follows the *remote* participant —
   and the sitter publishes no video, so Jitsi draws an initial avatar there
   (screenshot `publisher_390.png` shows a large “B”). The letter comes from the
   JWT `context.user.name`, which this brief explicitly forbids changing, and
   there is **no whitelisted Jitsi key that suppresses the large-video avatar**
   (`gravatar.disabled` only stops fetching a Gravatar image). No unsupported
   flag was added to paper over it. Remedies, if this is ever revisited, are
   (a) re-enable the filmstrip for the publisher only, or (b) have the server
   issue a blank `context.user.name` — both are out of scope here. **The viewer,
   which is the acceptance subject, is unaffected**: no avatar is on screen there.
2. **Self-view is suppressed by removing its container.** `disableSelfView`
   removes the self tile from the tile view and filmstrip, which is what we
   want, but there is no supported way to let the *publisher* keep a self view
   while the *viewer* loses one beyond the `!canPublish` split used here.
3. **The room name is still in the iframe URL.** Unavoidable with the
   server-issued-JWT model and harmless on JaaS, where authorisation comes from
   the token, not the URL.
4. **Transient placeholders.** While a remote track attaches, Jitsi briefly
   renders a centred avatar inside `#dominantSpeakerAvatarContainer`. It is gone
   once media flows; the harness therefore reads the presentation **after** the
   video is proven flowing, rather than during the join window.

---

## Final acceptance

**“Does this look and behave like a Baby Monitor rather than a video-conference
room?”** — **Yes for the viewer, which is the subject of this phase.** One
dominant 16:9 remote feed, no tiles, no self-view, no toolbar, no participant
count, no subject, no avatar, plus honest per-device facts and a clear
Listening-in role. The publisher keeps working camera/microphone controls and
sees its own device state; only its large surface is affected by limitation J.1.

### Reproducing

```powershell
# prerequisites: IIS Express on https://localhost:44368 (WebApplication2,
# with Web.MonitoringMedia.config), and `npm run dev` on 127.0.0.1:5173
$env:LITTLECARE_TEST_PARENT_TOKEN = '<live UserSessions token, parent of job 9001>'
$env:LITTLECARE_TEST_SITTER_TOKEN = '<live UserSessions token, assigned sitter>'
$env:LITTLECARE_TEST_JOB_ID = '9001'; $env:LITTLECARE_TEST_CHILD_ID = '1'
node docs/testing/phase8_9_monitoring_feed/monitoring_feed_browser.mjs
```

Requires `puppeteer-core` (installed with `--no-save`) and a local Chrome.

`FloatingContactButton` (a pre-existing shared FAB) floats over part of the
`MonitoringStatusBar` alert row. The text still wraps and reads, and no
monitoring control — video, pills, or Exit — is obscured. It is shared layout
used by every screen, so it was left alone rather than re-designed here.

## I. Build / lint results

`npm run lint` → **exit 0** (ESLint + CSS-module reference check).
`npm run build` → **exit 0** (`built in 693ms`).

Neither was treated as sufficient: the acceptance evidence above is all from the
real browser run.

`<video id="largeVideo">` — **no avatar plate, no name label, no toolbar, no
participant count, no filmstrip**.

The parent application does **not** reach into the iframe. The only DOM the app
touches is the `iframe` element itself and its injected host `<div>`, both sized
via `getIFrameRef` (pre-existing Phase 8.4 code).

* `configOverwrite` → `react/features/base/config/configWhitelist.ts`
  (+ `isEmbeddedConfigWhitelist.ts`, which applies because this app is always
  embedded)
* `interfaceConfigOverwrite` → `react/features/base/config/interfaceConfigWhitelist.ts`
  (+ `isEmbeddedInterfaceConfigWhitelist.ts`, which is **empty**)

Every flag below was checked against those lists before being added.
