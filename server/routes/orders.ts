import type { Express } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { requireFeatureAccess, requireAdmin, userHasFeature } from "../middleware";
import type { PoolConnection } from "mysql2/promise";
import { mysqlPool } from "../mysql";
import { z } from "zod";
import {
  sendOrderNotificationEmail,
  sendOrderConfirmationEmail,
  sendOrderFulfilledEmail,
  sendOrderApprovedEmail,
  sendOrderDeniedEmail,
  type OrderNotificationEmailData,
} from "../outlook";
import { storage } from "../storage";
import {
  ORDER_STATUSES,
  type OrderStatus,
  ADJUSTABLE_ORDER_FIELDS,
  ADJUSTABLE_ORDER_FIELDS_SET,
} from "@shared/schema";

// Statuses whose seasonal requests count toward the soft-hold balance
// displayed live in the Order Form (under each seasonal field) and on the
// Seasonal Inventory page. Denied orders are dropped. "submitted" is
// included so the on-screen Available number reflects pending requests
// that an approver hasn't acted on yet — purely informational; the app
// no longer blocks submit/edit/approve when a request exceeds the balance.
const SEASONAL_HOLD_STATUSES: OrderStatus[] = ["submitted", "approved", "received", "closed"];

function getActor(req: { session?: any }): { id: number | null; name: string; email: string | null } {
  const sess = (req.session as Record<string, { id?: number; name?: string; email?: string }>)?.user;
  return {
    id: typeof sess?.id === "number" ? sess.id : null,
    name: sess?.name || sess?.email || "Unknown",
    email: sess?.email || null,
  };
}

// Returns the list of `orders.location` strings (orderFormName ?? name) the
// signed-in user is allowed to read/write. Returns `null` to mean
// "no restriction" (admins and warehouse approvers see everything). Returns
// an empty array for users who have no assigned stores at all — they should
// see and touch nothing.
//
// Policy: anyone WITHOUT `orders.approve` is restricted to their own
// assigned stores. Approvers (warehouse / transportation) can see and act
// on every store's orders, which is required for the central approval and
// receive-coordination flows.
async function getUserAllowedLocationNames(
  user: { role?: string; locationIds?: string[] | null } | null | undefined
): Promise<string[] | null> {
  if (!user || !user.role) return [];
  if (user.role === "admin") return null;
  if (await userHasFeature(user, "orders.approve")) return null;

  const ids = (user.locationIds ?? []).filter(Boolean).map(String);
  if (ids.length === 0) return [];

  const idSet = new Set(ids);
  const allLocations = await storage.getLocations();
  const names = allLocations
    .filter((l: any) => idSet.has(String(l.id)))
    .map((l: any) => (l.orderFormName ?? l.name) as string);
  // De-dupe in case orderFormName collides across rows.
  return Array.from(new Set(names));
}

// Writes an audit row to the Postgres `order_events` table. State-change
// callers (approve/deny/receive/unreceive) MUST `await` this so they can
// surface a 500 if the audit write fails — we don't want a state change to
// silently commit without a history row. Best-effort callers (background
// emails, etc.) can keep using `void`.
async function logOrderEvent(args: {
  orderId: number;
  eventType: "created" | "modified" | "approved" | "denied" | "received" | "unreceived" | "deleted";
  fromStatus?: OrderStatus | null;
  toStatus?: OrderStatus | null;
  byUserId: number | null;
  byUserName: string;
  note?: string | null;
  changes?: Record<string, unknown> | null;
}): Promise<void> {
  await storage.createOrderEvent({
    orderId: args.orderId,
    eventType: args.eventType,
    fromStatus: args.fromStatus ?? null,
    toStatus: args.toStatus ?? null,
    byUserId: args.byUserId,
    byUserName: args.byUserName,
    note: args.note ?? null,
    changes: (args.changes ?? null) as any,
  });
}

const nonNegInt = z.number().int().min(0).nullable().optional();

