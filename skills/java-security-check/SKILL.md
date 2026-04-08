---
name: java-security-check
description: Review Java code for security vulnerabilities and best practices.
disable-model-invocation: true
---

# Java Security & Quality Audit
 
This skill performs a structured, multi-pass audit of a Java project. It produces a prioritized report of findings with severity levels and concrete fix suggestions.
 
## When to use
 
- User asks to "check", "audit", "review" a Java project for bugs or security issues
- User uploads or points to Java source files and wants a quality/security review
- User mentions proxy, server, game server, or network code in Java context
- User asks about null safety, exception handling, resource leaks, DoS, or thread safety in Java
 
## Audit workflow
 
### Phase 1: Project discovery
 
1. Locate the Java source tree. Check for:
   - `src/main/java/` (Maven/Gradle standard)
   - `src/` with `.java` files
   - Any directory the user specifies
2. Identify the build system (`pom.xml`, `build.gradle`, `build.gradle.kts`) and note dependencies — especially networking libraries (Netty, Mina, raw NIO, java.net.Socket).
3. Get a full file listing to understand project structure and size.
 
```bash
# Example discovery commands
find <project_root> -name "*.java" | head -80
find <project_root> -name "pom.xml" -o -name "build.gradle" -o -name "build.gradle.kts" | head -5
```
 
### Phase 2: Multi-pass analysis
 
Read every Java source file systematically (use `view` tool). For large projects, prioritize in this order:
 
1. **Network/IO layer** — anything handling sockets, channels, packets, connections
2. **Protocol handlers** — packet parsing, serialization/deserialization
3. **Public API surface** — anything accepting external input
4. **Core logic** — business logic, state management
5. **Utilities and helpers**
 
For each file, check against ALL categories below. Do not skip categories even if a file seems simple.
 
### Phase 3: Report generation
 
Produce a structured markdown report saved as a file. See "Report format" section below.
 
---
 
## Audit categories
 
Check every file against every applicable category. The categories are ordered by typical severity for network-facing projects.
 
### 1. DoS & Resource Exhaustion (CRITICAL for proxies/servers)
 
These are the highest priority for any network-facing Java project:
 
- **Unbounded reads**: Reading from a stream/channel without a size limit. An attacker can send infinite data.
  - Look for: `InputStream.read()` loops without length caps, `ByteBuf.readBytes()` without max, `readAllBytes()` on untrusted input
  - Fix: Always enforce a `MAX_PACKET_SIZE` or `MAX_BUFFER_SIZE` constant
 
- **Unbounded allocations**: Allocating memory based on attacker-controlled values.
  - Look for: `new byte[packetLength]` where `packetLength` comes from the wire, `new ArrayList<>()` filled in a loop from external data, `StringBuilder` appending without limit
  - Fix: Validate sizes against reasonable maximums before allocating
 
- **Missing timeouts**: Connections or operations that can hang forever.
  - Look for: `Socket` without `setSoTimeout()`, `Future.get()` without timeout, `Lock.lock()` without `tryLock(timeout)`, blocking reads without deadline
  - Fix: Always set timeouts on all blocking operations
 
- **Thread/connection exhaustion**: Unbounded thread or connection creation.
  - Look for: `new Thread()` per connection, `Executors.newCachedThreadPool()` without bounds, no connection limits on `ServerSocket.accept()` loops
  - Fix: Use bounded thread pools, enforce max connection limits
 
- **Slowloris-style attacks**: Accepting connections that send data very slowly to tie up resources.
  - Look for: Per-connection threads that block on slow reads, no idle timeout on connections
  - Fix: Use NIO/event-loop architecture, enforce idle timeouts
 
- **Hash collision attacks**: Using `HashMap` with attacker-controlled keys.
  - Look for: `HashMap<String, ...>` where keys come from network input
  - Fix: Use size limits, consider `LinkedHashMap` with access order + max size, or rate limiting
 
### 2. Null Safety
 
- **Unchecked return values**: Methods that can return null but callers don't check.
  - Look for: `Map.get()` used directly without null check, `String.split()` results assumed non-empty, method calls on potentially null references
  - Fix: Add null checks, use `Optional`, or use `Objects.requireNonNull()` at boundaries
 
