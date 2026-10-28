# Rebasing a branch

`/mwd-git:agent-rebase` rebases your branch onto its target branch, resolves the conflicts it can, and
checks that the result still builds. It pushes only when you pass `--push`.

A run goes like this:

1. It picks the repository and branch, asking when they aren't obvious. If you have uncommitted changes,
   it stops and asks how to handle them.
2. It picks the target branch: the one you named, or it asks, suggesting the default branch and recently
   active ones.
3. It fetches, resets your local branch to its copy on the remote, and rebases onto the fresh target. The
   reset means commits other people pushed to your branch aren't lost when it force-pushes later.
4. It resolves simple conflicts itself and asks you about the rest.
5. It regenerates a conflicted lockfile from `package.json` instead of merging it by hand.
6. It checks the commit history and runs the project's own lint, build and tests.
7. It stops and prints the push command, unless you passed `--push`.

## Before you start

- **Push your local commits first.** Step 3 resets your local branch to the remote copy, so commits you
  haven't pushed are left out of the rebase. They're still recoverable with `git reflog`.
- **The remote must be called `origin`.** The skill fetches from, rebases onto and pushes to `origin`.

## Options

| Option | What it does |
|:-------|:-------------|
| `[target-branch]` | Rebases onto this branch instead of asking. Use the bare name, such as `main` or `release/2.4`, without `origin/`. |
| `--push` | Force-pushes with `--force-with-lease` once the checks pass. |
| `--ci` | Also pushes, then watches the pipeline and reports its result. |

Permission to push holds only for the run you pass it to.

## Examples

Rebase, choosing the target when asked, and stop before pushing:

```text
/mwd-git:agent-rebase
```

Rebase onto `main` and stop before pushing:

```text
/mwd-git:agent-rebase main
```

Rebase onto a release branch and push once the checks pass:

```text
/mwd-git:agent-rebase release/2.4 --push
```

Rebase onto `main`, push, and watch the pipeline:

```text
/mwd-git:agent-rebase main --ci
```

## Conflicts

It resolves these itself:

- Both sides added entries to `CHANGELOG.md`: it keeps both, with the branch's entries under
  `[Unreleased]`.
- Both sides added unrelated imports, exports or list items: it keeps both, in the file's import order.
- Formatting-only differences: it takes the target branch's formatting and reapplies the branch's change.
- Edits that don't overlap inside one hunk: it combines them.
- A file the target branch moved: it reapplies the branch's edit at the new location.
- Code the target branch deleted: it finds what replaced it, and ports the branch's change there when the
  mapping is clear.

It asks you when both sides changed the same behavior differently, or when either side's intent is
unclear, and shows the options: one side, the other, or a combination.

## What it never does

- Push without `--push`, or with `--force`. If the lease is rejected because someone pushed meanwhile, it
  fetches and rebases again instead of forcing.
- Push a branch whose checks fail because of the rebase. A check that already fails on the target branch
  is reported as pre-existing.
- Invent build or test commands. It runs only what the project defines.
- Edit lockfile conflicts by hand, or regenerate a lockfile with a different package manager.
- Squash `fixup!` commits unless you ask.
- Discard your uncommitted changes, or abort the rebase unless you ask.
- Keep pushing commits to turn a red pipeline green. With `--ci`, it reports the failing job and stops.
- Touch your SSH agent or GPG signing when a push hangs. It asks you to check the terminal.
