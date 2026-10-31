---
name: Permission test isolation
description: Why permission checks must provision their own storage rather than restore shared rows
---

Permission tests must be safe when invoked directly, not only through CI wrappers.
Never replace their private database with a shared database plus saved/restored
permission snapshots or an assumed-missing record ID.

**Why:** Grant/revoke tests rewrite entire role arrays. Restoring a snapshot can
erase concurrent real permission edits, and a supposedly unused ID can later
belong to a real record. A wrapper-only safety flag leaves direct test invocation unsafe.

**How to apply:** Keep isolation established before importing application storage
or routes, and fail closed for external dependencies instead of falling back to
configured services.