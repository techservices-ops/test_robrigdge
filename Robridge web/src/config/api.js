// Centralized API Configuration
// Priority: window.location.origin (production browser) → REACT_APP_API_URL env var → localhost:3001 (dev)
export const getServerURL = () => {
  // If running in a browser and not on localhost, use current origin
  if (typeof window !== 'undefined' && window.location && window.location.hostname !== 'localhost') {
    return window.location.origin;
  }
  return process.env.REACT_APP_API_URL || 'http://localhost:3001';
};
