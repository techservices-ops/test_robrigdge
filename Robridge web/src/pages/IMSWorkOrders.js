import React, { useState, useEffect, useCallback } from 'react';
import {
  FaClipboardList, FaPlus, FaSearch, FaCheckCircle,
  FaClock, FaLayerGroup,
  FaBoxes, FaArrowRight, FaTimes, FaSave,
  FaSpinner, FaTrash, FaSync
} from 'react-icons/fa';
import './IMSWorkOrders.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useConfirm } from '../components/ConfirmModal';

const statusConfig = {
  PENDING:     { label: 'Pending',       color: '#7f8c8d', bg: '#ecf0f1', icon: FaClock },
  IN_PROGRESS: { label: 'In Progress',   color: '#e67e22', bg: '#fef9e7', icon: FaSpinner },
  QC:          { label: 'Quality Check', color: '#3498db', bg: '#eaf4fb', icon: FaCheckCircle },
  COMPLETE:    { label: 'Complete',      color: '#27ae60', bg: '#eafaf1', icon: FaCheckCircle },
  CANCELLED:   { label: 'Cancelled',     color: '#e74c3c', bg: '#fdf0ed', icon: FaTimes },
};

const NEXT_STATUS = { PENDING: 'IN_PROGRESS', IN_PROGRESS: 'QC', QC: 'COMPLETE' };
const NEXT_LABEL  = { PENDING: 'Start Production', IN_PROGRESS: 'Move to QC', QC: 'Mark Complete ✓' };

