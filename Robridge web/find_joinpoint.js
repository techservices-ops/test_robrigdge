const fs = require('fs');

// Read the corrupted file
const corrupted = fs.readFileSync('server.js.corrupted', 'utf8').split('\n');

// We need everything from line 1511 onwards in the corrupted file
// (line 1511 = 0-indexed 1510 = "// System status endpoint for Dashboard")
// But we want from line 1906 onwards (ESP32 Device Registration) because the paste already has
// system status, device pairing, change-password, forgot-password, reset-password

// Find the exact line in corrupted where ESP32 Device Registration is
let esp32StartIdx = -1;
for (let i = 0; i < corrupted.length; i++) {
  if (corrupted[i].trim() === '// ESP32 Device Registration' && corrupted[i+1] && corrupted[i+1].includes("app.post('/api/esp32/register'")) {
    esp32StartIdx = i;
    break;
  }
}

console.log('ESP32 Registration starts at line (1-indexed):', esp32StartIdx + 1);
console.log('Lines in corrupted file:', corrupted.length);
