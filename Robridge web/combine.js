const fs = require('fs');

// Read top section
const top = fs.readFileSync('server_top.js', 'utf8');

// Read corrupted file and take from line 1906 onwards (0-indexed: 1905)
const corrupted = fs.readFileSync('server.js.corrupted', 'utf8').split('\n');
const bottom = corrupted.slice(1905).join('\n');

// Combine
const combined = top + '\n' + bottom;
fs.writeFileSync('server.js', combined, 'utf8');

const lineCount = combined.split('\n').length;
console.log('Done! Combined file has', lineCount, 'lines');
console.log('Top section:', top.split('\n').length, 'lines');
console.log('Bottom section:', corrupted.slice(1905).length, 'lines');
