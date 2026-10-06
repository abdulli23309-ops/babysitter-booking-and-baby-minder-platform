# CR-01 — Grant a parent a publisher role on `/baby-monitoring`

| Field | Value |
|---|---|
| **ID** | CR-01 |
| **Title** | Optional local camera preview ("PiP") on the parent's monitoring dashboard |
| **Status** | **PROPOSED** — not implemented |
| **Priority** | Medium (cosmetic feature; no safety or privacy benefit) |
| **Raised** | Phase 9.3 (premium UI overhaul) |
| **Blocked deliverable** | The PiP tile on Screen 3 |
| **Decision needed from** | Project owner / supervisor |

---

## 1. What was asked for

The Phase 9.3 design brief requested that `/baby-monitoring` show:

- a full-bleed main feed from the nursery camera, **and**
- "the parent's own camera feed … as a small, beautifully rounded floating window"
  in the corner (Picture-in-Picture).

## 2. Why it could not be built as specified

**The parent is a viewer on that route.** There is no second video stream to place in a PiP
window. This is enforced at three independent layers, all deliberate:

| Layer | Mechanism | Source |
|---|---|---|
| Server role | `GetIndependentParentMedia(parentId)` passes `canPublish: false` | `MediaSessionService` |
| Server role (job-scoped) | `CanPublish = isParent`, so `false` for any sitter viewing | `MediaSessionService.GetMediaSession` |
| Join parameters | `audio=0`, `video=0`, `audio_cant_unmute=1`, `video_cant_unhide=1` | `BuildJoinPath` |
| Browser permissions | iframe `allow` omits `camera; microphone` for a viewer | `MonitoringMediaPanel` |

The receive-only guarantee for a viewer is a security property of the product (§8.3 of
`PROJECT_ARCHITECTURE_AUDIT.md`), not an incidental default.

### Options that were rejected

1. **Request the camera anyway and show it locally.** This breaks the receive-only
   guarantee. Even if the frame is never published, a page that silently acquires a user's
   camera is a serious trust violation for a childcare product, and it would need the
   `allow` list widened — undoing a control that is currently doing real work.
2. **Fake the PiP with a static image or a CSS placeholder.** Rejected on principle. This
   project has removed fake signals before (`HD 1080p`, `Secure Connection`, the mock
   nursery feed, and the non-functional "Camera On / Mic Active" toggles in Phase 12). A
   tile shaped like a camera preview but showing something else is the same class of lie.
3. **Reuse the SFU's own self-view tile.** The SFU is cross-origin, so its `<video>` element
   is unreachable. This is a deliberate isolation boundary; reaching into it would mean
   defeating the same-origin policy.

### What was built instead

The PiP **slot** is fully built and wired: same position, same glass treatment, same radius,
same soft shadow. It carries real, server-derived facts — child name, session reference, live
indicator — and it is labelled **"Room"**, not "You", so it can never be mistaken for a
self-view. When CR-01 is approved, a local `<video>` drops into that exact slot with **no
layout change**.

---

## 3. Proposed change

Introduce an **opt-in, session-scoped publishing capability** for the parent on this route.

### 3.1 Backend

| File | Change |
|---|---|
| `MediaSessionService.GetIndependentParentMedia` | Accept a `canPublish` flag instead of hard-coding `false` |
| `IndependentMonitoringController` (`GET /independent-monitoring/media`) | Read an explicit `?allowPublish=true` query parameter |
| `BuildJoinPath` | Unchanged — it already derives `audio`/`video`/`cant_publish` from `canPublish` |

### 3.2 Authorization requirement

**This is the part that must be designed carefully, and it is the reason this is a change
request rather than a quick edit.**

`canPublish` must NOT be a client-supplied flag the server honours on request. The route must
require an explicit, audited grant:

1. The parent holds a `ChildGuardian` row for the child (**already enforced** by
   `MonitoringAccess`).
2. A new `MonitoringSession.AllowParentPublish` boolean, set to `true` only by an explicit,
   audited action (e.g. "Share my camera on this session").
3. The flag **defaults to `false`** and is reset when the session ends.
4. A `MonitorEvent` audit row is written when the grant is created and when it is used.

### 3.3 Frontend

- Add a local `getUserMedia({ video: true })` preview, `muted`, `playsInline`.
- Attach the stream to a `<video>` in the existing `.pipTile` slot.
- Stop every track on unmount and on session end. **A camera that keeps running after the
  screen closes is a serious defect.**
- Prompt for the camera **only** after the user has taken the explicit action in 3.2(2) —
  never on page load.

---

## 4. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Accidental or covert camera capture by the parent | **High** | Explicit opt-in only; never on load; visible indicator; stops on unmount |
| Sitter gaining publish rights through the change | **High** | `CanPublish` still derives from the *role*; a Sitter can never receive `true`. Add a test asserting this |
| Bandwidth: a parent publishing while also consuming | Medium | Only one publisher per room; the parent becomes a second publisher alongside the device — verify with the SFU |
| Scope creep into a two-way video product | Medium | This CR is for a *local self-view*, not for publishing to others. Keeping them separate avoids re-opening §8.3 |

## 5. Recommendation

**Defer.** The PiP adds no safety value, no parental-control value, and no revenue. The
highest-value items in §13 of the audit (coturn for real-world NAT traversal, and job-scoped
device credentials so cry detection works during a booked sitting) are far more important to
a working product.

The PiP **slot** is already built and styled, so implementing this later is a small, contained
change rather than a redesign.

## 6. Approval

- [ ] Approved as specified
- [ ] Approved with changes (see notes)
- [ ] Deferred
- [ ] Rejected

**Notes:**

---