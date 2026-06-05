const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const target = "const initUserDataIsolation = async () => {\n  try {";
const replacement = "const initUserDataIsolation = async () => {\n  try {\n    await pool.query('ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS workspace_id INTEGER;');";

if (code.includes(target) && !code.includes("ADD COLUMN IF NOT EXISTS workspace_id INTEGER")) {
  code = code.replace(target, replacement);
  fs.writeFileSync('server.js', code);
  console.log('Added ALTER TABLE');
} else {
  console.log('Target not found or already added');
}
