const fs = require('fs');
const path = require('path');

const historyDir = path.join(process.env.APPDATA, 'Code', 'User', 'History');
let foundFiles = [];

function searchDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            searchDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.js') || !entry.name.includes('.'))) {
            try {
                const stats = fs.statSync(fullPath);
                if (stats.size > 200000 && stats.size < 300000) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    if (content.includes('ims_workorders') && content.includes('const express = require')) {
                        foundFiles.push({ path: fullPath, time: stats.mtimeMs, size: stats.size });
                    }
                }
            } catch (e) {}
        }
    }
}

console.log('Searching VS Code history...');
searchDir(historyDir);

foundFiles.sort((a, b) => b.time - a.time);

if (foundFiles.length > 0) {
    console.log('Found ' + foundFiles.length + ' matching backups!');
    for (let i=0; i<Math.min(5, foundFiles.length); i++) {
        console.log(`- ${foundFiles[i].path} (${foundFiles[i].size} bytes) - ${new Date(foundFiles[i].time).toLocaleString()}`);
    }
    fs.copyFileSync(foundFiles[0].path, 'server.js.recovered');
    console.log('Successfully recovered the newest backup to server.js.recovered!');
} else {
    console.log('No backups found matching criteria.');
}
