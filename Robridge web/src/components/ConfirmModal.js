import React, { useState, useEffect, useCallback } from 'react';
import { FaExclamationTriangle, FaTimes, FaTrash, FaCheckCircle } from 'react-icons/fa';

/**
 * Global styled Confirm Modal — replaces all window.confirm() calls.
 * 
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: 'Delete item?', message: 'This cannot be undone.', type: 'danger' });
 *   if (ok) { ... }
 * 
 * Types: 'danger' (red), 'warning' (orange), 'info' (blue)
 */

let resolveRef = null;
const listeners = new Set();

// Imperative trigger — called from useConfirm hook
const openConfirm = (options) => {
  return new Promise((resolve) => {
    resolveRef = resolve;
    listeners.forEach(fn => fn({ open: true, ...options }));
  });
};

export const useConfirm = () => {
  return useCallback((options) => openConfirm(options), []);
};

const typeConfig = {
  danger:  { color: '#e74c3c', bg: '#fdf0ed', Icon: FaTrash,              confirmLabel: 'Delete',  confirmStyle: { background: '#e74c3c' } },
  warning: { color: '#e67e22', bg: '#fef9e7', Icon: FaExclamationTriangle, confirmLabel: 'Confirm', confirmStyle: { background: '#e67e22' } },
  info:    { color: '#3498db', bg: '#eaf4fb', Icon: FaCheckCircle,         confirmLabel: 'OK',      confirmStyle: { background: '#3498db' } },
};

export default function ConfirmModal() {
  const [state, setState] = useState({ open: false, title: '', message: '', type: 'danger', confirmLabel: null });

  useEffect(() => {
    const handler = (options) => setState(options);
    listeners.add(handler);
    return () => listeners.delete(handler);
  }, []);

  const handleResponse = (confirmed) => {
    setState(s => ({ ...s, open: false }));
    if (resolveRef) {
      resolveRef(confirmed);
      resolveRef = null;
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && state.open) handleResponse(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [state.open]);

  if (!state.open) return null;

  const cfg = typeConfig[state.type] || typeConfig.danger;
  const confirmLabel = state.confirmLabel || cfg.confirmLabel;

  return (
    <div
      onClick={() => handleResponse(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: 20
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        style={{
          background: '#fff', borderRadius: 16, padding: '32px 36px', maxWidth: 420, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'slideIn 0.18s ease-out',
          fontFamily: 'Inter, sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', background: cfg.bg, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <cfg.Icon style={{ fontSize: 20, color: cfg.color }} />
          </div>
          <div>
            <h3 id="confirm-title" style={{ margin: '0 0 6px', fontSize: 17, color: '#2c3e50' }}>{state.title}</h3>
            {state.message && <p style={{ margin: 0, fontSize: 14, color: '#7f8c8d', lineHeight: 1.6 }}>{state.message}</p>}
          </div>
          <button onClick={() => handleResponse(false)} aria-label="Close"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 18, padding: 0, flexShrink: 0 }}>
            <FaTimes />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => handleResponse(false)}
            style={{
              padding: '9px 20px', borderRadius: 8, border: '1.5px solid #e0e0e0',
              background: '#fff', color: '#555', fontWeight: 600, fontSize: 14, cursor: 'pointer'
            }}>
            Cancel
          </button>
          <button onClick={() => handleResponse(true)} autoFocus
            style={{
              padding: '9px 20px', borderRadius: 8, border: 'none', color: '#fff',
              fontWeight: 600, fontSize: 14, cursor: 'pointer', ...cfg.confirmStyle
            }}>
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: scale(0.92) translateY(-10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
      `}</style>
    </div>
  );
}
