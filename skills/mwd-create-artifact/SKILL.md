---
name: mwd-create-artifact
description: Build a polished dark-themed (graphite + violet) single-page HTML artifact from what the session already holds — data, a diff, a plan, an investigation, options to compare — and publish it to a private claude.ai link with the Artifact tool. Checks first that this session can publish; if it can't, names the setting that blocks it and the fix instead of falling back to a local file or Markdown. Use whenever the user asks for an artifact, a dashboard, a visual or "fancy" HTML page, a report page, a PR walkthrough, a side-by-side comparison, or a progress tracker they can open as a link, or asks to turn session output into something nicer to look at — even if they don't say "dark" or "artifact". Not for documents people edit together (Claude Docs), slide decks, or files that belong in the repo.
argument-hint: "[what to build] [bg=graphite|navy|oled|warm|#hex]"
---

# Create artifact

Turn what this session knows into one polished dark page on claude.ai, published with the Artifact tool and private to the user until they share it. The user wants the claude.ai link specifically: a local HTML file or a Markdown summary is not an acceptable substitute.

`$ARGUMENTS` may say what to build. If it's empty, work it out from the session (Step 2). It may also hold `bg=<preset or #hex>` for the page background (Step 5).

## Ground rules

- **Real content only.** Every number, name, and code line comes from the session, the repo, or a tool call. If a fact is missing, show it on the page as an open question. Never use a placeholder value. Readers will trust what looks finished.
- **The page lives outside the repo.** Write it to `${TMPDIR:-/tmp}/mwd-create-artifact/<slug>.html` unless the user names a location, and never commit it.
- **Sharing is the user's call.** A new artifact is private. Don't change its audience unless asked.
- In the page's own CSS and JS, keep comments to one line.

## Step 1 — Can this session publish?

The Artifact tool is the only reliable signal. If it's in your tool list, or ToolSearch `select:Artifact` loads it, go to Step 2. That one exact lookup settles it: don't run keyword searches for other publishing tools. Claude Docs, Figma and the app's pane tools can't publish an HTML artifact, and loading them only costs time.

If not, run `bash <skill-dir>/scripts/check-artifact-env.sh "$PWD"` (it runs on this machine and only reads local settings). Then reply with:

1. One line: artifacts can't be published from this session.
2. Each BLOCKER line with its `file:line` and fix, then any WARN lines, as the script printed them.
3. The reminder that settings and environment are read at startup, so the fix only takes effect in a **new** session.

Then stop. Don't build the page, don't write a local HTML file, and don't fall back to Markdown. The user chose this: a page that isn't on claude.ai isn't what they asked for, and building it anyway costs tokens for nothing. If the script finds no local blocker, relay its account-side causes (plan, org toggle, CMEK/HIPAA/ZDR, policy not loading).

If the publish call itself fails later, quote its error and stop the same way.

## Step 2 — Decide what to build

Read the recent turns and what they produced (a diff, query results, a plan, findings, a list of options), plus `$ARGUMENTS`.

- **One clear subject:** say so in one line (`Building: <title> — <what's on it>`) and go on. Don't ask for confirmation.
- **Several plausible subjects, or nothing in the session:** ask once with AskUserQuestion. Offer 2–4 concrete candidates taken from the session, recommended one first, each naming what the page would show (e.g. "Dashboard of the 14 failed deploys we pulled", "Walkthrough of the session-refresh diff"). If the session is empty, ask what the page should show and where its data comes from.
- **A key fact you can't fetch** (which time range, which branch): include it in that same question.

Don't ask about colours, fonts, or layout. The design system settles those, and the user picked it already. The only colour input is a `bg=` the user passes.

## Step 3 — Gather the content

Fetch what's missing with tools (`git diff`, files, MCP queries) and keep a list of sources for the footer. Summarise big datasets (top N, totals, a sample) instead of inlining every row. Every inlined row costs output tokens, and the published page must stay under 16 MiB.

