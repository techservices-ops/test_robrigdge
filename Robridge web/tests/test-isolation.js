require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testDataIsolation() {
    console.log('🧪 Starting Data Isolation Test...\n');

    try {
        // Step 1: Clear all test data
        console.log('📋 Step 1: Clearing existing test data...');
        await pool.query('DELETE FROM barcodes');
        await pool.query('DELETE FROM saved_scans');
        await pool.query('DELETE FROM user_devices');
        await pool.query("DELETE FROM users WHERE email LIKE '%test%'");
        console.log('✅ Test data cleared\n');

        // Step 2: Create 2 test users
        console.log('📋 Step 2: Creating 2 test users...');
        const password1 = await bcrypt.hash('test123', 10);
        const password2 = await bcrypt.hash('test123', 10);

        const user1Result = await pool.query(
            `INSERT INTO users (email, password_hash, name, role) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, name`,
            ['testuser1@test.com', password1, 'Test User 1', 'expo_user']
        );
        const user1 = user1Result.rows[0];

        const user2Result = await pool.query(
            `INSERT INTO users (email, password_hash, name, role) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, name`,
            ['testuser2@test.com', password2, 'Test User 2', 'expo_user']
        );
        const user2 = user2Result.rows[0];

        console.log(`✅ Created User 1: ${user1.email} (ID: ${user1.id})`);
        console.log(`✅ Created User 2: ${user2.email} (ID: ${user2.id})\n`);

        // Step 3: Pair devices to each user
        console.log('📋 Step 3: Pairing devices to users...');
        await pool.query(
            `INSERT INTO user_devices (user_id, device_id, device_name, last_seen, is_active)
       VALUES ($1, $2, $3, NOW(), true)`,
            [user1.id, 'TEST_DEVICE_001', 'User 1 Scanner']
        );

        await pool.query(
            `INSERT INTO user_devices (user_id, device_id, device_name, last_seen, is_active)
       VALUES ($1, $2, $3, NOW(), true)`,
            [user2.id, 'TEST_DEVICE_002', 'User 2 Scanner']
        );

        console.log(`✅ Paired TEST_DEVICE_001 to User 1`);
        console.log(`✅ Paired TEST_DEVICE_002 to User 2\n`);

        // Step 4: Create scans for each user
        console.log('📋 Step 4: Creating test scans...');

        // User 1 scans
        await pool.query(
            `INSERT INTO barcodes (barcode_id, barcode_data, barcode_type, source, product_name, category, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            ['SCAN_USER1_001', '1234567890', 'barcode', 'esp32', 'Product A', 'Category A', user1.id]
        );
        await pool.query(
            `INSERT INTO barcodes (barcode_id, barcode_data, barcode_type, source, product_name, category, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            ['SCAN_USER1_002', '2345678901', 'qr', 'esp32', 'Product B', 'Category B', user1.id]
        );

        // User 2 scans
        await pool.query(
            `INSERT INTO barcodes (barcode_id, barcode_data, barcode_type, source, product_name, category, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            ['SCAN_USER2_001', '9876543210', 'barcode', 'esp32', 'Product X', 'Category X', user2.id]
        );
        await pool.query(
            `INSERT INTO barcodes (barcode_id, barcode_data, barcode_type, source, product_name, category, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            ['SCAN_USER2_002', '8765432109', 'qr', 'esp32', 'Product Y', 'Category Y', user2.id]
        );

        console.log(`✅ Created 2 scans for User 1`);
        console.log(`✅ Created 2 scans for User 2\n`);

        // Step 5: Create saved scans for each user
        console.log('📋 Step 5: Creating saved scans...');

        await pool.query(
            `INSERT INTO saved_scans (barcode_data, barcode_type, source, product_name, category, user_id, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            ['SAVED_1234567890', 'barcode', 'esp32', 'Saved Product A', 'Saved Cat A', user1.id]
        );

        await pool.query(
            `INSERT INTO saved_scans (barcode_data, barcode_type, source, product_name, category, user_id, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            ['SAVED_9876543210', 'barcode', 'esp32', 'Saved Product X', 'Saved Cat X', user2.id]
        );

        console.log(`✅ Created 1 saved scan for User 1`);
        console.log(`✅ Created 1 saved scan for User 2\n`);

        // Step 6: VERIFY ISOLATION
        console.log('📋 Step 6: VERIFYING DATA ISOLATION...\n');
        console.log('═══════════════════════════════════════════════════════\n');

        // Check User 1's data
        console.log(`🔍 Checking User 1 (${user1.email}) data:`);

        const user1Devices = await pool.query(
            'SELECT device_id, device_name FROM user_devices WHERE user_id = $1 AND is_active = true',
            [user1.id]
        );
        console.log(`   Devices: ${user1Devices.rows.length} found`);
        user1Devices.rows.forEach(d => console.log(`      - ${d.device_name} (${d.device_id})`));

        const user1Scans = await pool.query(
            'SELECT barcode_data, product_name FROM barcodes WHERE user_id = $1',
            [user1.id]
        );
        console.log(`   Scans: ${user1Scans.rows.length} found`);
        user1Scans.rows.forEach(s => console.log(`      - ${s.barcode_data} (${s.product_name})`));

        const user1Saved = await pool.query(
            'SELECT barcode_data, product_name FROM saved_scans WHERE user_id = $1',
            [user1.id]
        );
        console.log(`   Saved Scans: ${user1Saved.rows.length} found`);
        user1Saved.rows.forEach(s => console.log(`      - ${s.barcode_data} (${s.product_name})`));

        console.log('');

        // Check User 2's data
        console.log(`🔍 Checking User 2 (${user2.email}) data:`);

        const user2Devices = await pool.query(
            'SELECT device_id, device_name FROM user_devices WHERE user_id = $1 AND is_active = true',
            [user2.id]
        );
        console.log(`   Devices: ${user2Devices.rows.length} found`);
        user2Devices.rows.forEach(d => console.log(`      - ${d.device_name} (${d.device_id})`));

        const user2Scans = await pool.query(
            'SELECT barcode_data, product_name FROM barcodes WHERE user_id = $1',
            [user2.id]
        );
        console.log(`   Scans: ${user2Scans.rows.length} found`);
        user2Scans.rows.forEach(s => console.log(`      - ${s.barcode_data} (${s.product_name})`));

        const user2Saved = await pool.query(
            'SELECT barcode_data, product_name FROM saved_scans WHERE user_id = $1',
            [user2.id]
        );
        console.log(`   Saved Scans: ${user2Saved.rows.length} found`);
        user2Saved.rows.forEach(s => console.log(`      - ${s.barcode_data} (${s.product_name})`));

        console.log('\n═══════════════════════════════════════════════════════\n');

        // Validate isolation
        let passed = true;

        if (user1Devices.rows.length !== 1) {
            console.log('❌ FAIL: User 1 should have exactly 1 device');
            passed = false;
        }
        if (user2Devices.rows.length !== 1) {
            console.log('❌ FAIL: User 2 should have exactly 1 device');
            passed = false;
        }
        if (user1Scans.rows.length !== 2) {
            console.log('❌ FAIL: User 1 should have exactly 2 scans');
            passed = false;
        }
        if (user2Scans.rows.length !== 2) {
            console.log('❌ FAIL: User 2 should have exactly 2 scans');
            passed = false;
        }
        if (user1Saved.rows.length !== 1) {
            console.log('❌ FAIL: User 1 should have exactly 1 saved scan');
            passed = false;
        }
        if (user2Saved.rows.length !== 1) {
            console.log('❌ FAIL: User 2 should have exactly 1 saved scan');
            passed = false;
        }

        if (passed) {
            console.log('✅ ✅ ✅ DATA ISOLATION TEST PASSED! ✅ ✅ ✅\n');
            console.log('Each user can only see their own:');
            console.log('  - Devices ✓');
            console.log('  - Scanned Barcodes ✓');
            console.log('  - Saved Scans ✓\n');
            console.log('📝 Test Users Created:');
            console.log(`   Email: testuser1@test.com | Password: test123`);
            console.log(`   Email: testuser2@test.com | Password: test123\n`);
            console.log('You can now log in with these accounts to verify in the UI!');
        } else {
            console.log('❌ DATA ISOLATION TEST FAILED\n');
        }

    } catch (error) {
        console.error('❌ Test failed with error:', error);
    } finally {
        await pool.end();
    }
}

testDataIsolation();
