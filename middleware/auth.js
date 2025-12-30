const jwt = require('jsonwebtoken');
const logger = require('../utils/logger.js');

const User = require('../models/v2User');
const sessionManager = require('./singleSessionManager');
const SupportAccessToken = require('../models/SupportAccessToken');

// Extract JWT from either httpOnly cookie or Authorization header
function getTokenFromRequest(req) {
  const cookies = req.cookies || {};
  const authHeader =
    typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  if (cookies.token) {return cookies.token;}
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

// Middleware to validate JWT and attach user info
function verifyToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {return res.status(401).json({ message: 'Unauthorized' });}
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Enhanced JWT Authentication with User lookup
async function authenticateJWT(req, res, next) {
  const token = getTokenFromRequest(req);
  
  try {
    
    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ─────────────────────────────────────────────────────────────────────
    // BREAK-GLASS SUPPORT TOKENS (time-limited, scoped, revocable)
    // ─────────────────────────────────────────────────────────────────────
    if (decoded?.tokenType === 'support' && decoded?.jti) {
      const record = await SupportAccessToken.findOne({ jti: decoded.jti }).lean();
      if (!record) {
        return res.status(401).json({ message: 'Invalid support token', code: 'SUPPORT_TOKEN_NOT_FOUND' });
      }
      if (record.revokedAt) {
        return res.status(401).json({ message: 'Support token revoked', code: 'SUPPORT_TOKEN_REVOKED' });
      }
      if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
        return res.status(401).json({ message: 'Support token expired', code: 'SUPPORT_TOKEN_EXPIRED' });
      }

      // Path/method scope enforcement
      const method = String(req.method || '').toUpperCase();
      const allowedMethods = Array.isArray(record.allowedMethods) ? record.allowedMethods.map(m => String(m).toUpperCase()) : ['GET'];
      if (!allowedMethods.includes(method)) {
        return res.status(403).json({ message: 'Support token method not allowed', code: 'SUPPORT_TOKEN_METHOD_DENIED' });
      }

      const url = req.originalUrl || req.path || '';
      const prefixes = Array.isArray(record.allowedPathPrefixes) ? record.allowedPathPrefixes : [];
      if (prefixes.length > 0 && !prefixes.some(p => url.startsWith(p))) {
        return res.status(403).json({ message: 'Support token path not allowed', code: 'SUPPORT_TOKEN_PATH_DENIED' });
      }

      // Attach a synthetic user object (no DB user required for break-glass access)
      req.user = {
        _id: decoded.issuedByUserId || 'support',
        email: decoded.issuedByEmail || record.issuedByEmail || 'support@clientsvia',
        role: 'support',
        breakGlass: true,
        companyIds: (record.companyIds || []).map(id => id.toString()),
        supportTokenJti: decoded.jti
      };
      return next();
    }
    
    const user = await User.findById(decoded.userId).populate('companyId');
    
    if (!user || user.status !== 'active') {
      logger.security('❌ AUTH: User not found or inactive', { userId: decoded.userId });
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    // ✅ PROPER FIX: Admins don't need companyId (they're platform-level superusers)
    // Only non-admin users require company association for multi-tenant isolation
    if (!user.companyId && user.role !== 'admin') {
      logger.security('⚠️  AUTH: Non-admin user missing company association', {
        userId: user._id.toString(),
        email: user.email,
        role: user.role
      });
      return res.status(403).json({ 
        message: 'Your account is not properly configured. Please contact support to complete your account setup.',
        code: 'MISSING_COMPANY_ASSOCIATION'
      });
    }
    
    // NOTE: Admin access logging moved to debug level to prevent log spam
    // For security audit, use separate audit log or query-based reporting

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    logger.security('❌ JWT Authentication failed:', error.message);
    return res.status(401).json({ 
      message: 'Invalid token',
      error: error.message,
      code: error.name 
    });
  }
}

// Passport Session Authentication Middleware
function authenticateSession(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Not authenticated' });
}

// Require at least one of the allowed roles to access endpoint
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Access denied. Required roles: ${roles.join(', ')}` 
      });
    }
    
    next();
  };
}

// Require company access for multi-tenant operations
function requireCompanyAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  // Admin users can access any company
  if (req.user.role === 'admin' || req.user.emergency) {
    return next();
  }
  
  // Regular users can only access their own company
  const requestedCompanyId = req.params.companyId || req.body.companyId;
  if (requestedCompanyId && req.user.companyId && 
      requestedCompanyId !== req.user.companyId.toString()) {
    return res.status(403).json({ 
      message: 'Access denied to this company data' 
    });
  }
  
  next();
}

// For endpoints that must have 2FA verified (admins/managers)
function require2FA(req, res, next) {
  if (['admin', 'manager'].includes(req.user?.role) && !req.user?.twoFactorVerified) {
    return res.status(401).json({ message: '2FA required' });
  }
  next();
}

// Enhanced Single-Session JWT Authentication
async function authenticateSingleSession(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    
    if (!token) {
      return res.status(401).json({ 
        message: 'Access token required',
        code: 'NO_TOKEN'
      });
    }

    // Check for emergency bypass
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.emergency && decoded.sessionId === 'EMERGENCY_BYPASS') {
        logger.security('🚨 Emergency bypass access granted');
        req.user = { _id: decoded.userId, emergency: true };
        return next();
      }
    } catch (e) {
      // Continue to normal validation if bypass fails
    }

    // Validate session with single-session manager
    const validation = sessionManager.validateSession(token);
    
    if (!validation.valid) {
      return res.status(401).json({ 
        message: validation.error || 'Session invalid',
        code: 'SESSION_INVALID'
      });
    }

    // Get user from database
    const user = await User.findById(validation.decoded.userId).populate('companyId');
    
    if (!user || user.status !== 'active') {
      return res.status(401).json({ 
        message: 'User not found or inactive',
        code: 'USER_INACTIVE'
      });
    }

    // ✅ PROPER FIX: Only non-admin users require company association
    // Admins are platform-level superusers and don't need to be tied to a company
    if (!user.companyId && user.role !== 'admin') {
      logger.security('❌ Single-session auth: Non-admin user has no company association', { 
        userId: user._id,
        role: user.role 
      });
      return res.status(403).json({ 
        message: 'User account is not properly configured. Please contact support.',
        code: 'MISSING_COMPANY_ASSOCIATION'
      });
    }
    
    // NOTE: Admin access logging removed to prevent log spam

    // Attach user and session info to request
    req.user = user;
    req.sessionInfo = validation.session;
    next();

  } catch (error) {
    logger.security('Single session auth error:', error);
    return res.status(401).json({ 
      message: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
}

module.exports = {
  getTokenFromRequest,
  verifyToken,
  authenticateJWT,
  authenticateSingleSession, // NEW: Single session auth
  authenticateSession,
  requireRole,
  requireCompanyAccess
};
