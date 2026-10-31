/**
 * External-service bootstrap for permission tests.
 *
 * This module is intentionally side-effectful. Import it before importing any
 * route module:
 *
 *   import "./helpers/external-fixtures";
 *
 * ES module dependencies are evaluated before the importing test module, so
 * installing the fixtures here prevents server/mysql.ts, object storage, or
 * UKG code from opening a real external connection during module evaluation.
 * `setupExternalFixtures` is exported as well for tests that prefer an
 * explicit bootstrap call; repeated calls return the same handle.
 */

import mysql from "mysql2/promise";
import type {
  FieldPacket,
  Pool,
  PoolConnection,
  QueryOptions,
} from "mysql2/promise";
import net from "node:net";
import { ObjectStorageService } from "../../server/replit_integrations/object_storage/objectStorage";

const TEST_POOL_SYMBOL = Symbol.for("goodshift.external-fixtures.mysql-pool");
const TEST_FIXTURE_ENV = "GOODSHIFT_EXTERNAL_FIXTURES";
const PERMISSION_DATABASE_SYMBOL = Symbol.for("goodshift.permission-test.database");

type TestServerTarget = {
  origin: string;
  hostname: string;
  port: number;
};

let testServerTarget: TestServerTarget | undefined;

type SqlInput = string | QueryOptions;

export interface ExternalFixtureHandle {
  /** The isolated pool installed for the test process. */
  mysqlPool: Pool;
  /** Restore the original external clients. */
  restore(): void;
}

let activeHandle: ExternalFixtureHandle | undefined;

function unexpected(service: string, operation: string, detail?: string): Error {
  const suffix = detail ? ` (${detail})` : "";
  return new Error(`[external-fixtures] Unexpected ${service} operation: ${operation}${suffix}`);
}

function sqlText(input: SqlInput): string {
  return typeof input === "string" ? input : input.sql;
}

function compactSql(input: SqlInput): string {
  return sqlText(input).replace(/\s+/g, " ").trim().slice(0, 180);
}

/**
 * The permission suite only needs an empty read model. A SELECT is therefore
 * a valid fixture operation and returns no rows. DDL and writes are rejected
 * loudly so a newly-added route cannot accidentally hide a dependency on an
 * external MySQL instance.
 */
async function readOnlyQuery(input: SqlInput): Promise<[unknown, FieldPacket[]]> {
  const sql = sqlText(input);
  const normalized = sql.replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)*/, "").trim();

  if (/^(?:SELECT|WITH)\b/i.test(normalized)) {
    // COUNT(*) is the one aggregate for which returning an explicit zero is
    // more useful than an empty row set. All other reads are an empty table.
    if (/\bCOUNT\s*\(/i.test(normalized)) {
      return [[{ total: 0 }], []];
    }
    return [[], []];
  }

  if (/^(?:SHOW|DESCRIBE|EXPLAIN)\b/i.test(normalized)) {
    return [[], []];
  }

  throw unexpected("MySQL", "write or DDL query", compactSql(input));
}

function createEmptyMySqlPool(): Pool {
  const execute = async (input: SqlInput): Promise<[unknown, FieldPacket[]]> =>
    readOnlyQuery(input);
  const query = async (input: SqlInput): Promise<[unknown, FieldPacket[]]> =>
    readOnlyQuery(input);

  const connection = {
    execute,
    query,
    // Transaction methods are local no-ops. Any attempted write still fails
    // in execute/query before a route can observe a fake commit.
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => undefined,
  } as unknown as PoolConnection;

  const pool = {
    execute,
    query,
    getConnection: async () => connection,
    releaseConnection: () => undefined,
    end: async () => undefined,
  } as unknown as Pool;

  return pool;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

/**
 * Register the exact origin used by the in-process Express test server.
 *
 * The socket and fetch guards intentionally do not allow arbitrary loopback
 * addresses. Permission tests call this after `app.listen()` and before their
 * first request.
 */
export function allowTestServer(baseUrl: string): void {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("[external-fixtures] Test-server access requires node --test");
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`[external-fixtures] Invalid test-server URL: ${baseUrl}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !isLoopbackHostname(url.hostname) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`[external-fixtures] Test-server URL must be a loopback origin: ${baseUrl}`);
  }

  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[external-fixtures] Invalid test-server port: ${baseUrl}`);
  }
  testServerTarget = {
    origin: url.origin,
    hostname: normalizeHostname(url.hostname),
    port,
  };
}

function getFetchUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

/**
 * Keep only the registered test server reachable. This is deliberately
 * origin-exact: arbitrary loopback ports (including the Replit object-storage
 * sidecar on port 1106) are denied.
 */
function installFetchGuard(): () => void {
  const originalFetch = globalThis.fetch;
  const guardedFetch: typeof fetch = async (input, init) => {
    let url: URL;
    try {
      url = getFetchUrl(input);
    } catch {
      throw unexpected("network", "fetch", "invalid URL");
    }

    if (!testServerTarget || url.origin !== testServerTarget.origin) {
      throw unexpected("network", "fetch", url.origin);
    }

    if (typeof originalFetch !== "function") {
      throw unexpected("network", "fetch", "fetch is unavailable");
    }
    return originalFetch(input, init);
  };

  globalThis.fetch = guardedFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function permissionDatabaseSocketPath(): string | undefined {
  const config = (globalThis as unknown as Record<symbol, unknown>)[
    PERMISSION_DATABASE_SYMBOL
  ];
  if (!config || typeof config !== "object") return undefined;
  const host = (config as { host?: unknown }).host;
  if (typeof host !== "string" || host.length === 0) return undefined;
  return `${host.replace(/\/+$/, "")}/.s.PGSQL.5432`;
}

function socketTarget(args: unknown[]): {
  kind: "unix";
  path: string;
} | {
  kind: "tcp";
  host: string;
  port: number;
} | undefined {
  const first = args[0];
  // net.connect() passes its already-normalized [options, callback] tuple
  // into Socket.connect(), including undici's HTTP connections.
  if (Array.isArray(first)) return socketTarget(first);
  if (typeof first === "string") {
    return { kind: "unix", path: first };
  }
  if (typeof first === "number") {
    const host = typeof args[1] === "string" ? args[1] : "localhost";
    return { kind: "tcp", host, port: first };
  }
  if (first && typeof first === "object") {
    const options = first as {
      path?: unknown;
      host?: unknown;
      hostname?: unknown;
      port?: unknown;
    };
    if (typeof options.path === "string") {
      return { kind: "unix", path: options.path };
    }
    if (typeof options.port === "number" || typeof options.port === "string") {
      const port = Number(options.port);
      if (!Number.isInteger(port)) return undefined;
      const rawHost = options.host ?? options.hostname;
      return {
        kind: "tcp",
        host: typeof rawHost === "string" ? rawHost : "localhost",
        port,
      };
    }
  }
  return undefined;
}

/**
 * Guard the lowest common TCP path so direct HTTPS, HTTP, mysql2, and other
 * clients cannot bypass the fetch/ObjectStorage fixtures. The only exceptions
 * are the exact registered test-server endpoint and the disposable
 * PostgreSQL Unix socket provisioned by permission-database.ts.
 */
function installSocketGuard(): () => void {
  const socketPrototype = net.Socket.prototype as unknown as {
    connect: (...args: any[]) => net.Socket;
  };
  const originalConnect = socketPrototype.connect;
  socketPrototype.connect = function guardedSocketConnect(...args: any[]): net.Socket {
    const target = socketTarget(args);
    const permissionSocket = permissionDatabaseSocketPath();
    const allowedUnix =
      target?.kind === "unix" &&
      permissionSocket !== undefined &&
      target.path === permissionSocket;
    const allowedTcp =
      target?.kind === "tcp" &&
      testServerTarget !== undefined &&
      normalizeHostname(target.host) === testServerTarget.hostname &&
      target.port === testServerTarget.port;

    if (!allowedUnix && !allowedTcp) {
      const detail =
        target?.kind === "unix"
          ? `unix:${target.path}`
          : target?.kind === "tcp"
          ? `tcp:${target.host}:${target.port}`
          : "unknown socket target";
      throw unexpected("network", "net.Socket.connect", detail);
    }
    return originalConnect.apply(this, args);
  };

  return () => {
    socketPrototype.connect = originalConnect;
  };
}

const OBJECT_STORAGE_EXTERNAL_METHODS = [
  "getPublicObjectSearchPaths",
  "getPrivateObjectDir",
  "searchPublicObject",
  "downloadObject",
  "getObjectEntityUploadURL",
  "uploadObject",
  "getObjectEntityFile",
  "trySetObjectEntityAclPolicy",
  "canAccessObjectEntity",
  "canAccessObjectEntityOrFallback",
  "cleanupOrphanedUploads",
  "trySetObjectAclSilent",
] as const;

type ObjectStorageMethod = (this: ObjectStorageService, ...args: any[]) => any;

function installObjectStorageGuard(): () => void {
  const prototype = ObjectStorageService.prototype as unknown as Record<
    string,
    ObjectStorageMethod
  >;
  const originals = new Map<string, ObjectStorageMethod>();

  for (const methodName of OBJECT_STORAGE_EXTERNAL_METHODS) {
    const original = prototype[methodName];
    if (typeof original !== "function") continue;
    originals.set(methodName, original);
    prototype[methodName] = function guardedObjectStorageOperation() {
      throw unexpected("object storage", methodName);
    };
  }

  return () => {
    for (const [methodName, original] of originals) {
      prototype[methodName] = original;
    }
  };
}

/**
 * Install isolated external-service fixtures.
 *
 * The function is idempotent so a test can both side-effect-import this
 * module and call setupExternalFixtures explicitly without double-patching
 * prototypes or losing the original clients.
 */
export function setupExternalFixtures(): ExternalFixtureHandle {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("[external-fixtures] External fixtures may only run under node --test");
  }
  if (activeHandle) return activeHandle;

  const previousTestServerTarget = testServerTarget;
  const previousFixtureEnv = process.env[TEST_FIXTURE_ENV];
  process.env[TEST_FIXTURE_ENV] = "1";

  const fixturePool = createEmptyMySqlPool();
  (globalThis as unknown as Record<symbol, unknown>)[TEST_POOL_SYMBOL] = fixturePool;

  // Keep mysql2 itself patched as a second line of defence. The server/mysql
  // module consumes the global pool above, while this patch also protects any
  // test-only module that calls mysql.createPool directly.
  const mysqlApi = mysql as unknown as {
    createPool: (...args: any[]) => Pool;
  };
  const originalCreatePool = mysqlApi.createPool;
  mysqlApi.createPool = () => fixturePool;

  const restoreSocket = installSocketGuard();
  const restoreFetch = installFetchGuard();
  const restoreObjectStorage = installObjectStorageGuard();
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    restoreObjectStorage();
    restoreFetch();
    restoreSocket();
    mysqlApi.createPool = originalCreatePool;
    const globals = globalThis as unknown as Record<symbol, unknown>;
    if (globals[TEST_POOL_SYMBOL] === fixturePool) {
      delete globals[TEST_POOL_SYMBOL];
    }
    if (previousFixtureEnv === undefined) {
      delete process.env[TEST_FIXTURE_ENV];
    } else {
      process.env[TEST_FIXTURE_ENV] = previousFixtureEnv;
    }
    if (activeHandle?.mysqlPool === fixturePool) activeHandle = undefined;
    testServerTarget = previousTestServerTarget;
  };

  activeHandle = { mysqlPool: fixturePool, restore };
  return activeHandle;
}

// This must remain at module scope: calling setup from the importing test's
// body would be too late for static route imports to observe the patch.
setupExternalFixtures();
