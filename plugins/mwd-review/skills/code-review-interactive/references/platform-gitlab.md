# Platform plumbing: GitLab (`glab`)

Concrete fetch and post recipes for GitLab merge requests. SKILL.md dispatches here when the
change URL host is a GitLab instance (`gitlab.com` or a self-hosted GitLab). Terminology on this
platform: **merge request (MR)**, identified by its **IID**; inline review threads are
**discussions**.

**Tooling (PATH safety):** each bash block runs in a fresh shell with no shared environment, so every
block resolves absolute tool paths up front via `command -v` with a fallback and fails fast if a tool
is missing. Always call the resolved `"$GLAB"` / `"$JQ"` variables — never bare `glab`/`jq`.

## URL parsing

`https://gitlab.com/my-group/services/my-service/-/merge_requests/42`
→ repo `my-group/services/my-service`, IID `42`.

**URL-encoding**: replace `/` with `%2F` in the project path for API calls
(`my-group/services/my-service` → `my-group%2Fservices%2Fmy-service`).

## Step 1 — Fetch MR details

```bash
# Resolve tool path (this block runs in its own shell)
GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"
[ -x "$GLAB" ] || { echo "Required tool not found or not executable: $GLAB" >&2; exit 1; }

# Fetch MR metadata (title, description, author, labels, head pipeline, etc.)
"$GLAB" mr view <iid> -R <group/namespace/repo> -F json

# Save the diff to a temp file — do NOT dump it straight into context (see SKILL.md "Large MRs")
"$GLAB" mr diff <iid> -R <group/namespace/repo> --raw > /tmp/mr-<iid>.diff
wc -l /tmp/mr-<iid>.diff

# Fetch commit history
"$GLAB" api "projects/<url-encoded-project>/merge_requests/<iid>/commits"

# Fetch existing discussions (re-run awareness; follow pagination if 100+ results)
"$GLAB" api "projects/<url-encoded-project>/merge_requests/<iid>/discussions?per_page=100"
```

**Large MRs**: if the saved diff is under ~2,000 lines, read the temp file whole. Otherwise review it
file-by-file: list the boundaries with `grep -n '^diff --git' /tmp/mr-<iid>.diff`, then read one
file's slice at a time. If the diff looks truncated (far fewer files than `changes_count`), check
`GET .../merge_requests/<iid>/changes` for `"overflow": true` and fetch the missing files via the
paginated `.../merge_requests/<iid>/diffs?per_page=20&page=N` endpoint.

**Pipeline status**: capture `.head_pipeline.status` from the MR JSON (`success`, `failed`,
`running`, or absent) for the executive summary.

**Positioning data** — Step 4 needs these SHAs to anchor inline comments:

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

## Step 4.3 — Post an inline comment

Post one comment per approved finding via the GitLab **Discussions** API. This places the comment on
the exact diff line, just like the GitLab UI.

**Suggestion-block syntax on GitLab:** the fence takes a range — ` ```suggestion:-N+M ` replaces N
lines above through M lines below the anchored line (`-0+0` = just the anchored line).

**CRITICAL**: the `glab api -f` flag does **NOT** support nested objects. You **MUST** use `--input`
with a JSON file and `-H "Content-Type: application/json"` to send the nested `position` object.
Without this, GitLab silently drops the position and creates a regular comment instead of a diff
note. Both `old_path` and `new_path` are **always required** — use the same value if the file was not
renamed.

Build the JSON with `jq -n --arg` so the multi-line body (with `<details>` and fenced blocks) is
safely escaped — a literal newline inside a JSON string is invalid, so a plain heredoc into a JSON
string will not work.

```bash
# 0) Resolve tool paths (this block runs in its own shell)
GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"
JQ="$(command -v jq || echo /usr/bin/jq)"
for bin in "$GLAB" "$JQ"; do
  [ -x "$bin" ] || { echo "Required tool not found or not executable: $bin" >&2; exit 1; }
done

# 1) BODY = the shared comment body assembled per SKILL.md 4.3 (marker + finding + optional
#    suggestion + collapsible AI prompt). Assemble it with a quoted heredoc into $BODY.

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
```

**Line-type variants** — only the `position` object changes; keep the rest of the `jq` call identical:

- **Added line** (green `+`): `new_line` only — `..., new_line:42`
- **Removed line** (red `-`): `old_line` only — `..., old_line:38`
- **Unchanged context line**: both — `..., old_line:40, new_line:42`
- **Renamed files**: set `old_path` (`$op`) to the previous filename and `new_path` (`$np`) to the new one.

**Verify success**: the response must contain `"type": "DiffNote"` and a `"position"` object. Record
each `note_id` — the summary links every posted finding as `<mr-url>#note_<note_id>`. If you see
`"type": "DiscussionNote"` with no position, the request format was wrong — fix and retry.

**Fallback ladder** — when the POST returns 400 (GitLab rejects lines it cannot position) or the
verify check fails:

1. Retry with the alternate line-type variant (e.g., you sent `new_line` only for what is actually a
   context line → send both `old_line` and `new_line`, or vice versa). Double-check the line numbers
   against the diff hunk header.
2. Retry as a **file-level comment**: replace the line fields with `position_type:"file"` (keep both
   paths and all three SHAs) and prepend the intended `file:line` reference to the body text. Drop any
   suggestion block — suggestions require a line anchor.
3. If that also fails, do **not** silently post a plain non-inline discussion — the skill promises
   inline-only. Ask the user whether to post it as a regular MR comment or keep it in chat. In the
   summary, state which fallback level each posted finding ended up at.

**Clean up** the temp files after all inline comments are posted:

```bash
rm -f /tmp/mr-inline-comment.json /tmp/mr-<iid>.diff
```
