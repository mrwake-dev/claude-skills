---
name: fix-dependabot-alerts
description: Read the open Dependabot alerts of the current GitHub repository (via gh), check each one against the local lockfile, group the vulnerable packages by severity, let the user pick which groups to fix and decide every risky upgrade (major bumps, transitive pins), then update package.json / pom.xml / build.gradle, refresh the lockfile, and verify with the project's own build and tests. Fixes npm, yarn, pnpm, bun, Maven and Gradle dependencies; lists other ecosystems without touching them. Never commits, pushes, or writes to GitHub. Use when the user asks to fix, patch, resolve or work through Dependabot alerts or GitHub dependency security alerts.
disable-model-invocation: true
---

# Fix Dependabot Alerts

Read every open Dependabot alert of the GitHub repository behind the current checkout, **check each
one against the local lockfile**, group what is still vulnerable by severity, and let the user choose
which groups to fix. Upgrades that need judgment — a major version, a pin on a transitive dependency
— get their own question. Then edit the manifests, refresh the lockfile, and prove the result with the
project's own checks.

> **Never commit, stage, or push, and never write to GitHub.** The skill only edits manifests and
> lockfiles in the working tree. No `git add` / `commit` / `push` / `stash` / `checkout`, no dismissing
> alerts, no PRs, no comments. The user reviews the diff and commits; Dependabot closes the alerts by
> itself once the fix reaches the default branch.

Throughout this document, **an alert** is one Dependabot alert (`#36`), and **a fix item** is one
vulnerable package in one manifest with all of its alerts collapsed together — the unit the user
actually upgrades. One package often carries many alerts (a single `next` bump can close fifteen), so
the user decides per package, not per alert.

**Tooling (PATH safety):** each bash block runs in a fresh, minimally-initialized shell, so resolve
tools up front and fail fast:

```bash
GH="$(command -v gh || echo /opt/homebrew/bin/gh)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GH" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done
```

`npm`/`pnpm`/`yarn`/`mvn` often come from a version manager (nvm, corepack, sdkman) a non-login shell
has not initialised — resolve them the same way. If the user's or the project's instructions say how
to run the package manager here (a wrapper command, a Node version from `.nvmrc`, a registry login),
follow them for **every** install in this run.

## Step 1: Preflight

```bash
"$GH" repo view --json nameWithOwner,defaultBranchRef -q '.nameWithOwner + " " + .defaultBranchRef.name'
git rev-parse --abbrev-ref HEAD
git status --short
```

- **Repository.** If `gh` cannot resolve the repo (several remotes, a fork), show `git remote -v` and
  ask which one holds the alerts. Do not guess — a fork usually has none of its upstream's alerts.
- **Branch.** Alerts describe the default branch as GitHub last scanned it. On another branch, say so
  and continue; Step 4 drops alerts the local tree has already fixed or does not contain.
- **Dirty manifests.** If a manifest or lockfile the alerts point at already has uncommitted changes,
  stop and ask. Mixing the user's edits with the upgrades makes both hard to review.
- **Toolchain.** Pick the package manager from the lockfile (`references/npm.md`) or the build file
  (`references/maven-gradle.md`), and note whether `node_modules` exists.

## Step 2: Fetch the alerts

```bash
REPO="<owner/repo>"
WORK="${TMPDIR:-/tmp}/mwd-fix-dependabot-alerts/${REPO//\//-}"
mkdir -p "$WORK"
"$GH" api --paginate "repos/$REPO/dependabot/alerts?state=open&per_page=100" \
  --jq '.[] | {number, url: .html_url,
      severity: .security_advisory.severity,
      ghsa: .security_advisory.ghsa_id, cve: .security_advisory.cve_id,
      summary: .security_advisory.summary,
      withdrawn: (.security_advisory.withdrawn_at != null),
      epss: .security_advisory.epss.percentile,
      ecosystem: .dependency.package.ecosystem, package: .dependency.package.name,
      manifest: .dependency.manifest_path, scope: .dependency.scope,
      relationship: .dependency.relationship,
      range: .security_vulnerability.vulnerable_version_range,
      patched: .security_vulnerability.first_patched_version.identifier}' \
  > "$WORK/alerts.jsonl" || { cat "$WORK/alerts.jsonl"; exit 1; }
wc -l < "$WORK/alerts.jsonl"

# Open Dependabot PRs — an alert may already have a ready-made fix waiting for review
"$GH" pr list -R "$REPO" --author app/dependabot --state open --json number,title,url --limit 100
```

On failure `gh` writes the error body into the output file, hence the `cat`:

