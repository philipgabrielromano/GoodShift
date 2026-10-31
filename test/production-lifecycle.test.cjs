const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { mkdtempSync, readFileSync, rmSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const launcher = "scripts/start-production.sh";
const diagnostics = "./scripts/fatal-diagnostics.cjs";

for (const [label, code] of [
  ["uncaught exception", 'setImmediate(() => { throw new TypeError("fixture failure"); })'],
  ["unhandled rejection", 'Promise.reject(new Error("fixture rejection"))'],
  ["startup failure", 'require("./nonexistent-lifecycle-fixture.cjs")'],
]) {
  test(`${label} logs diagnostic before exiting nonzero`, () => {
    const result = spawnSync(process.execPath, [
      "--unhandled-rejections=strict", "--require", diagnostics, "-e", code,
    ], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr.split("\n")[0], /"event":"fatal_error"/);
    assert.match(result.stderr, /\[fatal_frame\]/);
  });
}

test("structured diagnostics omit messages and custom error properties", () => {
  const result = spawnSync(process.execPath, ["--require", diagnostics, "-e",
    'const e = new Error("private-message"); e.sql = "private-query"; throw e;',
  ], { encoding: "utf8", timeout: 5000 });
  // Native Node output still contains the exception message; check our added log.
  const structured = result.stderr.split("\n").filter(line =>
    line.startsWith('{"event"') || line.startsWith("[fatal_frame]")).join("\n");
  assert.doesNotMatch(structured, /private-message|private-query/);
});

for (const status of [0, 7]) {
  test(`launcher treats server exit ${status} as failure`, () => {
    const result = spawnSync("bash", [launcher, "bash", "-c", `exit ${status}`],
      { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, status || 1);
    assert.match(result.stdout, /stopping helpers/);
  });
}

for (const shutdown of ["crash", "SIGTERM"]) {
  test(`${shutdown} stops helper processes, including TERM-resistant helpers`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "goodshift-lifecycle-"));
    const pidFile = join(dir, "helper.pid");
    const processAlive = (pid) => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        return !/\) Z /.test(stat); // Exited orphan may await container init reaping.
      } catch { return false; }
    };
    const child = spawn("bash", [launcher, "bash", "-c",
      `(trap '' TERM; echo "$BASHPID" > "$1"; exec sleep 60) & wait_pid=$!; ` +
      (shutdown === "crash" ? "sleep 0.2; exit 9" : 'wait "$wait_pid"'),
      "fixture", pidFile], { stdio: "ignore" });
    const exit = once(child, "exit");
    let helper;
    try {
      for (let i = 0; i < 100; i++) {
        if (existsSync(pidFile)) helper = Number(readFileSync(pidFile, "utf8").trim());
        if (helper > 1) break;
        await delay(20);
      }
      assert.ok(helper > 1);
      if (shutdown === "SIGTERM") child.kill("SIGTERM");
      const [status] = await exit;
      assert.equal(status, shutdown === "crash" ? 9 : 143);
      for (let i = 0; i < 50 && processAlive(helper); i++) await delay(20);
      assert.equal(processAlive(helper), false);
    } finally {
      child.kill("SIGTERM");
      await exit;
      if (helper && processAlive(helper)) process.kill(helper, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
