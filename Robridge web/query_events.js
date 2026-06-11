const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function run() {
  try {
    const scans = await pool.query(
      'SELECT id, workspace_id, barcode, item_name, workflow, quantity, notes, scanned_at FROM ims_scan_events ORDER BY scanned_at DESC LIMIT 20'
    );
    console.log(`--- RECENT SCANS ACROSS ALL WORKSPACES ---`);
    console.table(scans.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
