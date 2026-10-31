# Dependency denial-of-service fixes

The application and mockup sandbox use overrides for transitive build dependencies:

- `source-map-js` 1.2.2 or newer fixes GHSA-68fv-2mgg-jv7q.
- `postcss-selector-parser` 7.1.7 fixes GHSA-rj75-hqrm-r3gf (fixed upstream
  starting with 7.1.6). The override also covers Tailwind 3, its typography
  plugin, and postcss-nested; verify CSS generation when changing this override.
- GHSA-vfj7-8cjw-p6xm has no patched upstream `braces` release. Both projects
  alias it to the exact `@dieub/braces-depth-guard@3.0.3-pn.3` release.
  Its published JavaScript was compared with braces 3.0.3: it retains the API
  and adds bounded nesting to the parser and recursive AST walkers, validates
  limits, and rejects parent cycles in expansion. The package has the same
  `fill-range` dependency and no install lifecycle scripts.

The fork is a temporary security replacement, not an upstream patched version.
Reassess it when upstream publishes a fix. Do not remove the overrides solely
because `npm audit` is clean: npm's advisory coverage may differ from the
project's dependency scanner.

Run `npm run test:dependency-security` for lockfile checks and bounded-process
regressions against the actual dependency copies used by both projects. Also
run `npm run build` and the sandbox's build after changes to these overrides.
