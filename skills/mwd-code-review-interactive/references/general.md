# General & Security Rules (always apply)

Apply these to every MR regardless of language.

## Code quality and readability

- Hardcoded values that should be configurable (magic numbers, URLs, timeouts)
- Dead code or commented-out code that should be removed
- Duplicated logic that should be extracted into shared utilities
- Naming clarity — do names accurately describe intent?

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
