const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function run() {
  try {
    const items = await pool.query(
      "SELECT id, workspace_id, barcode, name, stock, updated_at FROM ims_items WHERE barcode = '240701214'"
    );
    console.log('--- ITEMS FOR BARCODE 240701214 ---');
    console.table(items.rows);

    const scans = await pool.query(
      "SELECT id, workspace_id, barcode, item_name, workflow, quantity, scanned_at FROM ims_scan_events WHERE barcode = '240701214' ORDER BY scanned_at DESC"
    );
    console.log('--- SCANS FOR BARCODE 240701214 ---');
    console.table(scans.rows);

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
