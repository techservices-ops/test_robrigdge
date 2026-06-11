import React, { useState } from 'react';
import { FaEye, FaEyeSlash, FaLock, FaEnvelope, FaSignInAlt } from 'react-icons/fa';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear messages when user starts typing
    if (error) setError('');
    if (success) setSuccess('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    // Basic validation
    if (!formData.email || !formData.password) {
      setError('Please fill in all fields');
      setIsLoading(false);
      return;
    }

    if (!formData.email.includes('@')) {
      setError('Please enter a valid email address');
      setIsLoading(false);
      return;
    }

    // Call the login function from auth context
    try {
      const result = await login(formData.email, formData.password);

      if (result.success) {
        setSuccess(result.message || 'Login successful! Redirecting...');
        // Navigate immediately to prevent flash
        navigate('/');
      } else {
        if (result.requiresVerification) {
          setError('Email not verified. Redirecting to verification page...');
          setTimeout(() => {
            navigate(`/verify-email?email=${encodeURIComponent(result.email || formData.email)}`);
          }, 1500);
        } else {
          setError(result.message || 'Login failed. Please try again.');
        }
      }

    } catch (err) {
      console.error('Login error:', err);
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
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
            e.target.nextSibling.style.display = 'block';
          }}
        />
        <div className="logo-fallback" style={{ display: 'none' }}>
          <div className="-text">ROBRIDGE</div>
        </div>
        <h1 className="login-title">Sign In</h1>
        <p className="login-subtitle">Welcome to RoBridge Community</p>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <div className="input-container">
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              className="form-input with-icon"
              placeholder="Gmail"
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
              id="password"
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
              onClick={togglePasswordVisibility}
              disabled={isLoading}
            >
              {showPassword ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {success && (
          <div className="success-message">
            {success}
          </div>
        )}

        <div style={{ textAlign: 'right', marginBottom: '15px' }}>
          <Link to="/forgot-password" style={{ color: '#007bff', textDecoration: 'none', fontSize: '0.9rem' }}>
            Forgot Password?
          </Link>
        </div>

        <button
          type="submit"
          className={`login-button ${isLoading ? 'loading' : ''}`}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <div className="spinner" style={{ margin: 0 }}></div>
              <span>Signing In...</span>
            </>
          ) : (
            <>
              <FaSignInAlt />
              <span>Sign In</span>
            </>
          )}
        </button>
      </form>

      <div className="login-footer" style={{ marginTop: '20px', textAlign: 'center' }}>
        <p style={{ color: '#666' }}>
          Don't have an account?{' '}
          <Link to="/signup" style={{ color: '#007bff', textDecoration: 'none', fontWeight: 'bold' }}>
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
