/**
 * ============================================================================
 * TRIGGER SERVICE - Runtime trigger loading and merging
 * ============================================================================
 *
 * MULTI-TENANT ARCHITECTURE:
 * 
 * Each company has their OWN trigger collection (CompanyLocalTrigger).
 * Triggers can be:
 *   - LOCAL: Private to that company only (default)
 *   - GLOBAL: Published to a shared group template (e.g., "HVAC")
 * 
 * HOW LOCAL/GLOBAL WORKS:
 * 1. Company creates a trigger → stored in CompanyLocalTrigger with their companyId
 * 2. By default, trigger is LOCAL (only that company sees it at runtime)
 * 3. Admin toggles trigger to GLOBAL → it becomes part of the group template
 * 4. Other companies using the same group (e.g., "HVAC") will see GLOBAL triggers
 * 
 * EXAMPLE:
 *   - Penguin Air (HVAC company) creates "gas leak emergency" trigger
 *   - Toggles it to GLOBAL
 *   - Now ALL companies in the HVAC group see that trigger
 *   - Each company can still override the answer text for their business
 * 
 * RUNTIME MERGE:
 * 1. Load CompanyLocalTrigger (company's own triggers - both local and global-toggled)
 * 2. Load GlobalTrigger (triggers other companies published to this group)
 * 3. Merge both pools
 * 4. Dedupe by ruleId
 * 5. Sort by priority
 *
 * CACHE STRATEGY:
 * - Cache key includes: companyId, activeGroupId, groupVersion
 * - Automatic invalidation when data changes
 * - Safe multi-tenant isolation via key structure
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

const GlobalTriggerGroup = require('../../../models/GlobalTriggerGroup');
const GlobalTrigger = require('../../../models/GlobalTrigger');
const CompanyLocalTrigger = require('../../../models/CompanyLocalTrigger');
const CompanyTriggerSettings = require('../../../models/CompanyTriggerSettings');
const TriggerAudio = require('../../../models/TriggerAudio');

// ════════════════════════════════════════════════════════════════════════════════
// CACHE CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

const triggerCache = new Map();
const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function buildCacheKey(companyId, activeGroupId, groupVersion) {
  return `triggers:${companyId}:${activeGroupId || 'none'}:v${groupVersion || 0}`;
}

function getCachedTriggers(cacheKey) {
  const cached = triggerCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    triggerCache.delete(cacheKey);
    return null;
  }
  
  return cached.data;
}

function setCachedTriggers(cacheKey, data) {
  if (triggerCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = triggerCache.keys().next().value;
    triggerCache.delete(oldestKey);
  }
  
  triggerCache.set(cacheKey, {
    data,
    timestamp: Date.now()
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// CACHE INVALIDATION
// ════════════════════════════════════════════════════════════════════════════════

function invalidateCacheForCompany(companyId) {
  const keysToDelete = [];
  for (const key of triggerCache.keys()) {
    if (key.includes(`:${companyId}:`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => triggerCache.delete(key));
  
  logger.debug('[TriggerService] Cache invalidated for company', {
    companyId,
    keysDeleted: keysToDelete.length
  });
}

function invalidateCacheForGroup(groupId) {
  const keysToDelete = [];
  for (const key of triggerCache.keys()) {
    if (key.includes(`:${groupId}:`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => triggerCache.delete(key));
  
  logger.debug('[TriggerService] Cache invalidated for group', {
    groupId,
    keysDeleted: keysToDelete.length
  });
}

function invalidateAllCache() {
  const size = triggerCache.size;
  triggerCache.clear();
  
  logger.info('[TriggerService] All cache cleared', { entriesCleared: size });
}

// ════════════════════════════════════════════════════════════════════════════════
// AUDIO VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Checks database validity (isValid flag + text hash match + audioData exists).
 * Audio binary is stored in MongoDB and served via a self-healing fallback
 * route, so filesystem existence is no longer a gating factor.
 * 
 * V130: Also verify audioData exists - prevents 404s when record exists but binary is missing
 */
function resolveAudioUrl(companyAudio, effectiveAnswerText) {
  if (!companyAudio || !companyAudio.isValid) return '';
  if (!companyAudio.hasAudioData) return '';  // V130: Binary must exist (from findByCompanyId)
  if (companyAudio.textHash !== TriggerAudio.hashText(effectiveAnswerText)) return '';
  return companyAudio.audioUrl || '';
}

