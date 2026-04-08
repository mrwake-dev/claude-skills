---
name: mwd-create-mr-description
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
```md
## Description
[Provide a brief summary of the changes made in this merge request.]

### Changes
[List the key changes made in this merge request, including any new features, bug fixes, or improvements.]
```

## Example output
This example output is just for demonstrating how final output should be.

```md
## Description
This MR adds support for WiFi enterprise authentication (802.1X EAP) to the Tizen display driver, enabling devices to connect to enterprise networks using PEAP, TLS, and TTLS authentication methods.

### Changes
- **WiFi Enterprise Authentication (802.1X EAP)**
- **Phase 2 Authentication:** Added support for Phase 2 authentication methods:
  - PAP (Password Authentication Protocol)
  - MSCHAP v2 (Microsoft Challenge Handshake Authentication Protocol version 2)
  - GTC (Generic Token Card)
- **Test Coverage:** Added comprehensive unit tests (940+ lines) covering all methods, validation scenarios, and error handling
```

## Notes
- The generated MR description should be concise and informative, providing enough context for reviewers to understand the changes without needing to read through the entire git history.
- If there are multiple commits in the active branch, consider summarizing the commits into a cohesive narrative that explains the overall purpose and impact of the changes.