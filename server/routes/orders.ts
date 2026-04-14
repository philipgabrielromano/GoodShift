import type { Express } from "express";
import { requireManager } from "../middleware";
import { mysqlPool } from "../mysql";
import { z } from "zod";

const nonNegInt = z.number().int().min(0).nullable().optional();

const orderSchema = z.object({
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  orderType: z.enum(["Transfer and Receive", "End of Day/Equipment Count", "Donors", "Supplemental production"]),
  location: z.string().min(1),
  totesRequested: nonNegInt,
  totesReturned: nonNegInt,
  durosRequested: nonNegInt,
  durosReturned: nonNegInt,
  blueBinsRequested: nonNegInt,
  blueBinsReturned: nonNegInt,
  gaylordsRequested: nonNegInt,
  gaylordsReturned: nonNegInt,
  palletsRequested: nonNegInt,
  palletsReturned: nonNegInt,
  containersRequested: nonNegInt,
  containersReturned: nonNegInt,
  apparelGaylordsRequested: nonNegInt,
  apparelGaylordsReturned: nonNegInt,
  waresGaylordsRequested: nonNegInt,
  waresGaylordsReturned: nonNegInt,
  electricalGaylordsRequested: nonNegInt,
  electricalGaylordsReturned: nonNegInt,
  accessoriesGaylordsRequested: nonNegInt,
  accessoriesGaylordsReturned: nonNegInt,
  booksGaylordsRequested: nonNegInt,
  booksGaylordsReturned: nonNegInt,
  shoesGaylordsRequested: nonNegInt,
  shoesGaylordsReturned: nonNegInt,
  savedWinterRequested: nonNegInt,
  savedWinterReturned: nonNegInt,
  savedSummerRequested: nonNegInt,
  savedSummerReturned: nonNegInt,
  savedHalloweenRequested: nonNegInt,
  savedHalloweenReturned: nonNegInt,
  savedChristmasRequested: nonNegInt,
  savedChristmasReturned: nonNegInt,
  fullTotes: nonNegInt,
  emptyTotes: nonNegInt,
  fullGaylords: nonNegInt,
  emptyGaylords: nonNegInt,
  fullDuros: nonNegInt,
  emptyDuros: nonNegInt,
  fullContainers: nonNegInt,
  emptyContainers: nonNegInt,
  fullBlueBins: nonNegInt,
  emptyBlueBins: nonNegInt,
  emptyPallets: nonNegInt,
  outletApparel: nonNegInt,
  outletShoes: nonNegInt,
  outletMetal: nonNegInt,
  outletWares: nonNegInt,
  outletAccessories: nonNegInt,
  outletElectrical: nonNegInt,
  ecomContainersSent: nonNegInt,
  rotatedApparel: nonNegInt,
  rotatedShoes: nonNegInt,
  rotatedBooks: nonNegInt,
  rotatedWares: nonNegInt,
  apparelGaylordsUsed: nonNegInt,
  waresGaylordsUsed: nonNegInt,
  bookGaylordsUsed: nonNegInt,
  shoeGaylordsUsed: nonNegInt,
  donors: nonNegInt,
  isCentralProcessing: z.boolean().nullable().optional(),
  apparelProduction: nonNegInt,
  waresProduction: nonNegInt,
  notes: z.string().max(2000).nullable().optional(),
});

