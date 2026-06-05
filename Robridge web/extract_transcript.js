const fs = require('fs');
const readline = require('readline');

async function processTranscript() {
  const fileStream = fs.createReadStream('C:\\Users\\SASIKUMAR\\.gemini\\antigravity\\brain\\9d9d0897-6d22-447b-a989-33e7e72d0599\\.system_generated\\logs\\transcript.jsonl');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let serverJsContent = '';
  let foundWrite = false;

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      
      // Look for tool calls
      if (entry.tool_calls) {
        for (const call of entry.tool_calls) {
          if (call.name === 'write_to_file' || call.name === 'replace_file_content' || call.name === 'multi_replace_file_content') {
            const args = call.args;
            if (args.TargetFile && args.TargetFile.includes('server.js')) {
              console.log('Found modification to server.js in step', entry.step_index, 'Tool:', call.name);
            }
          }
        }
      }
      
      // Look for tool responses (might have the full file if we read it)
      if (entry.type === 'TOOL_RESPONSE' && entry.content && entry.content.includes('server.js')) {
        if (entry.content.length > 50000) {
            console.log('Found large server.js response in step', entry.step_index, 'Size:', entry.content.length);
            fs.writeFileSync('server.js.extracted', entry.content);
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  }
}

processTranscript();
