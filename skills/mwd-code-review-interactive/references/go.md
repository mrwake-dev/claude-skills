# Go Rules

- Error handling — all errors checked, no ignored return values; use `fmt.Errorf` with `%w` for wrapping
- Goroutine safety — proper channel usage, no goroutine leaks, context propagation
- Interface design — small interfaces, accept interfaces return structs
- Resource cleanup with `defer`
- Naming follows Go conventions (exported = PascalCase, unexported = camelCase, acronyms uppercase)
