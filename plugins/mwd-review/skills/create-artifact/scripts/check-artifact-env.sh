#!/usr/bin/env bash
# Finds what stops this Claude Code session from publishing claude.ai artifacts.
#
# Usage: check-artifact-env.sh [project-dir]
# Prints BLOCKER / WARN / OK lines, each blocker with the file:line that sets it and the fix.
# Exits 1 if any blocker is found, 0 otherwise. Reads local settings only; no network calls.
set -u

project="${1:-$PWD}"
min_code="2.1.281"
min_desktop="1.13576.0"
blockers=0

settings_files=("$HOME/.claude/settings.json")
if [ "$project/.claude" != "$HOME/.claude" ]; then
	settings_files+=("$project/.claude/settings.json" "$project/.claude/settings.local.json")
fi
settings_files+=("/Library/Application Support/ClaudeCode/managed-settings.json" "/etc/claude-code/managed-settings.json")

say() { printf '%-8s %s\n' "$1" "$2"; }
detail() { printf '%-8s %s\n' "" "$1"; }
blocker() {
	blockers=$((blockers + 1))
	say BLOCKER "$1"
}

# Prints file:line for every settings file that mentions the key.
where_set() {
	local f
	for f in "${settings_files[@]}"; do
		[ -f "$f" ] || continue
		grep -n "\"$1\"" "$f" 2>/dev/null | while IFS=: read -r line _; do detail "set at $f:$line"; done
	done
}

version_ge() {
	local a b i x y
	IFS=. read -r -a a <<<"$(printf '%s' "$1" | sed 's/[^0-9.].*//')"
	IFS=. read -r -a b <<<"$2"
	for i in 0 1 2; do
		x=${a[i]:-0}
		y=${b[i]:-0}
		((10#$x > 10#$y)) && return 0
		((10#$x < 10#$y)) && return 1
	done
	return 0
}

is_truthy() {
	case "$1" in "" | 0 | false | FALSE | False) return 1 ;; *) return 0 ;; esac
}

# Versions: the running binary first; the CLI on PATH can differ from what the desktop app bundles.
code_bin="${CLAUDE_CODE_EXECPATH:-$(command -v claude 2>/dev/null)}"
code_ver=""
[ -n "$code_bin" ] && code_ver=$("$code_bin" --version 2>/dev/null | awk '{print $1}')
if [ -z "$code_ver" ]; then
	say WARN "Claude Code version unknown (no CLAUDE_CODE_EXECPATH, no claude on PATH); needs $min_code+"
elif version_ge "$code_ver" "$min_code"; then
	say OK "Claude Code $code_ver (needs $min_code+)"
else
	blocker "Claude Code $code_ver is older than $min_code"
	detail "fix: update Claude Code (desktop app: restart it to pick up the bundled update; CLI: claude update)"
fi

if [ -n "${CLAUDE_CODE_DESKTOP_APP_VERSION:-}" ]; then
	if version_ge "$CLAUDE_CODE_DESKTOP_APP_VERSION" "$min_desktop"; then
		say OK "Claude desktop app $CLAUDE_CODE_DESKTOP_APP_VERSION (needs $min_desktop+)"
	else
		blocker "Claude desktop app $CLAUDE_CODE_DESKTOP_APP_VERSION is older than $min_desktop"
		detail "fix: update the Claude desktop app"
	fi
fi

# Env switches that turn artifacts off. In the env = this session; only in a file = new sessions.
for var in CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC CLAUDE_CODE_DISABLE_ARTIFACT; do
	in_files=$(where_set "$var")
	if [ -n "${!var:-}" ]; then
		blocker "$var is set in this session's environment (artifacts are off whenever it is set)"
		if [ -n "$in_files" ]; then
			printf '%s\n' "$in_files"
		else
			detail "no settings file sets it: it was removed after this session started, or comes from your shell profile or launch environment"
		fi
		detail "fix: remove it from the place that sets it, then start a new session"
	elif [ -n "$in_files" ]; then
		say WARN "$var is in a settings file; new sessions started there will have artifacts off"
		printf '%s\n' "$in_files"
	fi
done

for var in CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY; do
	if is_truthy "${!var:-}"; then
		blocker "$var is on: artifacts need the Anthropic API provider"
		where_set "$var"
		detail "fix: run this session on the Anthropic API with a claude.ai login"
	fi
done

# Auth: only a claude.ai login can publish.
for var in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; do
	if [ -n "${!var:-}" ]; then
		say WARN "$var is set; a session authenticated by API key or gateway token can't publish"
		where_set "$var"
		detail "fix: unset it and sign in with /login (claude.ai account)"
	fi
done
if [ -n "$(where_set apiKeyHelper)" ]; then
	say WARN "apiKeyHelper is configured; key-based sessions can't publish"
	where_set apiKeyHelper
fi

base_host=$(printf '%s' "${ANTHROPIC_BASE_URL:-}" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')
if [ -n "$base_host" ] && [ "$base_host" != "api.anthropic.com" ]; then
	say WARN "ANTHROPIC_BASE_URL points at $base_host; publishing fails through an LLM gateway"
	where_set ANTHROPIC_BASE_URL
fi

# Settings keys and permission rules.
key_hits=$(for f in "${settings_files[@]}"; do
	[ -f "$f" ] || continue
	grep -nE '"enableArtifact"[[:space:]]*:[[:space:]]*false' "$f" | while IFS=: read -r line _; do
		say BLOCKER '"enableArtifact": false'
		detail "set at $f:$line"
		detail "fix: delete the key (true in project settings does not re-enable), then start a new session"
	done
	grep -nE '"disableArtifact"[[:space:]]*:[[:space:]]*true' "$f" | while IFS=: read -r line _; do
		say BLOCKER '"disableArtifact": true (deprecated key)'
		detail "set at $f:$line"
		detail "fix: delete the key, then start a new session"
	done
	awk '
		/"deny"[[:space:]]*:/ { in_deny = 1 }
		in_deny && /"Artifact["(]/ { print FNR }
		in_deny && /\]/ { in_deny = 0 }
	' "$f" | while read -r line; do
		say BLOCKER "the Artifact tool is in permissions.deny"
		detail "set at $f:$line"
		detail 'fix: remove "Artifact" from deny, then start a new session'
	done
done)
if [ -n "$key_hits" ]; then
	printf '%s\n' "$key_hits"
	blockers=$((blockers + 1))
fi

if [ "$blockers" -eq 0 ]; then
	say OK "no local blocker found"
	detail "If the Artifact tool is still missing, the cause is account-side: plan (needs Pro, Max, Team or Enterprise),"
	detail "the org's Artifacts toggle (Team/Enterprise Owner: claude.ai Organization settings > Artifacts),"
	detail "CMEK/HIPAA/ZDR on the org, or the org policy not loading from api.anthropic.com (proxy/VPN)."
	exit 0
fi
exit 1
