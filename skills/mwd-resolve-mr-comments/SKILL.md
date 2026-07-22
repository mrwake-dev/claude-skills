---
name: mwd-resolve-mr-comments
description: Read every review comment on a GitLab merge request or GitHub pull request (via glab or gh, auto-detected from the repo URL), verify each one against the current code, and apply the valid ones as fixes in the working tree — confirming the plan with the user first. Never commits, stages, pushes, or writes back to the platform. Use when the user asks to resolve, address, or apply MR/PR review comments in code.
argument-hint: "[merge-request-or-pull-request-url]"
disable-model-invocation: true
---

# Resolve MR / PR Review Comments in Code

Read every review comment on the merge request / pull request at $ARGUMENTS, **verify each one against
the current code**, and apply the ones that are valid, actionable, and not already addressed as edits
in the working tree. The plan is **confirmed with the user before any file is touched**, and rejected
or non-actionable comments are reported instead of silently ignored.

> **Never commit, stage, or push.** This skill only edits files in the **currently checked-out
> branch**. It must never run `git add`, `git commit`, `git push`, `git stash`, or any command that
> alters git state or history — the user reviews the uncommitted diff and commits themselves. It also
> **never writes back to the platform**: no replies, no resolving threads, no new comments.

The skill supports **both GitLab (via `glab`) and GitHub (via `gh`)**; the platform is detected from
the URL. Throughout this document, **the change** means the MR or PR under review, and **a thread**
means one review discussion (an original comment plus any replies).

## Workflow

**Tooling (PATH safety):** Do not assume `glab`, `gh`, or `jq` are on `PATH`. Each bash block runs in a
fresh, minimally-initialized shell (no environment shared between blocks), so every block resolves
tool paths up front via `command -v` with a fallback (`/opt/homebrew/bin/…`, `/usr/bin/jq`) and fails
fast if a tool is missing. Always call the resolved `"$GLAB"` / `"$GH"` / `"$JQ"` variables.

### Step 0: Detect the platform

Look at the host in the change URL and pick the platform:

| URL host | Platform | CLI | Terminology |
|:---------|:---------|:----|:------------|
| `github.com` (or a GitHub Enterprise host) | GitHub | `gh` | pull request (PR), number, review comments |
| `gitlab.com` or a self-hosted GitLab | GitLab | `glab` | merge request (MR), IID, discussions |

If the URL alone is ambiguous, disambiguate by path shape (`/-/merge_requests/<n>` ⇒ GitLab,
`/pull/<n>` ⇒ GitHub); if still unclear, ask the user. Confirm the CLI is authenticated
(`gh auth status` / `glab auth status`) if a fetch fails with an auth error.

### Step 1: Confirm the working context

The skill edits the **currently checked-out branch**, so make sure it holds the code the comments were
made against before changing anything:

```bash
git rev-parse --abbrev-ref HEAD   # current branch
git status --short                 # note any pre-existing uncommitted changes
```

- Capture the change's **source branch** in Step 2 and compare it to the current branch. If they
  differ, **warn the user and ask whether to continue** — resolving comments against the wrong branch
  produces meaningless edits. Do not check out or switch branches yourself unless the user asks.
- If the working tree already has uncommitted changes, note it in the final summary so the user can
  tell your edits apart from theirs. Do **not** discard or stash them.

### Step 2: Fetch all review comments

Fetch every thread on the change — **inline** comments (anchored to a file and line) and **general**
comments (no line anchor). Capture, per comment: the body, author, whether it is resolved, its
file/line (for inline), and any replies (a later reply may retract, answer, or supersede the original).

**Filter out noise:** drop system/automated notes (label changes, pipeline events), and treat bot
authors (e.g. `*-bot`, Dependabot, CI accounts) as low priority — surface them but do not auto-plan
fixes from them unless the user includes them.

**GitLab** — discussions carry both inline and general notes:

```bash
GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GLAB" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done

# Source branch (compare against the checked-out branch in Step 1)
"$GLAB" mr view <iid> -R <group/namespace/repo> -F json | "$JQ" -r '.source_branch'

# All discussions; --paginate walks every page. Keep only human, non-system notes.
"$GLAB" api --paginate "projects/<url-encoded-project>/merge_requests/<iid>/discussions?per_page=100" \
  | "$JQ" -c '.[].notes[] | select(.system | not) | {
      id, body, author: .author.username, resolvable, resolved,
      path: .position.new_path, old_path: .position.old_path,
      new_line: .position.new_line, old_line: .position.old_line
    }'
```

**URL-encoding**: replace `/` with `%2F` in the project path for the API call.

**GitHub** — inline review comments and general (issue) comments live at different endpoints:

```bash
GH="$(command -v gh || echo /opt/homebrew/bin/gh)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GH" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done

# Source branch (compare against the checked-out branch in Step 1)
"$GH" pr view <number> -R <owner/repo> --json headRefName -q '.headRefName'

# Inline review comments (path + line + the diff hunk the comment was made on)
"$GH" api --paginate "repos/<owner>/<repo>/pulls/<number>/comments?per_page=100" \
  | "$JQ" -c '.[] | {id, body, user: .user.login, path, line, original_line, side, in_reply_to_id, diff_hunk}'

# General PR comments (no line anchor)
"$GH" api --paginate "repos/<owner>/<repo>/issues/<number>/comments?per_page=100" \
  | "$JQ" -c '.[] | {id, body, user: .user.login}'

# Review summary bodies (optional context)
"$GH" api --paginate "repos/<owner>/<repo>/pulls/<number>/reviews" \
  | "$JQ" -c '.[] | select(.body != "") | {id, body, user: .user.login, state}'
```

