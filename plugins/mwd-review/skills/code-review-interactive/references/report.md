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
AI-fix prompt. It reuses the `create-artifact` skill's design system — same tokens, same
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
ARTIFACT_DIR="$(dirname "$SKILL_DIR")/create-artifact"
[ -f "$ARTIFACT_DIR/references/template.html" ] ||
	ARTIFACT_DIR="$(find "$HOME/.claude" -maxdepth 5 -type d -name create-artifact -print -quit 2>/dev/null)"
[ -f "$ARTIFACT_DIR/references/template.html" ] || { echo "create-artifact not installed"; }
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
| Header | `.eyebrow` = `<project> · <MR !482 / PR #17 / branch> · <GitLab / GitHub / local>`; `h1` = the change title (the branch name when local); `.lead` = the verdict in `<strong>`, then one sentence with the counts and the main area of concern. It names no single finding: the executive summary lists them; `.meta` = verdict badge, author, reviewed-at, state, CI badge, `source → target`, 12-char head SHA, execution mode, labels as `.badge`s, and an `Open MR/PR ↗` link when there is a `url` |
| `.sevbar` | The counts, as one thin rule-bounded strip right under the header: all four severities (zeros muted, not hidden — the shape of the review is the point), then posted, files changed, and `+412 / −96` lines. **Not** `.stat` cards: seven dashboard tiles for seven small numbers is most of the page's weight spent on its least important content, and the design system reserves `.stats` for 3–4 headline numbers on a page that is about numbers. This page is about findings |
| Executive summary | Lists, not paragraphs: **Fix before merging**, **Also worth knowing**, then "What looks good" as a `.callout`. See "The executive summary" below |
| `.toc` | Pill nav to the sections below, when there are 4 or more |
| Coverage | One `.badge` per dimension from the Coverage line: `--ok` for `clean`, `--warn` for a finding count, `--bad` for `not reviewed` (with the reason in the badge text). Follow it with the pre-scan tally as one `.muted` line, and on a `build` run a second badge row for the tools — same colour rule, `--bad` for `not run` with its reason |
| All findings | `<section id="index">` headed `All findings · <n>`: a `.table-wrap` table with the class `index`, one row per finding in severity order (CRITICAL → LOW, then by ID). Columns: the ID as its severity badge linking to the card (`<a class="badge badge--bad" href="#HIGH-1">HIGH-1</a>`), the title, the location as `.mono` with only the last two path segments and the line (`queue/retry.ts:142`), and the status: `Posted ↗` linking the comment, `Kept · <reason>`, or `Already raised ↗` linking the thread. Omit the section when there are 3 findings or fewer |
| Findings | One `<section>` per status group, in this order and skipping any that is empty: **Posted inline** (`id="posted"`), **Kept in chat** (`id="kept"`), **Already raised** (`id="raised"`). Heading carries the count. Inside a group, each severity present gets an `h3.sevhead` sub-heading with its count (`High · 4`), CRITICAL → HIGH → MED → LOW, followed by its own `.findings` stack. Each card has its finding ID as `id` and reads What, Why and Fix, with the proof in a collapsed Evidence block. LOW cards fold to their head and What. See "One finding card" below |
| Mechanical pre-scan | The tally as **one `.muted` line** — `7 hits → 2 raised, 5 dismissed` — then the dismissed hits in a `<details>` holding a `.table-wrap` table of hit → reason. Three numbers do not need three cards. On a `build` run the dismissed diagnostics join that table, each marked `pre-existing` or with its own reason |
| Not reviewed | A `.card` listing each file that could not be reviewed, in `<code>`. Omit the section when every file was reviewed |
| `footer` | `Generated by /mwd-review:code-review-interactive`, the date, and the sources actually used: the change URL, the head SHA, and the dimensions applied |

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

**The executive summary.** A reader who stops here should know what has to change and why. So it is
lists, never a paragraph that strings finding IDs together:

