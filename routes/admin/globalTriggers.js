/**
 * ============================================================================
 * GLOBAL TRIGGERS - Admin API Routes (Platform-Level Resources)
 * ============================================================================
 *
 * These routes manage platform-wide trigger groups and triggers.
 * CRITICAL: No companyId in paths - these are global resources.
 *
 * ACCESS CONTROL:
 * - All routes require authentication + specific global permissions
 * - Write operations require approval workflow
 * - Changes are audited immutably
 *
 * ENDPOINTS:
 * - GET    /trigger-groups                    - List all groups
 * - POST   /trigger-groups                    - Create new group
 * - GET    /trigger-groups/:groupId           - Get group details
 * - PATCH  /trigger-groups/:groupId           - Update group metadata
 * - DELETE /trigger-groups/:groupId           - Delete group (requires approval)
 * - POST   /trigger-groups/:groupId/publish   - Publish changes
 * - POST   /trigger-groups/:groupId/rollback  - Rollback to previous version
 *
 * - GET    /trigger-groups/:groupId/triggers          - List triggers in group
 * - POST   /trigger-groups/:groupId/triggers          - Add trigger to group
 * - GET    /trigger-groups/:groupId/triggers/:ruleId  - Get trigger details
 * - PATCH  /trigger-groups/:groupId/triggers/:ruleId  - Update trigger
 * - DELETE /trigger-groups/:groupId/triggers/:ruleId  - Delete trigger
 *
 * - GET    /trigger-groups/:groupId/audit-log         - View audit history
 * - GET    /trigger-groups/:groupId/duplicates        - Check for duplicates
 *
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const { PERMISSIONS } = require('../../middleware/rbac');

const GlobalTriggerGroup = require('../../models/GlobalTriggerGroup');
const GlobalTrigger = require('../../models/GlobalTrigger');
const CompanyTriggerSettings = require('../../models/CompanyTriggerSettings');
const TriggerAudio = require('../../models/TriggerAudio');

// ════════════════════════════════════════════════════════════════════════════════
// CANONICALIZATION RULES
// ════════════════════════════════════════════════════════════════════════════════
// All identifiers must be normalized at the API boundary to prevent semantic duplicates.
// ruleId: ^[a-z0-9]+(\.[a-z0-9_-]+)*$ (e.g., "pricing.freon", "hvac.thermostat_blank")
// groupId: ^[a-z0-9_-]+$ (e.g., "hvac", "dental-office")

const RULE_ID_REGEX = /^[a-z0-9]+(\.[a-z0-9_-]+)*$/;
const GROUP_ID_REGEX = /^[a-z0-9_-]+$/;

function normalizeRuleId(ruleId) {
  if (!ruleId || typeof ruleId !== 'string') {
    return null;
  }
  const normalized = ruleId.trim().toLowerCase();
  if (!RULE_ID_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeGroupId(groupId) {
  if (!groupId || typeof groupId !== 'string') {
    return null;
  }
  const normalized = groupId.trim().toLowerCase();
  if (!GROUP_ID_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

function validateRuleId(ruleId, fieldName = 'ruleId') {
  const normalized = normalizeRuleId(ruleId);
  if (!normalized) {
    return {
      valid: false,
      error: `Invalid ${fieldName}: must be lowercase alphanumeric with dots/underscores/hyphens (e.g., "pricing.freon", "hvac.thermostat_blank")`
    };
  }
  return { valid: true, normalized };
}

function validateGroupId(groupId, fieldName = 'groupId') {
  const normalized = normalizeGroupId(groupId);
  if (!normalized) {
    return {
      valid: false,
      error: `Invalid ${fieldName}: must be lowercase alphanumeric with underscores/hyphens (e.g., "hvac", "dental-office")`
    };
  }
  return { valid: true, normalized };
}

// ════════════════════════════════════════════════════════════════════════════════
// GLOBAL TRIGGER PERMISSIONS
// ════════════════════════════════════════════════════════════════════════════════
const GLOBAL_TRIGGER_PERMISSIONS = {
  READ: 'agent2.global.trigger.read',
  WRITE: 'agent2.global.trigger.write',
  PUBLISH: 'agent2.global.trigger.publish',
  DELETE: 'agent2.global.trigger.delete'
};

function requireGlobalTriggerPermission(permission) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Platform-level admins have full access
    // Note: This system uses 'admin' role for platform admins (not 'super_admin')
    const isPlatformAdmin = user.role === 'admin' || 
                            user.role === 'super_admin' || 
                            user.role === 'platform_admin' ||
                            user.isSuperAdmin === true ||
                            user.isPlatformAdmin === true;
    
    if (isPlatformAdmin) {
      return next();
    }

    const userPermissions = user.permissions || [];
    if (userPermissions.includes(permission) || userPermissions.includes('*')) {
      return next();
    }

    if (permission === GLOBAL_TRIGGER_PERMISSIONS.READ && 
        userPermissions.includes(PERMISSIONS.CONFIG_READ)) {
      return next();
    }

    logger.warn('[GlobalTriggers] Permission denied', {
      userId: user.id || user._id,
      role: user.role,
      required: permission,
      userPermissions
    });

    return res.status(403).json({ 
      success: false, 
      error: 'Insufficient permissions for global trigger operations' 
    });
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// APPROVAL VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

function validateApproval(req, action) {
  const { approvalText } = req.body;
  
  if (!approvalText || approvalText.toLowerCase().trim() !== 'approved') {
    return {
      valid: false,
      error: `Approval required for ${action}. Please type "approved" to confirm.`
    };
  }

  return { valid: true };
}

// ════════════════════════════════════════════════════════════════════════════════
// TRIGGER GROUP ROUTES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /trigger-groups
 * List all global trigger groups
 */
