import React, { useState, useEffect, useCallback } from 'react';
import {
  FaWarehouse, FaPlus, FaSearch, FaExchangeAlt, FaTimes,
  FaSave, FaTrash, FaBoxes, FaMapMarkerAlt, FaSync, FaSpinner,
  FaLayerGroup, FaCheck
} from 'react-icons/fa';
import './IMSLocations.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useConfirm } from '../components/ConfirmModal';

const ZONE_TYPES = ['WAREHOUSE', 'RND', 'MANUFACTURING', 'ASSEMBLY', 'QC', 'SHIPPING'];
const ZONE_COLORS = {
  WAREHOUSE: '#3498db', RND: '#9b59b6', MANUFACTURING: '#e67e22',
  ASSEMBLY: '#e74c3c', QC: '#27ae60', SHIPPING: '#1abc9c'
};

export default function IMSLocations() {
  const { imsFetch, activeWorkspaceId } = useWorkspace();
  const confirm = useConfirm();

  // ── Core state ────────────────────────────────────────────────────────────
  const [locations, setLocations]   = useState([]);
  const [selected, setSelected]     = useState(null);
  const [zoneStock, setZoneStock]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [toast, setToast]           = useState('');

  // ── Create zone modal ─────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState({ name: '', type: 'WAREHOUSE', description: '' });

  // ── Transfer modal ────────────────────────────────────────────────────────
  const [showTransfer, setShowTransfer]   = useState(false);
  const [transfer, setTransfer]           = useState({ barcode: '', itemName: '', fromLocationId: '', toLocationId: '', qty: '' });
  const [txMaster, setTxMaster]           = useState('');
  const [txItems, setTxItems]             = useState([]);
  const [txItemsLoading, setTxItemsLoading] = useState(false);

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

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

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
    loadLocations();
    if (loc) {
      const r = await imsFetch(`/api/ims/locations/${loc.id}/stock`);
      const d = await r.json();
      if (d.success) setZoneStock(d.stock);
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
      showToast('✅ Zone created');
    } else {
      showToast('❌ ' + (d.error || 'Failed to create zone'));
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
      showToast('🗑️ Zone deleted');
    } else {
      showToast('❌ ' + (d.error || 'Failed to delete zone'));
    }
  };

  // ── Open transfer modal ────────────────────────────────────────────────────
  const openTransfer = (toLocationId = '') => {
    loadMasters();
    setTxMaster('');
    setTxItems([]);
    setTransfer({ barcode: '', itemName: '', fromLocationId: '', toLocationId: toLocationId, qty: '' });
    setShowTransfer(true);
  };

  // ── Execute transfer ───────────────────────────────────────────────────────
  const doTransfer = async () => {
    if (!transfer.barcode || !transfer.toLocationId || !transfer.qty) return;
    const r = await imsFetch('/api/ims/locations/transfer', {
      method: 'POST',
      body: JSON.stringify(transfer)
    });
    const d = await r.json();
    if (d.success) {
      showToast('✅ Stock transferred successfully');
      setShowTransfer(false);
      setTxMaster('');
      setTxItems([]);
      setTransfer({ barcode: '', itemName: '', fromLocationId: '', toLocationId: '', qty: '' });
      refreshZone(selected);
    } else {
      showToast('❌ Transfer failed: ' + (d.error || 'Unknown error'));
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
    if (toAssign.length === 0) { showToast('⚠️ Select at least one item with a quantity'); return; }
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
    showToast(`✅ ${successCount} of ${toAssign.length} item(s) assigned to ${selected.name}`);
    refreshZone(selected);
  };

  const filtered = locations.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.type.toLowerCase().includes(search.toLowerCase())
  );

  const selectedCount = Object.values(bulkSelected).filter(v => v.checked).length;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="ims-locations-page">

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: '#2c3e50', color: '#fff',
          padding: '12px 20px', borderRadius: 10, fontSize: 14,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Location &amp; Zone Tracking</h1>
          <p>Manage physical storage zones and track which items are in each area</p>
        </div>
        <div className="ims-header-right" style={{ gap: 10, display: 'flex' }}>
          <button className="btn btn-secondary" onClick={loadLocations}><FaSync /> Refresh</button>
          <button
            className="btn btn-secondary"
            style={{ borderColor: '#9b59b6', color: '#9b59b6' }}
            onClick={() => openTransfer('')}
          >
            <FaExchangeAlt /> Transfer Stock
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <FaPlus /> Add Zone
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Total Zones',  value: locations.length,                                              color: '#3498db' },
          { label: 'Total SKUs',   value: locations.reduce((a, l) => a + (l.sku_count || 0), 0),         color: '#27ae60' },
          { label: 'Total Units',  value: locations.reduce((a, l) => a + (l.total_qty || 0), 0),         color: '#e67e22' },
        ].map((k, i) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 10, padding: '14px 20px',
            borderLeft: `4px solid ${k.color}`, display: 'flex', gap: 12,
            alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', flex: 1
          }}>
            <div style={{ fontSize: 22, color: k.color, fontWeight: 700 }}>{k.value}</div>
            <div style={{ fontSize: 13, color: '#888' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Main Layout */}
      <div className="grn-layout">

        {/* ── Left: Zone List ── */}
        <div className="grn-list-panel">
          <div className="search-input" style={{ marginBottom: 12 }}>
            <FaSearch className="search-icon" />
            <input
              type="text" placeholder="Search zones..."
              value={search} onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: '#aaa' }}>
              <FaSpinner /> Loading...
            </div>
          ) : (
            <div className="grn-cards">
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: '#aaa' }}>
                  <FaWarehouse style={{ fontSize: 32 }} /><br />
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
                    style={{ borderLeftColor: color, cursor: 'pointer' }}
                  >
                    {/* Card top row */}
                    <div className="grn-card-top">
                      <div className="grn-id" style={{ color }}>
                        <FaMapMarkerAlt /> {loc.name}
                      </div>
                      <span style={{
                        background: color + '22', color,
                        padding: '3px 10px', borderRadius: 10,
                        fontSize: 12, fontWeight: 600
                      }}>
                        {loc.type}
                      </span>
                    </div>

                    {loc.description && (
                      <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
                        {loc.description}
                      </div>
                    )}

                    {/* Stock counts */}
                    <div className="grn-meta" style={{ marginTop: 8 }}>
                      <span><FaBoxes /> {loc.sku_count || 0} SKUs</span>
                      <span>{loc.total_qty || 0} units</span>
                    </div>

                    {/* Per-card delete button — inline, not absolute */}
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        title="Delete zone"
                        onClick={e => deleteLocation(e, loc)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          background: 'none', border: '1px solid #f5c6c6',
                          color: '#e74c3c', borderRadius: 6, padding: '4px 10px',
                          fontSize: 12, cursor: 'pointer', transition: 'all 0.15s'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#fff0f0'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                      >
                        <FaTrash style={{ fontSize: 11 }} /> Delete
                      </button>
                    </div>
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
                  <div style={{ color: '#888', fontSize: 14 }}>
                    {selected.type} Zone
                    {selected.description && ` · ${selected.description}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 22, color: '#3498db' }}>{selected.sku_count || 0}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>SKUs</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 22, color: '#27ae60' }}>{selected.total_qty || 0}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>Units</div>
                  </div>
                </div>
              </div>

              <h3 style={{ fontSize: 15, marginBottom: 12, marginTop: 16 }}>Stock in this Zone</h3>

              <div className="table-container" style={{ boxShadow: 'none', border: '1px solid #eee' }}>
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
                        <td colSpan={5} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>
                          No stock assigned yet. Use <strong>Assign Items</strong> to add items from your catalog.
                        </td>
                      </tr>
                    )}
                    {zoneStock.map((s, i) => (
                      <tr key={i}>
                        <td><code>{s.barcode}</code></td>
                        <td><strong>{s.item_name}</strong></td>
                        <td>{s.category || '—'}</td>
                        <td style={{ fontWeight: 700, color: '#27ae60' }}>{s.qty}</td>
                        <td style={{ fontSize: 12, color: '#888' }}>{s.updated_at?.split('T')[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action buttons */}
              <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={openBulkAssign}>
                  <FaLayerGroup /> Assign Items to Zone
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ borderColor: '#9b59b6', color: '#9b59b6' }}
                  onClick={() => openTransfer(String(selected.id))}
                >
                  <FaExchangeAlt /> Transfer Stock Here
                </button>
              </div>
            </>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              height: '100%', color: '#aaa', gap: 12
            }}>
              <FaWarehouse style={{ fontSize: 48 }} />
              <h3>Select a Zone</h3>
              <p style={{ fontSize: 14 }}>Click a zone to view its current stock and manage transfers.</p>
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
            <div className="modal-body">
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
                <div className="form-group" style={{ flex: 2 }}>
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
          TRANSFER STOCK MODAL  (catalog item picker)
      ══════════════════════════════════════════════════════════════════════ */}
      {showTransfer && (
        <div className="ims-modal-overlay" onClick={() => setShowTransfer(false)}>
          <div className="ims-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Transfer Stock Between Zones</h2>
                <p>Pick an item from your catalog, then choose source and destination zones</p>
              </div>
              <button className="modal-close" onClick={() => setShowTransfer(false)}><FaTimes /></button>
            </div>
            <div className="modal-body">

              {/* Step 1 — Pick item from catalog */}
              <div style={{
                background: '#f8f9fa', borderRadius: 8, padding: '14px 16px',
                marginBottom: 18, border: '1px solid #e9ecef'
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#555', marginBottom: 12 }}>
                  Step 1 — Pick Item from Catalog
                </div>
                <div className="modal-row">
                  <div className="form-group">
                    <label className="form-label">Master Catalog</label>
                    <select
                      className="form-select"
                      value={txMaster}
                      onChange={e => {
                        setTxMaster(e.target.value);
                        setTransfer(t => ({ ...t, barcode: '', itemName: '' }));
                        loadMasterItems(e.target.value, setTxItems, setTxItemsLoading);
                      }}
                    >
                      <option value="">— Select catalog —</option>
                      {catalogMasters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">
                      Item {txItemsLoading && <FaSpinner style={{ fontSize: 11, marginLeft: 4 }} />}
                    </label>
                    <select
                      className="form-select"
                      value={transfer.barcode}
                      disabled={!txMaster || txItems.length === 0}
                      onChange={e => {
                        const item = txItems.find(i => i.barcode === e.target.value);
                        setTransfer(t => ({ ...t, barcode: e.target.value, itemName: item?.name || '' }));
                      }}
                    >
                      <option value="">— Select item —</option>
                      {txItems.map(i => (
                        <option key={i.id} value={i.barcode}>
                          {i.name}  ({i.barcode})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Confirmation row */}
                {transfer.barcode && (
                  <div style={{
                    background: '#e8f5e9', border: '1px solid #c8e6c9',
                    borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#2e7d32'
                  }}>
                    <FaCheck style={{ marginRight: 6 }} />
                    <strong>{transfer.itemName}</strong>
                    &nbsp;·&nbsp;<code style={{ background: '#c8e6c9', padding: '1px 6px', borderRadius: 4 }}>{transfer.barcode}</code>
                  </div>
                )}
              </div>

              {/* Step 2 — From / To / Qty */}
              <div style={{ fontWeight: 600, fontSize: 13, color: '#555', marginBottom: 10 }}>
                Step 2 — Set Transfer Details
              </div>
              <div className="modal-row">
                <div className="form-group">
                  <label className="form-label">From Zone <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
                  <select
                    className="form-select"
                    value={transfer.fromLocationId}
                    onChange={e => setTransfer(t => ({ ...t, fromLocationId: e.target.value }))}
                  >
                    <option value="">— No source zone —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">To Zone *</label>
                  <select
                    className="form-select"
                    value={transfer.toLocationId}
                    onChange={e => setTransfer(t => ({ ...t, toLocationId: e.target.value }))}
                  >
                    <option value="">— Select destination —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ width: 110 }}>
                  <label className="form-label">Qty *</label>
                  <input
                    className="form-input"
                    type="number" min="1"
                    placeholder="1"
                    value={transfer.qty}
                    onChange={e => setTransfer(t => ({ ...t, qty: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowTransfer(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={doTransfer}
                disabled={!transfer.barcode || !transfer.toLocationId || !transfer.qty}
              >
                <FaExchangeAlt /> Transfer
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="modal-body">

              {/* Master selector */}
              <div className="form-group" style={{ marginBottom: 16 }}>
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
                <div style={{ textAlign: 'center', padding: 24, color: '#aaa' }}>
                  <FaSpinner /> Loading items...
                </div>
              )}

              {/* Items list */}
              {!bulkItemsLoading && bulkItems.length > 0 && (
                <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
                  {/* Header bar */}
                  <div style={{
                    background: '#f8f9fa', padding: '8px 16px',
                    borderBottom: '1px solid #eee',
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 13, color: '#555'
                  }}>
                    <span>{bulkItems.length} items available</span>
                    <span style={{ color: selectedCount > 0 ? '#27ae60' : '#aaa', fontWeight: 600 }}>
                      {selectedCount} selected
                    </span>
                  </div>

                  {/* Scrollable item rows */}
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {bulkItems.map(item => {
                      const sel = bulkSelected[item.id] || { checked: false, qty: 1 };
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 16px', borderBottom: '1px solid #f5f5f5',
                            background: sel.checked ? '#f0fff4' : '#fff',
                            transition: 'background 0.15s',
                            cursor: 'pointer'
                          }}
                          onClick={() => {
                            setBulkSelected(prev => ({
                              ...prev,
                              [item.id]: {
                                ...sel,
                                checked: !sel.checked,
                                barcode: item.barcode,
                                name: item.name,
                                qty: sel.qty || 1
                              }
                            }));
                          }}
                        >
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={sel.checked}
                            onChange={() => {}} // handled by div onClick
                            style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                          />

                          {/* Item info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#2c3e50' }}>
                              {item.name}
                            </div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                              <code style={{ background: '#f0f0f0', padding: '1px 5px', borderRadius: 3 }}>
                                {item.barcode}
                              </code>
                              &nbsp;·&nbsp;{item.category || 'General'}
                              &nbsp;·&nbsp;Current stock: <strong>{item.stock ?? '—'}</strong>
                            </div>
                          </div>

                          {/* Qty input — stop propagation so clicking qty doesn't toggle checkbox */}
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            onClick={e => e.stopPropagation()}
                          >
                            <label style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>Qty:</label>
                            <input
                              type="number"
                              min="1"
                              value={sel.qty || 1}
                              onChange={e => {
                                setBulkSelected(prev => ({
                                  ...prev,
                                  [item.id]: {
                                    ...sel,
                                    checked: true,
                                    barcode: item.barcode,
                                    name: item.name,
                                    qty: Number(e.target.value) || 1
                                  }
                                }));
                              }}
                              style={{
                                width: 72, padding: '5px 8px',
                                border: '1px solid #ddd', borderRadius: 6,
                                fontSize: 13, textAlign: 'center'
                              }}
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
                <div style={{ textAlign: 'center', padding: 32, color: '#aaa', fontSize: 14 }}>
                  <FaBoxes style={{ fontSize: 32, marginBottom: 8, display: 'block', margin: '0 auto 8px' }} />
                  Select a master catalog above to see its items
                </div>
              )}

              {!bulkItemsLoading && bulkMaster && bulkItems.length === 0 && (
                <div style={{ textAlign: 'center', padding: 32, color: '#aaa', fontSize: 14 }}>
                  No items found in this catalog
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBulkAssign(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={doBulkAssign}
                disabled={bulkSaving || selectedCount === 0}
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