```html
<section id="summary">
	<h2>Executive summary</h2>
	<div class="block__label">Fix before merging</div>
	<ul class="keylist">
		<li><a class="badge badge--bad" href="#HIGH-1">HIGH-1</a><span>Failed jobs are retried without limit, so an upstream outage can take the worker down.</span></li>
	</ul>
	<div class="block__label">Also worth knowing</div>
	<ul class="notes">
		<li>CI failed on the lint job.</li>
		<li>Two <code>fixup!</code> commits need an autosquash before merge.</li>
		<li>Nothing was posted: no finding was selected.</li>
	</ul>
	<div class="callout"><div class="callout__title">What looks good</div>…</div>
	<nav class="toc" aria-label="Sections">…</nav>
</section>
```

- **Fix before merging** has one item per CRITICAL and HIGH finding: its ID badge linking to the card,
  then one sentence on what goes wrong and for whom. With no CRITICAL or HIGH finding, the label becomes
  **Main findings** and the list holds the MED ones, three at most. With no findings, leave it out.
- **Also worth knowing** has one line per note, and only the notes the run has: CI status, commit
  hygiene, whether the description matches the change, missing tests, files not reviewed, and what
  happened at posting.
- "What looks good" is left out when there is nothing genuine to name.

One finding card:

```html
<h3 class="sevhead sevhead--bad">High · 1</h3>
<div class="findings">
<article class="card" id="HIGH-1">
	<div class="finding__head">
		<span class="badge badge--bad">HIGH-1</span>
		<h4>Unbounded retry queue grows without a cap</h4>
		<a class="badge badge--ok" href="https://…#note_1234567" target="_blank" rel="noreferrer">Comment ↗</a>
	</div>
	<p class="muted"><span class="mono">src/queue.ts:142</span> · DoS &amp; Resource Exhaustion</p>
	<dl class="finding__body">
		<dt>What</dt>
		<dd>Failed jobs go back on the retry queue with no limit.</dd>
		<dt>Why</dt>
		<dd>During an upstream outage the queue grows until the worker runs out of memory, and healthy jobs are lost with it.</dd>
	</dl>
	<div class="block__label">Fix · posted as an inline suggestion</div>
	<div class="code"><pre><span class="ln ln--del">-  queue.push(job);</span><span class="ln ln--add">+  if (queue.length &lt; MAX_RETRIES) queue.push(job);</span></pre></div>
	<details class="evidence">
		<summary>Evidence</summary>
		<ul>
			<li><span class="mono">src/queue.ts:142</span> pushes every failed job back; nothing checks the queue length.</li>
			<li>The merge base capped it at 100 (<span class="mono">src/queue.ts:139</span> at <span class="mono">a1b2c3d</span>); this change removed the check.</li>
		</ul>
	</details>
	<details class="prompt">
		<summary>AI fix prompt<button class="btn" type="button" data-copy>Copy</button></summary>
		<div class="code"><pre>…the prompt, verbatim…</pre></div>
	</details>
	<p class="muted">Anchor fallback used: file-level comment</p>
</article>
</div>
```

A LOW card folds, so the page's length goes to the findings that matter. It holds the same content in
the same order, with three changes: the card is a `<details class="card finding--fold">`, its head is
the `<summary>`, and the location and What move into that summary so they stay visible while it is
closed. The `<dl>` below keeps only Why:

```html
<h3 class="sevhead">Low · 1</h3>
<div class="findings">
<details class="card finding--fold" id="LOW-1">
	<summary class="finding__head">
		<span class="badge">LOW-1</span>
		<h4>Backoff delay is an unnamed number</h4>
		<span class="badge">Over the selection cap</span>
		<span class="finding__loc muted"><span class="mono">src/queue.ts:88</span> · Code quality</span>
		<span class="finding__what"><span class="finding__label">What</span><span>The retry delay is a bare <code>3000</code> with no name or unit.</span></span>
	</summary>
	<dl class="finding__body">
		<dt>Why</dt>
		<dd>Whoever tunes the backoff has to work out that it means milliseconds.</dd>
	</dl>
	…Fix, Evidence and the AI fix prompt exactly as on an open card…
</details>
</div>
```

