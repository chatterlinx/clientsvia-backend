/**
 * ============================================================================
 * COMPANYOPS CONTACTS - CRUD ROUTES
 * ============================================================================
 * 
 * PURPOSE: Manage contacts for CompanyOps Console
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET    /api/company/:companyId/contacts
 * - POST   /api/company/:companyId/contacts
 * - GET    /api/company/:companyId/contacts/:contactId
 * - PUT    /api/company/:companyId/contacts/:contactId
 * - DELETE /api/company/:companyId/contacts/:contactId
 * 
 * MODEL: v2Contact (existing)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const V2Contact = require('../../models/v2Contact');
const CallTrace = require('../../models/CallTrace');
const Location = require('../../models/Location');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/company/:companyId/contacts
 * ============================================================================
 * Get all contacts for a company with aggregated data
 * 
 * Query params:
 * - search: string (name, phone, email)
 * - tags: string[] (filter by tags)
 * - role: string (Owner, Tenant, Manager, Other)
 * - limit: number (default 100)
 * - offset: number (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { search, tags, role, limit = 100, offset = 0 } = req.query;

    // Build query
    const query = { companyId };

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { primaryPhone: searchRegex },
        { secondaryPhone: searchRegex },
        { email: searchRegex }
      ];
    }

    // Tags filter
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      query.tags = { $in: tagArray };
    }

    // Role filter
    if (role) {
      query.role = role;
    }

    // Get contacts
    const contacts = await V2Contact.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    // Get total count
    const total = await V2Contact.countDocuments(query);

    // Enrich with aggregated data
    const enrichedContacts = await Promise.all(
      contacts.map(async (contact) => {
        try {
          // Count locations
          const locationsCount = await Location.countDocuments({
            companyId,
            contactId: contact._id
          });

          // Get last call
          const lastCall = await CallTrace.findOne({
            companyId,
            'extracted.contactId': contact._id.toString()
          })
            .sort({ startedAt: -1 })
            .select('startedAt')
            .lean();

          return {
            ...contact,
            locationsCount,
            lastCallAt: lastCall?.startedAt || null
          };
        } catch (err) {
          logger.error('[CompanyOps Contacts] Error enriching contact', {
            contactId: contact._id,
            error: err.message
          });
          return {
            ...contact,
            locationsCount: 0,
            lastCallAt: null
          };
        }
      })
    );

    res.json({
      ok: true,
      data: enrichedContacts,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: offset + contacts.length < total
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Contacts] GET all failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch contacts'
    });
  }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/contacts
 * ============================================================================
 * Create a new contact
 * 
 * Body:
 * - name: string (required)
 * - primaryPhone: string
 * - secondaryPhone: string
 * - email: string
 * - role: string (Owner, Tenant, Manager, Other)
 * - tags: string[]
 * - notes: string
 */
router.post('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      name,
      primaryPhone,
      secondaryPhone,
      email,
      role,
      tags,
      notes
    } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Name is required'
      });
    }

    // Check for duplicate phone or email
    if (primaryPhone) {
      const existingByPhone = await V2Contact.findOne({
        companyId,
        primaryPhone
      });

      if (existingByPhone) {
        return res.status(409).json({
          ok: false,
          error: 'A contact with this phone number already exists'
        });
      }
    }

    if (email) {
      const existingByEmail = await V2Contact.findOne({
        companyId,
        email: email.toLowerCase()
      });

      if (existingByEmail) {
        return res.status(409).json({
          ok: false,
          error: 'A contact with this email already exists'
        });
      }
    }

    // Create contact
    const contact = await V2Contact.create({
      companyId,
      name: name.trim(),
      primaryPhone: primaryPhone?.trim() || '',
      secondaryPhone: secondaryPhone?.trim() || '',
      email: email?.toLowerCase().trim() || '',
      role: role || 'Other',
      tags: tags || [],
      notes: notes?.trim() || ''
    });

    logger.info('[CompanyOps Contacts] Contact created', {
      companyId,
      contactId: contact._id,
      name: contact.name
    });

    res.status(201).json({
      ok: true,
      data: contact
    });

  } catch (error) {
    logger.error('[CompanyOps Contacts] POST failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to create contact'
    });
  }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/contacts/:contactId
 * ============================================================================
 * Get a single contact with full details
 */
