const fs = require('fs');

const transcript = fs.readFileSync('transcript_copy.txt', 'utf8');
const lines = transcript.split('\n');

let patchStarted = false;
let recoveredLines = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.includes('@@ -1,24 +1,16 @@')) {
    patchStarted = true;
    console.log('Found patch start at line', i);
  }
  
  if (patchStarted) {
    if (line.includes('<truncated')) {
      console.log('Found truncation at line', i);
      break;
    }
    
    // The transcript might have \n embedded in a JSON string, so we need to be careful.
    // Actually, transcript.jsonl is one JSON object per line!
  }
}
