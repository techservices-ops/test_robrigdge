require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false
});

async function checkScanData() {
    try {
        console.log('🔍 Checking scan data and user_id assignments...\n');

        // Get all barcodes with their user_id
        const barcodesResult = await pool.query(`
      SELECT id, barcode_data, device_id, user_id, created_at 
      FROM barcodes 
      ORDER BY created_at DESC
    `);

        console.log(`📊 Total barcodes: ${barcodesResult.rows.length}\n`);

        barcodesResult.rows.forEach(scan => {
            console.log(`ID: ${scan.id}`);
            console.log(`  Barcode: ${scan.barcode_data.substring(0, 50)}...`);
            console.log(`  Device: ${scan.device_id}`);
            console.log(`  User ID: ${scan.user_id || 'NULL ❌'}`);
            console.log(`  Created: ${scan.created_at}`);
            console.log('');
        });

        // Get user info
        console.log('\n👥 Users:');
        const usersResult = await pool.query('SELECT id, email FROM users ORDER BY id');
        usersResult.rows.forEach(user => {
            console.log(`  ID ${user.id}: ${user.email}`);
        });

        // Get device pairings
        console.log('\n📱 Device Pairings:');
        const devicesResult = await pool.query(`
      SELECT ud.device_id, ud.device_name, ud.user_id, u.email 
      FROM user_devices ud
      JOIN users u ON ud.user_id = u.id
      WHERE ud.is_active = true
    `);

        if (devicesResult.rows.length === 0) {
            console.log('  No devices paired');
        } else {
            devicesResult.rows.forEach(device => {
                console.log(`  ${device.device_id} (${device.device_name}) → User ${device.user_id} (${device.email})`);
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkScanData();
