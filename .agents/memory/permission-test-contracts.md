---
name: Permission test contracts
description: Validate form dependencies when reconciling stale permission tests with current routes.
---

Do not assume a current route's permission list is the intended policy just because tests have drifted.

**Why:** A permission-suite repair initially accepted a route list that excluded manifest users even though their form needed it; fixing detail access alone left the workflow broken.

**How to apply:** When updating permission expectations, inspect the consuming form's lookup requests as well as its save endpoint. Test each supported custom-role grant independently across those dependencies.

When tightening a shared update schema, check every caller of its mutation hook, including nested settings cards, not just the main settings page.

**Why:** Handcrafted writable-only API tests missed fetched-row payloads in both the main form and a separate branding card; strict validation rejected their read-only fields.

**How to apply:** Search hook consumers and test their actual payload shapes, persistence, and preservation of unrelated fields before concluding that a stricter schema is compatible.