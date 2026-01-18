/**
 * ============================================================================
 * CHEATSHEET VERSION API ROUTES
 * ============================================================================
 * 
 * REST API for CheatSheet version management.
 * All routes protected by authentication middleware.
 * All inputs validated by Joi schemas.
 * 
 * BASE PATH: /api/cheatsheet
 * 
 * ROUTES:
 * - GET    /status/:companyId              - Get live + draft status
 * - POST   /draft/:companyId               - Create draft
 * - PATCH  /draft/:companyId/:versionId    - Save draft
 * - DELETE /draft/:companyId/:versionId    - Discard draft
 * - POST   /draft/:companyId/:versionId/push-live - Push draft live
 * - GET    /versions/:companyId            - Get version history
 * - GET    /versions/:companyId/:versionId - Get specific version
 * - POST   /versions/:companyId/:versionId/restore - Restore version
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { CheatSheetVersionService } = require('../../services/cheatsheet');
const {
  validate,
  createDraftSchema,
  saveDraftSchema,
  pushLiveSchema,
  restoreVersionSchema,
  getVersionHistorySchema
} = require('../../validators/cheatsheet');
const { authenticateJWT: authMiddleware } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const VariableSyncService = require('../../services/VariableSyncService');

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Extract request metadata (IP, User Agent, etc.)
 * Used for audit logging
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
// ROUTES
// ============================================================================

/**
 * GET /api/cheatsheet/status/:companyId
 * Get live and draft status
 */
router.get('/status/:companyId', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const status = await CheatSheetVersionService.getStatus(companyId);
    
    res.json({
      success: true,
      data: status
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_API_STATUS_ERROR', {
      companyId: req.params.companyId,
      error: err.message,
      stack: err.stack
    });
    
    res.status(err.code === 'NO_LIVE_CONFIG' ? 404 : 500).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * POST /api/cheatsheet/draft/:companyId
 * Create new draft
 */
router.post(
  '/draft/:companyId',
  authMiddleware,
  validate('body', createDraftSchema),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { name, baseVersionId, notes } = req.body;
      const userEmail = getUserEmail(req);
      const metadata = extractMetadata(req);
      
      const draft = await CheatSheetVersionService.createDraft(
        companyId,
        name,
        userEmail,
        baseVersionId,
        metadata
      );
      
      res.status(201).json({
        success: true,
        message: 'Draft created successfully',
        data: draft
      });
      
    } catch (err) {
      logger.error('CHEATSHEET_API_CREATE_DRAFT_ERROR', {
        companyId: req.params.companyId,
        error: err.message
      });
      
      const statusCode = err.code === 'DRAFT_ALREADY_EXISTS' ? 409 : 
                        err.code === 'VERSION_NOT_FOUND' ? 404 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: err.code || 'INTERNAL_ERROR',
        message: err.message,
        details: err.details || {}
      });
    }
  }
);

/**
 * PATCH /api/cheatsheet/draft/:companyId/:versionId
 * Save draft
 */
router.patch(
  '/draft/:companyId/:versionId',
  authMiddleware,
  validate('body', saveDraftSchema),
  async (req, res) => {
    try {
      const { companyId, versionId } = req.params;
      const { config, expectedVersion } = req.body;
      const userEmail = getUserEmail(req);
      const metadata = extractMetadata(req);
      
      const draft = await CheatSheetVersionService.saveDraft(
        companyId,
        versionId,
        config,
        userEmail,
        expectedVersion,
        metadata
      );
      
      // ═══════════════════════════════════════════════════════════════════════
      // AUTO-SYNC VARIABLES: Extract {variables} from saved config
      // Non-blocking - runs in background after response sent
      // ═══════════════════════════════════════════════════════════════════════
      logger.info(`🔄 [VARIABLE SYNC] Starting sync for draft save...`);
      logger.info(`🔄 [VARIABLE SYNC] Config keys: ${Object.keys(config || {}).join(', ')}`);
      logger.info(`🔄 [VARIABLE SYNC] frontlineIntel type: ${typeof config?.frontlineIntel}`);
      logger.info(`🔄 [VARIABLE SYNC] frontlineIntel preview: ${JSON.stringify(config?.frontlineIntel)?.substring(0, 200)}`);
      
      VariableSyncService.syncFromCheatSheet(companyId, config)
        .then(syncResult => {
          logger.info(`🔄 [VARIABLE SYNC] Sync complete:`, {
            synced: syncResult.synced,
            added: syncResult.added,
            variables: syncResult.variables,
            error: syncResult.error
          });
        })
        .catch(syncErr => {
          logger.error(`🔄 [VARIABLE SYNC] Background sync FAILED:`, {
            error: syncErr.message,
            stack: syncErr.stack
          });
        });
      
      res.json({
        success: true,
        message: 'Draft saved successfully',
        data: {
          versionId: draft.versionId,
          checksum: draft.checksum,
          version: draft.__v,
          updatedAt: draft.updatedAt
        }
      });
      
    } catch (err) {
      logger.error('CHEATSHEET_API_SAVE_DRAFT_ERROR', {
        companyId: req.params.companyId,
        versionId: req.params.versionId,
        error: err.message
      });
      
      const statusCode = err.code === 'DRAFT_NOT_FOUND' ? 404 : 
                        err.code === 'DRAFT_VERSION_CONFLICT' ? 409 :
                        err.code === 'CONFIG_TOO_LARGE' ? 413 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: err.code || 'INTERNAL_ERROR',
        message: err.message,
        details: err.details || {}
      });
    }
  }
);

