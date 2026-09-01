# Claude Skills

A collection of custom skills for Claude Code — reusable, shareable skill definitions that extend Claude Code's capabilities. Skills are defined as Markdown files with structured prompts and workflows, and can be symlinked into `~/.claude/skills` to make them available across projects.

## Installation
```
ln -s ~/<path-to-repo>/claude-skills/skills ~/.claude/skills
ln -s ~/<path-to-repo>/claude-skills/agents ~/.claude/agents
ln -s ~/<path-to-repo>/claude-skills/commands ~/.claude/commands
```

## GitLab CLI (`glab`)

Skills use the `glab` CLI to interact with GitLab (merge requests, code search, comments). No MCP servers are required for GitLab operations.

**Prerequisites**: Install and authenticate `glab`:
```sh
brew install glab
glab auth login  # authenticate with your GitLab instance
```

Verify it works:
```sh
glab auth status
```


## Code review archive

`/mwd-code-review-interactive` writes an HTML report for every review it runs, outside any repository
so work repos stay clean:

```
~/.claude/code-review-reports/
├── index.html          # every review ever run, newest first — searchable
├── reports.json        # manifest the index is built from
└── reports/<host>/<project>/<mr-482-20260809-141203>.html
```

Each report holds the full audit trail — findings that were posted, rejected, and already raised, with
fix code, copy-ready AI prompts, per-dimension coverage, and the pre-scan dismissals. Nothing is ever
overwritten; re-reviewing the same MR appends a new dated entry. Override the location with
`MWD_REVIEW_REPORTS_DIR`.

Reports are never opened automatically — use `/mwd-review-report` when you want one in the browser.

## Commands

| Name                                          | Description                                                                                                                                                     |
|:----------------------------------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/mwd-review-report [query \| index \| #N]`    | Open a report from the code review archive in the default browser. No argument opens the newest; `index` opens the archive listing; `#N` picks by position; anything else matches on project, title, author, verdict, or MR/PR number. `--list` prints recent reviews instead of opening one. |

## Agents

| Name               | Description                                                                                                                                       |
|:-------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------|
| `code-explorer`    | Analyzes existing codebase features by tracing execution paths, mapping architecture layers, and documenting dependencies to inform new development. |
| `code-reviewer`    | Reviews GitLab merge requests — code quality, correctness, security, TypeScript standards, test coverage. Uses the `mwd-code-review-local` skill. |
| `code-simplifier`  | Simplifies and refines code for clarity, consistency, and maintainability while preserving behavior.                                              |
| `mirek-hater`      | Joke agent — responds to any mention of Mirek/mireček with funny situations and a little bit of well-deserved hate.                               |
| `mwd-review-*`     | Five single-dimension reviewers (`-correctness`, `-security`, `-docs`, `-language`, `-device`) that `/mwd-code-review-interactive` fans out to on large changes. Spawned by the skill, not invoked directly. |
| `planner`          | Planning specialist for complex features, architectural changes, and refactoring — produces step-by-step implementation plans.                    |
| `refactor-cleaner` | Dead-code cleanup and consolidation — runs analysis tools (knip, depcheck, ts-prune) to identify unused code and safely removes it.               |

## Skills

| Name                                               | Description                                                                                                                                                |
|:---------------------------------------------------|:-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/mwd-agent-rebase`                                | Rebase a feature branch onto the latest target branch (`origin/master`/`origin/main` by default), resolve mechanical conflicts automatically, force-push, and drive the pipeline back to green. |
| `/mwd-code-review-interactive [mr-or-pr-url]`      | Interactive code review for a **GitLab MR (via `glab`) or GitHub PR (via `gh`)** — auto-detected from the repo URL. Generate findings, verify each against the full codebase, dedupe against previous runs and existing threads, confirm which to post, and post approved ones as inline diff comments with one-click suggestion blocks and copy-ready AI-fix prompts (including the fix code). Review checklists live in `references/` per language, including device-runtime rules for Tizen/webOS/BrightSign; platform-specific fetch/post plumbing lives in `references/platform-gitlab.md` and `references/platform-github.md`. On large changes, review dimensions fan out to parallel subagents whose findings are merged in the main thread; small changes are reviewed inline but walk the same dimension list, and a mechanical grep pre-scan for absolute prohibitions (`any`, `FC`, bare `except:`, …) plus a per-dimension coverage line in the summary keep both modes equally auditable. Every run also writes a self-contained HTML report — all findings (posted, rejected, already-raised), fix code, copy-ready AI prompts, coverage and pre-scan audit trail — into the archive at `~/.claude/code-review-reports/`, with an `index.html` logging every review across all projects. |
| `/mwd-code-review-local [gitlab-mr-url]`           | Perform a code review (local, chat-only) for a selected GitLab merge request (by URL) and provide feedback.                                                 |
| `/mwd-resolve-mr-comments [mr-or-pr-url]`          | Read every review comment on a **GitLab MR (via `glab`) or GitHub PR (via `gh`)** — auto-detected from the repo URL. Verify each comment against the current code (already-addressed / invalid / non-actionable comments are reported, not applied), confirm which fixes to apply (batch multi-select), and edit the **working tree only**. Never commits, stages, pushes, or writes back to the platform — the user reviews the uncommitted diff. |
| `/mwd-create-mr-description`                       | Summarize changes on the active branch and create a simple description for the merge request.                                                              |
| `/mwd-java-security-check`                         | Verify the whole project for security issues based on Java standards and provide feedback on how to fix them.                                              |
| `/mwd-markdown-check [file.md] <language:english>` | Validate a Markdown file, check the grammar, and write tips on how to improve readability.                                                                 |
| `/mwd-node-security-audit`                         | Comprehensively audit a Node.js project: find vulnerabilities, outdated and deprecated packages, peer dependency conflicts, and Node.js engine mismatches. |
| `/signage-cdp`                                     | Debug and develop on signage devices (Tizen, webOS, BrightSign, Android players) live over Chrome DevTools Protocol — inspect DOM, eval JS, screenshot, tail console, record network. |
| `/sos-applet-redesign`                             | Redesign a signageOS single-file applet onto the shared design system, add an on-screen debug mode, harden reconnect/sync playback, verify on-device via CDP, and generate Marketplace docs. |
