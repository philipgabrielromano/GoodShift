/**
 * Unit tests for the Transfer & Receive reconciliation hold
 * (server/services/orderReconciliationHold.ts).
 *
 * Policy: a store may not submit a new Transfer & Receive order while it has
 * an approved-but-unconfirmed T&R order dated (or submitted) AFTER
 * 2026-11-16 Eastern whose order date has already arrived. Admins/approvers
 * may override with a warning.
 *
 * Run with:   npx tsx --test test/order-reconciliation-hold.test.ts
 * No database needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { TR_RECONCILIATION_POLICY_DATE } from "../shared/schema";
import {
  decideTransferHold,
  easternTodayYmd,
  findBlockingTransferOrders,
  isBlockingTransferOrder,
  policyCutoffUtc,
  TRANSFER_ORDER_TYPE,
} from "../server/services/orderReconciliationHold";

const TODAY = "2026-11-20";

test("policy date is Nov 16 2026 and the cutoff is the end of that day in Eastern time", () => {
  assert.equal(TR_RECONCILIATION_POLICY_DATE, "2026-11-16");
  // Midnight starting Nov 17 EST (UTC-5) is 05:00 UTC.
  assert.equal(policyCutoffUtc(), "2026-11-17 05:00:00");
});

test("easternTodayYmd uses the America/New_York calendar day", () => {
  assert.equal(easternTodayYmd(new Date("2026-11-17T03:00:00Z")), "2026-11-16");
  assert.equal(easternTodayYmd(new Date("2026-11-17T05:30:00Z")), "2026-11-17");
});

test("easternTodayYmd follows the DST change on Nov 1 2026", () => {
  // EDT (UTC-4) until 06:00Z, then EST (UTC-5).
  assert.equal(easternTodayYmd(new Date("2026-11-01T03:59:00Z")), "2026-10-31");
  assert.equal(easternTodayYmd(new Date("2026-11-01T04:00:00Z")), "2026-11-01");
  assert.equal(easternTodayYmd(new Date("2026-11-02T04:59:00Z")), "2026-11-01");
  assert.equal(easternTodayYmd(new Date("2026-11-02T05:00:00Z")), "2026-11-02");
});

test("orders dated on or before Nov 16 and submitted before the cutoff are exempt", () => {
  assert.equal(isBlockingTransferOrder({ orderYmd: "2026-11-16", submittedAfterCutoff: false }, TODAY), false);
  assert.equal(isBlockingTransferOrder({ orderYmd: "2026-11-01", submittedAfterCutoff: false }, TODAY), false);
});

test("orders dated after Nov 16 block once their date has arrived", () => {
  assert.equal(isBlockingTransferOrder({ orderYmd: "2026-11-17", submittedAfterCutoff: false }, TODAY), true);
  assert.equal(isBlockingTransferOrder({ orderYmd: TODAY, submittedAfterCutoff: true }, TODAY), true);
});

test("a backdated order submitted after the cutoff still blocks", () => {
  assert.equal(isBlockingTransferOrder({ orderYmd: "2026-11-10", submittedAfterCutoff: true }, TODAY), true);
  assert.equal(isBlockingTransferOrder({ orderYmd: "2026-11-16", submittedAfterCutoff: true }, TODAY), true);
});

test("future-dated (not yet delivered) orders never block", () => {
  assert.equal(isBlockingTransferOrder({ orderYmd: "2026-11-21", submittedAfterCutoff: true }, TODAY), false);
});

test("a malformed order date never blocks", () => {
  assert.equal(isBlockingTransferOrder({ orderYmd: "", submittedAfterCutoff: true }, TODAY), false);
});

type Call = { sql: string; params: unknown[] };
function stubConn(rows: Record<string, unknown>[]) {
  const calls: Call[] = [];
  return {
    calls,
    conn: {
      execute: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return [rows, []] as [unknown, unknown];
      },
    },
  };
}

test("lookup only asks for this store's approved, unconfirmed T&R orders with an exact name match", async () => {
  const { calls, conn } = stubConn([]);
  await findBlockingTransferOrders(conn, "Café", { now: new Date("2026-11-20T15:00:00Z") });
  assert.equal(calls.length, 1);
  const { sql, params } = calls[0];
  assert.match(sql, /BINARY location = \?/);
  assert.doesNotMatch(sql, /(?<!BINARY )location = \?/);
  assert.match(sql, /status = 'approved'/);
  assert.match(sql, /confirmed_at IS NULL/);
  assert.match(sql, /order_type = \?/);
  assert.doesNotMatch(sql, /id <> \?/);
  assert.deepEqual(params, ["2026-11-17 05:00:00", TRANSFER_ORDER_TYPE, "Café"]);
});

test("lookup can exclude the order being edited", async () => {
  const { calls, conn } = stubConn([]);
  await findBlockingTransferOrders(conn, "Store A", { excludeOrderId: 42, now: new Date("2026-11-20T15:00:00Z") });
  assert.match(calls[0].sql, /id <> \?/);
  assert.equal(calls[0].params.at(-1), 42);
});

test("lookup applies the date rules and normalizes MySQL's 0/1 flags", async () => {
  const { conn } = stubConn([
    { id: 1, order_ymd: "2026-11-16", submitted_after_cutoff: 0 },
    { id: 2, order_ymd: "2026-11-18", submitted_after_cutoff: 1 },
    { id: 3, order_ymd: "2026-11-12", submitted_after_cutoff: "1" },
    { id: 4, order_ymd: "2026-11-25", submitted_after_cutoff: 1 },
    { id: 5, order_ymd: "2026-11-15", submitted_after_cutoff: null },
  ]);
  const result = await findBlockingTransferOrders(conn, "Store A", { now: new Date("2026-11-20T15:00:00Z") });
  assert.deepEqual(result, [
    { id: 2, orderDate: "2026-11-18" },
    { id: 3, orderDate: "2026-11-12" },
  ]);
});

const BLOCKERS = [{ id: 7, orderDate: "2026-11-18" }, { id: 9, orderDate: "2026-11-19" }];

test("non-T&R order types are never held", () => {
  for (const orderType of ["End of Day/Equipment Count", "Donors", "Supplemental production", "First Aid"]) {
    assert.deepEqual(decideTransferHold({ orderType, blockers: BLOCKERS, canOverride: false }), { action: "allow" });
  }
});

test("a T&R order from a store with no blockers is allowed", () => {
  assert.deepEqual(decideTransferHold({ orderType: TRANSFER_ORDER_TYPE, blockers: [], canOverride: false }), { action: "allow" });
});

test("a store user with blockers is refused with the blocking orders listed", () => {
  const decision = decideTransferHold({ orderType: TRANSFER_ORDER_TYPE, blockers: BLOCKERS, canOverride: false });
  assert.equal(decision.action, "block");
  if (decision.action !== "block") return;
  assert.equal(decision.body.code, "UNRECONCILED_TRANSFERS");
  assert.deepEqual(decision.body.blockingOrders, BLOCKERS);
  assert.match(decision.body.message, /2 Transfer & Receive orders/);
  assert.match(decision.body.message, /#7/);
  assert.match(decision.body.message, /#9/);
});

test("an approver with blockers is allowed with a warning and an audit note", () => {
  const decision = decideTransferHold({ orderType: TRANSFER_ORDER_TYPE, blockers: BLOCKERS.slice(0, 1), canOverride: true });
  assert.equal(decision.action, "override");
  if (decision.action !== "override") return;
  assert.match(decision.warning, /1 Transfer & Receive order\b/);
  assert.match(decision.auditNote, /#7/);
  assert.deepEqual(decision.blockingOrders, BLOCKERS.slice(0, 1));
});
