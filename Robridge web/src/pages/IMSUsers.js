import React, { useState, useEffect, useCallback } from 'react';
import {
  FaShieldAlt, FaKey,
  FaSearch, FaTrash, FaLink, FaCopy,
  FaCheck, FaTimes, FaEnvelope, FaUserCircle, FaChevronDown,
  FaSyncAlt, FaUnlockAlt, FaClock
} from 'react-icons/fa';
import './IMSUsers.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';

const SYSTEM_ROLES = [
  { value: 'owner', label: 'Admin', color: '#e74c3c', desc: 'Has full authority and has multiple managers to see. Can view and edit all pages.' },
  { value: 'admin', label: 'Admin', color: '#e74c3c', desc: 'Has full authority and has multiple managers to see. Can view and edit all pages.' },
  { value: 'manager', label: 'Manager', color: '#f39c12', desc: 'Has admin privilege but is restricted to pay or increase the subscription plan. Manager can request to increase plan. Can only invite Users.' },
  { value: 'user', label: 'User', color: '#3498db', desc: 'Master catalog and setting is hidden. Can view operation but cannot create or modify the data/order/GRN/QC. Hide Team & Access Control.' },
  { value: 'member', label: 'User', color: '#3498db', desc: 'Master catalog and setting is hidden. Can view operation but cannot create or modify the data/order/GRN/QC. Hide Team & Access Control.' },
  { value: 'viewer', label: 'User', color: '#3498db', desc: 'Master catalog and setting is hidden. Can view operation but cannot create or modify the data/order/GRN/QC. Hide Team & Access Control.' }
];

const UNIQUE_ROLES_FOR_UI = [
  { value: 'admin', label: 'Admin', color: '#e74c3c', desc: 'Has full authority and has multiple managers to see. Can view and edit all pages.' },
  { value: 'manager', label: 'Manager', color: '#f39c12', desc: 'Has admin privilege but is restricted to pay or increase the subscription plan. Manager can request to increase plan. Can only invite Users.' },
  { value: 'user', label: 'User', color: '#3498db', desc: 'Master catalog and setting is hidden. Can view operation but cannot create or modify the data/order/GRN/QC. Hide Team & Access Control.' }
];

const getRoleInfo = (role) => SYSTEM_ROLES.find(r => r.value === role) || { label: 'User', color: '#3498db', desc: '' };