// ════════════════════════════════════════════════════════════════════════════════
// TRIGGER LOADING
// ════════════════════════════════════════════════════════════════════════════════

async function loadTriggersForCompany(companyId, options = {}) {
  const { useCache = true, includeMeta = false } = options;
  
  const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
  
  let groupVersion = null;
  let groupInfo = null;
  let isGroupPublished = false;
  
  if (settings && settings.activeGroupId) {
    const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);
    if (group) {
      // VERSIONING MODEL: publishedVersion-only
      // Only serve global triggers if group is published (publishedVersion > 0)
      // Draft groups (publishedVersion = 0) don't serve triggers to companies
      isGroupPublished = group.publishedVersion > 0;
      groupVersion = group.publishedVersion;
      groupInfo = {
        groupId: group.groupId,
        name: group.name,
        publishedVersion: group.publishedVersion,
        isDraft: group.isDraft,
        isPublished: isGroupPublished
      };
    }
  }

  const cacheKey = buildCacheKey(companyId, settings?.activeGroupId, groupVersion);
  
  if (useCache) {
    const cached = getCachedTriggers(cacheKey);
    if (cached) {
      logger.info('[TriggerService] 🔍 CACHE_HIT', { 
        companyId, 
        cacheKey,
        cachedTriggerCount: cached.length,
        cachedFirstRuleId: cached[0]?.ruleId || null
      });
      return includeMeta ? { triggers: cached, meta: { fromCache: true, groupInfo } } : cached;
    }
  }
  
  logger.info('[TriggerService] 🔍 CACHE_MISS', { 
    companyId, 
    cacheKey,
    willQueryDatabase: true
  });

  // VISIBILITY: Warn when a group is assigned but not published — triggers will be empty.
  // This surfaces the silent blackout that previously made the system fall to LLM
  // with no indication of why. Visible in call console as TRIGGERS_GROUP_NOT_PUBLISHED.
  if (settings?.activeGroupId && !isGroupPublished) {
    logger.warn('[TriggerService] ⚠️ Active group exists but is NOT published — zero global triggers will load', {
      companyId,
      activeGroupId: settings.activeGroupId,
      publishedVersion: groupInfo?.publishedVersion ?? 0,
      isDraft: groupInfo?.isDraft,
      action: 'Publish the trigger group in the admin console to activate triggers'
    });
  }

  // Pass isGroupPublished to merge - if not published, global triggers are not loaded
  const triggers = await mergeTriggers(companyId, settings, groupInfo, isGroupPublished, options);

  setCachedTriggers(cacheKey, triggers);

  // VISIBILITY: Warn if the final compiled pool is empty — admin should know immediately.
  if (triggers.length === 0) {
    logger.warn('[TriggerService] ⚠️ Trigger pool is EMPTY — all calls will fall through to LLM fallback', {
      companyId,
      activeGroupId: settings?.activeGroupId || null,
      isGroupPublished,
      hint: !settings?.activeGroupId
        ? 'No trigger group assigned to this company'
        : !isGroupPublished
          ? 'Trigger group is assigned but not published'
          : 'Group is published but contains no enabled triggers'
    });
  }

  logger.debug('[TriggerService] Triggers loaded', {
    companyId,
    activeGroupId: settings?.activeGroupId,
    isGroupPublished,
    triggerCount: triggers.length
  });

  return includeMeta ? { triggers, meta: { fromCache: false, groupInfo } } : triggers;
}

// ════════════════════════════════════════════════════════════════════════════════
// MERGE LOGIC
// ════════════════════════════════════════════════════════════════════════════════