router.get('/:contactId', async (req, res) => {
  try {
    const { companyId, contactId } = req.params;

    const contact = await V2Contact.findOne({
      _id: contactId,
      companyId
    }).lean();

    if (!contact) {
      return res.status(404).json({
        ok: false,
        error: 'Contact not found'
      });
    }

    // Get locations
    const locations = await Location.find({
      companyId,
      contactId
    })
      .select('_id label addressLine1 city state postalCode')
      .lean();

    // Get recent calls (last 5)
    const recentCalls = await CallTrace.find({
      companyId,
      'extracted.contactId': contactId
    })
      .sort({ startedAt: -1 })
      .limit(5)
      .select('callId startedAt durationSeconds currentIntent finalOutcome')
      .lean();

    res.json({
      ok: true,
      data: {
        ...contact,
        locations,
        recentCalls
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Contacts] GET one failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      contactId: req.params.contactId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch contact'
    });
  }
});

/**
 * ============================================================================
 * PUT /api/company/:companyId/contacts/:contactId
 * ============================================================================
 * Update a contact
 */
router.put('/:contactId', async (req, res) => {
  try {
    const { companyId, contactId } = req.params;
    const {
      name,
      primaryPhone,
      secondaryPhone,
      email,
      role,
      tags,
      notes
    } = req.body;

    // Find existing contact
    const contact = await V2Contact.findOne({
      _id: contactId,
      companyId
    });

    if (!contact) {
      return res.status(404).json({
        ok: false,
        error: 'Contact not found'
      });
    }

    // Check for duplicate phone (if changed)
    if (primaryPhone && primaryPhone !== contact.primaryPhone) {
      const existingByPhone = await V2Contact.findOne({
        companyId,
        primaryPhone,
        _id: { $ne: contactId }
      });

      if (existingByPhone) {
        return res.status(409).json({
          ok: false,
          error: 'Another contact with this phone number already exists'
        });
      }
    }

    // Check for duplicate email (if changed)
    if (email && email.toLowerCase() !== contact.email?.toLowerCase()) {
      const existingByEmail = await V2Contact.findOne({
        companyId,
        email: email.toLowerCase(),
        _id: { $ne: contactId }
      });

      if (existingByEmail) {
        return res.status(409).json({
          ok: false,
          error: 'Another contact with this email already exists'
        });
      }
    }

    // Update fields
    if (name) contact.name = name.trim();
    if (primaryPhone !== undefined) contact.primaryPhone = primaryPhone.trim();
    if (secondaryPhone !== undefined) contact.secondaryPhone = secondaryPhone.trim();
    if (email !== undefined) contact.email = email.toLowerCase().trim();
    if (role !== undefined) contact.role = role;
    if (tags !== undefined) contact.tags = tags;
    if (notes !== undefined) contact.notes = notes.trim();

    await contact.save();

    logger.info('[CompanyOps Contacts] Contact updated', {
      companyId,
      contactId,
      name: contact.name
    });

    res.json({
      ok: true,
      data: contact
    });

  } catch (error) {
    logger.error('[CompanyOps Contacts] PUT failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      contactId: req.params.contactId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update contact'
    });
  }
});

/**
 * ============================================================================
 * DELETE /api/company/:companyId/contacts/:contactId
 * ============================================================================
 * Delete a contact (soft delete by marking as deleted)
 * 
 * NOTE: We don't hard delete because of foreign key references in:
 * - Locations
 * - Appointments
 * - CallTraces
 */
router.delete('/:contactId', async (req, res) => {
  try {
    const { companyId, contactId } = req.params;

    const contact = await V2Contact.findOne({
      _id: contactId,
      companyId
    });

    if (!contact) {
      return res.status(404).json({
        ok: false,
        error: 'Contact not found'
      });
    }

    // Check if contact is referenced by locations
    const locationCount = await Location.countDocuments({
      companyId,
      contactId
    });

    if (locationCount > 0) {
      return res.status(409).json({
        ok: false,
        error: `Cannot delete contact. It is referenced by ${locationCount} location(s). Remove those references first.`
      });
    }

    // Soft delete
    contact.deleted = true;
    contact.deletedAt = new Date();
    await contact.save();

    logger.info('[CompanyOps Contacts] Contact deleted', {
      companyId,
      contactId,
      name: contact.name
    });

    res.json({
      ok: true,
      message: 'Contact deleted successfully'
    });

  } catch (error) {
    logger.error('[CompanyOps Contacts] DELETE failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      contactId: req.params.contactId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to delete contact'
    });
  }
});

module.exports = router;

