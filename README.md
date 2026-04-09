# Claude Skills

A collection of custom skills for Claude Code — reusable, shareable skill definitions that extend Claude Code's capabilities. Skills are defined as Markdown files with structured prompts and workflows, and can be symlinked into `~/.claude/skills` to make them available across projects.

## Installation
```
cd /to/project/directory
ln -s ~/<path-to-repo>/claude-skills/skills ~/.claude/skills
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


## Skills
| Name | Description |
| :---- | :------ |
| `/mwd-markdown-check [file.md] <language:english>` | Validates the <file>.md, check the grammer and writes tips how to improve readibility. |
| `/mwd-create-mr-description` | Summarize changes in active branch and creates simple description for merge request. |
| `/mwd-java-security-check` | Verify whole project for security issues based Java standarts and provide feedback how to fix them. |
| `/mwd-code-review-local [gitlab-mr-url]` | Perform code review (LOCAL) for selected Gitlab merge request (by url) and provide feedback. |