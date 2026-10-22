# Closing the run — Step 4.4

Step 4.4 closes every run with the **chat summary** (4.4.b). When `$ARGUMENTS` carried the `artifact`
token, it first builds and publishes the full review as a **private claude.ai page** (4.4.a), so the
summary can link it. Nothing in this file is ever posted to GitLab/GitHub. Read this file when you
reach Step 4.4.

**Without the `artifact` token there is no report page** — go straight to 4.4.b. Do not write an HTML
file locally, do not write a Markdown report, and do not offer either as a substitute: the chat summary
is the whole output of a run without the token.

## 4.4.a Artifact report (only when `artifact` was passed)

The page is the audit log of the run: every finding, posted or not, with its fix code and its full
AI-fix prompt. It reuses the `mwd-create-artifact` skill's design system — same tokens, same
components — so a review page looks like every other artifact from these skills.

### a.1 Can this session publish?

The **Artifact tool** is the only reliable signal. If it is in your tool list, or `ToolSearch`
`select:Artifact` loads it, continue. That one lookup settles it — do not go looking for other
publishing tools.

If it cannot be loaded, run the artifact skill's environment check (`$ARTIFACT_DIR` is resolved in
a.2):

```bash
bash "$ARTIFACT_DIR/scripts/check-artifact-env.sh" "$PWD"
```

Then say in **one or two lines** that the artifact report could not be published, quote the BLOCKER
lines with their `file:line` and fix, and note that settings are read at startup so the fix only takes
effect in a **new** session. Then **go to 4.4.b and close the run normally**. A report that cannot be
published never blocks the review output — the findings are already in context, and the chat summary
carries them. Do the same, in one line, if the publish call itself fails later.

### a.2 Resolve the artifact skill

The two skills are installed side by side, so resolve the sibling directory rather than guessing a path:

```bash
SKILL_DIR="$(dirname "<path-to-this-skill's-SKILL.md>")"
ARTIFACT_DIR="$(dirname "$SKILL_DIR")/mwd-create-artifact"
[ -f "$ARTIFACT_DIR/references/template.html" ] ||
	ARTIFACT_DIR="$(find "$HOME/.claude" -maxdepth 5 -type d -name mwd-create-artifact -print -quit 2>/dev/null)"
[ -f "$ARTIFACT_DIR/references/template.html" ] || { echo "mwd-create-artifact not installed"; }
```

If it is not installed, say so in one line and close with 4.4.b — same rule as a.1.

### a.3 Build the page

1. **Read `$ARTIFACT_DIR/references/design.md`** — it holds the token rules, the component markup, and
   the "what makes it look cheap" list that this page follows.
2. Copy the template to the page path:

   ```bash
   PAGE="${TMPDIR:-/tmp}/mwd-create-artifact/review-<mr|pr|local>-<id>-<YYYYmmdd-HHMMSS>.html"
   mkdir -p "$(dirname "$PAGE")" && cp "$ARTIFACT_DIR/references/template.html" "$PAGE"
   ```

3. Fill it with the layout in a.4. Keep every `:root` token, delete nothing from it, and reference
   tokens rather than raw colour values.
4. **Background**: with no `bg=` in `$ARGUMENTS`, leave `--bg` as it is. With `bg=navy`, `oled`, `warm`
   or `bg=#rrggbb`, set **only** `--bg` to that value from design.md §1; a.5 re-checks the contrast.

### a.4 Layout

Same report as the page this skill used to render locally, rebuilt from the artifact components. One
page, in this order. Use in-page anchors — relative links do not resolve in the viewer.

| Section | Markup |
|:--|:--|
| Header | `.eyebrow` = `<project> · <MR !482 / PR #17 / branch> · <GitLab / GitHub / local>`; `h1` = the change title (the branch name when local); `.lead` = the verdict in `<strong>` then the one-sentence assessment with its counts; `.meta` = verdict badge, author, reviewed-at, state, CI badge, `source → target`, 12-char head SHA, execution mode, labels as `.badge`s, and an `Open MR/PR ↗` link when there is a `url` |
| `.sevbar` | The counts, as one thin rule-bounded strip right under the header: all four severities (zeros muted, not hidden — the shape of the review is the point), then posted, files changed, and `+412 / −96` lines. **Not** `.stat` cards: seven dashboard tiles for seven small numbers is most of the page's weight spent on its least important content, and the design system reserves `.stats` for 3–4 headline numbers on a page that is about numbers. This page is about findings |
| Executive summary | The Step 4.4 prose as `<p>`s directly under the strip, then "What looks good" as a `.callout` (omit the callout when there is nothing genuine to name) |
| `.toc` | Pill nav to the sections below, when there are 4 or more |
| Coverage | One `.badge` per dimension from the Coverage line: `--ok` for `clean`, `--warn` for a finding count, `--bad` for `not reviewed` (with the reason in the badge text). Follow it with the pre-scan tally as one `.muted` line, and on a `build` run a second badge row for the tools — same colour rule, `--bad` for `not run` with its reason |
| Findings | One `<section>` per status group, in this order and skipping any that is empty: **Posted inline**, **Kept in chat**, **Already raised**. Heading carries the count. Findings are ordered CRITICAL → HIGH → MED → LOW inside each group, as `.card`s in a `.findings` stack |
| Mechanical pre-scan | The tally as **one `.muted` line** — `7 hits → 2 raised, 5 dismissed` — then the dismissed hits in a `<details>` holding a `.table-wrap` table of hit → reason. Three numbers do not need three cards. On a `build` run the dismissed diagnostics join that table, each marked `pre-existing` or with its own reason |
| Not reviewed | A `.card` listing each file that could not be reviewed, in `<code>`. Omit the section when every file was reviewed |
| `footer` | `Generated by /mwd-code-review-interactive`, the date, and the sources actually used: the change URL, the head SHA, and the dimensions applied |

