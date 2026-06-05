import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  FaFileExcel, FaTimes, FaCheck, FaArrowRight,
  FaExclamationTriangle, FaSpinner, FaCheckCircle,
  FaInfoCircle, FaTag
} from 'react-icons/fa';
import './ImportMapper.css';

// IMS known fields with display info
const IMS_FIELDS = [
  { key: 'barcode',      label: 'Barcode / SKU',    required: true,  hint: 'Unique product code or barcode' },
  { key: 'name',         label: 'Product Name',      required: true,  hint: 'Full name of the product' },
  { key: 'category',     label: 'Category / Group',  required: false, hint: 'Product category or group' },
  { key: 'stock',        label: 'Opening Stock',     required: false, hint: 'Current quantity in stock' },
  { key: 'baseUnit',     label: 'Unit of Measure',   required: false, hint: 'Unit (Pcs, Kg, Box, etc.)' },
  { key: 'supplier',     label: 'Supplier / Vendor', required: false, hint: 'Supplier or vendor name' },
  { key: 'cost',         label: 'Cost / Price',      required: false, hint: 'Unit cost or purchase price' },
  { key: 'alertAt',      label: 'Reorder Level',     required: false, hint: 'Alert when stock drops below this' },
  { key: 'trackingMode', label: 'Tracking Mode',     required: false, hint: 'FIFO, FEFO, or LIFO' },
  { key: 'weight',       label: 'Weight',            required: false, hint: 'Item weight' },
];

// Smart auto-suggest: score how likely a column maps to a known field
const FIELD_KEYWORDS = {
  barcode:      ['barcode','sku','code','item code','id','itemid','product code','article','part no','part number','item no'],
  name:         ['name','product','description','item name','product name','item description','article name','title','product title'],
  category:     ['category','cat','group','type','class','section','department','division','family'],
  stock:        ['stock','qty','quantity','opening stock','on hand','available','inventory','balance','units','count'],
  baseUnit:     ['unit','uom','uom code','base unit','unit of measure','pack size','measure'],
  supplier:     ['supplier','vendor','brand','manufacturer','make','source','distributor'],
  cost:         ['cost','price','rate','unit cost','mrp','unit price','purchase price','value'],
  alertAt:      ['alert','reorder','min stock','minimum','reorder level','safety stock','threshold','min qty'],
  trackingMode: ['tracking','mode','method','tracking mode','fifo','fefo','lifo'],
  weight:       ['weight','mass','grams','kg','net weight','gross weight'],
};

function scoreMatch(colName, fieldKey) {
  const col = colName.toLowerCase().replace(/[_\-\.]/g, ' ').trim();
  const keywords = FIELD_KEYWORDS[fieldKey] || [];
  for (const kw of keywords) {
    if (col === kw) return 100;
    if (col.includes(kw) || kw.includes(col)) return 70;
  }
  return 0;
}

function autoSuggestMapping(columns) {
  const mapping = {};
  const usedCols = new Set();

  // For each IMS field, find the best matching column
  for (const field of IMS_FIELDS) {
    let best = null, bestScore = 0;
    for (const col of columns) {
      if (usedCols.has(col)) continue;
      const score = scoreMatch(col, field.key);
      if (score > bestScore) { bestScore = score; best = col; }
    }
    if (best && bestScore >= 70) {
      mapping[field.key] = best;
      usedCols.add(best);
    } else {
      mapping[field.key] = ''; // not mapped
    }
  }
  return mapping;
}

