const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
  try {
    const token = getTokenFromRequest(req);
    
    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).populate('companyId');
    
    if (!user || user.status !== 'active') {
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
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
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

// For endpoints that must have 2FA verified (admins/managers)
function require2FA(req, res, next) {
  if (['admin', 'manager'].includes(req.user?.role) && !req.user?.twoFactorVerified) {
    return res.status(401).json({ message: '2FA required' });
  }
  next();
}

module.exports = { 
  verifyToken, 
  requireRole, 
  require2FA, 
  authenticateJWT, 
  authenticateSession 
};