router.get('/trigger-groups',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const { includeInactive } = req.query;
      
      const query = includeInactive === 'true' ? {} : { isActive: true };
      
      const groups = await GlobalTriggerGroup.find(query)
        .select('groupId name icon description industry triggerCount companyCount version publishedVersion isDraft isActive createdAt')
        .sort({ companyCount: -1, name: 1 })
        .lean();

      return res.json({
        success: true,
        data: groups,
        total: groups.length
      });
    } catch (error) {
      logger.error('[GlobalTriggers] List groups error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /trigger-groups
 * Create a new global trigger group
 */
router.post('/trigger-groups',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.WRITE),
  async (req, res) => {
    try {
      const { groupId, name, icon, description, industry } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      if (!groupId || !name) {
        return res.status(400).json({ 
          success: false, 
          error: 'groupId and name are required' 
        });
      }

      const normalizedGroupId = groupId.toLowerCase().trim();

      if (!/^[a-z0-9_-]+$/.test(normalizedGroupId)) {
        return res.status(400).json({
          success: false,
          error: 'groupId must be lowercase alphanumeric with underscores/hyphens only'
        });
      }

      const exists = await GlobalTriggerGroup.groupIdExists(normalizedGroupId);
      if (exists) {
        return res.status(409).json({
          success: false,
          error: 'DUPLICATE_GROUP_ID',
          message: `Group "${normalizedGroupId}" already exists`
        });
      }

      const group = await GlobalTriggerGroup.create({
        groupId: normalizedGroupId,
        name: name.trim(),
        icon: icon || '📋',
        description: description || '',
        industry: industry || 'general',
        createdBy: userId,
        updatedBy: userId
      });

      group.addAuditEntry('GROUP_CREATED', userId, { name, icon, description, industry });
      await group.save();

      logger.info('[GlobalTriggers] Group created', {
        groupId: normalizedGroupId,
        createdBy: userId
      });

      return res.status(201).json({
        success: true,
        data: group
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          error: 'DUPLICATE_GROUP_ID',
          message: 'Group already exists (race condition caught)'
        });
      }
      logger.error('[GlobalTriggers] Create group error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /trigger-groups/:groupId
 * Get a specific global trigger group with its triggers
 */
router.get('/trigger-groups/:groupId',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { includeTriggers } = req.query;

      const group = await GlobalTriggerGroup.findByGroupId(groupId);
      
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      let triggers = [];
      if (includeTriggers === 'true') {
        triggers = await GlobalTrigger.findByGroupId(groupId);
      }

      const companies = await CompanyTriggerSettings.countCompaniesByGroup(groupId);

      return res.json({
        success: true,
        data: {
          ...group,
          companyCount: companies,
          triggers: includeTriggers === 'true' ? triggers : undefined
        }
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Get group error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * PATCH /trigger-groups/:groupId
 * Update group metadata
 */
router.patch('/trigger-groups/:groupId',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.WRITE),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { name, icon, description, industry } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      const group = await GlobalTriggerGroup.findOne({ groupId: groupId.toLowerCase() });
      
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      if (group.isLocked) {
        return res.status(423).json({
          success: false,
          error: 'Group is locked',
          lockedReason: group.lockedReason
        });
      }

      const updates = {};
      if (name !== undefined) {
        updates.name = name.trim();
      }
      if (icon !== undefined) {
        updates.icon = icon;
      }
      if (description !== undefined) {
        updates.description = description;
      }
      if (industry !== undefined) {
        updates.industry = industry.toLowerCase();
      }

      Object.assign(group, updates);
      group.incrementVersion(userId);
      group.addAuditEntry('GROUP_UPDATED', userId, { updates });
      
      await group.save();

      logger.info('[GlobalTriggers] Group updated', {
        groupId,
        updates: Object.keys(updates),
        updatedBy: userId
      });

      return res.json({
        success: true,
        data: group
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Update group error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * DELETE /trigger-groups/:groupId
 * Delete a group (requires approval)
 */
router.delete('/trigger-groups/:groupId',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.DELETE),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      const approval = validateApproval(req, 'group deletion');
      if (!approval.valid) {
        return res.status(400).json({
          success: false,
          error: approval.error,
          requiresApproval: true
        });
      }

      const group = await GlobalTriggerGroup.findOne({ groupId: groupId.toLowerCase() });
      
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      const companyCount = await CompanyTriggerSettings.countCompaniesByGroup(groupId);
      if (companyCount > 0) {
        return res.status(409).json({
          success: false,
          error: 'GROUP_IN_USE',
          message: `Cannot delete group: ${companyCount} companies are using it`,
          companyCount
        });
      }

      await GlobalTrigger.deleteMany({ groupId: groupId.toLowerCase() });

      await GlobalTriggerGroup.deleteOne({ groupId: groupId.toLowerCase() });

      logger.info('[GlobalTriggers] Group deleted', {
        groupId,
        triggersDeleted: group.triggerCount,
        deletedBy: userId
      });

      return res.json({
        success: true,
        message: `Group "${groupId}" deleted`
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Delete group error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /trigger-groups/:groupId/publish
 * Publish changes to production
 */
router.post('/trigger-groups/:groupId/publish',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.PUBLISH),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { changeLog } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      const approval = validateApproval(req, 'publishing');
      if (!approval.valid) {
        return res.status(400).json({
          success: false,
          error: approval.error,
          requiresApproval: true
        });
      }

      const group = await GlobalTriggerGroup.findOne({ groupId: groupId.toLowerCase() });
      
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      if (!group.isDraft && group.publishedVersion === group.version) {
        return res.status(400).json({
          success: false,
          error: 'No changes to publish'
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // DRAFT → PUBLISHED: Copy all draft triggers to published state
      // This is the REAL publish operation that prevents draft leakage
      // ═══════════════════════════════════════════════════════════════════════
      const publishResult = await GlobalTrigger.publishGroup(groupId.toLowerCase(), userId);

      if (publishResult.errors.length > 0) {
        logger.error('[GlobalTriggers] Publish had errors', {
          groupId,
          errors: publishResult.errors
        });
      }

      // Get draft triggers for snapshot (version history)
      const draftTriggers = await GlobalTrigger.findDraftsByGroupId(groupId.toLowerCase());

      const snapshot = {
        version: group.version,
        triggerCount: publishResult.publishedCount,
        publishedAt: new Date(),
        publishedBy: userId,
        changeLog: changeLog || '',
        triggersSnapshot: draftTriggers  // Store draft state at time of publish
      };

      group.versionHistory.push(snapshot);
      
      if (group.versionHistory.length > group.maxVersionHistorySize) {
        group.versionHistory = group.versionHistory.slice(-group.maxVersionHistorySize);
      }

      group.publishedVersion = group.version;
      group.isDraft = false;
      group.triggerCount = publishResult.publishedCount;
      group.addAuditEntry('GROUP_PUBLISHED', userId, { 
        version: group.version,
        triggerCount: publishResult.publishedCount,
        deletedFromPublished: publishResult.deletedFromPublished,
        changeLog 
      });

      await group.save();

      logger.info('[GlobalTriggers] Group published', {
        groupId,
        version: group.version,
        publishedCount: publishResult.publishedCount,
        deletedFromPublished: publishResult.deletedFromPublished,
        publishedBy: userId
      });

      return res.json({
        success: true,
        data: {
          groupId,
          version: group.version,
          publishedVersion: group.publishedVersion,
          triggerCount: publishResult.publishedCount,
          deletedFromPublished: publishResult.deletedFromPublished,
          publishErrors: publishResult.errors
        }
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Publish error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /trigger-groups/:groupId/rollback
 * Rollback to a previous version
 */
router.post('/trigger-groups/:groupId/rollback',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.PUBLISH),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { targetVersion, reason } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      const approval = validateApproval(req, 'rollback');
      if (!approval.valid) {
        return res.status(400).json({
          success: false,
          error: approval.error,
          requiresApproval: true
        });
      }

      if (!targetVersion) {
        return res.status(400).json({
          success: false,
          error: 'targetVersion is required'
        });
      }

      const group = await GlobalTriggerGroup.findOne({ groupId: groupId.toLowerCase() });
      
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      const snapshot = group.versionHistory.find(v => v.version === targetVersion);
      if (!snapshot) {
        return res.status(404).json({
          success: false,
          error: `Version ${targetVersion} not found in history`,
          availableVersions: group.versionHistory.map(v => v.version)
        });
      }

      await GlobalTrigger.deleteMany({ groupId: groupId.toLowerCase() });

      if (snapshot.triggersSnapshot && snapshot.triggersSnapshot.length > 0) {
        const triggersToInsert = snapshot.triggersSnapshot.map(t => ({
          ...t,
          _id: undefined
        }));
        await GlobalTrigger.insertMany(triggersToInsert);
      }

      group.version += 1;
      group.publishedVersion = group.version;
      group.isDraft = false;
      group.triggerCount = (snapshot.triggersSnapshot || []).length;
      group.addAuditEntry('GROUP_ROLLBACK', userId, {
        targetVersion,
        reason,
        triggerCount: group.triggerCount
      });

      await group.save();

      logger.info('[GlobalTriggers] Group rolled back', {
        groupId,
        targetVersion,
        newVersion: group.version,
        triggerCount: group.triggerCount,
        rolledBackBy: userId
      });

      return res.json({
        success: true,
        data: {
          groupId,
          restoredFromVersion: targetVersion,
          newVersion: group.version,
          triggerCount: group.triggerCount
        }
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Rollback error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// TRIGGER ROUTES (within a group)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /trigger-groups/:groupId/triggers
 * List all triggers in a group
 */
router.get('/trigger-groups/:groupId/triggers',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const { groupId } = req.params;

      const group = await GlobalTriggerGroup.findByGroupId(groupId);
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      // Admin sees draft triggers by default (what they're editing)
      // Use ?state=published to see live triggers
      const state = req.query.state || 'draft';
      const triggers = await GlobalTrigger.findByGroupId(groupId, { state });

      return res.json({
        success: true,
        data: triggers,
        total: triggers.length,
        state,
        groupId: group.groupId,
        groupName: group.name
      });
    } catch (error) {
      logger.error('[GlobalTriggers] List triggers error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /trigger-groups/:groupId/triggers
 * Add a trigger to a group
 * 
 * IDEMPOTENT CREATE: If trigger already exists, returns existing (200 with alreadyExisted)
 */
router.post('/trigger-groups/:groupId/triggers',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.WRITE),
  async (req, res) => {
    try {
      const { groupId: rawGroupId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';
      const {
        ruleId: rawRuleId,
        label,
        description,
        enabled,
        priority,
        keywords,
        phrases,
        negativeKeywords,
        responseMode,
        answerText,
        audioUrl,
        llmFactPack,
        followUpQuestion,
        followUpNextAction,
        scenarioTypeAllowlist,
        tags
      } = req.body;

      // ═══════════════════════════════════════════════════════════════════════
      // VALIDATION: Required fields
      // ═══════════════════════════════════════════════════════════════════════
      const isLlmMode = responseMode === 'llm';
      
      if (!rawRuleId || !label) {
        return res.status(400).json({
          success: false,
          error: 'ruleId and label are required'
        });
      }
      
      // For standard mode, answerText is required. For LLM mode, fact pack is required.
      if (!isLlmMode && !answerText) {
        return res.status(400).json({
          success: false,
          error: 'answerText is required for standard response mode'
        });
      }
      
      if (isLlmMode && (!llmFactPack || (!llmFactPack.includedFacts && !llmFactPack.excludedFacts))) {
        return res.status(400).json({
          success: false,
          error: 'LLM mode requires at least one fact pack (includedFacts or excludedFacts)'
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // CANONICALIZATION: Normalize IDs at API boundary
      // ═══════════════════════════════════════════════════════════════════════
      const groupIdValidation = validateGroupId(rawGroupId);
      if (!groupIdValidation.valid) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_GROUP_ID',
          message: groupIdValidation.error
        });
      }
      const normalizedGroupId = groupIdValidation.normalized;

      const ruleIdValidation = validateRuleId(rawRuleId);
      if (!ruleIdValidation.valid) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_RULE_ID',
          message: ruleIdValidation.error
        });
      }
      const ruleId = ruleIdValidation.normalized;

      const group = await GlobalTriggerGroup.findOne({ groupId: normalizedGroupId });
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      if (group.isLocked) {
        return res.status(423).json({
          success: false,
          error: 'Group is locked',
          lockedReason: group.lockedReason
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // IDEMPOTENT CREATE: Return existing if already exists (non-deleted)
      // ═══════════════════════════════════════════════════════════════════════
      const exists = await GlobalTrigger.existsInGroup(normalizedGroupId, ruleId, 'draft');
      if (exists) {
        const existing = await GlobalTrigger.findOne({ 
          groupId: normalizedGroupId, 
          ruleId,
          state: 'draft',
          isDeleted: { $ne: true }
        });
        logger.info('[GlobalTriggers] Idempotent create - returning existing', {
          groupId: normalizedGroupId,
          ruleId,
          existingTriggerId: existing?.triggerId
        });
        return res.status(200).json({
          success: true,
          data: existing,
          alreadyExisted: true
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // REVIVAL: If soft-deleted version exists, revive it instead of creating
      // ═══════════════════════════════════════════════════════════════════════
      const deletedTrigger = await GlobalTrigger.findDeletedInGroup(normalizedGroupId, ruleId, 'draft');
      if (deletedTrigger) {
        deletedTrigger.isDeleted = false;
        deletedTrigger.deletedAt = null;
        deletedTrigger.deletedBy = null;
        deletedTrigger.deletedReason = null;
        deletedTrigger.label = label;
        deletedTrigger.description = description || '';
        deletedTrigger.enabled = enabled !== false;
        deletedTrigger.priority = priority || 50;
        deletedTrigger.keywords = keywords || [];
        deletedTrigger.phrases = phrases || [];
        deletedTrigger.negativeKeywords = negativeKeywords || [];
        deletedTrigger.responseMode = responseMode || 'standard';
        deletedTrigger.answerText = answerText || (isLlmMode ? '[LLM-generated response]' : '');
        deletedTrigger.audioUrl = isLlmMode ? '' : (audioUrl || '');
        if (isLlmMode && llmFactPack) {
          deletedTrigger.llmFactPack = {
            includedFacts: llmFactPack.includedFacts || '',
            excludedFacts: llmFactPack.excludedFacts || '',
            backupAnswer: llmFactPack.backupAnswer || ''
          };
        }
        deletedTrigger.followUpQuestion = followUpQuestion || '';
        deletedTrigger.followUpNextAction = followUpNextAction || '';
        deletedTrigger.scenarioTypeAllowlist = scenarioTypeAllowlist || [];
        deletedTrigger.tags = tags || [];
        deletedTrigger.updatedAt = new Date();
        deletedTrigger.updatedBy = userId;
        deletedTrigger.version += 1;

        await deletedTrigger.save();

        group.incrementVersion(userId);
        group.addAuditEntry('TRIGGER_REVIVED', userId, { ruleId, triggerId: deletedTrigger.triggerId });
        await group.save();

        logger.info('[GlobalTriggers] Trigger revived from soft-delete', {
          groupId: normalizedGroupId,
          ruleId,
          triggerId: deletedTrigger.triggerId,
          revivedBy: userId
        });

        return res.status(200).json({
          success: true,
          data: deletedTrigger,
          revived: true
        });
      }

      const triggerId = GlobalTrigger.generateTriggerId(normalizedGroupId, ruleId);

      const trigger = await GlobalTrigger.create({
        groupId: normalizedGroupId,
        ruleId,
        triggerId,
        state: 'draft',  // All new triggers start as draft
        label,
        description: description || '',
        enabled: enabled !== false,
        priority: priority || 50,
        keywords: keywords || [],
        phrases: phrases || [],
        negativeKeywords: negativeKeywords || [],
        responseMode: responseMode || 'standard',
        answerText: answerText || (isLlmMode ? '[LLM-generated response]' : ''),
        audioUrl: isLlmMode ? '' : (audioUrl || ''),  // LLM mode doesn't use pre-recorded audio
        llmFactPack: isLlmMode ? {
          includedFacts: llmFactPack?.includedFacts || '',
          excludedFacts: llmFactPack?.excludedFacts || '',
          backupAnswer: llmFactPack?.backupAnswer || ''
        } : undefined,
        followUpQuestion: followUpQuestion || '',
        followUpNextAction: followUpNextAction || '',
        scenarioTypeAllowlist: scenarioTypeAllowlist || [],
        tags: tags || [],
        createdBy: userId,
        updatedBy: userId
      });

      group.incrementVersion(userId);
      group.triggerCount = await GlobalTrigger.countByGroupId(normalizedGroupId, 'draft');
      group.addAuditEntry('TRIGGER_ADDED', userId, { ruleId, label });
      await group.save();

      logger.info('[GlobalTriggers] Trigger added', {
        groupId: normalizedGroupId,
        ruleId,
        triggerId,
        createdBy: userId
      });

      return res.status(201).json({
        success: true,
        data: trigger
      });
    } catch (error) {
      // Idempotent create: if duplicate key error, return existing doc
      if (error.code === 11000) {
        try {
          const rawGroupId = req.params.groupId;
          const rawRuleId = req.body.ruleId;
          const groupId = normalizeGroupId(rawGroupId);
          const ruleId = normalizeRuleId(rawRuleId);
          const existing = await GlobalTrigger.findOne({ 
            groupId, 
            ruleId, 
            state: 'draft',
            isDeleted: { $ne: true }
          });
          if (existing) {
            logger.info('[GlobalTriggers] Idempotent create (race) - returning existing', {
              groupId,
              ruleId,
              existingTriggerId: existing.triggerId
            });
            return res.status(200).json({
              success: true,
              data: existing,
              alreadyExisted: true
            });
          }
        } catch (lookupError) {
          logger.error('[GlobalTriggers] Failed to lookup existing on duplicate', lookupError);
        }
        return res.status(409).json({
          success: false,
          error: 'DUPLICATE_RULE_ID',
          message: 'Trigger already exists'
        });
      }
      logger.error('[GlobalTriggers] Add trigger error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /trigger-groups/:groupId/triggers/:ruleId
 * Get a specific trigger
 */
router.get('/trigger-groups/:groupId/triggers/:ruleId',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const { groupId, ruleId } = req.params;

      const trigger = await GlobalTrigger.findOne({
        groupId: groupId.toLowerCase(),
        ruleId
      }).lean();

      if (!trigger) {
        return res.status(404).json({
          success: false,
          error: 'Trigger not found'
        });
      }

      return res.json({
        success: true,
        data: trigger
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Get trigger error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * PATCH /trigger-groups/:groupId/triggers/:ruleId
 * Update a trigger
 */
router.patch('/trigger-groups/:groupId/triggers/:ruleId',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.WRITE),
  async (req, res) => {
    try {
      const { groupId, ruleId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';
      const updates = req.body;

      const normalizedGroupId = groupId.toLowerCase();

      const group = await GlobalTriggerGroup.findOne({ groupId: normalizedGroupId });
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      if (group.isLocked) {
        return res.status(423).json({
          success: false,
          error: 'Group is locked',
          lockedReason: group.lockedReason
        });
      }

      const trigger = await GlobalTrigger.findOne({
        groupId: normalizedGroupId,
        ruleId
      });

      if (!trigger) {
        return res.status(404).json({
          success: false,
          error: 'Trigger not found'
        });
      }

      const allowedFields = [
        'label', 'description', 'enabled', 'priority',
        'keywords', 'phrases', 'negativeKeywords',
        'responseMode', 'answerText', 'audioUrl', 'llmFactPack',
        'followUpQuestion', 'followUpNextAction',
        'scenarioTypeAllowlist', 'tags'
      ];

      const cleanUpdates = {};
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          cleanUpdates[field] = updates[field];
        }
      }

      // Check if answer text changed - will need to invalidate audio for all companies using this trigger
      const textChanged = cleanUpdates.answerText && cleanUpdates.answerText !== trigger.answerText;

      Object.assign(trigger, cleanUpdates);
      trigger.version += 1;
      trigger.updatedAt = new Date();
      trigger.updatedBy = userId;

      await trigger.save();

      // If text changed, invalidate audio for ALL companies that have audio for this trigger
      let audioInvalidatedCount = 0;
      if (textChanged) {
        const result = await TriggerAudio.updateMany(
          { ruleId, isValid: true },
          {
            $set: {
              isValid: false,
              invalidatedAt: new Date(),
              invalidatedReason: 'GLOBAL_TRIGGER_TEXT_CHANGED'
            }
          }
        );
        audioInvalidatedCount = result.modifiedCount || 0;
        
        if (audioInvalidatedCount > 0) {
          logger.info('[GlobalTriggers] Audio invalidated across companies due to text change', {
            groupId: normalizedGroupId,
            ruleId,
            invalidatedCount: audioInvalidatedCount
          });
        }
      }

      group.incrementVersion(userId);
      group.addAuditEntry('TRIGGER_UPDATED', userId, { 
        ruleId, 
        updatedFields: Object.keys(cleanUpdates),
        audioInvalidated: audioInvalidatedCount > 0
      });
      await group.save();

      logger.info('[GlobalTriggers] Trigger updated', {
        groupId: normalizedGroupId,
        ruleId,
        updatedFields: Object.keys(cleanUpdates),
        textChanged,
        audioInvalidatedCount,
        updatedBy: userId
      });

      return res.json({
        success: true,
        data: trigger,
        audioInvalidated: textChanged,
        audioInvalidatedCount
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Update trigger error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * DELETE /trigger-groups/:groupId/triggers/:ruleId
 * Delete a trigger
 */
router.delete('/trigger-groups/:groupId/triggers/:ruleId',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.WRITE),
  async (req, res) => {
    try {
      const { groupId, ruleId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      const normalizedGroupId = groupId.toLowerCase();

      const group = await GlobalTriggerGroup.findOne({ groupId: normalizedGroupId });
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      if (group.isLocked) {
        return res.status(423).json({
          success: false,
          error: 'Group is locked',
          lockedReason: group.lockedReason
        });
      }

      const trigger = await GlobalTrigger.findOne({
        groupId: normalizedGroupId,
        ruleId
      });

      if (!trigger) {
        return res.status(404).json({
          success: false,
          error: 'Trigger not found'
        });
      }

      await GlobalTrigger.deleteOne({ _id: trigger._id });

      group.incrementVersion(userId);
      group.triggerCount = await GlobalTrigger.countByGroupId(normalizedGroupId);
      group.addAuditEntry('TRIGGER_DELETED', userId, { ruleId, label: trigger.label });
      await group.save();

      logger.info('[GlobalTriggers] Trigger deleted', {
        groupId: normalizedGroupId,
        ruleId,
        deletedBy: userId
      });

      return res.json({
        success: true,
        message: `Trigger "${ruleId}" deleted`
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Delete trigger error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// AUDIT & HEALTH ROUTES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /trigger-groups/:groupId/audit-log
 * View audit history for a group
 */
router.get('/trigger-groups/:groupId/audit-log',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { limit = 50 } = req.query;

      const group = await GlobalTriggerGroup.findOne({ groupId: groupId.toLowerCase() })
        .select('groupId name auditLog')
        .lean();

      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      const auditEntries = (group.auditLog || [])
        .slice(-parseInt(limit, 10))
        .reverse();

      return res.json({
        success: true,
        data: auditEntries,
        total: auditEntries.length,
        groupId: group.groupId
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Audit log error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /trigger-groups/:groupId/duplicates
 * Check for duplicate triggers in a group
 */
router.get('/trigger-groups/:groupId/duplicates',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const { groupId } = req.params;

      const duplicates = await GlobalTrigger.findDuplicatesInGroup(groupId);

      return res.json({
        success: true,
        healthy: duplicates.length === 0,
        duplicates: duplicates.map(d => ({
          ruleId: d._id,
          count: d.count,
          triggers: d.docs
        })),
        groupId
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Duplicates check error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /trigger-groups/:groupId/version-history
 * View version history for a group
 */
router.get('/trigger-groups/:groupId/version-history',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const { groupId } = req.params;

      const group = await GlobalTriggerGroup.findOne({ groupId: groupId.toLowerCase() })
        .select('groupId name version publishedVersion isDraft versionHistory')
        .lean();

      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      const history = (group.versionHistory || []).map(v => ({
        version: v.version,
        triggerCount: v.triggerCount,
        publishedAt: v.publishedAt,
        publishedBy: v.publishedBy,
        changeLog: v.changeLog
      })).reverse();

      return res.json({
        success: true,
        data: {
          currentVersion: group.version,
          publishedVersion: group.publishedVersion,
          isDraft: group.isDraft,
          history
        },
        groupId: group.groupId
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Version history error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// PRE-PUBLISH VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /trigger-groups/:groupId/validate
 * Pre-flight check before publish - returns all issues that would cause problems
 */
router.post('/trigger-groups/:groupId/validate',
  authenticateJWT,
  requireGlobalTriggerPermission(GLOBAL_TRIGGER_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const normalizedGroupId = normalizeGroupId(groupId);
      
      if (!normalizedGroupId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_GROUP_ID',
          message: 'Invalid groupId format'
        });
      }

      const group = await GlobalTriggerGroup.findByGroupId(normalizedGroupId);
      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      const triggers = await GlobalTrigger.findByGroupId(normalizedGroupId);
      const issues = [];

      // ═══════════════════════════════════════════════════════════════════════
      // 1. Check for invalid ruleIds
      // ═══════════════════════════════════════════════════════════════════════
      const invalidRuleIds = triggers.filter(t => {
        const validation = validateRuleId(t.ruleId);
        return !validation.valid;
      });
      if (invalidRuleIds.length > 0) {
        issues.push({
          type: 'INVALID_RULE_ID',
          severity: 'critical',
          message: `${invalidRuleIds.length} trigger(s) have invalid ruleId format`,
          items: invalidRuleIds.map(t => ({ triggerId: t.triggerId, ruleId: t.ruleId }))
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 2. Check for duplicate ruleIds (should be 0 with unique index)
      // ═══════════════════════════════════════════════════════════════════════
      const duplicates = await GlobalTrigger.findDuplicatesInGroup(normalizedGroupId);
      if (duplicates.length > 0) {
        issues.push({
          type: 'DUPLICATE_RULE_ID',
          severity: 'critical',
          message: `${duplicates.length} duplicate ruleId(s) found`,
          items: duplicates.map(d => ({ ruleId: d._id, count: d.count, triggers: d.docs }))
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 3. Check for missing required fields
      // ═══════════════════════════════════════════════════════════════════════
      const missingFields = triggers.filter(t => 
        !t.label || !t.answerText || !t.ruleId
      );
      if (missingFields.length > 0) {
        issues.push({
          type: 'MISSING_REQUIRED_FIELDS',
          severity: 'critical',
          message: `${missingFields.length} trigger(s) missing required fields (label, answerText, or ruleId)`,
          items: missingFields.map(t => ({
            triggerId: t.triggerId,
            ruleId: t.ruleId,
            missingLabel: !t.label,
            missingAnswerText: !t.answerText,
            missingRuleId: !t.ruleId
          }))
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 4. Check priority range (1-1000, recommend 1-100)
      // ═══════════════════════════════════════════════════════════════════════
      const outOfRangePriority = triggers.filter(t => 
        t.priority < 1 || t.priority > 1000
      );
      if (outOfRangePriority.length > 0) {
        issues.push({
          type: 'PRIORITY_OUT_OF_RANGE',
          severity: 'warning',
          message: `${outOfRangePriority.length} trigger(s) have priority outside 1-1000`,
          items: outOfRangePriority.map(t => ({ triggerId: t.triggerId, priority: t.priority }))
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 5. Check for empty keywords/phrases (match nothing)
      // ═══════════════════════════════════════════════════════════════════════
      const noMatchCriteria = triggers.filter(t => 
        (!t.keywords || t.keywords.length === 0) && 
        (!t.phrases || t.phrases.length === 0)
      );
      if (noMatchCriteria.length > 0) {
        issues.push({
          type: 'NO_MATCH_CRITERIA',
          severity: 'warning',
          message: `${noMatchCriteria.length} trigger(s) have no keywords or phrases (won't match anything)`,
          items: noMatchCriteria.map(t => ({ triggerId: t.triggerId, ruleId: t.ruleId, label: t.label }))
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 6. Check for disabled triggers
      // ═══════════════════════════════════════════════════════════════════════
      const disabledTriggers = triggers.filter(t => t.enabled === false);
      if (disabledTriggers.length > 0) {
        issues.push({
          type: 'DISABLED_TRIGGERS',
          severity: 'info',
          message: `${disabledTriggers.length} trigger(s) are disabled (will be published but not active)`,
          items: disabledTriggers.map(t => ({ triggerId: t.triggerId, ruleId: t.ruleId }))
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 7. Count companies using this group (impact analysis)
      // ═══════════════════════════════════════════════════════════════════════
      const companyCount = await CompanyTriggerSettings.countCompaniesByGroup(normalizedGroupId);

      // ═══════════════════════════════════════════════════════════════════════
      // 8. Check orphaned overrides across all companies using this group
      // ═══════════════════════════════════════════════════════════════════════
      const companies = await CompanyTriggerSettings.getCompaniesUsingGroup(normalizedGroupId);
      const triggerIds = new Set(triggers.map(t => t.triggerId));
      let orphanedOverrideCount = 0;

      for (const company of companies) {
        const CompanyLocalTrigger = require('../../models/CompanyLocalTrigger');
        const localTriggers = await CompanyLocalTrigger.find({
          companyId: company.companyId,
          isOverride: true,
          isDeleted: { $ne: true }
        }).select('overrideOfTriggerId').lean();

        for (const lt of localTriggers) {
          if (lt.overrideOfTriggerId && !triggerIds.has(lt.overrideOfTriggerId)) {
            orphanedOverrideCount++;
          }
        }
      }

      if (orphanedOverrideCount > 0) {
        issues.push({
          type: 'ORPHANED_OVERRIDES',
          severity: 'warning',
          message: `${orphanedOverrideCount} company override(s) point to triggers not in this group`,
          items: [{ orphanedCount: orphanedOverrideCount }]
        });
      }

      const criticalCount = issues.filter(i => i.severity === 'critical').length;
      const warningCount = issues.filter(i => i.severity === 'warning').length;
      const canPublish = criticalCount === 0;

      return res.json({
        success: true,
        canPublish,
        groupId: normalizedGroupId,
        groupName: group.name,
        currentVersion: group.version,
        publishedVersion: group.publishedVersion,
        triggerCount: triggers.length,
        companyCount,
        criticalIssues: criticalCount,
        warningIssues: warningCount,
        infoIssues: issues.filter(i => i.severity === 'info').length,
        issues,
        validatedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[GlobalTriggers] Validation error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
