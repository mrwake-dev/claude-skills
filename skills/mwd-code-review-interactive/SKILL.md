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

# Fetch MR metadata (title, description, author, labels, etc.)
"$GLAB" mr view <iid> -R <group/namespace/repo> -F json

# Fetch code changes
"$GLAB" mr diff <iid> -R <group/namespace/repo> --raw

# Fetch commit history
"$GLAB" api "projects/<url-encoded-project>/merge_requests/<iid>/commits"
```

**URL-encoding**: Replace `/` with `%2F` in the project path (e.g., `my-group/services/my-service` → `my-group%2Fservices%2Fmy-service`).

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

Check the MR description for completeness:
- Is there a clear description of what changed and why?
- Is the standard MR template filled in (classification, ClickUp task, checklists)?

### Step 2: Contextual Analysis

Before reviewing the diff, gather context:

1. **Identify the primary language/framework** from file extensions in the diff (`.ts`/`.tsx` → TypeScript/React, `.java` → Java, `.py` → Python, `.go` → Go, etc.) and apply the corresponding language-specific rules from Step 3.
2. **Read surrounding code** — for any modified file, examine the broader context (imports, class structure, related interfaces/types) to understand existing patterns and conventions in the project.
3. **Check for broken contracts** — if public APIs, interfaces, or shared types are modified, verify that all consumers are updated accordingly.

Check the MR description for completeness:
- Is there a clear description of what changed and why?
- Is the standard MR template filled in (classification, ClickUp task, checklists)?

Check the commit history:
- Are commit messages descriptive and meaningful?
- Is the history clean and logically structured, or full of "fix", "wip", "asdf"?
- Are commits broken down into logical, self-contained units?

### Step 3: Generate Feedback

Always apply the **General** and **Security** rules regardless of language. Then apply the relevant **language-specific** rules based on the detected language/framework.

#### General (all languages)

- **Code quality and readability**
  - Hardcoded values that should be configurable (magic numbers, URLs, timeouts)
  - Dead code or commented-out code that should be removed
  - Duplicated logic that should be extracted into shared utilities
  - Naming clarity — do names accurately describe intent?
- **Correctness**
  - Does the implementation match the described intent in the MR description?
  - Are there unhandled edge cases or missing error handling?
  - Are error messages informative and actionable?
- **Architecture**
  - Single-purpose components, proper separation of concerns
  - No breaking changes to public APIs without versioning or migration path
  - Environment variables accessed only in entry/config files, not scattered throughout
- **Logging**
  - Are important operations logged at appropriate levels?
  - Is logging too verbose or too sparse?
  - Are sensitive data (tokens, passwords, PII) excluded from logs?
- **Tests**
  - Are new/changed behaviors covered by tests?
  - Do tests follow AAA pattern (Arrange, Act, Assert)?
  - Are external dependencies mocked?
  - Are edge cases and error paths tested?
- **Dependencies**
  - Are new dependencies justified and not duplicating existing functionality?
  - Are dependency versions pinned and free of known vulnerabilities?
- **CHANGELOG**
  - Is there an entry under `[Unreleased]` using Keep a Changelog format?

#### Security (all languages)

- No exposed secrets, API keys, tokens, or credentials in code or config files
- Parameterized queries to prevent SQL/NoSQL injection
- Input validation at all API boundaries (not just SQL — also path traversal, SSRF, header injection)
- Authentication and authorization checks — are access controls present and correct?
- Sensitive data not leaked in logs, error messages, or API responses
- Deserialization of untrusted data handled safely
- CORS configuration is restrictive and intentional
- Rate limiting considered for public-facing endpoints

#### TypeScript / Node.js

- No `any` types; no type assertions (`as`, `<Type>`) — use `zod` schemas or type guards instead
- Correct naming conventions (camelCase for variables/functions, PascalCase for types/classes, UPPER_SNAKE_CASE for constants)
- Custom error classes with `Error` postfix
- Proper async/await usage — no floating promises, proper error propagation
- Microservices/CQRS/event sourcing patterns followed where applicable
- Test files use `*.spec.ts` in `test/` directory

#### React / Frontend

- Functional components only; no `FC` type, no `IOwnProps`
- Named exports only; absolute imports; proper import sorting
- `useNotification` for notifications, `useTranslation` for i18n
- No direct DOM manipulation — use refs or state
- Memoization (`useMemo`, `useCallback`) used appropriately, not excessively
- Accessibility basics (semantic HTML, alt text, keyboard navigation)

#### Java

- **Null safety** — use `Optional` for return types that may be absent; annotate with `@Nullable`/`@NonNull` where applicable; avoid returning `null` from public methods
- **Exception handling** — proper use of checked vs. unchecked exceptions; custom exception hierarchy with meaningful messages; no empty catch blocks; no catching `Exception` or `Throwable` generically
- **Immutability** — prefer `final` fields; use unmodifiable collections (`List.of()`, `Collections.unmodifiableList()`); avoid exposing mutable internal state
- **Concurrency** — thread safety of shared mutable state; proper use of `synchronized`, `volatile`, or concurrent utilities; watch for race conditions and deadlocks
- **Resource management** — `try-with-resources` for `AutoCloseable` resources (streams, connections, readers); no resource leaks
- **Dependency injection** — constructor injection over field injection; avoid `new` for service-layer dependencies
- **Naming and structure** — follow standard Java conventions (PascalCase classes, camelCase methods, UPPER_SNAKE_CASE constants); one public class per file
- **Serialization** — safe deserialization practices; avoid `ObjectInputStream` on untrusted data
- **Logging** — use parameterized logging (`log.info("User {} logged in", userId)`) instead of string concatenation

#### Python

- Type hints on function signatures and return types
- No mutable default arguments (`def foo(items=[])`)
- Proper use of context managers (`with` statements) for resource handling
- Virtual environment and dependency management (requirements pinned)
- Pythonic patterns — list comprehensions over manual loops where appropriate, `pathlib` over `os.path`
- Exception handling — specific exceptions, not bare `except:`

#### Go

- Error handling — all errors checked, no ignored return values; use `fmt.Errorf` with `%w` for wrapping
- Goroutine safety — proper channel usage, no goroutine leaks, context propagation
- Interface design — small interfaces, accept interfaces return structs
- Resource cleanup with `defer`
- Naming follows Go conventions (exported = PascalCase, unexported = camelCase, acronyms uppercase)

#### For each finding

In addition to the review text, capture the data needed to post the finding as an inline comment in Step 4:

- **Diff position** — `old_path` and `new_path` (same value unless the file was renamed), plus the line reference tagged by type, taken from the `glab mr diff` output:
  - Added line (green `+`) → `new_line` only
  - Removed line (red `-`) → `old_line` only
  - Unchanged context line → both `old_line` and `new_line`
  - If a finding cannot be tied to a specific line in the diff, mark it **un-anchorable** — it goes to the chat summary, not GitLab.
- **AI-fix prompt** — a concrete, self-contained instruction an AI coding agent (Claude Code, Cursor, etc.) could paste and act on directly: which file, the location, the problem, the required fix, the suggested implementation (the same code snippet shown in the chat summary's **Fix:** block), and any constraints. Embed the snippet as plain indented lines — never as a nested triple-backtick fence, which would terminate the prompt's outer fence in Step 4.3 — and label it as suggested (verify imports/APIs against the codebase), since review snippets are written without compiling.

Positive "what looks good" notes are review-only — never posting candidates.

---

### Step 4: Confirm & Post Feedback

#### 4.1 Present findings

List every actionable finding as a numbered chat list so the user can decide what to post. Include the location and a short summary; also show the proposed inline-comment body (or at least its summary) so the user knows exactly what would be posted.

```
1. [HIGH] <title> — src/foo.ts:42 — <one-line summary>
2. [MED]  <title> — src/bar.ts:10 — <one-line summary>
...
```

#### 4.2 Confirm (batch multi-select)

Ask the user **once** which findings to post — do **not** confirm findings one at a time. Posting is strictly **opt-in**: only findings the user *explicitly selects* are posted.

- Preferred: use the `AskUserQuestion` tool with `multiSelect: true`, one option per finding. Note its limit of **4 options per question** and **4 questions per call** (≈12 findings); group findings across questions when needed.
- If there are more findings than fit, ask in plain text instead: "Reply with the numbers to post (e.g. `1,3,5`), or `all` / `none`."

**Empty selection or Skip = post nothing.** If the user selects no findings, presses **Skip** / dismisses the prompt, replies `none`, or gives an empty or ambiguous answer, the approved set is **empty**: post **nothing** to GitLab, skip Step 4.3 entirely, and go straight to the chat summary in Step 4.4 (every finding is then "kept in chat"). Never post a finding the user did not explicitly select — do **not** fall back to posting "the important ones", the high-severity ones, or any other default subset. When in doubt, post nothing and ask again.

Findings the user does not select — and any un-anchorable findings — are **not** posted; they go to the chat summary in Step 4.4.

#### 4.3 Post approved findings as inline comments

**Precondition:** run this step only if the user explicitly selected **at least one** finding in Step 4.2. If the approved set is empty (nothing selected, or the user skipped/dismissed), post **nothing** and go straight to Step 4.4. Before posting, state exactly which findings (by number) and how many you are about to post — e.g. "Posting 2 of 5 findings inline: #1, #3" — so the count is visible and never silently exceeds the selection.

Post one comment per approved finding using the GitLab Discussions API. This places the comment on the exact diff line, just like the GitLab UI.

**Comment body format** — the finding (severity, title, **Category**, and what's wrong), then a **collapsible** section (GitLab Flavored Markdown supports `<details>`/`<summary>`) holding a copy-ready AI prompt inside a fenced code block (GitLab renders a one-click copy button on code blocks). The prompt **must include the suggested code fix** — the same snippet used in the chat summary's **Fix:** block — embedded as plain indented lines: a nested triple-backtick fence would terminate the outer `text` fence, break rendering, and truncate what the copy button copies. The trailing `\` after the title line is a hard line break, so **Category** renders directly beneath the title; the blank lines around `<summary>` and before `</details>` are required so the fenced block renders:

````markdown
**[HIGH] <short title>**\
**Category:** <e.g., DoS & Resource Exhaustion>

<what's wrong and why it matters — 1–3 sentences>

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

**Build and post the comment.** The body is multi-line and contains a `<details>` block and a fenced code block, so it **cannot** be written with a plain heredoc straight into a JSON string — literal newlines inside a JSON string are invalid. Build the JSON with `jq -n --arg` so the body is safely escaped (newlines, backticks, quotes), then post with `--input` + `-H "Content-Type: application/json"`.

**CRITICAL**: The `glab api -f` flag does **NOT** support nested objects. You **MUST** use `--input` with a JSON file and `-H "Content-Type: application/json"` to send the nested `position` object. Without this, GitLab silently drops the position and creates a regular comment instead of a diff note. Both `old_path` and `new_path` are **always required** — use the same value if the file was not renamed.

````bash
# 0) Resolve tool paths (this block runs in its own shell)
GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GLAB" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done

# 1) Assemble the multi-line markdown body (finding + collapsible AI prompt)
BODY=$(cat <<'EOF'
**[HIGH] <short title>**\
**Category:** <e.g., DoS & Resource Exhaustion>

<what's wrong and why it matters>

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

# 3) Post the inline comment
"$GLAB" api "projects/$PROJECT_ENCODED/merge_requests/<iid>/discussions" \
  -X POST -H "Content-Type: application/json" --input /tmp/mr-inline-comment.json
````

**Line-type variants** — only the `position` object changes; keep the rest of the `jq` call identical:

- **Added line** (green `+`): `new_line` only — `..., new_line:42`
- **Removed line** (red `-`): `old_line` only — `..., old_line:38`
- **Unchanged context line**: both — `..., old_line:40, new_line:42`
- **Renamed files**: set `old_path` (`$op`) to the previous filename and `new_path` (`$np`) to the new one.

**Verify success**: the response must contain `"type": "DiffNote"` and a `"position"` object. If you see `"type": "DiscussionNote"` with no position, the request format was wrong — fix and retry.

**Clean up** the temp file after all inline comments are posted:

```bash
rm -f /tmp/mr-inline-comment.json
```

#### 4.4 Final chat summary

Produce the final review summary **in chat only** — do not post it to GitLab. Per the code-review output convention, present it as a single raw, copy-pasteable fenced markdown block (use a 4-backtick outer fence, since the content contains ` ``` ` code blocks). Use the format below; include both what was posted and what was kept in chat.

First, the **finding block** format — used for **every** finding, whether posted or kept:

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
[2-3 sentences: overall assessment, number of critical/high findings, primary areas of concern]

**Verdict:** [APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES]

### Posted inline to GitLab
Every finding posted as an inline comment, shown **in full** using the finding block format above — not just a one-line list. Add a `**Posted:**` line to each noting the `file:line` where the comment was placed.

### Kept in chat (not posted)
Findings the user rejected plus any un-anchorable findings, shown **in full** using the finding block format above.

### What looks good
[Acknowledge good patterns and clean code where appropriate, if any]
