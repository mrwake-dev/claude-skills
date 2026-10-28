#!/usr/bin/env bash
# run_audit.sh — runs all dependency audit commands and dumps JSON to an output directory.
#
# Usage: ./run_audit.sh <project-dir> <output-dir>
# Example: ./run_audit.sh ./my-project ./audit-results

set -u

PROJECT_DIR="${1:-.}"
OUTPUT_DIR="${2:-./audit-results}"

if [ ! -f "$PROJECT_DIR/package.json" ]; then
  echo "Error: $PROJECT_DIR/package.json not found" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cd "$PROJECT_DIR" || exit 1

# Detect package manager
PM="npm"
if [ -f "pnpm-lock.yaml" ]; then PM="pnpm"; fi
if [ -f "yarn.lock" ] && [ ! -f "package-lock.json" ]; then PM="yarn"; fi
if [ -f "bun.lock" ] || [ -f "bun.lockb" ]; then PM="bun"; fi
echo "$PM" > "$OUTPUT_DIR/package_manager.txt"
echo "Detected package manager: $PM"

# Capture Node + npm versions
node --version > "$OUTPUT_DIR/node_version.txt" 2>/dev/null || echo "unknown" > "$OUTPUT_DIR/node_version.txt"
npm --version > "$OUTPUT_DIR/npm_version.txt" 2>/dev/null || echo "unknown" > "$OUTPUT_DIR/npm_version.txt"

# Copy package.json and lockfile if present
cp package.json "$OUTPUT_DIR/package.json" 2>/dev/null || true
cp package-lock.json "$OUTPUT_DIR/package-lock.json" 2>/dev/null || true

run_step() {
  local name="$1"
  shift
  echo "Running: $name"
  if "$@" > "$OUTPUT_DIR/$name.json" 2> "$OUTPUT_DIR/$name.err"; then
    echo "  ok"
  else
    # Non-zero exit is fine for audit/outdated — they exit non-zero when issues exist
    echo "  completed (exit $?)"
  fi
}

case "$PM" in
  npm)
    run_step "audit"     npm audit --json
    run_step "outdated"  npm outdated --json --long
    run_step "tree"      npm ls --json --all
    run_step "install_dryrun" npm install --dry-run --json
    ;;
  yarn)
    run_step "audit"    yarn audit --json
    run_step "outdated" yarn outdated --json
    ;;
  pnpm)
    run_step "audit"    pnpm audit --json
    run_step "outdated" pnpm outdated --format json
    ;;
  bun)
    run_step "audit"    bun audit --json
    # bun outdated has no JSON flag yet — capture human-readable output for the report,
    # and also run npm outdated against package.json as a JSON fallback if npm is available.
    run_step "outdated_text" bun outdated
    if command -v npm > /dev/null 2>&1; then
      run_step "outdated" npm outdated --json --long
    fi
    run_step "tree" bun pm ls --all
    ;;
esac

echo ""
echo "Audit results written to: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"
