import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import mysql from "mysql2/promise";

const CSV_TO_DB: Record<string, string> = {
  "Date": "order_date",
  "Type of Order": "order_type",
  "Location": "location",
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

const CP_HEADER = "ARE YOU ENTERING PRODUCTION FROM CENTRAL PROCESSING OR ARE YOU LEE HARVARD STORE?  (THIS IS ONLY FOR CENTRAL PROCESSING OR LEE HARVARD)";

const INT_COLUMNS = new Set(Object.values(CSV_TO_DB));
INT_COLUMNS.delete("order_date");
INT_COLUMNS.delete("order_type");
INT_COLUMNS.delete("location");
INT_COLUMNS.delete("notes");

function convertDate(mmddyyyy: string): string {
  const parts = mmddyyyy.split("/");
  if (parts.length !== 3) throw new Error(`Bad date: ${mmddyyyy}`);
  const [mm, dd, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseIntVal(val: string | undefined): number | null {
  if (val === undefined || val === null || val.trim() === "") return null;
  const n = parseFloat(val.trim());
  if (isNaN(n)) return null;
  return Math.round(n);
}

async function connectDirect(): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT) || 3306,
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 30000,
  });
}

async function main() {
  console.log(`[CONNECT] Trying direct connection to ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306}...`);
  const testConn = await connectDirect();
  const [testRows] = await testConn.execute("SELECT COUNT(*) as cnt FROM orders");
  console.log(`[CONNECT] Success! Current orders count: ${(testRows as any)[0].cnt}`);
  await testConn.end();

  const csvFiles = [
    "attached_assets/wpforms-10-Order-Form-2026-04-14-11-50-11_1776181935285.csv",
    "attached_assets/wpforms-10-Order-Form-2026-04-14-11-50-29_1776181935285.csv",
    "attached_assets/wpforms-10-Order-Form-2026-04-14-11-50-42_1776181935285.csv",
    "attached_assets/wpforms-10-Order-Form-2026-04-14-11-51-22_1776181935285.csv",
  ];

  const allColumns = [
    "order_date", "order_type", "location", "is_central_processing", "submitted_by",
    ...Object.values(CSV_TO_DB).filter(c => !["order_date", "order_type", "location"].includes(c)),
  ];
  const uniqueCols = [...new Set(allColumns)];

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const csvFile of csvFiles) {
    const filePath = path.resolve(csvFile);
    if (!fs.existsSync(filePath)) {
      console.log(`[SKIP] File not found: ${csvFile}`);
      continue;
    }

    console.log(`\n[IMPORT] Processing: ${path.basename(csvFile)}`);
    const content = fs.readFileSync(filePath, "utf-8");
    const records: Record<string, string>[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });

    console.log(`  Parsed ${records.length} rows`);

    const BATCH_SIZE = 100;
    let fileInserted = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      const rowsData: (string | number | null)[][] = [];
      for (const row of batch) {
        const dateStr = row["Date"]?.trim();
        if (!dateStr) { totalSkipped++; continue; }
        const orderType = row["Type of Order"]?.trim();
        const location = row["Location"]?.trim();
        if (!orderType || !location) { totalSkipped++; continue; }

        const cpVal = row[CP_HEADER]?.trim();
        const isCentralProcessing = cpVal === "YES" ? 1 : null;

        const valuesMap: Record<string, string | number | null> = {};
        valuesMap["order_date"] = convertDate(dateStr);
        valuesMap["order_type"] = orderType;
        valuesMap["location"] = location;
        valuesMap["is_central_processing"] = isCentralProcessing;
        valuesMap["submitted_by"] = "CSV Import";

        for (const [csvHeader, dbCol] of Object.entries(CSV_TO_DB)) {
          if (["order_date", "order_type", "location"].includes(dbCol)) continue;
          if (dbCol === "notes") {
            const note = row[csvHeader]?.trim();
            valuesMap[dbCol] = note || null;
          } else if (INT_COLUMNS.has(dbCol)) {
            valuesMap[dbCol] = parseIntVal(row[csvHeader]);
          }
        }

        rowsData.push(uniqueCols.map(col => valuesMap[col] ?? null));
      }

      if (rowsData.length === 0) continue;

      const singlePlaceholders = `(${uniqueCols.map(() => "?").join(", ")})`;
      const allPlaceholders = rowsData.map(() => singlePlaceholders).join(", ");
      const bulkSQL = `INSERT INTO orders (${uniqueCols.join(", ")}) VALUES ${allPlaceholders}`;
      const flatValues = rowsData.flat();

      const conn = await connectDirect();
      try {
        await conn.execute(bulkSQL, flatValues);
        fileInserted += rowsData.length;
      } finally {
        await conn.end();
      }

      if ((i + BATCH_SIZE) % 2000 < BATCH_SIZE) {
        console.log(`  Progress: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length} (${fileInserted} inserted)`);
      }
    }

    console.log(`  Inserted ${fileInserted} rows from this file`);
    totalInserted += fileInserted;
  }

  console.log(`\n[DONE] Total inserted: ${totalInserted}, skipped: ${totalSkipped}`);

  const conn = await connectDirect();
  const [countRows] = await conn.execute("SELECT COUNT(*) as cnt FROM orders");
  console.log(`[VERIFY] Total rows in orders table: ${(countRows as any)[0].cnt}`);
  await conn.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
