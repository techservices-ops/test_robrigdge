import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { FaQrcode, FaMobileAlt, FaTrash, FaClock } from 'react-icons/fa';
import { useWebSocket } from '../contexts/WebSocketContext';
import { getServerURL } from '../config/api';
import './DevicesPage.css';

const DevicesPage = () => {
    const [devices, setDevices] = useState([]);
    const [pairingCode, setPairingCode] = useState('');
    const [qrCodeUrl, setQrCodeUrl] = useState('');
    const [showPairingModal, setShowPairingModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true); // For page load
    const [isGenerating, setIsGenerating] = useState(false); // For button
    const [error, setError] = useState('');
    const { socket } = useWebSocket();

    // const getServerURL = () => {
    //     return 'https://robridge-express-zl9j.onrender.com';
    // };

    useEffect(() => {
        loadDevices();

        // WebSocket listeners for real-time updates
        if (socket) {
            // Listen for device paired event - auto-close modal and refresh
            socket.on('device_paired', (data) => {
                console.log('Device paired event received:', data);
                setShowPairingModal(false);
                setPairingCode('');
                setQrCodeUrl('');
                loadDevices(); // Refresh device list
            });

            // Listen for device unpaired event - refresh list
            socket.on('device_unpaired', (data) => {
                console.log('Device unpaired event received:', data);
                loadDevices(); // Refresh device list
            });

            // Listen for device status updates
            socket.on('device_status', (data) => {
                console.log('Device status update received:', data);
                loadDevices(); // Refresh device list
            });
        }

        // Cleanup listeners on unmount
        return () => {
            if (socket) {
                socket.off('device_paired');
                socket.off('device_unpaired');
                socket.off('device_status');
            }
        };
    }, [socket]);

    const loadDevices = async () => {
        try {
            const token = localStorage.getItem('robridge_token');
            const res = await fetch(`${getServerURL()}/api/devices`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setDevices(data.devices);
            }
        } catch (err) {
            console.error('Error loading devices:', err);
            setError('Failed to load devices');
        } finally {
            setIsLoading(false);
        }
    };

    const generatePairingCode = async () => {
        setIsGenerating(true);
        setError('');
        try {
            const token = localStorage.getItem('robridge_token');
            const res = await fetch(`${getServerURL()}/api/devices/pairing-code`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.success) {
                setPairingCode(data.pairingCode);

                // Generate QR code
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
            setError('Failed to generate pairing code');
        } finally {
            setIsGenerating(false);
        }
    };

    const unpairDevice = async (deviceId) => {
        if (!window.confirm('Are you sure you want to unpair this device?')) {
            return;
        }

        try {
            const token = localStorage.getItem('robridge_token');
            const res = await fetch(`${getServerURL()}/api/devices/${deviceId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.success) {
                loadDevices();
            }
        } catch (err) {
            console.error('Error unpairing device:', err);
            setError('Failed to unpair device');
        }
    };

    const closePairingModal = () => {
        setShowPairingModal(false);
        setPairingCode('');
        setQrCodeUrl('');
        loadDevices(); // Refresh devices list
    };

    return (
        <div className="devices-page">
            <div className="devices-header">
                <h1>My Devices</h1>
                <p className="devices-subtitle">Manage your paired Barcode Scanners</p>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="devices-actions">
                <button
                    className="pair-device-btn"
                    onClick={generatePairingCode}
                    disabled={isGenerating}
                >
                    <FaQrcode />
                    {isGenerating ? 'Generating...' : 'Pair New Device'}
                </button>
            </div>

            <div className="devices-list">
                <h2>Paired Devices ({devices.length})</h2>
                {isLoading ? (
                    <div className="loading-spinner-container" style={{ padding: '60px', textAlign: 'center' }}>
                        <div className="spinner-small" style={{
                            display: 'inline-block',
                            width: '40px',
                            height: '40px',
                            border: '4px solid #E3821E',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite',
                            marginBottom: '20px'
                        }}></div>
                        <h3 style={{ color: '#5F6368', fontSize: '18px', margin: 0 }}>Loading your devices...</h3>
                    </div>
                ) : devices.length === 0 ? (
                    <div className="no-devices">
                        <FaMobileAlt className="no-devices-icon" />
                        <p>No devices paired yet</p>
                        <p className="no-devices-hint">Click "Pair New Device" to get started</p>
                    </div>
                ) : (
                    <div className="devices-grid">
                        {devices.map(device => (
                            <div key={device.id} className="device-card">
                                <div className="device-header">
                                    <FaMobileAlt className="device-icon" />
                                    <h3>{device.device_name}</h3>
                                </div>
                                <div className="device-details">
                                    <div className="device-detail">
                                        <span className="detail-label">Device ID:</span>
                                        <span className="detail-value">{device.device_id}</span>
                                    </div>
                                    <div className="device-detail">
                                        <span className="detail-label">Paired At:</span>
                                        <span className="detail-value">
                                            <FaClock /> {device.paired_at ? new Date(device.paired_at).toLocaleString() : 'Never'}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    className="unpair-btn"
                                    onClick={() => unpairDevice(device.id)}
                                >
                                    <FaTrash /> Unpair Device
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {showPairingModal && (
                <div className="modal-overlay" onClick={closePairingModal}>
                    <div className="pairing-modal" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close" onClick={closePairingModal}>×</button>
                        <h2>Scan to Pair Device</h2>
                        <p className="modal-instructions">
                            Scan this QR code with your Barcode Scanner to pair it with your account
                        </p>
                        {qrCodeUrl && (
                            <div className="qr-code-container">
                                <img src={qrCodeUrl} alt="Pairing QR Code" className="qr-code" />
                            </div>
                        )}
                        <button className="modal-done-btn" onClick={closePairingModal}>
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DevicesPage;
