# npm, yarn, pnpm, bun

Dependabot files every JavaScript package manager under the `npm` ecosystem, and its `manifest_path`
is usually the **lockfile** (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), not `package.json`.
The `package.json` to edit is the one next to it — or, in a workspace, the one that declares the
dependency.

## Pick the package manager

| Lockfile | Manager | Install | Refresh one transitive package | Show copies and parents |
|:---------|:--------|:--------|:-------------------------------|:------------------------|
| `package-lock.json` / `npm-shrinkwrap.json` | npm | `npm install` | `npm update <pkg>` | `npm ls <pkg> --all`, `npm explain <pkg>` |
| `yarn.lock` + `.yarnrc.yml` | yarn 2+ (Berry) | `yarn install` | `yarn up -R <pkg>` | `yarn why <pkg>` |
| `yarn.lock` alone | yarn 1 (classic) | `yarn install` | see below | `yarn why <pkg>` |
| `pnpm-lock.yaml` | pnpm | `pnpm install` | `pnpm update <pkg>` | `pnpm why <pkg>` |
| `bun.lock` / `bun.lockb` | bun | `bun install` | `bun update <pkg>` | `bun pm ls --all` |

Install with `npm install`, not `npm ci`: `ci` refuses a lockfile that no longer matches `package.json`
and never writes one. Using a different manager than the lockfile's replaces the lockfile format
entirely — a far bigger diff than the fix.

yarn classic has no command that re-resolves one transitive package. Delete that package's entries
from `yarn.lock` (the block whose header starts with `<pkg>@`) and run `yarn install`; yarn
re-resolves only what is missing. It is the one lockfile hand edit this skill allows.

## Find the copies and their parents

`npm ls` and `npm explain` read `node_modules`. Without it, read `package-lock.json` (v2/v3) directly:

```bash
PKG="<package-name>"
# Every installed copy: path in the tree, version, dev or prod
"$JQ" -r --arg p "$PKG" '.packages | to_entries[]
  | select(.key == "node_modules/" + $p or (.key | endswith("/node_modules/" + $p)))
  | "\(.key)\t\(.value.version)\t\(if .value.dev then "dev" else "prod" end)"' package-lock.json

# Every parent that asks for it, with the range it asks for ("" is the root project)
"$JQ" -r --arg p "$PKG" '.packages | to_entries[]
  | ((.value.dependencies // {}) + (.value.devDependencies // {}) + (.value.optionalDependencies // {})) as $deps
  | select($deps[$p]) | "\(.key)\t\(.value.version // "-")\t\($deps[$p])"' package-lock.json
```

Only the root (`""`) and workspace entries carry `devDependencies` in the lockfile, so a key of `""`
or a workspace path means **direct**; anything under `node_modules/` is a transitive parent. The copy
`node_modules/a/node_modules/<pkg>` belongs to parent `a`; a top-level `node_modules/<pkg>` is shared
by every parent whose range it satisfies.

**Lockfile refresh or not:** if every parent of a vulnerable copy asks for a range that admits the
target (`^1.1.7` admits `1.1.21`), a refresh fixes it. If one asks for less (`~1.1.7` does not admit
`1.2.0`, an exact `1.1.11` admits nothing newer), that parent needs a bump or the copy needs a pin.

## Range bump (direct dependency)

Install the exact target with the package manager. Never hand-edit the range and run a bare install,
which resolves the newest version the new range allows instead:

| Manager | Command | Keeping the operator |
|:--------|:--------|:---------------------|
| npm | `npm install <pkg>@<target>` | saves `^` by default; `--save-prefix=~` for `~`, `--save-exact` for exact |
| yarn | `yarn add <pkg>@<target>` | `--tilde` / `--exact` |
| pnpm | `pnpm add <pkg>@<target>` | `--save-exact`; for `~`, fix the operator by hand afterwards |
| bun | `bun add <pkg>@<target>` | `--exact`; for `~`, fix the operator by hand afterwards |

npm keeps a package in the section it is already in. With yarn, pnpm and bun, pass the section flag
yourself (`-D` for `devDependencies`, the optional flag for `optionalDependencies`); without it the
package can land in `dependencies`. Fixing an operator by hand afterwards is safe: the lockfile already holds the
target, which satisfies the new range, so the next install keeps it.

The result keeps the existing operator, with the target as its floor:

| Before | Target | After |
|:-------|:-------|:------|
| `^16.1.0` | 16.3.8 | `^16.3.8` |
| `~4.17.20` | 4.17.21 | `~4.17.21` |
| `4.17.20` | 4.17.21 | `4.17.21` |

Raising the floor rather than only refreshing the lockfile records the minimum safe version, so a
later re-resolve cannot land back on a vulnerable one.

In a **library**, leave `peerDependencies` ranges alone — narrowing them pushes the upgrade onto every
consumer. Bump the matching `devDependencies` entry the library tests against instead.

In a **workspace**, edit the `package.json` of the workspace that declares the package and install
from the root that holds the lockfile.

## Parent bump

When the parent is a direct dependency, find the lowest release whose own range admits the target:

```bash
npm view <parent>@">=<installed-parent-version>" dependencies.<pkg>
```

It prints one line per matching release with the range it declares. Two cases it cannot see:

