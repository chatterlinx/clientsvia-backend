# Google OAuth Admin Access Control Guide

## 🔐 Security Levels (Choose One)

### **Level 1: Admin Email Whitelist (RECOMMENDED)**
Only specific Gmail/Google accounts can access admin functions.

**Environment Variables:**
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
ADMIN_GOOGLE_EMAILS=marc@gmail.com,admin@yourcompany.com,trusted@partner.com
```

**Security:** Highest - Only exact emails listed can login as admin
**Use Case:** Small team of known administrators

### **Level 2: Domain Whitelist**
Any Google account from specific domains can access.

**Environment Variables:**
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
ALLOWED_DOMAINS=yourcompany.com,trustedpartner.org
```

**Security:** Medium - Anyone from whitelisted domains
**Use Case:** Company-wide admin access

### **Level 3: Hybrid (Email + Domain)**
Combination of specific emails AND domain whitelist.

**Environment Variables:**
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
ADMIN_GOOGLE_EMAILS=marc@gmail.com,external@contractor.com
ALLOWED_DOMAINS=yourcompany.com
```

**Security:** Flexible - Specific external admins + company domain
**Use Case:** Company employees + external contractors

### **Level 4: No Restrictions (NOT RECOMMENDED)**
Any Google account can access admin functions.

**Environment Variables:**
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
# No ADMIN_GOOGLE_EMAILS or ALLOWED_DOMAINS
```

**Security:** None - Anyone with Google account
**Use Case:** Development/testing only

## 🚀 Setup Process

### 1. Google Cloud Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select project
3. Enable Google+ API or Google Identity API
4. Create OAuth 2.0 Client ID credentials
5. Add authorized redirect URI: `https://yourserver.com/api/auth/google/callback`

### 2. Environment Setup
Choose your security level and set environment variables in your hosting platform.

**For Render.com:**
1. Go to your service settings
2. Environment tab
3. Add the variables above

**For local development:**
Create `.env` file with your chosen variables.

### 3. Test Access Control
```bash
# Run the admin management script
node scripts/manage-google-admins.js
```

## 🛡️ Security Best Practices

1. **Use Admin Email Whitelist** for production
2. **Regularly audit** who has admin access
3. **Use company email addresses** when possible
4. **Monitor authentication logs** for unauthorized attempts
5. **Set up alerts** for new admin logins

## 🔧 Management Commands

```bash
# Interactive admin email management
node scripts/manage-google-admins.js

# Quick add admin email (manual)
export ADMIN_GOOGLE_EMAILS="current@emails.com,new@admin.com"

# Check current configuration
echo $ADMIN_GOOGLE_EMAILS
echo $ALLOWED_DOMAINS
```

## 🚨 Emergency Access

If you're locked out:
1. Use the JWT admin account: `admin@clientsvia.com / admin123`
2. Or temporarily disable Google OAuth restrictions
3. Or run `node scripts/create-admin.js` to reset JWT admin

## 📋 Current Implementation

The system now supports:
- ✅ JWT authentication (always available)
- ✅ Google OAuth with email whitelist
- ✅ Domain-based access control
- ✅ Hybrid security modes
- ✅ Management scripts
- ✅ Emergency fallback