/**
 * DELETE /api/cheatsheet/draft/:companyId/:versionId
 * Discard draft
 */
router.delete('/draft/:companyId/:versionId', authMiddleware, async (req, res) => {
  try {
    const { companyId, versionId } = req.params;
    const userEmail = getUserEmail(req);
    const metadata = extractMetadata(req);
    
    await CheatSheetVersionService.discardDraft(
      companyId,
      versionId,
      userEmail,
      metadata
    );
    
    res.json({
      success: true,
      message: 'Draft discarded successfully'
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_API_DISCARD_DRAFT_ERROR', {
      companyId: req.params.companyId,
      versionId: req.params.versionId,
      error: err.message
    });
    
    const statusCode = err.code === 'DRAFT_NOT_FOUND' ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * DELETE /api/cheatsheet/versions/:companyId/:versionId
 * Delete any version (draft or archived) by versionId
 * UI uses this for "Delete" button in Version History
 */
router.delete('/versions/:companyId/:versionId', authMiddleware, async (req, res) => {
  try {
    const { companyId, versionId } = req.params;
    const userEmail = getUserEmail(req);
    const metadata = extractMetadata(req);
    
    await CheatSheetVersionService.deleteVersion(
      companyId,
      versionId,
      userEmail,
      metadata
    );
    
    res.json({
      success: true,
      message: 'Version deleted successfully'
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_API_DELETE_VERSION_ERROR', {
      companyId: req.params.companyId,
      versionId: req.params.versionId,
      error: err.message
    });
    
    const statusCode = err.code === 'DRAFT_NOT_FOUND' || err.code === 'CANNOT_DELETE_LIVE' ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * POST /api/cheatsheet/draft/:companyId/:versionId/push-live
 * Push draft to live (atomic transaction)
 */
router.post(
  '/draft/:companyId/:versionId/push-live',
  authMiddleware,
  validate('body', pushLiveSchema),
  async (req, res) => {
    try {
      const { companyId, versionId } = req.params;
      const userEmail = getUserEmail(req);
      const metadata = extractMetadata(req);
      
      const newLive = await CheatSheetVersionService.pushDraftLive(
        companyId,
        versionId,
        userEmail,
        metadata
      );
      
      // Invalidate cache (import at top of file)
      const { CheatSheetRuntimeService } = require('../../services/cheatsheet');
      await CheatSheetRuntimeService.invalidateCache(companyId);
      
      // ═══════════════════════════════════════════════════════════════════════
      // AUTO-SYNC VARIABLES: Sync variables when pushing to live
      // ═══════════════════════════════════════════════════════════════════════
      if (newLive.config) {
        VariableSyncService.syncFromCheatSheet(companyId, newLive.config)
          .then(syncResult => {
            if (syncResult.added > 0) {
              logger.info(`🔄 [VARIABLE SYNC] Auto-synced ${syncResult.added} new variables on push-live`);
            }
          })
          .catch(syncErr => {
            logger.warn(`🔄 [VARIABLE SYNC] Background sync failed (non-critical): ${syncErr.message}`);
          });
      }
      
      res.json({
        success: true,
        message: 'Draft pushed to live successfully',
        data: {
          versionId: newLive.versionId,
          name: newLive.name,
          activatedAt: newLive.activatedAt,
          checksum: newLive.checksum
        }
      });
      
    } catch (err) {
      logger.error('CHEATSHEET_API_PUSH_LIVE_ERROR', {
        companyId: req.params.companyId,
        versionId: req.params.versionId,
        error: err.message,
        stack: err.stack
      });
      
      const statusCode = err.code === 'DRAFT_NOT_FOUND' ? 404 :
                        err.code === 'TRANSACTION_FAILED' ? 500 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: err.code || 'INTERNAL_ERROR',
        message: err.message,
        details: err.details || {}
      });
    }
  }
);

/**
 * POST /api/cheatsheet/versions/:companyId/:versionId/publish
 * Alias for push-live - makes version the new live config
 * Returns liveVersionId + all versions for Version Console
 */
router.post(
  '/versions/:companyId/:versionId/publish',
  authMiddleware,
  validate('body', pushLiveSchema),
  async (req, res) => {
    try {
      const { companyId, versionId } = req.params;
      const userEmail = getUserEmail(req);
      const metadata = extractMetadata(req);
      
      const newLive = await CheatSheetVersionService.pushDraftLive(
        companyId,
        versionId,
        userEmail,
        metadata
      );
      
      // Invalidate cache
      const { CheatSheetRuntimeService } = require('../../services/cheatsheet');
      await CheatSheetRuntimeService.invalidateCache(companyId);
      
      // Fetch all versions to return updated list
      const allVersions = await CheatSheetVersionService.getVersionHistory(companyId, 100);
      
      res.json({
        success: true,
        message: 'Version published successfully',
        data: {
          liveVersionId: newLive.versionId,
          versions: allVersions
        }
      });
      
    } catch (err) {
      logger.error('CHEATSHEET_API_PUBLISH_ERROR', {
        companyId: req.params.companyId,
        versionId: req.params.versionId,
        error: err.message
      });
      
      const statusCode = err.code === 'DRAFT_NOT_FOUND' ? 404 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: err.code || 'INTERNAL_ERROR',
        message: err.message
      });
    }
  }
);

/**
 * GET /api/cheatsheet/versions/:companyId
 * Get version history
 */
router.get(
  '/versions/:companyId',
  authMiddleware,
  validate('query', getVersionHistorySchema),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { limit } = req.query;
      
      const history = await CheatSheetVersionService.getVersionHistory(
        companyId,
        limit
      );
      
      res.json({
        success: true,
        data: {
          versions: history,
          count: history.length
        }
      });
      
    } catch (err) {
      logger.error('CHEATSHEET_API_GET_HISTORY_ERROR', {
        companyId: req.params.companyId,
        error: err.message
      });
      
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: err.message
      });
    }
  }
);

