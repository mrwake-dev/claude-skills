# Claude Skills

A collection of custom skills, agents, and slash commands for Claude Code — reusable, shareable definitions that extend Claude Code's capabilities. Each is a Markdown file with a structured prompt and workflow, shipped together as the `mwd` Claude Code plugin so they are available across every project.

## Installation

The repo is its own plugin marketplace, `mrwake-dev`, listing one plugin, `mwd`. In a Claude Code session:

```text
/plugin marketplace add mrwake-dev/claude-skills
/plugin install mwd@mrwake-dev
```

Every skill and agent takes the plugin's prefix: run `/mwd:mwd-code-review-interactive`, and the agents
are `mwd:code-explorer`, `mwd:mwd-review-correctness` and so on.

To edit the skills, add the marketplace from your clone instead of GitHub. Claude Code then loads the
plugin straight from the clone, and `/reload-plugins` picks up an edit without a release:

```text
/plugin marketplace add ~/Documents/develop/mrwake-dev/claude-skills
```

### Updates

`plugin.json` sets no `version`, so every pushed commit is a new release. Auto-update is off for this
marketplace until you select it under **Marketplaces** in `/plugin` and choose **Enable auto-update**;
without it, `/plugin marketplace update mrwake-dev` pulls the latest. On a machine without a GitHub SSH
key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`: updates started inside a session don't fall back to HTTPS.

### Migrating from the symlink install

Earlier versions of this README installed the repo by cloning it and symlinking its `skills/` and
`agents/` into `~/.claude`. To switch an existing setup to the plugin:

1. **Update the clone**, so it has the `.claude-plugin/` manifests:

   ```sh
   git -C ~/Documents/develop/mrwake-dev/claude-skills pull
   ```

2. **Install the plugin.** Use the clone as the source if you edit the skills; use
   `mrwake-dev/claude-skills` instead if you only use them, and the clone is no longer needed afterwards:

   ```sh
   claude plugin marketplace add ~/Documents/develop/mrwake-dev/claude-skills
   claude plugin install mwd@mrwake-dev
   ```

3. **Replace the symlinks with real folders.** Until they're gone, every skill and agent loads twice,
   with and without the `mwd:` prefix. Check that each one is a `->` link to the clone first. Without a
   trailing slash, `rm` deletes only the link, never the clone's files:

   ```sh
   ls -ld ~/.claude/skills ~/.claude/agents ~/.claude/commands
   rm ~/.claude/skills ~/.claude/agents
   mkdir ~/.claude/skills ~/.claude/agents
   ```

   Remove `~/.claude/commands` the same way if it links to the clone. The repo no longer has a
   `commands/` folder, so that link points at nothing.

4. **Keep what only lived in the clone.** A GitHub install contains only committed files, so skills or
   agents you kept in the clone without committing them stop loading. List them, and copy the ones you
   want into the new `~/.claude/skills` or `~/.claude/agents`:

   ```sh
   git -C ~/Documents/develop/mrwake-dev/claude-skills status --ignored --short skills agents
   ```

   With the clone as the source, Claude Code reads it as it is on disk, so those files keep loading
   under the `mwd:` prefix and you can skip this step.

5. **Switch to the new names.** Start a new session, or run `/reload-plugins`, and check that
   `claude plugin list` shows `mwd@mrwake-dev` as enabled. Every skill and agent now has the plugin's
   prefix:

   | Before                         | After                              |
   |:-------------------------------|:-----------------------------------|
   | `/mwd-code-review-interactive` | `/mwd:mwd-code-review-interactive` |
   | `planner` agent                | `mwd:planner`                      |

   Update anything that still calls them by the old name, such as your `CLAUDE.md`, another skill's
   `subagent_type` or a shell alias.

To go back, run `claude plugin marketplace remove mrwake-dev`, which also uninstalls the plugin. Then
move out anything you put in `~/.claude/skills` and `~/.claude/agents`, delete both folders, and
symlink the clone's `skills/` and `agents/` into `~/.claude` again.

## Prerequisites

No MCP servers are required. The skills shell out to ordinary CLIs:

| Tool      | Needed for                                                                                      | Install                                                                                          |
|:----------|:------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------------|
| `git`     | every git-based skill                                                                            | preinstalled                                                                                       |
| `node`    | the Node audit scripts                                                                           | [nodejs.org/download](https://nodejs.org/en/download) — or [nvm](https://github.com/nvm-sh/nvm), any current version |
| `glab`    | all GitLab MR work — fetching, diffing, posting inline comments                                   | `brew install glab`                                                                                |
| `gh`      | the same on GitHub PRs (`/mwd-code-review-interactive`, `/mwd-resolve-mr-comments`, `/mwd-update-mr` auto-detect) | `brew install gh`                                                                                  |
| `jq`      | parsing GitLab/GitHub API responses in both platform reference files                             | `brew install jq`                                                                                  |

The three forge/JSON CLIs install in one go:

```sh
brew install glab gh jq
```

The audit scripts have no npm dependencies, so whatever `node` your version manager already provides
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

Pass **`local`** instead of a URL to review your current branch straight from the working copy —
`/mwd-code-review-interactive local`, or `local <base-ref>` to compare against something other than
the default branch. The review itself is identical; there is no platform access at all, so nothing is
fetched and nothing can be posted. You still get every finding in chat.

Three optional tokens, in any combination, with either mode:

| Token | What it does |
|:------|:-------------|
| `build`    | runs the repo's **own** compiler and linter and feeds the diagnostics into the review as evidence — a type error or a floating promise is proved by a tool, not asserted by a reader. Never installs anything, and skips itself when the checkout isn't at the change under review |
| `max=<n>`  | how many findings are offered for posting, lowest severity dropping off first. Default 12, `max=all` for no cap — CRITICAL and HIGH are never capped, and capped findings still reach the summary |
| `artifact` | publishes the whole review as a private claude.ai page — see [Report page](#report-page) |

What it does beyond a plain review:

- **Verifies every finding** against the full file and its callers before you ever see it, and drops
  what wider context already handles.
- **Dedupes** against previous runs of the skill and against existing human threads, so nothing is
  raised twice.
- **Fans out** on large changes — one subagent per dimension (correctness, security, docs, language,
  device runtime, platform scripts), merged back in the main thread. Small changes are reviewed
  inline but walk the same dimension list.
- **Pre-scans mechanically** with grep for absolute prohibitions (`any`, `React.FC`, bare `except:`,
  …); every hit becomes a finding or a recorded dismissal.
- **Reports coverage** per dimension, so both modes are auditable the same way.

Review checklists live in the skill's `references/`, one per language plus device-runtime rules for
Tizen/webOS/BrightSign; the platform plumbing is split into `platform-gitlab.md` and
`platform-github.md`.

### Report page

By default a run ends with the chat summary: every finding as one table row, with its location and
what happened to it. Add **`artifact`** — `/mwd-code-review-interactive <url> artifact` — and the whole
review is also published as a private claude.ai page before the summary, which then links it.

The page is the audit trail: findings that were posted, kept, and already raised, each with its fix
code and a copy-ready AI prompt, plus per-dimension coverage, the pre-scan dismissals and the files
that could not be reviewed. It is built from `/mwd-create-artifact`'s design system, so `bg=navy`,
`oled`, `warm` or a dark hex works here too, and it stays private until you share it from the page
header. Each run publishes its own page, so re-reviewing a change never overwrites an earlier review.

Publishing has to be available in the session. If it isn't, the run says which setting blocks it and
closes with the chat summary — a review is never held up by its report page.

## Agents

| Name               | Description                                                                                                                                       |
|:-------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------|
| `code-explorer`    | Analyzes existing codebase features by tracing execution paths, mapping architecture layers, and documenting dependencies to inform new development. |
| `code-simplifier`  | Simplifies and refines code for clarity, consistency, and maintainability while preserving behavior.                                              |
| `mwd-review-*`     | Six single-dimension reviewers (`-correctness`, `-security`, `-docs`, `-language`, `-device`, `-platform-scripts`) that `/mwd-code-review-interactive` fans out to on large changes. Spawned by the skill, not invoked directly. |
| `planner`          | Planning specialist for complex features, architectural changes, and refactoring — produces step-by-step implementation plans.                    |
| `refactor-cleaner` | Dead-code cleanup and consolidation — runs analysis tools (knip, depcheck, ts-prune) to identify unused code and safely removes it.               |

## Skills

| Name                                                          | Description                                                                                                     |
|:--------------------------------------------------------------|:-----------------------------------------------------------------------------------------------------------------|
| `/mwd-code-review-interactive [mr-or-pr-url \| local] [build] [max=n] [artifact]` | Review a GitLab MR or GitHub PR, confirm which findings to post, and post them as inline comments. `local` reviews the current branch from the working copy with no platform access and nothing posted; `build` backs the findings with the repo's own compiler and linter; `max=n` caps how many are offered for posting; `artifact` also publishes the whole review as a private claude.ai page — see [Code review](#code-review). |
| `/mwd-resolve-mr-comments [mr-or-pr-url]`                     | Check every review comment against the current code, then apply the fixes you pick — working tree only, never commits or pushes. |
| `/mwd-update-mr [mr-or-pr-url]`                               | Write or update the current branch's MR/PR title and description from the branch diff and this conversation — tests run, companion MRs, decisions. Merges into the existing description, confirms before posting, can open a Draft. |
| `/mwd-agent-rebase [target-branch] [--push] [--ci]`           | Rebase a branch onto its target, resolve mechanical conflicts, and verify with the project's own build. Force-push and pipeline watching are opt-in. |
| `/mwd-shorter-jsdocs [--committed \| --uncommitted] [path...]` | Trim the JSDoc this branch touched — shorten the bloated blocks, drop the unnecessary ones.                       |
| `/mwd-markdown-check [file.md] <language:english>`            | Check a Markdown file's grammar and readability.                                                                  |
| `/mwd-node-security-audit`                                    | Audit a Node.js project for vulnerabilities, outdated and deprecated packages, and engine mismatches.             |
| `/mwd-java-security-check`                                    | Audit a Java project against security standards and report how to fix what it finds.                              |
| `/mwd-create-artifact [what to build] [bg=preset \| #hex]`    | Build a dark (graphite + violet) page from what the session holds — a dashboard, a PR walkthrough, a comparison — and publish it as a private claude.ai artifact. `bg=` picks the background: `navy`, `oled`, `warm` or a dark hex. If publishing is off, names the setting that blocks it and stops. |
