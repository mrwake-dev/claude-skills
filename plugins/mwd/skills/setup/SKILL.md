---
name: setup
description: Pick which mrwake-dev plugins to install (code review, merge request chores, security audits, Cloudflare Workers, docs checks, general agents), install or remove them with the claude CLI, and check that the command-line tools they need are installed and logged in. Use when the user runs /mwd:setup, asks which mwd plugins to install, or wants to add or remove one.
disable-model-invocation: true
allowed-tools: Bash, AskUserQuestion
---

# Setup

Install the mrwake-dev plugins the user needs, remove the ones they don't, and check the tools those plugins
call. Every plugin comes from the `mrwake-dev` marketplace, which is already registered, since this skill runs
from it.

## The plugins

| Plugin           | What it adds                                                                                   | Tools it needs                |
|:-----------------|:-----------------------------------------------------------------------------------------------|:------------------------------|
| `mwd-review`     | `/mwd-review:code-review-interactive`, `/mwd-review:create-artifact` and six review agents      | `git`, `jq`, `gh` and/or `glab` |
| `mwd-git`        | `/mwd-git:resolve-mr-comments`, `/mwd-git:update-mr`, `/mwd-git:agent-rebase`                  | `git`, `jq`, `gh` and/or `glab` |
| `mwd-security`   | `/mwd-security:fix-dependabot-alerts`, `/mwd-security:node-security-audit`, `/mwd-security:java-security-check` | `gh`, `jq`, `node`  |
| `mwd-cloudflare` | `/mwd-cloudflare:prepare-to-cf-workers`                                                        | `node`                        |
| `mwd-docs`       | `/mwd-docs:shorter-jsdocs`, `/mwd-docs:markdown-check`                                         | `git`                         |
| `mwd-agents`     | The `code-explorer`, `code-simplifier`, `planner` and `refactor-cleaner` agents                | none                          |

`mwd` itself holds only this skill. Never uninstall it here.

## Step 1: See what's installed

Each bash block runs in a fresh shell, so resolve `claude` in every block. Prefer the binary running this
session, then a `claude` on `PATH`, then the native installer's path. When `claude` is a shell function or
alias, `command -v` prints just the name, so only accept an absolute path from it:

```bash
CLAUDE="${CLAUDE_CODE_EXECPATH:-}"
[ -x "$CLAUDE" ] || CLAUDE="$(command -v claude)"
case "$CLAUDE" in /*) ;; *) CLAUDE="$HOME/.local/bin/claude" ;; esac
[ -x "$CLAUDE" ] || { echo "claude CLI not found"; exit 1; }
"$CLAUDE" plugin list --json
```

Note which `*@mrwake-dev` plugins are installed and whether each is enabled. If the `claude` CLI can't be
found, stop: tell the user to run the install commands from Step 4 in their own terminal.

## Step 2: Ask which plugins they want

Ask with AskUserQuestion, multi-select, in one call. The picker shows at most four options per question, so
split the six plugins over two questions:

1. `mwd-review`, `mwd-git`, `mwd-security`, `mwd-cloudflare`
2. `mwd-docs`, `mwd-agents`, and a third option, "All six plugins"

Describe each option with the "What it adds" column in plain words, and add "(installed)" to the label of
plugins that already are. "All six plugins" means every row of the table, whatever else was ticked.

## Step 3: Ask about GitHub and GitLab

Only if the picks include `mwd-review`, `mwd-git` or `mwd-security`: ask single-select whether they work with
GitHub, GitLab or both. The answer only decides which of `gh` and `glab` Step 5 checks. `mwd-security` needs
`gh` regardless, for Dependabot alerts.

## Step 4: Install and remove

Install each picked plugin that isn't installed yet, one command per plugin:

```bash
"$CLAUDE" plugin install mwd-review@mrwake-dev
```

If a plugin is installed but disabled and the user picked it, run `"$CLAUDE" plugin enable <name>@mrwake-dev`
instead.

Installed plugins the user did not pick are candidates for removal, never removed by default. List them and
ask, multi-select, which to uninstall. Run `"$CLAUDE" plugin uninstall <name>@mrwake-dev` only for the ones
they confirm.

If an install fails over SSH, tell the user to set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`, open a new terminal and
run `/mwd:setup` again. Show any other error as it is.

## Step 5: Check the tools

Work out which tools the plugins now installed need, from the table above and the Step 3 answer, and check
only those:

```bash
for tool in git jq gh glab node; do printf '%-5s %s\n' "$tool" "$(command -v "$tool" || echo missing)"; done
gh auth status      # only when gh is needed
glab auth status    # only when glab is needed
uname -s; command -v brew || echo "brew missing"
grep -E '^(ID|ID_LIKE)=' /etc/os-release 2>/dev/null || true   # Linux distribution
```

`node` often comes from a version manager such as nvm that a fresh shell hasn't loaded. If it's missing, say
it may still be installed that way rather than reporting it as absent.

Report one line per needed tool: the tool, which plugin needs it, and whether it's installed and logged in.
For each problem, give the command to fix it, and don't run it: installing software and logging in are the
user's call.

Pick the commands by platform, and list only the missing tools in them:

- **macOS, or Linux with Homebrew:** `brew install gh glab jq`. For `node`, nodejs.org or nvm.
- **Linux without Homebrew**, by `ID` and `ID_LIKE` from `/etc/os-release`:
  - Debian, Ubuntu, or `ID_LIKE` naming either: `sudo apt install git jq`, and `sudo snap install glab` (a
    community package; on Debian, `snapd` comes first). Where snap isn't available, a `.deb` from
    https://gitlab.com/gitlab-org/cli/-/releases works too.
  - Fedora, only when `ID=fedora`: `sudo dnf install git jq glab` (`glab` is a community package there).
    RHEL and CentOS also report `ID_LIKE` fedora, but their repositories may not have `glab`, so treat them
    as anything else.
  - Anything else: the distribution's own `git` and `jq` packages. `glab` is officially supported on Linux
    only through Homebrew.
  - `gh` everywhere: it comes from GitHub's own package repository, which takes several commands to add.
    Point to the commands in the README,
    https://github.com/mrwake-dev/claude-skills#macos-and-linux, or GitHub's guide,
    https://github.com/cli/cli/blob/trunk/docs/install_linux.md, rather than writing a shortened version.
  - For `node`, nodejs.org or nvm.
- **Windows** (`uname -s` starts with `MINGW` or `MSYS`): `winget install --id <id> -e` with `Git.Git`,
  `GitHub.cli`, `GLab.GLab`, `jqlang.jq` or `OpenJS.NodeJS.LTS`.
- **Not logged in:** `gh auth login`, or `glab auth login`, adding `--hostname <server>` for a self-hosted
  GitLab.

## Step 6: Finish

Summarize in a few lines: which plugins were installed, enabled or removed, and the commands each one added.
End by telling the user to run `/reload-plugins`, or start a new session, so the changes load. You can't run
that command for them.
