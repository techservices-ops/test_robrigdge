import React, { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import * as XLSX from 'xlsx';
import {
  FaSearch, FaPlus, FaEdit,
  FaFilter, FaDownload, 
  FaFileExcel, FaTimes, FaSave,
  FaCubes, FaMagic, FaFolderPlus, FaArrowLeft, FaFolderOpen,
  FaClipboardList
} from 'react-icons/fa';
import './IMSCatalog.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useConfirm } from '../components/ConfirmModal';
import { useToast } from '../components/Toast';
import ImportMapper from '../components/ImportMapper';
import BOMAnalyzerDialog from '../components/BOMAnalyzerDialog';

const trackingColors = { FEFO: '#e74c3c', FIFO: '#3498db', LIFO: '#27ae60' };

const emptyForm = { barcode: '', name: '', category: 'General', baseUnit: 'Unit', stock: '', trackingMode: 'FIFO', parentBarcode: '', multiplier: '', supplier: '', locations: [{zone: '', qty: ''}], bom: [], weight: '', cost: '', itemType: 'Raw Material', imageUrl: '' };
const ITEM_TYPES = ['Raw Material', 'Finished Product'];

const compressImage = (file, maxW = 300, maxH = 300) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxW) {
            height *= maxW / width;
            width = maxW;
          }
        } else {
          if (height > maxH) {
            width *= maxH / height;
            height = maxH;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
const DEFAULT_CATEGORIES = ['All', 'Pharmacy', 'PPE', 'Hygiene', 'General', 'Electronics', 'Food & Beverage'];

const IMSCatalog = () => {
  const { imsFetch, activeWorkspaceId, activeWorkspace } = useWorkspace();
  const confirm = useConfirm();
  const showToast = useToast();

  const [masters, setMasters] = useState([]);
  const [activeMaster, setActiveMaster] = useState(null);
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [masterForm, setMasterForm] = useState({ name: '', description: '', category: 'All' });
  const [, setLoading] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [categoryDetails, setCategoryDetails] = useState([]);
  const [, setWorkflows] = useState(['RECEIVE', 'DISPATCH', 'PUTAWAY', 'PICK', 'RETURN']);

  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [activeTab, setActiveTab] = useState('general');
  const [showImporter, setShowImporter] = useState(false);
  
  const [showBomAnalyzer, setShowBomAnalyzer] = useState(false);

  const [locations, setLocations] = useState([]);

  const barcodeRef = useRef(null);

  // Load masters, dynamic categories & workflows on mount
  useEffect(() => {
    if (!activeWorkspaceId) return;
    imsFetch('/api/ims/masters')
      .then(r => r.json())
      .then(d => { if (d.success) setMasters(d.masters); })
      .catch(console.error);

    // Fetch locations/zones from Zone Tracking
    imsFetch('/api/ims/locations')
      .then(r => r.json())
      .then(d => { if (d.success) setLocations(d.locations || []); })
      .catch(console.error);

    // Fetch dynamic categories from Settings
    imsFetch('/api/ims/categories')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.categories.length > 0) {
          setCategoryDetails(d.categories);
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
  const openEdit = (p) => { setForm({ ...p, multiplier: p.multiplier || '', parentBarcode: p.parentBarcode || '', imageUrl: p.imageUrl || '' }); setEditProduct(p); setActiveTab('general'); setShowModal(true); };

  const handleDelete = async (id) => {
    if (!activeMaster) return;
    const ok = await confirm({
      title: 'Delete Product?',
      message: 'Are you sure you want to permanently delete this product?',
      type: 'danger',
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    try {
      const res = await imsFetch(`/api/ims/masters/${activeMaster.id}/items/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setProducts(prev => prev.filter(p => p.id !== id));
        setMasters(prev => prev.map(m => m.id === activeMaster.id ? { ...m, count: Math.max(0, (m.count || 0) - 1) } : m));
        showToast('Product deleted successfully', 'success');
      } else {
        showToast(data.error || 'Failed to delete product', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error deleting product', 'error');
    }
  };

  const generateBarcode = () => setForm(f => ({ ...f, barcode: 'GEN-' + Math.floor(100000 + Math.random() * 900000) }));

  const handleSave = async () => {
    if (!form.barcode || !form.name || !activeMaster) return;
    
    let supervisorPin = undefined;
    
    if (editProduct && Number(form.stock) !== Number(editProduct.stock)) {
      try {
        const settingsRes = await imsFetch('/api/ims/settings');
        const settingsData = await settingsRes.json();
        if (settingsData.success && settingsData.settings) {
          const settings = settingsData.settings;
          if (settings.security?.managerApproval) {
            const role = activeWorkspace?.currentUserRole;
            const isUserAdminOrOwner = ['owner', 'admin'].includes(role);
            if (!isUserAdminOrOwner) {
              const enteredPin = prompt("Manager Overrides is enabled. Please enter the Supervisor PIN to adjust stock quantity:");
              if (enteredPin === null) {
                return;
              }
              supervisorPin = enteredPin;
            }
          }
        }
      } catch (err) {
        console.error("Error checking settings for overrides", err);
      }
    }

    const payload = { 
      ...form, 
      stock: Number(form.stock) || 0, 
      multiplier: form.multiplier ? Number(form.multiplier) : null, 
      masterId: activeMaster.id,
      supervisorPin
    };

    try {
      if (editProduct) {
        const res = await imsFetch(`/api/ims/masters/${activeMaster.id}/items/${editProduct.id}`, { 
          method: 'PUT', 
          body: JSON.stringify(payload) 
        });
        const data = await res.json();
        if (data.success) {
          setProducts(prev => prev.map(p => p.id === editProduct.id ? { ...payload, id: p.id } : p));
          setShowModal(false);
          showToast('Product updated successfully.', 'success');
        } else {
          showToast(data.error || 'Failed to update product', 'error');
        }
      } else {
        const res = await imsFetch(`/api/ims/masters/${activeMaster.id}/items`, { 
          method: 'POST', 
          body: JSON.stringify(payload) 
        });
        const data = await res.json();
        if (data.success) {
          setProducts(prev => [...prev, data.item]);
          setMasters(prev => prev.map(m => m.id === activeMaster.id ? { ...m, count: (m.count || 0) + 1 } : m));
          setShowModal(false);
          showToast('Product added successfully.', 'success');
        } else {
          showToast(data.error || 'Failed to add product', 'error');
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving product', 'error');
    }
  };


  // BOM upload and analysis logic extracted to BOMAnalyzerDialog


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
        showToast('Master catalog deleted successfully', 'success');
      } else {
        showToast(data.error || 'Failed to delete master catalog', 'error');
      }
    } catch (err) {
      console.error('Failed to delete master', err);
      showToast('Error deleting master catalog', 'error');
    }
  };

  const activeProducts = products.filter(p => !activeMaster || !p.masterId || String(p.masterId) === String(activeMaster.id));
  const filtered = activeProducts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'All' || p.category === categoryFilter;
    return matchSearch && matchCat;
  });

  // Calculate dynamic custom columns from filtered products, excluding duplicate built-in fields
  const excludedKeys = ['barcode', 'name', 'category', 'itemtype', 'baseunit', 'stock', 'tracking', 'trackingmode', 'location', 'locations', 'supplier'];
  const customCols = Array.from(new Set(
    filtered.flatMap(p => Object.keys(p.customFields || {}))
  )).filter(col => !excludedKeys.includes(col.toLowerCase().replace(/\s+/g, '')));

  const handleExport = () => {
    if (filtered.length === 0) return;
    const rows = filtered.map(p => {
      const row = {
        Barcode: p.barcode,
        Name: p.name,
        Category: p.category,
        'Item Type': p.itemType || 'Raw Material',
        'Base Unit': p.baseUnit,
        Stock: p.stock,
        'Tracking Mode': p.trackingMode || 'FIFO',
        Supplier: p.supplier || '',
        Locations: p.locations && p.locations.length > 0
          ? p.locations.map(loc => `${loc.zone}:${loc.qty}`).join(', ')
          : 'Unassigned'
      };
      
      if (p.customFields) {
        Object.entries(p.customFields).forEach(([key, val]) => {
          row[key] = val;
        });
      }
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, `${activeMaster?.name || 'Catalog'}_products.xlsx`);
  };

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
                  className="icon-btn catalog-delete-btn"
                  title="Delete Master Catalog"
                  onClick={(e) => handleDeleteMaster(e, m)}
                  style={{
                    position: 'absolute', top: '10px', right: '10px',
                    opacity: 0.6, transition: 'opacity 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = 1}
                  onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                >
                  <FaTimes />
                </button>
              </div>
            );
          })}
        </div>

        {showMasterModal && (
          <div className="ims-modal-overlay" onClick={() => setShowMasterModal(false)}>
            <div className="ims-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{ flex: 1, paddingRight: '24px' }}><h2>Create New Master</h2><p>Define a new separated catalog space</p></div>
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

      <BOMAnalyzerDialog isOpen={showBomAnalyzer} onClose={() => setShowBomAnalyzer(false)} />
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
          <button className="btn btn-secondary" onClick={() => setShowBomAnalyzer(true)} style={{borderColor: '#9b59b6', color: '#9b59b6'}}>
             <FaClipboardList /> BOM Analyzer
          </button>
          <button className="btn btn-secondary" onClick={() => setShowImporter(true)}>
             <FaFileExcel /> Import Excel
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
             <FaPlus /> Add Product
          </button>
        </div>
      </div>

      <div className="catalog-controls">
        <div className="catalog-search-wrapper" style={{ maxWidth: '340px', flex: 1 }}>
          <FaSearch className="search-icon" />
          <input type="text" placeholder="Search name or barcode..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-dropdown">
          <FaFilter className="filter-icon" />
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn btn-secondary" onClick={handleExport} disabled={filtered.length === 0} style={{ marginLeft: 'auto' }}>
          <FaDownload /> Export
        </button>
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
                  <td>
                    <div className="product-name-cell">
                      <div>
                        <strong>{p.name}</strong>
                        <div className="supplier-sub">{p.supplier}</div>
                      </div>
                    </div>
                  </td>
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
                      <button className="icon-btn catalog-edit-btn" onClick={() => openEdit(p)} title="Edit Product"><FaEdit /></button>
                      <button className="icon-btn catalog-delete-btn" onClick={() => handleDelete(p.id)} title="Delete Product"><FaTimes /></button>
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
              <div style={{ flex: 1, paddingRight: '24px' }}><h2>{editProduct ? 'Edit Product' : 'Add New Product'}</h2><p>{editProduct ? `Editing ${editProduct.name}` : 'Fill in product details'}</p></div>
              <button className="modal-close" onClick={() => setShowModal(false)}><FaTimes /></button>
            </div>
            <div className="modal-tabs">
              <button className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>General & SKU</button>
            </div>

            <div className="modal-body">
              {activeTab === 'general' && (
                <>
                  <div className="modal-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Barcode *</label>
                      <div className="barcode-input-wrapper">
                        <input className="form-input" placeholder="e.g. PACK001" value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} />
                        <button type="button" className="btn btn-secondary" onClick={generateBarcode} title="Generate Autocode"><FaMagic /></button>
                      </div>
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Product Name *</label>
                      <input className="form-input" placeholder="e.g. Paracetamol 500mg" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                  </div>
                  <div className="modal-row">
                    <div className="form-group">
                      <label className="form-label">Category</label>
                      <select className="form-select" value={form.category} onChange={e => {
                        const selectedCatName = e.target.value;
                        const matchedCat = categoryDetails.find(c => c.name === selectedCatName);
                        setForm(f => ({ 
                          ...f, 
                          category: selectedCatName,
                          trackingMode: matchedCat ? matchedCat.mode : 'FIFO'
                        }));
                      }}>
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
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Location (Zone)</label>
                      <select className="form-select" value={form.locations?.[0]?.zone || ''} onChange={e => {
                        const val = e.target.value;
                        setForm(f => {
                          const locs = [...(f.locations || [{zone: '', qty: ''}])];
                          if (!locs[0]) locs[0] = { zone: '', qty: '' };
                          locs[0].zone = val;
                          if (!locs[0].qty && f.stock) locs[0].qty = f.stock;
                          return { ...f, locations: locs };
                        });
                      }}>
                        <option value="">— Select Location Zone —</option>
                        {locations.map(loc => (
                          <option key={loc.id} value={loc.name}>{loc.name} ({loc.type})</option>
                        ))}
                      </select>
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

      <BOMAnalyzerDialog isOpen={showBomAnalyzer} onClose={() => setShowBomAnalyzer(false)} />
    </div>
  );
};

export default IMSCatalog;
