const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;
console.log('DB Url:', dbUrl ? 'Set' : 'Not set');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: false
});

async function run() {
  try {
    const client = await pool.connect();
    
    // List all triggers
    console.log('--- TRIGGERS ---');
    const triggers = await client.query(`
      SELECT 
        tgname as trigger_name,
        relname as table_name
      FROM pg_trigger
      JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid
      WHERE NOT tgisinternal
    `);
    console.log(triggers.rows);

    // List all user functions
    console.log('--- FUNCTIONS ---');
    const functions = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
    `);
    console.log(functions.rows.map(f => f.routine_name));

    client.release();
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
