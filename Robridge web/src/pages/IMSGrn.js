import React, { useState, useEffect, useCallback } from 'react';
import {
  FaFileInvoice, FaPlus, FaCheckCircle, FaSearch,
  FaTimes, FaSave, FaArrowDown, FaArrowUp,
  FaCalendarAlt, FaBuilding, FaBoxes, FaClipboardCheck,
  FaSpinner, FaSync, FaTrash, FaUpload
} from 'react-icons/fa';
import './IMSGrn.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useConfirm } from '../components/ConfirmModal';
import { useWebSocket } from '../contexts/WebSocketContext';

const statusStyle = {
  APPROVED: { color: '#27ae60', bg: '#eafaf1', label: '✓ Approved' },
  PENDING:  { color: '#e67e22', bg: '#fef9e7', label: '⏳ Pending Approval' },
  REJECTED: { color: '#e74c3c', bg: '#fdf0ed', label: '✗ Rejected' },
};

const emptyForm = { type: 'INWARD', supplier: '', poRef: '', vehicleNo: '', notes: '' };
const emptyItem = { barcode: '', name: '', orderedQty: '', receivedQty: '', unit: 'pcs', condition: 'Good', note: '' };

export default function IMSGrn() {
  const { imsFetch, activeWorkspaceId, activeWorkspace } = useWorkspace();
  const { socket } = useWebSocket();
  const confirm = useConfirm();
  const [tab, setTab] = useState('INWARD');
  const [grns, setGrns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [lineItems, setLineItems] = useState([{ ...emptyItem }]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const isReadOnly = ['user', 'member', 'viewer'].includes(activeWorkspace?.currentUserRole);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const rows = text.split('\n').map(r => r.trim()).filter(r => r);
      if (rows.length < 2) return showToast('❌ Invalid CSV format');
      
      const parseLine = (line) => {
        const res = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') inQuote = !inQuote;
          else if (line[i] === ',' && !inQuote) { res.push(cur); cur = ''; }
          else cur += line[i];
        }
        res.push(cur);
        return res.map(s => s.trim());
      };

      const headers = parseLine(rows[0]).map(h => h.toLowerCase());
      const bcIdx = headers.findIndex(h => h.includes('barcode'));
      const nmIdx = headers.findIndex(h => h.includes('name') || h.includes('item') || h.includes('product'));
      const ordIdx = headers.findIndex(h => h.includes('order') || h.includes('qty') || h.includes('quantity') || h.includes('expected'));
      const recIdx = headers.findIndex(h => h.includes('receiv'));
      
      if (bcIdx === -1 || nmIdx === -1) return showToast('❌ CSV must have Barcode and Name columns');
      
      const parsedItems = [];
      for (let i = 1; i < rows.length; i++) {
        const cols = parseLine(rows[i]);
        if (cols.length < 2) continue;
        parsedItems.push({
          barcode: cols[bcIdx] || '',
          name: cols[nmIdx] || '',
          orderedQty: ordIdx !== -1 ? cols[ordIdx] : '',
          receivedQty: recIdx !== -1 ? cols[recIdx] : '',
          unit: 'pcs',
          condition: 'Good',
          note: ''
        });
      }
      setLineItems(parsedItems.length > 0 ? parsedItems : [{ ...emptyItem }]);
      showToast('✅ CSV uploaded successfully');
      e.target.value = ''; // Reset input
    };
    reader.readAsText(file);
  };

  const loadGRNs = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const r = await imsFetch('/api/ims/grn');
      const d = await r.json();
      if (d.success) setGrns(d.grns);
    } finally { setLoading(false); }
  }, [activeWorkspaceId, imsFetch]);

  useEffect(() => { loadGRNs(); }, [loadGRNs]);

  useEffect(() => {
    if (!socket) return;
    const handleUpdate = (data) => {
      if (selected && selected.id === data.grnId) {
        setSelectedItems(prev => prev.map(i => i.id === data.itemId ? { ...i, received_qty: data.receivedQty } : i));
        showToast(`📦 Scanned: ${data.name} (${data.receivedQty}/${data.orderedQty})`);
      }
    };
    socket.on('grn_item_updated', handleUpdate);
    return () => socket.off('grn_item_updated', handleUpdate);
  }, [socket, selected]);


  const selectGRN = async (grn) => {
    setSelected(grn);
    const r = await imsFetch(`/api/ims/grn/${grn.id}/items`);
    const d = await r.json();
    if (d.success) setSelectedItems(d.items);
  };

  const createGRN = async () => {
    if (!form.supplier) return;
    setSaving(true);
    try {
      const payload = { ...form, type: tab, items: lineItems.filter(i => i.barcode && i.name) };
      const r = await imsFetch('/api/ims/grn', { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.success) {
        setGrns(prev => [d.grn, ...prev]);
        setShowCreate(false);
        setForm(emptyForm);
        setLineItems([{ ...emptyItem }]);
        showToast('✅ Document created successfully');
      }
    } finally { setSaving(false); }
  };

  const approve = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: `Approve ${selected.doc_no}?`,
      message: 'Approving this document will update stock levels. This action cannot be reversed.',
      type: 'warning',
      confirmLabel: 'Approve & Update Stock'
    });
    if (!ok) return;
    const r = await imsFetch(`/api/ims/grn/${selected.id}/approve`, { method: 'POST', body: '{}' });
    const d = await r.json();
    if (d.success) {
      setGrns(prev => prev.map(g => g.id === selected.id ? { ...g, status: 'APPROVED' } : g));
      setSelected(s => ({ ...s, status: 'APPROVED' }));
      showToast('✅ Approved! Stock has been updated.');
    }
  };

  const reject = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: `Reject ${selected.doc_no}?`,
      message: 'The document will be marked as rejected and no stock changes will be made.',
      type: 'danger',
      confirmLabel: 'Reject'
    });
    if (!ok) return;
    const r = await imsFetch(`/api/ims/grn/${selected.id}/reject`, { method: 'POST', body: '{}' });
    const d = await r.json();
    if (d.success) {
      setGrns(prev => prev.map(g => g.id === selected.id ? { ...g, status: 'REJECTED' } : g));
      setSelected(s => ({ ...s, status: 'REJECTED' }));
      showToast('🗑️ Document rejected');
    }
  };

  const filtered = grns.filter(g => g.type === tab &&
    (g.doc_no.includes(search) || g.supplier.toLowerCase().includes(search.toLowerCase())));

  const kpis = [
    { label: 'Total GRNs',          value: grns.filter(g => g.type === 'INWARD').length,            color: '#3498db', icon: FaArrowDown },
    { label: 'Pending Approval',     value: grns.filter(g => g.status === 'PENDING').length,         color: '#e67e22', icon: FaClipboardCheck },
    { label: 'Dispatch Notes',       value: grns.filter(g => g.type === 'OUTWARD').length,           color: '#27ae60', icon: FaArrowUp },
    { label: 'Approved Today',       value: grns.filter(g => g.status === 'APPROVED' && g.created_at?.startsWith(new Date().toISOString().slice(0,10))).length, color: '#9b59b6', icon: FaBoxes },
  ];

  return (
    <div className="ims-grn-page">
      {toast && <div style={{ position: 'fixed', top: 20, right: 20, background: '#2c3e50', color: '#fff', padding: '12px 20px', borderRadius: 10, zIndex: 9999, fontSize: 14 }}>{toast}</div>}

      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Inward GRN &amp; Outward Dispatch</h1>
          <p>Manage Goods Receipt Notes for inbound stock and Dispatch Notes for outward shipments</p>
        </div>
        <div className="ims-header-right" style={{ gap: 10, display: 'flex' }}>
          <button className="btn btn-secondary" onClick={loadGRNs}><FaSync /> Refresh</button>
          {!isReadOnly && (
            <button className="btn btn-primary" onClick={() => { setForm({ ...emptyForm, type: tab }); setShowCreate(true); }}>
              <FaPlus /> Create {tab === 'INWARD' ? 'GRN' : 'Dispatch Note'}
            </button>
          )}
        </div>
      </div>

      <div className="grn-kpi-strip">
        {kpis.map((k, i) => (
          <div key={i} className="grn-kpi-card" style={{ borderLeftColor: k.color }}>
            <k.icon style={{ color: k.color, fontSize: 22 }} />
            <div><div className="grn-kpi-val" style={{ color: k.color }}>{k.value}</div><div className="grn-kpi-lbl">{k.label}</div></div>
          </div>
        ))}
      </div>

      <div className="grn-layout">
        {/* Left List */}
        <div className="grn-list-panel">
          <div className="grn-tabs">
            <button className={`grn-tab ${tab === 'INWARD' ? 'active' : ''}`} onClick={() => setTab('INWARD')}><FaArrowDown /> Inward GRN</button>
            <button className={`grn-tab ${tab === 'OUTWARD' ? 'active' : ''}`} onClick={() => setTab('OUTWARD')}><FaArrowUp /> Outward Dispatch</button>
          </div>
          <div className="search-input" style={{ margin: '12px 0' }}>
            <FaSearch className="search-icon" />
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {loading ? <div style={{ textAlign: 'center', padding: 30, color: '#aaa' }}><FaSpinner /></div> : (
            <div className="grn-cards">
              {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 30, color: '#aaa' }}>No documents found.</div>}
              {filtered.map(grn => {
                const ss = statusStyle[grn.status] || statusStyle.PENDING;
                return (
                  <div key={grn.id} className={`grn-card ${selected?.id === grn.id ? 'active' : ''}`} onClick={() => selectGRN(grn)}>
                    <div className="grn-card-top">
                      <div className="grn-id">{grn.doc_no}</div>
                      <span className="grn-status" style={{ background: ss.bg, color: ss.color }}>{ss.label}</span>
                    </div>
                    <div className="grn-supplier"><FaBuilding /> {grn.supplier}</div>
                    <div className="grn-meta">
                      {grn.po_ref && <span><FaFileInvoice /> {grn.po_ref}</span>}
                      <span><FaCalendarAlt /> {grn.created_at?.split('T')[0]}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Detail */}
        <div className="grn-detail-panel">
          {selected ? (
            <>
              <div className="grn-detail-header">
                <div>
                  <h2>{selected.doc_no}</h2>
                  <div style={{ color: '#888', fontSize: 14 }}>{selected.supplier} {selected.po_ref && `· ${selected.po_ref}`}</div>
                </div>
                <span className="grn-status large" style={{ background: statusStyle[selected.status]?.bg, color: statusStyle[selected.status]?.color }}>{statusStyle[selected.status]?.label}</span>
              </div>
              <div style={{ padding: '0 0 16px', borderBottom: '1px solid #eee', marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 12, color: '#888' }}>Date</div><div style={{ fontWeight: 600 }}>{selected.created_at?.split('T')[0]}</div></div>
                {selected.po_ref && <div><div style={{ fontSize: 12, color: '#888' }}>Reference</div><div style={{ fontWeight: 600 }}>{selected.po_ref}</div></div>}
                {selected.vehicle_no && <div><div style={{ fontSize: 12, color: '#888' }}>Vehicle No</div><div style={{ fontWeight: 600 }}>{selected.vehicle_no}</div></div>}
                <div><div style={{ fontSize: 12, color: '#888' }}>Type</div><div style={{ fontWeight: 600 }}>{selected.type}</div></div>
              </div>

              <h3 style={{ fontSize: 15, marginBottom: 12 }}>Item-wise Details</h3>
              <div className="table-container" style={{ boxShadow: 'none', border: '1px solid #eee' }}>
                <table className="table">
                  <thead><tr><th>Barcode</th><th>Item</th><th>Ordered</th><th>Received</th><th>Condition</th><th>Notes</th></tr></thead>
                  <tbody>
                    {selectedItems.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: 20 }}>No items recorded</td></tr>}
                    {selectedItems.map((item, i) => (
                      <tr key={i}>
                        <td><code>{item.barcode}</code></td>
                        <td><strong>{item.name}</strong></td>
                        <td>{item.ordered_qty} {item.unit}</td>
                        <td style={{ color: Number(item.received_qty) >= Number(item.ordered_qty) ? '#27ae60' : '#e74c3c', fontWeight: 600 }}>{item.received_qty} {item.unit}</td>
                        <td><span style={{ background: '#eafaf1', color: '#27ae60', padding: '3px 8px', borderRadius: 10, fontSize: 12 }}>{item.condition}</span></td>
                        <td style={{ color: '#888', fontSize: 13 }}>{item.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.status === 'PENDING' && !isReadOnly && (
                <div className="grn-approval-strip">
                  <button className="btn btn-primary" style={{ background: '#27ae60' }} onClick={approve}><FaCheckCircle /> Approve &amp; Update Stock</button>
                  <button className="btn btn-secondary" style={{ borderColor: '#e74c3c', color: '#e74c3c' }} onClick={reject}><FaTimes /> Reject</button>
                </div>
              )}
              {selected.status === 'PENDING' && isReadOnly && (
                <div style={{ marginTop: 24, padding: '12px', background: '#fef2f2', color: '#e74c3c', borderRadius: 8, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>
                  You have view-only access. You cannot approve or reject documents.
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', gap: 12 }}>
              <FaFileInvoice style={{ fontSize: 48 }} />
              <h3>Select a GRN or Dispatch Note</h3>
              <p style={{ fontSize: 14 }}>Click on a record to view item-level details and take action.</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="ims-modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="ims-modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div><h2>Create {tab === 'INWARD' ? 'Goods Receipt Note' : 'Dispatch Note'}</h2><p>Fill in the delivery details and items</p></div>
              <button className="modal-close" onClick={() => setShowCreate(false)}><FaTimes /></button>
            </div>
            <div className="modal-body">
              <div className="modal-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">{tab === 'INWARD' ? 'Supplier Name' : 'Recipient Name'} *</label>
                  <input className="form-input" placeholder="Company / Person" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">PO / SO Reference</label>
                  <input className="form-input" placeholder="PO-XXXX" value={form.poRef} onChange={e => setForm(f => ({ ...f, poRef: e.target.value }))} />
                </div>
              </div>
              <div className="modal-row">
                <div className="form-group">
                  <label className="form-label">Vehicle / Courier No</label>
                  <input className="form-input" placeholder="TN-01-AB-1234" value={form.vehicleNo} onChange={e => setForm(f => ({ ...f, vehicleNo: e.target.value }))} />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Notes</label>
                  <input className="form-input" placeholder="Any special instructions..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong>Line Items</strong>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <label className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer', margin: 0 }}>
                      <FaUpload /> Upload CSV
                      <input type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileUpload} />
                    </label>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setLineItems(p => [...p, { ...emptyItem }])}><FaPlus /> Add Row</button>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ background: '#f8f9fa' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Barcode</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Name</th>
                    <th style={{ padding: '6px 8px', width: 70 }}>Ordered</th>
                    <th style={{ padding: '6px 8px', width: 70 }}>Received</th>
                    <th style={{ padding: '6px 8px', width: 60 }}>Unit</th>
                    <th style={{ padding: '6px 8px', width: 30 }}></th>
                  </tr></thead>
                  <tbody>
                    {lineItems.map((it, i) => {
                      const o = Number(it.orderedQty) || 0;
                      const r = Number(it.receivedQty) || 0;
                      let rStyle = { padding: '4px 8px', fontSize: 12, minWidth: '70px' };
                      if (it.barcode && r > 0) {
                        if (r === o) rStyle.color = '#27ae60'; // Green - Match
                        else if (r > o && o > 0) rStyle.color = '#e67e22'; // Orange - Overage
                        else if (r < o) rStyle.color = '#e74c3c'; // Red - Short
                        else if (o === 0) rStyle.color = '#3498db'; // Blue - Unexpected
                      }
                      
                      return (
                      <tr key={i}>
                        <td style={{ padding: '4px' }}><input className="form-input" style={{ padding: '4px 8px', fontSize: 12 }} value={it.barcode} onChange={e => { const n = [...lineItems]; n[i].barcode = e.target.value; setLineItems(n); }} placeholder="Barcode" /></td>
                        <td style={{ padding: '4px' }}><input className="form-input" style={{ padding: '4px 8px', fontSize: 12 }} value={it.name} onChange={e => { const n = [...lineItems]; n[i].name = e.target.value; setLineItems(n); }} placeholder="Name" /></td>
                        <td style={{ padding: '4px' }}><input className="form-input" type="number" style={{ padding: '4px 8px', fontSize: 12, minWidth: '70px' }} value={it.orderedQty} onChange={e => { const n = [...lineItems]; n[i].orderedQty = e.target.value; setLineItems(n); }} placeholder="0" /></td>
                        <td style={{ padding: '4px' }}><input className="form-input" type="number" style={{...rStyle}} value={it.receivedQty} onChange={e => { const n = [...lineItems]; n[i].receivedQty = e.target.value; setLineItems(n); }} placeholder="0" /></td>
                        <td style={{ padding: '4px' }}><input className="form-input" style={{ padding: '4px 8px', fontSize: 12, background: '#f5f6fa', color: '#7f8c8d' }} value="pcs" readOnly title="Fixed Unit" /></td>
                        <td style={{ padding: '4px', textAlign: 'center' }}><button style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer' }} onClick={() => setLineItems(p => p.filter((_, j) => j !== i))}><FaTrash /></button></td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createGRN} disabled={saving || !form.supplier}>
                {saving ? <FaSpinner /> : <FaSave />} Create Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
