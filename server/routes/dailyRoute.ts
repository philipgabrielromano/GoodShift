import type { Express, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import ExcelJS from "exceljs";
import { z } from "zod";
import { mysqlPool } from "../mysql";
import { requireFeatureAccess } from "../middleware";
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { truckRoutes, truckRouteLocations, locations, WAREHOUSES, WAREHOUSE_LABELS } from "@shared/schema";

// Allowed origin labels for manifests created from a daily route. The route
// is always Warehouse → store stops, so only the two warehouses are valid
// "From" locations. Kept as a Set for O(1) membership checks.
const WAREHOUSE_LOCATION_LABELS = new Set<string>(WAREHOUSES.map(w => WAREHOUSE_LABELS[w]));

// All "requested" fields the order form collects, grouped for the matrix
// rows. Order is meaningful (it's how rows render top-to-bottom in both the
// GUI and the Excel export). Snake-case names match the MySQL columns.
type DailyField = {
  key: string;        // camelCase for JSON / React keys
  snake: string;      // MySQL column name
  label: string;
  category: string;
};

const DAILY_FIELDS: DailyField[] = [
  // Equipment
  { key: "totesRequested",       snake: "totes_requested",       label: "Totes",          category: "Equipment" },
  { key: "durosRequested",       snake: "duros_requested",       label: "Duros",          category: "Equipment" },
  { key: "blueBinsRequested",    snake: "blue_bins_requested",   label: "Blue Bins",      category: "Equipment" },
  { key: "gaylordsRequested",    snake: "gaylords_requested",    label: "Gaylords",       category: "Equipment" },
  { key: "palletsRequested",     snake: "pallets_requested",     label: "Pallets",        category: "Equipment" },
  { key: "containersRequested",  snake: "containers_requested",  label: "Containers",     category: "Equipment" },

  // Specific gaylords
  { key: "apparelGaylordsRequested",     snake: "apparel_gaylords_requested",     label: "Apparel Gaylords",     category: "Gaylords (Specific)" },
  { key: "waresGaylordsRequested",       snake: "wares_gaylords_requested",       label: "Wares Gaylords",       category: "Gaylords (Specific)" },
  { key: "electricalGaylordsRequested",  snake: "electrical_gaylords_requested",  label: "Electrical Gaylords",  category: "Gaylords (Specific)" },
  { key: "accessoriesGaylordsRequested", snake: "accessories_gaylords_requested", label: "Accessories Gaylords", category: "Gaylords (Specific)" },
  { key: "booksGaylordsRequested",       snake: "books_gaylords_requested",       label: "Books Gaylords",       category: "Gaylords (Specific)" },
  { key: "shoesGaylordsRequested",       snake: "shoes_gaylords_requested",       label: "Shoes Gaylords",       category: "Gaylords (Specific)" },
  { key: "furnitureGaylordsRequested",   snake: "furniture_gaylords_requested",   label: "Furniture Gaylords",   category: "Gaylords (Specific)" },

  // Seasonal
  { key: "savedWinterRequested",     snake: "saved_winter_requested",     label: "Saved Winter",     category: "Seasonal" },
  { key: "savedSummerRequested",     snake: "saved_summer_requested",     label: "Saved Summer",     category: "Seasonal" },
  { key: "savedHalloweenRequested",  snake: "saved_halloween_requested",  label: "Saved Halloween",  category: "Seasonal" },
  { key: "savedChristmasRequested",  snake: "saved_christmas_requested",  label: "Saved Christmas",  category: "Seasonal" },

  // Production / donors
  { key: "apparelProduction", snake: "apparel_production", label: "Apparel Production", category: "Production" },
  { key: "waresProduction",   snake: "wares_production",   label: "Wares Production",   category: "Production" },
  { key: "donors",            snake: "donors",             label: "Donors",             category: "Production" },
];

interface DailyRouteOrderRow extends RowDataPacket {
  id: number;
  location: string;
  status: string;
  // All the requested columns we care about — we SELECT * for simplicity since
  // the row size is bounded.
  [key: string]: unknown;
}

interface RouteStopShape {
  locationId: number;
  locationName: string;     // canonical name (locations.name)
  matchKey: string;         // what orders.location stores (orderFormName ?? name)
  sequence: number;
}

interface RouteShape {
  id: number;
  name: string;
  isActive: boolean;
  stops: RouteStopShape[];
}

interface DailyStop {
  locationId: number | null; // null for unrouted matches
  locationName: string;      // shown in column header
  orderId: number | null;    // null if no order from this stop today
  values: Record<string, number>; // fieldKey -> qty (0 if missing)
}

interface DailyRouteGroup {
  routeId: number | null;    // null for the "Unrouted" group
  routeName: string;
  stops: DailyStop[];
}

interface DailyRouteData {
  date: string;
  fields: DailyField[];
  groups: DailyRouteGroup[];
  totalOrders: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Normalize a location string for matching orders.location against route
// stop match keys. Lower-cases, trims, and collapses internal whitespace so
// minor casing/spacing drift between the orders table and the routes config
// (e.g. "Strongsville " vs "strongsville") still matches the right route
// instead of falling into the "Unrouted" bucket.
function normalizeKey(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadRoutes(): Promise<RouteShape[]> {
  // Fetch all routes (active first, then by name) with their stops in
  // sequence order. We pull orderFormName here so we can match orders.location
  // (which stores orderFormName ?? name, not just name).
  const routes = await db
    .select()
    .from(truckRoutes)
    .orderBy(truckRoutes.isActive, truckRoutes.name);

  if (routes.length === 0) return [];

  const stops = await db
    .select({
      routeId: truckRouteLocations.routeId,
      locationId: truckRouteLocations.locationId,
      sequence: truckRouteLocations.sequence,
      name: locations.name,
      orderFormName: locations.orderFormName,
    })
    .from(truckRouteLocations)
    .leftJoin(locations, eq(truckRouteLocations.locationId, locations.id));

  const stopsByRoute = new Map<number, RouteStopShape[]>();
  for (const s of stops) {
    const arr = stopsByRoute.get(s.routeId) || [];
    const fallbackName = s.name ?? `(deleted location #${s.locationId})`;
    arr.push({
      locationId: s.locationId,
      locationName: fallbackName,
      matchKey: (s.orderFormName ?? s.name ?? fallbackName) as string,
      sequence: s.sequence,
    });
    stopsByRoute.set(s.routeId, arr);
  }

  return routes
    .filter(r => r.isActive)
    .map(r => ({
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      stops: (stopsByRoute.get(r.id) || []).sort(
        (a, b) => a.sequence - b.sequence || a.locationName.localeCompare(b.locationName),
      ),
    }));
}

async function loadDailyRouteData(date: string): Promise<DailyRouteData> {
  const routes = await loadRoutes();

  // SELECT only the columns we need (id, location, and every requested field)
  // for the day's approved Transfer-and-Receive orders. Submitted/Denied are
  // excluded because the operator only routes what's actually going out.
  const requestedCols = DAILY_FIELDS.map(f => f.snake).join(", ");
  const sql = `
    SELECT id, location, status, ${requestedCols}
    FROM orders
    WHERE order_date = ?
      AND order_type = 'Transfer and Receive'
      AND status = 'approved'
    ORDER BY location ASC, id ASC
  `;
  const [rows] = await mysqlPool.query<DailyRouteOrderRow[]>(sql, [date]);

  // Map orders by their normalized location string. If a location somehow
  // has multiple approved Transfer-and-Receive orders for the same day, sum
  // the requested values so the matrix shows the combined draw on the truck.
  // We retain the original (display) name so unrouted rows show the human
  // form rather than the lower-cased key.
  const ordersByLocation = new Map<string, { displayName: string; ids: number[]; values: Record<string, number> }>();
  for (const row of rows) {
    const display = String(row.location || "").trim();
    const key = normalizeKey(display);
    if (!key) continue;
    let bucket = ordersByLocation.get(key);
    if (!bucket) {
      bucket = { displayName: display, ids: [], values: {} };
      for (const f of DAILY_FIELDS) bucket.values[f.key] = 0;
      ordersByLocation.set(key, bucket);
    }
    bucket.ids.push(Number(row.id));
    for (const f of DAILY_FIELDS) {
      const raw = row[f.snake];
      const n = typeof raw === "number" ? raw : raw == null ? 0 : Number(raw);
      bucket.values[f.key] += Number.isFinite(n) ? n : 0;
    }
  }

  // Track which order locations we've assigned to a route so we can collect
  // the rest into the "Unrouted" group.
  const claimed = new Set<string>();
  const groups: DailyRouteGroup[] = [];

  for (const route of routes) {
    const stops: DailyStop[] = route.stops.map(stop => {
      const stopKey = normalizeKey(stop.matchKey);
      const bucket = ordersByLocation.get(stopKey);
      if (bucket) claimed.add(stopKey);
      const values: Record<string, number> = {};
      for (const f of DAILY_FIELDS) values[f.key] = bucket?.values[f.key] ?? 0;
      return {
        locationId: stop.locationId,
        // Show the canonical name in the column header — operators recognize
        // this from the routes config, not the order-form alias.
        locationName: stop.locationName,
        // If the same location has 2+ orders, expose the first id (the GUI
        // can fetch others via /orders if needed). For Excel we just need a
        // qty, so this is fine.
        orderId: bucket?.ids[0] ?? null,
        values,
      };
    });
    groups.push({ routeId: route.id, routeName: route.name, stops });
  }

  // Anything left over: orders whose location string didn't match any active
  // route's match key. These still need to be visible to the operator —
  // hiding them silently would lose orders.
  const unrouted: DailyStop[] = [];
  ordersByLocation.forEach((bucket, key) => {
    if (claimed.has(key)) return;
    const values: Record<string, number> = {};
    for (const f of DAILY_FIELDS) values[f.key] = bucket.values[f.key];
    unrouted.push({
      locationId: null,
      locationName: bucket.displayName,
      orderId: bucket.ids[0],
      values,
    });
  });
  unrouted.sort((a, b) => a.locationName.localeCompare(b.locationName));
  if (unrouted.length > 0) {
    groups.push({ routeId: null, routeName: "Unrouted", stops: unrouted });
  }

  return {
    date,
    fields: DAILY_FIELDS,
    groups,
    totalOrders: rows.length,
  };
}

function buildWorkbook(data: DailyRouteData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GoodShift";
  wb.created = new Date();

  const ws = wb.addWorksheet(`Daily Route ${data.date}`, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
  });

  // Aggregate stops by location: one row per location, summing equipment
  // quantities across any orders that hit that location on the date. Route
  // grouping is intentionally collapsed — operators want a single
  // location × equipment grid, not a per-route breakdown.
  type LocRow = { locationName: string; values: Record<string, number> };
  const byName = new Map<string, LocRow>();
  const locationOrder: string[] = [];
  for (const g of data.groups) {
    for (const stop of g.stops) {
      const existing = byName.get(stop.locationName);
      if (existing) {
        for (const [k, v] of Object.entries(stop.values)) {
          existing.values[k] = (existing.values[k] ?? 0) + Number(v ?? 0);
        }
      } else {
        byName.set(stop.locationName, {
          locationName: stop.locationName,
          values: { ...stop.values },
        });
        locationOrder.push(stop.locationName);
      }
    }
  }
  const locationRows: LocRow[] = locationOrder.map(n => byName.get(n)!);

  // Group fields by category so we can write category band headers that
  // span their equipment columns (matches the GUI layout).
  const sections: Array<{ category: string; fields: DailyField[] }> = [];
  {
    let current: { category: string; fields: DailyField[] } | null = null;
    for (const f of data.fields) {
      if (!current || current.category !== f.category) {
        current = { category: f.category, fields: [f] };
        sections.push(current);
      } else {
        current.fields.push(f);
      }
    }
  }
  const allFields = sections.flatMap(s => s.fields);
  const totalCol = 2 + allFields.length; // col 1 = Location, then one col per field, then Total

  // Row 1: Title
  ws.getCell(1, 1).value = `Daily Route — ${data.date}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, Math.max(totalCol, 1));

  // Row 2: Category band — each category name spans its equipment columns.
  // We apply fill + borders to every cell in the merged range, not just the
  // top-left, because exceljs only renders borders on individual cells —
  // not the conceptual merged range — so without this the right edge of a
  // multi-column category band ends up missing.
  let cursor = 2;
  for (const section of sections) {
    const startCol = cursor;
    const endCol = cursor + section.fields.length - 1;
    const cell = ws.getCell(2, startCol);
    cell.value = section.category;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
    if (endCol > startCol) ws.mergeCells(2, startCol, 2, endCol);
    for (let c = startCol; c <= endCol; c += 1) {
      const cc = ws.getCell(2, c);
      cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      cc.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: "thin" }, right: { style: "thin" },
      };
    }
    cursor = endCol + 1;
  }
  // Style the Total cell on row 2 to match the band.
  if (allFields.length > 0) {
    const tc = ws.getCell(2, totalCol);
    tc.value = "";
    tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    tc.border = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
  }

  // Row 3: Column headers (Location | each equipment field | Total)
  ws.getCell(3, 1).value = "Location";
  ws.getCell(3, 1).font = { bold: true };
  allFields.forEach((field, i) => {
    const c = ws.getCell(3, 2 + i);
    c.value = field.label;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", wrapText: true };
  });
  ws.getCell(3, totalCol).value = "Total";
  ws.getCell(3, totalCol).font = { bold: true };
  ws.getCell(3, totalCol).alignment = { horizontal: "center" };

  // Body: one row per location. Track per-equipment running totals so we
  // can emit a "Grand Total" row at the bottom.
  const colTotals: number[] = allFields.map(() => 0);
  let grandTotal = 0;
  let row = 4;
  for (const locRow of locationRows) {
    ws.getCell(row, 1).value = locRow.locationName;
    let rowTotal = 0;
    allFields.forEach((field, i) => {
      const v = Number(locRow.values[field.key] ?? 0);
      const cell = ws.getCell(row, 2 + i);
      cell.value = v === 0 ? null : v;
      cell.alignment = { horizontal: "right" };
      rowTotal += v;
      colTotals[i] += v;
    });
    const tc = ws.getCell(row, totalCol);
    tc.value = rowTotal === 0 ? null : rowTotal;
    tc.font = { bold: true };
    tc.alignment = { horizontal: "right" };
    grandTotal += rowTotal;
    row += 1;
  }

  // Grand totals row (bold, light-gray fill, top border) so the operator
  // can sight-read totals per equipment column and overall in a glance.
  if (locationRows.length > 0) {
    const labelCell = ws.getCell(row, 1);
    labelCell.value = "Total";
    labelCell.font = { bold: true };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    labelCell.border = { top: { style: "medium" } };
    allFields.forEach((_, i) => {
      const cell = ws.getCell(row, 2 + i);
      const v = colTotals[i];
      cell.value = v === 0 ? null : v;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "right" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      cell.border = { top: { style: "medium" } };
    });
    const gtc = ws.getCell(row, totalCol);
    gtc.value = grandTotal === 0 ? null : grandTotal;
    gtc.font = { bold: true };
    gtc.alignment = { horizontal: "right" };
    gtc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    gtc.border = { top: { style: "medium" } };
  }

  // Column widths
  ws.getColumn(1).width = 28;
  for (let i = 0; i < allFields.length; i++) ws.getColumn(2 + i).width = 14;
  ws.getColumn(totalCol).width = 12;

  return wb;
}

export function registerDailyRouteRoutes(app: Express) {
  app.get(
    "/api/daily-route",
    requireFeatureAccess("orders.view_all"),
    async (req, res) => {
      try {
        const date = String(req.query.date || "").trim();
        if (!DATE_RE.test(date)) {
          return res.status(400).json({ message: "date must be YYYY-MM-DD" });
        }
        const data = await loadDailyRouteData(date);
        res.json(data);
      } catch (err) {
        console.error("[DailyRoute] Load error:", err);
        res.status(500).json({ message: "Failed to load daily route" });
      }
    },
  );

  // POST /api/daily-route/create-manifest
  // Body: { date, routeId, fromLocation, notes? }
  // Pre-fills a trailer manifest from one route's aggregated daily-route
  // data. Refuses to create a duplicate when a manifest for the same
  // (routeId, date) already exists; the response includes the existing
  // manifest's id so the client can link to it.
  app.post(
    "/api/daily-route/create-manifest",
    requireFeatureAccess("trailer_manifest.edit"),
    async (req, res) => {
      try {
        const user = getSessionUser(req);
        if (!user) return res.status(401).json({ message: "Authentication required" });

        const parsed = createManifestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: parsed.error.errors[0].message });
        }
        const { date, routeId, fromLocation, notes } = parsed.data;

        // Reload the same data the screen uses so quantities can never drift
        // between what the operator sees and what gets written.
        const data = await loadDailyRouteData(date);
        const group = data.groups.find(g => g.routeId === routeId);
        if (!group) {
          return res.status(400).json({
            message: "That route has no orders on this date — nothing to put on a manifest.",
          });
        }

        const itemQuantities = aggregateRouteAsManifestItems(group);
        const totalQty = Object.values(itemQuantities).reduce((s, n) => s + n, 0);
        if (totalQty === 0) {
          return res.status(400).json({
            message: "That route has no equipment quantities on this date — nothing to pre-fill.",
          });
        }

        const result = await storage.createTrailerManifestFromDailyRoute({
          forDate: date,
          fromLocation,
          // The route is the destination as a whole; the manifest's free-text
          // toLocation gets the route's name so list views read naturally
          // (e.g. "Cleveland Warehouse → Lakewood Route"). Individual stops
          // are still recoverable via the routeId / route detail page.
          toLocation: group.routeName,
          routeId,
          notes: notes ?? null,
          itemQuantities,
          user,
        });

        if (result.existingManifestId) {
          return res.status(409).json({
            message: "A trailer manifest for this route and date already exists.",
            existingManifestId: result.existingManifestId,
          });
        }

        return res.status(201).json({ id: result.created!.id });
      } catch (err: any) {
        if (typeof err?.message === "string" && err.message.startsWith("Unknown routeId")) {
          return res.status(400).json({ message: err.message });
        }
        console.error("[DailyRoute] Create manifest error:", err);
        res.status(500).json({ message: "Failed to create manifest from daily route" });
      }
    },
  );

  app.get(
    "/api/daily-route/export",
    requireFeatureAccess("orders.view_all"),
    async (req, res: Response) => {
      try {
        const date = String(req.query.date || "").trim();
        if (!DATE_RE.test(date)) {
          return res.status(400).json({ message: "date must be YYYY-MM-DD" });
        }
        const data = await loadDailyRouteData(date);
        const wb = buildWorkbook(data);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="daily-route-${date}.xlsx"`,
        );
        await wb.xlsx.write(res);
        res.end();
      } catch (err) {
        console.error("[DailyRoute] Export error:", err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Failed to export daily route" });
        } else {
          res.end();
        }
      }
    },
  );
}

