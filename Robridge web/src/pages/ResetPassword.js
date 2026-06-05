import React, { useState } from 'react';
import { FaLock, FaExclamationCircle } from 'react-icons/fa';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import './LoginPage.css';

const ResetPassword = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setIsLoading(true);
        setError('');
        setMessage('');

        try {
            // Use the backend API URL
            const apiUrl = process.env.REACT_APP_API_URL || 'https://robridge-express-zl9j.onrender.com';

            const response = await fetch(`${apiUrl}/api/auth/reset-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token, newPassword }),
            });

            const data = await response.json();

            if (data.success) {
                setMessage('Password reset successful! Redirecting to login...');
                setTimeout(() => {
                    navigate('/login');
                }, 3000);
            } else {
                setError(data.error || 'Failed to reset password');
            }
        } catch (err) {
            console.error('Reset error:', err);
            setError('An error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!token) {
        return (
            <div className="login-content" style={{ padding: '20px', textAlign: 'center' }}>
                <FaExclamationCircle size={50} color="#dc3545" />
                <h2>Invalid Link</h2>
                <p>This password reset link is invalid or missing the token.</p>
                <Link to="/login" className="login-button">Back to Login</Link>
            </div>
        );
    }

    return (
        <div className="login-content" style={{ width: '100%', maxWidth: '450px', padding: '20px' }}>
            <div className="login-header">
                <h1 className="login-title">New Password</h1>
                <p className="login-subtitle">Enter your new secure password</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
                <div className="form-group">
                    <div className="input-container">
                        <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="form-input with-icon"
                            placeholder="New Password"
                            required
                        />
                        <div className="input-icon-inside"><FaLock /></div>
                    </div>
                </div>

                <div className="form-group">
                    <div className="input-container">
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="form-input with-icon"
                            placeholder="Confirm New Password"
                            required
                        />
                        <div className="input-icon-inside"><FaLock /></div>
                    </div>
                </div>

                {error && <div className="error-message">{error}</div>}
                {message && <div className="success-message">{message}</div>}

                <button
                    type="submit"
                    className="login-button"
                    disabled={isLoading || !!message}
                >
                    {isLoading ? 'Resetting...' : 'Reset Password'}
                </button>
            </form>
        </div>
    );
};

export default ResetPassword;
