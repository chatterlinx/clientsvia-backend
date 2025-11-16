/**
 * ============================================================================
 * CHEAT SHEET - ROLE CONTACTS MAPPING ROUTES
 * ============================================================================
 * 
 * PURPOSE: Map roles to specific contacts for use in behavior rules/escalation
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET   /api/company/:companyId/role-contacts
 * - PATCH /api/company/:companyId/role-contacts
 * 
 * DATA MODEL: v2Company.roleContacts
 * 
 * STRUCTURE:
 * roleContacts: {
 *   owner: "contactId",
 *   officeManager: "contactId",
 *   onCallTech: "contactId",
 *   billingContact: "contactId",
 *   escalationContact: "contactId",
 *   [customRole]: "contactId"
 * }
 * 
 * DEFAULT ROLES:
 * - owner: Business owner / main decision maker
 * - officeManager: Day-to-day operations
 * - onCallTech: After-hours emergency tech
 * - billingContact: Billing / invoices contact
 * - escalationContact: Who to transfer angry customers to
 * 
 * USED BY:
 * - Behavior rules (escalation, angry customers)
 * - Notification events (if tied to role instead of static contact)
 * - After-hours routing
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const V2Company = require('../../models/v2Company');
const V2Contact = require('../../models/v2Contact');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

// Default role definitions
const DEFAULT_ROLES = {
  owner: { label: 'Business Owner', description: 'Main decision maker' },
  officeManager: { label: 'Office Manager', description: 'Day-to-day operations' },
  onCallTech: { label: 'On-Call Tech', description: 'After-hours emergency tech' },
  billingContact: { label: 'Billing Contact', description: 'Billing / invoices' },
  escalationContact: { label: 'Escalation Contact', description: 'Angry customer transfers' }
};

/**
 * ============================================================================
 * GET /api/company/:companyId/role-contacts
 * ============================================================================
 * Get role-to-contact mappings with resolved contact info
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await V2Company.findById(companyId).lean();

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Get role contacts or use empty object
    const roleContacts = company.roleContacts || {};

    // Get all contacts for this company for dropdown population
    const allContacts = await V2Contact.find({ companyId })
      .select('_id name primaryPhone email role')
      .sort({ name: 1 })
      .lean();

    // Resolve contact info for each role
    const resolvedRoles = {};
    
    for (const [roleKey, contactId] of Object.entries(roleContacts)) {
      const contact = await V2Contact.findOne({
        _id: contactId,
        companyId
      })
        .select('_id name primaryPhone email role')
        .lean();

      const roleDefinition = DEFAULT_ROLES[roleKey] || {
        label: roleKey,
        description: 'Custom role'
      };

      resolvedRoles[roleKey] = {
        contactId,
        contactInfo: contact,
        roleDefinition
      };
    }

    // Add default roles that aren't mapped yet
    for (const [roleKey, roleDefinition] of Object.entries(DEFAULT_ROLES)) {
      if (!resolvedRoles[roleKey]) {
        resolvedRoles[roleKey] = {
          contactId: null,
          contactInfo: null,
          roleDefinition
        };
      }
    }

    res.json({
      ok: true,
      data: {
        roles: resolvedRoles,
        availableContacts: allContacts,
        defaultRoles: DEFAULT_ROLES
      }
    });

  } catch (error) {
    logger.error('[Cheat Sheet RoleContacts] GET failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch role contacts'
    });
  }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/role-contacts
 * ============================================================================
 * Update role-to-contact mappings
 * 
 * Body:
 * {
 *   roles: {
 *     roleKey: contactId | null,
 *     ...
 *   }
 * }
 */
router.patch('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { roles } = req.body;

    if (!roles || typeof roles !== 'object') {
      return res.status(400).json({
        ok: false,
        error: 'Roles object is required'
      });
    }

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Validate all contactIds exist
    const contactIds = Object.values(roles).filter(id => id !== null);
    
    if (contactIds.length > 0) {
      const existingContacts = await V2Contact.find({
        _id: { $in: contactIds },
        companyId
      }).select('_id');

      const existingIds = new Set(existingContacts.map(c => c._id.toString()));
      const invalidIds = contactIds.filter(id => !existingIds.has(id.toString()));

      if (invalidIds.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `Some contacts do not exist: ${invalidIds.join(', ')}`
        });
      }
    }

    // Initialize roleContacts if doesn't exist
    if (!company.roleContacts) {
      company.roleContacts = {};
    }

    // Update role mappings
    for (const [roleKey, contactId] of Object.entries(roles)) {
      if (contactId === null) {
        // Remove mapping
        delete company.roleContacts[roleKey];
      } else {
        // Set mapping
        company.roleContacts[roleKey] = contactId;
      }
    }

    company.markModified('roleContacts');
    await company.save();

    logger.info('[Cheat Sheet RoleContacts] Roles updated', {
      companyId,
      rolesUpdated: Object.keys(roles)
    });

    // Clear Redis cache
    try {
      const redisClient = require('../../src/config/redisClient');
      await redisClient.del(`company:${companyId}`);
      logger.info('[Cheat Sheet RoleContacts] Redis cache cleared', { companyId });
    } catch (redisError) {
      logger.warn('[Cheat Sheet RoleContacts] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'Role contacts updated successfully',
      data: {
        roleContacts: company.roleContacts
      }
    });

  } catch (error) {
    logger.error('[Cheat Sheet RoleContacts] PATCH failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update role contacts'
    });
  }
});

module.exports = router;

