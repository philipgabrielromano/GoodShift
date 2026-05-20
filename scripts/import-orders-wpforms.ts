import { mysqlPool } from "../server/mysql";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { createHash } from "crypto";

const CSV_PATH = process.argv[2] ?? "attached_assets/wpforms-10-Order-Form-2026-05-20-07-12-00_1779275631489.csv";

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
  // Strip leading apostrophe (Excel/Google Sheets escape, e.g. "'-1")
  const cleaned = s.replace(/^'/, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
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

function rowSignature(row: Record<string, any>, insertCols: string[]): string {
  const h = createHash("sha256");
  for (const c of insertCols) {
    if (c === "submitted_by" || c === "submitted_at") continue;
    const v = row[c];
    h.update(c);
    h.update("=");
    h.update(v === null || v === undefined ? "\0" : String(v));
    h.update("\x1f");
  }
  return h.digest("hex");
}

async function main() {
  console.log("[Import] Starting");
  console.log("[Import] Reading", CSV_PATH);
  const stream = createReadStream(CSV_PATH);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] | null = null;
  let colIdxToDbCol: (string | null)[] = [];
  const insertCols: string[] = [];
  const placeholders: string[] = [];

  const BATCH = 500;
  let batch: any[][] = [];
  let total = 0;
  let skipped = 0;
  let duplicates = 0;
  const parsedRows: Record<string, any>[] = [];

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
      const unmapped = headers.filter((h, i) => !colIdxToDbCol[i]);
      console.log(`[Import] Mapped ${insertCols.length - 2} columns`);
      if (unmapped.length) console.log(`[Import] Unmapped headers: ${unmapped.join(" | ")}`);
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
    parsedRows.push(row);
  }

  if (!headers) {
    console.log("[Import] Empty file");
    return;
  }

  // Build dedupe signatures and check which already exist as csv_import rows.
  const allSigs = parsedRows.map(r => rowSignature(r, insertCols));
  // Find date range we care about for the existence lookup
  const minDate = parsedRows.reduce((m, r) => r.order_date < m ? r.order_date : m, "9999-12-31");
  const maxDate = parsedRows.reduce((m, r) => r.order_date > m ? r.order_date : m, "0000-00-00");
  console.log(`[Import] CSV has ${parsedRows.length} parsed rows from ${minDate} to ${maxDate}`);

  const conn = await mysqlPool.getConnection();
  const existingSigs = new Set<string>();
  try {
    const cols = insertCols.filter(c => c !== "submitted_by" && c !== "submitted_at");
    const [rows] = await conn.query(
      `SELECT ${cols.join(",")} FROM orders WHERE submitted_by='csv_import' AND order_date BETWEEN ? AND ?`,
      [minDate, maxDate]
    );
    for (const r of rows as any[]) {
      // Normalize order_date back to YYYY-MM-DD string (mysql2 returns Date objects)
      if (r.order_date instanceof Date) {
        const d = r.order_date;
        r.order_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      existingSigs.add(rowSignature(r, insertCols));
    }
    console.log(`[Import] Found ${existingSigs.size} existing csv_import rows in date range — will skip duplicates`);

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const sig = allSigs[i];
      if (existingSigs.has(sig)) {
        duplicates++;
        continue;
      }
      // Avoid in-CSV duplicates too (the file itself can repeat)
      existingSigs.add(sig);

      const values = insertCols.map(c => {
        if (c === "submitted_by") return "csv_import";
        if (c === "submitted_at") return new Date();
        return row[c] ?? null;
      });
      batch.push(values);

      if (batch.length >= BATCH) {
        const sql = `INSERT INTO orders (${insertCols.join(",")}) VALUES ${batch.map(() => `(${placeholders.join(",")})`).join(",")}`;
        await conn.query(sql, batch.flat());
        total += batch.length;
        batch = [];
        console.log(`[Import] Inserted ${total} rows...`);
      }
    }

    if (batch.length) {
      const sql = `INSERT INTO orders (${insertCols.join(",")}) VALUES ${batch.map(() => `(${placeholders.join(",")})`).join(",")}`;
      await conn.query(sql, batch.flat());
      total += batch.length;
    }

    console.log(`[Import] Done. Inserted ${total} new rows. Skipped ${duplicates} duplicates. Skipped ${skipped} malformed rows (missing date/type/location).`);
  } finally {
    conn.release();
    await mysqlPool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
