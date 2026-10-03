# Inline comment — body format, assembly & posting

Step 4.3 of the skill reads this file once the user has approved at least one finding. It never runs in
Local mode.

Post one comment per approved finding as an **inline diff comment** on the exact line, using the post
recipe in the platform reference you loaded in Step 0 (§"Step 4.3"). That reference gives the exact
`glab`/`gh` call, the line-type/side variants, the success check, and the fallback ladder. The comment
**body** described below is identical on both platforms — only the API call and the suggestion-fence
syntax differ.

**Comment body format** — the first line is a hidden marker `<!-- mwd-review:<ID>:<file>:<line> -->` followed by a blank line (HTML comments don't render in GitLab or GitHub markdown; the marker lets future runs recognize and dedupe this finding). Then the finding (severity+ID, title, **Category**, and what's wrong), an optional **suggestion block**, then a **collapsible** section (both GitLab and GitHub Flavored Markdown support `<details>`/`<summary>`) holding a copy-ready AI prompt inside a fenced code block (both platforms render a one-click copy button on code blocks). The prompt **must include the suggested code fix** — the same snippet as the finding's `fix_code` — embedded as plain indented lines: a nested triple-backtick fence would terminate the outer `text` fence, break rendering, and truncate what the copy button copies. The trailing `\` after the title line is a hard line break, so **Category** renders directly beneath the title; the blank lines around `<summary>` and before `</details>` are required so the fenced block renders (the `suggestion:-0+0` fence below is the **GitLab** form — on GitHub use a plain `suggestion` fence, see the suggestion rules):

````markdown
<!-- mwd-review:HIGH-1:src/foo.ts:42 -->

**[HIGH-1] <short title>**\
**Category:** <e.g., DoS & Resource Exhaustion>

<what's wrong and why it matters — 1–3 sentences>

```suggestion:-0+0
<replacement for the anchored line(s) — include ONLY when the fix qualifies per Step 3 "Fix delivery">
```

<details>
<summary>🤖 Copy this AI prompt for your agent to fix this issue</summary>

```text
Fix a code-review finding in `src/foo.ts` around line 42.
Problem: <concise description of the issue>.
Required fix: <concrete, actionable instructions>.
Suggested implementation (verify imports/APIs against the codebase before applying):

    <the finding's fix_code, as plain indented lines — no backtick fences>

Constraints: keep changes minimal and consistent with surrounding code; update/add tests if applicable.
```

</details>
````

**Suggestion block rules** (omit the block entirely when they don't hold):

- Only on comments anchored to the **new side** of the diff (added or context lines — GitLab `new_line` set / GitHub `side:"RIGHT"`). Suggestions cannot attach to removed lines.
- **Fence syntax is platform-specific.** GitLab: `suggestion:-N+M` replaces N lines above through M lines below the anchored line (`-0+0` = just the anchored line). GitHub: a plain `suggestion` fence replaces the anchored line, or the whole `start_line..line` range when the comment itself is multi-line (see the platform reference). Use the form for the detected platform. Either way the block content is the complete replacement for that range, with real indentation.
- The replacement content must never contain a line starting with three backticks.
- When the suggestion fully covers the fix, the `<details>` AI prompt may be omitted to keep the comment small; keep both when the suggestion is only the local part of a wider fix.

**Build and post the comment.** The body is multi-line and contains a `<details>` block and fenced code blocks, so it **cannot** be written with a plain heredoc straight into a JSON string — literal newlines inside a JSON string are invalid. Assemble the body once into a shell variable with a quoted heredoc (below), then hand it to the platform reference's §"Step 4.3" recipe, which builds the JSON with `jq -n --arg` (safely escaping newlines, backticks, quotes) and POSTs it via the platform CLI:

````bash
# Assemble the multi-line markdown body (marker + finding + optional suggestion + collapsible AI prompt).
# The suggestion fence below is the GitLab form (suggestion:-0+0); on GitHub use a plain `suggestion` fence.
# Then feed "$BODY" into the platform reference's Step 4.3 recipe (jq build + CLI POST + verify).
BODY=$(cat <<'EOF'
<!-- mwd-review:HIGH-1:src/foo.ts:42 -->

**[HIGH-1] <short title>**\
**Category:** <e.g., DoS & Resource Exhaustion>

<what's wrong and why it matters>

```suggestion:-0+0
<replacement line(s) — only when the fix qualifies>
```

<details>
<summary>🤖 Copy this AI prompt for your agent to fix this issue</summary>

```text
Fix a code-review finding in `src/foo.ts` around line 42.
Problem: <concise description>.
Required fix: <concrete instructions>.
Suggested implementation (verify imports/APIs against the codebase before applying):

    <fix snippet as plain indented lines — no backtick fences>

Constraints: keep changes minimal and consistent with surrounding code; update/add tests if applicable.
```

</details>
EOF
)
````

**Anchoring, verifying, and the fallback ladder are platform-specific** — follow the loaded platform
reference (§"Step 4.3"):

- **GitLab** anchors with a nested `position` object (base/head/start SHAs + `old_line`/`new_line` by
  line type) and must be a `DiffNote`; the summary link is `<mr-url>#note_<note_id>`.
- **GitHub** anchors with `commit_id` + `path` + `line` + `side` (`RIGHT`=new side, `LEFT`=old side);
  the response's `html_url` is the summary link.

In both cases: verify each post landed as a real inline comment (not a plain discussion/issue note),
record its direct link for the Step 4.4 summary, and if a line cannot be positioned walk the
reference's fallback ladder (alternate anchor → file-level comment → ask the user). Never silently
downgrade an inline-only finding to a plain comment without asking.

**Clean up** the diff temp files after all inline comments are posted (use whichever names Step 1
created). Do this **after** Step 4.4's report payload is written, or simply leave it to the end of the
run — nothing below needs the diff:

```bash
rm -f /tmp/mr-inline-comment.json /tmp/pr-inline-comment.json /tmp/mr-*.diff /tmp/pr-*.diff /tmp/mr-*.added /tmp/pr-*.added /tmp/mwd-review-report.json
```
