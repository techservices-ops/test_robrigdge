const fs = require('fs');

if (!fs.existsSync('eslint_report.json')) {
  console.log('No eslint_report.json found.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync('eslint_report.json', 'utf8'));

report.forEach(fileResult => {
  if (fileResult.warningCount === 0 && fileResult.errorCount === 0) return;

  let content = fs.readFileSync(fileResult.filePath, 'utf8');
  let lines = content.split('\n');

  // Sort descending by line
  const messages = fileResult.messages.sort((a, b) => b.line - a.line);

  messages.forEach(msg => {
    if (msg.ruleId === 'no-unused-vars') {
      const lineIdx = msg.line - 1;
      let lineStr = lines[lineIdx];

      // Match 'varName' is assigned a value but never used
      // OR 'varName' is defined but never used
      const match = msg.message.match(/'([^']+)' is/);
      if (match) {
        const varName = match[1];

        // For imports inside { }
        lineStr = lineStr.replace(new RegExp(`\\b${varName}\\b\\s*,\\s*`), '');
        lineStr = lineStr.replace(new RegExp(`\\s*,\\s*\\b${varName}\\b`), '');
        
        // If it's a standalone import or the last one in braces
        lineStr = lineStr.replace(new RegExp(`\\b${varName}\\b`), '');

        // Cleanup empty import braces
        if (lineStr.match(/import\s*{\s*}\s*from/)) {
          lineStr = '';
        }
        
        // Remove 'const =' or 'let =' if the variable was the only thing
        if (lineStr.match(/^\s*(const|let)\s*=\s*(.*?);?$/)) {
          lineStr = '';
        }

        // Remove empty lines if we stripped the whole thing
        if (lineStr.trim() === 'import  from \'react-icons/fa\';') {
            lineStr = '';
        }

        lines[lineIdx] = lineStr;
      }
    }
  });

  fs.writeFileSync(fileResult.filePath, lines.filter(l => l !== null).join('\n'));
});
console.log('Finished removing unused vars!');