const getInitials = (name) => {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

const IMSUsers = () => {
  const { imsFetch, activeWorkspaceId, activeWorkspace } = useWorkspace();
  const { getUserInfo } = useAuth();
  const showToast = useToast();
  const currentUser = getUserInfo();

  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('members');

  // Invite generator state
  const [genRole, setGenRole] = useState('user');
  const [genExpiry, setGenExpiry] = useState('7');
  const [generating, setGenerating] = useState(false);
  const [newInviteLink, setNewInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  // Role editor state
  const [editingRole, setEditingRole] = useState(null); // userId
  const [editRoleValue, setEditRoleValue] = useState('');
  const [savingRole, setSavingRole] = useState(false);

  // Role config modal
  const [showRoleModal, setShowRoleModal] = useState(false);

  const fetchData = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        imsFetch('/api/workspaces/members'),
        imsFetch('/api/workspaces/invites')
      ]);
      const mData = await membersRes.json();
      const iData = await invitesRes.json();
      if (mData.success) setMembers(mData.members);
      if (iData.success) setInvites(iData.invites);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [activeWorkspaceId, imsFetch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGenerateInvite = async () => {
    setGenerating(true);
    try {
      const res = await imsFetch('/api/workspaces/invites/generate', {
        method: 'POST',
        body: JSON.stringify({ role: genRole, expiryDays: parseInt(genExpiry) })
      });
      const data = await res.json();
      if (data.success) {
        const baseUrl = window.location.origin;
        const link = `${baseUrl}/onboarding?invite=${data.token}`;
        setNewInviteLink(link);
        await fetchData();
        showToast('Invite link generated!', 'success');
      } else {
        showToast(data.error || 'Failed to generate link', 'error');
      }
    } catch {
      showToast('Failed to generate invite link', 'error');
    }
    setGenerating(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(newInviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRevokeInvite = async (id) => {
    try {
      const res = await imsFetch(`/api/workspaces/invites/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setInvites(prev => prev.filter(i => i.id !== id));
        showToast('Invite revoked', 'success');
      }
    } catch {
      showToast('Failed to revoke invite', 'error');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    setSavingRole(true);
    try {
      const res = await imsFetch(`/api/workspaces/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole })
      });
      const data = await res.json();
      if (data.success) {
        setMembers(prev => prev.map(m => m.id === userId ? { ...m, role: newRole } : m));
        showToast('Role updated', 'success');
      } else {
        showToast(data.error || 'Failed to update role', 'error');
      }
    } catch {
      showToast('Failed to update role', 'error');
    }
    setEditingRole(null);
    setSavingRole(false);
  };

  const handleRemoveMember = async (userId, name) => {
    if (!window.confirm(`Remove ${name} from this workspace?`)) return;
    try {
      const res = await imsFetch(`/api/workspaces/members/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setMembers(prev => prev.filter(m => m.id !== userId));
        showToast(`${name} removed from workspace`, 'success');
      } else {
        showToast(data.error || 'Failed to remove member', 'error');
      }
    } catch {
      showToast('Failed to remove member', 'error');
    }
  };

  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  const isAdmin = ['owner', 'admin'].includes(activeWorkspace?.currentUserRole || 'member');
  const isManager = activeWorkspace?.currentUserRole === 'manager';

  const inviteRoles = isManager ? UNIQUE_ROLES_FOR_UI.filter(r => r.value === 'user') : UNIQUE_ROLES_FOR_UI.filter(r => r.value !== 'admin');

  return (
    <div className="ims-users-page">



      {/* ── HEADER ── */}
      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Team & Access Control</h1>
          <p>Manage workspace members, send invite links, and configure role-based access.</p>
        </div>
        <div className="ims-header-right ims-flex-gap-10">
          <button className="btn btn-secondary" onClick={() => setShowRoleModal(true)}>
            <FaShieldAlt /> Role Guide
          </button>
        </div>
      </div>

      {/* ── STATS ROW ── */}
      <div className="users-stats-row">
        <div className="users-stat-card">
          <div className="users-stat-num">{members.length}</div>
          <div className="users-stat-label">Total Members</div>
        </div>
        <div className="users-stat-card">
          <div className="users-stat-num" style={{ color: '#27ae60' }}>
            {members.filter(m => m.status === 'active').length}
          </div>
          <div className="users-stat-label">Active</div>
        </div>
        <div className="users-stat-card">
          <div className="users-stat-num" style={{ color: '#e74c3c' }}>
            {members.filter(m => m.role === 'owner' || m.role === 'admin').length}
          </div>
          <div className="users-stat-label">Admins</div>
        </div>
        <div className="users-stat-card">
          <div className="users-stat-num" style={{ color: '#3498db' }}>
            {invites.length}
          </div>
          <div className="users-stat-label">Active Invite Links</div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="users-tabs">
        <button className={`users-tab ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}>
          Members ({members.length})
        </button>
        <button className={`users-tab ${activeTab === 'invite' ? 'active' : ''}`} onClick={() => setActiveTab('invite')}>
          Invite Links ({invites.length})
        </button>
      </div>

      {/* ── MEMBERS TAB ── */}
      {activeTab === 'members' && (
        <div className="users-members-panel">
          <div className="users-search-bar">
            <FaSearch className="usearch-icon" />
            <input
              type="text"
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="users-refresh-btn" onClick={fetchData} title="Refresh">
              <FaSyncAlt />
            </button>
          </div>

          {loading ? (
            <div className="users-loading">Loading members…</div>
          ) : filtered.length === 0 ? (
            <div className="users-empty">
              <FaUserCircle className="users-empty-icon" />
              <p>No members found. Invite your team to get started!</p>
            </div>
          ) : (
            <div className="members-list">
              {filtered.map(member => {
                const roleInfo = getRoleInfo(member.role);
                const isYou = member.email === currentUser?.email;
                return (
                  <div className="member-card" key={member.id}>
                    <div className="member-avatar" style={{ background: roleInfo.color + '22', color: roleInfo.color }}>
                      {getInitials(member.name)}
                    </div>
                    <div className="member-info">
                      <div className="member-name">
                        {member.name}
                        {isYou && <span className="member-you-badge">You</span>}
                      </div>
                      <div className="member-email"><FaEnvelope /> {member.email}</div>
                    </div>

                    <div className="member-role-section">
                      {editingRole === member.id ? (
                        <div className="member-role-editor">
                          <select
                            value={editRoleValue}
                            onChange={e => setEditRoleValue(e.target.value)}
                            autoFocus
                          >
                            {UNIQUE_ROLES_FOR_UI.filter(r => r.value !== 'admin').map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          <button className="role-save-btn" onClick={() => handleRoleChange(member.id, editRoleValue)} disabled={savingRole}>
                            <FaCheck />
                          </button>
                          <button className="role-cancel-btn" onClick={() => setEditingRole(null)}>
                            <FaTimes />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="member-role-badge"
                          style={{ background: roleInfo.color + '15', color: roleInfo.color }}
                          onClick={() => {
                            if (isAdmin && !isYou) {
                              setEditingRole(member.id);
                              setEditRoleValue(member.role);
                            }
                          }}
                          title={isAdmin && !isYou ? 'Click to change role' : roleInfo.desc}
                        >
                          {member.role === 'owner' && <FaKey style={{ fontSize: 10 }} />}
                          {roleInfo.label}
                          {isAdmin && !isYou && <FaChevronDown style={{ fontSize: 9, marginLeft: 4, opacity: 0.6 }} />}
                        </div>
                      )}
                    </div>

                    <div className="member-status">
                      <span className={`member-status-dot ${member.status === 'active' ? 'active' : 'pending'}`} />
                      <span>{member.status === 'active' ? 'Active' : 'Pending'}</span>
                    </div>

                    <div className="member-joined">
                      <FaClock style={{ fontSize: 10, opacity: 0.5 }} />
                      {new Date(member.joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>

                    {((isAdmin && member.role !== 'owner') || (isManager && ['user', 'member', 'viewer'].includes(member.role))) && !isYou && (
                      <button
                        className="member-remove-btn"
                        onClick={() => handleRemoveMember(member.id, member.name)}
                        title="Remove from workspace"
                      >
                        <FaTrash />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── INVITE TAB ── */}
      {activeTab === 'invite' && (
        <div className="invite-tab-layout">

          {/* Generator Panel */}
          <div className="invite-generator-panel">
            <div className="igp-header">
              <div className="igp-icon"><FaLink /></div>
              <div>
                <div className="igp-title">Generate Invite Link</div>
                <div className="igp-sub">Anyone with this link can join your workspace with the selected role.</div>
              </div>
            </div>

            <div className="igp-controls">
              <div className="igp-field">
                <label>Assign Role</label>
                <div className="igp-role-grid">
                  {inviteRoles.map(r => (
                    <button
                      key={r.value}
                      className={`igp-role-btn ${genRole === r.value ? 'selected' : ''}`}
                      style={genRole === r.value ? { borderColor: r.color, color: r.color, background: r.color + '12' } : {}}
                      onClick={() => setGenRole(r.value)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="igp-role-desc">{getRoleInfo(genRole).desc}</div>
              </div>

              <div className="igp-field">
                <label>Link expires in</label>
                <div className="igp-expiry-row">
                  {['1', '3', '7', '14', '30'].map(d => (
                    <button key={d} className={`igp-expiry-btn ${genExpiry === d ? 'selected' : ''}`} onClick={() => setGenExpiry(d)}>
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              <button className="igp-generate-btn" onClick={handleGenerateInvite} disabled={generating}>
                {generating ? 'Generating…' : <><FaLink /> Generate Invite Link</>}
              </button>

              {newInviteLink && (
                <div className="igp-result">
                  <div className="igp-result-label">Share this link with your team:</div>
                  <div className="igp-link-row">
                    <input type="text" readOnly value={newInviteLink} className="igp-link-input" />
                    <button className="igp-copy-btn" onClick={handleCopy}>
                      {copied ? <><FaCheck /> Copied!</> : <><FaCopy /> Copy</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Active Links Panel */}
          <div className="active-invites-panel">
            <div className="aip-header">
              <div className="aip-title">Active Invite Links</div>
              <div className="aip-sub">{invites.length} link{invites.length !== 1 ? 's' : ''} currently active</div>
            </div>

            {invites.length === 0 ? (
              <div className="aip-empty">
                <FaUnlockAlt className="aip-empty-icon" />
                <p>No active links. Generate one to invite your team.</p>
              </div>
            ) : (
              <div className="aip-list">
                {invites.map(inv => {
                  const roleInfo = getRoleInfo(inv.role);
                  const expiry = new Date(inv.expires_at);
                  const daysLeft = Math.max(0, Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24)));
                  return (
                    <div className="aip-row" key={inv.id}>
                      <div className="aip-token-wrap">
                        <span className="aip-token">{inv.token.slice(0, 12)}…</span>
                        <span className="aip-role-badge" style={{ color: roleInfo.color, background: roleInfo.color + '15' }}>{roleInfo.label}</span>
                      </div>
                      <div className="aip-meta">
                        <span><FaClock style={{ opacity: 0.5 }} /> {daysLeft}d left</span>
                        <span>{inv.uses_remaining} uses</span>
                        <span>by {inv.created_by_name}</span>
                      </div>
                      <button className="aip-revoke-btn" onClick={() => handleRevokeInvite(inv.id)} title="Revoke link">
                        <FaTimes />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ROLE GUIDE MODAL ── */}
      {showRoleModal && (
        <div className="modal-overlay" onClick={() => setShowRoleModal(false)}>
          <div className="role-guide-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FaShieldAlt /> Role Permissions Guide</h2>
              <button className="btn-close" onClick={() => setShowRoleModal(false)}><FaTimes /></button>
            </div>
            <div className="role-guide-body">
              {UNIQUE_ROLES_FOR_UI.map(role => (
                <div className="role-guide-row" key={role.value}>
                  <div className="role-guide-badge" style={{ background: role.color + '15', color: role.color }}>
                    {role.value === 'admin' && <FaKey />} {role.label}
                  </div>
                  <div className="role-guide-desc">{role.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IMSUsers;
