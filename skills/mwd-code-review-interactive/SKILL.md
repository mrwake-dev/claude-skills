---
name: mwd-code-review-interactive
description: Interactive code review on a GitLab merge request — generate feedback, confirm with the user which findings to post, and post approved ones as inline diff comments via glab. Use when the user asks to interactively review an MR and post comments.
argument-hint: "[merge-request-url]"
disable-model-invocation: true
---

# Interactive Code Review for GitLab Merge Requests

Perform an **interactive** code review on the merge request at $ARGUMENTS. Generate feedback exactly
as a normal review, then confirm with the user which findings to post to GitLab and post the
approved ones as **inline diff comments**. Rejected or un-postable findings stay in a final chat
summary — nothing else is written to GitLab.

## Workflow

**Tooling (PATH safety):** Do not assume `glab` and `jq` are on `PATH`. Each bash block below runs in a fresh, possibly minimally-initialized shell (no environment shared between blocks), so every block that uses these tools resolves their absolute paths up front via `command -v` with a fallback (`/opt/homebrew/bin/glab`, `/usr/bin/jq`) and fails fast if a tool is missing. Always call the resolved `"$GLAB"` / `"$JQ"` variables — never bare `glab`/`jq`.

### Step 1: Fetch MR Details

Parse the MR URL to extract the project path and MR IID (e.g., `https://gitlab.com/my-group/services/my-service/-/merge_requests/42` → repo `my-group/services/my-service`, IID `42`).

```bash
# Resolve tool path (this block runs in its own shell)
GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"
[ -x "$GLAB" ] || { echo "Required tool not found or not executable: $GLAB" >&2; exit 1; }

# Fetch MR metadata (title, description, author, labels, head pipeline, etc.)
"$GLAB" mr view <iid> -R <group/namespace/repo> -F json

# Save the diff to a temp file — do NOT dump it straight into context (see "Large MRs")
"$GLAB" mr diff <iid> -R <group/namespace/repo> --raw > /tmp/mr-<iid>.diff
wc -l /tmp/mr-<iid>.diff

# Fetch commit history
"$GLAB" api "projects/<url-encoded-project>/merge_requests/<iid>/commits"

# Fetch existing discussions (re-run awareness — see below; follow pagination if 100+ results)
"$GLAB" api "projects/<url-encoded-project>/merge_requests/<iid>/discussions?per_page=100"
```

**URL-encoding**: Replace `/` with `%2F` in the project path (e.g., `my-group/services/my-service` → `my-group%2Fservices%2Fmy-service`).

**Large MRs**: if the saved diff is under ~2,000 lines, read the temp file whole. Otherwise review it file-by-file: list the boundaries with `grep -n '^diff --git' /tmp/mr-<iid>.diff`, then read one file's slice at a time (Read tool with offset/limit, or `sed -n 'START,ENDp'`). If the diff looks truncated (far fewer files than the MR's `changes_count`), check `GET .../merge_requests/<iid>/changes` for `"overflow": true` and fetch the missing files via the paginated `.../merge_requests/<iid>/diffs?per_page=20&page=N` endpoint. Any file that still could not be reviewed must be named in the Step 4.4 executive summary.

**Re-run awareness**: scan the fetched discussions for note bodies starting with `<!-- mwd-review:` — those are findings posted by a previous run of this skill — and note human-raised threads plus their resolved state. The Step 3 verification pass uses this to avoid re-raising anything already on the MR.

**Pipeline status**: capture `.head_pipeline.status` from the MR JSON (`success`, `failed`, `running`, or absent). It goes into the executive summary; if `failed`, connect it to relevant findings where possible.

Also capture the positioning data now — Step 4 needs it to anchor inline comments:

```bash
# Resolve tool paths (this block runs in its own shell)
GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GLAB" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done

MR_JSON=$("$GLAB" mr view <iid> -R <group/namespace/repo> -F json)
BASE_SHA=$(echo "$MR_JSON" | "$JQ" -r '.diff_refs.base_sha')
HEAD_SHA=$(echo "$MR_JSON" | "$JQ" -r '.diff_refs.head_sha')
START_SHA=$(echo "$MR_JSON" | "$JQ" -r '.diff_refs.start_sha')

# URL-encoded project path for API calls
PROJECT_ENCODED=$(echo "$MR_JSON" | "$JQ" -r '.references.full' | sed 's/![0-9]*$//' | "$JQ" -Rr '@uri')
```

