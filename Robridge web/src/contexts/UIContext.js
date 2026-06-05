import React, { createContext, useContext, useState, useCallback } from 'react';

const UIContext = createContext();

export const useUI = () => {
    const context = useContext(UIContext);
    if (!context) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
};

export const UIProvider = ({ children }) => {
    // Toast State
    const [toasts, setToasts] = useState([]);

    // Modal State
    const [modal, setModal] = useState(null); // { title, content, actions, onClose }
    const [loading, setLoading] = useState(false);

    // Toast Methods
    const showToast = useCallback((message, type = 'info', duration = 3000) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);

        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, duration);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Modal Methods
    const showModal = useCallback((modalContent) => {
        setModal(modalContent);
    }, []);

    const closeModal = useCallback(() => {
        setModal(null);
    }, []);

    const showConfirm = useCallback((title, message, onConfirm, onCancel) => {
        setModal({
            type: 'confirm',
            title,
            content: message,
            actions: [
                {
                    label: 'Cancel',
                    onClick: () => {
                        if (onCancel) onCancel();
                        closeModal();
                    },
                    variant: 'secondary'
                },
                {
                    label: 'Confirm',
                    onClick: () => {
                        if (onConfirm) onConfirm();
                        closeModal();
                    },
                    variant: 'primary'
                }
            ]
        });
    }, [closeModal]);

    return (
        <UIContext.Provider value={{
            toasts,
            showToast,
            removeToast,
            modal,
            showModal,
            closeModal,
            showConfirm,
            loading,
            setLoading
        }}>
            {children}
        </UIContext.Provider>
    );
};