## Step 4 — Pick the page shape

| The page answers | Shape |
|:--|:--|
| How are we doing? (metrics, failures, usage) | Stat row → 1–3 charts → detail table |
| What changed and is it right? (PR, commit) | Header naming the change → summary + findings by severity → per-file annotated diffs |
| Which option? | Grid of option cards (recommended one accented) → criteria table → recommendation callout |
| What happened? (incident, investigation) | Lead answer → timeline → evidence sections → open questions |
| How far along are we? | Progress bar → grouped checklist; republish as items close |
| What value should this be? | Controls bound to a live preview → result to copy back into the session |

Lead with the answer. The header's lead sentence states the conclusion and its number.

A page about a commit, PR or MR must say which change it is, because people open shared links cold. Put the short SHA or PR/MR number in the eyebrow and the subject line verbatim in the h1 or lead. Author, date, files changed and +/− lines go in the meta row.

## Step 5 — Build it

Read `references/design.md`, then copy `references/template.html` to the page path and fill it in. The template already holds every component's CSS. Add markup from design.md, keep the tokens, and delete nothing from `:root`.

**Background.** With no `bg=`, keep `--bg` as it is (graphite). With `bg=navy`, `oled` or `warm`, set `--bg` to that preset's hex from design.md §1. With `bg=#rrggbb`, set `--bg` to it as given; Step 6 checks its contrast. Change only `--bg`: the surfaces, glow and button text derive from it. The page must stay dark, because the text tokens are only readable on dark surfaces. If the user asks for a light background, say so instead of building it.

The artifact viewer serves the page under a strict Content Security Policy:

- **External requests:** fonts load only from Google Fonts (already linked). Scripts load only from cdnjs.cloudflare.com, unpkg.com, cdn.jsdelivr.net/npm/, cdn.tailwindcss.com, and code.jquery.com. External images and stylesheets are blocked, and `fetch` reaches nothing else.
- **Charts:** bar charts are HTML (`.bars`), line charts are `.linechart` (SVG line, HTML labels). Text drawn inside an SVG shrinks with it and becomes unreadable on a phone. Other images are inline SVG. Embed raster images as small data URIs only when they're the point.
- **One page:** relative links don't resolve, so use in-page anchors for sections.
- **Downloads:** the viewer blocks downloads the page starts itself. A download button needs the downloads capability declared when publishing, and the user is asked first. Add one only when asked.
- **Encoding:** save as UTF-8 `.html`.

## Step 6 — Check before publishing

Run `bash <skill-dir>/scripts/lint-page.sh <page>`. It checks for:

- resources loaded from hosts outside the allowed list
- leftover template placeholders
- `<text>` inside SVG
- the 16 MiB size limit
- WCAG AA contrast of every token pair, with the surfaces derived from `--bg`

Fix every FAIL and run it again. REVIEW lines list colour literals outside `:root`: they're allowed only in SVG `fill`/`stroke` the tokens can't reach, or in code samples. If a custom `bg=` fails contrast, tell the user which pair fails and suggest the nearest preset. Don't adjust other tokens to make it pass.

Then re-read the first screen as the reader: does the lead answer the question? Is every number traceable to a source?

## Step 7 — Publish and reply

Publish the file with the Artifact tool. Use a short, specific title (≤ 6 words, e.g. "Deploy failures, 1–14 Oct") and a tab icon matching the content (chart, diff, checklist, calendar).

Reply with the link, one line on what the page shows, and a note that it's private until shared from the page header. Don't paste the page's content into chat.

## Updating

To revise, edit the same file and publish again. It lands on the same URL as a new version. To update an artifact from an earlier session, find its URL with `Artifact action: "list"` (newest first, with titles), or ask the user if it isn't there. Read it with `action: "read"`, build on the version that comes back, then publish with `url` set. Without the URL, publishing creates a new artifact.
