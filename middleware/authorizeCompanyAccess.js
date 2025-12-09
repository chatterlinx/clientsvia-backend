/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTHORIZE COMPANY ACCESS MIDDLEWARE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that the authenticated user has access to the requested company.
 * This is Layer 3 of our 5-layer multi-tenant security model.
 * 
 * SECURITY LAYERS:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. URL: ?companyId=XXX required
 * 2. JWT: authenticateJWT validates token
 * 3. THIS: authorizeCompanyAccess validates user has company access ← YOU ARE HERE
 * 4. Database: Queries filter by companyId
 * 5. Response: No cross-company data leaks
 * 
 * USAGE:
 * ─────────────────────────────────────────────────────────────────────────────
 * router.get('/:companyId/calls', 
 *   authenticateJWT, 
 *   authorizeCompanyAccess,  ← Add this after authenticateJWT
 *   CallController.list
 * );
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');
const mongoose = require('mongoose');

/**
 * Middleware to verify user has access to the requested company
 * 
 * Prerequisites:
 * - Must be used AFTER authenticateJWT middleware
 * - Route must have :companyId parameter
 * 
 * What it does:
 * - Extracts companyId from req.params
 * - Validates companyId format (MongoDB ObjectId)
 * - Checks user.companyIds includes requested company
 * - Attaches companyId to req for convenience
 * - Logs unauthorized access attempts
 */
const authorizeCompanyAccess = async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Extract companyId from route params
    // ─────────────────────────────────────────────────────────────────────────
    const { companyId } = req.params;
    
    if (!companyId) {
      logger.warn('[AUTH] Missing companyId in route params', {
        path: req.path,
        method: req.method,
        userId: req.user?._id
      });
      
      return res.status(400).json({
        success: false,
        error: 'Missing company ID',
        message: 'companyId is required in the route'
      });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Validate companyId format
    // ─────────────────────────────────────────────────────────────────────────
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      logger.warn('[AUTH] Invalid companyId format', {
        companyId,
        path: req.path,
        method: req.method,
        userId: req.user?._id
      });
      
      return res.status(400).json({
        success: false,
        error: 'Invalid company ID format',
        message: 'companyId must be a valid MongoDB ObjectId'
      });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Check user exists and has companyIds
    // ─────────────────────────────────────────────────────────────────────────
    const user = req.user;
    
    if (!user) {
      logger.error('[AUTH] No user object found - authenticateJWT not called?', {
        path: req.path,
        method: req.method
      });
      
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please authenticate first'
      });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Check user has access to this company
    // ─────────────────────────────────────────────────────────────────────────
    
    // Get user's allowed companies (handle different formats)
    // Check companyIds (array), companies (array), or companyId (single - most common)
    let userCompanyIds = user.companyIds || user.companies || [];
    
    // Also check singular companyId (this is how our auth system works)
    if (user.companyId) {
      const singleCompanyId = typeof user.companyId === 'object' 
        ? (user.companyId._id?.toString() || user.companyId.toString())
        : user.companyId;
      if (!userCompanyIds.includes(singleCompanyId)) {
        userCompanyIds = [...userCompanyIds, singleCompanyId];
      }
    }
    
    // Convert to strings for comparison
    const allowedCompanies = userCompanyIds.map(id => 
      typeof id === 'object' ? (id._id?.toString() || id.toString()) : id
    );
    
    // Super admin check (has access to all companies)
    const isSuperAdmin = user.role === 'super_admin' || user.isSuperAdmin === true;
    
    // Check access
    const hasAccess = isSuperAdmin || allowedCompanies.includes(companyId);
    
    if (!hasAccess) {
      logger.warn('[AUTH] Unauthorized company access attempt', {
        userId: user._id?.toString() || user.id,
        userEmail: user.email,
        userRole: user.role,
        attemptedCompanyId: companyId,
        allowedCompanies: allowedCompanies.slice(0, 5),  // Log first 5 only
        allowedCompaniesCount: allowedCompanies.length,
        path: req.path,
        method: req.method,
        ip: req.ip || req.connection?.remoteAddress
      });
      
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You do not have access to this company'
      });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Attach companyId to request for convenience
    // ─────────────────────────────────────────────────────────────────────────
    req.companyId = companyId;
    req.companyObjectId = new mongoose.Types.ObjectId(companyId);
    
    // Log successful authorization (debug level only)
    logger.debug('[AUTH] Company access authorized', {
      userId: user._id?.toString() || user.id,
      companyId,
      isSuperAdmin,
      authTime: Date.now() - startTime
    });
    
    next();
    
  } catch (error) {
    logger.error('[AUTH] Company authorization error', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      companyId: req.params?.companyId,
      userId: req.user?._id
    });
    
    return res.status(500).json({
      success: false,
      error: 'Authorization check failed',
      message: 'An error occurred while checking company access'
    });
  }
};

/**
 * Factory function to create middleware with custom options
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.companyIdParam - Name of the route param (default: 'companyId')
 * @param {boolean} options.allowSuperAdmin - Allow super admins to access all (default: true)
 * @param {boolean} options.logAllAttempts - Log all attempts, not just failures (default: false)
 */
const createAuthorizeCompanyAccess = (options = {}) => {
  const {
    companyIdParam = 'companyId',
    allowSuperAdmin = true,
    logAllAttempts = false
  } = options;
  
  return async (req, res, next) => {
    const companyId = req.params[companyIdParam];
    
    // Temporarily set to standard param name for the main middleware
    req.params.companyId = companyId;
    
    // If super admin bypass is disabled, we need custom logic
    if (!allowSuperAdmin && req.user?.role === 'super_admin') {
      // Still require explicit company access even for super admins
      const userCompanyIds = (req.user.companyIds || []).map(id => id.toString());
      if (!userCompanyIds.includes(companyId)) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'Super admin access not permitted for this resource'
        });
      }
    }
    
    // Log all attempts if configured
    if (logAllAttempts) {
      logger.info('[AUTH] Company access attempt', {
        userId: req.user?._id,
        companyId,
        path: req.path,
        method: req.method
      });
    }
    
    return authorizeCompanyAccess(req, res, next);
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = authorizeCompanyAccess;
module.exports.createAuthorizeCompanyAccess = createAuthorizeCompanyAccess;

