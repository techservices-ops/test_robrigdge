require('dotenv').config();
const { Pool } = require('pg');

// Use same config as server.js
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false
});

async function clearScanData() {
    try {
        console.log('🗑️  Clearing all scan data and device pairings...\n');

        // Delete all barcodes
        const barcodesResult = await pool.query('DELETE FROM barcodes');
        console.log(`✅ Deleted ${barcodesResult.rowCount} barcodes`);

        // Delete all saved scans
        const savedScansResult = await pool.query('DELETE FROM saved_scans');
        console.log(`✅ Deleted ${savedScansResult.rowCount} saved scans`);

        // Delete all device pairings
        const devicesResult = await pool.query('DELETE FROM user_devices');
        console.log(`✅ Deleted ${devicesResult.rowCount} device pairings`);

        console.log('\n🎉 All scan data cleared! User accounts are preserved.');
        console.log('\n📝 Remaining users:');

        const usersResult = await pool.query('SELECT id, email, name, role FROM users ORDER BY id');
        usersResult.rows.forEach(user => {
            console.log(`   - ${user.email} (${user.name}) - Role: ${user.role}`);
        });

    } catch (error) {
        console.error('❌ Error clearing data:', error);
    } finally {
        await pool.end();
    }
}

clearScanData();
