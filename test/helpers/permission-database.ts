import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PoolConfig } from "pg";

// Always provision a private cluster, even when DATABASE_URL is present.
// No caller-supplied database URL is ever used by this suite.
if (!process.env.NODE_TEST_CONTEXT) {
  throw new Error("Permission database fixtures may only run under node --test");
}

const directory = mkdtempSync(join(tmpdir(), "permission-db-"));
const data = join(directory, "data");
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: "C.UTF-8",
};
let started = false;
let cleaned = false;

export function cleanupPermissionDatabase(): void {
  if (cleaned) return;
  if (started) {
    execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
      env, stdio: "ignore", timeout: 30_000,
    });
  }
  rmSync(directory, { recursive: true, force: true });
  cleaned = true;
}

process.once("exit", cleanupPermissionDatabase);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    cleanupPermissionDatabase();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  execFileSync("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "--no-locale"], {
    env, stdio: "pipe", timeout: 30_000,
  });
  // Unix socket only, inside a randomly named mode-0700 temporary directory.
  execFileSync("pg_ctl", [
    "-D", data, "-l", join(directory, "postgres.log"),
    "-o", `-F -k ${directory} -c listen_addresses=''`, "-w", "start",
  ], { env, stdio: "pipe", timeout: 30_000 });
  started = true;
  execFileSync("createdb", ["-h", directory, "-U", "postgres", "permissions_test"], {
    env, stdio: "pipe", timeout: 30_000,
  });
  const url = `postgresql://postgres@localhost/permissions_test?host=${encodeURIComponent(directory)}`;
  execFileSync("node_modules/.bin/drizzle-kit", ["push", "--force"], {
    env: { ...env, DATABASE_URL: url }, stdio: "pipe", timeout: 60_000,
  });
  const config: PoolConfig = {
    host: directory, port: 5432, user: "postgres", password: "",
    database: "permissions_test", ssl: false,
  };
  (globalThis as Record<symbol, unknown>)[Symbol.for("goodshift.permission-test.database")] = config;
} catch (error) {
  cleanupPermissionDatabase();
  throw error;
}