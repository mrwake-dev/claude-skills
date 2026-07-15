---
name: mwd-agent-rebase
description: Rebase a feature branch onto a selected target branch (latest origin/master or origin/main by default), resolving mechanical conflicts automatically (including lockfile regeneration as a last resort), force-pushing, and driving the pipeline back to green. Use when a branch is behind its base branch, has merge conflicts, or needs a rebase before review/merge.
disable-model-invocation: true
model: opus
---

# Rebase Branch

Rebase a feature branch onto a target branch — the default branch (`origin/master` or `origin/main`) unless the user picks another — resolve conflicts, force-push, and then make the pipeline pass.

## Terminal Output Guidelines

**CRITICAL**: Always pipe git commands through `cat` or use `--no-pager` to prevent pager from blocking:

```bash
git --no-pager log --oneline -10
git --no-pager status --short
```

## Step 1: Select Repository and Branch

If the repo and branch are obvious from the current conversation or working directory, use them. Otherwise **ask the user**, offering likely options:

```bash
cd $(git rev-parse --show-toplevel)
git --no-pager branch --show-current
git --no-pager branch --sort=-committerdate | head -5   # recently active branches
```

Present the current repo + current branch as the default option, plus recently active branches.

If the working tree is dirty, stop and ask the user how to handle the uncommitted changes — never silently stash-drop or discard them.

## Step 1b: Select the Target Branch

Determine the repo's default branch and offer a target-branch selection, with the default branch (`master`/`main`) as the **default option**:

```bash
DEFAULT_BRANCH=$(git remote show origin | grep "HEAD branch" | awk '{print $NF}')
git --no-pager branch -r --sort=-committerdate | head -8   # other candidate target branches
```

- If the user already named a target branch, use it without asking.
- Otherwise ask, offering: `$DEFAULT_BRANCH` (recommended default), plus a few likely alternatives (recently active remote branches, e.g. a release or epic branch the feature branch was forked from).
- Verify the chosen target exists on the remote: `git rev-parse --verify origin/<target>`.

Use the selected branch as `TARGET_BRANCH` in all following steps.

## Step 2: Sync With Remote and Rebase

**CRITICAL: reset the local branch to the remote tip before rebasing.** Other agents or humans may have pushed commits since the last fetch — rebasing a stale local branch and force-pushing destroys their work.

```bash
git fetch origin
git checkout <branch>
git reset --hard origin/<branch>    # ← sync with remote; local may be stale

git rebase origin/$TARGET_BRANCH
```

**Do NOT autosquash.** Plain `git rebase` — no `-i --autosquash` — so existing `fixup!` commits survive the rebase intact. Only autosquash if the user explicitly asks for it.

If the rebase completes cleanly, skip to Step 5.

## Step 3: Resolve Conflicts

For each conflict stop:

```bash
git --no-pager diff --name-only --diff-filter=U
git --no-pager diff <conflicted-file>   # inspect the hunks
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
git add <resolved-files>
git rebase --continue
```

Repeat until the rebase finishes. Never `git rebase --abort` just because conflicts look tedious — abort only if the user asks to stop.

## Step 4: Lockfile Conflicts (Last Resort: Regenerate)

For `package-lock.json` / `pnpm-lock.yaml` conflicts, first try the mechanical route: if `package.json` did not conflict, the lockfile can usually be regenerated rather than merged by hand. **Never hand-edit lockfile conflict hunks.**

Last resort — take the target branch's lockfile and fully regenerate it from the (already resolved) `package.json` file(s), inside Docker:

```bash
git checkout origin/$TARGET_BRANCH -- package-lock.json    # or pnpm-lock.yaml
docker compose exec app npm install                        # or: pnpm install
git add package-lock.json
git rebase --continue
```

Verify afterwards that the regenerated lockfile diff against the target branch only contains changes explained by the branch's `package.json` edits.

## Step 5: Verify and Force-Push

```bash
git --no-pager log --oneline origin/$TARGET_BRANCH..HEAD | cat    # history looks right, fixups preserved
git push --force-with-lease origin <branch> 2>&1 | cat
```

- Always `--force-with-lease`, never `--force`.
- If the push hangs, it is likely waiting for a GPG/SSH passphrase — ask the user to check the terminal. **Never** use `ssh-add`/`ssh-agent`, never disable GPG signing.

## Common Mistakes

- Rebasing without `git reset --hard origin/<branch>` first — a stale local branch force-pushed over the remote destroys other people's commits
- Autosquashing `fixup!` commits without being asked
- Using `--force` instead of `--force-with-lease`
- Hand-editing lockfile conflict hunks instead of regenerating from `package.json`
- Regenerating the lockfile on the host — `npm install`/`pnpm install` must run in Docker
- Assuming master/main as the target without offering the selection — the branch may be based on a release/epic branch
- Rebasing onto a local, stale copy of the target branch instead of `origin/$TARGET_BRANCH` after a fresh fetch
- Asking the user about trivially mechanical conflicts (CHANGELOG merges, import lists)
- Silently picking a side on a genuine design conflict instead of asking
- Discarding uncommitted working-tree changes without asking
- Running git commands without `--no-pager` or `| cat`
