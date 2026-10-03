---
name: mwd-update-mr
description: Write or update the title and description of the GitLab merge request or GitHub pull request for the current branch (via glab or gh, auto-detected from the git remote), using the whole branch diff plus this conversation's history — why the work was done, decisions taken, tests that actually ran, companion MRs opened. Merges into an existing description instead of overwriting it, offers to open a Draft MR/PR when none exists, and confirms before every platform write. Never commits or pushes. Use at the end of a finished task or when opening an MR/PR.
argument-hint: "[merge-request-or-pull-request-url]"
disable-model-invocation: true
---

# Update MR / PR

Write or update the merge request / pull request for the **current branch** (or the one at
$ARGUMENTS, if given). The description is built from two inputs: **the whole branch** — what changed
— and **this conversation** — why, what was decided, what was tested, which companion MRs exist. The
skill runs in the main conversation on purpose; its history is an input.

> **Never commit, stage, or push.** No `git add`, `commit`, `push`, `stash`, `checkout`, `reset`, or
> any command that alters branches or history. The only platform writes allowed are the **title and
> description of this one MR/PR**, or **creating one Draft MR/PR** — and only after the user says yes
> in Step 5, separately on every run. Never touch labels, reviewers, assignees, draft/ready state,
> comments, or companion MRs.

Supports **GitLab (`glab`)** and **GitHub (`gh`)**. Below, **the change** means the MR or PR.

## Workflow

**Tooling (PATH safety):** Do not assume `git`, `glab`, `gh`, or `jq` are on `PATH`. Each bash block
runs in a fresh shell with no shared environment, so every block resolves tool paths up front via
`command -v` with a fallback (`/opt/homebrew/bin/…`, `/usr/bin/jq`) and fails fast if a tool is
missing. Always call the resolved `"$GLAB"` / `"$GH"` / `"$JQ"` variables.

### Step 1: Resolve the branch, remote, platform, and change

```bash
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] || { echo "detached HEAD — check out the branch first" >&2; exit 1; }

# Remote: the branch's upstream remote, else the only remote. Never assume `origin`.
UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"   # e.g. github/feature-x
REMOTE="${UPSTREAM%%/*}"
[ -n "$REMOTE" ] || { [ "$(git remote | wc -l | tr -d ' ')" = 1 ] && REMOTE="$(git remote)"; }
[ -n "$REMOTE" ] || { echo "cannot pick a remote from: $(git remote | tr '\n' ' ')" >&2; exit 1; }

URL="$(git remote get-url "$REMOTE")"
HOST="$(printf '%s' "$URL" | sed -E 's#^[a-z+]+://([^@/]+@)?##; s#^[^@]+@##; s#[:/].*$##')"
REPO="$(printf '%s' "$URL" | sed -E 's#^[a-z+]+://[^/]+/##; s#^[^@]+@[^:]+:##; s#\.git$##')"

DEFAULT="$(git symbolic-ref --quiet --short "refs/remotes/$REMOTE/HEAD" 2>/dev/null)"   # e.g. github/main
[ -n "$DEFAULT" ] || for c in main master; do
  git rev-parse --verify --quiet "$REMOTE/$c" >/dev/null && { DEFAULT="$REMOTE/$c"; break; }
done

echo "branch=$BRANCH remote=$REMOTE host=$HOST repo=$REPO upstream=${UPSTREAM:-none} default=${DEFAULT:-unknown}"
git status --porcelain                                                     # uncommitted work
[ -n "$UPSTREAM" ] && echo "unpushed=$(git rev-list --count "$UPSTREAM"..HEAD)"
git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null && echo "on-remote=yes" || echo "on-remote=no"
```

- If the remote can't be picked, ask the user which one. If `BRANCH` is the default branch, stop —
  there is nothing to describe.
- **Platform** from `HOST`:

  | Host | Platform | CLI | Terminology |
  |:-----|:---------|:----|:------------|
  | `github.com` (or a GitHub Enterprise host) | GitHub | `gh` | pull request (PR), number |
  | `gitlab.com` or a self-hosted GitLab | GitLab | `glab` | merge request (MR), IID |

  If the host is unclear, ask. A URL in `$ARGUMENTS` overrides the remote: take host, repo, and
  number from it (`/-/merge_requests/<iid>` ⇒ GitLab, `/pull/<n>` ⇒ GitHub).

