#!/bin/bash
set -e
npm install
npm run db:push
npx tsx --test test/permissions.test.ts
