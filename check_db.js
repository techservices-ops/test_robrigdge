const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'Barcode generator&Scanner', 'barcodes.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath);

// Check tables
db.all('SELECT name FROM sqlite_master WHERE type="table"', (err, tables) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Tables:', tables.map(t => t.name));
    
    // Check if saved_scans exists
    const hasSavedScans = tables.some(t => t.name === 'saved_scans');
    console.log('Has saved_scans table:', hasSavedScans);
    
    if (hasSavedScans) {
      // Get count
      db.get('SELECT COUNT(*) as count FROM saved_scans', (err, result) => {
        if (err) {
          console.error('Error getting count:', err);
        } else {
          console.log('Total saved scans:', result.count);
          
          // Get duplicates
          db.all('SELECT barcode_data, COUNT(*) as count FROM saved_scans GROUP BY barcode_data HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT 5', (err, duplicates) => {
            if (err) {
              console.error('Error getting duplicates:', err);
            } else {
              console.log('Top duplicates:');
              duplicates.forEach(dup => {
                console.log(`  ${dup.barcode_data}: ${dup.count} times`);
              });
            }
            db.close();
          });
        }
      });
    } else {
      db.close();
    }
  }
});
