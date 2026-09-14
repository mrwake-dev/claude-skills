---
name: mwd-code-review-interactive
description: Interactive code review on a GitLab merge request or GitHub pull request — generate feedback, confirm with the user which findings to post, post approved ones as inline diff comments via glab or gh (auto-detected from the repo URL), and write an HTML report into a persistent review archive. Pass `local` instead of a URL to review the current branch from the local checkout with no platform access and nothing posted. Use when the user asks to interactively review an MR/PR and post comments, or to review their working branch locally.
argument-hint: "[merge-request-or-pull-request-url|local]"
disable-model-invocation: true
---

# Interactive Code Review for GitLab MRs & GitHub PRs

Perform an **interactive** code review on $ARGUMENTS. Generate feedback exactly as a normal review,
then confirm with the user which findings to post and post the approved ones as **inline diff
comments**. Rejected or un-postable findings stay in a short final chat summary — nothing else is
written to the platform. Every run also writes an HTML report of the whole review into a persistent
local archive; that report, not the chat summary, carries the full detail of each finding.

`$ARGUMENTS` selects one of **two modes**, and Step 0 resolves which:

| `$ARGUMENTS`                | Mode      | Change under review                        | Platform access                     |
|:----------------------------|:----------|:-------------------------------------------|:-------------------------------------|
| an MR/PR URL                | **Remote** | the merge request / pull request at that URL | reads the change, posts approved findings |
| the literal word `local`    | **Local**  | the current branch in the working directory  | **none — nothing is read or posted**  |

The skill supports **both GitLab (via `glab`) and GitHub (via `gh`)**. The review logic (Steps 2–3)
is identical on both and identical in Local mode; only the fetch (Step 1) and post (Step 4.3)
plumbing differs, and that lives in a per-platform reference file. Throughout this document, **the
change** means the MR or PR under review in Remote mode, and the branch under review in Local mode.

## Workflow

**Tooling (PATH safety):** Do not assume `glab`, `gh`, or `jq` are on `PATH`. Each bash block runs in
a fresh, minimally-initialized shell (no environment shared between blocks), so every block resolves
tool paths up front via `command -v` with a fallback (`/opt/homebrew/bin/…`, `/usr/bin/jq`) and fails
fast if a tool is missing. Always call the resolved `"$GLAB"` / `"$GH"` / `"$JQ"` variables.

**Running the helper script:** Step 4.4.a invokes `scripts/render-report.js`, which lives next to this
`SKILL.md` in the skill's installation directory — **not** in the user's project. Resolve
`SKILL_DIR="$(dirname "<path-to-this-SKILL.md>")"` and call it by absolute path
(`node "$SKILL_DIR/scripts/render-report.js" …`). If the script "doesn't exist", you are looking in the
project directory instead of the skill directory.

### Step 0: Resolve the mode, then the platform

**Mode first.** If `$ARGUMENTS` is the word `local` (case-insensitive, optionally followed by a base
ref — see Step 1), the run is in **Local mode**: skip the rest of this step entirely, load no platform
reference, and go to Step 1's Local branch. Local mode makes **no network calls and no platform calls
at all** — there is no URL, so there is nothing to read from and nothing to post to.

If `$ARGUMENTS` is empty, ask which the user wants rather than guessing; do not silently default to
either mode.

**Otherwise the argument is a URL and the run is in Remote mode.** Look at the host in the change URL
and pick the platform — this decides which CLI and which reference file the rest of the run uses:

| URL host | Platform | CLI | Terminology | Plumbing reference |
|:---------|:---------|:----|:------------|:-------------------|
| `github.com` (or a GitHub Enterprise host) | GitHub | `gh` | pull request (PR), number, review comments | `references/platform-github.md` |
| `gitlab.com` or a self-hosted GitLab | GitLab | `glab` | merge request (MR), IID, discussions | `references/platform-gitlab.md` |

