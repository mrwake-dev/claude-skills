# TypeScript / Node.js Rules

- No `any` types; no type assertions (`as`, `<Type>`) — use `zod` schemas or type guards instead
- Correct naming conventions (camelCase for variables/functions, PascalCase for types/classes, UPPER_SNAKE_CASE for constants)
- Custom error classes with `Error` postfix
- Proper async/await usage — no floating promises, proper error propagation
- Microservices/CQRS/event sourcing patterns followed where applicable
- Test files use `*.spec.ts` in `test/` directory
- JSDoc in `.ts`/`.tsx` files must not duplicate types the compiler already expresses (`@param {string}` is redundant and drifts) — doc comments carry semantics only (why, constraints, units, side effects)
