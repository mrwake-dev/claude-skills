# General & Security Rules (always apply)

Apply these to every MR regardless of language.

## Code quality and readability

- Hardcoded values that should be configurable (magic numbers, URLs, timeouts)
- Dead code or commented-out code that should be removed
- Duplicated logic that should be extracted into shared utilities
- Naming clarity — do names accurately describe intent?

## Documentation & comments

**Scope: existing docs only.** These rules validate doc comments that are already there — a function, class, or module *without* a doc comment is **never** a finding. Do not report "missing JSDoc/docstring/Javadoc" issues. Docs must always be correct — an outdated doc comment is worse than none.

- When a diff changes a function's signature, behavior, return value, thrown errors, or defaults, verify the attached doc comment (JSDoc/TSDoc, Javadoc, docstring) still matches — flag updating it as part of the change.
- `@param` names and count must match the actual parameters (renamed, removed, or added params are the classic drift).
- `@returns` must match what is actually returned now (e.g., became async, now returns `null` on failure).
- `@throws` must match errors actually thrown; documented defaults and units (ms vs s, ISO formats) must match the implementation.
- `@example` blocks must still reflect the current API.
- Docs that merely restate the name (`/** Gets the user. */ getUser()`) are noise — flag for removal or enrichment with what the code cannot say (why, constraints, side effects).
- Stale inline comments that no longer describe the adjacent code after a refactor.

## Correctness

- Does the implementation match the described intent in the MR description?
- Are there unhandled edge cases or missing error handling?
- Are error messages informative and actionable?

## Architecture

- Single-purpose components, proper separation of concerns
- No breaking changes to public APIs without versioning or migration path
- Environment variables accessed only in entry/config files, not scattered throughout

## Logging

- Are important operations logged at appropriate levels?
- Is logging too verbose or too sparse?
- Are sensitive data (tokens, passwords, PII) excluded from logs?

## Tests

- Are new/changed behaviors covered by tests?
- Do tests follow AAA pattern (Arrange, Act, Assert)?
- Are external dependencies mocked?
- Are edge cases and error paths tested?

## Dependencies

- Are new dependencies justified and not duplicating existing functionality?
- Are dependency versions pinned and free of known vulnerabilities?
- Manifest and lockfile move together — flag `package.json` (or equivalent) changes without the corresponding lockfile change, and vice versa.

## CHANGELOG

- Is there an entry under `[Unreleased]` using Keep a Changelog format?

## Security

- No exposed secrets, API keys, tokens, or credentials in code or config files
- Parameterized queries to prevent SQL/NoSQL injection
- Input validation at all API boundaries (not just SQL — also path traversal, SSRF, header injection)
- Authentication and authorization checks — are access controls present and correct?
- Sensitive data not leaked in logs, error messages, or API responses
- Deserialization of untrusted data handled safely
- CORS configuration is restrictive and intentional
- Rate limiting considered for public-facing endpoints