**What, Why and Evidence.** A finding arrives as one description plus whatever Step 3's verification
established. The card splits that so a reader gets the point in two short answers and the proof on
demand:

- **What**: one or two sentences, about 25 words at most, on what the code now does wrong, as
  behaviour a reader can picture without the diff. No line numbers, commit SHAs or before-and-after
  history here.
- **Why**: one or two sentences, about 25 words at most, on the consequence: what breaks, for whom,
  and when. It should make the severity understandable.
- **Evidence**: everything that proves it, as a short list: `file:line` references, the merge-base
  comparison, commit SHAs, related files, platform or version specifics. Omit the block when there is
  nothing beyond What and Why.
- **Restructure, never add.** Every claim on the card comes from the finding's description or from what
  Step 3's verification recorded. Shorten and reorder freely, but never introduce a cause, a
  consequence or a number that isn't there. When the finding states no consequence, Why says plainly
  what the description says rather than guessing at one.

When a What or Why runs long, the detail moves to Evidence; it doesn't leave the card. *Line 142,
changed in a1b2c3d, now pushes every failed job back onto the queue, where line 139 used to cap it at
100* becomes the What *Failed jobs go back on the retry queue with no limit*, and the line numbers,
the SHA and the old cap go to Evidence.

Every finding on the page gets this shape, whatever its group. Posted comments and the chat summary
keep the description as it was.

Badge mapping, so severity and status read the same on every page:

A card has one severity badge, and it reads the finding's ID (`HIGH-1`): the ID already names the
severity, so a separate `HIGH` badge would say it twice. The status badge says only what the group's
heading doesn't.

| Value | Badge |
|:--|:--|
| `CRITICAL`, `HIGH` | `badge--bad` |
| `MED` | `badge--warn` |
| `LOW` | `badge` |
| status `posted` | `badge--ok` reading `Comment ↗`, as an `<a>` to the comment; `Posted` with no link when there is none |
| status `kept` | `badge` with the chat summary's reason only: `Not selected`, `Un-anchorable`, `Over the selection cap` or `Local run`. The heading already says Kept |
| status `already_raised` | `badge` reading `Existing thread ↗`, as an `<a>` to the thread |

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

