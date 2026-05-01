import mysql from "mysql2/promise";

const LOCAL_PROXY_PORT = 13306;

const useTailscale = !!process.env.TAILSCALE_AUTH_KEY;
const mysqlHost = useTailscale ? "127.0.0.1" : process.env.MYSQL_HOST;
const mysqlPort = useTailscale ? LOCAL_PROXY_PORT : (Number(process.env.MYSQL_PORT) || 3306);

const pool = mysql.createPool({
  host: mysqlHost,
  port: mysqlPort,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: useTailscale ? undefined : { rejectUnauthorized: true },
  connectTimeout: 10000,
});

export async function initOrdersTable(): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_date DATE NOT NULL,
        order_type VARCHAR(50) NOT NULL,
        location VARCHAR(100) NOT NULL,
        totes_requested INT DEFAULT NULL,
        totes_returned INT DEFAULT NULL,
        duros_requested INT DEFAULT NULL,
        duros_returned INT DEFAULT NULL,
        blue_bins_requested INT DEFAULT NULL,
        blue_bins_returned INT DEFAULT NULL,
        gaylords_requested INT DEFAULT NULL,
        gaylords_returned INT DEFAULT NULL,
        pallets_requested INT DEFAULT NULL,
        pallets_returned INT DEFAULT NULL,
        containers_requested INT DEFAULT NULL,
        containers_returned INT DEFAULT NULL,
        apparel_gaylords_requested INT DEFAULT NULL,
        apparel_gaylords_returned INT DEFAULT NULL,
        wares_gaylords_requested INT DEFAULT NULL,
        wares_gaylords_returned INT DEFAULT NULL,
        electrical_gaylords_requested INT DEFAULT NULL,
        electrical_gaylords_returned INT DEFAULT NULL,
        accessories_gaylords_requested INT DEFAULT NULL,
        accessories_gaylords_returned INT DEFAULT NULL,
        books_gaylords_requested INT DEFAULT NULL,
        books_gaylords_returned INT DEFAULT NULL,
        shoes_gaylords_requested INT DEFAULT NULL,
        shoes_gaylords_returned INT DEFAULT NULL,
        furniture_gaylords_requested INT DEFAULT NULL,
        furniture_gaylords_returned INT DEFAULT NULL,
        saved_winter_requested INT DEFAULT NULL,
        saved_winter_returned INT DEFAULT NULL,
        saved_summer_requested INT DEFAULT NULL,
        saved_summer_returned INT DEFAULT NULL,
        saved_halloween_requested INT DEFAULT NULL,
        saved_halloween_returned INT DEFAULT NULL,
        saved_christmas_requested INT DEFAULT NULL,
        saved_christmas_returned INT DEFAULT NULL,
        full_totes INT DEFAULT NULL,
        empty_totes INT DEFAULT NULL,
        full_gaylords INT DEFAULT NULL,
        empty_gaylords INT DEFAULT NULL,
        full_duros INT DEFAULT NULL,
        empty_duros INT DEFAULT NULL,
        full_containers INT DEFAULT NULL,
        empty_containers INT DEFAULT NULL,
        full_blue_bins INT DEFAULT NULL,
        empty_blue_bins INT DEFAULT NULL,
        empty_pallets INT DEFAULT NULL,
        outlet_apparel INT DEFAULT NULL,
        outlet_shoes INT DEFAULT NULL,
        outlet_metal INT DEFAULT NULL,
        outlet_wares INT DEFAULT NULL,
        outlet_accessories INT DEFAULT NULL,
        outlet_electrical INT DEFAULT NULL,
        ecom_containers_sent INT DEFAULT NULL,
        rotated_apparel INT DEFAULT NULL,
        rotated_shoes INT DEFAULT NULL,
        rotated_books INT DEFAULT NULL,
        rotated_wares INT DEFAULT NULL,
        apparel_gaylords_used INT DEFAULT NULL,
        wares_gaylords_used INT DEFAULT NULL,
        book_gaylords_used INT DEFAULT NULL,
        shoe_gaylords_used INT DEFAULT NULL,
        donors INT DEFAULT NULL,
        is_central_processing TINYINT(1) DEFAULT NULL,
        apparel_production INT DEFAULT NULL,
        wares_production INT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        submitted_by VARCHAR(255) DEFAULT NULL,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order_date (order_date),
        INDEX idx_order_type (order_type),
        INDEX idx_location (location)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("[MySQL] Orders table ready");

    const [cols] = await conn.query<any[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'`
    );
    const colSet = new Set((cols as Array<{ COLUMN_NAME: string }>).map(c => c.COLUMN_NAME.toLowerCase()));
    const ensureCol = async (name: string, ddl: string): Promise<boolean> => {
      if (!colSet.has(name.toLowerCase())) {
        await conn.query(`ALTER TABLE orders ADD COLUMN ${name} ${ddl}`);
        colSet.add(name.toLowerCase());
        console.log(`[MySQL] Added orders.${name}`);
        return true;
      }
      return false;
    };
    await ensureCol("furniture_gaylords_requested", "INT DEFAULT NULL");
    await ensureCol("furniture_gaylords_returned", "INT DEFAULT NULL");
    await ensureCol("fulfilled_at", "DATETIME DEFAULT NULL");
    await ensureCol("fulfilled_by", "VARCHAR(255) DEFAULT NULL");

    // First Aid order type (per-item replenishment counts). Each item is a
    // single INT column — the new "First Aid" order type uses these instead
    // of the equipment columns above.
    await ensureCol("first_aid_guide", "INT DEFAULT NULL");
    await ensureCol("cpr_mask", "INT DEFAULT NULL");
    await ensureCol("scissors", "INT DEFAULT NULL");
    await ensureCol("tweezers", "INT DEFAULT NULL");
    await ensureCol("medical_exam_gloves", "INT DEFAULT NULL");
    await ensureCol("antibiotic_treatment", "INT DEFAULT NULL");
    await ensureCol("antiseptic", "INT DEFAULT NULL");
    await ensureCol("burn_treatment", "INT DEFAULT NULL");
    await ensureCol("sterile_bandaids", "INT DEFAULT NULL");
    await ensureCol("medical_tape", "INT DEFAULT NULL");
    await ensureCol("triangular_sling", "INT DEFAULT NULL");
    await ensureCol("absorbent_compress", "INT DEFAULT NULL");
    await ensureCol("sterile_pads", "INT DEFAULT NULL");
    await ensureCol("sting_bite_ampules", "INT DEFAULT NULL");
    await ensureCol("stop_bleed_kit", "INT DEFAULT NULL");
    await ensureCol("instant_cold_pack", "INT DEFAULT NULL");
    await ensureCol("spill_kit", "INT DEFAULT NULL");

    // Phase 1 order approval workflow
    const statusJustAdded = await ensureCol(
      "status",
      "VARCHAR(20) NOT NULL DEFAULT 'submitted'",
    );
    await ensureCol("approved_at", "DATETIME DEFAULT NULL");
    await ensureCol("approved_by", "VARCHAR(255) DEFAULT NULL");
    await ensureCol("denied_at", "DATETIME DEFAULT NULL");
    await ensureCol("denied_by", "VARCHAR(255) DEFAULT NULL");
    await ensureCol("denial_reason", "TEXT DEFAULT NULL");

    // Backfill: any pre-existing rows had no concept of status, so treat them
    // as the legacy behavior — anything fulfilled is "received", everything
    // else is treated as "approved" (because the old engine counted them all
    // toward inventory). Only run on the migration that just added the column,
    // so we don't keep clobbering live data on subsequent boots.
    if (statusJustAdded) {
      await conn.query(
        "UPDATE orders SET status = 'received', approved_at = COALESCE(approved_at, fulfilled_at), approved_by = COALESCE(approved_by, fulfilled_by) WHERE fulfilled_at IS NOT NULL",
      );
      await conn.query(
        "UPDATE orders SET status = 'approved', approved_at = COALESCE(approved_at, submitted_at), approved_by = COALESCE(approved_by, submitted_by) WHERE fulfilled_at IS NULL",
      );
      console.log("[MySQL] Backfilled orders.status (fulfilled→received, others→approved)");
    }

    // Helpful index for status filtering in the warehouse on-hand engine and
    // the seasonal balance loaders.
    try {
      await conn.query("CREATE INDEX idx_orders_status ON orders(status)");
    } catch {
      /* index already exists */
    }
  } finally {
    conn.release();
  }
}

export { pool as mysqlPool };
