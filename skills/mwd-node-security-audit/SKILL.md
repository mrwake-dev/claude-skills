---
name: mwd-node-security-audit
disable-model-invocation: true
description: Audit a Node.js project's dependencies for security vulnerabilities, outdated packages, deprecated packages, peer dependency conflicts, and Node.js engine compatibility issues. Use this skill whenever the user mentions auditing a package.json, checking for vulnerabilities, finding outdated dependencies, running npm audit, upgrading packages, dependency health, security issues in node_modules, or anything related to evaluating the state of a JavaScript/TypeScript project's dependencies — even if they don't explicitly ask for an "audit". Produces a prioritized upgrade table and a written Markdown report.
---

# Dependency Audit

Comprehensively audit a Node.js project: find vulnerabilities, outdated and deprecated packages, peer dependency conflicts, and Node.js engine mismatches. Produce a prioritized upgrade plan as both an inline summary table and a Markdown report file.

## When to use this skill

Trigger this skill when the user wants to evaluate the health of dependencies in a `package.json` — whether they ask for a "security audit", "dependency check", "what should I upgrade", "is this project safe", or hand over a project and ask "what's the state of this codebase". This skill is the right tool any time the answer involves running `npm audit`, `npm outdated`, or comparing installed versions against the registry.

## Requirements

This skill needs the following to run:

- **Shell execution** — to run `npm`/`yarn`/`pnpm`/`bun` commands and the helper scripts in `scripts/`. In Claude Code this means `Bash` is allowed; in Claude.ai or Cowork the equivalent code execution tool must be available.
- **File read/write** — to read `package.json` and lockfiles, and to write the final Markdown report.
- **Node.js ≥ 18** in the execution environment — required to run `check_deprecated.js` and `parse_audit.js`. Most environments that have `npm` installed already meet this.
- **The relevant package manager** installed and on `PATH` — `npm` for npm projects, `yarn` for yarn projects, etc. The skill detects which one based on the lockfile.
- **Network access to the npm registry** (`registry.npmjs.org`) — used by `npm audit`, `npm outdated`, and the deprecated-package check. If the environment has restricted network access, allowlist `registry.npmjs.org`. Without it, `npm audit` falls back to limited offline data and the deprecated check fails outright.
- **An installed `node_modules` directory is strongly recommended** — without it, `npm audit` and `npm outdated` produce minimal output. If it's missing, the skill offers to run `npm install` (or the equivalent) first.

If any of these aren't available, surface the limitation in the report rather than silently producing an incomplete audit.

## Running the helper scripts

This skill ships with three helper scripts in its `scripts/` directory. They live next to this `SKILL.md` file in the skill's installation directory — **not** in the user's project directory. Before invoking any script, determine the skill directory and use the absolute path.

A reliable way to find the skill directory:

```bash
# If you're reading SKILL.md via a known path, use its directory:
SKILL_DIR="$(dirname "<path-to-this-SKILL.md>")"

# Or, if the skill was installed under a known root:
#   /mnt/skills/<name>, ~/.claude/skills/<name>, etc.
```

Then invoke scripts via interpreter, with the absolute path:

```bash
bash "$SKILL_DIR/scripts/run_audit.sh" <project-dir> <output-dir>
node "$SKILL_DIR/scripts/check_deprecated.js" <path-to-package.json>
node "$SKILL_DIR/scripts/parse_audit.js" <audit.json> [outdated.json]
```

**Common mistake:** running `./scripts/run_audit.sh` from the user's project directory. The user's project doesn't contain these scripts — they're part of the skill. If a script "doesn't exist", it almost certainly means you're looking in the wrong directory; check the skill directory before falling back to manual queries.

## Inputs

The user typically provides one of:
- A path to a project directory containing `package.json` (and ideally `package-lock.json`)
- A `package.json` file alone
- A repo they've uploaded

