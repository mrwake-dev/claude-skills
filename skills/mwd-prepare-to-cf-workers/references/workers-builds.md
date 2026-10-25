# Workers Builds (Cloudflare's Git integration)

Cloudflare clones the repo on every push, installs dependencies, runs the build command, then the deploy command. The user connects it in the dashboard; nothing in the repo or GitHub secrets is needed for the deploy itself.

## Settings to give the user

The repo must be on GitHub or GitLab with the Wrangler config pushed. Then the user sets these in the Cloudflare dashboard (Workers & Pages → the Worker → Settings → Builds), connecting the repo first:

| Setting | Value |
|:--|:--|
| Git repository | the project's repo |
| Production branch | `main` (or the repo's default) |
| Build command | the project's build, e.g. `npm run build` (see the private-registry variant below); empty when there is no build step |
| Deploy command | `npx wrangler deploy` (default) |
| Non-production branch deploy command | default `npx wrangler preview`, which gives each branch a preview. Leave it, or turn non-production builds off if the user doesn't want previews |
| Root directory | the package folder, for monorepos; otherwise empty |

Other points to pass on:
- **The Worker name in the dashboard must equal `name` in `wrangler.jsonc`**, or the deploy fails ("The name in your Wrangler configuration file must match the name of your Worker"). Connecting the repo to the Worker the first deploy created satisfies this.
- **Node version:** from `.nvmrc` or `.node-version`, or a `NODE_VERSION` build variable. The default is Node 24.
- **Other versions:** set them with build variables `PNPM_VERSION`, `YARN_VERSION` or `BUN_VERSION`.
- **Build variables exist only during the build**, not at runtime. Runtime secrets are separate (`wrangler secret put`).
- **Builds time out after 20 minutes.**
- **Each build reports as a check on the commit in GitHub,** with a link to its log.

## Private registries (e.g. `@mrwake-dev` on GitHub Packages)

If `.npmrc` maps a scope to a registry that needs auth (`@scope:registry=https://npm.pkg.github.com`), Cloudflare's automatic install fails with **401 Unauthorized**. GitHub Packages needs a token even for public packages. Confirm before telling the user by fetching the package with an empty user config:

```bash
d=$(mktemp -d) && cp .npmrc "$d/" && (cd "$d" && : > u && npm view <@scope/package> version --userconfig="$d/u"); rm -rf "$d"
```

A `401` confirms it. The fix keeps the repo unchanged. Never write `${NPM_TOKEN}` into the project `.npmrc`: it would override the developer's own token locally and break local installs.

| Build variable | Value |
|:--|:--|
| `SKIP_DEPENDENCY_INSTALL` | `1` |
| `NPM_TOKEN` (**secret**) | a GitHub personal access token (classic) with the `read:packages` scope, which the user creates |

Build command, with the package manager and build script adjusted to the project:

```bash
npm config set //npm.pkg.github.com/:_authToken=$NPM_TOKEN && npm ci && npm run build
```

`npm config set` writes to the build machine's user config, so the token never touches the repo.

## GitHub Actions alongside Workers Builds

Keep the workflow as checks only (lint, typecheck, build, tests). Don't add a deploy job or `CLOUDFLARE_API_TOKEN`: Workers Builds deploys, and a second deployer would race it. If the tests run `wrangler dev`, add `WRANGLER_SEND_METRICS: false` to the workflow `env`. Wrangler also runs fine after `npm ci --ignore-scripts`, because workerd and esbuild find their platform binaries without their postinstall scripts.

## Troubleshooting

| Build log says | Cause | Fix |
|:--|:--|:--|
| `401 Unauthorized` during install | private registry | the section above |
| `Missing entry-point` | `wrangler.jsonc` isn't in the pushed commit, or has no `assets` / `main` | commit the config |
| `The name in your Wrangler configuration file … must match` | dashboard Worker name ≠ `name` | rename one of them |
| `Could not route to /client/v4/accounts/<id>/…` | `account_id` in the config belongs to a different account than the connected one | fix `account_id` |
| `The build token selected for this build has been deleted or rolled` | the API token Cloudflare generated for builds was removed | pick or create a new token in the build settings |
| Unsupported engine / syntax errors | Node version | `.nvmrc` or `NODE_VERSION` |
