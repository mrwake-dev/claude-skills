#!/usr/bin/env node
'use strict';

/**
 * mwd-code-review-interactive — HTML report renderer.
 *
 * Reads a JSON payload describing one completed review, writes a self-contained
 * HTML report, appends the review to a manifest, and regenerates the archive
 * index that lists every review ever rendered.
 *
 * Usage:
 *   node render-report.js <payload.json> [--out-dir <dir>]
 *   node render-report.js -            [--out-dir <dir>]   # payload on stdin
 *
 * Default out-dir: $MWD_REVIEW_REPORTS_DIR or ~/.claude/code-review-reports
 *
 * Layout:
 *   <out-dir>/index.html                                  regenerated every run
 *   <out-dir>/reports.json                                append-only manifest
 *   <out-dir>/reports/<host>/<project>/<id>-<stamp>.html  one file per review
 *
 * No dependencies, no network. The payload schema is documented in
 * ../references/report.md.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/* ------------------------------------------------------------------ utils */

const SEVERITIES = ['CRITICAL', 'HIGH', 'MED', 'LOW'];
const STATUSES = {
	posted: { label: 'Posted inline', cls: 'posted' },
	kept: { label: 'Kept in chat', cls: 'kept' },
	already_raised: { label: 'Already raised', cls: 'raised' },
};

