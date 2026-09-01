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

## Code review

`/mwd-code-review-interactive` works on **GitLab MRs (via `glab`) and GitHub PRs (via `gh`)**, picking
the platform from the repo URL. A run goes: fetch the diff → review it → confirm with you → post only
what you approved as inline diff comments, each with a one-click suggestion block and a copy-ready
AI-fix prompt.

What it does beyond a plain review:

- **Verifies every finding** against the full file and its callers before you ever see it, and drops
  what wider context already handles.
- **Dedupes** against previous runs of the skill and against existing human threads, so nothing is
  raised twice.
- **Fans out** on large changes — one subagent per dimension (correctness, security, docs, language,
  device runtime), merged back in the main thread. Small changes are reviewed inline but walk the
  same dimension list.
- **Pre-scans mechanically** with grep for absolute prohibitions (`any`, `React.FC`, bare `except:`,
  …); every hit becomes a finding or a recorded dismissal.
- **Reports coverage** per dimension, so both modes are auditable the same way.

Review checklists live in the skill's `references/`, one per language plus device-runtime rules for
Tizen/webOS/BrightSign; the platform plumbing is split into `platform-gitlab.md` and
`platform-github.md`.

### Report archive

Every run writes an HTML report outside any repository, so work repos stay clean:

```
~/.claude/code-review-reports/
├── index.html          # every review ever run, newest first — searchable
├── reports.json        # manifest the index is built from
└── reports/<host>/<project>/<mr-482-20260809-141203>.html
```

Each report holds the full audit trail — findings that were posted, rejected, and already raised, with
fix code, copy-ready AI prompts, per-dimension coverage, and the pre-scan dismissals. It carries a top
bar with a search box, a light/dark toggle, a link straight to the MR/PR, and a link back to the
index. Nothing is ever overwritten; re-reviewing the same MR appends a new dated entry. Override the
location with `MWD_REVIEW_REPORTS_DIR`.

Every run prints its report link in chat when it finishes. Reports are never opened automatically —
use `/mwd-review-report` to reopen one later.

## Commands

| Name                                          | Description                                                                                                                                                     |
|:----------------------------------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/mwd-review-report [query \| index \| #N]`    | Open a report from the code review archive in the default browser. No argument opens the newest; `index` opens the archive listing; `#N` picks by position; anything else matches on project, title, author, verdict, or MR/PR number. `--list` prints recent reviews instead of opening one. |

## Agents

| Name               | Description                                                                                                                                       |
|:-------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------|
| `code-explorer`    | Analyzes existing codebase features by tracing execution paths, mapping architecture layers, and documenting dependencies to inform new development. |
| `code-simplifier`  | Simplifies and refines code for clarity, consistency, and maintainability while preserving behavior.                                              |
| `mirek-hater`      | Joke agent — responds to any mention of Mirek/mireček with funny situations and a little bit of well-deserved hate.                               |
| `mwd-review-*`     | Five single-dimension reviewers (`-correctness`, `-security`, `-docs`, `-language`, `-device`) that `/mwd-code-review-interactive` fans out to on large changes. Spawned by the skill, not invoked directly. |
| `planner`          | Planning specialist for complex features, architectural changes, and refactoring — produces step-by-step implementation plans.                    |
| `refactor-cleaner` | Dead-code cleanup and consolidation — runs analysis tools (knip, depcheck, ts-prune) to identify unused code and safely removes it.               |

## Skills

| Name                                                          | Description                                                                                                     |
|:--------------------------------------------------------------|:-----------------------------------------------------------------------------------------------------------------|
| `/mwd-code-review-interactive [mr-or-pr-url]`                 | Review a GitLab MR or GitHub PR, confirm which findings to post, and post them as inline comments — see [Code review](#code-review). |
| `/mwd-resolve-mr-comments [mr-or-pr-url]`                     | Check every review comment against the current code, then apply the fixes you pick — working tree only, never commits or pushes. |
| `/mwd-create-mr-description`                                  | Summarize the active branch's changes into a merge request description.                                           |
| `/mwd-agent-rebase [target-branch] [--push] [--ci]`           | Rebase a branch onto its target, resolve mechanical conflicts, and verify with the project's own build. Force-push and pipeline watching are opt-in. |
| `/mwd-shorter-jsdocs [--committed \| --uncommitted] [path...]` | Trim the JSDoc this branch touched — shorten the bloated blocks, drop the unnecessary ones.                       |
| `/mwd-markdown-check [file.md] <language:english>`            | Check a Markdown file's grammar and readability.                                                                  |
| `/mwd-node-security-audit`                                    | Audit a Node.js project for vulnerabilities, outdated and deprecated packages, and engine mismatches.             |
| `/mwd-java-security-check`                                    | Audit a Java project against security standards and report how to fix what it finds.                              |
| `/signage-cdp`                                                | Debug a signage device (Tizen, webOS, BrightSign, Android) live over Chrome DevTools Protocol.                     |
| `/sos-applet-redesign`                                        | Redesign a signageOS applet onto the shared design system and prepare it for the Marketplace.                      |
