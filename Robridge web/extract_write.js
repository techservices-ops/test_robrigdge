const fs = require('fs');
const readline = require('readline');

async function extractWrite() {
  const fileStream = fs.createReadStream('C:\\Users\\SASIKUMAR\\.gemini\\antigravity\\brain\\9d9d0897-6d22-447b-a989-33e7e72d0599\\.system_generated\\logs\\transcript.jsonl');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.step_index === 6008) {
        if (entry.tool_calls) {
          for (const call of entry.tool_calls) {
            if (call.name === 'write_to_file' && call.args.TargetFile.includes('server.js')) {
              console.log('Extracting server.js from step 6008');
              fs.writeFileSync('server.js.extracted', call.args.CodeContent);
              console.log('Saved to server.js.extracted, size:', call.args.CodeContent.length);
            }
          }
        }
      }
    } catch (e) {}
  }
}

extractWrite();
