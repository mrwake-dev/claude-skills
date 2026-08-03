# Platform plumbing: GitHub (`gh`)

Concrete fetch and post recipes for GitHub pull requests. SKILL.md dispatches here when the change
URL host is `github.com` (or a GitHub Enterprise host). Terminology on this platform: **pull request
(PR)**, identified by its **number**; inline review threads are **pull request review comments**.

**Tooling (PATH safety):** each bash block runs in a fresh shell with no shared environment, so every
block resolves absolute tool paths up front via `command -v` with a fallback and fails fast if a tool
is missing. Always call the resolved `"$GH"` / `"$JQ"` variables — never bare `gh`/`jq`. (`gh` uses
its own stored auth from `gh auth login`; no token juggling needed.)

## URL parsing

`https://github.com/my-org/my-service/pull/42`
→ repo `my-org/my-service` (`OWNER=my-org`, `REPO=my-service`), PR number `42`.

Unlike GitLab, the API path uses the plain `owner/repo` — **no URL-encoding** of slashes.

## Step 1 — Fetch PR details

```bash
# Resolve tool path (this block runs in its own shell)
GH="$(command -v gh || echo /opt/homebrew/bin/gh)"
[ -x "$GH" ] || { echo "Required tool not found or not executable: $GH" >&2; exit 1; }

# Fetch PR metadata. headRefOid is the head SHA used as commit_id when posting;
# statusCheckRollup carries CI state; files/changedFiles gauge the diff size.
"$GH" pr view <number> -R <owner/repo> \
  --json number,title,body,author,labels,headRefName,baseRefName,headRefOid,baseRefOid,state,url,changedFiles,files,commits,statusCheckRollup

# Save the diff to a temp file — do NOT dump it straight into context (see SKILL.md "Large MRs")
"$GH" pr diff <number> -R <owner/repo> > /tmp/pr-<number>.diff
wc -l /tmp/pr-<number>.diff

# Fetch commit history
"$GH" api "repos/<owner>/<repo>/pulls/<number>/commits" --paginate

# Fetch existing inline review comments (re-run awareness — this is where our markers live)
"$GH" api "repos/<owner>/<repo>/pulls/<number>/comments?per_page=100" --paginate
```

`--paginate` walks all pages automatically, so no manual page loop is needed.

**Large PRs**: if the saved diff is under ~2,000 lines, read the temp file whole. Otherwise review it
file-by-file: list the boundaries with `grep -n '^diff --git' /tmp/pr-<number>.diff`, then read one
file's slice at a time. `gh pr diff` returns the full unified diff without GitLab-style pagination
overflow; if the PR is enormous, fetch per-file patches via
`gh api "repos/<owner>/<repo>/pulls/<number>/files?per_page=100" --paginate` (each entry has a
`patch`).

**CI status**: derive it from `statusCheckRollup` in the PR JSON — treat any `FAILURE`/`ERROR`
conclusion as failed, all `SUCCESS`/`NEUTRAL`/`SKIPPED` as success, any `IN_PROGRESS`/`QUEUED`/
`PENDING` as running, and an empty array as absent. Put it in the executive summary as "CI: …".

**Positioning data** — Step 4 needs only the head commit SHA (GitHub's line-based comment API does
not use base/start SHAs):

```bash
# Resolve tool paths (this block runs in its own shell)
GH="$(command -v gh || echo /opt/homebrew/bin/gh)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GH" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done

HEAD_SHA=$("$GH" pr view <number> -R <owner/repo> --json headRefOid -q '.headRefOid')
```

## Step 4.3 — Post an inline comment

Post one comment per approved finding via the **pull request review comments** API
(`POST /repos/{owner}/{repo}/pulls/{number}/comments`). GitHub uses a **line-based** anchor
(`path` + `line` + `side`) plus the head `commit_id` — there is no nested `position` object and no
base/start SHA.

**Suggestion-block syntax on GitHub:** the fence takes **no range** — just ` ```suggestion ` followed
by the full replacement for the anchored line(s). To replace more than the single anchored line, make
the comment itself multi-line (set `start_line` + `start_side`, below); the suggestion then replaces
the whole `start_line..line` range. Drop the GitLab `:-N+M` range suffix entirely.

Build the JSON with `jq -n --arg` so the multi-line body (with `<details>` and fenced blocks) is
safely escaped. `gh api --input` sends the file as the JSON request body (Content-Type is set
automatically).

```bash
# 0) Resolve tool paths (this block runs in its own shell)
GH="$(command -v gh || echo /opt/homebrew/bin/gh)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GH" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done

# 1) BODY = the shared comment body assembled per SKILL.md 4.3 (marker + finding + optional
#    suggestion + collapsible AI prompt). Assemble it with a quoted heredoc into $BODY.

# 2) Build valid JSON with jq (safely escapes newlines/backticks/quotes).
#    This example targets an ADDED line (side RIGHT). See variants below.
"$JQ" -n --arg body "$BODY" --arg commit "$HEAD_SHA" --arg path "src/foo.ts" \
  '{body:$body, commit_id:$commit, path:$path, line:42, side:"RIGHT"}' \
  > /tmp/pr-inline-comment.json

# 3) Post the inline comment and capture the response
RESPONSE=$("$GH" api "repos/<owner>/<repo>/pulls/<number>/comments" \
  -X POST --input /tmp/pr-inline-comment.json)

# 4) Verify + collect the direct link for the summary
echo "$RESPONSE" | "$JQ" -r '"id=\(.id) path=\(.path) line=\(.line) url=\(.html_url)"'
```

**Line-type variants** — only the anchor fields change; keep the rest of the `jq` call identical.
`side` selects which side of the diff the line number refers to: **RIGHT** = new/added side,
**LEFT** = old/removed side.

- **Added line** (green `+`): `line:<new_line>, side:"RIGHT"`
- **Removed line** (red `-`): `line:<old_line>, side:"LEFT"`
- **Unchanged context line**: `line:<new_line>, side:"RIGHT"` (RIGHT anchors context fine)
- **Multi-line range**: add `start_line:<n>, start_side:"RIGHT"` (or `LEFT`) alongside `line`/`side`;
  `start_line` must be ≤ `line` and on the same side.
- **Renamed files**: `path` is always the **new** path; GitHub tracks the rename itself.

**Verify success**: a successful response is the created review comment object — it has an `id`, the
`path`/`line` you sent, and an `html_url`. Record each `html_url` — the summary links every posted
finding directly to it (GitHub gives the anchor URL, so no manual `#note_…` construction is needed).
A `422` means GitHub could not position the line.

**Fallback ladder** — when the POST returns `422 Unprocessable Entity` (line not part of the diff, or
wrong side) or the verify check fails:

1. Retry with the alternate `side`/line (e.g., you sent `side:"RIGHT"` with a new-line number for what
   is actually a removed line → send `side:"LEFT"` with the old-line number, or vice versa).
   Double-check the numbers against the diff hunk header.
2. Retry as a **file-level comment**: replace `line`/`side` with `subject_type:"file"` (keep `path`
   and `commit_id`) and prepend the intended `file:line` reference to the body text. Drop any
   suggestion block — suggestions require a line anchor.
3. If that also fails, do **not** silently post a plain issue comment — the skill promises
   inline-only. Ask the user whether to post it as a regular PR comment
   (`gh pr comment <number> -R <owner/repo> --body-file …`) or keep it in chat. In the summary, state
   which fallback level each posted finding ended up at.

**Clean up** the temp files after all inline comments are posted:

```bash
rm -f /tmp/pr-inline-comment.json /tmp/pr-<number>.diff
```
