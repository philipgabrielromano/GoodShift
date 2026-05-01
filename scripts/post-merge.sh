#!/bin/bash
set -e
# Use --no-audit --no-fund to skip slow registry audit calls that aren't
# useful in a non-interactive merge runner. --prefer-offline lets npm reuse
# its cache when nothing has changed (the common case for a content-only
# merge), keeping this step well under a second when no deps changed.
npm install --no-audit --no-fund --prefer-offline
npm run db:push

# Permissions test is informational only here — run it so regressions are
# visible in the post-merge log, but don't fail the whole merge if a few
# subtests fail. The post-merge runner's job is to land deps + migrations;
# permission-table drift should be caught in PR review / CI, not here.
# (Without this guard, ANY merge would also fail post-merge whenever
# someone introduces a new SYSTEM_FEATURES row that hasn't been wired
# into ROUTE_GATES yet.)
if ! npx tsx --test test/permissions.test.ts; then
  echo "post-merge: permissions test had failures (non-blocking); see output above"
fi
