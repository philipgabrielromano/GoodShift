import type { Express } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { requireFeatureAccess, requireAdmin, userHasFeature } from "../middleware";
import type { PoolConnection } from "mysql2/promise";
import { mysqlPool } from "../mysql";
import { z } from "zod";
import { sendOrderNotificationEmail, sendOrderConfirmationEmail, sendOrderFulfilledEmail, type OrderNotificationEmailData } from "../outlook";
import { storage } from "../storage";

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
  furnitureGaylordsRequested: nonNegInt,
  furnitureGaylordsReturned: nonNegInt,
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
  fulfilled_at: string | null;
  fulfilled_by: string | null;
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

export const SEASONAL_CATEGORIES = [
  { key: "winter", label: "Winter", requestedCol: "saved_winter_requested", returnedCol: "saved_winter_returned", requestedField: "savedWinterRequested" as const },
  { key: "summer", label: "Summer", requestedCol: "saved_summer_requested", returnedCol: "saved_summer_returned", requestedField: "savedSummerRequested" as const },
  { key: "halloween", label: "Halloween", requestedCol: "saved_halloween_requested", returnedCol: "saved_halloween_returned", requestedField: "savedHalloweenRequested" as const },
  { key: "christmas", label: "Christmas", requestedCol: "saved_christmas_requested", returnedCol: "saved_christmas_returned", requestedField: "savedChristmasRequested" as const },
] as const;

