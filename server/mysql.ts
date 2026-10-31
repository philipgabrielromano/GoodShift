import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { ORDER_RECONCILABLE_COLUMNS, SEASONAL_CONFIRMABLE_COLUMNS } from "@shared/schema";

const LOCAL_PROXY_PORT = 13306;
const TEST_POOL_SYMBOL = Symbol.for("goodshift.external-fixtures.mysql-pool");
const TEST_FIXTURE_ENV = "GOODSHIFT_EXTERNAL_FIXTURES";
const NODE_TEST_CONTEXT_ENV = "NODE_TEST_CONTEXT";

/**
 * Permission tests install an isolated pool before importing any route module.
 *
 * Keeping the injection point here (rather than replacing mysql2 throughout
 * the application) means the production path remains exactly the same while
 * tests can guarantee that a route can never open a real MySQL connection.
 * The test helper deliberately owns the fixture implementation; this module
 * only consumes the already-installed pool.
 */
function getInstalledTestPool(): Pool | undefined {
  const candidate = (globalThis as unknown as Record<symbol, unknown>)[TEST_POOL_SYMBOL];
  const fixtureRequested =
    process.env[TEST_FIXTURE_ENV] === "1" || candidate !== undefined;
  if (!fixtureRequested) return undefined;
  if (!process.env[NODE_TEST_CONTEXT_ENV]) {
    throw new Error("[MySQL] External fixtures require node --test");
  }
  const validPool =
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { execute?: unknown }).execute === "function" &&
    typeof (candidate as { query?: unknown }).query === "function" &&
    typeof (candidate as { getConnection?: unknown }).getConnection === "function" &&
    typeof (candidate as { end?: unknown }).end === "function";
  if (validPool) {
    return candidate as Pool;
  }
  throw new Error("[MySQL] Fixture mode requested without a valid isolated pool");
}

const useTailscale = !!process.env.TAILSCALE_AUTH_KEY;
const mysqlHost = useTailscale ? "127.0.0.1" : process.env.MYSQL_HOST;
const mysqlPort = useTailscale ? LOCAL_PROXY_PORT : (Number(process.env.MYSQL_PORT) || 3306);

const testPool = getInstalledTestPool();
// Created on first use: with maxIdle below connectionLimit, mysql2 starts an
// idle-reaper timer as soon as the pool exists, which would keep any process
// that merely imports this module (tests, scripts) from exiting.
let realPool: mysql.Pool | undefined;
function getPool(): mysql.Pool {
  return testPool ?? (realPool ??= createRealPool());
}

const createRealPool = () => mysql.createPool({
  host: mysqlHost,
  port: mysqlPort,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  // Keep few idle connections and drop them after a minute, so connections
  // that sat idle through the tunnel are replaced rather than reused.
  maxIdle: 2,
  idleTimeout: 60_000,
  // Bounded wait queue: when MySQL is unreachable, requests fail fast (503)
  // instead of piling up behind hung connections.
  queueLimit: 50,
  enableKeepAlive: true,
  ssl: useTailscale ? undefined : { rejectUnauthorized: true },
  connectTimeout: 10000,
});

// ---- Timeouts and self-healing ----
//
// Through the Tailscale tunnel the client socket goes to socat on
// 127.0.0.1, which stays healthy even when the far side is dead, so TCP
// keepalive never notices a half-open tunnel. The per-query timeout below is
// what does: a query that gets no answer fails, and its connection is
// destroyed (mysql2 leaves a timed-out connection mid-command, so it must
// never go back to the pool). Do not remove the timeout.
const QUERY_TIMEOUT_MS = 25_000;
const ACQUIRE_TIMEOUT_MS = 15_000;

// The connection itself is unusable after these.
const BROKEN_CONNECTION_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
]);
// Safe to retry once on a fresh connection: the connection dropped, so the
// statement may not have reached MySQL. Not timeouts (that would double the wait).
const RETRYABLE_CODES = new Set(["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE"]);

function withQueryTimeout(sql: unknown): unknown {
  if (typeof sql === "string") return { sql, timeout: QUERY_TIMEOUT_MS };
  if (sql && typeof sql === "object" && (sql as any).timeout === undefined) {
    return { ...(sql as object), timeout: QUERY_TIMEOUT_MS };
  }
  return sql;
}

