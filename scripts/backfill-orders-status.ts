import "dotenv/config";
import { mysqlPool } from "../server/mysql";

(async () => {
  const conn = await mysqlPool.getConnection();
  try {
    const [r1]: any = await conn.query(
      "UPDATE orders SET status = 'received', approved_at = COALESCE(approved_at, fulfilled_at), approved_by = COALESCE(approved_by, fulfilled_by) WHERE fulfilled_at IS NOT NULL AND status = 'submitted'",
    );
    const [r2]: any = await conn.query(
      "UPDATE orders SET status = 'approved', approved_at = COALESCE(approved_at, submitted_at), approved_by = COALESCE(approved_by, submitted_by) WHERE fulfilled_at IS NULL AND status = 'submitted'",
    );
    console.log("Backfill complete. received:", r1.affectedRows, "approved:", r2.affectedRows);
  } finally {
    conn.release();
    process.exit(0);
  }
})();