interface SeasonalAggRow extends RowDataPacket {
  location: string;
  total_returned: string | number | null;
  total_requested: string | number | null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

const FIELD_LABELS: Record<string, string> = {
  totesRequested: "Totes Requested", totesReturned: "Totes Returned",
  durosRequested: "Duros Requested", durosReturned: "Duros Returned",
  blueBinsRequested: "Blue Bins Requested", blueBinsReturned: "Blue Bins Returned",
  gaylordsRequested: "Gaylords Requested", gaylordsReturned: "Gaylords Returned",
  palletsRequested: "Pallets Requested", palletsReturned: "Pallets Returned",
  containersRequested: "Containers Requested", containersReturned: "Containers Returned",
  apparelGaylordsRequested: "Apparel Gaylords Requested", apparelGaylordsReturned: "Apparel Gaylords Returned",
  waresGaylordsRequested: "Wares Gaylords Requested", waresGaylordsReturned: "Wares Gaylords Returned",
  electricalGaylordsRequested: "Electrical Gaylords Requested", electricalGaylordsReturned: "Electrical Gaylords Returned",
  accessoriesGaylordsRequested: "Accessories Gaylords Requested", accessoriesGaylordsReturned: "Accessories Gaylords Returned",
  booksGaylordsRequested: "Books Gaylords Requested", booksGaylordsReturned: "Books Gaylords Returned",
  shoesGaylordsRequested: "Shoes Gaylords Requested", shoesGaylordsReturned: "Shoes Gaylords Returned",
  furnitureGaylordsRequested: "Furniture Gaylords Requested", furnitureGaylordsReturned: "Furniture Gaylords Returned",
  savedWinterRequested: "Saved Winter Requested", savedWinterReturned: "Saved Winter Returned",
  savedSummerRequested: "Saved Summer Requested", savedSummerReturned: "Saved Summer Returned",
  savedHalloweenRequested: "Saved Halloween Requested", savedHalloweenReturned: "Saved Halloween Returned",
  savedChristmasRequested: "Saved Christmas Requested", savedChristmasReturned: "Saved Christmas Returned",
  fullTotes: "Full Totes", emptyTotes: "Empty Totes",
  fullGaylords: "Full Gaylords", emptyGaylords: "Empty Gaylords",
  fullDuros: "Full Duros", emptyDuros: "Empty Duros",
  fullContainers: "Full Containers", emptyContainers: "Empty Containers",
  fullBlueBins: "Full Blue Bins", emptyBlueBins: "Empty Blue Bins",
  emptyPallets: "Empty Pallets",
  outletApparel: "Outlet Apparel", outletShoes: "Outlet Shoes",
  outletMetal: "Outlet Metal", outletWares: "Outlet Wares",
  outletAccessories: "Outlet Accessories", outletElectrical: "Outlet Electrical",
  ecomContainersSent: "eCom Containers Sent",
  rotatedApparel: "Rotated Apparel", rotatedShoes: "Rotated Shoes",
  rotatedBooks: "Rotated Books", rotatedWares: "Rotated Wares",
  apparelGaylordsUsed: "Apparel Gaylords Used", waresGaylordsUsed: "Wares Gaylords Used",
  bookGaylordsUsed: "Book Gaylords Used", shoeGaylordsUsed: "Shoe Gaylords Used",
  donors: "Donors", isCentralProcessing: "Central Processing",
  apparelProduction: "Apparel Production", waresProduction: "Wares Production",
};

const SKIP_KEYS = new Set(["orderDate", "orderType", "location", "notes"]);

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
  furnitureGaylordsRequested: "furniture_gaylords_requested",
  furnitureGaylordsReturned: "furniture_gaylords_returned",
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

interface SeasonBalance {
  season: string;
  label: string;
  onDeposit: number;
  pendingRequested: number;
  available: number;
}

interface LocationBalance {
  location: string;
  seasons: SeasonBalance[];
}

async function loadBalances(location?: string): Promise<LocationBalance[]> {
  const where = location ? "WHERE location = ?" : "";
  const params = location ? [location] : [];
  const selectCols = SEASONAL_CATEGORIES
    .map(c => `COALESCE(SUM(${c.returnedCol}), 0) AS ret_${c.key}, COALESCE(SUM(${c.requestedCol}), 0) AS req_${c.key}`)
    .join(", ");
  const [rows] = await mysqlPool.execute<RowDataPacket[]>(
    `SELECT location, ${selectCols} FROM orders ${where} GROUP BY location ORDER BY location`,
    params
  );
  return (rows as Array<Record<string, string | number | null>>).map(r => ({
    location: String(r.location),
    seasons: SEASONAL_CATEGORIES.map(c => {
      const onDeposit = Number(r[`ret_${c.key}`] || 0);
      const requested = Number(r[`req_${c.key}`] || 0);
      const available = onDeposit - requested;
      return {
        season: c.key,
        label: c.label,
        onDeposit,
        pendingRequested: requested,
        available,
      };
    }),
  }));
}

/**
 * Validate that this order's seasonal requests don't push the store
 * over the available balance. Returns null if OK, or a message if the
 * request must be rejected.
 *
 * `excludeOrderId` is set on edits so the order being modified is not
 * counted as part of the existing baseline (otherwise its old request
 * would double-count against the new one).
 */
async function validateSeasonalRequests(
  conn: PoolConnection,
  parsed: OrderInput,
  excludeOrderId: number | null
): Promise<string | null> {
  const hasAnyRequest = SEASONAL_CATEGORIES.some(c => {
    const v = parsed[c.requestedField];
    return typeof v === "number" && v > 0;
  });
  if (!hasAnyRequest) return null;

  const selectCols = SEASONAL_CATEGORIES
    .map(c => `COALESCE(SUM(${c.returnedCol}), 0) AS ret_${c.key}, COALESCE(SUM(${c.requestedCol}), 0) AS req_${c.key}`)
    .join(", ");
  // FOR UPDATE locks the rows being aggregated (within the active transaction)
  // so a concurrent submitter for the same location must wait until this
  // transaction commits, preventing two submits from each passing validation
  // against stale aggregates and overdrawing the deposit.
  const where = excludeOrderId !== null ? "WHERE location = ? AND id <> ?" : "WHERE location = ?";
  const params: (string | number)[] = excludeOrderId !== null
    ? [parsed.location, excludeOrderId]
    : [parsed.location];
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT ${selectCols} FROM orders ${where} FOR UPDATE`,
    params
  );
  const agg = (rows[0] || {}) as Record<string, string | number | null>;

  for (const c of SEASONAL_CATEGORIES) {
    const newRequest = Number(parsed[c.requestedField] || 0);
    if (newRequest <= 0) continue;
    const onDeposit = Number(agg[`ret_${c.key}`] || 0);
    const otherRequests = Number(agg[`req_${c.key}`] || 0);
    const available = onDeposit - otherRequests;
    if (newRequest > available) {
      return `${parsed.location} only has ${available} ${c.label} on deposit (requested: ${newRequest}). Stores can only request back what they previously sent in.`;
    }
  }
  return null;
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
  app.post("/api/orders", requireFeatureAccess("orders.submit"), async (req, res) => {
    let conn: PoolConnection | null = null;
    try {
      const parsed = orderSchema.parse(req.body);
      const user = (req.session as Record<string, { name?: string; email?: string }>)?.user;
      const { columns, values } = toSnakeColumns(parsed);

      columns.push("submitted_by");
      values.push(user?.name || user?.email || "Unknown");

      const placeholders = columns.map(() => "?").join(", ");

      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      const balanceError = await validateSeasonalRequests(conn, parsed, null);
      if (balanceError) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(422).json({ message: balanceError });
      }
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO orders (${columns.join(", ")}) VALUES (${placeholders})`,
        values
      );
      await conn.commit();
      conn.release();
      conn = null;

