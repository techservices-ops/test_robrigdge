import React from 'react';
import { Outlet } from 'react-router-dom';
import './AuthLayout.css';

const AuthLayout = () => {
    const features = [
        {
            icon: '⚡',
            title: 'Real-time Scanning',
            description: 'Instant barcode recognition'
        },
        {
            icon: '🔒',
            title: 'Secure & Reliable',
            description: 'Enterprise-grade security'
        },
        {
            icon: '⚡',
            title: 'Fast Processing',
            description: 'Lightning-fast performance'
        }
    ];

    return (
        <div className="auth-layout">
            <div className="auth-left">
                <Outlet />
            </div>
            <div className="auth-right">
                <div className="right-content">
                    <div className="hero-section">
                        <div className="scanner-image-container">
                            <img
                                src={`${process.env.PUBLIC_URL}/static/media/scanner.png`}
                                alt="Barcode Scanner"
                                className="scanner-image"
                            />
                            <div className="model-text">"BVS - 110"</div>
                            <div className="scanner-glow"></div>
                        </div>
                        <h1 className="hero-title">
                            Scan smarter. Work faster.
                        </h1>
                        <p className="hero-subtitle">
                            Transform your workflow with intelligent barcode management
                        </p>
                    </div>

                    <div className="features-grid">
                        {features.map((feature, index) => (
                            <div key={index} className="feature-card">
                                <div className="feature-icon">{feature.icon}</div>
                                <h3 className="feature-title">{feature.title}</h3>
                                <p className="feature-description">{feature.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuthLayout;
