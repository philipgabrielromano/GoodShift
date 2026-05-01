#!/bin/bash
set -e
# Use --no-audit --no-fund to skip slow registry audit calls that aren't
# useful in a non-interactive merge runner. --prefer-offline lets npm reuse
# its cache when nothing has changed (the common case for a content-only
# merge), keeping this step well under a second when no deps changed.
npm install --no-audit --no-fund --prefer-offline
npm run db:push
npx tsx --test test/permissions.test.ts
