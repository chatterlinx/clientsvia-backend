/**
 * ============================================================================
 * GLOBAL CONFIG ROUTES
 * ============================================================================
 * 
 * API routes for sharing and importing CheatSheet configurations globally.
 * Enables companies to share their configs and import from others.
 * 
 * SCOPE:
 * - Version History → Global Configurations feature only
 * - Does NOT affect agent runtime
 * - Admin-only access
 * 
 * ROUTES:
 * - POST /api/global-config/categories           - Create category
 * - GET  /api/global-config/categories           - List all categories
 * - POST /api/global-config/share                - Share local config to global
 * - GET  /api/global-config?categoryId=X         - List global configs by category
 * - POST /api/global-config/import               - Import global config as draft
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const GlobalCategory = require('../models/GlobalCategory');
const GlobalConfigReference = require('../models/GlobalConfigReference');
const CheatSheetVersion = require('../models/cheatsheet/CheatSheetVersion');
const Company = require('../models/v2Company');
const { authenticateJWT: authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Extract request metadata for audit logging
 */
function extractMetadata(req) {
  return {
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'] || 'Unknown'
  };
}

/**
 * Extract user email from authenticated request
 */
function getUserEmail(req) {
  return req.user?.email || req.user?.username || 'System';
}

// ============================================================================
// CATEGORY ROUTES
// ============================================================================

/**
 * POST /api/global-config/categories
 * Create a new global category
 */
router.post('/categories', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'Category name is required and must be a non-empty string'
      });
    }
    
    // Check if category already exists
    const existing = await GlobalCategory.findOne({ name: name.trim() });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'CATEGORY_EXISTS',
        message: `Category "${name.trim()}" already exists`
      });
    }
    
    // Create category
    const category = await GlobalCategory.create({
      name: name.trim()
    });
    
    logger.info('GLOBAL_CATEGORY_CREATED', {
      categoryId: category._id,
      name: category.name,
      createdBy: getUserEmail(req)
    });
    
    res.status(201).json({
      success: true,
      data: category.getSummary()
    });
    
  } catch (err) {
    logger.error('GLOBAL_CATEGORY_CREATE_ERROR', {
      error: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to create category'
    });
  }
});

/**
 * GET /api/global-config/categories
 * List all categories (sorted alphabetically)
 */
router.get('/categories', authMiddleware, async (req, res) => {
  try {
    const categories = await GlobalCategory
      .find({})
      .sort({ name: 1 })
      .select('_id name')
      .lean();
    
    res.json({
      success: true,
      data: categories
    });
    
  } catch (err) {
    logger.error('GLOBAL_CATEGORY_LIST_ERROR', {
      error: err.message
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch categories'
    });
  }
});

// ============================================================================
// SHARING ROUTES
// ============================================================================

/**
 * POST /api/global-config/share
 * Share company's live CheatSheet config to global library
 */
router.post('/share', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.body;
    
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'companyId is required'
      });
    }
    
    // Validate company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'COMPANY_NOT_FOUND',
        message: 'Company not found'
      });
    }
    
    // Ensure company has a category assigned
    if (!company.cheatSheetCategoryId) {
      return res.status(400).json({
        success: false,
        error: 'CATEGORY_NOT_SET',
        message: 'Category must be set before sharing to global. Please select a category first.'
      });
    }
    
    // Find current LIVE CheatSheetVersion for this company
    const liveVersion = await CheatSheetVersion.findOne({
      companyId,
      status: 'live'
    });
    
    if (!liveVersion) {
      return res.status(400).json({
        success: false,
        error: 'NO_LIVE_VERSION',
        message: 'No live CheatSheet version found. Please push a draft to live first.'
      });
    }
    
    // Upsert GlobalConfigReference (update if exists, create if not)
    const reference = await GlobalConfigReference.findOneAndUpdate(
      { companyId },
      {
        categoryId: company.cheatSheetCategoryId,
        cheatSheetVersionId: liveVersion._id
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );
    
    logger.info('GLOBAL_CONFIG_SHARED', {
      companyId,
      categoryId: company.cheatSheetCategoryId,
      cheatSheetVersionId: liveVersion._id,
      sharedBy: getUserEmail(req)
    });
    
    res.json({
      success: true,
      data: {
        companyId: reference.companyId,
        cheatSheetVersionId: reference.cheatSheetVersionId,
        categoryId: reference.categoryId
      }
    });
    
  } catch (err) {
    logger.error('GLOBAL_CONFIG_SHARE_ERROR', {
      companyId: req.body.companyId,
      error: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to share configuration'
    });
  }
});

