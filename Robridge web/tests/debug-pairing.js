const fetch = require('node-fetch');

const runTest = async () => {
    try {
        console.log('1️⃣  Logging in as Admin...');
        const loginRes = await fetch('http://localhost:3001/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@robridge.com', password: 'admin123' })
        });
        const loginData = await loginRes.json();
        if (!loginData.success) throw new Error('Login failed');
        const token = loginData.token;
        console.log('✅ Logged in. Token obtained.');

        console.log('2️⃣  Generating Pairing Code...');
        const pairRes = await fetch('http://localhost:3001/api/devices/pairing-code', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const pairData = await pairRes.json();
        const pairingCode = pairData.pairingCode;
        console.log(`✅ Pairing Code Generated: ${pairingCode}`);

        console.log('3️⃣  Simulating ESP32 Scan of Pairing Code...');
        // Simulate ESP32 sending this code
        const scanRes = await fetch('http://localhost:3001/api/esp32/scan/TEST_DEVICE_001', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: 'TEST_DEVICE_001',
                barcodeData: pairingCode,
                scanType: 'QR_CODE',
                timestamp: Date.now()
            })
        });
        const scanData = await scanRes.json();
        console.log('📡 Scan Response:', scanData);

        if (scanData.success && scanData.action === 'pair') {
            console.log('🎉 SUCCESS! Device paired successfully.');
        } else {
            console.log('❌ FAILURE! Device did not pair.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    }
};

runTest();
