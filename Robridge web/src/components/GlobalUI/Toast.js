import React from 'react';
import { FaCheckCircle, FaExclamationCircle, FaInfoCircle, FaExclamationTriangle, FaTimes } from 'react-icons/fa';
import './GlobalUI.css';
import { useUI } from '../../contexts/UIContext';

const Toast = ({ id, message, type }) => {
    const { removeToast } = useUI();

    const getIcon = () => {
        switch (type) {
            case 'success': return <FaCheckCircle />;
            case 'error': return <FaExclamationCircle />;
            case 'warning': return <FaExclamationTriangle />;
            default: return <FaInfoCircle />;
        }
    };

    return (
        <div className={`toast ${type}`}>
            <div className="toast-icon">
                {getIcon()}
            </div>
            <div className="toast-content">
                <p className="toast-message">{message}</p>
            </div>
            <button className="toast-close" onClick={() => removeToast(id)}>
                <FaTimes />
            </button>
        </div>
    );
};

export default Toast;
