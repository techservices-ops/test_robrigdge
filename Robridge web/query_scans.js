const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: false
});

async function run() {
  try {
    const scans = await pool.query('SELECT id, barcode, item_name, workflow, quantity, scanned_at FROM ims_scan_events ORDER BY scanned_at DESC LIMIT 20');
    console.log('--- RECENT SCANS ---');
    console.log(scans.rows);

    const items = await pool.query('SELECT id, barcode, name, stock, updated_at FROM ims_items ORDER BY updated_at DESC LIMIT 10');
    console.log('--- RECENT ITEMS ---');
    console.log(items.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