// ============================================================================
// LISTING ROUTES
// ============================================================================

/**
 * GET /api/global-config?categoryId=<id>
 * List all global configs for a specific category
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { categoryId } = req.query;
    
    if (!categoryId) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'categoryId query parameter is required'
      });
    }
    
    // Find all references for this category
    const references = await GlobalConfigReference
      .find({ categoryId })
      .populate('companyId', 'companyName name')
      .populate('cheatSheetVersionId', 'name versionId updatedAt')
      .lean();
    
    // Format response
    const data = references.map(ref => ({
      globalConfigId: ref._id,
      companyId: ref.companyId._id,
      companyName: ref.companyId.companyName || ref.companyId.name || 'Unnamed Company',
      cheatSheetVersionId: ref.cheatSheetVersionId._id,
      configName: ref.cheatSheetVersionId.name || 'Unnamed Configuration',
      updatedAt: ref.updatedAt
    }));
    
    res.json({
      success: true,
      data
    });
    
  } catch (err) {
    logger.error('GLOBAL_CONFIG_LIST_ERROR', {
      categoryId: req.query.categoryId,
      error: err.message
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch global configurations'
    });
  }
});

// ============================================================================
// IMPORT ROUTES
// ============================================================================

/**
 * POST /api/global-config/import
 * Import a global config into target company as a new draft
 */
router.post('/import', authMiddleware, async (req, res) => {
  try {
    const { targetCompanyId, globalConfigId } = req.body;
    
    if (!targetCompanyId || !globalConfigId) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'targetCompanyId and globalConfigId are required'
      });
    }
    
    // Validate target company exists
    const targetCompany = await Company.findById(targetCompanyId);
    if (!targetCompany) {
      return res.status(404).json({
        success: false,
        error: 'COMPANY_NOT_FOUND',
        message: 'Target company not found'
      });
    }
    
    // Load GlobalConfigReference
    const reference = await GlobalConfigReference.findById(globalConfigId);
    if (!reference) {
      return res.status(404).json({
        success: false,
        error: 'GLOBAL_CONFIG_NOT_FOUND',
        message: 'Global configuration reference not found'
      });
    }
    
    // Load source CheatSheetVersion
    const sourceVersion = await CheatSheetVersion.findById(reference.cheatSheetVersionId);
    if (!sourceVersion) {
      return res.status(404).json({
        success: false,
        error: 'SOURCE_VERSION_NOT_FOUND',
        message: 'Source configuration version not found'
      });
    }
    
    // Check if target company already has a draft
    const existingDraft = await CheatSheetVersion.findOne({
      companyId: targetCompanyId,
      status: 'draft'
    });
    
    if (existingDraft) {
      return res.status(409).json({
        success: false,
        error: 'DRAFT_EXISTS',
        message: 'Target company already has a draft. Please push or discard it first.'
      });
    }
    
    // Create new draft for target company (copy config from source)
    const newDraft = await CheatSheetVersion.create({
      companyId: targetCompanyId,
      status: 'draft',
      versionId: `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `Imported from ${sourceVersion.name || 'Global Config'}`,
      notes: `Imported from global configuration (Company ID: ${reference.companyId})`,
      createdBy: getUserEmail(req),
      config: sourceVersion.config.toObject(), // Deep copy config
      checksum: sourceVersion.checksum
    });
    
    logger.info('GLOBAL_CONFIG_IMPORTED', {
      targetCompanyId,
      globalConfigId,
      sourceVersionId: sourceVersion._id,
      newDraftId: newDraft._id,
      importedBy: getUserEmail(req)
    });
    
    res.status(201).json({
      success: true,
      data: {
        companyId: targetCompanyId,
        cheatSheetVersionId: newDraft._id
      }
    });
    
  } catch (err) {
    logger.error('GLOBAL_CONFIG_IMPORT_ERROR', {
      targetCompanyId: req.body.targetCompanyId,
      globalConfigId: req.body.globalConfigId,
      error: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to import configuration'
    });
  }
});

// ============================================================================
// ERROR HANDLER (Catch-all)
// ============================================================================

router.use((err, req, res, next) => {
  logger.error('GLOBAL_CONFIG_UNHANDLED_ERROR', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack
  });
  
  res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred'
  });
});

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;

