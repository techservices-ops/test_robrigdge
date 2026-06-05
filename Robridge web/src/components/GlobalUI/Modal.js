import React from 'react';
import { FaTimes } from 'react-icons/fa';
import './GlobalUI.css';
import { useUI } from '../../contexts/UIContext';

const Modal = () => {
    const { modal, closeModal } = useUI();

    if (!modal) return null;

    const { title, content, actions } = modal;

    return (
        <div className="modal-overlay" onClick={closeModal}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">{title}</h3>
                    <button className="modal-close-btn" onClick={closeModal}>
                        <FaTimes />
                    </button>
                </div>

                <div className="modal-body">
                    {typeof content === 'string' ? <p>{content}</p> : content}
                </div>

                {actions && actions.length > 0 && (
                    <div className="modal-footer">
                        {actions.map((action, index) => (
                            <button
                                key={index}
                                className={`modal-btn ${action.variant || 'secondary'}`}
                                onClick={action.onClick}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;
