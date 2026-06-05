import React from 'react';
import { useUI } from '../../contexts/UIContext';
import Toast from './Toast';
import Modal from './Modal';

const GlobalUIComponents = () => {
    const { toasts, modal } = useUI();

    return (
        <>
            <div className="toast-container">
                {toasts.map(toast => (
                    <Toast key={toast.id} {...toast} />
                ))}
            </div>
            {modal && <Modal />}
        </>
    );
};

export default GlobalUIComponents;