.mono { font-family: var(--font-mono); font-size: 0.92em; overflow-wrap: anywhere; }
a.badge:hover { text-decoration: none; border-color: currentColor; }
.sevbar { display: flex; flex-wrap: wrap; align-items: baseline; gap: calc(var(--space) * 3);
          margin-top: calc(var(--space) * 3); padding: calc(var(--space) * 1.5) 0;
          border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.sev { display: inline-flex; align-items: baseline; gap: 7px; color: var(--muted); font-size: 13px; }
.sev b { font-size: 19px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.sev--bad b { color: var(--bad); }
.sev--warn b { color: var(--warn); }
.sev--zero b { color: var(--muted); font-weight: 500; }
.sevbar .sev--push { margin-left: auto; }
.block__label { color: var(--muted); font-size: 12px; font-weight: 500; letter-spacing: 0.06em;
                text-transform: uppercase; margin: calc(var(--space) * 2) 0 6px; }
h2 + .block__label { margin-top: 0; }
.keylist { list-style: none; margin: 0 0 calc(var(--space) * 3); padding: 0; border-top: 1px solid var(--border); }
.keylist li { display: grid; grid-template-columns: 6.5rem minmax(0, 62ch); gap: calc(var(--space) * 2);
              align-items: baseline; padding: calc(var(--space) * 1.25) 0; border-bottom: 1px solid var(--border); }
.keylist .badge { justify-self: start; }
.notes { margin: 0 0 calc(var(--space) * 3); padding-left: 1.2em; }
.notes li { max-width: 62ch; margin-bottom: 4px; }
.index td:first-child { white-space: nowrap; }
.index td:last-child { color: var(--muted); }
.sevhead { display: flex; align-items: center; gap: calc(var(--space) * 1.5); color: var(--muted); font-size: 12px;
           letter-spacing: 0.06em; text-transform: uppercase; margin: calc(var(--space) * 4) 0 calc(var(--space) * 1.5); }
.sevhead::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
h2 + .sevhead { margin-top: 0; }
.sevhead--bad { color: var(--bad); }
.sevhead--warn { color: var(--warn); }
/* minmax(0, 1fr): a long code line scrolls inside its block instead of widening every card past the page. */
.findings { display: grid; grid-template-columns: minmax(0, 1fr); gap: calc(var(--space) * 2); }
.findings > .card { scroll-margin-top: calc(var(--space) * 3); }
.finding__head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.finding__head h4 { flex: 1 1 260px; margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; }
/* 62ch is about 75 characters of Inter: prose stays readable on a wide page, while code blocks keep the card's full width. */
.finding__body, .finding__what { display: grid; grid-template-columns: 4.5rem minmax(0, 62ch); gap: 6px calc(var(--space) * 2); }
.finding__body { margin: calc(var(--space) * 1.5) 0 0; }
.finding__body dt, .finding__label { color: var(--muted); font-size: 12px; font-weight: 500; letter-spacing: 0.06em;
                                     text-transform: uppercase; padding-top: 3px; }
.finding__body dd { margin: 0; }
details.finding--fold > summary { cursor: pointer; list-style: none; row-gap: 6px; }
details.finding--fold > summary::-webkit-details-marker { display: none; }
details.finding--fold > summary::after { content: ""; order: 1; width: 7px; height: 7px; margin: 0 4px;
                                         border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted);
                                         transform: rotate(-45deg); }
details.finding--fold[open] > summary::after { transform: rotate(45deg); }
details.finding--fold > summary:hover h4 { color: var(--accent); }
.finding__loc, .finding__what { order: 2; flex-basis: 100%; }
details.evidence, details.prompt { margin-top: var(--space); }
details.evidence > ul { margin: calc(var(--space) * 1.5) 0 0; padding-left: 1.2em; color: var(--muted); font-size: 14px; }
details.evidence > summary,
details.prompt > summary { display: flex; align-items: center; gap: var(--space); cursor: pointer;
                           color: var(--muted); font-size: 13px; font-weight: 600; padding: 7px 10px;
                           border: 1px dashed var(--border); border-radius: var(--radius-sm); }
details.evidence > summary:hover,
details.prompt > summary:hover { color: var(--accent); border-color: var(--accent); }
@media (max-width: 480px) {
	.finding__body, .finding__what { grid-template-columns: minmax(0, 1fr); row-gap: 2px; }
	.finding__body dd + dt { margin-top: var(--space); }
	.keylist li { grid-template-columns: auto minmax(0, 1fr); }
}
details.prompt > summary [data-copy] { margin-left: auto; padding: 2px 10px; }
details.prompt > .code { margin-top: calc(var(--space) * 1.5); }
/* The template pads code by its .ln diff lines; a block without them needs its own padding. */
.code pre:not(:has(.ln)) { padding: 12px 14px; }
details.prompt pre { white-space: pre-wrap; overflow-wrap: anywhere; }
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

**The page script.** The AI-fix prompt is the one thing a reader takes off the page, so each `<details>`
gets a copy button. The viewer's sandbox may block the clipboard, so selecting the text is the fallback.
The same listener opens a folded LOW card when a link to it is clicked, so the index and the ID links
never land on a closed card:

```html
<script>
document.addEventListener('click', function (e) {
	var link = e.target.closest('a[href^="#"]');
	if (link) {
		var target = document.getElementById(link.getAttribute('href').slice(1));
		if (target && target.tagName === 'DETAILS') target.open = true;
		return;
	}
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
- A finding ID mentioned in prose links to its card, `<a href="#HIGH-1">HIGH-1</a>`, wherever it
  appears: the summary, What and Why, Evidence, the pre-scan line. Inside a `<pre>` it stays plain text.
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
