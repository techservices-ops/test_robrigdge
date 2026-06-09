import React, { useState, useRef, useEffect } from 'react';
import {
  FaBarcode, FaSearch, FaCheckCircle, FaExclamationCircle,
  FaPlus, FaTimes, FaClock,
  FaCubes, FaLayerGroup, FaTag, FaBoxOpen, FaSave,
  FaCogs, FaChevronDown, FaFilter
} from 'react-icons/fa';
import './IMSScanner.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useToast } from '../components/Toast';

const trackingColors = { FEFO: '#e74c3c', FIFO: '#3498db', LIFO: '#27ae60' };

const IMSScanner = () => {
  const { imsFetch, activeWorkspaceId } = useWorkspace();
  const { latestScan } = useWebSocket();
  const showToast = useToast();
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [scanInput, setScanInput] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [foundItem, setFoundItem] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanStage, setScanStage] = useState('RECEIVE');
  const [dynamicStages, setDynamicStages] = useState([
    { id: 1, name: 'RECEIVE', color: '#27ae60' },
    { id: 2, name: 'DISPATCH', color: '#e74c3c' },
    { id: 3, name: 'PUTAWAY', color: '#f39c12' }
  ]);
  const [batchNo, setBatchNo] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [scanLog, setScanLog] = useState([]);
  const [showOnboard, setShowOnboard] = useState(false);
  const [onboardForm, setOnboardForm] = useState({ name: '', category: 'General', unit: 'Unit', qty: '', tracking: 'FIFO' });
  const [newItemBarcode, setNewItemBarcode] = useState('');
  const [autoLogEnabled, setAutoLogEnabled] = useState(true);
  const [fefoRec, setFefoRec] = useState([]);
  const [dynamicCategories, setDynamicCategories] = useState(['General', 'Pharmacy', 'PPE', 'Hygiene', 'Electronics', 'Food & Beverage']);
  const inputRef = useRef(null);
  const isScanningRef = useRef(false); // guard against concurrent doScan() calls
  const lastScanTimeRef = useRef(0);
  const lastScanBarcodeRef = useRef('');
  // GRN/Dispatch/WO verify-scan result state
  const [scanMatch, setScanMatch] = useState(null); // { matched, type, data, message }
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('All');
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const actionDropdownRef = useRef(null);

  // Close action dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (actionDropdownRef.current && !actionDropdownRef.current.contains(e.target)) {
        setShowActionDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Fetch recent scan events
  const fetchEvents = async () => {
    if (!activeWorkspaceId) return;
    try {
      const res = await imsFetch('/api/ims/scanner/events?limit=20');
      const data = await res.json();
      if (data.success) {
        setScanLog(data.events.map(e => {
          // DB stores timestamps in UTC without 'Z'. Append 'Z' to force UTC interpretation
          // so toLocaleTimeString() correctly converts to the user's local timezone (e.g. IST).
          const rawTs = e.scanned_at || '';
          const utcDate = new Date(rawTs.includes('Z') || rawTs.includes('+') ? rawTs : rawTs.replace(' ', 'T') + 'Z');
          return {
            barcode: e.barcode, product: e.item_name || 'Unknown', action: e.workflow,
            qty: e.quantity, unit: e.unit || '', time: utcDate.toLocaleTimeString(),
            trace: [e.batch_no ? `B:${e.batch_no}` : '', e.serial_no ? `S:${e.serial_no}` : ''].filter(Boolean).join(' | ')
          };
        }));
      }
    } catch (err) { console.error('Failed to fetch events'); }
  };

  // Live WebSocket Updates - trigger full scan lookup when ESP32 scan arrives
  const lastProcessedScanRef = useRef(latestScan?.id || latestScan?.timestamp || null);
  const mountTimeRef = useRef(Date.now());
  const doScanRef = useRef(null);

  // Keep doScanRef fresh on every render to eliminate stale closures of scanStage
  useEffect(() => {
    doScanRef.current = doScan;
  });

  useEffect(() => {
    if (latestScan && latestScan.barcodeData) {
      // Prevent processing historical scans on mount (older than page load time)
      const scanTime = new Date(latestScan.timestamp || latestScan.scanned_at || latestScan.created_at || Date.now()).getTime();
      if (scanTime < mountTimeRef.current - 1000) {
        console.log('⏳ Skipping historical WebSocket scan on mount:', latestScan.barcodeData);
        return;
      }

      // Prevent processing the exact same scan event multiple times
      if (lastProcessedScanRef.current === latestScan.id || lastProcessedScanRef.current === latestScan.timestamp) return;
      lastProcessedScanRef.current = latestScan.id || latestScan.timestamp;
      
      doScanRef.current(latestScan.barcodeData, latestScan.id);
    }
  }, [latestScan]);

  // Load Preferences and Dynamic Stages
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
    const loadData = async () => {
      if (activeWorkspaceId) {
        try {
          const res = await imsFetch('/api/ims/settings');
          const setData = await res.json();
          if (setData.success && setData.settings?.scannerPrefs) {
             setAutoLogEnabled(setData.settings.scannerPrefs.autoLog);
          }
          const wfRes = await imsFetch('/api/ims/workflows');
          const wfData = await wfRes.json();
          if (wfData.success && wfData.workflows.length > 0) {
             setDynamicStages(wfData.workflows);
             if (!wfData.workflows.find(s => s.name === scanStage)) {
               setScanStage(wfData.workflows[0].name);
             }
          }
          // Fetch dynamic categories
          const catRes = await imsFetch('/api/ims/categories');
          const catData = await catRes.json();
          if (catData.success && catData.categories.length > 0) {
            setDynamicCategories(catData.categories.map(c => c.name));
          }
          // Fetch workspace locations
          const locRes = await imsFetch('/api/ims/locations');
          const locData = await locRes.json();
          if (locData.success && locData.locations) {
            setLocations(locData.locations);
            if (locData.locations.length > 0) {
              setSelectedLocation(locData.locations[0]);
            }
          }
          fetchEvents();
        } catch (e) { console.error('IMS fetch error:', e); }
      }
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  const recordScanEvent = async (item, workflow, qty = 1, batch = '', serial = '', nameFallback = '', notes = '', websocketScanId = '', location = '', locationId = '') => {
    try {
      const res = await imsFetch('/api/ims/scanner/scan', {
        method: 'POST',
        body: JSON.stringify({
          barcode: item ? item.barcode : newItemBarcode,
          itemId: item ? item.id : null,
          itemName: item ? item.name : nameFallback,
          workflow,
          quantity: qty,
          unit: item ? item.baseUnit : onboardForm.unit,
          category: item ? item.category : onboardForm.category,
          trackingMode: item ? item.trackingMode : onboardForm.tracking,
          batchNo: batch,
          serialNo: serial,
          notes: notes,
          websocketScanId: websocketScanId,
          location,
          locationId
        })
      });
      const data = await res.json();
      if (data.success && data.updatedStock !== undefined) {
        if (item) {
          const updatedLocations = location ? [{ zone: location, qty: data.updatedStock }] : item.locations;
          setFoundItem({ ...item, stock: data.updatedStock, locations: updatedLocations });
        }
      }
      fetchEvents();
    } catch (e) { console.error('Error recording scan'); }
  };

  const isGrnMode = (stage) => stage === 'RECEIVE' || stage === 'DISPATCH';
  const isWoMode = (stage) => stage === 'PUTAWAY';

  const doScan = async (code, websocketScanId = null) => {
    const val = code || scanInput.trim();
    if (!val) return;

    // Debounce: ignore scans of the exact same barcode within 2500ms
    const now = Date.now();
    if (val === lastScanBarcodeRef.current && now - lastScanTimeRef.current < 2500) {
      console.log('🚫 Ignoring duplicate scan (debounce):', val);
      return;
    }
    lastScanBarcodeRef.current = val;
    lastScanTimeRef.current = now;

    // Prevent double-firing from concurrent event sources (WebSocket + keyboard/button)
    if (isScanningRef.current) return;
    isScanningRef.current = true;
    localStorage.setItem('ims_last_scanned_barcode', val);
    setScanning(true);
    setScanResult(null);
    setFoundItem(null);
    setScanMatch(null);
    setBatchNo('');
    setSerialNo('');

    try {
      // ── GRN / Dispatch verify-scan mode ──────────────────────────
      if (isGrnMode(scanStage)) {
        const res = await imsFetch('/api/ims/grn/verify-scan', {
          method: 'POST',
          body: JSON.stringify({ barcode: val, mode: scanStage })
        });
        const data = await res.json();
        setScanMatch({ type: 'GRN', ...data });
        setScanResult(data.matched ? 'scan_match' : 'scan_nomatch');

        // Also look up catalog item for right-panel product info
        try {
          const lookupRes = await imsFetch(`/api/ims/scanner/lookup/${encodeURIComponent(val)}`);
          const lookupData = await lookupRes.json();
          if (lookupData.success && lookupData.found) {
            setFoundItem(lookupData.item);
            if (data.matched && autoLogEnabled) {
              const prefix = scanStage === 'DISPATCH' ? 'DN:' : 'GRN:';
              await recordScanEvent(lookupData.item, scanStage, 1, '', '', '', prefix + data.grn.docNo);
            }
          }
        } catch (e) { /* catalog lookup failure is non-fatal */ }

        setScanning(false);
        setScanInput('');
        isScanningRef.current = false;
        setTimeout(() => inputRef.current?.focus(), 300);
        return;
      }

      // ── Work Order verify-scan mode ──────────────────────────────
      if (isWoMode(scanStage)) {
        const res = await imsFetch('/api/ims/workorders/verify-scan', {
          method: 'POST',
          body: JSON.stringify({ barcode: val })
        });
        const data = await res.json();
        setScanMatch({ type: 'WO', ...data });
        setScanResult(data.matched ? 'scan_match' : 'scan_nomatch');

        // Also look up catalog item for right-panel product info
        try {
          const lookupRes = await imsFetch(`/api/ims/scanner/lookup/${encodeURIComponent(val)}`);
          const lookupData = await lookupRes.json();
          if (lookupData.success && lookupData.found) {
            setFoundItem(lookupData.item);
            if (data.matched && autoLogEnabled) {
              await recordScanEvent(lookupData.item, scanStage, 1, '', '', '', 'WO:' + data.wo.woNumber);
            }
          }
        } catch (e) { /* catalog lookup failure is non-fatal */ }

        setScanning(false);
        setScanInput('');
        isScanningRef.current = false;
        setTimeout(() => inputRef.current?.focus(), 300);
        return;
      }

      // ── Regular catalog lookup mode ───────────────────────────────
      const res = await imsFetch(`/api/ims/scanner/lookup/${encodeURIComponent(val)}`);
      const data = await res.json();
      setScanning(false);

      if (data.success && data.found) {
        const item = data.item;
        setFoundItem(item);

        if (item?.trackingMode === 'FEFO') {
          try {
            const fr = await imsFetch(`/api/ims/fefo-recommendation?barcode=${encodeURIComponent(val)}`);
            const fd = await fr.json();
            if (fd.success) setFefoRec(fd.recommendation || []);
          } catch(e) { setFefoRec([]); }
        } else {
          setFefoRec([]);
        }

        if (scanStage === 'RECEIVE') {
          setScanResult('known');
          await recordScanEvent(item, 'RECEIVE', 1, '', '', '', '', websocketScanId);
          showToast(`Received 1 unit of ${item.name}`, 'success');
        } else if (scanStage === 'DISPATCH') {
          if (item.stock <= 0) {
            setScanResult('error');
            showToast(`Cannot dispatch ${item.name}. Stock is already 0.`, 'error');
          } else {
            setScanResult('known');
            await recordScanEvent(item, 'DISPATCH', 1, '', '', '', '', websocketScanId);
            showToast(`Dispatched 1 unit of ${item.name}`, 'success');
          }
        } else if (scanStage === 'PUTAWAY') {
          if (!selectedLocation) {
            setScanResult('error');
            showToast('Please select a target location for Putaway.', 'error');
          } else {
            setScanResult('confirmed');
            await recordScanEvent(item, 'PUTAWAY', 0, '', '', '', '', websocketScanId, selectedLocation.name, selectedLocation.id);
            showToast(`Moved ${item.name} to ${selectedLocation.name}`, 'success');
          }
        } else {
          setScanResult('known');
        }
      } else {
        // Item not found in catalog
        if (scanStage === 'RECEIVE') {
          setScanResult('unknown');
          setNewItemBarcode(val);
          setShowOnboard(true);
        } else {
          setScanResult('error');
          showToast(`Item with barcode ${val} not found in catalog.`, 'error');
        }
      }
    } catch (err) {
      console.error(err);
      setScanning(false);
      setScanResult('error');
      showToast('Scan processing failed.', 'error');
    }
    setScanInput('');
    isScanningRef.current = false;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doScan();
    }
  };


  const handleOnboardSave = async () => {
    const tempItem = {
      name: onboardForm.name || 'New Item',
      barcode: newItemBarcode,
      category: onboardForm.category,
      baseUnit: onboardForm.unit,
      trackingMode: onboardForm.tracking,
      stock: 0
    };
    await recordScanEvent(tempItem, scanStage, onboardForm.qty || 1, '', '', tempItem.name);
    setShowOnboard(false);
    setOnboardForm({ name: '', category: 'General', unit: 'Unit', qty: '', tracking: 'FIFO' });
    setTimeout(() => inputRef.current?.focus(), 100);
  };



  const filteredLog = scanLog.filter(entry => {
    const matchesSearch = 
      (entry.barcode || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entry.product || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entry.action || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesAction = 
      actionFilter === 'All' || 
      (entry.action || '').toUpperCase() === actionFilter.toUpperCase();
    
    return matchesSearch && matchesAction;
  });

  const exportToCSV = () => {
    if (filteredLog.length === 0) return;
    const headers = ['Time', 'Action', 'Barcode', 'Product', 'Quantity', 'Traceability'];
    const rows = filteredLog.map(entry => [
      entry.time,
      entry.action,
      entry.barcode,
      entry.product,
      entry.qty,
      entry.trace || '-'
    ]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `scan_history_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  return (
    <div className="ims-scanner-page">
      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Smart Scanner</h1>
          <p>Scan barcodes to instantly look up, add or move stock items</p>
        </div>
        <div className="ims-header-right">
          <div className="scan-stage-toggle">
            {dynamicStages.map(s => (
              <button 
                key={s.id}
                className={`stage-btn ${scanStage === s.name ? 'active' : ''}`}
                style={scanStage === s.name ? { backgroundColor: s.color, color: 'white', borderColor: s.color } : {}}
                onClick={() => setScanStage(s.name)}
              >
                <FaCogs /> {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="scanner-layout">
        {/* Left — Scan Zone */}
        <div className="scanner-left">
          {/* Scan Result Banner */}
      {scanMatch && (
        <div style={{
          margin: '0 0 16px',
          borderRadius: 12,
          padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 16,
          background: scanMatch.matched ? '#f0fff4' : '#fff5f5',
          border: `1px solid ${scanMatch.matched ? '#27ae60' : '#e74c3c'}`
        }}>
          {scanMatch.matched ? (
            <>
              <FaCheckCircle style={{ fontSize: 32, color: '#27ae60', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                {scanMatch.type === 'GRN' ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#27ae60' }}>
                      {scanMatch.item.name}
                    </div>
                    <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>
                      {scanStage === 'RECEIVE' ? '📄 GRN' : '🚚 Dispatch Note'}: <strong>{scanMatch.grn.docNo}</strong> · {scanMatch.grn.supplier}
                    </div>
                    <div style={{ marginTop: 8, background: '#e8e8e8', borderRadius: 50, height: 8, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 50, transition: 'width 0.4s',
                        width: `${Math.min(100, (Number(scanMatch.item.receivedQty) / Number(scanMatch.item.orderedQty || 1)) * 100)}%`,
                        background: scanMatch.item.fullyReceived ? '#27ae60' : '#3498db'
                      }} />
                    </div>
                    <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
                      {scanMatch.item.receivedQty} / {scanMatch.item.orderedQty} {scanMatch.item.unit} received
                      {scanMatch.item.fullyReceived && <span style={{ color: '#27ae60', fontWeight: 700 }}> ✓ Complete!</span>}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#27ae60' }}>
                      {scanMatch.wo.productName}
                    </div>
                    <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>
                      ⚙️ Work Order: <strong>{scanMatch.wo.woNumber}</strong>
                    </div>
                    <div style={{ marginTop: 8, background: '#e8e8e8', borderRadius: 50, height: 8, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 50, transition: 'width 0.4s',
                        width: `${Math.min(100, (Number(scanMatch.wo.builtQty) / Number(scanMatch.wo.targetQty || 1)) * 100)}%`,
                        background: scanMatch.wo.fullyBuilt ? '#27ae60' : '#f39c12'
                      }} />
                    </div>
                    <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
                      {scanMatch.wo.builtQty} / {scanMatch.wo.targetQty} units built
                      {scanMatch.wo.fullyBuilt && <span style={{ color: '#27ae60', fontWeight: 700 }}> ✓ Target Reached!</span>}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <FaExclamationCircle style={{ fontSize: 32, color: '#e74c3c', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, color: '#e74c3c' }}>No match found</div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{scanMatch.message}</div>
              </div>
            </>
          )}
        </div>
      )}
          {scanStage === 'PUTAWAY' && (
            <div className="putaway-location-box" style={{
              margin: '0 0 16px',
              borderRadius: 12,
              padding: '16px 20px',
              background: '#fcfcfd',
              border: '1px solid #dadce0',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: '#3c4043', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📍 Target Location for Putaway</span>
              </label>
              <select
                className="form-select"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #dadce0',
                  fontSize: '14px',
                  color: '#3c4043',
                  backgroundColor: '#ffffff'
                }}
                value={selectedLocation ? selectedLocation.id : ''}
                onChange={(e) => {
                  const loc = locations.find(l => l.id === Number(e.target.value));
                  setSelectedLocation(loc || null);
                }}
              >
                {locations.length === 0 ? (
                  <option value="">No locations available</option>
                ) : (
                  locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.type})</option>
                  ))
                )}
              </select>
            </div>
          )}

      <div className={`scan-zone ${scanning ? 'scanning' : ''} ${scanResult === 'known' ? 'found' : ''} ${scanResult === 'unknown' ? 'notfound' : ''}`}>
            <div className="scan-icon-wrap">
              {scanning ? (
                <div className="scan-spinner"></div>
              ) : scanResult === 'known' ? (
                <FaCheckCircle className="scan-status-icon ok" />
              ) : scanResult === 'pending_confirm' ? (
                <FaExclamationCircle className="scan-status-icon warn" style={{ color: '#f39c12' }} />
              ) : scanResult === 'unknown' ? (
                <FaExclamationCircle className="scan-status-icon warn" />
              ) : scanResult === 'onboarded' ? (
                <FaCheckCircle className="scan-status-icon ok" />
              ) : (
                <FaBarcode className="scan-idle-icon" />
              )}
            </div>
            <div className="scan-label">
              {scanning ? 'Scanning...' :
                scanResult === 'known' ? 'Item Auto-Logged ✓' :
                scanResult === 'pending_confirm' ? 'Needs Confirmation' :
                scanResult === 'unknown' ? 'Unknown Barcode' :
                scanResult === 'onboarded' ? 'Item Onboarded! ✓' :
                scanResult === 'confirmed' ? `${scanStage} Confirmed ✓` :
                `Ready to Scan for ${scanStage}`}
            </div>
            <input
              ref={inputRef}
              className="scan-input"
              type="text"
              placeholder="Scan barcode or type here..."
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button className="btn btn-primary scan-btn" onClick={() => doScan()} disabled={scanning || !scanInput.trim()}>
              <FaSearch /> Scan
            </button>
          </div>

        </div>

        {/* Right — Product Info */}
        <div className="scanner-right">
          {foundItem ? (
            <div className="found-item-card">
              <div className="found-header">
                <div className="found-name">{foundItem.name}</div>
                <div className="found-tracking" style={{ background: `${trackingColors[foundItem.trackingMode]}22`, color: trackingColors[foundItem.trackingMode] }}>
                  {foundItem.trackingMode}
                </div>
              </div>
              <div className="found-details-grid">
                <div className="found-detail-item">
                  <FaTag className="fd-icon" /> <span className="fd-label">Barcode</span>
                  <span className="fd-value">{foundItem.barcode}</span>
                </div>
                <div className="found-detail-item">
                  <FaCubes className="fd-icon" /> <span className="fd-label">Category</span>
                  <span className="fd-value">{foundItem.category}</span>
                </div>
                
                {foundItem.customFields && Object.entries(foundItem.customFields).map(([key, value]) => (
                  <div className="found-detail-item" key={key}>
                    <FaTag className="fd-icon" style={{ color: '#8e44ad' }} /> <span className="fd-label">{key}</span>
                    <span className="fd-value">{value || '-'}</span>
                  </div>
                ))}

                <div className="found-detail-item stock-item">
                  <FaBoxOpen className="fd-icon" /> <span className="fd-label">Current Stock</span>
                  <span className={`fd-value stock-val ${foundItem.stock < 20 ? 'low-stock' : ''}`}>{foundItem.stock} {foundItem.baseUnit}s</span>
                </div>
                <div className="found-detail-item">
                  <FaLayerGroup className="fd-icon" /> <span className="fd-label">Unit</span>
                  <span className="fd-value">{foundItem.baseUnit}</span>
                </div>
                {/* Children panel (parent-child hierarchy) */}
              {foundItem.children && foundItem.children.length > 0 && (
                <div style={{ margin: '0 20px 12px', background: '#fff9f0', border: '1px solid #f39c12', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#e67e22', marginBottom: 8 }}>📦 Box contains {foundItem.children.length} child item(s):</div>
                  {foundItem.children.map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #fde8c8' }}>
                      <span><code>{c.barcode}</code> — {c.name}</span>
                      <span style={{ fontWeight: 600, color: c.stock === 0 ? '#e74c3c' : '#27ae60' }}>Stock: {c.stock}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* FEFO Recommendation */}
              {fefoRec.length > 0 && (
                <div style={{ margin: '0 20px 12px', background: '#fff0f0', border: '1px solid #e74c3c', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#e74c3c', marginBottom: 8 }}>🧊 FEFO — Dispatch this batch first:</div>
                  {fefoRec.map((b, i) => (
                    <div key={i} style={{ fontSize: 13, padding: '3px 0', color: '#555' }}>
                      Batch <strong>{b.batch_no}</strong> → Expires <strong style={{ color: '#e74c3c' }}>{b.expiry_date?.split('T')[0]}</strong> (qty: {b.current_qty})
                    </div>
                  ))}
                </div>
              )}

              {foundItem.parentBarcode && (
                  <div className="found-detail-item uom-item">
                    <FaLayerGroup className="fd-icon" /> <span className="fd-label">Parent Unit</span>
                    <span className="fd-value">1 {foundItem.parentUnit} = {foundItem.multiplier} {foundItem.baseUnit}s</span>
                  </div>
                )}
                {foundItem.expiryDate && (
                  <div className="found-detail-item">
                    <FaClock className="fd-icon" /> <span className="fd-label">Expiry</span>
                    <span className="fd-value">{foundItem.expiryDate}</span>
                  </div>
                )}
                <div className="found-detail-item full-width">
                  <span className="fd-label">📍 Location</span>
                  <span className="fd-value">
                    {Array.isArray(foundItem.locations) && foundItem.locations.length > 0
                      ? foundItem.locations.map(l => `${l.zone} (${l.qty})`).join(', ')
                      : 'None'}
                  </span>
                </div>
              </div>
              {scanMatch === null ? (
                <div className="found-actions" style={{ justifyContent: 'center', background: '#f0fff5', borderTop: '1px solid #c3e6cb', color: '#155724', padding: '12px', fontWeight: 'bold', width: '100%' }}>
                  <FaCheckCircle style={{ marginRight: '8px' }} /> Successfully Auto-Logged
                </div>
              ) : scanMatch.matched ? (
                <div className="found-actions" style={{ justifyContent: 'center', background: '#f0fff5', borderTop: '1px solid #c3e6cb', color: '#155724', padding: '12px', fontWeight: 'bold', width: '100%' }}>
                  <FaCheckCircle style={{ marginRight: '8px' }} /> Verification Successful — Logged
                </div>
              ) : autoLogEnabled ? (
                <div className="found-actions" style={{ justifyContent: 'center', background: '#fff9e6', borderTop: '1px solid #ffeeba', color: '#856404', padding: '12px', fontWeight: 'bold', width: '100%' }}>
                  <FaExclamationCircle style={{ marginRight: '8px' }} /> Verification Failed — Logged as Standalone
                </div>
              ) : (
                <div className="found-actions" style={{ justifyContent: 'center', background: '#fff0f0', borderTop: '1px solid #f5c6cb', color: '#721c24', padding: '12px', fontWeight: 'bold', width: '100%' }}>
                  <FaExclamationCircle style={{ marginRight: '8px' }} /> Verification Failed — Not Logged
                </div>
              )}
            </div>
          ) : (
             <div className="empty-state" style={{ background: '#fff', border: '1px solid #dadce0', borderRadius: '12px', height: '100%' }}>
                <FaBarcode className="empty-state-icon" style={{ fontSize: '64px', color: '#e8eaed' }} />
                <h3 style={{ color: '#5f6368' }}>No Product Scanned</h3>
                <p>Scan an item to view its details here</p>
             </div>
          )}
        </div>
      </div>

      {/* Bottom — Scan History Table */}
      <div className="scan-history-section" style={{ marginTop: '24px' }}>
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
               <FaClock style={{ color: '#e3821e', fontSize: '20px' }} />
               <h2 style={{ margin: 0, fontSize: '18px' }}>Scan History Explorer</h2>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div className="logs-search-wrapper" style={{ width: '220px' }}>
                  <FaSearch className="search-icon" />
                  <input
                    type="text"
                    placeholder="Search logs..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="action-dropdown-wrapper" ref={actionDropdownRef}>
                  <button
                    className="action-dropdown-trigger"
                    onClick={() => setShowActionDropdown(v => !v)}
                  >
                    <FaFilter className="action-dd-icon" />
                    <span>{actionFilter === 'All' ? 'All Actions' : actionFilter}</span>
                    <FaChevronDown className={`action-dd-chevron${showActionDropdown ? ' open' : ''}`} />
                  </button>
                  {showActionDropdown && (
                    <div className="action-dropdown-menu">
                      {['All', ...dynamicStages.map(s => s.name)].map(opt => (
                        <button
                          key={opt}
                          className={`action-dd-option${actionFilter === opt ? ' selected' : ''}`}
                          onClick={() => { setActionFilter(opt); setShowActionDropdown(false); }}
                        >
                          {opt === 'All' ? 'All Actions' : opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn btn-secondary export-csv-btn" onClick={exportToCSV}>Export CSV</button>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
             <div className="table-container" style={{ boxShadow: 'none', borderRadius: 0, overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%' }}>
                   <thead>
                      <tr>
                         <th>Time</th>
                         <th>Action</th>
                         <th>Barcode</th>
                         <th>Product</th>
                         <th>Qty</th>
                         <th>Traceability</th>
                         <th>User</th>
                         <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                   </thead>
                   <tbody>
                      {filteredLog.map((entry, i) => (
                         <tr key={`log-${i}`}>
                            <td style={{ color: '#5f6368', fontSize: '13px' }}>{entry.time}</td>
                            <td><span className={`log-action-badge action-${entry.action.toLowerCase()}`}>{entry.action}</span></td>
                            <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{entry.barcode}</td>
                            <td style={{ fontWeight: 600, color: '#2c3e50' }}>{entry.product}</td>
                            <td>{entry.qty} {entry.unit}</td>
                            <td style={{ fontSize: '12px', color: '#7f8c8d' }}>{entry.trace || '-'}</td>
                            <td style={{ fontSize: '13px' }}>Admin (Aisle 4)</td>
                            <td style={{ textAlign: 'right' }}>
                               <button className="icon-btn delete-btn" title="Revert Scan">
                                  <FaTimes />
                               </button>
                            </td>
                         </tr>
                      ))}
                      {filteredLog.length === 0 && (
                         <tr>
                            <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#95a5a6' }}>
                               No matching scans found.
                            </td>
                         </tr>
                      )}
                   </tbody>
                </table>
             </div>
          </div>
        </div>


      </div>

      {/* Unknown Barcode Onboarding Modal */}
      {showOnboard && (
        <div className="ims-modal-overlay" onClick={() => setShowOnboard(false)}>
          <div className="ims-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <FaPlus className="modal-icon" />
              <div>
                <h2>New Barcode Detected</h2>
                <p>Barcode <strong>{newItemBarcode}</strong> is not in your catalog. Add it now?</p>
              </div>
              <button className="modal-close" onClick={() => setShowOnboard(false)}><FaTimes /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Product Name *</label>
                <input className="form-input" placeholder="e.g. Aspirin 100mg" value={onboardForm.name}
                  onChange={e => setOnboardForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="modal-row">
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={onboardForm.category}
                    onChange={e => setOnboardForm(f => ({ ...f, category: e.target.value }))}>
                    {dynamicCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Base Unit</label>
                  <select className="form-select" value={onboardForm.unit}
                    onChange={e => setOnboardForm(f => ({ ...f, unit: e.target.value }))}>
                    <option>Unit</option>
                    <option>Pack</option>
                    <option>Box</option>
                    <option>Case</option>
                    <option>Piece</option>
                    <option>Kg</option>
                    <option>Litre</option>
                  </select>
                </div>
              </div>
              <div className="modal-row">
                <div className="form-group">
                  <label className="form-label">Opening Quantity</label>
                  <input className="form-input" type="number" placeholder="0" value={onboardForm.qty}
                    onChange={e => setOnboardForm(f => ({ ...f, qty: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tracking Mode</label>
                  <select className="form-select" value={onboardForm.tracking}
                    onChange={e => setOnboardForm(f => ({ ...f, tracking: e.target.value }))}>
                    <option value="FIFO">FIFO — First In First Out</option>
                    <option value="FEFO">FEFO — First Expire First Out</option>
                    <option value="LIFO">LIFO — Last In First Out</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowOnboard(false)}>Skip for Now</button>
              <button className="btn btn-primary" onClick={handleOnboardSave}>
                <FaSave /> Add to Catalog
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IMSScanner;
