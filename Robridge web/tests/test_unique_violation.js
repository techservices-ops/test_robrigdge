const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function run() {
  const wsId = 1;
  const userId = 11;
  const barcode = '123456';
  const testId = `test_ws_scan_${Date.now()}`;

  try {
    console.log('🧪 Starting Unique Constraint Verification...');

    // First insert
    console.log('Inserting first event...');
    await pool.query(
      `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, workflow, quantity, websocket_scan_id)
       VALUES ($1, $2, $3, 'RECEIVE', 1, $4)`,
      [userId, wsId, barcode, testId]
    );
    console.log('✅ First event inserted.');

    // Second insert (duplicate ID)
    console.log('Inserting duplicate event (should fail)...');
    try {
      await pool.query(
        `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, workflow, quantity, websocket_scan_id)
         VALUES ($1, $2, $3, 'RECEIVE', 1, $4)`,
         [userId, wsId, barcode, testId]
      );
      console.log('❌ Error: Duplicate insert succeeded when it should have failed!');
      process.exit(1);
    } catch (dbError) {
      console.log(`Received database error code: ${dbError.code}`);
      if (dbError.code === '23505') {
        console.log('✅ Success: Unique constraint violation (23505) correctly enforced by PostgreSQL.');
      } else {
        console.log('❌ Error: Expected code 23505 but got:', dbError);
        process.exit(1);
      }
    }

    // Cleanup
    await pool.query('DELETE FROM ims_scan_events WHERE websocket_scan_id = $1', [testId]);
    console.log('✅ Database cleaned up.');
    process.exit(0);

  } catch (err) {
    console.error('❌ Test script failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
