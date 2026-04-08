---
name: mwd-markdown-check
description: Check and validate Markdown content for proper formatting, structure, grammar and spelling. Use when the user asks to validate or review Markdown content.
disable-model-invocation: true
argument-hint: <path/to/markdown.md> [language]
allowed-tools: Read, Glob, Grep
---

# Markdown Check

Analyze and validate the Markdown file at `$0`.
The content language is: `$1` (default to English if not specified).

## Workflow

1. Read the file `$0`
2. Analyze the Markdown content for:
   - Proper heading hierarchy (H1 → H2 → H3, no skipped levels)
   - Correct use of ordered and unordered lists
   - Valid link and image syntax
   - Proper formatting of code blocks (language tags, closing fences)
   - Grammar and spelling errors in the `$1` language
3. Compile a report with line numbers and suggestions for improvement
4. Present the report in a table format: | Line | Issue | Suggestion |
5. After presenting the report, ask the user if they want you to automatically fix the found issues.
   - If yes, apply all fixes directly to `$0`
   - If there are issues that cannot be fixed automatically (e.g. ambiguous grammar), list them separately and ask for clarification