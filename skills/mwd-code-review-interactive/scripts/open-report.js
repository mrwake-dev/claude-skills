#!/usr/bin/env node
'use strict';

/**
 * mwd-code-review-interactive — archive lookup / opener.
 *
 * Resolves a report out of the archive written by render-report.js and, with
 * --open, hands it to the platform's default browser.
 *
 * Usage:
 *   node open-report.js                      # newest report
 *   node open-report.js --open               # newest report, in the browser
 *   node open-report.js index --open         # the archive index
 *   node open-report.js applet-player --open # newest match on project/title/author/change id
 *   node open-report.js '#3' --open          # 3rd newest (positions come from --list)
 *   node open-report.js --list               # recent reviews, numbered
 *
 * Options: --out-dir <dir> (default $MWD_REVIEW_REPORTS_DIR or ~/.claude/code-review-reports)
 *          --limit <n>     how many rows --list prints (default 20)
 *
 * No dependencies, no network.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fail(message, hint) {
	process.stderr.write(`open-report: ${message}\n`);
	if (hint) process.stderr.write(`${hint}\n`);
	process.exit(1);
}

function takeOption(argv, name) {
	const i = argv.indexOf(name);
	if (i === -1) return null;
	const value = argv[i + 1];
	argv.splice(i, value === undefined ? 1 : 2);
	return value === undefined ? null : value;
}

function takeFlag(argv, name) {
	const i = argv.indexOf(name);
	if (i === -1) return false;
	argv.splice(i, 1);
	return true;
}

function formatDateTime(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return String(iso || '');
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function summarize(entry) {
	const c = entry.counts || {};
	const sev = ['critical', 'high', 'med', 'low']
		.map((k) => (c[k] ? `${k[0].toUpperCase()}${c[k]}` : ''))
		.filter(Boolean)
		.join(' ');
	const change = (entry.platform === 'github' ? '#' : '!') + String(entry.change_id || '?');
	return [
		formatDateTime(entry.generated_at),
		`${entry.project || '?'} ${change}`,
		entry.title || '',
		entry.verdict || '',
		sev || 'clean',
	];
}

function openInBrowser(target) {
	const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
	const args = process.platform === 'win32' ? ['', target] : [target];
	const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
	child.on('error', (err) => fail(`could not launch ${cmd} (${err.message})`, `Open it manually: ${target}`));
	child.unref();
}

function main() {
	const argv = process.argv.slice(2);

	if (argv.includes('-h') || argv.includes('--help')) {
		process.stdout.write('usage: open-report.js [query|index|#N] [--open] [--list] [--limit n] [--out-dir dir]\n');
		process.exit(0);
	}

	const outDirOpt = takeOption(argv, '--out-dir');
	const limitOpt = takeOption(argv, '--limit');
	const wantOpen = takeFlag(argv, '--open');
	const wantList = takeFlag(argv, '--list');
	const query = argv.join(' ').trim();

	const outDir = path.resolve(
		outDirOpt || process.env.MWD_REVIEW_REPORTS_DIR || path.join(os.homedir(), '.claude', 'code-review-reports'),
	);
	const indexPath = path.join(outDir, 'index.html');
	const manifestPath = path.join(outDir, 'reports.json');

	if (!fs.existsSync(manifestPath)) {
		fail(
			`no review archive at ${outDir}`,
			'Run /mwd-code-review-interactive on an MR or PR first — it creates the archive.',
		);
	}

	let entries;
	try {
		entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	} catch (err) {
		fail(`archive manifest is unreadable (${err.message})`, `Check ${manifestPath}`);
	}
	if (!Array.isArray(entries) || !entries.length) fail('the review archive is empty');
	entries.sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));

	// `index` / `all` opens the archive index instead of a single report.
	if (/^(index|all|archive)$/i.test(query)) {
		process.stdout.write(`TARGET  ${indexPath}\nURL     file://${indexPath}\nREVIEWS ${entries.length}\n`);
		if (wantOpen) openInBrowser(indexPath);
		return;
	}

	if (wantList) {
		const limit = Math.max(1, Number(limitOpt) || 20);
		const rows = entries.slice(0, limit).map((e, i) => [`#${i + 1}`].concat(summarize(e)));
		const widths = rows.reduce(
			(acc, row) => row.map((cell, i) => Math.max(acc[i] || 0, String(cell).length)),
			[],
		);
		rows.forEach((row) => {
			process.stdout.write(`${row.map((cell, i) => String(cell).padEnd(i === row.length - 1 ? 0 : widths[i])).join('  ')}\n`);
		});
		process.stdout.write(`\n${entries.length} review(s) in ${outDir}\n`);
		if (!wantOpen) return;
	}

	let entry;
	const byPosition = /^#(\d+)$/.exec(query);
	if (byPosition) {
		entry = entries[Number(byPosition[1]) - 1];
		if (!entry) fail(`there is no review #${byPosition[1]} — the archive holds ${entries.length}`);
	} else if (query) {
		const needle = query.toLowerCase();
		entry = entries.find((e) =>
			[e.project, e.title, e.author, e.verdict, e.host, String(e.change_id)]
				.join(' ')
				.toLowerCase()
				.includes(needle),
		);
		if (!entry) {
			fail(`no review matches "${query}"`, `List what is there: open-report.js --list`);
		}
	} else {
		entry = entries[0];
	}

	const target = path.join(outDir, String(entry.report).split('/').join(path.sep));
	if (!fs.existsSync(target)) {
		fail(`the manifest points at a missing file: ${target}`, 'The report may have been deleted from the archive.');
	}

	const change = (entry.platform === 'github' ? '#' : '!') + String(entry.change_id || '?');
	process.stdout.write(
		`TARGET  ${target}\n` +
			`URL     file://${target}\n` +
			`REVIEW  ${entry.project} ${change} — ${entry.title || ''}\n` +
			`WHEN    ${formatDateTime(entry.generated_at)}\n` +
			`VERDICT ${entry.verdict || '—'}\n` +
			`INDEX   file://${indexPath}\n`,
	);
	if (wantOpen) openInBrowser(target);
}

main();
