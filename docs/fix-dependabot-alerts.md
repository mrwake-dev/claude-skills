# Fixing Dependabot alerts

`/mwd-security:fix-dependabot-alerts` works through the open Dependabot alerts of the GitHub repository
you have checked out. It reads them with `gh`, so it works on GitHub only. It fixes npm, yarn, pnpm, bun,
Maven and Gradle dependencies; alerts from other ecosystems, such as pip or GitHub Actions, are counted in
the summary and left alone.

It takes no arguments. Run it from the repository's checkout. A run goes like this:

1. It reads every open alert and groups them by package, because one upgrade often closes many alerts.
   A single `next` bump can close fifteen.
2. It checks each package against your local lockfile or build, and drops what your branch has already
   fixed or no longer contains.
3. It picks the smallest upgrade that leaves every vulnerable range, then checks that version against the
   GitHub Advisory Database as well, because alerts lag behind it. If a newer advisory still covers the
   version, it raises the target until none does.
4. It shows an overview grouped by severity and asks which groups to fix.
5. Major upgrades and pins on indirect dependencies each get a question of their own, with Skip as an
   option.
6. It edits the manifests, installs the exact target versions, refreshes the lockfile, and runs the
   project's own lint, build and tests.
7. It ends with a summary: what it fixed, which other alerts closed along the way, what you skipped, what
   it couldn't fix, and a commit preview.

## Before you start

- Dependabot alerts must be turned on for the repository, under **Settings → Code security** on GitHub.
- `gh` needs access to them: a classic token with `repo` (or `security_events`), or a fine-grained token
  with **Dependabot alerts: read**. Your account needs write, maintain or admin access to the repository.
- Commit or put aside any edits to the manifests and lockfiles first. If one of them already has
  uncommitted changes, the skill stops and asks, so its upgrades don't get mixed with your work.

## Examples

Run it in the repository:

```text
/mwd-security:fix-dependabot-alerts
```

The overview it shows before asking looks like this (shortened):

```text
your-org/your-repo: 35 open alerts → 11 fix items (npm). Default branch main, local main.

| Group    | Package | Alerts | Scope   | Path             | Installed → Target | Note                                  |
|----------|---------|--------|---------|------------------|--------------------|---------------------------------------|
| Critical | next    | 15     | runtime | range bump       | 16.2.10 → 16.4.1   | alerts say 16.3.8; 3 newer advisories |
| High     | postcss | 4      | runtime | via next bump    | 8.4.31 → 8.5.23    | next pins it exactly                  |
| High     | nanoid  | 1      | runtime | lockfile refresh | 3.3.16 → 3.3.18    |                                       |
```

Pick the severity groups to fix. Picking nothing changes nothing.

## How it upgrades each package

| Path | When | Asks you? |
|:-----|:-----|:----------|
| Range bump | A direct dependency whose fix stays on the same major version | No, picking the group covers it |
| Lockfile refresh | An indirect dependency whose parents already allow the fixed version | No |
| Via a parent bump | An indirect dependency that another picked upgrade already fixes | No, it moves with that upgrade |
| Major upgrade | A direct dependency whose fix needs a new major version | Yes: upgrade or skip |
| Parent bump or pin | An indirect dependency that a parent holds below the fixed version | Yes: bump the parent, pin the package, or skip |

If Dependabot already has an open pull request for a package, the overview says so: merging it may be the
simpler fix.

## What it can't fix

The summary lists these instead of offering them:

- **Withdrawn advisories.** GitHub retracted them; dismiss the alert as inaccurate on GitHub.
- **Alerts with no patched version.** No upgrade closes them. The options are replacing the package or
  accepting the risk with a written reason.
- **Advisories with no alert yet.** For npm-family projects it runs an audit after the upgrades. An
  advisory the audit still flags but no Dependabot alert covers is listed with its fixed version, for you
  to upgrade now or after Dependabot catches up.

## What it never does

- Commit, stage or push, or write to GitHub: it doesn't dismiss alerts, open pull requests or comment. You
  review the diff and commit, and Dependabot closes the alerts by itself once the fix reaches the default
  branch.
- Run `npm audit fix`, which touches packages outside your picks and, with `--force`, jumps major
  versions.
- Delete the lockfile or `node_modules` to force a resolution.
- Push past a peer dependency conflict with `--force` or `--legacy-peer-deps`. It stops, shows the
  conflict, and offers to drop that package.
- Rewrite your code to fit a new major version. When a check fails, it names the upgrade most likely
  behind it and asks whether to revert that upgrade.

The commands it uses for each ecosystem are in
[npm.md](../plugins/mwd-security/skills/fix-dependabot-alerts/references/npm.md) and
[maven-gradle.md](../plugins/mwd-security/skills/fix-dependabot-alerts/references/maven-gradle.md).
