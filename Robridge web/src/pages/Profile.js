import React, { useState, useEffect } from 'react';
import { getServerURL } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { FaUser, FaEnvelope, FaLock, FaEdit, FaCamera, FaEye, FaEyeSlash, FaCheck, FaTimes } from 'react-icons/fa';
import './Profile.css';

// Helper functions to generate user information based on login data
const formatUserId = (id) => {
  if (!id) return '#USR000';
  return `#USR${String(id).padStart(3, '0')}`;
};

const formatMemberSince = (dateString) => {
  if (!dateString) return 'Member since January 2024';

  const date = new Date(dateString);
  // Check if date is valid
  if (isNaN(date.getTime())) return 'Member since January 2024';

  const options = { month: 'long', year: 'numeric' };
  return `Member since ${date.toLocaleDateString('en-US', options)}`;
};

const Profile = () => {
  const { getUserInfo } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const user = getUserInfo();

  const [userDetails, setUserDetails] = useState({
    name: user?.name || 'User',
    email: user?.email || '',
    id: user?.id ? formatUserId(user.id) : '#USR000',
    memberSince: user?.created_at ? formatMemberSince(user.created_at) : formatMemberSince(null),
    profilePic: null
  });

  const [editMode, setEditMode] = useState({
    name: false,
    email: false
  });

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [showPassword, setShowPassword] = useState({
    current: false,
    new: false,
    confirm: false
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Hidden file input ref
  const fileInputRef = React.useRef(null);

  // Fetch user profile from backend
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const token = localStorage.getItem('robridge_token');
        const serverURL = getServerURL();

        const response = await fetch(`${serverURL}/api/user/profile`, {
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();

        if (data.success) {
          // Load profile pic from local storage
          const workspaceKey = activeWorkspace?.id || 'default';
          const savedProfilePic = localStorage.getItem(`profile_pic_${data.user.id}_${workspaceKey}`);

          setUserDetails({
            name: data.user.name || '',
            email: data.user.email || '',
            id: formatUserId(data.user.id),
            memberSince: formatMemberSince(data.user.memberSince),
            profilePic: savedProfilePic || null
          });
        } else {
          setMessage({ type: 'error', text: 'Failed to load profile data' });
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
        setMessage({ type: 'error', text: 'Failed to load profile data' });
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [activeWorkspace?.id]);

  const handleInputChange = (field, value) => {
    setUserDetails(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Handle profile picture selection
  const handleProfilePicSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5000000) { // 5MB limit
        setMessage({ type: 'error', text: 'Image size should be less than 5MB' });
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result;
        setUserDetails(prev => ({ ...prev, profilePic: base64String }));

        setMessage({ type: 'success', text: 'Picture selected. Click "Save Changes" to apply.' });
        setTimeout(() => setMessage({ type: '', text: '' }), 3000);
      };
      reader.readAsDataURL(file);
    }
    // Reset file input value to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveProfilePic = () => {
    setUserDetails(prev => ({ ...prev, profilePic: null }));
    setMessage({ type: 'success', text: 'Picture removed. Click "Save Changes" to apply.' });
    setTimeout(() => setMessage({ type: '', text: '' }), 3000);
  };

  const toggleEditMode = (field) => {
    if (field === 'password') {
      setShowPasswordModal(true);
      return;
    }
    setEditMode(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const handlePasswordChange = (field, value) => {
    setPasswordData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const togglePasswordVisibility = (field) => {
    setShowPassword(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const handleSaveChanges = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });

    try {
      const token = localStorage.getItem('robridge_token');
      const serverURL = getServerURL();

      const response = await fetch(`${serverURL}/api/user/profile`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: userDetails.name,
          email: userDetails.email
        })
      });

      const data = await response.json();

      if (data.success) {
        const numericId = parseInt(userDetails.id.replace('#USR', '')) || 0;
        const workspaceKey = activeWorkspace?.id || 'default';
        if (userDetails.profilePic) {
          localStorage.setItem(`profile_pic_${numericId}_${workspaceKey}`, userDetails.profilePic);
        } else {
          localStorage.removeItem(`profile_pic_${numericId}_${workspaceKey}`);
        }

        setMessage({ type: 'success', text: 'Profile updated successfully!' });
        setEditMode({ name: false, email: false });

        setUserDetails(prev => ({
          ...prev,
          name: data.user.name,
          email: data.user.email
        }));
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update profile' });
      }

      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      console.error('Error updating profile:', error);
      setMessage({ type: 'error', text: 'Failed to update profile. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setMessage({ type: 'error', text: 'Please fill in all password fields.' });
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters long.' });
      return;
    }

    setSaving(true);
    setMessage({ type: '', text: '' });

    try {
      const token = localStorage.getItem('robridge_token');
      const serverURL = getServerURL();

      const response = await fetch(`${serverURL}/api/user/password`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword
        })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Password changed successfully!' });
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setShowPassword({ current: false, new: false, confirm: false });
        setShowPasswordModal(false);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to change password' });
      }

      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      console.error('Error changing password:', error);
      setMessage({ type: 'error', text: 'Failed to change password. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setShowPassword({ current: false, new: false, confirm: false });
  };

  return (
    <div className="profile-page">
      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>Workspace Profile</h1>
          <p>Manage your account and workspace capacity details</p>
        </div>
        <div className="ims-header-right ims-flex-gap-10">
          {/* Security button hidden */}
        </div>
      </div>

      {message.text && (
        <div className={`message-banner ${message.type}`}>
          {message.type === 'success' && <FaCheck />}
          {message.text}
        </div>
      )}

      <div className="profile-layout">
        {/* Left Side - Avatar Card */}
        <div className="avatar-card">
          {loading ? (
            <div className="loading-spinner-container" style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}>
              <div className="spinner-small" style={{
                width: '30px',
                height: '30px',
                border: '3px solid #E3821E',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
            </div>
          ) : (
            <>
              <div className="avatar-container">
                <div className="avatar-circle">
                  {userDetails.profilePic ? (
                    <img src={userDetails.profilePic} alt="Profile" className="profile-pic-img" />
                  ) : (
                    <FaUser />
                  )}
                </div>
                <button
                  className="camera-button"
                  title="Change profile picture"
                  onClick={() => fileInputRef.current.click()}
                >
                  <FaCamera />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept="image/*"
                  onChange={handleProfilePicSelect}
                />
              </div>
              {userDetails.profilePic && (
                <button
                  className="remove-pic-btn"
                  onClick={handleRemoveProfilePic}
                >
                  Remove Picture
                </button>
              )}
              <div className="user-info-section">
                <h2>{userDetails.name}</h2>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '8px 0' }}>
                  <span className="user-id-badge">{userDetails.id}</span>
                  <span className="user-id-badge" style={{ background: '#e3f2fd', color: '#1565c0' }}>{activeWorkspace?.role?.toUpperCase() || 'MEMBER'}</span>
                </div>
                <p className="member-date" style={{ color: '#666', fontSize: '13px' }}>{userDetails.memberSince}</p>

                <div className="workspace-card" style={{ marginTop: '20px', padding: '15px', background: '#F8F9FA', borderRadius: '12px', border: '1px solid #EAEAEA', textAlign: 'left' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#333' }}>Current Workspace</h4>
                  <div style={{ fontWeight: '600', fontSize: '16px', color: '#fa1804' }}>{activeWorkspace?.name || 'No Workspace'}</div>

                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Side - Account Information */}
        <div className="account-card">
          <h3>Account Information</h3>

          {loading ? (
            <div className="loading-spinner-container" style={{ padding: '60px', display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '15px' }}>
              <div className="spinner-small" style={{
                width: '30px',
                height: '30px',
                border: '3px solid #E3821E',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
              <span style={{ color: '#666' }}>Loading account details...</span>
            </div>
          ) : (
            <>
              {/* Name Field */}
              <div className="form-field">
                <label>
                  <FaUser />
                  NAME
                </label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    value={userDetails.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    readOnly={!editMode.name}
                    className={editMode.name ? 'editing' : ''}
                  />
                  <FaEdit
                    className="edit-btn"
                    onClick={() => toggleEditMode('name')}
                    title={editMode.name ? 'Lock field' : 'Edit field'}
                  />
                </div>
              </div>

              {/* Email Field */}
              <div className="form-field">
                <label>
                  <FaEnvelope />
                  EMAIL
                </label>
                <div className="input-wrapper">
                  <input
                    type="email"
                    value={userDetails.email}
                    readOnly={true}
                    style={{ backgroundColor: '#f9f9f9', cursor: 'not-allowed', color: '#888' }}
                    title="Email cannot be changed directly."
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="form-field">
                <label>
                  <FaLock />
                  PASSWORD
                </label>
                <div className="input-wrapper">
                  <input
                    type="password"
                    value="••••••••"
                    readOnly
                    className=""
                  />
                  <FaEdit
                    className="edit-btn"
                    onClick={() => toggleEditMode('password')}
                    title="Change password"
                  />
                </div>
              </div>

              <button
                className="save-btn btn btn-primary"
                onClick={handleSaveChanges}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="modal-overlay" onClick={closePasswordModal}>
          <div className="password-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closePasswordModal}>
              <FaTimes />
            </button>
            <h2>Change Password</h2>
            <p className="modal-subtitle">Enter your current password to set a new one</p>

            <div className="modal-form">
              <div className="form-field">
                <label>
                  <FaLock />
                  CURRENT PASSWORD
                </label>
                <div className="input-wrapper">
                  <input
                    type={showPassword.current ? 'text' : 'password'}
                    value={passwordData.currentPassword}
                    onChange={(e) => handlePasswordChange('currentPassword', e.target.value)}
                    placeholder="Enter current password"
                  />
                  {showPassword.current ? (
                    <FaEyeSlash
                      className="edit-btn"
                      onClick={() => togglePasswordVisibility('current')}
                    />
                  ) : (
                    <FaEye
                      className="edit-btn"
                      onClick={() => togglePasswordVisibility('current')}
                    />
                  )}
                </div>
              </div>

              <div className="form-field">
                <label>
                  <FaLock />
                  NEW PASSWORD
                </label>
                <div className="input-wrapper">
                  <input
                    type={showPassword.new ? 'text' : 'password'}
                    value={passwordData.newPassword}
                    onChange={(e) => handlePasswordChange('newPassword', e.target.value)}
                    placeholder="Enter new password"
                  />
                  {showPassword.new ? (
                    <FaEyeSlash
                      className="edit-btn"
                      onClick={() => togglePasswordVisibility('new')}
                    />
                  ) : (
                    <FaEye
                      className="edit-btn"
                      onClick={() => togglePasswordVisibility('new')}
                    />
                  )}
                </div>
              </div>

              <div className="form-field">
                <label>
                  <FaLock />
                  CONFIRM NEW PASSWORD
                </label>
                <div className="input-wrapper">
                  <input
                    type={showPassword.confirm ? 'text' : 'password'}
                    value={passwordData.confirmPassword}
                    onChange={(e) => handlePasswordChange('confirmPassword', e.target.value)}
                    placeholder="Confirm new password"
                  />
                  {showPassword.confirm ? (
                    <FaEyeSlash
                      className="edit-btn"
                      onClick={() => togglePasswordVisibility('confirm')}
                    />
                  ) : (
                    <FaEye
                      className="edit-btn"
                      onClick={() => togglePasswordVisibility('confirm')}
                    />
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={closePasswordModal}
                >
                  Cancel
                </button>
                <button
                  className="save-btn btn btn-primary"
                  onClick={handleChangePassword}
                  disabled={saving}
                >
                  {saving ? 'Changing...' : 'Change Password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
