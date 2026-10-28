# Resolving review comments

`/mwd-git:resolve-mr-comments` reads every review comment on a GitLab merge request or GitHub pull
request, checks each one against the current code, and applies the fixes you pick to the files on your
branch. It works out the platform from the URL and uses `glab` or `gh`.

A run goes like this:

1. It checks that you're on the merge request's source branch. If you aren't, it warns you and asks
   whether to go on. It also notes any uncommitted changes you already have, so you can tell its edits
   from yours.
2. It fetches every thread, both comments on lines and general ones, with their replies. It drops system
   notes such as label changes, and lists comments from bots without planning fixes for them.
3. It reads the code each comment points at, finding it by content because line numbers go stale, and
   sorts the comment into one of five groups.
4. It shows the plan and asks once which items to apply.
5. It applies the ones you picked, each as the smallest change that answers the comment, and may run a
   quick type-check on the files it touched.
6. It ends with a summary that accounts for every comment.

## How it sorts comments

| Group | Meaning | What happens |
|:------|:--------|:-------------|
| Actionable | A real issue that still exists, with a clear fix | Offered, with the proposed fix |
| Needs your decision | The right fix depends on intent, changes a public contract, or needs more than an edit (a dependency bump, a CI change, splitting the merge request) | Offered, without a proposed edit |
| Already addressed | The code already does what the comment asks | Listed, not offered |
| Incorrect | The comment's premise doesn't hold in this code | Listed with the reason, not offered |
| Not actionable | A question, praise or a discussion point | Listed, not offered |

## Examples

```text
/mwd-git:resolve-mr-comments https://gitlab.example.com/your-group/your-repo/-/merge_requests/17
/mwd-git:resolve-mr-comments https://github.com/your-org/your-repo/pull/42
```

The plan it shows before asking looks like this:

```text
Actionable:
[1] src/foo.ts:42 — reviewer: "handle the empty list"
      → Proposed fix: return early when items is empty
[2] src/bar.ts:10 — reviewer: "use the shared logger"
      → Proposed fix: replace console.log with logger.info

Needs your decision:
[3] src/baz.ts:88 — reviewer: "rename this endpoint" — changes a public API

Not planned (for your awareness):
- src/qux.ts:5 — already addressed in current code
- general — reviewer: question, non-actionable
```

Pick the items to apply. Picking nothing changes nothing.

## What it never does

- Commit, stage, push, stash, check out or reset. Every edit stays uncommitted for you to review.
- Write to GitLab or GitHub: no replies, no resolved threads, no new comments.
- Apply a fix you didn't pick.
- Discard or stash your uncommitted changes.
- Refactor code the comments didn't ask about, or reformat the repository.
