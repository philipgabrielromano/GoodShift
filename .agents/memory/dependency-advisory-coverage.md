---
name: Dependency advisory coverage
description: npm audit may omit a reviewed advisory that the project security scan reports.
---

Do not treat a clean npm audit as proof that every assigned dependency advisory is resolved.

**Why:** The reviewed braces stack-exhaustion advisory GHSA-vfj7-8cjw-p6xm was absent from npm audit even though the installed version was affected and the upstream advisory had no patched release.

**How to apply:** Check the upstream advisory's affected ranges and patched versions when a security finding does not appear in npm audit. Report unresolved findings explicitly; do not silently substitute a major build-tool migration for a dependency patch.

When upstream has no patched release, a minimal API-compatible security fork is
preferred over migrating the styling toolchain solely to remove a transitive
dependency.

**Why:** A toolchain migration can change generated CSS across the entire app;
a bounded-nesting fix addresses the specific denial of service without that scope.

**How to apply:** Inspect the fork's changes and lifecycle scripts, pin its exact
release, test malicious inputs and ordinary patterns through real consumer
resolution, and revisit the replacement when upstream publishes a fix.