const { Client } = require('pg');

const testConnection = async (password) => {
  const connectionString = `postgresql://postgres:${password}@localhost:5432/robridge_local`;
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log(`✅ Success! Connected with password: '${password}'`);
    await client.end();
    return true;
  } catch (err) {
    console.log(`❌ Failed with password '${password}': ${err.message}`);
    return false;
  }
};

const runTests = async () => {
  console.log('Testing local PostgreSQL connection...');
  
  const passwords = ['password', 'password123', 'postgres', 'admin', 'root', '123456'];
  
  for (const pass of passwords) {
    if (await testConnection(pass)) {
      console.log('\n✨ Valid credentials found!');
      console.log(`Connection String: postgresql://postgres:${pass}@localhost:5432/robridge_local`);
      process.exit(0);
    }
  }
  
  console.log('\n❌ Could not connect with common default passwords.');
  console.log('Please ensure PostgreSQL is running and robridge_local database exists.');
  process.exit(1);
};

runTests();
