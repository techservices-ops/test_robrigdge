require('dotenv').config();
const { Client } = require('pg');

const testConnection = async () => {
    console.log('🧪 Testing Database Connection...');
    console.log('URL:', process.env.DATABASE_URL ? 'Defined (Hidden)' : 'Not Defined');

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL is missing in .env');
        return;
    }

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false // Required for Render
        },
        connectionTimeoutMillis: 10000 // 10s timeout
    });

    try {
        console.log('🔌 Connecting...');
        await client.connect();
        console.log('✅ Connection Successful!');

        const res = await client.query('SELECT NOW()');
        console.log('🕒 Server Time:', res.rows[0].now);

        await client.end();
        console.log('👋 Disconnected');
    } catch (err) {
        console.error('❌ Connection Failed:', err.message);
        console.error('Code:', err.code);
        if (err.message.includes('ECONNRESET')) {
            console.log('💡 Tip: Render free tier DBs sleep. Try running this script again in 30 seconds.');
        }
    }
};

testConnection();
