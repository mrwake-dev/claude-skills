---
name: mwd-code-review-local
description: Perform code review on a GitLab merge request, providing feedback on code quality, correctness, and adherence. Use when the user asks to "review" a merge request.
argument-hint: "[merge-request-url]"
disable-model-invocation: true
---

# Code Review for GitLab Merge Requests

Perform code review on the merge request at $ARGUMENTS.

## Workflow

### Step 1: Fetch MR Details

Parse the MR URL to extract the project path and MR IID (e.g., `https://gitlab.com/my-group/services/my-service/-/merge_requests/42` → repo `my-group/services/my-service`, IID `42`).

```bash
# Fetch MR metadata (title, description, author, labels, etc.)
glab mr view <iid> -R <group/namespace/repo> -F json

# Fetch code changes
glab mr diff <iid> -R <group/namespace/repo> --raw

# Fetch commit history
glab api "projects/<url-encoded-project>/merge_requests/<iid>/commits"
```

**URL-encoding**: Replace `/` with `%2F` in the project path (e.g., `my-group/services/my-service` → `my-group%2Fservices%2Fmy-service`).

Check the MR description for completeness:
- Is there a clear description of what changed and why?
- Is the standard MR template filled in (classification, ClickUp task, checklists)?

### Step 2: Contextual Analysis

Before reviewing the diff, gather context:

1. **Identify the primary language/framework** from file extensions in the diff (`.ts`/`.tsx` → TypeScript/React, `.java` → Java, `.py` → Python, `.go` → Go, etc.) and apply the corresponding language-specific rules from Step 3.
2. **Read surrounding code** — for any modified file, examine the broader context (imports, class structure, related interfaces/types) to understand existing patterns and conventions in the project.
3. **Check for broken contracts** — if public APIs, interfaces, or shared types are modified, verify that all consumers are updated accordingly.

Check the MR description for completeness:
- Is there a clear description of what changed and why?
- Is the standard MR template filled in (classification, ClickUp task, checklists)?

Check the commit history:
- Are commit messages descriptive and meaningful?
- Is the history clean and logically structured, or full of "fix", "wip", "asdf"?
- Are commits broken down into logical, self-contained units?

### Step 3: Generate Feedback

Always apply the **General** and **Security** rules regardless of language. Then apply the relevant **language-specific** rules based on the detected language/framework.

#### General (all languages)

- **Code quality and readability**
  - Hardcoded values that should be configurable (magic numbers, URLs, timeouts)
  - Dead code or commented-out code that should be removed
  - Duplicated logic that should be extracted into shared utilities
  - Naming clarity — do names accurately describe intent?
- **Correctness**
  - Does the implementation match the described intent in the MR description?
  - Are there unhandled edge cases or missing error handling?
  - Are error messages informative and actionable?
- **Architecture**
  - Single-purpose components, proper separation of concerns
  - No breaking changes to public APIs without versioning or migration path
  - Environment variables accessed only in entry/config files, not scattered throughout
- **Logging**
  - Are important operations logged at appropriate levels?
  - Is logging too verbose or too sparse?
  - Are sensitive data (tokens, passwords, PII) excluded from logs?
- **Tests**
  - Are new/changed behaviors covered by tests?
  - Do tests follow AAA pattern (Arrange, Act, Assert)?
  - Are external dependencies mocked?
  - Are edge cases and error paths tested?
- **Dependencies**
  - Are new dependencies justified and not duplicating existing functionality?
  - Are dependency versions pinned and free of known vulnerabilities?
- **CHANGELOG**
  - Is there an entry under `[Unreleased]` using Keep a Changelog format?

#### Security (all languages)

- No exposed secrets, API keys, tokens, or credentials in code or config files
- Parameterized queries to prevent SQL/NoSQL injection
- Input validation at all API boundaries (not just SQL — also path traversal, SSRF, header injection)
- Authentication and authorization checks — are access controls present and correct?
- Sensitive data not leaked in logs, error messages, or API responses
- Deserialization of untrusted data handled safely
- CORS configuration is restrictive and intentional
- Rate limiting considered for public-facing endpoints

#### TypeScript / Node.js

- No `any` types; no type assertions (`as`, `<Type>`) — use `zod` schemas or type guards instead
- Correct naming conventions (camelCase for variables/functions, PascalCase for types/classes, UPPER_SNAKE_CASE for constants)
- Custom error classes with `Error` postfix
- Proper async/await usage — no floating promises, proper error propagation
- Microservices/CQRS/event sourcing patterns followed where applicable
- Test files use `*.spec.ts` in `test/` directory

#### React / Frontend

- Functional components only; no `FC` type, no `IOwnProps`
- Named exports only; absolute imports; proper import sorting
- `useNotification` for notifications, `useTranslation` for i18n
- No direct DOM manipulation — use refs or state
- Memoization (`useMemo`, `useCallback`) used appropriately, not excessively
- Accessibility basics (semantic HTML, alt text, keyboard navigation)

#### Java

- **Null safety** — use `Optional` for return types that may be absent; annotate with `@Nullable`/`@NonNull` where applicable; avoid returning `null` from public methods
- **Exception handling** — proper use of checked vs. unchecked exceptions; custom exception hierarchy with meaningful messages; no empty catch blocks; no catching `Exception` or `Throwable` generically
- **Immutability** — prefer `final` fields; use unmodifiable collections (`List.of()`, `Collections.unmodifiableList()`); avoid exposing mutable internal state
- **Concurrency** — thread safety of shared mutable state; proper use of `synchronized`, `volatile`, or concurrent utilities; watch for race conditions and deadlocks
- **Resource management** — `try-with-resources` for `AutoCloseable` resources (streams, connections, readers); no resource leaks
- **Dependency injection** — constructor injection over field injection; avoid `new` for service-layer dependencies
- **Naming and structure** — follow standard Java conventions (PascalCase classes, camelCase methods, UPPER_SNAKE_CASE constants); one public class per file
- **Serialization** — safe deserialization practices; avoid `ObjectInputStream` on untrusted data
- **Logging** — use parameterized logging (`log.info("User {} logged in", userId)`) instead of string concatenation

#### Python

- Type hints on function signatures and return types
- No mutable default arguments (`def foo(items=[])`)
- Proper use of context managers (`with` statements) for resource handling
- Virtual environment and dependency management (requirements pinned)
- Pythonic patterns — list comprehensions over manual loops where appropriate, `pathlib` over `os.path`
- Exception handling — specific exceptions, not bare `except:`

#### Go

- Error handling — all errors checked, no ignored return values; use `fmt.Errorf` with `%w` for wrapping
- Goroutine safety — proper channel usage, no goroutine leaks, context propagation
- Interface design — small interfaces, accept interfaces return structs
- Resource cleanup with `defer`
- Naming follows Go conventions (exported = PascalCase, unexported = camelCase, acronyms uppercase)

---

### Step 4: Generate Report

Structure the report using the format below. End with a clear verdict.

## Report Format

### Executive Summary
[2-3 sentences: overall assessment, number of critical/high findings, primary areas of concern]

**Verdict:** [APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES]
 
### [CRITICAL-1] Title
- **File:** `path/to/File.ts`, line(s) X-Y
- **Category:** [e.g., DoS & Resource Exhaustion]
- **Description:** What the issue is and why it matters
- **Fix:**
```ts
// Concrete code showing the fix
```

### [HIGH-1] Title
[Same structure as Critical]

### [MED-1] Title
[Same structure, attack scenario optional]

### [LOW-1] Title
[Abbreviated structure]

### What looks good
[Acknowledge good patterns and clean code where appropriate, if any]
