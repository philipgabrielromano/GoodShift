import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireFeatureAccess } from "../middleware";
import {
  insertWarehouseInventoryCountSchema,
  insertWarehouseTransferSchema,
  WAREHOUSE_INVENTORY_CATEGORIES,
  WAREHOUSES,
  TRANSFER_REASONS,
  type Warehouse,
} from "@shared/schema";
import { computeWarehouseOnHand } from "../services/warehouseOnHand";
import { sendWarehouseVarianceCsvEmail } from "../outlook";

function getSessionUser(req: Request): { id: number; name: string; role?: string } | null {
  const u = (req.session as any)?.user;
  if (!u) return null;
  return { id: u.id, name: u.name || u.email || "Unknown", role: u.role };
}

const VALID_ITEM_NAMES = new Set(
  WAREHOUSE_INVENTORY_CATEGORIES.flatMap(c => c.items),
);

const itemsUpdateSchema = z.object({
  items: z.array(z.object({
    itemName: z.string().refine(n => VALID_ITEM_NAMES.has(n), "Invalid item"),
    qty: z.number().int().min(0).max(1_000_000),
  })).min(1).max(500),
});

const createSchema = insertWarehouseInventoryCountSchema.omit({
  status: true,
  finalizedAt: true,
  finalizedById: true,
  finalizedByName: true,
} as any).extend({
  copyFromCountId: z.number().int().positive().optional(),
  copyFromLatest: z.boolean().optional(),
  prefillFromEngine: z.boolean().optional(), // Default true: pre-fill qty AND expectedQty from on-hand engine
});

const updateSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional(),
});

function todayInTZ(): string {
  // Local date in America/New_York (Ohio). Avoids off-by-one around midnight.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  return fmt.format(new Date()); // YYYY-MM-DD
}

// One-time seed: when locations have NULL warehouseAssignment, infer it from
// the location name. Cleveland-area names → cleveland; Canton-area names →
// canton; the warehouse locations themselves resolve to themselves. Admins
// can override any assignment from the Locations admin UI; this seed only
// fills in NULLs and never overwrites an explicit choice.
async function seedWarehouseAssignments(): Promise<{ assigned: number; remaining: number }> {
  const locations = await storage.getLocations();
  const CLEVELAND_HINTS = ["cleveland", "lakewood", "parma", "euclid", "lorain", "elyria", "mentor", "willoughby", "ashtabula", "painesville", "north olmsted", "westlake", "strongsville"];
  const CANTON_HINTS = ["canton", "massillon", "akron", "barberton", "alliance", "north canton", "stark", "cuyahoga falls", "hartville"];
  let updated = 0;
  for (const loc of locations) {
    if (loc.warehouseAssignment) continue; // never overwrite admin choice
    const haystack = `${loc.name || ""} ${loc.orderFormName || ""}`.toLowerCase();
    let assigned: string | null = null;
    // Self-resolution: a warehouse named cleveland/canton routes to itself
    if (/cleveland warehouse|warehouse.*cleveland/.test(haystack)) assigned = "cleveland";
    else if (/canton warehouse|warehouse.*canton/.test(haystack)) assigned = "canton";
    else if (CLEVELAND_HINTS.some(h => haystack.includes(h))) assigned = "cleveland";
    else if (CANTON_HINTS.some(h => haystack.includes(h))) assigned = "canton";
    if (assigned) {
      await storage.updateLocation(loc.id, { warehouseAssignment: assigned });
      updated++;
    }
  }
  if (updated > 0) {
    console.log(`[WarehouseInventory] Auto-assigned warehouse routing for ${updated} location(s) (admins can override in Locations).`);
  }
  const remaining = (await storage.getLocations()).filter(l => !l.warehouseAssignment).length;
  return { assigned: updated, remaining };
}

