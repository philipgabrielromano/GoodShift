const mysql = require("mysql2/promise");

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 13306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  try {
    const [r1] = await conn.query(
      "UPDATE orders SET status = 'received', approved_at = COALESCE(approved_at, fulfilled_at), approved_by = COALESCE(approved_by, fulfilled_by) WHERE fulfilled_at IS NOT NULL AND status = 'submitted'",
    );
    const [r2] = await conn.query(
      "UPDATE orders SET status = 'approved', approved_at = COALESCE(approved_at, submitted_at), approved_by = COALESCE(approved_by, submitted_by) WHERE fulfilled_at IS NULL AND status = 'submitted'",
    );
    const [counts] = await conn.query("SELECT status, COUNT(*) as c FROM orders GROUP BY status");
    console.log("received:", r1.affectedRows, "approved:", r2.affectedRows);
    console.log("status counts:", counts);
  } finally {
    await conn.end();
  }
})();
