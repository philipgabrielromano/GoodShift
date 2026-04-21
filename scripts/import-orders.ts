import { mysqlPool } from "../server/mysql";
import { createReadStream } from "fs";
import { createInterface } from "readline";

const CSV_PATH = "attached_assets/combined-orders-2026-04-21_1776797190492.csv";

const HEADER_TO_COL: Record<string, string> = {
  "Date": "order_date",
  "Type of Order": "order_type",
  "Location": "location",
  "ARE YOU ENTERING PRODUCTION FROM CENTRAL PROCESSING OR ARE YOU LEE HARVARD STORE?  (THIS IS ONLY FOR CENTRAL PROCESSING OR LEE HARVARD)": "is_central_processing",
  "Donors": "donors",
  "Rotated Apparel": "rotated_apparel",
  "Rotated Wares": "rotated_wares",
  "Rotated Books": "rotated_books",
  "Rotated Shoes": "rotated_shoes",
  "Apparel Gaylords Used": "apparel_gaylords_used",
  "Wares Gaylords Used": "wares_gaylords_used",
  "Book Gaylords Used": "book_gaylords_used",
  "Shoe Gaylords Used": "shoe_gaylords_used",
  "Wares Production": "wares_production",
  "Apparel Production": "apparel_production",
  "Full Totes": "full_totes",
  "Empty Totes": "empty_totes",
  "Full Duros": "full_duros",
  "Empty Duros": "empty_duros",
  "Full Blue Bins": "full_blue_bins",
  "Empty Blue Bins": "empty_blue_bins",
  "Full Gaylords": "full_gaylords",
  "Empty Gaylords": "empty_gaylords",
  "Full Containers": "full_containers",
  "Empty Containers": "empty_containers",
  "Empty Pallets": "empty_pallets",
  "Totes Returned": "totes_returned",
  "Duros Returned": "duros_returned",
  "Blue Bins Returned": "blue_bins_returned",
  "Gaylords Returned": "gaylords_returned",
  "Pallets Returned": "pallets_returned",
  "Containers Returned": "containers_returned",
  "Totes Requested": "totes_requested",
  "Duros Requested": "duros_requested",
  "Blue Bins Requested": "blue_bins_requested",
  "Gaylords Requested": "gaylords_requested",
  "Pallets Requested": "pallets_requested",
  "Containers Requested": "containers_requested",
  "Wares Gaylords Requested": "wares_gaylords_requested",
  "Apparel Gaylords Requested": "apparel_gaylords_requested",
  "Electrical Gaylords Requested": "electrical_gaylords_requested",
  "Accessories Gaylords Requested": "accessories_gaylords_requested",
  "Books Gaylords Requested": "books_gaylords_requested",
  "Shoes Gaylords Requested": "shoes_gaylords_requested",
  "Saved Winter Requested": "saved_winter_requested",
  "Saved Summer Requested": "saved_summer_requested",
  "Saved Halloween Requested": "saved_halloween_requested",
  "Saved Christmas Requested": "saved_christmas_requested",
  "Wares Gaylords Returned": "wares_gaylords_returned",
  "Apparel Gaylords Returned": "apparel_gaylords_returned",
  "Electrical Gaylords Returned": "electrical_gaylords_returned",
  "Accessories Gaylords Returned": "accessories_gaylords_returned",
  "Books Gaylords Returned": "books_gaylords_returned",
  "Shoes Gaylords Returned": "shoes_gaylords_returned",
  "Saved Winter Returned": "saved_winter_returned",
  "Saved Summer Returned": "saved_summer_returned",
  "Saved Halloween Returned": "saved_halloween_returned",
  "Saved Christmas Returned": "saved_christmas_returned",
  "Outlet Apparel": "outlet_apparel",
  "Outlet Shoes": "outlet_shoes",
  "Outlet Metal": "outlet_metal",
  "Outlet Wares": "outlet_wares",
  "Outlet Accessories": "outlet_accessories",
  "Outlet Electrical": "outlet_electrical",
  "eCom Containers Sent": "ecom_containers_sent",
  "Notes": "notes",
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else { cur += ch; }
    } else {
      if (ch === ',') { out.push(cur); cur = ""; }
      else if (ch === '"') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

function parseDate(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mm, dd, yy] = m;
  if (yy.length === 2) yy = (Number(yy) > 50 ? "19" : "20") + yy;
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseInt0(s: string): number | null {
  if (s === "" || s == null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function parseCp(s: string): number | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t.includes("central")) return 1;
  if (t.includes("lee harvard") || t.includes("lee")) return 0;
  return null;
}

async function main() {
  console.log("[Import] Starting");
  const stream = createReadStream(CSV_PATH);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  console.log("[Import] Reading", CSV_PATH);

  let headers: string[] | null = null;
  let cols: string[] = [];
  let colIdxToDbCol: (string | null)[] = [];
  const insertCols: string[] = [];
  const placeholders: string[] = [];

  const BATCH = 500;
  let batch: any[][] = [];
  let total = 0;
  let skipped = 0;

  const conn = await mysqlPool.getConnection();
  try {
    for await (const rawLine of rl) {
      const line = rawLine.replace(/^\uFEFF/, "");
      if (!line.trim()) continue;
      const fields = parseCsvLine(line);

      if (!headers) {
        headers = fields;
        colIdxToDbCol = headers.map(h => HEADER_TO_COL[h] ?? null);
        const seen = new Set<string>();
        for (const c of colIdxToDbCol) {
          if (c && !seen.has(c)) { seen.add(c); insertCols.push(c); }
        }
        insertCols.push("submitted_by");
        insertCols.push("submitted_at");
        for (const _ of insertCols) placeholders.push("?");
        console.log(`[Import] Mapped ${insertCols.length - 2} columns; ${headers.filter((h, i) => !colIdxToDbCol[i]).join(" | ")} skipped`);
        continue;
      }

      const row: Record<string, any> = {};
      for (let i = 0; i < fields.length; i++) {
        const dbCol = colIdxToDbCol[i];
        if (!dbCol) continue;
        const raw = fields[i];
        if (dbCol === "order_date") row[dbCol] = parseDate(raw);
        else if (dbCol === "order_type" || dbCol === "location" || dbCol === "notes") row[dbCol] = raw || null;
        else if (dbCol === "is_central_processing") row[dbCol] = parseCp(raw);
        else row[dbCol] = parseInt0(raw);
      }

      if (!row.order_date || !row.order_type || !row.location) {
        skipped++;
        continue;
      }

      const values = insertCols.map(c => {
        if (c === "submitted_by") return "csv_import";
        if (c === "submitted_at") return new Date();
        return row[c] ?? null;
      });
      batch.push(values);

      if (batch.length >= BATCH) {
        const sql = `INSERT INTO orders (${insertCols.join(",")}) VALUES ${batch.map(() => `(${placeholders.join(",")})`).join(",")}`;
        const flat = batch.flat();
        await conn.query(sql, flat);
        total += batch.length;
        batch = [];
        if (total % 5000 === 0) console.log(`[Import] Inserted ${total} rows...`);
      }
    }

    if (batch.length) {
      const sql = `INSERT INTO orders (${insertCols.join(",")}) VALUES ${batch.map(() => `(${placeholders.join(",")})`).join(",")}`;
      const flat = batch.flat();
      await conn.query(sql, flat);
      total += batch.length;
    }

    console.log(`[Import] Done. Inserted ${total} rows. Skipped ${skipped} rows (missing date/type/location).`);
  } finally {
    conn.release();
    await mysqlPool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