export function registerWarehouseInventoryRoutes(app: Express) {
  const requireAccess = requireFeatureAccess("warehouse_inventory.view");
  const requireEdit = requireFeatureAccess("warehouse_inventory.edit");
  const requireFinalize = requireFeatureAccess("warehouse_inventory.finalize");
  const requireTransfer = requireFeatureAccess("warehouse_inventory.transfer");

  // Seed default warehouse assignments on startup (idempotent, NULLs only).
  void seedWarehouseAssignments().catch(err =>
    console.error("[WarehouseInventory] Warehouse-assignment seed failed (non-fatal):", err));

  // Admin-only endpoint to re-run the auto-assignment heuristic for any
  // locations that still have NULL routing (e.g. after new stores are added).
  // Warehouse routing affects on-hand math everywhere, so this is gated by an
  // explicit role check, not just by feature flag.
  app.post("/api/warehouse-inventory/auto-assign-locations", async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can auto-assign warehouse routing" });
      }
      const result = await seedWarehouseAssignments();
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Auto-assignment failed";
      res.status(500).json({ message: msg });
    }
  });

  // === On-hand engine: live computed from baseline + orders + transfers ===
  app.get("/api/warehouse-inventory/on-hand", requireAccess, async (req, res) => {
    try {
      const warehouse = String(req.query.warehouse || "");
      if (!WAREHOUSES.includes(warehouse as any)) {
        return res.status(400).json({ message: "Invalid warehouse" });
      }
      const asOf = typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf)
        ? req.query.asOf
        : todayInTZ();
      const result = await computeWarehouseOnHand(warehouse as Warehouse, asOf);
      res.json(result);
    } catch (err) {
      console.error("[WarehouseInventory] On-hand error:", err);
      res.status(500).json({ message: "Failed to compute on-hand" });
    }
  });

  // === Warehouse transfers ===
  app.get("/api/warehouse-transfers", requireAccess, async (req, res) => {
    try {
      const warehouse = typeof req.query.warehouse === "string" ? req.query.warehouse : undefined;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const createdByName = typeof req.query.createdByName === "string" && req.query.createdByName.trim()
        ? req.query.createdByName.trim()
        : undefined;
      const createdByIdRaw = typeof req.query.createdById === "string" ? parseInt(req.query.createdById, 10) : NaN;
      const createdById = Number.isFinite(createdByIdRaw) && createdByIdRaw > 0 ? createdByIdRaw : undefined;
      const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || "100"), 10) || 100));
      const rows = await storage.getWarehouseTransfers({ warehouse, from, to, limit, createdById, createdByName });
      res.json(rows);
    } catch (err) {
      console.error("[WarehouseTransfers] List error:", err);
      res.status(500).json({ message: "Failed to load transfers" });
    }
  });

  // Two POST modes:
  //   1) Paired inter-warehouse transfer: body = { mode: 'paired', fromWarehouse, toWarehouse, itemName, qty>0, transferDate, notes? }
  //      → atomically posts a -qty row on source AND a +qty row on dest, sharing transferGroupId.
  //   2) Adjustment / salvage / other single-sided: body = { warehouse, itemName, qty (signed, !=0), reason, transferDate, notes? }
  //      → posts a single signed row on that warehouse. Reason CANNOT be transfer_in/out (those are reserved for paired).
  const pairedSchema = z.object({
    mode: z.literal("paired"),
    fromWarehouse: z.enum(WAREHOUSES),
    toWarehouse: z.enum(WAREHOUSES),
    itemName: z.string().min(1),
    qty: z.number().int().positive(),
    transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
    notes: z.string().max(2000).nullable().optional(),
  });

  app.post("/api/warehouse-transfers", requireTransfer, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });

      // Mode 1: paired inter-warehouse transfer
      if (req.body && req.body.mode === "paired") {
        const input = pairedSchema.parse(req.body);
        if (!VALID_ITEM_NAMES.has(input.itemName)) return res.status(400).json({ message: "Invalid item" });
        if (input.fromWarehouse === input.toWarehouse) {
          return res.status(400).json({ message: "Source and destination warehouses must be different" });
        }
        const cat = WAREHOUSE_INVENTORY_CATEGORIES.find(c => c.items.includes(input.itemName));
        const rows = await storage.createPairedWarehouseTransfer({
          fromWarehouse: input.fromWarehouse,
          toWarehouse: input.toWarehouse,
          itemName: input.itemName,
          groupName: cat?.group || "Unknown",
          qty: input.qty,
          transferDate: input.transferDate,
          notes: input.notes ?? null,
        }, user);
        return res.status(201).json({ rows });
      }

      // Mode 2: single-sided adjustment
      const input = insertWarehouseTransferSchema.parse(req.body);
      if (!VALID_ITEM_NAMES.has(input.itemName)) {
        return res.status(400).json({ message: "Invalid item" });
      }
      if (input.reason === "transfer_in" || input.reason === "transfer_out") {
        return res.status(400).json({
          message: "Inter-warehouse transfers must use mode='paired' so both sides are posted atomically.",
        });
      }
      const cat = WAREHOUSE_INVENTORY_CATEGORIES.find(c => c.items.includes(input.itemName));
      const created = await storage.createWarehouseTransfer({
        ...input,
        groupName: cat?.group || input.groupName,
      }, user);
      res.status(201).json(created);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: err.errors?.[0]?.message || "Invalid input" });
      console.error("[WarehouseTransfers] Create error:", err);
      res.status(500).json({ message: err?.message || "Failed to create transfer" });
    }
  });

  // Edit a transfer's notes (and date). Quantity/item/warehouse changes are
  // intentionally not editable — delete + recreate keeps the audit trail clean
  // and avoids ambiguity for paired rows. If the row belongs to a paired
  // transfer (transferGroupId set), BOTH halves get the same notes/date.
  const transferEditSchema = z.object({
    notes: z.string().max(2000).nullable().optional(),
    transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional(),
  });

  app.patch("/api/warehouse-transfers/:id", requireTransfer, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      const input = transferEditSchema.parse(req.body);
      if (input.notes === undefined && input.transferDate === undefined) {
        return res.status(400).json({ message: "Nothing to update" });
      }
      const updated = await storage.updateWarehouseTransfer(id, input, user);
      res.json(updated);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: err.errors?.[0]?.message || "Invalid input" });
      console.error("[WarehouseTransfers] Update error:", err);
      res.status(500).json({ message: err?.message || "Failed to update transfer" });
    }
  });

  // Per-transfer audit history (notes/date edits + deletes). Returns rows
  // newest-first; for paired transfers, both halves are merged so the UI
  // shows a single timeline regardless of which side was clicked.
  app.get("/api/warehouse-transfers/:id/history", requireAccess, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      const audits = await storage.getWarehouseTransferAudits(id);
      res.json(audits);
    } catch (err) {
      console.error("[WarehouseTransfers] History error:", err);
      res.status(500).json({ message: "Failed to load transfer history" });
    }
  });

  // Admin-only: export the entire transfer audit trail to CSV. Optional
  // filters: warehouse, from/to (YYYY-MM-DD on changedAt). Includes both
  // surviving and orphaned (post-delete) audit rows. The `changes` JSON is
  // serialized so reviewers can see field-level before/after.
  app.get("/api/warehouse-transfer-audits/export.csv", async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can export the transfer audit log" });
      }
      const rawWarehouse = typeof req.query.warehouse === "string" ? req.query.warehouse : undefined;
      const warehouse: Warehouse | undefined = rawWarehouse && (WAREHOUSES as readonly string[]).includes(rawWarehouse)
        ? (rawWarehouse as Warehouse)
        : undefined;
      const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : undefined;
      const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : undefined;
      const rows = await storage.exportWarehouseTransferAudits({ warehouse, from, to });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="warehouse-transfer-audits-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      // Stream the CSV row-by-row so that future audit-log growth does not
      // force the whole file into memory before the first byte goes out.
      res.write(["ChangedAt", "Action", "TransferId", "TransferGroupId", "Warehouse", "ChangedById", "ChangedByName", "Changes"].join(",") + "\n");
      for (const r of rows) {
        res.write([
          csvSafe(new Date(r.changedAt).toISOString()),
          csvSafe(r.action),
          String(r.transferId),
          csvSafe(r.transferGroupId ?? ""),
          csvSafe(r.warehouse ?? ""),
          r.changedById == null ? "" : String(r.changedById),
          csvSafe(r.changedByName ?? ""),
          csvSafe(JSON.stringify(r.changes ?? {})),
        ].join(",") + "\n");
      }
      res.end();
    } catch (err) {
      console.error("[WarehouseTransferAudits] Export error:", err);
      res.status(500).json({ message: "Failed to export transfer audits" });
    }
  });

  // Admin-only: archive/purge audit rows older than N days. Pass dryRun=true
  // to preview the deletion count without removing anything. Minimum
  // retention is 30 days to prevent accidental wipe of recent activity.
  const purgeSchema = z.object({
    olderThanDays: z.number().int().min(30).max(3650),
    dryRun: z.boolean().optional(),
  });
  app.post("/api/warehouse-transfer-audits/purge", async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can purge the transfer audit log" });
      }
      const input = purgeSchema.parse(req.body);
      const result = await storage.purgeWarehouseTransferAudits(input);
      if (!result.dryRun) {
        console.log(`[WarehouseTransferAudits] Admin ${user.name} (id=${user.id}) purged ${result.deleted} audit row(s) older than ${input.olderThanDays} days (cutoff=${result.cutoff})`);
      }
      res.json({ ...result, olderThanDays: input.olderThanDays });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid input" });
      }
      console.error("[WarehouseTransferAudits] Purge error:", err);
      const message = err instanceof Error ? err.message : "Failed to purge transfer audits";
      res.status(500).json({ message });
    }
  });

  app.delete("/api/warehouse-transfers/:id", requireTransfer, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      // Only admin can delete after the fact (audit trail)
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can delete recorded transfers" });
      }
      await storage.deleteWarehouseTransfer(Number(req.params.id), user);
      res.status(204).send();
    } catch (err) {
      console.error("[WarehouseTransfers] Delete error:", err);
      res.status(500).json({ message: "Failed to delete transfer" });
    }
  });

  // Expose category structure + warehouses (for form dropdowns)
  app.get("/api/warehouse-inventory/meta", requireAccess, async (_req, res) => {
    res.json({
      warehouses: WAREHOUSES,
      categories: WAREHOUSE_INVENTORY_CATEGORIES,
      today: todayInTZ(),
    });
  });

  // Leadership dashboard: latest count per warehouse + deltas + live on-hand
  app.get("/api/warehouse-inventory/dashboard", requireAccess, async (_req, res) => {
    try {
      const today = todayInTZ();
      const results = await Promise.all(WAREHOUSES.map(async (w) => {
        const onHand = await computeWarehouseOnHand(w as Warehouse, today);
        const latest = await storage.getLatestWarehouseInventoryCount(w);
        if (!latest) {
          return {
            warehouse: w,
            latest: null,
            prior: null,
            items: [] as any[],
            priorItems: [] as any[],
            totals: { total: 0, byGroup: {} as Record<string, number> },
            priorTotals: { total: 0, byGroup: {} as Record<string, number> },
            delta: { total: 0, byGroup: {} as Record<string, number> },
            variance: { net: 0, abs: 0, expectedTotal: 0, hasExpected: false },
            staleDays: null as number | null,
            onHand,
          };
        }
        const prior = await storage.getLatestWarehouseInventoryCount(w, latest.countDate);
        const [items, priorItems] = await Promise.all([
          storage.getWarehouseInventoryCountItems(latest.id),
          prior ? storage.getWarehouseInventoryCountItems(prior.id) : Promise.resolve([]),
        ]);
        const totals = { total: 0, byGroup: {} as Record<string, number> };
        for (const it of items) {
          totals.total += it.qty;
          totals.byGroup[it.groupName] = (totals.byGroup[it.groupName] || 0) + it.qty;
        }
        // Variance vs system-expected (snapshotted at finalize). Legacy counts
        // pre-dating the on-hand engine have no expectedQty; in that case we
        // surface hasExpected=false so the UI can show "—" rather than 0.
        let varianceNet = 0;
        let varianceAbs = 0;
        let expectedTotal = 0;
        let varianceHasExpected = false;
        for (const it of items) {
          const exp = it.expectedQty;
          if (exp != null) {
            varianceHasExpected = true;
            const diff = it.qty - exp;
            varianceNet += diff;
            varianceAbs += Math.abs(diff);
            expectedTotal += exp;
          }
        }
        const variance = varianceHasExpected
          ? { net: varianceNet, abs: varianceAbs, expectedTotal, hasExpected: true }
          : { net: 0, abs: 0, expectedTotal: 0, hasExpected: false };
        const priorTotals = { total: 0, byGroup: {} as Record<string, number> };
        for (const it of priorItems) {
          priorTotals.total += it.qty;
          priorTotals.byGroup[it.groupName] = (priorTotals.byGroup[it.groupName] || 0) + it.qty;
        }
        const delta = {
          total: totals.total - priorTotals.total,
          byGroup: {} as Record<string, number>,
        };
        const groupKeys = new Set([
          ...Object.keys(totals.byGroup),
          ...Object.keys(priorTotals.byGroup),
        ]);
        groupKeys.forEach(g => {
          delta.byGroup[g] = (totals.byGroup[g] || 0) - (priorTotals.byGroup[g] || 0);
        });

        const latestDate = new Date(latest.countDate + "T00:00:00");
        const todayDate = new Date(today + "T00:00:00");
        const staleDays = Math.max(
          0,
          Math.round((todayDate.getTime() - latestDate.getTime()) / 86400000),
        );

        return { warehouse: w, latest, prior, items, priorItems, totals, priorTotals, delta, variance, staleDays, onHand };
      }));
      res.json({ warehouses: results, today });
    } catch (err) {
      console.error("[WarehouseInventory] Dashboard error:", err);
      res.status(500).json({ message: "Failed to load dashboard" });
    }
  });

  // Trend: one item across recent counts for a warehouse
  app.get("/api/warehouse-inventory/trend", requireAccess, async (req, res) => {
    try {
      const warehouse = String(req.query.warehouse || "");
      const item = String(req.query.item || "");
      const limit = Math.min(90, Math.max(2, parseInt(String(req.query.limit || "30"), 10) || 30));
      if (!WAREHOUSES.includes(warehouse as any)) {
        return res.status(400).json({ message: "Invalid warehouse" });
      }
      if (!VALID_ITEM_NAMES.has(item)) {
        return res.status(400).json({ message: "Invalid item" });
      }
      const counts = await storage.getWarehouseInventoryCounts({ warehouse, limit });
      const ordered = counts.slice().reverse();
      const series = await Promise.all(ordered.map(async c => {
        const items = await storage.getWarehouseInventoryCountItems(c.id);
        const hit = items.find(i => i.itemName === item);
        return { date: c.countDate, qty: hit?.qty ?? 0, status: c.status };
      }));
      res.json({ warehouse, item, series });
    } catch (err) {
      console.error("[WarehouseInventory] Trend error:", err);
      res.status(500).json({ message: "Failed to load trend" });
    }
  });

  // List counts (history)
  app.get("/api/warehouse-inventory", requireAccess, async (req, res) => {
    try {
      const warehouse = typeof req.query.warehouse === "string" ? req.query.warehouse : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const counts = await storage.getWarehouseInventoryCounts({ warehouse, status, from, to, limit: 200 });
      // Attach totals + variance per count for list display. Variance is only
      // meaningful when expectedQty was snapshotted (post on-hand-engine
      // counts). Legacy counts have no expectedQty → hasExpected=false so the
      // UI shows "—" instead of a misleading 0.
      const withTotals = await Promise.all(counts.map(async c => {
        const items = await storage.getWarehouseInventoryCountItems(c.id);
        const total = items.reduce((a, b) => a + b.qty, 0);
        let varianceNet = 0;
        let varianceAbs = 0;
        let expectedTotal = 0;
        let hasExpected = false;
        for (const it of items) {
          if (it.expectedQty != null) {
            hasExpected = true;
            const diff = it.qty - it.expectedQty;
            varianceNet += diff;
            varianceAbs += Math.abs(diff);
            expectedTotal += it.expectedQty;
          }
        }
        return {
          ...c,
          totalItems: total,
          variance: hasExpected
            ? { net: varianceNet, abs: varianceAbs, expectedTotal, hasExpected: true }
            : { net: 0, abs: 0, expectedTotal: 0, hasExpected: false },
        };
      }));
      res.json(withTotals);
    } catch (err) {
      console.error("[WarehouseInventory] List error:", err);
      res.status(500).json({ message: "Failed to load counts" });
    }
  });

  // CSV export for leadership
  app.get("/api/warehouse-inventory/export.csv", requireAccess, async (req, res) => {
    try {
      const warehouse = typeof req.query.warehouse === "string" ? req.query.warehouse : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const counts = await storage.getWarehouseInventoryCounts({ warehouse, status, from, to, limit: 500 });
      const rows: string[] = [
        ["Date", "Warehouse", "Status", "Group", "Item", "Qty", "Counted By", "Notes"].join(","),
      ];
      for (const c of counts) {
        const items = await storage.getWarehouseInventoryCountItems(c.id);
        for (const it of items) {
          rows.push([
            csv(c.countDate),
            csv(c.warehouse),
            csv(c.status),
            csv(it.groupName),
            csv(it.itemName),
            String(it.qty),
            csv(c.createdByName || ""),
            csv(c.notes || ""),
          ].join(","));
        }
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="warehouse-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(rows.join("\n"));
    } catch (err) {
      console.error("[WarehouseInventory] Export error:", err);
      res.status(500).json({ message: "Failed to export" });
    }
  });

  // Email the variance CSV to ops/audit. Recipients are ALWAYS resolved from
  // the per-warehouse list configured in Settings
  // (warehouseVarianceEmailsCleveland / warehouseVarianceEmailsCanton). We do
  // NOT accept a caller-supplied recipient list here — that would let any user
  // with warehouse_inventory.view exfiltrate count data to arbitrary addresses.
  // The CSV body matches the client-side download exactly so leaders can hand
  // off counts in one click.
  app.post("/api/warehouse-inventory/:id/email-csv", requireAccess, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      const items = await storage.getWarehouseInventoryCountItems(id);

      // Resolve expected map: snapshot for finalized counts, live engine otherwise.
      let expectedMap: Record<string, number | null> = {};
      if (count.status === "final") {
        for (const it of items) expectedMap[it.itemName] = it.expectedQty ?? null;
      } else {
        const live = await computeWarehouseOnHand(count.warehouse as Warehouse, count.countDate);
        for (const it of live.items) expectedMap[it.itemName] = it.onHand;
      }

      // Compute variance summary (same logic as dashboard endpoint).
      let itemsWithVariance = 0;
      let varianceNet = 0;
      let varianceAbs = 0;
      for (const it of items) {
        const exp = expectedMap[it.itemName];
        if (exp != null) {
          const diff = it.qty - exp;
          if (diff !== 0) itemsWithVariance++;
          varianceNet += diff;
          varianceAbs += Math.abs(diff);
        }
      }

      // Build CSV identical in shape to the client download (metadata header + rows).
      const isFinal = count.status === "final";
      const esc = (v: unknown) => {
        let s = v == null ? "" : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const titleCaseW = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const lines: string[] = [];
      lines.push(`# Warehouse count export`);
      lines.push(`# Warehouse,${esc(titleCaseW(count.warehouse))}`);
      lines.push(`# Count date,${esc(count.countDate)}`);
      lines.push(`# Status,${esc(isFinal ? "Finalized" : "Draft")}`);
      lines.push(`# Started by,${esc(count.createdByName || "")}`);
      lines.push(`# Finalized by,${esc(count.finalizedByName || "")}`);
      // Match client export: client receives finalizedAt as the JSON-serialized
      // ISO string, so normalize Date objects here to keep CSVs byte-identical.
      const finalizedAtStr = count.finalizedAt
        ? (count.finalizedAt instanceof Date ? count.finalizedAt.toISOString() : String(count.finalizedAt))
        : "";
      lines.push(`# Finalized at,${esc(finalizedAtStr)}`);
      lines.push(`# Expected source,${esc(isFinal ? "snapshot at finalize" : "live system")}`);
      lines.push(`# Exported at,${esc(new Date().toISOString())}`);
      lines.push("");
      lines.push(["Group", "Item", "Expected", "Counted", "Variance"].join(","));
      for (const cat of WAREHOUSE_INVENTORY_CATEGORIES) {
        for (const itemName of cat.items) {
          const row = items.find(i => i.itemName === itemName);
          const counted = row?.qty ?? 0;
          const expected = expectedMap[itemName];
          const variance = expected != null ? counted - expected : null;
          lines.push([
            esc(cat.group),
            esc(itemName),
            expected == null ? "" : String(expected),
            String(counted),
            variance == null ? "" : String(variance),
          ].join(","));
        }
      }
      const csvBody = "\uFEFF" + lines.join("\r\n") + "\r\n";
      const csvBase64 = Buffer.from(csvBody, "utf-8").toString("base64");
      const safeWarehouse = count.warehouse.replace(/[^a-z0-9-]+/gi, "-");
      const csvFilename = `warehouse-count-${safeWarehouse}-${count.countDate}.csv`;

      // Resolve recipients ONLY from per-warehouse settings (no caller override).
      let recipients: string[] = [];
      const settings = await storage.getGlobalSettings();
      const raw = count.warehouse === "cleveland"
        ? settings?.warehouseVarianceEmailsCleveland
        : count.warehouse === "canton"
          ? settings?.warehouseVarianceEmailsCanton
          : null;
      if (raw) {
        recipients = raw.split(",").map(s => s.trim()).filter(Boolean);
      }
      if (recipients.length === 0) {
        return res.status(400).json({
          message: `No variance email recipients configured for the ${titleCaseW(count.warehouse)} warehouse. Add them in Settings → Notifications.`,
        });
      }

      const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "https";
      const host = req.get("host") || "";
      const appUrl = `${proto}://${host}`;

      const result = await sendWarehouseVarianceCsvEmail(recipients, {
        countId: id,
        warehouse: count.warehouse,
        countDate: count.countDate,
        status: isFinal ? "final" : "draft",
        finalizedByName: count.finalizedByName ?? null,
        finalizedAt: count.finalizedAt ? new Date(count.finalizedAt).toISOString() : null,
        createdByName: count.createdByName ?? null,
        itemsWithVariance,
        varianceNet,
        varianceAbs,
        appUrl,
        csvBase64,
        csvFilename,
        triggeredByName: user.name,
      });
      if (!result.success) {
        return res.status(502).json({ message: result.error || "Email failed to send" });
      }
      res.json({ success: true, recipients });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[WarehouseInventory] Email CSV error:", err);
      res.status(500).json({ message: err?.message || "Failed to email CSV" });
    }
  });

  // Detail (count + items + prior count for comparison)
  app.get("/api/warehouse-inventory/:id", requireAccess, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      const items = await storage.getWarehouseInventoryCountItems(id);
      const prior = await storage.getLatestWarehouseInventoryCount(count.warehouse, count.countDate);
      const priorItems = prior
        ? await storage.getWarehouseInventoryCountItems(prior.id)
        : [];
      // For draft (non-final) counts, include a live system-expected map so the
      // UI can show real-time variance (counted vs system) per item. For final
      // counts, the snapshotted expectedQty on each item row is authoritative.
      let expectedMap: Record<string, number> | undefined;
      if (count.status !== "final") {
        const live = await computeWarehouseOnHand(count.warehouse, count.countDate);
        expectedMap = {};
        for (const it of live.items) expectedMap[it.itemName] = it.onHand;
      }
      // Whether per-warehouse variance email recipients are configured. Used by
      // the UI to disable the "Email CSV" button (and tooltip the reason) when
      // no recipients exist for this warehouse.
      const settings = await storage.getGlobalSettings();
      const recipientsRaw = count.warehouse === "cleveland"
        ? settings?.warehouseVarianceEmailsCleveland
        : count.warehouse === "canton"
          ? settings?.warehouseVarianceEmailsCanton
          : null;
      const hasEmailRecipients = !!(recipientsRaw && recipientsRaw.split(",").some(s => s.trim().length > 0));
      res.json({
        count,
        items,
        prior,
        priorItems,
        categories: WAREHOUSE_INVENTORY_CATEGORIES,
        expectedMap,
        hasEmailRecipients,
      });
    } catch (err) {
      console.error("[WarehouseInventory] Detail error:", err);
      res.status(500).json({ message: "Failed to load count" });
    }
  });

  // Create
  app.post("/api/warehouse-inventory", requireEdit, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const input = createSchema.parse(req.body);

      const existing = await storage.getWarehouseInventoryCountByWarehouseDate(
        input.warehouse,
        input.countDate,
      );
      if (existing) {
        return res.status(409).json({
          message: "A count already exists for this warehouse and date.",
          existingId: existing.id,
        });
      }

      let copyFromCountId: number | undefined = input.copyFromCountId;
      if (copyFromCountId) {
        // Ensure the source count belongs to the same warehouse
        const src = await storage.getWarehouseInventoryCount(copyFromCountId);
        if (!src || src.warehouse !== input.warehouse) {
          return res.status(400).json({ message: "copyFromCountId must belong to the same warehouse" });
        }
      } else if (input.copyFromLatest !== false && input.prefillFromEngine === false) {
        const prior = await storage.getLatestWarehouseInventoryCount(input.warehouse);
        if (prior) copyFromCountId = prior.id;
      }

      // Default behavior: use engine pre-fill (running on-hand) unless explicitly disabled
      let prefillFromEngine: { qty: Record<string, number>; expected: Record<string, number> } | undefined;
      if (input.prefillFromEngine !== false && !copyFromCountId) {
        const onHand = await computeWarehouseOnHand(input.warehouse as Warehouse, input.countDate);
        const qty: Record<string, number> = {};
        const expected: Record<string, number> = {};
        for (const it of onHand.items) {
          qty[it.itemName] = Math.max(0, it.onHand);
          expected[it.itemName] = it.onHand;
        }
        prefillFromEngine = { qty, expected };
      }

      const { copyFromCountId: _a, copyFromLatest: _b, prefillFromEngine: _c, ...baseInput } = input;
      const created = await storage.createWarehouseInventoryCount(
        baseInput as any,
        user,
        copyFromCountId ? { copyFromCountId } : prefillFromEngine ? { prefillFromEngine } : undefined,
      );
      res.status(201).json(created);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      // Map unique constraint violation to 409
      if (err?.code === "23505" || /unique/i.test(err?.message || "")) {
        return res.status(409).json({ message: "A count already exists for this warehouse and date." });
      }
      console.error("[WarehouseInventory] Create error:", err);
      res.status(500).json({ message: "Failed to create count" });
    }
  });

  // Update header (notes, date)
  app.put("/api/warehouse-inventory/:id", requireEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      if (count.status === "final") {
        return res.status(409).json({ message: "Finalized counts cannot be edited. Reopen first." });
      }
      const input = updateSchema.parse(req.body);
      // Guard countDate uniqueness
      if (input.countDate && input.countDate !== count.countDate) {
        const clash = await storage.getWarehouseInventoryCountByWarehouseDate(count.warehouse, input.countDate);
        if (clash && clash.id !== id) {
          return res.status(409).json({ message: "A count already exists for this warehouse and date." });
        }
      }
      const updated = await storage.updateWarehouseInventoryCount(id, input as any);
      if (!updated) {
        // Race: finalized between check and update
        return res.status(409).json({ message: "Finalized counts cannot be edited. Reopen first." });
      }
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err?.code === "23505") {
        return res.status(409).json({ message: "A count already exists for this warehouse and date." });
      }
      console.error("[WarehouseInventory] Update error:", err);
      res.status(500).json({ message: "Failed to update count" });
    }
  });

  // Per-count audit history (per-item qty edits + finalize/reopen events).
  // Returned newest-first so the UI shows the most recent change at the top.
  app.get("/api/warehouse-inventory/:id/history", requireAccess, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      const audits = await storage.getWarehouseInventoryAudits(id);
      res.json(audits);
    } catch (err) {
      console.error("[WarehouseInventory] History error:", err);
      res.status(500).json({ message: "Failed to load count history" });
    }
  });

  // Bulk update item quantities
  app.put("/api/warehouse-inventory/:id/items", requireEdit, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      if (count.status === "final") {
        return res.status(409).json({ message: "Finalized counts cannot be edited. Reopen first." });
      }
      const { items } = itemsUpdateSchema.parse(req.body);
      const updated = await storage.updateWarehouseInventoryItems(id, items, user);
      if (updated === null) {
        // Race: finalized between check and tx
        return res.status(409).json({ message: "Finalized counts cannot be edited. Reopen first." });
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[WarehouseInventory] Items update error:", err);
      res.status(500).json({ message: "Failed to update items" });
    }
  });

  // Finalize
  app.post("/api/warehouse-inventory/:id/finalize", requireFinalize, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      if (count.status === "final") return res.json(count);
      // Snapshot expected qty (for over/under variance) RIGHT BEFORE finalizing,
      // using the engine state at the count's date — excluding this draft from
      // the engine result by definition (baseline = most recent FINAL).
      const onHand = await computeWarehouseOnHand(count.warehouse as Warehouse, count.countDate);
      const expected: Record<string, number> = {};
      for (const it of onHand.items) expected[it.itemName] = it.onHand;
      await storage.snapshotExpectedQtys(id, expected);
      const updated = await storage.finalizeWarehouseInventoryCount(id, user);
      res.json(updated);
    } catch (err) {
      console.error("[WarehouseInventory] Finalize error:", err);
      res.status(500).json({ message: "Failed to finalize count" });
    }
  });

  // Reopen — gated by warehouse_inventory.finalize feature (admin/manager by default,
  // plus any custom role granted that feature).
  app.post("/api/warehouse-inventory/:id/reopen", requireFinalize, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      const updated = await storage.reopenWarehouseInventoryCount(id, user);
      res.json(updated);
    } catch (err) {
      console.error("[WarehouseInventory] Reopen error:", err);
      res.status(500).json({ message: "Failed to reopen count" });
    }
  });

  // Delete (admin only)
  app.delete("/api/warehouse-inventory/:id", requireAccess, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required to delete counts" });
      }
      const id = Number(req.params.id);
      await storage.deleteWarehouseInventoryCount(id);
      res.status(204).send();
    } catch (err) {
      console.error("[WarehouseInventory] Delete error:", err);
      res.status(500).json({ message: "Failed to delete count" });
    }
  });
}

function csv(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// CSV cell that also defuses spreadsheet formula injection. Cells starting
// with =, +, -, @, tab, or carriage return are prefixed with a single quote
// so Excel/Sheets/Numbers treats them as text instead of formulas.
function csvSafe(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
