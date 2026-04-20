import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireFeatureAccess } from "../middleware";
import {
  insertWarehouseInventoryCountSchema,
  WAREHOUSE_INVENTORY_CATEGORIES,
  WAREHOUSES,
} from "@shared/schema";

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

export function registerWarehouseInventoryRoutes(app: Express) {
  const requireAccess = requireFeatureAccess("warehouse_inventory");

  // Expose category structure + warehouses (for form dropdowns)
  app.get("/api/warehouse-inventory/meta", requireAccess, async (_req, res) => {
    res.json({
      warehouses: WAREHOUSES,
      categories: WAREHOUSE_INVENTORY_CATEGORIES,
      today: todayInTZ(),
    });
  });

  // Leadership dashboard: latest count per warehouse + deltas
  app.get("/api/warehouse-inventory/dashboard", requireAccess, async (_req, res) => {
    try {
      const today = todayInTZ();
      const results = await Promise.all(WAREHOUSES.map(async (w) => {
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
            staleDays: null as number | null,
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

        return { warehouse: w, latest, prior, items, priorItems, totals, priorTotals, delta, staleDays };
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
      // Attach totals per count for list display
      const withTotals = await Promise.all(counts.map(async c => {
        const items = await storage.getWarehouseInventoryCountItems(c.id);
        const total = items.reduce((a, b) => a + b.qty, 0);
        return { ...c, totalItems: total };
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
      res.json({
        count,
        items,
        prior,
        priorItems,
        categories: WAREHOUSE_INVENTORY_CATEGORIES,
      });
    } catch (err) {
      console.error("[WarehouseInventory] Detail error:", err);
      res.status(500).json({ message: "Failed to load count" });
    }
  });

  // Create
  app.post("/api/warehouse-inventory", requireAccess, async (req, res) => {
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
      } else if (input.copyFromLatest !== false) {
        const prior = await storage.getLatestWarehouseInventoryCount(input.warehouse);
        if (prior) copyFromCountId = prior.id;
      }

      const { copyFromCountId: _a, copyFromLatest: _b, ...baseInput } = input;
      const created = await storage.createWarehouseInventoryCount(
        baseInput as any,
        user,
        copyFromCountId ? { copyFromCountId } : undefined,
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
  app.put("/api/warehouse-inventory/:id", requireAccess, async (req, res) => {
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

  // Bulk update item quantities
  app.put("/api/warehouse-inventory/:id/items", requireAccess, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      if (count.status === "final") {
        return res.status(409).json({ message: "Finalized counts cannot be edited. Reopen first." });
      }
      const { items } = itemsUpdateSchema.parse(req.body);
      const updated = await storage.updateWarehouseInventoryItems(id, items);
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
  app.post("/api/warehouse-inventory/:id/finalize", requireAccess, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      if (count.status === "final") return res.json(count);
      const updated = await storage.finalizeWarehouseInventoryCount(id, user);
      res.json(updated);
    } catch (err) {
      console.error("[WarehouseInventory] Finalize error:", err);
      res.status(500).json({ message: "Failed to finalize count" });
    }
  });

  // Reopen — admin/manager only (same gate as feature access is fine; manager can correct)
  app.post("/api/warehouse-inventory/:id/reopen", requireAccess, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers or admins can reopen a finalized count" });
      }
      const id = Number(req.params.id);
      const count = await storage.getWarehouseInventoryCount(id);
      if (!count) return res.status(404).json({ message: "Count not found" });
      const updated = await storage.reopenWarehouseInventoryCount(id);
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
