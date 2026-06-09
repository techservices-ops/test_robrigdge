import React, { useState } from 'react';
import { FaSync, FaDownload, FaUpload, FaPlug } from 'react-icons/fa';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useToast } from '../components/Toast';

export default function IMSErp() {
  const { imsFetch } = useWorkspace();
  const showToast = useToast();
  const [loading, setLoading] = useState(false);
  const [stockData, setStockData] = useState([]);
  const [poJson, setPoJson] = useState('{\n  "doc_no": "PO-2024-001",\n  "items": [\n    { "barcode": "SKU001", "name": "Item A", "qty": 100 }\n  ]\n}');

  const syncStock = async () => {
    setLoading(true);
    try {
      const res = await imsFetch('/api/ims/erp/sync', {
        method: 'POST',
        body: JSON.stringify({ action: 'SYNC_STOCK', payload: {} })
      });
      const d = await res.json();
      if (d.success) {
        setStockData(d.stock);
        showToast(`✅ Exported ${d.stock.length} SKUs for ERP`, 'success');
      } else {
        showToast(d.error || 'Sync failed', 'error');
      }
    } catch (e) {
      showToast('Failed to sync stock', 'error');
    }
    setLoading(false);
  };

  const importPO = async () => {
    let payload;
    try { payload = JSON.parse(poJson); } catch(e) {
      showToast('Invalid JSON in PO payload', 'error'); return;
    }
    setLoading(true);
    try {
      const res = await imsFetch('/api/ims/erp/sync', {
        method: 'POST',
        body: JSON.stringify({ action: 'IMPORT_PO', payload })
      });
      const d = await res.json();
      if (d.success) {
        showToast(`PO ${payload.doc_no} imported as GRN successfully`, 'success');
      } else {
        showToast(d.error || 'Import failed', 'error');
      }
    } catch (e) {
      showToast('Failed to import PO', 'error');
    }
    setLoading(false);
  };

  const downloadStockCSV = () => {
    if (!stockData.length) return;
    const headers = ['barcode', 'name', 'stock', 'cost'];
    const rows = stockData.map(i => headers.map(h => i[h] ?? '').join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'stock_export.csv'; a.click();
  };

  return (
    <div style={{ padding: 0, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div className="page-header ims-page-header" style={{ marginBottom: 16 }}>
        <div className="ims-header-left">
          <h1>ERP Integration</h1>
          <p>Sync stock data and import Purchase Orders from SAP, Tally, or any external system</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Export Stock */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FaDownload style={{ color: '#E3821E' }} />
            <h3 style={{ margin: 0 }}>Export Stock to ERP</h3>
          </div>
          <div className="card-body">
            <p style={{ color: '#666', fontSize: 14 }}>
              Pull current inventory levels and push them to your ERP system via API or download as CSV.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button className="btn btn-primary" onClick={syncStock} disabled={loading}>
                <FaSync /> {loading ? 'Syncing...' : 'Pull Stock Data'}
              </button>
              {stockData.length > 0 && (
                <button className="btn btn-secondary" onClick={downloadStockCSV}>
                  <FaDownload /> Download CSV ({stockData.length} SKUs)
                </button>
              )}
            </div>
            {stockData.length > 0 && (
              <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead><tr><th>Barcode</th><th>Name</th><th>Stock</th><th>Cost</th></tr></thead>
                  <tbody>
                    {stockData.map((s, i) => (
                      <tr key={i}>
                        <td><code>{s.barcode}</code></td>
                        <td>{s.name}</td>
                        <td style={{ fontWeight: 600, color: s.stock === 0 ? '#e74c3c' : '#27ae60' }}>{s.stock}</td>
                        <td>{s.cost ? '₹' + s.cost : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Import PO */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FaUpload style={{ color: '#E3821E' }} />
            <h3 style={{ margin: 0 }}>Import Purchase Order</h3>
          </div>
          <div className="card-body">
            <p style={{ color: '#666', fontSize: 14 }}>
              Paste a PO payload from SAP/Tally/ERP as JSON. It will be imported as a pending GRN.
            </p>
            <div className="form-group">
              <label className="form-label">PO Payload (JSON)</label>
              <textarea
                className="form-textarea"
                style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 180 }}
                value={poJson}
                onChange={e => setPoJson(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={importPO} disabled={loading}>
              <FaUpload /> {loading ? 'Importing...' : 'Import as GRN'}
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FaPlug style={{ color: '#E3821E' }} />
          <h3 style={{ margin: 0 }}>API Webhook Reference</h3>
        </div>
        <div className="card-body">
          <p style={{ color: '#555', fontSize: 14, marginBottom: 12 }}>
            Use these endpoints to integrate RoBridge IMS with any external system:
          </p>
          <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 13, color: '#cdd6f4' }}>
            <div style={{ color: '#89dceb' }}>POST</div>
            <div>/api/ims/erp/sync</div>
            <div style={{ color: '#a6e3a1', marginTop: 12 }}>// Export all stock to ERP</div>
            <div>{'{ "action": "SYNC_STOCK", "payload": {} }'}</div>
            <div style={{ color: '#a6e3a1', marginTop: 12 }}>// Import Purchase Order as pending GRN</div>
            <div>{'{ "action": "IMPORT_PO", "payload": { "doc_no": "PO-001", "items": [...] } }'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
