# 🔐 Role-Based Authentication System

## Overview
The Robridge Web Application now includes a comprehensive role-based authentication system that restricts access to different pages based on user email domains.

## 🎯 User Roles

### 1. **Expo User** (`@expo.com` / `@expo.dev` / `@expo.io`)
- **Access Level**: Limited
- **Allowed Pages**:
  - Dashboard (`/`)
  - Barcode Scanner (`/scanner`)
  - Device Connected (`/device-connected`)
- **Features**: Basic barcode scanning and device monitoring

### 2. **Administrator** (`@admin.robridge.com`)
- **Access Level**: Full + Admin Controls
- **Allowed Pages**: All pages including admin-specific features
- **Features**: Complete system control and management

### 3. **Full Access** (`@robridge.com`)
- **Access Level**: Complete
- **Allowed Pages**: All pages except admin-specific features
- **Features**: Full system functionality

## 🚀 How to Use

### Login Process
1. Navigate to the login page
2. Enter your email address with one of the authorized domains
3. Enter any password (for demo purposes)
4. The system will automatically detect your role based on email domain
5. You'll be redirected to the appropriate pages based on your role

### Demo Credentials
- **Expo User**: `user@expo.com` / `expo123`
- **Admin**: `admin@admin.robridge.com` / `admin123`
- **Full Access**: `user@robridge.com` / `full123`

## 🔧 Technical Implementation

### Key Components

#### 1. **AuthContext** (`src/contexts/AuthContext.js`)
- Manages user authentication state
- Validates email domains and assigns roles
- Provides role-based access control functions
- Handles login/logout functionality

#### 2. **ProtectedRoute** (`src/App.js`)
- Wraps protected routes with access control
- Checks user authentication and page permissions
- Shows access denied page for unauthorized access

#### 3. **Navigation** (`src/components/Navigation.js`)
- Dynamically filters navigation items based on user role
- Shows only accessible pages in the navigation menu
- Displays user role and information

#### 4. **LoginPage** (`src/pages/LoginPage.js`)
- Enhanced login form with role-based validation
- Visual indicators for different user types
- Demo credentials for testing

### Role Configuration

```javascript
// Role definitions
export const ROLES = {
  ADMIN: 'admin',
  EXPO_USER: 'expo_user',
  FULL_ACCESS: 'full_access'
};

// Page access control
export const PAGE_ACCESS = {
  [ROLES.ADMIN]: [
    '/', '/scanner', '/generator', '/image-processing', '/robot-control',
    '/rack-status', '/rack-management', '/product-management', '/device-connected', '/settings'
  ],
  [ROLES.EXPO_USER]: [
    '/', '/scanner', '/device-connected'
  ],
  [ROLES.FULL_ACCESS]: [
    '/', '/scanner', '/generator', '/image-processing', '/robot-control',
    '/rack-status', '/rack-management', '/product-management', '/device-connected', '/settings'
  ]
};
```

## 🎨 UI Features

### Login Page Enhancements
- **Role Examples**: Visual cards showing different user types
- **Demo Buttons**: Quick-fill buttons for testing different roles
- **Success/Error Messages**: Clear feedback for login attempts
- **Responsive Design**: Works on all screen sizes

### Navigation Enhancements
- **Role-based Filtering**: Only shows accessible pages
- **User Information**: Displays user name, email, and role
- **Role Icons**: Visual indicators for different user types
- **Collapsible Design**: Space-efficient navigation

### Access Control
- **Protected Routes**: Automatic redirection for unauthorized access
- **Access Denied Page**: User-friendly error page for restricted access
- **Role Validation**: Server-side and client-side validation

## 🔒 Security Features

### Email Domain Validation
- Validates email format and domain
- Assigns roles based on domain patterns
- Prevents unauthorized access attempts

### Page Access Control
- Double validation (role + page access)
- Automatic redirection for unauthorized access
- Secure route protection

### Session Management
- Persistent login sessions
- Automatic logout on invalid access
- Secure token handling

## 🧪 Testing

### Test Different Roles
1. **Expo User Test**:
   - Login with `user@expo.com`
   - Verify only Dashboard, Scanner, and Device Connected are visible
   - Try accessing restricted pages (should show access denied)

2. **Admin Test**:
   - Login with `admin@admin.robridge.com`
   - Verify all pages are accessible
   - Check admin-specific features

3. **Full Access Test**:
   - Login with `user@robridge.com`
   - Verify all standard pages are accessible
   - Check full functionality

### Edge Cases
- Invalid email domains (should be rejected)
- Direct URL access to restricted pages
- Session persistence after page refresh
- Logout functionality

## 📱 Responsive Design

The role-based authentication system is fully responsive and works on:
- Desktop computers
- Tablets
- Mobile devices
- Different screen orientations

## 🚀 Future Enhancements

### Planned Features
1. **Password Validation**: Real authentication with backend
2. **Role Management**: Admin panel for managing user roles
3. **Permission Granularity**: More detailed permission system
4. **Audit Logging**: Track user actions and access attempts
5. **Multi-factor Authentication**: Enhanced security features

### Integration Points
- Backend API integration for real authentication
- Database user management
- LDAP/Active Directory integration
- OAuth/SSO integration

## 🐛 Troubleshooting

### Common Issues
1. **Login Not Working**: Check email domain format
2. **Pages Not Showing**: Verify user role assignment
3. **Access Denied**: Check page permissions for user role
4. **Session Issues**: Clear browser cache and localStorage

### Debug Information
- Check browser console for authentication errors
- Verify user object in localStorage
- Check role assignment in AuthContext
- Validate page access permissions

## 📞 Support

For issues or questions about the role-based authentication system:
1. Check this documentation
2. Review the code comments
3. Test with demo credentials
4. Check browser console for errors

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Compatibility**: React 18+, Modern Browsers
