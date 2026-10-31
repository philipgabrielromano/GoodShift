# Permission release check

Run `npm run validate:release` (or `npx tsx --test test/permissions.test.ts`).
Dependencies must already be installed, and PostgreSQL 16 tools (`initdb`,
`pg_ctl`, `createdb`) must be on PATH. Run as a non-root user. The project's
Replit PostgreSQL module supplies these tools.

Every invocation creates a private temporary PostgreSQL cluster, applies the
current Drizzle schema there, and removes the cluster on completion. It never
uses `DATABASE_URL`. MySQL is an empty read-only fixture, object-storage calls
are rejected, and outbound sockets are limited to the disposable database and
the in-process HTTP test server. No service credentials are required.

`npm run build` runs this check through `prebuild`; a failure stops the build
before any release bundle is produced. The existing deployment uses that
command. CI can run `npm ci` followed by `npm run validate:release` or
`npm run build` in an environment with the PostgreSQL tools installed.
Do not bypass the gate with `--ignore-scripts` or invoke `script/build.ts`
directly for releases.

`scripts/post-merge.sh` remains dependency/shared-schema setup only. It is not
a validation command. The schema push performed by the test fixture is solely
for its disposable test database, never the application's database.