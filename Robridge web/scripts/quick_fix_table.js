// Quick fix - check and add missing columns to temporary_scans
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function quickFix() {
    try {
        console.log('🔧 Checking temporary_scans table...');

        // Check if table exists and get columns
        const columnsResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'temporary_scans'
      ORDER BY ordinal_position
    `);

        console.log('Current columns:', columnsResult.rows);

        // Add missing columns if needed
        const alterQueries = [
            `ALTER TABLE temporary_scans ADD COLUMN IF NOT EXISTS device_name VARCHAR(100)`,
            `ALTER TABLE temporary_scans ADD COLUMN IF NOT EXISTS device_id VARCHAR(100)`
        ];

        for (const query of alterQueries) {
            await pool.query(query);
            console.log('✅ Executed:', query);
        }

        console.log('\n✅ Table structure fixed!');

        // Show final structure
        const finalColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'temporary_scans'
      ORDER BY ordinal_position
    `);

        console.log('\nFinal columns:', finalColumns.rows);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

quickFix();