const ORDER_TYPES = ["Transfer and Receive", "End of Day/Equipment Count", "Donors", "Supplemental production", "First Aid"] as const;
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
  // First Aid items (per-item replenishment counts for the "First Aid"
  // order type). All optional; omitted columns stay NULL.
  firstAidGuide: nonNegInt,
  cprMask: nonNegInt,
  scissors: nonNegInt,
  tweezers: nonNegInt,
  medicalExamGloves: nonNegInt,
  antibioticTreatment: nonNegInt,
  antiseptic: nonNegInt,
  burnTreatment: nonNegInt,
  sterileBandaids: nonNegInt,
  medicalTape: nonNegInt,
  triangularSling: nonNegInt,
  absorbentCompress: nonNegInt,
  sterilePads: nonNegInt,
  stingBiteAmpules: nonNegInt,
  stopBleedKit: nonNegInt,
  instantColdPack: nonNegInt,
  spillKit: nonNegInt,
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
  status: OrderStatus;
  approved_at: string | null;
  approved_by: string | null;
  denied_at: string | null;
  denied_by: string | null;
  denial_reason: string | null;
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
  // First Aid items
  firstAidGuide: "First Aid Guide",
  cprMask: "CPR Mask (disposable)",
  scissors: "Scissors",
  tweezers: "Tweezers",
  medicalExamGloves: "Medical Exam Gloves",
  antibioticTreatment: "Antibiotic Treatment",
  antiseptic: "Antiseptic (no alcohol)",
  burnTreatment: "Burn Treatment",
  sterileBandaids: "Sterile Band-Aids",
  medicalTape: "Medical Tape",
  triangularSling: "Triangular Sling",
  absorbentCompress: "Absorbent Compress",
  sterilePads: "Sterile Pads",
  stingBiteAmpules: "Sting & Bite Ampules",
  stopBleedKit: "Stop the Bleed Kit",
  instantColdPack: "Instant Cold Pack",
  spillKit: "Spill Kit (BBP/Vomit)",
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
  // First Aid items
  firstAidGuide: "first_aid_guide",
  cprMask: "cpr_mask",
  scissors: "scissors",
  tweezers: "tweezers",
  medicalExamGloves: "medical_exam_gloves",
  antibioticTreatment: "antibiotic_treatment",
  antiseptic: "antiseptic",
  burnTreatment: "burn_treatment",
  sterileBandaids: "sterile_bandaids",
  medicalTape: "medical_tape",
  triangularSling: "triangular_sling",
  absorbentCompress: "absorbent_compress",
  sterilePads: "sterile_pads",
  stingBiteAmpules: "sting_bite_ampules",
  stopBleedKit: "stop_bleed_kit",
  instantColdPack: "instant_cold_pack",
  spillKit: "spill_kit",
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
  // Only count non-denied orders toward the seasonal balance display.
  // Denied orders never reserved anything; submitted orders are a soft hold
  // so the store cannot keep stacking pending requests against the same
  // deposit before the approver acts.
  const statusPlaceholders = SEASONAL_HOLD_STATUSES.map(() => "?").join(",");
  const conds: string[] = [`status IN (${statusPlaceholders})`];
  const params: (string | number)[] = [...SEASONAL_HOLD_STATUSES];
  if (location) {
    conds.push("location = ?");
    params.push(location);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
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
      const actor = getActor(req);

      // Store-scoped users (no orders.approve) can only submit orders for
      // their own assigned store(s). Admins/approvers are unrestricted.
      const allowedLocations = await getUserAllowedLocationNames((req.session as any)?.user);
      if (allowedLocations !== null && !allowedLocations.includes(parsed.location)) {
        return res.status(403).json({
          message: "You can only submit orders for your assigned store(s).",
        });
      }

      const { columns, values } = toSnakeColumns(parsed);

      columns.push("submitted_by");
      values.push(actor.name);

      // Phase 1: every newly created order is "submitted" (pending) and has
      // no inventory effect until an approver acts on it. The MySQL column
      // also defaults to 'submitted', but we set it explicitly so the audit
      // trail is unambiguous.
      columns.push("status");
      values.push("submitted");

      const placeholders = columns.map(() => "?").join(", ");

      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      // Seasonal "deposit/withdrawal" balance is informational only — stores
      // are never blocked from requesting more than they have on deposit.
      // The Order Form still shows the live Available number under each
      // seasonal field so the operator can see they're over.
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO orders (${columns.join(", ")}) VALUES (${placeholders})`,
        values
      );
      await conn.commit();
      conn.release();
      conn = null;

      const newOrderId = result.insertId;
      void logOrderEvent({
        orderId: newOrderId,
        eventType: "created",
        toStatus: "submitted",
        byUserId: actor.id,
        byUserName: actor.name,
      });

      res.status(201).json({ id: newOrderId, status: "submitted", message: "Order submitted successfully" });

      const submittedBy = actor.name;
      const submitterEmail = actor.email;
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

          // Notification recipients depend on order type:
          //  - "First Aid" pulls from the dedicated firstAidNotificationEmails
          //    setting so the safety/facilities team can be notified without
          //    spamming the general logistics distro.
          //  - Transfer and End-of-Day use the existing generic order list.
          //  - Donors and Supplemental Production are submitter-only (no
          //    extra recipients).
          const GENERIC_NOTIFY_TYPES = new Set([
            "Transfer and Receive",
            "End of Day/Equipment Count",
          ]);
          let emailList: string | null | undefined;
          if (parsed.orderType === "First Aid") {
            const settings = await storage.getGlobalSettings();
            emailList = settings?.firstAidNotificationEmails;
          } else if (GENERIC_NOTIFY_TYPES.has(parsed.orderType)) {
            const settings = await storage.getGlobalSettings();
            emailList = settings?.orderNotificationEmails;
          }
          if (emailList) {
            const recipients = emailList.split(",").map(e => e.trim().toLowerCase()).filter(e => e && e !== submitterEmail?.toLowerCase());
            for (const email of recipients) {
              await sendOrderNotificationEmail(email, emailData);
            }
            if (recipients.length > 0) {
              console.log(`[Orders] Sent ${parsed.orderType} notification to ${recipients.length} recipient(s)`);
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
      const { startDate, endDate, location, orderType, status, limit, offset } = req.query;
      console.log("[Orders] GET /api/orders query:", JSON.stringify(req.query));

      // Store-scoped users see only their assigned stores' orders.
      // `null` = no restriction (admin / approver). `[]` = no assignments,
      // so the user sees nothing (short-circuit with an empty page).
      const allowedLocations = await getUserAllowedLocationNames((req.session as any)?.user);
      if (allowedLocations !== null && allowedLocations.length === 0) {
        const pageLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
        const pageOffset = Math.max(0, Number(offset) || 0);
        return res.json({ orders: [], total: 0, limit: pageLimit, offset: pageOffset });
      }

      // Build the shared filter clauses ONCE so list and count stay in sync.
      const filters: string[] = [];
      const filterParams: (string | number)[] = [];
      if (startDate && typeof startDate === "string") {
        filters.push("order_date >= ?");
        filterParams.push(startDate);
      }
      if (endDate && typeof endDate === "string") {
        filters.push("order_date <= ?");
        filterParams.push(endDate);
      }
      if (location && typeof location === "string") {
        filters.push("location = ?");
        filterParams.push(location);
      }
      if (orderType && typeof orderType === "string") {
        filters.push("order_type = ?");
        filterParams.push(orderType);
      }
      if (status && typeof status === "string" && (ORDER_STATUSES as readonly string[]).includes(status)) {
        filters.push("status = ?");
        filterParams.push(status);
      }
      if (allowedLocations !== null) {
        filters.push(`location IN (${allowedLocations.map(() => "?").join(", ")})`);
        filterParams.push(...allowedLocations);
      }

      const whereClause = filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : "";

      let query = `SELECT * FROM orders${whereClause} ORDER BY order_date DESC, submitted_at DESC`;
      const pageLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const pageOffset = Math.max(0, Number(offset) || 0);
      query += ` LIMIT ${Math.floor(pageLimit)} OFFSET ${Math.floor(pageOffset)}`;

      const [rows] = await mysqlPool.execute<OrderRow[]>(query, filterParams);

      const countQuery = `SELECT COUNT(*) as total FROM orders${whereClause}`;
      const [countRows] = await mysqlPool.execute<CountRow[]>(countQuery, filterParams);
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
      const user = (req.session as Record<string, any>)?.user;
      // Compute the user's store scope up-front so we can enforce it
      // consistently in both the single-location and aggregate paths.
      const allowedLocations = await getUserAllowedLocationNames(user);

      if (!filter) {
        // Aggregate (all-stores) view: requires seasonal_inventory.view AND,
        // if the caller is store-scoped, the result is trimmed to just their
        // stores. This prevents a non-approver with seasonal_inventory.view
        // from reading other stores' aggregate balances.
        const allowed = await userHasFeature(user, "seasonal_inventory.view");
        if (!allowed) {
          return res.status(403).json({ message: "Access denied" });
        }
      } else {
        // Single-location lookup (used by the order form for inline
        // validation). Store-scoped users may only ask about their own
        // stores' balances. Approvers / admins are unrestricted.
        if (allowedLocations !== null && !allowedLocations.includes(filter)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      let balances = await loadBalances(filter);
      // Trim aggregate results down to the caller's allowed stores when
      // they're store-scoped. Cheap post-filter — there are ~50 stores at
      // most so this is fine without pushing the filter into the SQL.
      if (!filter && allowedLocations !== null) {
        const allowedSet = new Set(allowedLocations);
        balances = balances.filter(b => allowedSet.has(b.location));
      }
      res.json({ balances });
    } catch (err) {
      console.error("[Orders] Error fetching seasonal balances:", err);
      res.status(500).json({ message: "Failed to fetch seasonal balances" });
    }
  });

  // Mark an order as physically received at the store. This is the renamed
  // "fulfill" action — the legacy /fulfill route is kept as an alias below
  // for backwards compat with any clients/scripts that still reference it.
  // Only allowed transition: approved → received. Receiving a second time
  // (received → received) is a no-op for the user and is treated as success
  // without re-running the UPDATE so we don't get tripped up by MySQL's
  // affectedRows=0 behaviour when nothing actually changes.
  const handleReceive = async (req: any, res: any) => {
    let conn: PoolConnection | null = null;
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const actor = getActor(req);

      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      // SELECT FOR UPDATE + status predicate in the UPDATE makes the
      // approved → received transition atomic against concurrent
      // approve/deny/unreceive on the same row.
      const [rows] = await conn.execute<OrderRow[]>(
        "SELECT id, status, location FROM orders WHERE id = ? FOR UPDATE",
        [id]
      );
      if (rows.length === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ message: "Order not found" });
      }
      // Only stores assigned to this order may receive it. Approvers /
      // admins are unrestricted (allowedLocations === null).
      const allowedRecvLocations = await getUserAllowedLocationNames((req.session as any)?.user);
      if (allowedRecvLocations !== null && !allowedRecvLocations.includes(rows[0].location as string)) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ message: "Order not found" });
      }
      const fromStatus = rows[0].status as OrderStatus;
      if (fromStatus === "received") {
        // Already received — nothing to do, no audit row to write.
        await conn.rollback();
        conn.release();
        conn = null;
        return res.json({ message: "Order is already received", status: "received" });
      }
      if (fromStatus !== "approved") {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({
          message: `Order is currently "${fromStatus}". Only approved orders can be marked received.`,
        });
      }

      const fulfilledBy = actor.name;
      const [result] = await conn.execute<ResultSetHeader>(
        "UPDATE orders SET fulfilled_at = NOW(), fulfilled_by = ?, status = 'received' WHERE id = ? AND status = 'approved'",
        [fulfilledBy, id]
      );
      if (result.affectedRows === 0) {
        // Another writer changed the status between our SELECT FOR UPDATE
        // and the UPDATE (shouldn't happen with the lock, but defend in
        // depth) — surface a 409 so the client can retry.
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ message: "Order status changed before this request — try again." });
      }
      await conn.commit();
      conn.release();
      conn = null;

      // Await the audit write — if it fails we surface a 500 and the operator
      // will see a state-change without a history row in the logs (no silent
      // partial commits possible without an alert).
      await logOrderEvent({
        orderId: id,
        eventType: "received",
        fromStatus,
        toStatus: "received",
        byUserId: actor.id,
        byUserName: actor.name,
      });
      res.json({ message: "Order marked as received", status: "received" });

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
      if (conn) {
        try { await conn.rollback(); } catch { /* ignore */ }
        try { conn.release(); } catch { /* ignore */ }
      }
      console.error("[Orders] Error receiving order:", err);
      res.status(500).json({ message: "Failed to mark order as received" });
    }
  };

  app.post("/api/orders/:id/receive", requireFeatureAccess("orders.receive"), handleReceive);
  // Backwards-compat alias for the renamed action.
  app.post("/api/orders/:id/fulfill", requireFeatureAccess("orders.receive"), handleReceive);

  // Reverse a receive — moves an order from received back to approved so a
  // leader can correct a mistaken receive. Requires orders.receive (same
  // permission as marking received). `closed` is intentionally disallowed
  // here: closing an order is a terminal action; reopening it requires a
  // separate "reopen closed order" workflow we have not yet implemented
  // (tracked as a follow-up).
  const handleUnreceive = async (req: any, res: any) => {
    let conn: PoolConnection | null = null;
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const actor = getActor(req);

      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute<OrderRow[]>(
        "SELECT id, status, location FROM orders WHERE id = ? FOR UPDATE",
        [id]
      );
      if (rows.length === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ message: "Order not found" });
      }
      // Same store-scope guard as receive — only the assigned store(s) can
      // un-receive; admin/approver bypass via getUserAllowedLocationNames.
      const allowedUnrecvLocations = await getUserAllowedLocationNames((req.session as any)?.user);
      if (allowedUnrecvLocations !== null && !allowedUnrecvLocations.includes(rows[0].location as string)) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ message: "Order not found" });
      }
      const fromStatus = rows[0].status as OrderStatus;
      if (fromStatus === "closed") {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({
          message: "This order is closed. Closed orders can't be reverted to approved.",
        });
      }
      if (fromStatus !== "received") {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({
          message: `Order is currently "${fromStatus}", not received — nothing to undo.`,
        });
      }
      const [result] = await conn.execute<ResultSetHeader>(
        "UPDATE orders SET fulfilled_at = NULL, fulfilled_by = NULL, status = 'approved' WHERE id = ? AND status = 'received'",
        [id]
      );
      if (result.affectedRows === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ message: "Order status changed before this request — try again." });
      }
      await conn.commit();
      conn.release();
      conn = null;

      await logOrderEvent({
        orderId: id,
        eventType: "unreceived",
        fromStatus,
        toStatus: "approved",
        byUserId: actor.id,
        byUserName: actor.name,
      });
      res.json({ message: "Order moved back to approved", status: "approved" });
    } catch (err) {
      if (conn) {
        try { await conn.rollback(); } catch { /* ignore */ }
        try { conn.release(); } catch { /* ignore */ }
      }
      console.error("[Orders] Error un-receiving order:", err);
      res.status(500).json({ message: "Failed to undo receive" });
    }
  };
  app.post("/api/orders/:id/unreceive", requireFeatureAccess("orders.receive"), handleUnreceive);
  app.post("/api/orders/:id/unfulfill", requireFeatureAccess("orders.receive"), handleUnreceive);

  // Approve a submitted order. Seasonal balance is informational only here
  // — over-approval is allowed; the live balance shown in the Order Form
  // is just a guide for the operator.
  //
  // Optional `adjustments` body lets the warehouse record what was actually
  // shipped instead of what the store originally requested. Only fields
  // listed in shared/schema.ts → ADJUSTABLE_ORDER_FIELDS are accepted; values
  // must be non-negative integers and may be either lower or higher than the
  // requested value. The adjusted columns are overwritten in place (Option A
  // from the design discussion) and the originals get snapshotted into the
  // audit event note so we can always see what changed.
  const approveSchema = z.object({
    adjustments: z.record(z.string(), z.number().int().min(0).max(99999)).optional(),
    reason: z.string().trim().max(2000).optional(),
  });
  app.post("/api/orders/:id/approve", requireFeatureAccess("orders.approve"), async (req, res) => {
    let conn: PoolConnection | null = null;
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const actor = getActor(req);
      const body = approveSchema.parse(req.body ?? {});
      const rawAdjustments = body.adjustments ?? {};

      // Validate every adjustment field name against the allowlist *before*
      // we touch the DB so a typo in the client never gets near a SQL UPDATE.
      for (const k of Object.keys(rawAdjustments)) {
        if (!ADJUSTABLE_ORDER_FIELDS_SET.has(k)) {
          return res.status(400).json({ message: `Field "${k}" is not adjustable` });
        }
      }

      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute<OrderRow[]>(
        "SELECT * FROM orders WHERE id = ? FOR UPDATE",
        [id]
      );
      if (rows.length === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ message: "Order not found" });
      }
      const order = rows[0];
      const fromStatus = order.status as OrderStatus;
      if (fromStatus !== "submitted") {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({
          message: `Order is currently "${fromStatus}". Only submitted orders can be approved.`,
        });
      }

      const camel = toCamel(order) as Record<string, any>;

      // Build the effective post-approval values: start from what the store
      // requested, override anything the warehouse adjusted. Only keep
      // entries that actually differ — equal values are no-ops we don't need
      // to log or UPDATE.
      const changedFields: Array<{ field: string; column: string; original: number; adjusted: number; label: string }> = [];
      for (const [field, adjusted] of Object.entries(rawAdjustments)) {
        const original = Number(camel[field] ?? 0) || 0;
        if (adjusted === original) continue;
        changedFields.push({
          field,
          column: field.replace(/[A-Z]/g, m => "_" + m.toLowerCase()),
          original,
          adjusted,
          label: FIELD_LABELS[field] || field,
        });
      }

      // Seasonal balance is informational only at approval time — the
      // approver can adjust requested seasonal quantities without being
      // blocked by deposit limits. Stores can over-request and warehouse
      // staff can over-approve; the balance display is a guide, not a wall.

      // Build a single UPDATE that flips status + writes any adjustments.
      // Always include the status / approved_at / approved_by / denial-clear
      // columns; tack adjustment columns on the end.
      const setClauses = [
        "status = 'approved'",
        "approved_at = NOW()",
        "approved_by = ?",
        "denied_at = NULL",
        "denied_by = NULL",
        "denial_reason = NULL",
        ...changedFields.map(f => `${f.column} = ?`),
      ];
      const params: (string | number)[] = [actor.name, ...changedFields.map(f => f.adjusted), id];
      const [updateResult] = await conn.execute<ResultSetHeader>(
        `UPDATE orders SET ${setClauses.join(", ")} WHERE id = ? AND status = 'submitted'`,
        params
      );
      // Defence-in-depth race guard: matches the same affectedRows check
      // used by deny/receive/unreceive so a 0-row update can't silently
      // succeed even if some future trigger or replica drift breaks the
      // FOR UPDATE assumption.
      if (updateResult.affectedRows === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ message: "Order status changed before this request — try again." });
      }
      await conn.commit();
      conn.release();
      conn = null;

      // Build the audit-log note. For a no-adjustment approval we leave it
      // null so the audit row stays compact; with adjustments we record a
      // human-readable summary plus the optional warehouse reason.
      let note: string | undefined;
      if (changedFields.length > 0) {
        const summary = changedFields.map(f => `${f.label}: ${f.original} → ${f.adjusted}`).join("; ");
        note = body.reason ? `${summary} — ${body.reason}` : summary;
      }

      // Await the audit write — if it fails the route returns 500 so the
      // operator sees a state-change without a history row, instead of a
      // silent partial commit.
      await logOrderEvent({
        orderId: id,
        eventType: "approved",
        fromStatus,
        toStatus: "approved",
        byUserId: actor.id,
        byUserName: actor.name,
        note,
      });
      res.json({
        message: changedFields.length > 0 ? "Order approved with adjustments" : "Order approved",
        status: "approved",
        adjustedFields: changedFields.map(f => ({ field: f.field, original: f.original, adjusted: f.adjusted })),
      });

      // Notify submitter (best-effort, async). Build the per-line ship list
      // from every requested column in the order, with originals attached
      // for the lines the warehouse adjusted so the email shows "5 (requested 7)".
      void (async () => {
        try {
          const submittedBy = String(camel.submittedBy || "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedBy)) return;
          const sentItems: Array<{ label: string; value: number; originalValue?: number }> = [];
          for (const field of ADJUSTABLE_ORDER_FIELDS) {
            const original = Number(camel[field] ?? 0) || 0;
            const adj = changedFields.find(f => f.field === field);
            const value = adj ? adj.adjusted : original;
            if (value <= 0 && original <= 0) continue;
            sentItems.push({
              label: FIELD_LABELS[field] || field,
              value,
              originalValue: adj ? original : undefined,
            });
          }
          await sendOrderApprovedEmail(submittedBy.toLowerCase(), {
            orderId: id,
            orderDate: String(camel.orderDate || ""),
            orderType: String(camel.orderType || ""),
            location: String(camel.location || ""),
            approvedBy: actor.name,
            appUrl: "https://goodshift.goodwillgoodskills.org",
            sentItems,
            adjustmentReason: body.reason,
          });
        } catch (e) {
          console.error("[Orders] Failed to send approval email:", e);
        }
      })();
    } catch (err) {
      if (conn) {
        try { await conn.rollback(); } catch { /* ignore */ }
        try { conn.release(); } catch { /* ignore */ }
      }
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Orders] Error approving order:", err);
      res.status(500).json({ message: "Failed to approve order" });
    }
  });

  // ----- Bulk "approve as requested" -----
  //
  // Helper: approve a single order with no adjustments, in its own
  // transaction, returning a structured result instead of throwing. This
  // is intentionally a parallel implementation of the per-order /approve
  // route's "as-requested" path rather than a shared extraction — we
  // didn't want to refactor the heavily-exercised single-order route as
  // part of adding a bulk action. Behaviour kept in lockstep:
  //   * Locks the order row (FOR UPDATE)
  //   * Rejects anything not in 'submitted'
  //   * Flips status with the same race-guard affectedRows check
  //   * Writes an `approved` audit event
  //   * Fires the same submitter notification email best-effort async
  //   * (No seasonal balance gate — over-approval is allowed; the live
  //     "Available" balance in the Order Form is informational only.)
  async function approveOrderAsRequested(
    id: number,
    actor: ReturnType<typeof getActor>,
  ): Promise<{ ok: true; location: string } | { ok: false; status: number; message: string; location?: string }> {
    let conn: PoolConnection | null = null;
    try {
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute<OrderRow[]>(
        "SELECT * FROM orders WHERE id = ? FOR UPDATE",
        [id]
      );
      if (rows.length === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return { ok: false, status: 404, message: "Order not found" };
      }
      const order = rows[0];
      const fromStatus = order.status as OrderStatus;
      const camel = toCamel(order) as Record<string, any>;
      const location = String(camel.location || "");
      if (fromStatus !== "submitted") {
        await conn.rollback();
        conn.release();
        conn = null;
        return {
          ok: false,
          status: 409,
          location,
          message: `Already ${fromStatus} — only submitted orders can be approved.`,
        };
      }

      // Seasonal balance is informational only — bulk approval doesn't
      // re-validate against the deposit either, matching the single-order
      // approve route. The Order Form / Daily Route still surface live
      // balances for human visibility.

      const [updateResult] = await conn.execute<ResultSetHeader>(
        "UPDATE orders SET status = 'approved', approved_at = NOW(), approved_by = ?, denied_at = NULL, denied_by = NULL, denial_reason = NULL WHERE id = ? AND status = 'submitted'",
        [actor.name, id]
      );
      if (updateResult.affectedRows === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return { ok: false, status: 409, location, message: "Status changed before this request — try again." };
      }
      await conn.commit();
      conn.release();
      conn = null;

      await logOrderEvent({
        orderId: id,
        eventType: "approved",
        fromStatus,
        toStatus: "approved",
        byUserId: actor.id,
        byUserName: actor.name,
      });

      // Notify submitter (best-effort, async). Same shape as the
      // single-order approve.
      void (async () => {
        try {
          const submittedBy = String(camel.submittedBy || "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedBy)) return;
          const sentItems: Array<{ label: string; value: number; originalValue?: number }> = [];
          for (const field of ADJUSTABLE_ORDER_FIELDS) {
            const value = Number(camel[field] ?? 0) || 0;
            if (value <= 0) continue;
            sentItems.push({ label: FIELD_LABELS[field] || field, value });
          }
          await sendOrderApprovedEmail(submittedBy.toLowerCase(), {
            orderId: id,
            orderDate: String(camel.orderDate || ""),
            orderType: String(camel.orderType || ""),
            location,
            approvedBy: actor.name,
            appUrl: "https://goodshift.goodwillgoodskills.org",
            sentItems,
          });
        } catch (e) {
          console.error("[Orders] Failed to send bulk-approval email:", e);
        }
      })();

      return { ok: true, location };
    } catch (err) {
      if (conn) {
        try { await conn.rollback(); } catch { /* ignore */ }
        try { conn.release(); } catch { /* ignore */ }
      }
      console.error(`[Orders] Bulk approve failed for order ${id}:`, err);
      return {
        ok: false,
        status: 500,
        message: err instanceof Error ? err.message : "Unexpected error",
      };
    }
  }

  // Cap the bulk size so a runaway client (or a future "approve all
  // historical" misclick) can't lock the table for minutes. 500 is well
  // above any realistic backlog and still completes in seconds.
  const bulkApproveSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1, "No order IDs provided").max(500, "Too many orders in one request"),
  });
  app.post("/api/orders/bulk-approve", requireFeatureAccess("orders.approve"), async (req, res) => {
    try {
      const { ids } = bulkApproveSchema.parse(req.body ?? {});
      const actor = getActor(req);
      // Enforce the same store-scope policy as the read endpoint: a user
      // without orders.approve already can't reach this route, but
      // double-check here so a future permission change doesn't silently
      // grant cross-location approval.
      const allowedLocations = await getUserAllowedLocationNames((req.session as any)?.user);

      // De-duplicate while preserving order so the result list lines up
      // with what the operator clicked.
      const uniqueIds = Array.from(new Set(ids));

      const approved: number[] = [];
      const skipped: Array<{ id: number; location?: string; reason: string }> = [];

      for (const id of uniqueIds) {
        // Defence-in-depth scope check — fetch the order's location
        // before approval if the user is store-scoped and refuse anything
        // outside their allowed list. (allowedLocations === null means
        // unrestricted.)
        if (allowedLocations !== null) {
          const [rows] = await mysqlPool.execute<OrderRow[]>(
            "SELECT location FROM orders WHERE id = ?",
            [id]
          );
          const loc = rows[0]?.location;
          if (!loc || !allowedLocations.includes(String(loc))) {
            skipped.push({ id, reason: "Not allowed for your location scope" });
            continue;
          }
        }

        const result = await approveOrderAsRequested(id, actor);
        if (result.ok) {
          approved.push(id);
        } else {
          skipped.push({ id, location: result.location, reason: result.message });
        }
      }

      res.json({
        attempted: uniqueIds.length,
        approved: approved.length,
        approvedIds: approved,
        skipped,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Orders] Bulk approve failed:", err);
      res.status(500).json({ message: "Bulk approve failed" });
    }
  });

  // Deny a submitted order. Requires a non-empty reason so the submitter
  // can see why their request was rejected.
  const denySchema = z.object({ reason: z.string().trim().min(1, "A reason is required").max(2000) });
  app.post("/api/orders/:id/deny", requireFeatureAccess("orders.approve"), async (req, res) => {
    let conn: PoolConnection | null = null;
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const { reason } = denySchema.parse(req.body);
      const actor = getActor(req);

      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      // SELECT FOR UPDATE + status predicate makes the submitted → denied
      // transition atomic against a concurrent approve.
      const [rows] = await conn.execute<OrderRow[]>(
        "SELECT * FROM orders WHERE id = ? FOR UPDATE",
        [id]
      );
      if (rows.length === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ message: "Order not found" });
      }
      const order = rows[0];
      const fromStatus = order.status as OrderStatus;
      if (fromStatus !== "submitted") {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({
          message: `Order is currently "${fromStatus}". Only submitted orders can be denied.`,
        });
      }

      const [result] = await conn.execute<ResultSetHeader>(
        "UPDATE orders SET status = 'denied', denied_at = NOW(), denied_by = ?, denial_reason = ?, approved_at = NULL, approved_by = NULL WHERE id = ? AND status = 'submitted'",
        [actor.name, reason, id]
      );
      if (result.affectedRows === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ message: "Order status changed before this request — try again." });
      }
      await conn.commit();
      conn.release();
      conn = null;

      await logOrderEvent({
        orderId: id,
        eventType: "denied",
        fromStatus,
        toStatus: "denied",
        byUserId: actor.id,
        byUserName: actor.name,
        note: reason,
      });
      res.json({ message: "Order denied", status: "denied" });

      void (async () => {
        try {
          const camel = toCamel(order) as Record<string, any>;
          const submittedBy = String(camel.submittedBy || "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedBy)) return;
          await sendOrderDeniedEmail(submittedBy.toLowerCase(), {
            orderId: id,
            orderDate: String(camel.orderDate || ""),
            orderType: String(camel.orderType || ""),
            location: String(camel.location || ""),
            deniedBy: actor.name,
            reason,
            appUrl: "https://goodshift.goodwillgoodskills.org",
          });
        } catch (e) {
          console.error("[Orders] Failed to send denial email:", e);
        }
      })();
    } catch (err) {
      if (conn) {
        try { await conn.rollback(); } catch { /* ignore */ }
        try { conn.release(); } catch { /* ignore */ }
      }
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Orders] Error denying order:", err);
      res.status(500).json({ message: "Failed to deny order" });
    }
  });

  // Audit log for a single order — anyone who can view orders can read it.
  app.get("/api/orders/:id/events", requireFeatureAccess("orders.view_all"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      // Cross-store leak guard: a non-approver shouldn't be able to read the
      // audit trail of an order that belongs to a store they aren't assigned
      // to. Cheap pre-check against the parent order's location.
      const [orderRows] = await mysqlPool.execute<OrderRow[]>(
        "SELECT location FROM orders WHERE id = ?",
        [id]
      );
      if (orderRows.length === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      const allowedLocations = await getUserAllowedLocationNames((req.session as any)?.user);
      if (allowedLocations !== null && !allowedLocations.includes(orderRows[0].location as string)) {
        // 404 (not 403) so we don't leak the existence of orders from other
        // stores by status-code differentiation.
        return res.status(404).json({ message: "Order not found" });
      }
      const events = await storage.getOrderEvents(id);
      res.json(events);
    } catch (err) {
      console.error("[Orders] Error fetching order events:", err);
      res.status(500).json({ message: "Failed to fetch order events" });
    }
  });

  app.get("/api/orders/:id", requireFeatureAccess("orders.view_all"), async (req, res) => {
    try {
      const [rows] = await mysqlPool.execute<OrderRow[]>("SELECT * FROM orders WHERE id = ?", [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      const allowedLocations = await getUserAllowedLocationNames((req.session as any)?.user);
      if (allowedLocations !== null && !allowedLocations.includes(rows[0].location as string)) {
        // 404, not 403 — same reasoning as above (don't leak existence).
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
      const actor = getActor(req);

      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();

      // Pull the full row so we can compute a per-field diff for the audit log.
      const [existing] = await conn.execute<OrderRow[]>(
        "SELECT * FROM orders WHERE id = ? FOR UPDATE",
        [id]
      );
      if (existing.length === 0) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ message: "Order not found" });
      }
      const beforeRow = toCamel(existing[0]) as Record<string, any>;
      const beforeStatus = (existing[0].status as OrderStatus) || "submitted";

      // Store-scope guard: edits must come from a user assigned to either
      // the original store OR the new store (so they can't move an order
      // out of their scope, and can't pull one in from someone else's).
      const allowedLocations = await getUserAllowedLocationNames((req.session as any)?.user);
      if (allowedLocations !== null) {
        const beforeLoc = (existing[0].location as string) || "";
        if (!allowedLocations.includes(beforeLoc) || !allowedLocations.includes(parsed.location)) {
          await conn.rollback();
          conn.release();
          conn = null;
          return res.status(403).json({
            message: "You can only edit orders for your assigned store(s).",
          });
        }
      }

      // Seasonal balance is informational only — edits are not blocked by
      // the deposit ledger. The Order Form shows live Available numbers
      // so the editor can see when they're going over.

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

      // Compute a compact diff of just the fields that actually changed so the
      // audit log doesn't blow up with ~70 unchanged columns per edit.
      const before: Record<string, any> = {};
      const after: Record<string, any> = {};
      for (const [key, newVal] of Object.entries(parsed)) {
        const oldVal = beforeRow[key];
        const oldNorm = oldVal === undefined ? null : oldVal;
        const newNorm = newVal === undefined ? null : newVal;
        if (oldNorm !== newNorm) {
          before[key] = oldNorm;
          after[key] = newNorm;
        }
      }
      void logOrderEvent({
        orderId: id,
        eventType: "modified",
        fromStatus: beforeStatus,
        toStatus: beforeStatus,
        byUserId: actor.id,
        byUserName: actor.name,
        changes: { before, after },
      });

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
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const actor = getActor(req);
      const [rows] = await mysqlPool.execute<OrderRow[]>(
        "SELECT id, status, location FROM orders WHERE id = ?",
        [id]
      );
      // Store-scope guard: a non-approver can only delete an order from a
      // store they're assigned to. We return 404 (not 403) for cross-store
      // attempts so we don't leak existence.
      const allowedDelLocations = await getUserAllowedLocationNames((req.session as any)?.user);
      if (rows.length > 0 && allowedDelLocations !== null && !allowedDelLocations.includes(rows[0].location as string)) {
        return res.status(404).json({ message: "Order not found" });
      }
      const fromStatus = (rows[0]?.status as OrderStatus | undefined) || null;
      const [result] = await mysqlPool.execute<ResultSetHeader>(
        "DELETE FROM orders WHERE id = ?",
        [id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      // Keep the audit trail around even though the order itself is gone —
      // delete the order_events row only if a future operator decides to
      // purge them. For now we log the deletion and leave prior events in
      // place for forensics.
      void logOrderEvent({
        orderId: id,
        eventType: "deleted",
        fromStatus,
        toStatus: null,
        byUserId: actor.id,
        byUserName: actor.name,
      });
      res.json({ message: "Order deleted" });
    } catch (err) {
      console.error("[Orders] Error deleting order:", err);
      res.status(500).json({ message: "Failed to delete order" });
    }
  });
}
