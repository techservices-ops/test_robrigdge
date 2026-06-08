const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// 1. Serve the compiled static assets from the 'build' directory under the '/bvs' path
app.use('/bvs', express.static(path.join(__dirname, 'build')));

// 2. Fallback for React Router - serve index.html for any sub-routes under /bvs
app.get('/bvs*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// 3. Redirect root requests (/) to (/bvs/) automatically
app.get('/', (req, res) => {
  res.redirect('/bvs/');
});

app.listen(port, () => {
  console.log('\n==================================================');
  console.log(`Production build server running at:`);
  console.log(`http://localhost:${port}/bvs/`);
  console.log('==================================================\n');
});
