# Dark artifact design system

Graphite surfaces, one violet accent, three data colours. Every page starts from `template.html`, which already holds all the CSS below. This file explains the rules and gives the markup for each component.

## Contents

1. Tokens
2. Page anatomy
3. Components (markup)
4. Charts
5. What makes it look cheap

## 1. Tokens

All colours live on `:root` in the template. Rules reference tokens, never raw hex, so one palette change re-skins the page. Every text pairing below passes WCAG AA.

| Token | Value | Use |
|:--|:--|:--|
| `--bg` | `#0b0b10` | Page background (plus one faint violet glow, top left) |
| `--surface` / `--surface-2` | `#16161f` / `#1e1e2a` | Cards, tables, charts / table headers, inline code, hover |
| `--border` / `--border-strong` | 8% / 14% white | Hairlines / inputs, timeline rail |
| `--text` / `--muted` | `#ececf1` / `#9a9aab` | Body / labels, axes, secondary |
| `--accent` | `#8b7cf6` | Links, eyebrow, the one thing to look at, series 1 |
| `--c2` `--c3` `--c4` | cyan `#4cc9f0`, amber `#f5b84c`, rose `#f2708a` | Data series 2–4, in that order |
| `--ok` `--warn` `--bad` | green `#5ad19a`, amber, rose | Status only: pass/fail, deltas, severity |

- Violet is scarce on purpose: eyebrow, links, the highlighted series or card, primary button. When everything is violet, nothing stands out.
- Status colours mean status. Don't use green or rose as decoration.
- Type: Inter for UI, JetBrains Mono for code, both from Google Fonts (the only external font host the artifact viewer allows) with system fallbacks. Numbers in stats and tables use tabular figures (`.num`).
- Spacing is a multiple of 8px. Radius 10px for containers, 6px for small parts.

## 2. Page anatomy

```
header   eyebrow (context: project · type) → h1 (specific title) → lead (the answer + its number) → meta (as-of date, source)
         a change walkthrough identifies the change in the header: eyebrow = repo · short SHA or PR/MR number,
         h1 or lead = its subject line verbatim, meta = author · date · files changed · +/− lines
         optional .toc pill nav when there are 4+ sections
stats    3–4 headline numbers, only when the page is about numbers
sections each = h2 + one main exhibit (chart, table, diff, grid of cards) + at most 2 short paragraphs
footer   sources actually used, generated date
```

The first screen must answer the question the page exists for. A reader who stops after the lead should still have the conclusion.

## 3. Components (markup)

Stat row:
```html
<div class="stats">
	<div class="stat"><div class="stat__label">Failed deploys</div><div class="stat__value">14</div><div class="stat__delta down">+6 vs last week</div></div>
</div>
```
`up` = good direction (green), `down` = bad direction (rose), regardless of the arithmetic sign.

Cards in a responsive grid (options to compare, per-service summaries). Mark the recommended one with `card--accent`:
```html
<div class="grid">
	<article class="card card--accent"><span class="badge badge--accent">Recommended</span><h3>Option B — edge cache</h3><p class="muted">One line on the trade-off.</p></article>
</div>
```

Table (sticky header, right-aligned numbers, status as badges):
```html
<div class="table-wrap"><table>
	<thead><tr><th>Service</th><th class="num">Failures</th><th>Status</th></tr></thead>
	<tbody><tr><td>billing-api</td><td class="num">6</td><td><span class="badge badge--bad">Failing</span></td></tr></tbody>
</table></div>
```

Callout (a decision, a risk, an open question): `<div class="callout callout--warn"><div class="callout__title">Open question</div>Which regions roll out first?</div>`

Annotated diff (PR walkthroughs). One `.ln` per line, escaped with `&lt;` `&gt;` `&amp;`; notes sit beside the code on desktop and stack below it on mobile:
```html
<div class="annotated">
	<div class="code">
		<div class="code__head"><span>src/auth/session.ts</span><span>+12 −4</span></div>
		<pre><span class="ln ln--hunk">@@ -40,6 +40,14 @@</span><span class="ln ln--del">-  return token;</span><span class="ln ln--add">+  return refresh(token);</span></pre>
	</div>
	<aside><div class="note note--warn"><strong>L42</strong> — refresh can throw; the caller doesn't catch it.</div></aside>
</div>
```

Timeline (investigations, incidents): `<ol class="timeline"><li><time>14:02</time>Alert fired on billing-api</li></ol>`

Checklist with progress (trackers that get republished as work moves):
```html
<div class="progress" aria-label="7 of 12 done"><span style="width:58%"></span></div>
<ul class="checklist"><li class="done">Migrate users table</li><li>Backfill sessions</li></ul>
```

Buttons and sliders (interactive tuners): `.btn`, `.btn--primary`, `<input type="range">` (already accent-coloured). For a "copy result" control, show the result in a `<pre>` the reader can select. The clipboard API may be blocked in the viewer's sandbox, so a copy button needs a select-the-text fallback.

## 4. Charts

Charts must read on a phone. SVG scales everything inside its `viewBox`, text included: an 11px label in a 600-wide viewBox renders at about 6px on a 390px screen. So keep every word and number in HTML, and use SVG only for marks that look right at any size (lines, areas). Both patterns below are hand-built: no library, no CDN, exact palette. Reach for a library (Chart.js from cdnjs) only for heavy interaction such as zoom or brushing over hundreds of points.

