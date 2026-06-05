import React, { useState, useEffect, useCallback } from 'react';
import { FaCheckCircle, FaExclamationCircle, FaInfoCircle, FaTimes } from 'react-icons/fa';

/**
 * Global Toast Notification System
 * 
 * Usage:
 *   import { useToast } from '../components/Toast';
 *   
 *   const showToast = useToast();
 *   showToast('Item saved successfully!', 'success');
 *   showToast('Failed to load data', 'error');
 *   showToast('Please wait...', 'info');
 */

let nextId = 1;
const listeners = new Set();

export const showToast = (message, type = 'info', duration = 4000) => {
  const id = nextId++;
  listeners.forEach(fn => fn({ id, message, type, duration }));
  return id;
};

export const useToast = () => {
  return useCallback((message, type, duration) => showToast(message, type, duration), []);
};

const typeConfig = {
  success: { Icon: FaCheckCircle, color: '#2ecc71', bg: '#f2fcf6', border: '#b5eecf' },
  error:   { Icon: FaExclamationCircle, color: '#e74c3c', bg: '#fdf0ed', border: '#f5b7b1' },
  info:    { Icon: FaInfoCircle, color: '#3498db', bg: '#eaf4fb', border: '#aed6f1' },
};

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (toast) => {
      setToasts(prev => [...prev, toast]);
      if (toast.duration !== Infinity) {
        setTimeout(() => removeToast(toast.id), toast.duration);
      }
    };
    listeners.add(handler);
    return () => listeners.delete(handler);
  }, []);

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div 
      aria-live="polite"
      style={{
        position: 'fixed', top: 20, right: 20, zIndex: 999999,
        display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none'
      }}
    >
      {toasts.map(toast => {
        const cfg = typeConfig[toast.type] || typeConfig.info;
        return (
          <div 
            key={toast.id} 
            role="alert"
            style={{
              background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8,
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,0.1)', pointerEvents: 'auto',
              animation: 'toastSlideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
              minWidth: 280, maxWidth: 400, fontFamily: 'Inter, sans-serif'
            }}
          >
            <cfg.Icon style={{ color: cfg.color, fontSize: 20, flexShrink: 0 }} aria-hidden="true" />
            <div style={{ color: '#2c3e50', fontSize: 14, fontWeight: 500, flex: 1, lineHeight: 1.4 }}>
              {toast.message}
            </div>
            <button onClick={() => removeToast(toast.id)} aria-label="Close notification" style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#95a5a6',
              padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <FaTimes style={{ fontSize: 14 }} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(40px) scale(0.9); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
