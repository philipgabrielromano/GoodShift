
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const fixtureConfig = (globalThis as Record<symbol, unknown>)[
  Symbol.for("goodshift.permission-test.database")
] as pg.PoolConfig | undefined;
if (fixtureConfig && !process.env.NODE_TEST_CONTEXT) {
  throw new Error("Isolated database fixtures require node --test");
}

if (!fixtureConfig && !process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set. Did you forget to provision a database?");
  // Don't throw - allow server to start for health checks
}

export const pool = new Pool({ 
  ...(fixtureConfig ?? { connectionString: process.env.DATABASE_URL }),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
});

// Handle pool errors gracefully
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

export const db = drizzle(pool, { schema });
