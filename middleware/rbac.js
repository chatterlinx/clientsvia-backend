/**
 * ============================================================================
 * RBAC (Role-Based Access Control) - Enterprise Governance Layer
 * ============================================================================
 *
 * Roles (Salesforce-level semantics):
 * - admin: platform superuser (can access any company)
 * - owner: company owner/admin (full company config)
 * - support: support engineer (read-only by default; writes only via break-glass)
 * - read_only: view-only (no writes)
 *
 * Legacy compatibility:
 * - manager -> owner
 * - staff   -> read_only
 */

const logger = require('../utils/logger');

const ROLES = {
  ADMIN: 'admin',
  OWNER: 'owner',
  SUPPORT: 'support',
  READ_ONLY: 'read_only',

  // Legacy roles still present in DB
  MANAGER: 'manager',
  STAFF: 'staff'
};

const PERMISSIONS = {
  // Config governance
  CONFIG_READ: 'config:read',
  CONFIG_WRITE: 'config:write',

  // Diagnostics governance
  DIAGNOSTICS_ADMIN: 'diagnostics:admin',

  // Support break-glass
  BREAK_GLASS: 'break_glass:use'
};

function getEffectiveRole(role) {
  if (role === ROLES.MANAGER) return ROLES.OWNER;
  if (role === ROLES.STAFF) return ROLES.READ_ONLY;
  return role || ROLES.READ_ONLY;
}

function hasPermission(user, permission) {
  const role = getEffectiveRole(user?.role);

  // Break-glass tokens can temporarily elevate within scopes (handled separately)
  const breakGlass = user?.breakGlass === true;

  // Platform admin: all permissions
  if (role === ROLES.ADMIN) return true;

  // Owner: can read/write config for their company; cannot use admin-only diagnostics
  if (role === ROLES.OWNER) {
    if (permission === PERMISSIONS.CONFIG_READ) return true;
    if (permission === PERMISSIONS.CONFIG_WRITE) return true;
    return false;
  }

  // Support: read config; writes require break-glass token
  if (role === ROLES.SUPPORT) {
    if (permission === PERMISSIONS.CONFIG_READ) return true;
    if (permission === PERMISSIONS.CONFIG_WRITE) return breakGlass === true;
    if (permission === PERMISSIONS.BREAK_GLASS) return breakGlass === true;
    return false;
  }

  // Read-only: view only
  if (role === ROLES.READ_ONLY) {
    if (permission === PERMISSIONS.CONFIG_READ) return true;
    return false;
  }

  return false;
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Break-glass must remain company-scoped (no cross-tenant leakage).
    if (req.user.breakGlass === true && Array.isArray(req.user.companyIds) && req.user.companyIds.length > 0) {
      const requestedCompanyId = req.params.companyId || req.body?.companyId || null;
      if (requestedCompanyId && !req.user.companyIds.includes(String(requestedCompanyId))) {
        return res.status(403).json({
          success: false,
          message: 'Access denied (support token is not scoped to this company)',
          code: 'BREAK_GLASS_COMPANY_SCOPE_DENIED'
        });
      }
    }

    const ok = hasPermission(req.user, permission);
    if (!ok) {
      logger.security?.('[RBAC] Access denied', {
        userId: req.user?._id?.toString?.() || null,
        email: req.user?.email || null,
        role: req.user?.role || null,
        effectiveRole: getEffectiveRole(req.user?.role),
        breakGlass: req.user?.breakGlass === true,
        permission,
        path: req.originalUrl || req.path,
        method: req.method
      });
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        requiredPermission: permission
      });
    }

    return next();
  };
}

module.exports = {
  ROLES,
  PERMISSIONS,
  getEffectiveRole,
  hasPermission,
  requirePermission
};