Always start by locating `package.json`. If only `package.json` is provided without a lockfile, mention this in the report — `npm audit` results are most accurate with a lockfile present.

## Workflow

Run the workflow in this order. Each step is independent — if one fails (e.g., the registry is unreachable), continue with the others and note the failure in the report.

### Step 1: Inspect the project

Read `package.json` to gather:
- Project name and version
- Declared `engines.node` (and `engines.npm` if present)
- Direct `dependencies` and `devDependencies` counts
- Whether `package-lock.json` or `npm-shrinkwrap.json` exists

This context goes into the report header and helps interpret later results.

### Step 2: Run the audits

Run these commands from the project directory. Capture JSON output where available — it's far easier to parse than human-readable output. The helper script at `$SKILL_DIR/scripts/run_audit.sh` runs all of them in sequence and writes results to a temp directory (see "Running the helper scripts" above for how to resolve `$SKILL_DIR`).

```bash
# Vulnerabilities (requires lockfile)
npm audit --json > audit.json 2>/dev/null || true

# Outdated packages (compares installed vs latest)
npm outdated --json > outdated.json 2>/dev/null || true

# Peer dependency issues — install with dry-run to surface conflicts
# without actually modifying node_modules
npm install --dry-run --json > install.json 2>/dev/null || true

# Deprecated packages — extract from `npm ls` warnings or query registry
npm ls --json --all > tree.json 2>/dev/null || true
```

`npm audit` and `npm outdated` exit non-zero when they find issues, so always use `|| true` or capture exit codes separately. A non-zero exit is information, not an error.

If `node_modules` doesn't exist, suggest the user run `npm install` first — without it, `npm audit` and `npm outdated` produce limited or no output. Offer to run it for them.

### Step 3: Detect deprecated packages

`npm outdated --json` doesn't flag deprecation. To find deprecated packages, query the npm registry for each direct dependency or parse `npm install --dry-run` output for "deprecated" warnings. The script `$SKILL_DIR/scripts/check_deprecated.js` handles this — it reads `package.json`, queries `https://registry.npmjs.org/<package>`, and reports any package whose latest version (or installed version) has a `deprecated` field.

### Step 4: Check Node.js engine compatibility

Compare `engines.node` from `package.json` against:
- The currently running Node version (`node --version`)
- The Node version requirements of the latest versions of major dependencies (when proposing upgrades)

If an upgrade requires a newer Node than the project declares, flag it — this is the "Node.js upgrade required" signal the user wants. Common patterns: ESLint 9 requires Node ≥18.18, Vite 5+ requires Node ≥18, etc.

### Step 5: Classify and prioritize

For every issue found, assign a **priority** based on this rubric:

| Priority | Criteria |
|----------|----------|
| **Critical** | Critical or High CVSS vulnerability, OR deprecated package with no maintained alternative, OR security advisory with known exploit |
| **High** | Moderate CVSS vulnerability, OR major version behind on a security-sensitive package (auth, crypto, network), OR deprecated package with a clear successor |
| **Medium** | Low CVSS vulnerability, OR major version behind on a non-sensitive package, OR peer dependency conflict |
| **Low** | Minor/patch version behind, OR cosmetic warnings |

Within each priority, sort by ease of upgrade (patch < minor < major) so the user can knock out quick wins first.

### Step 6: Determine upgrade paths

For each outdated package, identify three version targets from `npm outdated`:
- **Wanted**: the version satisfying the current semver range in `package.json` — usually a safe `npm update` target
- **Latest**: the newest published version — may require a major version bump
- **Recommended**: your judgment call. Default to "Wanted" for direct upgrades, "Latest" when the wanted version still has an unfixed vulnerability or is itself deprecated. Note breaking changes for major bumps.

For vulnerabilities, prefer the version `npm audit` reports as the fix (`fixAvailable.version`).

### Step 7: Produce the output

