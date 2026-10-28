<div align="center">
  <img src=".github/assets/readme-icon.svg" width="120" height="120" alt="A terminal tile that types /wake and answers ✓ awake">
  <h1>Claude Skills</h1>
  <p>
    Skills and agents for Claude Code that review merge requests, audit dependencies and handle everyday Git work.<br>
    They install together as one plugin, <code>mwd</code>.
  </p>
  <p>
    <a href="#install">Install</a> ·
    <a href="#skills">Skills</a> ·
    <a href="#agents">Agents</a> ·
    <a href="docs/code-review.md">Code review</a> ·
    <a href="#development">Development</a>
  </p>
</div>

## Install

You need Claude Code and a few command-line tools that the skills call. No MCP servers are needed.

| Tool   | What the skills use it for                                                         |
|:-------|:-----------------------------------------------------------------------------------|
| `git`  | Every skill that works with a repository                                           |
| `gh`   | GitHub pull requests and Dependabot alerts                                         |
| `glab` | GitLab merge requests: reading diffs and posting comments                          |
| `jq`   | Reading GitHub and GitLab API responses                                            |
| `node` | The Node.js audit scripts. Any current version works; they have no npm dependencies |

### macOS and Linux

`git` is usually installed already. Install the rest with Homebrew:

```sh
brew install gh glab jq
```