export default function ImportMapper({ masterId, imsFetch, onComplete, onClose }) {
  const [step, setStep] = useState('upload'); // upload | map | importing | done | error
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const parseFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!parsed.length) { setErrorMsg('The file appears to be empty.'); setStep('error'); return; }
      const cols = Object.keys(parsed[0]);
      const suggested = autoSuggestMapping(cols);
      setRows(parsed);
      setColumns(cols);
      setMapping(suggested);
      setStep('map');
    };
    reader.readAsBinaryString(file);
  }, []);

  const handleImport = async () => {
    // Validate: barcode and name must be mapped
    if (!mapping.barcode) { alert('Please map the Barcode / SKU column before importing.'); return; }
    if (!mapping.name) { alert('Please map the Product Name column before importing.'); return; }

    setStep('importing');
    try {
      const res = await imsFetch(`/api/ims/masters/${masterId}/import`, {
        method: 'POST',
        body: JSON.stringify({ rows, mapping })
      });
      const data = await res.json();
      if (data.success) {
        setResult(data);
        setStep('done');
        onComplete && onComplete(data);
      } else {
        setErrorMsg(data.error || 'Import failed');
        setStep('error');
      }
    } catch (err) {
      setErrorMsg('Network error — please try again.');
      setStep('error');
    }
  };

  // Columns not mapped to any IMS field = stored as custom_fields
  const mappedCols = new Set(Object.values(mapping).filter(Boolean));
  const customCols = columns.filter(c => !mappedCols.has(c));
  const previewRows = rows.slice(0, 3);

  return (
    <div className="import-mapper-overlay" onClick={onClose}>
      <div className="import-mapper-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="im-header">
          <div className="im-header-left">
            <FaFileExcel className="im-header-icon" />
            <div>
              <div className="im-header-title">Universal Excel / CSV Importer</div>
              <div className="im-header-sub">
                {step === 'upload' && 'Upload any Excel or CSV file — any column structure accepted'}
                {step === 'map' && `${rows.length} rows detected · ${columns.length} columns found in "${fileName}"`}
                {step === 'importing' && 'Importing your data…'}
                {step === 'done' && 'Import complete!'}
                {step === 'error' && 'Import failed'}
              </div>
            </div>
          </div>
          <button className="im-close-btn" onClick={onClose}><FaTimes /></button>
        </div>

        {/* Step indicators */}
        <div className="im-steps">
          {['Upload', 'Map Columns', 'Import'].map((s, i) => (
            <div key={s} className={`im-step ${
              (step === 'upload' && i === 0) ||
              (step === 'map' && i === 1) ||
              (['importing','done','error'].includes(step) && i === 2) ? 'active' : ''
            } ${
              (step === 'map' && i === 0) ||
              (['importing','done','error'].includes(step) && i <= 1) ? 'done' : ''
            }`}>
              <div className="im-step-dot">{
                (step === 'map' && i === 0) ||
                (['importing','done','error'].includes(step) && i <= 1) ?
                <FaCheck /> : i + 1
              }</div>
              <div className="im-step-label">{s}</div>
            </div>
          ))}
        </div>

        <div className="im-body">

          {/* ── STEP 1: Upload ── */}
          {step === 'upload' && (
            <div
              className={`im-dropzone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); parseFile(e.dataTransfer.files[0]); }}
              onClick={() => document.getElementById('im-file-input').click()}
            >
              <input
                type="file"
                id="im-file-input"
                style={{ display: 'none' }}
                accept=".csv,.xlsx,.xls"
                onChange={e => parseFile(e.target.files[0])}
              />
              <FaFileExcel className="im-dz-icon" />
              <div className="im-dz-title">Drop your Excel or CSV file here</div>
              <div className="im-dz-sub">or click to browse · .xlsx, .xls, .csv supported</div>
              <div className="im-dz-note">
                Any column names are accepted — you'll map them in the next step
              </div>
            </div>
          )}

          {/* ── STEP 2: Map Columns ── */}
          {step === 'map' && (
            <div className="im-map-layout">
              {/* Left: mapping table */}
              <div className="im-map-left">
                <div className="im-map-section-title">
                  Map your Excel columns to IMS fields
                  <span className="im-map-section-sub">Required: Barcode + Name. Everything else is optional.</span>
                </div>

                <div className="im-map-table">
                  <div className="im-map-row im-map-thead">
                    <div>IMS Field</div>
                    <div></div>
                    <div>Your Excel Column</div>
                  </div>

                  {IMS_FIELDS.map(field => (
                    <div key={field.key} className={`im-map-row ${field.required ? 'required' : ''}`}>
                      <div className="im-map-field">
                        <span className="im-map-field-name">
                          {field.label}
                          {field.required && <span className="im-req-badge">Required</span>}
                        </span>
                        <span className="im-map-field-hint">{field.hint}</span>
                      </div>

                      <FaArrowRight className="im-map-arrow" />

                      <div className="im-map-select-wrap">
                        <select
                          className={`im-map-select ${mapping[field.key] ? 'mapped' : ''}`}
                          value={mapping[field.key] || ''}
                          onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                        >
                          <option value="">— Not mapped —</option>
                          {columns.map(col => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                        {mapping[field.key] && (
                          <FaCheck className="im-map-check" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Custom columns badge */}
                {customCols.length > 0 && (
                  <div className="im-custom-cols">
                    <FaTag className="im-custom-icon" />
                    <div>
                      <div className="im-custom-title">{customCols.length} columns will be stored as Custom Fields</div>
                      <div className="im-custom-list">
                        {customCols.map(c => <span key={c} className="im-custom-badge">{c}</span>)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: data preview */}
              <div className="im-map-right">
                <div className="im-map-section-title">Data Preview (first 3 rows)</div>
                <div className="im-preview-scroll">
                  <table className="im-preview-table">
                    <thead>
                      <tr>
                        {columns.map(col => (
                          <th key={col}>
                            {col}
                            {Object.values(mapping).includes(col) && (
                              <div className="im-preview-mapped-to">
                                → {IMS_FIELDS.find(f => mapping[f.key] === col)?.label}
                              </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i}>
                          {columns.map(col => (
                            <td key={col}>{String(row[col] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="im-preview-count">
                  Showing 3 of {rows.length} rows · {columns.length} columns detected
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Importing ── */}
          {step === 'importing' && (
            <div className="im-status-screen">
              <FaSpinner className="im-spin-icon spin" />
              <div className="im-status-title">Importing {rows.length} rows…</div>
              <div className="im-status-sub">Processing in a single batch operation — this is fast!</div>
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && result && (
            <div className="im-status-screen">
              <FaCheckCircle className="im-done-icon" />
              <div className="im-done-title">Import Complete!</div>
              <div className="im-done-stats">
                <div className="im-done-stat green">
                  <div className="im-done-num">{result.imported}</div>
                  <div>Products imported</div>
                </div>
                {result.skipped > 0 && (
                  <div className="im-done-stat orange">
                    <div className="im-done-num">{result.skipped}</div>
                    <div>Rows skipped</div>
                  </div>
                )}
                {result.customColumns?.length > 0 && (
                  <div className="im-done-stat blue">
                    <div className="im-done-num">{result.customColumns.length}</div>
                    <div>Custom fields saved</div>
                  </div>
                )}
              </div>
              {result.customColumns?.length > 0 && (
                <div className="im-done-custom">
                  <FaInfoCircle /> Custom fields stored: {result.customColumns.join(', ')}
                </div>
              )}
              <button className="im-done-btn" onClick={onClose}>Close & View Catalog</button>
            </div>
          )}

          {/* ── ERROR ── */}
          {step === 'error' && (
            <div className="im-status-screen">
              <FaExclamationTriangle className="im-error-icon" />
              <div className="im-done-title" style={{ color: '#e74c3c' }}>Import Failed</div>
              <div className="im-status-sub">{errorMsg}</div>
              <button className="im-btn-secondary" onClick={() => setStep('upload')}>Try Again</button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {step === 'map' && (
          <div className="im-footer">
            <button className="im-btn-secondary" onClick={() => setStep('upload')}>← Change File</button>
            <div className="im-footer-info">
              <FaInfoCircle />
              <span>{rows.length} rows · Unmapped columns saved as custom fields</span>
            </div>
            <button
              className="im-btn-primary"
              onClick={handleImport}
              disabled={!mapping.barcode || !mapping.name}
            >
              Import {rows.length} Products <FaArrowRight />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
