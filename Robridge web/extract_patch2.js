const fs = require('fs');

const transcript = fs.readFileSync('transcript_copy.txt', 'utf8');
const lines = transcript.split('\n');

for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i].trim()) continue;
  try {
    const entry = JSON.parse(lines[i]);
    if (entry.type === 'USER_INPUT' && entry.content && entry.content.includes('@@ -1,24')) {
      console.log('Found the patch message!');
      fs.writeFileSync('patch_raw.txt', entry.content);
      console.log('Saved to patch_raw.txt');
      break;
    }
  } catch(e) {}
}
