---
name: mwd-agent-rebase
description: Rebase a feature branch onto a selected target branch (latest origin/master or origin/main by default), resolving mechanical conflicts automatically and regenerating lockfiles when needed, then verifying the result with the project's own build. Force-pushing and pipeline-watching are opt-in via --push and --ci. Use when a branch is behind its base branch, has merge conflicts, or needs a rebase before review/merge.
argument-hint: "[target-branch] [--push] [--ci]"
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, AskUserQuestion
model: opus
---

# Rebase Branch

Rebase a feature branch onto a target branch — the default branch (`origin/master` or `origin/main`) unless the user picks another — resolve the conflicts, and prove the result still builds.

## Arguments

Rewriting published history is the user's call, not yours. Both write actions are **opt-in**:

| Argument          | Effect                                                                                       |
|:------------------|:----------------------------------------------------------------------------------------------|
| `[target-branch]` | Rebase onto this branch instead of asking. Bare name (`master`, `release/2.4`), no `origin/`. |
| `--push`          | Permission to `git push --force-with-lease` once verification passes (Step 6).                 |
| `--ci`            | After pushing, watch the pipeline and report the result (Step 7). Implies `--push`.            |

**Without `--push` the rebase stops in the local branch** — verified, not pushed. Print the exact
push command and let the user run it. Never force-push because the rebase "looks fine", because the
user said `--ci`'s intent was obvious, or because a previous run in this session used `--push`.
Permission is per-invocation.

`--ci` without a reachable `glab`/`gh` is a hard stop before pushing, not a silent skip — the user
asked to see the pipeline, so failing to check it changes what they agreed to.

## Tooling (PATH safety)

Do not assume `git`, `glab`, `gh`, or the project's package manager are on `PATH`. Each bash block
runs in a fresh, minimally-initialized shell, so resolve tool paths up front via `command -v` with a
fallback and fail fast if one is missing. Always call the resolved variables.

```bash
GIT="$(command -v git || echo /usr/bin/git)"
GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"   # only when --ci on GitLab
GH="$(command -v gh || echo /opt/homebrew/bin/gh)"         # only when --ci on GitHub
```

`npm`/`pnpm`/`yarn` usually come from a version manager (nvm, corepack) that a non-login shell has
not initialised. Resolve them the same way, and if the project pins a Node version (`.nvmrc`), say so
rather than silently building on whatever version answers.

## Terminal Output Guidelines

**CRITICAL**: Always pipe git commands through `cat` or use `--no-pager` to prevent pager from blocking:

```bash
"$GIT" --no-pager log --oneline -10
"$GIT" --no-pager status --short
```

## Step 1: Select Repository and Branch

If the repo and branch are obvious from the current conversation or working directory, use them. Otherwise **ask the user**, offering likely options:

```bash
cd $("$GIT" rev-parse --show-toplevel)
"$GIT" --no-pager branch --show-current
"$GIT" --no-pager branch --sort=-committerdate | head -5   # recently active branches
```

Present the current repo + current branch as the default option, plus recently active branches.

If the working tree is dirty, stop and ask the user how to handle the uncommitted changes — never silently stash-drop or discard them.

## Step 1b: Select the Target Branch

Determine the repo's default branch and offer a target-branch selection, with the default branch (`master`/`main`) as the **default option**:

```bash
DEFAULT_BRANCH=$("$GIT" remote show origin | grep "HEAD branch" | awk '{print $NF}')
"$GIT" --no-pager branch -r --sort=-committerdate | head -8   # other candidate target branches
```

- If the user already named a target branch, use it without asking.
- Otherwise ask, offering: `$DEFAULT_BRANCH` (recommended default), plus a few likely alternatives (recently active remote branches, e.g. a release or epic branch the feature branch was forked from).
- Verify the chosen target exists on the remote: `git rev-parse --verify origin/<target>`.

Use the selected branch as `TARGET_BRANCH` in all following steps.

## Step 2: Sync With Remote and Rebase

**CRITICAL: reset the local branch to the remote tip before rebasing.** Other agents or humans may have pushed commits since the last fetch — rebasing a stale local branch and force-pushing destroys their work.

```bash
"$GIT" fetch origin
"$GIT" checkout <branch>
"$GIT" reset --hard origin/<branch>    # ← sync with remote; local may be stale

"$GIT" rebase origin/$TARGET_BRANCH
```

**Do NOT autosquash.** Plain `git rebase` — no `-i --autosquash` — so existing `fixup!` commits survive the rebase intact. Only autosquash if the user explicitly asks for it.

If the rebase completes cleanly, skip to Step 5.

## Step 3: Resolve Conflicts

For each conflict stop:

```bash
"$GIT" --no-pager diff --name-only --diff-filter=U
"$GIT" --no-pager diff <conflicted-file>   # inspect the hunks
```

**Resolve autonomously (mechanical conflicts):**
- Both sides appended entries to `CHANGELOG.md` → keep both, branch entries under `[Unreleased]`
- Both sides added unrelated imports/exports/list items → keep both, respect import ordering
- Whitespace/formatting-only differences → take the target-branch formatting, re-apply the branch's semantic change
- Non-overlapping edits inside one hunk → combine both
- File renamed/moved on the target branch → re-apply the branch's edit at the new location
- Branch edits code that the target branch deleted entirely → investigate the replacement; if the branch change clearly maps onto the successor code, port it there

**Ask the user (genuine decisions only):** conflicts where both sides changed the same behavior differently and picking a side is a product/design choice, or where the intent of either side is unclear. Present the concrete options (side A, side B, combination) with a short explanation of each — don't just say "there's a conflict".

After resolving each file:

```bash
"$GIT" add <resolved-files>
"$GIT" rebase --continue
```