// Mapping from daily-route field keys to trailer-manifest item names. Only
// fields we can map confidently are listed — production / seasonal / donor
// rows have no clean equivalent in TRAILER_MANIFEST_CATEGORIES, so we
// deliberately leave them unmapped (the manifest detail page exposes every
// item for the operator to fill in by hand).
//
// Multiple daily-route fields can map to the same manifest item (e.g. all
// the per-category gaylord requests sum into "Empty Gaylords"). The
// aggregator below honors that automatically.
const FIELD_TO_MANIFEST_ITEM: Record<string, string> = {
  totesRequested:               "Empty Totes",
  durosRequested:               "Empty Duros",
  blueBinsRequested:            "Empty Blue Bins",
  gaylordsRequested:            "Empty Gaylords",
  palletsRequested:             "Empty Pallets",
  containersRequested:          "Empty Containers",
  apparelGaylordsRequested:     "Empty Gaylords",
  waresGaylordsRequested:       "Empty Gaylords",
  electricalGaylordsRequested:  "Empty Gaylords",
  accessoriesGaylordsRequested: "Empty Gaylords",
  booksGaylordsRequested:       "Empty Gaylords",
  shoesGaylordsRequested:       "Empty Gaylords",
  furnitureGaylordsRequested:   "Empty Gaylords",
};

