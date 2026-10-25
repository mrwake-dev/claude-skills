# Configuration per project type

## Contents

1. Build output directory by framework
2. Choosing `html_handling`
3. Static site
4. Client-only SPA
5. Static site or SPA plus an API Worker
6. `_headers` templates
7. 404 page per framework
8. Limits and gotchas

## 1. Build output directory by framework

Confirm by running the build. Configs can override these defaults.

| Framework | Output | Notes |
|:--|:--|:--|
| Vite (React, Vue, Svelte) | `dist` | `base` must stay `/` for nested 404s |
| Next.js | `out` | needs `output: 'export'` in `next.config.*`; without it the app needs a server, so stop and ask |
| Astro (static) | `dist` | |
| SvelteKit + adapter-static | `build` | |
| Angular | `dist/<project>/browser` | |
| Create React App | `build` | |
| Eleventy / Hugo | `_site` / `public` | |
| Plain HTML, no build | the folder holding `index.html` | prefer a dedicated folder; if it must be the repo root, add `.assetsignore` |
| Custom bundler (webpack, Rspack) | see `output.path` | static files like `_headers` need a copy plugin |

## 2. Choosing `html_handling`

Look at the built files and the links the site uses. Pick the mode under which every in-site link answers with 200 directly, without a redirect.

| Output files | In-site links | `html_handling` | Result |
|:--|:--|:--|:--|
| `about/index.html` | `/about` | `drop-trailing-slash` | `/about` 200; `/about/` and `/about/index.html` 307 to `/about` |
| `about/index.html` | `/about/` | `auto-trailing-slash` (default) | `/about/` 200; `/about` 307 to `/about/` |
| `about.html` | `/about` | `auto-trailing-slash` (default) | `/about` 200; `/about.html` 307 to `/about` |
| only `index.html` (SPA) | any | default | the SPA fallback handles routes |

Redirects are always 307. `/` serves `index.html`, and `/index.html` redirects to `/`.

Sites often mix styles, e.g. `/about/` → `about/index.html` and `/contact` → `contact.html`. Check every distinct link against the table and pick the mode that serves all of them with 200; the default `auto-trailing-slash` covers that common mix. If no mode fits every link, tell the user which links would redirect, and suggest aligning them rather than leaving redirects in the site.

## 3. Static site

Every route has its own HTML file. Unknown URLs should return a real 404.

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "<worker-name>",
	"account_id": "<from wrangler whoami>",
	"compatibility_date": "<from the workerd version>",
	"workers_dev": true,

	// Assets-only Worker: Cloudflare serves the build straight from the edge.
	"assets": {
		"directory": "./dist",
		// <one line: why this mode, e.g. "Pages are dist/x/index.html and links point to /x.">
		"html_handling": "drop-trailing-slash",
		// Unknown paths get the nearest 404.html with a 404 status.
		"not_found_handling": "404-page"
	}
}
```

- `404-page` serves the nearest `404.html`, walking up from the requested path, with status 404. `/404` itself answers 200.
- **A prerendered SPA** (a client router whose routes are prerendered, like the Stocksee site) is a static site. Its catch-all route should be prerendered to `404.html` so it hydrates on any unknown URL. Don't use the SPA fallback: it would serve the homepage's prerendered markup at unknown URLs, the router would render a different page, and hydration would fail.
- **Custom domain:** add `"routes": [{ "pattern": "example.com", "custom_domain": true }]`, plus `www.example.com` if wanted. Set `"workers_dev": false` only if the user wants the `workers.dev` URL gone.

## 4. Client-only SPA

One `index.html`; the router renders every route in the browser.

```jsonc
	"assets": {
		"directory": "./dist",
		// The client router renders every route, so unknown URLs get index.html.
		"not_found_handling": "single-page-application"
	}
```

- Unmatched requests get `index.html` with **200**, including missing files like `/assets/old.js`. Mention this to the user; the app's own "not found" route is the only 404 users see.
- Deep links (`/settings/profile`) return 200, so verify one with `check-site.sh`.

## 5. Static site or SPA plus an API Worker

Server code (form submit, API calls, anything with secrets) runs in a Worker. Static files are still served by the asset layer without invoking it.

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "<worker-name>",
	"account_id": "<from wrangler whoami>",
	"main": "./worker/index.ts",
	"compatibility_date": "<from the workerd version>",
	"workers_dev": true,

	"assets": {
		"directory": "./dist",
		"binding": "ASSETS",
		// 404-page for a static site, single-page-application for an SPA
		"not_found_handling": "404-page",
		// Only these paths wake the Worker; everything else is served straight from the edge.
		"run_worker_first": ["/api/*"]
	},

	// So console.error from the Worker shows up in the dashboard.
	"observability": { "enabled": true }
}
```

Add `"vars": { … }` only when the Worker needs non-secret settings. Secrets go through `npx wrangler secret put <NAME>`, never into this file.

**`worker/index.ts`** (the pattern from the craftania project):

