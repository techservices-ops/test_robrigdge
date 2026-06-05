const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'robridge',
  password: process.env.PGPASSWORD || 'postgres',
  port: process.env.PGPORT || 5432,
});

async function test() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS test_pairing ( id int PRIMARY KEY, code text )`);
    await pool.query(
      `INSERT INTO test_pairing (id, code) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET code = $2`,
      [1, 'TEST']
    );
    console.log('Success!');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}
test();
