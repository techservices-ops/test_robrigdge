require('dotenv').config();
const { Client } = require('pg');

const testUsers = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();
        console.log('✅ Connected to database');

        // Check if users table exists
        const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      );
    `);
        console.log('Users table exists:', tableCheck.rows[0].exists);

        if (tableCheck.rows[0].exists) {
            // Get all users
            const users = await client.query('SELECT id, email, name, role, created_at FROM users');
            console.log('\n📋 Users in database:');
            console.table(users.rows);
        }

        await client.end();
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
};

testUsers();
