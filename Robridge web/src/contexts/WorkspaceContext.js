import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getServerURL } from '../config/api';

const WorkspaceContext = createContext();

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};

export const WorkspaceProvider = ({ children }) => {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => {
    return localStorage.getItem('robridge_workspace_id') || null;
  });
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);

  // Fetch all workspaces the user belongs to
  const fetchWorkspaces = useCallback(async () => {
    if (!user) return;
    setLoadingWorkspaces(true);
    try {
      const token = localStorage.getItem('robridge_token');
      const res = await fetch(`${getServerURL()}/api/workspaces`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setWorkspaces(data.workspaces || []);

        // Auto-select: prefer stored id, then fall back to user's default, then first one
        const storedId = localStorage.getItem('robridge_workspace_id');
        const userDefault = user.workspaceId ? String(user.workspaceId) : null;
        const allIds = (data.workspaces || []).map(w => String(w.id));

        let targetId = null;
        if (storedId && allIds.includes(storedId)) {
          targetId = storedId;
        } else if (userDefault && allIds.includes(userDefault)) {
          targetId = userDefault;
        } else if (allIds.length > 0) {
          targetId = allIds[0];
        }

        if (targetId) {
          setActiveWorkspaceId(targetId);
          localStorage.setItem('robridge_workspace_id', targetId);
        }
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
    } finally {
      setLoadingWorkspaces(false);
    }
  }, [user]);

  // When user changes (login/logout) refresh workspaces
  useEffect(() => {
    if (user) {
      fetchWorkspaces();
    } else {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      localStorage.removeItem('robridge_workspace_id');
    }
  }, [user, fetchWorkspaces]);

  // Switch the active workspace
  const switchWorkspace = (id) => {
    const sid = String(id);
    setActiveWorkspaceId(sid);
    localStorage.setItem('robridge_workspace_id', sid);
  };

  // Returns headers for IMS API requests — Bearer token (from localStorage) + workspace id
  const getImsHeaders = useCallback(() => {
    const token = localStorage.getItem('robridge_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (activeWorkspaceId) headers['x-workspace-id'] = activeWorkspaceId;
    return headers;
  }, [activeWorkspaceId]);

  // Convenience fetch wrapper — injects workspace header + always sends cookie
  // Only redirects to login on 401 (truly unauthenticated). 403 = permissions issue, not logout.
  const imsFetch = useCallback(async (path, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET' && activeWorkspaceId) {
      sessionStorage.removeItem(`ims_dashboard_cache_${activeWorkspaceId}`);
    }

    const headers = { ...getImsHeaders(), ...(options.headers || {}) };
    const response = await fetch(`${getServerURL()}${path}`, {
      ...options,
      headers,
      credentials: 'include' // httpOnly cookie carries the JWT
    });

    if (response.status === 401) {
      localStorage.removeItem('robridge_user');
      localStorage.removeItem('robridge_workspace_id');
      window.location.href = '/login';
      return new Response(JSON.stringify({ success: false, error: 'Session expired. Please log in again.' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    return response;
  }, [getImsHeaders]);


  // Create a new workspace
  const createWorkspace = async (name) => {
    try {
      const token = localStorage.getItem('robridge_token');
      const res = await fetch(`${getServerURL()}/api/workspaces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.success) {
        await fetchWorkspaces();
        switchWorkspace(data.workspace.id);
        return { success: true, workspace: data.workspace };
      }
      return { success: false, error: data.error };
    } catch (err) {
      console.error('Error creating workspace:', err);
      return { success: false, error: 'Failed to create workspace' };
    }
  };

  const activeWorkspace = workspaces.find(w => String(w.id) === String(activeWorkspaceId)) || null;

  return (
    <WorkspaceContext.Provider value={{
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      loadingWorkspaces,
      switchWorkspace,
      createWorkspace,
      fetchWorkspaces,
      getImsHeaders,
      imsFetch
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
};
