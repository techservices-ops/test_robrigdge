import React, { useState, useEffect, useCallback } from 'react';
import {
  FaChartBar, FaDownload, FaSync, FaFilter,
  FaBoxes, FaExchangeAlt, FaExclamationTriangle, FaHistory, FaSpinner
} from 'react-icons/fa';
import './IMSReports.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import * as XLSX from 'xlsx';

const TABS = [
  { key: 'scan',     label: 'Scan History',    icon: FaHistory },
  { key: 'stock',    label: 'Stock Summary',   icon: FaBoxes },
  { key: 'movement', label: 'Movement Report', icon: FaExchangeAlt },
  { key: 'lowstock', label: 'Low Stock',       icon: FaExclamationTriangle },
  { key: 'wastage',  label: 'Wastage Analysis',icon: FaChartBar },
];

export default function IMSReports() {
  const { imsFetch, activeWorkspaceId } = useWorkspace();
  const [tab, setTab] = useState('scan');
  const [data, setData] = useState({ scan: [], stock: [], movement: [], lowstock: [], wastage: [], stockTotals: null });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ from: '', to: '', workflow: '', barcode: '', days: 30 });

  const load = useCallback(async (t) => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const active = t || tab;
      if (active === 'scan') {
        const params = new URLSearchParams();
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (filters.workflow) params.set('workflow', filters.workflow);
        if (filters.barcode) params.set('barcode', filters.barcode);
        const r = await imsFetch(`/api/ims/reports/scan-history?${params}`);
        const d = await r.json();
        if (d.success) setData(prev => ({ ...prev, scan: d.events }));
      } else if (active === 'stock') {
        const r = await imsFetch('/api/ims/reports/stock-summary');
        const d = await r.json();
        if (d.success) setData(prev => ({ ...prev, stock: d.items, stockTotals: d.totals }));
      } else if (active === 'movement') {
        const r = await imsFetch(`/api/ims/reports/movement?days=${filters.days}`);
        const d = await r.json();
        if (d.success) setData(prev => ({ ...prev, movement: d.movements }));
      } else if (active === 'lowstock') {
        const r = await imsFetch('/api/ims/reports/low-stock');
        const d = await r.json();
        if (d.success) setData(prev => ({ ...prev, lowstock: d.items }));
      } else if (active === 'wastage') {
        const r = await imsFetch('/api/ims/reports/wastage');
        const d = await r.json();
        if (d.success) setData(prev => ({ ...prev, wastage: d.wastage }));
      }
    } finally { setLoading(false); }
  }, [activeWorkspaceId, tab, filters, imsFetch]);

  useEffect(() => { load(); }, [tab, activeWorkspaceId]);

  const exportXLSX = (rows, filename) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, filename + '.xlsx');
  };

  const exportScan = () => exportXLSX(data.scan.map(e => ({
    Date: e.scanned_at?.replace('T', ' ').slice(0, 16),
    Barcode: e.barcode, Item: e.item_name, Action: e.workflow,
    Qty: e.quantity, 'Batch No': e.batch_no, 'Serial No': e.serial_no,
    Operator: e.operator, Notes: e.notes
  })), 'ScanHistory');

  const exportStock = () => exportXLSX(data.stock.map(i => ({
    Barcode: i.barcode, Name: i.name, Category: i.category,
    Stock: i.stock, Unit: i.unit, Supplier: i.supplier,
    'Unit Cost': i.cost, 'Total Value': i.total_value, 'Last Movement': i.last_movement?.split('T')[0]
  })), 'StockSummary');

  return (
    <div className="ims-reports-page">
      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Reports &amp; Analytics</h1>
          <p>Export scan history, stock summaries, movement reports, and low stock alerts</p>
        </div>
        <div className="ims-header-right ims-flex-gap-10">
          <button className="btn btn-secondary" onClick={() => load()}>
            <FaSync /> Refresh
          </button>
          {tab === 'scan' && <button className="btn btn-secondary" onClick={exportScan}><FaDownload /> Export Excel</button>}
          {tab === 'stock' && <button className="btn btn-secondary" onClick={exportStock}><FaDownload /> Export Excel</button>}
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f0f2f5', borderRadius: 12, padding: 4 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); load(t.key); }}
            style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14,
              background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#E3821E' : '#666',
              boxShadow: tab === t.key ? '0 2px 8px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <t.icon /> {t.label}
          </button>
        ))}
      </div>

      {/* Scan History Filters */}
      {tab === 'scan' && (
        <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">From Date</label>
            <input type="date" className="form-input" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">To Date</label>
            <input type="date" className="form-input" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Action / Workflow</label>
            <input className="form-input" placeholder="RECEIVE, DISPATCH..." value={filters.workflow} onChange={e => setFilters(f => ({ ...f, workflow: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Barcode Search</label>
            <input className="form-input" placeholder="Search barcode..." value={filters.barcode} onChange={e => setFilters(f => ({ ...f, barcode: e.target.value }))} />
          </div>
          <button className="btn btn-primary" style={{ height: '40px', padding: '0 18px', whiteSpace: 'nowrap', flexShrink: 0, marginBottom: '16px' }} onClick={() => load('scan')}><FaFilter /> Apply</button>
        </div>

      )}

      {tab === 'movement' && (
        <div className="movement-filter-bar">
          <span className="movement-filter-label">Date Range</span>
          <div className="movement-filter-row">
            <select
              className="movement-filter-select"
              value={filters.days}
              onChange={e => setFilters(f => ({ ...f, days: e.target.value }))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last 12 months</option>
            </select>
            <button className="btn btn-primary movement-apply-btn" onClick={() => load('movement')}>
              <FaFilter /> Apply
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}><FaSpinner style={{ fontSize: 32 }} /><br />Loading report...</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', overflow: 'hidden' }}>

          {/* Stock Totals Banner */}
          {tab === 'stock' && data.stockTotals && (
            <div style={{ display: 'flex', gap: 24, padding: '16px 20px', borderBottom: '1px solid #eee', background: '#fafbfc' }}>
              {[
                { label: 'Total SKUs', val: data.stockTotals.skus, color: '#3498db' },
                { label: 'Total Units', val: data.stockTotals.total_units, color: '#27ae60' },
                { label: 'Total Value', val: '₹' + Number(data.stockTotals.total_value).toLocaleString(), color: '#e67e22' },
              ].map((k, i) => (
                <div key={i}><div style={{ fontWeight: 700, fontSize: 22, color: k.color }}>{k.val}</div><div style={{ fontSize: 12, color: '#888' }}>{k.label}</div></div>
              ))}
            </div>
          )}

          {/* Scan History Table */}
          {tab === 'scan' && (
            <table className="table">
              <thead><tr><th>Date &amp; Time</th><th>Barcode</th><th>Item</th><th>Action</th><th>Qty</th><th>Batch No</th><th>Operator</th></tr></thead>
              <tbody>
                {data.scan.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>No scan events found.</td></tr>}
                {data.scan.map((e, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12 }}>{e.scanned_at?.replace('T', ' ').slice(0, 16)}</td>
                    <td><code style={{ fontSize: 12 }}>{e.barcode}</code></td>
                    <td>{e.item_name}</td>
                    <td><span style={{ background: e.workflow?.includes('DISPATCH') || e.workflow?.includes('ISSUE') ? '#fdf0ed' : '#eafaf1', color: e.workflow?.includes('DISPATCH') || e.workflow?.includes('ISSUE') ? '#e74c3c' : '#27ae60', padding: '3px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{e.workflow}</span></td>
                    <td style={{ fontWeight: 600 }}>{e.quantity}</td>
                    <td style={{ fontSize: 12, color: '#888' }}>{e.batch_no || '—'}</td>
                    <td style={{ fontSize: 12 }}>{e.operator || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Stock Summary Table */}
          {tab === 'stock' && (
            <table className="table">
              <thead><tr><th>Barcode</th><th>Name</th><th>Category</th><th>Stock</th><th>Unit</th><th>Supplier</th><th>Unit Cost</th><th>Total Value</th></tr></thead>
              <tbody>
                {data.stock.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>No items in catalog.</td></tr>}
                {data.stock.map((i, idx) => (
                  <tr key={idx}>
                    <td><code style={{ fontSize: 12 }}>{i.barcode}</code></td>
                    <td><strong>{i.name}</strong></td>
                    <td>{i.category}</td>
                    <td style={{ fontWeight: 700, color: i.stock === 0 ? '#e74c3c' : '#27ae60' }}>{i.stock}</td>
                    <td>{i.unit}</td>
                    <td style={{ fontSize: 12, color: '#888' }}>{i.supplier || '—'}</td>
                    <td>{i.cost ? '₹' + i.cost : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{i.cost ? '₹' + Number(i.total_value).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Movement Table */}
          {tab === 'movement' && (
            <table className="table">
              <thead><tr><th>Barcode</th><th>Item Name</th><th>Action</th><th>Total Qty</th><th>Events</th><th>Last Activity</th></tr></thead>
              <tbody>
                {data.movement.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>No movement data for this period.</td></tr>}
                {data.movement.map((m, i) => (
                  <tr key={i}>
                    <td><code style={{ fontSize: 12 }}>{m.barcode}</code></td>
                    <td>{m.item_name}</td>
                    <td><span style={{ background: '#eaf4fb', color: '#2980b9', padding: '3px 8px', borderRadius: 10, fontSize: 12 }}>{m.workflow}</span></td>
                    <td style={{ fontWeight: 700 }}>{m.total_qty}</td>
                    <td style={{ color: '#888' }}>{m.event_count}</td>
                    <td style={{ fontSize: 12, color: '#888' }}>{m.last_event?.split('T')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Wastage Analysis Table */}
          {tab === 'wastage' && (
            <table className="table">
              <thead><tr><th>Barcode</th><th>Item</th><th>Work Order</th><th>Wasted Qty</th><th>Incidents</th></tr></thead>
              <tbody>
                {data.wastage.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>✅ No wastage or rejections recorded.</td></tr>}
                {data.wastage.map((w, i) => (
                  <tr key={i}>
                    <td><code style={{ fontSize: 12 }}>{w.barcode}</code></td>
                    <td><strong>{w.item_name}</strong></td>
                    <td style={{ color: '#888', fontSize: 12 }}>{w.wo_number || '—'}</td>
                    <td style={{ fontWeight: 700, color: '#e74c3c' }}>{w.wasted_qty}</td>
                    <td style={{ color: '#888' }}>{w.incident_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Low Stock Table */}
          {tab === 'lowstock' && (
            <table className="table">
              <thead><tr><th>Barcode</th><th>Name</th><th>Category</th><th>Current Stock</th><th>Threshold</th><th>Shortfall</th><th>Urgency</th></tr></thead>
              <tbody>
                {data.lowstock.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>✅ No low stock items! All products are above threshold.</td></tr>}
                {data.lowstock.map((i, idx) => {
                  const shortfall = i.threshold - i.stock;
                  const critical = i.stock === 0;
                  return (
                    <tr key={idx}>
                      <td><code style={{ fontSize: 12 }}>{i.barcode}</code></td>
                      <td><strong>{i.name}</strong></td>
                      <td>{i.category}</td>
                      <td style={{ fontWeight: 700, color: critical ? '#e74c3c' : '#e67e22' }}>{i.stock}</td>
                      <td style={{ color: '#888' }}>{i.threshold}</td>
                      <td style={{ color: '#e74c3c', fontWeight: 600 }}>-{shortfall}</td>
                      <td><span style={{ background: critical ? '#fdf0ed' : '#fef9e7', color: critical ? '#e74c3c' : '#e67e22', padding: '3px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{critical ? '🔴 OUT OF STOCK' : '🟡 LOW'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
