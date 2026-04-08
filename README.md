# Claude Skills

A collection of custom skills for Claude Code — reusable, shareable skill definitions that extend Claude Code's capabilities. Skills are defined as Markdown files with structured prompts and workflows, and can be symlinked into `~/.claude/skills` to make them available across projects.

## Installation
```
cd /to/project/directory
ln -s ~/<path-to-repo>/claude-skills/skills ~/.claude/skills
```

## Skills
| Name | Description |
| :---- | :------ |
| `/mwd-markdown-check` | Validates the <file>.md, check the grammer and writes tips how to improve readibility. |