If the URL alone is ambiguous (e.g. a self-hosted host you don't recognize), check the path shape
(`/-/merge_requests/<n>` ⇒ GitLab, `/pull/<n>` ⇒ GitHub); if still unclear, ask the user. **Read the
matching platform reference now** — Steps 1 and 4.3 below delegate all the concrete `glab`/`gh`
commands to it. Confirm the CLI is authenticated (`gh auth status` / `glab auth status`) if a fetch
fails with an auth error.

### Step 1: Get the change details

#### Remote mode

Parse the URL and fetch the metadata, diff, commits, existing inline comments, and positioning data
using the **fetch recipe in the platform reference you loaded in Step 0** (§"Step 1"). The reference
gives the exact `glab`/`gh` commands, URL-parsing rules, and how to derive the positioning data
(GitLab needs base/head/start SHAs; GitHub needs only the head `commit_id`).

Regardless of platform, you must come away from this step with:

- **Metadata** — title, description, author, labels, state.
- **The diff saved to a temp file** (`/tmp/mr-<iid>.diff` or `/tmp/pr-<number>.diff`) — do NOT dump
  it straight into context (see "Large changes").
- **Commit history.**
- **Existing inline review comments** (for re-run awareness, below).
- **Positioning data** for anchoring comments in Step 4.
- **CI status** for the executive summary — GitLab `.head_pipeline.status`, or GitHub's
  `statusCheckRollup`. If failed, connect it to relevant findings where possible.

**Large changes**: if the saved diff is under ~2,000 lines, read the temp file whole. Otherwise review
it file-by-file: list the boundaries with `grep -n '^diff --git' <tmp-diff>`, then read one file's
slice at a time (Read tool with offset/limit, or `sed -n 'START,ENDp'`). See the platform reference
for how to recover a truncated/overflowed diff. Any file that still could not be reviewed must be
named in the Step 4.4 executive summary.

**Re-run awareness**: scan the fetched inline comments for bodies starting with `<!-- mwd-review:` —
those are findings posted by a previous run of this skill — and note human-raised threads plus their
resolved state. The Step 3 verification pass uses this to avoid re-raising anything already on the
change.

#### Local mode

Build the same inputs from the working directory with `git` alone — no `glab`, no `gh`, no network.
The base is the merge-base with the repo's default branch, or the ref the user named as
`local <base-ref>`:

```bash
git rev-parse --is-inside-work-tree >/dev/null || { echo "not a git repo"; exit 1; }
BASE_REF="<the ref after 'local', if the user gave one>"
if [ -z "$BASE_REF" ]; then
  BASE_REF="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"    # e.g. origin/main
  [ -n "$BASE_REF" ] || for c in origin/main origin/master main master; do
    git rev-parse --verify --quiet "$c" >/dev/null && { BASE_REF="$c"; break; }
  done
fi
[ -n "$BASE_REF" ] || { echo "cannot determine a base ref — pass one as 'local <base-ref>'"; exit 1; }
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
HEAD_SHA="$(git rev-parse HEAD)"
MERGE_BASE="$(git merge-base "$BASE_REF" HEAD)" || { echo "no merge base with $BASE_REF"; exit 1; }
DIFF="/tmp/local-$(printf '%s' "$BRANCH" | tr '/' '-')-$(git rev-parse --short HEAD).diff"
git diff "$MERGE_BASE" HEAD > "$DIFF"
wc -l "$DIFF"
git log --format='%h %an %s' "$MERGE_BASE"..HEAD      # commit history + intent
git status --porcelain                                 # uncommitted work, see below
```

Stop and report rather than reviewing nothing if the diff is empty — HEAD is at the base, or the
user is on the default branch itself and meant to name a different one.

**Uncommitted changes.** The diff above covers committed work only. If `git status --porcelain` is
non-empty, say so and ask whether to include the working tree (`git diff "$MERGE_BASE"` picks up
unstaged edits as well) before continuing — do not silently review a stale snapshot of files the user
has since edited.

The Step 1 outputs map like this; the rest of the workflow is unchanged because it consumes these,
not the platform:

| Remote-mode input        | Local-mode equivalent                                                          |
|:--------------------------|:--------------------------------------------------------------------------------|
| Metadata                 | branch name as the title, `git log -1 --format='%an'` as the author; no labels, no state |
| Diff temp file           | `/tmp/local-<branch>-<short-sha>.diff` as above                                |
| Commit history           | `git log "$MERGE_BASE"..HEAD` — also the **intent context** a description would give |
| Existing inline comments | none — **re-run awareness does not apply**, so nothing is ever "already raised" |
| Positioning data         | not needed; nothing is posted. Findings still carry `file:line` for the report |
| CI status                | none — report it as `n/a (local)` in the executive summary                     |

Everything from here to Step 4.1 is identical to Remote mode. **Steps 4.2 and 4.3 do not run in Local
mode** — see the guard on each.

### Step 2: Contextual Analysis

**Identify the review rules.** The checklists live in this skill's `references/` directory (paths relative to this SKILL.md). Decide the execution mode first (see Step 3): in **inline mode**, read the applicable files yourself now; in **fan-out mode**, only detect which apply — each subagent reads its own rule file(s), so do not load them all into the main context. Applicability:

- `references/general.md` — **always** (code quality, documentation & comment accuracy, correctness, architecture, logging, tests, dependencies, CHANGELOG, security).
- The language files matching the diff, detected from file extensions: `references/typescript.md` (`.ts` / Node.js), `references/react.md` (`.tsx` / React — read together with typescript.md), `references/java.md`, `references/python.md`, `references/go.md`.
- `references/device-runtime.md` — when the change touches code that runs on signage devices (Tizen, webOS, BrightSign, embedded Linux). Confirm mechanically rather than by impression, because a missed trigger silently drops both the dimension and its pre-scan:

  ```bash
  grep -lE '@signageos/(front-applet|front-display|lib-bundler)' package.json                    # device runtime deps
  grep -E '^\+\+\+ ' "$DIFF" | grep -iE 'tizen|webos|brightsign|applet|player'                   # device paths in the diff
  ls .swcrc .browserslistrc rspack.config.* webpack*.config.* tools/build.mjs 2>/dev/null        # a bundler with a transpile target
  ```

  Any hit turns the dimension on. Otherwise fall back to the prose triggers — applet or player-runtime directories, a browserslist targeting old Chromium/WebKit — and when still unsure, apply it: most changes in this ecosystem ship to devices.

  **When it applies, resolve the build target before reviewing anything** — follow "Resolve the target first" in `references/device-runtime.md` and record all three facts (real transpile target with its `file:line`, the ES gate and its asserted level or `none`, polyfill coverage). `tsconfig.json` `target` is not authoritative. In fan-out mode these go into the device agent's spawn prompt; in inline mode you use them yourself. Every syntax and lib-API hit is triaged against them.
- `references/platform-scripts.md` — when the diff touches platform scripting: `.sh`/`.bash`, `.ps1`/`.psm1`/`.psd1`, `.brs`, `.bat`/`.cmd`, `.cs`. These ship to the device or drive its install and recovery, and no language file covers them.

`references/platform-gitlab.md`, `references/platform-github.md`, and `references/report.md` are
plumbing, not checklists — they are read in Steps 0 and 4.4, and never handed to a review subagent.

Then gather context:

1. **Read surrounding code** — for any modified file, examine the broader context (imports, class structure, related interfaces/types) to understand existing patterns and conventions in the project.
2. **Check for broken contracts** — if public APIs, interfaces, or shared types are modified, verify that all consumers are updated accordingly.

Check the change description for completeness:
- Is there a clear description of what changed and why?
- Is the standard MR/PR template filled in (classification, ClickUp task, checklists)?

Check the commit history:
- Are commit messages descriptive and meaningful?
- Is the history clean and logically structured, or full of "fix", "wip", "asdf"?
- Are commits broken down into logical, self-contained units?

### Step 3: Generate Feedback

#### Mechanical pre-scan (both modes, before any judgement-based review)

A subset of the rules are **absolute prohibitions on constructs that are deterministically greppable**
— `any` in TypeScript, `FC`, a bare `except:`, `catch (Exception)`. Leaving those to reading is exactly
how they get missed on a small diff, where a single context juggles every rule file at once. So detect
them mechanically first, in the **main context**, regardless of execution mode. This costs no context
budget, so it applies to huge diffs too.

Flatten the saved diff into one `file:new_line:added_text` record per added line — every pattern pass
then runs against that one file, and each hit already carries the new-side anchor data Step 4 needs:

```bash
DIFF=/tmp/mr-<iid>.diff                  # or /tmp/pr-<number>.diff, or /tmp/local-<branch>-<sha>.diff
ADDED="${DIFF%.diff}.added"
awk '
  /^diff --git/ || /^index / || /^old mode/ || /^new mode/ { next }
  /^--- /    { next }
  /^\+\+\+ / { f = substr($0, 7); next }   # strip "+++ b/"
  /^@@/      { match($0, /\+[0-9]+/); n = substr($0, RSTART + 1, RLENGTH - 1) + 0; next }
  /^\\/      { next }                      # "\ No newline at end of file"
  /^\+/      { print f ":" n ":" substr($0, 2); n++; next }
  /^-/       { next }
             { n++ }                       # context line advances the new-side counter
' "$DIFF" > "$ADDED"
wc -l "$ADDED"
```

Then run the passes for the rule files detected in Step 2 — only those:

```bash
# --- typescript.md ---
grep -nE '\bany\b' "$ADDED"                                                     # no `any` types
grep -nE '\bas +[A-Z]|\bas +(const|unknown)\b|[^A-Za-z0-9_.>]<[A-Z][A-Za-z0-9_]*> *[A-Za-z_(]' "$ADDED"   # no type assertions
                                                                                # (the third alternative is the `<Foo>bar` form; requiring a
                                                                                # non-identifier before `<` keeps out `useState<Bar>(`, `g<T>(`,
                                                                                # `Promise<Foo>`, `new Map<String, Foo>()`)
grep -nE '@ts-(ignore|nocheck)' "$ADDED"                                        # never acceptable
grep -nE '@ts-expect-error' "$ADDED"                                            # allowed only with a stated reason
grep -nE 'class +[A-Za-z0-9_]+ +extends +[A-Za-z0-9_]*Error' "$ADDED"            # Error postfix on custom errors

# --- react.md (read together with typescript.md) ---
grep -nE '\bReact\.FC\b|\bFC<|\bFunctionComponent\b|IOwnProps' "$ADDED"          # no FC type, no IOwnProps
grep -nE 'export +default' "$ADDED"                                              # named exports only
grep -nE 'document\.(getElementById|querySelector|createElement|write)|\.innerHTML *=' "$ADDED"  # no direct DOM

# --- python.md ---
grep -nE 'except *:' "$ADDED"                                                    # no bare except
grep -nE 'def +[A-Za-z0-9_]+\(.*= *(\[\]|\{\})' "$ADDED"                         # no mutable default args

# --- java.md ---
grep -nE 'catch *\( *(Exception|Throwable)\b' "$ADDED"                           # no generic catch
grep -nE 'log[A-Za-z]*\.(trace|debug|info|warn|error) *\(.*\+' "$ADDED"          # parameterized logging only

# --- go.md ---
grep -nE 'fmt\.Errorf\(' "$ADDED" | grep -v '%w'                                 # wrap with %w
grep -nE '[^A-Za-z0-9_]_ *:?=' "$ADDED"                                          # ignored return values (note: `^` would
                                                                                 # never match — every record starts `file:line:`)

# --- device-runtime.md ---
# Resolve the real build target, the gate and polyfill coverage first (device-runtime.md, "Resolve
# the target first") — that is what turns most hits below into one-line dismissals.

# Lib & DOM APIs: never transpiled, invisible to es-check, invisible to tsc under `lib: es2022`.
grep -nE 'Object\.(entries|values|assign|fromEntries|hasOwn)\(|Array\.from\(|\.(padStart|padEnd|trimStart|trimEnd|matchAll|replaceAll)\(' "$ADDED"           # ES2015-21 lib
grep -nE 'Promise\.(allSettled|any)\(|\.finally\(|structuredClone\(|\.(at|findLast|findLastIndex)\(|\.(flat|flatMap)\(|\bglobalThis\b|\bBigInt\b' "$ADDED"   # ES2018-22 lib
grep -nE '\bfetch\(|AbortController|AbortSignal\.timeout|URLSearchParams|IntersectionObserver|ResizeObserver|requestIdleCallback|queueMicrotask\(|new EventTarget\(|\.closest\(|\.replaceChildren\(|crypto\.subtle' "$ADDED"  # DOM/BOM

# Regex syntax is engine-level — never transpiled, whatever the target.
grep -nE '\(\?<[=!A-Za-z]' "$ADDED"                                              # named groups, lookbehind

# Downlevellable syntax. Noise wherever a loader covers the file, so run this pass ONLY for files
# nothing compiles (config/, tools/, scripts/, *.mjs, *.cjs, *.sh) or when there is no gate.
grep -nE '\?\.|\?\?|\|\|=|&&=|\basync |\bawait |\{ *\.\.\.|for await|catch *\{|[A-Za-z0-9_)] *\*\* *[A-Za-z0-9_(]' "$ADDED"

grep -nE 'setInterval\(|setTimeout\(|addEventListener\(' "$ADDED"                # needs matching teardown
grep -nE 'gap *:|aspect-ratio|position *: *sticky|inset *:|:has\(' "$ADDED"      # CSS vs oldest target WebKit

# --- platform-scripts.md ---
# Records are `file:line:text`, so the `^[^:]*\.ext:` anchor scopes each pass to its file type.
grep -nE '^[^:]*\.(sh|bash):.*\b(rm|cp|mv|cd|mkdir) +[^|]*\$[A-Za-z_{]' "$ADDED"  # unquoted expansion in a destructive path
grep -nE '^[^:]*\.(sh|bash):.*(`|\| *(ba)?sh\b|\beval )' "$ADDED"                 # backticks, curl|sh, eval
grep -nE '^[^:]*\.(ps1|psm1):.*(Invoke-Expression|\biex\b|-ErrorAction +SilentlyContinue|-AsPlainText)' "$ADDED"
grep -E '^\+\+\+ .*\.(sh|bash)$' "$DIFF"                                          # new/changed shell file — verify `set -euo pipefail`
grep -E '^\+\+\+ .*\.(ps1|psm1)$' "$DIFF"                                         # new/changed PS file — verify $ErrorActionPreference / Set-StrictMode

# --- general.md (added lines) ---
grep -niE '(api[_-]?key|secret|token|password|passwd|credential)[^=:]{0,4}[:=][^=]{8,}' "$ADDED"  # hardcoded secrets

# --- general.md (changed-file list, not line content) ---
grep -E '^\+\+\+ ' "$DIFF"    # manifest without its lockfile (and vice versa); missing CHANGELOG entry;
                              # test files outside test/ or not named *.spec.ts
```

**Every hit must be accounted for.** Hits are candidates, not findings — the patterns favour recall, so
`\bany\b` also matches `Promise.any(` and the word "any" in comments and strings, and the leak and
device-runtime passes match plenty of perfectly correct code (a `setTimeout` that *is* cleared, an
optional chain the build target *does* cover). Triage each hit against its rule file and the
surrounding code, then either raise it as a finding or record it as dismissed with a one-line reason.
What is forbidden is a hit that simply disappears — that is the failure this pre-scan exists to
prevent, and Step 4.4 reports the counts.

Two caveats on the derived positions: `new_line` values come from the awk hunk arithmetic, so confirm a
hit's line against the diff before it becomes a posted comment; and a removed line whose content starts
with `-- ` is indistinguishable from a `--- ` file header, so a hit's file attribution is worth a glance
when it looks wrong.

#### Execution mode: inline or fan-out

Pick based on the diff size measured in Step 1:

- **Inline** — under ~300 changed lines and ~5 files: review in the main context. Spawning subagents for a small diff is pure overhead — but inline mode must still earn the coverage guarantee fan-out gets for free from one-agent-per-dimension, so do **not** review "the diff" as one undifferentiated pass. Walk the **same dimension table** as fan-out (below), one dimension at a time and in that order: read that dimension's rule file, apply **every bullet in it** to the diff, and settle that dimension's outcome before starting the next. A dimension is done only when each of its bullets has been either turned into a finding or consciously cleared. Record the per-dimension outcome as you go — `clean`, a finding count, or `not reviewed` + why — because Step 4.4 has to report it. Then run the full verification pass below.
- **Fan-out** — anything larger: launch parallel review subagents with the Agent tool, **all in a single message** so they run concurrently — one per applicable dimension. Two per-spawn fields make the running agents tellable apart, and both matter: `subagent_type` is the name the agent switcher shows, and `description` is the label on the launch list. Set **both** from the row below. If a `mwd-review-*` type is not available in this environment, fall back to `general-purpose` for that dimension — the review is identical, only the switcher label is generic. When a dimension fails its retry, the Step 4.4 coverage line still has to name *which* one went unreviewed.

| Dimension                                                         | `subagent_type`           | `description`                  | Rule file(s)                                                                             | When                                 |
|:------------------------------------------------------------------|:--------------------------|:-------------------------------|:-----------------------------------------------------------------------------------------|:-------------------------------------|
| Correctness & code quality (incl. tests, dependencies, CHANGELOG) | `mwd-review-correctness`  | `Correctness & quality review` | `references/general.md` except the Security and Documentation sections                   | always                               |
| Security                                                          | `mwd-review-security`     | `Security review`              | `references/general.md` — Security section                                               | always                               |
| Documentation & comments                                          | `mwd-review-docs`         | `Docs & comments review`       | `references/general.md` — Documentation & comments section                               | always                               |
| Language conventions                                              | `mwd-review-language`     | `<Language> conventions review` — name the detected language, e.g. `TypeScript conventions review` | the detected `references/typescript.md` / `react.md` / `java.md` / `python.md` / `go.md` | per detected language                |
| Device runtime                                                    | `mwd-review-device`       | `Device runtime review`        | `references/device-runtime.md`                                                            | when the Step 2 device triggers match |
| Platform scripts                                                  | `mwd-review-platform-scripts` | `Platform scripts review`  | `references/platform-scripts.md`                                                          | when the diff touches `.sh` / `.ps1` / `.brs` / `.bat` / `.cs` |

Those agent types carry the invariants (own rule file only, account for every pre-scan hit, self-verify, never touch the platform, JSON-only output) but **not** the run's specifics — the spawn prompt is still self-contained per the list below.

Subagents **never** interact with the user or with GitLab/GitHub — no questions, no posting. Everything user-facing — presenting findings (4.1), asking what to post (4.2), posting (4.3), the summary (4.4) — happens **only in the main conversation**, built from the findings the subagents return.

**Each subagent prompt must be self-contained.** Include:

- the temp diff path (`/tmp/mr-<iid>.diff` or `/tmp/pr-<number>.diff`) — and for very large diffs, which file slices this dimension should read;
- the absolute path(s) of its rule file(s) — the agent reads and applies **only** those, bullet by bullet;
- the **pre-scan hits for its rule file(s)** as `file:line:text`, which it must each either raise as a finding or explicitly dismiss with a reason — no hit may go unmentioned in its result;
- the repo root, `HEAD_SHA`, and the change title/description for intent context;
- **for the device-runtime dimension only** — the three build-target facts resolved in Step 2 (real transpile target with the `file:line` it came from, the ES gate and its asserted level or `none`, and polyfill coverage). Resolve them **once in the main context**, not per agent; the agent judges every syntax and lib-API hit against them;
- the finding-capture rules from "For each finding" below (diff position with line types, fix delivery, AI-fix prompt content rules);
- the **self-verification requirement**: before returning, re-read the full current file (not just the hunk) and relevant callers for every candidate finding; drop what wider context already handles; downgrade overstated severity;
- the output contract below.

**Output contract** — each subagent returns **only** a JSON object, no prose and no markdown fences, with one entry in `findings` per surviving finding (`"findings": []` means the dimension is clean — a valid result, not a failure) and one entry in `prescan_dismissed` per pre-scan hit it decided was not a finding:

```json
{
  "findings": [{
    "severity": "CRITICAL | HIGH | MED | LOW",
    "title": "short title",
    "category": "e.g. Security / Documentation / Device Runtime",
    "old_path": "src/foo.ts",
    "new_path": "src/foo.ts",
    "line_type": "added | removed | context",
    "old_line": null,
    "new_line": 42,
    "anchorable": true,
    "description": "what is wrong and why it matters (1-3 sentences)",
    "fix_code": "concrete code showing the fix — the finding's Fix block in the report",
    "suggestion": "replacement line(s) when suggestion-eligible, else null",
    "suggestion_range": "-0+0",
    "ai_prompt": "full AI-fix prompt text per the rules below"
  }],
  "prescan_dismissed": [
    { "hit": "src/foo.ts:42:// accepts any shape", "reason": "match is inside a comment" }
  ]
}
```

**Main-loop merge (after all subagents return):**

1. Parse each result. A subagent returning unparseable output gets **one** retry; if it still fails, report that dimension as "not reviewed" in the Step 4.4 executive summary — never silently drop it. Check that `findings` + `prescan_dismissed` together account for **every** pre-scan hit handed to that dimension; an unaccounted hit is triaged in the main loop rather than dropped.
2. **Dedupe across dimensions** — overlapping rules produce near-duplicates: same file + same/adjacent lines + substantively the same issue → merge into one finding, keeping the highest severity and the most complete fix.
3. **Dedupe against the change** — existing inline comments from Step 1 (previous-run `<!-- mwd-review:` markers, human threads) turn matches into "already raised" (see Verification pass).
4. Assign the final `[SEV-n]` IDs **only now**, after merging, so numbering is stable across 4.1, the posted comments, and 4.4.

#### For each finding

Assign a stable ID — `[CRITICAL-n]`, `[HIGH-n]`, `[MED-n]`, `[LOW-n]`, numbered per severity. The **same ID** is used in the Step 4.1 selection list, the posted comment (title and hidden marker), and the Step 4.4 summary, so the user can cross-reference everywhere. In fan-out mode, subagents do **not** assign IDs — the main loop assigns them after the merge.

In addition to the review text, capture the data needed to post the finding as an inline comment in Step 4:

- **Diff position** — `old_path` and `new_path` (same value unless the file was renamed), plus the line reference tagged by type, taken from the diff:
  - Added line (green `+`) → `new_line` only
  - Removed line (red `-`) → `old_line` only
  - Unchanged context line → both `old_line` and `new_line`
  - If a finding cannot be tied to a specific line in the diff, mark it **un-anchorable** — it goes to the chat summary, not the platform.
- **Fix delivery** — decide how the fix ships in the comment:
  - **Inline suggestion block** when the entire fix is a replacement of the anchored line or a small contiguous range (≤ ~5 lines) on the **new side** of the diff (`new_line` is set). Both GitLab and GitHub render suggestion blocks the author applies with one click in the platform UI (fence syntax differs — see Step 4.3).
  - **AI-fix prompt** for everything else (multi-line rewrites, multi-file changes, dependency bumps, refactors).
  - **Both** when a mechanical local edit is only part of a wider fix (e.g., swap a literal for an enum via suggestion + bump the dependency via prompt).
- **AI-fix prompt** — a concrete, self-contained instruction an AI coding agent (Claude Code, Cursor, etc.) could paste and act on directly: which file, the location, the problem, the required fix, the suggested implementation (the same snippet as the finding's `fix_code`), and any constraints. Embed the snippet as plain indented lines — never as a nested triple-backtick fence, which would terminate the prompt's outer fence in Step 4.3 — and label it as suggested (verify imports/APIs against the codebase), since review snippets are written without compiling.

#### Verification pass (mandatory, before presenting)

Findings must survive scrutiny before the user ever sees them. In fan-out mode, item 1 runs inside each subagent (its prompt requires it) and items 2–3 run in the main loop during the merge; in inline mode, do all three yourself:

1. **Re-read the evidence** — for each candidate finding, read the full current file (not just the diff hunk) and, where the claim depends on it, the callers/consumers. Drop findings the wider context already handles (e.g., a "missing null check" validated upstream); downgrade severity where the blast radius is smaller than the hunk suggested. State, per surviving finding, the one line of evidence that rules out the "already handled upstream" explanation. A finding with no such line is dropped, not downgraded.
2. **Dedupe against the change** — compare each finding with the inline comments fetched in Step 1. If the same issue was already raised — by a previous run of this skill (an `<!-- mwd-review:` marker on the same file and substantively the same issue, even if the line shifted) or by a human reviewer — it is **not a posting candidate**: keep it for the chat summary, marked "already raised", with a link to the existing thread.
3. **Close out the pre-scan and the dimension list** — every mechanical pre-scan hit is now either a finding or a recorded dismissal with a reason, and every dimension applicable per Step 2 has an outcome (`clean` / n findings / `not reviewed` + why). Resolve any gap here, not by omission: an unreviewed dimension or a vanished hit must reach the Step 4.4 coverage line as such.

Positive "what looks good" notes are review-only — never posting candidates.

---

### Step 4: Confirm & Post Feedback

#### 4.1 Present findings

List every actionable finding in chat using its Step 3 ID so the user can decide what to post. Include the location and a short summary; also show the proposed inline-comment body (or at least its summary) so the user knows exactly what would be posted. Findings marked "already raised" are shown separately and are not selectable.

**In Local mode** nothing can be posted, so present the list as the review result rather than a
selection menu — drop the "proposed inline-comment body", then go straight to Step 4.4.

```
[HIGH-1] <title> — src/foo.ts:42 — <one-line summary>
[MED-1]  <title> — src/bar.ts:10 — <one-line summary>
...
```

#### 4.2 Confirm (batch multi-select)

> **Local mode: skip this step.** There is no platform to post to, so there is nothing to confirm.
> Every finding is `kept`. Do not ask the user which findings to post — go to Step 4.4.

Ask the user **once** which findings to post — do **not** confirm findings one at a time. Posting is strictly **opt-in**: only findings the user *explicitly selects* are posted.

- Preferred: use the `AskUserQuestion` tool with `multiSelect: true`, one option per finding. Note its limit of **4 options per question** and **4 questions per call** (≈12 findings); group findings across questions when needed.
- If there are more findings than fit, ask in plain text instead: "Reply with the IDs to post (e.g. `HIGH-1, MED-2`), or `all` / `none`."

**Empty selection or Skip = post nothing.** If the user selects no findings, presses **Skip** / dismisses the prompt, replies `none`, or gives an empty or ambiguous answer, the approved set is **empty**: post **nothing** to the platform, skip Step 4.3 entirely, and go straight to the chat summary in Step 4.4 (every finding is then "kept in chat"). Never post a finding the user did not explicitly select — do **not** fall back to posting "the important ones", the high-severity ones, or any other default subset. When in doubt, post nothing and ask again.

Findings the user does not select — and any un-anchorable or already-raised findings — are **not** posted; they go to the chat summary in Step 4.4.

#### 4.3 Post approved findings as inline comments

> **Local mode: this step never runs.** Local mode has no URL, no platform reference and no
> authenticated CLI target. Do not post, comment, approve, or write to GitLab/GitHub in any form —
> not even if the repo has a remote you could resolve a project from, and not even if the user asks
> mid-run. If they want findings posted, that is a new run against the MR/PR URL.

**Precondition:** run this step only if the user explicitly selected **at least one** finding in Step 4.2. If the approved set is empty (nothing selected, or the user skipped/dismissed), post **nothing** and go straight to Step 4.4. Before posting, state exactly which findings (by ID) and how many you are about to post — e.g. "Posting 2 of 5 findings inline: HIGH-1, MED-2" — so the count is visible and never silently exceeds the selection.

Post one comment per approved finding as an **inline diff comment** on the exact line, using the post
recipe in the platform reference you loaded in Step 0 (§"Step 4.3"). That reference gives the exact
`glab`/`gh` call, the line-type/side variants, the success check, and the fallback ladder. The comment
**body** described below is identical on both platforms — only the API call and the suggestion-fence
syntax differ.

**Comment body format** — the first line is a hidden marker `<!-- mwd-review:<ID>:<file>:<line> -->` followed by a blank line (HTML comments don't render in GitLab or GitHub markdown; the marker lets future runs recognize and dedupe this finding). Then the finding (severity+ID, title, **Category**, and what's wrong), an optional **suggestion block**, then a **collapsible** section (both GitLab and GitHub Flavored Markdown support `<details>`/`<summary>`) holding a copy-ready AI prompt inside a fenced code block (both platforms render a one-click copy button on code blocks). The prompt **must include the suggested code fix** — the same snippet as the finding's `fix_code` — embedded as plain indented lines: a nested triple-backtick fence would terminate the outer `text` fence, break rendering, and truncate what the copy button copies. The trailing `\` after the title line is a hard line break, so **Category** renders directly beneath the title; the blank lines around `<summary>` and before `</details>` are required so the fenced block renders (the `suggestion:-0+0` fence below is the **GitLab** form — on GitHub use a plain `suggestion` fence, see the suggestion rules):

````markdown
<!-- mwd-review:HIGH-1:src/foo.ts:42 -->

**[HIGH-1] <short title>**\
**Category:** <e.g., DoS & Resource Exhaustion>

<what's wrong and why it matters — 1–3 sentences>

```suggestion:-0+0
<replacement for the anchored line(s) — include ONLY when the fix qualifies per Step 3 "Fix delivery">
```

<details>
<summary>🤖 Copy this AI prompt for your agent to fix this issue</summary>

```text
Fix a code-review finding in `src/foo.ts` around line 42.
Problem: <concise description of the issue>.
Required fix: <concrete, actionable instructions>.
Suggested implementation (verify imports/APIs against the codebase before applying):

    <the finding's fix_code, as plain indented lines — no backtick fences>

Constraints: keep changes minimal and consistent with surrounding code; update/add tests if applicable.
```

</details>
````

**Suggestion block rules** (omit the block entirely when they don't hold):

- Only on comments anchored to the **new side** of the diff (added or context lines — GitLab `new_line` set / GitHub `side:"RIGHT"`). Suggestions cannot attach to removed lines.
- **Fence syntax is platform-specific.** GitLab: `suggestion:-N+M` replaces N lines above through M lines below the anchored line (`-0+0` = just the anchored line). GitHub: a plain `suggestion` fence replaces the anchored line, or the whole `start_line..line` range when the comment itself is multi-line (see the platform reference). Use the form for the detected platform. Either way the block content is the complete replacement for that range, with real indentation.
- The replacement content must never contain a line starting with three backticks.
- When the suggestion fully covers the fix, the `<details>` AI prompt may be omitted to keep the comment small; keep both when the suggestion is only the local part of a wider fix.

**Build and post the comment.** The body is multi-line and contains a `<details>` block and fenced code blocks, so it **cannot** be written with a plain heredoc straight into a JSON string — literal newlines inside a JSON string are invalid. Assemble the body once into a shell variable with a quoted heredoc (below), then hand it to the platform reference's §"Step 4.3" recipe, which builds the JSON with `jq -n --arg` (safely escaping newlines, backticks, quotes) and POSTs it via the platform CLI:

````bash
# Assemble the multi-line markdown body (marker + finding + optional suggestion + collapsible AI prompt).
# The suggestion fence below is the GitLab form (suggestion:-0+0); on GitHub use a plain `suggestion` fence.
# Then feed "$BODY" into the platform reference's Step 4.3 recipe (jq build + CLI POST + verify).
BODY=$(cat <<'EOF'
<!-- mwd-review:HIGH-1:src/foo.ts:42 -->

**[HIGH-1] <short title>**\
**Category:** <e.g., DoS & Resource Exhaustion>

<what's wrong and why it matters>

```suggestion:-0+0
<replacement line(s) — only when the fix qualifies>
```

<details>
<summary>🤖 Copy this AI prompt for your agent to fix this issue</summary>

```text
Fix a code-review finding in `src/foo.ts` around line 42.
Problem: <concise description>.
Required fix: <concrete instructions>.
Suggested implementation (verify imports/APIs against the codebase before applying):

    <fix snippet as plain indented lines — no backtick fences>

Constraints: keep changes minimal and consistent with surrounding code; update/add tests if applicable.
```

</details>
EOF
)
````

**Anchoring, verifying, and the fallback ladder are platform-specific** — follow the loaded platform
reference (§"Step 4.3"):

- **GitLab** anchors with a nested `position` object (base/head/start SHAs + `old_line`/`new_line` by
  line type) and must be a `DiffNote`; the summary link is `<mr-url>#note_<note_id>`.
- **GitHub** anchors with `commit_id` + `path` + `line` + `side` (`RIGHT`=new side, `LEFT`=old side);
  the response's `html_url` is the summary link.

In both cases: verify each post landed as a real inline comment (not a plain discussion/issue note),
record its direct link for the Step 4.4 summary, and if a line cannot be positioned walk the
reference's fallback ladder (alternate anchor → file-level comment → ask the user). Never silently
downgrade an inline-only finding to a plain comment without asking.

**Clean up** the diff temp files after all inline comments are posted (use whichever names Step 1
created). Do this **after** Step 4.4's report payload is written, or simply leave it to the end of the
run — nothing below needs the diff:

```bash
rm -f /tmp/mr-inline-comment.json /tmp/pr-inline-comment.json /tmp/mr-*.diff /tmp/pr-*.diff /tmp/mr-*.added /tmp/pr-*.added /tmp/mwd-review-report.json
```

#### 4.4 HTML report, then the final chat summary

Two outputs close the run, in this order: the **HTML report** (so the summary can link to it), then the
**chat summary**. Both are local — neither is posted to GitLab/GitHub.

##### 4.4.a Write the HTML report

Every run — including one where the user posted nothing — is recorded in a persistent local archive at
`~/.claude/code-review-reports/`, so the reports build up into a log of every review this skill has
ever done. **Read `references/report.md` now** for the full payload schema and the archive layout.

1. Assemble the payload and write it to `/tmp/mwd-review-report.json` **with the Write tool**, not a
   heredoc — the values contain code, backticks, and newlines.
2. It must contain **every** finding, not just the posted ones: `status` is `posted` (with
   `posted_url`), `kept`, or `already_raised` (with `thread_url`). Carry `fix_code` and `ai_prompt`
   verbatim — the report's copy button is how the user gets the prompt for a finding that was never
   posted. `coverage` and `prescan` mirror the Coverage line below exactly.
3. Render it:

```bash
node "$SKILL_DIR/scripts/render-report.js" /tmp/mwd-review-report.json
```

**In Local mode** the report is written exactly as always — it is local output, so nothing about it
changes. Only the payload's identity fields come from git instead of the platform:

- `"platform": "local"` — the renderer labels the page `Local`, titles it `Branch <name>` instead of
  `MR !<id>`, and names the file `local-<branch>-<stamp>.html`;
- `project` from the `origin` remote path, or the repo directory name when there is no remote;
- `change_id` the **branch name** (that is what `local-` is prefixed to);
- `host` from the remote host when there is one, so the archive still nests under the right project;
  omit it with no remote and the renderer files the review under `local/`;
- `branch` as `{ source: <branch>, target: <base-ref> }`;
- **`url` omitted**, so the page renders no dead "Open MR/PR" link.

Every finding's `status` is `kept`; `posted_url` and `thread_url` never appear.

The script writes the report, appends it to the archive manifest, regenerates the archive index, and
prints `REPORT`, `REPORT_URL`, `INDEX`, `INDEX_URL`, `REVIEWS`.

**Always print `REPORT_URL` verbatim in the summary below — every run, without exception.** It is a
clickable `file://` link to that run's own report, and it is the only place the full findings live now
that the chat summary is a table. Never replace it with a pointer to `/mwd-review-report`, never
paraphrase it as "the report was written to the archive", and never leave the user to go looking for
it. Mentioning that `/mwd-review-report` reopens the newest report is fine **in addition to** the
link, never instead of it. **Do not open the report in a browser** — print the link and let the user
click.

If rendering fails, say so in one line in the summary and carry on; a failed report never blocks the
review output.

##### 4.4.b Final chat summary

Close the run with a **short** summary **in chat only** — do not post it to GitLab/GitHub. The 4.4.a
report already holds every finding in full (description, fix code, AI prompt), so this summary is a
one-screen manifest that points at it, **never a second copy of the review**. Render it as normal
markdown — no outer copy-paste fence, and no code blocks anywhere in it. Every finding appears exactly
once, as a **single table row**, whether it was posted or kept.

**This brevity is scoped to the chat summary and nothing else.** The inline comments posted in 4.3 and
the HTML report written in 4.4.a stay **full-length** — full description, suggestion block, and the
complete AI-fix prompt with its code snippet, exactly as those steps specify. Never trim a posted
comment or a report entry to match the style below. Layout:

### Executive Summary
[2-3 sentences: overall assessment, number of critical/high findings, primary areas of concern. Include the CI status (e.g., "CI: failed") and, for large changes, name any files that could not be reviewed.]

**Verdict:** [APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES]

**Coverage:** one compact line naming **every** dimension applicable per Step 2, each with `clean`, a finding count, or `not reviewed` + reason — in **both** execution modes, so a small change is auditable exactly like a large one. End it with the pre-scan tally. A dimension that is silently absent is the failure this line exists to prevent.

`Correctness ✓ · Security ✓ · Docs ✓ · TypeScript (2) · Device runtime (1, target swc es5) · Platform scripts ✓ · pre-scan: 7 hits → 2 raised, 5 dismissed`

When the device dimension ran, name the resolved build target in its entry as above — a device
review judged against an unstated target is not auditable.

**Report:** the `REPORT_URL` from 4.4.a **in full and unabbreviated** — this line is mandatory on every
run — plus the `INDEX_URL` for the full archive:
`file:///Users/you/.claude/code-review-reports/reports/gitlab.com/group/repo/mr-482-20260809-141203.html` (all reviews: `…/index.html`)

### Posted inline (n)

**Local mode: omit this section entirely** — nothing was posted, so an empty "Posted inline (0)"
heading is noise. Every finding goes under "Kept in chat" with `local run` as the reason, and the
executive summary opens by naming the branch and base (`Local review of feat/queue vs origin/master`)
so the report is not mistaken for an MR review.

| ID | Finding | Location | Category | Thread |
|:---|:--------|:---------|:---------|:-------|
| HIGH-1 | Unbounded retry loop | `src/api.ts:42` | DoS & Resource Exhaustion | [note](<mr-url>#note_1) |
| MED-1 | Missing null guard | `src/ui.tsx:10` | Correctness | [note](<mr-url>#note_2) — file-level fallback |

### Kept in chat (n)

| ID | Finding | Location | Category | Why not posted |
|:---|:--------|:---------|:---------|:---------------|
| MED-2 | Duplicate fetch per render | `src/a.ts:88` | Efficiency | not selected |
| LOW-1 | Stale JSDoc on `parse()` | `src/b.ts:12` | Docs | un-anchorable |
| LOW-2 | Unhandled reject path | `src/c.ts:5` | Correctness | already raised — [thread](<url>) |

Table rules:
- **ID** without brackets; severity is readable from the prefix, so no separate severity column.
- **Finding** is a noun phrase of ≤ ~8 words — not a sentence, not the description.
- Never add a Description or Fix column, and never inline a code snippet: that detail is what the report is for.
- Skip an empty group's table entirely and say it in one line instead ("Nothing posted — all 3 findings kept in chat.").
- A posted finding that needed a non-inline anchor notes the fallback level in the Thread cell, as above.

### What looks good
[One line, only if there is genuinely something to name. Omit the section otherwise.]

**On demand only:** if the user then asks about a specific ID, print that one finding in full — file
and line(s), category, description, and its `fix_code` in a fenced block. Never volunteer these blocks
for the whole set; that is the long output this summary replaces.

---

### Step 5: If the user redirects to "fix these locally instead of posting"

This happens on most runs, often mid-way through the Step 4 confirmation. Treat it as a scoped edit
task, not a licence to improve the file:

- Touch only the lines the finding names. No adjacent refactors, no renames, no new helpers.
- **Add no JSDoc and no inline comments** unless the finding itself was "missing/wrong docs".
- One CHANGELOG line per user-visible fix, under 120 characters. Never one per finding.
- Report as a table: finding → `file:line` → what changed. No per-file narration.
- Nothing is posted to GitLab/GitHub once the user has redirected — the review stays local.
- In Local mode this is simply the expected next step, not a redirect: the same rules apply.
