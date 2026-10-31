---
name: Dependency advisory coverage
description: npm audit may omit a reviewed advisory that the project security scan reports.
---

Do not treat a clean npm audit as proof that every assigned dependency advisory is resolved.

**Why:** The reviewed braces stack-exhaustion advisory GHSA-vfj7-8cjw-p6xm was absent from npm audit even though the installed version was affected and the upstream advisory had no patched release.

**How to apply:** Check the upstream advisory's affected ranges and patched versions when a security finding does not appear in npm audit. Report unresolved findings explicitly; do not silently substitute a major build-tool migration for a dependency patch.

Do not replace an upstream package with a third-party fork. The owner reverted
the `@dieub/braces-depth-guard` alias to upstream `braces` (2026-10-31).

**Why:** A fork from an unvetted publisher is a supply-chain risk in every build,
and the advisory it addressed (GHSA-vfj7-8cjw-p6xm) was withdrawn on 2026-10-23.

**How to apply:** Check whether an advisory is withdrawn before acting on it.
When upstream has no patched release, report the finding and ask the owner;
prefer upstream packages, and use overrides only to select upstream versions.