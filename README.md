# Claude Skills

A collection of custom skills, agents, and slash commands for Claude Code — reusable, shareable definitions that extend Claude Code's capabilities. Each is a Markdown file with a structured prompt and workflow, symlinked into `~/.claude` to make it available across every project.

## Installation

Clone the repo, then symlink the three directories into `~/.claude`:

```sh
REPO=~/Documents/develop/mrwake-dev/claude-skills   # wherever you cloned it

ln -s "$REPO/skills"   ~/.claude/skills
ln -s "$REPO/agents"   ~/.claude/agents
ln -s "$REPO/commands" ~/.claude/commands
```

If any of those already exist as real directories, move them aside first — `ln -s` into an existing
directory silently creates `~/.claude/skills/skills` instead of failing. Check with
`ls -la ~/.claude | grep -E 'skills|agents|commands'`; each should be a `->` symlink to this repo.

## Prerequisites

No MCP servers are required. The skills shell out to ordinary CLIs:

| Tool      | Needed for                                                                                      | Install                                                                                          |
|:----------|:------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------------|
| `git`     | every git-based skill                                                                            | preinstalled                                                                                       |
| `node`    | the HTML report renderer, the report opener, and the Node audit scripts                          | [nodejs.org/download](https://nodejs.org/en/download) — or [nvm](https://github.com/nvm-sh/nvm), any current version |
| `glab`    | all GitLab MR work — fetching, diffing, posting inline comments                                   | `brew install glab`                                                                                |
| `gh`      | the same on GitHub PRs (`/mwd-code-review-interactive`, `/mwd-resolve-mr-comments` auto-detect)  | `brew install gh`                                                                                  |
| `jq`      | parsing GitLab/GitHub API responses in both platform reference files                             | `brew install jq`                                                                                  |
| `docker`  | lockfile regeneration during `/mwd-agent-rebase`                                                  | [Docker Desktop](https://www.docker.com/products/docker-desktop/)                                  |
| `python3` | the local preview server in `/sos-applet-redesign` only                                           | preinstalled on macOS                                                                              |

The three forge/JSON CLIs install in one go:

```sh
brew install glab gh jq
```

The report scripts have no npm dependencies, so whatever `node` your version manager already provides
is fine — there is no need to install a second one through Homebrew.

Authenticate the two forge CLIs once:

```sh
glab auth login   # your GitLab instance
gh auth login     # github.com
```

Verify everything resolves:

```sh
node --version && glab auth status && gh auth status && jq --version
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
| `/mwd-agent-rebase`                                | Rebase a feature branch onto the latest target branch (`origin/master`/`origin/main` by default), resolve mechanical conflicts automatically (regenerating lockfiles in Docker as a last resort), and force-push with `--force-with-lease`. |
| `/mwd-code-review-interactive [mr-or-pr-url]`      | Interactive code review for a **GitLab MR (via `glab`) or GitHub PR (via `gh`)** — auto-detected from the repo URL. Generate findings, verify each against the full codebase, dedupe against previous runs and existing threads, confirm which to post, and post approved ones as inline diff comments with one-click suggestion blocks and copy-ready AI-fix prompts (including the fix code). Review checklists live in `references/` per language, including device-runtime rules for Tizen/webOS/BrightSign; platform-specific fetch/post plumbing lives in `references/platform-gitlab.md` and `references/platform-github.md`. On large changes, review dimensions fan out to parallel subagents whose findings are merged in the main thread; small changes are reviewed inline but walk the same dimension list, and a mechanical grep pre-scan for absolute prohibitions (`any`, `FC`, bare `except:`, …) plus a per-dimension coverage line in the summary keep both modes equally auditable. Every run also writes a self-contained HTML report — all findings (posted, rejected, already-raised), fix code, copy-ready AI prompts, coverage and pre-scan audit trail — into the archive at `~/.claude/code-review-reports/`, with an `index.html` logging every review across all projects. |
| `/mwd-code-review-local [gitlab-mr-url]`           | Perform a code review (local, chat-only) for a selected GitLab merge request (by URL) and provide feedback.                                                 |
| `/mwd-resolve-mr-comments [mr-or-pr-url]`          | Read every review comment on a **GitLab MR (via `glab`) or GitHub PR (via `gh`)** — auto-detected from the repo URL. Verify each comment against the current code (already-addressed / invalid / non-actionable comments are reported, not applied), confirm which fixes to apply (batch multi-select), and edit the **working tree only**. Never commits, stages, pushes, or writes back to the platform — the user reviews the uncommitted diff. |
| `/mwd-create-mr-description`                       | Summarize changes on the active branch and create a simple description for the merge request.                                                              |
| `/mwd-java-security-check`                         | Verify the whole project for security issues based on Java standards and provide feedback on how to fix them.                                              |
| `/mwd-markdown-check [file.md] <language:english>` | Validate a Markdown file, check the grammar, and write tips on how to improve readability.                                                                 |
| `/mwd-shorter-jsdocs [--committed \| --uncommitted] [path...]` | Audit the JSDoc blocks this branch added or touched — flag bloated ones to shorten and unnecessary ones to remove, then apply after confirmation. |
| `/mwd-node-security-audit`                         | Comprehensively audit a Node.js project: find vulnerabilities, outdated and deprecated packages, peer dependency conflicts, and Node.js engine mismatches. |
| `/signage-cdp`                                     | Debug and develop on signage devices (Tizen, webOS, BrightSign, Android players) live over Chrome DevTools Protocol — inspect DOM, eval JS, screenshot, tail console, record network. |
| `/sos-applet-redesign`                             | Redesign a signageOS single-file applet onto the shared design system, add an on-screen debug mode, harden reconnect/sync playback, verify on-device via CDP, and generate Marketplace docs. |