function esc(value) {
	return String(value === null || value === undefined ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Review prose is written as markdown, so render the inline subset it actually
 * uses. Code spans are split out first and only escaped, so markdown characters
 * inside `foo.bar(**x**)` stay literal; everything else is escaped before any
 * tag is introduced, which keeps this injection-safe.
 */
function mdInline(value) {
	return String(value === null || value === undefined ? '' : value)
		.split(/(`[^`\n]+`)/)
		.map((part) => {
			if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
				return `<code>${esc(part.slice(1, -1))}</code>`;
			}
			return esc(part)
				.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
				.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:])/g, '$1<em>$2</em>')
				.replace(
					/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
					'<a href="$2" target="_blank" rel="noreferrer">$1</a>',
				);
		})
		.join('');
}

/** Same, plus paragraph and line breaks — for multi-sentence prose fields. */
function mdBlock(value) {
	const text = String(value === null || value === undefined ? '' : value).trim();
	if (!text) return '';
	return text
		.split(/\n{2,}/)
		.map((para) => `<p>${mdInline(para).replace(/\n/g, '<br>')}</p>`)
		.join('');
}

function fail(message) {
	process.stderr.write(`render-report: ${message}\n`);
	process.exit(1);
}

/** Keep a path component safe to write to disk, and never let it escape out-dir. */
function safeSegment(value, fallback) {
	const cleaned = String(value || '')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^[.-]+/, '')
		.replace(/-+$/, '');
	return cleaned || fallback;
}

/** A project path keeps its slashes so the archive mirrors the remote layout. */
function safeProjectPath(value, fallback) {
	const parts = String(value || '')
		.split('/')
		.map((p) => safeSegment(p, ''))
		.filter(Boolean);
	return parts.length ? parts.join('/') : fallback;
}

function stamp(date) {
	const p = (n) => String(n).padStart(2, '0');
	return (
		`${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
		`-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
	);
}

function formatDateTime(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return String(iso || '');
	const p = (n) => String(n).padStart(2, '0');
	return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function readJson(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

/**
 * Drop the indentation every line shares, keeping relative indentation intact.
 * A suggestion block carries the file's own leading tabs because the platform
 * replaces whole lines; that offset is noise once it is just code on a page.
 */
function stripIndent(value) {
	const lines = String(value === null || value === undefined ? '' : value).replace(/\s+$/, '').split('\n');
	const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0]);
	if (!indents.length) return lines.join('\n');

	let prefix = indents[0];
	for (const indent of indents) {
		let i = 0;
		while (i < prefix.length && i < indent.length && prefix[i] === indent[i]) i += 1;
		prefix = prefix.slice(0, i);
		if (!prefix) return lines.join('\n');
	}
	return lines.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l.trimStart())).join('\n');
}

function verdictClass(verdict) {
	const v = String(verdict || '').toUpperCase();
	if (v.startsWith('REQUEST')) return 'reject';
	if (v.includes('COMMENT')) return 'warn';
	if (v.startsWith('APPROVE')) return 'ok';
	return 'neutral';
}

function ciClass(status) {
	const s = String(status || '').toLowerCase();
	if (/(^|[^a-z])(success|passed|pass)([^a-z]|$)/.test(s)) return 'ok';
	if (/fail|error/.test(s)) return 'reject';
	if (/running|pending|waiting/.test(s)) return 'warn';
	return 'neutral';
}

/* -------------------------------------------------------------- shared css */

const DARK_VARS = `
  --bg: #0e1015; --surface: #161922; --surface-2: #1b1f2a; --text: #e6e9f0;
  --muted: #98a1b4; --border: #262c39; --accent: #8b87f7; --accent-soft: #23213c;
  --ok: #4ade80; --ok-soft: #16281d; --warn: #fbbf24; --warn-soft: #2b2312;
  --reject: #f87171; --reject-soft: #2d1718; --neutral-soft: #1e222c;
  --crit: #f87171; --crit-soft: #2d1718; --high: #fb923c; --high-soft: #2c1d12;
  --med: #fbbf24; --med-soft: #2b2312; --low: #38bdf8; --low-soft: #10222c;
  --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px -14px rgba(0,0,0,.8);
  --nav-bg: rgba(22,25,34,.86);
`;

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f4f5f8; --surface: #fff; --surface-2: #f8f9fb; --text: #14161c;
  --muted: #616a7d; --border: #e2e6ee; --accent: #4f46e5; --accent-soft: #eceafd;
  --ok: #15803d; --ok-soft: #e6f6ec; --warn: #b45309; --warn-soft: #fdf2df;
  --reject: #c02626; --reject-soft: #fdecec; --neutral-soft: #eef0f5;
  --crit: #b91c1c; --crit-soft: #fdeaea; --high: #c2410c; --high-soft: #fdeee4;
  --med: #a16207; --med-soft: #fbf3de; --low: #0e7490; --low-soft: #e4f4f8;
  --shadow: 0 1px 2px rgba(16,20,32,.05), 0 6px 20px -12px rgba(16,20,32,.28);
  --nav-bg: rgba(255,255,255,.86);
  --radius: 12px; --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
/* Auto follows the OS unless the toggle has pinned a theme; the explicit
   selector then wins for a pinned dark. */
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK_VARS}} }
:root[data-theme="dark"] {${DARK_VARS}}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text); line-height: 1.55;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px; -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 32px 24px 72px; }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow);
}
h1 { font-size: 24px; line-height: 1.3; margin: 0 0 6px; letter-spacing: -.02em; }
h2 { font-size: 15px; margin: 34px 0 12px; text-transform: uppercase;
     letter-spacing: .08em; color: var(--muted); font-weight: 650; }
h3 { font-size: 16px; margin: 0; letter-spacing: -.01em; }
p { margin: 0 0 10px; }
code, pre, .mono { font-family: var(--mono); }
/* Pills share the button/input corner radius — a full 999px capsule reads as a
   different design language next to the cards. */
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
  border-radius: 8px; font-size: 12px; font-weight: 650; letter-spacing: .02em;
  background: var(--neutral-soft); color: var(--muted); white-space: nowrap;
  border: 1px solid var(--border);
}
/* Tinted pills outline themselves in their own hue; the var(--border) above is
   the fallback wherever color-mix() is unavailable. */
.pill.ok, .pill.warn, .pill.reject, .pill.accent, .pill.posted,
.pill.sev-CRITICAL, .pill.sev-HIGH, .pill.sev-MED, .pill.sev-LOW {
  border-color: color-mix(in srgb, currentColor 32%, transparent);
}
.pill.ok { background: var(--ok-soft); color: var(--ok); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.reject { background: var(--reject-soft); color: var(--reject); }
.pill.accent { background: var(--accent-soft); color: var(--accent); }
.sev-CRITICAL { background: var(--crit-soft); color: var(--crit); }
.sev-HIGH { background: var(--high-soft); color: var(--high); }
.sev-MED { background: var(--med-soft); color: var(--med); }
.sev-LOW { background: var(--low-soft); color: var(--low); }
.muted { color: var(--muted); }
.small { font-size: 13px; }
pre {
  margin: 0; padding: 14px 16px; background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border); border-radius: 10px; overflow-x: auto;
  font-size: 12.5px; line-height: 1.6; white-space: pre; tab-size: 2;
}
button {
  font: inherit; cursor: pointer; border: 1px solid var(--border); background: var(--surface);
  color: var(--text); border-radius: 8px; padding: 5px 11px; font-size: 12.5px; font-weight: 600;
}
button:hover { border-color: var(--accent); color: var(--accent); }
details > summary { cursor: pointer; list-style: none; }
details > summary::-webkit-details-marker { display: none; }
:not(pre) > code {
  background: var(--neutral-soft); border-radius: 5px; padding: 1px 5px;
  font-size: .89em; overflow-wrap: anywhere;
}
input[type=search] {
  font: inherit; padding: 7px 12px; border-radius: 9px;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text);
}
input[type=search]:focus { outline: none; border-color: var(--accent); }

/* top navigation ------------------------------------------------------- */
.nav {
  position: sticky; top: 0; z-index: 30; background: var(--nav-bg);
  border-bottom: 1px solid var(--border); backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
}
.nav-in {
  max-width: 1240px; margin: 0 auto; padding: 10px 24px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.nav a { color: var(--text); }
.nav-home { font-weight: 650; font-size: 13.5px; white-space: nowrap; }
.nav-home:hover { color: var(--accent); text-decoration: none; }
.nav-crumb {
  font-size: 12.5px; color: var(--muted); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nav-right { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nav-right input[type=search] { width: 260px; max-width: 42vw; padding: 6px 11px; font-size: 13px; }
.nav-btn {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600;
  padding: 6px 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface);
  color: var(--text); white-space: nowrap;
}
.nav-btn:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }
@media (max-width: 620px) {
  .nav-crumb { display: none; }
  .nav-right input[type=search] { width: 100%; max-width: none; order: 3; }
}
@media print {
  body { background: #fff; } .card { box-shadow: none; }
  details[open] > summary ~ * { display: revert; } details { break-inside: avoid; }
  .no-print, .nav { display: none !important; }
}
`;

/** Applied before first paint so a pinned theme never flashes the other one. */
const THEME_BOOT = `<script>(function(){try{var t=localStorage.getItem('mwd-review-theme');
if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();</script>`;

const THEME_SCRIPT = `
var THEMES = ['auto', 'light', 'dark'];
var THEME_LABEL = { auto: '\\u25D0 Auto', light: '\\u2600\\uFE0E Light', dark: '\\u263E\\uFE0E Dark' };
var themeBtn = document.getElementById('theme');
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'auto'; }
function paintTheme() { if (themeBtn) themeBtn.textContent = THEME_LABEL[currentTheme()]; }
if (themeBtn) {
  paintTheme();
  themeBtn.addEventListener('click', function () {
    var next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
    if (next === 'auto') { document.documentElement.removeAttribute('data-theme'); }
    else { document.documentElement.setAttribute('data-theme', next); }
    try { if (next === 'auto') { localStorage.removeItem('mwd-review-theme'); }
      else { localStorage.setItem('mwd-review-theme', next); } } catch (e) {}
    paintTheme();
  });
}
`;

/** Shared sticky bar. `home` is null on the index itself, which is the home. */
function renderNav(home, crumbHtml, actionsHtml) {
	return `<nav class="nav no-print"><div class="nav-in">
  ${
		home
			? `<a class="nav-home" href="${esc(home)}">&#8592; All reviews</a>`
			: '<span class="nav-home">Code review archive</span>'
	}
  ${crumbHtml ? `<span class="nav-crumb">${crumbHtml}</span>` : ''}
  <span class="nav-right">${actionsHtml || ''}<button type="button" class="nav-btn" id="theme">&#9680; Auto</button></span>
</div></nav>`;
}

/* ------------------------------------------------------------ report page */

function statCard(label, value, cls) {
	return `<div class="stat ${cls || ''}"><div class="stat-v">${esc(value)}</div><div class="stat-l">${esc(label)}</div></div>`;
}

function metaRow(label, valueHtml) {
	if (!valueHtml) return '';
	return `<div class="meta-row"><dt>${esc(label)}</dt><dd>${valueHtml}</dd></div>`;
}

function renderFinding(finding) {
	const sev = SEVERITIES.includes(String(finding.severity).toUpperCase())
		? String(finding.severity).toUpperCase()
		: 'LOW';
	const status = STATUSES[finding.status] ? finding.status : 'kept';
	const id = finding.id || `${sev}-?`;
	const loc = [finding.file, finding.line].filter(Boolean).join(':');

	const statusPill =
		status === 'posted' && finding.posted_url
			? `<a class="pill posted" href="${esc(finding.posted_url)}" target="_blank" rel="noreferrer">${esc(STATUSES[status].label)} &#8599;</a>`
			: `<span class="pill ${status === 'posted' ? 'ok' : ''}">${esc(STATUSES[status].label)}</span>`;

	// One fix block per finding. `suggestion` is the same fix rewritten for the
	// platform's one-click apply, so rendering it too is duplication on a page
	// that cannot apply anything; it is only the fallback when there is no
	// fix_code, and otherwise just earns a note on the label.
	const fixCode = finding.fix_code || finding.suggestion;
	const fix = fixCode
		? `<div class="block"><div class="block-h">Fix${
				finding.suggestion ? ' &middot; posted as an inline suggestion' : ''
			}</div><pre><code>${esc(stripIndent(fixCode))}</code></pre></div>`
		: '';

	const prompt = finding.ai_prompt
		? `<details class="block toggle prompt"><summary><span class="chev">&#9656;</span> AI fix prompt` +
			`<button class="copy no-print" type="button">Copy</button></summary>` +
			`<pre><code>${esc(stripIndent(finding.ai_prompt))}</code></pre></details>`
		: '';

	const fallback = finding.fallback
		? `<p class="small muted">Anchor fallback used: ${mdInline(finding.fallback)}</p>`
		: '';

	const link = finding.thread_url
		? `<p class="small"><a href="${esc(finding.thread_url)}" target="_blank" rel="noreferrer">Existing thread &#8599;</a></p>`
		: '';

	const haystack = [id, sev, finding.title, loc, finding.category, finding.description, STATUSES[status].label]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	return `
<article class="card finding" data-sev="${esc(sev)}" data-status="${esc(status)}" data-search="${esc(haystack)}">
  <header class="finding-h">
    <span class="pill sev-${esc(sev)}">${esc(sev)}</span>
    <h3>${mdInline(finding.title || id)}</h3>
    <span class="fid mono">${esc(id)}</span>
    ${statusPill}
  </header>
  <div class="finding-meta small muted">
    ${loc ? `<span class="mono">${esc(loc)}</span>` : ''}
    ${finding.category ? `<span>&middot;</span><span>${mdInline(finding.category)}</span>` : ''}
  </div>
  ${mdBlock(finding.description)}
  ${fix}${prompt}${fallback}${link}
</article>`;
}

function renderReport(data, counts, indexHref) {
	const bareId = String(data.change_id || '?').replace(/^[!#]/, '');
	const idLabel = data.platform === 'github' ? `PR #${bareId}` : `MR !${bareId}`;
	const findings = Array.isArray(data.findings) ? data.findings : [];
	const order = { CRITICAL: 0, HIGH: 1, MED: 2, LOW: 3 };
	const sorted = findings
		.slice()
		.sort((a, b) => (order[String(a.severity).toUpperCase()] ?? 9) - (order[String(b.severity).toUpperCase()] ?? 9));

	const groups = [
		['posted', 'Posted inline'],
		['kept', 'Kept in chat (not posted)'],
		['already_raised', 'Already raised'],
	]
		.map(([key, label]) => {
			const items = sorted.filter((f) => (STATUSES[f.status] ? f.status : 'kept') === key);
			if (!items.length) return '';
			return `<h2>${esc(label)} <span class="count">${items.length}</span></h2>${items.map(renderFinding).join('')}`;
		})
		.join('');

	const coverage = (Array.isArray(data.coverage) ? data.coverage : [])
		.map((c) => {
			const st = String(c.status || '').toLowerCase();
			const cls = st === 'clean' ? 'ok' : st === 'not_reviewed' ? 'reject' : 'warn';
			const value =
				st === 'clean' ? 'clean' : st === 'not_reviewed' ? `not reviewed${c.note ? ` — ${c.note}` : ''}` : `${c.count ?? 0}`;
			return `<span class="pill ${cls}">${esc(c.dimension)} <span class="cov-v">${mdInline(value)}</span></span>`;
		})
		.join('');

	const prescan = data.prescan || {};
	const dismissed = Array.isArray(prescan.dismissed) ? prescan.dismissed : [];
	const prescanBlock =
		prescan.hits === undefined && !dismissed.length
			? ''
			: `<h2>Mechanical pre-scan</h2>
<div class="card pad">
  <div class="stats">
    ${statCard('hits', prescan.hits ?? dismissed.length + (prescan.raised ?? 0))}
    ${statCard('raised as findings', prescan.raised ?? 0)}
    ${statCard('dismissed', dismissed.length)}
  </div>
  ${
		dismissed.length
			? `<details class="block toggle"><summary><span class="chev">&#9656;</span> Dismissed hits &amp; reasons</summary>
  <table class="tbl small">
    <thead><tr><th>Hit</th><th>Reason for dismissal</th></tr></thead>
    <tbody>${dismissed
		.map((d) => `<tr><td class="mono">${esc(d.hit)}</td><td>${mdInline(d.reason)}</td></tr>`)
		.join('')}</tbody>
  </table></details>`
			: '<p class="small muted">No dismissed hits recorded.</p>'
	}
</div>`;

	// Sits inside the header card, under the executive summary — it is part of the
	// overall assessment, not a footnote after the findings.
	const good = Array.isArray(data.good) ? data.good.filter(Boolean) : [];
	const goodBlock = good.length
		? `<div class="good-wrap"><div class="block-h">What looks good</div><ul class="good">${good
				.map((g) => `<li>${mdInline(g)}</li>`)
				.join('')}</ul></div>`
		: '';

	const unreviewed = Array.isArray(data.unreviewed_files) ? data.unreviewed_files.filter(Boolean) : [];
	const unreviewedBlock = unreviewed.length
		? `<h2>Not reviewed</h2><div class="card pad"><ul class="good">${unreviewed
				.map((f) => `<li class="mono">${esc(f)}</li>`)
				.join('')}</ul></div>`
		: '';

	const stats = Array.isArray(data.stats) ? {} : data.stats || {};
	const filters = SEVERITIES.filter((s) => counts[s.toLowerCase()] > 0)
		.map(
			(s) =>
				`<button type="button" class="filter on" data-filter="${s}">${s} <span class="count">${counts[s.toLowerCase()]}</span></button>`,
		)
		.join('');

	const changeLink = data.url
		? `<a class="nav-btn" href="${esc(data.url)}" target="_blank" rel="noreferrer">${esc(
				data.platform === 'github' ? 'Open PR' : 'Open MR',
			)} ${esc(idLabel.replace(/^(PR|MR) /, ''))} &#8599;</a>`
		: '';

	return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review ${esc(idLabel)} — ${esc(data.title || data.project || '')}</title>
${THEME_BOOT}
<style>${CSS}
.head { padding: 26px 28px; margin-bottom: 26px; }
.head-top { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
.crumb { font-size: 13px; color: var(--muted); }
.crumb .mono { color: var(--text); }
.verdict { margin-left: auto; font-size: 12.5px; padding: 5px 14px; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 2px 24px; margin: 16px 0 0; }
.meta-row { display: flex; gap: 8px; font-size: 13.5px; padding: 3px 0; min-width: 0; }
.meta-row dt { color: var(--muted); min-width: 84px; flex: none; }
.meta-row dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.summary { margin: 16px 0 0; padding-top: 16px; border-top: 1px solid var(--border); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 10px; }
.stat { padding: 12px 14px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
.stat-v { font-size: 22px; font-weight: 680; letter-spacing: -.02em; line-height: 1.2; }
.stat-l { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.stat.CRITICAL { background: var(--crit-soft); } .stat.CRITICAL .stat-v { color: var(--crit); }
.stat.HIGH { background: var(--high-soft); } .stat.HIGH .stat-v { color: var(--high); }
.stat.MED { background: var(--med-soft); } .stat.MED .stat-v { color: var(--med); }
.stat.LOW { background: var(--low-soft); } .stat.LOW .stat-v { color: var(--low); }
.cov { display: flex; flex-wrap: wrap; gap: 8px; }
.cov-v { opacity: .75; font-weight: 550; }
.pad { padding: 18px 20px; }
.count { display: inline-block; padding: 0 6px; border-radius: 6px; background: var(--neutral-soft);
         color: var(--muted); font-size: 11.5px; font-weight: 650; vertical-align: 1px; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 26px 0 4px; }
.filter { opacity: .45; }
.filter.on { opacity: 1; border-color: var(--accent); color: var(--accent); }
.finding { padding: 18px 20px; margin-bottom: 12px; }
.finding-h { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.finding-h h3 { flex: 1 1 260px; }
.fid { font-size: 12px; color: var(--muted); }
.pill.posted { background: var(--ok-soft); color: var(--ok); }
.finding-meta { display: flex; flex-wrap: wrap; gap: 7px; margin: 6px 0 10px; }
.block { margin-top: 12px; }
.block-h { font-size: 11.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin-bottom: 6px; }
.toggle > summary { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 650;
                    color: var(--muted); padding: 7px 10px; border: 1px dashed var(--border); border-radius: 8px; }
.toggle > summary:hover { border-color: var(--accent); color: var(--accent); }
.prompt[open] > summary { border-radius: 8px 8px 0 0; border-bottom: none; }
.prompt > pre { border-radius: 0 0 8px 8px; }
.prompt .copy { margin-left: auto; }
.chev { transition: transform .15s; display: inline-block; }
details[open] > summary .chev { transform: rotate(90deg); }
.tbl { width: 100%; border-collapse: collapse; margin-top: 10px; }
.tbl th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em;
          color: var(--muted); padding: 6px 10px; border-bottom: 1px solid var(--border); }
.tbl td { padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; }
.tbl tr:last-child td { border-bottom: none; }
.good { margin: 0; padding-left: 20px; } .good li { margin-bottom: 5px; }
.good-wrap { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
.good-wrap .good { font-size: 14px; }
.foot { margin-top: 40px; font-size: 12.5px; color: var(--muted); text-align: center; }
.empty { padding: 26px; text-align: center; color: var(--muted); }
.no-hits { padding: 22px; text-align: center; color: var(--muted); display: none; }
</style></head>
<body>
${renderNav(indexHref, `<span class="mono">${esc(data.project || '')}</span> &middot; ${esc(idLabel)}`, `<input type="search" id="q" placeholder="Search findings…" autocomplete="off">${changeLink}`)}
<div class="wrap">

<header class="card head">
  <div class="head-top">
    <span class="pill accent">${esc(data.platform === 'github' ? 'GitHub' : 'GitLab')}</span>
    <span class="crumb"><span class="mono">${esc(data.project || '')}</span> &middot; ${esc(idLabel)}</span>
    <span class="pill ${verdictClass(data.verdict)} verdict">${esc(data.verdict || 'NO VERDICT')}</span>
  </div>
  <h1>${data.url ? `<a href="${esc(data.url)}" target="_blank" rel="noreferrer">${esc(data.title || idLabel)}</a>` : esc(data.title || idLabel)}</h1>
  <dl class="meta">
    ${metaRow('Author', esc(data.author))}
    ${metaRow('Reviewed', esc(formatDateTime(data.reviewed_at)))}
    ${metaRow('State', esc(data.state))}
    ${metaRow('CI', data.ci_status ? `<span class="pill ${ciClass(data.ci_status)}">${esc(data.ci_status)}</span>` : '')}
    ${metaRow('Branch', data.branch && (data.branch.source || data.branch.target) ? `<span class="mono small">${esc(data.branch.source || '?')} &rarr; ${esc(data.branch.target || '?')}</span>` : '')}
    ${metaRow('Head SHA', data.head_sha ? `<span class="mono small">${esc(String(data.head_sha).slice(0, 12))}</span>` : '')}
    ${metaRow('Mode', esc(data.mode))}
    ${metaRow('Labels', (data.labels || []).length ? (data.labels || []).map((l) => `<span class="pill">${esc(l)}</span>`).join(' ') : '')}
  </dl>
  ${data.executive_summary || goodBlock ? `<div class="summary">${mdBlock(data.executive_summary)}${goodBlock}</div>` : ''}
</header>

<div class="stats">
  ${SEVERITIES.map((s) => statCard(s.toLowerCase(), counts[s.toLowerCase()], s)).join('')}
  ${statCard('posted', counts.posted)}
  ${stats.files_changed !== undefined ? statCard('files', stats.files_changed) : ''}
  ${stats.additions !== undefined || stats.deletions !== undefined ? statCard('lines', `+${stats.additions ?? 0} / -${stats.deletions ?? 0}`) : ''}
</div>

${coverage ? `<h2>Coverage</h2><div class="cov">${coverage}</div>` : ''}

${
	findings.length
		? `<div class="bar no-print"><span class="small muted">Filter:</span>${filters}<button type="button" class="filter on" data-filter="ALL">All</button></div>${groups}<div class="card no-hits" id="no-hits">No finding matches this search.</div>`
		: '<h2>Findings</h2><div class="card empty">No findings recorded for this review.</div>'
}

${prescanBlock}
${unreviewedBlock}

<p class="foot">Generated by <span class="mono">/mwd-code-review-interactive</span> &middot; ${esc(formatDateTime(data.generated_at))} &middot; <a href="${esc(indexHref)}">All reviews</a></p>
</div>
<script>
document.querySelectorAll('.copy').forEach(function (btn) {
  btn.addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    var pre = btn.closest('details').querySelector('pre');
    var text = pre ? pre.textContent : '';
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { btn.textContent = 'Press Cmd+C'; });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (err) { btn.textContent = 'Press Cmd+C'; }
      document.body.removeChild(ta);
    }
  });
});
var allBtn = document.querySelector('.filter[data-filter="ALL"]');
var sevBtns = Array.prototype.slice.call(document.querySelectorAll('.filter')).filter(function (f) {
  return f !== allBtn;
});
var q = document.getElementById('q');
var noHits = document.getElementById('no-hits');
function isOn(f) { return f.classList.contains('on'); }
function apply() {
  var active = sevBtns.filter(isOn).map(function (f) { return f.dataset.filter; });
  var term = q ? q.value.trim().toLowerCase() : '';
  var shown = 0;
  document.querySelectorAll('.finding').forEach(function (el) {
    var hit = active.indexOf(el.dataset.sev) > -1 && (!term || el.dataset.search.indexOf(term) > -1);
    el.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  // A group heading is followed by its finding cards; hide it when they are all filtered out.
  document.querySelectorAll('h2').forEach(function (h) {
    var n = h.nextElementSibling, any = false, owns = false;
    while (n && n.classList && n.classList.contains('finding')) {
      owns = true;
      if (n.style.display !== 'none') any = true;
      n = n.nextElementSibling;
    }
    if (owns) h.style.display = any ? '' : 'none';
  });
  if (noHits) noHits.style.display = shown ? 'none' : 'block';
  if (allBtn) allBtn.classList.toggle('on', active.length === sevBtns.length);
}
if (q) q.addEventListener('input', apply);
sevBtns.forEach(function (f) {
  f.addEventListener('click', function () {
    f.classList.toggle('on');
    // Never leave an empty selection — turning off the last one means "show everything".
    if (!sevBtns.some(isOn)) sevBtns.forEach(function (o) { o.classList.add('on'); });
    apply();
  });
});
if (allBtn) allBtn.addEventListener('click', function () {
  sevBtns.forEach(function (o) { o.classList.add('on'); });
  if (q) q.value = '';
  apply();
});
${THEME_SCRIPT}
</script>
</body></html>`;
}

/* ------------------------------------------------------------- index page */

function renderIndex(entries) {
	const total = entries.length;
	const sums = entries.reduce(
		(acc, e) => {
			const c = e.counts || {};
			acc.findings += c.total || 0;
			acc.posted += c.posted || 0;
			acc.critical += c.critical || 0;
			acc.high += c.high || 0;
			return acc;
		},
		{ findings: 0, posted: 0, critical: 0, high: 0 },
	);
	const projects = new Set(entries.map((e) => `${e.host}/${e.project}`)).size;

	const rows = entries
		.map((e) => {
			const c = e.counts || {};
			const badges = SEVERITIES.map((s) => {
				const n = c[s.toLowerCase()] || 0;
				return n ? `<span class="pill sev-${s}">${s[0]}${n}</span>` : '';
			})
				.filter(Boolean)
				.join(' ');
			const changeWord = e.platform === 'github' ? '#' : '!';
			const search = [e.project, e.title, e.author, e.verdict, e.change_id].join(' ').toLowerCase();
			return `<tr data-search="${esc(search)}">
  <td class="nowrap small muted">${esc(formatDateTime(e.generated_at))}</td>
  <td class="small"><span class="mono">${esc(e.project || '')}</span><div class="muted xsmall">${esc(e.host || '')}</div></td>
  <td class="nowrap small mono">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(changeWord + String(e.change_id || '?'))}</a>` : esc(changeWord + String(e.change_id || '?'))}</td>
  <td class="t-title"><a href="${esc(e.report)}">${esc(e.title || 'Review')}</a></td>
  <td class="nowrap"><span class="pill ${verdictClass(e.verdict)}">${esc(e.verdict || '—')}</span></td>
  <td class="nowrap">${badges || '<span class="muted small">clean</span>'}</td>
  <td class="nowrap small muted">${esc(c.posted || 0)}/${esc(c.total || 0)}</td>
</tr>`;
		})
		.join('');

	return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Code review archive</title>
${THEME_BOOT}
<style>${CSS}
.wrap { max-width: 1240px; }
.head { padding: 24px 26px; margin-bottom: 22px; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.stat { flex: 1 1 110px; padding: 12px 14px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
.stat-v { font-size: 22px; font-weight: 680; letter-spacing: -.02em; line-height: 1.2; }
.stat-l { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.tbl-scroll { overflow-x: auto; border-radius: var(--radius); }
table { width: 100%; min-width: 880px; border-collapse: collapse; }
th.t-title, td.t-title { width: 40%; }
th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em;
     color: var(--muted); padding: 10px 12px; border-bottom: 1px solid var(--border); }
td { padding: 11px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--surface-2); }
.nowrap { white-space: nowrap; }
.xsmall { font-size: 11.5px; }
.pill.sev-CRITICAL, .pill.sev-HIGH, .pill.sev-MED, .pill.sev-LOW { padding: 2px 7px; font-size: 11px; }
.foot { margin-top: 32px; font-size: 12.5px; color: var(--muted); text-align: center; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.no-hits { padding: 26px; text-align: center; color: var(--muted); display: none; margin-top: 12px; }
</style></head>
<body>
${renderNav(null, `${total} review${total === 1 ? '' : 's'} &middot; ${projects} project${projects === 1 ? '' : 's'}`, '<input type="search" id="q" placeholder="Search project, title, author…" autocomplete="off">')}
<div class="wrap">
<header class="card head">
  <h1>Code review archive</h1>
  <p class="small muted">Every review run with <span class="mono">/mwd-code-review-interactive</span>, newest first.</p>
  <div class="stats">
    ${statCard('reviews', total)}
    ${statCard('projects', projects)}
    ${statCard('findings', sums.findings)}
    ${statCard('posted', sums.posted)}
    ${statCard('critical', sums.critical, 'CRITICAL')}
    ${statCard('high', sums.high, 'HIGH')}
  </div>
</header>

${
	total
		? `<div class="card tbl-scroll"><table>
  <thead><tr><th>Reviewed</th><th>Project</th><th>Change</th><th class="t-title">Title</th><th>Verdict</th><th>Findings</th><th>Posted</th></tr></thead>
  <tbody id="rows">${rows}</tbody>
</table></div>`
		: '<div class="card empty">No reviews recorded yet.</div>'
}
<div class="card no-hits" id="no-hits">No review matches this search.</div>

<p class="foot">Generated ${esc(formatDateTime(new Date().toISOString()))}</p>
</div>
<script>
var q = document.getElementById('q');
var noHits = document.getElementById('no-hits');
if (q) q.addEventListener('input', function () {
  var v = q.value.trim().toLowerCase();
  var shown = 0;
  document.querySelectorAll('#rows tr').forEach(function (tr) {
    var hit = !v || tr.dataset.search.indexOf(v) > -1;
    tr.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  if (noHits) noHits.style.display = shown ? 'none' : 'block';
});
${THEME_SCRIPT}
</script>
</body></html>`;
}

/* ------------------------------------------------------------------- main */

function main() {
	const argv = process.argv.slice(2);
	if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
		process.stdout.write('usage: render-report.js <payload.json|-> [--out-dir <dir>]\n');
		process.exit(argv.length ? 0 : 1);
	}

	const payloadArg = argv[0];
	const outFlag = argv.indexOf('--out-dir');
	const outDir = path.resolve(
		outFlag > -1 && argv[outFlag + 1]
			? argv[outFlag + 1]
			: process.env.MWD_REVIEW_REPORTS_DIR || path.join(os.homedir(), '.claude', 'code-review-reports'),
	);

	let raw;
	try {
		raw = payloadArg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(payloadArg, 'utf8');
	} catch (err) {
		fail(`cannot read payload (${err.message})`);
	}

	let data;
	try {
		data = JSON.parse(raw);
	} catch (err) {
		fail(`payload is not valid JSON (${err.message})`);
	}

	if (!data || typeof data !== 'object') fail('payload must be a JSON object');
	if (!data.project) fail('payload.project is required (e.g. "group/sub/repo")');
	if (data.change_id === undefined || data.change_id === null || data.change_id === '') {
		fail('payload.change_id is required (MR iid / PR number)');
	}

	const now = new Date();
	data.generated_at = data.generated_at || now.toISOString();
	data.reviewed_at = data.reviewed_at || data.generated_at;
	data.platform = data.platform === 'github' ? 'github' : 'gitlab';

	const findings = Array.isArray(data.findings) ? data.findings : [];
	const counts = { critical: 0, high: 0, med: 0, low: 0, total: findings.length, posted: 0, kept: 0, already_raised: 0 };
	for (const f of findings) {
		const sev = String(f.severity || 'LOW').toUpperCase();
		if (counts[sev.toLowerCase()] !== undefined) counts[sev.toLowerCase()] += 1;
		const st = STATUSES[f.status] ? f.status : 'kept';
		counts[st] += 1;
	}

	const host = safeSegment(data.host || (data.platform === 'github' ? 'github.com' : 'gitlab.com'), 'unknown-host');
	const project = safeProjectPath(data.project, 'unknown-project');
	const prefix = data.platform === 'github' ? 'pr' : 'mr';
	const fileName = `${prefix}-${safeSegment(data.change_id, 'x')}-${stamp(now)}.html`;
	const relReport = path.join('reports', host, project, fileName);
	const absReport = path.join(outDir, relReport);

	// The archive nests one directory per project path segment, so the depth back
	// up to index.html varies per project — compute it instead of hardcoding it.
	const indexHref = `${'../'.repeat(relReport.split(path.sep).length - 1)}index.html`;

	fs.mkdirSync(path.dirname(absReport), { recursive: true });
	fs.writeFileSync(absReport, renderReport(data, counts, indexHref), 'utf8');

	const manifestPath = path.join(outDir, 'reports.json');
	const manifest = readJson(manifestPath, []);
	const entries = Array.isArray(manifest) ? manifest : [];
	entries.push({
		generated_at: data.generated_at,
		report: relReport.split(path.sep).join('/'),
		platform: data.platform,
		host: data.host || host,
		project: data.project,
		change_id: data.change_id,
		url: data.url || '',
		title: data.title || '',
		author: data.author || '',
		verdict: data.verdict || '',
		mode: data.mode || '',
		ci_status: data.ci_status || '',
		counts,
	});
	entries.sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));

	fs.writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
	fs.writeFileSync(path.join(outDir, 'index.html'), renderIndex(entries), 'utf8');

	process.stdout.write(`REPORT      ${absReport}\n`);
	process.stdout.write(`REPORT_URL  file://${absReport.split(path.sep).join('/')}\n`);
	process.stdout.write(`INDEX       ${path.join(outDir, 'index.html')}\n`);
	process.stdout.write(`INDEX_URL   file://${path.join(outDir, 'index.html').split(path.sep).join('/')}\n`);
	process.stdout.write(`REVIEWS     ${entries.length}\n`);
}

main();
