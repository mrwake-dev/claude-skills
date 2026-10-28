#!/usr/bin/env bash
# Checks status codes, redirect targets and response headers of a site (local wrangler dev or live).
#
# Usage: check-site.sh <base-url> <path=status[>location]>... [--header 'name=value']...
#   /=200                    expect 200
#   '/about/=307>/about'     expect a 307 whose Location resolves to /about (quote it: > is a shell redirect)
#   /missing=404             expect 404
#   --header 'x-robots-tag=noindex'   every checked response must carry this header with this value
# Exits 1 if any check fails.
set -u

if [ $# -lt 2 ]; then
	sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
fi

base="${1%/}"
shift
expectations=()
headers=()
while [ $# -gt 0 ]; do
	case "$1" in
	--header)
		headers+=("$2")
		shift 2
		;;
	*)
		expectations+=("$1")
		shift
		;;
	esac
done

failures=0
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

for exp in "${expectations[@]}"; do
	path="${exp%%=*}"
	want="${exp#*=}"
	want_status="${want%%>*}"
	want_location=""
	if [ "$want" != "$want_status" ]; then
		want_location="${want#*>}"
	fi

	result=$(curl -s -o /dev/null -D "$tmp" --max-time 20 --retry 2 --retry-delay 2 -w '%{http_code} %{redirect_url}' "$base$path")
	status="${result%% *}"
	location="${result#* }"
	# Compare only the path part, so absolute and relative Location headers both match
	location_path=$(printf '%s' "$location" | sed -E 's#^[a-zA-Z]+://[^/]+##')

	problems=""
	if [ "$status" != "$want_status" ]; then
		problems="status $status, expected $want_status"
	fi
	if [ -n "$want_location" ] && [ "$location_path" != "$want_location" ]; then
		problems="${problems:+$problems; }redirects to '${location_path:-nothing}', expected '$want_location'"
	fi
	for h in ${headers[@]+"${headers[@]}"}; do
		name="${h%%=*}"
		value="${h#*=}"
		actual=$(grep -i "^$name:" "$tmp" | head -1 | cut -d: -f2- | tr -d '\r' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
		if [ "$actual" != "$value" ]; then
			problems="${problems:+$problems; }header $name is '${actual:-missing}', expected '$value'"
		fi
	done

	if [ -z "$problems" ]; then
		printf 'PASS  %-28s %s%s\n' "$path" "$status" "${location_path:+ -> $location_path}"
	else
		printf 'FAIL  %-28s %s\n' "$path" "$problems"
		failures=$((failures + 1))
	fi
done

if [ "$failures" -gt 0 ]; then
	printf '\n%d of %d checks failed\n' "$failures" "${#expectations[@]}"
	exit 1
fi
printf '\nAll %d checks passed\n' "${#expectations[@]}"