```ts
// Asset responses get these from _headers; Worker responses need them set here
const SECURITY_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'X-Frame-Options': 'DENY',
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === '/api/hello') {
			return Response.json({ ok: true }, { headers: SECURITY_HEADERS });
		}
		// Unknown API paths must 404 here; falling through to assets would serve the SPA's index.html with 200
		if (url.pathname.startsWith('/api/')) {
			return Response.json({ error: 'Not found' }, { status: 404, headers: SECURITY_HEADERS });
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
```

Leave out `SECURITY_HEADERS` if the user didn't choose security headers. With noindex chosen, add `'X-Robots-Tag': 'noindex'` too.

- **Types:**
  - `npx wrangler types` writes `worker-configuration.d.ts` at the project root, with `Env` (bindings, vars) and the runtime types. Commit it (Cloudflare's own templates do), and re-run `cf-typegen` after changing bindings or `compatibility_date`.
  - Give the worker its own `worker/tsconfig.json`, so the frontend's DOM types and the Workers runtime types don't mix:
    ```json
    {
    	"compilerOptions": {
    		"target": "ES2022",
    		"lib": ["ES2023"],
    		"module": "preserve",
    		"moduleResolution": "bundler",
    		"strict": true,
    		"noEmit": true,
    		"skipLibCheck": true,
    		"types": ["../worker-configuration.d.ts"]
    	},
    	"include": ["."]
    }
    ```
  - Add `cf-typegen` (`wrangler types`) and `typecheck:worker` (`tsc -p worker`) scripts.
  - If the project already uses `@cloudflare/workers-types` with a hand-written `Env` (like craftania), keep that.
- **Local secrets:** `.dev.vars` in `KEY=value` format, read by `wrangler dev` and gitignored. Commit `.dev.vars.example` with the names and placeholder values only.
- **Production secrets:** the user runs `npx wrangler secret put <NAME>` and types the value. They persist across deploys.
- **SPA plus API:** `run_worker_first: ["/api/*"]` matters. Without it, a browser navigation to `/api/...` would get `index.html`, because navigation requests prefer assets.
- **Local development** (the user picks in Step 2):
  - **Vite projects:** Cloudflare's `@cloudflare/vite-plugin` runs the Worker and the assets inside `vite dev`, using the same `wrangler.jsonc`. It's the closest match to production, and replaces any dev mock of the API.
  - **Otherwise:** keep the dev server and test the Worker with `npm run build && npm run preview`. If a dev mock of the API stays, say it can drift from the Worker.
  - Other dev servers can proxy `/api` to a running `wrangler dev`.

## 6. `_headers` templates

**Syntax:** a URL pattern on its own line, then indented `Name: value` lines. `#` starts a comment; keep comments on their own line above a block. Limits are 100 rules and 2,000 characters per line.

**What it covers:** headers apply to every asset response, including the 307 redirects, 404s and the SPA fallback. They don't apply to responses generated by a Worker script; set those in code. The `_headers` file itself isn't served.

**One block per pattern.** A second block with the same pattern (e.g. two `/*` blocks) silently replaces the first, even though Wrangler logs both as valid rules. Put every header for a pattern in one block.

```
# Security headers on every response
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
```

Keep search engines out until launch by adding `X-Robots-Tag: noindex` inside the same `/*` block, with a comment above the block saying to remove that line at launch. Don't add a robots.txt `Disallow` alongside it, or crawlers never see the `noindex`.

Long cache, only for directories whose filenames contain a content hash:

```
# Content-hashed files never change
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Hashed directories by framework: Vite `/assets/*`, Next.js `/_next/static/*`, Astro `/_astro/*`, Angular and CRA `/static/*` or the root (check the names). Never put `Cache-Control` under `/*`: values from several matching rules are joined with commas. Without a rule, assets get `public, max-age=0, must-revalidate` with an ETag, which is the right default for HTML.

## 7. 404 page per framework

| Framework | How |
|:--|:--|
| Next.js export | `app/not-found.tsx` (or `pages/404.tsx`) builds `out/404.html` |
| Astro | `src/pages/404.astro` |
| Vite multi-page / plain HTML | a `404.html` built to the output root (Vite: add it as a build input) |
| Prerendered React/Vue SPA | a catch-all route, prerendered to `<output>/404.html` |
| Eleventy / Hugo | `404.md` / `layouts/404.html` |

Use the site's existing header, footer and typography, with a short line of copy and a way home. Give it a `noindex` meta tag and a "Page not found" title.

## 8. Limits and gotchas

- **Asset limits:** up to 25 MiB per file, and 20,000 files on the free plan. Asset requests are free; only Worker invocations count.
- **Excluded from upload:** `_headers`, `_redirects` and `.assetsignore`. Use `_redirects` for moved URLs.
- **`compatibility_date` newer than the installed workerd:** Wrangler warns and falls back. Use the workerd version's date.
- **Missing Wrangler config:** `npx wrangler deploy` fails with "Missing entry-point". The config must be committed for Workers Builds.
- **Several Cloudflare accounts:** Wrangler prompts to pick one, unless `account_id` is set.
- **Moving a Cloudflare Pages project** (`pages_build_output_dir`, `functions/`) to Workers: port `functions/` to the Worker's `fetch` and `_routes.json` to `run_worker_first`. Ask before migrating; the user may want to keep Pages.
