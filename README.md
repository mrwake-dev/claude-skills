# Claude Skills

A collection of custom skills for Claude Code — reusable, shareable skill definitions that extend Claude Code's capabilities. Skills are defined as Markdown files with structured prompts and workflows, and can be symlinked into `~/.claude/skills` to make them available across projects.

## Installation
```
ln -s ~/<path-to-repo>/claude-skills/skills ~/.claude/skills
ln -s ~/<path-to-repo>/claude-skills/agents ~/.claude/agents
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


## Agents

| Name               | Description                                                                                                                                       |
|:-------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------|
| `code-explorer`    | Analyzes existing codebase features by tracing execution paths, mapping architecture layers, and documenting dependencies to inform new development. |
| `code-reviewer`    | Reviews GitLab merge requests — code quality, correctness, security, TypeScript standards, test coverage. Uses the `mwd-code-review-local` skill. |
| `code-simplifier`  | Simplifies and refines code for clarity, consistency, and maintainability while preserving behavior.                                              |
| `mirek-hater`      | Joke agent — responds to any mention of Mirek/mireček with funny situations and a little bit of well-deserved hate.                               |
| `planner`          | Planning specialist for complex features, architectural changes, and refactoring — produces step-by-step implementation plans.                    |
| `refactor-cleaner` | Dead-code cleanup and consolidation — runs analysis tools (knip, depcheck, ts-prune) to identify unused code and safely removes it.               |

## Skills

| Name                                               | Description                                                                                                                                                |
|:---------------------------------------------------|:-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/mwd-agent-rebase`                                | Rebase a feature branch onto the latest target branch (`origin/master`/`origin/main` by default), resolve mechanical conflicts automatically, force-push, and drive the pipeline back to green. |
| `/mwd-code-review-interactive [gitlab-mr-url]`     | Interactive code review for a GitLab MR — generate findings, verify each against the full codebase, dedupe against previous runs and existing threads, confirm which to post, and post approved ones as inline diff comments with one-click GitLab suggestion blocks and copy-ready AI-fix prompts (including the fix code). Review checklists live in `references/` per language, including device-runtime rules for Tizen/webOS/BrightSign. On large MRs, review dimensions fan out to parallel subagents whose findings are merged in the main thread. |
| `/mwd-code-review-local [gitlab-mr-url]`           | Perform a code review (local, chat-only) for a selected GitLab merge request (by URL) and provide feedback.                                                 |
| `/mwd-resolve-mr-comments [mr-or-pr-url]`          | Read every review comment on a **GitLab MR (via `glab`) or GitHub PR (via `gh`)** — auto-detected from the repo URL. Verify each comment against the current code (already-addressed / invalid / non-actionable comments are reported, not applied), confirm which fixes to apply (batch multi-select), and edit the **working tree only**. Never commits, stages, pushes, or writes back to the platform — the user reviews the uncommitted diff. |
| `/mwd-create-mr-description`                       | Summarize changes on the active branch and create a simple description for the merge request.                                                              |
| `/mwd-java-security-check`                         | Verify the whole project for security issues based on Java standards and provide feedback on how to fix them.                                              |
| `/mwd-markdown-check [file.md] <language:english>` | Validate a Markdown file, check the grammar, and write tips on how to improve readability.                                                                 |
| `/mwd-node-security-audit`                         | Comprehensively audit a Node.js project: find vulnerabilities, outdated and deprecated packages, peer dependency conflicts, and Node.js engine mismatches. |
| `/signage-cdp`                                     | Debug and develop on signage devices (Tizen, webOS, BrightSign, Android players) live over Chrome DevTools Protocol — inspect DOM, eval JS, screenshot, tail console, record network. |
| `/sos-applet-redesign`                             | Redesign a signageOS single-file applet onto the shared design system, add an on-screen debug mode, harden reconnect/sync playback, verify on-device via CDP, and generate Marketplace docs. |
