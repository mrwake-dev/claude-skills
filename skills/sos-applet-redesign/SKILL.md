---
name: sos-applet-redesign
description: Redesign/modernize a signageOS single-file applet onto the shared design system, add a debug mode with on-screen tail logging, harden reconnect/sync playback, verify on-device via Chrome DevTools Protocol, and generate Marketplace docs (MARKETPLACE.md + .sosconfig.json). Use when asked to redesign, restyle, modernize, "polish", or "prepare for the Solution Hub / Marketplace" a signageOS applet, or to add a debug mode / on-screen logging to one.
---

# sos-applet-redesign

Modernize a signageOS single-file applet (`singlefile-applet/index.html`) so it looks consistent, is debuggable on-device, survives disconnects/sync, and ships with Marketplace docs — **without changing what the applet actually does**.

## When to use
- "Redesign / restyle / modernize / polish this applet", "make it match the design system", "prepare it for the Solution Hub / Marketplace".
- "Add a debug mode" / "add on-screen logging" to an applet.
- Bringing an old bright-background, `contentElement.innerHTML='...'` applet up to the current standard.

## When NOT to use
- Non-signageOS web apps. General frontend work → use `frontend-design`.
- Pure logic changes with no UI/diagnostics/docs surface.

## Golden rule
**Preserve the applet's core function.** Playback loops, sync barriers, stream calls, file caching — keep the logic byte-for-byte. You are only *layering* styling, `log()` calls, status updates, a debug toggle, and docs *around* it. If asked to also change the loop, treat that as a separate, explicit step.

---

## Step 0 — Discover
1. Read the target `singlefile-applet/index.html`, plus any `.sosconfig.json`, `MARKETPLACE.md`, `marketplace.json`, `applet.json` in the applet folder.
2. Read **`reference/DESIGN.md`** (the design system) and **`reference/index.html`** (the base template) bundled with this skill.
3. Identify: the core function (playback / stream / sync / slideshow…), the `sos.config.*` keys it reads, and its `sos` API surface. Note the pinned `front-applet` version in `applet.json`.

---

## Step 1 — Apply the design system
Rebuild the single file on `reference/index.html`, following `reference/DESIGN.md` exactly. Non-negotiables:
- **One self-contained file.** No external fonts/CSS/JS/images — devices are often offline. System-font stacks only (`--font-ui` / `--font-mono`).
- Palette **tokens** on `:root` (`--bg` `#13132a`, `--accent` `#fdc400`, …). Never hardcode a hex in a rule.
- Layout: `.app` (flex column, `height: 100vh`) → `.app__header` (`.brand` + `.device-info` firmware/model/type tiles) → optional `.stage` → `.log` tail console. Respect the **flex height-chain** (`.log__body { min-height: 0; overflow-y: auto }`).
- `loadDeviceInfo()` fills firmware/model/type (guard `sos.management.supports('MODEL')`); call it fire-and-forget so it never blocks playback.
- Old-WebKit friendly: `async/await`, arrow fns, template literals, `appendChild` are fine.

---

## Step 2 — Debug mode + tail logging
Add a `mode` config (`production` | `debug`). Production shows only the header; **debug** reveals the status stage + on-screen log console. Full-screen playback applets hide the whole dashboard once playback starts and **re-reveal it on error**.

CSS (append to the style block):
```css
/* Mode / phase — stage + log are debug-only; production shows only the header */
.stage, .log { display: none; }
.mode-debug .stage, .mode-debug .log { display: flex; }
/* Once playback starts (both modes), hide the dashboard so the native media owns the display */
.is-playing .app { display: none; }
```

JS — module-level flag + tail logger (timestamp, levels, 200-line cap, error re-reveal):
```js
let debugMode = false; // module-level so log() can re-reveal after the dashboard is hidden
function log(message, level) {
    const line = document.createElement('li');
    line.className = 'log__line';
    const time = document.createElement('span');
    time.className = 'log__time';
    time.textContent = new Date().toTimeString().slice(0, 8);
    const text = document.createElement('span');
    text.className = level ? `log__message log__message--${level}` : 'log__message';
    text.textContent = message;
    line.appendChild(time); line.appendChild(text);
    logEl.appendChild(line);
    if (debugMode && level === 'error') document.documentElement.className = 'mode-debug'; // never hide an error
    while (logEl.childNodes.length > 200) logEl.removeChild(logEl.firstChild); // tail cap
    logEl.scrollTop = logEl.scrollHeight; // pin newest
}
```

Class management — put `mode-debug` and `is-playing` **both on `document.documentElement`**:
```js
debugMode = sos.config.mode === 'debug';
document.documentElement.className = debugMode ? 'mode-debug' : '';   // startup
// …once media is actually playing:
document.documentElement.className = debugMode ? 'mode-debug is-playing' : 'is-playing';
```

Status stage helpers: `setStatus(text, level)` toggles `#status-dot` (`--warn`/`--error`) + text; update a secondary field (e.g. "Now playing" / "Video input") from the loop.

**Bootstrap — never drop the async listener** (async `sos` injection is exactly what `sos.loaded` is for):
```js
log('Applet loaded.');
typeof sos !== 'undefined'
    ? startApplet()
    : window.addEventListener('sos.loaded', startApplet);
```
Guard `startApplet` with a `started` flag. Do **not** replace the `else` with an error status.

Add `log()` calls at every meaningful step (ready, mode, device info, cache, connect, per-item play, warnings, errors). Replace all old `contentElement.innerHTML = '...'` status text with `setStatus()` + `log()`.

---

## Step 3 — Harden reconnect / sync
**Order:** cache media first (visible in debug — watch downloads) → hide dashboard → connect/join → play. So the UI is hidden while waiting for the group, and a caching error still shows.

