// Script to fix existing scans in the database
// Run this with: node fix_scans.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixScans() {
    try {
        console.log('🔧 Starting database fix...');

        // Step 1: Update source field
        console.log('📝 Updating source field from lowercase to uppercase...');
        const sourceUpdate = await pool.query(`
      UPDATE barcodes 
      SET source = 'ESP32' 
      WHERE LOWER(source) = 'esp32'
    `);
        console.log(`✅ Updated ${sourceUpdate.rowCount} scans with correct source`);

        // Step 2: Check for scans without user_id
        const nullUserIdCheck = await pool.query(`
      SELECT COUNT(*) as count FROM barcodes WHERE user_id IS NULL
    `);
        console.log(`⚠️  Found ${nullUserIdCheck.rows[0].count} scans without user_id`);

        if (parseInt(nullUserIdCheck.rows[0].count) > 0) {
            console.log('📝 Assigning scans to user ID 11 (testuser1)...');
            const userIdUpdate = await pool.query(`
        UPDATE barcodes 
        SET user_id = 11 
        WHERE user_id IS NULL
      `);
            console.log(`✅ Updated ${userIdUpdate.rowCount} scans with user_id`);
        }

        // Step 3: Verify the changes
        const verification = await pool.query(`
      SELECT 
        COUNT(*) as total_scans,
        COUNT(CASE WHEN source = 'ESP32' THEN 1 END) as esp32_uppercase_scans,
        COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as scans_with_user_id,
        COUNT(CASE WHEN user_id IS NULL THEN 1 END) as scans_without_user_id
      FROM barcodes
    `);

        console.log('\n📊 Database Statistics:');
        console.log(verification.rows[0]);
        console.log('\n✅ Database fix complete!');

    } catch (error) {
        console.error('❌ Error fixing database:', error);
    } finally {
        await pool.end();
    }
}

fixScans();
