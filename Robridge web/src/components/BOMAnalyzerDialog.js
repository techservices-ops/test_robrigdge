import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FaUpload, FaSpinner, FaTimes, FaClipboardList,
  FaCheck, FaExclamationTriangle, FaTimesCircle, FaDownload
} from 'react-icons/fa';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './BOMAnalyzerDialog.css';

export default function BOMAnalyzerDialog({ isOpen, onClose }) {
  const { imsFetch } = useWorkspace();
  const [bomAnalyzing, setBomAnalyzing] = useState(false);
  const [bomDragOver, setBomDragOver] = useState(false);
  const [bomReport, setBomReport] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleBomUpload = async (file) => {
    if (!file) return;
    setBomAnalyzing(true);
    setErrorMsg('');
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        if (!wb.SheetNames || wb.SheetNames.length === 0) {
          throw new Error('Excel file appears to be empty or corrupted.');
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        
        if (rows.length === 0) {
          throw new Error('No data rows found in sheet.');
        }

        const items = rows.map(r => ({
          sku: String(r.SKU || r.sku || r.Barcode || r.barcode || '').trim(),
          needed: Number(r.Qty || r.qty || r.Needed || r.needed || r.Quantity || 1)
        })).filter(r => r.sku);

        if (items.length === 0) {
          throw new Error('No valid rows containing SKU, Barcode, or Qty headers.');
        }

        const res = await imsFetch('/api/ims/bom/analyze', {
          method: 'POST',
          body: JSON.stringify({ items })
        });
        const data = await res.json();
        
        if (data.success) {
          setBomReport(data.report);
        } else {
          setErrorMsg(data.error || 'BOM analysis failed.');
        }
      } catch (err) {
        console.error(err);
        setErrorMsg(err.message || 'Failed to process file. Ensure it is a valid Excel/CSV.');
      } finally {
        setBomAnalyzing(false);
      }
    };

    reader.onerror = () => {
      setErrorMsg('Error reading file.');
      setBomAnalyzing(false);
    };

    reader.readAsBinaryString(file);
  };

  const handleExport = () => {
    if (!bomReport || !bomReport.items || bomReport.items.length === 0) return;
    
    const rows = bomReport.items.map(i => ({
      'SKU / Barcode': i.sku,
      'Item Name': i.name,
      'Required Quantity': i.needed,
      'Available Quantity': i.available,
      'Status': i.status === 'ok' ? 'Fully Available' : i.status === 'shortage' ? 'Shortage' : 'Not in Catalog',
      'Difference (Deficit)': i.diff
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOM Analysis');
    XLSX.writeFile(wb, `BOM_Analysis_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return (
    <div className="bom-drawer-overlay" onClick={onClose}>
      <div className="bom-drawer" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bom-drawer-header">
          <div className="header-icon-wrap">
            <FaClipboardList className="bom-header-icon" />
          </div>
          <div className="header-text-wrap">
            <h2>BOM Inventory Analyzer</h2>
            <p>Upload a customer BOM to cross-reference stock levels across all master catalogs</p>
          </div>
          <button className="bom-drawer-close" onClick={onClose}>
            <FaTimes />
          </button>
        </div>

        {/* Body */}
        <div className="bom-drawer-body">
          {errorMsg && (
            <div className="bom-error-alert">
              <FaExclamationTriangle />
              <span>{errorMsg}</span>
            </div>
          )}

          {!bomReport && !bomAnalyzing && (
            <div
              className={`bom-upload-zone ${bomDragOver ? 'drag-over' : ''}`}
              onDragOver={e => {
                e.preventDefault();
                setBomDragOver(true);
              }}
              onDragLeave={() => setBomDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setBomDragOver(false);
                if (e.dataTransfer.files[0]) handleBomUpload(e.dataTransfer.files[0]);
              }}
              onClick={() => document.getElementById('bomDrawerUploadInput').click()}
            >
              <input
                type="file"
                id="bomDrawerUploadInput"
                style={{ display: 'none' }}
                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                onChange={e => e.target.files?.[0] && handleBomUpload(e.target.files[0])}
              />
              <FaUpload className="bom-upload-icon" />
              <div className="bom-upload-text">Upload Customer BOM (Excel/CSV)</div>
              <div className="bom-upload-sub">Click or drag & drop file to analyze</div>
            </div>
          )}

          {bomAnalyzing && (
            <div className="bom-analyzing-state">
              <FaSpinner className="bom-spin-icon" />
              <p>Cross-referencing Global Catalog...</p>
            </div>
          )}

          {bomReport && (
            <div className="bom-report-section">
              {/* KPIs */}
              <div className="bom-report-kpis">
                <div className="kpi-box total">
                  <div className="kpi-num">{bomReport.total}</div>
                  <div className="kpi-label">Total SKUs</div>
                </div>
                <div className="kpi-box ok">
                  <div className="kpi-num">{bomReport.ok}</div>
                  <div className="kpi-label">Available</div>
                </div>
                <div className="kpi-box shortage">
                  <div className="kpi-num">{bomReport.shortage}</div>
                  <div className="kpi-label">Shortage</div>
                </div>
                <div className="kpi-box missing">
                  <div className="kpi-num">{bomReport.missing}</div>
                  <div className="kpi-label">Missing</div>
                </div>
              </div>

              {/* Breakdown */}
              <h3 className="section-title">Analysis Breakdown</h3>
              <div className="bom-table-container">
                <table className="bom-analysis-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Item Name</th>
                      <th>Required</th>
                      <th>Available</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomReport.items.map((i, idx) => (
                      <tr key={idx}>
                        <td className="sku-cell"><code>{i.sku}</code></td>
                        <td className="name-cell">{i.name}</td>
                        <td className="qty-cell">{i.needed}</td>
                        <td className={`qty-cell ${i.status === 'ok' ? 'text-ok' : i.available === 0 ? 'text-missing' : 'text-shortage'}`}>
                          {i.available}
                        </td>
                        <td>
                          {i.status === 'ok' && (
                            <span className="badge status-ok">
                              <FaCheck /> Fully Available
                            </span>
                          )}
                          {i.status === 'shortage' && (
                            <span className="badge status-shortage">
                              <FaExclamationTriangle /> Shortage ({i.diff})
                            </span>
                          )}
                          {i.status === 'missing' && (
                            <span className="badge status-missing">
                              <FaTimesCircle /> Not in Catalog
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {bomReport && (
          <div className="bom-drawer-footer">
            <button className="bom-btn-secondary" onClick={() => setBomReport(null)}>
              Reset
            </button>
            <button className="bom-btn-primary" onClick={handleExport}>
              <FaDownload /> Export Excel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