      res.status(201).json({ id: result.insertId, message: "Order submitted successfully" });

      const submittedBy = user?.name || user?.email || "Unknown";
      const submitterEmail = user?.email;
      void (async () => {
        try {
          const nonZeroFields: { label: string; value: string | number }[] = [];
          for (const [key, val] of Object.entries(parsed)) {
            if (SKIP_KEYS.has(key) || val === null || val === undefined || val === 0) continue;
            const label = FIELD_LABELS[key] || key;
            if (key === "isCentralProcessing") {
              nonZeroFields.push({ label, value: val ? "Yes" : "No" });
            } else {
              nonZeroFields.push({ label, value: val as string | number });
            }
          }

          const appUrl = "https://goodshift.goodwillgoodskills.org";
          const emailData: OrderNotificationEmailData = {
            orderDate: parsed.orderDate,
            orderType: parsed.orderType,
            location: parsed.location,
            submittedBy,
            nonZeroFields,
            notes: parsed.notes,
            appUrl,
          };

          if (submitterEmail) {
            await sendOrderConfirmationEmail(submitterEmail, emailData);
            console.log(`[Orders] Sent order confirmation to submitter: ${submitterEmail}`);
          }

          const NOTIFY_TYPES = new Set(["Transfer and Receive", "End of Day/Equipment Count"]);
          if (NOTIFY_TYPES.has(parsed.orderType)) {
            const settings = await storage.getGlobalSettings();
            const emailList = settings?.orderNotificationEmails;
            if (emailList) {
              const recipients = emailList.split(",").map(e => e.trim().toLowerCase()).filter(e => e && e !== submitterEmail?.toLowerCase());
              for (const email of recipients) {
                await sendOrderNotificationEmail(email, emailData);
              }
              if (recipients.length > 0) {
                console.log(`[Orders] Sent order notification to ${recipients.length} recipient(s)`);
              }
            }
          }
        } catch (err) {
          console.error("[Orders] Error sending order emails:", err);
        }
      })();
    } catch (err) {
      if (conn) {
        try { await conn.rollback(); } catch { /* ignore */ }
        conn.release();
      }
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Orders] Error creating order:", err);
      res.status(500).json({ message: "Failed to submit order" });
    }
  });

  app.get("/api/orders", requireFeatureAccess("orders.view_all"), async (req, res) => {
    try {
      const { startDate, endDate, location, orderType, limit, offset } = req.query;
      console.log("[Orders] GET /api/orders query:", JSON.stringify(req.query));

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
      query += ` LIMIT ${Math.floor(pageLimit)} OFFSET ${Math.floor(pageOffset)}`;

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
      console.log(`[Orders] Returning ${camelRows.length} orders (total: ${total})`);
      res.json({ orders: camelRows, total, limit: pageLimit, offset: pageOffset });
    } catch (err) {
      console.error("[Orders] Error fetching orders:", err);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/seasonal-balances", requireFeatureAccess("orders.submit"), async (req, res) => {
    try {
      const { location } = req.query;
      const filter = typeof location === "string" && location.trim() ? location.trim() : undefined;
      // Single-location lookups are allowed for any submitter (they need it
      // for inline form validation). Pulling balances across all stores is
      // an aggregate view and requires `orders.view_all`.
      if (!filter) {
        const user = (req.session as Record<string, { role?: string }>)?.user;
        const allowed = await userHasFeature(user, "orders.view_all");
        if (!allowed) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      const balances = await loadBalances(filter);
      res.json({ balances });
    } catch (err) {
      console.error("[Orders] Error fetching seasonal balances:", err);
      res.status(500).json({ message: "Failed to fetch seasonal balances" });
    }
  });

  app.post("/api/orders/:id/fulfill", requireFeatureAccess("orders.edit"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const user = (req.session as Record<string, { name?: string; email?: string }>)?.user;
      const fulfilledBy = user?.name || user?.email || "Unknown";
      const [result] = await mysqlPool.execute<ResultSetHeader>(
        "UPDATE orders SET fulfilled_at = NOW(), fulfilled_by = ? WHERE id = ?",
        [fulfilledBy, id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json({ message: "Order marked as fulfilled" });

      // Notify the requesting store that their order is fulfilled.
      void (async () => {
        try {
          const [orderRows] = await mysqlPool.execute<OrderRow[]>(
            "SELECT * FROM orders WHERE id = ?",
            [id]
          );
          if (orderRows.length === 0) return;
          const order = toCamel(orderRows[0]);
          const orderLocation = String(order.location || "").trim();
          if (!orderLocation) return;

          // Surface the actually-requested items so the recipient knows what
          // is being shipped/picked up. We include any *_requested or
          // saved_*_requested field with a positive value.
          const fulfilledFields: { label: string; value: number | string }[] = [];
          for (const [key, val] of Object.entries(order)) {
            if (typeof val !== "number" || val <= 0) continue;
            if (!/Requested$/.test(key)) continue;
            fulfilledFields.push({ label: FIELD_LABELS[key] || key, value: val });
          }

          const allLocations = await storage.getLocations();
          const dest = allLocations.find(
            l => l.name.trim().toLowerCase() === orderLocation.toLowerCase(),
          );
          const recipients = new Set<string>();
          const locEmail = dest?.notificationEmail?.trim();
          if (locEmail) recipients.add(locEmail.toLowerCase());

          // Also notify the original submitter when their stored value looks
          // like an email address (some submitters are saved by name only).
          const submittedBy = String(order.submittedBy || "").trim();
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedBy)) {
            recipients.add(submittedBy.toLowerCase());
          }

          if (recipients.size === 0) {
            console.log(`[Orders] No fulfillment notification email available for "${orderLocation}" (order #${id})`);
            return;
          }

          const fulfilledAt = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
          const orderDateRaw = order.orderDate;
          const orderDate = orderDateRaw
            ? new Date(orderDateRaw as string).toLocaleDateString("en-US", { timeZone: "America/New_York" })
            : "";
          await Promise.all(
            Array.from(recipients).map(addr =>
              sendOrderFulfilledEmail(addr, {
                orderId: id,
                orderDate,
                orderType: String(order.orderType || ""),
                location: orderLocation,
                fulfilledBy,
                fulfilledAt,
                fulfilledFields,
                notes: order.notes ? String(order.notes) : null,
                appUrl: "https://goodshift.goodwillgoodskills.org",
              }),
            ),
          );
        } catch (e) {
          console.error("[Orders] Failed to send fulfillment email:", e);
        }
      })();
    } catch (err) {
      console.error("[Orders] Error fulfilling order:", err);
      res.status(500).json({ message: "Failed to fulfill order" });
    }
  });

  app.post("/api/orders/:id/unfulfill", requireFeatureAccess("orders.edit"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const [result] = await mysqlPool.execute<ResultSetHeader>(
        "UPDATE orders SET fulfilled_at = NULL, fulfilled_by = NULL WHERE id = ?",
        [id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json({ message: "Order marked as not fulfilled" });
    } catch (err) {
      console.error("[Orders] Error unfulfilling order:", err);
      res.status(500).json({ message: "Failed to unfulfill order" });
    }
  });

  app.get("/api/orders/:id", requireFeatureAccess("orders.view_all"), async (req, res) => {
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

  app.put("/api/orders/:id", requireFeatureAccess("orders.edit"), async (req, res) => {
    let conn: PoolConnection | null = null;
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const parsed = orderSchema.parse(req.body);

      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();

      const [existing] = await conn.execute<OrderRow[]>(
        "SELECT id FROM orders WHERE id = ? FOR UPDATE",
        [id]
      );
      if (existing.length === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ message: "Order not found" });
      }

      const balanceError = await validateSeasonalRequests(conn, parsed, id);
      if (balanceError) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(422).json({ message: balanceError });
      }

      const fields: string[] = [];
      const values: (string | number | boolean | null)[] = [];
      const camelToSnake = (s: string) => s.replace(/[A-Z]/g, m => "_" + m.toLowerCase());
      for (const [key, val] of Object.entries(parsed)) {
        fields.push(`${camelToSnake(key)} = ?`);
        values.push(val === undefined ? null : (val as string | number | boolean | null));
      }
      values.push(id);

      await conn.execute<ResultSetHeader>(
        `UPDATE orders SET ${fields.join(", ")} WHERE id = ?`,
        values
      );
      await conn.commit();
      conn.release();
      conn = null;

      res.json({ message: "Order updated successfully" });
    } catch (err) {
      if (conn) {
        try { await conn.rollback(); } catch { /* ignore */ }
        conn.release();
      }
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Orders] Error updating order:", err);
      res.status(500).json({ message: "Failed to update order" });
    }
  });

  app.delete("/api/orders/:id", requireFeatureAccess("orders.delete"), async (req, res) => {
    try {
      const [result] = await mysqlPool.execute<ResultSetHeader>(
        "DELETE FROM orders WHERE id = ?",
        [req.params.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json({ message: "Order deleted" });
    } catch (err) {
      console.error("[Orders] Error deleting order:", err);
      res.status(500).json({ message: "Failed to delete order" });
    }
  });
}
