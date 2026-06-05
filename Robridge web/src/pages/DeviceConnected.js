import React, { useState, useEffect } from 'react';
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
  FaMicrochip
} from 'react-icons/fa';
import { useWebSocket } from '../contexts/WebSocketContext';
import './DeviceConnected.css';

const DeviceConnected = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [, setIsRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showConfigure, setShowConfigure] = useState(false);
  const { isConnected, esp32Devices, latestScan, socket } = useWebSocket();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (esp32Devices.length > 0) {
      setLoading(false);
    } else {
      const timer = setTimeout(() => setLoading(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [esp32Devices]);

  // Listen for device pairing/unpairing events for instant updates
  React.useEffect(() => {
    if (!socket) return;

    const handleDevicePaired = () => {
      console.log('Device paired - devices will auto-update via WebSocket context');
    };

    const handleDeviceUnpaired = () => {
      console.log('Device unpaired - devices will auto-update via WebSocket context');
    };

    socket.on('device_paired', handleDevicePaired);
    socket.on('device_unpaired', handleDeviceUnpaired);

    return () => {
      socket.off('device_paired', handleDevicePaired);
      socket.off('device_unpaired', handleDeviceUnpaired);
    };
  }, [socket]);

  // Use WebSocket devices directly (no local polling needed)
  const displayDevices = esp32Devices;

  const getStatusColor = (status) => {
    switch (status) {
      case 'connected': return '#4CAF50';
      case 'disconnected': return '#F44336';
      default: return '#9AA0A6';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'connected': return <FaCheckCircle />;
      case 'disconnected': return <FaTimesCircle />;
      default: return <FaExclamationTriangle />;
    }
  };

  const filteredDevices = displayDevices.filter(device => {
    const matchesSearch = device.deviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      device.deviceId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || device.status === filterStatus;
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

  const exportDeviceData = () => {
    const csvContent = [
      ['Device Name', 'Device ID', 'Status', 'IP Address', 'Last Seen', 'Total Scans'],
      ...displayDevices.map(device => [
        device.deviceName,
        device.deviceId,
        device.status,
        device.ipAddress,
        device.lastSeen,
        device.totalScans || 0
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const date = new Date().toISOString().split('T')[0];
    const a = document.createElement('a');
    a.href = url;
    a.download = `connected_devices_${date}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleDetails = (device) => {
    setSelectedDevice(device);
    setShowDetails(true);
  };

  const closeModal = () => {
    setShowDetails(false);
    setShowConfigure(false);
    setSelectedDevice(null);
  };

  return (
    <div className="device-connected">
      <div className="page-header">
        <h1>Device Connected</h1>
        <p>Monitor and manage connected Barcode Scanners</p>
      </div>

      {/* Connection Status */}
      <div className="connection-status">
        <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          <FaSignal />
          WebSocket: {isConnected ? 'Connected' : 'Disconnected'}
        </div>
        <div className="device-count">
          <FaMicrochip />
          Device Connected: {displayDevices.length}
        </div>
      </div>

      {/* Controls */}
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

      {/* Filters */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filter-group">
            <label>Status:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All</option>
              <option value="connected">Connected</option>
              <option value="disconnected">Disconnected</option>
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

      {/* Latest Scan Info */}
      {latestScan && (
        <div className="latest-scan-info">
          <h3>Latest Device Connected Scan</h3>
          <div className="scan-details">
            <p><strong>Device:</strong> {latestScan.deviceName}</p>
            <p><strong>Barcode:</strong> {latestScan.barcodeData}</p>
            <p><strong>Time:</strong> {new Date(latestScan.timestamp).toLocaleString()}</p>

          </div>
        </div>
      )}

      {/* Device Grid */}
      <div className="device-grid">
        {loading ? (
          <div className="loading-spinner-container" style={{
            gridColumn: '1 / -1',
            padding: '60px',
            display: 'flex',
            justifyContent: 'center',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <div className="spinner-small" style={{
              width: '40px',
              height: '40px',
              border: '4px solid #E3821E',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              marginBottom: '16px'
            }}></div>
            <h3 style={{ color: '#5F6368', fontSize: '18px' }}>Searching for devices...</h3>
          </div>
        ) : sortedDevices.length > 0 ? (
          sortedDevices.map((device) => (
            <div key={device.deviceId} className="device-card">
              <div className="device-header">
                <div className="device-info">
                  <div className="name-row">
                    <h3>{device.deviceName}</h3>
                  </div>
                  <div className="status-row">
                    <span className={`status-badge ${device.status}`}>
                      {getStatusIcon(device.status)}
                      {device.status}
                    </span>
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


              </div>

              <div className="device-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleDetails(device)}
                >
                  <FaInfoCircle />
                  Details
                </button>

              </div>
            </div>
          ))
        ) : (
          <div className="no-devices">
            <FaMicrochip size={64} />
            <h3>No Device Connected Devices</h3>
            <p>Waiting for Device Connected devices to connect...</p>
            <p>Make sure your Device Connected is powered on and connected to WiFi.</p>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {showDetails && selectedDevice && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Device Details</h2>
              <button className="close-btn" onClick={closeModal}>
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
                    <strong>Last Seen:</strong> {new Date(selectedDevice.lastSeen).toLocaleString()}
                  </div>



                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Configure Modal */}
      {showConfigure && selectedDevice && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Configure Device</h2>
              <button className="close-btn" onClick={closeModal}>
                <FaTimesCircle />
              </button>
            </div>
            <div className="modal-body">
              <div className="config-form">
                <div className="form-group">
                  <label>Device Name</label>
                  <input
                    type="text"
                    defaultValue={selectedDevice.deviceName}
                    className="form-control"
                  />
                </div>

                <div className="form-group">
                  <label>Scan Interval (seconds)</label>
                  <input
                    type="number"
                    defaultValue="30"
                    className="form-control"
                  />
                </div>

                <div className="form-group">
                  <label>Heartbeat Interval (seconds)</label>
                  <input
                    type="number"
                    defaultValue="30"
                    className="form-control"
                  />
                </div>

                <div className="form-group">
                  <label>Auto Reconnect</label>
                  <select className="form-control">
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Debug Mode</label>
                  <select className="form-control">
                    <option value="false">Disabled</option>
                    <option value="true">Enabled</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary">
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeviceConnected;