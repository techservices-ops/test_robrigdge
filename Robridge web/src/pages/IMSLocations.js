import React, { useState, useEffect, useCallback } from 'react';
import {
  FaWarehouse, FaPlus, FaSearch, FaExchangeAlt, FaTimes,
  FaSave, FaTrash, FaBoxes, FaMapMarkerAlt, FaSync, FaSpinner,
  FaLayerGroup, FaCheck
} from 'react-icons/fa';
import './IMSLocations.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useConfirm } from '../components/ConfirmModal';
import { useToast } from '../components/Toast';

const ZONE_TYPES = ['WAREHOUSE', 'RND', 'MANUFACTURING', 'ASSEMBLY', 'QC', 'SHIPPING'];
const ZONE_COLORS = {
  WAREHOUSE: '#3498db', RND: '#9b59b6', MANUFACTURING: '#e67e22',
  ASSEMBLY: '#e74c3c', QC: '#27ae60', SHIPPING: '#1abc9c'
};

export default function IMSLocations() {
  const { imsFetch, activeWorkspaceId, activeWorkspace } = useWorkspace();
  const confirm = useConfirm();
  const showToast = useToast();

  const isReadOnly = ['user', 'member', 'viewer'].includes(activeWorkspace?.currentUserRole);

  // ── Core state ────────────────────────────────────────────────────────────
  const [locations, setLocations]   = useState([]);
  const [selected, setSelected]     = useState(null);
  const [zoneStock, setZoneStock]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');

  // ── Create zone modal ─────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState({ name: '', type: 'WAREHOUSE', description: '' });

  // ── Transfer modal ────────────────────────────────────────────────────────
  const [showTransfer, setShowTransfer]   = useState(false);
  const [transfer, setTransfer]           = useState({ barcode: '', itemName: '', fromLocationId: '', toLocationId: '', qty: '' });
  const [sourceStock, setSourceStock]               = useState([]);
  const [sourceStockLoading, setSourceStockLoading] = useState(false);
  const [maxAvailableQty, setMaxAvailableQty]       = useState(null);

  const loadSourceStock = async (zoneId) => {
    setSourceStockLoading(true);
    try {
      const r = await imsFetch(`/api/ims/locations/${zoneId}/stock`);
      const d = await r.json();
      if (d.success) {
        setSourceStock((d.stock || []).filter(s => s.qty > 0));
      } else {
        setSourceStock([]);
      }
    } catch (e) {
      setSourceStock([]);
    } finally {
      setSourceStockLoading(false);
    }
  };

  const handleFromZoneChange = async (zoneId) => {
    setTransfer(t => ({ ...t, fromLocationId: zoneId, barcode: '', itemName: '', qty: '' }));
    setMaxAvailableQty(null);
    if (!zoneId) {
      setSourceStock([]);
      return;
    }
    loadSourceStock(zoneId);
  };

  const handleSourceStockItemChange = (barcode) => {
    const item = sourceStock.find(s => s.barcode === barcode);
    if (item) {
      setTransfer(t => ({ ...t, barcode: item.barcode, itemName: item.item_name }));
      setMaxAvailableQty(item.qty);
    } else {
      setTransfer(t => ({ ...t, barcode: '', itemName: '' }));
      setMaxAvailableQty(null);
    }
  };

  // ── Bulk assign modal ─────────────────────────────────────────────────────
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkMaster, setBulkMaster]         = useState('');
  const [bulkItems, setBulkItems]           = useState([]);
  const [bulkItemsLoading, setBulkItemsLoading] = useState(false);
  const [bulkSelected, setBulkSelected]     = useState({}); // { itemId: { checked, qty, barcode, name } }
  const [bulkSaving, setBulkSaving]         = useState(false);

  // ── Shared catalog masters list ───────────────────────────────────────────
  const [catalogMasters, setCatalogMasters] = useState([]);

  // ─────────────────────────────────────────────────────────────────────────


  // Load all zones
  const loadLocations = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const r = await imsFetch('/api/ims/locations');
      const d = await r.json();
      if (d.success) setLocations(d.locations);
    } finally { setLoading(false); }
  }, [activeWorkspaceId, imsFetch]);

  useEffect(() => { loadLocations(); }, [loadLocations]);

  // Load master catalogs (used by both modals)
  const loadMasters = useCallback(async () => {
    try {
      const r = await imsFetch('/api/ims/masters');
      const d = await r.json();
      if (d.success) setCatalogMasters(d.masters || []);
    } catch (e) { console.error('Failed to load masters', e); }
  }, [imsFetch]);

  // Load items for a master into given setter
  const loadMasterItems = async (masterId, itemSetter, loadingSetter) => {
    if (!masterId) { itemSetter([]); return; }
    if (loadingSetter) loadingSetter(true);
    try {
      const r = await imsFetch(`/api/ims/masters/${masterId}/items`);
      const d = await r.json();
      itemSetter(d.items || []);
    } catch (e) { itemSetter([]); }
    finally { if (loadingSetter) loadingSetter(false); }
  };

  // Select a zone and load its stock
  const selectZone = async (loc) => {
    setSelected(loc);
    const r = await imsFetch(`/api/ims/locations/${loc.id}/stock`);
    const d = await r.json();
    if (d.success) setZoneStock(d.stock);
  };

  // Refresh zone detail after transfer/assign
  const refreshZone = async (loc) => {
    if (!loc) {
      loadLocations();
      return;
    }
    try {
      const rLocs = await imsFetch('/api/ims/locations');
      const dLocs = await rLocs.json();
      if (dLocs.success) {
        setLocations(dLocs.locations);
        const updated = dLocs.locations.find(l => l.id === loc.id);
        if (updated) setSelected(updated);
      }
      const rStock = await imsFetch(`/api/ims/locations/${loc.id}/stock`);
      const dStock = await rStock.json();
      if (dStock.success) setZoneStock(dStock.stock);
    } catch (e) {
      console.error('Failed to refresh zone:', e);
      loadLocations();
    }
  };

  // ── Create zone ────────────────────────────────────────────────────────────
  const createLocation = async () => {
    if (!form.name) return;
    const r = await imsFetch('/api/ims/locations', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.success) {
      setLocations(prev => [...prev, { ...d.location, sku_count: 0, total_qty: 0 }]);
      setShowCreate(false);
      setForm({ name: '', type: 'WAREHOUSE', description: '' });
      showToast('Zone created', 'success');
    } else {
      showToast(d.error || 'Failed to create zone', 'error');
    }
  };

  // ── Delete zone ────────────────────────────────────────────────────────────
  const deleteLocation = async (e, loc) => {
    e.stopPropagation(); // Prevent card selection
    const ok = await confirm({
      title: `Delete zone "${loc.name}"?`,
      message: 'This will permanently remove the zone and all its stock assignments.',
      type: 'danger',
      confirmLabel: 'Delete Zone'
    });
    if (!ok) return;
    const r = await imsFetch(`/api/ims/locations/${loc.id}`, { method: 'DELETE' });
    const d = await r.json();
    if (d.success !== false) {
      setLocations(prev => prev.filter(l => l.id !== loc.id));
      if (selected?.id === loc.id) { setSelected(null); setZoneStock([]); }
      showToast('Zone deleted', 'info');
    } else {
      showToast(d.error || 'Failed to delete zone', 'error');
    }
  };

  // ── Open transfer modal ────────────────────────────────────────────────────
  const openTransfer = (fromId = '', toId = '') => {
    setSourceStock([]);
    setSourceStockLoading(false);
    setMaxAvailableQty(null);
    setTransfer({ barcode: '', itemName: '', fromLocationId: fromId, toLocationId: toId, qty: '' });
    setShowTransfer(true);
    if (fromId) {
      loadSourceStock(fromId);
    }
  };

  // ── Execute transfer ───────────────────────────────────────────────────────
  const doTransfer = async () => {
    if (!transfer.fromLocationId || !transfer.barcode || !transfer.toLocationId || !transfer.qty || Number(transfer.qty) <= 0) return;
    if (maxAvailableQty !== null && Number(transfer.qty) > maxAvailableQty) {
      showToast(`Transfer quantity cannot exceed available quantity (${maxAvailableQty})`, 'error');
      return;
    }
    const r = await imsFetch('/api/ims/locations/transfer', {
      method: 'POST',
      body: JSON.stringify(transfer)
    });
    const d = await r.json();
    if (d.success) {
      showToast('Stock transferred successfully', 'success');

      setShowTransfer(false);
      setSourceStock([]);
      setMaxAvailableQty(null);
      setTransfer({ barcode: '', itemName: '', fromLocationId: '', toLocationId: '', qty: '' });
      refreshZone(selected);
    } else {
      showToast('Transfer failed: ' + (d.error || 'Unknown error'), 'error');
    }
  };

  // ── Open bulk assign modal ─────────────────────────────────────────────────
  const openBulkAssign = () => {
    loadMasters();
    setBulkMaster('');
    setBulkItems([]);
    setBulkSelected({});
    setShowBulkAssign(true);
  };

  // ── Execute bulk assign ────────────────────────────────────────────────────
  const doBulkAssign = async () => {
    const toAssign = Object.values(bulkSelected).filter(v => v.checked && Number(v.qty) > 0);
    if (toAssign.length === 0) { showToast('Select at least one item with a quantity', 'error'); return; }
    setBulkSaving(true);
    let successCount = 0;
    for (const item of toAssign) {
      try {
        const r = await imsFetch('/api/ims/locations/transfer', {
          method: 'POST',
          body: JSON.stringify({
            barcode: item.barcode,
            itemName: item.name,
            fromLocationId: '',
            toLocationId: String(selected.id),
            qty: Number(item.qty)
          })
        });
        const d = await r.json();
        if (d.success) successCount++;
      } catch (e) { /* continue with next item */ }
    }
    setBulkSaving(false);
    setShowBulkAssign(false);
    showToast(`${successCount} of ${toAssign.length} item(s) assigned to ${selected.name}`, 'success');
    refreshZone(selected);
  };

  const filtered = locations.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.type.toLowerCase().includes(search.toLowerCase())
  );

  const selectedCount = Object.values(bulkSelected).filter(v => v.checked).length;

  const hasInvalidBulkQty = Object.entries(bulkSelected).some(([id, value]) => {
    if (!value.checked) return false;
    const item = bulkItems.find(i => String(i.id) === String(id));
    if (!item) return false;
    return item.stock !== null && item.stock !== undefined && Number(value.qty) > Number(item.stock);
  });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="ims-locations-page">



      {/* Header */}
      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Location &amp; Zone Tracking</h1>
          <p>Manage physical storage zones and track which items are in each area</p>
        </div>
        <div className="ims-header-right ims-flex-gap-10">
          <button className="btn btn-secondary" onClick={loadLocations}><FaSync /> Refresh</button>
          {!isReadOnly && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <FaPlus /> Add Zone
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="ims-loc-kpi-container">
        {[
          { label: 'Total Zones',  value: locations.length,                                              color: '#3498db' },
          { label: 'Total SKUs',   value: locations.reduce((a, l) => a + (l.sku_count || 0), 0),         color: '#27ae60' },
          { label: 'Total Units',  value: locations.reduce((a, l) => a + (l.total_qty || 0), 0),         color: '#e67e22' },
        ].map((k, i) => (
          <div key={i} className="ims-loc-kpi-card" style={{ borderLeftColor: k.color }}>
            <div className="ims-loc-kpi-value" style={{ color: k.color }}>{k.value}</div>
            <div className="ims-loc-kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Main Layout */}
      <div className="grn-layout">

        {/* ── Left: Zone List ── */}
        <div className="grn-list-panel">
          <div className="search-input ims-search-wrapper">
            <FaSearch className="search-icon" />
            <input
              type="text" placeholder="Search zones..."
              value={search} onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="ims-loading-placeholder">
              <FaSpinner /> Loading...
            </div>
          ) : (
            <div className="grn-cards">
              {filtered.length === 0 && (
                <div className="ims-empty-placeholder">
                  <FaWarehouse className="ims-empty-icon" /><br />
                  No zones yet. Add your first zone.
                </div>
              )}

              {filtered.map(loc => {
                const color = ZONE_COLORS[loc.type] || '#3498db';
                return (
                  <div
                    key={loc.id}
                    className={`grn-card ${selected?.id === loc.id ? 'active' : ''}`}
                    onClick={() => selectZone(loc)}
                    style={{ borderLeftColor: color }}
                  >
                    {/* Card top row */}
                    <div className="grn-card-top">
                      <div className="grn-id" style={{ color }}>
                        <FaMapMarkerAlt /> {loc.name}
                      </div>
                      <span className="ims-zone-badge" style={{ background: color + '22', color }}>
                        {loc.type}
                      </span>
                    </div>

                    {loc.description && (
                      <div className="ims-item-meta-row">
                        {loc.description}
                      </div>
                    )}

                    {/* Stock counts */}
                    <div className="grn-meta ims-margin-top-8">
                      <span><FaBoxes /> {loc.sku_count || 0} SKUs</span>
                      <span>{loc.total_qty || 0} units</span>
                    </div>

                    {/* Per-card delete button — inline, not absolute */}
                    {!isReadOnly && (
                      <div className="ims-margin-top-10-flex-end">
                        <button
                          title="Delete zone"
                          onClick={e => deleteLocation(e, loc)}
                          className="ims-btn-delete-zone"
                        >
                          <FaTrash style={{ fontSize: 11 }} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right: Zone Detail ── */}
        <div className="grn-detail-panel">
          {selected ? (
            <>
              <div className="grn-detail-header">
                <div>
                  <h2>
                    <FaMapMarkerAlt style={{ color: ZONE_COLORS[selected.type] }} /> {selected.name}
                  </h2>
                  <div className="ims-text-muted-sm">
                    {selected.type} Zone
                    {selected.description && ` · ${selected.description}`}
                  </div>
                </div>
                <div className="ims-zone-detail-stats">
                  <div className="ims-zone-stat-item">
                    <div className="ims-zone-stat-val sku">{selected.sku_count || 0}</div>
                    <div className="ims-zone-stat-lbl">SKUs</div>
                  </div>
                  <div className="ims-zone-stat-item">
                    <div className="ims-zone-stat-val qty">{selected.total_qty || 0}</div>
                    <div className="ims-zone-stat-lbl">Units</div>
                  </div>
                </div>
              </div>

              <h3 className="ims-section-title">Stock in this Zone</h3>

              <div className="table-container ims-table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Barcode</th>
                      <th>Item Name</th>
                      <th>Category</th>
                      <th>Qty in Zone</th>
                      <th>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zoneStock.length === 0 && (
                      <tr>
                        <td colSpan={5} className="ims-empty-table-cell-large">
                          No stock assigned yet. Use <strong>Assign Items</strong> to add items from your catalog.
                        </td>
                      </tr>
                    )}
                    {zoneStock.map((s, i) => (
                      <tr key={i}>
                        <td><code>{s.barcode}</code></td>
                        <td><strong>{s.item_name}</strong></td>
                        <td>{s.category || '—'}</td>
                        <td className="ims-table-qty">{s.qty}</td>
                        <td className="ims-text-muted-sm">{s.updated_at?.split('T')[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action buttons */}
              {!isReadOnly ? (
                <div className="ims-margin-top-16-flex-wrap">
                  <button className="btn btn-primary" onClick={openBulkAssign}>
                    <FaLayerGroup /> Assign Items to Zone
                  </button>
                  <button
                    className="btn btn-secondary btn-purple-outline"
                    onClick={() => openTransfer('', String(selected.id))}
                  >
                    <FaExchangeAlt /> Transfer Stock In
                  </button>
                  <button
                    className="btn btn-secondary btn-purple-outline"
                    onClick={() => openTransfer(String(selected.id), '')}
                  >
                    <FaExchangeAlt /> Transfer Stock Out
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 24, padding: '12px', background: '#fef2f2', color: '#e74c3c', borderRadius: 8, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>
                  You have view-only access. You cannot assign or transfer items.
                </div>
              )}
            </>
          ) : (
            <div className="ims-empty-detail">
              <FaWarehouse style={{ fontSize: 48 }} />
              <h3>Select a Zone</h3>
              <p className="ims-empty-detail-desc">Click a zone to view its current stock and manage transfers.</p>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
           CREATE ZONE MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      {showCreate && (
        <div className="ims-modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="ims-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Add Storage Zone</h2>
                <p>Define a physical area in your facility</p>
              </div>
              <button className="modal-close" onClick={() => setShowCreate(false)}><FaTimes /></button>
            </div>
            <div className="modal-body ims-modal-body-no-padding">
              <div className="form-group">
                <label className="form-label">Zone Name *</label>
                <input
                  className="form-input"
                  placeholder="e.g. Warehouse A"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="modal-row">
                <div className="form-group">
                  <label className="form-label">Zone Type</label>
                  <select
                    className="form-select"
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  >
                    {ZONE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group ims-flex-2">
                  <label className="form-label">Description</label>
                  <input
                    className="form-input"
                    placeholder="Optional notes about this zone"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createLocation} disabled={!form.name}>
                <FaSave /> Create Zone
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
           TRANSFER STOCK MODAL  (optimized flow)
      ══════════════════════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════════
           TRANSFER STOCK MODAL  (optimized flow)
      ══════════════════════════════════════════════════════════════════════ */}
      {showTransfer && (() => {
        const fromZoneName = locations.find(l => String(l.id) === String(transfer.fromLocationId))?.name || 'Select source zone';
        const toZoneName = locations.find(l => String(l.id) === String(transfer.toLocationId))?.name || 'Select destination';
        const isQtyInvalid = transfer.fromLocationId && maxAvailableQty !== null && Number(transfer.qty) > maxAvailableQty;
        const isTransferDisabled = !transfer.fromLocationId || !transfer.barcode || !transfer.toLocationId || !transfer.qty || Number(transfer.qty) <= 0 || isQtyInvalid;

        const isSourceLocked = !!transfer.fromLocationId && transfer.fromLocationId === String(selected?.id);
        const isDestLocked = !!transfer.toLocationId && transfer.toLocationId === String(selected?.id);

        return (
          <div className="ims-modal-overlay" onClick={() => setShowTransfer(false)}>
            <div className="ims-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2>Transfer Stock Between Zones</h2>
                  <p>Establish a transfer route, select an item, and set quantity</p>
                </div>
                <button className="modal-close" onClick={() => setShowTransfer(false)}><FaTimes /></button>
              </div>
              <div className="modal-body ims-modal-body-no-padding">

                {/* Step 1 — Set Route */}
                <div className="ims-step-title">
                  Step 1 — Set Transfer Route
                </div>
                <div className="modal-row">
                  {isSourceLocked ? (
                    <div className="form-group">
                      <label className="form-label">From Zone (Source) *</label>
                      <div className="form-input ims-locked-input" style={{ background: '#f1f5f9', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, height: 38 }}>
                        <FaMapMarkerAlt /> {fromZoneName} (Current)
                      </div>
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="form-label">From Zone (Source) *</label>
                      <select
                        className="form-select"
                        value={transfer.fromLocationId}
                        onChange={e => handleFromZoneChange(e.target.value)}
                      >
                        <option value="">— Select source zone —</option>
                        {locations
                          .filter(l => String(l.id) !== String(transfer.toLocationId))
                          .map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
                      </select>
                    </div>
                  )}

                  {isDestLocked ? (
                    <div className="form-group">
                      <label className="form-label">To Zone (Destination) *</label>
                      <div className="form-input ims-locked-input" style={{ background: '#f1f5f9', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, height: 38 }}>
                        <FaMapMarkerAlt /> {toZoneName} (Current)
                      </div>
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="form-label">To Zone (Destination) *</label>
                      <select
                        className="form-select"
                        value={transfer.toLocationId}
                        onChange={e => setTransfer(t => ({ ...t, toLocationId: e.target.value }))}
                      >
                        <option value="">— Select destination —</option>
                        {locations
                          .filter(l => String(l.id) !== String(transfer.fromLocationId))
                          .map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {/* Route Visualizer */}
                <div className="ims-route-visualizer">
                  <div className="ims-route-node source">
                    <div className="ims-route-node-label">Source Zone</div>
                    <div className="ims-route-node-val">{fromZoneName}</div>
                  </div>
                  <div className="ims-route-connector">
                    <FaExchangeAlt />
                  </div>
                  <div className="ims-route-node dest">
                    <div className="ims-route-node-label">Destination Zone</div>
                    <div className="ims-route-node-val">{toZoneName}</div>
                  </div>
                </div>

                {/* Step 2 — Pick Item & Qty */}
                <div className="ims-step-title-small-margin">
                  Step 2 — Select Item &amp; Quantity
                </div>

                {transfer.fromLocationId ? (
                  sourceStockLoading ? (
                    <div className="ims-loading-box-modal" style={{ padding: '15px 0' }}>
                      <FaSpinner className="ims-spinner-small" /> Loading stock items...
                    </div>
                  ) : sourceStock.length === 0 ? (
                    <div style={{ color: '#e74c3c', background: '#fdf2f2', padding: '12px 16px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                      No items with stock available in <strong>{fromZoneName}</strong>. Please select a different source zone.
                    </div>
                  ) : (
                    <>
                      <div className="modal-row">
                        <div className="form-group ims-flex-2">
                          <label className="form-label">Item from Source Stock *</label>
                          <select
                            className="form-select"
                            value={transfer.barcode}
                            onChange={e => handleSourceStockItemChange(e.target.value)}
                          >
                            <option value="">— Select item from source stock —</option>
                            {sourceStock.map(s => (
                              <option key={s.barcode} value={s.barcode}>
                                {s.item_name} ({s.barcode}) — Qty: {s.qty}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group ims-width-110">
                          <label className="form-label">Qty *</label>
                          <input
                            className="form-input"
                            type="number" min="1"
                            placeholder="0"
                            value={transfer.qty}
                            onChange={e => setTransfer(t => ({ ...t, qty: e.target.value }))}
                          />
                        </div>
                      </div>

                      {transfer.barcode && (
                        <div className="ims-confirm-box-green" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div>
                            <FaCheck style={{ marginRight: 6 }} />
                            <strong>{transfer.itemName}</strong>&nbsp;·&nbsp;<code>{transfer.barcode}</code>
                          </div>
                          <div style={{ fontWeight: 600 }}>
                            Available in zone: {maxAvailableQty} units
                          </div>
                        </div>
                      )}

                      {isQtyInvalid && (
                        <div className="ims-validation-warning" style={{ color: '#e74c3c', fontSize: 13, fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>⚠️ Warning:</span>
                          Quantity exceeds available stock of {maxAvailableQty} units in source zone.
                        </div>
                      )}
                    </>
                  )
                ) : (
                  <div style={{ color: '#888', background: '#f8f9fa', padding: '16px', borderRadius: 8, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>
                    Please select a source zone in Step 1 to load its available stock items.
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowTransfer(false)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={doTransfer}
                  disabled={isTransferDisabled}
                >
                  <FaExchangeAlt /> Transfer
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════════
           BULK ASSIGN MODAL  (multi-select items → zone)
      ══════════════════════════════════════════════════════════════════════ */}
      {showBulkAssign && (
        <div className="ims-modal-overlay" onClick={() => setShowBulkAssign(false)}>
          <div className="ims-modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2><FaLayerGroup style={{ marginRight: 8 }} />Assign Items to "{selected?.name}"</h2>
                <p>Select multiple items from your catalog and set opening quantities for this zone</p>
              </div>
              <button className="modal-close" onClick={() => setShowBulkAssign(false)}><FaTimes /></button>
            </div>
            <div className="modal-body ims-modal-body-no-padding">

              {/* Master selector */}
              <div className="form-group">
                <label className="form-label">Master Catalog</label>
                <select
                  className="form-select"
                  value={bulkMaster}
                  onChange={e => {
                    setBulkMaster(e.target.value);
                    setBulkSelected({});
                    loadMasterItems(e.target.value, setBulkItems, setBulkItemsLoading);
                  }}
                >
                  <option value="">— Select a catalog to browse items —</option>
                  {catalogMasters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>

              {/* Loading state */}
              {bulkItemsLoading && (
                <div className="ims-loading-box-modal">
                  <FaSpinner /> Loading items...
                </div>
              )}

              {/* Items list */}
              {!bulkItemsLoading && bulkItems.length > 0 && (
                <div className="ims-border-container">
                  {/* Header bar */}
                  <div className="ims-border-header">
                    <span>{bulkItems.length} items available</span>
                    <span className="ims-selected-count-label" style={{ color: selectedCount > 0 ? '#27ae60' : '#aaa' }}>
                      {selectedCount} selected
                    </span>
                  </div>

                  {/* Scrollable item rows */}
                  <div className="ims-scrollable-list">
                    {bulkItems.map(item => {
                      const sel = bulkSelected[item.id] || { checked: false };
                      const isRowQtyInvalid = sel.checked && item.stock !== null && item.stock !== undefined && Number(sel.qty) > Number(item.stock);
                      return (
                        <div
                          key={item.id}
                          className={`ims-list-row ${sel.checked ? 'checked' : ''}`}
                          onClick={() => {
                            setBulkSelected(prev => ({
                              ...prev,
                              [item.id]: {
                                ...sel,
                                checked: !sel.checked,
                                barcode: item.barcode,
                                name: item.name,
                                qty: !sel.checked ? 1 : ''
                              }
                            }));
                          }}
                        >
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={sel.checked}
                            onChange={() => {}} // handled by div onClick
                            className="ims-checkbox"
                          />

                          {/* Item info */}
                          <div className="ims-flex-1-min-width-0">
                            <div className="ims-item-name-header">
                              {item.name}
                            </div>
                            <div className="ims-item-meta-row">
                              <code className="ims-code-gray">
                                {item.barcode}
                              </code>
                              &nbsp;·&nbsp;{item.category || 'General'}
                              &nbsp;·&nbsp;Current stock: <strong>{item.stock ?? '—'}</strong>
                            </div>
                            {isRowQtyInvalid && (
                              <div style={{ color: '#e74c3c', fontSize: 11, marginTop: 4, fontWeight: 500 }}>
                                ⚠️ Cannot exceed catalog stock of {item.stock}
                              </div>
                            )}
                          </div>

                          {/* Qty input — stop propagation so clicking qty doesn't toggle checkbox */}
                          <div
                            className="ims-flex-align-center-gap-6"
                            onClick={e => e.stopPropagation()}
                          >
                            <label className="ims-qty-label">Qty:</label>
                            <input
                              type="number"
                              min="1"
                              placeholder="0"
                              max={item.stock !== null && item.stock !== undefined ? item.stock : undefined}
                              value={sel.qty !== undefined && sel.qty !== null ? sel.qty : ''}
                              onChange={e => {
                                const val = e.target.value;
                                setBulkSelected(prev => ({
                                  ...prev,
                                  [item.id]: {
                                    ...sel,
                                    checked: true,
                                    barcode: item.barcode,
                                    name: item.name,
                                    qty: val === '' ? '' : Number(val)
                                  }
                                }));
                              }}
                              className={`ims-qty-input-small ${isRowQtyInvalid ? 'ims-input-error' : ''}`}
                              disabled={!sel.checked}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!bulkItemsLoading && !bulkMaster && (
                <div className="ims-empty-modal-state">
                  <FaBoxes className="ims-empty-modal-icon" />
                  Select a master catalog above to see its items
                </div>
              )}

              {!bulkItemsLoading && bulkMaster && bulkItems.length === 0 && (
                <div className="ims-empty-modal-state">
                  No items found in this catalog
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBulkAssign(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={doBulkAssign}
                disabled={bulkSaving || selectedCount === 0 || hasInvalidBulkQty}
              >
                {bulkSaving ? <FaSpinner /> : <FaCheck />}
                &nbsp;{bulkSaving ? 'Assigning...' : `Assign ${selectedCount} Item${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
