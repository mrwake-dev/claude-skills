# Code review

`/mwd:mwd-code-review-interactive` reviews GitLab merge requests through `glab` and GitHub pull requests
through `gh`, and picks the right one from the URL. A run goes like this:

1. It fetches the diff and reviews it.
2. It shows you the findings and asks which ones to post.
3. It posts only those, as comments on the changed lines. Each comment has a suggested fix you can apply
   with one click and a prompt you can paste into an AI assistant.

To review your current branch without GitLab or GitHub, pass `local` instead of a URL, or
`local <base-ref>` to compare against something other than the default branch. Nothing is fetched or
posted, and you get every finding in chat.

## Options

Add any of these after the URL or `local`:

| Option | What it does |
|:-------|:-------------|
| `build` | Runs the repo's own compiler and linter and uses their output as evidence, so a type error is confirmed by the tool, not just by reading the code. It never installs anything, and it skips itself when your checkout isn't on the change being reviewed. |
| `max=<n>` | Caps how many findings are offered for posting, dropping the least severe first. The default is 12, and `max=all` removes the cap. Critical and high findings are always offered, and the ones left out still appear in the summary. |
| `artifact` | Also publishes the full review as a private claude.ai page. See [Report page](#report-page). |

## Examples

Review a GitHub pull request:

```text
/mwd:mwd-code-review-interactive https://github.com/your-org/your-repo/pull/42
```

Review a GitLab merge request, on gitlab.com or your own GitLab server:

```text
/mwd:mwd-code-review-interactive https://gitlab.example.com/your-group/your-repo/-/merge_requests/17
```

Review your current branch against the default branch, without GitLab or GitHub:

```text
/mwd:mwd-code-review-interactive local
```

Compare your branch against a different one, such as a release branch:

```text
/mwd:mwd-code-review-interactive local origin/release/2.0
```

Back the review with the repo's own compiler and linter:

```text
/mwd:mwd-code-review-interactive local build
```

Offer up to 5 findings for posting (critical and high ones are offered regardless), or all of them:

```text
/mwd:mwd-code-review-interactive https://github.com/your-org/your-repo/pull/42 max=5
/mwd:mwd-code-review-interactive https://github.com/your-org/your-repo/pull/42 max=all
```

Also publish the full review as a private page with a navy background:

```text
/mwd:mwd-code-review-interactive https://github.com/your-org/your-repo/pull/42 artifact bg=navy
```

Options combine, in any order:

```text
/mwd:mwd-code-review-interactive https://gitlab.example.com/your-group/your-repo/-/merge_requests/17 build max=all artifact
```

Run the command with nothing after it and it asks whether you want to review a URL or your local
branch.

## How it checks its own work

- Before you see a finding, it checks it against the whole file and the code that calls it, and drops it
  if the surrounding code already handles the problem.
- It skips anything already raised, either by an earlier run or by a person in an existing comment
  thread.
- It searches the diff for patterns that are never allowed, such as `any`, `React.FC` or a bare
  `except:`. Every match becomes a finding, or is recorded with the reason it was dismissed.
- It reviews one area at a time: correctness, security, docs, language conventions, device runtime and
  platform scripts. Changes over about 300 lines or 5 files get one reviewer agent per area, running in
  parallel.
- The summary says which areas it reviewed, so you can see what it covered.

The checklists live in the skill's [`references/`](../skills/mwd-code-review-interactive/references/)
folder: one per language, plus device rules for Tizen, webOS and BrightSign. The GitLab and GitHub
details are in `platform-gitlab.md` and `platform-github.md`.

## Report page

A run normally ends with a summary in chat: one row per finding, with where it is and what happened to
it. Add `artifact` and the full review is also published as a private claude.ai page, and the summary
links to it.

The page lists every finding, whether you posted it, kept it back or it was raised before, each with its
fix and a ready-to-paste AI prompt. It also shows which areas were reviewed, the dismissed pattern
matches and any files that couldn't be reviewed. It uses the same design as `/mwd:mwd-create-artifact`,
so `bg=navy`, `oled`, `warm` or a dark hex color work here too. The page stays private until you share
it from its header, and every run creates a new page, so reviewing a change again never overwrites an
earlier review.

If publishing isn't available in your session, the run tells you which setting blocks it and ends with
the chat summary instead. The review never waits on the page.
