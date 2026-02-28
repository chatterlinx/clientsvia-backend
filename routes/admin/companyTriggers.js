/**
 * ============================================================================
 * COMPANY TRIGGERS - Admin API Routes (Company-Scoped Resources)
 * ============================================================================
 *
 * These routes manage company-specific trigger configurations.
 * All routes require companyId in the path for isolation.
 *
 * ISOLATION RULES:
 * - Every route scoped by companyId
 * - No cross-company data access possible
 * - Merged view combines global + local without data leakage
 *
 * ENDPOINTS:
 * - GET    /:companyId/triggers           - Get merged trigger list (UI view)
 * - PUT    /:companyId/active-group       - Select/change active global group
 * - GET    /:companyId/active-group       - Get current active group info
 *
 * - GET    /:companyId/local-triggers     - List local triggers only
 * - POST   /:companyId/local-triggers     - Create local trigger
 * - GET    /:companyId/local-triggers/:id - Get local trigger
 * - PATCH  /:companyId/local-triggers/:id - Update local trigger
 * - DELETE /:companyId/local-triggers/:id - Delete local trigger
 *
 * - PUT    /:companyId/trigger-visibility - Hide/show global triggers
 * - PUT    /:companyId/trigger-override   - Set partial override
 * - DELETE /:companyId/trigger-override/:triggerId - Remove partial override
 * - PUT    /:companyId/trigger-scope      - Change trigger scope (LOCAL/GLOBAL)
 *
 * - PUT    /:companyId/trigger-audio/:ruleId - Save company-specific audio
 * - DELETE /:companyId/trigger-audio/:ruleId - Delete company-specific audio
 * - PUT    /:companyId/variables          - Save company variables
 *
 * - GET    /:companyId/duplicates         - Check for duplicate triggers
 *
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');

const GlobalTriggerGroup = require('../../models/GlobalTriggerGroup');
const GlobalTrigger = require('../../models/GlobalTrigger');
const CompanyLocalTrigger = require('../../models/CompanyLocalTrigger');
const CompanyTriggerSettings = require('../../models/CompanyTriggerSettings');
const TriggerAudio = require('../../models/TriggerAudio');
const v2Company = require('../../models/v2Company');
const { resolveAudioUrl } = require('../../services/engine/agent2/TriggerService');

// ════════════════════════════════════════════════════════════════════════════════
// PERMISSION HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function isPlatformAdmin(user) {
  if (!user) { return false; }
  return user.role === 'admin' || 
         user.role === 'super_admin' || 
         user.role === 'platform_admin' ||
         user.isSuperAdmin === true ||
         user.isPlatformAdmin === true;
}

// ════════════════════════════════════════════════════════════════════════════════
// CANONICALIZATION RULES
// ════════════════════════════════════════════════════════════════════════════════
// All identifiers must be normalized at the API boundary to prevent semantic duplicates.
// ruleId: ^[a-z0-9]+(\.[a-z0-9_-]+)*$ (e.g., "pricing.freon", "hvac.thermostat_blank")
// groupId: ^[a-z0-9_-]+$ (e.g., "hvac", "dental-office")
// companyId: preserved as-is (already normalized upstream)

const RULE_ID_REGEX = /^[a-z0-9]+(\.[a-z0-9_-]+)*$/;

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

// ════════════════════════════════════════════════════════════════════════════════
// HELPER: Build merged trigger list for UI
// ════════════════════════════════════════════════════════════════════════════════

async function buildMergedTriggerList(companyId) {
  const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
  
  let globalTriggers = [];
  let groupInfo = null;
  
  if (settings && settings.activeGroupId) {
    globalTriggers = await GlobalTrigger.findByGroupId(settings.activeGroupId);
    const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);
    if (group) {
      groupInfo = {
        groupId: group.groupId,
        name: group.name,
        icon: group.icon,
        version: group.version,
        publishedVersion: group.publishedVersion,
        triggerCount: group.triggerCount
      };
    }
  }

  const localTriggers = await CompanyLocalTrigger.findByCompanyId(companyId);
  
  // Load company-specific audio for all triggers
  const audioRecordings = await TriggerAudio.findByCompanyId(companyId);
  const audioMap = new Map();
  audioRecordings.forEach(a => {
    audioMap.set(a.ruleId, a);
  });

  const disabledGlobalSet = new Set(settings?.disabledGlobalTriggerIds || []);
  
  // partialOverrides is now a Map (keyed by globalTriggerId)
  // Convert to regular Map if it's a Mongoose Map
  const partialOverrideMap = new Map();
  if (settings?.partialOverrides) {
    const overrides = settings.partialOverrides instanceof Map 
      ? settings.partialOverrides 
      : new Map(Object.entries(settings.partialOverrides || {}));
    overrides.forEach((value, key) => {
      partialOverrideMap.set(key, value);
    });
  }

  // Full overrides: Map by overrideOfRuleId (canonical key, never parse IDs)
  const fullOverrideByRuleId = new Map();
  localTriggers.forEach(lt => {
    if (lt.isOverride && lt.overrideOfRuleId) {
      fullOverrideByRuleId.set(lt.overrideOfRuleId, lt);
    }
  });

  const triggerMap = new Map();

  for (const gt of globalTriggers) {
    // Check for full override by ruleId (not by parsing triggerId)
    if (fullOverrideByRuleId.has(gt.ruleId)) {
      continue;
    }

    const partialOverride = partialOverrideMap.get(gt.triggerId);
    const isDisabled = disabledGlobalSet.has(gt.triggerId);
    const companyAudio = audioMap.get(gt.ruleId);
    
    // Use answer text from partial override if exists, else from global
    const effectiveAnswerText = partialOverride?.answerText || gt.answerText;
    
    // Audio is ALWAYS company-specific - never from global trigger
    // Validates DB record AND verifies file exists on disk
    const effectiveAudioUrl = resolveAudioUrl(companyAudio, effectiveAnswerText);
    const hasValidAudio = Boolean(effectiveAudioUrl);
    
    const triggerData = {
      triggerId: gt.triggerId,
      ruleId: gt.ruleId,
      label: gt.label,
      scope: 'GLOBAL',
      originGroupId: gt.groupId,
      originGroupName: groupInfo?.name || null,
      isEnabled: !isDisabled,
      isOverridden: Boolean(partialOverride),
      overrideType: partialOverride ? 'PARTIAL' : null,
      priority: gt.priority,
      responseMode: gt.responseMode || 'standard',
      match: {
        keywords: gt.keywords || [],
        phrases: gt.phrases || [],
        negativeKeywords: gt.negativeKeywords || []
      },
      answer: {
        answerText: effectiveAnswerText,
        audioUrl: effectiveAudioUrl,
        hasAudio: Boolean(effectiveAudioUrl),
        audioNeedsRegeneration: companyAudio && !hasValidAudio
      },
      followUp: {
        question: gt.followUpQuestion || '',
        nextAction: gt.followUpNextAction || ''
      },
      createdAt: gt.createdAt,
      createdBy: gt.createdBy,
      lastEditedAt: partialOverride?.updatedAt || gt.updatedAt,
      lastEditedBy: partialOverride?.updatedBy || gt.updatedBy,
      version: gt.version
    };
    
    // Include LLM fact pack if in LLM mode
    if (gt.responseMode === 'llm' && gt.llmFactPack) {
      triggerData.llmFactPack = {
        includedFacts: gt.llmFactPack.includedFacts || '',
        excludedFacts: gt.llmFactPack.excludedFacts || '',
        backupAnswer: gt.llmFactPack.backupAnswer || ''
      };
    }
    
    triggerMap.set(gt.ruleId, triggerData);
  }

  for (const lt of localTriggers) {
    const companyAudio = audioMap.get(lt.ruleId);
    
    // Validates DB record AND verifies file exists on disk
    const effectiveAudioUrl = resolveAudioUrl(companyAudio, lt.answerText);
    const hasValidAudio = Boolean(effectiveAudioUrl);
    
    const localTriggerData = {
      triggerId: lt.triggerId,
      ruleId: lt.ruleId,
      label: lt.label,
      scope: 'LOCAL',
      originGroupId: lt.overrideOfGroupId || null,
      originGroupName: null,
      isEnabled: lt.enabled,
      isOverridden: lt.isOverride,
      overrideType: lt.isOverride ? 'FULL' : null,
      overrideOfTriggerId: lt.overrideOfTriggerId || null,
      overrideOfGroupId: lt.overrideOfGroupId || null,
      overrideOfRuleId: lt.overrideOfRuleId || null,
      priority: lt.priority,
      responseMode: lt.responseMode || 'standard',
      match: {
        keywords: lt.keywords || [],
        phrases: lt.phrases || [],
        negativeKeywords: lt.negativeKeywords || []
      },
      answer: {
        answerText: lt.answerText,
        audioUrl: effectiveAudioUrl,
        hasAudio: Boolean(effectiveAudioUrl),
        audioNeedsRegeneration: companyAudio && !hasValidAudio
      },
      followUp: {
        question: lt.followUpQuestion || '',
        nextAction: lt.followUpNextAction || ''
      },
      createdAt: lt.createdAt,
      createdBy: lt.createdBy,
      lastEditedAt: lt.updatedAt,
      lastEditedBy: lt.updatedBy,
      version: 1
    };
    
    // Include LLM fact pack if in LLM mode
    if (lt.responseMode === 'llm' && lt.llmFactPack) {
      localTriggerData.llmFactPack = {
        includedFacts: lt.llmFactPack.includedFacts || '',
        excludedFacts: lt.llmFactPack.excludedFacts || '',
        backupAnswer: lt.llmFactPack.backupAnswer || ''
      };
    }
    
    triggerMap.set(lt.ruleId, localTriggerData);
  }

  const triggers = Array.from(triggerMap.values())
    .sort((a, b) => a.priority - b.priority);

  const globalCount = globalTriggers.length;
  const globalDisabledCount = disabledGlobalSet.size;
  const globalOverriddenCount = fullOverrideByRuleId.size;
  const globalEnabledCount = globalCount - globalDisabledCount - globalOverriddenCount;
  
  const localNonOverride = localTriggers.filter(lt => !lt.isOverride && lt.isDeleted !== true);
  const localCount = localNonOverride.length;
  const localEnabledCount = localNonOverride.filter(lt => lt.enabled !== false).length;
  const localDisabledCount = localCount - localEnabledCount;
  
  const fullOverrideCount = localTriggers.filter(lt => lt.isOverride && lt.isDeleted !== true).length;
  const partialOverrideCount = partialOverrideMap.size;
  const overrideCount = fullOverrideCount + partialOverrideCount;
  
  const totalTriggerCount = triggers.length;
  const totalActiveCount = triggers.filter(t => t.isEnabled !== false).length;
  const totalDisabledCount = totalTriggerCount - totalActiveCount;

  return {
    companyId,
    activeGroupId: settings?.activeGroupId || null,
    activeGroupName: groupInfo?.name || null,
    activeGroupIcon: groupInfo?.icon || null,
    activeGroupVersion: groupInfo?.publishedVersion || null,
    triggers,
    stats: {
      globalCount,
      globalEnabledCount,
      globalDisabledCount,
      globalOverriddenCount,
      localCount,
      localEnabledCount,
      localDisabledCount,
      overrideCount,
      totalTriggerCount,
      totalActiveCount,
      totalDisabledCount
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MERGED TRIGGER LIST (UI VIEW)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /:companyId/triggers
 * Get merged trigger list for UI display
 */
