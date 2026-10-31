# Dependency denial-of-service fixes

The application and mockup sandbox use overrides for transitive build dependencies:

- `source-map-js` 1.2.2 or newer fixes GHSA-68fv-2mgg-jv7q.
- `postcss-selector-parser` 7.1.7 fixes GHSA-rj75-hqrm-r3gf (fixed upstream
  starting with 7.1.6). The override also covers Tailwind 3, its typography
  plugin, and postcss-nested; verify CSS generation when changing this override.
- `braces` is the upstream package (3.0.3). GHSA-vfj7-8cjw-p6xm, which had no
  patched release, was withdrawn on 2026-10-23, so the earlier alias to the
  third-party `@dieub/braces-depth-guard` fork was removed. Don't reintroduce
  forks of upstream packages without the owner's approval.

Do not remove the remaining overrides solely because `npm audit` is clean:
npm's advisory coverage may differ from the project's dependency scanner.

Run `npm run test:dependency-security` for lockfile checks and bounded-process
regressions against the actual dependency copies used by both projects. Also
run `npm run build` and the sandbox's build after changes to these overrides.
