# Build & lint evidence — the `build` token

Step 3 runs this in the main context, after the mechanical pre-scan, **only when `$ARGUMENTS` carried
the `build` token**. Everything else in this skill reads code and asserts; the compiler and the linter
*prove*. A type error, a floating promise, an unused import — these are findings no reading pass
catches reliably, and they arrive with a `file:line` that posts as an inline comment unchanged.

The pass is **read-only and additive**: it never installs anything, never switches branches, never
stashes, and never writes to the repo. If it cannot run, it is recorded as `not run` with a reason and
the review continues exactly as it would without the token.

## Gate 1 — is this checkout actually the change?

In **Remote mode** the diff came from GitLab/GitHub; the working directory may be a different branch,
or a different repository entirely. Running the compiler here would then type-check code that has
nothing to do with the review, and every diagnostic would be a lie:

```bash
[ "$(git rev-parse HEAD 2>/dev/null)" = "$HEAD_SHA" ] || echo "not run (checkout is not at $HEAD_SHA)"
```

A mismatch ends the pass. **Do not** fetch, check out, switch branches, pull, or stash to make it
match — the user's working tree is theirs, and a review is never worth disturbing it. Say in one line
that the build pass was skipped and why; if they want it, they can check the branch out and re-run.

In **Local mode** the checkout *is* the change by construction, so this gate always passes. If Step 1
found uncommitted work and the user chose to include it, the tools see that same working tree — which
is correct, and worth stating in the coverage line.

## Gate 2 — is the toolchain already here?

Use only what the repo already has. **Never** run `npm install`, `go mod download`, `pip install`, a
Gradle bootstrap, or anything else that fetches dependencies: installs are slow, can need credentials
the session may not have, and can rewrite a lockfile inside the change under review. A missing
toolchain is a `not run` reason, not a problem to solve.

Resolve binaries from the repo first (`node_modules/.bin`), then `command -v`. Every block runs in a
fresh shell, so resolve them in the same block that uses them.

## What to run

Run only the tools matching the rule files Step 2 detected, from the repo root, each with a timeout:

| Detected | Command | Diagnostics format |
|:--|:--|:--|
| `typescript.md` / `react.md` | `node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false` | `src/a.ts(42,9): error TS2345: msg` |
| `typescript.md` / `react.md` | `node_modules/.bin/eslint --format unix <changed files>` | `/abs/src/a.ts:42:9: msg [Error/rule]` |
| `go.md` | `go vet ./...` then `go build ./...` | `./pkg/a.go:42:2: msg` |
| `python.md` | `ruff check --output-format concise .` / `mypy <changed files>` — only when the repo configures them | `a.py:42:9: F401 msg` |
| `platform-scripts.md` | `shellcheck -f gcc <changed .sh>` · `Invoke-ScriptAnalyzer` when `pwsh` is present | `a.sh:42:1: error: msg [SC2086]` |
| `java.md` | **not run by default** — a Maven/Gradle compile takes minutes and usually needs the network. Record `not run (build too expensive)` unless the user asked for it explicitly | — |

```bash
timeout 300 node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false > "<run-dir>/build-tsc.log" 2>&1
echo "tsc exit $?"
```

A timeout or a crash is a `not run` reason for that tool — never a finding, and never a reason to
retry with different flags.

**Monorepos**: a tool run inside a package prints paths relative to that package, while the diff's
paths are relative to the repo root. Either run from the root with the root config, or prefix the
package path onto each diagnostic before the join below. A join on mismatched paths silently yields
zero hits, which looks exactly like a clean build.

## Normalize, then join against the diff

Reduce every tool's output to the same `file:line:text` shape the pre-scan's flatten step produces, so
one join works for all of them:

```bash
# tsc
sed -nE 's#^([^(]+)\(([0-9]+),[0-9]+\): #\1:\2:#p' "<run-dir>/build-tsc.log"
# eslint --format unix, go vet, shellcheck -f gcc: already file:line:col:…, drop the column
sed -nE "s#^${PWD}/##; s#^\./##; s#^([^:]+):([0-9]+):[0-9]+: #\1:\2:#p" "<run-dir>/build-<tool>.log"
```