function toSnake(obj: Record<string, any>): Record<string, any> {
  const map: Record<string, string> = {
    orderDate: "order_date",
    orderType: "order_type",
    totesRequested: "totes_requested",
    totesReturned: "totes_returned",
    durosRequested: "duros_requested",
    durosReturned: "duros_returned",
    blueBinsRequested: "blue_bins_requested",
    blueBinsReturned: "blue_bins_returned",
    gaylordsRequested: "gaylords_requested",
    gaylordsReturned: "gaylords_returned",
    palletsRequested: "pallets_requested",
    palletsReturned: "pallets_returned",
    containersRequested: "containers_requested",
    containersReturned: "containers_returned",
    apparelGaylordsRequested: "apparel_gaylords_requested",
    apparelGaylordsReturned: "apparel_gaylords_returned",
    waresGaylordsRequested: "wares_gaylords_requested",
    waresGaylordsReturned: "wares_gaylords_returned",
    electricalGaylordsRequested: "electrical_gaylords_requested",
    electricalGaylordsReturned: "electrical_gaylords_returned",
    accessoriesGaylordsRequested: "accessories_gaylords_requested",
    accessoriesGaylordsReturned: "accessories_gaylords_returned",
    booksGaylordsRequested: "books_gaylords_requested",
    booksGaylordsReturned: "books_gaylords_returned",
    shoesGaylordsRequested: "shoes_gaylords_requested",
    shoesGaylordsReturned: "shoes_gaylords_returned",
    savedWinterRequested: "saved_winter_requested",
    savedWinterReturned: "saved_winter_returned",
    savedSummerRequested: "saved_summer_requested",
    savedSummerReturned: "saved_summer_returned",
    savedHalloweenRequested: "saved_halloween_requested",
    savedHalloweenReturned: "saved_halloween_returned",
    savedChristmasRequested: "saved_christmas_requested",
    savedChristmasReturned: "saved_christmas_returned",
    fullTotes: "full_totes",
    emptyTotes: "empty_totes",
    fullGaylords: "full_gaylords",
    emptyGaylords: "empty_gaylords",
    fullDuros: "full_duros",
    emptyDuros: "empty_duros",
    fullContainers: "full_containers",
    emptyContainers: "empty_containers",
    fullBlueBins: "full_blue_bins",
    emptyBlueBins: "empty_blue_bins",
    emptyPallets: "empty_pallets",
    outletApparel: "outlet_apparel",
    outletShoes: "outlet_shoes",
    outletMetal: "outlet_metal",
    outletWares: "outlet_wares",
    outletAccessories: "outlet_accessories",
    outletElectrical: "outlet_electrical",
    ecomContainersSent: "ecom_containers_sent",
    rotatedApparel: "rotated_apparel",
    rotatedShoes: "rotated_shoes",
    rotatedBooks: "rotated_books",
    rotatedWares: "rotated_wares",
    apparelGaylordsUsed: "apparel_gaylords_used",
    waresGaylordsUsed: "wares_gaylords_used",
    bookGaylordsUsed: "book_gaylords_used",
    shoeGaylordsUsed: "shoe_gaylords_used",
    donors: "donors",
    isCentralProcessing: "is_central_processing",
    apparelProduction: "apparel_production",
    waresProduction: "wares_production",
    notes: "notes",
    location: "location",
  };
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const snakeKey = map[key];
    if (snakeKey && val !== undefined) {
      result[snakeKey] = val;
    }
  }
  return result;
}

function toCamel(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = val;
  }
  return result;
}

export function registerOrderRoutes(app: Express) {
  app.post("/api/orders", requireManager, async (req, res) => {
    try {
      const parsed = orderSchema.parse(req.body);
      const user = (req.session as any)?.user;
      const snaked = toSnake(parsed);
      snaked.submitted_by = user?.name || user?.email || "Unknown";

      if (snaked.is_central_processing !== undefined && snaked.is_central_processing !== null) {
        snaked.is_central_processing = snaked.is_central_processing ? 1 : 0;
      }

      const columns = Object.keys(snaked);
      const placeholders = columns.map(() => "?").join(", ");
      const values = columns.map((c) => snaked[c] ?? null);

      const [result] = await mysqlPool.execute(
        `INSERT INTO orders (${columns.join(", ")}) VALUES (${placeholders})`,
        values
      );
      const insertId = (result as any).insertId;

      res.status(201).json({ id: insertId, message: "Order submitted successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Orders] Error creating order:", err);
      res.status(500).json({ message: "Failed to submit order" });
    }
  });

  app.get("/api/orders", requireManager, async (req, res) => {
    try {
      const { startDate, endDate, location, orderType, limit, offset } = req.query;

      let query = "SELECT * FROM orders WHERE 1=1";
      const params: any[] = [];

      if (startDate) {
        query += " AND order_date >= ?";
        params.push(startDate);
      }
      if (endDate) {
        query += " AND order_date <= ?";
        params.push(endDate);
      }
      if (location) {
        query += " AND location = ?";
        params.push(location);
      }
      if (orderType) {
        query += " AND order_type = ?";
        params.push(orderType);
      }

      query += " ORDER BY order_date DESC, submitted_at DESC";

      const pageLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const pageOffset = Math.max(0, Number(offset) || 0);
      query += " LIMIT ? OFFSET ?";
      params.push(pageLimit, pageOffset);

      const [rows] = await mysqlPool.execute(query, params);

      let countQuery = "SELECT COUNT(*) as total FROM orders WHERE 1=1";
      const countParams: any[] = [];
      if (startDate) { countQuery += " AND order_date >= ?"; countParams.push(startDate); }
      if (endDate) { countQuery += " AND order_date <= ?"; countParams.push(endDate); }
      if (location) { countQuery += " AND location = ?"; countParams.push(location); }
      if (orderType) { countQuery += " AND order_type = ?"; countParams.push(orderType); }
      const [countRows] = await mysqlPool.execute(countQuery, countParams);
      const total = (countRows as any[])[0]?.total || 0;

      const camelRows = (rows as any[]).map(toCamel);
      res.json({ orders: camelRows, total, limit: pageLimit, offset: pageOffset });
    } catch (err) {
      console.error("[Orders] Error fetching orders:", err);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:id", requireManager, async (req, res) => {
    try {
      const [rows] = await mysqlPool.execute("SELECT * FROM orders WHERE id = ?", [req.params.id]);
      const results = rows as any[];
      if (results.length === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json(toCamel(results[0]));
    } catch (err) {
      console.error("[Orders] Error fetching order:", err);
      res.status(500).json({ message: "Failed to fetch order" });
    }
  });
}
