// Database migration to create IMS Dynamic Settings tables
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupImsTables() {
    try {
        console.log('🔧 Setting up IMS Settings & Configurations tables...');

        // Create ims_settings table (User/Tenant Configuration Toggles storing JSON)
        await pool.query(`
      CREATE TABLE IF NOT EXISTS ims_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        preferences JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
        console.log('✅ ims_settings table created/verified');

        // Create ims_roles table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS ims_roles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(20) DEFAULT '#3498db',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
        console.log('✅ ims_roles table created/verified');

        // Create ims_workflows table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS ims_workflows (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(20) DEFAULT '#3498db',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
        console.log('✅ ims_workflows table created/verified');

        // Create ims_categories table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS ims_categories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        mode VARCHAR(20) DEFAULT 'FIFO',
        alert_at INTEGER DEFAULT 10,
        reorder_at INTEGER DEFAULT 20,
        color VARCHAR(20) DEFAULT '#3498db',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
        console.log('✅ ims_categories table created/verified');

        console.log('\n✅ IMS Database setup complete!');

    } catch (error) {
        console.error('❌ Error setting up tables:', error);
    } finally {
        await pool.end();
    }
}

setupImsTables();
