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
    const ensureCol = async (name: string, ddl: string) => {
      if (!colSet.has(name.toLowerCase())) {
        await conn.query(`ALTER TABLE orders ADD COLUMN ${name} ${ddl}`);
        console.log(`[MySQL] Added orders.${name}`);
      }
    };
    await ensureCol("furniture_gaylords_requested", "INT DEFAULT NULL");
    await ensureCol("furniture_gaylords_returned", "INT DEFAULT NULL");
  } finally {
    conn.release();
  }
}

export { pool as mysqlPool };
