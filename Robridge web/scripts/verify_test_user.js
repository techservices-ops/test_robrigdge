require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query("UPDATE users SET email_verified = true WHERE email = 'testuser1@robridge.com' RETURNING id, email, name")
  .then(r => { console.log('Verified:', JSON.stringify(r.rows)); pool.end(); })
  .catch(e => { console.error('Error:', e.message); pool.end(); });
