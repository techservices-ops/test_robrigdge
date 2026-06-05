import React, { createContext, useContext, useState, useEffect } from 'react';

import { getServerURL } from '../config/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Role definitions
export const ROLES = {
  ADMIN: 'admin',
  EXPO_USER: 'expo_user',
  FULL_ACCESS: 'full_access'
};

// Page access control
export const PAGE_ACCESS = {
  [ROLES.ADMIN]: [
    '/', '/scanner', '/scanned-barcodes', '/stock-track', '/generator', '/saved-scans', '/image-processing', '/robot-control',
    '/rack-status', '/rack-management', '/product-management', '/device-connected', '/devices', '/device-manager', '/settings', '/scan-comparison',
    '/ims-dashboard', '/ims-catalog', '/ims-scanner', '/ims-settings', '/ims-users',
    '/ims-workorders', '/ims-production', '/ims-locations', '/ims-grn', '/ims-reports'
  ],
  [ROLES.EXPO_USER]: [
    '/', '/scanner', '/scanned-barcodes', '/stock-track', '/saved-scans', '/device-connected', '/devices', '/device-manager', '/profile', '/scan-comparison',
    '/ims-dashboard', '/ims-catalog', '/ims-scanner', '/ims-settings', '/ims-users',
    '/ims-workorders', '/ims-production', '/ims-locations', '/ims-grn', '/ims-reports'
  ],
  [ROLES.FULL_ACCESS]: [
    '/', '/scanner', '/scanned-barcodes', '/stock-track', '/generator', '/saved-scans', '/image-processing', '/robot-control',
    '/rack-status', '/rack-management', '/product-management', '/device-connected', '/devices', '/device-manager', '/settings', '/scan-comparison',
    '/ims-dashboard', '/ims-catalog', '/ims-scanner', '/ims-settings', '/ims-users',
    '/ims-workorders', '/ims-production', '/ims-locations', '/ims-grn', '/ims-reports'
  ]
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('robridge_user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch (error) {
      console.error('Error parsing saved user:', error);
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);

  // Get server URL - Uses centralized config logic
  // const getServerURL is imported

  // Check for existing session on app load
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const savedUser = localStorage.getItem('robridge_user');

        if (savedUser) {
          // Verify token with backend
          try {
            const response = await fetch(`${getServerURL()}/api/auth/verify`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json'
              },
              credentials: 'include'
            });

            if (response.ok) {
              const data = await response.json();
              if (data.success) {
                const userData = {
                  ...data.user,
                  isAuthenticated: true,
                  allowedPages: PAGE_ACCESS[data.user.role] || []
                };
                setUser(userData);
                localStorage.setItem('robridge_user', JSON.stringify(userData));
              } else {
                // Token invalid, clear storage
                localStorage.removeItem('robridge_user');
              }
            } else {
              // Token invalid, clear storage
              localStorage.removeItem('robridge_user');
            }
          } catch (error) {
            console.error('Error verifying token:', error);
            // If verification fails, try to use saved user data (offline mode)
            const userData = JSON.parse(savedUser);
            setUser(userData);
          }
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        localStorage.removeItem('robridge_user');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    try {
      if (!email || !password) {
        return {
          success: false,
          message: 'Email and password are required'
        };
      }

      // Call backend login API
      const response = await fetch(`${getServerURL()}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password
        }),
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Store user data (token is stored securely in httpOnly cookie)

        const userInfo = {
          ...data.user,
          loginTime: new Date().toISOString(),
          isAuthenticated: true,
          allowedPages: PAGE_ACCESS[data.user.role] || []
        };

        localStorage.setItem('robridge_user', JSON.stringify(userInfo));
        // Also store the raw JWT for cross-origin API calls (Bearer token auth)
        if (data.token) localStorage.setItem('robridge_token', data.token);
        setUser(userInfo);

        return {
          success: true,
          message: data.message || 'Login successful',
          user: userInfo
        };
      } else {
        return {
          success: false,
          message: data.error || 'Login failed. Please check your credentials.'
        };
      }
    } catch (error) {
      console.error('Error during login:', error);
      return {
        success: false,
        message: 'Login failed. Please check your connection and try again.'
      };
    }
  };

  const register = async (email, password, name) => {
    try {
      if (!email || !password) {
        return {
          success: false,
          message: 'Email and password are required'
        };
      }

      // Call backend register API
      const response = await fetch(`${getServerURL()}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
          name: name ? name.trim() : email.split('@')[0]
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return {
          success: true,
          message: data.message || 'Registration successful',
          user: data.user,
          token: data.token,
          email: data.email,
          requiresVerification: data.requiresVerification
        };
      } else {
        return {
          success: false,
          message: data.error || 'Registration failed. Please try again.'
        };
      }
    } catch (error) {
      console.error('Error during registration:', error);
      return {
        success: false,
        message: 'Registration failed. Please check your connection and try again.'
      };
    }
  };

  const logout = async () => {
    try {
      setUser(null);
      localStorage.removeItem('robridge_user');
      localStorage.removeItem('robridge_token');
      await fetch(`${getServerURL()}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      return true;
    } catch (error) {
      console.error('Error clearing user data:', error);
      return false;
    }
  };

  const isAuthenticated = () => {
    return user && user.isAuthenticated;
  };

  const getUserInfo = () => {
    return user;
  };

  const hasPageAccess = (path) => {
    if (!user) {
      return false;
    }
    const currentAllowed = PAGE_ACCESS[user.role];
    if (currentAllowed) {
      return currentAllowed.includes(path);
    }
    return user.allowedPages ? user.allowedPages.includes(path) : false;
  };

  const getUserRole = () => {
    return user ? user.role : null;
  };

  const isExpoUser = () => {
    return user && user.role === ROLES.EXPO_USER;
  };

  const isAdmin = () => {
    return user && user.role === ROLES.ADMIN;
  };

  const isFullAccess = () => {
    return user && user.role === ROLES.FULL_ACCESS;
  };

  const loginWithUser = (userData, token) => {
    const userInfo = {
      ...userData,
      loginTime: new Date().toISOString(),
      isAuthenticated: true,
      allowedPages: PAGE_ACCESS[userData.role] || []
    };
    localStorage.setItem('robridge_user', JSON.stringify(userInfo));
    if (token) localStorage.setItem('robridge_token', token);
    setUser(userInfo);
  };

  const value = {
    user,
    isLoading,
    login,
    loginWithUser,
    register,
    logout,
    isAuthenticated,
    getUserInfo,
    hasPageAccess,
    getUserRole,
    isExpoUser,
    isAdmin,
    isFullAccess,
    ROLES,
    PAGE_ACCESS
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
