require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function test() {
  try {
    const res = await pool.query('SELECT i.* FROM ims_grn_items i JOIN ims_grn g ON g.id = i.grn_id WHERE i.grn_id=$1', [5]);
    console.log('ROWS FOR GRN 5:', res.rows);
  } catch (err) {
    console.error('QUERY ERROR:', err.message);
  } finally {
    pool.end();
  }
}

test();