async function mergeTriggers(companyId, settings, groupInfo, isGroupPublished = true) {
  let globalTriggers = [];
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL RUNTIME FILTERS:
  // - Global: state='published', enabled=true, isDeleted!=true
  // - Local: enabled=true, isDeleted!=true
  // These filters are enforced at the query level (not post-filter)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Load ONLY published global triggers (never draft - prevents draft leakage)
  if (settings && settings.activeGroupId && isGroupPublished) {
    const rawGlobalTriggers = await GlobalTrigger.findPublishedByGroupId(settings.activeGroupId);
    // CRITICAL FIX: .lean() returns raw docs without methods, so we must manually transform
    // to the TriggerCardMatcher format which expects card.match.keywords (not card.keywords)
    globalTriggers = rawGlobalTriggers.map(gt => {
      if (gt.toMatcherFormat) {
        return gt.toMatcherFormat();
      }
      // Manual transformation for lean() results - mirrors toMatcherFormat()
      return {
        id: gt.triggerId,
        ruleId: gt.ruleId,
        triggerId: gt.triggerId,
        enabled: gt.enabled,
        priority: gt.priority ?? 50,
        label: gt.label,
        maxInputWords: typeof gt.maxInputWords === 'number' ? gt.maxInputWords : undefined,
        match: {
          keywords: gt.keywords || [],
          phrases: gt.phrases || [],
          negativeKeywords: gt.negativeKeywords || [],
          negativePhrases:  gt.negativePhrases  || [],
          scenarioTypeAllowlist: gt.scenarioTypeAllowlist || []
        },
        responseMode: gt.responseMode || 'standard',
        answer: {
          answerText: gt.answerText || '',
          audioUrl: gt.audioUrl || ''
        },
        followUp: {
          question: gt.followUpQuestion || '',
          nextAction: gt.followUpNextAction || ''
        },
        llmFactPack: gt.responseMode === 'llm' && gt.llmFactPack ? {
          includedFacts: gt.llmFactPack.includedFacts || '',
          excludedFacts: gt.llmFactPack.excludedFacts || '',
          backupAnswer: gt.llmFactPack.backupAnswer || ''
        } : null,
        _scope: 'GLOBAL'
      };
    });
  }

  // Load ONLY active local triggers (enabled=true, isDeleted!=true)
  const rawLocalTriggers = await CompanyLocalTrigger.findActiveByCompanyId(companyId);
  
  // 🔍 DIAGNOSTIC: Log what we actually loaded
  logger.info('[TriggerService] 🔍 LOCAL_LOADED', {
    callSid,
    companyId,
    toPhone,
    localCount: rawLocalTriggers.length,
    globalCount: globalTriggers.length,
    firstLocalRuleId: rawLocalTriggers[0]?.ruleId || null,
    firstLocalLabel: rawLocalTriggers[0]?.label || null,
    queryMethod: 'CompanyLocalTrigger.findActiveByCompanyId',
    queryFilters: { companyId, enabled: true, isDeleted: { $ne: true } },
    collectionQueried: 'companyLocalTriggers'
  });
  
  // 🚨 CRITICAL ASSERTION: If this is Penguin and we get 0, something is WRONG
  if (companyId === '68e3f77a9d623b8058c700c4' && rawLocalTriggers.length === 0) {
    logger.error('[TriggerService] 🚨 ASSERTION_FAILED', {
      callSid,
      companyId,
      toPhone,
      expected: 42,
      actual: 0,
      message: 'Penguin Air should have 42 local triggers but query returned 0',
      mongoHost: mongoose.connection.host,
      mongoDbName: mongoose.connection.name,
      possibleCauses: [
        '1. Wrong companyId passed to this function',
        '2. Wrong MongoDB connection (different DB than UI)',
        '3. Field name mismatch (enabled vs isEnabled)',
        '4. Collection name mismatch'
      ]
    });
  }
  
  // CRITICAL FIX: .lean() returns raw docs without methods, so we must manually transform
  // to the TriggerCardMatcher format which expects card.match.keywords (not card.keywords)
  const localTriggers = rawLocalTriggers.map(lt => {
    if (lt.toMatcherFormat) {
      return lt.toMatcherFormat();
    }
    // Manual transformation for lean() results - mirrors toMatcherFormat()
    return {
      id: lt.triggerId,
      ruleId: lt.ruleId,
      triggerId: lt.triggerId,
      enabled: lt.enabled,
      priority: lt.priority ?? 50,
      label: lt.label,
      maxInputWords: typeof lt.maxInputWords === 'number' ? lt.maxInputWords : undefined,
      match: {
        keywords: lt.keywords || [],
        phrases: lt.phrases || [],
        negativeKeywords: lt.negativeKeywords || [],
        negativePhrases:  lt.negativePhrases  || [],
        scenarioTypeAllowlist: lt.scenarioTypeAllowlist || []
      },
      responseMode: lt.responseMode || 'standard',
      answer: {
        answerText: lt.answerText || '',
        audioUrl: lt.audioUrl || ''
      },
      followUp: {
        question: lt.followUpQuestion || '',
        nextAction: lt.followUpNextAction || ''
      },
      llmFactPack: lt.responseMode === 'llm' && lt.llmFactPack ? {
        includedFacts: lt.llmFactPack.includedFacts || '',
        excludedFacts: lt.llmFactPack.excludedFacts || '',
        backupAnswer: lt.llmFactPack.backupAnswer || ''
      } : null,
      _scope: 'LOCAL',
      _isOverride: lt.isOverride,
      _overrideOfGroupId: lt.overrideOfGroupId,
      _overrideOfRuleId: lt.overrideOfRuleId,
      _overrideOfTriggerId: lt.overrideOfTriggerId
    };
  });
  
  // Load company-specific audio recordings
  const audioRecordings = await TriggerAudio.findByCompanyId(companyId);
  const audioMap = new Map();
  audioRecordings.forEach(a => {
    audioMap.set(a.ruleId, a);
  });

  const hiddenSet = new Set(settings?.hiddenGlobalTriggerIds || []);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PARTIAL OVERRIDES: partialOverrides is now a Map (keyed by globalTriggerId)
  // ═══════════════════════════════════════════════════════════════════════════
  const partialOverrideMap = new Map();
  if (settings?.partialOverrides) {
    const overrides = settings.partialOverrides instanceof Map 
      ? settings.partialOverrides 
      : new Map(Object.entries(settings.partialOverrides || {}));
    overrides.forEach((value, key) => {
      partialOverrideMap.set(key, value);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL OVERRIDES: Map by overrideOfRuleId (NEVER parse IDs)
  // This is the canonical key that guarantees correct Map behavior at runtime
  // ═══════════════════════════════════════════════════════════════════════════
  const fullOverrideByRuleId = new Map();
  localTriggers.forEach(lt => {
    if (lt._isOverride && lt._overrideOfRuleId) {
      fullOverrideByRuleId.set(lt._overrideOfRuleId, lt);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE: Map keyed by ruleId guarantees no duplicates in output
  // CRITICAL: Always use .ruleId as the canonical key (never _id, never triggerId)
  // ═══════════════════════════════════════════════════════════════════════════
  const triggerMap = new Map();

  for (const gt of globalTriggers) {
    if (hiddenSet.has(gt.triggerId)) {
      continue;
    }

    // Check for full override by ruleId (canonical key)
    if (fullOverrideByRuleId.has(gt.ruleId)) {
      continue;
    }

    const partialOverride = partialOverrideMap.get(gt.triggerId);
    const companyAudio = audioMap.get(gt.ruleId);
    
    const trigger = {
      ...gt,
      _scope: 'GLOBAL',
      _originGroupId: groupInfo?.groupId || null,
      _isPartiallyOverridden: Boolean(partialOverride)
    };

    // Apply partial override (text only - audio is always company-specific)
    if (partialOverride) {
      if (partialOverride.answerText) {
        trigger.answer = { ...trigger.answer, answerText: partialOverride.answerText };
      }
    }
    
    // Apply company-specific audio (if valid for current text AND file exists on disk)
    const effectiveAnswerText = partialOverride?.answerText || gt.answerText;
    const audioUrl = resolveAudioUrl(companyAudio, effectiveAnswerText);
    trigger.answer = { ...trigger.answer, audioUrl };

    // CANONICAL KEY: Always use ruleId for Map operations
    triggerMap.set(gt.ruleId, trigger);
  }

  for (const lt of localTriggers) {
    const companyAudio = audioMap.get(lt.ruleId);
    
    // Check if company has valid audio for this trigger's current text AND file exists
    const audioUrl = resolveAudioUrl(companyAudio, lt.answerText);

    const trigger = {
      ...lt,
      _scope: 'LOCAL'
    };
    
    trigger.answer = { ...trigger.answer, audioUrl };

    // CANONICAL KEY: Always use ruleId - this overwrites any global with same ruleId
    triggerMap.set(lt.ruleId, trigger);
  }

  const triggers = Array.from(triggerMap.values());

  // PRIORITY SEMANTICS: Lower number = higher priority, sort ASCENDING
  // priority 1 beats priority 10; default to 9999 if missing
  triggers.sort((a, b) => {
    const priorityA = typeof a.priority === 'number' ? a.priority : 9999;
    const priorityB = typeof b.priority === 'number' ? b.priority : 9999;
    return priorityA - priorityB;
  });

  return triggers;
}

// ════════════════════════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Transform a legacy playbook.rules card (flat format) into the TriggerCardMatcher
 * format (card.match.keywords / card.answer.answerText / card.followUp.question).
 *
 * Legacy cards are stored directly in company.aiAgentSettings.agent2.discovery.playbook.rules
 * and have a flat structure:  { ruleId, keywords, phrases, negativeKeywords, answerText, followUpQuestion }
 *
 * TriggerCardMatcher expects:  { id, match: { keywords, phrases, negativeKeywords }, answer: { answerText }, followUp: { question } }
 *
 * Without this transform, TriggerCardMatcher reads card.match?.keywords = undefined → safeArr([]) → zero matches ever fire.
 */
function transformLegacyCard(card) {
  if (!card) return null;

  // Already in new format — has card.match structure
  if (card.match && typeof card.match === 'object') return card;

  return {
    id:        card.id || card.ruleId || card.triggerId,
    ruleId:    card.ruleId || card.id,
    triggerId: card.triggerId || card.ruleId || card.id,
    enabled:   card.enabled !== false,
    priority:  typeof card.priority === 'number' ? card.priority : 50,
    label:     card.label || card.ruleId || '',
    match: {
      keywords:         card.keywords         || [],
      phrases:          card.phrases          || [],
      negativeKeywords: card.negativeKeywords  || [],
      negativePhrases:  card.negativePhrases   || [],
      scenarioTypeAllowlist: card.scenarioTypeAllowlist || []
    },
    responseMode: card.responseMode || 'standard',
    answer: {
      answerText: card.answerText || card.answer?.answerText || '',
      audioUrl:   card.audioUrl   || card.answer?.audioUrl   || ''
    },
    followUp: {
      question:   card.followUpQuestion  || card.followUp?.question   || '',
      nextAction: card.followUpNextAction || card.followUp?.nextAction || 'CONTINUE'
    },
    llmFactPack: card.llmFactPack || null,
    _scope: 'LEGACY'
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STRICT TRIGGER SYSTEM - UNIFIED LOADER (V131)
// ════════════════════════════════════════════════════════════════════════════════
// This is the ONLY entry point for loading triggers at runtime.
// It enforces strict mode and tracks legacy usage.
//
// STRICT MODE (default):
// - Only GlobalTrigger + CompanyLocalTrigger are loaded
// - Legacy playbook.rules is NEVER used
// - Empty pool returns empty array (caller handles warning)
//
// LEGACY MODE (explicit opt-in):
// - Falls back to playbook.rules if no other triggers exist
// - Records usage for auditing
// - Returns metadata indicating legacy was used
// ════════════════════════════════════════════════════════════════════════════════

async function loadTriggersWithLegacyFallback(companyId, legacyConfig, options = {}) {
  const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
  
  // Track metadata for caller
  const loadMetadata = {
    strictMode: true,  // Always true, no legacy mode
    legacyUsed: false,
    legacyCardCount: 0,
    source: null,
    activeGroupId: settings?.activeGroupId || null,
    isGroupPublished: false
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ONLY PATH: Load from official GlobalTrigger system
  // ═══════════════════════════════════════════════════════════════════════════
  // NEW PLATFORM: activeGroupId is REQUIRED. No fallback, no legacy mode.
  
  if (!settings || !settings.activeGroupId) {
    // CRITICAL ERROR: Company has no trigger group assigned
    logger.error('[TriggerService] 🚨 CRITICAL: Company has no activeGroupId assigned', {
      companyId,
      hasSettings: Boolean(settings),
      action: 'ASSIGN_TRIGGER_GROUP_IMMEDIATELY',
      impact: 'All calls will fall to generic fallback',
      remediation: 'Run: CompanyTriggerSettings.setActiveGroup(companyId, "hvac-master-v1", 1, "admin")'
    });
    
    loadMetadata.source = 'EMPTY_NO_GROUP';
    const emptyResult = [];
    emptyResult._loadMetadata = loadMetadata;
    return emptyResult;
  }
  
  // Load triggers from official GlobalTrigger + CompanyLocalTrigger system
  const result = await loadTriggersForCompany(companyId, { includeMeta: true });
  const triggers = result.triggers || result;
  const groupInfo = result.meta?.groupInfo;
  
  loadMetadata.source = 'OFFICIAL_LIBRARY';
  loadMetadata.activeGroupId = settings.activeGroupId;
  loadMetadata.isGroupPublished = groupInfo?.isPublished || false;
  
  if (triggers.length === 0) {
    logger.error('[TriggerService] 🚨 CRITICAL: Trigger pool is EMPTY despite activeGroupId', {
      companyId,
      activeGroupId: settings.activeGroupId,
      isGroupPublished: groupInfo?.isPublished,
      action: 'VERIFY_GROUP_IS_PUBLISHED_AND_HAS_TRIGGERS'
    });
  }
  
  // Attach metadata
  triggers._loadMetadata = loadMetadata;
  return triggers;

  // ═══════════════════════════════════════════════════════════════════════════
  // NO TRIGGERS FOUND — CRITICAL ERROR
  // ═══════════════════════════════════════════════════════════════════════════
  // NEW PLATFORM: No legacy fallback, no migration mode.
  // If triggers aren't found, it's a configuration error that must be fixed.
  
  logger.error('[TriggerService] 🚨 CRITICAL: No triggers found for company', {
    companyId,
    hasSettings: Boolean(settings),
    hasActiveGroupId: Boolean(settings?.activeGroupId),
    action: 'ASSIGN_TRIGGER_GROUP_IMMEDIATELY',
    impact: 'All calls falling through to generic fallback',
    remediation: 'Ensure company has activeGroupId set to a published trigger group'
  });
  
  loadMetadata.source = 'EMPTY_NO_TRIGGERS';
  const emptyResult = [];
  emptyResult._loadMetadata = loadMetadata;
  return emptyResult;
}

// ════════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════════════

async function checkDuplicates(companyId) {
  const triggers = await loadTriggersForCompany(companyId, { useCache: false });
  
  const ruleIdCounts = {};
  for (const t of triggers) {
    const ruleId = t.id || t.ruleId;
    ruleIdCounts[ruleId] = (ruleIdCounts[ruleId] || 0) + 1;
  }
  
  const duplicates = Object.entries(ruleIdCounts)
    .filter(([_, count]) => count > 1)
    .map(([ruleId, count]) => ({ ruleId, count }));
  
  return {
    healthy: duplicates.length === 0,
    duplicates,
    totalTriggers: triggers.length
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STRICT TRIGGER SYSTEM - COMPREHENSIVE HEALTH CHECK (V131)
// ════════════════════════════════════════════════════════════════════════════════
// Returns a full health report for a company's trigger system.
// Call this on startup, on publish, or on-demand via admin API.
// ════════════════════════════════════════════════════════════════════════════════

async function checkTriggerSystemHealth(companyId, legacyConfig = null) {
  const issues = [];
  const warnings = [];
  const info = [];
  
  // 1. Load settings
  const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
  const isStrictMode = settings?.strictMode !== false;
  
  info.push({
    code: 'STRICT_MODE_STATUS',
    message: isStrictMode ? 'Strict mode is ENABLED (legacy blocked)' : 'Strict mode is DISABLED (legacy allowed)',
    strictMode: isStrictMode
  });
  
  // 2. Check if group is assigned
  const hasActiveGroup = Boolean(settings?.activeGroupId);
  if (!hasActiveGroup) {
    warnings.push({
      code: 'NO_ACTIVE_GROUP',
      message: 'No global trigger group assigned — company relies on local triggers only',
      remediation: 'Assign a global trigger group in Triggers admin'
    });
  }
  
  // 3. Count local triggers
  const localTriggers = await CompanyLocalTrigger.findByCompanyId(companyId);
  const activeLocalCount = localTriggers.filter(t => t.enabled && !t.isDeleted).length;
  
  info.push({
    code: 'LOCAL_TRIGGER_COUNT',
    message: `${activeLocalCount} active local triggers`,
    total: localTriggers.length,
    active: activeLocalCount
  });
  
  // 4. Check for legacy playbook.rules
  const hasLegacyRules = Boolean(legacyConfig?.discovery?.playbook?.rules?.length);
  const legacyCount = legacyConfig?.discovery?.playbook?.rules?.length || 0;
  
  if (hasLegacyRules) {
    if (isStrictMode) {
      info.push({
        code: 'LEGACY_BLOCKED',
        message: `${legacyCount} legacy playbook.rules exist but are BLOCKED by strict mode`,
        legacyCount,
        blocked: true
      });
    } else {
      warnings.push({
        code: 'LEGACY_ACTIVE',
        message: `${legacyCount} legacy playbook.rules may be loaded at runtime — enable strict mode to prevent`,
        legacyCount,
        remediation: 'Enable strict mode OR migrate legacy triggers to CompanyLocalTrigger'
      });
    }
  }
  
  // 5. Check for empty trigger pool
  const totalAvailable = activeLocalCount + (hasActiveGroup ? 1 : 0); // Rough check
  if (activeLocalCount === 0 && !hasActiveGroup) {
    issues.push({
      code: 'TRIGGER_POOL_EMPTY',
      severity: 'CRITICAL',
      message: 'No triggers will load at runtime — all calls will fall through to LLM fallback',
      remediation: 'Create local triggers OR assign a global trigger group'
    });
  }
  
  // 6. Check for duplicate ruleIds
  const duplicateCheck = await checkDuplicates(companyId);
  if (!duplicateCheck.healthy) {
    issues.push({
      code: 'DUPLICATE_RULE_IDS',
      severity: 'ERROR',
      message: `${duplicateCheck.duplicates.length} duplicate ruleIds found`,
      duplicates: duplicateCheck.duplicates,
      remediation: 'Remove duplicate triggers — only one trigger per ruleId is allowed'
    });
  }
  
  // 7. Check for required fields in local triggers (isomorphic validation)
  const triggersWithoutAnswerText = localTriggers.filter(t => 
    !t.isDeleted && t.enabled && t.responseMode !== 'llm' && !t.answerText
  );
  if (triggersWithoutAnswerText.length > 0) {
    issues.push({
      code: 'MISSING_ANSWER_TEXT',
      severity: 'ERROR',
      message: `${triggersWithoutAnswerText.length} enabled triggers have no answerText`,
      triggerIds: triggersWithoutAnswerText.slice(0, 5).map(t => t.ruleId),
      remediation: 'Add answer text to all standard-mode triggers'
    });
  }
  
  // 8. Track legacy fallback usage
  if (settings?.legacyFallbackCount > 0) {
    warnings.push({
      code: 'LEGACY_USAGE_HISTORY',
      message: `Legacy fallback has been used ${settings.legacyFallbackCount} times`,
      lastUsed: settings.lastLegacyFallbackAt,
      count: settings.legacyFallbackCount,
      remediation: 'Enable strict mode to prevent future legacy usage'
    });
  }
  
  // Compile health report
  const isHealthy = issues.length === 0;
  const healthScore = Math.max(0, 100 - (issues.length * 25) - (warnings.length * 10));
  
  return {
    companyId,
    healthy: isHealthy,
    healthScore,
    strictMode: isStrictMode,
    timestamp: new Date().toISOString(),
    summary: {
      issueCount: issues.length,
      warningCount: warnings.length,
      infoCount: info.length,
      localTriggerCount: activeLocalCount,
      hasActiveGroup,
      hasLegacyRules,
      legacyBlocked: isStrictMode && hasLegacyRules
    },
    issues,
    warnings,
    info
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  loadTriggersForCompany,
  loadTriggersWithLegacyFallback,
  
  invalidateCacheForCompany,
  invalidateCacheForGroup,
  invalidateAllCache,
  
  checkDuplicates,
  checkTriggerSystemHealth,  // V131: Comprehensive health check
  resolveAudioUrl,
  
  buildCacheKey,
  
  _internal: {
    triggerCache,
    mergeTriggers
  }
};
