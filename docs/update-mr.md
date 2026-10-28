# Updating a merge request

`/mwd-git:update-mr` writes or updates the title and description of the merge request (GitLab) or pull
request (GitHub) for the branch you're on. It works out the platform from the git remote and uses `glab`
or `gh`. Pass a URL to target a specific one instead.

The description comes from two places. The whole branch diff decides what changed. The conversation in
the session you run it from supplies the rest: why the work was done, what was decided, which tests ran,
and which related merge requests exist. So run it at the end of the session where you did the work.

A run goes like this:

1. It finds the branch, the remote, the platform and the open merge request for the branch. If that merge
   request was opened from a different branch, it warns you and asks before going on.
2. It compares the branch against a freshly fetched copy of the target branch, and collects from the
   conversation the intent, decisions, tests with their final result, related merge requests and issue
   keys.
3. It writes the new description, and a new title if the current one no longer fits.
4. It merges the new description into the existing one rather than replacing it. See
   [Updating an existing description](#updating-an-existing-description).
5. It shows the full new description, the title change and any lines the update would remove, then asks
   once what to do. With no merge request yet, it offers to create one as a draft.
6. It posts, then reads the merge request back to check it landed exactly as written.

## Examples

Update the merge request for the branch you're on:

```text
/mwd-git:update-mr
```

Update a specific one, on GitLab or GitHub:

```text
/mwd-git:update-mr https://gitlab.example.com/your-group/your-repo/-/merge_requests/17
/mwd-git:update-mr https://github.com/your-org/your-repo/pull/42
```

When it asks, the choices are:

| Situation | Choices |
|:----------|:--------|
| A merge request exists and the title changes | Update title and description, description only, or copy only |
| A merge request exists and the title stays | Update, or copy only |
| No merge request yet | Create a draft, or copy only |

"Copy only" posts nothing; the description is already in the chat for you to copy.

## What the description contains

- **Description:** up to three sentences on what the change does and why.
- **What changed:** up to eight one-line bullets, grouped by theme.
- **Companion MRs** (Companion PRs on GitHub): related merge requests in any repository, with full links,
  and the merge order when it matters.
- **Testing:** a table of every check that ran, with its type, where it ran and its result (✅, ❌ or ⚠️).
  It includes the CI pipeline when there is one.
- **Reviewer notes:** decisions with the alternative that was rejected, or the riskiest file to read
  first.
- **Related issues:** "Closes" only when the conversation says the change fully resolves the issue,
  otherwise "Related to".

The sections after the first two appear only when there is something real to put in them.

## Updating an existing description

| Section | What happens |
|:--------|:-------------|
| Description | Rewritten from the whole branch. If the session has no history about the branch, it's kept as it is unless the branch now covers more than it says. |
| What changed (or an older Changes) | Rewritten, under the heading What changed. |
| Companion MRs, Testing, Reviewer notes, Related issues | Kept, with new entries added. A test that ran again in this session replaces its old row. |
| Any other heading, text before the first heading, images, checklists | Left exactly as they are. |

## What it never does

- Commit, stage or push. To create a draft, the branch must already be on the remote. If it isn't, the
  skill prints the push command and stops.
- Post without asking. Every run asks, and dismissing the question posts nothing.
- Touch labels, reviewers, assignees, the draft or ready state, comments, or the related merge requests.
- List a test that didn't run, or hide a failure. A failure that wasn't fixed shows as ❌.
- Describe uncommitted changes, or anything discussed in the session that isn't in the diff.
- Copy secrets, tokens or personal data from the conversation, or make up a link for a ticket key.
