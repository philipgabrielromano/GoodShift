---
name: Production crash diagnostics
description: Why production must fail closed on a fatal server error and keep crash logs compact.
---

Keep server bundles readable and emit compact fatal diagnostics before Node's native crash output. Do not swallow uncaught exceptions or blindly replay requests after a crash. The deployment launcher must terminate its VPN/proxy process group when the server exits.

**Why:** During an outage, minified bundled-source excerpts overwhelmed the available log output, hiding the actual exception. Helper processes remaining alive after server loss were a plausible contributor, not a confirmed root cause. An in-process catch-and-continue or automatic submission replay could leave state inconsistent or duplicate writes.

**How to apply:** Retain isolated lifecycle tests when changing deployment startup. New structured error logs should omit raw error objects, SQL, request data, and arbitrary messages. Native Node diagnostics still print their usual exception text. Treat a successful local lifecycle test as validation of safeguards, not proof that the original production defect is fixed.