- **Find the change** (open only). More than one match → ask which.

  ```bash
  # GitLab
  GLAB="$(command -v glab || echo /opt/homebrew/bin/glab)"; JQ="$(command -v jq || echo /usr/bin/jq)"
  for bin in "$GLAB" "$JQ"; do [ -x "$bin" ] || { echo "Required tool not found: $bin" >&2; exit 1; }; done
  "$GLAB" mr list -R "<repo>" --source-branch "<branch>" -F json | "$JQ" -c '.[] | {iid, title, web_url}'
  "$GLAB" mr view <iid> -R "<repo>" -F json \
    | "$JQ" '{title, description, source_branch, target_branch, draft, web_url, pipeline: .head_pipeline | {id, status, web_url}}'

  # GitHub
  GH="$(command -v gh || echo /opt/homebrew/bin/gh)"; JQ="$(command -v jq || echo /usr/bin/jq)"
  for bin in "$GH" "$JQ"; do [ -x "$bin" ] || { echo "Required tool not found: $bin" >&2; exit 1; }; done
  "$GH" pr list -R "<repo>" --head "<branch>" --state open --json number,title,url
  "$GH" pr view <number> -R "<repo>" --json title,body,headRefName,baseRefName,isDraft,url,statusCheckRollup
  ```

  If the change's source branch ≠ `BRANCH`, warn and ask whether to continue — describing the wrong
  branch is worse than describing none. Auth error → check `glab auth status` / `gh auth status`.

- **Target** = the change's target branch; with no change yet, `DEFAULT` without the remote prefix.

### Step 2: Gather evidence

Three sources, each with a fixed role:

| Source | Feeds | Rule |
|:-------|:------|:-----|
| **Branch** | Description, What changed, title | **Source of truth for what changed.** Anything discussed in the conversation that is not in the diff (reverted, abandoned) is left out. |
| **Conversation** | the *why*, Testing, Companion MRs, Reviewer notes, Related issues | Only what actually happened — see below. |
| **Platform** | existing title and description, CI status | CI becomes one Testing row. |

**Branch** — compare against a fresh target, never against base-branch commits:

```bash
BASE="<remote>/<target>"
git fetch --quiet "<remote>" "<target>" || echo "fetch failed — $BASE may be stale" >&2   # refreshes only the remote-tracking ref
MERGE_BASE="$(git merge-base "$BASE" HEAD)" || { echo "no merge base with $BASE" >&2; exit 1; }
SLUG="$(printf '%s' "<branch>" | tr '/' '-')"
git log --format='%h %s%n%b' "$MERGE_BASE"..HEAD
git diff --stat "$MERGE_BASE" HEAD
git diff "$MERGE_BASE" HEAD > "/tmp/mwd-update-mr-$SLUG.diff"; wc -l "/tmp/mwd-update-mr-$SLUG.diff"
```

Under ~2,000 diff lines, read the file whole; above that, read it per file
(`grep -n '^diff --git'` for the boundaries). Uncommitted changes are never described.

**Conversation** — walk this conversation (or its summary, if it was compacted — do not guess at
details the summary dropped) and collect:

- **Intent** — what the user asked for and any course corrections.
- **Decisions** — options weighed, the one picked, and why; files that carry the most risk.
- **Tests** — every check that **ran and produced a result you saw**: test suites, builds,
  type-checks, lints, e2e, manual checks (browser, simulator, device, `curl`), CI pipelines watched.
  Record what ran, its type, where it executed (Local macOS, a container, a device model, CI), and the
  **final** result — a test that failed and was fixed shows only the passing run. Never list planned
  tests or "should pass".
- **Companion MRs/PRs** — URLs created (`glab mr create` / `gh pr create` output) or linked as part of
  the same task, in any repo.
- **Issue refs** — ticket keys (`ABC-123`) and issue URLs; also scan the branch name and commit
  subjects.

If the conversation holds nothing about this branch (a fresh session), say so and build from the
branch and platform only. **Never copy secrets, tokens, env values, internal credentials, or personal
data** from the conversation into the description.

### Step 3: Compose

```md
## Description
<≤3 sentences: what the change does and why.>

### What changed
- **<Theme>:** <one line>

### Companion MRs
| MR | Purpose |
|:---|:--------|
| [group/repo!12](https://…) | <one line> |

Merge order: <only when it matters>

### Testing
| Test | Type | Where | Result |
|:-----|:-----|:------|:-------|
| `npm test` | Unit | Local (macOS) | ✅ 142 passed |
| [Pipeline #881](https://…) | CI | GitLab CI | ✅ passed |
| Wi-Fi EAP connect | Manual | Tizen display | ✅ connected |

### Reviewer notes
- <decision + the alternative rejected, or the riskiest file to read first>

### Related issues
- Related to ABC-123
- Closes #45
```

- **Budgets:** Description ≤ 3 sentences. What changed ≤ 8 bullets, one line each, grouped by theme
  — no per-file narration. Reviewer notes ≤ 5 bullets added per run. No filler or motivation essays.
- **Optional sections** (Companion, Testing, Reviewer notes, Related issues) appear only with real
  content — never "N/A". On GitHub the heading is **Companion PRs**; link companions with full URLs
  (`group/repo!12` / `owner/repo#12` as link text) so they work across repos and platforms.
- **Result** cells start with ✅, ❌, or ⚠️. An unfixed failure is listed as ❌ — do not hide it.
- **CI row:** GitLab `pipeline.status`; GitHub `statusCheckRollup` — any `FAILURE`/`ERROR` ⇒ ❌, any
  pending ⇒ ⚠️ running, otherwise ✅. No pipeline ⇒ no row.
