# Device Runtime Rules (signage players: Tizen, webOS, BrightSign, embedded Linux)

Apply when the MR touches code that runs on signage devices. Triggers: imports from a device-runtime
SDK (`front-applet` / `front-display` packages), `tizen` / `webos` / `brightsign` in paths or
configs, a browserslist targeting old Chromium/WebKit, applet or player-runtime directories. When
unsure whether code ships to devices, apply these rules anyway — the failure modes below are
invisible in CI and on developer machines, and only surface on the fleet.

## Engine & build-target compatibility

Source here is routinely written in modern JS and downlevelled by the bundler, so "modern syntax in
the diff" is not by itself a defect. What decides it is the **real** build target, whether a gate
enforces it, and whether lib APIs are polyfilled. Establish those three facts first — every rule in
this section is judged against them.

### Resolve the target first (mandatory)

**1. Real transpile target.** Search in this order, first hit wins. `tsconfig.json` `target` is
**not** authoritative — it reads `esnext` in repos that ship ES5 — and is a fallback only when
nothing below exists:

| Look in                                                     | Field                                                                        |
|:------------------------------------------------------------|:-----------------------------------------------------------------------------|
| `rspack.config.*` / `webpack.config.*` using `swc-loader`   | `jsc.target`                                                                 |
| `.swcrc`                                                     | `jsc.target`                                                                 |
| `webpack*.config.*` using `babel-loader`                    | `presets: ['@babel/preset-env', { targets }]` — **absent `targets` means ES5** |
| `tools/build.mjs` driving a `lib-bundler` wrapper           | bundler default (esbuild `es6`, then swc down to `es5`)                      |
| `.browserslistrc` / `package.json` `browserslist`           | the query                                                                    |
| `tsconfig.json` (last resort)                                | `target`                                                                     |

Note which bundle the changed file belongs to — a repo commonly targets ancient Chromium for its
client bundle and current Node for its server bundles, from the same `package.json`.

**2. The gate.** Is `es-check` (or equivalent) both present *and* chained into the `build` script? A
devDependency nothing runs is not a gate. Record the asserted level — it is often looser than the
transpile target (swc emitting `es5` behind `es-check --module es6` is real).

**3. Polyfill coverage.** Broad (`core-js/stable` imported at an entry point), narrow (a hand-rolled
`src/polyfills/*` covering one or two APIs), or none. This decides whether a lib-API hit is a defect
or a non-issue.

State the resolved values, and the `file:line` you read them from, in any finding that depends on them.

### Transpiled syntax — usually not a finding

`?.`, `??`, `??=`/`||=`, `**`, `async`/`await`, object spread, optional catch binding, class fields
`#x`, `for await`, `Array.prototype.flat`/`flatMap` and `Object.fromEntries` are all rewritten by
swc/babel/esbuild. Raise them only when:

- the file is **outside what the loader processes** — a dependency outside a `node_modules`
  allowlist, or a config/tool/script file nothing compiles (HIGH);
- there is **no gate**, so a transpile misconfiguration ships silently (MED);
- a gate exists and would fail the build (LOW–MED — say so, and point at the gate).

Regex is the exception that is never transpiled: named capture groups, lookbehind and the `s`/`u`
flags are engine features, so they fail at runtime regardless of the target.

### Non-transpiled lib & DOM APIs — the real hazard

These are never rewritten, are invisible to `es-check` (which parses syntax only), and type-check
cleanly whenever `lib` is `es2022`/`esnext`. Nothing in the toolchain catches them and they
white-screen on the device. Judge each against the resolved target, naming the ES year it needs:

- **ES2015–17** — `Object.assign`, `Array.from`, `Object.entries`/`values`, `String.padStart`/`padEnd`
- **ES2018–20** — `Promise.prototype.finally`, `String.trimStart`/`trimEnd`, `String.matchAll`,
  `Promise.allSettled`, `globalThis`, `BigInt`
- **ES2021+** — `String.replaceAll`, `Promise.any`, `Object.hasOwn`, `Array.prototype.at`,
  `findLast`/`findLastIndex`, `structuredClone`
- **DOM/BOM** — `fetch`, `AbortController`, `AbortSignal.timeout`, `URLSearchParams`,
  `IntersectionObserver`, `ResizeObserver`, `requestIdleCallback`, `queueMicrotask`,
  `new EventTarget()`, `Element.closest`, `replaceChildren`, Web Crypto (`crypto.subtle`)

Severity: HIGH–CRITICAL where polyfill coverage is narrow or absent; MED where a broad `core-js` is
imported at the entry point but the API falls outside its configured scope.

### CSS

Flexbox `gap`, `aspect-ratio`, `position: sticky`, `inset`, `:has()`, logical properties — verify
against the oldest target WebKit. CSS is not transpiled either; autoprefixer adds prefixes but
cannot add a missing feature.

### Untranspiled dependencies (classic fleet-killer)

A new or bumped dependency may publish modern syntax in its `dist`. Which of the two mechanisms the
repo uses decides how serious that is:

- **Dedicated `node_modules` rule** — a second loader entry matching `node_modules`, often
  `enforce: 'post'`. Everything is downlevelled and a new dependency is covered by default.
- **Selective `include` allowlist** — the loader processes `src` plus a named list of packages only.
  Then **any** new runtime dependency is untranspiled by default. That is structural rather than a
  judgement call: flag it and name the allowlist that has to be extended.

Either way, for each new/bumped runtime dependency check the published dist syntax level, or the
package's `engines`/browser-support statement.

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
  `common-types`), verify the version pinned in `package.json`/lockfile actually exports
  it — a member added in a sibling MR does not exist until the dependency is bumped.
- String literals that mirror a shared enum or a contract with another service (gateway endpoints,
  telemetry names, socket event names) are drift risks — require the shared constant/enum, or an
  explicit comment justifying the literal.
