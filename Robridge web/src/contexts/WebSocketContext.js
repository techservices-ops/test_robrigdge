import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { getServerURL } from '../config/api';
import { useAuth } from './AuthContext';

const WebSocketContext = createContext();

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

export const WebSocketProvider = ({ children }) => {
  const { isAuthenticated } = useAuth(); // Integrate AuthContext
  const [isConnected, setIsConnected] = useState(false);
  const [esp32Devices, setEsp32Devices] = useState([]);
  const [latestScan, setLatestScan] = useState(null);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [scanBuffer, setScanBuffer] = useState({});
  const socketRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const isProcessingScanRef = useRef(false);


  // Server URL is now imported from centralized config

  // Function to check if we have complete scan data
  const isCompleteScanData = (scanData) => {
    return scanData &&
      scanData.barcodeData &&
      scanData.barcodeData.trim().length > 0 &&
      scanData.deviceName &&
      scanData.scanType;
  };

  // Function to auto-save scan data to database
  const autoSaveScanToDatabase = async (scanData) => {
    try {
      const serverURL = getServerURL();
      const token = localStorage.getItem('robridge_token');

      if (!token) {
        console.error('Cannot auto-save scan: No token found');
        return;
      }

      const response = await fetch(`${serverURL}/api/barcodes/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          barcodeData: scanData.barcodeData,
          deviceName: scanData.deviceName || 'ESP32 Scanner',
          deviceId: scanData.deviceId || 'unknown',
          scanType: scanData.scanType || 'unknown',
          scannedAt: scanData.timestamp,
          productName: scanData.productInfo?.productName || `Scanned Product ${scanData.barcodeData}`,
          productId: scanData.barcodeData,
          weight: scanData.weight || null,
          dimensions: scanData.dimensions || null,
          category: scanData.productInfo?.productType || 'Scanned',
          aiAnalysis: {
            deviceName: scanData.deviceName || 'ESP32 Scanner',
            deviceId: scanData.deviceId || 'unknown',
            scanType: scanData.scanType || 'unknown',
            timestamp: scanData.timestamp || new Date().toISOString(),
            productDetails: scanData.productInfo?.productDetails || '',
            foundInLocalDB: scanData.productInfo?.foundInLocalDB || false,
            aiAnalysis: scanData.aiAnalysis,
            source: 'live_scanner'
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Live Scanner result auto-saved to database:', result);
      } else {
        console.error('Failed to auto-save Live Scanner result:', response.statusText);
      }
    } catch (error) {
      console.error('Error auto-saving Live Scanner result:', error);
    }
  };

  // Function to buffer and process scan data
  const processScanData = (scanData, eventType) => {
    console.log(`🔄 Processing ${eventType}:`, scanData);
    console.log('📊 AI Analysis in scan data:', scanData.aiAnalysis);

    // Only process ESP32 scans
    const isEsp32Device = scanData.deviceName?.includes('Scanner') ||
      scanData.deviceName?.includes('RobridgeAI') ||
      scanData.deviceName?.includes('Robridge') ||
      scanData.deviceName?.includes('ESP32-') ||
      scanData.source === 'esp32' ||
      scanData.source === 'esp32_basic' ||
      scanData.source === 'ESP32_LIVE_SCANNER';

    if (!isEsp32Device) {
      return;
    }

    // Buffer the data
    setScanBuffer(prev => ({
      ...prev,
      ...scanData,
      aiAnalysis: scanData.aiAnalysis || prev.aiAnalysis,
      lastUpdate: Date.now(),
      eventType: eventType
    }));

    // Check completeness
    setTimeout(() => {
      setScanBuffer(currentBuffer => {
        if (isCompleteScanData(currentBuffer) && !isProcessingScanRef.current) {
          console.log('✅ Complete scan data found, processing...');
          isProcessingScanRef.current = true;
          setIsProcessingScan(true);

          const hasValidTimestamp = (ts) => {
            if (!ts) return false;
            const date = new Date(ts);
            return !isNaN(date.getTime()) && date.getFullYear() > 2020;
          };

          const rawTs = currentBuffer.timestamp || currentBuffer.scanned_at || currentBuffer.created_at;
          const validTimestamp = hasValidTimestamp(rawTs)
            ? rawTs
            : Date.now();

          const completeScan = {
            ...currentBuffer,
            timestamp: validTimestamp,
            source: 'ESP32',
            aiAnalysis: currentBuffer.aiAnalysis,
            dbRecord: currentBuffer.productInfo ? {
              id: currentBuffer.barcodeData,
              name: currentBuffer.productInfo.productName,
              category: currentBuffer.productInfo.productType,
              price: '$0.00',
              location: 'ESP32 Scanner',
              lastUpdated: validTimestamp,
              status: currentBuffer.productInfo.foundInLocalDB ? 'ACTIVE' : 'UNKNOWN'
            } : null
          };

          setLatestScan(completeScan);
          // autoSaveScanToDatabase(completeScan); // Commented out to prevent duplicate saves/overwrites

          setTimeout(() => {
            isProcessingScanRef.current = false;
            setIsProcessingScan(false);
            setScanBuffer({});
          }, 2000);
        }
        return currentBuffer;
      });
    }, 500);
  };

  // Connect & Authenticate function
  const connectSocket = () => {
    if (socketRef.current && socketRef.current.connected) {
      console.log('WebSocket already connected, checking authentication...');
      // Re-authenticate just in case
      const token = localStorage.getItem('robridge_token');
      if (token) {
        socketRef.current.emit('authenticate', token);
      }
      return;
    }

    const serverURL = getServerURL();
    console.log('🔄 Initializing WebSocket connection to:', serverURL);

    // Close existing socket if any (cleanup)
    if (socketRef.current) {
      try {
        socketRef.current.disconnect();
        socketRef.current.removeAllListeners();
      } catch (e) {
        console.error('Error cleaning up socket:', e);
      }
    }

    socketRef.current = io(serverURL, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    setupSocketListeners();
  };

  const setupSocketListeners = () => {
    if (!socketRef.current) return;

    socketRef.current.on('connect', () => {
      console.log('✅ WebSocket connected');
      setIsConnected(true);

      const token = localStorage.getItem('robridge_token');
      if (token) {
        console.log('🔐 Authenticating WebSocket...');
        socketRef.current.emit('authenticate', token);
      } else {
        console.log('⚠️ No token found for WebSocket authentication');
      }
    });

    socketRef.current.on('authenticated', async (data) => {
      console.log('✅ WebSocket authenticated:', data);

      // Setup device polling/fetching logic
      const fetchDevices = async () => {
        try {
          const serverURL = getServerURL();
          const token = localStorage.getItem('robridge_token');
          if (!token) return;

          const [dbData, liveData] = await Promise.all([
            fetch(`${serverURL}/api/devices`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()).catch(() => ({ success: false })),
            fetch(`${serverURL}/api/esp32/devices`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()).catch(() => ({ success: false }))
          ]);

          if (dbData.success) {
            const mergedDevices = dbData.devices.map(dbDev => {
              const liveDev = liveData.success && liveData.devices ? liveData.devices.find(d => d.deviceId === dbDev.device_id) : null;
              const lastSeenDate = new Date(dbDev.last_seen);
              const isRecentlySeen = lastSeenDate > new Date(Date.now() - 5 * 60 * 1000);

              if (liveDev) return { ...dbDev, ...liveDev, status: liveDev.status || (isRecentlySeen ? 'connected' : 'disconnected'), deviceName: dbDev.device_name, deviceId: dbDev.device_id };
              if (isRecentlySeen) return { ...dbDev, status: 'connected', ipAddress: 'Active', deviceName: dbDev.device_name, deviceId: dbDev.device_id };
              return { ...dbDev, status: 'disconnected', ipAddress: 'Offline', deviceName: dbDev.device_name, deviceId: dbDev.device_id };
            });
            setEsp32Devices(mergedDevices);
          }
        } catch (error) {
          console.error('Error fetching devices:', error);
        }
      };

      socketRef.current.fetchDevices = fetchDevices;
      fetchDevices();

      // Clear existing polling to prevent duplicates
      if (socketRef.current.devicePollingInterval) clearInterval(socketRef.current.devicePollingInterval);
      socketRef.current.devicePollingInterval = setInterval(fetchDevices, 30000); // Poll every 30s to prevent 429 rate limit errors
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('⚠️ WebSocket disconnected:', reason);
      setIsConnected(false);
      if (reason === 'io server disconnect') {
        // Disconnected by server, try manual reconnect
        if (socketRef.current) socketRef.current.connect();
      }
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('❌ WebSocket connection error:', error.message);
      setIsConnected(false);
    });

    // Auth error handling
    socketRef.current.on('unauthorized', (error) => {
      console.error('⛔ WebSocket authentication failed:', error);
      // Force token refresh or logout if heavily persistent
    });

    socketRef.current.on('esp32_devices_update', () => {
      if (socketRef.current.fetchDevices) socketRef.current.fetchDevices();
    });

    socketRef.current.on('esp32_barcode_scan', (data) => processScanData(data, 'esp32_barcode_scan'));
    socketRef.current.on('esp32_scan_processed', (data) => processScanData(data, 'esp32_scan_processed'));
    socketRef.current.on('esp32_device_connected', (device) => {
      setEsp32Devices(prev => {
        const exists = prev.find(d => d.deviceId === device.deviceId);
        if (exists) return prev.map(d => d.deviceId === device.deviceId ? { ...d, ...device, status: 'connected' } : d);
        return [...prev, { ...device, status: 'connected' }];
      });
    });

    socketRef.current.on('device_paired', () => socketRef.current.fetchDevices && socketRef.current.fetchDevices());
    socketRef.current.on('device_unpaired', () => socketRef.current.fetchDevices && socketRef.current.fetchDevices());
  };

  // MAIN EFFECT: Handle Connection & Auth changes
  useEffect(() => {
    if (isAuthenticated) {
      connectSocket();
    } else {
      if (socketRef.current) {
        console.log('🔒 Logged out, disconnecting WebSocket');
        socketRef.current.disconnect();
      }
    }
  }, [isAuthenticated]);

  // ACTIVE CONNECTION MANAGEMENT (Heartbeat & Visibility)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('👀 Application visible (Wake/Focus) - Checking WebSocket...');

        // Check if socket is disconnected, if so, reconnect explicitly
        if (isAuthenticated && (!socketRef.current || !socketRef.current.connected)) {
          console.log('⚠️ Socket disconnected on wake, reconnecting...');
          connectSocket();
        } else if (isAuthenticated && socketRef.current && socketRef.current.connected) {
          // Determine if connection is stale by sending a ping or re-authenticating
          const token = localStorage.getItem('robridge_token');
          if (token) socketRef.current.emit('authenticate', token);
        }
      }
    };

    const handleOnline = () => {
      console.log('🌐 Network online - Reconnecting WebSocket...');
      if (isAuthenticated) connectSocket();
    };

    const handleOffline = () => {
      console.log('🚫 Network offline');
      setIsConnected(false);
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Heartbeat Interval: Check periodically
    heartbeatIntervalRef.current = setInterval(() => {
      if (isAuthenticated && (!socketRef.current || !socketRef.current.connected)) {
        console.log('💓 Heartbeat: Socket disconnected, reconnecting...');
        connectSocket();
      }
    }, 30000); // Check every 30 seconds

    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);

      if (socketRef.current) {
        if (socketRef.current.devicePollingInterval) clearInterval(socketRef.current.devicePollingInterval);
        socketRef.current.disconnect();
      }
    };
  }, [isAuthenticated]); // Re-bind if auth state changes

  const value = {
    isConnected,
    esp32Devices,
    latestScan,
    setLatestScan,
    scanBuffer,
    isProcessingScan,
    socket: socketRef.current
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};
