const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function run() {
  try {
    const scans = await pool.query(
      'SELECT id, barcode, item_name, workflow, quantity, notes, scanned_at FROM ims_scan_events WHERE workspace_id = 11 ORDER BY scanned_at DESC'
    );
    console.log('--- ALL SCANS IN WORKSPACE 11 ---');
    console.table(scans.rows);

    const items = await pool.query(
      'SELECT id, barcode, name, stock, updated_at FROM ims_items WHERE workspace_id = 11'
    );
    console.log('--- ALL ITEMS IN WORKSPACE 11 ---');
    console.table(items.rows);

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
