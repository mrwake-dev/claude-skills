# applet-default — Design Guide

This folder is the **base template** for new signageOS applets. `index.html` is a single,
self-contained file (HTML + CSS + JS in one document) meant to be copied and extended.

This document describes the design system and the non-obvious rules behind it so future
edits stay consistent. **Read this before restyling or extending `index.html`.**

---

## 1. Purpose & principles

- A signageOS applet is a customer HTML app that runs on a signage device (Tizen, webOS,
  BrightSign, Android player) via the signageOS runtime. It typically plays video, works
  with the file system, and reports device state.
- This template gives a clean, good-looking starting point that surfaces: **title**,
  **description**, key **device info** (firmware / model / type), and a **log console**.
- Keep it **simple**. It is a base others copy — favour clarity over cleverness. Don't add
  features (preview stages, clocks, extra panels) unless asked.

## 2. Hard constraints (do not break these)

- **Fully self-contained.** No external fonts, CSS, JS, or image requests. Signage devices
  are frequently offline; anything fetched from a CDN may fail to load. All styles live in
  the single `<style>` block; all script in the single inline `<script>`.
- **System fonts only.** See the `--font-ui` / `--font-mono` stacks. Never add Google Fonts
  or `@font-face` from a URL.
- **Landscape, full-screen.** Designed for a fixed display (commonly 1920×1080). The layout
  fills the viewport exactly (`height: 100vh`) — see the height-chain rule in §6.
- **Old WebKit friendly.** Devices may run older browser engines. The repo's single-file
  examples use `async/await`, arrow functions and template literals, so those are safe.
  Avoid very new APIs without checking. Prefer `element.appendChild()` over newer sugar.

## 3. Colour palette

All colours are CSS custom properties on `:root`. **Always reference the token, never hardcode
a hex value** in a rule.

| Token           | Value                        | Use                                             |
| --------------- | ---------------------------- | ----------------------------------------------- |
| `--bg`          | `#13132a`                    | Page background (dark navy)                     |
| `--surface-alt` | `#1e1e3d`                    | Elevated panels (the log). One step lighter than `--bg` |
| `--accent`      | `#fdc400`                    | signageOS yellow — marks, labels, status dots   |
| `--text`        | `#f4f4f8`                    | Primary text                                    |
| `--text-muted`  | `#a6a6c8`                    | Labels, secondary text, log timestamps          |
| `--border`      | `rgba(255,255,255,0.08)`     | Hairline separators / panel borders             |
| `--warn`        | `#f5a623`                    | Warning-level log lines (orange)                |
| `--error`       | `#ff6b6b`                    | Error-level log lines (red)                     |

Rules:
- `--bg` and `--accent` (`#13132a` dark navy + `#fdc400` yellow) are the fixed brand pair —
  don't change them without an explicit request.
- Elevated surfaces are **lighter** than the background (dark-UI convention). A new panel
  should use `--surface-alt` (or a value close to it), never a colour darker than `--bg`.
- Keep the yellow for accents/branding. Don't use it for warnings — that's `--warn`.

## 4. Typography

- UI text: `--font-ui` (system sans stack).
- Log console + any monospaced/tabular data: `--font-mono`.
- Numeric values that update (device info) use `font-variant-numeric: tabular-nums` so they
  don't jitter as digits change.
- Uppercase micro-labels (`--accent`, `letter-spacing: 0.08em`, ~0.75–0.8rem, weight 600) are
  the established label style — reuse `.device-info__label` / `.log__header` as the pattern.

## 5. Layout & responsive sizing

Structure:

```
.app (flex column, height:100vh, max-width 1800px, centred, padded)
├── .app__header (flex row, wraps)
│   ├── .brand         → accent bar + title + description  (left, grows)
│   └── .device-info   → firmware / model / type tiles     (right, fixed)
└── .log (flex column, grows to fill)
    ├── .log__header   → "Log" title + accent dot
    └── .log__body     → scrollable line list (#log)
```

- **Fluid sizing** everywhere via `clamp(min, vw, max)` so it reads well on a large TV and
  scales down. Follow this pattern for new spacing/font sizes rather than fixed px.
- The header uses `flex-wrap: wrap`; on narrow widths the device-info block drops below the
  title. `.brand` grows (`flex: 1 1 auto`), `.device-info` is fixed (`flex: none`).
- `.app` has a larger `padding-bottom` than its other sides — intentional breathing room
  under the log. Preserve it.

## 6. ⚠️ The flex height-chain rule (critical — easy to break)

The log is a **tail console**: it fills the remaining height, scrolls **internally**, and
new lines auto-pin to the bottom while old lines scroll out of view. This only works if the
height chain is intact. If you touch `.app`, `.log`, or `.log__body`, keep all of this:

