# HTML report — payload contract & rendering

Step 4.5 of the skill renders the review as a self-contained HTML page and appends it to a persistent
archive. This file documents the payload you build and the script that consumes it. Read it only when
you reach Step 4.5.

## Where reports live

```
~/.claude/code-review-reports/            # archive root ($MWD_REVIEW_REPORTS_DIR overrides it)
├── index.html                            # regenerated every run — every review, newest first
├── reports.json                          # manifest the index is built from
└── reports/<host>/<project>/<id>-<stamp>.html
```

The root is deliberately **outside any repository**: reports never pollute a work repo, need no
`.gitignore` entry, and one index accumulates every review across every project. Nothing is ever
overwritten — re-reviewing the same MR appends a new dated entry, which is what makes the archive a
log rather than a snapshot.

## Rendering

```bash
node "$SKILL_DIR/scripts/render-report.js" /tmp/mwd-review-report.json
```

`$SKILL_DIR` is the directory holding this skill's `SKILL.md` (see "Running the helper script" in
SKILL.md). Options: `--out-dir <dir>` to override the archive root; pass `-` instead of a file path to
read the payload from stdin. The script has no dependencies and makes no network calls.

It prints the paths the Step 4.4 summary needs:

```
REPORT      /Users/you/.claude/code-review-reports/reports/gitlab.com/group/repo/mr-482-20260809-141203.html
REPORT_URL  file:///Users/you/.claude/code-review-reports/reports/gitlab.com/group/repo/mr-482-20260809-141203.html
INDEX       /Users/you/.claude/code-review-reports/index.html
INDEX_URL   file:///Users/you/.claude/code-review-reports/index.html
REVIEWS     37
```

Do **not** open the report in a browser — print `REPORT_URL` and `INDEX_URL` in the summary and let the
user click. The `/mwd-review-report` command (backed by `scripts/open-report.js` in this same
directory) is how the user opens a report on demand, later, without re-running the review.

## Payload schema

Write the payload to `/tmp/mwd-review-report.json` with the Write tool (not a heredoc — the values
contain code, backticks, and newlines). Only `project` and `change_id` are required; every other key is
optional and its section is skipped when absent. Unknown keys are ignored, so extra data is harmless.

```jsonc
{
  "platform": "gitlab",                   // "gitlab" | "github" — drives MR/PR wording and the file prefix
  "host": "gitlab.com",                   // URL host; becomes an archive directory
  "project": "group/sub/repo",            // REQUIRED — becomes nested archive directories
  "change_id": "482",                     // REQUIRED — MR iid or PR number
  "url": "https://gitlab.com/group/sub/repo/-/merge_requests/482",
  "title": "Add offline playback queue",
  "author": "jkral",
  "state": "opened",
  "labels": ["frontend", "needs-review"],
  "ci_status": "failed",                  // rendered as a pass/fail/pending pill
  "branch": { "source": "feat/queue", "target": "master" },
  "head_sha": "9f3c1a2b8d7e…",            // truncated to 12 chars in the header
  "reviewed_at": "2026-08-09T10:12:00Z",  // defaults to now
  "mode": "fan-out",                      // "inline" | "fan-out" — the Step 3 execution mode
  "verdict": "REQUEST CHANGES",           // APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES
  "executive_summary": "…",               // the same prose as the Step 4.4 executive summary
  "stats": { "files_changed": 11, "additions": 412, "deletions": 96 },

  // One entry per dimension applicable in Step 2 — the same list as the Coverage line.
  "coverage": [
    { "dimension": "Correctness", "status": "findings", "count": 2 },
    { "dimension": "Security",    "status": "clean" },
    { "dimension": "Device runtime", "status": "not_reviewed", "note": "subagent failed twice" }
  ],

  // The mechanical pre-scan tally. Every hit is either raised as a finding or listed here with a reason.
  "prescan": {
    "hits": 7,
    "raised": 2,
    "dismissed": [
      { "hit": "src/queue.ts:88:// accepts any shape", "reason": "match is inside a comment" }
    ]
  },

  // EVERY finding — posted, kept in chat, and already-raised alike.
  "findings": [
    {
      "id": "HIGH-1",                     // the stable Step 3 ID
      "severity": "HIGH",                 // CRITICAL | HIGH | MED | LOW
      "title": "Unbounded retry queue grows without a cap",
      "category": "DoS & Resource Exhaustion",
      "file": "src/queue.ts",
      "line": "142",                      // string or number; a range like "142-150" is fine
      "status": "posted",                 // "posted" | "kept" | "already_raised"
      "posted_url": "https://…#note_1234567",   // status "posted": the direct comment link
      "thread_url": "https://…#note_1200001",   // status "already_raised": the existing thread
      "fallback": "file-level comment",   // only when the inline anchor needed a fallback
      "description": "What is wrong and why it matters.",
      "suggestion": "…",                  // the suggestion block content, when one was posted
      "fix_code": "…",                    // the Fix block from the chat summary
      "ai_prompt": "…"                    // the full AI-fix prompt, verbatim
    }
  ],

  "unreviewed_files": ["src/vendor/legacy-bundle.js (generated, 8k lines)"],
  "good": ["Retry backoff uses jitter — avoids thundering-herd reconnects."]
}
```

### Fidelity rules

- **Every finding goes in**, including ones the user declined to post and ones already raised. The
  report is the audit log; the platform only ever gets the approved subset.
- `fix_code` and `ai_prompt` are copied **verbatim** from what Step 3 produced — the report's copy
  button is how the user gets the prompt for a finding that was never posted.
- `coverage` and `prescan` must match the Step 4.4 Coverage line exactly. A dimension missing here is
  the same failure that line exists to prevent.
- Newlines and backticks in code and prompts need no escaping beyond normal JSON; the renderer
  HTML-escapes everything.

## What the page contains

Header (project, change link, verdict, author, CI, branch, SHA, mode, labels, executive summary) ·
severity/posted/size stat cards · coverage pills · severity filter · findings grouped into **Posted
inline** / **Kept in chat** / **Already raised**, each with description, suggestion, fix code, and a
collapsible AI prompt with a copy button · pre-scan tally with the dismissed-hits table · files not
reviewed · what looks good. Light and dark are both supported via `prefers-color-scheme`, and the page
prints cleanly with no external assets.
