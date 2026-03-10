---
name: markdown-check
description: Check and validate Markdown content for proper formatting and structure. Use when the user asks to validate or review Markdown content.
disable-model-invocation: true
---

# Skill: markdown-check

## Overview
The `markdown-check` skill is designed to analyze and validate Markdown content for proper formatting and structure. It can be used to ensure that Markdown documents adhere to best practices, such as correct heading levels, proper use of lists, and valid link syntax. This skill also checks grammar and spelling in the Markdown content.

## Usage
- Use this skill when you need to validate or review Markdown content for proper formatting, structure, and grammar.
- When user asks to check or validate Markdown content, invoke this skill to analyze the provided Markdown text and return feedback on any issues found.

## Workflow
1. Ask user the user which file they want to check, usually it's opened file, but if there are multiple files, ask which one they want to check. If the user doesn't specify, check the currently opened file.
2. Read the content of the specified Markdown file.
3. Analyze the Markdown content for:
   - Proper heading levels (e.g., H1, H2, H3)
   - Correct use of lists (ordered and unordered)
   - Valid link syntax
   - Proper formatting of code blocks
   - Grammar and spelling errors in the text
4. Compile a report of any issues found, including line numbers and suggestions for improvement.
5. Return the report to the user in a clear and concise format, use table format if there are multiple issues.

## Notes
- This skill focuses on English grammar and spelling. If the Markdown content is not in English, ask the user if they want to still check grammar and spelling.