- **Null parameters**: Methods that receive parameters without validating them.
  - Look for: Public/protected methods that use parameters directly, constructor parameters stored without validation
  - Fix: Add `Objects.requireNonNull()` or precondition checks at method entry
 
- **Nullable fields accessed without checks**: Fields that might be null at access time.
  - Look for: Fields initialized to null and accessed later, fields set in one method and used in another without synchronization
  - Fix: Initialize in constructor, use `Optional`, or add null checks
 
### 3. Exception Handling
 
- **Swallowed exceptions**: Catch blocks that silently discard errors.
  - Look for: Empty catch blocks, catch blocks with only a comment, `catch (Exception e) {}`, logging without re-throwing when error state is critical
  - Fix: At minimum log the exception. Consider if it should be re-thrown or if the error state needs handling.
 
- **Overly broad catch**: Catching `Exception` or `Throwable` when specific exceptions are expected.
  - Look for: `catch (Exception e)`, `catch (Throwable t)` in non-top-level code
  - Fix: Catch specific exception types
 
- **Missing finally/try-with-resources**: Resources opened but not closed in a finally block.
  - Look for: `new FileInputStream(...)` or `Socket` or `Connection` not in try-with-resources
  - Fix: Use try-with-resources
 
- **Exception information leakage**: Stack traces or internal details sent to remote clients.
  - Look for: Sending `e.getMessage()` or `e.toString()` over the network to untrusted clients
  - Fix: Log the full exception server-side, send a generic error to the client
 
### 4. Thread Safety & Concurrency
 
- **Shared mutable state without synchronization**: Fields accessed from multiple threads without proper guards.
  - Look for: Non-volatile, non-synchronized fields in classes used by multiple threads (connection handlers, shared caches, player registries)
  - Fix: Use `volatile`, `synchronized`, `Atomic*` types, or concurrent collections
 
- **Check-then-act races**: Checking a condition and then acting on it without atomicity.
  - Look for: `if (map.containsKey(k)) { map.get(k)... }`, `if (!file.exists()) { file.create() }`
  - Fix: Use `computeIfAbsent`, `putIfAbsent`, or synchronize the whole block
 
- **Unsafe publication**: Objects shared between threads without proper visibility guarantees.
  - Look for: Setting a field in one thread and reading it in another without `volatile` or `synchronized`
  - Fix: Use `volatile`, final fields, or thread-safe publication patterns
 
- **Deadlock potential**: Acquiring multiple locks in inconsistent order.
  - Look for: Nested `synchronized` blocks on different objects, multiple `Lock.lock()` calls
  - Fix: Define and document lock ordering
 
### 5. Input Validation & Injection
 
- **Buffer/array index issues**: Using attacker-controlled values as array indices without bounds checking.
  - Look for: `array[packetId]` where `packetId` is from the wire, negative index values not checked
  - Fix: Validate bounds before indexing
 
- **Integer overflow**: Arithmetic on untrusted values that could overflow.
  - Look for: `length * width` for buffer sizing, `offset + size` without overflow check
  - Fix: Use `Math.addExact()`, `Math.multiplyExact()`, or manual overflow checks
 
- **String encoding issues**: Assuming encoding without specifying it.
  - Look for: `new String(bytes)` without charset, `getBytes()` without charset
  - Fix: Always specify `StandardCharsets.UTF_8` or the expected charset
 
- **Path traversal**: Building file paths from user input.
  - Look for: `new File(baseDir + userInput)`, `Paths.get(userSupplied)`
  - Fix: Canonicalize and verify the path stays within the intended directory
 
- **Deserialization**: Using Java's built-in serialization on untrusted data.
  - Look for: `ObjectInputStream` on network data, `readObject()` from untrusted sources
  - Fix: Never deserialize untrusted data with Java serialization. Use a safe format (JSON, Protocol Buffers, custom binary).
 
### 6. Resource Management
 
- **Leaked resources**: Streams, connections, channels not properly closed.
  - Look for: Resources opened in one method but closed (or not) somewhere else, resources closed in a different order than opened, resources not closed on error paths
  - Fix: Use try-with-resources, implement `Closeable`/`AutoCloseable`
 
