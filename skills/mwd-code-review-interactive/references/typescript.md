# TypeScript / Node.js Rules

- No `any` types; no type assertions (`as`, `<Type>`) — use `zod` schemas or type guards instead
- No compiler suppressions — fix the type error rather than silencing it. `@ts-nocheck` (disables the whole file) and `@ts-ignore` are never acceptable; `@ts-ignore` in particular rots silently, staying in place long after the error it hid is gone. Where a suppression is genuinely unavoidable (an upstream type bug, a `.d.ts` gap), require `@ts-expect-error` — it fails the build once it becomes unnecessary — narrowed to the single offending line and carrying a comment that states why and what would remove it
- Correct naming conventions (camelCase for variables/functions, PascalCase for types/classes, UPPER_SNAKE_CASE for constants)
- Custom error classes with `Error` postfix
- Proper async/await usage — no floating promises, proper error propagation
- Microservices/CQRS/event sourcing patterns followed where applicable
- Test files use `*.spec.ts` in `test/` directory
- JSDoc in `.ts`/`.tsx` files must not duplicate types the compiler already expresses (`@param {string}` is redundant and drifts) — doc comments carry semantics only (why, constraints, units, side effects)
