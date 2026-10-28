---
name: mwd-prepare-to-cf-workers
description: Prepare a web project for deployment on Cloudflare Workers with static assets — detect the project type (static/prerendered site, client-only SPA, or static site plus an API Worker), add a pinned Wrangler, wrangler.jsonc, _headers, 404 handling and preview/deploy scripts, verify everything on the local Workers runtime, run the first deploy after confirmation, and hand over the Cloudflare Workers Builds (Git integration) settings, including the GitHub Packages token fix for private @scope packages. Use when the user wants to host, deploy or move a site or frontend to Cloudflare Workers.
argument-hint: "[worker-name]"
disable-model-invocation: true
---

# Prepare a project for Cloudflare Workers

Turn the project in the current directory into a Cloudflare Worker that serves its built files from Cloudflare's edge, prove it works on the local Workers runtime, deploy it once (with the user's OK), and leave Cloudflare's Git integration (Workers Builds) to deploy every later push.

`$ARGUMENTS` may name the Worker. Otherwise derive it from `package.json` `name` or the repo name (lowercase, letters, digits and dashes) and say which name you picked.

## Ground rules

- **Say where things run** before the first build: build, `wrangler dev` and the first deploy run on this machine; later deploys run in Cloudflare Workers Builds.
- **Never handle credentials.** Don't paste, echo or store API tokens, npm tokens or Worker secrets. The user creates tokens in the Cloudflare and GitHub dashboards and types secret values themselves (`wrangler secret put` prompts them). Reading `wrangler whoami` output is fine; the account ID isn't a secret.
- **Deploying publishes the site.** Run `wrangler deploy` only after the user confirms in chat for this project.
- **Don't commit or push** unless the user asks. Workers Builds deploys from the Git remote, so remind them the changes must be pushed.
- **Stay in scope.** Change only what Workers hosting needs. If something unrelated looks wrong, list it at the end instead of fixing it.
- Match the project's conventions: package manager, exact vs ranged versions, indentation, comment style. Keep comments to one line.

## Step 1 — Inspect the project (read-only)

Gather these before asking anything:

