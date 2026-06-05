const { Client } = require('pg');

const setupDatabase = async () => {
    const config = {
        user: 'postgres',
        password: 'password123', // Default we asked user to set
        host: 'localhost',
        port: 5432,
        database: 'postgres' // Connect to default DB first
    };

    const client = new Client(config);

    try {
        console.log('🔌 Connecting to PostgreSQL server...');
        await client.connect();
        console.log('✅ Connected to PostgreSQL server');

        // Check if database exists
        const checkDb = await client.query("SELECT 1 FROM pg_database WHERE datname = 'robridge_local'");

        if (checkDb.rows.length === 0) {
            console.log('🛠️  Creating database "robridge_local"...');
            await client.query('CREATE DATABASE robridge_local');
            console.log('✅ Database created successfully');
        } else {
            console.log('ℹ️  Database "robridge_local" already exists');
        }

        await client.end();

        // Test connection to new DB
        console.log('🔌 Testing connection to robridge_local...');
        const newClient = new Client({ ...config, database: 'robridge_local' });
        await newClient.connect();
        console.log('✅ Successfully connected to robridge_local!');
        await newClient.end();

        console.log('\n🎉 Setup Complete! You can now update your .env file.');

    } catch (err) {
        console.error('\n❌ Error:', err.message);
        if (err.message.includes('password authentication failed')) {
            console.error('💡 Hint: The password "password123" was incorrect. Did you set a different password?');
        }
        process.exit(1);
    }
};

setupDatabase();
