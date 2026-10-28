# Mechanical pre-scan — flatten and grep passes

Step 3 of the skill runs this in the main context, in both modes and both execution modes, before any
judgement-based review. See SKILL.md Step 3 for why.

## Flatten the diff

Flatten the saved diff into one `file:new_line:added_text` record per added line — every pattern pass
then runs against that one file, and each hit already carries the new-side anchor data Step 4 needs:

```bash
DIFF="<run-dir>/change.diff"             # the same path in both modes
ADDED="${DIFF%.diff}.added"
awk '
  /^diff --git/ || /^index / || /^old mode/ || /^new mode/ { next }
  /^--- /    { next }
  /^\+\+\+ / { f = substr($0, 7); next }   # strip "+++ b/"
  /^@@/      { match($0, /\+[0-9]+/); n = substr($0, RSTART + 1, RLENGTH - 1) + 0; next }
  /^\\/      { next }                      # "\ No newline at end of file"
  /^\+/      { print f ":" n ":" substr($0, 2); n++; next }
  /^-/       { next }
             { n++ }                       # context line advances the new-side counter
' "$DIFF" > "$ADDED"
wc -l "$ADDED"
```

## Pattern passes

Then run the passes for the rule files detected in Step 2 — only those:

```bash
# --- typescript.md ---
grep -nE '\bany\b' "$ADDED"                                                     # no `any` types
grep -nE '\bas +[A-Z]|\bas +(const|unknown)\b|[^A-Za-z0-9_.>]<[A-Z][A-Za-z0-9_]*> *[A-Za-z_(]' "$ADDED"   # no type assertions
                                                                                # (the third alternative is the `<Foo>bar` form; requiring a
                                                                                # non-identifier before `<` keeps out `useState<Bar>(`, `g<T>(`,
                                                                                # `Promise<Foo>`, `new Map<String, Foo>()`)
grep -nE '@ts-(ignore|nocheck)' "$ADDED"                                        # never acceptable
grep -nE '@ts-expect-error' "$ADDED"                                            # allowed only with a stated reason
grep -nE 'class +[A-Za-z0-9_]+ +extends +[A-Za-z0-9_]*Error' "$ADDED"            # Error postfix on custom errors

# --- react.md (read together with typescript.md) ---
grep -nE '\bReact\.FC\b|\bFC<|\bFunctionComponent\b|IOwnProps' "$ADDED"          # no FC type, no IOwnProps
grep -nE 'export +default' "$ADDED"                                              # named exports only
grep -nE 'document\.(getElementById|querySelector|createElement|write)|\.innerHTML *=' "$ADDED"  # no direct DOM

# --- python.md ---
grep -nE 'except *:' "$ADDED"                                                    # no bare except
grep -nE 'def +[A-Za-z0-9_]+\(.*= *(\[\]|\{\})' "$ADDED"                         # no mutable default args

# --- java.md ---
grep -nE 'catch *\( *(Exception|Throwable)\b' "$ADDED"                           # no generic catch
grep -nE 'log[A-Za-z]*\.(trace|debug|info|warn|error) *\(.*\+' "$ADDED"          # parameterized logging only

# --- go.md ---
grep -nE 'fmt\.Errorf\(' "$ADDED" | grep -v '%w'                                 # wrap with %w
grep -nE '[^A-Za-z0-9_]_ *:?=' "$ADDED"                                          # ignored return values (note: `^` would
                                                                                 # never match — every record starts `file:line:`)

# --- device-runtime.md ---
# Resolve the real build target, the gate and polyfill coverage first (device-runtime.md, "Resolve
# the target first") — that is what turns most hits below into one-line dismissals.

# Lib & DOM APIs: never transpiled, invisible to es-check, invisible to tsc under `lib: es2022`.
grep -nE 'Object\.(entries|values|assign|fromEntries|hasOwn)\(|Array\.from\(|\.(padStart|padEnd|trimStart|trimEnd|matchAll|replaceAll)\(' "$ADDED"           # ES2015-21 lib
grep -nE 'Promise\.(allSettled|any)\(|\.finally\(|structuredClone\(|\.(at|findLast|findLastIndex)\(|\.(flat|flatMap)\(|\bglobalThis\b|\bBigInt\b' "$ADDED"   # ES2018-22 lib
grep -nE '\bfetch\(|AbortController|AbortSignal\.timeout|URLSearchParams|IntersectionObserver|ResizeObserver|requestIdleCallback|queueMicrotask\(|new EventTarget\(|\.closest\(|\.replaceChildren\(|crypto\.subtle' "$ADDED"  # DOM/BOM

# Regex syntax is engine-level — never transpiled, whatever the target.
grep -nE '\(\?<[=!A-Za-z]' "$ADDED"                                              # named groups, lookbehind

# Downlevellable syntax. Noise wherever a loader covers the file, so run this pass ONLY for files
# nothing compiles (config/, tools/, scripts/, *.mjs, *.cjs, *.sh) or when there is no gate.
grep -nE '\?\.|\?\?|\|\|=|&&=|\basync |\bawait |\{ *\.\.\.|for await|catch *\{|[A-Za-z0-9_)] *\*\* *[A-Za-z0-9_(]' "$ADDED"

grep -nE 'setInterval\(|setTimeout\(|addEventListener\(' "$ADDED"                # needs matching teardown
grep -nE 'gap *:|aspect-ratio|position *: *sticky|inset *:|:has\(' "$ADDED"      # CSS vs oldest target WebKit

# --- platform-scripts.md ---
# Records are `file:line:text`, so the `^[^:]*\.ext:` anchor scopes each pass to its file type.
grep -nE '^[^:]*\.(sh|bash):.*\b(rm|cp|mv|cd|mkdir) +[^|]*\$[A-Za-z_{]' "$ADDED"  # unquoted expansion in a destructive path
grep -nE '^[^:]*\.(sh|bash):.*(`|\| *(ba)?sh\b|\beval )' "$ADDED"                 # backticks, curl|sh, eval
grep -nE '^[^:]*\.(ps1|psm1):.*(Invoke-Expression|\biex\b|-ErrorAction +SilentlyContinue|-AsPlainText)' "$ADDED"
grep -E '^\+\+\+ .*\.(sh|bash)$' "$DIFF"                                          # new/changed shell file — verify `set -euo pipefail`
grep -E '^\+\+\+ .*\.(ps1|psm1)$' "$DIFF"                                         # new/changed PS file — verify $ErrorActionPreference / Set-StrictMode

# --- general.md (added lines) ---
grep -niE '(api[_-]?key|secret|token|password|passwd|credential)[^=:]{0,4}[:=][^=]{8,}' "$ADDED"  # hardcoded secrets

# --- general.md (changed-file list, not line content) ---
grep -E '^\+\+\+ ' "$DIFF"    # manifest without its lockfile (and vice versa); missing CHANGELOG entry;
                              # test files outside test/ or not named *.spec.ts
```

## Triage

**Every hit must be accounted for.** Hits are candidates, not findings — the patterns favour recall, so
`\bany\b` also matches `Promise.any(` and the word "any" in comments and strings, and the leak and
device-runtime passes match plenty of perfectly correct code (a `setTimeout` that *is* cleared, an
optional chain the build target *does* cover). Triage each hit against its rule file and the
surrounding code, then either raise it as a finding or record it as dismissed with a one-line reason.
What is forbidden is a hit that simply disappears — that is the failure this pre-scan exists to
prevent, and Step 4.4 reports the counts.

Two caveats on the derived positions: `new_line` values come from the awk hunk arithmetic, so confirm a
hit's line against the diff before it becomes a posted comment; and a removed line whose content starts
with `-- ` is indistinguishable from a `--- ` file header, so a hit's file attribution is worth a glance
when it looks wrong.
