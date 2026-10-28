# Contributing

This repo is a Claude Code plugin marketplace. This guide covers how it's laid out, how to add or change a
skill, an agent or a plugin, how to test the change, and how commits become release notes.

## How the repo is laid out

```text
.claude-plugin/marketplace.json   lists every plugin
plugins/<plugin>/
  .claude-plugin/plugin.json      the plugin's name, version and description
  skills/<name>/SKILL.md          one folder per skill, with its references/ and scripts/
  agents/<name>.md                one file per agent
docs/                             guides for the bigger skills
.github/workflows/                CI, Release and Changelog
```

## Names

- Plugins are named `mwd-<area>`, such as `mwd-review` or `mwd-git`. `mwd` itself holds only `/mwd:setup`.
- Skills and agents use lowercase letters, digits and hyphens, without an `mwd-` prefix: the plugin adds
  it. `plugins/mwd-git/skills/update-mr` runs as `/mwd-git:update-mr`.
- A skill's `name:` matches its folder, and an agent's `name:` matches its file. CI fails otherwise.

## Adding a skill

Create `plugins/<plugin>/skills/<name>/SKILL.md`. These are the frontmatter fields the skills here use:

| Field | What it does |
|:------|:-------------|
| `name` | The command name after the plugin's prefix. Keep it equal to the folder name. |
| `description` | What the skill does, then "Use when …". Claude reads it to decide when the skill applies, so put the main use case first. CI fails without one. |
| `disable-model-invocation: true` | The skill runs only when someone types its command, and its description stays out of Claude's context. Every skill here sets it except `create-artifact`. Set it on anything that writes, posts, pushes or deploys. |
| `argument-hint` | Shown after the command while typing, such as `[url] [--push]`. |
| `allowed-tools` | Tools the skill may use without a permission prompt, during the turn that runs it. It doesn't limit which tools are available. |
| `model` | The model for the turn that runs the skill. |

Keep files the skill needs next to `SKILL.md`, in `references/` or `scripts/`. In `SKILL.md`, refer to them
as `${CLAUDE_PLUGIN_ROOT}/skills/<name>/...`; Claude Code fills in the path when the skill loads. It
doesn't fill it in inside reference files, so a reference file that needs a path works it out from the
skill's own folder, the way the code review skill finds `create-artifact`.

Then update the docs:

- Add a row to the skill table in the [README](../README.md#skills).
- Add the command to the plugin's row in `/mwd:setup`'s table, in
  `plugins/mwd/skills/setup/SKILL.md`, with any new tool it needs. Add that tool to the README's
  [Plugins](../README.md#plugins) table too.
- If the skill has options or several steps, write a guide in `docs/` like
  [the code review guide](code-review.md), and link it from the skill's row.

### Rules every skill here follows

- **Ask before anything leaves the machine.** No commit, push or post to GitHub or GitLab without the
  user's yes in that run. Destructive git commands, such as `reset --hard` or a forced push, come only after
  checking what would be lost and asking.
- **Never assume the remote is `origin`.** Use the branch's upstream remote, else the only remote, else
  ask. `update-mr` and `agent-rebase` show how.
- **Each bash block runs in a fresh shell.** Resolve tools with `command -v` and a fallback path, and stop
  when one is missing.
- **Temp files go in a folder for that run,** made with `mktemp -d`. Cleanup removes only that folder:
  never a fixed `/tmp/name`, and never a delete by wildcard.
- **Use the project's own commands.** Run the build, lint and test scripts the project defines, and never
  invent one.

## Adding an agent

Create `plugins/<plugin>/agents/<name>.md` with `name`, `description` and usually `tools` in its
frontmatter, and `model` when it needs a specific one. Plugin agents ignore `permissionMode`, `hooks`,
`mcpServers` and `initialPrompt`.

A skill that starts an agent uses its full name, `<plugin>:<name>`, such as `mwd-review:correctness`.

## Adding a plugin

1. Create `plugins/mwd-<area>/.claude-plugin/plugin.json`. Copy another plugin's file and change `name`,
   `description` and `keywords`. Keep `version` the same as the other plugins.
2. List it in `.claude-plugin/marketplace.json` as
   `{ "name": "mwd-<area>", "source": "./plugins/mwd-<area>" }`. CI fails on a plugin folder the
   marketplace doesn't list.
3. Add it to `/mwd:setup`, both its table and the questions in its Step 2, and to the README's
   [Plugins](../README.md#plugins) table.

## Testing a change

1. Add your clone as the marketplace instead of GitHub, as described in
   [Working on the skills](../README.md#working-on-the-skills), and pick "All six plugins" in
   `/mwd:setup`.
2. After an edit, run `/reload-plugins` and try the skill.
3. Before you push, run the same manifest check as CI:

   ```sh
   claude plugin validate --strict .
   for source in $(jq -r '.plugins[].source' .claude-plugin/marketplace.json); do claude plugin validate --strict "$source"; done
   ```

CI also checks skill and agent names and every Markdown link on each push and pull request.

## Commits

Write commit messages as `type(scope): Summary`, with a lowercase type, the skill, plugin or area as the
scope, and a summary starting with a capital letter, for example
`fix(agent-rebase): Detected the branch's remote and asked before dropping unpushed commits`.

The release notes group commits by type:

| Type | Section in the release notes |
|:-----|:-----------------------------|
| `feat` | Features |
| `fix` | Bug Fixes |
| `docs` | Documentation |
| `refactor` | Code Refactoring |
| `ci` | Continuous Integration |
| `chore` | Chores |

Give a fix to something you just added its own `fix(...)` message. Reusing the `feat(...)` message lists the
same line twice in the notes.

## Releases

Only maintainers release, by running the Release workflow as described in
[Releasing](../README.md#releasing). Don't change `version` in a `plugin.json` by hand: the workflow raises
every plugin's version together, and it stops if they don't match.

## License

By contributing, you agree that your work is released under the [MIT License](../LICENSE).
