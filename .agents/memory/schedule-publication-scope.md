---
name: Schedule publication boundaries
description: Compatibility and authorization constraints for location-scoped publishing
---

Treat previously published whole weeks as published unless a location has an explicit exception. Never convert a location unpublish into deletion of the legacy whole-week publication.

**Why:** Existing weeks were published globally. Simply removing the manager admin-only gate would expose schedules across stores; replacing old markers without preserving visibility would unexpectedly hide already-published schedules.

**How to apply:** Preserve legacy visibility when evolving persistence, require concrete authorized scope for non-admin mutations, and check publication per employee location for viewers. Schedule clearing must change publication in the same scope and transaction as shift deletion. Production schema changes must go through Publish, not manual production edits.