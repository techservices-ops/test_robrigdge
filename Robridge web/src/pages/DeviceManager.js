import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { getServerURL } from '../config/api';
import {
    FaBarcode,
    FaTimesCircle,
    
    FaSearch,
    FaFilter,
    FaDownload,
    
    FaInfoCircle,
    FaCheckCircle,
    FaExclamationTriangle,
    
    FaSignal,
    FaBatteryFull,
    FaBatteryThreeQuarters,
    FaBatteryHalf,
    FaBatteryQuarter,
    FaBatteryEmpty,
    FaClock,
    FaMapMarkerAlt,
    FaMicrochip,
    FaQrcode,
    FaMobileAlt,
    FaTrash,
    FaWifi
} from 'react-icons/fa';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useUI } from '../contexts/UIContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './DeviceManager.css';

const DeviceManager = () => {
    const { showToast, showConfirm } = useUI();
    const { imsFetch } = useWorkspace();
    // State for paired devices (from DB)
    const [pairedDevices, setPairedDevices] = useState([]);
    const [isLoadingPaired, setIsLoadingPaired] = useState(true);

    // State for pairing
    const [pairingCode, setPairingCode] = useState('');
    const [qrCodeUrl, setQrCodeUrl] = useState('');
    const [showPairingModal, setShowPairingModal] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // State for WiFi configuration - Initialize from localStorage
    const [showWifiModal, setShowWifiModal] = useState(false);
    const [wifiSSID, setWifiSSID] = useState(() => {
        return localStorage.getItem('robridge_wifi_ssid') || '';
    });
    const [wifiPassword, setWifiPassword] = useState(() => {
        return localStorage.getItem('robridge_wifi_password') || '';
    });
    const [wifiSecurityType, setWifiSecurityType] = useState(() => {
        return localStorage.getItem('robridge_wifi_security') || 'WPA';
    });
    const [wifiQrCodeUrl, setWifiQrCodeUrl] = useState('');
    const [showPasswordWifi, setShowPasswordWifi] = useState(false);

    // State for UI controls
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [sortBy, setSortBy] = useState('name');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [showDetails, setShowDetails] = useState(false);
    const [error, setError] = useState('');
    const [displayTime, setDisplayTime] = useState('');

    // WebSocket context for live data
    const { isConnected, esp32Devices, latestScan, isProcessingScan, socket } = useWebSocket();

    // Load paired devices from database
    useEffect(() => {
        loadPairedDevices();
    }, []);

    // Listen for WebSocket events
    useEffect(() => {
        if (!socket) return;

        const handleDevicePaired = () => {
            console.log('Device paired - refreshing list');
            setShowPairingModal(false);
            setPairingCode('');
            setQrCodeUrl('');
            loadPairedDevices();
        };

        const handleDeviceUnpaired = () => {
            console.log('Device unpaired - refreshing list');
            loadPairedDevices();
        };

        socket.on('device_paired', handleDevicePaired);
        socket.on('device_unpaired', handleDeviceUnpaired);

        return () => {
            socket.off('device_paired', handleDevicePaired);
            socket.off('device_unpaired', handleDeviceUnpaired);
        };
    }, [socket]);

    // Update display time for latest scan
    useEffect(() => {
        if (latestScan) {
            const ts = latestScan.timestamp;
            const date = ts ? new Date(ts) : new Date();
            const isValid = date.getFullYear() > 2020;
            setDisplayTime(isValid ? date.toLocaleString() : new Date().toLocaleString());
        }
    }, [latestScan]);

    // Auto-regenerate WiFi QR code when credentials change
    useEffect(() => {
        if (wifiSSID.trim()) {
            generateWifiQR();
        } else {
            setWifiQrCodeUrl('');
        }
    }, [wifiSSID, wifiPassword, wifiSecurityType]);

    // Save WiFi credentials to localStorage whenever they change
    useEffect(() => {
        if (wifiSSID) {
            localStorage.setItem('robridge_wifi_ssid', wifiSSID);
        } else {
            localStorage.removeItem('robridge_wifi_ssid');
        }
    }, [wifiSSID]);

    useEffect(() => {
        if (wifiPassword) {
            localStorage.setItem('robridge_wifi_password', wifiPassword);
        } else {
            localStorage.removeItem('robridge_wifi_password');
        }
    }, [wifiPassword]);

    useEffect(() => {
        localStorage.setItem('robridge_wifi_security', wifiSecurityType);
    }, [wifiSecurityType]);

    const loadPairedDevices = async () => {
        try {
            const res = await imsFetch('/api/devices');
            const data = await res.json();
            if (data.success) {
                setPairedDevices(data.devices);
            }
        } catch (err) {
            console.error('Error loading paired devices:', err);
            setError('Failed to load paired devices');
        } finally {
            setIsLoadingPaired(false);
        }
    };

    // Merge paired devices with live connection status
    const mergedDevices = pairedDevices.map(paired => {
        const liveDevice = esp32Devices.find(live => live.deviceId === paired.device_id);
        return {
            id: paired.id,
            deviceId: paired.device_id,
            deviceName: paired.device_name,
            pairedAt: paired.paired_at,
            status: liveDevice ? liveDevice.status : 'offline',
            ipAddress: liveDevice?.ipAddress || 'N/A',
            totalScans: liveDevice?.totalScans || 0,
            lastSeen: liveDevice?.lastSeen || paired.paired_at,
            batteryLevel: liveDevice?.batteryLevel,
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
            setError(`Failed: ${err.message || 'Network Error'}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const unpairDevice = async (deviceId) => {
        showConfirm('Unpair Device', 'Are you sure you want to unpair this device?', async () => {
            try {
                const res = await imsFetch(`/api/devices/${deviceId}`, {
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
        setPairingCode('');
        setQrCodeUrl('');
        loadPairedDevices(); // Refresh device list after closing modal
    };

    const generateWifiQR = async () => {
        if (!wifiSSID.trim()) {
            showToast('Please enter a WiFi SSID', 'warning');
            return;
        }

        try {
            // WiFi QR code format: WIFI:T:WPA;S:ssid;P:password;H:false;;
            // T = security type (WPA, WEP, or nopass for open network)
            // S = SSID (network name)
            // P = password
            // H = hidden network (true/false)
            const securityType = wifiPassword.trim() ? wifiSecurityType : 'nopass';
            const wifiString = `WIFI:T:${securityType};S:${wifiSSID.trim()};P:${wifiPassword.trim()};H:false;;`;

            const qrUrl = await QRCode.toDataURL(wifiString, {
                width: 300,
                margin: 2,
                color: {
                    dark: '#E3821E',
                    light: '#FFFFFF'
                },
                errorCorrectionLevel: 'M'
            });

            setWifiQrCodeUrl(qrUrl);
        } catch (err) {
            console.error('Error generating WiFi QR code:', err);
            showToast('Failed to generate WiFi QR code', 'error');
        }
    };

    const openWifiConfig = () => {
        setShowWifiModal(true);
        // Don't reset credentials - keep them persistent
    };

    const closeWifiModal = () => {
        setShowWifiModal(false);
        // Don't clear credentials - keep them for next time
    };

    const handleSaveScan = async () => {
        if (!latestScan) {
            showToast('No scan to save', 'warning');
            return;
        }

        const source = (latestScan.source || '').toUpperCase();
        if (source !== 'ESP32') {
            showToast(`Only ESP32 source scans can be saved. Current source: "${latestScan.source}"`, 'warning');
            return;
        }

        try {
            const serverURL = getServerURL();
            const response = await fetch(`${serverURL}/api/save-scan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('robridge_token')}`
                },
                body: JSON.stringify({
                    barcode_data: latestScan.barcodeData,
                    barcode_type: latestScan.scanType || 'unknown',
                    source: latestScan.source || 'ESP32',
                    product_name: latestScan.aiAnalysis?.title || 'Unknown Product',
                    category: latestScan.aiAnalysis?.category || 'Unknown',
                    price: 0,
                    description: latestScan.aiAnalysis?.description || '',
                    metadata: {
                        deviceId: latestScan.deviceId,
                        deviceName: latestScan.deviceName,
                        aiAnalysis: latestScan.aiAnalysis,
                        timestamp: latestScan.timestamp
                    }
                })
            });

            const result = await response.json();

            if (result.success) {
                showToast('Scan saved successfully! View in "Saved Scans" page.', 'success');
            } else {
                if (result.duplicate) {
                    showToast(result.error + '\n\nLast saved: ' + new Date(result.lastSaved).toLocaleString(), 'warning');
                } else {
                    showToast('Failed to save scan: ' + (result.error || 'Unknown error'), 'error');
                }
            }
        } catch (error) {
            console.error('Error saving scan:', error);
            showToast('Error saving scan. Please ensure the server is running.', 'error');
        }
    };

    const exportDeviceData = () => {
        const csvContent = [
            ['Device Name', 'Device ID', 'Status', 'IP Address', 'Paired At', 'Last Seen', 'Total Scans'],
            ...mergedDevices.map(device => [
                device.deviceName,
                device.deviceId,
                device.status,
                device.ipAddress,
                new Date(device.pairedAt).toLocaleString(),
                new Date(device.lastSeen).toLocaleString(),
                device.totalScans || 0
            ])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const date = new Date().toISOString().split('T')[0];
        const a = document.createElement('a');
        a.href = url;
        a.download = `device_manager_${date}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const handleDetails = (device) => {
        setSelectedDevice(device);
        setShowDetails(true);
    };

    const closeDetailsModal = () => {
        setShowDetails(false);
        setSelectedDevice(null);
    };

    const getBatteryIcon = (level) => {
        if (!level) return <FaBatteryFull />;
        if (level >= 80) return <FaBatteryFull />;
        if (level >= 60) return <FaBatteryThreeQuarters />;
        if (level >= 40) return <FaBatteryHalf />;
        if (level >= 20) return <FaBatteryQuarter />;
        return <FaBatteryEmpty />;
    };

    const getBatteryColor = (level) => {
        if (!level) return '#9AA0A6';
        if (level >= 60) return '#4CAF50';
        if (level >= 30) return '#FF9800';
        return '#F44336';
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'connected': return '#4CAF50';
            case 'offline': return '#9AA0A6';
            case 'disconnected': return '#F44336';
            default: return '#9AA0A6';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'connected': return <FaCheckCircle />;
            case 'offline': return <FaExclamationTriangle />;
            case 'disconnected': return <FaTimesCircle />;
            default: return <FaExclamationTriangle />;
        }
    };

    // Filter and sort devices
    const filteredDevices = mergedDevices.filter(device => {
        const matchesSearch = device.deviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            device.deviceId.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all' ||
            (filterStatus === 'connected' && device.status === 'connected') ||
            (filterStatus === 'offline' && device.status === 'offline');
        return matchesSearch && matchesStatus;
    });

    const sortedDevices = [...filteredDevices].sort((a, b) => {
        switch (sortBy) {
            case 'name':
                return a.deviceName.localeCompare(b.deviceName);
            case 'status':
                return a.status.localeCompare(b.status);
            case 'lastSeen':
                return new Date(b.lastSeen) - new Date(a.lastSeen);
            case 'scanCount':
                return (b.totalScans || 0) - (a.totalScans || 0);
            default:
                return 0;
        }
    });

    // Calculate stats
    const totalDevices = mergedDevices.length;
    const onlineDevices = mergedDevices.filter(d => d.status === 'connected').length;
    const totalScansToday = mergedDevices.reduce((sum, d) => sum + (d.totalScans || 0), 0);

    return (
        <div className="device-manager">
            {/* Header Section */}
            <div className="page-header ims-page-header">
                <div className="ims-header-left">
                    <h1>Device Manager</h1>
                    <p>Manage, monitor, and pair your barcode scanners</p>
                </div>
                <div className="ims-header-right">
                    <button
                        className="btn btn-secondary wifi-config-btn"
                        onClick={openWifiConfig}
                    >
                        <FaWifi /> WiFi Config
                    </button>
                    <button
                        className="btn btn-primary pair-device-btn"
                        onClick={generatePairingCode}
                        disabled={isGenerating}
                    >
                        <FaQrcode /> {isGenerating ? 'Generating...' : 'Pair New Device'}
                    </button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="quick-stats">
                <div className="stat-card">
                    <FaMicrochip className="stat-icon" />
                    <div className="stat-info">
                        <span className="stat-value">{totalDevices}</span>
                        <span className="stat-label">Total Devices</span>
                    </div>
                </div>
                <div className="stat-card">
                    <FaSignal className="stat-icon" />
                    <div className="stat-info">
                        <span className="stat-value">{onlineDevices}</span>
                        <span className="stat-label">Online Now</span>
                    </div>
                </div>
                <div className="stat-card">
                    <FaBarcode className="stat-icon" />
                    <div className="stat-info">
                        <span className="stat-value">{totalScansToday}</span>
                        <span className="stat-label">Total Scans</span>
                    </div>
                </div>
            </div>

            {error && <div className="error-banner">{error}</div>}

            {/* Main Content Area */}
            <div className="main-content">
                {/* Left Panel - Device Fleet */}
                <div className="device-fleet">
                    {/* Toolbar */}
                    <div className="device-controls">
                        <div className="search-section">
                            <div className="search-box">
                                <FaSearch className="search-icon" />
                                <input
                                    type="text"
                                    placeholder="Search devices..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <button
                                className="filter-btn"
                                onClick={() => setShowFilters(!showFilters)}
                            >
                                <FaFilter />
                                Filters
                            </button>
                        </div>

                        <div className="action-buttons">
                            <button className="btn btn-primary" onClick={exportDeviceData}>
                                <FaDownload />
                                Export
                            </button>
                        </div>
                    </div>

                    {/* Filters Panel */}
                    {showFilters && (
                        <div className="filters-panel">
                            <div className="filter-group">
                                <label>Status:</label>
                                <select
                                    value={filterStatus}
                                    onChange={(e) => setFilterStatus(e.target.value)}
                                >
                                    <option value="all">All</option>
                                    <option value="connected">Online</option>
                                    <option value="offline">Offline</option>
                                </select>
                            </div>
                            <div className="filter-group">
                                <label>Sort by:</label>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value)}
                                >
                                    <option value="name">Name</option>
                                    <option value="status">Status</option>
                                    <option value="lastSeen">Last Seen</option>
                                    <option value="scanCount">Scan Count</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Device Grid */}
                    <div className="device-grid">
                        {isLoadingPaired ? (
                            <div className="loading-spinner-container">
                                <div className="spinner-small"></div>
                                <h3>Loading devices...</h3>
                            </div>
                        ) : sortedDevices.length > 0 ? (
                            sortedDevices.map((device) => (
                                <div key={device.id} className="device-card">
                                    <div className="device-header">
                                        <div className="device-info">
                                            <div className="name-row">
                                                <h3>{device.deviceName}</h3>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="device-details">
                                        <div className="detail-row">
                                            <FaMapMarkerAlt />
                                            <span>IP: {device.ipAddress}</span>
                                        </div>
                                        <div className="detail-row">
                                            <FaClock />
                                            <span>Last Seen: {new Date(device.lastSeen).toLocaleString()}</span>
                                        </div>
                                        <div className="detail-row">
                                            <FaBarcode />
                                            <span>Total Scans: {device.totalScans || 0}</span>
                                        </div>
                                        {device.isLive && device.batteryLevel && (
                                            <div className="detail-row">
                                                <span style={{ color: getBatteryColor(device.batteryLevel) }}>
                                                    {getBatteryIcon(device.batteryLevel)}
                                                </span>
                                                <span>Battery: {device.batteryLevel}%</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="device-actions">
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => handleDetails(device)}
                                        >
                                            <FaInfoCircle />
                                            Details
                                        </button>
                                        <button
                                            className="btn btn-sm btn-danger"
                                            onClick={() => unpairDevice(device.id)}
                                        >
                                            <FaTrash />
                                            Unpair
                                        </button>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="no-devices">
                                <FaMobileAlt className="no-devices-icon" />
                                <h3>No Devices Found</h3>
                                <p>Click "Pair New Device" to get started</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel - Live Scanner Feed */}
                <div className="live-scanner-feed">
                    <h2>Live Scanner Feed</h2>
                    <div className="connection-status">
                        <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
                            <FaSignal />
                            {isConnected ? 'Connected' : 'Disconnected'}
                        </div>
                    </div>

                    {isProcessingScan && !latestScan ? (
                        <div className="scan-result-card processing">
                            <h3>Processing Scan...</h3>
                            <p>Collecting data from scanner...</p>
                        </div>
                    ) : latestScan ? (
                        <div className="scan-result-card">
                            <h3>Latest Scan</h3>

                            <div className="scan-info-section">
                                <div className="info-field">
                                    <label>Device</label>
                                    <span className="info-value">{latestScan.deviceName || 'Unknown Device'}</span>
                                </div>
                                <div className="info-field">
                                    <label>Scan Time</label>
                                    <span className="info-value">{displayTime}</span>
                                </div>
                            </div>

                            <div className="barcode-data-section">
                                <h4>Barcode Data</h4>
                                <div className="barcode-data-container">
                                    <span className="barcode-data-text">{latestScan.barcodeData}</span>
                                </div>
                            </div>

                            {(() => {
                                const deviceName = latestScan.deviceName || '';
                                const hasAI = deviceName && typeof deviceName === 'string' && deviceName.toUpperCase().includes('AI');

                                if (hasAI) {
                                    return (
                                        <div className="ai-analysis-section">
                                            <h4>🤖 AI Analysis</h4>
                                            <div className="ai-analysis-container">
                                                <div className="ai-field">
                                                    <label>Product:</label>
                                                    <span>{latestScan.aiAnalysis?.title || latestScan.aiAnalysis?.productName || 'Unknown Product'}</span>
                                                </div>
                                                <div className="ai-field">
                                                    <label>Category:</label>
                                                    <span>{latestScan.aiAnalysis?.category || latestScan.aiAnalysis?.productType || 'Unknown'}</span>
                                                </div>
                                                <div className="ai-field">
                                                    <label>Description:</label>
                                                    <div className="ai-description">
                                                        {latestScan.aiAnalysis?.description ||
                                                            latestScan.aiAnalysis?.description_short ||
                                                            'No AI analysis available for this scan.'}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                            <div className="save-scan-btn-container" style={{ marginTop: '15px' }}>
                                <button className="btn btn-primary" onClick={handleSaveScan} style={{ width: '100%' }}>
                                    Save Scan
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="no-scan-card">
                            <FaBarcode size={48} />
                            <h3>No Recent Scan</h3>
                            <p>Scan a barcode using your connected scanner to see results here</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Pairing Modal */}
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
                        {pairingCode && (
                            <div className="pairing-code-text" style={{ marginTop: '15px', marginBottom: '15px', fontSize: '16px', fontWeight: 'bold', letterSpacing: '1px', textAlign: 'center' }}>
                                Pairing Code: <code style={{ background: '#f1f3f4', padding: '4px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>{pairingCode}</code>
                            </div>
                        )}
                        <button className="modal-done-btn" onClick={closePairingModal}>
                            Done
                        </button>
                    </div>
                </div>
            )}

            {/* Details Modal */}
            {showDetails && selectedDevice && (
                <div className="modal-overlay" onClick={closeDetailsModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Device Details</h2>
                            <button className="close-btn" onClick={closeDetailsModal}>
                                <FaTimesCircle />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="device-details-grid">
                                <div className="detail-section">
                                    <h3>Basic Information</h3>
                                    <div className="detail-item">
                                        <strong>Device Name:</strong> {selectedDevice.deviceName}
                                    </div>
                                    <div className="detail-item">
                                        <strong>Device ID:</strong> {selectedDevice.deviceId}
                                    </div>
                                    <div className="detail-item">
                                        <strong>Status:</strong>
                                        <span className="status-badge" style={{ color: getStatusColor(selectedDevice.status) }}>
                                            {getStatusIcon(selectedDevice.status)} {selectedDevice.status}
                                        </span>
                                    </div>
                                    <div className="detail-item">
                                        <strong>IP Address:</strong> {selectedDevice.ipAddress}
                                    </div>
                                </div>

                                <div className="detail-section">
                                    <h3>Activity</h3>
                                    <div className="detail-item">
                                        <strong>Total Scans:</strong> {selectedDevice.totalScans || 0}
                                    </div>
                                    <div className="detail-item">
                                        <strong>Paired At:</strong> {new Date(selectedDevice.pairedAt).toLocaleString()}
                                    </div>
                                    <div className="detail-item">
                                        <strong>Last Seen:</strong> {new Date(selectedDevice.lastSeen).toLocaleString()}
                                    </div>
                                    {selectedDevice.batteryLevel && (
                                        <div className="detail-item">
                                            <strong>Battery Level:</strong> {selectedDevice.batteryLevel}%
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={closeDetailsModal}>
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* WiFi Configuration Modal */}
            {showWifiModal && (
                <div className="modal-overlay" onClick={closeWifiModal}>
                    <div className="wifi-modal" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close" onClick={closeWifiModal}>×</button>
                        <h2>WiFi Configuration</h2>
                        <p className="modal-instructions">
                            Enter WiFi credentials to generate a QR code for automatic device connection
                        </p>

                        <div className="wifi-form">
                            <div className="form-group">
                                <label htmlFor="wifi-ssid">WiFi Network Name (SSID) *</label>
                                <input
                                    id="wifi-ssid"
                                    type="text"
                                    className="form-control"
                                    placeholder="Enter WiFi SSID"
                                    value={wifiSSID}
                                    onChange={(e) => setWifiSSID(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="wifi-security">Security Type</label>
                                <select
                                    id="wifi-security"
                                    className="form-control"
                                    value={wifiSecurityType}
                                    onChange={(e) => setWifiSecurityType(e.target.value)}
                                >
                                    <option value="WPA">WPA/WPA2</option>
                                    <option value="WEP">WEP</option>
                                    <option value="nopass">Open (No Password)</option>
                                </select>
                            </div>

                            {wifiSecurityType !== 'nopass' && (
                                <div className="form-group">
                                    <label htmlFor="wifi-password">WiFi Password</label>
                                    <div className="password-input-wrapper">
                                        <input
                                            id="wifi-password"
                                            type={showPasswordWifi ? 'text' : 'password'}
                                            className="form-control"
                                            placeholder="Enter WiFi password"
                                            value={wifiPassword}
                                            onChange={(e) => setWifiPassword(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="toggle-password-btn"
                                            onClick={() => setShowPasswordWifi(!showPasswordWifi)}
                                        >
                                            {showPasswordWifi ? '👁️' : '👁️‍🗨️'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {wifiQrCodeUrl && (
                            <div className="wifi-qr-result">
                                <h3>📱 Scan to Connect</h3>
                                <div className="qr-code-container">
                                    <img src={wifiQrCodeUrl} alt="WiFi QR Code" className="qr-code" />
                                </div>
                                <div className="wifi-info">
                                    <p><strong>Network:</strong> {wifiSSID}</p>
                                    <p><strong>Security:</strong> {wifiSecurityType === 'nopass' ? 'Open Network' : wifiSecurityType}</p>
                                </div>
                                <p className="wifi-instructions">
                                    Scan this QR code with your device to automatically connect to the WiFi network
                                </p>
                            </div>
                        )}

                        <button className="modal-done-btn" onClick={closeWifiModal}>
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DeviceManager;