Repeat until the rebase finishes. Never `git rebase --abort` just because conflicts look tedious — abort only if the user asks to stop.

## Step 4: Lockfile Conflicts (Regenerate, Never Hand-Merge)

For `package-lock.json` / `pnpm-lock.yaml` conflicts, first try the mechanical route: if `package.json` did not conflict, the lockfile can usually be regenerated rather than merged by hand. **Never hand-edit lockfile conflict hunks.**

Take the target branch's lockfile and fully regenerate it from the (already resolved) `package.json`:

```bash
"$GIT" checkout origin/$TARGET_BRANCH -- package-lock.json   # or pnpm-lock.yaml
npm install --package-lock-only                              # or: pnpm install --lockfile-only
"$GIT" add package-lock.json
"$GIT" rebase --continue
```

`--package-lock-only` / `--lockfile-only` resolves the tree without downloading or building anything, so it is fast and cannot leave a half-installed `node_modules` behind. Drop the flag only if the lockfile still will not resolve.

Match the project's package manager — `pnpm-lock.yaml` means pnpm, `yarn.lock` means yarn. Regenerating with the wrong one replaces the lockfile format entirely, which is a far bigger diff than the conflict was.

Verify afterwards that the regenerated lockfile diff against the target branch only contains changes explained by the branch's `package.json` edits.

## Step 5: Verify the Rebase Locally

A rebase is not done when the conflicts stop. Porting an edit onto successor code (Step 3) or regenerating a lockfile (Step 4) can produce a tree that compiles differently from either parent, so **check the history and then check the build** — before anything is pushed.

History first:

```bash
"$GIT" --no-pager log --oneline origin/$TARGET_BRANCH..HEAD | cat   # right commits, fixups preserved
"$GIT" --no-pager diff origin/$TARGET_BRANCH...HEAD --stat | cat    # no file you never touched
```

Then run the project's own checks — **do not invent commands**. Read `package.json` scripts (or `Makefile`, `pom.xml`, `go.mod`, `pyproject.toml`) and run what is actually defined, cheapest first:

```bash
npm run lint --if-present
npm run build --if-present
npm test --if-present
```

- **Only run what the project defines.** No script → say so and move on; a missing test script is not a failure.
- If a check needs services the machine does not have (a database, a device), say which one you skipped and why. Do not fake a pass.
- The bar is **no worse than the target branch**. If a check already fails on `origin/$TARGET_BRANCH`, that failure is pre-existing — report it, do not try to fix it here.
- **A failure caused by the rebase stops the run.** Report the failing check and what conflict resolution likely caused it. Never push a branch you know is broken; never "fix" it with unrelated edits.

## Step 6: Force-Push (only with `--push`)

**Without `--push`, stop here.** Report what was rebased, what verification found, and print the command for the user:

```
Rebased onto origin/master, 7 commits, lint+build pass.
Push it yourself with:  git push --force-with-lease origin <branch>
```

With `--push`:

```bash
"$GIT" push --force-with-lease origin <branch> 2>&1 | cat
```

- Always `--force-with-lease`, never `--force`.
- If `--force-with-lease` is rejected, someone pushed while you worked. **Do not retry with `--force`** — re-fetch, redo Step 2's reset, and rebase again.
- If the push hangs, it is likely waiting for a GPG/SSH passphrase — ask the user to check the terminal. **Never** use `ssh-add`/`ssh-agent`, never disable GPG signing.

## Step 7: Watch the Pipeline (only with `--ci`)

Only after a successful push. Detect the platform from the remote URL — `git remote get-url origin` — and use the matching CLI:

```bash
# GitLab
"$GLAB" ci status --branch <branch> 2>&1 | cat
"$GLAB" ci list --branch <branch> --per-page 1 2>&1 | cat     # if status needs a pipeline id

# GitHub
"$GH" run list --branch <branch> --limit 1 2>&1 | cat
"$GH" run watch <run-id> --exit-status 2>&1 | cat
```

- Pipelines take minutes. Poll at a sensible interval rather than blocking indefinitely, and tell the user the pipeline is running instead of going silent.
- **Report the result; do not chase it.** A red pipeline is an outcome to hand back — name the failing job and quote the relevant log lines. Pushing follow-up commits to make CI green is a separate task the user asks for explicitly.
- If no pipeline appears (CI not configured for the branch, or it needs manual start), say so plainly rather than waiting on something that will never arrive.

## Common Mistakes

- **Force-pushing without `--push`** — the argument is the permission; a clean rebase is not
- Treating `--ci` as permission to keep pushing commits until the pipeline goes green
- Skipping Step 5 because the rebase had no conflicts — a lockfile regeneration alone can break the build
- Pushing a branch whose build you know is broken, or "fixing" it with edits unrelated to the conflicts
- Rebasing without `git reset --hard origin/<branch>` first — a stale local branch force-pushed over the remote destroys other people's commits
- Autosquashing `fixup!` commits without being asked
- Using `--force` instead of `--force-with-lease`, or retrying with `--force` after a lease rejection
- Hand-editing lockfile conflict hunks instead of regenerating from `package.json`
- Regenerating a lockfile with the wrong package manager — `pnpm-lock.yaml` is not npm's
- Inventing build or test commands the project does not define, or reporting a skipped check as a pass
- Assuming master/main as the target without offering the selection — the branch may be based on a release/epic branch
- Rebasing onto a local, stale copy of the target branch instead of `origin/$TARGET_BRANCH` after a fresh fetch
- Asking the user about trivially mechanical conflicts (CHANGELOG merges, import lists)
- Silently picking a side on a genuine design conflict instead of asking
- Discarding uncommitted working-tree changes without asking
- Running git commands without `--no-pager` or `| cat`
