// Classifies errors from the app's dependencies, so a request that failed
// because MySQL, the tunnel or Postgres was briefly unavailable answers 503
// ("try again") instead of 500, and logs say which dependency failed.

// Errors that mean "MySQL or the tunnel is unavailable right now", as opposed
// to a bad query. (Kept here, not in ./mysql, so this module has no side
// effects; importing ./mysql creates the pool.)
const TRANSIENT_MYSQL_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ER_CON_COUNT_ERROR",
  "MYSQL_ACQUIRE_TIMEOUT",
  "MYSQL_QUEUE_FULL",
]);

export function isTransientMysqlError(err: unknown): boolean {
  const code = (err as any)?.code;
  // mysql2 marks connection-level failures fatal; some (e.g. MariaDB's
  // "Connection was killed") carry no code.
  return (typeof code === "string" && TRANSIENT_MYSQL_CODES.has(code)) || (err as any)?.fatal === true;
}

// Postgres SQLSTATEs for connection loss, shutdown and "too many connections".
const TRANSIENT_PG_CODES = new Set(["08000", "08001", "08003", "08004", "08006", "57P01", "57P02", "57P03", "53300"]);
const TRANSIENT_PG_MESSAGES = [
  "timeout exceeded when trying to connect", // pg-pool: no free client within connectionTimeoutMillis
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
];

export function isTransientPgError(err: unknown): boolean {
  const code = (err as any)?.code;
  if (typeof code === "string" && TRANSIENT_PG_CODES.has(code)) return true;
  const message = (err as any)?.message;
  return typeof message === "string" && TRANSIENT_PG_MESSAGES.some(m => message.includes(m));
}

export function isTransientDependencyError(err: unknown): boolean {
  return isTransientMysqlError(err) || isTransientPgError(err) || isTransientPgError((err as any)?.cause);
}

export function errorStatus(err: unknown): 500 | 503 {
  return isTransientDependencyError(err) ? 503 : 500;
}

// "mysql" | "pg" | "app", from the shape of the error code.
export function dependencyOf(err: unknown): "mysql" | "pg" | "app" {
  const code = (err as any)?.code ?? (err as any)?.cause?.code;
  if (typeof code === "string") {
    if (code.startsWith("ER_") || code.startsWith("PROTOCOL_") || code.startsWith("MYSQL_")) return "mysql";
    if (/^[0-9A-Z]{5}$/.test(code)) return "pg";
  }
  if (isTransientPgError(err)) return "pg";
  return "app";
}
