// Check if scans are being saved to temporary_scans
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkScans() {
    try {
        console.log('🔍 Checking temporary_scans data...\n');

        // Count total scans
        const countResult = await pool.query('SELECT COUNT(*) as total FROM temporary_scans');
        console.log(`Total scans in temporary_scans: ${countResult.rows[0].total}`);

        // Count by user
        const userCountResult = await pool.query(`
      SELECT user_id, COUNT(*) as count 
      FROM temporary_scans 
      GROUP BY user_id
      ORDER BY user_id
    `);

        console.log('\nScans by user:');
        userCountResult.rows.forEach(row => {
            console.log(`  User ${row.user_id}: ${row.count} scans`);
        });

        // Show most recent scans
        const recentScans = await pool.query(`
      SELECT id, user_id, barcode_data, source, device_name, created_at 
      FROM temporary_scans 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

        console.log('\nMost recent 5 scans:');
        recentScans.rows.forEach((scan, index) => {
            console.log(`  ${index + 1}. ID: ${scan.id}, User: ${scan.user_id}, Data: ${scan.barcode_data}, Source: ${scan.source}, Time: ${scan.created_at}`);
        });

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkScans();
