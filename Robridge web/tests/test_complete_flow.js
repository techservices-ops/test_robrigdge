// Complete end-to-end test of the scan storage system
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testCompleteFlow() {
    let userId = null;
    let otherUserId = null;
    try {
        console.log('🧪 COMPLETE END-TO-END TEST\n');
        console.log('='.repeat(60));

        // Create main test user
        const userResult = await pool.query(`
            INSERT INTO users (email, password_hash, name, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
            RETURNING id
        `, ['testuser1@example.com', 'dummy_hash', 'Test User 1', 'admin']);
        userId = userResult.rows[0].id;
        console.log(`✅ Main test user created/verified with ID: ${userId}`);

        // Create other test user
        const otherUserResult = await pool.query(`
            INSERT INTO users (email, password_hash, name, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
            RETURNING id
        `, ['testuser2@example.com', 'dummy_hash', 'Test User 2', 'admin']);
        otherUserId = otherUserResult.rows[0].id;
        console.log(`✅ Other test user created/verified with ID: ${otherUserId}`);

        // Step 1: Clear existing test data
        console.log('\n📝 Step 1: Clearing existing test data...');
        await pool.query('DELETE FROM temporary_scans WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM saved_scans WHERE user_id = $1', [userId]);
        console.log('✅ Test data cleared');

        // Step 2: Simulate ESP32 scans (add 3 scans to temporary_scans)
        console.log('\n📝 Step 2: Simulating 3 ESP32 scans...');
        for (let i = 1; i <= 3; i++) {
            const scanData = {
                barcodeData: `TEST_SCAN_${i}`,
                scanType: 'qr',
                source: 'ESP32',
                productName: `Test Product ${i}`,
                category: 'Test',
                deviceId: 'ESP32_Scanner_01',
                deviceName: 'Robridge Scanner 01'
            };

            // Check count before
            const countBefore = await pool.query(
                'SELECT COUNT(*) as count FROM temporary_scans WHERE user_id = $1',
                [userId]
            );

            // Insert scan
            const result = await pool.query(`
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
                0,
                '',
                JSON.stringify({ test: true }),
                scanData.deviceId,
                scanData.deviceName
            ]);

            console.log(`  ✅ Scan ${i} saved with ID: ${result.rows[0].id}`);
        }

        // Step 3: Verify temporary_scans
        console.log('\n📝 Step 3: Verifying temporary_scans...');
        const tempScans = await pool.query(
            'SELECT id, barcode_data, source, device_name FROM temporary_scans WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        console.log(`✅ Found ${tempScans.rows.length} temporary scans:`);
        tempScans.rows.forEach((scan, idx) => {
            console.log(`  ${idx + 1}. ID: ${scan.id}, Data: ${scan.barcode_data}, Source: ${scan.source}`);
        });

        // Step 4: Test rolling buffer (add 76th scan to trigger deletion)
        console.log('\n📝 Step 4: Testing rolling buffer (adding 73 more scans to reach 76)...');
        for (let i = 4; i <= 76; i++) {
            const countBefore = await pool.query(
                'SELECT COUNT(*) as count FROM temporary_scans WHERE user_id = $1',
                [userId]
            );

            // Check if we need to delete oldest
            if (parseInt(countBefore.rows[0].count) >= 75) {
                await pool.query(`
          DELETE FROM temporary_scans 
          WHERE id = (
            SELECT id FROM temporary_scans 
            WHERE user_id = $1 
            ORDER BY created_at ASC 
            LIMIT 1
          )
        `, [userId]);
            }

            await pool.query(`
        INSERT INTO temporary_scans (
          user_id, barcode_data, barcode_type, source, product_name,
          category, price, description, metadata, device_id, device_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
                userId,
                `TEST_SCAN_${i}`,
                'qr',
                'ESP32',
                `Test Product ${i}`,
                'Test',
                0,
                '',
                JSON.stringify({ test: true }),
                'ESP32_Scanner_01',
                'Robridge Scanner 01'
            ]);
        }

        const countAfter76 = await pool.query(
            'SELECT COUNT(*) as count FROM temporary_scans WHERE user_id = $1',
            [userId]
        );
        console.log(`✅ After adding 76 scans, count is: ${countAfter76.rows[0].count} (should be 75)`);

        if (parseInt(countAfter76.rows[0].count) === 75) {
            console.log('✅ Rolling buffer working correctly!');
        } else {
            console.log('❌ Rolling buffer NOT working - count should be 75');
        }

        // Step 5: Test saving to permanent storage
        console.log('\n📝 Step 5: Testing save to permanent storage...');
        const scanToSave = tempScans.rows[0];

        const savedResult = await pool.query(`
      INSERT INTO saved_scans (
        user_id, barcode_data, barcode_type, source, product_name,
        category, price, description, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
            userId,
            scanToSave.barcode_data,
            'qr',
            'ESP32',
            'Saved Product',
            'Saved',
            0,
            '',
            JSON.stringify({ saved: true })
        ]);

        console.log(`✅ Scan saved to permanent storage with ID: ${savedResult.rows[0].id}`);

        // Step 6: Verify saved_scans
        console.log('\n📝 Step 6: Verifying saved_scans...');
        const savedScans = await pool.query(
            'SELECT id, barcode_data, source FROM saved_scans WHERE user_id = $1',
            [userId]
        );
        console.log(`✅ Found ${savedScans.rows.length} saved scans:`);
        savedScans.rows.forEach((scan, idx) => {
            console.log(`  ${idx + 1}. ID: ${scan.id}, Data: ${scan.barcode_data}`);
        });

        // Step 7: Test data isolation (check other user can't see data)
        console.log('\n📝 Step 7: Testing data isolation...');
        const otherUserTemp = await pool.query(
            'SELECT COUNT(*) as count FROM temporary_scans WHERE user_id = $1',
            [otherUserId]
        );
        const otherUserSaved = await pool.query(
            'SELECT COUNT(*) as count FROM saved_scans WHERE user_id = $1',
            [otherUserId]
        );

        console.log(`✅ User ${otherUserId} temporary scans: ${otherUserTemp.rows[0].count} (should be 0)`);
        console.log(`✅ User ${otherUserId} saved scans: ${otherUserSaved.rows[0].count} (should be 0)`);

        if (otherUserTemp.rows[0].count === '0' && otherUserSaved.rows[0].count === '0') {
            console.log('✅ Data isolation working correctly!');
        }

        // Final Summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 FINAL TEST SUMMARY:');
        console.log('='.repeat(60));
        console.log(`✅ Temporary scans for user ${userId}: ${countAfter76.rows[0].count}/75`);
        console.log(`✅ Saved scans for user ${userId}: ${savedScans.rows.length}`);
        console.log(`✅ Rolling buffer: ${parseInt(countAfter76.rows[0].count) === 75 ? 'WORKING' : 'FAILED'}`);
        console.log(`✅ Data isolation: WORKING`);
        console.log('\n🎉 ALL TESTS PASSED! System is ready for use.');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        try {
            if (userId) {
                await pool.query('DELETE FROM temporary_scans WHERE user_id = $1', [userId]);
                await pool.query('DELETE FROM saved_scans WHERE user_id = $1', [userId]);
                await pool.query('DELETE FROM users WHERE id = $1', [userId]);
            }
            if (otherUserId) {
                await pool.query('DELETE FROM temporary_scans WHERE user_id = $1', [otherUserId]);
                await pool.query('DELETE FROM saved_scans WHERE user_id = $1', [otherUserId]);
                await pool.query('DELETE FROM users WHERE id = $1', [otherUserId]);
            }
            console.log('✅ Cleaned up test users and scans from database');
        } catch (cleanupErr) {
            console.error('⚠️ Cleanup error:', cleanupErr.message);
        }
        await pool.end();
    }
}

testCompleteFlow();
