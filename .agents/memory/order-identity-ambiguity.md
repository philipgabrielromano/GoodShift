---
name: Order identity ambiguity
description: Security tradeoff for legacy orders identified only by display names
---

When multiple locations resolve to the same order display identity, deny scoped access to that identity. Do not automatically assign historical orders to one of the stores or silently rename them.

**Why:** Historical orders do not contain enough information to distinguish stores sharing an alias. Guessing ownership would preserve or introduce cross-store disclosure. This hardening intentionally prioritizes isolation over access to ambiguous records.

**How to apply:** Preserve denial for legacy collisions when evolving order authorization. Any future repair of ambiguous historical ownership needs explicit business input or reliable source data. Prevent new effective alias/name collisions atomically, and avoid database collation widening exact authorized identities.

Apply exact identity matching before SQL aggregation and exact grouping as well.

**Why:** MySQL's accent-insensitive collation can merge names such as Cafe and Café even when JavaScript treats them as different identities. Filtering aggregate results afterward cannot separate totals already combined across stores.

**How to apply:** Check both predicates and grouping whenever a query returns per-store totals, including global views. Test collation-equivalent names as distinct stores.