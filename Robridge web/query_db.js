const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: (dbUrl && dbUrl.includes('render.com')) ? true : { rejectUnauthorized: false }
});

async function run() {
  try {
    const counts = await pool.query('SELECT workspace_id, master_id, COUNT(*) FROM ims_items GROUP BY workspace_id, master_id ORDER BY workspace_id');
    console.log(counts.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
