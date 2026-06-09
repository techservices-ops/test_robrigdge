const fetch = require('node-fetch');

async function testScan() {
  const token = process.env.TEST_TOKEN || 'dummy'; // need to get a valid token if auth is required
  // Wait, if I just do it directly to DB I can see if it updates
}