| Response | Meaning | What to do |
|:---------|:--------|:-----------|
| 403 `Dependabot alerts are disabled for this repository` | the feature is off | tell the user to enable it under **Settings → Code security**, and stop. `gh` also prints a "needs the admin:repo_hook scope" hint here — ignore it; the `repo` scope is enough |
| 403 other / 404 | no security access to this repo, or wrong repo | a classic token needs `repo` (or `security_events`), a fine-grained one needs **Dependabot alerts: read**; the user needs write, maintain or admin on the repo |
| empty file | no open alerts | say so and stop |

## Step 3: Group the alerts into fix items

```bash
"$JQ" -s '
  def rank: {"critical": 4, "high": 3, "medium": 2, "low": 1}[.] // 0;
  group_by([.ecosystem, .manifest, .package])
  | map({ecosystem: .[0].ecosystem, manifest: .[0].manifest, package: .[0].package,
         relationship: .[0].relationship,
         scope: (map(.scope) | unique),
         severity: (map(.severity) | max_by(rank)),
         epss: (map(.epss // 0) | max),
         alerts: map({number, severity, range, patched, withdrawn, ghsa, cve, summary})})
  | sort_by(-(.severity | rank), (if (.scope | index("runtime")) then 0 else 1 end), -.epss)
' "$WORK/alerts.jsonl" > "$WORK/items.json"
"$JQ" -c '.[] | {package, manifest, severity, relationship, scope, alerts: (.alerts | length)}' "$WORK/items.json"
```

