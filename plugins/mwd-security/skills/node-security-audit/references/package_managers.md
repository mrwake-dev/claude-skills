# Package Manager Equivalents

The skill defaults to npm. When the project uses yarn, pnpm, or bun, swap the commands as below — the workflow and output format stay identical.

Detect the package manager by lockfile presence:
- `package-lock.json` or `npm-shrinkwrap.json` → npm
- `yarn.lock` → yarn
- `pnpm-lock.yaml` → pnpm
- `bun.lock` (or legacy binary `bun.lockb`) → bun

If multiple lockfiles are present, prefer the one most recently modified and warn the user that mixed lockfiles often cause inconsistent installs.

## Command equivalents

| Task | npm | yarn (classic, v1) | yarn (berry, v2+) | pnpm | bun |
|------|-----|--------------------|-------------------|------|-----|
| Audit | `npm audit --json` | `yarn audit --json` | `yarn npm audit --json` | `pnpm audit --json` | `bun audit --json` |
| Outdated | `npm outdated --json` | `yarn outdated --json` | `yarn outdated --json` (via plugin) | `pnpm outdated --format json` | `bun outdated` |
| Dependency tree | `npm ls --json --all` | `yarn list --json` | `yarn info --json` | `pnpm ls --json --depth=Infinity` | `bun pm ls --all` |
| Apply auto-fix | `npm audit fix` | `yarn upgrade <pkg>` | `yarn up <pkg>` | `pnpm update <pkg>` | `bun update <pkg>` (no `audit fix` yet) |
| Force major bump | `npm install <pkg>@latest` | `yarn upgrade <pkg>@latest` | `yarn up <pkg>@latest` | `pnpm update <pkg>@latest` | `bun update <pkg>@latest` or `bun update --latest` |

## Format differences

### yarn audit JSON

`yarn audit --json` outputs newline-delimited JSON — one object per line, ending with a summary object. Parse it as NDJSON, not a single JSON document. Each finding object has shape:

```json
{
  "type": "auditAdvisory",
  "data": {
    "advisory": { "module_name": "...", "severity": "...", "patched_versions": "..." },
    "resolution": { "id": 123, "path": "..." }
  }
}
```

### pnpm audit JSON

`pnpm audit --json` produces a single JSON document with `advisories` (keyed by ID) and `metadata`. Roughly compatible with the npm v6 audit format.

### bun audit JSON

`bun audit` (added in Bun v1.2.15) queries the same npm advisory API as `npm audit`, so the JSON shape from `bun audit --json` matches the npm v7+ audit format closely — top-level `vulnerabilities` keyed by package name, each with `severity`, `via`, `range`, and `fixAvailable`. The existing `parse_audit.js` script works on it without modification.

A few specifics worth noting:
- `bun audit` requires a `bun.lock` file. If only `bun.lockb` (legacy binary lockfile) exists, run `bun install --save-text-lockfile` once to migrate, or run `bun install` with a recent Bun version which will update the lockfile in place.
- `bun outdated` does not currently support a JSON flag — it prints a human-readable table. For machine-readable output, fall back to running `npm outdated --json` against the same `package.json` (npm reads `package.json`, not the lockfile, for outdated checks), or query the registry directly via the `check_deprecated.js` pattern.
- Bun has no `audit fix` command yet — recommend `bun update <pkg>` for compatible upgrades or `bun update --latest` for major bumps. Track upstream progress at oven-sh/bun#20238.

### yarn berry (v2+)

Yarn berry's PnP mode doesn't create a `node_modules` directory in the same way. `yarn npm audit` queries the npm registry directly. Outdated checking requires the `@yarnpkg/plugin-interactive-tools` plugin, or you can fall back to manual registry queries.

## Fix application differences

`npm audit fix` will modify `package.json` and `package-lock.json` automatically. Yarn and pnpm don't have an exact equivalent — you'll need to update each affected package explicitly.

When recommending fixes in the report, generate the appropriate command for the detected package manager:

- npm: `npm audit fix` or `npm install <pkg>@<version>`
- yarn classic: `yarn upgrade <pkg>@<version>`
- yarn berry: `yarn up <pkg>@<version>`
- pnpm: `pnpm update <pkg>@<version>`
- bun: `bun update <pkg>@<version>` (no auto-fix command yet — list each affected package explicitly)

## When the user has no preference

If you're starting fresh and the user asks "which should I use", that's outside the scope of this skill — answer based on general guidance, but the audit itself is identical in quality regardless of which tool they pick.
