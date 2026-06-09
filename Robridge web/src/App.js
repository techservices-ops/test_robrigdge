import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { UIProvider } from './contexts/UIContext';
import GlobalUIComponents from './components/GlobalUI/GlobalUIComponents';
// ChatWidget disabled — replaced by IMSChatBot
import AuthLayout from './components/AuthLayout';
import Navigation from './components/Navigation';
import IMSChatBot from './components/IMSChatBot';
import ErrorBoundary from './components/ErrorBoundary';
import ConfirmModal from './components/ConfirmModal';
import ToastContainer from './components/Toast';
import './styles/design-system.css';
import './App.css';

// ── Lazy-loaded pages (code-split into separate chunks) ──────────────────────
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const SignupPage = React.lazy(() => import('./pages/SignupPage'));
const ForgotPassword = React.lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = React.lazy(() => import('./pages/VerifyEmail'));
const BarcodeGenerator = React.lazy(() => import('./pages/BarcodeGenerator'));
const ImageProcessing = React.lazy(() => import('./pages/ImageProcessing'));
const RobotControl = React.lazy(() => import('./pages/RobotControl'));
const RackStatus = React.lazy(() => import('./pages/RackStatus'));
const RackManagement = React.lazy(() => import('./pages/RackManagement'));
const ProductManagement = React.lazy(() => import('./pages/ProductManagement'));
const DeviceConnected = React.lazy(() => import('./pages/DeviceConnected'));
const Profile = React.lazy(() => import('./pages/Profile'));
const Settings = React.lazy(() => import('./pages/Settings'));
const DevicesPage = React.lazy(() => import('./pages/DevicesPage'));
const DeviceManager = React.lazy(() => import('./pages/DeviceManager'));
const IMSDashboard = React.lazy(() => import('./pages/IMSDashboard'));
const IMSCatalog = React.lazy(() => import('./pages/IMSCatalog'));
const IMSScanner = React.lazy(() => import('./pages/IMSScanner'));
const IMSSettings = React.lazy(() => import('./pages/IMSSettings'));
const IMSUsers = React.lazy(() => import('./pages/IMSUsers'));
const IMSWorkOrders = React.lazy(() => import('./pages/IMSWorkOrders'));
const IMSProduction = React.lazy(() => import('./pages/IMSProduction'));
const IMSLocations = React.lazy(() => import('./pages/IMSLocations'));
const IMSGrn = React.lazy(() => import('./pages/IMSGrn'));
const IMSReports = React.lazy(() => import('./pages/IMSReports'));
const IMSErp = React.lazy(() => import('./pages/IMSErp'));
const IMSComponentReplacement = React.lazy(() => import('./pages/IMSComponentReplacement'));
const WorkspaceOnboarding = React.lazy(() => import('./pages/WorkspaceOnboarding'));

// ── Page loading spinner (shown while lazy chunks load) ──────────────────────
const PageLoadingSpinner = () => (
  <div className="loading-container">
    <div className="loading-spinner">
      <div className="spinner"></div>
      <p>Loading...</p>
    </div>
  </div>
);

