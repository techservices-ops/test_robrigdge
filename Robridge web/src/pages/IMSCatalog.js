import React, { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import * as XLSX from 'xlsx';
import {
  FaSearch, FaPlus, FaEdit, FaTrash, FaUpload,
  FaFilter, FaDownload, 
  FaFileExcel, FaTimes, FaSave, FaLayerGroup,
  FaCubes, FaMagic, FaFolderPlus, FaArrowLeft, FaFolderOpen,
  FaClipboardList
} from 'react-icons/fa';
import './IMSCatalog.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useConfirm } from '../components/ConfirmModal';
import ImportMapper from '../components/ImportMapper';

const trackingColors = { FEFO: '#e74c3c', FIFO: '#3498db', LIFO: '#27ae60' };

const emptyForm = { barcode: '', name: '', category: 'General', baseUnit: 'Unit', stock: '', trackingMode: 'FIFO', parentBarcode: '', multiplier: '', supplier: '', locations: [{zone: '', qty: ''}], bom: [], weight: '', cost: '', itemType: 'Raw Material' };
const ITEM_TYPES = ['Raw Material', 'Finished Product'];
const DEFAULT_CATEGORIES = ['All', 'Pharmacy', 'PPE', 'Hygiene', 'General', 'Electronics', 'Food & Beverage'];

const IMSCatalog = () => {
  const { imsFetch, activeWorkspaceId } = useWorkspace();
  const confirm = useConfirm();

  const [masters, setMasters] = useState([]);
  const [activeMaster, setActiveMaster] = useState(null);
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [masterForm, setMasterForm] = useState({ name: '', description: '', category: 'All' });
  const [, setLoading] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [, setWorkflows] = useState(['RECEIVE', 'DISPATCH', 'PUTAWAY', 'PICK', 'RETURN']);

  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [activeTab, setActiveTab] = useState('general');
  const [showImporter, setShowImporter] = useState(false);
  const [bomDragOver, setBomDragOver] = useState(false);
  
  const [showBomAnalyzer, setShowBomAnalyzer] = useState(false);
  const [bomAnalyzing, setBomAnalyzing] = useState(false);
  const [bomReport, setBomReport] = useState(null);

  const barcodeRef = useRef(null);

  // Load masters, dynamic categories & workflows on mount
  useEffect(() => {
    if (!activeWorkspaceId) return;
    imsFetch('/api/ims/masters')
      .then(r => r.json())
      .then(d => { if (d.success) setMasters(d.masters); })
      .catch(console.error);

    // Fetch dynamic categories from Settings
    imsFetch('/api/ims/categories')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.categories.length > 0) {
          const dynamicCats = d.categories.map(c => c.name);
          // Merge dynamic with defaults, keeping 'All' at front
          const merged = ['All', ...new Set([...dynamicCats])];
          setCategories(merged);
        }
      })
      .catch(console.error);

    // Fetch dynamic workflows from Settings
    imsFetch('/api/ims/workflows')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.workflows.length > 0) {
          setWorkflows(d.workflows.map(w => w.name));
        }
      })
      .catch(console.error);
  }, [activeWorkspaceId, imsFetch]);

  // Load items when master selected
  useEffect(() => {
    if (!activeWorkspaceId || !activeMaster) return;
    setLoading(true);
    imsFetch(`/api/ims/masters/${activeMaster.id}/items`)
      .then(r => r.json())
      .then(d => { if (d.success) setProducts(d.items); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeMaster, activeWorkspaceId, imsFetch]);

  useEffect(() => {
    if (form.barcode && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, form.barcode, {
          format: 'CODE128', displayValue: true, height: 40, width: 1.5, margin: 0, fontSize: 14
        });
      } catch (err) {}
    }
  }, [form.barcode, activeTab, showModal]);

  const openAdd = () => { setForm(emptyForm); setEditProduct(null); setActiveTab('general'); setShowModal(true); };
  const openEdit = (p) => { setForm({ ...p, multiplier: p.multiplier || '', parentBarcode: p.parentBarcode || '' }); setEditProduct(p); setActiveTab('general'); setShowModal(true); };

  const handleDelete = async (id) => {
    if (!activeMaster) return;
    await imsFetch(`/api/ims/masters/${activeMaster.id}/items/${id}`, { method: 'DELETE' });
    setProducts(prev => prev.filter(p => p.id !== id));
    setMasters(prev => prev.map(m => m.id === activeMaster.id ? { ...m, count: Math.max(0, (m.count || 0) - 1) } : m));
  };

  const generateBarcode = () => setForm(f => ({ ...f, barcode: 'GEN-' + Math.floor(100000 + Math.random() * 900000) }));

  const handleSave = async () => {
    if (!form.barcode || !form.name || !activeMaster) return;
    const payload = { ...form, stock: Number(form.stock) || 0, multiplier: form.multiplier ? Number(form.multiplier) : null, masterId: activeMaster.id };
    if (editProduct) {
      const res = await imsFetch(`/api/ims/masters/${activeMaster.id}/items/${editProduct.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) setProducts(prev => prev.map(p => p.id === editProduct.id ? { ...payload, id: p.id } : p));
    } else {
      const res = await imsFetch(`/api/ims/masters/${activeMaster.id}/items`, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) {
        setProducts(prev => [...prev, data.item]);
        setMasters(prev => prev.map(m => m.id === activeMaster.id ? { ...m, count: (m.count || 0) + 1 } : m));
      }
    }
    setShowModal(false);
  };


  const handleBomUpload = async (file) => {
    if (!file) return;
    setBomAnalyzing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const items = rows.map(r => ({
        sku: String(r.SKU || r.sku || r.Barcode || r.barcode || '').trim(),
        needed: Number(r.Qty || r.qty || r.Needed || r.needed || r.Quantity || 1)
      })).filter(r => r.sku);
      const res = await imsFetch('/api/ims/bom/analyze', { method: 'POST', body: JSON.stringify({ items }) });
      const data = await res.json();
      if (data.success) setBomReport(data.report);
      setBomAnalyzing(false);
    };
    reader.readAsBinaryString(file);
  };


  const handleSaveMaster = async () => {
    if (!masterForm.name) return;
    try {
      const res = await imsFetch('/api/ims/masters', {
        method: 'POST',
        body: JSON.stringify(masterForm)
      });
      const data = await res.json();
      if (data.success) {
        setMasters(prev => [...prev, data.master]);
        setShowMasterModal(false);
        setMasterForm({ name: '', description: '', category: 'All' });
      }
    } catch (err) {
      console.error('Failed to create master catalog', err);
    }
  };

  const handleDeleteMaster = async (e, master) => {
    e.stopPropagation();
    const itemCount = products.filter(p => p.masterId === master.id).length;
    const ok = await confirm({
      title: `Delete "${master.name}"?`,
      message: itemCount > 0
        ? `This master contains ${itemCount} item(s). Deleting it will permanently remove ALL items inside it.`
        : `This will permanently delete the master catalog. This cannot be undone.`,
      type: 'danger',
      confirmLabel: itemCount > 0 ? `Delete (removes ${itemCount} items)` : 'Delete Master'
    });
    if (!ok) return;
    try {
      const res = await imsFetch(`/api/ims/masters/${master.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setMasters(prev => prev.filter(m => m.id !== master.id));
        setProducts(prev => prev.filter(p => p.masterId !== master.id));
      }
    } catch (err) {
      console.error('Failed to delete master', err);
    }
  };

  const activeProducts = products.filter(p => !activeMaster || !p.masterId || String(p.masterId) === String(activeMaster.id));
  const filtered = activeProducts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'All' || p.category === categoryFilter;
    return matchSearch && matchCat;
  });

  // Calculate dynamic custom columns from filtered products
  const customCols = Array.from(new Set(
    filtered.flatMap(p => Object.keys(p.customFields || {}))
  ));

  if (!activeMaster) {
    return (
      <div className="ims-catalog-page">
        <div className="page-header ims-page-header">
          <div className="ims-header-left">
            <h1>Master Catalogs</h1>
            <p>Select a master catalog to view and manage its products, or create a new one.</p>
          </div>
          <div className="ims-header-right" style={{gap: '10px', display: 'flex'}}>
            <button className="btn btn-secondary" onClick={() => setShowBomAnalyzer(true)} style={{borderColor: '#9b59b6', color: '#9b59b6'}}>
               <FaClipboardList /> BOM Analyzer
            </button>
            <button className="btn btn-primary" onClick={() => setShowMasterModal(true)}>
              <FaFolderPlus /> Create Master Catalog
            </button>
          </div>
        </div>

        <div className="masters-grid">
          {masters.map(m => {
            const prodCount = m.count || 0;
            return (
              <div key={m.id} className="master-card" onClick={() => setActiveMaster(m)} style={{ position: 'relative' }}>
                <div className="master-card-icon"><FaFolderOpen /></div>
                <div className="master-card-content">
                  <h3>{m.name}</h3>
                  <p>{m.description}</p>
                  <div className="master-card-footer">
                    <span className="master-category">{m.category !== 'All' ? m.category : 'General'}</span>
                    <span className="master-count">{prodCount} Items</span>
                  </div>
                </div>
                <button
                  className="icon-btn delete-btn"
                  title="Delete Master Catalog"
                  onClick={(e) => handleDeleteMaster(e, m)}
                  style={{
                    position: 'absolute', top: '10px', right: '10px',
                    opacity: 0.6, transition: 'opacity 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = 1}
                  onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                >
                  <FaTrash />
                </button>
              </div>
            );
          })}
        </div>

        {showMasterModal && (
          <div className="ims-modal-overlay" onClick={() => setShowMasterModal(false)}>
            <div className="ims-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div><h2>Create New Master</h2><p>Define a new separated catalog space</p></div>
                <button className="modal-close" onClick={() => setShowMasterModal(false)}><FaTimes /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Master Name *</label>
                  <input className="form-input" placeholder="e.g. Chemicals Master" value={masterForm.name} onChange={e => setMasterForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="form-input" placeholder="Brief details about this catalog" value={masterForm.description} onChange={e => setMasterForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Default Category</label>
                  <select className="form-select" value={masterForm.category} onChange={e => setMasterForm(f => ({ ...f, category: e.target.value }))}>
                    {categories.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowMasterModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveMaster}>Create Master</button>
              </div>
            </div>
          </div>
        )}

      {/* ── BOM ANALYZER MODAL ── */}
      {showBomAnalyzer && (
        <div className="ims-modal-overlay" onClick={() => { setShowBomAnalyzer(false); setBomReport(null); }}>
          <div className="ims-modal bom-analyzer-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
            <div className="modal-header" style={{borderBottom: '1px solid #eee', paddingBottom: '15px'}}>
              <FaClipboardList className="modal-icon" style={{ color: '#9b59b6', fontSize: '24px' }} />
              <div>
                 <h2 style={{margin: 0}}>BOM Inventory Feasibility Analyzer</h2>
                 <p style={{margin: 0, color: '#7f8c8d', fontSize: '13px'}}>Upload a Customer BOM to cross-reference stock levels across ALL Masters.</p>
              </div>
              <button className="modal-close" onClick={() => { setShowBomAnalyzer(false); setBomReport(null); }}><FaTimes /></button>
            </div>

            <div className="modal-body" style={{padding: '20px'}}>
              {!bomReport && !bomAnalyzing && (
                 <div className={`upload-zone ${bomDragOver ? 'drag-over' : ''}`} onDragOver={e => { e.preventDefault(); setBomDragOver(true); }} onDragLeave={() => setBomDragOver(false)} onDrop={e => { e.preventDefault(); setBomDragOver(false); if (e.dataTransfer.files[0]) handleBomUpload(e.dataTransfer.files[0]); }} onClick={() => document.getElementById('bomUploadInput').click()}>
                    <input type="file" id="bomUploadInput" style={{display: 'none'}} accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={e => e.target.files?.[0] && handleBomUpload(e.target.files[0])} />
                    <FaUpload className="upload-icon" style={{color: '#9b59b6'}} />
                    <div className="upload-text">Upload Customer BOM (Excel/CSV)</div>
                    <div className="upload-sub">Click or drag & drop to analyze</div>
                 </div>
              )}

              {bomAnalyzing && (
                 <div style={{textAlign: 'center', padding: '60px 0'}}>
                    <div className="spinner style-spinner" style={{width: '40px', height: '40px', borderColor: '#9b59b6', borderRightColor: 'transparent', borderRadius: '50%', borderStyle: 'solid', borderWidth: '3px', animation: 'spin 1s linear infinite', margin: '0 auto 20px'}}></div>
                    <p style={{fontWeight: 600, color: '#34495e'}}>Cross-referencing Global Catalog...</p>
                 </div>
              )}

              {bomReport && (
                 <div className="bom-report-section">
                    <div className="bom-report-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', marginBottom: '25px' }}>
                       <div className="kpi-box" style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid #ecf0f1' }}>
                          <div style={{fontSize: '32px', fontWeight: 'bold', color: '#34495e'}}>{bomReport.total}</div>
                          <div style={{fontSize: '12px', color: '#7f8c8d'}}>Total SKUs</div>
                       </div>
                       <div className="kpi-box" style={{ background: '#f0fff5', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid #c3e6cb' }}>
                          <div style={{fontSize: '32px', fontWeight: 'bold', color: '#27ae60'}}>{bomReport.ok}</div>
                          <div style={{fontSize: '12px', color: '#27ae60'}}>Found & Available</div>
                       </div>
                       <div className="kpi-box" style={{ background: '#fff9e6', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid #ffeeba' }}>
                          <div style={{fontSize: '32px', fontWeight: 'bold', color: '#f39c12'}}>{bomReport.shortage}</div>
                          <div style={{fontSize: '12px', color: '#f39c12'}}>Low Stock / Shortage</div>
                       </div>
                       <div className="kpi-box" style={{ background: '#fff0f0', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid #f5c6cb' }}>
                          <div style={{fontSize: '32px', fontWeight: 'bold', color: '#e74c3c'}}>{bomReport.missing}</div>
                          <div style={{fontSize: '12px', color: '#e74c3c'}}>Missing from DB</div>
                       </div>
                    </div>

                    <h3 style={{fontSize: '15px', borderBottom: '1px solid #eee', paddingBottom: '10px', marginBottom: '15px'}}>Analysis Breakdown</h3>
                    
                    <div className="table-responsive">
                       <table className="users-table" style={{width: '100%', borderCollapse: 'collapse'}}>
                          <thead style={{background: '#f8f9fa', borderBottom: '2px solid #eee'}}>
                             <tr>
                                <th style={{padding: '10px', textAlign: 'left', fontSize: '13px'}}>SKU</th>
                                <th style={{padding: '10px', textAlign: 'left', fontSize: '13px'}}>Item Name</th>
                                <th style={{padding: '10px', textAlign: 'center', fontSize: '13px'}}>Required</th>
                                <th style={{padding: '10px', textAlign: 'center', fontSize: '13px'}}>Available</th>
                                <th style={{padding: '10px', textAlign: 'left', fontSize: '13px'}}>Status</th>
                             </tr>
                          </thead>
                          <tbody>
                             {bomReport.items.map((i, idx) => (
                                <tr key={idx} style={{borderBottom: '1px solid #eee'}}>
                                   <td style={{padding: '12px 10px', fontWeight: 600, fontFamily: 'monospace'}}>{i.sku}</td>
                                   <td style={{padding: '12px 10px'}}>{i.name}</td>
                                   <td style={{padding: '12px 10px', textAlign: 'center'}}>{i.needed}</td>
                                   <td style={{padding: '12px 10px', textAlign: 'center', color: i.status==='ok' ? '#27ae60' : i.available===0 ? '#e74c3c' : '#f39c12'}}>{i.available}</td>
                                   <td style={{padding: '12px 10px'}}>
                                      {i.status === 'ok' && <span style={{background: '#d4edda', color: '#155724', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600}}>Fully Available</span>}
                                      {i.status === 'shortage' && <span style={{background: '#fff3cd', color: '#856404', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600}}>Shortage ({i.diff})</span>}
                                      {i.status === 'missing' && <span style={{background: '#f8d7da', color: '#721c24', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600}}>Not in Catalog</span>}
                                   </td>
                                </tr>
                             ))}
                          </tbody>
                       </table>
                    </div>
                 </div>
              )}
            </div>
            
            {bomReport && (
               <div className="modal-footer" style={{padding: '15px 20px', display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #eee'}}>
                  <button className="btn btn-secondary" onClick={() => setBomReport(null)}>Reset</button>
                  <button className="btn btn-primary" style={{background: '#9b59b6', borderColor: '#9b59b6'}}>Export Report</button>
               </div>
            )}
          </div>
        </div>
      )}

      </div>
    );
  }

  return (
    <div className="ims-catalog-page">
      <div className="master-breadcrumb">
        <button className="breadcrumb-btn" onClick={() => setActiveMaster(null)}>
          <FaArrowLeft /> Back to Master Catalogs
        </button>
      </div>

      <div className="page-header ims-page-header" style={{ marginTop: '12px' }}>
        <div className="ims-header-left">
          <h1>{activeMaster.name}</h1>
          <p>Product catalog, variants, and stock management for this master</p>
        </div>
        <div className="ims-header-right" style={{gap: '10px', display: 'flex'}}>
          <button className="btn btn-secondary" onClick={() => setShowImporter(true)}>
             <FaFileExcel /> Import Excel
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
             <FaPlus /> Add Product
          </button>
        </div>
      </div>

      <div className="catalog-controls">
        <div className="search-input" style={{ maxWidth: '340px', flex: 1 }}>
          <FaSearch className="search-icon" />
          <input type="text" placeholder="Search name or barcode..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-dropdown">
          <FaFilter className="filter-icon" />
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn btn-secondary" style={{ marginLeft: 'auto' }}><FaDownload /> Export</button>
        <span className="catalog-count">{filtered.length} of {products.length} products</span>
      </div>

      <div className="table-container">
        {products.length === 0 ? (
          <div className="empty-catalog-state" style={{ padding: '60px 20px', textAlign: 'center', background: '#fff', borderRadius: '12px', border: '1px dashed #ccc' }}>
            <FaCubes style={{ fontSize: '48px', color: '#bdc3c7', marginBottom: '15px' }} />
            <h2 style={{ fontSize: '20px', color: '#2c3e50', marginBottom: '10px' }}>This Catalog is Empty</h2>
            <p style={{ color: '#7f8c8d', marginBottom: '25px', maxWidth: '400px', margin: '0 auto 25px' }}>
              Import your existing data from Excel, and any custom columns will be automatically added to this view.
            </p>
            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setShowImporter(true)} style={{ padding: '10px 20px' }}>
                 <FaFileExcel /> Import Excel
              </button>
              <button className="btn btn-primary" onClick={openAdd} style={{ padding: '10px 20px' }}>
                 <FaPlus /> Add Manually
              </button>
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Barcode</th><th>Product Name</th><th>Category</th><th>Item Type</th><th>Base Unit</th>
                <th>Stock</th><th>Tracking</th><th>Location</th>
                {customCols.map(c => <th key={c}>{c}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td><code className="barcode-code">{p.barcode}</code></td>
                  <td><strong>{p.name}</strong><div className="supplier-sub">{p.supplier}</div></td>
                  <td><span className="badge badge-info">{p.category}</span></td>
                  <td>
                    <span className="badge" style={{ background: p.itemType === 'Finished Product' ? '#1abc9c18' : '#3498db18', color: p.itemType === 'Finished Product' ? '#1abc9c' : '#3498db', fontWeight: 600 }}>
                      {p.itemType || 'Raw Material'}
                    </span>
                  </td>
                  <td>{p.baseUnit}</td>
                  <td><span className={`stock-num ${p.stock < 10 ? 'stock-critical' : p.stock < 25 ? 'stock-low' : 'stock-ok'}`}>{p.stock}</span></td>
                  <td><span className="tracking-badge" style={{ background: `${trackingColors[p.trackingMode] || trackingColors.FIFO}18`, color: trackingColors[p.trackingMode] || trackingColors.FIFO }}>{p.trackingMode || 'FIFO'}</span></td>
                  <td>
                    <div className="location-multi-tag">
                      {p.locations && p.locations.length > 0 ? (
                        p.locations.length === 1 ? p.locations[0].zone : `${p.locations.length} Locations`
                      ) : 'Unassigned'}
                    </div>
                  </td>
                  {customCols.map(c => <td key={c}>{p.customFields?.[c] || <span className="text-tertiary">—</span>}</td>)}
                  <td>
                    <div className="table-actions">
                      <button className="icon-btn edit-btn" onClick={() => openEdit(p)}><FaEdit /></button>
                      <button className="icon-btn delete-btn" onClick={() => handleDelete(p.id)}><FaTrash /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && products.length > 0 && (
                <tr><td colSpan={9 + customCols.length}><div className="empty-state"><FaSearch className="empty-state-icon" /><h3>No Products Found</h3><p>Try changing your search or filter.</p></div></td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
         /* Edit Product Modal Logic (omitted for brevity, maintained from original) */
         <div className="ims-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="ims-modal catalog-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <FaPlus className="modal-icon" />
              <div><h2>{editProduct ? 'Edit Product' : 'Add New Product'}</h2><p>{editProduct ? `Editing ${editProduct.name}` : 'Fill in product details'}</p></div>
              <button className="modal-close" onClick={() => setShowModal(false)}><FaTimes /></button>
            </div>
            <div className="modal-tabs">
              <button className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>General & SKU</button>
            </div>

            <div className="modal-body">
              {activeTab === 'general' && (
                <>
                  <div className="modal-row">
                    <div className="form-group">
                      <label className="form-label">Barcode *</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input className="form-input" placeholder="e.g. PACK001" value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} style={{ flex: 1 }} />
                        <button className="btn btn-secondary" onClick={generateBarcode} title="Generate Autocode" style={{ padding: '0 12px' }}><FaMagic /></button>
                      </div>
                    </div>
                    <div className="form-group" style={{ flex: 2 }}>
                      <label className="form-label">Product Name *</label>
                      <input className="form-input" placeholder="e.g. Paracetamol 500mg" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                  </div>
                  <div className="modal-row">
                    <div className="form-group">
                      <label className="form-label">Category</label>
                      <select className="form-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                        {categories.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Item Type</label>
                      <select className="form-select" value={form.itemType || 'Raw Material'} onChange={e => setForm(f => ({ ...f, itemType: e.target.value }))}>
                        {ITEM_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="modal-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Opening Stock</label>
                      <input className="form-input" type="number" placeholder="0" value={form.stock} onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} />
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.barcode || !form.name}>
                <FaSave /> {editProduct ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImporter && (
        <ImportMapper
          masterId={activeMaster.id}
          imsFetch={imsFetch}
          onComplete={async (result) => {
            // Refresh items after import
            const itemsRes = await imsFetch(`/api/ims/masters/${activeMaster.id}/items`);
            const itemsData = await itemsRes.json();
            if (itemsData.success) {
              setProducts(itemsData.items);
              setMasters(prev => prev.map(m => m.id === activeMaster.id ? { ...m, count: itemsData.items.length } : m));
            }
          }}
          onClose={() => setShowImporter(false)}
        />
      )}

      {/* BOM Analyzer modal removed from here */}
    </div>
  );
};

export default IMSCatalog;
