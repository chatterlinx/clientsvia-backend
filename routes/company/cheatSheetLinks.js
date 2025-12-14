/**
 * ============================================================================
 * CHEAT SHEET - LINKS MANAGEMENT ROUTES
 * ============================================================================
 * 
 * PURPOSE: Store all URLs the AI needs to reference or send to customers
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET    /api/company/:companyId/links
 * - POST   /api/company/:companyId/links
 * - PUT    /api/company/:companyId/links/:linkId
 * - DELETE /api/company/:companyId/links/:linkId
 * 
 * DATA MODEL: v2Company.links[]
 * 
 * STRUCTURE:
 * links: [{
 *   _id: ObjectId,
 *   key: "paymentPortal",
 *   label: "Online Payment Portal",
 *   url: "https://...",
 *   type: "Payment Portal",
 *   description: "Used when customer wants to pay invoice online",
 *   visibleToAgent: true
 * }]
 * 
 * LINK TYPES:
 * - Website
 * - Payment Portal
 * - Customer Portal
 * - Booking Widget
 * - Financing Application
 * - Terms/Privacy
 * - Documentation
 * - Other
 * 
 * USED BY:
 * - LLM-0 Orchestrator (via Active Instructions)
 * - Behavior rules (can reference link keys)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent
const mongoose = require('mongoose');

const V2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

// Valid link types
const VALID_LINK_TYPES = [
  'Website',
  'Payment Portal',
  'Customer Portal',
  'Booking Widget',
  'Financing Application',
  'Terms/Privacy',
  'Documentation',
  'Other'
];

/**
 * ============================================================================
 * GET /api/company/:companyId/links
 * ============================================================================
 * Get all links for this company
 * 
 * Query params:
 * - type: string (filter by link type)
 * - visibleToAgent: boolean (filter by visibility)
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { type, visibleToAgent } = req.query;

    const company = await V2Company.findById(companyId).lean();

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Get links or empty array
    let links = company.links || [];

    // Apply filters
    if (type) {
      links = links.filter(link => link.type === type);
    }

    if (visibleToAgent !== undefined) {
      const visible = visibleToAgent === 'true';
      links = links.filter(link => link.visibleToAgent === visible);
    }

    res.json({
      ok: true,
      data: {
        links,
        validTypes: VALID_LINK_TYPES
      }
    });

  } catch (error) {
    logger.error('[Cheat Sheet Links] GET failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch links'
    });
  }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/links
 * ============================================================================
 * Create a new link
 * 
 * Body:
 * - key: string (machine name, unique per company)
 * - label: string (required)
 * - url: string (required, valid URL)
 * - type: string (required, one of VALID_LINK_TYPES)
 * - description: string
 * - visibleToAgent: boolean (default true)
 */
router.post('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { key, label, url, type, description, visibleToAgent } = req.body;

    // Validation
    if (!label || !label.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Label is required'
      });
    }

    if (!url || !url.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'URL is required'
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (urlError) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid URL format'
      });
    }

    if (!type || !VALID_LINK_TYPES.includes(type)) {
      return res.status(400).json({
        ok: false,
        error: `Type must be one of: ${VALID_LINK_TYPES.join(', ')}`
      });
    }

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Initialize links array if doesn't exist
    if (!company.links) {
      company.links = [];
    }

    // Generate key if not provided
    const linkKey = key?.trim() || label.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // Check for duplicate key
    const existingLinkWithKey = company.links.find(link => link.key === linkKey);
    if (existingLinkWithKey) {
      return res.status(409).json({
        ok: false,
        error: `A link with key "${linkKey}" already exists`
      });
    }

    // Create new link
    const newLink = {
      _id: new mongoose.Types.ObjectId(),
      key: linkKey,
      label: label.trim(),
      url: url.trim(),
      type,
      description: description?.trim() || '',
      visibleToAgent: visibleToAgent !== false // default true
    };

    company.links.push(newLink);
    company.markModified('links');
    await company.save();

    logger.info('[Cheat Sheet Links] Link created', {
      companyId,
      linkKey,
      type
    });

    // Clear Redis cache
    try {
      const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
      if (isRedisConfigured()) {
        const redisClient = getSharedRedisClient();
        await redisClient.del(`company:${companyId}`);
      }
      logger.info('[Cheat Sheet Links] Redis cache cleared', { companyId });
    } catch (redisError) {
      logger.warn('[Cheat Sheet Links] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.status(201).json({
      ok: true,
      message: 'Link created successfully',
      data: newLink
    });

  } catch (error) {
    logger.error('[Cheat Sheet Links] POST failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to create link'
    });
  }
});

