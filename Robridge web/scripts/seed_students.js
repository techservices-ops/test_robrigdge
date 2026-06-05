require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const WORKSPACE_ID = 86;

const students = [
  { barcode: '221001148', name: 'Sasikumar K S', dept: 'IT',  number: '9876543210', year: 'I' },
  { barcode: '221601020', name: 'Kaartieshwar',  dept: 'R&A', number: '3216549870', year: 'IV' },
  { barcode: '221601024', name: 'Umesh Yadav',   dept: 'CSE', number: '9638527410', year: 'III' },
  { barcode: '221001111', name: 'Ramu',           dept: 'IT',  number: '7418529630', year: 'II' },
];

async function run() {
  for (const s of students) {
    const locationsJson = JSON.stringify([{ zone: s.year }]);
    await pool.query(
      `INSERT INTO ims_items (workspace_id, barcode, name, category, base_unit, stock, supplier, locations)
       VALUES ($1, $2, $3, $4, 'Person', 1, $5, $6)
       ON CONFLICT (workspace_id, barcode) DO UPDATE 
         SET name = EXCLUDED.name, category = EXCLUDED.category, 
             supplier = EXCLUDED.supplier, locations = EXCLUDED.locations,
             updated_at = CURRENT_TIMESTAMP`,
      [WORKSPACE_ID, s.barcode, s.name, s.dept, s.number, locationsJson]
    );
    console.log('✅ Inserted:', s.name, '|', s.barcode, '|', s.dept, '|', s.number, '| Year', s.year);
  }
  console.log('\n🎉 All student records seeded successfully!');
  pool.end();
}

run().catch(e => { console.error('❌ Error:', e.message); pool.end(); });
