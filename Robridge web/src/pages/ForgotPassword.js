import React, { useState } from 'react';
import { FaEnvelope, FaPaperPlane, FaArrowLeft } from 'react-icons/fa';
import { Link } from 'react-router-dom';
import { getServerURL } from '../config/api';
import './LoginPage.css'; // Re-use login styles

const ForgotPassword = () => {
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setMessage('');
        setError('');

        try {
            // Use the backend API URL
            const apiUrl = getServerURL();

            const response = await fetch(`${apiUrl}/api/auth/forgot-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            if (data.success) {
                setMessage(data.message);
            } else {
                setError(data.error || 'Failed to send reset link.');
            }
        } catch (err) {
            console.error('Error:', err);
            setError('Something went wrong. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-content" style={{ width: '100%', maxWidth: '450px', padding: '20px' }}>
            <div className="login-header">
                <img
                    src={`${process.env.PUBLIC_URL}/static/media/robridge-logo.png`}
                    alt="Robridge Logo"
                    className="logo-image"
                    onError={(e) => {
                        e.target.style.display = 'none';
                    }}
                />
                <h1 className="login-title">Reset Password</h1>
                <p className="login-subtitle">Enter your email to receive a reset link</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
                <div className="form-group">
                    <div className="input-container">
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="form-input with-icon"
                            placeholder="Enter your email"
                            required
                            disabled={isLoading}
                        />
                        <div className="input-icon-inside">
                            <FaEnvelope />
                        </div>
                    </div>
                </div>

                {error && <div className="error-message">{error}</div>}
                {message && <div className="success-message">{message}</div>}

                <button
                    type="submit"
                    className={`login-button ${isLoading ? 'loading' : ''}`}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        'Sending...'
                    ) : (
                        <>
                            <FaPaperPlane style={{ marginRight: '8px' }} />
                            Send Reset Link
                        </>
                    )}
                </button>
            </form>

            <div className="login-footer" style={{ marginTop: '20px', textAlign: 'center' }}>
                <Link to="/login" style={{ color: '#666', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                    <FaArrowLeft size={12} /> Back to Login
                </Link>
            </div>
        </div>
    );
};

export default ForgotPassword;