export default function IMSWorkOrders() {
  const { imsFetch, activeWorkspaceId } = useWorkspace();
  const { socket } = useWebSocket();
  const confirm = useConfirm();
  const [workorders, setWorkorders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [newWO, setNewWO] = useState({ productBarcode: '', productName: '', targetQty: '', dueDate: '', priority: 'NORMAL', notes: '' });

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const loadWOs = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const r = await imsFetch('/api/ims/workorders');
      const d = await r.json();
      if (d.success) setWorkorders(d.workorders);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [activeWorkspaceId, imsFetch]);

  useEffect(() => { loadWOs(); }, [loadWOs]);

  useEffect(() => {
    if (!socket) return;
    const handleWOUpdate = (data) => {
      // Update list
      setWorkorders(prev => prev.map(wo => wo.id === data.woId ? { ...wo, built_qty: data.builtQty } : wo));
      
      // Update selected if open
      setSelected(s => {
        if (s && s.id === data.woId) {
          return { ...s, built_qty: data.builtQty };
        }
        return s;
      });

      showToast(`⚙️ WO Updated: ${data.productName} (${data.builtQty}/${data.targetQty} built)`);
    };
    socket.on('workorder_updated', handleWOUpdate);
    return () => socket.off('workorder_updated', handleWOUpdate);
  }, [socket]);

  const selectWO = async (wo) => {
    setSelected(wo);
    const r = await imsFetch(`/api/ims/workorders/${wo.id}`);
    const d = await r.json();
    if (d.success) setMaterials(d.materials);
  };

  const createWO = async () => {
    if (!newWO.productName || !newWO.targetQty) return;
    setSaving(true);
    try {
      const r = await imsFetch('/api/ims/workorders', { method: 'POST', body: JSON.stringify(newWO) });
      const d = await r.json();
      if (d.success) {
        setWorkorders(prev => [d.workorder, ...prev]);
        setShowCreate(false);
        setNewWO({ productBarcode: '', productName: '', targetQty: '', dueDate: '', priority: 'NORMAL', notes: '' });
        showToast('✅ Work Order created');
      }
    } finally { setSaving(false); }
  };

  const changeStatus = async (wo, status) => {
    const r = await imsFetch(`/api/ims/workorders/${wo.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    const d = await r.json();
    if (d.success) {
      setWorkorders(prev => prev.map(w => w.id === wo.id ? { ...w, status } : w));
      setSelected(s => s?.id === wo.id ? { ...s, status } : s);
      showToast(`✅ Status updated to ${statusConfig[status].label}`);
      if (status === 'COMPLETE') showToast('🎉 BOM executed — raw materials deducted from stock!');
    }
  };

  const deleteWO = async (wo) => {
    const ok = await confirm({
      title: `Delete Work Order ${wo.wo_number}?`,
      message: 'This will permanently remove the work order and all its BOM items. This cannot be undone.',
      type: 'danger',
      confirmLabel: 'Delete Work Order'
    });
    if (!ok) return;
    await imsFetch(`/api/ims/workorders/${wo.id}`, { method: 'DELETE' });
    setWorkorders(prev => prev.filter(w => w.id !== wo.id));
    if (selected?.id === wo.id) setSelected(null);
    showToast('🗑️ Work Order deleted');
  };

  const filtered = workorders.filter(w => {
    const ms = w.product_name.toLowerCase().includes(search.toLowerCase()) || w.wo_number.toLowerCase().includes(search.toLowerCase());
    return ms && (filter === 'ALL' || w.status === filter);
  });

  return (
    <div className="ims-wo-page">
      {toast && <div style={{ position: 'fixed', top: 20, right: 20, background: '#2c3e50', color: '#fff', padding: '12px 20px', borderRadius: 10, zIndex: 9999, fontSize: 14 }}>{toast}</div>}

      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Work Orders</h1>
          <p>Create production jobs — BOM materials are auto-deducted from stock when marked Complete</p>
        </div>
        <div className="ims-header-right" style={{ gap: 10, display: 'flex' }}>
          <button className="btn btn-secondary" onClick={loadWOs}><FaSync /> Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><FaPlus /> New Work Order</button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="wo-kpi-strip">
        {[
          { label: 'Total', value: workorders.length, color: '#E3821E', icon: FaClipboardList },
          { label: 'In Progress', value: workorders.filter(w => w.status === 'IN_PROGRESS').length, color: '#e67e22', icon: FaSpinner },
          { label: 'In QC', value: workorders.filter(w => w.status === 'QC').length, color: '#3498db', icon: FaCheckCircle },
          { label: 'Completed', value: workorders.filter(w => w.status === 'COMPLETE').length, color: '#27ae60', icon: FaCheckCircle },
          { label: 'Pending', value: workorders.filter(w => w.status === 'PENDING').length, color: '#7f8c8d', icon: FaClock },
        ].map((k, i) => (
          <div key={i} className="wo-kpi-card" style={{ borderLeftColor: k.color }}>
            <k.icon className="wo-kpi-icon" style={{ color: k.color }} />
            <div><div className="wo-kpi-value" style={{ color: k.color }}>{k.value}</div><div className="wo-kpi-label">{k.label}</div></div>
          </div>
        ))}
      </div>

      <div className="wo-layout">
        {/* Left List */}
        <div className="wo-list-panel">
          <div className="wo-controls">
            <div className="wo-search-wrapper" style={{ flex: 1 }}>
              <FaSearch className="search-icon" />
              <input type="text" placeholder="Search work orders..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 145 }}>
              <option value="ALL">All Status</option>
              {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {loading ? <div style={{ padding: 30, textAlign: 'center', color: '#aaa' }}><FaSpinner /> Loading...</div> : (
            <div className="wo-cards">
              {filtered.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#aaa' }}>No work orders found.</div>}
              {filtered.map(wo => {
                const sc = statusConfig[wo.status] || statusConfig.PENDING;
                const pct = wo.target_qty > 0 ? Math.round((wo.built_qty / wo.target_qty) * 100) : 0;
                return (
                  <div key={wo.id} className={`wo-card ${selected?.id === wo.id ? 'active' : ''}`} onClick={() => selectWO(wo)}>
                    <div className="wo-card-top">
                      <div className="wo-id">{wo.wo_number}</div>
                      <span className="wo-status-badge" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                    </div>
                    <div className="wo-product">{wo.product_name}</div>
                    <div className="wo-meta">
                      <span><FaBoxes /> {wo.built_qty}/{wo.target_qty} units</span>
                      {wo.due_date && <span><FaClock /> Due: {wo.due_date?.split('T')[0]}</span>}
                      <span style={{ color: wo.priority === 'CRITICAL' ? '#e74c3c' : '#999', fontSize: 12 }}>{wo.priority}</span>
                    </div>
                    <div className="wo-progress-bar">
                      <div className="wo-progress-fill" style={{ width: `${pct}%`, background: sc.color }} />
                    </div>
                    <div className="wo-pct">{pct}% complete</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Detail */}
        <div className="wo-detail-panel">
          {selected ? (
            <>
              <div className="wo-detail-header">
                <div>
                  <h2>{selected.product_name}</h2>
                  <div className="wo-detail-id">{selected.wo_number}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="wo-status-badge large" style={{ background: statusConfig[selected.status]?.bg, color: statusConfig[selected.status]?.color }}>
                    {statusConfig[selected.status]?.label}
                  </span>
                  {selected.status !== 'COMPLETE' && selected.status !== 'CANCELLED' && (
                    <button className="icon-btn delete-btn" onClick={() => deleteWO(selected)}><FaTrash /></button>
                  )}
                </div>
              </div>

              <div className="wo-detail-stats">
                <div className="wo-stat"><div className="wo-stat-val">{selected.target_qty}</div><div className="wo-stat-lbl">Target</div></div>
                <div className="wo-stat"><div className="wo-stat-val">{selected.built_qty}</div><div className="wo-stat-lbl">Built</div></div>
                <div className="wo-stat"><div className="wo-stat-val">{selected.target_qty - selected.built_qty}</div><div className="wo-stat-lbl">Remaining</div></div>
                <div className="wo-stat"><div className="wo-stat-val">{selected.due_date?.split('T')[0] || '—'}</div><div className="wo-stat-lbl">Due Date</div></div>
              </div>

              <div className="wo-materials-section">
                <h3><FaLayerGroup /> Bill of Materials {materials.length === 0 && <span style={{ color: '#aaa', fontWeight: 400, fontSize: 13 }}>(No BOM — add a BOM to the product in Catalog)</span>}</h3>
                {materials.length > 0 && (
                  <table className="wo-bom-table">
                    <thead><tr><th>Component</th><th>Required</th><th>Available Now</th><th>Status</th></tr></thead>
                    <tbody>
                      {materials.map((m, i) => {
                        const ok = Number(m.available_qty) >= Number(m.required_qty);
                        return (
                          <tr key={i}>
                            <td><code style={{ fontSize: 12 }}>{m.barcode}</code> {m.name}</td>
                            <td>{m.required_qty} {m.unit}</td>
                            <td style={{ color: ok ? '#27ae60' : '#e74c3c', fontWeight: 600 }}>{m.available_qty} {m.unit}</td>
                            <td><span className={`bom-status ${ok ? 'ok' : 'short'}`}>{ok ? '✓ OK' : `⚠ Short ${m.required_qty - m.available_qty}`}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {selected.notes && <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#555', marginTop: 12 }}>📝 {selected.notes}</div>}

              <div className="wo-actions">
                {NEXT_STATUS[selected.status] && (
                  <button className="btn btn-primary" style={selected.status === 'QC' ? { background: '#27ae60' } : {}}
                    onClick={() => changeStatus(selected, NEXT_STATUS[selected.status])}>
                    <FaArrowRight /> {NEXT_LABEL[selected.status]}
                  </button>
                )}
                {selected.status !== 'COMPLETE' && selected.status !== 'CANCELLED' && (
                  <button className="btn btn-secondary" style={{ borderColor: '#e74c3c', color: '#e74c3c' }}
                    onClick={() => changeStatus(selected, 'CANCELLED')}>
                    <FaTimes /> Cancel WO
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="wo-empty-detail">
              <FaClipboardList className="wo-empty-icon" />
              <h3>Select a Work Order</h3>
              <p>Click any work order to view its BOM, track progress, and advance its production stage.</p>
            </div>
          )}
        </div>
      </div>

      {/* Create WO Modal */}
      {showCreate && (
        <div className="ims-modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="ims-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div><h2>Create Work Order</h2><p>Define a new production job</p></div>
              <button className="modal-close" onClick={() => setShowCreate(false)}><FaTimes /></button>
            </div>
            <div className="modal-body">
              <div className="modal-row">
                <div className="form-group">
                  <label className="form-label">Finished Product Name *</label>
                  <input className="form-input" placeholder="e.g. LED Tube Light 40W" value={newWO.productName} onChange={e => setNewWO(f => ({ ...f, productName: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Product Barcode (for BOM)</label>
                  <input className="form-input" placeholder="e.g. TUBE-40W" value={newWO.productBarcode} onChange={e => setNewWO(f => ({ ...f, productBarcode: e.target.value }))} />
                </div>
              </div>
              <div className="modal-row">
                <div className="form-group">
                  <label className="form-label">Target Quantity *</label>
                  <input className="form-input" type="number" placeholder="50" value={newWO.targetQty} onChange={e => setNewWO(f => ({ ...f, targetQty: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Date</label>
                  <input className="form-input" type="date" value={newWO.dueDate} onChange={e => setNewWO(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={newWO.priority} onChange={e => setNewWO(f => ({ ...f, priority: e.target.value }))}>
                    <option>NORMAL</option><option>HIGH</option><option>CRITICAL</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <input className="form-input" placeholder="Any additional instructions..." value={newWO.notes} onChange={e => setNewWO(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div style={{ background: '#eaf4fb', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#2980b9', marginTop: 8 }}>
                💡 If you enter a Product Barcode that has a BOM defined in the Catalog, the system will auto-populate the required raw materials.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createWO} disabled={saving || !newWO.productName || !newWO.targetQty}>
                {saving ? <FaSpinner /> : <FaSave />} Create Work Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
