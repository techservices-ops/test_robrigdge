require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    const wsId = 86;
    const bufferMultiplier = 1;
    
    console.log('Testing low stock query...');
    await pool.query(`SELECT i.id, i.name, i.barcode, i.stock, i.category, ROUND(COALESCE(c.alert_at, 10) * $2) as alert_at
       FROM ims_items i
       LEFT JOIN ims_categories c ON LOWER(c.name) = LOWER(i.category) AND c.workspace_id = i.workspace_id
       WHERE i.workspace_id = $1 AND i.stock <= ROUND(COALESCE(c.alert_at, 10) * $2)
       ORDER BY i.stock ASC LIMIT 20`, [wsId, bufferMultiplier]);

    console.log('Testing scan events...');
    await pool.query('SELECT COUNT(*)::int as count FROM ims_scan_events WHERE workspace_id = $1 AND scanned_at >= CURRENT_DATE', [wsId]);
    
    console.log('Testing recent activity...');
    await pool.query('SELECT barcode, item_name, workflow, quantity, unit, scanned_at FROM ims_scan_events WHERE workspace_id = $1 ORDER BY scanned_at DESC LIMIT 20', [wsId]);

    console.log('Testing category breakdown...');
    await pool.query('SELECT category, COUNT(*)::int as sku_count, COALESCE(SUM(stock),0)::int as total_stock FROM ims_items WHERE workspace_id = $1 GROUP BY category ORDER BY total_stock DESC', [wsId]);

    console.log('All queries successful!');
  } catch(e) {
    console.error('ERROR:', e.message);
  } finally {
    pool.end();
  }
}
run();
