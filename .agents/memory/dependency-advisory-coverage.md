---
name: Dependency advisory coverage
description: npm audit may omit a reviewed advisory that the project security scan reports.
---

Do not treat a clean npm audit as proof that every assigned dependency advisory is resolved.

**Why:** The reviewed braces stack-exhaustion advisory GHSA-vfj7-8cjw-p6xm was absent from npm audit even though the installed version was affected and the upstream advisory had no patched release.

**How to apply:** Check the upstream advisory's affected ranges and patched versions when a security finding does not appear in npm audit. Report unresolved findings explicitly; do not silently substitute a major build-tool migration for a dependency patch.