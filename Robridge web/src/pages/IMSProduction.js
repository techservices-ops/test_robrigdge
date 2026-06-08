import React, { useState, useEffect, useCallback } from 'react';
import {
  FaSync, 
  FaSave, FaSpinner, FaBarcode, FaClipboardList
} from 'react-icons/fa';
import './IMSProduction.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useWebSocket } from '../contexts/WebSocketContext';

const OUTCOMES = [
  { value: 'FORWARD', label: '✓ Forward', color: '#27ae60', bg: '#eafaf1' },
  { value: 'REWORK',  label: '↩ Rework',  color: '#e67e22', bg: '#fef9e7' },
  { value: 'REJECT',  label: '✗ Reject',  color: '#e74c3c', bg: '#fdf0ed' },
];

export default function IMSProduction() {
  const { imsFetch, activeWorkspaceId } = useWorkspace();
  const { latestScan, scanBuffer } = useWebSocket();
  const [stages, setStages] = useState([]);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState([]);
  const [selectedStage, setSelectedStage] = useState(null);
  const [, setLoading] = useState(false);
  const [scan, setScan] = useState({ barcode: localStorage.getItem('ims_last_scanned_barcode') || '', itemName: '', outcome: 'FORWARD', qty: 1, batchNo: '', notes: '', woId: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const lastSeenScanId = React.useRef(latestScan?.id);

  useEffect(() => {
    if (latestScan?.id && latestScan.id !== lastSeenScanId.current) {
      lastSeenScanId.current = latestScan.id;
      const barcode = latestScan.barcodeData;
      setScan(s => ({ ...s, barcode }));
      localStorage.setItem('ims_last_scanned_barcode', barcode);
    }
  }, [latestScan?.id]);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    const [sR, eR, sumR] = await Promise.all([
      imsFetch('/api/ims/production/stages').then(r => r.json()),
      imsFetch('/api/ims/production/events').then(r => r.json()),
      imsFetch('/api/ims/production/summary').then(r => r.json()),
    ]);
    if (sR.success) { setStages(sR.stages); if (!selectedStage && sR.stages.length) setSelectedStage(sR.stages[0]); }
    if (eR.success) setEvents(eR.events);
    if (sumR.success) setSummary(sumR.summary);
    setLoading(false);
  }, [activeWorkspaceId, imsFetch]);

  useEffect(() => { load(); }, [load]);

  const recordScan = async () => {
    if (!scan.barcode || !selectedStage) return;
    setSaving(true);
    try {
      const payload = { ...scan, stageId: selectedStage.id, stageName: selectedStage.name, qty: Number(scan.qty) || 1 };
      const r = await imsFetch('/api/ims/production/scan', { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.success) {
        showToast(`✅ ${scan.outcome} recorded at ${selectedStage.name}`);
        setScan(s => ({ ...s, barcode: '', batchNo: '', notes: '' }));
        load();
      } else { showToast('❌ ' + d.error); }
    } finally { setSaving(false); }
  };

  // Compute stage-level summary from summary array
  const getStageSummary = (stageName) => {
    const rows = summary.filter(s => s.stage_name === stageName);
    return {
      forward: rows.find(r => r.outcome === 'FORWARD')?.total || 0,
      rework: rows.find(r => r.outcome === 'REWORK')?.total || 0,
      reject: rows.find(r => r.outcome === 'REJECT')?.total || 0,
    };
  };

  const stageEvents = events.filter(e => e.stage_id === selectedStage?.id).slice(0, 50);

  return (
    <div className="ims-production-page">
      {toast && <div style={{ position: 'fixed', top: 20, right: 20, background: '#2c3e50', color: '#fff', padding: '12px 20px', borderRadius: 10, zIndex: 9999, fontSize: 14 }}>{toast}</div>}

      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Production &amp; QC Tracking</h1>
          <p>Scan items at each production stage — classify as Forward, Rework, or Reject</p>
        </div>
        <div className="ims-header-right">
          <button className="btn btn-secondary" onClick={load}><FaSync /> Refresh</button>
        </div>
      </div>

      {/* Stage Pipeline */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, overflowX: 'auto' }}>
        {stages.map((st, i) => {
          const s = getStageSummary(st.name);
          const active = selectedStage?.id === st.id;
          return (
            <React.Fragment key={st.id}>
              <div onClick={() => setSelectedStage(st)} style={{
                background: active ? '#E3821E' : '#fff', color: active ? '#fff' : '#333',
                padding: '14px 20px', borderRadius: i === 0 ? '10px 0 0 10px' : i === stages.length - 1 ? '0 10px 10px 0' : 0,
                cursor: 'pointer', border: '1px solid #e0e0e0', borderLeft: i > 0 ? 'none' : '1px solid #e0e0e0',
                minWidth: 140, textAlign: 'center', transition: 'all 0.2s', boxShadow: active ? '0 4px 12px rgba(227,130,30,0.25)' : 'none'
              }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{st.name}</div>
                <div style={{ fontSize: 12, marginTop: 4, opacity: active ? 1 : 0.6 }}>
                  <span style={{ color: active ? '#9fffba' : '#27ae60' }}>✓{s.forward}</span>
                  {' · '}
                  <span style={{ color: active ? '#ffe0a0' : '#e67e22' }}>↩{s.rework}</span>
                  {' · '}
                  <span style={{ color: active ? '#ffbaba' : '#e74c3c' }}>✗{s.reject}</span>
                </div>
              </div>
              {i < stages.length - 1 && <div style={{ width: 0, height: 0, borderTop: '31px solid transparent', borderBottom: '31px solid transparent', borderLeft: `18px solid ${active ? '#E3821E' : '#e0e0e0'}`, zIndex: 1 }} />}
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20 }}>
        {/* Scan Panel */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', height: 'fit-content' }}>
          <h3 style={{ marginBottom: 16, fontSize: 16 }}><FaBarcode /> Scan at: <span style={{ color: '#E3821E' }}>{selectedStage?.name || 'Select a stage'}</span></h3>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">Barcode *</label>
            <input className="form-input" placeholder="Scan or type barcode..." value={scan.barcode} style={{ textAlign: 'left' }}
              onChange={e => setScan(s => ({ ...s, barcode: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && recordScan()} autoFocus />
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">Item Name</label>
            <input className="form-input" placeholder="Optional" value={scan.itemName} style={{ textAlign: 'left' }} onChange={e => setScan(s => ({ ...s, itemName: e.target.value }))} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label className="form-label">Outcome *</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {OUTCOMES.map(o => (
                <button key={o.value} onClick={() => setScan(s => ({ ...s, outcome: o.value }))}
                  style={{ flex: 1, padding: '8px 0', border: `2px solid ${scan.outcome === o.value ? o.color : '#e0e0e0'}`, borderRadius: 8, background: scan.outcome === o.value ? o.bg : '#fff', color: o.color, fontWeight: 700, cursor: 'pointer', fontSize: 13, transition: 'all 0.15s' }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="modal-row" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label className="form-label">Qty</label>
              <input className="form-input" type="number" value={scan.qty} style={{ textAlign: 'center' }} onChange={e => setScan(s => ({ ...s, qty: e.target.value }))} />
            </div>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Batch No</label>
              <input className="form-input" placeholder="Optional" value={scan.batchNo} style={{ textAlign: 'left' }} onChange={e => setScan(s => ({ ...s, batchNo: e.target.value }))} />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Notes</label>
            <input className="form-input" placeholder="Reason for rework/reject..." value={scan.notes} style={{ textAlign: 'left' }} onChange={e => setScan(s => ({ ...s, notes: e.target.value }))} />
          </div>

          <button className="btn btn-primary" style={{ width: '100%' }} onClick={recordScan} disabled={saving || !scan.barcode || !selectedStage}>
            {saving ? <FaSpinner /> : <FaSave />} Record Scan
          </button>
        </div>

        {/* Events at Selected Stage */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, margin: 0 }}><FaClipboardList /> Events at {selectedStage?.name}</h3>
          </div>

          {/* Summary Row */}
          {selectedStage && (() => {
            const s = getStageSummary(selectedStage.name);
            return (
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                {[{ label: 'Forwarded', val: s.forward, color: '#27ae60' }, { label: 'Rework', val: s.rework, color: '#e67e22' }, { label: 'Rejected', val: s.reject, color: '#e74c3c' }].map((k, i) => (
                  <div key={i} style={{ flex: 1, background: '#f8f9fa', borderRadius: 8, padding: '10px 14px', borderLeft: `4px solid ${k.color}` }}>
                    <div style={{ fontWeight: 700, fontSize: 20, color: k.color }}>{k.val}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{k.label}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="table-container" style={{ boxShadow: 'none', border: '1px solid #eee' }}>
            <table className="table">
              <thead><tr><th>Barcode</th><th>Item</th><th>Outcome</th><th>Qty</th><th>Batch</th><th>Operator</th><th>Time</th></tr></thead>
              <tbody>
                {stageEvents.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 20 }}>No events at this stage yet.</td></tr>}
                {stageEvents.map((ev, i) => {
                  const o = OUTCOMES.find(x => x.value === ev.outcome) || OUTCOMES[0];
                  return (
                    <tr key={i}>
                      <td><code style={{ fontSize: 12 }}>{ev.barcode}</code></td>
                      <td>{ev.item_name}</td>
                      <td><span style={{ background: o.bg, color: o.color, padding: '3px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{o.label}</span></td>
                      <td>{ev.qty}</td>
                      <td style={{ fontSize: 12, color: '#888' }}>{ev.batch_no || '—'}</td>
                      <td style={{ fontSize: 12 }}>{ev.operator_name || '—'}</td>
                      <td style={{ fontSize: 12, color: '#888' }}>{ev.created_at?.replace('T', ' ').slice(0, 16)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
