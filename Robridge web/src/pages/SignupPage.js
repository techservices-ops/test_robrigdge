import React, { useState } from 'react';
import { FaEye, FaEyeSlash, FaLock, FaEnvelope, FaUserPlus, FaUser } from 'react-icons/fa';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import './LoginPage.css'; // Reuse login styles

const SignupPage = () => {
    const { register, loginWithUser } = useAuth();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        confirmPassword: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // No background polling needed for OTP verification flow

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
        if (error) setError('');
        if (success) setSuccess('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');
        setSuccess('');

        // Validation
        if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
            setError('Please fill in all fields');
            setIsLoading(false);
            return;
        }

        if (!formData.email.includes('@')) {
            setError('Please enter a valid email address');
            setIsLoading(false);
            return;
        }

        if (formData.password.length < 6) {
            setError('Password must be at least 6 characters long');
            setIsLoading(false);
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            setIsLoading(false);
            return;
        }

        try {
            const result = await register(formData.email, formData.password, formData.name);

            if (result.success) {
                if (result.requiresVerification) {
                    setSuccess('Registration successful! Redirecting to verification...');
                    setTimeout(() => {
                        navigate(`/verify-email?email=${encodeURIComponent(result.email)}`);
                    }, 1000);
                } else {
                    setSuccess('Registration successful! Redirecting to setup...');
                    if (result.user && result.token) {
                        loginWithUser(result.user, result.token);
                    }
                    navigate('/onboarding');
                }
            } else {
                setError(result.message || 'Registration failed. Please try again.');
            }

        } catch (err) {
            console.error('Registration error:', err);
            setError('Registration failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Render signup form (wait state is handled on the dedicated VerifyEmail route)

    return (
        <div className="login-content" style={{ width: '100%', maxWidth: '450px', padding: '20px' }}>
            <div className="login-header">
                <img
                    src={`${process.env.PUBLIC_URL}/static/media/robridge-logo.png`}
                    alt="Robridge Logo"
                    className="logo-image"
                    onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'block';
                    }}
                />
                <div className="logo-fallback" style={{ display: 'none' }}>
                    <div className="-text">ROBRIDGE</div>
                </div>
                <h1 className="login-title">Create Account</h1>
                <p className="login-subtitle">Join the RoBridge Community</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
                <div className="form-group">
                    <div className="input-container">
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleInputChange}
                            className="form-input with-icon"
                            placeholder="Full Name"
                            required
                            disabled={isLoading}
                        />
                        <div className="input-icon-inside">
                            <FaUser />
                        </div>
                    </div>
                </div>

                <div className="form-group">
                    <div className="input-container">
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleInputChange}
                            className="form-input with-icon"
                            placeholder="Email Address"
                            required
                            disabled={isLoading}
                        />
                        <div className="input-icon-inside">
                            <FaEnvelope />
                        </div>
                    </div>
                </div>

                <div className="form-group">
                    <div className="input-container">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            name="password"
                            value={formData.password}
                            onChange={handleInputChange}
                            className="form-input with-icon"
                            placeholder="Password"
                            required
                            disabled={isLoading}
                        />
                        <div className="input-icon-inside">
                            <FaLock />
                        </div>
                        <button
                            type="button"
                            className="password-toggle"
                            onClick={() => setShowPassword(!showPassword)}
                            disabled={isLoading}
                        >
                            {showPassword ? <FaEyeSlash /> : <FaEye />}
                        </button>
                    </div>
                </div>

                <div className="form-group">
                    <div className="input-container">
                        <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            name="confirmPassword"
                            value={formData.confirmPassword}
                            onChange={handleInputChange}
                            className="form-input with-icon"
                            placeholder="Confirm Password"
                            required
                            disabled={isLoading}
                        />
                        <div className="input-icon-inside">
                            <FaLock />
                        </div>
                        <button
                            type="button"
                            className="password-toggle"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            disabled={isLoading}
                        >
                            {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                        </button>
                    </div>
                </div>

                {error && <div className="error-message">{error}</div>}
                {success && <div className="success-message">{success}</div>}

                <button
                    type="submit"
                    className={`login-button ${isLoading ? 'loading' : ''}`}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <>
                            <div className="spinner" style={{ margin: 0 }}></div>
                            <span>Creating Account...</span>
                        </>
                    ) : (
                        <>
                            <FaUserPlus />
                            <span>Sign Up</span>
                        </>
                    )}
                </button>
            </form>

            <div className="login-footer" style={{ marginTop: '20px', textAlign: 'center' }}>
                <p style={{ color: '#666' }}>
                    Already have an account?{' '}
                    <Link to="/login" style={{ color: '#007bff', textDecoration: 'none', fontWeight: 'bold' }}>
                        Sign In
                    </Link>
                </p>
            </div>
        </div>
    );
};

export default SignupPage;
