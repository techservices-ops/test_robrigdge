import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  FaHome,
  
  FaQrcode,
  FaImage,
  FaRobot,
  
  
  FaCog,
  FaCogs,
  FaMicroscope,
  FaDatabase,
  
  FaUserCircle,
  FaUsers,
  FaBars,
  FaTimes,
  FaSignOutAlt,
  FaBuilding,
  FaChevronDown,
  FaPlus,
  FaClipboardList,
  FaIndustry,
  FaMapMarkerAlt,
  FaFileInvoice,
  FaChartBar,
  FaPlug,
  FaTools
} from 'react-icons/fa';
import { useAuth, ROLES } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useUI } from '../contexts/UIContext';
import './Navigation.css';


const Navigation = () => {
  const navigate = useNavigate();
  const { showConfirm } = useUI();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showWsSwitcher, setShowWsSwitcher] = useState(false);

  const { workspaces, activeWorkspace, switchWorkspace } = useWorkspace();

  // Initialize body class based on collapsed state
  useEffect(() => {
    if (isCollapsed) {
      document.body.classList.add('sidebar-collapsed');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
    return () => document.body.classList.remove('sidebar-collapsed');
  }, [isCollapsed]);

  const { logout, getUserInfo, hasPageAccess, getUserRole } = useAuth();
  const user = getUserInfo();
  const userRole = getUserRole();

  const allNavItems = [
    { path: '/', icon: FaHome, label: 'Dashboard', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-scanner', icon: FaMicroscope, label: 'Smart Scanner', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-catalog', icon: FaDatabase, label: 'Master Catalog', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-workorders', icon: FaClipboardList, label: 'Work Orders', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-production', icon: FaIndustry, label: 'Production QC', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-locations', icon: FaMapMarkerAlt, label: 'Zone Tracking', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-grn', icon: FaFileInvoice, label: 'GRN & Dispatch', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-reports', icon: FaChartBar, label: 'Reports', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-erp', icon: FaPlug, label: 'ERP Integration', roles: [ROLES.ADMIN, ROLES.FULL_ACCESS] },
    { path: '/ims-components', icon: FaTools, label: 'Component Swap', roles: [ROLES.ADMIN, ROLES.FULL_ACCESS] },
    { path: 'divider-tools', icon: null, label: '— Tools & Core —', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS], isDivider: true },
    { path: '/generator', icon: FaQrcode, label: 'Barcode Generator', roles: [ROLES.ADMIN, ROLES.FULL_ACCESS] },
    { path: '/image-processing', icon: FaImage, label: 'Vision AI', roles: [ROLES.ADMIN, ROLES.FULL_ACCESS] },
    { path: '/device-manager', icon: FaCogs, label: 'Device Manager', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/robot-control', icon: FaRobot, label: 'Robots & Racks', roles: [ROLES.ADMIN, ROLES.FULL_ACCESS] },
    { path: '/profile', icon: FaUserCircle, label: 'User Profile', roles: [ROLES.EXPO_USER, ROLES.ADMIN, ROLES.FULL_ACCESS] },
    { path: '/ims-users', icon: FaUsers, label: 'Team & Access', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
    { path: '/ims-settings', icon: FaCog, label: 'IMS Settings', roles: [ROLES.ADMIN, ROLES.EXPO_USER, ROLES.FULL_ACCESS] },
  ];

  const navItems = allNavItems.filter(item => {
    if (!user || !userRole) return false;
    const effectiveRole = (userRole === ROLES.ADMIN || userRole === ROLES.FULL_ACCESS) ? userRole : ROLES.EXPO_USER;
    const hasRoleAccess = item.roles.includes(effectiveRole);
    const hasPageAccessCheck = hasPageAccess(item.path);

    // Apply Workspace-level role restrictions for 'user', 'member', 'viewer'
    const wsRole = activeWorkspace?.currentUserRole;
    if (wsRole === 'user' || wsRole === 'member' || wsRole === 'viewer') {
      const restrictedPaths = ['/ims-catalog', '/ims-settings', '/ims-users', '/settings'];
      if (restrictedPaths.includes(item.path)) {
        return false; // Hide these for standard users
      }
    }

    return hasRoleAccess && hasPageAccessCheck;
  });

  const toggleCollapse = () => {
    const newCollapsedState = !isCollapsed;
    setIsCollapsed(newCollapsedState);
    if (newCollapsedState) {
      document.body.classList.add('sidebar-collapsed');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
  };

  const handleLogout = () => {
    showConfirm('Logout', 'Are you sure you want to logout?', () => {
      logout();
      navigate('/login');
    });
  };

  return (
    <nav className={`navigation ${isCollapsed ? 'collapsed' : ''} ${userRole === ROLES.EXPO_USER ? 'expo-navigation' : userRole === ROLES.ADMIN ? 'admin-navigation' : userRole === ROLES.FULL_ACCESS ? 'full-access-navigation' : ''}`}>
      <div className="nav-header">
        <div className={`nav-logo ${userRole === ROLES.EXPO_USER ? 'expo-logo' : userRole === ROLES.ADMIN ? 'admin-logo' : userRole === ROLES.FULL_ACCESS ? 'full-access-logo' : ''}`}>
          <img src={`${process.env.PUBLIC_URL}/static/media/robridge-logo.png`} alt="RobBridge Logo" className={`logo-image ${userRole === ROLES.EXPO_USER ? 'expo-logo-image' : userRole === ROLES.ADMIN ? 'admin-logo-image' : userRole === ROLES.FULL_ACCESS ? 'full-access-logo-image' : ''}`} />
        </div>
        <button className="nav-toggle" onClick={toggleCollapse}>
          {isCollapsed ? <FaBars /> : <FaTimes />}
        </button>
      </div>

      <div className="nav-content">
        {!isCollapsed && (
          <div className="ws-switcher" onClick={() => setShowWsSwitcher(p => !p)}>
            <FaBuilding className="ws-icon" />
            <div className="ws-info">
              <span className="ws-label">Workspace</span>
              <span className="ws-name">{activeWorkspace ? activeWorkspace.name : 'No Workspace'}</span>
            </div>
            <FaChevronDown className={`ws-chevron ${showWsSwitcher ? 'open' : ''}`} />
            {showWsSwitcher && (
              <ul className="ws-dropdown">
                {workspaces.map(ws => (
                  <li
                    key={ws.id}
                    className={`ws-option ${activeWorkspace && activeWorkspace.id === ws.id ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); switchWorkspace(ws.id); setShowWsSwitcher(false); }}
                  >
                    <FaBuilding /> {ws.name}
                  </li>
                ))}
                <li className="ws-option create-ws" onClick={(e) => {
                  e.stopPropagation();
                  setShowWsSwitcher(false);
                  navigate('/onboarding');
                }}>
                  <FaPlus /> Create Workspace
                </li>
              </ul>
            )}
          </div>
        )}

        <ul className="nav-menu">
          {navItems.map((item) => {
            const Icon = item.icon;
            if (item.isDivider) {
              if (isCollapsed) return null;
              return (
                <li key={item.path} className="nav-divider-label">
                  <span>{item.label}</span>
                </li>
              );
            }
            return (
              <li key={item.path} className="nav-item">
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                  title={isCollapsed ? item.label : ''}
                >
                  <Icon className="nav-icon" />
                  {!isCollapsed && <span className="nav-label">{item.label}</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>

        <div className="nav-footer">
          <button
            className="logout-btn"
            onClick={handleLogout}
            title={isCollapsed ? 'Logout' : ''}
          >
            <FaSignOutAlt />
            {!isCollapsed && <span>Logout</span>}
          </button>

          <div className="nav-version">v1.0.0</div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
