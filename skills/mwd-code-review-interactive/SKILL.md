---
name: mwd-code-review-interactive
description: Interactive code review on a GitLab merge request or GitHub pull request — generate feedback, confirm with the user which findings to post, and post approved ones as inline diff comments via glab or gh (auto-detected from the repo URL). Use when the user asks to interactively review an MR/PR and post comments.
argument-hint: "[merge-request-or-pull-request-url]"
disable-model-invocation: true
---

# Interactive Code Review for GitLab MRs & GitHub PRs

Perform an **interactive** code review on the merge request / pull request at $ARGUMENTS. Generate
feedback exactly as a normal review, then confirm with the user which findings to post and post the
approved ones as **inline diff comments**. Rejected or un-postable findings stay in a final chat
summary — nothing else is written to the platform.

The skill supports **both GitLab (via `glab`) and GitHub (via `gh`)**. The review logic (Steps 2–3)
is identical on both; only the fetch (Step 1) and post (Step 4.3) plumbing differs, and that lives in
a per-platform reference file. Throughout this document, **the change** means the MR or PR under
review.

## Workflow

**Tooling (PATH safety):** Do not assume `glab`, `gh`, or `jq` are on `PATH`. Each bash block runs in
a fresh, minimally-initialized shell (no environment shared between blocks), so every block resolves
tool paths up front via `command -v` with a fallback (`/opt/homebrew/bin/…`, `/usr/bin/jq`) and fails
fast if a tool is missing. Always call the resolved `"$GLAB"` / `"$GH"` / `"$JQ"` variables.

### Step 0: Detect the platform

Look at the host in the change URL and pick the platform — this decides which CLI and which reference
file the rest of the run uses:

| URL host | Platform | CLI | Terminology | Plumbing reference |
|:---------|:---------|:----|:------------|:-------------------|
| `github.com` (or a GitHub Enterprise host) | GitHub | `gh` | pull request (PR), number, review comments | `references/platform-github.md` |
| `gitlab.com` or a self-hosted GitLab | GitLab | `glab` | merge request (MR), IID, discussions | `references/platform-gitlab.md` |

