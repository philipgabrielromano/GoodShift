import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const rootRequire = createRequire(new URL("../package.json", import.meta.url));
const sandboxRequire = createRequire(new URL("../artifacts/mockup-sandbox/package.json", import.meta.url));

// All five advisories below affect Vite 7.0.0 through 7.3.6 and are
// patched in 7.3.7. Check the artifact as well as the main application.
const viteAdvisories = [
  "GHSA-587h-7wmj-h5pm",
  "GHSA-698v-4r3x-3vcv",
  "GHSA-r825-w8mm-5pxw",
  "GHSA-rq7h-c2jc-7f22",
  "GHSA-9jrq-w75r-8gcw",
];

test("both projects require and lock Vite with all five security fixes", () => {
  for (const relative of ["../", "../artifacts/mockup-sandbox/"]) {
    const manifest = JSON.parse(readFileSync(new URL(`${relative}package.json`, import.meta.url), "utf8"));
    const lock = JSON.parse(readFileSync(new URL(`${relative}package-lock.json`, import.meta.url), "utf8"));
    assert.equal(manifest.devDependencies.vite, "^7.3.7", relative);
    assert.equal(lock.packages[""].devDependencies.vite, manifest.devDependencies.vite, relative);
    const viteEntries = Object.entries(lock.packages).filter(([path]) => path.endsWith("/node_modules/vite") || path === "node_modules/vite");
    assert.ok(viteEntries.length > 0, `${relative}: Vite must be present`);
    for (const [path, entry] of viteEntries as [string, any][]) {
      // Stay on the verified compatible major; a major upgrade needs its own review.
      assert.match(entry.version, /^7\.\d+\.\d+$/);
      const [, minor, patch] = entry.version.split(".").map(Number);
      assert.ok(minor > 3 || (minor === 3 && patch >= 7),
        `${relative}${path}@${entry.version} is affected by ${viteAdvisories.join(", ")}`);
    }
  }
});

// Use isolated processes: a regressed parser must fail the test, not hang or
// exhaust the stack of the test runner. Resolve the copies consumers actually use.
function runBounded(code: string) {
  const result = spawnSync(process.execPath, ["-e", code], {
    timeout: 5000,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
}

test("both lockfiles exclude the three affected dependency versions", () => {
  for (const relative of ["../package-lock.json", "../artifacts/mockup-sandbox/package-lock.json"]) {
    const lock = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
    for (const [path, entry] of Object.entries(lock.packages) as [string, any][]) {
      if (path.endsWith("/source-map-js")) {
        const [major, minor, patch] = entry.version.split(".").map(Number);
        assert.ok(major > 1 || (major === 1 && (minor > 2 || (minor === 2 && patch >= 2))), path);
      }
      if (path.endsWith("/postcss-selector-parser")) {
        const [major, minor, patch] = entry.version.split(".").map(Number);
        assert.ok(major > 7 || (major === 7 && (minor > 1 || (minor === 1 && patch >= 6))), path);
      }
      if (path.endsWith("/braces")) {
        assert.equal(entry.name, "@dieub/braces-depth-guard", path);
        assert.equal(entry.version, "3.0.3-pn.3", path);
      }
    }
  }
});

for (const [name, require] of [["application", rootRequire], ["sandbox", sandboxRequire]] as const) {
  const parents = name === "application" ? ["micromatch", "chokidar"] : ["micromatch"];
  for (const parent of parents) {
    const bracesPath = createRequire(require.resolve(parent)).resolve("braces");
    test(`${name}/${parent}: brace parsing and AST walkers reject excessive nesting`, () => {
      runBounded(`
        const assert = require("node:assert/strict");
        const braces = require(${JSON.stringify(bracesPath)});
        assert.deepEqual(braces.expand("src/{pages,components}/*.{ts,tsx}"), [
          "src/pages/*.ts", "src/pages/*.tsx",
          "src/components/*.ts", "src/components/*.tsx"
        ]);
        assert.deepEqual(braces.expand("{1..3}"), ["1", "2", "3"]);
        assert.deepEqual(braces.expand("a/{b,{c,d}}/e"), ["a/b/e", "a/c/e", "a/d/e"]);
        assert.equal(braces.stringify(braces.parse("a/{b,c}/d")), "a/{b,c}/d");
        for (const [open, close] of [["{", "}"], ["(", ")"], ["{(", ")}"]]) {
          const input = open.repeat(2000) + "a,b" + close.repeat(2000);
          for (const method of ["parse", "compile", "expand", "stringify"]) {
            assert.throws(() => braces[method](input), /exceeds max depth/);
          }
          assert.throws(() => braces(input), /exceeds max depth/);
          assert.throws(() => braces.parse(input, {maxDepth: Infinity}), /exceeds max depth/);
        }
        for (const method of ["compile", "expand", "stringify"]) {
          let ast = {type: "text", value: "x"};
          for (let i = 0; i < 2000; i++) ast = {type: "paren", nodes: [ast]};
          ast = {type: "root", nodes: [ast]};
          assert.throws(() => braces[method](ast), /exceeds max depth/);
        }
      `);
    });
  }

  test(`${name}: indexed source maps reject excessive section offsets`, () => {
    for (const parent of ["postcss", "@tailwindcss/node"]) {
      const sourceMapPath = createRequire(require.resolve(parent)).resolve("source-map-js");
      runBounded(`
        const assert = require("node:assert/strict");
        const {SourceMapConsumer} = require(${JSON.stringify(sourceMapPath)});
        const basic = {version: 3, sources: ["input.js"], names: [], mappings: "AAAA"};
        for (const line of [Number.MAX_SAFE_INTEGER, Infinity, -1, 0.5]) {
          assert.throws(() => new SourceMapConsumer({
            version: 3, sections: [{offset: {line, column: 0}, map: basic}]
          }), /offset/i);
        }
        const consumer = new SourceMapConsumer({
          version: 3, sections: [{offset: {line: 1, column: 0}, map: basic}]
        });
        const mappings = [];
        consumer.eachMapping(mapping => mappings.push(mapping));
        assert.equal(mappings[0].source, "input.js");
        assert.equal(mappings[0].generatedLine, 2);
        assert.equal(mappings[0].originalLine, 1);
      `);
    }
  });
}

test("selector parser handles a large flat selector without quadratic work", () => {
  const parserPath = createRequire(rootRequire.resolve("tailwindcss")).resolve("postcss-selector-parser");
  runBounded(`
    const assert = require("node:assert/strict");
    const parser = require(${JSON.stringify(parserPath)});
    const selector = ".a".repeat(200000);
    assert.equal(parser().processSync(selector), selector);
    const ordinary = ':is(.a, #b) > [data-state="open"]::before';
    assert.equal(parser().processSync(ordinary), ordinary);
  `);
});