Always produce **both**:
1. **An inline summary table** in the chat — see "Output format" below
2. **A Markdown report file** saved to `dependency-audit-report.md` (or `<project-name>-audit.md` if a project name is available) in the current working directory

Use the `present_files` tool to surface the Markdown report so the user can download it.

## Output format

### Inline summary table

Lead with a one-line verdict ("3 critical issues, 12 packages outdated, Node 20 upgrade recommended"). Then this table:

```
| Priority | Package | Issue | Current | Recommended | Notes |
|----------|---------|-------|---------|-------------|-------|
| Critical | lodash  | CVE-2021-23337 (High) | 4.17.20 | 4.17.21 | Patch — safe upgrade |
| High     | express | 1 major behind | 4.18.2 | 5.0.1 | Breaking: see migration guide |
| Medium   | eslint  | Deprecated config format | 8.57.0 | 9.17.0 | Requires Node ≥18.18 |
```

Keep the table to roughly 10–15 most important rows. If there are more, mention the count and refer to the full report.

If a Node.js upgrade is required for any recommended upgrade, add a clearly marked section directly under the table:

```
**⚠ Node.js upgrade required**
Project declares: `engines.node: ">=16"`
Recommended:      Node 20 LTS or later
Triggered by:     eslint 9.x (≥18.18), vite 5.x (≥18)
```

### Markdown report file

The full Markdown report uses this structure:

```markdown
# Dependency Audit — <project-name>

_Generated: <ISO date>_

## Summary
- <N> vulnerabilities (X critical, Y high, Z moderate, W low)
- <N> outdated direct dependencies
- <N> deprecated packages
- <N> peer dependency conflicts
- Node.js: declared <range>, current <version>, recommended <version>

## Recommended action plan
<numbered list of grouped actions, e.g.>
1. Patch security issues (run `npm audit fix` — covers 5 of 7 vulnerabilities)
2. Upgrade ESLint to v9 (requires Node 18.18+)
3. Replace deprecated `request` with `undici` or `node-fetch`

## Full upgrade table
<the same table as inline, but with all rows>

## Vulnerabilities (detailed)
<for each vulnerability: package, severity, CVE, affected versions, fixed in, path>

## Deprecated packages
<for each: package, deprecation message, suggested replacement>

## Node.js compatibility
<engines.node analysis, which upgrades require what Node version>

## Peer dependency conflicts
<output of npm install --dry-run if conflicts exist>

## Notes
<lockfile presence, audit limitations, any commands that failed>
```

Stay factual and concise. Don't pad with generic advice ("always keep dependencies up to date") — the user wants specifics about *their* project.

## Common pitfalls

- **No lockfile** → `npm audit` returns minimal data. Note this clearly; don't pretend the audit was thorough.
- **`node_modules` missing** → most commands return nothing useful. Run `npm install` first or tell the user to.
- **Monorepos (workspaces)** → run audits at the root; the helper script handles this. For per-workspace reports, run separately in each.
- **Yarn, pnpm, or bun projects** → detect by checking for `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock`/`bun.lockb`. Adjust commands: `yarn audit --json`, `pnpm audit --json`, `bun audit --json`, etc. The principles are identical — see `references/package_managers.md` for the full mapping.
- **Private registries** → some packages may 404 against the public npm registry. Note these as "unable to verify" rather than treating them as deprecated.
- **Unfixable vulnerabilities** → if a vulnerability has no patched version, recommend the workaround (replace the package, pin a transitive dependency via `overrides`, accept the risk with documentation).

## Reference files

- `scripts/run_audit.sh` — runs all audit commands and dumps JSON to a directory
- `scripts/check_deprecated.js` — queries the npm registry to find deprecated packages
- `scripts/parse_audit.js` — parses npm audit JSON into a normalized issue list
- `references/severity_rubric.md` — extended priority/severity classification guidance with examples
- `references/package_managers.md` — equivalent commands for yarn and pnpm
