// Test the API endpoint directly
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

async function testAPI() {
    try {
        console.log('🧪 Testing /api/barcodes/scanned endpoint...\n');

        // Generate a valid JWT token for user 11
        const token = jwt.sign(
            { id: 11, username: 'testuser1' },
            'your-secret-key-change-this-in-production'
        );

        console.log('📝 Generated token for user 11');
        console.log('Token:', token.substring(0, 50) + '...\n');

        // Make request to local server
        const response = await fetch('http://localhost:3001/api/barcodes/scanned?limit=100', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('📡 Response status:', response.status);
        console.log('📡 Response status text:', response.statusText);

        const data = await response.json();

        console.log('\n📊 API Response:');
        console.log('Success:', data.success);
        console.log('Barcodes count:', data.barcodes ? data.barcodes.length : 0);

        if (data.barcodes && data.barcodes.length > 0) {
            console.log('\n✅ First 5 scans:');
            data.barcodes.slice(0, 5).forEach((scan, idx) => {
                console.log(`  ${idx + 1}. ID: ${scan.id}, Data: ${scan.barcode_data}, Source: ${scan.source}`);
            });
        } else {
            console.log('\n❌ No scans returned!');
            console.log('Full response:', JSON.stringify(data, null, 2));
        }

    } catch (error) {
        console.error('❌ Error testing API:', error.message);
        console.error('Full error:', error);
    }
}

testAPI();