- **Leaked ByteBufs (Netty-specific)**: Reference-counted buffers not released.
  - Look for: `ByteBuf` received in a handler but not released, `ByteBuf.copy()` or `ByteBuf.retain()` without corresponding `release()`, exception paths that skip `release()`
  - Fix: Use `try { ... } finally { buf.release(); }` or `ReferenceCountUtil.release()`
 
- **Connection leaks**: Connections from pools not returned.
  - Look for: Database connections, HTTP client connections opened without close, error paths that skip connection close
  - Fix: Always close in finally/try-with-resources
 
### 7. Logging & Information Disclosure
 
- **Sensitive data in logs**: Logging passwords, tokens, keys, or personally identifiable information.
  - Look for: Logging request/packet contents that might contain credentials, `log.debug(password)`, logging full connection details
  - Fix: Sanitize logged data, use structured logging with known-safe fields
 
- **Verbose error responses**: Sending detailed error messages to untrusted parties.
  - Look for: Forwarding exception messages to clients, including server internals in error packets
  - Fix: Generic error codes/messages to clients, full details only in server logs
 
### 8. Cryptography & Authentication (if applicable)
 
- **Weak or missing encryption**: Using outdated algorithms or plaintext where encryption is expected.
  - Look for: `DES`, `RC4`, `MD5` for security purposes, `TrustManager` that accepts all certificates, `SSLContext` with `TrustAll`
  - Fix: Use modern algorithms (AES-256-GCM, SHA-256+), proper certificate validation
 
- **Hardcoded secrets**: API keys, passwords, or tokens in source code.
  - Look for: String literals that look like keys/passwords, `"password"`, base64-encoded secrets
  - Fix: Use environment variables, config files excluded from VCS, or a secrets manager
 
---
 
## Report format
 
Save the report as `security-audit-report.md` in the output directory. Use this structure:
 
```markdown
# Security Audit Report: [Project Name]
 
**Date:** [date]
**Scope:** [files reviewed]
**Project type:** [e.g., Hytale proxy, game server, etc.]
 
## Executive Summary
 
[2-3 sentences: overall security posture, most critical findings count, recommendation priority]
 
## Critical Findings
 
[Issues that could lead to server crash, data breach, or remote exploitation]
 
### [CRITICAL-1] Title
- **File:** `path/to/File.java`, line(s) X-Y
- **Category:** [e.g., DoS & Resource Exhaustion]
- **Description:** What the issue is and why it matters
- **Attack scenario:** How an attacker would exploit this
- **Fix:**
```java
// Concrete code showing the fix
```
 
## High Severity Findings
 
[Issues that could degrade service or leak information]
 
### [HIGH-1] Title
[Same structure as Critical]
 
## Medium Severity Findings
 
[Code quality issues that increase bug risk]
 
### [MED-1] Title
[Same structure, attack scenario optional]
 
## Low Severity Findings
 
[Style issues, minor improvements]
 
### [LOW-1] Title
[Abbreviated structure]
 
## Summary Table
 
| ID | Severity | Category | File | Description |
|----|----------|----------|------|-------------|
 
## Recommendations
 
[Prioritized list of what to fix first and general architectural advice]
```
 
## Severity classification
 
- **CRITICAL**: Remotely exploitable, can crash server / corrupt data / gain unauthorized access. Fix immediately.
- **HIGH**: Can degrade service, leak sensitive information, or lead to undefined behavior under specific conditions. Fix before production.
- **MEDIUM**: Code quality issues that increase the probability of bugs or make future vulnerabilities more likely. Fix in normal development cycle.
- **LOW**: Style, best practices, minor improvements. Fix when convenient.
 
## Important principles
 
- Be thorough but not paranoid. False positives waste the developer's time.
- Every finding must include a concrete fix — ideally with a code snippet.
- For proxy/server projects, always prioritize DoS vectors and resource exhaustion above all else.
- Don't just list problems — explain *why* they matter with realistic attack scenarios for Critical/High findings.
- If the project uses Netty, pay special attention to ByteBuf lifecycle, pipeline handler ordering, and channel lifecycle.
- If the project handles Minecraft/Hytale-style protocols, check packet ID validation, VarInt/VarLong parsing (infinite loops on malformed data), and state machine transitions.
- Check for protocol-specific attacks: oversized packets, malformed handshakes, rapid connect/disconnect cycling, out-of-order packets.