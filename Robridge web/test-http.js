const http = require('http');

const payload = JSON.stringify({ email: 'admin@robridge.com', password: 'admin123' });

const reqOpts = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': payload.length
  }
};

const req = http.request(reqOpts, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const response = JSON.parse(data);
    if (!response.token) {
      console.log('Login failed', response);
      return;
    }
    
    const wsId = response.workspaces?.[0]?.id || '1';
    console.log('Using token and workspace ID:', wsId);
    
    http.get(`http://localhost:3001/api/ims/dashboard`, {
      headers: {
        'Authorization': 'Bearer ' + response.token,
        'x-workspace-id': wsId
      }
    }, (res2) => {
      let data2 = '';
      res2.on('data', d => data2 += d);
      res2.on('end', () => {
        console.log('GET /api/ims/dashboard response status:', res2.statusCode);
        console.log('Body:', data2);
      });
    });
  });
});

req.write(payload);
req.end();