| What | How | Why it matters |
|:--|:--|:--|
| Package manager | lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`) | install commands, Workers Builds install |
| Build command and output dir | `package.json` scripts, framework config (see `references/project-types.md`) | `assets.directory` |
| Existing Cloudflare config | `wrangler.toml` / `wrangler.json` / `wrangler.jsonc`; Pages' `pages_build_output_dir` | update it rather than add a second one |
| Routing type | one HTML file per route, or a single `index.html` with a client-side router; any server code (forms, API, secrets)? | picks the project type |
| Link style | built HTML hrefs: `/about` vs `/about/`; output files `about/index.html` vs `about.html` | `html_handling` |
| Node version | `.nvmrc`, `.node-version`, `engines` | Workers Builds reads `.nvmrc`/`.node-version` (default Node 24) |
| Private registries | `.npmrc` scopes pointing at registries that need auth, e.g. `npm.pkg.github.com` | Workers Builds install fails with 401 without a token |
| Git remote | `git remote -v` | Workers Builds needs the repo on GitHub or GitLab. If there is none, the user has to create and push one; don't add remotes yourself |
| Dev-time mocks | dev-server middleware or proxies serving `/api/*` (e.g. a `configureServer` plugin in `vite.config.*`) | they describe what an API Worker must do, and drift from it if both are kept |
| CI and tests | `.github/workflows`, Playwright/Cypress config and its `webServer` | tests should run on the Workers runtime |
| Cloudflare login | after installing Wrangler: `npx wrangler whoami` | account ID; whether a login exists |
| Candidate domain | `homepage` in package.json, README, contact emails; `dig +short NS <domain>` | a domain on Cloudflare nameservers can be attached as a custom domain |

Classify the project as one of:

- **Static site**: every route has its own built HTML file (plain HTML, Astro, Next.js `output: 'export'`, a prerendered SPA, Eleventy, Hugo…). Assets-only Worker, real 404s.
- **Client-only SPA**: one `index.html`, the client router renders every route. Assets-only Worker with the SPA fallback.
- **Static site or SPA plus an API Worker**: either of the above plus server code: form handlers, API routes, anything needing secrets. A Worker script for `/api/*`, assets for everything else.

If the type is ambiguous (e.g. an SPA that could be prerendered), ask rather than guess.

## Step 2 — Ask the user (one round)

Use one AskUserQuestion call with only the questions that apply, and a recommended option first:

1. **Address**: `workers.dev` only, or a custom domain (offer it only if Step 1 found a domain on Cloudflare nameservers; apex, `www`, or both).
2. **Search engines**: allow indexing, or keep them out until launch. Placeholder or unfinished content is a reason to block. Blocking uses an `X-Robots-Tag: noindex` header and no robots.txt `Disallow`, because Google can only honour `noindex` on pages it is allowed to crawl.
3. **Extras** (multi-select): security headers (nosniff, referrer policy, frame blocking); long cache for content-hashed assets (only if the build emits hashed filenames in their own folder); a 404 page (static sites without one).
4. **Project type**, only if Step 1 left it unclear.
5. **Local development of an API Worker in a Vite project**: Cloudflare's Vite plugin (`@cloudflare/vite-plugin` runs the Worker inside `vite dev` and replaces any dev mock), or keep the dev server as is and exercise the Worker with `npm run preview` after a build. Ask only for API Workers; if a dev mock exists, mention that it can drift from the Worker.

AskUserQuestion takes at most four questions, so drop the ones Step 1 already settles.

## Step 3 — Configure

Read `references/project-types.md` for the per-type `wrangler.jsonc`, `html_handling` choice, `_headers` templates, 404 setup per framework and the API Worker layout.

1. **Wrangler**: install the latest version as a devDependency with the project's package manager (`npm view wrangler version`). Pin it the way the project pins; if the project has no dependencies yet, pin it exactly. Wrangler needs Node 22+. No `package.json` at all? Create a minimal private one so the version is pinned.
2. **compatibility_date**: the date in the installed `workerd` version (`node -p "require('workerd/package.json').version"` → `1.20261001.1` means `2026-10-01`). A newer date makes Wrangler warn and fall back.
3. **wrangler.jsonc**: from the matching template. Set `account_id` from `wrangler whoami`; it avoids an account prompt when the login can see several accounts. One-line comments explaining non-obvious settings, in the style of the project.
4. **`_headers`**: put it in the folder the build copies verbatim into the output (`public/` for Vite, Next.js, Astro; the site folder itself when there's no build; a copy step for custom bundlers). After building, confirm it is in the output directory.
   - **Use exactly one block per path pattern.** A second `/*` block silently replaces the first, even though Wrangler reports both as valid.
   - Put comments on their own line above a block.
   - `_headers` only covers responses served from assets. If the user chose security headers and there's an API Worker, set the same headers on the Worker's responses in code.
5. **404 page** (static sites): use the framework's native mechanism so it lands at `<output>/404.html`. Assets on it must use root-absolute URLs (`/assets/...`), because Cloudflare serves it at nested paths too.
6. **Scripts**:
   - `preview` = `wrangler dev --port <free port>`, run after a build.
   - `deploy` = `<build> && wrangler deploy`, or just `wrangler deploy` when there's no build step.
   - API Worker: also `cf-typegen` = `wrangler types` and a worker typecheck.
7. **.gitignore**:
   - `.wrangler/`.
   - `node_modules/`, if installing Wrangler created it and it isn't ignored yet.
   - API Worker: also `.dev.vars`, `.dev.vars.*` and `!.dev.vars.example`.
   - Commit the generated `worker-configuration.d.ts`; Cloudflare's own templates do.
8. **Node version**: if the project has no `.nvmrc`, `.node-version` or `engines`, leave it. Workers Builds defaults to Node 24, which satisfies Wrangler. Add one only if the build needs a specific version.
8. **Tests**: if an E2E suite starts a static server (`sirv`, `serve`, `vite preview`…), point it at `npm run preview` so tests run on the Workers runtime. Then add checks for the trailing-slash redirect, the 404 or SPA fallback and the headers. Drop the old static-server dependency if nothing else uses it.
9. **CI**: keep GitHub Actions as checks only. Workers Builds deploys, so don't add a deploy job or Cloudflare secrets. If CI runs `wrangler dev` (E2E), set `WRANGLER_SEND_METRICS: false` in the workflow env.

## Step 4 — Verify locally

1. Run the project's lint, typecheck and build, if present, and confirm the output has the expected files (`404.html`, `_headers`, each route's HTML).
2. Start `wrangler dev` in the background, or through the preview tooling if available. Check it with the bundled script, which takes `path=status` or `'path=status>redirect-target'` and `--header 'name=value'`, and exits non-zero on any failure:
   ```bash
   S=${CLAUDE_PLUGIN_ROOT}/skills/mwd-prepare-to-cf-workers/scripts/check-site.sh
   # Asset routes: every route, an unknown URL, the trailing-slash redirect, and the headers you added
   bash $S http://localhost:<port> /=200 /about=200 /does-not-exist=404 '<redirect check>' \
     --header 'x-content-type-options=nosniff' --header 'x-robots-tag=noindex'
   ```
   Build the expectations from the project, not from this example:
   - **Redirect check** for the chosen `html_handling`:
     - `drop-trailing-slash`: `'/about/=307>/about'`
     - `auto-trailing-slash` with `about/index.html`: `'/about=307>/about/'`
     - `auto-trailing-slash` with `about.html`: `'/about.html=307>/about'`
   - **SPA:** a deep link like `/settings/profile=200` instead of the 404 line.
   - **API Worker:** check it in a separate call. `--header` applies to every path in one call, and `_headers` doesn't cover Worker responses. Include each `/api/...` route with its status, and an unknown `/api/nope=404` (it must not fall through to the SPA's `index.html`).
   - **Long cache:** check one hashed file in its own call with `--header 'cache-control=public, max-age=31536000, immutable'`.
3. Run the E2E suite if there is one.
4. If a browser tool is available, open a page and the 404 page, and check the console is clean. The browser logs a 404 page's own 404 status as an error; that one is expected.
5. Stop every `wrangler dev`, preview server or browser tab you started.

Fix failures before moving on. Don't loosen a check to make it pass.

**Harmless output you can ignore:**
- npm 11 saying the esbuild/workerd install scripts were skipped; Wrangler works without them.
- `wrangler whoami` listing missing OAuth scopes and suggesting `wrangler login`.
- `wrangler dev` warning about `Request.cf` timeouts when offline.
- `wrangler types` suggesting `@types/node` when `nodejs_compat` isn't enabled.

## Step 5 — First deploy (after the user confirms)

Ask, naming the Worker, e.g. "Deploy `<name>` to your workers.dev subdomain now?" The full URL appears in the deploy output, and `whoami` doesn't show the subdomain. Then:

```bash
WRANGLER_SEND_METRICS=false npm run deploy
```

Use the URL Wrangler prints for all later checks.

- If the account has no `workers.dev` subdomain, Wrangler asks to register one and the non-interactive shell declines. Hand that step to the user: the dashboard (Workers & Pages → your subdomain) or running `npx wrangler deploy` in their own terminal.
- With a custom domain in `routes` (`"custom_domain": true`), the deploy creates the DNS record and certificate. The zone must be in the same account.
- Verify the live URL with `check-site.sh` using the same expectations as Step 4, and look at a page in the browser if possible.
- API Worker: before or right after the first deploy, the user sets runtime secrets with `npx wrangler secret put <NAME>` in their own terminal. Secrets survive later deploys.

## Step 6 — Hand over Workers Builds

Read `references/workers-builds.md` and give the user the exact dashboard settings for this project. If the repo has no remote yet, start with: push it to GitHub or GitLab, including these changes. Then cover:
- build command (empty when there's no build step) and deploy command
- root directory, for monorepos
- build variables, including the private-registry fix when Step 1 found an auth-requiring registry
- that the dashboard Worker name must equal `name` in `wrangler.jsonc`

Explain that each push to the production branch then builds and deploys, and that the build shows up as a check on the commit in GitHub.

## Step 7 — Report

Keep it short and plain:
- the live URL, and whether it was deployed
- the project type and the key settings: `html_handling`, 404 or SPA fallback, headers, indexing
- what was verified locally and live
- what the user still has to do: the dashboard settings, any token, and committing and pushing
- anything out of scope you noticed but didn't touch