For `node`, keep the one your version manager (such as nvm) already provides, or download it from
[nodejs.org](https://nodejs.org/en/download).

Log in to GitHub and GitLab once:

```sh
gh auth login     # github.com
glab auth login   # your GitLab instance
```

Check that everything is ready:

```sh
node --version && gh auth status && glab auth status && jq --version
```

### Windows

Install [Git for Windows](https://git-scm.com/downloads/win) first. With it, Claude Code runs shell
commands in Git Bash. Without it, Claude Code falls back to PowerShell, and the bash scripts these
skills run won't work.

Install everything with winget, in PowerShell:

```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
winget install --id GLab.GLab -e
winget install --id jqlang.jq -e
winget install --id OpenJS.NodeJS.LTS -e
```

Skip the last line if you already manage Node.js with nvm-windows. Then open a new terminal, so it
finds the new commands, and log in once:

```powershell
gh auth login
glab auth login
```

Check that everything is ready:

```powershell
node --version; gh auth status; glab auth status; jq --version
```

If Claude Code can't find Git Bash, tell it where `bash.exe` is in
`%USERPROFILE%\.claude\settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_GIT_BASH_PATH": "C:\\Program Files\\Git\\bin\\bash.exe"
  }
}
```

### Add the plugin

This step is the same on every system. In a Claude Code session, run:

```text
/plugin marketplace add mrwake-dev/claude-skills
/plugin install mwd@mrwake-dev
```

The first command registers this repo as a plugin source called `mrwake-dev`. The second installs its
plugin, `mwd`.

Every skill and agent name starts with `mwd:`. You run `/mwd:mwd-code-review-interactive`, and the
planner agent is `mwd:planner`.

Claude Code downloads plugins over SSH when you have a GitHub SSH key, and over HTTPS otherwise. Installs
and updates started inside a session don't switch to HTTPS on their own, so on a machine without a key,
set this variable before you add the plugin:

```sh
# macOS and Linux: add it to your shell profile
export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1
```

```powershell
# Windows: applies to terminals you open afterwards
setx CLAUDE_CODE_PLUGIN_PREFER_HTTPS 1
```

## Skills

Run a skill by typing its command in a Claude Code session. Only `mwd-create-artifact` can also start on
its own, when you ask Claude for a page or a dashboard.

| Command | What it does |
|:--------|:-------------|
| `/mwd:mwd-code-review-interactive <url \| local>` | Reviews a GitLab merge request or a GitHub pull request, asks which findings to post, and posts them as comments on the changed lines. `local` reviews your current branch instead. See the [code review guide](docs/code-review.md). |
| `/mwd:mwd-resolve-mr-comments [url]` | Checks every review comment against the current code and applies the fixes you choose. It only edits files; it never commits or pushes. |
| `/mwd:mwd-update-mr [url]` | Writes or updates the title and description of your branch's merge request from the diff and the conversation: tests you ran, related merge requests, decisions. It keeps what's already there, asks before posting, and can open the merge request as a draft. |
| `/mwd:mwd-agent-rebase [target-branch] [--push] [--ci]` | Rebases your branch onto its target (the latest `main` or `master` by default), resolves simple conflicts, regenerates lockfiles and checks the result with the project's own build. It force-pushes only with `--push`; `--ci` also pushes and then watches the pipeline. |
| `/mwd:mwd-fix-dependabot-alerts` | Reads the repo's open Dependabot alerts and groups the vulnerable packages by severity. For the groups you pick, it upgrades npm, yarn, pnpm, bun, Maven or Gradle dependencies, asks you about risky upgrades, and runs the project's build and tests. It never commits, pushes or writes to GitHub. |
| `/mwd:mwd-node-security-audit` | Checks a Node.js project for vulnerable, outdated and deprecated packages, peer dependency conflicts and Node.js version mismatches, then writes a prioritized upgrade plan. |
| `/mwd:mwd-java-security-check` | Reviews a Java project for security problems and explains how to fix each one. |
| `/mwd:mwd-prepare-to-cf-workers [worker-name]` | Prepares a website for Cloudflare Workers: adds Wrangler and its config, headers and 404 handling, tests the site locally, deploys it once you confirm, and lists the settings for building from Git. |
| `/mwd:mwd-shorter-jsdocs [--committed \| --uncommitted] [path...]` | Shortens the JSDoc comments your branch touched and removes the ones that add nothing. |
| `/mwd:mwd-markdown-check <file.md> [language]` | Checks a Markdown file's grammar and readability. The language defaults to English. |
| `/mwd:mwd-create-artifact [what to build] [bg=...]` | Builds a dark page (graphite and violet) from what the session already has, such as a dashboard, a pull request walkthrough or a comparison, and publishes it as a private claude.ai link. `bg=navy`, `oled`, `warm` or a dark hex color changes the background. If publishing is turned off, it tells you which setting blocks it. |

## Agents

Claude Code can hand work to these agents. Ask for one by name, for example "use mwd:planner", or let
Claude pick.

| Agent | What it does |
|:------|:-------------|
| `mwd:code-explorer` | Traces how an existing feature works across the codebase before you build on it. It only reads code. |
| `mwd:code-simplifier` | Makes code clearer and more consistent without changing what it does. |
| `mwd:planner` | Turns a feature, an architecture change or a refactor into a step-by-step plan. |
| `mwd:refactor-cleaner` | Finds unused code with knip, depcheck and ts-prune, and removes it. |
| `mwd:mwd-review-*` | Six reviewers, one per area: correctness, security, docs, language, device and platform scripts. The code review skill starts them on large changes; you don't call them yourself. |

## Moving from the symlink setup

Older versions of this README told you to clone the repo and symlink its `skills/` and `agents/` folders
into `~/.claude`. To switch to the plugin:

1. Update your clone, so it has the plugin files in `.claude-plugin/`:

   ```sh
   git -C ~/Documents/develop/mrwake-dev/claude-skills pull
   ```

2. Add the plugin. Use your clone as the source if you edit the skills. If you only use them, add
   `mrwake-dev/claude-skills` instead, and you can delete the clone afterwards.

   ```sh
   claude plugin marketplace add ~/Documents/develop/mrwake-dev/claude-skills
   claude plugin install mwd@mrwake-dev
   ```

3. Replace the symlinks with real folders. Until you do, every skill and agent shows up twice, with and
   without the `mwd:` prefix. First check that each one is a link to your clone (it shows an arrow,
   `->`):

   ```sh
   ls -ld ~/.claude/skills ~/.claude/agents ~/.claude/commands
   rm ~/.claude/skills ~/.claude/agents
   mkdir ~/.claude/skills ~/.claude/agents
   ```

   Without a trailing slash, `rm` removes only the link and leaves your clone alone. If
   `~/.claude/commands` also links to the clone, remove it the same way. The repo has no `commands/`
   folder anymore, so that link points at nothing.

   On Windows, check the links in PowerShell and remove each one with `rmdir`. It deletes a link, but
   refuses to delete a real folder that still has files in it:

   ```powershell
   Get-Item "$env:USERPROFILE\.claude\skills", "$env:USERPROFILE\.claude\agents" | Select-Object FullName, LinkType, Target
   cmd /c rmdir "%USERPROFILE%\.claude\skills"
   cmd /c rmdir "%USERPROFILE%\.claude\agents"
   mkdir "$env:USERPROFILE\.claude\skills", "$env:USERPROFILE\.claude\agents"
   ```

   If `LinkType` is empty, that folder is a copy rather than a link. Rename it instead, and move back
   anything you still need.

4. Keep files that only lived in your clone. An install from GitHub contains only committed files, so
   skills or agents you kept in the clone without committing them won't load. List them, and copy the
   ones you want into the new `~/.claude/skills` or `~/.claude/agents`:

   ```sh
   git -C ~/Documents/develop/mrwake-dev/claude-skills status --ignored --short skills agents
   ```

   If your clone is the source, skip this step. Claude Code reads the clone as it is on disk, so those
   files keep loading under the `mwd:` prefix.

5. Switch to the new names. Start a new session, or run `/reload-plugins`, and check that
   `claude plugin list` shows `mwd@mrwake-dev` as enabled. Every name now has the plugin's prefix:

   | Before                         | After                              |
   |:-------------------------------|:-----------------------------------|
   | `/mwd-code-review-interactive` | `/mwd:mwd-code-review-interactive` |
   | `planner` agent                | `mwd:planner`                      |

   Update anything that still uses an old name, such as your `CLAUDE.md`, another skill's
   `subagent_type` or a shell alias.

To undo the switch, run `claude plugin marketplace remove mrwake-dev`, which also uninstalls the plugin.
Then move out anything you put in `~/.claude/skills` and `~/.claude/agents`, delete both folders, and
link the clone's `skills/` and `agents/` folders into `~/.claude` again.

## Development

### Working on the skills

If you edit the skills, clone this repo and add your clone instead of GitHub:

```text
/plugin marketplace add <path-to-your-clone>
```

Claude Code then reads the skills straight from your clone, so `/reload-plugins` picks up an edit
without waiting for a release.

### Updates

You get a new version only when a release raises the version number in `.claude-plugin/plugin.json`.
Commits pushed to `main` between releases don't reach installed copies. A plugin added from a local
clone is the exception: it always uses the files on disk.

Automatic updates are off until you turn them on. Open `/plugin`, go to **Marketplaces**, select
`mrwake-dev` and choose **Enable auto-update**. To update by hand instead, run:

```text
/plugin marketplace update mrwake-dev
```

### Releasing

Run the **Release** workflow on `main` and choose `patch`, `minor` or `major`, either from the repo's
Actions tab or with:

```sh
gh workflow run release.yml -f bump=patch
```

The workflow raises the version in `plugin.json`, commits it as `release: X.Y.Z`, tags the commit
`X.Y.Z` and pushes both. It then starts the **Changelog** workflow, which publishes a GitHub release. The
release notes list the commits since the previous tag, grouped by type: `feat`, `fix`, `docs` and so on.

You can also push an `X.Y.Z` tag yourself. Changelog publishes a release for it only if `plugin.json` at
that tag already has the same version, because installed copies would never get it otherwise.