If the URL alone is ambiguous (e.g. a self-hosted host you don't recognize), check the path shape
(`/-/merge_requests/<n>` ⇒ GitLab, `/pull/<n>` ⇒ GitHub); if still unclear, ask the user. **Read the
matching platform reference now** — Steps 1 and 4.3 below delegate all the concrete `glab`/`gh`
commands to it. Confirm the CLI is authenticated (`gh auth status` / `glab auth status`) if a fetch
fails with an auth error.

### Step 1: Fetch the change details

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

### Step 2: Contextual Analysis

**Identify the review rules.** The checklists live in this skill's `references/` directory (paths relative to this SKILL.md). Decide the execution mode first (see Step 3): in **inline mode**, read the applicable files yourself now; in **fan-out mode**, only detect which apply — each subagent reads its own rule file(s), so do not load them all into the main context. Applicability:

- `references/general.md` — **always** (code quality, documentation & comment accuracy, correctness, architecture, logging, tests, dependencies, CHANGELOG, security).
- The language files matching the diff, detected from file extensions: `references/typescript.md` (`.ts` / Node.js), `references/react.md` (`.tsx` / React — read together with typescript.md), `references/java.md`, `references/python.md`, `references/go.md`.
- `references/device-runtime.md` — when the change touches code that runs on signage devices (Tizen, webOS, BrightSign, embedded Linux). Triggers: imports from `@signageos/front-applet`/`@signageos/front-display`, `tizen`/`webos`/`brightsign` in paths or configs, a browserslist targeting old Chromium/WebKit, applet or player-runtime directories. When unsure, read it — most changes in this ecosystem ship to devices.

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

#### Execution mode: inline or fan-out

Pick based on the diff size measured in Step 1:

- **Inline** — under ~300 changed lines and ~5 files: review in the main context. Read the rule files identified in Step 2 yourself, apply them all to the diff, and run the full verification pass below. Spawning subagents for a small diff is pure overhead.
- **Fan-out** — anything larger: launch parallel review subagents (Agent tool, `general-purpose`), **all in a single message** so they run concurrently — one per applicable dimension:

| Dimension                                                         | Rule file(s)                                                                             | When                                 |
|:------------------------------------------------------------------|:-----------------------------------------------------------------------------------------|:-------------------------------------|
| Correctness & code quality (incl. tests, dependencies, CHANGELOG) | `references/general.md` except the Security and Documentation sections                   | always                               |
| Security                                                          | `references/general.md` — Security section                                               | always                               |
| Documentation & comments                                          | `references/general.md` — Documentation & comments section                               | always                               |
| Language conventions                                              | the detected `references/typescript.md` / `react.md` / `java.md` / `python.md` / `go.md` | per detected language                |
| Device runtime                                                    | `references/device-runtime.md`                                                            | when the Step 2 device triggers match |

Subagents **never** interact with the user or with GitLab/GitHub — no questions, no posting. Everything user-facing — presenting findings (4.1), asking what to post (4.2), posting (4.3), the summary (4.4) — happens **only in the main conversation**, built from the findings the subagents return.

**Each subagent prompt must be self-contained.** Include:

- the temp diff path (`/tmp/mr-<iid>.diff` or `/tmp/pr-<number>.diff`) — and for very large diffs, which file slices this dimension should read;
- the absolute path(s) of its rule file(s) — the agent reads and applies **only** those;
- the repo root, `HEAD_SHA`, and the change title/description for intent context;
- the finding-capture rules from "For each finding" below (diff position with line types, fix delivery, AI-fix prompt content rules);
- the **self-verification requirement**: before returning, re-read the full current file (not just the hunk) and relevant callers for every candidate finding; drop what wider context already handles; downgrade overstated severity;
- the output contract below.

**Output contract** — each subagent returns **only** a JSON array, no prose and no markdown fences, one object per surviving finding (an empty array means the dimension is clean — a valid result, not a failure):

```json
[{
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
  "fix_code": "concrete code for the chat summary's Fix block",
  "suggestion": "replacement line(s) when suggestion-eligible, else null",
  "suggestion_range": "-0+0",
  "ai_prompt": "full AI-fix prompt text per the rules below"
}]
```

**Main-loop merge (after all subagents return):**

1. Parse each result. A subagent returning unparseable output gets **one** retry; if it still fails, report that dimension as "not reviewed" in the Step 4.4 executive summary — never silently drop it.
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
- **AI-fix prompt** — a concrete, self-contained instruction an AI coding agent (Claude Code, Cursor, etc.) could paste and act on directly: which file, the location, the problem, the required fix, the suggested implementation (the same code snippet shown in the chat summary's **Fix:** block), and any constraints. Embed the snippet as plain indented lines — never as a nested triple-backtick fence, which would terminate the prompt's outer fence in Step 4.3 — and label it as suggested (verify imports/APIs against the codebase), since review snippets are written without compiling.

#### Verification pass (mandatory, before presenting)

Findings must survive scrutiny before the user ever sees them. In fan-out mode, item 1 runs inside each subagent (its prompt requires it) and item 2 runs in the main loop during the merge; in inline mode, do both yourself:

1. **Re-read the evidence** — for each candidate finding, read the full current file (not just the diff hunk) and, where the claim depends on it, the callers/consumers. Drop findings the wider context already handles (e.g., a "missing null check" validated upstream); downgrade severity where the blast radius is smaller than the hunk suggested.
2. **Dedupe against the change** — compare each finding with the inline comments fetched in Step 1. If the same issue was already raised — by a previous run of this skill (an `<!-- mwd-review:` marker on the same file and substantively the same issue, even if the line shifted) or by a human reviewer — it is **not a posting candidate**: keep it for the chat summary, marked "already raised", with a link to the existing thread.

Positive "what looks good" notes are review-only — never posting candidates.

---

### Step 4: Confirm & Post Feedback

#### 4.1 Present findings

List every actionable finding in chat using its Step 3 ID so the user can decide what to post. Include the location and a short summary; also show the proposed inline-comment body (or at least its summary) so the user knows exactly what would be posted. Findings marked "already raised" are shown separately and are not selectable.

```
[HIGH-1] <title> — src/foo.ts:42 — <one-line summary>
[MED-1]  <title> — src/bar.ts:10 — <one-line summary>
...
```

#### 4.2 Confirm (batch multi-select)

Ask the user **once** which findings to post — do **not** confirm findings one at a time. Posting is strictly **opt-in**: only findings the user *explicitly selects* are posted.

- Preferred: use the `AskUserQuestion` tool with `multiSelect: true`, one option per finding. Note its limit of **4 options per question** and **4 questions per call** (≈12 findings); group findings across questions when needed.
- If there are more findings than fit, ask in plain text instead: "Reply with the IDs to post (e.g. `HIGH-1, MED-2`), or `all` / `none`."

**Empty selection or Skip = post nothing.** If the user selects no findings, presses **Skip** / dismisses the prompt, replies `none`, or gives an empty or ambiguous answer, the approved set is **empty**: post **nothing** to the platform, skip Step 4.3 entirely, and go straight to the chat summary in Step 4.4 (every finding is then "kept in chat"). Never post a finding the user did not explicitly select — do **not** fall back to posting "the important ones", the high-severity ones, or any other default subset. When in doubt, post nothing and ask again.

Findings the user does not select — and any un-anchorable or already-raised findings — are **not** posted; they go to the chat summary in Step 4.4.

#### 4.3 Post approved findings as inline comments

**Precondition:** run this step only if the user explicitly selected **at least one** finding in Step 4.2. If the approved set is empty (nothing selected, or the user skipped/dismissed), post **nothing** and go straight to Step 4.4. Before posting, state exactly which findings (by ID) and how many you are about to post — e.g. "Posting 2 of 5 findings inline: HIGH-1, MED-2" — so the count is visible and never silently exceeds the selection.

Post one comment per approved finding as an **inline diff comment** on the exact line, using the post
recipe in the platform reference you loaded in Step 0 (§"Step 4.3"). That reference gives the exact
`glab`/`gh` call, the line-type/side variants, the success check, and the fallback ladder. The comment
**body** described below is identical on both platforms — only the API call and the suggestion-fence
syntax differ.

**Comment body format** — the first line is a hidden marker `<!-- mwd-review:<ID>:<file>:<line> -->` followed by a blank line (HTML comments don't render in GitLab or GitHub markdown; the marker lets future runs recognize and dedupe this finding). Then the finding (severity+ID, title, **Category**, and what's wrong), an optional **suggestion block**, then a **collapsible** section (both GitLab and GitHub Flavored Markdown support `<details>`/`<summary>`) holding a copy-ready AI prompt inside a fenced code block (both platforms render a one-click copy button on code blocks). The prompt **must include the suggested code fix** — the same snippet used in the chat summary's **Fix:** block — embedded as plain indented lines: a nested triple-backtick fence would terminate the outer `text` fence, break rendering, and truncate what the copy button copies. The trailing `\` after the title line is a hard line break, so **Category** renders directly beneath the title; the blank lines around `<summary>` and before `</details>` are required so the fenced block renders (the `suggestion:-0+0` fence below is the **GitLab** form — on GitHub use a plain `suggestion` fence, see the suggestion rules):

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

    <the fix snippet from the chat summary's Fix block, as plain indented lines — no backtick fences>

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

**Clean up** the temp files after all inline comments are posted (use whichever names Step 1 created):

```bash
rm -f /tmp/mr-inline-comment.json /tmp/pr-inline-comment.json /tmp/mr-*.diff /tmp/pr-*.diff
```

#### 4.4 Final chat summary

Produce the final review summary **in chat only** — do not post it to GitLab/GitHub. Per the code-review output convention, present it as a single raw, copy-pasteable fenced markdown block (use a 4-backtick outer fence, since the content contains ` ``` ` code blocks). Use the format below; include both what was posted and what was kept in chat.

First, the **finding block** format — used for **every** finding, whether posted or kept (IDs match Step 4.1):

### [CRITICAL-1] Title
- **File:** `path/to/File.ts`, line(s) X-Y
- **Category:** [e.g., DoS & Resource Exhaustion]
- **Description:** What the issue is and why it matters
- **Fix:**
```ts
// Concrete code showing the fix
```

Severity tags: `[CRITICAL-n]`, `[HIGH-n]`, `[MED-n]`, `[LOW-n]` (attack scenario optional for MED/LOW; LOW may be abbreviated). Then lay the summary out as:

### Executive Summary
[2-3 sentences: overall assessment, number of critical/high findings, primary areas of concern. Include the CI status (e.g., "CI: failed") and, for large changes, name any files that could not be reviewed.]

**Verdict:** [APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES]

### Posted inline
Every finding posted as an inline comment, shown **in full** using the finding block format above — not just a one-line list. Add a `**Posted:**` line to each with the direct link (GitLab `<mr-url>#note_<note_id>`, or the GitHub comment `html_url`) and, if it needed a fallback (non-inline anchor), the fallback level used.

### Kept in chat (not posted)
Findings the user rejected plus any un-anchorable findings, shown **in full** using the finding block format above. List "already raised" findings here too — one line each with a link to the existing thread instead of a full block.

### What looks good
[Acknowledge good patterns and clean code where appropriate, if any]
