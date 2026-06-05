require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function mockExpress() {
  const req = {
    params: { id: '5' },
    workspace_id: 1
  };
  
  try {
    const result = await pool.query('SELECT i.* FROM ims_grn_items i JOIN ims_grn g ON g.id = i.grn_id WHERE i.grn_id=$1 AND g.workspace_id=$2', [req.params.id, req.workspace_id]);
    console.log('Result:', result.rows);
  } catch (e) {
    console.error('SERVER CRASH ERROR:', e);
  } finally {
    pool.end();
  }
}

mockExpress();