- **Related issues:** `Closes` only when the conversation says this change fully resolves the issue;
  otherwise `Related to`. Never invent a URL for a ticket key.
- **Title:** propose a new one only when the current title no longer fits (still the branch name, the
  first commit, or describes a different scope). Match the commit-subject style in `git log` (e.g.
  `feat(scope): …`). Keep an existing GitLab `Draft:` prefix as is.

### Step 4: Merge with the existing description

With no existing description, use the Step 3 output as is. Otherwise, split the existing body into
sections by `##`/`###` heading (case-insensitive) and handle each:

| Existing section | Handling |
|:-----------------|:---------|
| `Description` | **Regenerated** from the whole branch. With no conversation history (Step 2), **kept word for word** instead — rewritten only if the branch now covers scope it doesn't mention. |
| `What changed`, or the legacy `Changes` | **Regenerated**; the heading becomes `What changed`. |
| `Companion MRs` / `Companion PRs`, `Testing`, `Reviewer notes`, `Related issues` | **Accumulated** — keep existing entries, add new ones. |
| Any other heading, text before the first heading, images, checklists | **Untouched** — kept word for word, in place. |

- Accumulated sections dedupe: Testing rows by *Test + Where* (a test re-run in this conversation
  replaces its row), companions by URL, issues by key. Drop an existing entry only when the branch
  proves it wrong — the removal then shows up in Step 5.
- Managed sections stay where they were; a new one is inserted at its Step 3 position relative to
  the others.
- An existing body with **no headings at all** is kept word for word at the top, and Step 5 warns that
  it may duplicate the new Description.

Save both versions and list what the update removes:

```bash
# Old body: GitLab `.description`, GitHub `.body` from the Step 1 fetch, piped through `"$JQ" -r '… // ""'`
#   > /tmp/mwd-update-mr-<slug>.old.md
# New body: write it with the Write tool to /tmp/mwd-update-mr-<slug>.md
diff -u /tmp/mwd-update-mr-<slug>.old.md /tmp/mwd-update-mr-<slug>.md | sed '1,2d' | grep '^-'
```

### Step 5: Confirm

Print, in chat:

```
MR:       <link>   — or: none, a Draft MR will be created against <target>
Base:     <remote>/<target> @ <merge-base short sha>
Title:    <old> → <new>   — or: unchanged
Warnings: <no conversation history — built from branch and MR only / unpushed commits / uncommitted changes / branch mismatch / heading-less body kept / none>
```

then the **full new description in a fenced `md` block** (always — so it can be copied even if
nothing is posted), then **Removed from the current description:** with the removed lines, if any.

Ask **once** with `AskUserQuestion`:

| Situation | Options |
|:----------|:--------|
| Change exists, title changed | **Update MR** (title + description) · **Description only** · **Copy only** |
| Change exists, title unchanged | **Update MR** · **Copy only** |
| No change exists | **Create Draft MR** · **Copy only** |

Use the platform's term (MR/PR) in the labels. **Copy only, a dismissal, or an empty answer posts
nothing** — go straight to Step 7.

### Step 6: Write and verify

Pass the title through a quoted heredoc (`TITLE="$(cat <<'EOF' … EOF)"`) so quotes in it survive.

```bash
BODY="/tmp/mwd-update-mr-<slug>.md"

# GitLab — update / create
"$GLAB" mr update <iid> -R "<repo>" --description-file "$BODY" [--title "$TITLE"]
"$GLAB" mr create -R "<repo>" --draft -s "<branch>" -b "<target>" -t "$TITLE" --description-file "$BODY" --yes

# GitHub — update / create
"$GH" pr edit <number> -R "<repo>" --body-file "$BODY" [--title "$TITLE"]
"$GH" pr create -R "<repo>" --draft --base "<target>" --head "<branch>" --title "$TITLE" --body-file "$BODY"
```

- **Before creating**, the branch must already be on the remote (`on-remote=yes` from Step 1). If it
  isn't, do not create anything: print the push command for the user and stop. This skill never
  pushes. On GitLab, `--draft` adds the `Draft:` prefix itself — don't put it in `$TITLE`.
- **Verify** by re-fetching the body (Step 1 commands) and comparing it to the file:
  `… | diff --strip-trailing-cr -B - "$BODY"`. No output means it landed as written. A difference →
  report it; do not retry blindly.
- **Clean up:** `rm -f /tmp/mwd-update-mr-<slug>.*`

### Step 7: Summary

Report in chat:

- The change link, and what happened: updated / created as Draft / copy only.
- Sections regenerated, added, and kept untouched; the removed lines, if any were posted.
- The base ref and merge-base used.
- Warnings that still apply (unpushed commits the MR doesn't show yet, uncommitted work left out).
- A closing reminder that nothing was committed or pushed.
