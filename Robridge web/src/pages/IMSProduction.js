import React, { useState, useEffect, useCallback } from 'react';
import {
  FaSync, 
  FaSave, FaSpinner, FaBarcode, FaClipboardList, FaArrowRight
} from 'react-icons/fa';
import './IMSProduction.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useToast } from '../components/Toast';

const OUTCOMES = [
  { value: 'FORWARD', label: '✓ Forward', color: '#27ae60', bg: '#eafaf1' },
  { value: 'REWORK',  label: '↩ Rework',  color: '#e67e22', bg: '#fef9e7' },
  { value: 'REJECT',  label: '✗ Reject',  color: '#e74c3c', bg: '#fdf0ed' },
];

export default function IMSProduction() {
  const { imsFetch, activeWorkspaceId, activeWorkspace } = useWorkspace();
  const { latestScan, scanBuffer } = useWebSocket();
  const isReadOnly = ['user', 'member', 'viewer'].includes(activeWorkspace?.currentUserRole);
  const showToast = useToast();
  const [stages, setStages] = useState([]);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState([]);
  const [selectedStage, setSelectedStage] = useState(null);
  const [, setLoading] = useState(false);
  const [scan, setScan] = useState({ barcode: localStorage.getItem('ims_last_scanned_barcode') || '', itemName: '', outcome: 'FORWARD', qty: 0, batchNo: '', notes: '', woId: '' });
  const [saving, setSaving] = useState(false);

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
      const payload = { ...scan, stageId: selectedStage.id, stageName: selectedStage.name, qty: Number(scan.qty) };
      const r = await imsFetch('/api/ims/production/scan', { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.success) {
        showToast(`${scan.outcome} recorded at ${selectedStage.name}`, 'success');
        setScan(s => ({ ...s, barcode: '', batchNo: '', notes: '' }));
        load();
      } else { showToast(d.error, 'error'); }
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
      <div className="ims-pipeline-container">
        {stages.map((st, i) => {
          const s = getStageSummary(st.name);
          const active = selectedStage?.id === st.id;
          return (
            <React.Fragment key={st.id}>
              <div onClick={() => setSelectedStage(st)} className={`ims-stage-card ${active ? 'active' : ''}`}>
                <div className="ims-stage-name">{st.name}</div>
                <div className="ims-stage-metrics">
                  <div className="ims-stage-metric-col ims-metric-fwd">
                    <span className="ims-stage-metric-label">FWD</span>
                    {s.forward}
                  </div>
                  <div className="ims-stage-metric-divider" />
                  <div className="ims-stage-metric-col ims-metric-rwk">
                    <span className="ims-stage-metric-label">RWK</span>
                    {s.rework}
                  </div>
                  <div className="ims-stage-metric-divider" />
                  <div className="ims-stage-metric-col ims-metric-rej">
                    <span className="ims-stage-metric-label">REJ</span>
                    {s.reject}
                  </div>
                </div>
              </div>
              {i < stages.length - 1 && (
                <div className="ims-pipeline-arrow">
                  <FaArrowRight />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="ims-prod-grid">
        {/* Scan Panel */}
        <div className="ims-panel ims-scan-panel">
          <h3 className="ims-panel-title"><FaBarcode /> Scan at: <span className="ims-highlight">{selectedStage?.name || 'Select a stage'}</span></h3>

          <div className="form-group ims-form-group">
            <label className="form-label ims-form-label">Barcode *</label>
            <input className="form-input ims-form-input" placeholder="Scan or type barcode..." value={scan.barcode}
              onChange={e => setScan(s => ({ ...s, barcode: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && recordScan()} autoFocus disabled={isReadOnly} />
          </div>
          <div className="form-group" style={{ marginBottom: 16, textAlign: 'left' }}>
            <label className="form-label" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontWeight: 600, fontSize: 13, color: '#444' }}>Item Name</label>
            <input className="form-input" placeholder="Optional" value={scan.itemName} 
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textAlign: 'left', boxSizing: 'border-box' }}
              onChange={e => setScan(s => ({ ...s, itemName: e.target.value }))} disabled={isReadOnly} />
          </div>

          <div className="ims-form-group">
            <label className="form-label ims-form-label">Outcome *</label>
            <div className="ims-outcome-buttons">
              {OUTCOMES.map(o => (
                <button key={o.value} onClick={() => setScan(s => ({ ...s, outcome: o.value }))} disabled={isReadOnly}
                  style={{ flex: 1, padding: '10px 0', border: `2px solid ${scan.outcome === o.value ? o.color : '#e0e0e0'}`, borderRadius: 8, background: scan.outcome === o.value ? o.bg : '#fff', color: o.color, fontWeight: 700, cursor: isReadOnly ? 'not-allowed' : 'pointer', fontSize: 13, transition: 'all 0.15s', opacity: isReadOnly ? 0.6 : 1 }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="modal-row" style={{ display: 'flex', gap: 12, marginBottom: 16, textAlign: 'left' }}>
            <div className="form-group" style={{ flex: 1, textAlign: 'left' }}>
              <label className="form-label" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontWeight: 600, fontSize: 13, color: '#444' }}>Qty</label>
              <input className="form-input" type="number" value={scan.qty} 
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textAlign: 'left', boxSizing: 'border-box' }}
                onChange={e => setScan(s => ({ ...s, qty: e.target.value }))} disabled={isReadOnly} />
            </div>
            <div className="form-group" style={{ flex: 2, textAlign: 'left' }}>
              <label className="form-label" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontWeight: 600, fontSize: 13, color: '#444' }}>Batch No</label>
              <input className="form-input" placeholder="Optional" value={scan.batchNo} 
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textAlign: 'left', boxSizing: 'border-box' }}
                onChange={e => setScan(s => ({ ...s, batchNo: e.target.value }))} disabled={isReadOnly} />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 20, textAlign: 'left' }}>
            <label className="form-label" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontWeight: 600, fontSize: 13, color: '#444' }}>Notes</label>
            <input className="form-input" placeholder="Reason for rework/reject..." value={scan.notes} 
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textAlign: 'left', boxSizing: 'border-box' }}
              onChange={e => setScan(s => ({ ...s, notes: e.target.value }))} disabled={isReadOnly} />
          </div>

          <button className="btn btn-primary" style={{ width: '100%' }} onClick={recordScan} disabled={saving || !scan.barcode || !selectedStage || isReadOnly}>
            {saving ? <FaSpinner /> : <FaSave />} {isReadOnly ? "View Only" : "Record Scan"}
          </button>
          {isReadOnly && <p style={{ color: '#e74c3c', fontSize: 12, marginTop: 8, textAlign: 'center' }}>You have view-only access.</p>}
        </div>

        {/* Events at Selected Stage */}
        <div className="ims-panel ims-events-panel">
          <div className="ims-panel-header">
            <h3 className="ims-panel-title-no-margin"><FaClipboardList /> Events at {selectedStage?.name}</h3>
          </div>

          {/* Summary Row */}
          {selectedStage && (() => {
            const s = getStageSummary(selectedStage.name);
            return (
              <div className="ims-metrics-row">
                {[{ label: 'Forwarded', val: s.forward, color: '#27ae60' }, { label: 'Rework', val: s.rework, color: '#e67e22' }, { label: 'Rejected', val: s.reject, color: '#e74c3c' }].map((k, i) => (
                  <div key={i} className="ims-metric-card" style={{ borderLeftColor: k.color }}>
                    <div className="ims-metric-val" style={{ color: k.color }}>{k.val}</div>
                    <div className="ims-metric-lbl">{k.label}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="table-container ims-table-container">
            <table className="table">
              <thead><tr><th>Barcode</th><th>Item</th><th>Outcome</th><th>Qty</th><th>Batch</th><th>Operator</th><th>Time</th></tr></thead>
              <tbody>
                {stageEvents.length === 0 && <tr><td colSpan={7} className="ims-empty-table-cell">No events at this stage yet.</td></tr>}
                {stageEvents.map((ev, i) => {
                  const o = OUTCOMES.find(x => x.value === ev.outcome) || OUTCOMES[0];
                  return (
                    <tr key={i}>
                      <td><code className="ims-code-barcode">{ev.barcode}</code></td>
                      <td>{ev.item_name}</td>
                      <td><span className="ims-outcome-badge" style={{ background: o.bg, color: o.color }}>{o.label}</span></td>
                      <td>{ev.qty}</td>
                      <td className="ims-text-muted-sm">{ev.batch_no || '—'}</td>
                      <td className="ims-text-sm">{ev.operator_name || '—'}</td>
                      <td className="ims-text-muted-sm">{ev.created_at?.replace('T', ' ').slice(0, 16)}</td>
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
