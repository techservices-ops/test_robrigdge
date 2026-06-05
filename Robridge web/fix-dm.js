const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'pages', 'DeviceManager.js');
const content = fs.readFileSync(filePath, 'utf8');

const lines = content.split('\n');

const missingCode = `            batteryLevel: liveDevice?.batteryLevel,
            signalStrength: liveDevice?.signalStrength,
            isLive: !!liveDevice
        };
    });

    const generatePairingCode = async () => {
        setIsGenerating(true);
        setError('');
        try {
            const res = await imsFetch('/api/devices/pairing-code');
            const data = await res.json();

            if (data.success) {
                setPairingCode(data.pairingCode);
                const qrUrl = await QRCode.toDataURL(data.pairingCode, {
                    width: 300,
                    margin: 2,
                    color: {
                        dark: '#E3821E',
                        light: '#FFFFFF'
                    }
                });
                setQrCodeUrl(qrUrl);
                setShowPairingModal(true);
            } else {
                setError(data.error || 'Failed to generate pairing code');
            }
        } catch (err) {
            console.error('Error generating pairing code:', err);
            setError(\`Failed: \${err.message || 'Network Error'}\`);
        } finally {
            setIsGenerating(false);
        }
    };

    const unpairDevice = async (deviceId) => {
        showConfirm('Unpair Device', 'Are you sure you want to unpair this device?', async () => {
            try {
                const res = await imsFetch(\`/api/devices/\${deviceId}\`, {
                    method: 'DELETE'
                });
                const data = await res.json();

                if (data.success) {
                    loadPairedDevices();
                    showToast('Device unpaired successfully', 'success');
                } else {
                    showToast('Failed to unpair device: ' + data.error, 'error');
                }
            } catch (err) {
                console.error('Error unpairing device:', err);
                setError('Failed to unpair device');
                showToast('Failed to unpair device', 'error');
            }
        });
    };

    const closePairingModal = () => {
        setShowPairingModal(false);
        setPairingCode('');`;

// Remove line 172 which is just "        setQrCodeUrl('');" and insert our block there.
lines.splice(172, 2, missingCode, "        setQrCodeUrl('');");
fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
console.log('Fixed DeviceManager.js');