- **A chain** — the copy's parent is itself transitive (`wrangler` → `miniflare` → `sharp`). The bump
  happens at the direct dependency on top, so you need to know which of its releases pull in a fixed
  copy two levels down.
- **Prereleases** — a range in `npm view` skips versions like `5.20260910.0-alpha`, and some lines
  publish nothing else (every `miniflare` 5.x release is a prerelease).

For both, download each package's registry document once and join them with jq:

```bash
REG="$WORK/registry"; mkdir -p "$REG"
curl -s "https://registry.npmjs.org/<direct-parent>" -o "$REG/top.json"
curl -s "https://registry.npmjs.org/<middle>" -o "$REG/mid.json"

"$JQ" -r --slurpfile mid "$REG/mid.json" --arg from "<installed-direct-version>" '
  def ver: split("-")[0] | split(".") | map(tonumber? // 0);
  .versions | to_entries[]
  | select(.key | test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))
  | select((.key | ver) >= ($from | ver))
  | .value.dependencies["<middle>"] as $m
  | "\(.key)\t<middle> \($m)\t<pkg> \($mid[0].versions[$m].dependencies["<pkg>"] // "-")"
' "$REG/top.json" | sort -V
```

Scoped names are URL-encoded in the registry URL (`@scope%2Fname`). The first row whose `<pkg>`
clears the vetted target is the bump target — in testing, `wrangler` 4.149.0, whose `miniflare` pins
`sharp` 0.35.5. Vet that parent release too, with the advisory check from SKILL.md Step 4.

The join reads `$mid[0].versions[$m]`, so it needs the middle link to be an exact version — the usual
reason a refresh could not fix the copy. When the middle link is a range, try `npm update <middle>`
first: a newer middle inside that range may already carry the fix.

On a private registry, take the base URL from `npm config get registry` (or
`npm config get @scope:registry`). `curl` sends no credentials, so if the registry needs auth, fall back
to `npm view <pkg>@<exact-version> dependencies --json`, one release at a time.

Recommend the bump when it is a patch or minor of the direct dependency — `wrangler` `^4.123.0` →
`^4.149.0` stays inside its own range. Recommend a pin when the bump needs a major or no release
carries the fix yet.

## Pin

Pins go in the **root** `package.json`:

| Manager | Field | Example |
|:--------|:------|:--------|
| npm ≥ 8.3 | `overrides` | `"overrides": { "postcss": "^8.5.23" }` |
| yarn | `resolutions` | `"resolutions": { "postcss": "^8.5.23" }` |
| pnpm ≤ 9 | `pnpm.overrides` | `"pnpm": { "overrides": { "postcss": "^8.5.23" } }` |
| pnpm 10+ | `overrides` in `pnpm-workspace.yaml` | `overrides:` → `postcss: ^8.5.23` |
| bun | `overrides` | as npm |

- **Pin to a range on the copy's own major** (`^8.5.23`), not an exact version — later patches still
  flow, and the parent keeps the version line it was written against. On a `0.x` package the minor
  is the major: `^0.34.5` does not admit 0.35.0, so a pin from 0.34 to 0.35 is breaking and goes into
  the question as a major.
- **Several copies on different majors:** a bare `"<pkg>": "..."` pin forces every copy onto one
  version and breaks the parents that need the other major. Scope it instead:
  - npm and bun — nest it under the parent: `"overrides": { "minimatch": { "brace-expansion": "^1.1.21" } }`
  - pnpm — a version selector in the key: `"brace-expansion@1": "^1.1.21"`
  - yarn classic — a path key: `"minimatch/brace-expansion": "^1.1.21"`
  - yarn Berry — a descriptor key with the range the parent asks for: `"brace-expansion@npm:^1.1.7": "^1.1.21"`
- **Never pin a direct dependency** — do a range bump. npm rejects an override for a package the
  project depends on directly unless the specs match exactly (or the override is a `"$<pkg>"`
  reference), and a bump says the same thing more plainly.

After the install, re-run the copy lookup. npm sometimes keeps an existing lockfile entry despite a
new override. If the old version is still there, report the pin as **not applied** and ask before
anything more invasive — never delete the lockfile to force it.

## Engines

Before offering a target, check that it still runs on the project's Node:

```bash
npm view <pkg>@<target> engines
```

Compare it with `engines.node` in `package.json` and with `.nvmrc`. A target that needs a newer Node
goes into the decision question's description, not into a failed install.

## Audit cross-check

After the install, list the advisories the tree still has that no open alert covers:

```bash
"$JQ" -r '.ghsa' "$WORK/alerts.jsonl" | sort -u > "$WORK/alert-ghsas.txt"
npm audit --json | "$JQ" -r '[.vulnerabilities[].via[] | objects
    | {ghsa: (.url | split("/") | last), name, severity, range}] | unique[]
  | "\(.ghsa)\t\(.name)\t\(.severity)\t\(.range)"' | grep -v -F -f "$WORK/alert-ghsas.txt"
```

Compare by GHSA, not by package: a package can have open alerts and still carry a newer advisory that
none of them covers. Get each row's fixed version from the advisory check in SKILL.md Step 4. The other
managers' audits: `yarn audit --json` (yarn 1), `yarn npm audit --all --recursive --json` (yarn 2+),
`pnpm audit --json`, `bun audit --json`. Their output shapes differ from npm's, so adapt the jq.
