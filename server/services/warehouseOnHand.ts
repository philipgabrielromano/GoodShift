import type { RowDataPacket } from "mysql2";
import { storage } from "../storage";
import { mysqlPool } from "../mysql";
import {
  ORDER_FIELD_TO_WAREHOUSE_ITEM,
  WAREHOUSE_INVENTORY_CATEGORIES,
  type Warehouse,
} from "@shared/schema";

export interface ItemMovement {
  itemName: string;
  groupName: string;
  baseline: number;        // last finalized count qty (or 0 if none)
  baselineDate: string | null;
  ordersDelta: number;     // net change from orders since baseline
  transfersDelta: number;  // net change from manual transfers since baseline
  onHand: number;          // baseline + ordersDelta + transfersDelta
}

export interface OnHandResult {
  warehouse: Warehouse;
  baselineDate: string | null;
  baselineCountId: number | null;
  asOfDate: string;        // upper bound (inclusive) for orders/transfers
  items: ItemMovement[];
  totals: {
    onHand: number;
    baseline: number;
    ordersDelta: number;
    transfersDelta: number;
    byGroup: Record<string, { onHand: number; baseline: number; ordersDelta: number; transfersDelta: number }>;
  };
}

interface OrderRowMin extends RowDataPacket {
  location: string;
  [key: string]: any;
}

/**
 * Build a complete on-hand snapshot for a warehouse.
 *  baseline = qty from the most recent FINAL count whose date <= asOf
 *             (if no final count, falls back to the most recent count of any status,
 *              then 0). Orders & transfers strictly AFTER the baseline date and
 *              up to (and including) asOf are added on top.
 */
export async function computeWarehouseOnHand(
  warehouse: Warehouse,
  asOf: string,
): Promise<OnHandResult> {
  // 1. Find baseline = most recent FINAL count whose date <= asOf.
  // Drafts are NEVER used as a baseline — they would produce phantom on-hand
  // numbers that don't reflect a real, leadership-approved snapshot. If no
  // finalized count exists yet (rollout state), the engine starts from zero.
  const allCounts = await storage.getWarehouseInventoryCounts({ warehouse, limit: 200 });
  const baseline = allCounts.find(c => c.status === "final" && c.countDate <= asOf) || null;

  const baselineDate = baseline?.countDate ?? null;
  const baselineId = baseline?.id ?? null;
  const baselineItems = baseline
    ? await storage.getWarehouseInventoryCountItems(baseline.id)
    : [];
  const baselineMap = new Map(baselineItems.map(i => [i.itemName, i.qty] as const));

  // 2. Find which store locations feed this warehouse
  const allLocations = await storage.getLocations();
  const feederStoreNames = allLocations
    .filter(l => (l as any).warehouseAssignment === warehouse)
    .map(l => l.name);

  // 3. Sum order deltas in (baselineDate, asOf]
  const orderDeltas = new Map<string, number>(); // itemName -> signed qty
  if (feederStoreNames.length > 0) {
    const fields = Object.keys(ORDER_FIELD_TO_WAREHOUSE_ITEM);
    const fieldList = fields.map(f => `COALESCE(SUM(${f}), 0) AS ${f}`).join(", ");
    const placeholders = feederStoreNames.map(() => "?").join(",");
    const params: any[] = [...feederStoreNames];
    let dateClause = "";
    if (baselineDate) {
      dateClause += " AND order_date > ?";
      params.push(baselineDate);
    }
    dateClause += " AND order_date <= ?";
    params.push(asOf);
    const sqlText = `
      SELECT ${fieldList}
      FROM orders
      WHERE location IN (${placeholders}) ${dateClause}
    `;
    const [rows] = await mysqlPool.query<OrderRowMin[]>(sqlText, params);
    const row: any = rows[0] || {};
    for (const [field, mapping] of Object.entries(ORDER_FIELD_TO_WAREHOUSE_ITEM)) {
      const raw = Number(row[field] || 0);
      if (!raw) continue;
      const delta = raw * mapping.sign;
      orderDeltas.set(mapping.item, (orderDeltas.get(mapping.item) || 0) + delta);
    }
  }

  // 4. Sum transfers in (baselineDate, asOf]
  const transferDeltas = new Map<string, number>();
  const transfers = await storage.getWarehouseTransfers({
    warehouse,
    from: baselineDate ? addDays(baselineDate, 1) : undefined,
    to: asOf,
    limit: 5000,
  });
  for (const t of transfers) {
    transferDeltas.set(t.itemName, (transferDeltas.get(t.itemName) || 0) + t.qty);
  }

  // 5. Combine into per-item movements (every canonical item, even at 0)
  const items: ItemMovement[] = [];
  const totals = {
    onHand: 0,
    baseline: 0,
    ordersDelta: 0,
    transfersDelta: 0,
    byGroup: {} as Record<string, { onHand: number; baseline: number; ordersDelta: number; transfersDelta: number }>,
  };
  for (const cat of WAREHOUSE_INVENTORY_CATEGORIES) {
    for (const itemName of cat.items) {
      const baselineQty = baselineMap.get(itemName) || 0;
      const ordersDelta = orderDeltas.get(itemName) || 0;
      const transfersDelta = transferDeltas.get(itemName) || 0;
      const onHand = baselineQty + ordersDelta + transfersDelta;
      items.push({
        itemName,
        groupName: cat.group,
        baseline: baselineQty,
        baselineDate,
        ordersDelta,
        transfersDelta,
        onHand,
      });
      totals.onHand += onHand;
      totals.baseline += baselineQty;
      totals.ordersDelta += ordersDelta;
      totals.transfersDelta += transfersDelta;
      const g = (totals.byGroup[cat.group] ||= { onHand: 0, baseline: 0, ordersDelta: 0, transfersDelta: 0 });
      g.onHand += onHand;
      g.baseline += baselineQty;
      g.ordersDelta += ordersDelta;
      g.transfersDelta += transfersDelta;
    }
  }

  return {
    warehouse,
    baselineDate,
    baselineCountId: baselineId,
    asOfDate: asOf,
    items,
    totals,
  };
}

function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(yyyyMmDd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