router.get('/:companyId/triggers',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;

      const company = await v2Company.findById(companyId).select('companyName').lean();
      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      const result = await buildMergedTriggerList(companyId);

      const groups = await GlobalTriggerGroup.listActiveGroups();
      
      const settings = await CompanyTriggerSettings.findOne({ companyId });
      let companyVariables = {};
      
      if (settings?.companyVariables) {
        if (settings.companyVariables instanceof Map) {
          companyVariables = Object.fromEntries(settings.companyVariables);
        } else if (typeof settings.companyVariables === 'object') {
          companyVariables = settings.companyVariables;
        }
      }

      return res.json({
        success: true,
        data: {
          ...result,
          companyName: company.companyName,
          availableGroups: groups,
          companyVariables,
          permissions: {
            canEditGlobalTriggers: isPlatformAdmin(req.user),
            canEditLocalTriggers: true,
            canSwitchGroup: true,
            canCreateGroup: isPlatformAdmin(req.user)
          }
        }
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Get triggers error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// ACTIVE GROUP SELECTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /:companyId/active-group
 * Get current active group info
 */
router.get('/:companyId/active-group',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;

      const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
      
      if (!settings || !settings.activeGroupId) {
        return res.json({
          success: true,
          data: {
            activeGroupId: null,
            activeGroupName: null,
            groupSelectedAt: null,
            groupSelectedBy: null
          }
        });
      }

      const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);

      return res.json({
        success: true,
        data: {
          activeGroupId: settings.activeGroupId,
          activeGroupName: group?.name || null,
          activeGroupIcon: group?.icon || null,
          activeGroupVersion: group?.publishedVersion || null,
          triggerCount: group?.triggerCount || 0,
          groupSelectedAt: settings.groupSelectedAt,
          groupSelectedBy: settings.groupSelectedBy
        }
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Get active group error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * PUT /:companyId/active-group
 * Select/change active global group
 */
router.put('/:companyId/active-group',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { groupId } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      const company = await v2Company.findById(companyId).select('companyName').lean();
      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      if (groupId) {
        const group = await GlobalTriggerGroup.findByGroupId(groupId);
        if (!group) {
          return res.status(404).json({
            success: false,
            error: 'Group not found'
          });
        }

        if (!group.isActive) {
          return res.status(400).json({
            success: false,
            error: 'Cannot select inactive group'
          });
        }
      }

      const previousSettings = await CompanyTriggerSettings.findByCompanyId(companyId);
      const previousGroupId = previousSettings?.activeGroupId;

      // Get the group's publishedVersion for informational tracking
      let publishedVersion = null;
      if (groupId) {
        const groupForVersion = await GlobalTriggerGroup.findByGroupId(groupId);
        publishedVersion = groupForVersion?.publishedVersion || null;
      }

      const settings = await CompanyTriggerSettings.setActiveGroup(companyId, groupId, publishedVersion, userId);

      if (previousGroupId && previousGroupId !== groupId) {
        await GlobalTriggerGroup.updateOne(
          { groupId: previousGroupId },
          { $inc: { companyCount: -1 } }
        );
      }
      if (groupId && groupId !== previousGroupId) {
        await GlobalTriggerGroup.updateOne(
          { groupId: groupId.toLowerCase() },
          { $inc: { companyCount: 1 } }
        );
      }

      logger.info('[CompanyTriggers] Active group changed', {
        companyId,
        previousGroupId,
        newGroupId: groupId,
        changedBy: userId
      });

      const group = groupId ? await GlobalTriggerGroup.findByGroupId(groupId) : null;

      return res.json({
        success: true,
        data: {
          activeGroupId: settings.activeGroupId,
          activeGroupName: group?.name || null,
          activeGroupIcon: group?.icon || null,
          triggerCount: group?.triggerCount || 0,
          groupSelectedAt: settings.groupSelectedAt,
          groupSelectedBy: settings.groupSelectedBy
        }
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Set active group error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// LOCAL TRIGGERS CRUD
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /:companyId/local-triggers
 * List local triggers only (not merged)
 */
router.get('/:companyId/local-triggers',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;

      const triggers = await CompanyLocalTrigger.findByCompanyId(companyId);

      return res.json({
        success: true,
        data: triggers,
        total: triggers.length
      });
    } catch (error) {
      logger.error('[CompanyTriggers] List local triggers error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /:companyId/local-triggers
 * Create a local trigger
 * 
 * OVERRIDE RULES:
 * - If isOverride=true, client MUST provide overrideOfTriggerId
 * - The ruleId MUST equal the global trigger's ruleId (enforced)
 * - We store overrideOfGroupId and overrideOfRuleId explicitly (never parse IDs)
 */
router.post('/:companyId/local-triggers',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
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
        isOverride,
        overrideOfTriggerId,
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
      // CANONICALIZATION: Normalize ruleId at API boundary
      // ═══════════════════════════════════════════════════════════════════════
      const ruleIdValidation = validateRuleId(rawRuleId);
      if (!ruleIdValidation.valid) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_RULE_ID',
          message: ruleIdValidation.error
        });
      }
      const ruleId = ruleIdValidation.normalized;

      const company = await v2Company.findById(companyId).select('_id').lean();
      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // OVERRIDE VALIDATION: Enforce strict rules for overrides
      // ═══════════════════════════════════════════════════════════════════════
      let overrideOfGroupId = null;
      let overrideOfRuleId = null;

      if (isOverride) {
        if (!overrideOfTriggerId) {
          return res.status(400).json({
            success: false,
            error: 'MISSING_OVERRIDE_TARGET',
            message: 'isOverride=true requires overrideOfTriggerId'
          });
        }

        const globalTrigger = await GlobalTrigger.findByTriggerId(overrideOfTriggerId);
        if (!globalTrigger) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_OVERRIDE_TARGET',
            message: `Cannot override non-existent global trigger "${overrideOfTriggerId}"`
          });
        }

        // CRITICAL: Enforce ruleId === global trigger's ruleId
        // This guarantees Map key behavior is correct at runtime
        if (ruleId !== globalTrigger.ruleId) {
          return res.status(400).json({
            success: false,
            error: 'RULE_ID_MISMATCH',
            message: `Override ruleId must match global trigger's ruleId. Expected "${globalTrigger.ruleId}", got "${ruleId}"`
          });
        }

        // Store explicit references (never parse IDs at runtime)
        overrideOfGroupId = globalTrigger.groupId;
        overrideOfRuleId = globalTrigger.ruleId;

        const overrideExists = await CompanyLocalTrigger.overrideExists(companyId, overrideOfTriggerId);
        if (overrideExists) {
          return res.status(409).json({
            success: false,
            error: 'DUPLICATE_OVERRIDE',
            message: `Override for "${overrideOfTriggerId}" already exists`
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // DUPLICATE CHECK: Prevent duplicate ruleId for this company
      // ═══════════════════════════════════════════════════════════════════════
      const exists = await CompanyLocalTrigger.existsForCompany(companyId, ruleId);
      if (exists) {
        // Idempotent create: return existing trigger instead of error
        const existing = await CompanyLocalTrigger.findOne({ 
          companyId, 
          ruleId,
          isDeleted: { $ne: true }
        });
        logger.info('[CompanyTriggers] Idempotent create - returning existing', {
          companyId,
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
      const deletedTrigger = await CompanyLocalTrigger.findDeletedForCompany(companyId, ruleId);
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
        deletedTrigger.answerText = answerText;
        deletedTrigger.audioUrl = audioUrl || '';
        deletedTrigger.followUpQuestion = followUpQuestion || '';
        deletedTrigger.followUpNextAction = followUpNextAction || '';
        deletedTrigger.isOverride = Boolean(isOverride);
        deletedTrigger.overrideOfGroupId = overrideOfGroupId;
        deletedTrigger.overrideOfRuleId = overrideOfRuleId;
        deletedTrigger.overrideOfTriggerId = isOverride ? overrideOfTriggerId : null;
        deletedTrigger.overrideType = isOverride ? 'FULL' : null;
        deletedTrigger.tags = tags || [];
        deletedTrigger.updatedAt = new Date();
        deletedTrigger.updatedBy = userId;

        await deletedTrigger.save();

        logger.info('[CompanyTriggers] Local trigger revived from soft-delete', {
          companyId,
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

      const triggerId = CompanyLocalTrigger.generateTriggerId(
        companyId, 
        ruleId, 
        isOverride, 
        overrideOfTriggerId
      );

      const trigger = await CompanyLocalTrigger.create({
        companyId,
        ruleId,
        triggerId,
        label,
        description: description || '',
        enabled: enabled !== false,
        priority: priority || 50,
        keywords: keywords || [],
        phrases: phrases || [],
        negativeKeywords: negativeKeywords || [],
        responseMode: responseMode || 'standard',
        answerText: answerText || (isLlmMode ? '[LLM-generated response]' : ''),
        audioUrl: '',  // Audio is always stored separately in TriggerAudio
        llmFactPack: isLlmMode ? {
          includedFacts: llmFactPack?.includedFacts || '',
          excludedFacts: llmFactPack?.excludedFacts || '',
          backupAnswer: llmFactPack?.backupAnswer || ''
        } : undefined,
        followUpQuestion: followUpQuestion || '',
        followUpNextAction: followUpNextAction || '',
        isOverride: Boolean(isOverride),
        overrideOfGroupId,
        overrideOfRuleId,
        overrideOfTriggerId: isOverride ? overrideOfTriggerId : null,
        overrideType: isOverride ? 'FULL' : null,
        tags: tags || [],
        createdBy: userId,
        updatedBy: userId
      });
      
      // Save audio separately if provided
      if (audioUrl && audioUrl.trim()) {
        await TriggerAudio.saveAudio(companyId, ruleId, audioUrl, answerText, null, userId);
        logger.info('[CompanyTriggers] Company-specific audio saved', {
          companyId,
          ruleId
        });
      }

      logger.info('[CompanyTriggers] Local trigger created', {
        companyId,
        ruleId,
        triggerId,
        isOverride: Boolean(isOverride),
        overrideOfRuleId,
        hasAudio: Boolean(audioUrl),
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
          const { companyId } = req.params;
          const rawRuleId = req.body.ruleId;
          const ruleId = normalizeRuleId(rawRuleId);
          const existing = await CompanyLocalTrigger.findOne({ 
            companyId, 
            ruleId,
            isDeleted: { $ne: true }
          });
          if (existing) {
            logger.info('[CompanyTriggers] Idempotent create (race) - returning existing', {
              companyId,
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
          logger.error('[CompanyTriggers] Failed to lookup existing on duplicate', lookupError);
        }
        return res.status(409).json({
          success: false,
          error: 'DUPLICATE_RULE_ID',
          message: 'Trigger already exists'
        });
      }
      logger.error('[CompanyTriggers] Create local trigger error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /:companyId/local-triggers/:ruleId
 * Get a specific local trigger
 */
router.get('/:companyId/local-triggers/:ruleId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;

      const trigger = await CompanyLocalTrigger.findOne({ companyId, ruleId }).lean();

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
      logger.error('[CompanyTriggers] Get local trigger error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * PATCH /:companyId/local-triggers/:ruleId
 * Update a local trigger
 */
router.patch('/:companyId/local-triggers/:ruleId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';
      const updates = req.body;

      const trigger = await CompanyLocalTrigger.findOne({ companyId, ruleId });

      if (!trigger) {
        return res.status(404).json({
          success: false,
          error: 'Trigger not found'
        });
      }

      const allowedFields = [
        'label', 'description', 'enabled', 'priority',
        'keywords', 'phrases', 'negativeKeywords',
        'responseMode', 'answerText', 'llmFactPack',
        'followUpQuestion', 'followUpNextAction',
        'tags'
      ];

      const cleanUpdates = {};
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          cleanUpdates[field] = updates[field];
        }
      }
      
      // Check if answer text changed - invalidate audio if it did
      const textChanged = cleanUpdates.answerText && cleanUpdates.answerText !== trigger.answerText;
      
      // Handle audio URL separately (never store in trigger, always in TriggerAudio)
      const audioUrl = updates.audioUrl;
      const hasAudioUpdate = audioUrl !== undefined;

      Object.assign(trigger, cleanUpdates);
      trigger.updatedAt = new Date();
      trigger.updatedBy = userId;

      await trigger.save();
      
      // Handle audio changes
      if (textChanged) {
        await TriggerAudio.invalidateAudio(companyId, ruleId, 'ANSWER_TEXT_CHANGED');
        logger.info('[CompanyTriggers] Audio invalidated due to text change', {
          companyId,
          ruleId
        });
      } else if (hasAudioUpdate) {
        // Save or update company-specific audio
        const finalAnswerText = cleanUpdates.answerText || trigger.answerText;
        if (audioUrl && audioUrl.trim()) {
          await TriggerAudio.saveAudio(companyId, ruleId, audioUrl, finalAnswerText, null, userId);
          logger.info('[CompanyTriggers] Company-specific audio saved', {
            companyId,
            ruleId
          });
        } else {
          // Empty audio URL = delete audio
          await TriggerAudio.deleteAudio(companyId, ruleId);
          logger.info('[CompanyTriggers] Company-specific audio removed', {
            companyId,
            ruleId
          });
        }
      }

      logger.info('[CompanyTriggers] Local trigger updated', {
        companyId,
        ruleId,
        updatedFields: Object.keys(cleanUpdates),
        textChanged,
        audioUpdated: hasAudioUpdate,
        updatedBy: userId
      });

      return res.json({
        success: true,
        data: trigger,
        audioInvalidated: textChanged
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Update local trigger error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * DELETE /:companyId/local-triggers/:ruleId
 * Delete a local trigger
 */
router.delete('/:companyId/local-triggers/:ruleId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      const trigger = await CompanyLocalTrigger.findOne({ companyId, ruleId });

      if (!trigger) {
        return res.status(404).json({
          success: false,
          error: 'Trigger not found'
        });
      }

      await CompanyLocalTrigger.deleteOne({ _id: trigger._id });

      logger.info('[CompanyTriggers] Local trigger deleted', {
        companyId,
        ruleId,
        triggerId: trigger.triggerId,
        deletedBy: userId
      });

      return res.json({
        success: true,
        message: `Trigger "${ruleId}" deleted`
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Delete local trigger error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// VISIBILITY & OVERRIDES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * PUT /:companyId/trigger-visibility
 * Enable or disable a global trigger for this company
 * Note: Disabled triggers are still visible but marked as OFF
 */
router.put('/:companyId/trigger-visibility',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { triggerId, visible } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      if (!triggerId) {
        return res.status(400).json({
          success: false,
          error: 'triggerId is required'
        });
      }

      const globalTrigger = await GlobalTrigger.findByTriggerId(triggerId);
      if (!globalTrigger) {
        return res.status(404).json({
          success: false,
          error: 'Global trigger not found'
        });
      }

      let settings;
      if (visible === false) {
        settings = await CompanyTriggerSettings.disableGlobalTrigger(companyId, triggerId);
      } else {
        settings = await CompanyTriggerSettings.enableGlobalTrigger(companyId, triggerId);
      }

      logger.info('[CompanyTriggers] Trigger enabled/disabled', {
        companyId,
        triggerId,
        enabled: visible !== false,
        changedBy: userId
      });

      return res.json({
        success: true,
        data: {
          triggerId,
          enabled: visible !== false,
          disabledGlobalTriggerIds: settings.disabledGlobalTriggerIds
        }
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Enable/disable error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * PUT /:companyId/trigger-override
 * Set a partial override on a global trigger (just answer text/audio)
 */
router.put('/:companyId/trigger-override',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { globalTriggerId, answerText, audioUrl } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      if (!globalTriggerId) {
        return res.status(400).json({
          success: false,
          error: 'globalTriggerId is required'
        });
      }

      if (!answerText && !audioUrl) {
        return res.status(400).json({
          success: false,
          error: 'At least one of answerText or audioUrl is required'
        });
      }

      const globalTrigger = await GlobalTrigger.findByTriggerId(globalTriggerId);
      if (!globalTrigger) {
        return res.status(404).json({
          success: false,
          error: 'Global trigger not found'
        });
      }

      const overrideData = {};
      if (answerText !== undefined) {
        overrideData.answerText = answerText;
      }
      if (audioUrl !== undefined) {
        overrideData.audioUrl = audioUrl;
      }

      const settings = await CompanyTriggerSettings.setPartialOverride(
        companyId,
        globalTriggerId,
        overrideData,
        userId
      );

      logger.info('[CompanyTriggers] Partial override set', {
        companyId,
        globalTriggerId,
        overrideFields: Object.keys(overrideData),
        setBy: userId
      });

      return res.json({
        success: true,
        data: {
          globalTriggerId,
          override: settings.partialOverrides.find(po => po.globalTriggerId === globalTriggerId)
        }
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Set override error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * DELETE /:companyId/trigger-override/:triggerId
 * Remove a partial override
 */
router.delete('/:companyId/trigger-override/:triggerId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, triggerId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      await CompanyTriggerSettings.removePartialOverride(companyId, triggerId);

      logger.info('[CompanyTriggers] Partial override removed', {
        companyId,
        globalTriggerId: triggerId,
        removedBy: userId
      });

      return res.json({
        success: true,
        message: `Override for "${triggerId}" removed`
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Remove override error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * PUT /:companyId/trigger-scope
 * Change a trigger's scope between LOCAL and GLOBAL
 */
router.put('/:companyId/trigger-scope',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { triggerId, scope } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      if (!triggerId || !scope) {
        return res.status(400).json({
          success: false,
          error: 'triggerId and scope are required'
        });
      }

      if (scope !== 'LOCAL' && scope !== 'GLOBAL') {
        return res.status(400).json({
          success: false,
          error: 'scope must be either LOCAL or GLOBAL'
        });
      }

      const trigger = await CompanyLocalTrigger.findOne({ 
        companyId, 
        triggerId,
        isDeleted: { $ne: true }
      });

      if (!trigger) {
        return res.status(404).json({
          success: false,
          error: 'Trigger not found'
        });
      }

      if (scope === 'GLOBAL') {
        if (!isPlatformAdmin(req.user)) {
          return res.status(403).json({
            success: false,
            error: 'Only platform admins can change triggers to GLOBAL scope'
          });
        }

        const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
        if (!settings?.activeGroupId) {
          return res.status(400).json({
            success: false,
            error: 'Cannot change to GLOBAL scope: No active global group selected'
          });
        }

        const globalTrigger = await GlobalTrigger.create({
          groupId: settings.activeGroupId,
          ruleId: trigger.ruleId,
          triggerId: `GLOBAL_${settings.activeGroupId}_${trigger.ruleId}`,
          label: trigger.label,
          description: trigger.description || '',
          priority: trigger.priority,
          keywords: trigger.keywords || [],
          phrases: trigger.phrases || [],
          negativeKeywords: trigger.negativeKeywords || [],
          answerText: trigger.answerText,
          audioUrl: trigger.audioUrl || '',
          followUpQuestion: trigger.followUpQuestion || '',
          followUpNextAction: trigger.followUpNextAction || '',
          tags: trigger.tags || [],
          createdBy: userId,
          updatedBy: userId
        });

        await CompanyLocalTrigger.updateOne(
          { _id: trigger._id },
          {
            $set: {
              isDeleted: true,
              deletedAt: new Date(),
              deletedBy: userId,
              deletedReason: 'CONVERTED_TO_GLOBAL'
            }
          }
        );

        await GlobalTriggerGroup.updateOne(
          { groupId: settings.activeGroupId },
          { $inc: { triggerCount: 1 } }
        );

        logger.info('[CompanyTriggers] Trigger converted to GLOBAL', {
          companyId,
          triggerId,
          ruleId: trigger.ruleId,
          newGlobalTriggerId: globalTrigger.triggerId,
          convertedBy: userId
        });

        return res.json({
          success: true,
          message: 'Trigger converted to GLOBAL scope',
          data: {
            scope: 'GLOBAL',
            triggerId: globalTrigger.triggerId,
            ruleId: trigger.ruleId
          }
        });

      } else {
        return res.status(400).json({
          success: false,
          error: 'Converting GLOBAL triggers to LOCAL is not currently supported'
        });
      }

    } catch (error) {
      logger.error('[CompanyTriggers] Change scope error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// TRIGGER AUDIO (Company-Specific)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * PUT /:companyId/trigger-audio/:ruleId
 * Save company-specific audio for a trigger
 */
router.put('/:companyId/trigger-audio/:ruleId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;
      const { audioUrl, answerText, voiceId } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      if (!audioUrl || !answerText) {
        return res.status(400).json({
          success: false,
          error: 'audioUrl and answerText are required'
        });
      }

      const audio = await TriggerAudio.saveAudio(
        companyId,
        ruleId,
        audioUrl,
        answerText,
        voiceId,
        userId
      );

      logger.info('[TriggerAudio] Audio saved', {
        companyId,
        ruleId,
        voiceId,
        savedBy: userId
      });

      return res.json({
        success: true,
        data: {
          companyId,
          ruleId,
          audioUrl: audio.audioUrl,
          isValid: audio.isValid,
          textHash: audio.textHash
        }
      });
    } catch (error) {
      logger.error('[TriggerAudio] Save audio error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * DELETE /:companyId/trigger-audio/:ruleId
 * Delete company-specific audio for a trigger
 */
router.delete('/:companyId/trigger-audio/:ruleId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      await TriggerAudio.deleteAudio(companyId, ruleId);

      logger.info('[TriggerAudio] Audio deleted', {
        companyId,
        ruleId,
        deletedBy: userId
      });

      return res.json({
        success: true,
        message: 'Audio deleted successfully'
      });
    } catch (error) {
      logger.error('[TriggerAudio] Delete audio error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// COMPANY VARIABLES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * PUT /:companyId/variables
 * Save company-specific variables for placeholder replacement
 */
router.put('/:companyId/variables',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { variables } = req.body;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      if (!variables || typeof variables !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'variables object is required'
        });
      }

      const company = await v2Company.findById(companyId).select('_id').lean();
      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      let settings = await CompanyTriggerSettings.findOne({ companyId });
      if (!settings) {
        settings = new CompanyTriggerSettings({ companyId });
      }

      // Detect which variables actually changed value
      const oldVariables = settings.companyVariables instanceof Map
        ? Object.fromEntries(settings.companyVariables)
        : (settings.companyVariables || {});
      
      const changedVarNames = [];
      for (const [varName, newValue] of Object.entries(variables)) {
        const oldValue = oldVariables[varName] || '';
        if (oldValue !== newValue) {
          changedVarNames.push(varName);
        }
      }

      settings.companyVariables = new Map(Object.entries(variables));
      settings.updatedAt = new Date();
      await settings.save();

      // If any variables changed, invalidate audio that uses them
      let invalidationResult = { invalidatedCount: 0, invalidatedRuleIds: [] };
      if (changedVarNames.length > 0) {
        invalidationResult = await TriggerAudio.invalidateAudioUsingVariables(companyId, changedVarNames);
        
        if (invalidationResult.invalidatedCount > 0) {
          logger.info('[CompanyTriggers] Audio invalidated due to variable change', {
            companyId,
            changedVariables: changedVarNames,
            invalidatedCount: invalidationResult.invalidatedCount,
            invalidatedRuleIds: invalidationResult.invalidatedRuleIds
          });
        }
      }

      logger.info('[CompanyTriggers] Company variables updated', {
        companyId,
        variableCount: settings.companyVariables.size,
        changedVariables: changedVarNames,
        updatedBy: userId
      });

      return res.json({
        success: true,
        data: {
          companyVariables: Object.fromEntries(settings.companyVariables),
          audioInvalidated: invalidationResult.invalidatedCount > 0,
          invalidatedRuleIds: invalidationResult.invalidatedRuleIds
        }
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Save variables error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// NAME GREETING — One-time opening line when caller name is captured
// Stored at: aiAgentSettings.agent2.discovery.nameGreeting
// ════════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/name-greeting',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const company = await v2Company.findById(companyId)
        .select('aiAgentSettings.agent2.discovery.nameGreeting')
        .lean();

      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      const settings = company.aiAgentSettings?.agent2?.discovery?.nameGreeting || {
        alwaysGreet: false,
        greetingLine: 'Hello {name}, thank you for calling.'
      };

      return res.json({ success: true, settings });
    } catch (error) {
      logger.error('[CompanyTriggers] Load name greeting error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.put('/:companyId/name-greeting',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { settings } = req.body;

      logger.info('[CompanyTriggers] Name greeting SAVE request', {
        companyId,
        receivedSettings: settings
      });

      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ success: false, error: 'settings object is required' });
      }

      const safeSettings = {
        alwaysGreet: settings.alwaysGreet === true,
        greetingLine: String(settings.greetingLine || '').trim().substring(0, 500) || 'Hello {name}, thank you for calling.',
        updatedAt: new Date()
      };

      logger.info('[CompanyTriggers] Name greeting SAVE sanitized', {
        companyId,
        safeSettings
      });

      // FIX: Use find + markModified + save pattern instead of findByIdAndUpdate
      // Mongoose doesn't reliably persist deeply nested changes with $set on Mixed schemas
      const company = await v2Company.findById(companyId);
      
      if (!company) {
        logger.error('[CompanyTriggers] Name greeting SAVE - Company not found!', { companyId });
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      // Ensure nested path exists
      if (!company.aiAgentSettings) company.aiAgentSettings = {};
      if (!company.aiAgentSettings.agent2) company.aiAgentSettings.agent2 = {};
      if (!company.aiAgentSettings.agent2.discovery) company.aiAgentSettings.agent2.discovery = {};
      
      // Set the value
      company.aiAgentSettings.agent2.discovery.nameGreeting = safeSettings;
      
      // CRITICAL: Mark the path as modified so Mongoose detects the change
      company.markModified('aiAgentSettings.agent2.discovery.nameGreeting');
      company.markModified('aiAgentSettings');
      
      await company.save();

      logger.info('[CompanyTriggers] Name greeting SAVE complete', {
        companyId,
        savedValue: company.aiAgentSettings?.agent2?.discovery?.nameGreeting
      });

      return res.json({ success: true, settings: safeSettings });
    } catch (error) {
      logger.error('[CompanyTriggers] Save name greeting error', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// PATIENCE SETTINGS — "Hold on" / "wait" behavior config
// Stored at: aiAgentSettings.agent2.discovery.patienceSettings
// ════════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/patience-settings',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const company = await v2Company.findById(companyId)
        .select('aiAgentSettings.agent2.discovery.patienceSettings')
        .lean();

      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      const settings = company.aiAgentSettings?.agent2?.discovery?.patienceSettings || {
        enabled: true,
        phrases: ['hold on', 'wait', 'one second', 'just a second', 'hang on', 'let me think', 'think about it', 'give me a moment', 'bear with me', 'please hold', 'standby', 'let me check', 'one moment', 'give me a sec'],
        initialResponse: "Take your time — I'm right here whenever you're ready.",
        timeoutEnabled: true,
        timeoutSeconds: 45,
        checkinResponse: "Are you still there? No rush — take your time.",
        maxCheckins: 2,
        finalResponse: "I'm still here whenever you're ready. Just let me know how I can help."
      };

      return res.json({ success: true, settings });
    } catch (error) {
      logger.error('[CompanyTriggers] Load patience settings error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.put('/:companyId/patience-settings',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { settings } = req.body;

      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ success: false, error: 'settings object is required' });
      }

      const safeSettings = {
        enabled: settings.enabled !== false,
        phrases: Array.isArray(settings.phrases) ? settings.phrases.map(p => String(p).trim().toLowerCase()).filter(Boolean) : [],
        initialResponse: String(settings.initialResponse || '').trim().substring(0, 500),
        timeoutEnabled: settings.timeoutEnabled !== false,
        timeoutSeconds: Math.max(10, Math.min(180, parseInt(settings.timeoutSeconds) || 45)),
        checkinResponse: String(settings.checkinResponse || '').trim().substring(0, 500),
        maxCheckins: Math.max(1, Math.min(10, parseInt(settings.maxCheckins) || 2)),
        finalResponse: String(settings.finalResponse || '').trim().substring(0, 500),
        updatedAt: new Date()
      };

      // FIX: Use find + markModified + save pattern instead of findByIdAndUpdate
      const company = await v2Company.findById(companyId);
      
      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      // Ensure nested path exists
      if (!company.aiAgentSettings) company.aiAgentSettings = {};
      if (!company.aiAgentSettings.agent2) company.aiAgentSettings.agent2 = {};
      if (!company.aiAgentSettings.agent2.discovery) company.aiAgentSettings.agent2.discovery = {};
      
      company.aiAgentSettings.agent2.discovery.patienceSettings = safeSettings;
      company.markModified('aiAgentSettings.agent2.discovery.patienceSettings');
      company.markModified('aiAgentSettings');
      
      await company.save();

      logger.info('[CompanyTriggers] Patience settings saved', {
        companyId,
        enabled: safeSettings.enabled,
        phraseCount: safeSettings.phrases.length,
        timeoutSeconds: safeSettings.timeoutSeconds
      });

      return res.json({ success: true, settings: safeSettings });
    } catch (error) {
      logger.error('[CompanyTriggers] Save patience settings error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// HEALTH & DUPLICATES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /:companyId/duplicates
 * Comprehensive integrity check:
 * - Local ruleId duplicates (should be impossible with unique index)
 * - Merged output duplicates (should be impossible with Map dedup)
 * - Settings array duplicates (hiddenGlobalTriggerIds)
 * - Orphaned overrides (pointing to non-existent global triggers)
 * - Semantic duplicates (same keywords/answer but different ruleId)
 * - Cross-layer collisions (local ruleId matches global but isn't an override)
 */
router.get('/:companyId/duplicates',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const issues = [];

      // ═══════════════════════════════════════════════════════════════════════
      // 1. Local ruleId duplicates (should be 0 if unique index exists)
      // ═══════════════════════════════════════════════════════════════════════
      const localDupes = await CompanyLocalTrigger.findDuplicatesForCompany(companyId);
      if (localDupes.length > 0) {
        issues.push({
          type: 'LOCAL_RULE_ID_DUPLICATE',
          severity: 'critical',
          message: `${localDupes.length} duplicate ruleId(s) in local triggers`,
          items: localDupes.map(d => ({ ruleId: d._id, count: d.count, triggers: d.docs }))
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 2. Settings integrity: hiddenGlobalTriggerIds duplicates
      // ═══════════════════════════════════════════════════════════════════════
      const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
      if (settings?.hiddenGlobalTriggerIds) {
        const hiddenSet = new Set();
        const hiddenDupes = [];
        for (const id of settings.hiddenGlobalTriggerIds) {
          if (hiddenSet.has(id)) {
            hiddenDupes.push(id);
          }
          hiddenSet.add(id);
        }
        if (hiddenDupes.length > 0) {
          issues.push({
            type: 'HIDDEN_IDS_DUPLICATE',
            severity: 'warning',
            message: `${hiddenDupes.length} duplicate(s) in hiddenGlobalTriggerIds`,
            items: hiddenDupes
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 3. Orphaned overrides (local override pointing to non-existent global)
      // ═══════════════════════════════════════════════════════════════════════
      const localTriggers = await CompanyLocalTrigger.findByCompanyId(companyId);
      const orphanedOverrides = [];
      for (const lt of localTriggers) {
        if (lt.isOverride && lt.overrideOfTriggerId) {
          const globalExists = await GlobalTrigger.findByTriggerId(lt.overrideOfTriggerId);
          if (!globalExists) {
            orphanedOverrides.push({
              triggerId: lt.triggerId,
              ruleId: lt.ruleId,
              overrideOfTriggerId: lt.overrideOfTriggerId
            });
          }
        }
      }
      if (orphanedOverrides.length > 0) {
        issues.push({
          type: 'ORPHANED_OVERRIDE',
          severity: 'warning',
          message: `${orphanedOverrides.length} override(s) point to non-existent global triggers`,
          items: orphanedOverrides
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 4. Cross-layer collision (local ruleId matches global but isn't override)
      // ═══════════════════════════════════════════════════════════════════════
      if (settings?.activeGroupId) {
        const globalTriggers = await GlobalTrigger.findByGroupId(settings.activeGroupId);
        const globalRuleIds = new Set(globalTriggers.map(gt => gt.ruleId));
        
        const collisions = localTriggers
          .filter(lt => !lt.isOverride && globalRuleIds.has(lt.ruleId))
          .map(lt => ({ ruleId: lt.ruleId, localTriggerId: lt.triggerId }));
        
        if (collisions.length > 0) {
          issues.push({
            type: 'CROSS_LAYER_COLLISION',
            severity: 'info',
            message: `${collisions.length} local trigger(s) have same ruleId as global (not overrides - will shadow global)`,
            items: collisions
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 5. Merged output check (should always be 0 due to Map dedup)
      // ═══════════════════════════════════════════════════════════════════════
      const merged = await buildMergedTriggerList(companyId);
      const ruleIdCounts = {};
      for (const t of merged.triggers) {
        ruleIdCounts[t.ruleId] = (ruleIdCounts[t.ruleId] || 0) + 1;
      }
      const mergedDupes = Object.entries(ruleIdCounts)
        .filter(([, count]) => count > 1)
        .map(([ruleId, count]) => ({ ruleId, count }));
      
      if (mergedDupes.length > 0) {
        issues.push({
          type: 'MERGED_OUTPUT_DUPLICATE',
          severity: 'critical',
          message: `${mergedDupes.length} duplicate(s) in merged output - this should not happen`,
          items: mergedDupes
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 6. Missing activeGroupId reference
      // ═══════════════════════════════════════════════════════════════════════
      if (settings?.activeGroupId) {
        const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);
        if (!group) {
          issues.push({
            type: 'MISSING_ACTIVE_GROUP',
            severity: 'warning',
            message: `Active group "${settings.activeGroupId}" does not exist`,
            items: [{ activeGroupId: settings.activeGroupId }]
          });
        }
      }

      const criticalCount = issues.filter(i => i.severity === 'critical').length;
      const warningCount = issues.filter(i => i.severity === 'warning').length;

      return res.json({
        success: true,
        healthy: issues.length === 0,
        criticalIssues: criticalCount,
        warningIssues: warningCount,
        infoIssues: issues.filter(i => i.severity === 'info').length,
        issues,
        companyId,
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Integrity check error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /:companyId/fix-duplicates
 * Fix duplicate triggers (AUTO-FIX with safety controls)
 * 
 * SAFETY RULES:
 * - Dry-run by default (execute=false)
 * - Requires admin approval text
 * - Soft deletes (marks isDeleted=true, doesn't hard delete)
 * - Returns detailed audit log of changes
 * - Uses "latest edited wins" rule for conflict resolution
 */
router.post('/:companyId/fix-duplicates',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';
      const { execute, approvalText } = req.body;

      // ═══════════════════════════════════════════════════════════════════════
      // SAFETY: Require approval for actual execution
      // ═══════════════════════════════════════════════════════════════════════
      const isDryRun = execute !== true;
      
      if (!isDryRun) {
        if (!approvalText || approvalText.toLowerCase() !== 'approved') {
          return res.status(400).json({
            success: false,
            error: 'APPROVAL_REQUIRED',
            message: 'To execute fixes, set execute=true and approvalText="approved"'
          });
        }
      }

      const auditLog = [];
      const fixes = [];

      // ═══════════════════════════════════════════════════════════════════════
      // 1. Fix hiddenGlobalTriggerIds duplicates
      // ═══════════════════════════════════════════════════════════════════════
      const settings = await CompanyTriggerSettings.findOne({ companyId });
      if (settings?.hiddenGlobalTriggerIds?.length > 0) {
        const uniqueHidden = [...new Set(settings.hiddenGlobalTriggerIds)];
        if (uniqueHidden.length !== settings.hiddenGlobalTriggerIds.length) {
          const removed = settings.hiddenGlobalTriggerIds.length - uniqueHidden.length;
          fixes.push({
            type: 'HIDDEN_IDS_DEDUPED',
            removed,
            before: settings.hiddenGlobalTriggerIds.length,
            after: uniqueHidden.length
          });
          auditLog.push({
            action: 'DEDUPE_HIDDEN_IDS',
            removed,
            timestamp: new Date()
          });

          if (!isDryRun) {
            settings.hiddenGlobalTriggerIds = uniqueHidden;
            await settings.save();
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 2. Find and soft-delete duplicate local triggers
      // Latest edited wins, others get soft-deleted
      // ═══════════════════════════════════════════════════════════════════════
      const localTriggers = await CompanyLocalTrigger.find({ 
        companyId, 
        isDeleted: { $ne: true } 
      }).sort({ updatedAt: -1 });

      const seenRuleIds = new Map();
      const toSoftDelete = [];

      for (const trigger of localTriggers) {
        if (seenRuleIds.has(trigger.ruleId)) {
          // This is a duplicate - mark for soft delete
          toSoftDelete.push({
            trigger,
            keptTriggerId: seenRuleIds.get(trigger.ruleId).triggerId,
            reason: 'DEDUPED_LATEST_WINS'
          });
        } else {
          seenRuleIds.set(trigger.ruleId, trigger);
        }
      }

      if (toSoftDelete.length > 0) {
        fixes.push({
          type: 'LOCAL_TRIGGERS_DEDUPED',
          count: toSoftDelete.length,
          items: toSoftDelete.map(d => ({
            triggerId: d.trigger.triggerId,
            ruleId: d.trigger.ruleId,
            keptTriggerId: d.keptTriggerId,
            reason: d.reason
          }))
        });

        for (const item of toSoftDelete) {
          auditLog.push({
            action: 'SOFT_DELETE_DUPLICATE',
            triggerId: item.trigger.triggerId,
            ruleId: item.trigger.ruleId,
            keptTriggerId: item.keptTriggerId,
            reason: item.reason,
            timestamp: new Date()
          });

          if (!isDryRun) {
            await CompanyLocalTrigger.updateOne(
              { _id: item.trigger._id },
              {
                $set: {
                  isDeleted: true,
                  deletedAt: new Date(),
                  deletedBy: userId,
                  deletedReason: item.reason
                }
              }
            );
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 3. Log the operation
      // ═══════════════════════════════════════════════════════════════════════
      logger.info('[CompanyTriggers] Fix duplicates', {
        companyId,
        isDryRun,
        fixCount: fixes.length,
        userId
      });

      return res.json({
        success: true,
        isDryRun,
        message: isDryRun 
          ? 'Dry run complete. Set execute=true and approvalText="approved" to apply fixes.'
          : 'Fixes applied successfully.',
        fixes,
        auditLog,
        companyId,
        fixedAt: isDryRun ? null : new Date().toISOString(),
        fixedBy: isDryRun ? null : userId
      });
    } catch (error) {
      logger.error('[CompanyTriggers] Fix duplicates error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