A fix item takes the **highest** severity among its alerts — one `next` bump that closes a critical
alert belongs in Critical even if most of its alerts are medium. Within a group, runtime comes before
development and a higher EPSS (the advisory's exploit probability) before a lower one.

Set aside what the skill cannot fix. These are reported, never offered as choices:

- **Withdrawn advisories** (`withdrawn: true`) — GitHub retracted them. Drop those alerts from their
  item and recompute its severity without them; if nothing is left, report the item as "advisory
  withdrawn — dismiss as inaccurate on GitHub".
- **No patched version** (`patched: null`) — no upgrade closes that alert. Report it with the
  realistic options: replace the package, or accept the risk with a written reason. The item's other
  alerts stay fixable; set the item aside only when none of them has a patch.
- **Other ecosystems** — anything but `npm` and `maven` (Dependabot files Gradle packages under
  `maven` too; the manifest path tells them apart). Count them per ecosystem in the overview.

## Step 4: Check each item against the local checkout

For every remaining fix item, find the copies actually resolved in the local lockfile or build — the
commands are in `references/npm.md` and `references/maven-gradle.md`. Each copy ends up as one of:

- **Already patched locally** — its version is outside every vulnerable range. Drop it and note it;
  the alert closes when this branch merges.
- **Not in the local tree** — the manifest or package is gone on this branch. Drop it and note it.
- **Vulnerable** — choose a fix path and a target version.

**Target version:** start from the lowest patched version that is at or above the installed copy and
outside **every** vulnerable range the copy falls into — not the latest release. The smallest move is
the least likely to break anything. When copies sit on different major lines (`brace-expansion` 1.x
and 5.x), each copy gets its own target on its own line: a parent written against 1.x was never
tested with 5.x.

Then **vet every candidate against the GitHub Advisory Database**. Alerts lag behind it: an advisory
published after Dependabot's last scan, or one it never raised, is missing from Step 2. In testing,
three `next` advisories — two of them critical — were in the database two days before any alert
existed, so the alerts' 16.3.8 was still vulnerable. One call checks all candidates of an ecosystem:

```bash
"$GH" api --paginate "advisories?ecosystem=<npm|maven>&affects=<pkg>@<candidate>,<pkg>@<candidate>&per_page=100" \
  --jq '.[] | select(.withdrawn_at == null) | .ghsa_id as $id | .severity as $sev
        | .vulnerabilities[] | "\(.package.name)\t\($id)\t\($sev)\t\(.vulnerable_version_range)\t\(.first_patched_version // "none")"'
```

The response does not say which queried version matched, and one advisory can list several packages
and ranges. Keep the rows whose package you asked about and whose range contains that candidate. For
each hit, raise the candidate to the patched version on the same line and check again, until nothing
comes back. For `next` 16.2.10 the alerts point to 16.3.8, the database adds three advisories fixed in
16.4.1, and the target becomes 16.4.1. A clean version that needs a new major turns the item into a
**major upgrade**, and a hit with no patched version goes to the overview as not fixable. Name the
advisories that raised a target in the overview's Note, so the user sees why it is above the alerts.

**Fix path:**

| Path | When | Asks the user? |
|:-----|:-----|:---------------|
| **Range bump** | a direct dependency, and the target stays on the major of its declared range | no — the group pick covers it |
| **Lockfile refresh** | a transitive dependency, and every parent's declared range already admits the target | no |
| **Major upgrade** | a direct dependency whose target needs a new major (or a new minor of a `0.x`) | yes |
| **Parent bump or pin** | a transitive dependency some parent's range keeps below the target | yes |

**Overlapping fixes.** A direct bump often moves transitive packages with it: bumping `next` 16.2.10 →
16.3.8 also moves its exact-pinned `postcss` 8.4.31 → 8.5.23 and its `sharp` range to `^0.35.4`.
Before giving a transitive item its own path, check whether another item's target for one of its
parents already admits the fix (`npm view <parent>@<target> dependencies.<pkg>`, or the BOM / parent
pom for Maven). If it does, mark the item **via `<parent>` bump**. When the parent's group is
selected, the item rides along with no question of its own. When it is not, the item keeps its own
path, and the same parent bump becomes one of its options.

If a Dependabot PR from Step 2 already bumps the package, attach it to the item. Merging it may be the
simpler fix, and the user should know before choosing.

## Step 5: Pick the groups

Show the overview, one row per vulnerable copy, grouped by severity. Add a Manifest column when the
alerts span more than one manifest (a monorepo, a `docs/` site with its own lockfile):

```
<owner/repo> — 35 open alerts → 11 fix items (npm). Default branch main, local main.

| Group    | Package         | Alerts | Scope   | Path              | Installed → Target | Note                                                  |
|----------|-----------------|--------|---------|-------------------|--------------------|-------------------------------------------------------|
| Critical | next            | 15     | runtime | range bump        | 16.2.10 → 16.4.1   | alerts say 16.3.8; 3 newer advisories · Dependabot PR #41 |
| High     | postcss         | 4      | runtime | via next bump     | 8.4.31 → 8.5.23    | next pins it exactly                                  |
| High     | nanoid          | 1      | runtime | lockfile refresh  | 3.3.16 → 3.3.18    |                                                       |
| High     | sharp           | 2      | dev     | parent bump / pin | 0.35.2 → 0.35.5    | miniflare pins it exactly; alerts say 0.35.4          |
| High     | brace-expansion | 5      | dev     | lockfile refresh  | 1.1.16 → 1.1.21    | copy on the 1.x line                                  |
| High     | brace-expansion |        | dev     | lockfile refresh  | 5.0.7 → 5.0.12     | copy on the 5.x line; alerts say 5.0.9                |
| …        |                 |        |         |                   |                    |                                                       |

Not fixable here: braces (#36) — advisory withdrawn · <pkg> (#n) — no patched version
Already patched locally: <pkg> (#n)
Other ecosystems: 2 pip, 1 actions — not handled by this skill
```

Then ask **once** with `AskUserQuestion`, `multiSelect: true`, one option per severity group that has
at least one fix item. Label each with its counts (`Critical — 1 package, 15 alerts`) and put the
package names and fix paths in the description. The highest group comes first, marked
`(Recommended)`.

**An empty selection or a skip changes nothing** — go straight to the summary (Step 9).

## Step 6: Decide the risky upgrades

Fix items in the chosen groups whose path is **major upgrade** or **parent bump or pin** each get one
single-select question. Every question ends with **Skip**. Build the options from what the registry
actually offers:

- **Major upgrade** — `Upgrade to <target> (major)` or `Skip`. Put what you know of the breaking
  changes in the description (release notes or CHANGELOG if quick to find), and any `engines`
  requirement the project's Node or JDK does not meet.
- **Parent bump or pin** — `Bump <parent> to <version>` when a parent release admits the target (the
  tree stays as its maintainers tested it; recommend it when that bump is a patch or minor), and
  `Pin <package> to <range>` via overrides / resolutions / `dependencyManagement` / constraints
  (recommend it when the parent needs a major or has no fixed release yet).

Up to four items fit one `AskUserQuestion` call — ask them together. With more, ask in plain text
instead, one numbered line per item with its options lettered and the recommended one marked:
"Reply with your picks (e.g. `1a 2b 3 skip`), or `recommended`."

An unanswered or skipped item is skipped. Never apply an option the user did not pick.

## Step 7: Apply

Work manifest by manifest:

1. **Edit by hand** with the Edit tool: pins (overrides, resolutions, `dependencyManagement`,
   constraints), and for Maven and Gradle every version where it is declared — those are exact
   already, so the build resolves exactly what you wrote.
2. **Install the exact targets** of the npm-family direct dependencies — range bumps, major upgrades,
   bumps of a direct parent — in one command: `npm install <pkg>@<target> <pkg>@<target>`. The same
   install applies the pins from step 1; with no direct targets, run a plain install. The flags that
   keep a `~` or exact range, and the other managers' commands, are in `references/npm.md`.
   Do not hand-edit a range and then run a bare install: it resolves the newest version the new range
   allows, not the target. In testing, `^16.3.8` installed `next` 16.4.3, and `^4.131.0` installed
   `wrangler` 4.152.0 — 21 minors past the user's pick, closing an alert the user had declined.
   Afterwards, `git diff package.json` may show only the changed version lines; restore anything else
   (a reordered block, a moved section) by hand.
3. **Refresh the lockfile** for the lockfile-refresh items with the command in the ecosystem reference.
   Re-run the Step 4 lookup for them first: the install has often moved them already with a parent.
   A refresh resolves the newest version the parents allow and can move other packages with it
   (refreshing `browserslist` also moved `baseline-browser-mapping`); Step 8 reports what moved.

What this skill never does, because each one changes far more than the user selected:

- `npm audit fix` — it touches packages outside the chosen groups, and `--force` jumps majors.
- Deleting the lockfile or `node_modules` to force a resolution — it re-resolves the whole tree and
  buries the fix in an unreviewable diff.
- `--force` / `--legacy-peer-deps` past a peer conflict. Stop, show the conflict, and offer to drop
  that item.

An install that fails on authentication (a private registry, an expired login) stops the run. Tell
the user what to renew rather than continuing with a half-installed tree.

## Step 8: Verify

1. **Every targeted copy resolved where it should.** Re-run the Step 4 lookup. A direct dependency
   must sit **exactly** on its target — "at or above" would hide an overshoot. A transitive copy must
   be at or above its target. A copy that is still vulnerable — a pin that did not take, a second
   parent holding it back — is reported as **not fixed**, with the reason. Never count its alerts as
   closed.
2. **Side effects.** Check the resolved tree against **every** open alert from Step 2, including the
   groups the user did not select and the items they skipped. An alert whose package now resolves
   outside its vulnerable range was closed as a side effect. List it under **Also closed** with the
   change that moved it, so nothing in the diff surprises the user in review.
3. **Advisories with no alert.** For npm-family projects, run the audit from `references/npm.md` and
   compare it with the alerts by GHSA. An advisory still flagged that no open Dependabot alert covers
   goes under **No alert yet**, with its package and fixed version. This run did not fix it; upgrading it now or
   after Dependabot catches up is the user's call. Maven has no built-in audit, so the Step 4 vetting
   covers only the packages this run touched.
4. **The diff touches only what it should.** `git diff --stat` must show manifests and lockfiles only.
   Explain anything else or revert your part of it.
5. **The project's own checks, cheapest first.** Read the scripts (`package.json`, `pom.xml`,
   `build.gradle`) and run only what is defined — lint, build, test. A missing script is not a
   failure, and anything slower than two minutes runs in the background.