**Flat on purpose.** The review page is the one deliberate exception to the artifact design system's
depth: no background glow, no shadows, no hover lift, and surfaces only where something genuinely needs
a ground — code blocks, table headers, chips. Cards and callouts are hairline outlines on the page
background. A review is read closely and at length, often by someone looking for a specific finding, so
the page is laid out for scanning rather than for first impression: depth cues that make a dashboard
inviting are, over 20 findings, just noise between the reader and the text. The overrides that do this
are the first four rules of the CSS block below; the tokens themselves are untouched, so `bg=` and the
contrast check behave exactly as they do on every other page.

**One pill shape on the page.** Every chip is a `.badge`, which is fully rounded. An inline `<code>`
is *not* a pill — it has its own small radius and border, and next to a badge it reads as a squared
version of one. So keep `<code>` for code inside prose and nothing else: a file path, a line number, a
branch, a SHA, a mode is **metadata**, and goes in plain `.mono` text with no chip around it. Mixed
radii on one row is the single thing that makes this page look assembled rather than designed.

One finding card:

```html
<article class="card">
	<div class="finding__head">
		<span class="badge badge--bad">HIGH</span>
		<h3>Unbounded retry queue grows without a cap</h3>
		<span class="finding__id">HIGH-1</span>
		<a class="badge badge--ok" href="https://…#note_1234567" target="_blank" rel="noreferrer">Posted inline ↗</a>
	</div>
	<p class="muted"><span class="mono">src/queue.ts:142</span> · DoS &amp; Resource Exhaustion</p>
	<p>What is wrong and why it matters.</p>
	<div class="block__label">Fix · posted as an inline suggestion</div>
	<div class="code"><pre><span class="ln ln--del">-  return token;</span><span class="ln ln--add">+  return refresh(token);</span></pre></div>
	<details class="prompt">
		<summary>AI fix prompt<button class="btn" type="button" data-copy>Copy</button></summary>
		<div class="code"><pre>…the prompt, verbatim…</pre></div>
	</details>
	<p class="muted">Anchor fallback used: file-level comment</p>
</article>
```

Badge mapping, so severity and status read the same on every page:

| Value | Badge |
|:--|:--|
| `CRITICAL`, `HIGH` | `badge--bad` |
| `MED` | `badge--warn` |
| `LOW` | `badge` |
| status `posted` | `badge--ok`, wrapped in an `<a>` to the comment when there is one |
| status `kept` | `badge` — the chat summary's reason (`not selected`, `un-anchorable`, `over the selection cap`, `local run`) goes in the badge text |
| status `already_raised` | `badge`, plus an `Existing thread ↗` link under the description |

CRITICAL and HIGH share one colour because the system has three status colours, not four; the badge
text is what distinguishes them. The old local report also carried a theme toggle, a findings search
box and severity filters — the artifact is dark-only and static, so those are gone. Nothing else about
the page changes.

**The review layout's own CSS.** Append exactly this after the template's styles. Every value comes
from a token, and this is the whole of what the review page adds or overrides:

