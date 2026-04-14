import type { Express } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { requireFeatureAccess } from "../middleware";
import { mysqlPool } from "../mysql";
import { z } from "zod";

const nonNegInt = z.number().int().min(0).nullable().optional();

const ORDER_TYPES = ["Transfer and Receive", "End of Day/Equipment Count", "Donors", "Supplemental production"] as const;
type OrderType = typeof ORDER_TYPES[number];

const orderSchema = z.object({
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  orderType: z.enum(ORDER_TYPES),
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

type OrderInput = z.infer<typeof orderSchema>;

interface OrderRow extends RowDataPacket {
  id: number;
  order_date: string;
  order_type: string;
  location: string;
  submitted_by: string | null;
  submitted_at: string | null;
  notes: string | null;
  totes_requested: number | null;
  totes_returned: number | null;
  duros_requested: number | null;
  duros_returned: number | null;
  blue_bins_requested: number | null;
  blue_bins_returned: number | null;
  gaylords_requested: number | null;
  gaylords_returned: number | null;
  pallets_requested: number | null;
  pallets_returned: number | null;
  containers_requested: number | null;
  containers_returned: number | null;
  donors: number | null;
  is_central_processing: number | null;
  apparel_production: number | null;
  wares_production: number | null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

const CAMEL_TO_SNAKE: Record<keyof OrderInput, string> = {
  orderDate: "order_date",
  orderType: "order_type",
  location: "location",
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
};

function toSnakeColumns(parsed: OrderInput): { columns: string[]; values: (string | number | null)[] } {
  const columns: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [camelKey, snakeKey] of Object.entries(CAMEL_TO_SNAKE)) {
    const val = parsed[camelKey as keyof OrderInput];
    if (val === undefined) continue;

    columns.push(snakeKey);
    if (camelKey === "isCentralProcessing") {
      values.push(val === true ? 1 : val === false ? 0 : null);
    } else {
      values.push(val as string | number | null);
    }
  }

  return { columns, values };
}

function toCamel(row: RowDataPacket): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camelKey === "isCentralProcessing") {
      result[camelKey] = val === 1 ? true : val === 0 ? false : null;
    } else {
      result[camelKey] = val as string | number | null;
    }
  }
  return result;
}

export function registerOrderRoutes(app: Express) {
  app.post("/api/orders", requireFeatureAccess("orders"), async (req, res) => {
    try {
      const parsed = orderSchema.parse(req.body);
      const user = (req.session as Record<string, { name?: string; email?: string }>)?.user;
      const { columns, values } = toSnakeColumns(parsed);

      columns.push("submitted_by");
      values.push(user?.name || user?.email || "Unknown");

      const placeholders = columns.map(() => "?").join(", ");

      const [result] = await mysqlPool.execute<ResultSetHeader>(
        `INSERT INTO orders (${columns.join(", ")}) VALUES (${placeholders})`,
        values
      );

      res.status(201).json({ id: result.insertId, message: "Order submitted successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Orders] Error creating order:", err);
      res.status(500).json({ message: "Failed to submit order" });
    }
  });

  app.get("/api/orders", requireFeatureAccess("orders"), async (req, res) => {
    try {
      const { startDate, endDate, location, orderType, limit, offset } = req.query;

      let query = "SELECT * FROM orders WHERE 1=1";
      const params: (string | number)[] = [];

      if (startDate && typeof startDate === "string") {
        query += " AND order_date >= ?";
        params.push(startDate);
      }
      if (endDate && typeof endDate === "string") {
        query += " AND order_date <= ?";
        params.push(endDate);
      }
      if (location && typeof location === "string") {
        query += " AND location = ?";
        params.push(location);
      }
      if (orderType && typeof orderType === "string") {
        query += " AND order_type = ?";
        params.push(orderType);
      }

      query += " ORDER BY order_date DESC, submitted_at DESC";

      const pageLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const pageOffset = Math.max(0, Number(offset) || 0);
      query += " LIMIT ? OFFSET ?";
      params.push(pageLimit, pageOffset);

      const [rows] = await mysqlPool.execute<OrderRow[]>(query, params);

      let countQuery = "SELECT COUNT(*) as total FROM orders WHERE 1=1";
      const countParams: string[] = [];
      if (startDate && typeof startDate === "string") { countQuery += " AND order_date >= ?"; countParams.push(startDate); }
      if (endDate && typeof endDate === "string") { countQuery += " AND order_date <= ?"; countParams.push(endDate); }
      if (location && typeof location === "string") { countQuery += " AND location = ?"; countParams.push(location); }
      if (orderType && typeof orderType === "string") { countQuery += " AND order_type = ?"; countParams.push(orderType); }
      const [countRows] = await mysqlPool.execute<CountRow[]>(countQuery, countParams);
      const total = countRows[0]?.total || 0;

      const camelRows = rows.map(toCamel);
      res.json({ orders: camelRows, total, limit: pageLimit, offset: pageOffset });
    } catch (err) {
      console.error("[Orders] Error fetching orders:", err);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:id", requireFeatureAccess("orders"), async (req, res) => {
    try {
      const [rows] = await mysqlPool.execute<OrderRow[]>("SELECT * FROM orders WHERE id = ?", [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json(toCamel(rows[0]));
    } catch (err) {
      console.error("[Orders] Error fetching order:", err);
      res.status(500).json({ message: "Failed to fetch order" });
    }
  });
}
