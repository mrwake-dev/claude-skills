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
  grep -lE '"[^"]*(front-applet|front-display|lib-bundler)"' package.json                        # device runtime deps
  grep -E '^\+\+\+ ' "$DIFF" | grep -iE 'tizen|webos|brightsign|applet|player'                   # device paths in the diff
  ls .swcrc .browserslistrc rspack.config.* webpack*.config.* tools/build.mjs 2>/dev/null        # a bundler with a transpile target
  ```

  Any hit turns the dimension on. Otherwise fall back to the prose triggers — applet or player-runtime directories, a browserslist targeting old Chromium/WebKit — and when still unsure, apply it: most changes in this ecosystem ship to devices.

  **When it applies, resolve the build target before reviewing anything** — follow "Resolve the target first" in `references/device-runtime.md` and record all three facts (real transpile target with its `file:line`, the ES gate and its asserted level or `none`, polyfill coverage). `tsconfig.json` `target` is not authoritative. In fan-out mode these go into the device agent's spawn prompt; in inline mode you use them yourself. Every syntax and lib-API hit is triaged against them.
- `references/platform-scripts.md` — when the diff touches platform scripting: `.sh`/`.bash`, `.ps1`/`.psm1`/`.psd1`, `.brs`, `.bat`/`.cmd`, `.cs`. These ship to the device or drive its install and recovery, and no language file covers them.

`references/platform-gitlab.md`, `references/platform-github.md`, `references/pre-scan.md`,
`references/posting.md`, and `references/report.md` are plumbing, not checklists — they are read in
Steps 0, 3, 4.3 and 4.4, and never handed to a review subagent.

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

**Read `references/pre-scan.md` now.** It flattens the diff into one record per added line and lists
the grep passes per rule file; run only the passes for the rule files detected in Step 2. **Every hit
must be accounted for**: raise it as a finding or dismiss it with a one-line reason. Step 4.4 reports
the counts.

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

Post one comment per approved finding as an **inline diff comment** on the exact line. **Read
`references/posting.md` now** for the comment body format, the suggestion-block rules, body assembly,
anchoring and cleanup. The API call itself is the platform reference's §"Step 4.3" recipe.

#### 4.4 HTML report, then the final chat summary

Two outputs close the run, in this order: the **HTML report** (so the summary can link to it), then the
**chat summary**. Both are local — neither is posted to GitLab/GitHub. **Read `references/report.md`
now** and follow its 4.4.a section (write and render the report on every run, Local mode included) and
its 4.4.b section (the one-screen chat summary, which always prints `REPORT_URL` verbatim).

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