```css
/* Flat: a review carries no depth cues. Structure comes from hairlines, not from lift. */
body { background: var(--bg); }
.card, .callout { background: transparent; }
.card--accent { box-shadow: none; }
tbody tr:hover td { background: transparent; }

.mono { font-family: var(--font-mono); font-size: 0.92em; }
.sevbar { display: flex; flex-wrap: wrap; align-items: baseline; gap: calc(var(--space) * 3);
          margin-top: calc(var(--space) * 3); padding: calc(var(--space) * 1.5) 0;
          border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.sev { display: inline-flex; align-items: baseline; gap: 7px; color: var(--muted); font-size: 13px; }
.sev b { font-size: 19px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.sev--bad b { color: var(--bad); }
.sev--warn b { color: var(--warn); }
.sev--zero b { color: var(--muted); font-weight: 500; }
.sevbar .sev--push { margin-left: auto; }
.findings { display: grid; gap: calc(var(--space) * 2); }
.finding__head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.finding__head h3 { flex: 1 1 260px; margin: 0; }
.finding__id { color: var(--muted); font: 500 12px var(--font-mono); }
.block__label { color: var(--muted); font-size: 12px; font-weight: 500; letter-spacing: 0.06em;
                text-transform: uppercase; margin: calc(var(--space) * 2) 0 6px; }
details.prompt > summary { display: flex; align-items: center; gap: var(--space); cursor: pointer;
                           color: var(--muted); font-size: 13px; font-weight: 600; padding: 7px 10px;
                           border: 1px dashed var(--border); border-radius: var(--radius-sm); }
details.prompt > summary:hover { color: var(--accent); border-color: var(--accent); }
details.prompt > summary [data-copy] { margin-left: auto; padding: 2px 10px; }
details.prompt > .code { margin-top: calc(var(--space) * 1.5); }
```

The severity strip, with zeros kept and muted:

```html
<div class="sevbar">
	<span class="sev sev--zero"><b>0</b> Critical</span>
	<span class="sev sev--bad"><b>1</b> High</span>
	<span class="sev sev--warn"><b>2</b> Med</span>
	<span class="sev sev--zero"><b>0</b> Low</span>
	<span class="sev sev--push"><b>2</b> posted</span>
	<span class="sev"><b>11</b> files</span>
	<span class="sev"><b>+412 / −96</b> lines</span>
</div>
```

**The copy button.** The AI-fix prompt is the one thing a reader takes off the page, so each `<details>`
gets one. The viewer's sandbox may block the clipboard, so selecting the text is the fallback:

```html
<script>
document.addEventListener('click', function (e) {
	var btn = e.target.closest('[data-copy]');
	if (!btn) return;
	e.preventDefault();
	var pre = (btn.closest('details') || btn.closest('.card')).querySelector('pre');
	if (!pre) return;
	var done = function (label) { btn.textContent = label; setTimeout(function () { btn.textContent = 'Copy'; }, 1600); };
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(pre.textContent).then(function () { done('Copied'); }, function () { select(pre); });
	} else {
		select(pre);
	}
	// Clipboard blocked: leave the block selected so Cmd+C works.
	function select(node) {
		var range = document.createRange();
		range.selectNodeContents(node);
		var sel = window.getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
		done('Press Cmd+C');
	}
});
</script>
```

### Fidelity rules

- **Every finding goes on the page**, including the ones the user declined to post and the ones
  already raised. The platform only ever got the approved subset; this page is the full record.
- `fix_code` and `ai_prompt` are reproduced **verbatim** from what Step 3 produced — the copy button is
  how the user gets the prompt for a finding that was never posted. Strip the block's common
  indentation so it reads flush, and change nothing else.
- One fix block per finding. A `suggestion` is the same fix rewritten for the platform's one-click
  apply, so it is not a second block: it only adds `· posted as an inline suggestion` to the label, and
  stands in for `fix_code` when there is none.
- Coverage and pre-scan numbers must match the 4.4.b Coverage line exactly. A dimension missing from
  the page is the same failure that line exists to prevent.
- **Escape code and prose yourself** — `&amp;`, `&lt;`, `&gt;` in every `<pre>`, `<code>`, diff line and
  table cell. You are writing the HTML directly, so nothing escapes it for you.
- Prose is written as **HTML**, not markdown: `<code>`, `<strong>`, `<em>`, `<a href>`, `<p>` per
  paragraph. A stray `**bold**` renders as asterisks.
- Real values only. A field you do not have is a row you omit, never a placeholder.

### a.5 Check, publish, link

```bash
bash "$ARTIFACT_DIR/scripts/lint-page.sh" "$PAGE"
```

Fix every FAIL and run it again. REVIEW lines list colour literals outside `:root` — on this page they
are allowed only inside a finding's code sample. If a custom `bg=` fails contrast, say which pair fails
and fall back to the nearest preset rather than touching the other tokens.

Then publish `$PAGE` with the **Artifact tool**: a title of at most 6 words (`Review MR !482`,
`Review PR #17`, `Review feat/queue`), the icon `diff`, and a one-sentence description naming the
verdict and the counts. Keep the returned URL for 4.4.b.

The artifact is **private** until the user shares it from the page header — say so in one line, and do
not change its audience. Each run publishes its own page, which keeps the archive property the local
reports had: re-reviewing the same change never overwrites an earlier review. To put a re-review on the
**same** URL instead, follow the "Updating" section of `$ARTIFACT_DIR/SKILL.md` and publish with `url`
set.

