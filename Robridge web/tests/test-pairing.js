// Quick test for device pairing endpoint
const testPairingEndpoint = async () => {
    try {
        // First login to get a valid token
        const loginRes = await fetch('http://localhost:3001/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'admin@robridge.com',
                password: 'admin123'
            })
        });

        const loginData = await loginRes.json();
        console.log('Login response:', loginData);

        if (!loginData.success) {
            console.error('Login failed');
            return;
        }

        const token = loginData.token;
        console.log('Token:', token);

        // Now test the pairing code endpoint
        const pairingRes = await fetch('http://localhost:3001/api/devices/pairing-code', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const pairingData = await pairingRes.json();
        console.log('Pairing code response:', pairingData);

        if (pairingData.success) {
            console.log('✅ SUCCESS! Pairing code:', pairingData.pairingCode);
        } else {
            console.error('❌ FAILED:', pairingData);
        }

    } catch (error) {
        console.error('Error:', error);
    }
};

testPairingEndpoint();
