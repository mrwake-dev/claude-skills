# Severity & Priority Rubric

This rubric translates raw audit findings into the four-tier priority used in the upgrade table. The goal is consistent, defensible classification — not perfect precision.

## Priority tiers

### Critical — fix immediately

- A vulnerability with severity **Critical** or **High** in `npm audit`
- A known exploit exists in the wild (check the advisory link)
- A deprecated package with **no maintained alternative** is still in production code paths
- The package handles auth, crypto, file uploads, deserialization, or external input AND has any known vulnerability

### High — fix this sprint

- A vulnerability with severity **Moderate** in `npm audit`
- The package is **2+ major versions behind** AND is security-sensitive (auth, network, crypto, parsing)
- A deprecated package with a clear, named successor (e.g., `request` → `undici`)
- A fix is available but requires a major version bump (breaking change)

### Medium — schedule for next quarter

- A vulnerability with severity **Low**
- The package is **1 major version behind**
- Peer dependency conflicts that don't currently break the build
- A deprecation warning without a security implication
- Build/dev tools (eslint, webpack, vite) more than one major version behind

### Low — when convenient

- Patch or minor version bumps with no security relevance
- Cosmetic warnings
- Type definition packages (`@types/*`) out of date

## Security-sensitive package categories

Treat these as security-sensitive when assigning priority:

- **Authentication / authorization**: passport, jsonwebtoken, bcrypt, argon2, oauth, openid
- **Crypto**: crypto-js, node-forge, sjcl, tweetnacl
- **Network / HTTP**: axios, got, node-fetch, request, undici, ws (websockets)
- **Parsing untrusted input**: xml2js, fast-xml-parser, marked, dompurify, sanitize-html, multer, formidable
- **Serialization**: node-serialize, serialize-javascript
- **Templating**: handlebars, ejs, pug, nunjucks
- **Database drivers**: mysql, mysql2, pg, mongodb, redis (when connecting to networks)

A "Moderate" CVE in `lodash` is treated more seriously than a "Moderate" CVE in `chalk`, because lodash often handles arbitrary input.

## Special cases

### "No fix available"

When `npm audit` reports a vulnerability with no fix:
1. Check if the vulnerable package can be removed entirely
2. Check if a `overrides` entry in `package.json` can pin a transitive dependency to a safe version
3. If the package is unmaintained, recommend a replacement
4. As a last resort, document the accepted risk

Mark these as **Critical** in the report so they get attention, even if the workaround is "accept the risk".

### Deprecated but no replacement

Some legacy packages are deprecated with messages like "this package is no longer maintained" and offer no alternative. Treat as **High** and note in the report that the user should evaluate dropping it or maintaining a fork.

### Pre-1.0 packages

For packages with version `0.x.y`, every minor bump can be breaking. Don't auto-recommend `wanted` for these — surface it as needing review.

### Workspaces / monorepos

In a monorepo, the same vulnerability may appear in multiple workspaces. Deduplicate by `(package, version)` in the report and list affected workspaces in the notes column.

## Examples

| Finding | Priority | Reasoning |
|---------|----------|-----------|
| `lodash@4.17.20`, prototype pollution, fixed in 4.17.21 | Critical | High CVSS, parses input, trivial patch |
| `axios@0.21.0`, SSRF, fixed in 1.6.0 | Critical | Network library, known exploit pattern |
| `eslint@7.x`, deprecated, replaced by 9.x | High | Major build tool, two majors behind |
| `react@17.0.2`, no vuln, latest is 18.3 | Medium | One major behind, breaking changes documented |
| `@types/node@18.x`, latest is 22.x | Low | Type-only, no runtime impact |
| `request@2.88.2`, deprecated, no fix | High | Replace with undici or node-fetch |
