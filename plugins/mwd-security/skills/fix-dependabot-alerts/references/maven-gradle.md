# Maven and Gradle

Dependabot files both under the `maven` ecosystem with the package as `groupId:artifactId`. The
`manifest_path` tells them apart: `pom.xml` is Maven; `build.gradle`, `build.gradle.kts`,
`gradle.lockfile` or `gradle/libs.versions.toml` is Gradle. The advisory check in SKILL.md Step 4 takes
the same name: `ecosystem=maven&affects=org.yaml:snakeyaml@1.33`.

Use the wrapper when the repo has one (`./mvnw`, `./gradlew`) — it pins the build tool version the
project expects. Both need network access to resolve, and the first run can take minutes; run it in
the background.

## Find the resolved version

```bash
# Maven — every path that brings the artifact in, per module
./mvnw -q dependency:tree -Dincludes=<groupId>:<artifactId>

# Gradle — the resolved version and why it won, per configuration
./gradlew -q dependencyInsight --dependency <groupId>:<artifactId> --configuration runtimeClasspath
```

In a multi-project Gradle build, run `dependencyInsight` per subproject (`:app:dependencyInsight`), and
check `testRuntimeClasspath` too when the alert's scope is `development`.

## Where the version is declared

Change a version where it is declared **in this repo**, never in a downloaded parent.

**Maven**, in the order to check:

1. A literal `<version>` on the `<dependency>` — edit it.
2. A `${property}` from `<properties>` — edit the property. Check what else uses it: a shared
   property such as `${jackson.version}` moves every Jackson module, which is usually right for a
   family of artifacts but belongs in the plan.
3. `<dependencyManagement>` in this pom or a parent pom in this repo — edit the entry there.
4. A BOM you import (`<scope>import</scope>`) or a `<parent>` you don't own, such as
   `spring-boot-starter-parent`:
   - **Parent bump:** a patch release of the parent or BOM that already ships the fix.
   - **Pin:** if the BOM exposes a version property, override it in `<properties>` (Spring Boot:
     `<tomcat.version>`, `<snakeyaml.version>`, …). Otherwise add the artifact to this pom's
     `<dependencyManagement>` with the patched version.

A **transitive** dependency is pinned the same way, through `<dependencyManagement>`. Maven resolves
by nearest-wins, not by highest version, so a managed version is the only reliable way to force one.

**Gradle:**

1. A version catalog (`gradle/libs.versions.toml`) — edit the `[versions]` entry.
2. A literal in the build file (`implementation("g:a:1.2.3")`) — edit it.
3. A platform (`implementation(platform("g:bom:1.0"))`) — bump the platform when its patch release
   ships the fix (parent bump).
4. **Pin** a transitive dependency with a constraint. Constraints take part in conflict resolution,
   so they raise the version without forcing a downgrade:

   ```kotlin
   dependencies {
       constraints {
           implementation("org.yaml:snakeyaml:2.2") {
               because("GHSA-xxxx-xxxx-xxxx")
           }
       }
   }
   ```

   If the build applies the Spring `io.spring.dependency-management` plugin, it overrides
   constraints. Set its version property instead: `extra["snakeyaml.version"] = "2.2"` (Kotlin DSL) or
   `ext['snakeyaml.version'] = '2.2'` (Groovy).

## Gradle lockfiles

If the repo has `gradle.lockfile` (or `*.lockfile` under `gradle/dependency-locks/`), refresh only the
upgraded artifacts:

```bash
./gradlew dependencies --update-locks <groupId>:<artifactId>
```

Maven has no lockfile — the `pom.xml` edit is the whole fix.

## Major upgrades

The same rules as npm apply: a new major is the user's call, with the breaking changes in the
question. Coordinate changes such as `javax.*` → `jakarta.*` are a migration, not an upgrade. Report
them and skip.

## Checks

`./mvnw -q verify` (compiles and runs the tests) and `./gradlew build` are the projects' standard
lifecycles, so they count as the project's own checks. When the project's docs or CI use a narrower
command, prefer that one.
