import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { FaCheckCircle, FaExclamationCircle, FaSpinner } from 'react-icons/fa';
import { useAuth } from '../contexts/AuthContext';
import { getServerURL } from '../config/api';
import './LoginPage.css';

const VerifyEmail = () => {
    const { loginWithUser } = useAuth();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');

    const [status, setStatus] = useState('verifying'); // verifying, success, error
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!token) {
            setStatus('error');
            setMessage('Invalid verification link. Token is missing.');
            return;
        }

        // Call verification API
        const verifyEmail = async () => {
            try {
                // Use the backend API URL
                const apiUrl = getServerURL();
                const response = await fetch(`${apiUrl}/api/auth/verify-email?token=${token}`);
                const data = await response.json();

                if (data.success) {
                    setStatus('success');
                    setMessage(data.message);
                    
                    // Automatically log user in
                    if (data.user && data.token) {
                        loginWithUser(data.user, data.token);
                    }
                    
                    // Redirect to onboarding after 2 seconds
                    setTimeout(() => {
                        navigate('/onboarding');
                    }, 2000);
                } else {
                    setStatus('error');
                    setMessage(data.error || 'Verification failed');
                }
            } catch (err) {
                console.error('Verification error:', err);
                setStatus('error');
                setMessage('An error occurred during verification. Please try again.');
            }
        };

        verifyEmail();
    }, [token, navigate]);

    return (
        <div className="login-content" style={{ width: '100%', maxWidth: '450px', padding: '20px', textAlign: 'center' }}>
            <div className="login-header">
                <img
                    src={`${process.env.PUBLIC_URL}/static/media/robridge-logo.png`}
                    alt="Robridge Logo"
                    className="logo-image"
                    onError={(e) => {
                        e.target.style.display = 'none';
                    }}
                />
                <h1 className="login-title">Email Verification</h1>
            </div>

            <div style={{ padding: '40px 20px' }}>
                {status === 'verifying' && (
                    <div>
                        <FaSpinner size={50} color="#007bff" className="fa-spin" />
                        <p style={{ marginTop: '20px', color: '#666' }}>Verifying your email...</p>
                    </div>
                )}

                {status === 'success' && (
                    <div>
                        <FaCheckCircle size={50} color="#28a745" />
                        <h2 style={{ color: '#28a745', marginTop: '20px' }}>Success!</h2>
                        <p style={{ color: '#666', marginTop: '10px' }}>{message}</p>
                        <p style={{ color: '#999', marginTop: '20px' }}>Redirecting to workspace setup...</p>
                    </div>
                )}

                {status === 'error' && (
                    <div>
                        <FaExclamationCircle size={50} color="#dc3545" />
                        <h2 style={{ color: '#dc3545', marginTop: '20px' }}>Verification Failed</h2>
                        <p style={{ color: '#666', marginTop: '10px' }}>{message}</p>
                        <Link to="/login" className="login-button" style={{ marginTop: '30px', display: 'inline-block', textDecoration: 'none' }}>
                            Go to Login
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VerifyEmail;