### Step 2: Contextual Analysis

**Identify the review rules.** The checklists live in this skill's `references/` directory (paths relative to this SKILL.md). Decide the execution mode first (see Step 3): in **inline mode**, read the applicable files yourself now; in **fan-out mode**, only detect which apply — each subagent reads its own rule file(s), so do not load them all into the main context. Applicability:

- `references/general.md` — **always** (code quality, documentation & comment accuracy, correctness, architecture, logging, tests, dependencies, CHANGELOG, security).
- The language files matching the diff, detected from file extensions: `references/typescript.md` (`.ts` / Node.js), `references/react.md` (`.tsx` / React — read together with typescript.md), `references/java.md`, `references/python.md`, `references/go.md`.
- `references/device-runtime.md` — when the MR touches code that runs on signage devices (Tizen, webOS, BrightSign, embedded Linux). Triggers: imports from `@signageos/front-applet`/`@signageos/front-display`, `tizen`/`webos`/`brightsign` in paths or configs, a browserslist targeting old Chromium/WebKit, applet or player-runtime directories. When unsure, read it — most MRs in this ecosystem ship to devices.

Then gather context:

1. **Read surrounding code** — for any modified file, examine the broader context (imports, class structure, related interfaces/types) to understand existing patterns and conventions in the project.
2. **Check for broken contracts** — if public APIs, interfaces, or shared types are modified, verify that all consumers are updated accordingly.

Check the MR description for completeness:
- Is there a clear description of what changed and why?
- Is the standard MR template filled in (classification, ClickUp task, checklists)?

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

Subagents **never** interact with the user or with GitLab — no questions, no posting. Everything user-facing — presenting findings (4.1), asking what to post (4.2), posting (4.3), the summary (4.4) — happens **only in the main conversation**, built from the findings the subagents return.

**Each subagent prompt must be self-contained.** Include:

- the temp diff path (`/tmp/mr-<iid>.diff`) — and for very large diffs, which file slices this dimension should read;
- the absolute path(s) of its rule file(s) — the agent reads and applies **only** those;
- the repo root, `HEAD_SHA`, and the MR title/description for intent context;
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
3. **Dedupe against the MR** — existing discussions from Step 1 (previous-run `<!-- mwd-review:` markers, human threads) turn matches into "already raised" (see Verification pass).
4. Assign the final `[SEV-n]` IDs **only now**, after merging, so numbering is stable across 4.1, the posted comments, and 4.4.

#### For each finding

Assign a stable ID — `[CRITICAL-n]`, `[HIGH-n]`, `[MED-n]`, `[LOW-n]`, numbered per severity. The **same ID** is used in the Step 4.1 selection list, the posted comment (title and hidden marker), and the Step 4.4 summary, so the user can cross-reference everywhere. In fan-out mode, subagents do **not** assign IDs — the main loop assigns them after the merge.

In addition to the review text, capture the data needed to post the finding as an inline comment in Step 4:

- **Diff position** — `old_path` and `new_path` (same value unless the file was renamed), plus the line reference tagged by type, taken from the diff:
  - Added line (green `+`) → `new_line` only
  - Removed line (red `-`) → `old_line` only
  - Unchanged context line → both `old_line` and `new_line`
  - If a finding cannot be tied to a specific line in the diff, mark it **un-anchorable** — it goes to the chat summary, not GitLab.
- **Fix delivery** — decide how the fix ships in the comment:
  - **GitLab suggestion block** when the entire fix is a replacement of the anchored line or a small contiguous range (≤ ~5 lines) on the **new side** of the diff (`new_line` is set). The author applies it with one click in the GitLab UI.
  - **AI-fix prompt** for everything else (multi-line rewrites, multi-file changes, dependency bumps, refactors).
  - **Both** when a mechanical local edit is only part of a wider fix (e.g., swap a literal for an enum via suggestion + bump the dependency via prompt).
