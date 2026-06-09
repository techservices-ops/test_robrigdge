require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')) ? true : false,
});

async function run() {
  try {
    // Let's get the first active workspace ID or fallback
    const wsRes = await pool.query('SELECT id FROM ims_workspaces LIMIT 1');
    if (wsRes.rows.length === 0) {
      console.log('No workspaces found. Exiting.');
      return;
    }
    const wsId = wsRes.rows[0].id;
    console.log(`Using Workspace ID: ${wsId}\n`);

    console.log('1. Testing active workorders query...');
    const activeWo = await pool.query(
      `SELECT id, wo_number, product_name, target_qty, built_qty, status, due_date
       FROM ims_workorders
       WHERE workspace_id = $1 AND status IN ('PENDING', 'IN_PROGRESS', 'QC')
       ORDER BY created_at DESC LIMIT 5`,
      [wsId]
    );
    console.log(`   Success: Found ${activeWo.rows.length} active work orders.`);

    console.log('2. Testing active expiring batches query...');
    const expiry = await pool.query(
      `WITH batch_stock AS (
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
       ORDER BY expiry_date ASC`,
      [wsId]
    );
    console.log(`   Success: Found ${expiry.rows.length} expiring batches in stock.`);

    console.log('3. Testing weekly trend movement query...');
    const trends = await pool.query(
      `SELECT 
         DATE(scanned_at) as event_date,
         SUM(CASE WHEN workflow IN ('INWARD', 'ADD', 'RECEIVE', 'PUTAWAY', 'RESTOCK', 'RETURN') THEN quantity ELSE 0 END)::int as in_qty,
         SUM(CASE WHEN workflow IN ('OUTWARD', 'REMOVE', 'BOM_CONSUMPTION', 'DISPATCH', 'ISSUE', 'PICK', 'SHIP') THEN quantity ELSE 0 END)::int as out_qty
       FROM ims_scan_events
       WHERE workspace_id = $1 AND scanned_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY DATE(scanned_at)
       ORDER BY DATE(scanned_at) ASC`,
      [wsId]
    );
    console.log(`   Success: Found ${trends.rows.length} days of movement trends.`);

    const getLocalDateString = (dateObj) => {
      const d = new Date(dateObj);
      if (isNaN(d.getTime())) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(getLocalDateString(d));
    }
    console.log('Generated Dates:', dates);
    console.log('Database Rows:', trends.rows.map(r => ({
      raw_date: r.event_date,
      formatted_date: getLocalDateString(r.event_date),
      in_qty: r.in_qty,
      out_qty: r.out_qty
    })));

    const inData = dates.map(date => {
      const row = trends.rows.find(r => getLocalDateString(r.event_date) === date);
      return row ? row.in_qty : 0;
    });
    console.log('Mapped In Data:', inData);

    console.log('\n🎉 ALL DASHBOARD QUERIES ARE SQL VALID AND EXECUTED SUCCESSFULY!');
  } catch(e) {
    console.error('❌ SQL ERROR:', e.message);
  } finally {
    pool.end();
  }
}
run();
