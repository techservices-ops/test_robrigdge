import React, { useState } from 'react';
import { FaTools, FaExchangeAlt, FaSave, FaExclamationTriangle } from 'react-icons/fa';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useToast } from '../components/Toast';

export default function IMSComponentReplacement() {
  const { imsFetch } = useWorkspace();
  const showToast = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    parentBarcode: '',
    oldComponentBarcode: '',
    newComponentBarcode: '',
    reason: ''
  });

  const handleReplace = async () => {
    if (!form.parentBarcode || !form.oldComponentBarcode || !form.newComponentBarcode || !form.reason) {
      showToast('All fields are required', 'error');
      return;
    }
    
    setLoading(true);
    try {
      const res = await imsFetch('/api/ims/components/replace', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      const d = await res.json();
      
      if (d.success) {
        showToast('Component replaced successfully', 'success');
        setForm({ parentBarcode: '', oldComponentBarcode: '', newComponentBarcode: '', reason: '' });
      } else {
        showToast(d.error || 'Failed to replace component', 'error');
      }
    } catch (e) {
      showToast('Server error during replacement', 'error');
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: 0, maxWidth: 800, margin: '0 auto' }}>
      <div className="page-header ims-page-header" style={{ marginBottom: 16 }}>
        <div className="ims-header-left">
          <h1>Component Replacement</h1>
          <p>Log maintenance and component swaps for full traceability</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FaTools style={{ color: '#E3821E' }} />
          <h3 style={{ margin: 0 }}>Swap Sub-Components</h3>
        </div>
        <div className="card-body">
          <div style={{ background: '#fff9e6', border: '1px solid #ffeeba', padding: 16, borderRadius: 8, marginBottom: 20, color: '#856404', display: 'flex', gap: 12 }}>
            <FaExclamationTriangle style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Traceability Notice:</strong> Swapping components will unlink the old barcode from the parent unit and link the new one. This action is permanently logged in the audit trail.
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Parent Unit Barcode</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g. ASSEMBLED-MACHINE-01" 
              value={form.parentBarcode}
              onChange={e => setForm({...form, parentBarcode: e.target.value})} 
            />
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">Old Component Barcode</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. FAULTY-PART-123" 
                value={form.oldComponentBarcode}
                onChange={e => setForm({...form, oldComponentBarcode: e.target.value})} 
              />
            </div>
            
            <FaExchangeAlt style={{ color: '#aaa', marginTop: 24 }} />

            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">New Component Barcode</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. NEW-PART-456" 
                value={form.newComponentBarcode}
                onChange={e => setForm({...form, newComponentBarcode: e.target.value})} 
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label">Reason for Replacement</label>
            <textarea 
              className="form-input" 
              placeholder="e.g. Motor burnt out during testing" 
              rows="3"
              value={form.reason}
              onChange={e => setForm({...form, reason: e.target.value})} 
            />
          </div>

          <button className="btn btn-primary" onClick={handleReplace} disabled={loading} style={{ width: '100%' }}>
            <FaSave /> {loading ? 'Processing...' : 'Confirm Replacement'}
          </button>
        </div>
      </div>
    </div>
  );
}
