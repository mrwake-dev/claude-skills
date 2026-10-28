# Java Rules

- **Null safety** — use `Optional` for return types that may be absent; annotate with `@Nullable`/`@NonNull` where applicable; avoid returning `null` from public methods
- **Exception handling** — proper use of checked vs. unchecked exceptions; custom exception hierarchy with meaningful messages; no empty catch blocks; no catching `Exception` or `Throwable` generically
- **Immutability** — prefer `final` fields; use unmodifiable collections (`List.of()`, `Collections.unmodifiableList()`); avoid exposing mutable internal state
- **Concurrency** — thread safety of shared mutable state; proper use of `synchronized`, `volatile`, or concurrent utilities; watch for race conditions and deadlocks
- **Resource management** — `try-with-resources` for `AutoCloseable` resources (streams, connections, readers); no resource leaks
- **Dependency injection** — constructor injection over field injection; avoid `new` for service-layer dependencies
- **Naming and structure** — follow standard Java conventions (PascalCase classes, camelCase methods, UPPER_SNAKE_CASE constants); one public class per file
- **Serialization** — safe deserialization practices; avoid `ObjectInputStream` on untrusted data
- **Logging** — use parameterized logging (`log.info("User {} logged in", userId)`) instead of string concatenation