/**
 * ============================================================================
 * PUT /api/company/:companyId/links/:linkId
 * ============================================================================
 * Update an existing link
 */
router.put('/:linkId', async (req, res) => {
  try {
    const { companyId, linkId } = req.params;
    const { key, label, url, type, description, visibleToAgent } = req.body;

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    if (!company.links || company.links.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No links found for this company'
      });
    }

    // Find link
    const linkIndex = company.links.findIndex(link => link._id.toString() === linkId);

    if (linkIndex === -1) {
      return res.status(404).json({
        ok: false,
        error: 'Link not found'
      });
    }

    // Validate URL if provided
    if (url) {
      try {
        new URL(url);
      } catch (urlError) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid URL format'
        });
      }
    }

    // Validate type if provided
    if (type && !VALID_LINK_TYPES.includes(type)) {
      return res.status(400).json({
        ok: false,
        error: `Type must be one of: ${VALID_LINK_TYPES.join(', ')}`
      });
    }

    // Check for duplicate key (if key is being changed)
    if (key && key !== company.links[linkIndex].key) {
      const existingLinkWithKey = company.links.find(
        (link, idx) => idx !== linkIndex && link.key === key
      );
      
      if (existingLinkWithKey) {
        return res.status(409).json({
          ok: false,
          error: `A link with key "${key}" already exists`
        });
      }
    }

    // Update link
    if (key !== undefined) company.links[linkIndex].key = key.trim();
    if (label !== undefined) company.links[linkIndex].label = label.trim();
    if (url !== undefined) company.links[linkIndex].url = url.trim();
    if (type !== undefined) company.links[linkIndex].type = type;
    if (description !== undefined) company.links[linkIndex].description = description.trim();
    if (visibleToAgent !== undefined) company.links[linkIndex].visibleToAgent = visibleToAgent;

    company.markModified('links');
    await company.save();

    logger.info('[Cheat Sheet Links] Link updated', {
      companyId,
      linkId,
      key: company.links[linkIndex].key
    });

    // Clear Redis cache
    try {
      const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
      if (isRedisConfigured()) {
        const redisClient = getSharedRedisClient();
        await redisClient.del(`company:${companyId}`);
      }
    } catch (redisError) {
      logger.warn('[Cheat Sheet Links] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'Link updated successfully',
      data: company.links[linkIndex]
    });

  } catch (error) {
    logger.error('[Cheat Sheet Links] PUT failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      linkId: req.params.linkId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update link'
    });
  }
});

/**
 * ============================================================================
 * DELETE /api/company/:companyId/links/:linkId
 * ============================================================================
 * Delete a link
 */
router.delete('/:linkId', async (req, res) => {
  try {
    const { companyId, linkId } = req.params;

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    if (!company.links || company.links.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No links found for this company'
      });
    }

    // Find and remove link
    const linkIndex = company.links.findIndex(link => link._id.toString() === linkId);

    if (linkIndex === -1) {
      return res.status(404).json({
        ok: false,
        error: 'Link not found'
      });
    }

    const deletedLink = company.links[linkIndex];
    company.links.splice(linkIndex, 1);
    
    company.markModified('links');
    await company.save();

    logger.info('[Cheat Sheet Links] Link deleted', {
      companyId,
      linkId,
      key: deletedLink.key
    });

    // Clear Redis cache
    try {
      const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
      if (isRedisConfigured()) {
        const redisClient = getSharedRedisClient();
        await redisClient.del(`company:${companyId}`);
      }
    } catch (redisError) {
      logger.warn('[Cheat Sheet Links] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'Link deleted successfully'
    });

  } catch (error) {
    logger.error('[Cheat Sheet Links] DELETE failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      linkId: req.params.linkId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to delete link'
    });
  }
});

module.exports = router;