Pick by the data's shape:

| Data | Build it as |
|:--|:--|
| One measure across items | `.bars`, sorted descending |
| Parts of a whole | `.bars` with % values; no pie |
| Signed change | `.bars` with `--ok` / `--bad` fills and the sign in the value |
| Items × a few periods | One `.bars` chart per period in a `.grid` (small multiples), or `.linechart` with a line per item |
| One quantity over time | `.linechart` |
| Low–high range | `.bars` with the fill offset: `left` = low, width = high − low |

Rules:
- No `<text>` inside SVG. Labels, values and axes are HTML so they keep their size on every screen.
- Bars start at zero: `--v` = value ÷ max × 100%. Write the value beside every bar; then a legend is only needed with 2+ series.
- To make one bar the point, leave its fill violet (the default) and give the rest `bars__fill--muted`. Several series use `--c1` → `--c4` in order.
- A reference value (average, target, SLO) is a `.bars__mark` at the same `--at` in every row, named in `.chart__sub`.
- Hover detail: a `title` attribute on each `.bars__row`, a `<title>` inside each SVG line.
- More than 4 series → small multiples or a table.
- Every chart has a `.chart__title` stating the finding ("Billing failures doubled after the 3 Oct release") and a `.chart__sub` with the unit and range.
- On screens under 480px, each `.bars__row` stacks: label and value on one line, the full-width bar under them. Don't override that.

Bar chart (`.bars`):
```html
<figure class="chart" style="margin:0">
	<div class="chart__title">billing-api fails at twice the overall rate</div>
	<div class="chart__sub">Failed deploys per service, 1–14 Oct · dashed line = 11.4% overall rate</div>
	<div class="bars">
		<div class="bars__row" title="billing-api: 9 of 38 deploys failed">
			<span class="bars__label">billing-api</span>
			<span class="bars__track"><span class="bars__fill" style="--v:100%"></span><span class="bars__mark" style="--at:48%"></span></span>
			<span class="bars__value">23.7%</span>
		</div>
		<div class="bars__row" title="search: 4 of 51 deploys failed">
			<span class="bars__label">search</span>
			<span class="bars__track"><span class="bars__fill bars__fill--muted" style="--v:33%"></span><span class="bars__mark" style="--at:48%"></span></span>
			<span class="bars__value">7.8%</span>
		</div>
	</div>
</figure>
```
Range bar: `<span class="bars__fill" style="left:20%; --v:35%">`. Other fills: `bars__fill--c2`, `--c3`, `--c4`, `--ok`, `--bad`.

Line chart (`.linechart`): the SVG uses a 100 × 40 viewBox stretched to the plot area (`preserveAspectRatio="none"`), so x runs 0–100 across the period and y = 40 − value ÷ max × 40. `vector-effect="non-scaling-stroke"` keeps lines 2px at any size. Dots would stretch into ovals, so mark points through the `<title>` and name the key values in `.chart__sub`.
```html
<figure class="chart linechart" style="margin:0">
	<div class="chart__title">Deploy time crept up after 3 Oct</div>
	<div class="chart__sub">Median deploy minutes per day, 1–14 Oct · peak 11.4 on 9 Oct</div>
	<div class="linechart__body">
		<div class="linechart__y"><span>12</span><span>6</span><span>0</span></div>
		<svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Median deploy minutes per day">
			<line class="grid-line" x1="0" y1="0" x2="100" y2="0" vector-effect="non-scaling-stroke"/>
			<line class="grid-line" x1="0" y1="20" x2="100" y2="20" vector-effect="non-scaling-stroke"/>
			<line class="grid-line" x1="0" y1="40" x2="100" y2="40" vector-effect="non-scaling-stroke"/>
			<polygon points="0,40 0,26 15,25 31,21 46,14 62,2 77,9 100,8 100,40" fill="var(--c1)" fill-opacity="0.12"/>
			<polyline points="0,26 15,25 31,21 46,14 62,2 77,9 100,8" fill="none" stroke="var(--c1)" stroke-width="2" vector-effect="non-scaling-stroke"><title>1 Oct 4.1 → 9 Oct 11.4 → 14 Oct 9.6</title></polyline>
		</svg>
		<div class="linechart__x"><span>1 Oct</span><span>14 Oct</span></div>
	</div>
</figure>
```
y labels sit at the top, middle and bottom gridlines, so their values are max, max ÷ 2 and 0. x labels are spread evenly, so only label points that are evenly spaced in time (the period's ends are always safe). Add a `.legend` under the chart for 2+ lines.

## 5. What makes it look cheap

- Gradient text, glassmorphism stacks, glow on every card. One background glow and one accented card per page is enough.
- Emoji as icons. Use a badge, a small inline SVG, or nothing.
- Filler: a "Key takeaways" box that repeats the lead, a "Methodology" section nobody asked for, placeholder numbers or lorem ipsum.
- Centered body text, ALL-CAPS headings, more than two font weights in one block.
- Grey text below the muted token (`#9a9aab`). Anything dimmer fails contrast on these surfaces.
- Hardcoded hex in rules, which breaks the token system.
