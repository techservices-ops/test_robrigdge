const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

let lastMaxId = 0;

async function init() {
  try {
    const res = await pool.query('SELECT MAX(id) as max_id FROM ims_scan_events');
    lastMaxId = Number(res.rows[0].max_id || 0);
    console.log(`📡 Watching for new scans starting from ID > ${lastMaxId}...`);
    
    // Print current stock of some items
    const items = await pool.query('SELECT barcode, name, stock FROM ims_items ORDER BY updated_at DESC LIMIT 5');
    console.log('Current items stock preview:');
    console.log(items.rows);
  } catch (e) {
    console.error('Initialization error:', e);
  }
}

async function check() {
  try {
    const res = await pool.query('SELECT id, barcode, item_name, workflow, quantity, scanned_at, websocket_scan_id FROM ims_scan_events WHERE id > $1 ORDER BY id ASC', [lastMaxId]);
    if (res.rows.length > 0) {
      for (const row of res.rows) {
        console.log(`\n🆕 NEW SCAN EVENT DETECTED:`);
        console.log(`   ID: ${row.id}`);
        console.log(`   Barcode: ${row.barcode}`);
        console.log(`   Item Name: ${row.item_name}`);
        console.log(`   Workflow: ${row.workflow}`);
        console.log(`   Quantity: ${row.quantity}`);
        console.log(`   Scanned At: ${row.scanned_at}`);
        console.log(`   WS Scan ID: ${row.websocket_scan_id}`);
        
        // Query updated stock
        const itemRes = await pool.query('SELECT stock FROM ims_items WHERE barcode = $1 LIMIT 1', [row.barcode]);
        if (itemRes.rows.length > 0) {
          console.log(`   Updated Stock in DB: ${itemRes.rows[0].stock}`);
        }
        
        lastMaxId = Math.max(lastMaxId, row.id);
      }
    }
  } catch (e) {
    console.error('Check error:', e);
  }
}

async function run() {
  await init();
  setInterval(check, 1000);
}

run();
