const jwt = require('jsonwebtoken');
const User = require('../models/v2User');
const sessionManager = require('./singleSessionManager');

// Extract JWT from either httpOnly cookie or Authorization header
function getTokenFromRequest(req) {
  const cookies = req.cookies || {};
  const authHeader =
    typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  if (cookies.token) return cookies.token;
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

// Middleware to validate JWT and attach user info
function verifyToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
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
    console.log('🔍 AUTH CHECKPOINT: JWT decoded successfully, userId:', decoded.userId);
    
    const user = await User.findById(decoded.userId).populate('companyId');
    console.log('🔍 AUTH CHECKPOINT: User found:', !!user);
    console.log('🔍 AUTH CHECKPOINT: User companyId field:', user?.companyId);
    console.log('🔍 AUTH CHECKPOINT: User companyId type:', typeof user?.companyId);
    console.log('🔍 AUTH CHECKPOINT: User status:', user?.status);
    
    if (!user || user.status !== 'active') {
      console.error('❌ AUTH CHECKPOINT: User not found or inactive');
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    // 🚨 PRODUCTION: Auto-fix user-company association for known users (Mongoose + Redis)
    const knownAssociations = [
      { userId: '688bdd8b2f0ec14cfaf88139', companyId: '68813026dd95f599c74e49c7', email: 'chatterlinx@gmail.com' }
    ];
    
    const association = knownAssociations.find(a => 
      a.userId === user._id.toString() || a.email === user.email.toLowerCase()
    );
    
    if (association && (!user.companyId || user.companyId.toString() !== association.companyId)) {
      console.log('🚨 PRODUCTION: Auto-fixing user-company association in JWT auth middleware');
      console.log('🔍 User email:', user.email);
      console.log('🔍 Current companyId:', user.companyId);
      console.log('🔍 Target companyId:', association.companyId);
      
      try {
        const oldCompanyId = user.companyId;
        user.companyId = association.companyId;
        await user.save();
        
        // Clear Redis cache following established pattern
        const { redisClient } = require('../clients');
        try {
          await redisClient.del(`user:${user._id}`);
          console.log(`🗑️ CACHE CLEARED: user:${user._id} - Association fixed in JWT auth`);
        } catch (cacheError) {
          console.warn(`⚠️ Cache clear failed:`, cacheError.message);
        }
        
        console.log('✅ User-company association fixed in JWT auth middleware');
        console.log('✅ Changed from:', oldCompanyId, 'to:', association.companyId);
        
      } catch (fixError) {
        console.error('⚠️ JWT auth auto-fix failed:', fixError.message);
      }
    }

    req.user = user;
    console.log('✅ AUTH CHECKPOINT: Authentication successful, user attached to request');
    next();
  } catch (error) {
    console.error('❌ JWT Authentication failed:', error.message);
    console.error('❌ JWT Error details:', {
      name: error.name,
      message: error.message,
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      hasJWTSecret: !!process.env.JWT_SECRET
    });
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
        console.log('🚨 Emergency bypass access granted');
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

    // 🚨 PRODUCTION FIX: Auto-fix missing companyId for known users (Mongoose + Redis)
    if (!user.companyId) {
      const knownAssociations = [
        { userId: '688bdd8b2f0ec14cfaf88139', companyId: '68813026dd95f599c74e49c7' }
      ];
      
      const association = knownAssociations.find(a => a.userId === user._id.toString());
      
      if (association) {
        console.log('🚨 PRODUCTION: Auto-fixing user-company association in auth middleware');
        try {
          user.companyId = association.companyId;
          await user.save();
          
          // Clear Redis cache following established pattern
          const { redisClient } = require('../clients');
          try {
            await redisClient.del(`user:${user._id}`);
            console.log(`🗑️ CACHE CLEARED: user:${user._id} - Association fixed in auth`);
          } catch (cacheError) {
            console.warn(`⚠️ Cache clear failed:`, cacheError.message);
          }
          
          console.log('✅ User-company association fixed in auth middleware');
        } catch (fixError) {
          console.error('⚠️ Auth auto-fix failed:', fixError.message);
        }
      }
    }

    // Attach user and session info to request
    req.user = user;
    req.sessionInfo = validation.session;
    next();

  } catch (error) {
    console.error('Single session auth error:', error);
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