// Patches a checked-out connection so every statement has a timeout and a
// broken connection is destroyed instead of being returned to the pool.
// release() after destroy() is a no-op, so callers' cleanup stays correct.
function guardConnection(conn: mysql.PoolConnection): mysql.PoolConnection {
  for (const method of ["query", "execute"] as const) {
    const original = (conn as any)[method].bind(conn);
    (conn as any)[method] = (sql: unknown, ...rest: unknown[]) =>
      original(withQueryTimeout(sql), ...rest).catch((err: any) => {
        if (BROKEN_CONNECTION_CODES.has(err?.code) || err?.fatal === true) conn.destroy();
        throw err;
      });
  }
  return conn;
}

async function acquireConnection(): Promise<mysql.PoolConnection> {
  const pending = getPool().getConnection();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error("Timed out waiting for a MySQL connection"), { code: "MYSQL_ACQUIRE_TIMEOUT" }));
    }, ACQUIRE_TIMEOUT_MS);
  });
  try {
    return guardConnection(await Promise.race([pending, timeout]));
  } catch (err: any) {
    // If the timeout won, hand the connection back whenever it does arrive.
    pending.then(c => c.release(), () => {});
    if (err?.message === "Queue limit reached.") err.code = "MYSQL_QUEUE_FULL";
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function runOnPool(method: "query" | "execute", args: unknown[]): Promise<any> {
  const attempt = async () => {
    const conn = await acquireConnection();
    try {
      return await (conn as any)[method](...args);
    } finally {
      conn.release();
    }
  };
  try {
    return await attempt();
  } catch (err: any) {
    const sqlText = typeof args[0] === "string" ? args[0] : (args[0] as any)?.sql;
    const isRead = typeof sqlText === "string" && /^\s*(SELECT|SHOW)\b/i.test(sqlText);
    if (isRead && RETRYABLE_CODES.has(err?.code)) {
      console.warn(`[MySQL] ${err.code} on a read; retrying once on a fresh connection`);
      return attempt();
    }
    throw err;
  }
}

// What the rest of the app uses. Same call shapes as the mysql2 promise pool
// (so typed calls like execute<OrderRow[]>() still check), with the timeouts
// and recovery above.
const guardedPool = {
  query: (...args: unknown[]) => runOnPool("query", args),
  execute: (...args: unknown[]) => runOnPool("execute", args),
  getConnection: acquireConnection,
  end: () => (testPool ?? realPool)?.end() ?? Promise.resolve(),
} as unknown as mysql.Pool;

export async function initOrdersTable(): Promise<void> {
  const conn = await getPool().getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_date DATE NOT NULL,
        order_type VARCHAR(50) NOT NULL,
        location VARCHAR(100) NOT NULL,
        totes_requested INT DEFAULT NULL,
        totes_returned INT DEFAULT NULL,
        duros_requested INT DEFAULT NULL,
        duros_returned INT DEFAULT NULL,
        blue_bins_requested INT DEFAULT NULL,
        blue_bins_returned INT DEFAULT NULL,
        gaylords_requested INT DEFAULT NULL,
        gaylords_returned INT DEFAULT NULL,
        pallets_requested INT DEFAULT NULL,
        pallets_returned INT DEFAULT NULL,
        containers_requested INT DEFAULT NULL,
        containers_returned INT DEFAULT NULL,
        apparel_gaylords_requested INT DEFAULT NULL,
        apparel_gaylords_returned INT DEFAULT NULL,
        wares_gaylords_requested INT DEFAULT NULL,
        wares_gaylords_returned INT DEFAULT NULL,
        electrical_gaylords_requested INT DEFAULT NULL,
        electrical_gaylords_returned INT DEFAULT NULL,
        accessories_gaylords_requested INT DEFAULT NULL,
        accessories_gaylords_returned INT DEFAULT NULL,
        books_gaylords_requested INT DEFAULT NULL,
        books_gaylords_returned INT DEFAULT NULL,
        shoes_gaylords_requested INT DEFAULT NULL,
        shoes_gaylords_returned INT DEFAULT NULL,
        furniture_gaylords_requested INT DEFAULT NULL,
        furniture_gaylords_returned INT DEFAULT NULL,
        saved_winter_requested INT DEFAULT NULL,
        saved_winter_returned INT DEFAULT NULL,
        saved_summer_requested INT DEFAULT NULL,
        saved_summer_returned INT DEFAULT NULL,
        saved_halloween_requested INT DEFAULT NULL,
        saved_halloween_returned INT DEFAULT NULL,
        saved_christmas_requested INT DEFAULT NULL,
        saved_christmas_returned INT DEFAULT NULL,
        full_totes INT DEFAULT NULL,
        empty_totes INT DEFAULT NULL,
        full_gaylords INT DEFAULT NULL,
        empty_gaylords INT DEFAULT NULL,
        full_duros INT DEFAULT NULL,
        empty_duros INT DEFAULT NULL,
        full_containers INT DEFAULT NULL,
        empty_containers INT DEFAULT NULL,
        full_blue_bins INT DEFAULT NULL,
        empty_blue_bins INT DEFAULT NULL,
        empty_pallets INT DEFAULT NULL,
        outlet_apparel INT DEFAULT NULL,
        outlet_shoes INT DEFAULT NULL,
        outlet_metal INT DEFAULT NULL,
        outlet_wares INT DEFAULT NULL,
        outlet_accessories INT DEFAULT NULL,
        outlet_electrical INT DEFAULT NULL,
        ecom_containers_sent INT DEFAULT NULL,
        rotated_apparel INT DEFAULT NULL,
        rotated_shoes INT DEFAULT NULL,
        rotated_books INT DEFAULT NULL,
        rotated_wares INT DEFAULT NULL,
        apparel_gaylords_used INT DEFAULT NULL,
        wares_gaylords_used INT DEFAULT NULL,
        book_gaylords_used INT DEFAULT NULL,
        shoe_gaylords_used INT DEFAULT NULL,
        donors INT DEFAULT NULL,
        is_central_processing TINYINT(1) DEFAULT NULL,
        apparel_production INT DEFAULT NULL,
        wares_production INT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        submitted_by VARCHAR(255) DEFAULT NULL,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order_date (order_date),
        INDEX idx_order_type (order_type),
        INDEX idx_location (location)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("[MySQL] Orders table ready");

    const [cols] = await conn.query<any[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'`
    );
    const colSet = new Set((cols as Array<{ COLUMN_NAME: string }>).map(c => c.COLUMN_NAME.toLowerCase()));
    const ensureCol = async (name: string, ddl: string): Promise<boolean> => {
      if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
        throw new Error(`Invalid column name: ${name}`);
      }
      if (!/^(INT|TINYINT\(\d+\)|VARCHAR\(\d+\)|TEXT|DATETIME)(\s+(NOT\s+)?NULL)?(\s+DEFAULT\s+('[^']*'|NULL|CURRENT_TIMESTAMP))?$/i.test(ddl)) {
        throw new Error(`Invalid column DDL: ${ddl}`);
      }
      if (!colSet.has(name.toLowerCase())) {
        const sql = "ALTER TABLE orders ADD COLUMN `" + name + "` " + ddl;
        await conn.query(sql);
        colSet.add(name.toLowerCase());
        console.log(`[MySQL] Added orders.${name}`);
        return true;
      }
      return false;
    };
    await ensureCol("furniture_gaylords_requested", "INT DEFAULT NULL");
    await ensureCol("furniture_gaylords_returned", "INT DEFAULT NULL");
    await ensureCol("fulfilled_at", "DATETIME DEFAULT NULL");
    await ensureCol("fulfilled_by", "VARCHAR(255) DEFAULT NULL");

    // First Aid order type (per-item replenishment counts). Each item is a
    // single INT column — the new "First Aid" order type uses these instead
    // of the equipment columns above.
    await ensureCol("first_aid_guide", "INT DEFAULT NULL");
    await ensureCol("cpr_mask", "INT DEFAULT NULL");
    await ensureCol("scissors", "INT DEFAULT NULL");
    await ensureCol("tweezers", "INT DEFAULT NULL");
    await ensureCol("medical_exam_gloves", "INT DEFAULT NULL");
    await ensureCol("antibiotic_treatment", "INT DEFAULT NULL");
    await ensureCol("antiseptic", "INT DEFAULT NULL");
    await ensureCol("burn_treatment", "INT DEFAULT NULL");
    await ensureCol("sterile_bandaids", "INT DEFAULT NULL");
    await ensureCol("medical_tape", "INT DEFAULT NULL");
    await ensureCol("triangular_sling", "INT DEFAULT NULL");
    await ensureCol("absorbent_compress", "INT DEFAULT NULL");
    await ensureCol("sterile_pads", "INT DEFAULT NULL");
    await ensureCol("sting_bite_ampules", "INT DEFAULT NULL");
    await ensureCol("stop_bleed_kit", "INT DEFAULT NULL");
    await ensureCol("instant_cold_pack", "INT DEFAULT NULL");
    await ensureCol("spill_kit", "INT DEFAULT NULL");

    // Phase 1 order approval workflow
    const statusJustAdded = await ensureCol(
      "status",
      "VARCHAR(20) NOT NULL DEFAULT 'submitted'",
    );
    await ensureCol("approved_at", "DATETIME DEFAULT NULL");
    await ensureCol("approved_by", "VARCHAR(255) DEFAULT NULL");
    await ensureCol("denied_at", "DATETIME DEFAULT NULL");
    await ensureCol("denied_by", "VARCHAR(255) DEFAULT NULL");
    await ensureCol("denial_reason", "TEXT DEFAULT NULL");

    // Backfill: any pre-existing rows had no concept of status, so treat them
    // as the legacy behavior — anything fulfilled is "received", everything
    // else is treated as "approved" (because the old engine counted them all
    // toward inventory). Only run on the migration that just added the column,
    // so we don't keep clobbering live data on subsequent boots.
    if (statusJustAdded) {
      await conn.query(
        "UPDATE orders SET status = 'received', approved_at = COALESCE(approved_at, fulfilled_at), approved_by = COALESCE(approved_by, fulfilled_by) WHERE fulfilled_at IS NOT NULL",
      );
      await conn.query(
        "UPDATE orders SET status = 'approved', approved_at = COALESCE(approved_at, submitted_at), approved_by = COALESCE(approved_by, submitted_by) WHERE fulfilled_at IS NULL",
      );
      console.log("[MySQL] Backfilled orders.status (fulfilled→received, others→approved)");
    }

    // Helpful index for status filtering in the warehouse on-hand engine and
    // the seasonal balance loaders.
    try {
      await conn.query("CREATE INDEX idx_orders_status ON orders(status)");
    } catch {
      /* index already exists */
    }

    // ---- Order reconciliation (receiving & export confirmation) ----
    // Each inventory-affecting column gets a mirror "<col>_actual" that holds
    // the quantity the responsible side TYPED IN at confirmation time. The
    // warehouse on-hand engine reads COALESCE(<col>_actual, <col>) so confirmed
    // actuals win and un-confirmed (NULL) actuals fall back to the planned
    // value. Add all the actual columns FIRST, then confirmed_at/by.
    for (const col of ORDER_RECONCILABLE_COLUMNS) {
      await ensureCol(`${col}_actual`, "INT DEFAULT NULL");
    }
    // Seasonal saved-stock lines can also be recorded at confirmation (record
    // only — they don't feed on-hand), so they need mirror columns too.
    for (const col of SEASONAL_CONFIRMABLE_COLUMNS) {
      await ensureCol(`${col}_actual`, "INT DEFAULT NULL");
    }
    // confirmed_at / confirmed_by drive the "reconciled" state. A goods-moving
    // order does NOT count toward inventory until confirmed_at is set.
    const confirmedAtJustAdded = await ensureCol("confirmed_at", "DATETIME DEFAULT NULL");
    await ensureCol("confirmed_by", "VARCHAR(255) DEFAULT NULL");
    // Optional free-text note typed by the confirmer (damage, discrepancies,
    // why actuals differ from planned). Cleared when a confirmation is undone.
    await ensureCol("confirmed_note", "TEXT DEFAULT NULL");

    // One-time backfill on the migration that first adds confirmed_at: every
    // order the OLD engine already counted (status approved/received/closed) is
    // marked confirmed so historical on-hand math is preserved EXACTLY — the
    // _actual columns stay NULL, so COALESCE(_actual, planned) falls back to the
    // planned value and nothing changes. submitted/denied orders are left
    // unconfirmed. New orders created after this migration start unconfirmed and
    // must be reconciled by typing actuals before they affect inventory.
    if (confirmedAtJustAdded) {
      await conn.query(
        `UPDATE orders
            SET confirmed_at = COALESCE(fulfilled_at, approved_at, submitted_at),
                confirmed_by = COALESCE(fulfilled_by, approved_by, submitted_by)
          WHERE status IN ('approved', 'received', 'closed')
            AND confirmed_at IS NULL`,
      );
      console.log("[MySQL] Backfilled orders.confirmed_at for pre-existing approved/received/closed orders");
    }

    // Index to keep the warehouse on-hand query (now filters on confirmed_at)
    // fast.
    try {
      await conn.query("CREATE INDEX idx_orders_confirmed_at ON orders(confirmed_at)");
    } catch {
      /* index already exists */
    }
  } finally {
    conn.release();
  }
}

// initOrdersTable (above) uses the raw pool: its ALTER TABLE statements on a
// large live table can legitimately run longer than the query timeout.
// A test fixture pool is used as-is: the timeout/recovery wrapper is for the
// real tunnel connection.
const exportedPool = testPool ?? guardedPool;
export { exportedPool as mysqlPool };
