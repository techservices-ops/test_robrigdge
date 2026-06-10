import React, { useState, useEffect } from 'react';
import {
  FaBell, FaToggleOn, FaToggleOff, 
  FaSave, FaCheckCircle, FaLock, FaBrain, 
  FaChartLine, 
  FaPlus, FaTrash, FaLayerGroup, FaExchangeAlt,
  FaCloud, FaHourglassHalf
} from 'react-icons/fa';
import './IMSSettings.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useConfirm } from '../components/ConfirmModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';

const IMSSettings = () => {
  const { imsFetch, activeWorkspaceId, activeWorkspace } = useWorkspace();
  const { getUserInfo } = useAuth();
  const showToast = useToast();
  const confirm = useConfirm();
  const currentUser = getUserInfo();
  
  const wsRole = activeWorkspace?.currentUserRole;
  const isAdmin = ['owner', 'admin'].includes(wsRole || 'member');
  const isManager = wsRole === 'manager';

  // Storage Subscription State
  const [storageGB, setStorageGB] = useState(1);
  const [currentStorageGB, setCurrentStorageGB] = useState(1);
  const [pendingUpgrade, setPendingUpgrade] = useState(null); // { requestedGB, requestedBy, status }
  
  // Master Dynamic State
  const [categories, setCategories] = useState([]);
  const [workflows, setWorkflows] = useState([]);

  // Category Builder State
  const [newCatName, setNewCatName] = useState('');
  const [newCatMode, setNewCatMode] = useState('FIFO');
  const [newCatAlert, setNewCatAlert] = useState('');
  const [newCatReorder, setNewCatReorder] = useState('');
  const [newCatColor, setNewCatColor] = useState('#3498db');

  // Workflow Builder State
  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowColor, setNewFlowColor] = useState('#3498db');

  // Other Settings
  const [alerts, setAlerts] = useState({ email: true });
  const [security, setSecurity] = useState({ restrictRobot: true, blockUnpaired: true, immutableLogs: true, managerApproval: false, supervisorPin: '1234' });
  const [aiSettings, setAiSettings] = useState({ aiClassify: true, predictiveStock: false });
  const [scannerPrefs, setScannerPrefs] = useState({ autoLog: true, sound: true, vibration: true });

  const [bufferPct, setBufferPct] = useState(15);
  const [saved, setSaved] = useState(false);

  // Fetch data on mount
  useEffect(() => {
    if(!activeWorkspaceId) return;
    const loadData = async () => {
       try {
          const catRes = await imsFetch('/api/ims/categories');
          const catData = await catRes.json();
          if(catData.success) setCategories(catData.categories);

          const wfRes = await imsFetch('/api/ims/workflows');
          const wfData = await wfRes.json();
          if(wfData.success) setWorkflows(wfData.workflows);

          const setRes = await imsFetch('/api/ims/settings');
          const setData = await setRes.json();
          if(setData.success && setData.settings && Object.keys(setData.settings).length > 0) {
             const prefs = setData.settings;
             if(prefs.alerts) setAlerts(prefs.alerts);
             if(prefs.security) setSecurity(prev => ({ ...prev, ...prefs.security }));
              if(prefs.aiSettings) setAiSettings(prev => ({ ...prev, ...prefs.aiSettings }));
              if(prefs.scannerPrefs) setScannerPrefs(prefs.scannerPrefs);
              if(prefs.bufferPct) setBufferPct(prefs.bufferPct);
             if(prefs.storageGB) {
               setStorageGB(prefs.storageGB);
               setCurrentStorageGB(prefs.storageGB);
             }
             if(prefs.pendingUpgrade) {
               setPendingUpgrade(prefs.pendingUpgrade);
             }
          }
       } catch (err) { console.error("Error fetching IMS data", err); }
    };
    loadData();
  }, [activeWorkspaceId, imsFetch]);

  const handleToggle = (setter, key) => setter(prev => ({ ...prev, [key]: !prev[key] }));

  // Dynamic Add Methods
  const addCategory = async () => {
    if (!isAdmin) return;
    if (!newCatName || !newCatAlert || !newCatReorder) {
      showToast('All fields are required to build a category', 'error');
      return;
    }
    try {
      const res = await imsFetch('/api/ims/categories', {
        method: 'POST',
        body: JSON.stringify({ name: newCatName, mode: newCatMode, alertAt: Number(newCatAlert), reorderAt: Number(newCatReorder), color: newCatColor })
      });
      const data = await res.json();
      if(data.success) {
        setCategories([...categories, data.category]);
        setNewCatName(''); setNewCatAlert(''); setNewCatReorder('');
        showToast(`Category "${data.category.name}" created successfully.`, 'success');
      } else {
        showToast(data.error || 'Failed to create category', 'error');
      }
    } catch(err) { 
      console.error(err); 
      showToast('Error creating category', 'error');
    }
  };

  const removeCategory = async (id, name) => {
    if (!isAdmin) return;
    const ok = await confirm({
      title: `Delete category "${name}"?`,
      message: 'Items using this category will retain their current category label but lose threshold enforcement.',
      type: 'danger', confirmLabel: 'Delete Category'
    });
    if (!ok) return;
    try {
      const res = await imsFetch(`/api/ims/categories/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if(data.success) {
        setCategories(categories.filter(c => c.id !== id));
        showToast(`Category "${name}" deleted successfully.`, 'success');
      } else {
        showToast(data.error || 'Failed to delete category', 'error');
      }
    } catch(err) { 
      console.error(err); 
      showToast('Error deleting category', 'error');
    }
  };

  const addWorkflow = async () => {
    if (!isAdmin) return;
    if (!newFlowName) return;
    try {
      const res = await imsFetch('/api/ims/workflows', {
        method: 'POST',
        body: JSON.stringify({ name: newFlowName, color: newFlowColor })
      });
      const data = await res.json();
      if(data.success) {
        setWorkflows([...workflows, data.workflow]);
        setNewFlowName('');
      }
    } catch(err) { console.error(err); }
  };

  const removeWorkflow = async (id, name) => {
    if (!isAdmin) return;
    const ok = await confirm({
      title: `Delete workflow "${name}"?`,
      message: 'Scans using this workflow will lose their workflow classification.',
      type: 'danger', confirmLabel: 'Delete Workflow'
    });
    if (!ok) return;
    try {
      await imsFetch(`/api/ims/workflows/${id}`, { method: 'DELETE' });
      setWorkflows(workflows.filter(w => w.id !== id));
    } catch(err) { console.error(err); }
  };

  const handleRequestUpgrade = async (requestedSize) => {
    const newPending = {
      requestedGB: requestedSize,
      requestedBy: currentUser?.name || 'Manager',
      status: 'pending',
      requestedAt: new Date().toISOString()
    };
    setPendingUpgrade(newPending);
    
    const settings = {
      alerts, security, aiSettings, scannerPrefs, bufferPct,
      storageGB: currentStorageGB,
      pendingUpgrade: newPending
    };
    try {
      const res = await imsFetch('/api/ims/settings', {
        method: 'POST',
        body: JSON.stringify({ settings })
      });
      const data = await res.json();
      if(data.success) {
        showToast(`Upgrade request for ${requestedSize} GB sent to Admins.`, 'success');
      }
    } catch(err) {
      console.error(err);
      showToast('Failed to send upgrade request', 'error');
    }
  };

  const handlePayAndUpgrade = async (newSize) => {
    setCurrentStorageGB(newSize);
    setStorageGB(newSize);
    setPendingUpgrade(null);
    
    const settings = {
      alerts, security, aiSettings, scannerPrefs, bufferPct,
      storageGB: newSize,
      pendingUpgrade: null
    };
    try {
      const res = await imsFetch('/api/ims/settings', {
        method: 'POST',
        body: JSON.stringify({ settings })
      });
      const data = await res.json();
      if(data.success) {
        showToast(`Subscription upgraded to ${newSize} GB! Payment processed successfully.`, 'success');
      }
    } catch(err) {
      console.error(err);
      showToast('Upgrade payment failed', 'error');
    }
  };

  const handleCancelRequest = async () => {
    setPendingUpgrade(null);
    const settings = {
      alerts, security, aiSettings, scannerPrefs, bufferPct,
      storageGB: currentStorageGB,
      pendingUpgrade: null
    };
    try {
      const res = await imsFetch('/api/ims/settings', {
        method: 'POST',
        body: JSON.stringify({ settings })
      });
      const data = await res.json();
      if(data.success) {
        showToast('Upgrade request cancelled', 'info');
      }
    } catch(err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    const settings = { 
      alerts, security, aiSettings, scannerPrefs, bufferPct,
      storageGB: currentStorageGB,
      pendingUpgrade
    };
    try {
      const res = await imsFetch('/api/ims/settings', {
        method: 'POST',
        body: JSON.stringify({ settings })
      });
      const data = await res.json();
      if(data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch(err) { console.error(err); }
  };

  return (
    <div className="ims-settings-page">
      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>IMS Decision Control</h1>
          <p>Configure autonomous rules, thresholds, and dynamic parameters</p>
        </div>
        <div className="ims-header-right">
          {isAdmin ? (
            <button className="btn btn-primary btn-save-settings" onClick={handleSave}>
              {saved ? <><FaCheckCircle /> Saved!</> : <><FaSave /> Deploy Settings</>}
            </button>
          ) : (
            <span className="badge badge-info" style={{ padding: '8px 16px', fontSize: '13px', background: 'rgba(52,152,219,0.15)', color: '#3498db', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FaLock /> Read Only View
            </span>
          )}
        </div>
      </div>

      {/* ── STORAGE SUBSCRIPTION BOX ── */}
      <div className="subscription-card">
        <div className="subscription-card-header">
          <div className="subscription-header-left">
            <FaCloud className="subscription-icon" />
            <div>
              <h2>Storage Subscription Plan</h2>
              <p>Base storage is 1 GB (Free). Drag the slider to increase storage capacity.</p>
            </div>
          </div>
          <div className="subscription-badge">
            Active: <strong>{currentStorageGB} GB</strong>
          </div>
        </div>

        <div className="subscription-body">
          <div className="slider-wrapper">
            <div className="slider-labels">
              <span>1 GB (Base)</span>
              <span>100 GB (Max)</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="100" 
              value={storageGB} 
              onChange={(e) => setStorageGB(Number(e.target.value))} 
              className="storage-slider"
              disabled={!isAdmin}
            />
            <div className="slider-current-val">
              Target Storage: <strong>{storageGB} GB</strong>
            </div>
          </div>

          <div className="price-details-section">
            <div className="price-info">
              <span>Monthly Amount:</span>
              <strong className="price-amount">${(storageGB - 1) * 5} <span className="price-period">/ month</span></strong>
            </div>
            
            <div className="upgrade-actions">
              {isManager ? (
                <button 
                  className="btn btn-primary"
                  disabled={storageGB === currentStorageGB || (pendingUpgrade && pendingUpgrade.requestedGB === storageGB)}
                  onClick={() => handleRequestUpgrade(storageGB)}
                >
                  {pendingUpgrade && pendingUpgrade.requestedGB === storageGB ? 'Request Sent' : 'Request Admin to Upgrade'}
                </button>
              ) : (
                <button 
                  className="btn btn-primary" 
                  disabled={storageGB === currentStorageGB || !isAdmin}
                  onClick={() => handlePayAndUpgrade(storageGB)}
                >
                  Pay & Subscribe
                </button>
              )}
            </div>
          </div>

          {/* Pending Upgrade Alert Banner */}
          {pendingUpgrade && pendingUpgrade.status === 'pending' && (
            <div className="upgrade-alert-banner">
              <FaHourglassHalf className="alert-spinner" />
              <div className="banner-text">
                {isAdmin ? (
                  <span>Manager <strong>{pendingUpgrade.requestedBy}</strong> requested an upgrade to <strong>{pendingUpgrade.requestedGB} GB</strong> (${(pendingUpgrade.requestedGB - 1) * 5}/mo).</span>
                ) : (
                  <span>Your request to upgrade to <strong>{pendingUpgrade.requestedGB} GB</strong> is pending Admin approval.</span>
                )}
              </div>
              <div className="banner-buttons">
                {isAdmin ? (
                  <>
                    <button className="btn-approve-req" onClick={() => handlePayAndUpgrade(pendingUpgrade.requestedGB)}>Approve & Pay</button>
                    <button className="btn-reject-req" onClick={handleCancelRequest}>Cancel</button>
                  </>
                ) : (
                  <button className="btn-reject-req" onClick={handleCancelRequest}>Withdraw</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="settings-grid">
        {/* Left Column: Alerts, Category Builder, Compliance */}
        <div className="settings-column">
          {/* ── ALERTS & NOTIFICATIONS ── */}
          <div className="settings-card alerts-card">
            <div className="settings-card-header">
              <FaBell className="settings-card-icon" />
              <h2>Alert Distribution</h2>
            </div>
            <div className="alert-toggles">
              {[
                { key: 'email', label: 'Email Notifications', desc: 'Send daily digests and critical alerts to Admins' }
              ].map(a => (
                <div key={a.key} className="alert-toggle-row" onClick={() => isAdmin && handleToggle(setAlerts, a.key)} style={{ cursor: isAdmin ? 'pointer' : 'default' }}>
                  <div className="toggle-info">
                    <div className="toggle-label">{a.label}</div>
                    <div className="toggle-desc">{a.desc}</div>
                  </div>
                  {alerts[a.key] ? <FaToggleOn className="toggle-icon on" /> : <FaToggleOff className="toggle-icon off" />}
                </div>
              ))}
            </div>
          </div>

          {/* ── DYNAMIC CATEGORY BUILDER ── */}
          <div className="settings-card category-builder-card">
            <div className="settings-card-header">
              <FaLayerGroup className="settings-card-icon" style={{color: '#f39c12'}} />
              <h2>Master Category Builder</h2>
            </div>
            <div className="builder-desc">Defined categories are synced to Catalog Master and enforce rotational behaviour (FEFO/FIFO).</div>
            
            <div className="builder-form">
              <div className="builder-form-row">
                <div className="builder-field-group" style={{ flex: 2 }}>
                  <label>Category Name</label>
                  <input type="text" placeholder="e.g. Chemicals" value={newCatName} onChange={e => setNewCatName(e.target.value)} className="form-input" disabled={!isAdmin} />
                </div>
                <div className="builder-field-group" style={{ flex: 1.2 }}>
                  <label>Rotation Mode</label>
                  <select value={newCatMode} onChange={e => setNewCatMode(e.target.value)} className="form-select" disabled={!isAdmin}>
                    <option value="FIFO">FIFO (First In First Out)</option>
                    <option value="FEFO">FEFO (First Expire First Out)</option>
                    <option value="LIFO">LIFO (Last In First Out)</option>
                  </select>
                </div>
              </div>
              <div className="builder-form-row">
                <div className="builder-field-group" style={{ flex: 1 }}>
                  <label>Alert Threshold</label>
                  <input type="number" placeholder="Alert Qty" value={newCatAlert} onChange={e => setNewCatAlert(e.target.value)} className="form-input" disabled={!isAdmin} />
                </div>
                <div className="builder-field-group" style={{ flex: 1 }}>
                  <label>Reorder Point</label>
                  <input type="number" placeholder="Reorder Qty" value={newCatReorder} onChange={e => setNewCatReorder(e.target.value)} className="form-input" disabled={!isAdmin} />
                </div>
                <div className="builder-field-group" style={{ width: '44px', flexShrink: 0 }}>
                  <label>Color</label>
                  <input type="color" value={newCatColor} onChange={e => setNewCatColor(e.target.value)} className="color-picker" title="Tag Color" disabled={!isAdmin} style={{ height: '38px', width: '44px', padding: '2px' }} />
                </div>
                <div className="builder-field-group" style={{ flexShrink: 0 }}>
                  <label>&nbsp;</label>
                  <button className="btn btn-secondary btn-icon-only" onClick={addCategory} disabled={!isAdmin} style={{ height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FaPlus /></button>
                </div>
              </div>
            </div>

            <div className="builder-list">
              {categories.length === 0 ? (
                <div className="no-data-placeholder">
                  No categories configured. Build one above.
                </div>
              ) : (
                categories.map(cat => (
                  <div key={cat.id} className="builder-row">
                    <span className="builder-color-dot" style={{background: cat.color}}></span>
                    <div className="builder-info">
                      <strong>{cat.name}</strong> <span className="cat-mode-badge">{cat.mode}</span>
                      <div className="cat-limits">Alert: {cat.alertAt} · Reorder: {cat.reorderAt}</div>
                    </div>
                    {isAdmin && <button className="btn-icon danger" onClick={() => removeCategory(cat.id, cat.name)}><FaTrash /></button>}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── SECURITY & AUDIT COMPLIANCE ── */}
          <div className="settings-card compliance-card">
            <div className="settings-card-header">
              <FaLock className="settings-card-icon" style={{ color: '#e74c3c' }} />
              <h2>Security & Audit Compliance</h2>
            </div>
            <div className="alert-toggles">
              {[
                { key: 'blockUnpaired', label: 'Block Unpaired Scans', desc: 'Prevent scanning events from un-paired ESP32/Mobile devices' },
                { key: 'restrictRobot', label: 'Restricted Robot Control', desc: 'Limit robot console movement and start/stop controls to workspace Admins, Owners, and Managers' },
                { key: 'immutableLogs', label: 'Immutable Audit Trail', desc: 'Lock scan history and catalog from deletion (FDA / ISO compliance)' },
                { key: 'managerApproval', label: 'Manager Overrides', desc: 'Require supervisor PIN for manual quantity adjustments' },
              ].map(a => (
                <div key={a.key} className="alert-toggle-row" onClick={() => isAdmin && handleToggle(setSecurity, a.key)} style={{ cursor: isAdmin ? 'pointer' : 'default' }}>
                  <div className="toggle-info">
                    <div className="toggle-label">{a.label}</div>
                    <div className="toggle-desc">{a.desc}</div>
                  </div>
                  {security[a.key] ? <FaToggleOn className="toggle-icon on-red" /> : <FaToggleOff className="toggle-icon off" />}
                </div>
              ))}

              {/* Configurable Supervisor PIN for Manager Overrides */}
              {security.managerApproval && (
                <div style={{
                  padding: '12px var(--spacing-md)',
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-light)',
                  margin: '8px var(--spacing-md) 12px var(--spacing-md)'
                }}>
                  <label style={{
                    fontSize: '12.5px',
                    fontWeight: 'var(--font-semibold)',
                    color: 'var(--text-secondary)',
                    display: 'block',
                    marginBottom: '6px'
                  }}>
                    Set Supervisor Override PIN
                  </label>
                  <input 
                    type="password" 
                    maxLength="6"
                    placeholder="e.g. 1234"
                    value={security.supervisorPin || ''}
                    onChange={(e) => setSecurity(prev => ({ ...prev, supervisorPin: e.target.value.replace(/\D/g, '') }))}
                    disabled={!isAdmin}
                    style={{
                      padding: '8px 12px',
                      fontSize: '14px',
                      border: '1px solid var(--border-medium)',
                      borderRadius: 'var(--radius-sm)',
                      width: '140px',
                      letterSpacing: '4px',
                      textAlign: 'center',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: AI Engine, Scanner Operations */}
        <div className="settings-column">
          {/* ── AUTONOMOUS AI ENGINE ── */}
          <div className="settings-card ai-card">
            <div className="settings-card-header">
              <FaBrain className="settings-card-icon ai-icon" />
              <h2>Autonomous AI Engine</h2>
              <span className="ai-badge">Brain Config</span>
            </div>
            
            <div className="alert-toggles">
              <div className="alert-toggle-row" onClick={() => isAdmin && handleToggle(setAiSettings, 'aiClassify')} style={{ cursor: isAdmin ? 'pointer' : 'default' }}>
                <div className="toggle-info">
                  <div className="toggle-label">AI Product Classification</div>
                  <div className="toggle-desc">Use Gemini/AI to identify and categorize items from ESP32 scanner images</div>
                </div>
                {aiSettings.aiClassify ? <FaToggleOn className="toggle-icon on" /> : <FaToggleOff className="toggle-icon off" />}
              </div>
              <div className="alert-toggle-row" onClick={() => isAdmin && handleToggle(setAiSettings, 'predictiveStock')} style={{ cursor: isAdmin ? 'pointer' : 'default' }}>
                <div className="toggle-info">
                  <div className="toggle-label">Predictive Stock Forecast</div>
                  <div className="toggle-desc">AI automatically shifts minimum inventory levels based on scan velocity</div>
                </div>
                {aiSettings.predictiveStock ? <FaToggleOn className="toggle-icon on" /> : <FaToggleOff className="toggle-icon off" />}
              </div>
            </div>

            <div className="settings-slider-group">
              <div className="slider-header">
                <span><FaChartLine /> Predictive Stock Buffer</span>
                <strong>+{bufferPct}%</strong>
              </div>
              <input type="range" min="0" max="50" step="5" value={bufferPct} onChange={(e) => setBufferPct(Number(e.target.value))} className="slider-input" disabled={!isAdmin} />
            </div>
          </div>

          {/* ── DYNAMIC SCANNER WORKFLOWS ── */}
          <div className="settings-card workflow-builder-card">
            <div className="settings-card-header">
              <FaExchangeAlt className="settings-card-icon" style={{color: '#3498db'}} />
              <h2>Scanner Operations Definition</h2>
            </div>
            <div className="builder-desc">Custom action modes loaded dynamically into the Smart Scanner app.</div>
            
            <div className="builder-form">
              <div className="builder-form-row">
                <div className="builder-field-group" style={{ flex: 1 }}>
                  <label>Operation Name</label>
                  <input type="text" placeholder="e.g. Return To Vendor" value={newFlowName} onChange={e => setNewFlowName(e.target.value)} className="form-input" disabled={!isAdmin} />
                </div>
                <div className="builder-field-group" style={{ width: '44px', flexShrink: 0 }}>
                  <label>Color</label>
                  <input type="color" value={newFlowColor} onChange={e => setNewFlowColor(e.target.value)} className="color-picker" disabled={!isAdmin} style={{ height: '38px', width: '44px', padding: '2px' }} />
                </div>
                <div className="builder-field-group" style={{ flexShrink: 0 }}>
                  <label>&nbsp;</label>
                  <button className="btn btn-secondary btn-icon-only" onClick={addWorkflow} disabled={!isAdmin} style={{ height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FaPlus /></button>
                </div>
              </div>
            </div>

            <div className="workflows-grid">
              {workflows.length === 0 ? (
                <div className="no-data-placeholder" style={{ width: '100%' }}>
                  No scanner operations defined. Add one above.
                </div>
              ) : (
                workflows.map(flow => (
                  <div key={flow.id} className="workflow-pill" style={{borderLeftColor: flow.color}}>
                    <span className="wf-name">{flow.name}</span>
                    {isAdmin && <FaTrash className="wf-del" onClick={() => removeWorkflow(flow.id)} />}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {saved && (
        <div className="save-toast">
          <FaCheckCircle /> Configuration Deployed Successfully!
        </div>
      )}
    </div>
  );
};

export default IMSSettings;