GitHub thread **resolution** state is not in the REST payload (it lives in the GraphQL
`reviewThreads.isResolved`). Fetching it is optional; if you skip it, the Step 3 verification still
catches already-addressed comments by reading the current code. If a comment has an `in_reply_to_id`,
group it with its parent so the thread is judged as a whole.

**Group into threads** and order them file-by-file (inline) then general, so the user sees a coherent
list in Step 4.

### Step 3: Verify each comment (one by one)

For **each thread**, read the code it refers to and decide whether it warrants a fix. Comment line
numbers can be stale (the branch may have moved since the comment) — locate the relevant code by
**content and context**, not the raw line number alone. For an inline comment, open the current file
around the anchored path/line and read the surrounding function/class; for a general comment, find the
code it describes.

Classify every thread into exactly one bucket:

- **VALID & ACTIONABLE** — the comment identifies a real issue that still exists in the current code,
  and there is a concrete code change that addresses it. → proposes a fix (Step 4).
- **ALREADY ADDRESSED** — the code already does what the comment asks (fixed in a later commit, or the
  latest reply in the thread confirms resolution). → skip, note as already done.
- **INVALID / INCORRECT** — the comment is factually wrong, based on a misreading, or its premise does
  not hold in this codebase. → skip, with a one-line reason.
- **NON-ACTIONABLE** — a question, praise, a discussion point, or a nit with no clear code change. →
  skip, summarize what it was.
- **AMBIGUOUS / NEEDS DECISION** — actionable in principle but the correct fix depends on intent,
  affects a public contract, or has multiple reasonable resolutions. → do **not** guess; list it for
  the user to decide in Step 4 rather than proposing a specific edit.

**Verification discipline** (mirrors the review skill's rigor, in reverse):

1. Read the **full current file** and the relevant callers/consumers before trusting a comment — do
   not fix based on the comment text alone.
2. Prefer the **minimal** change that satisfies the comment; keep it consistent with surrounding code
   and existing conventions. Do not opportunistically refactor unrelated code.
3. If fixing one comment would conflict with another, note the conflict and let the user choose.
4. If a comment asks for something out of scope for a working-tree edit (a dependency bump requiring
   lockfile regeneration, a CI change, a decision to split the MR), classify it AMBIGUOUS / NEEDS
   DECISION and describe it — do not half-apply it.

### Step 4: Present the plan & confirm (batch multi-select)

Present the verified threads in chat so the user can choose what to apply. Show **all** buckets, but
only **VALID & ACTIONABLE** and **AMBIGUOUS** threads are selectable:

```
Actionable:
[1] src/foo.ts:42 — <author>: "<comment gist>"
      → Proposed fix: <one-line description of the edit>
[2] src/bar.ts:10 — <author>: "<comment gist>"
      → Proposed fix: <one-line description>

Needs your decision:
[3] src/baz.ts:88 — <author>: "<comment gist>" — <why it needs a decision>

Not planned (for your awareness):
- src/qux.ts:5 — already addressed in current code
- general — <author>: question, non-actionable
- src/x.ts:9 — comment appears incorrect: <reason>
```

Ask the user **once** which items to apply — do **not** confirm them one at a time. Applying is
strictly **opt-in**:

- Preferred: `AskUserQuestion` with `multiSelect: true`, one option per selectable item. Note its
  limit of **4 options per question** and **4 questions per call** (≈12 items); group across questions
  when needed.
- If there are more items than fit, ask in plain text: "Reply with the numbers to apply (e.g.
  `1, 3`), or `all` / `none`."

**Empty selection or Skip = change nothing.** If the user selects nothing, skips, dismisses, replies
`none`, or is ambiguous, apply **no** edits and go straight to the summary (Step 6). Never apply a fix
the user did not explicitly select; do not fall back to "just the obvious ones."

### Step 5: Apply the selected fixes (working tree only)

For each selected item, apply the edit with the Edit/Write tools. Keep each comment's change **focused
and minimal**. After editing:

- If the project has an obvious, fast type-check or lint for the touched files, you **may** run it in
  read-only fashion to confirm the edit compiles (e.g. `tsc --noEmit`, per the project's convention) —
  but **do not** auto-format the whole repo or run anything that rewrites unrelated files.
- Re-read the edited region to confirm the change is coherent and did not break surrounding code.

**Reminder — the hard constraints (never violate, even if asked mid-run to "just commit it"):**

- **No git state changes:** no `git add`, `commit`, `push`, `stash`, `checkout`, `reset`, `restore`,
  or branch operations. Leave every change unstaged in the working tree.
- **No platform writes:** do not reply to, resolve, or create any comment on GitLab/GitHub. This skill
  is read-only toward the platform.

If the user explicitly asks you to commit afterwards, treat that as a **separate, new request** — stop
and confirm the message and scope before doing anything with git.

### Step 6: Final summary

Report in chat (no platform write). Cover:

- **Applied** — one line per fix: `path:line — <comment gist> → <what you changed>`.
- **Skipped (not selected)** — the actionable/ambiguous items the user did not pick.
- **Not planned** — already-addressed, invalid, and non-actionable threads, each with its one-line
  reason (so the user knows every comment was accounted for).
- **Verification run**, if any (e.g. "type-check passed on the 3 touched files").
- A closing reminder that **all changes are uncommitted** in the current branch for the user to review
  and commit, and that nothing was written back to the MR/PR.
