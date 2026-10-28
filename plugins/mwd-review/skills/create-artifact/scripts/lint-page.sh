#!/usr/bin/env bash
# Checks a filled artifact page before it is published.
#
# Usage: lint-page.sh <page.html>
# Prints FAIL / REVIEW / OK lines. FAIL must be fixed; REVIEW lines are allowed only where SKILL.md Step 6 says so.
# Exits 1 if any FAIL is found, 0 otherwise. Reads the file only; no network calls.
set -u

page="${1:?usage: lint-page.sh <page.html>}"
[ -f "$page" ] || { printf 'FAIL     %s not found\n' "$page"; exit 1; }
fails=0

say() { printf '%-8s %s\n' "$1" "$2"; }
detail() { printf '%-8s %s\n' "" "$1"; }
fail() {
	fails=$((fails + 1))
	say FAIL "$1"
}

# Resources the viewer's CSP blocks. Plain <a href> links are navigation, not loads, so they are not checked.
allowed='https://(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net/npm/|cdn\.tailwindcss\.com|code\.jquery\.com)'
hits=$(grep -nEo 'src="https?://[^"]*"|<link[^>]*href="https?://[^"]*"|url\(["'\'']?https?://[^)]*\)' "$page" | grep -vE "$allowed")
if [ -n "$hits" ]; then
	fail "external resource outside the allowed hosts"
	printf '%s\n' "$hits" | while IFS= read -r h; do detail "$h"; done
fi

hits=$(grep -nE '>(TITLE|EYEBROW|SOURCE)<|LEAD —|As of DATE|Source: SOURCE' "$page")
if [ -n "$hits" ]; then
	fail "template placeholders left"
	printf '%s\n' "$hits" | while IFS= read -r h; do detail "$h"; done
fi

n=$(grep -c '<text' "$page")
[ "$n" -eq 0 ] || fail "$n <text> element(s) in SVG; chart labels and values belong in HTML"

hits=$(awk '
	/^:root \{/ { r = 1 }
	r && /^\}/ { r = 0; next }
	!r { s = $0; while (match(s, /.{0,40}(#[0-9a-fA-F]{6}|rgba?\([^)]*\))/)) { print NR ": …" substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH) } }
' "$page")
if [ -n "$hits" ]; then
	say REVIEW "colour literals outside :root (fine only in SVG fill/stroke the tokens can't reach, or code samples)"
	printf '%s\n' "$hits" | while IFS= read -r h; do detail "$h"; done
fi

bytes=$(wc -c <"$page" | tr -d ' ')
[ "$bytes" -le 16777216 ] || fail "page is $bytes bytes; the limit is 16 MiB"

# Contrast of the token pairs the template uses, with surfaces derived from --bg the same way the CSS does.
contrast=$(awk '
	function hex(h,   i, v) { h = tolower(h); v = 0; for (i = 1; i <= length(h); i++) v = v * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1; return v }
	function rgb(name,   v) { v = tok[name]; if (v !~ /^#[0-9a-fA-F]{6}$/) { print "FAIL\t--" name " must be a 6-digit hex, got " (v == "" ? "nothing" : v); bad = 1; return 0 }
		R[name] = hex(substr(v, 2, 2)); G[name] = hex(substr(v, 4, 2)); B[name] = hex(substr(v, 6, 2)); return 1 }
	function mix(out, a, b, p) { R[out] = R[a] * (1 - p) + R[b] * p; G[out] = G[a] * (1 - p) + G[b] * p; B[out] = B[a] * (1 - p) + B[b] * p }
	function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4 }
	function lum(n) { return 0.2126 * lin(R[n]) + 0.7152 * lin(G[n]) + 0.0722 * lin(B[n]) }
	function ratio(fg, bg,   a, b) { a = lum(fg) + 0.05; b = lum(bg) + 0.05; return a > b ? a / b : b / a }
	function check(fg, bg,   r) { r = ratio(fg, bg); if (r < 4.5) { printf "FAIL\t--%s on --%s is %.2f:1, needs 4.5:1\n", fg, bg, r; bad = 1 } else if (r < worst) { worst = r; wp = fg " on " bg } }
	/^:root \{/ { r = 1; next }
	r && /^\}/ { r = 0 }
	r && match($0, /--[a-z0-9-]+:[[:space:]]*#[0-9a-fA-F]+/) { split(substr($0, RSTART + 2, RLENGTH - 2), kv, /:[[:space:]]*/); tok[kv[1]] = kv[2] }
	END {
		n = split("bg accent text muted ok warn bad", names, " ")
		for (i = 1; i <= n; i++) rgb(names[i])
		if (bad) exit
		R["white"] = G["white"] = B["white"] = 255
		mix("lift", "accent", "white", 0.6)
		mix("surface", "bg", "lift", 0.06)
		mix("surface-2", "bg", "lift", 0.10)
		worst = 99
		split("bg surface surface-2", grounds, " ")
		for (i = 1; i <= 3; i++) { check("text", grounds[i]); check("muted", grounds[i]); check("accent", grounds[i]) }
		for (i = 1; i <= 2; i++) { check("ok", grounds[i]); check("warn", grounds[i]); check("bad", grounds[i]) }
		check("bg", "accent")
		if (!bad) printf "OK\tcontrast passes for --bg %s; lowest pair %s at %.2f:1\n", tok["bg"], wp, worst
	}
' "$page")
while IFS="$(printf '\t')" read -r level msg; do
	[ -n "$level" ] || continue
	if [ "$level" = FAIL ]; then fail "$msg"; else say "$level" "$msg"; fi
done <<<"$contrast"

[ "$fails" -eq 0 ] || exit 1
say OK "no blocking issues"
