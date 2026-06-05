// Centralized API Configuration
// Priority: REACT_APP_API_URL env var → localhost:3001 (dev)
// Set REACT_APP_API_URL in your .env.production for deployment
export const getServerURL = () => {
  return process.env.REACT_APP_API_URL || 'http://localhost:3001';
};
