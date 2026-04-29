import type { Express, Response } from "express";
import type { RowDataPacket } from "mysql2";
import ExcelJS from "exceljs";
import { mysqlPool } from "../mysql";
import { requireFeatureAccess } from "../middleware";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { truckRoutes, truckRouteLocations, locations } from "@shared/schema";

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

  // Flatten stops so each store gets its own column. We also remember which
  // column starts/ends each route so we can write the route header row across
  // them.
  const flatStops: Array<{ groupIdx: number; stop: DailyStop }> = [];
  const groupCols: Array<{ groupIdx: number; startCol: number; endCol: number; routeName: string }> = [];

  let cursor = 2; // col 1 = item label
  data.groups.forEach((g, gi) => {
    if (g.stops.length === 0) return;
    const startCol = cursor;
    g.stops.forEach(s => {
      flatStops.push({ groupIdx: gi, stop: s });
      cursor += 1;
    });
    groupCols.push({ groupIdx: gi, startCol, endCol: cursor - 1, routeName: g.routeName });
  });
  const totalCol = cursor;

  // Row 1: Title
  ws.getCell(1, 1).value = `Daily Route — ${data.date}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, Math.max(totalCol, 1));

  // Row 2: Route header band (each route's name spans its store columns).
  // We apply fill + borders to every cell in the merged range, not just the
  // top-left, because exceljs only renders the visible border on individual
  // cells — not the conceptual range — so without this the right edge of a
  // multi-store route band ends up missing.
  groupCols.forEach(g => {
    const cell = ws.getCell(2, g.startCol);
    cell.value = g.routeName;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
    if (g.endCol > g.startCol) ws.mergeCells(2, g.startCol, 2, g.endCol);
    for (let c = g.startCol; c <= g.endCol; c += 1) {
      const cc = ws.getCell(2, c);
      cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      cc.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: "thin" }, right: { style: "thin" },
      };
    }
  });
  if (totalCol > 1) {
    const tc = ws.getCell(2, totalCol);
    tc.value = "";
    tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    tc.border = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
  }

  // Row 3: Column headers (Item | each store name | Total)
  ws.getCell(3, 1).value = "Item";
  ws.getCell(3, 1).font = { bold: true };
  flatStops.forEach((entry, i) => {
    const c = ws.getCell(3, 2 + i);
    c.value = entry.stop.locationName;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", wrapText: true };
  });
  ws.getCell(3, totalCol).value = "Total";
  ws.getCell(3, totalCol).font = { bold: true };
  ws.getCell(3, totalCol).alignment = { horizontal: "center" };

  // Item rows. Render in the same category order as DAILY_FIELDS (the array
  // is intentionally ordered). Track per-store running totals so we can
  // emit a "Grand Total" row at the bottom.
  const colTotals: number[] = flatStops.map(() => 0);
  let grandTotal = 0;
  let row = 4;
  let lastCategory = "";
  for (const field of data.fields) {
    if (field.category !== lastCategory) {
      // Category divider row
      const catCell = ws.getCell(row, 1);
      catCell.value = field.category;
      catCell.font = { bold: true, italic: true };
      catCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      if (totalCol > 1) ws.mergeCells(row, 1, row, totalCol);
      row += 1;
      lastCategory = field.category;
    }

    ws.getCell(row, 1).value = field.label;
    let rowTotal = 0;
    flatStops.forEach((entry, i) => {
      const v = entry.stop.values[field.key] ?? 0;
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
  // can sight-read truck totals per store and overall in a single glance.
  if (flatStops.length > 0) {
    const labelCell = ws.getCell(row, 1);
    labelCell.value = "Total";
    labelCell.font = { bold: true };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    labelCell.border = { top: { style: "medium" } };
    flatStops.forEach((_, i) => {
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
  for (let i = 0; i < flatStops.length; i++) ws.getColumn(2 + i).width = 14;
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

// Keep the helper accessible for other routes (e.g., a future
// "create manifests from this route" endpoint can re-use the same loader so
// we don't drift between the screen view and the manifest source data).
export { loadDailyRouteData, DAILY_FIELDS };
export type { DailyRouteData, DailyRouteGroup, DailyStop, DailyField };