- `.app { height: 100vh; }` — **must be a fixed height, not `min-height`.** With `min-height`
  the container grows and the whole *page* scrolls instead of the log.
- `.log { flex: 1 1 auto; }` — fills the leftover space below the header.
- `.log__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }` — **`min-height: 0` is
  mandatory.** A flex item defaults to `min-height: auto`, which refuses to shrink below its
  content, so `overflow-y` never engages and the panel just expands.

Rule of thumb: any scrollable region inside a flex column needs `min-height: 0` on itself and
a bounded (non-growing) height on its flex ancestors.

## 7. Naming convention

BEM-ish: `.block`, `.block__element`, `.block__element--modifier`. Existing blocks: `app`,
`brand`, `device-info`, `log`. Follow this when adding elements (e.g. a new log level is
`.log__message--info`, not a new class).

## 8. Component patterns

### Device-info tile
One `.device-info__item` = uppercase `--accent` label + bold value with a stable `id`.
Placeholder value is an em dash `—`. Current ids: `firmware-version`, `device-model`,
`device-type`. To add a field, copy an item, give the value a new `id`, and populate it in JS.

### Log console
- Each line is `<li class="log__line">` = `.log__time` (`HH:MM:SS`, `--text-muted`, fixed
  width) + `.log__message` (grows, `min-width: 0` so long text/URLs wrap).
- `.log__line` uses `white-space: pre-wrap; word-break: break-word;` so long lines wrap
  instead of overflowing. **Keep `min-width: 0` on `.log__message`** — without it, long
  unbreakable strings overflow horizontally on older engines.
- **Levels** are message modifiers: default (info, `--text`), `--warn` (orange), `--error`
  (red). Add a level by adding a `--<level>` colour token and a `.log__message--<level>` rule.

## 9. signageOS runtime integration

The template's JS follows the repo's single-file convention:

- `sos` is a **global injected by the signageOS runtime** — there is no `import`/`require`
  (that's only for `cli-applet` webpack builds). Never add `import sos from ...` here.
- Bootstrap pattern (handles both "sos already present" and "sos loads later"):
  ```js
  if (typeof sos !== 'undefined') { startApplet(); }
  else { window.addEventListener('sos.loaded', startApplet); }
  ```
  A `started` guard prevents double-init.
- Always await `sos.onReady()` before calling the management API.

API methods used (guard with `sos.management.supports('<CAP>')` where a capability exists):

| Field    | Call                                       |
| -------- | ------------------------------------------ |
| Firmware | `sos.management.firmware.getVersion()`     |
| Model    | `sos.management.getModel()` (cap `MODEL`)  |
| Type     | `sos.management.app.getType()`             |

Other useful surfaces for future applets: `sos.video.play(...)`, `sos.stream.play(...)`,
`sos.fileSystem.*`, `sos.management.getSerialNumber()`, `sos.management.getTemperature()`.

### Preview fallback
`sos` does not exist in a plain browser, so a `setTimeout` fallback logs "preview mode" and
sets fields to `N/A` after ~2s (the delay lets `sos.loaded` win on a real device). This makes
the template demonstrable in a browser. Keep it, but it must never win on-device.

### Demo lines
The three long/warn/error log lines in the preview fallback are **verification samples,
marked "safe to remove"**. Remove them for a real applet.

## 10. Extending — quick recipes

- **Add a device field:** duplicate a `.device-info__item`, set a new `id`, and in
  `loadDeviceInfo()` fetch + `textContent` it + `log()` it.
- **Add a log level:** add `--<level>` token, `.log__message--<level>` rule, call
  `log(msg, '<level>')`.
- **Add a content section:** place it between the header and `.log` as another flex child.
  Give it `flex: none` (fixed) or manage the height chain (§6) if it should scroll.

## 11. Do / Don't

- ✅ Use palette tokens, `clamp()` sizing, BEM names, the existing label/console patterns.
- ✅ Keep everything in the single file; keep it offline-safe.
- ❌ No external assets, webfonts, frameworks, or CSS resets beyond what's here.
- ❌ Don't reintroduce `min-height` on `.app` or drop `min-height: 0` from `.log__body`.
- ❌ Don't hardcode hex colours in rules; don't repurpose `--accent` for warnings.

## 12. Verifying changes

Serve the folder and open it in a browser (there is no build step for the single file):

```bash
python3 -m http.server 4599 --directory applet-default
# open http://localhost:4599/
```

Check: dark-navy bg + yellow accents; header title/description left, firmware/model/type
right (they show `N/A` in preview mode); the log renders sample lines. To test the console,
append many lines and confirm the page does **not** scroll, the log scrolls internally, the
newest line stays pinned at the bottom, and long lines wrap.
