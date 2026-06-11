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

  const processScanData = (scanData, eventType) => {
    console.log(`🔄 Processing ${eventType} in real-time:`, scanData);
    if (!scanData || !scanData.barcodeData) return;

    const rawTs = scanData.timestamp || scanData.scanned_at || scanData.created_at || Date.now();
    const completeScan = {
      ...scanData,
      timestamp: rawTs,
      clientReceivedAt: Date.now(), // Arrival time relative to local client clock to prevent clock-skew skips
      source: 'ESP32'
    };

    setLatestScan(completeScan);

    // Clear dashboard caches to keep data consistent across pages
    try {
      Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('ims_dashboard_cache_')) {
          sessionStorage.removeItem(key);
        }
      });
      console.log('🧹 Cleared dashboard cache on WebSocket scan');
    } catch (e) {
      console.error('Error clearing sessionStorage:', e);
    }

    if (scanData.deviceId) {
      setEsp32Devices(prev => {
        const exists = prev.find(d => String(d.deviceId).toLowerCase() === String(scanData.deviceId).toLowerCase());
        if (exists) {
          return prev.map(d => String(d.deviceId).toLowerCase() === String(scanData.deviceId).toLowerCase() ? { ...d, status: 'connected', lastSeen: new Date().toISOString() } : d);
        }
        return prev;
      });
    }
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

          const workspaceId = localStorage.getItem('robridge_workspace_id');
          const headers = { 'Authorization': `Bearer ${token}` };
          if (workspaceId) headers['x-workspace-id'] = workspaceId;

          const [dbData, liveData] = await Promise.all([
            fetch(`${serverURL}/api/devices`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
            fetch(`${serverURL}/api/esp32/devices`, { headers }).then(r => r.json()).catch(() => ({ success: false }))
          ]);

          if (dbData.success) {
            // WORKAROUND: Forcefully ping the backend for each device to read its live memory status
            // This bypasses the missing /api/esp32/devices endpoint on the old Render backend.
            const liveStatuses = await Promise.all(
              dbData.devices.map(d => 
                fetch(`${serverURL}/api/esp32/ping/${d.device_id}`)
                  .then(r => r.json())
                  .catch(() => ({ success: false }))
              )
            );

            setEsp32Devices(prev => {
              const mergedDevices = dbData.devices.map((dbDev, index) => {
                const liveDev = liveData.success && liveData.devices ? liveData.devices.find(d => String(d.deviceId).toLowerCase() === String(dbDev.device_id).toLowerCase()) : null;
                const pingData = liveStatuses[index];
                
                // Prioritize the lastSeen from the current React state if it's newer (updated via WebSocket)
                const existing = prev.find(p => String(p.deviceId).toLowerCase() === String(dbDev.device_id).toLowerCase());
                const existingLastSeen = existing && existing.lastSeen ? new Date(existing.lastSeen) : new Date(0);
                
                // Fix timezone issue: Postgres NOW() returns timestamp without timezone. Force UTC parsing.
                const parseDbDate = (dateStr) => {
                  if (!dateStr) return new Date(0);
                  const str = String(dateStr);
                  return new Date(str.endsWith('Z') || str.includes('+') ? str : str + 'Z');
                };

                // Prioritize ping data if available
                let fetchedLastSeen = parseDbDate(dbDev.last_seen);
                if (pingData && pingData.success && pingData.timestamp) {
                  fetchedLastSeen = new Date(pingData.timestamp);
                } else if (liveDev && liveDev.lastSeen) {
                  fetchedLastSeen = new Date(liveDev.lastSeen);
                }
                
                const bestLastSeen = existingLastSeen > fetchedLastSeen ? existingLastSeen : fetchedLastSeen;
                
                // Also give a 15-second grace period for 'connected' status
                const isRecentlySeen = bestLastSeen > new Date(Date.now() - 15 * 1000);

                return { 
                  ...dbDev, 
                  ...(liveDev || {}), 
                  status: isRecentlySeen ? 'connected' : 'disconnected',
                  lastSeen: bestLastSeen.toISOString(),
                  deviceName: dbDev.device_name, 
                  deviceId: dbDev.device_id 
                };
              });
              return mergedDevices;
            });
          }
        } catch (error) {
          console.error('Error fetching devices:', error);
        }
      };

      socketRef.current.fetchDevices = fetchDevices;
      fetchDevices();

      // Clear existing polling to prevent duplicates
      if (socketRef.current.devicePollingInterval) clearInterval(socketRef.current.devicePollingInterval);
      socketRef.current.devicePollingInterval = setInterval(fetchDevices, 3000); // Poll every 3s for fast UI updates
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
    // Commented out to prevent double-processing identical scan events emitted simultaneously
    // socketRef.current.on('esp32_scan_processed', (data) => processScanData(data, 'esp32_scan_processed'));
    socketRef.current.on('esp32_device_connected', (device) => {
      setEsp32Devices(prev => {
        const exists = prev.find(d => String(d.deviceId).toLowerCase() === String(device.deviceId).toLowerCase());
        if (exists) return prev.map(d => String(d.deviceId).toLowerCase() === String(device.deviceId).toLowerCase() ? { ...d, ...device, status: 'connected', lastSeen: new Date().toISOString() } : d);
        return [...prev, { ...device, status: 'connected', lastSeen: new Date().toISOString() }];
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
