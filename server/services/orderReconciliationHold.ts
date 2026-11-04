// Transfer & Receive reconciliation hold.
//
// A store can't submit a new Transfer & Receive order while it has an earlier
// T&R order that was approved but never confirmed (reconciled) — as long as
// that order falls under the policy:
//   - it is dated after TR_RECONCILIATION_POLICY_DATE, OR it was submitted
//     after the end of that day (Eastern), so backdating can't dodge the rule;
//   - AND its order date has arrived (today or earlier, Eastern), so a store
//     isn't held up by a delivery that physically hasn't happened yet.
// submitted / denied / confirmed orders never block. Admins and approvers may
// override; the caller records the override in the order history.
//
// Kept free of `storage` / pool imports so it is unit-testable without a
// database (see test/order-reconciliation-hold.test.ts).

import { fromZonedTime } from "date-fns-tz";
import { TR_RECONCILIATION_POLICY_DATE } from "@shared/schema";

export const TRANSFER_ORDER_TYPE = "Transfer and Receive";
export const UNRECONCILED_TRANSFERS_CODE = "UNRECONCILED_TRANSFERS";

// Same zone as TIMEZONE in server/middleware.ts (not imported: that module
// pulls in storage and the database).
const EASTERN = "America/New_York";

// Keeps the response small; the store only needs to see where to start.
const MAX_BLOCKERS = 50;

export interface BlockingTransferOrder {
  id: number;
  orderDate: string; // YYYY-MM-DD
}

// Anything with mysql2's execute(): a Pool or a PoolConnection inside a
// transaction.
export interface HoldQueryRunner {
  execute(sql: string, values: (string | number)[]): Promise<[unknown, unknown]>;
}

export function easternTodayYmd(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// The first instant after the policy day, in UTC, as a MySQL DATETIME literal.
export function policyCutoffUtc(): string {
  const [y, m, d] = TR_RECONCILIATION_POLICY_DATE.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextYmd = next.toISOString().slice(0, 10);
  return fromZonedTime(`${nextYmd}T00:00:00`, EASTERN).toISOString().slice(0, 19).replace("T", " ");
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isBlockingTransferOrder(
  order: { orderYmd: string; submittedAfterCutoff: boolean },
  todayEt: string,
): boolean {
  if (!YMD.test(order.orderYmd)) return false;
  const inPolicy = order.orderYmd > TR_RECONCILIATION_POLICY_DATE || order.submittedAfterCutoff;
  const delivered = order.orderYmd <= todayEt;
  return inPolicy && delivered;
}

// The store's T&R orders that block a new T&R submission, oldest first.
// `location` must already be an authorized, exact order identity; BINARY keeps
// MySQL's accent-insensitive collation from merging look-alike store names.
export async function findBlockingTransferOrders(
  conn: HoldQueryRunner,
  location: string,
  opts: { excludeOrderId?: number; now?: Date } = {},
): Promise<BlockingTransferOrder[]> {
  // submitted_at is written with MySQL's own clock (DEFAULT CURRENT_TIMESTAMP),
  // whose zone we don't control. Shift the UTC cutoff by the server's current
  // offset (NOW() - UTC_TIMESTAMP()) so the comparison holds in any zone.
  // Known limit: if MySQL runs in a DST-observing zone, the offset used during
  // daylight time is an hour off for the (standard-time) cutoff, moving it by
  // one hour. That only affects backdated orders submitted around midnight on
  // Nov 17; a UTC server (Azure's default) is exact.
  const params: (string | number)[] = [policyCutoffUtc(), TRANSFER_ORDER_TYPE, location];
  let sql = `SELECT id,
            DATE_FORMAT(order_date, '%Y-%m-%d') AS order_ymd,
            (submitted_at IS NOT NULL
              AND submitted_at >= TIMESTAMPADD(SECOND, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()), ?)) AS submitted_after_cutoff
       FROM orders
      WHERE order_type = ?
        AND status = 'approved'
        AND confirmed_at IS NULL
        AND BINARY location = ?`;
  if (opts.excludeOrderId !== undefined) {
    sql += `\n        AND id <> ?`;
    params.push(opts.excludeOrderId);
  }
  sql += `\n      ORDER BY order_date ASC, id ASC`;

  const [rows] = await conn.execute(sql, params);
  const today = easternTodayYmd(opts.now);
  const blockers: BlockingTransferOrder[] = [];
  for (const row of (rows as Record<string, unknown>[]) ?? []) {
    const orderYmd = typeof row.order_ymd === "string" ? row.order_ymd : "";
    const submittedAfterCutoff = Number(row.submitted_after_cutoff) === 1;
    if (isBlockingTransferOrder({ orderYmd, submittedAfterCutoff }, today)) {
      blockers.push({ id: Number(row.id), orderDate: orderYmd });
      if (blockers.length >= MAX_BLOCKERS) break;
    }
  }
  return blockers;
}

export const RECONCILIATION_HOLD_LOCKED_CODE = "RECONCILIATION_HOLD_LOCKED";

// Is this existing order one of the orders currently holding its store?
// Store users must reconcile it, not edit or delete it away (an edit would send
// it back to "submitted" and quietly lift the hold). Only approved, unconfirmed
// T&R orders can qualify, so everything else skips the query.
export async function isOrderHoldingStore(
  conn: HoldQueryRunner,
  order: { id: unknown; order_type?: unknown; status?: unknown; confirmed_at?: unknown; location?: unknown },
): Promise<boolean> {
  if (order.order_type !== TRANSFER_ORDER_TYPE || order.status !== "approved" || order.confirmed_at != null) {
    return false;
  }
  const id = Number(order.id);
  const blockers = await findBlockingTransferOrders(conn, String(order.location ?? ""));
  return blockers.some(b => b.id === id);
}

export const HOLD_LOCKED_MESSAGE =
  "This Transfer & Receive order is holding up new Transfer & Receive orders for this store. " +
  "Confirm what was received on it in Order Submissions instead, or ask the warehouse to change it.";

function describe(blockers: BlockingTransferOrder[]): string {
  const n = blockers.length;
  const list = blockers.slice(0, 5).map(b => `#${b.id} (${b.orderDate})`).join(", ");
  const more = n > 5 ? ` and ${n - 5} more` : "";
  return `${n} Transfer & Receive ${n === 1 ? "order" : "orders"} not yet reconciled: ${list}${more}`;
}

export type TransferHoldDecision =
  | { action: "allow" }
  | {
      action: "block";
      body: { code: typeof UNRECONCILED_TRANSFERS_CODE; message: string; blockingOrders: BlockingTransferOrder[] };
    }
  | { action: "override"; warning: string; auditNote: string; blockingOrders: BlockingTransferOrder[] };

export function decideTransferHold(args: {
  orderType: string;
  blockers: BlockingTransferOrder[];
  canOverride: boolean;
}): TransferHoldDecision {
  if (args.orderType !== TRANSFER_ORDER_TYPE || args.blockers.length === 0) {
    return { action: "allow" };
  }
  const summary = describe(args.blockers);
  if (!args.canOverride) {
    return {
      action: "block",
      body: {
        code: UNRECONCILED_TRANSFERS_CODE,
        message: `This store has ${summary}. Confirm what was received on those orders before submitting a new Transfer & Receive order.`,
        blockingOrders: args.blockers,
      },
    };
  }
  return {
    action: "override",
    warning: `Submitted even though this store has ${summary}.`,
    auditNote: `Reconciliation hold overridden — store had ${summary}.`,
    blockingOrders: args.blockers,
  };
}
