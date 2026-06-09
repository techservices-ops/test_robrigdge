const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function run() {
  try {
    // Show all ims_items with duplicate barcodes
    const dupes = await pool.query(`
      SELECT id, workspace_id, barcode, name, stock, master_id, updated_at
      FROM ims_items
      ORDER BY barcode, workspace_id, id
    `);
    console.log('--- ALL IMS_ITEMS ---');
    console.table(dupes.rows);

    // Show duplicates (same workspace_id + barcode)
    const dupCheck = await pool.query(`
      SELECT workspace_id, barcode, COUNT(*) as cnt, ARRAY_AGG(id) as ids, ARRAY_AGG(stock) as stocks
      FROM ims_items
      GROUP BY workspace_id, barcode
      HAVING COUNT(*) > 1
    `);
    console.log('--- DUPLICATE BARCODE/WORKSPACE COMBOS ---');
    console.table(dupCheck.rows);

    // Also show what the scan endpoint does: what WHERE clause it uses
    // From server.js line 5243: WHERE id = $2 AND workspace_id = $3  (uses ID - OK)
    // From server.js line 5246: WHERE id = $2 AND workspace_id = $3  (uses ID - OK)
    // But the ESP32/GRN approve path uses WHERE barcode = $2 AND workspace_id = $3 (hits duplicates!)
    console.log('\n--- SCAN ENDPOINT NOTES ---');
    console.log('POST /api/ims/scanner/scan uses WHERE id = resolvedItemId  => only hits ONE row (OK)');
    console.log('GRN approve uses WHERE barcode = ... (hits ALL rows with that barcode!)');
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
