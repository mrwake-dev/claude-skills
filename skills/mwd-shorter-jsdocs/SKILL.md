---
name: mwd-shorter-jsdocs
description: Audit the JSDoc comments added or modified on the current branch — flag bloated blocks to shorten and unnecessary ones to remove, then apply after confirmation. Use when the user asks to shorten, trim, clean up, or review JSDoc / doc comments on a branch.
disable-model-invocation: true
argument-hint: "[--committed | --uncommitted] [path...]"
allowed-tools: Read, Edit, Glob, Grep, Bash
---

# Shorter JSDocs

Audit every JSDoc block this branch added or touched, and cut it down to what a reader actually needs.

Arguments in `$ARGUMENTS`:
- `--committed` — only commits on this branch, ignore the working tree
- `--uncommitted` — only staged + unstaged + untracked changes
- neither — **both** (default)
- any remaining values are path filters passed to `git diff -- <path>`

## Rules

- **Report first, edit only after confirmation.** Never touch a file before the user picks what to apply.
- **Scope is the diff, not the file.** A JSDoc block is in scope only if at least one of its lines appears as `+` in the diff. Pre-existing blocks in a touched file are out of scope — do not clean them, do not mention them.
- **Never edit code.** Only the comment blocks. If a JSDoc is wrong because the code is wrong, report it as a note; do not fix the code.
- **Target shape:** one line stating the non-obvious fact. Two lines only if a second fact genuinely does not fit.
- **JS/TS only** (`.ts .tsx .js .jsx .mts .cts .mjs .cjs`). Ignore Javadoc, docstrings, and other languages.

## Workflow

### Step 1: Resolve scope

```bash
BASE=$(git merge-base HEAD "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/master)")
```

State the base ref you resolved in your reply. Then collect changed files:

| Mode | Command |
|:--|:--|
| default | `git diff --name-only "$BASE"` + `git ls-files --others --exclude-standard` |
| `--committed` | `git diff --name-only "$BASE" HEAD` |
| `--uncommitted` | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` |

`git diff "$BASE"` (no second ref) already spans merge-base → working tree, so the default mode is one command plus untracked files. Filter to JS/TS extensions.

If nothing matched, say so and stop.

### Step 2: Locate the touched blocks

For each changed file, get the added-line ranges:

```bash
git diff -U0 "$BASE" -- <file>
```

Parse the `@@ -a,b +c,d @@` hunk headers for new-file line numbers. Untracked files are entirely in scope.

Then `Read` the file and find every `/** … */` block whose line span intersects an added range. Record for each: file, start line, the symbol it documents, and whether that symbol is exported.

Line-comment noise (`//`) is out of scope — this skill is about JSDoc blocks.

### Step 3: Classify each block

**REMOVE** — the block carries zero information the signature does not:

- Restates the name — `/** Gets the user name. */` above `getUserName()`
- Only `@param` / `@returns` that repeat the parameter name or the TS type
- `@constructor`, `@function`, `@memberof`, `@public`, `@type` on already-typed TS
- Narrates the change rather than the code — "Added to fix the reconnect bug", "New helper for the refactor"
- Trivial getters, setters, and one-line pass-through wrappers
- Decorative banners and section separators

**SHORTEN** — there is a real fact buried in prose:

- Multi-paragraph explanations of *how* the body works — the body already says that
- Step-by-step implementation bullets
- `@example` blocks that duplicate a test or restate the obvious call
- Mixed `@param` lists where only one parameter is non-obvious — keep that one line, drop the rest
- Anything hedging, apologising, or addressing the reader

**KEEP** — leave as-is, or shorten at most; never remove:

- Any block on an **exported or otherwise public symbol** — shorten only
- Blocks holding `@deprecated`, `@throws`, `@see`, `@internal`, `@override`, `@template`, `@license`, `@packageDocumentation`
- Load-bearing pragmas — `@ts-ignore`, `@ts-expect-error`, `@type`, `@typedef`, `@satisfies`, `@jsx`, `eslint-disable`, `/* global */`. In plain `.js` files under `checkJs`, `@param` / `@returns` **are** the types: never strip them.
- Non-obvious constraints — units, ranges, ordering guarantees, side effects, async/reentrancy caveats, and why a workaround exists

When a block is ambiguous, classify it KEEP and say why in the notes column. Deleting a comment that encoded a hard-won fact costs more than leaving one long comment.

### Step 4: Report

Present one table, grouped by file:

| Location | Verdict | Now | Proposed | Why |
|:--|:--|:--|:--|:--|
| `src/foo.ts:12` | SHORTEN | 9 lines | 1 line | Restates the body; only the 500ms debounce is non-obvious |
| `src/foo.ts:48` | REMOVE | 4 lines | — | `@param id` repeats the `string` type |
| `src/api.ts:7` | KEEP | 6 lines | — | Exported, documents the retry contract |

Then show the **proposed replacement text** for every SHORTEN block, so the user can judge the wording before agreeing.

Finish with the counts (`N to shorten, M to remove, K kept`) and ask which to apply — all, none, or a specific list.

### Step 5: Apply and verify

Apply only what the user picked, with `Edit`, one block at a time. When removing a block, remove its trailing blank line too if that leaves a double gap.

Then prove nothing broke. Check `package.json` scripts and run whichever exist, in this order:

```bash
npm run typecheck   # or tsc --noEmit
npm run lint
```

A JSDoc edit can break a build — `@type` casts, `@ts-expect-error` pragmas, and `checkJs` type annotations all live in comments. If the check fails, revert the offending edit and report it rather than patching around it.

Close with a one-line summary of what changed and the verification result. If a check could not run (no script, no deps installed), say that explicitly instead of implying it passed.