Collect them all into `<run-dir>/build.diag`. Then split them against `$ADDED` — the flatten file the
pre-scan already wrote (`pre-scan.md` §"Flatten the diff"; run that block first if you have not yet,
it is idempotent):

```bash
ADDED="${DIFF%.diff}.added"
awk -F: 'NR==FNR { a[$1 ":" $2]; next } ($1 ":" $2) in a'    "$ADDED" "<run-dir>/build.diag" > "<run-dir>/build.new"
awk -F: 'NR==FNR { a[$1 ":" $2]; next } !(($1 ":" $2) in a)' "$ADDED" "<run-dir>/build.diag" > "<run-dir>/build.other"
wc -l "<run-dir>/build.new" "<run-dir>/build.other"
```

**`mwd-build.new` is new by construction.** Those lines did not exist before this change, so a
diagnostic on one was introduced by it. No baseline build, no second checkout, no comparison run —
this is the whole reason the join is worth doing.

**`mwd-build.other` is ambiguous** and needs judgement, because it holds two very different things:

- *pre-existing* problems on lines this change never touched — noise, and in a repo that does not run
  these tools in CI there can be hundreds;
- *broken contracts* — the highest-value diagnostic this pass produces. Remove a field, rename an
  export, narrow a type, and the error lands on an **unchanged** line, usually in a file the diff does
  not touch at all. Filtering the ambiguous bucket away would throw out exactly what Step 2's "check
  for broken contracts" is asking for.

Triage it by size:

- **Empty** — nothing to do.
- **Up to ~20** — triage each one, the same contract as a pre-scan hit: raise it or dismiss it with a
  one-line reason. A diagnostic naming a symbol, file, or export the diff removed or renamed (check it
  against the diff's `-` lines) is a broken contract — raise it. One that has no connection to the
  change is pre-existing — dismiss it, and never post it as a finding on someone else's MR.
- **More than ~20** — the repo does not build clean to begin with, so per-item triage is not a good use
  of the run. Scan them for the broken-contract shape only, and record the rest as
  `N pre-existing diagnostics outside the change, not triaged` in the coverage line.

Certainty here would need a second build at the merge-base, in a second worktree with its own
dependency tree. That is out of scope deliberately: it doubles the slowest part of the run to resolve a
bucket that is usually empty.

## Handing the evidence to the review

The diagnostics are evidence for the dimensions, not a separate dimension of their own:

| Diagnostic | Dimension that owns it |
|:--|:--|
| Compile and type errors | Correctness |
| Lint rules about correctness (floating promises, unused vars, exhaustive deps) | Correctness |
| Lint rules that restate a language checklist (`no-explicit-any`, naming, import order) | Language conventions |
| `shellcheck` / `PSScriptAnalyzer` | Platform scripts |

In **fan-out** mode, each spawn prompt carries its own diagnostics as `file:line:text`, under the same
rule as the pre-scan hits: **every one must be either raised as a finding or dismissed with a reason**,
and a diagnostic that goes unmentioned is the failure this pass exists to prevent. In **inline** mode,
do the same triage yourself while reviewing the dimension that owns it.

Severity floor for what survives:

- A compile or type error on an added line is **HIGH** at minimum — the change does not build. Connect
  it to the CI status from Step 1: if CI is already failing, this is very likely why, and the finding
  should say so.
- A lint **error** is MED; a lint **warning** is LOW and still has to clear the usual bar of naming a
  concrete consequence.
- A diagnostic the repo's own config suppresses is not a finding. Neither is one in generated or
  vendored output — list that file under "not reviewed" instead.

## Reporting

The coverage line in Step 4.4 gains a `build:` segment naming **every** tool, including the ones that
did not run and why — the same auditability rule the dimensions follow:

```
build: tsc 3 → 2 raised, 1 pre-existing · eslint clean · shellcheck not run (not installed)
```

```
build: not run (checkout is not at 9f3c1a2b8d7e)
```

On an `artifact` run the same segment becomes its own badge row beside the coverage badges, and the
pre-existing diagnostics that were dismissed go in the dismissed table next to the pre-scan's.
