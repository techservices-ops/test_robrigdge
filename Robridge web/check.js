const fs = require('fs');
const code = fs.readFileSync('server_clean.js', 'utf8');
const lines = code.split('\n');
let inString = false;
let startLine = 0;
for(let i=0; i<3553; i++) {
  const l = lines[i];
  for(let j=0; j<l.length; j++) {
    if (l[j] === String.fromCharCode(96) && (j===0 || l[j-1] !== '\\')) {
      inString = !inString;
      if(inString) startLine = i + 1;
    }
  }
}
if (inString) console.log('Unclosed backtick started at line ' + startLine);