## 4.4.b Final chat summary

Close the run with a **short** summary **in chat only** — do not post it to GitLab/GitHub. Render it as
normal markdown — no outer copy-paste fence, and no code blocks anywhere in it. Every finding appears
exactly once, as a **single table row**, whether it was posted or kept.

When 4.4.a ran, the page holds every finding in full and this summary is a one-screen manifest that
points at it. **Without the `artifact` token this summary is the only record of the run**, so it carries
the same table either way — brief, but complete: every finding, its location, and what happened to it.
The user can ask for any single finding in full afterwards (see the end of this file).

**This brevity is scoped to the chat summary and nothing else.** The inline comments posted in 4.3 and
the artifact page built in 4.4.a stay **full-length** — full description, suggestion block, and the
complete AI-fix prompt with its code snippet, exactly as those steps specify. Never trim a posted
comment or a page entry to match the style below. Layout:

### Executive Summary
[2-3 sentences: overall assessment, number of critical/high findings, primary areas of concern. Include the CI status (e.g., "CI: failed") and, for large changes, name any files that could not be reviewed.]

**Verdict:** [APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES]

**Coverage:** one compact line naming **every** dimension applicable per Step 2, each with `clean`, a finding count, or `not reviewed` + reason — in **both** execution modes, so a small change is auditable exactly like a large one. End it with the pre-scan tally, and on a `build` run with the `build:` segment from `build-check.md` — naming every tool, including the ones that did not run and why. A dimension or a tool that is silently absent is the failure this line exists to prevent.

`Correctness ✓ · Security ✓ · Docs ✓ · TypeScript (2) · Device runtime (1, target swc es5) · Platform scripts ✓ · pre-scan: 7 hits → 2 raised, 5 dismissed · build: tsc 3 → 2 raised, 1 pre-existing · eslint clean · selection: 12 of 19 offered`

The `selection:` segment appears only when Step 4.1's cap actually held something back, and names both
numbers. Without it, the reader cannot tell a run that found 12 findings from one that offered 12 of 19.

When the device dimension ran, name the resolved build target in its entry as above — a device
review judged against an unstated target is not auditable.

**Report:** only when 4.4.a published a page — the artifact URL it returned, in full, with one line
saying it is private until shared. Omit this line entirely on a run without the `artifact` token;
never replace it with a local file path, and never offer to write one.

### Posted inline (n)

**Local mode: omit this section entirely** — nothing was posted, so an empty "Posted inline (0)"
heading is noise. Every finding goes under "Kept in chat" with `local run` as the reason, and the
executive summary opens by naming the branch and base (`Local review of feat/queue vs origin/master`)
so the report is not mistaken for an MR review.

| ID | Finding | Location | Category | Thread |
|:---|:--------|:---------|:---------|:-------|
| HIGH-1 | Unbounded retry loop | `src/api.ts:42` | DoS & Resource Exhaustion | [note](https://gitlab.com/group/repo/-/merge_requests/482#note_1) |
| MED-1 | Missing null guard | `src/ui.tsx:10` | Correctness | [note](https://gitlab.com/group/repo/-/merge_requests/482#note_2) — file-level fallback |

### Kept in chat (n)

| ID | Finding | Location | Category | Why not posted |
|:---|:--------|:---------|:---------|:---------------|
| MED-2 | Duplicate fetch per render | `src/a.ts:88` | Efficiency | not selected |
| LOW-1 | Stale JSDoc on `parse()` | `src/b.ts:12` | Docs | un-anchorable |
| LOW-2 | Unhandled reject path | `src/c.ts:5` | Correctness | already raised — [thread](https://gitlab.com/group/repo/-/merge_requests/482#note_3) |
| LOW-3 | Magic number in backoff | `src/d.ts:31` | Code quality | over the selection cap |

Table rules:
- A finding held back by Step 4.1's selection cap is a row like any other, with `over the selection cap` as its reason. The cap decides what was offered for posting, never what is reported — every finding still appears exactly once, and a run that capped says so in its Coverage line.
- **ID** without brackets; severity is readable from the prefix, so no separate severity column.
- **Finding** is a noun phrase of ≤ ~8 words — not a sentence, not the description.
- Never add a Description or Fix column, and never inline a code snippet: that detail belongs in the artifact page, or in an on-demand answer below.
- Skip an empty group's table entirely and say it in one line instead ("Nothing posted — all 3 findings kept in chat.").
- A posted finding that needed a non-inline anchor notes the fallback level in the Thread cell, as above.

### What looks good
[One line, only if there is genuinely something to name. Omit the section otherwise.]

**On demand only:** if the user then asks about a specific ID, print that one finding in full — file
and line(s), category, description, and its `fix_code` in a fenced block. Never volunteer these blocks
for the whole set; that is the long output this summary replaces.
