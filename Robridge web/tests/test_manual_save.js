// Manual test - save a scan directly to temporary_scans
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testSave() {
    try {
        console.log('🧪 Testing manual save to temporary_scans...\n');

        const userId = 11; // testuser1
        const scanData = {
            barcodeData: 'TEST_BARCODE_123',
            scanType: 'qr',
            source: 'ESP32',
            productName: 'Test Product',
            category: 'Test',
            price: 0,
            metadata: { test: true },
            deviceId: 'TEST_DEVICE',
            deviceName: 'Test Scanner'
        };

        // Check current count
        const countBefore = await pool.query(
            'SELECT COUNT(*) as count FROM temporary_scans WHERE user_id = $1',
            [userId]
        );
        console.log(`Scans before: ${countBefore.rows[0].count}`);

        // Insert test scan
        const insertResult = await pool.query(`
      INSERT INTO temporary_scans (
        user_id, barcode_data, barcode_type, source, product_name,
        category, price, description, metadata, device_id, device_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
            userId,
            scanData.barcodeData,
            scanData.scanType,
            scanData.source,
            scanData.productName,
            scanData.category,
            scanData.price,
            '',
            JSON.stringify(scanData.metadata),
            scanData.deviceId,
            scanData.deviceName
        ]);

        console.log(`✅ Test scan saved with ID: ${insertResult.rows[0].id}`);

        // Check count after
        const countAfter = await pool.query(
            'SELECT COUNT(*) as count FROM temporary_scans WHERE user_id = $1',
            [userId]
        );
        console.log(`Scans after: ${countAfter.rows[0].count}`);

        // Fetch the scan
        const fetchResult = await pool.query(
            'SELECT * FROM temporary_scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [userId]
        );

        console.log('\nFetched scan:', fetchResult.rows[0]);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

testSave();
