// Database migration to create temporary and permanent scan tables
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupScanTables() {
    try {
        console.log('🔧 Setting up scan storage tables...');

        // Create temporary_scans table (rolling buffer of 75 scans per user)
        await pool.query(`
      CREATE TABLE IF NOT EXISTS temporary_scans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        barcode_data TEXT NOT NULL,
        barcode_type VARCHAR(50),
        source VARCHAR(50) DEFAULT 'ESP32',
        product_name TEXT,
        category VARCHAR(100),
        price DECIMAL(10, 2) DEFAULT 0,
        description TEXT,
        metadata JSONB,
        device_id VARCHAR(100),
        device_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
        console.log('✅ temporary_scans table created/verified');

        // Create index for faster queries
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_temp_scans_user_created 
      ON temporary_scans(user_id, created_at DESC)
    `);
        console.log('✅ Index created on temporary_scans');

        // Verify saved_scans table exists (should already exist)
        await pool.query(`
      CREATE TABLE IF NOT EXISTS saved_scans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        barcode_data TEXT NOT NULL,
        barcode_type VARCHAR(50),
        source VARCHAR(50) DEFAULT 'ESP32',
        product_name TEXT,
        category VARCHAR(100),
        price DECIMAL(10, 2) DEFAULT 0,
        description TEXT,
        metadata JSONB,
        saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
        console.log('✅ saved_scans table created/verified');

        // Create index for saved_scans
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_scans_user_saved 
      ON saved_scans(user_id, saved_at DESC)
    `);
        console.log('✅ Index created on saved_scans');

        console.log('\n✅ Database setup complete!');

    } catch (error) {
        console.error('❌ Error setting up tables:', error);
    } finally {
        await pool.end();
    }
}

setupScanTables();