// Sum every stop's per-field quantities for one route group, then translate
// into manifest item names. Returns {itemName: qty}. Only items with a
// non-zero total are included so the caller can show a meaningful preview.
function aggregateRouteAsManifestItems(group: DailyRouteGroup): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const stop of group.stops) {
    for (const [fieldKey, manifestItem] of Object.entries(FIELD_TO_MANIFEST_ITEM)) {
      const v = Number(stop.values[fieldKey] ?? 0);
      if (!Number.isFinite(v) || v <= 0) continue;
      totals[manifestItem] = (totals[manifestItem] ?? 0) + v;
    }
  }
  return totals;
}

const createManifestSchema = z.object({
  date: z.string().regex(DATE_RE, "date must be YYYY-MM-DD"),
  routeId: z.number().int().positive(),
  fromLocation: z
    .string()
    .trim()
    .min(1, "fromLocation is required")
    .max(200)
    // Defense in depth: the client only offers warehouse options, but reject
    // anything else here too so a hand-crafted POST can't bypass it.
    .refine(v => WAREHOUSE_LOCATION_LABELS.has(v), {
      message: `fromLocation must be one of: ${Array.from(WAREHOUSE_LOCATION_LABELS).join(", ")}`,
    }),
  notes: z.string().trim().max(500).nullable().optional(),
});

function getSessionUser(req: Request): { id: number; name: string } | null {
  const u = (req.session as any)?.user;
  if (!u) return null;
  return { id: u.id, name: u.name || u.email || "Unknown" };
}

// Keep the helper accessible for other routes (e.g., a future
// "create manifests from this route" endpoint can re-use the same loader so
// we don't drift between the screen view and the manifest source data).
export { loadDailyRouteData, DAILY_FIELDS };
export type { DailyRouteData, DailyRouteGroup, DailyStop, DailyField };
