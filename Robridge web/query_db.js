const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: false
});

async function run() {
  try {
    const workspaces = await pool.query('SELECT * FROM ims_workspaces');
    console.log('Workspaces:', workspaces.rows);
    const members = await pool.query('SELECT * FROM ims_workspace_members');
    console.log('Members:', members.rows);
    const users = await pool.query('SELECT id, name, email FROM users');
    console.log('Users:', users.rows);
    const items = await pool.query('SELECT * FROM ims_items');
    console.log('Items:', items.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
