# Device Runtime Rules (signage players: Tizen, webOS, BrightSign, embedded Linux)

Apply when the MR touches code that runs on signage devices. Triggers: imports from
`@signageos/front-applet` / `@signageos/front-display`, `tizen` / `webos` / `brightsign` in paths or
configs, a browserslist targeting old Chromium/WebKit, applet or player-runtime directories. When
unsure whether code ships to devices, apply these rules anyway — the failure modes below are
invisible in CI and on developer machines, and only surface on the fleet.

## Engine & build-target compatibility

The oldest supported devices run ancient engines (Tizen 2.4 ≈ Chromium 47-era WebKit; early webOS
is similar; BrightSign ships its own Chromium builds). Anything modern in the diff must be covered
by the build target.

- Check `tsconfig.json` `target`, browserslist, and babel/swc config against new **syntax** in the
  diff: optional chaining `?.`, nullish coalescing `??`, logical assignment `??=`/`||=`,
  `String.prototype.replaceAll`, `Array.prototype.flat`/`flatMap`, `Object.fromEntries`,
  `globalThis`, BigInt, class fields.
- Runtime **APIs are not transpiled** — verify availability or a polyfill for: `fetch`,
  `AbortController`, `URLSearchParams`, `IntersectionObserver`, `ResizeObserver`,
  `requestIdleCallback`, Web Crypto, `Promise.allSettled`/`any`.
- **CSS** in the diff: flexbox `gap`, `aspect-ratio`, `position: sticky`, `inset`, newer selectors
  — verify against the oldest target WebKit.
- **Untranspiled dependencies** (classic fleet-killer): a new or bumped dependency may publish
  modern syntax in its dist. If the bundler does not transpile `node_modules`, the app
  white-screens on old devices and neither type-check nor CI catches it. For each new/bumped
  runtime dependency, check the published dist syntax level (or the package's `engines`/browser
  support statement), or confirm `node_modules` transpilation is configured.

## 24/7 longevity (the app never reloads)

Signage apps run for weeks without a page reload — slow leaks that are invisible on a laptop crash
a player on day 4.

- Every `setInterval`/`setTimeout` registered in a loop, retry, or reconnect path must be cleared
  on the corresponding teardown.
- Event listeners (`addEventListener`, emitter `.on`) added in reconnect/re-init paths need
  matching removal — re-subscribing on every reconnect both leaks and duplicates handlers (double
  playback, double telemetry reports).
- Unbounded growth: log/telemetry buffers, caches, Maps keyed by content id, arrays that only ever
  push. Require a size cap or eviction policy.
- DOM growth: nodes appended per content rotation without removal.
- Retained closures in long-lived sagas/subscriptions holding large objects (video blobs, decoded
  image data).
- `setInterval` drifts over long uptimes — when wall-clock accuracy matters (scheduled content),
  schedule with `setTimeout` to the next boundary instead.

## Network resilience (connectivity is unreliable)

- Every fetch/XHR needs a timeout; a hung request must never stall playback.
- Retries: exponential backoff with jitter and a cap — no tight retry loops. They melt the CPU on
  weak devices and, fleet-wide, DDoS the backend.
- WebSocket reconnect: backoff + jitter, and resubscription that does not stack duplicate handlers.
- Offline-first: what happens when the device boots without network? Cached content must still
  play; a failed sync must not wipe local state.
- Clock skew: devices may boot with a wrong clock until NTP syncs — beware of comparing local time
  against server timestamps, or of tokens/certs appearing expired at boot.

## TLS & certificates on legacy devices

- New external endpoints must work with old device trust stores and TLS stacks — old Tizen/webOS
  may lack newer root CAs (the Let's Encrypt DST Root X3 expiry broke real fleets) and may not
  support TLS 1.3.
- Mixed content: HTTP resources on HTTPS pages fail silently on some device browsers.

## Storage & media constraints

- Flash/SD wear (especially BrightSign): avoid high-frequency writes — per-second state
  persistence, verbose file logging. Batch and throttle writes.
- Handle `localStorage`/IndexedDB quota errors; device quotas are small.
- Many SoCs have a **single hardware video decoder** — flag concurrent `<video>` playback, or
  preloading a second video while one plays, without a device-capability check.
- Memory budget is ~512 MB–1 GB on full-HD panels — flag unbounded image preloading and
  larger-than-viewport textures.

## Shared cross-service contracts

- When the diff references a symbol from a shared package (e.g. `DeviceTelemetryType` from
  `@signageos/common-types`), verify the version pinned in `package.json`/lockfile actually exports
  it — a member added in a sibling MR does not exist until the dependency is bumped.
- String literals that mirror a shared enum or a contract with another service (gateway endpoints,
  telemetry names, socket event names) are drift risks — require the shared constant/enum, or an
  explicit comment justifying the literal.
