import React, { useState, useEffect, useRef } from 'react';
import { FaLock, FaEnvelope, FaPaperPlane } from 'react-icons/fa';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { getServerURL } from '../config/api';
import './LoginPage.css';

const ResetPassword = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');
    const emailParam = searchParams.get('email');

    const [email, setEmail] = useState(emailParam || '');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [resendCooldown, setResendCooldown] = useState(0);
    const cooldownTimer = useRef(null);

    // Resend cooldown timer effect
    useEffect(() => {
        if (resendCooldown > 0) {
            cooldownTimer.current = setInterval(() => {
                setResendCooldown(prev => prev - 1);
            }, 1000);
        } else if (resendCooldown === 0 && cooldownTimer.current) {
            clearInterval(cooldownTimer.current);
        }
        return () => {
            if (cooldownTimer.current) clearInterval(cooldownTimer.current);
        };
    }, [resendCooldown]);

    const handleResendOtp = async () => {
        if (resendCooldown > 0 || !email) return;

        setIsLoading(true);
        setError('');
        setSuccess('');

        try {
            const apiUrl = getServerURL();
            const response = await fetch(`${apiUrl}/api/auth/forgot-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: email.trim() })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setSuccess(data.message || 'A new reset code has been sent.');
                setResendCooldown(30); // 30 seconds cooldown
            } else {
                setError(data.error || 'Failed to resend code.');
            }
        } catch (err) {
            console.error('OTP resend error:', err);
            setError('Connection error. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

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
        setSuccess('');

        try {
            const apiUrl = getServerURL();
            const payload = token 
                ? { token, newPassword }
                : { email: email.trim(), otp: otp.trim(), newPassword };

            const response = await fetch(`${apiUrl}/api/auth/reset-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setSuccess('Password reset successful! Redirecting to login...');
                setTimeout(() => {
                    navigate('/login');
                }, 2000);
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

    // If neither token nor email (or manual entry option) is available, show access error.
    // However, in OTP flow we can let the user enter their email manually if they hit this page without URL parameters.
    const isOtpMode = !token;

    return (
        <div className="login-content" style={{ width: '100%', maxWidth: '450px', padding: '20px' }}>
            <div className="login-header" style={{ textAlign: 'center' }}>
                <img
                    src={`${process.env.PUBLIC_URL}/static/media/robridge-logo.png`}
                    alt="Robridge Logo"
                    className="logo-image"
                    onError={(e) => {
                        e.target.style.display = 'none';
                    }}
                />
                <h1 className="login-title">{isOtpMode ? 'Reset Password' : 'New Password'}</h1>
                <p className="login-subtitle">
                    {isOtpMode 
                        ? `Enter the 6-digit code sent to ${email || 'your email'}` 
                        : 'Enter your new secure password'
                    }
                </p>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
                {isOtpMode && !emailParam && (
                    <div className="form-group">
                        <label htmlFor="email" style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '0.9rem' }}>Email Address</label>
                        <div className="input-container">
                            <input
                                type="email"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="form-input with-icon"
                                placeholder="Enter your email"
                                required
                                disabled={isLoading || !!success}
                            />
                            <div className="input-icon-inside"><FaEnvelope /></div>
                        </div>
                    </div>
                )}

                {isOtpMode && (
                    <div className="form-group">
                        <label htmlFor="otp" style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '0.9rem' }}>6-Digit Code</label>
                        <input
                            type="text"
                            id="otp"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            className="form-input"
                            placeholder="123456"
                            maxLength="6"
                            pattern="\d{6}"
                            style={{ textAlign: 'center', fontSize: '1.8rem', letterSpacing: '8px', fontWeight: 'bold' }}
                            required
                            disabled={isLoading || !!success}
                        />
                    </div>
                )}

                <div className="form-group">
                    <label htmlFor="newPassword" style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '0.9rem' }}>New Password</label>
                    <div className="input-container">
                        <input
                            type="password"
                            id="newPassword"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="form-input with-icon"
                            placeholder="New Password"
                            required
                            disabled={isLoading || !!success}
                        />
                        <div className="input-icon-inside"><FaLock /></div>
                    </div>
                </div>

                <div className="form-group">
                    <label htmlFor="confirmPassword" style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '0.9rem' }}>Confirm New Password</label>
                    <div className="input-container">
                        <input
                            type="password"
                            id="confirmPassword"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="form-input with-icon"
                            placeholder="Confirm New Password"
                            required
                            disabled={isLoading || !!success}
                        />
                        <div className="input-icon-inside"><FaLock /></div>
                    </div>
                </div>

                {error && <div className="error-message">{error}</div>}
                {success && <div className="success-message">{success}</div>}

                <button
                    type="submit"
                    className={`login-button ${isLoading ? 'loading' : ''}`}
                    disabled={isLoading || !!success || (isOtpMode && (otp.length !== 6 || !email))}
                >
                    {isLoading ? 'Processing...' : 'Reset Password'}
                </button>
            </form>

            {isOtpMode && (
                <div className="login-footer" style={{ marginTop: '20px', textAlign: 'center' }}>
                    <p style={{ color: '#666', marginBottom: '10px' }}>
                        Didn't receive the code?
                    </p>
                    <button
                        type="button"
                        onClick={handleResendOtp}
                        disabled={isLoading || resendCooldown > 0 || !email || !!success}
                        className="btn-secondary"
                        style={{
                            background: 'none',
                            border: 'none',
                            color: (resendCooldown > 0 || !!success) ? '#999' : '#007bff',
                            fontWeight: 'bold',
                            cursor: (resendCooldown > 0 || !!success) ? 'default' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        <FaPaperPlane size={12} />
                        {resendCooldown > 0 ? `Resend Code (${resendCooldown}s)` : 'Resend Code'}
                    </button>
                </div>
            )}

            <div className="login-footer" style={{ marginTop: '20px', textAlign: 'center' }}>
                <Link to="/login" style={{ color: '#007bff', textDecoration: 'none', fontSize: '0.9rem' }}>
                    ← Back to Sign In
                </Link>
            </div>
        </div>
    );
};

export default ResetPassword;
