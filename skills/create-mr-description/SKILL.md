---
name: create-mr-description
description: Create a merge request description based on the provided content.
disable-model-invocation: true
---

# Skill: create-mr-description

## Overview
The `create-mr-description` skill is designed to generate a merge request (MR) description based on the git history and the changes made in a active branch. This skill can be used to create a comprehensive and informative MR description that summarizes the changes, the motivation behind them, and any relevant details that reviewers should be aware of.

## Usage
- Use this skill when you need to create a merge request description for a branch that has changes that need to be reviewed and merged into the main branch.
- When user asks to create a merge request description, invoke this skill to analyze the git history and changes in the active branch and generate a well-structured MR description.

## Workflow
1. Identify the active branch and the target branch for the merge request (e.g., main), use `git` commands to gather information about the commits and changes in the active branch compared to the target branch.
2. Analyze the git history of the active branch to gather information about the commits, including commit messages, and the files that were changed.
3. Summarize the changes made in the active branch, the key features or fixes implemented, and any relevant details that reviewers should be aware of.
4. Finally provide user markdown result in code block, based on the template below.

## Template for MR Description
```
## Description
[Provide a brief summary of the changes made in this merge request.]

### Changes
[List the key changes made in this merge request, including any new features, bug fixes, or improvements.]
```

## Notes
- The generated MR description should be concise and informative, providing enough context for reviewers to understand the changes without needing to read through the entire git history.
- If there are multiple commits in the active branch, consider summarizing the commits into a cohesive narrative that explains the overall purpose and impact of the changes.