// Protected Route Component with Role-based Access Control
function ProtectedRoute({ children, requiredPath }) {
  const { isAuthenticated, hasPageAccess, isLoading } = useAuth();
  const { workspaces, loadingWorkspaces } = useWorkspace();

  // Optimistic rendering: If authenticated (optimistically), render children even if loading.
  if (isLoading && !isAuthenticated()) {
    return (
      <div className="loading-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  // Removed forced redirect to onboarding so users go straight to dashboard upon login
  if (requiredPath && requiredPath !== '/onboarding' && !hasPageAccess(requiredPath)) {
    return (
      <div className="access-denied">
        <div className="access-denied-content">
          <h2>Access Denied</h2>
          <p>You don't have permission to access this page.</p>
          <p>Your role doesn't include access to this feature.</p>
          <button onClick={() => window.history.back()}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// Main App Content Component
function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading spinner only if we don't have a user session yet
  // If we have a user (optimistic load), we render the app immediately while verifying in background
  if (isLoading && !isAuthenticated()) {
    return (
      <div className="loading-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading RobBridge...</p>
        </div>
      </div>
    );
  }

  // Show login/signup page if not authenticated
  if (!isAuthenticated()) {
    return (
      <Suspense fallback={<PageLoadingSpinner />}>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="*" element={<LoginPage />} />
          </Route>
        </Routes>
      </Suspense>
    );
  }

  // Show main application if authenticated
  return (
    <Routes>
      {/* ── Onboarding: full-screen, no sidebar ── */}
      <Route path="/onboarding" element={
        <ProtectedRoute requiredPath="/onboarding">
          <WorkspaceOnboarding />
        </ProtectedRoute>
      } />

      {/* ── All other pages: inside the App shell with sidebar ── */}
      <Route path="*" element={
        <div className="App">
          <Navigation />
          <main className="app-main-content">
            <Suspense fallback={<PageLoadingSpinner />}>
              <Routes>
                <Route path="/" element={<ProtectedRoute requiredPath="/"><IMSDashboard /></ProtectedRoute>} />
                <Route path="/generator" element={<ProtectedRoute requiredPath="/generator"><BarcodeGenerator /></ProtectedRoute>} />
                <Route path="/image-processing" element={<ProtectedRoute requiredPath="/image-processing"><ImageProcessing /></ProtectedRoute>} />
                <Route path="/robot-control" element={<ProtectedRoute requiredPath="/robot-control"><RobotControl /></ProtectedRoute>} />
                <Route path="/rack-status" element={<ProtectedRoute requiredPath="/rack-status"><RackStatus /></ProtectedRoute>} />
                <Route path="/rack-management" element={<ProtectedRoute requiredPath="/rack-management"><RackManagement /></ProtectedRoute>} />
                <Route path="/product-management" element={<ProtectedRoute requiredPath="/product-management"><ProductManagement /></ProtectedRoute>} />
                <Route path="/device-connected" element={<ProtectedRoute requiredPath="/device-connected"><DeviceConnected /></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute requiredPath="/profile"><Profile /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute requiredPath="/settings"><Settings /></ProtectedRoute>} />
                <Route path="/devices" element={<ProtectedRoute requiredPath="/devices"><DevicesPage /></ProtectedRoute>} />
                <Route path="/device-manager" element={<ProtectedRoute requiredPath="/device-manager"><DeviceManager /></ProtectedRoute>} />
                <Route path="/ims-catalog" element={<ProtectedRoute requiredPath="/ims-catalog"><IMSCatalog /></ProtectedRoute>} />
                <Route path="/ims-scanner" element={<ProtectedRoute requiredPath="/ims-scanner"><IMSScanner /></ProtectedRoute>} />
                <Route path="/ims-settings" element={<ProtectedRoute requiredPath="/ims-settings"><IMSSettings /></ProtectedRoute>} />
                <Route path="/ims-users" element={<ProtectedRoute requiredPath="/ims-users"><IMSUsers /></ProtectedRoute>} />
                <Route path="/ims-workorders" element={<ProtectedRoute requiredPath="/ims-workorders"><IMSWorkOrders /></ProtectedRoute>} />
                <Route path="/ims-production" element={<ProtectedRoute requiredPath="/ims-production"><IMSProduction /></ProtectedRoute>} />
                <Route path="/ims-locations" element={<ProtectedRoute requiredPath="/ims-locations"><IMSLocations /></ProtectedRoute>} />
                <Route path="/ims-grn" element={<ProtectedRoute requiredPath="/ims-grn"><IMSGrn /></ProtectedRoute>} />
                <Route path="/ims-reports" element={<ProtectedRoute requiredPath="/ims-reports"><IMSReports /></ProtectedRoute>} />
                <Route path="/ims-erp" element={<ProtectedRoute requiredPath="/ims-erp"><IMSErp /></ProtectedRoute>} />
                <Route path="/ims-components" element={<ProtectedRoute requiredPath="/ims-components"><IMSComponentReplacement /></ProtectedRoute>} />
                <Route path="/login" element={<LoginPage />} />
              </Routes>
            </Suspense>
          </main>
          <IMSChatBot />
        </div>
      } />
    </Routes>
  );
}

// Main App Component with Auth Provider
// In development, handle both root and /bvs paths (for testing)
// In production, strictly use /bvs as per deployment requirement
const routerBasename = process.env.NODE_ENV === 'production' ? '/bvs' : '/';

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <WorkspaceProvider>
          <WebSocketProvider>
            <UIProvider>
              <Router basename={routerBasename}>
                <ErrorBoundary>
                  <AppContent />
                </ErrorBoundary>
                <GlobalUIComponents />
                <ConfirmModal />
                <ToastContainer />
              </Router>
            </UIProvider>
          </WebSocketProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