/**
 * GET /api/cheatsheet/versions/:companyId/:versionId
 * Get specific version
 */
router.get('/versions/:companyId/:versionId', authMiddleware, async (req, res) => {
  try {
    const { companyId, versionId } = req.params;
    const includeConfig = req.query.includeConfig === 'true';
    
    const version = await CheatSheetVersionService.getVersion(
      companyId,
      versionId,
      includeConfig
    );
    
    res.json({
      success: true,
      data: version
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_API_GET_VERSION_ERROR', {
      companyId: req.params.companyId,
      versionId: req.params.versionId,
      error: err.message
    });
    
    const statusCode = err.code === 'VERSION_NOT_FOUND' ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * POST /api/cheatsheet/versions/:companyId/:versionId/restore
 * Restore archived version (creates new draft)
 */
router.post(
  '/versions/:companyId/:versionId/restore',
  authMiddleware,
  validate('body', restoreVersionSchema),
  async (req, res) => {
    try {
      const { companyId, versionId } = req.params;
      const { name, notes } = req.body;
      const userEmail = getUserEmail(req);
      const metadata = extractMetadata(req);
      
      const draft = await CheatSheetVersionService.restoreVersion(
        companyId,
        versionId,
        name,
        userEmail,
        metadata
      );
      
      res.status(201).json({
        success: true,
        message: 'Version restored as new draft',
        data: draft
      });
      
    } catch (err) {
      logger.error('CHEATSHEET_API_RESTORE_VERSION_ERROR', {
        companyId: req.params.companyId,
        versionId: req.params.versionId,
        error: err.message
      });
      
      const statusCode = err.code === 'VERSION_NOT_FOUND' ? 404 :
                        err.code === 'DRAFT_ALREADY_EXISTS' ? 409 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: err.code || 'INTERNAL_ERROR',
        message: err.message,
        details: err.details || {}
      });
    }
  }
);

// ============================================================================
// LIVE CONFIG ENDPOINTS (for Call Protection UI)
// ============================================================================

/**
 * GET /api/cheatsheet/:companyId/live
 * Get the live config (used by Call Protection Manager)
 */
router.get('/:companyId/live', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const { CheatSheetRuntimeService } = require('../../services/cheatsheet');
    const liveConfig = await CheatSheetRuntimeService.getLiveConfig(companyId);
    
    if (!liveConfig) {
      return res.status(404).json({
        success: false,
        error: 'NO_LIVE_CONFIG',
        message: 'No live configuration found for this company'
      });
    }
    
    res.json({
      success: true,
      ...liveConfig
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_API_GET_LIVE_ERROR', {
      companyId: req.params.companyId,
      error: err.message
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * PUT /api/cheatsheet/:companyId/edge-cases
 * Update edge cases directly (for Call Protection Manager)
 * Creates a new version with updated edge cases and pushes to live
 */
router.put('/:companyId/edge-cases', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { edgeCases } = req.body;
    const userEmail = getUserEmail(req);
    const metadata = extractMetadata(req);
    
    if (!Array.isArray(edgeCases)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'edgeCases must be an array'
      });
    }
    
    logger.info('[CALL PROTECTION API] Updating edge cases', {
      companyId,
      edgeCaseCount: edgeCases.length,
      userEmail
    });
    
    // Get current live config
    const { CheatSheetRuntimeService } = require('../../services/cheatsheet');
    let currentConfig = {};
    
    try {
      const liveConfig = await CheatSheetRuntimeService.getLiveConfig(companyId);
      if (liveConfig?.config) {
        currentConfig = liveConfig.config;
      }
    } catch (err) {
      // No live config yet, start fresh
      logger.info('[CALL PROTECTION API] No existing config, starting fresh');
    }
    
    // Update edge cases in config
    const updatedConfig = {
      ...currentConfig,
      edgeCases: edgeCases
    };
    
    // Create a draft with the updated config
    const draftName = `Call Protection Update - ${new Date().toLocaleDateString()}`;
    
    // Check if draft already exists, if so update it
    const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');
    let draft = await CheatSheetVersion.findOne({ 
      companyId, 
      status: 'draft' 
    });
    
    if (draft) {
      // Update existing draft
      draft.config = updatedConfig;
      draft.updatedBy = userEmail;
      draft.updatedAt = new Date();
      await draft.save();
      logger.info('[CALL PROTECTION API] Updated existing draft', { versionId: draft.versionId });
    } else {
      // Create new draft
      draft = await CheatSheetVersionService.createDraft(
        companyId,
        draftName,
        userEmail,
        null, // No base version
        metadata
      );
      
      // Update the draft with our config
      await CheatSheetVersionService.saveDraft(
        companyId,
        draft.versionId,
        updatedConfig,
        userEmail,
        draft.__v,
        metadata
      );
      logger.info('[CALL PROTECTION API] Created new draft', { versionId: draft.versionId });
    }
    
    // Push to live immediately
    const liveVersion = await CheatSheetVersionService.pushDraftLive(
      companyId,
      draft.versionId,
      userEmail,
      metadata
    );
    
    // Invalidate cache
    await CheatSheetRuntimeService.invalidateCache(companyId);
    
    logger.info('[CALL PROTECTION API] Edge cases updated and pushed to live', {
      companyId,
      edgeCaseCount: edgeCases.length,
      versionId: liveVersion.versionId
    });
    
    res.json({
      success: true,
      message: 'Edge cases updated successfully',
      data: {
        versionId: liveVersion.versionId,
        edgeCaseCount: edgeCases.length,
        activatedAt: liveVersion.activatedAt
      }
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_API_UPDATE_EDGE_CASES_ERROR', {
      companyId: req.params.companyId,
      error: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * PUT /api/cheatsheet/:companyId/company-contacts
 * Update company contacts directly (for Transfer Directory Manager)
 */
router.put('/:companyId/company-contacts', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { companyContacts } = req.body;
    const userEmail = getUserEmail(req);
    const metadata = extractMetadata(req);
    
    if (!Array.isArray(companyContacts)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'companyContacts must be an array'
      });
    }
    
    logger.info('[TRANSFER DIRECTORY API] Updating company contacts', {
      companyId,
      contactCount: companyContacts.length,
      userEmail
    });
    
    // Get current live config
    const { CheatSheetRuntimeService } = require('../../services/cheatsheet');
    let currentConfig = {};
    
    try {
      const liveConfig = await CheatSheetRuntimeService.getLiveConfig(companyId);
      if (liveConfig?.config) {
        currentConfig = liveConfig.config;
      }
    } catch (err) {
      logger.info('[TRANSFER DIRECTORY API] No existing config, starting fresh');
    }
    
    // Update company contacts in config
    const updatedConfig = {
      ...currentConfig,
      companyContacts: companyContacts
    };
    
    // Create/update draft and push to live
    const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');
    let draft = await CheatSheetVersion.findOne({ companyId, status: 'draft' });
    const draftName = `Contact Directory Update - ${new Date().toLocaleDateString()}`;
    
    if (draft) {
      draft.config = updatedConfig;
      draft.updatedBy = userEmail;
      draft.updatedAt = new Date();
      await draft.save();
    } else {
      draft = await CheatSheetVersionService.createDraft(companyId, draftName, userEmail, null, metadata);
      await CheatSheetVersionService.saveDraft(companyId, draft.versionId, updatedConfig, userEmail, draft.__v, metadata);
    }
    
    // Push to live
    const liveVersion = await CheatSheetVersionService.pushDraftLive(companyId, draft.versionId, userEmail, metadata);
    await CheatSheetRuntimeService.invalidateCache(companyId);
    
    logger.info('[TRANSFER DIRECTORY API] Contacts updated and pushed to live', {
      companyId,
      contactCount: companyContacts.length,
      versionId: liveVersion.versionId
    });
    
    res.json({
      success: true,
      message: 'Company contacts updated successfully',
      data: {
        versionId: liveVersion.versionId,
        contactCount: companyContacts.length,
        activatedAt: liveVersion.activatedAt
      }
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_API_UPDATE_CONTACTS_ERROR', {
      companyId: req.params.companyId,
      error: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * PUT /api/cheatsheet/:companyId/transfer-rules
 * Update transfer rules directly (for Transfer Directory Manager)
 */
router.put('/:companyId/transfer-rules', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { transferRules } = req.body;
    const userEmail = getUserEmail(req);
    const metadata = extractMetadata(req);
    
    if (!Array.isArray(transferRules)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'transferRules must be an array'
      });
    }
    
    logger.info('[TRANSFER DIRECTORY API] Updating transfer rules', {
      companyId,
      ruleCount: transferRules.length,
      userEmail
    });
    
    // Get current live config
    const { CheatSheetRuntimeService } = require('../../services/cheatsheet');
    let currentConfig = {};
    
    try {
      const liveConfig = await CheatSheetRuntimeService.getLiveConfig(companyId);
      if (liveConfig?.config) {
        currentConfig = liveConfig.config;
      }
    } catch (err) {
      logger.info('[TRANSFER DIRECTORY API] No existing config, starting fresh');
    }
    
    // Update transfer rules in config
    const updatedConfig = {
      ...currentConfig,
      transferRules: transferRules
    };
    
    // Create/update draft and push to live
    const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');
    let draft = await CheatSheetVersion.findOne({ companyId, status: 'draft' });
    const draftName = `Transfer Rules Update - ${new Date().toLocaleDateString()}`;
    
    if (draft) {
      draft.config = updatedConfig;
      draft.updatedBy = userEmail;
      draft.updatedAt = new Date();
      await draft.save();
    } else {
      draft = await CheatSheetVersionService.createDraft(companyId, draftName, userEmail, null, metadata);
      await CheatSheetVersionService.saveDraft(companyId, draft.versionId, updatedConfig, userEmail, draft.__v, metadata);
    }
    
    // Push to live
    const liveVersion = await CheatSheetVersionService.pushDraftLive(companyId, draft.versionId, userEmail, metadata);
    await CheatSheetRuntimeService.invalidateCache(companyId);
    
    logger.info('[TRANSFER DIRECTORY API] Transfer rules updated and pushed to live', {
      companyId,
      ruleCount: transferRules.length,
      versionId: liveVersion.versionId
    });
    
    res.json({
      success: true,
      message: 'Transfer rules updated successfully',
      data: {
        versionId: liveVersion.versionId,
        ruleCount: transferRules.length,
        activatedAt: liveVersion.activatedAt
      }
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_API_UPDATE_TRANSFER_RULES_ERROR', {
      companyId: req.params.companyId,
      error: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

// ============================================================================
// ERROR HANDLER (Catch-all)
// ============================================================================

router.use((err, req, res, next) => {
  logger.error('CHEATSHEET_API_UNHANDLED_ERROR', {
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
// EXPORT ROUTER
// ============================================================================

module.exports = router;

