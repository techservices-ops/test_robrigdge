require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkLocks() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT pid, state, query, wait_event_type, wait_event
      FROM pg_stat_activity
      WHERE state != 'idle' AND pid != pg_backend_pid();
    `);
    console.log('Running queries:', res.rows);
    
    const locks = await client.query(`
      SELECT a.datname, l.relation::regclass, l.transactionid, l.mode, l.GRANTED,
      a.usename, a.query, a.pid
      FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid = a.pid
      WHERE a.pid != pg_backend_pid() AND l.mode LIKE '%ExclusiveLock%';
    `);
    console.log('Locks:', locks.rows);

    // If there is a hanging CREATE TABLE query, let's terminate it
    for (const row of res.rows) {
      if (row.query.includes('CREATE TABLE IF NOT EXISTS ims_masters')) {
         console.log('Terminating pid', row.pid);
         await client.query(`SELECT pg_terminate_backend($1)`, [row.pid]);
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

checkLocks();