When a check fails, read the error and name the upgrade most likely behind it (major upgrades first).
Ask whether to revert that item — restore its manifest lines and install again — or keep it for the
user to fix. Do not rewrite application code to fit a new major here; report what broke and where. If
the failure has nothing to do with the upgraded packages, it may predate this run; say so instead of
blaming the upgrade.

## Step 9: Summary

```
Fixed (uncommitted):
| Package  | From → To        | How                         | Alerts closed once merged |
|----------|------------------|-----------------------------|---------------------------|
| next     | 16.2.10 → 16.4.1 | range ^16.2.10 → ^16.4.1    | #12 #14 #15 … (15)        |
| postcss  | 8.4.31 → 8.5.23  | via next bump               | #20 #21 #30 #31           |

Also closed (not selected): baseline-browser-mapping 2.10.43 → 2.11.32 via browserslist refresh (#24)
Skipped by you: express 4 → 5 (major)
Not fixed: sharp 0.35.2 — pin did not apply, still 0.35.2 (#33)
No alert yet: zod 4.6.5 — GHSA-mrhx-c7xc-m3w5, fixed in 4.6.6
Not fixable here: braces (#36) — advisory withdrawn
Other ecosystems: 2 pip, 1 actions
Checks: lint ✓ · build ✓ · test ✓
```

Link every alert number to its `url`. Then the commit preview — the files to stage, one line on what
changed in each, and a one-line message such as `fix(deps): Patched next and postcss for Dependabot
alerts`. List the GHSA IDs behind any pin, since a manifest has nowhere to say why it exists.

Close with a reminder that every change is uncommitted, nothing was written to GitHub, and the alerts
close by themselves once the fix lands on the default branch.

## Reference files

- `references/npm.md` — lockfile detection, finding copies, range bumps, lockfile refresh, parent bumps
  and pins for npm, yarn, pnpm and bun
- `references/maven-gradle.md` — the same for Maven and Gradle: where a version is declared, BOMs,
  `dependencyManagement`, constraints, Gradle lockfiles
