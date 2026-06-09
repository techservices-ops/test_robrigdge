require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function run() {
  try {
    const wsId = 86;
    const bufferMultiplier = 1.15;
    
    console.log('Testing low stock query...');
    await pool.query(`SELECT i.id, i.name, i.barcode, i.stock, i.category, ROUND(COALESCE(c.alert_at, 10) * $2::numeric) as alert_at
       FROM ims_items i
       LEFT JOIN ims_categories c ON LOWER(c.name) = LOWER(i.category) AND c.workspace_id = i.workspace_id
       WHERE i.workspace_id = $1 AND i.stock <= ROUND(COALESCE(c.alert_at, 10) * $2::numeric)
       ORDER BY i.stock ASC LIMIT 20`, [wsId, bufferMultiplier]);

    console.log('Testing scan events...');
    await pool.query('SELECT COUNT(*)::int as count FROM ims_scan_events WHERE workspace_id = $1 AND scanned_at >= CURRENT_DATE', [wsId]);
    
    console.log('Testing recent activity...');
    await pool.query('SELECT barcode, item_name, workflow, quantity, unit, scanned_at FROM ims_scan_events WHERE workspace_id = $1 ORDER BY scanned_at DESC LIMIT 20', [wsId]);

    console.log('Testing category breakdown...');
    await pool.query('SELECT category, COUNT(*)::int as sku_count, COALESCE(SUM(stock),0)::int as total_stock FROM ims_items WHERE workspace_id = $1 GROUP BY category ORDER BY total_stock DESC', [wsId]);

    console.log('Testing workorders query...');
    await pool.query(`SELECT id, wo_number, product_name, target_qty, built_qty, status, due_date
       FROM ims_workorders
       WHERE workspace_id = $1 AND status IN ('PENDING', 'IN_PROGRESS', 'QC')
       ORDER BY created_at DESC LIMIT 5`, [wsId]);

    console.log('Testing expiry query...');
    await pool.query(`WITH batch_stock AS (
         SELECT 
           se.barcode,
           i.name as product_name,
           se.batch_no,
           se.expiry_date,
           COALESCE(SUM(CASE WHEN se.workflow IN ('INWARD', 'ADD', 'RECEIVE', 'PUTAWAY', 'RESTOCK', 'RETURN') THEN se.quantity ELSE 0 END), 0) -
           COALESCE(SUM(CASE WHEN se.workflow IN ('OUTWARD', 'REMOVE', 'BOM_CONSUMPTION', 'DISPATCH', 'ISSUE', 'PICK', 'SHIP') THEN se.quantity ELSE 0 END), 0) as current_qty
         FROM ims_scan_events se
         JOIN ims_items i ON i.barcode = se.barcode AND i.workspace_id = se.workspace_id
         WHERE se.workspace_id = $1 AND se.expiry_date IS NOT NULL
         GROUP BY se.barcode, i.name, se.batch_no, se.expiry_date
       )
       SELECT barcode, product_name, batch_no, expiry_date, current_qty
       FROM batch_stock
       WHERE current_qty > 0
       ORDER BY expiry_date ASC`, [wsId]);

    console.log('Testing weekly trends query...');
    await pool.query(`SELECT 
         TO_CHAR(scanned_at, 'YYYY-MM-DD') as event_date,
         SUM(CASE WHEN workflow IN ('INWARD', 'ADD', 'RECEIVE', 'PUTAWAY', 'RESTOCK', 'RETURN') THEN quantity ELSE 0 END)::int as in_qty,
         SUM(CASE WHEN workflow IN ('OUTWARD', 'REMOVE', 'BOM_CONSUMPTION', 'DISPATCH', 'ISSUE', 'PICK', 'SHIP') THEN quantity ELSE 0 END)::int as out_qty
       FROM ims_scan_events
       WHERE workspace_id = $1 AND scanned_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY TO_CHAR(scanned_at, 'YYYY-MM-DD')
       ORDER BY TO_CHAR(scanned_at, 'YYYY-MM-DD') ASC`, [wsId]);

    console.log('All queries successful!');
  } catch(e) {
    console.error('ERROR:', e.message);
  } finally {
    pool.end();
  }
}
run();
