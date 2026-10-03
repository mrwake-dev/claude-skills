# HTML report & final chat summary — Step 4.4

Step 4.4 of the skill closes the run with two local outputs, in this order: the HTML report (4.4.a), so
the summary can link to it, then the chat summary (4.4.b). Neither is posted to GitLab/GitHub. Read this
file when you reach Step 4.4.

## 4.4.a Write the HTML report

Every run — including one where the user posted nothing — is recorded in a persistent local archive at
`~/.claude/code-review-reports/`, so the reports build up into a log of every review this skill has
ever done. The archive layout and the full payload schema are below.

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
  "platform": "gitlab",                   // "gitlab" | "github" | "local" — drives the wording, the header
                                          // pill and the file prefix (mr- / pr- / local-)
  "host": "gitlab.com",                   // URL host; becomes an archive directory. Defaults per platform
                                          // ("local" when the platform is local and no remote host is known)
  "project": "group/sub/repo",            // REQUIRED — becomes nested archive directories
  "change_id": "482",                     // REQUIRED — MR iid, PR number, or the branch name when local
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
      "suggestion": "…",                  // the suggestion posted to the platform; not rendered as its
                                          // own block — it only labels the Fix block, and stands in
                                          // for fix_code when that is absent
      "fix_code": "…",                    // concrete code showing the fix — chat only shows it on request
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
- **Prose fields render inline markdown** — `executive_summary`, `description`, finding `title`,
  `category`, `good[]`, coverage `note`, and dismissed `reason` support `` `code` ``, `**bold**`,
  `_italic_`, `[text](https://…)`, and blank-line paragraphs. Write them as you would in chat; the
  renderer escapes first and only then applies markdown, so no field can inject HTML. Fields not on
  that list (`file`, `line`, `fallback` values, code blocks) are escaped verbatim.

## What the page contains

A sticky top bar — back to the index, project/change breadcrumb, findings search, a direct **Open
MR/PR** link (needs `url`, so a local review has none), and a light/dark/auto theme toggle persisted
in `localStorage` — then the
header (project, change link, verdict, author, CI, branch, SHA, mode, labels, executive summary) ·
severity/posted/size stat cards · coverage pills · severity filter · findings grouped into **Posted
inline** / **Kept in chat** / **Already raised**, each with description, **one** fix block, and a
collapsible AI prompt with a copy button · pre-scan tally with the dismissed-hits table · files not
reviewed. "What looks good" sits in the header under the executive summary. Code blocks have their
common indentation stripped, so a suggestion carrying the file's own leading tabs still reads flush.
Search and the severity filters compose — a finding shows only when it
passes both. The index carries the same bar with its own search over project, title, author and
verdict. Theme defaults to `prefers-color-scheme` until the toggle pins one, and the page prints
cleanly with no external assets.

## 4.4.b Final chat summary

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
| HIGH-1 | Unbounded retry loop | `src/api.ts:42` | DoS & Resource Exhaustion | [note](https://gitlab.com/group/repo/-/merge_requests/482#note_1) |
| MED-1 | Missing null guard | `src/ui.tsx:10` | Correctness | [note](https://gitlab.com/group/repo/-/merge_requests/482#note_2) — file-level fallback |

### Kept in chat (n)

| ID | Finding | Location | Category | Why not posted |
|:---|:--------|:---------|:---------|:---------------|
| MED-2 | Duplicate fetch per render | `src/a.ts:88` | Efficiency | not selected |
| LOW-1 | Stale JSDoc on `parse()` | `src/b.ts:12` | Docs | un-anchorable |
| LOW-2 | Unhandled reject path | `src/c.ts:5` | Correctness | already raised — [thread](https://gitlab.com/group/repo/-/merge_requests/482#note_3) |

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