- **AI-fix prompt** — a concrete, self-contained instruction an AI coding agent (Claude Code, Cursor, etc.) could paste and act on directly: which file, the location, the problem, the required fix, the suggested implementation (the same code snippet shown in the chat summary's **Fix:** block), and any constraints. Embed the snippet as plain indented lines — never as a nested triple-backtick fence, which would terminate the prompt's outer fence in Step 4.3 — and label it as suggested (verify imports/APIs against the codebase), since review snippets are written without compiling.

#### Verification pass (mandatory, before presenting)

Findings must survive scrutiny before the user ever sees them. In fan-out mode, item 1 runs inside each subagent (its prompt requires it) and item 2 runs in the main loop during the merge; in inline mode, do both yourself:

1. **Re-read the evidence** — for each candidate finding, read the full current file (not just the diff hunk) and, where the claim depends on it, the callers/consumers. Drop findings the wider context already handles (e.g., a "missing null check" validated upstream); downgrade severity where the blast radius is smaller than the hunk suggested.
2. **Dedupe against the MR** — compare each finding with the discussions fetched in Step 1. If the same issue was already raised — by a previous run of this skill (an `<!-- mwd-review:` marker on the same file and substantively the same issue, even if the line shifted) or by a human reviewer — it is **not a posting candidate**: keep it for the chat summary, marked "already raised", with a link to the existing thread.

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

**Empty selection or Skip = post nothing.** If the user selects no findings, presses **Skip** / dismisses the prompt, replies `none`, or gives an empty or ambiguous answer, the approved set is **empty**: post **nothing** to GitLab, skip Step 4.3 entirely, and go straight to the chat summary in Step 4.4 (every finding is then "kept in chat"). Never post a finding the user did not explicitly select — do **not** fall back to posting "the important ones", the high-severity ones, or any other default subset. When in doubt, post nothing and ask again.

Findings the user does not select — and any un-anchorable or already-raised findings — are **not** posted; they go to the chat summary in Step 4.4.

#### 4.3 Post approved findings as inline comments

**Precondition:** run this step only if the user explicitly selected **at least one** finding in Step 4.2. If the approved set is empty (nothing selected, or the user skipped/dismissed), post **nothing** and go straight to Step 4.4. Before posting, state exactly which findings (by ID) and how many you are about to post — e.g. "Posting 2 of 5 findings inline: HIGH-1, MED-2" — so the count is visible and never silently exceeds the selection.

Post one comment per approved finding using the GitLab Discussions API. This places the comment on the exact diff line, just like the GitLab UI.

**Comment body format** — the first line is a hidden marker `<!-- mwd-review:<ID>:<file>:<line> -->` followed by a blank line (HTML comments don't render in GitLab; the marker lets future runs recognize and dedupe this finding). Then the finding (severity+ID, title, **Category**, and what's wrong), an optional **suggestion block**, then a **collapsible** section (GitLab Flavored Markdown supports `<details>`/`<summary>`) holding a copy-ready AI prompt inside a fenced code block (GitLab renders a one-click copy button on code blocks). The prompt **must include the suggested code fix** — the same snippet used in the chat summary's **Fix:** block — embedded as plain indented lines: a nested triple-backtick fence would terminate the outer `text` fence, break rendering, and truncate what the copy button copies. The trailing `\` after the title line is a hard line break, so **Category** renders directly beneath the title; the blank lines around `<summary>` and before `</details>` are required so the fenced block renders:

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

- Only on comments anchored to the **new side** of the diff (`new_line` set — added or context lines). Suggestions cannot attach to removed lines.
- `suggestion:-N+M` replaces N lines above through M lines below the anchored line (`-0+0` = just the anchored line). The block content is the complete replacement for that range, with real indentation.
- The replacement content must never contain a line starting with three backticks.
- When the suggestion fully covers the fix, the `<details>` AI prompt may be omitted to keep the comment small; keep both when the suggestion is only the local part of a wider fix.

**Build and post the comment.** The body is multi-line and contains a `<details>` block and fenced code blocks, so it **cannot** be written with a plain heredoc straight into a JSON string — literal newlines inside a JSON string are invalid. Build the JSON with `jq -n --arg` so the body is safely escaped (newlines, backticks, quotes), then post with `--input` + `-H "Content-Type: application/json"`.

**CRITICAL**: The `glab api -f` flag does **NOT** support nested objects. You **MUST** use `--input` with a JSON file and `-H "Content-Type: application/json"` to send the nested `position` object. Without this, GitLab silently drops the position and creates a regular comment instead of a diff note. Both `old_path` and `new_path` are **always required** — use the same value if the file was not renamed.

````bash
# 0) Resolve tool paths (this block runs in its own shell)
GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GLAB" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done

# 1) Assemble the multi-line markdown body (marker + finding + optional suggestion + collapsible AI prompt)
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

# 2) Build valid JSON with jq (safely escapes newlines/backticks/quotes).
#    This example targets an ADDED line (new_line only). See variants below.
"$JQ" -n --arg body "$BODY" \
  --arg base "$BASE_SHA" --arg head "$HEAD_SHA" --arg start "$START_SHA" \
  --arg op "src/foo.ts" --arg np "src/foo.ts" \
  '{body:$body, position:{position_type:"text", base_sha:$base, head_sha:$head, start_sha:$start, old_path:$op, new_path:$np, new_line:42}}' \
  > /tmp/mr-inline-comment.json

# 3) Post the inline comment and capture the response
RESPONSE=$("$GLAB" api "projects/$PROJECT_ENCODED/merge_requests/<iid>/discussions" \
  -X POST -H "Content-Type: application/json" --input /tmp/mr-inline-comment.json)

# 4) Verify + collect the note id for the summary link
echo "$RESPONSE" | "$JQ" -r '.notes[0] | "type=\(.type) note_id=\(.id)"'
````

**Line-type variants** — only the `position` object changes; keep the rest of the `jq` call identical:

- **Added line** (green `+`): `new_line` only — `..., new_line:42`
- **Removed line** (red `-`): `old_line` only — `..., old_line:38`
- **Unchanged context line**: both — `..., old_line:40, new_line:42`
- **Renamed files**: set `old_path` (`$op`) to the previous filename and `new_path` (`$np`) to the new one.

**Verify success**: the response must contain `"type": "DiffNote"` and a `"position"` object. Record each `note_id` — the summary links every posted finding as `<mr-url>#note_<note_id>`. If you see `"type": "DiscussionNote"` with no position, the request format was wrong — fix and retry.

**Fallback ladder** — when the POST returns 400 (GitLab rejects lines it cannot position) or the verify check fails:

1. Retry with the alternate line-type variant (e.g., you sent `new_line` only for what is actually a context line → send both `old_line` and `new_line`, or vice versa). Double-check the line numbers against the diff hunk header.
2. Retry as a **file-level comment**: replace the line fields with `position_type:"file"` (keep both paths and all three SHAs) and prepend the intended `file:line` reference to the body text. Drop any suggestion block — suggestions require a line anchor.
3. If that also fails, do **not** silently post a plain non-inline discussion — the skill promises inline-only. Ask the user whether to post it as a regular MR comment or keep it in chat. In the summary, state which fallback level each posted finding ended up at.

**Clean up** the temp files after all inline comments are posted:

```bash
rm -f /tmp/mr-inline-comment.json /tmp/mr-<iid>.diff
```

#### 4.4 Final chat summary

Produce the final review summary **in chat only** — do not post it to GitLab. Per the code-review output convention, present it as a single raw, copy-pasteable fenced markdown block (use a 4-backtick outer fence, since the content contains ` ``` ` code blocks). Use the format below; include both what was posted and what was kept in chat.

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
[2-3 sentences: overall assessment, number of critical/high findings, primary areas of concern. Include the head pipeline status (e.g., "CI: failed") and, for large MRs, name any files that could not be reviewed.]

**Verdict:** [APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES]

### Posted inline to GitLab
Every finding posted as an inline comment, shown **in full** using the finding block format above — not just a one-line list. Add a `**Posted:**` line to each with the direct link (`<mr-url>#note_<note_id>`) and, if it was not a clean DiffNote, the fallback level used.

### Kept in chat (not posted)
Findings the user rejected plus any un-anchorable findings, shown **in full** using the finding block format above. List "already raised" findings here too — one line each with a link to the existing discussion instead of a full block.

### What looks good
[Acknowledge good patterns and clean code where appropriate, if any]