**Sync applets** — barrier-aware loop (only play the video the group agreed on; otherwise skip a round and resync; stop stale prepared media):
```js
let previousVideoIndex, currentVideoIndex = 0, preparedVideoIndex = -1;
while (true) {
    const previousVideo = typeof previousVideoIndex === 'undefined' ? undefined : videos[previousVideoIndex];
    const currentVideo = videos[currentVideoIndex];
    const realUid = await sos.sync.wait(currentVideo.uid, syncGroup); // group barrier, keyed by uid
    const realIndex = videos.findIndex(v => v.uid === realUid);
    if (preparedVideoIndex >= 0 && preparedVideoIndex !== realIndex && preparedVideoIndex !== previousVideoIndex) {
        await sos.video.stop(...videos[preparedVideoIndex].arguments); preparedVideoIndex = -1;
    }
    let endedPromise;
    if (realIndex === currentVideoIndex) {            // in sync → play
        await sos.video.play(...currentVideo.arguments);
        if (previousVideo && previousVideoIndex !== currentVideoIndex) await sos.video.stop(...previousVideo.arguments);
        previousVideoIndex = currentVideoIndex;
        endedPromise = sos.video.onceEnded(...currentVideo.arguments);
    } else { log(`Out of sync — resyncing from next.`, 'warn'); } // don't play out-of-sync media
    const nextIndex = (realIndex + 1) % videos.length;
    await sos.video.prepare(...videos[nextIndex].arguments); preparedVideoIndex = nextIndex;
    if (endedPromise) await endedPromise;
    currentVideoIndex = nextIndex;
}
```
- ⚠️ **Sync-uid gotcha (silent drift):** every device in a `sync_group` must call `wait` with the **same uid** at each step — only the media **URI** differs per device. Mismatched uids (e.g. `video-1/2/3` on one screen, `video-4/5/6` on another) make the follower error/hang at the barrier. This is the #1 multi-screen bug.
- **Modern sync API (verify against the pinned version — don't guess):**
  - `sos.sync.connect(uri ? { engine: 'sync-server', uri } : undefined)` — the bare-string overload is deprecated; `undefined` keeps the device-default engine (don't force `sync-server` and break `p2p-local`).
  - `sos.sync.joinGroup({ groupName })` — `sos.sync.init(groupName)` is deprecated.
  - `sos.sync.wait(data, groupName, timeout)` — group is the **2nd positional** arg (unchanged since 1.0.32).
  - Confirm signatures by fetching the actual `.d.ts` (e.g. `https://unpkg.com/@signageos/front-applet@<ver>/es6/FrontApplet/Sync/Sync.d.ts`).
- **Stream applets** self-heal: wire `sos.stream.onConnected(() => setStreaming(true))` (hide UI, native layer owns the display) and `onDisconnected(() => setStreaming(false))` (show UI + status). `setStreaming` toggles `body.is-streaming` (transparent bg + `.app { display:none }`).

Marketplace note for sync: a screen that starts/reboots late needs **up to one full loop** to fall into sync (it waits out the current round, then joins on the next).

---

## Step 4 — Verify on-device via CDP
The applet must be deployed to the real device (the human does this, or per the project flow — don't serve HTML locally unless asked). Then use the **`signage-cdp`** skill (or CDP directly) against the device:
- Applet renders: dark-navy bg + yellow accents; header title + device-info tiles populate (not `—`).
- `debug` mode: the log **tails** (newest pinned, scrolls internally, long lines wrap), the stage shows live status; production shows **only** the header.
- Core behavior works (playback/stream/sync); on a forced error the dashboard **re-reveals** with the red log line.
- Tail the device console; screenshot. Note: the applet runs in an **iframe** and screenshots capture the **web layer only** — the native video/stream layer won't appear, so confirm playback via logs/state, not the screenshot.

---

## Step 5 — Marketplace docs
Create/update **`MARKETPLACE.md`**:
```md
# <Applet Name>

***<one-line value prop>***

<2–3 sentence description.>

## Highlights
- **<feature>** — <benefit>
- **On-screen diagnostics** — `debug` mode reveals a live log console and status readout for troubleshooting

## Configuration
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `<key>` | string/enum | … | … |
| `mode` | enum | `production` | `production` shows only the title + device-info header; `debug` also reveals the status readout and on-screen log console |

## Use Cases
- …

## Getting Started
<install → configure → deploy; end with: switch `mode` to `debug` to troubleshoot.>
```
- **Sync applets:** add a `## Synchronization` section warning that a late/restarted screen takes up to one loop to sync.
- Create/extend **`.sosconfig.json`** so options show in the box UI (create it if the applet lacks one):
```json
{ "configDefinition": [
  { "name": "mode", "valueType": "enum",
    "description": "Debug shows the status readout and on-screen log console; production hides everything except the title and device-info section. Defaults to production.",
    "list": ["production", "debug"] }
] }
```
- Keep config keys **consistent across an applet family** (e.g. `placement` = layout, `mode` = debug). If a layout key collides with `mode`, rename the layout key rather than overloading `mode`.

---

## Hard rules
- ✅ Preserve core behavior; only layer styling/logging/status/debug/docs around it.
- ✅ One self-contained, offline-safe file; palette tokens; system fonts; BEM names; `clamp()` sizing.
- ✅ Keep the `sos.loaded` listener in the bootstrap `else`.
- ✅ Verify SDK signatures against the actual `front-applet` version — never assume.
- ✅ Sync: identical `uid`s across all group members; only URIs differ.
- ❌ No external assets, webfonts, frameworks. No hardcoded hex. Don't repurpose `--accent` for warnings (that's `--warn`).

## Bundled references
- `reference/DESIGN.md` — the design system. Read before restyling.
- `reference/index.html` — the base single-file template to build on.
