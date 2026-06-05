const jwt = require('jsonwebtoken');

async function test() {
  const token = jwt.sign({ id: 1 }, 'robridge_secret_key_123');
  try {
    const res = await fetch('http://localhost:3001/api/devices/pairing-code', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-workspace-id': '1'
      }
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', data);
  } catch (e) {
    console.error('Fetch error:', e);
  }
}
test();
