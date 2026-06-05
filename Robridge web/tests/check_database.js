// Script to check database connection and scan data
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkDatabase() {
  try {
    console.log('🔍 Checking database connection...');
    console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'NOT SET');
    
    // Test connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully');
    console.log('Server time:', testResult.rows[0].now);
    
    // Check if barcodes table exists
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'barcodes'
    `);
    
    if (tableCheck.rows.length === 0) {
      console.log('❌ ERROR: barcodes table does NOT exist!');
      return;
    }
    
    console.log('✅ barcodes table exists');
    
    // Check table structure
    const columnsCheck = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'barcodes'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 Table structure:');
    columnsCheck.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Count total scans
    const countResult = await pool.query('SELECT COUNT(*) as total FROM barcodes');
    console.log(`\n📊 Total scans in database: ${countResult.rows[0].total}`);
    
    // Count scans by user
    const userCountResult = await pool.query(`
      SELECT user_id, COUNT(*) as count 
      FROM barcodes 
      GROUP BY user_id
      ORDER BY user_id
    `);
    
    console.log('\n👥 Scans by user:');
    userCountResult.rows.forEach(row => {
      console.log(`  User ${row.user_id || 'NULL'}: ${row.count} scans`);
    });
    
    // Count scans by source
    const sourceCountResult = await pool.query(`
      SELECT source, COUNT(*) as count 
      FROM barcodes 
      GROUP BY source
      ORDER BY source
    `);
    
    console.log('\n📡 Scans by source:');
    sourceCountResult.rows.forEach(row => {
      console.log(`  ${row.source}: ${row.count} scans`);
    });
    
    // Show most recent scans
    const recentScans = await pool.query(`
      SELECT id, barcode_data, source, user_id, created_at 
      FROM barcodes 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log('\n🕐 Most recent 5 scans:');
    recentScans.rows.forEach((scan, index) => {
      console.log(`  ${index + 1}. ID: ${scan.id}, Data: ${scan.barcode_data}, Source: ${scan.source}, User: ${scan.user_id}, Time: ${scan.created_at}`);
    });
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

checkDatabase();
