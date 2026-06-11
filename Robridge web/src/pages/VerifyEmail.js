import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { FaCheckCircle, FaSpinner, FaPaperPlane } from 'react-icons/fa';
import { getServerURL } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

const VerifyEmail = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { loginWithUser } = useAuth();

    // Support both direct token redirection (backward compatibility) AND OTP
    const token = searchParams.get('token');
    const emailParam = searchParams.get('email');

    const [email, setEmail] = useState(emailParam || '');
    const [otp, setOtp] = useState('');
    const [status, setStatus] = useState(token ? 'verifying' : 'idle'); // verifying, success, error, idle
    const [message, setMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Resend cooldown state
    const [resendCooldown, setResendCooldown] = useState(0);
    const cooldownTimer = useRef(null);

    // If a token parameter is found in URL, run legacy link verification immediately.
    useEffect(() => {
        if (token) {
            window.location.href = `${getServerURL()}/api/auth/verify?token=${token}`;
        }
    }, [token]);

    // Handle resend countdown
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

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (!otp || otp.trim().length !== 6) {
            setError('Please enter a valid 6-digit verification code');
            return;
        }

        setIsLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await fetch(`${getServerURL()}/api/auth/verify-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email.trim(),
                    otp: otp.trim()
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setStatus('success');
                setMessage(data.message || 'Email verified successfully!');
                
                // Automatically log user in and redirect
                if (data.user && data.token) {
                    loginWithUser(data.user, data.token);
                }

                setTimeout(() => {
                    if (data.hasWorkspace) {
                        navigate('/dashboard');
                    } else {
                        navigate('/onboarding');
                    }
                }, 2000);
            } else {
                setError(data.error || 'Verification failed. Please check your code.');
            }
        } catch (err) {
            console.error('OTP verification error:', err);
            setError('Connection error. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendOtp = async () => {
        if (resendCooldown > 0) return;

        setIsLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await fetch(`${getServerURL()}/api/auth/resend-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email.trim()
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setSuccess(data.message || 'A new verification code has been sent.');
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

    if (status === 'verifying') {
        return (
            <div className="login-content" style={{ width: '100%', maxWidth: '450px', padding: '20px', textAlign: 'center' }}>
                <div className="login-header">
                    <img src={`${process.env.PUBLIC_URL}/static/media/robridge-logo.png`} alt="Robridge Logo" className="logo-image" />
                    <h1 className="login-title">Email Verification</h1>
                </div>
                <div style={{ padding: '40px 20px' }}>
                    <FaSpinner size={50} color="#007bff" className="fa-spin" />
                    <p style={{ marginTop: '20px', color: '#666' }}>Verifying your email...</p>
                </div>
            </div>
        );
    }

    if (status === 'success') {
        return (
            <div className="login-content" style={{ width: '100%', maxWidth: '450px', padding: '20px', textAlign: 'center' }}>
                <div className="login-header">
                    <img src={`${process.env.PUBLIC_URL}/static/media/robridge-logo.png`} alt="Robridge Logo" className="logo-image" />
                    <h1 className="login-title">Email Verification</h1>
                </div>
                <div style={{ padding: '40px 20px' }}>
                    <FaCheckCircle size={50} color="#28a745" />
                    <h2 style={{ color: '#28a745', marginTop: '20px' }}>Success!</h2>
                    <p style={{ color: '#666', marginTop: '10px' }}>{message}</p>
                    <p style={{ color: '#999', marginTop: '20px' }}>Redirecting to workspace setup...</p>
                </div>
            </div>
        );
    }

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
                <h1 className="login-title">Verify Your Email</h1>
                <p className="login-subtitle">
                    A 6-digit verification code has been sent to <br />
                    <strong style={{ color: '#333' }}>{email || 'your email address'}</strong>
                </p>
            </div>

            <form className="login-form" onSubmit={handleVerifyOtp}>
                {!emailParam && (
                    <div className="form-group">
                        <label htmlFor="email" style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '0.9rem' }}>Email Address</label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="form-input"
                            placeholder="Enter your email"
                            required
                            disabled={isLoading}
                        />
                    </div>
                )}

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
                        disabled={isLoading}
                    />
                </div>

                {error && <div className="error-message">{error}</div>}
                {success && <div className="success-message">{success}</div>}

                <button
                    type="submit"
                    className={`login-button ${isLoading ? 'loading' : ''}`}
                    disabled={isLoading || otp.length !== 6 || !email}
                >
                    {isLoading ? (
                        <>
                            <div className="spinner" style={{ margin: 0 }}></div>
                            <span>Verifying...</span>
                        </>
                    ) : (
                        <span>Verify Code</span>
                    )}
                </button>
            </form>

            <div className="login-footer" style={{ marginTop: '20px', textAlign: 'center' }}>
                <p style={{ color: '#666', marginBottom: '10px' }}>
                    Didn't receive the code?
                </p>
                <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={isLoading || resendCooldown > 0 || !email}
                    className="btn-secondary"
                    style={{
                        background: 'none',
                        border: 'none',
                        color: resendCooldown > 0 ? '#999' : '#007bff',
                        fontWeight: 'bold',
                        cursor: resendCooldown > 0 ? 'default' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <FaPaperPlane size={12} />
                    {resendCooldown > 0 ? `Resend Code (${resendCooldown}s)` : 'Resend Code'}
                </button>

                <div style={{ marginTop: '20px' }}>
                    <Link to="/login" style={{ color: '#007bff', textDecoration: 'none', fontSize: '0.9rem' }}>
                        ← Back to Sign In
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default VerifyEmail;
