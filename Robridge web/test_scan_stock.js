const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function run() {
  try {
    // 1. Get current stock of item with barcode '123456'
    const beforeRes = await pool.query("SELECT id, stock FROM ims_items WHERE barcode = '123456' AND workspace_id = 11");
    if (beforeRes.rows.length === 0) {
      console.log('Item not found');
      return;
    }
    const item = beforeRes.rows[0];
    console.log('Stock BEFORE:', item.stock);

    // 2. Perform raw update like the scan endpoint does
    const updateRes = await pool.query(
      "UPDATE ims_items SET stock = stock + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND workspace_id = 11 RETURNING stock",
      [item.id]
    );
    console.log('Stock AFTER update query:', updateRes.rows[0].stock);

    // 3. Rollback the change
    await pool.query("UPDATE ims_items SET stock = stock - 1 WHERE id = $1 AND workspace_id = 11", [item.id]);
    console.log('Stock rolled back.');

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
