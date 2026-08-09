---
description: Open a code review report from the archive in the default browser (newest by default)
argument-hint: "[search text | index | #N | --list]"
allowed-tools: Bash(node:*)
---

Open a report from the `/mwd-code-review-interactive` archive in the user's default browser.

Run exactly one command — the resolver does the lookup and the opening:

```bash
node ~/.claude/skills/mwd-code-review-interactive/scripts/open-report.js $ARGUMENTS --open
```

Pass `$ARGUMENTS` through as-is; the resolver interprets it:

| Argument | Opens |
|:---------|:------|
| *(none)* | the newest report |
| `index`, `all`, `archive` | the archive index listing every review |
| `#3` | the 3rd newest review (positions come from `--list`) |
| anything else | the newest review matching it on project, title, author, verdict, or MR/PR number |

`--list` prints recent reviews numbered instead of opening one; keep `--open` off in that case, or the
command both lists and opens the newest match.

If the skill is installed somewhere other than `~/.claude/skills`, resolve the real path to
`skills/mwd-code-review-interactive/scripts/open-report.js` and use that.

Then report in **one or two lines**: which review was opened (project, MR/PR number, title, verdict)
and the `file://` URL, so the user can reopen it without the command. On a `--list` run, show the list
as the resolver printed it.

**Failure handling — do not improvise.** The resolver exits non-zero with a specific message:

- *no review archive* → the skill has not been run yet; say so and stop.
- *no review matches "…"* → rerun once with `--list` (no `--open`) and show the user what is available.
- *manifest points at a missing file* → the report was deleted from the archive; say so and stop.

Never fall back to opening a different report than the one asked for, and never search the filesystem
for HTML files outside the archive.
