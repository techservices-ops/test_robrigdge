import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FaBuilding, FaUserPlus, FaArrowRight, FaCheckCircle,
  FaSpinner, FaRocket, FaUsers, FaChartBar, FaShieldAlt,
  FaArrowLeft, FaLink, FaExclamationTriangle
} from 'react-icons/fa';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import './WorkspaceOnboarding.css';

export default function WorkspaceOnboarding() {
  const { workspaces, createWorkspace, imsFetch, fetchWorkspaces, switchWorkspace } = useWorkspace();
  const { getUserInfo } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const user = getUserInfo();
  const prefilledToken = searchParams.get('invite') || '';

  const [mode, setMode] = useState(prefilledToken ? 'join' : null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [workspaceName, setWorkspaceName] = useState('');
  const [orgType, setOrgType] = useState('manufacturing');
  const [inviteToken, setInviteToken] = useState(prefilledToken);
  const [invitePreview, setInvitePreview] = useState(null);
  const [error, setError] = useState('');
  const [successData, setSuccessData] = useState(null);

  // Removed the auto-redirect so users can use this UI to create additional workspaces anytime.

  const extractToken = (raw) => {
    let t = raw.trim();
    if (t.includes('invite=')) return t.split('invite=')[1].split('&')[0];
    if (t.includes('/join/')) return t.split('/join/').pop();
    return t;
  };

  const previewInvite = async (token) => {
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const serverUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001'
        : window.location.origin;
      const tkn = extractToken(token);
      const res = await fetch(`${serverUrl}/api/workspaces/join/${tkn}`);
      const data = await res.json();
      if (data.success) {
        setInvitePreview(data);
        setError('');
      } else {
        setError(data.error || 'Invalid invite link');
        setInvitePreview(null);
      }
    } catch {
      setError('Could not validate invite link. Check your connection.');
      setInvitePreview(null);
    }
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!workspaceName.trim()) { setError('Please enter a workspace name'); return; }
    setLoading(true);
    setError('');
    const result = await createWorkspace(workspaceName.trim());
    setLoading(false);
    if (result.success) {
      setSuccessData({ type: 'create', name: workspaceName });
      setStep(3);
    } else {
      setError(result.error || 'Failed to create workspace');
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!inviteToken.trim()) { setError('Please enter or paste an invite link/code'); return; }
    setLoading(true);
    setError('');
    try {
      const tkn = extractToken(inviteToken);
      const res = await imsFetch('/api/workspaces/join', {
        method: 'POST',
        body: JSON.stringify({ token: tkn })
      });
      const data = await res.json();
      if (data.success) {
        await fetchWorkspaces();
        if (data.workspaceId) switchWorkspace(data.workspaceId);
        setSuccessData({ type: 'join', name: data.workspaceName || 'Workspace' });
        setStep(3);
      } else {
        setError(data.error || 'Invalid or expired invite link');
      }
    } catch {
      setError('Failed to join workspace. Please try again.');
    }
    setLoading(false);
  };

  const features = [
    { icon: FaChartBar, label: 'Live Inventory Dashboard', desc: 'Real-time stock levels and alerts' },
    { icon: FaShieldAlt, label: 'RBAC Security', desc: 'Role-based access control built in' },
    { icon: FaUsers, label: 'Team Collaboration', desc: 'Invite your entire team seamlessly' },
    { icon: FaRocket, label: 'ERP Integration', desc: 'Connect SAP, Tally and more' },
  ];

  return (
    <div className="ws-onboarding-root">
      {/* Left Panel */}
      <div className="ws-onboarding-left">
        <div className="ws-onboarding-brand">
          <img src={`${process.env.PUBLIC_URL}/static/media/robridge-logo.png`} alt="RoBridge" className="ws-ob-logo"
            onError={e => { e.target.style.display = 'none'; }} />
          <span className="ws-ob-brand-name">RoBridge IMS</span>
        </div>

        <div className="ws-ob-hero">
          <h1>Your warehouse,<br /><span className="ws-ob-accent">intelligently managed.</span></h1>
          <p>Set up your workspace to start tracking inventory, managing teams, and gaining real-time insights across your operations.</p>
        </div>

        <div className="ws-ob-features">
          {features.map(({ icon: Icon, label, desc }) => (
            <div className="ws-ob-feature" key={label}>
              <div className="ws-ob-feature-icon"><Icon /></div>
              <div>
                <div className="ws-ob-feature-label">{label}</div>
                <div className="ws-ob-feature-desc">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="ws-ob-dots">
          {[0, 1, 2].map(i => (
            <div key={i} className={`ws-ob-dot ${step - 1 === i ? 'active' : ''}`} />
          ))}
        </div>
      </div>

      {/* Right Panel */}
      <div className="ws-onboarding-right">
        <div className="ws-ob-right-inner">

          {/* Step 1: Mode selection */}
          {step === 1 && (
            <div className="ws-ob-step ws-ob-step-enter">
              {workspaces && workspaces.length > 0 && (
                <button className="ws-ob-back" onClick={() => navigate('/')} style={{ marginBottom: '20px' }}>
                  <FaArrowLeft /> Exit & Go back to Workspace
                </button>
              )}
              <div className="ws-ob-greeting">
                <div className="ws-ob-avatar">{user?.name?.charAt(0)?.toUpperCase() || 'U'}</div>
                <div>
                  <div className="ws-ob-welcome">Welcome, {user?.name?.split(' ')[0] || 'there'}! 👋</div>
                  <div className="ws-ob-sub">Let's get your workspace set up.</div>
                </div>
              </div>

              <div className="ws-ob-cards">
                <button className="ws-ob-card" onClick={() => { setMode('create'); setStep(2); }}>
                  <div className="ws-ob-card-icon create-icon">
                    <FaBuilding />
                  </div>
                  <div className="ws-ob-card-body">
                    <div className="ws-ob-card-title">Create a new workspace</div>
                    <div className="ws-ob-card-desc">Set up IMS for your company or facility. You'll be the workspace owner with full admin access.</div>
                  </div>
                  <FaArrowRight className="ws-ob-card-arrow" />
                </button>

                <button className="ws-ob-card" onClick={() => { setMode('join'); setStep(2); }}>
                  <div className="ws-ob-card-icon join-icon">
                    <FaLink />
                  </div>
                  <div className="ws-ob-card-body">
                    <div className="ws-ob-card-title">Join an existing workspace</div>
                    <div className="ws-ob-card-desc">Got an invite link from your admin? Paste it here to instantly join your team's workspace.</div>
                  </div>
                  <FaArrowRight className="ws-ob-card-arrow" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Forms */}
          {step === 2 && mode === 'create' && (
            <div className="ws-ob-step ws-ob-step-enter">
              <button className="ws-ob-back" onClick={() => { setStep(1); setError(''); }}>
                <FaArrowLeft /> Back
              </button>
              <h2 className="ws-ob-form-title">Set up your workspace</h2>
              <p className="ws-ob-form-sub">This will be the central hub for all your inventory operations.</p>

              <form onSubmit={handleCreate} className="ws-ob-form">
                <div className="ws-ob-field">
                  <label>Workspace / Company Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Acme Manufacturing Pvt Ltd"
                    value={workspaceName}
                    onChange={e => { setWorkspaceName(e.target.value); setError(''); }}
                    autoFocus
                    className={error ? 'ws-ob-input error' : 'ws-ob-input'}
                  />
                </div>

                <div className="ws-ob-field">
                  <label>Organization Type</label>
                  <div className="ws-ob-org-grid">
                    {[
                      { val: 'manufacturing', label: 'Manufacturing', emoji: '🏭' },
                      { val: 'retail', label: 'Retail / Distribution', emoji: '🛒' },
                      { val: 'pharma', label: 'Pharma / Food', emoji: '💊' },
                      { val: 'logistics', label: 'Logistics', emoji: '🚚' },
                    ].map(({ val, label, emoji }) => (
                      <button type="button" key={val}
                        className={`ws-ob-org-btn ${orgType === val ? 'selected' : ''}`}
                        onClick={() => setOrgType(val)}>
                        <span>{emoji}</span> {label}
                      </button>
                    ))}
                  </div>
                </div>

                {error && <div className="ws-ob-error"><FaExclamationTriangle /> {error}</div>}

                <button type="submit" className="ws-ob-submit-btn" disabled={loading}>
                  {loading ? <><FaSpinner className="spin" /> Creating...</> : <><FaRocket /> Create Workspace</>}
                </button>
              </form>
            </div>
          )}

          {step === 2 && mode === 'join' && (
            <div className="ws-ob-step ws-ob-step-enter">
              <button className="ws-ob-back" onClick={() => { setStep(1); setError(''); setInvitePreview(null); }}>
                <FaArrowLeft /> Back
              </button>
              <h2 className="ws-ob-form-title">Join a workspace</h2>
              <p className="ws-ob-form-sub">Paste the invite link or code shared by your workspace admin.</p>

              <form onSubmit={handleJoin} className="ws-ob-form">
                <div className="ws-ob-field">
                  <label>Invite Link or Code</label>
                  <input
                    type="text"
                    placeholder="https://… or paste the invite code"
                    value={inviteToken}
                    onChange={e => { setInviteToken(e.target.value); setError(''); setInvitePreview(null); }}
                    onBlur={e => e.target.value.trim() && previewInvite(e.target.value)}
                    autoFocus
                    className={error ? 'ws-ob-input error' : 'ws-ob-input'}
                  />
                  <button type="button" className="ws-ob-preview-btn" onClick={() => previewInvite(inviteToken)} disabled={loading}>
                    {loading ? <FaSpinner className="spin" /> : 'Validate →'}
                  </button>
                </div>

                {invitePreview && (
                  <div className="ws-ob-preview-card">
                    <FaCheckCircle className="ws-ob-preview-check" />
                    <div>
                      <div className="ws-ob-preview-name">{invitePreview.workspaceName}</div>
                      <div className="ws-ob-preview-role">You'll join as: <strong>{invitePreview.role}</strong></div>
                    </div>
                  </div>
                )}

                {error && <div className="ws-ob-error"><FaExclamationTriangle /> {error}</div>}

                <button type="submit" className="ws-ob-submit-btn join" disabled={loading || !inviteToken.trim()}>
                  {loading ? <><FaSpinner className="spin" /> Joining...</> : <><FaUserPlus /> Join Workspace</>}
                </button>
              </form>
            </div>
          )}

          {/* Step 3: Success */}
          {step === 3 && successData && (
            <div className="ws-ob-step ws-ob-success ws-ob-step-enter">
              <div className="ws-ob-success-icon">
                {successData.type === 'create' ? '🚀' : '🎉'}
              </div>
              <h2>{successData.type === 'create' ? 'Workspace Created!' : 'You\'re in!'}</h2>
              <p>
                {successData.type === 'create'
                  ? <><strong>{successData.name}</strong> is ready. Start by adding your first items to the catalog.</>
                  : <>You've successfully joined <strong>{successData.name}</strong>. Your team is waiting!</>
                }
              </p>
              <button className="ws-ob-submit-btn" onClick={() => navigate('/')}>
                <FaArrowRight /> Go to Dashboard
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
