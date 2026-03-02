/**
 * ============================================================================
 * TRIGGER SERVICE - Runtime trigger loading and merging
 * ============================================================================
 *
 * This service handles loading and merging triggers for runtime use.
 * It combines global triggers (from the company's selected group) with
 * local triggers, applying visibility and override rules.
 *
 * CACHE STRATEGY:
 * - Cache key includes: companyId, activeGroupId, groupVersion
 * - Automatic invalidation when data changes
 * - Safe multi-tenant isolation via key structure
 *
 * MERGE RULES:
 * 1. Load global triggers from active group
 * 2. Remove hidden global triggers
 * 3. Apply partial overrides to global triggers
 * 4. Replace global triggers with full local overrides
 * 5. Add pure local triggers
 * 6. Dedupe by ruleId (Map-based, guaranteed no duplicates)
 * 7. Sort by priority
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
      logger.debug('[TriggerService] Cache hit', { companyId, cacheKey });
      return includeMeta ? { triggers: cached, meta: { fromCache: true, groupInfo } } : cached;
    }
  }

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
  const triggers = await mergeTriggers(companyId, settings, groupInfo, isGroupPublished);

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

async function loadTriggersWithLegacyFallback(companyId, legacyConfig) {
  const settings = await CompanyTriggerSettings.findByCompanyId(companyId);

  if (!settings || !settings.activeGroupId) {
    // ── CRITICAL FIX (V130): ALWAYS load CompanyLocalTriggers ──────────────────
    // Previously this path returned ONLY the legacy playbook.rules when no
    // activeGroupId was set, completely ignoring CompanyLocalTrigger documents.
    //
    // This caused the bug where 42 triggers visible in the Trigger Console were
    // completely invisible to the runtime — they existed in CompanyLocalTrigger
    // but were never loaded because the short-circuit returned before reaching
    // the code that loads local triggers (which lives in loadTriggersForCompany).
    //
    // Fix: ALWAYS load CompanyLocalTriggers, then layer legacy cards as a fallback
    // only if the local trigger pool is empty.
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const localTriggers = await CompanyLocalTrigger.findActiveByCompanyId(companyId);

      if (localTriggers && localTriggers.length > 0) {
        // Company has local triggers configured — use them exclusively.
        // Map to TriggerCardMatcher format (same transform as mergeTriggers does).
        const audioRecordings = await TriggerAudio.findByCompanyId(companyId);
        const audioMap = new Map();
        audioRecordings.forEach(a => { audioMap.set(a.ruleId, a); });

        const formatted = localTriggers.map(lt => {
          if (lt.toMatcherFormat) return lt.toMatcherFormat();
          const audioUrl = resolveAudioUrl(audioMap.get(lt.ruleId), lt.answerText);
          return {
            id:        lt.triggerId,
            ruleId:    lt.ruleId,
            triggerId: lt.triggerId,
            enabled:   lt.enabled,
            priority:  lt.priority ?? 50,
            label:     lt.label,
            bucket:    lt.bucket || null,
            maxInputWords: lt.maxInputWords || null,
            match: {
              keywords:         lt.keywords         || [],
              phrases:          lt.phrases          || [],
              negativeKeywords: lt.negativeKeywords  || [],
              negativePhrases:  lt.negativePhrases   || [],
              scenarioTypeAllowlist: lt.scenarioTypeAllowlist || []
            },
            responseMode: lt.responseMode || 'standard',
            answer: {
              answerText: lt.answerText || '',
              audioUrl:   audioUrl      || ''
            },
            followUp: {
              question:   lt.followUpQuestion     || '',
              nextAction: lt.followUpNextAction   || 'CONTINUE'
            },
            llmFactPack: lt.llmFactPack || null,
            _scope: 'LOCAL'
          };
        }).filter(Boolean);

        // Sort by priority
        formatted.sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));

        logger.debug('[TriggerService] Loaded CompanyLocalTriggers (no activeGroupId)', {
          companyId,
          localCount: formatted.length
        });
        return formatted;
      }
    } catch (localLoadErr) {
      logger.warn('[TriggerService] Failed to load CompanyLocalTriggers, falling back to legacy', {
        companyId,
        error: localLoadErr.message
      });
    }

    // No local triggers found — fall back to legacy playbook.rules
    if (legacyConfig && legacyConfig.discovery?.playbook?.rules) {
      const rawCards = legacyConfig.discovery.playbook.rules;
      // Transform legacy flat-format cards into TriggerCardMatcher format.
      const transformed = rawCards.map(transformLegacyCard).filter(Boolean);

      logger.debug('[TriggerService] Using legacy trigger cards (no local triggers found)', {
        companyId,
        rawCount: rawCards.length,
        transformedCount: transformed.length
      });
      return transformed;
    }

    return [];
  }

  return loadTriggersForCompany(companyId);
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
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  loadTriggersForCompany,
  loadTriggersWithLegacyFallback,
  
  invalidateCacheForCompany,
  invalidateCacheForGroup,
  invalidateAllCache,
  
  checkDuplicates,
  resolveAudioUrl,
  
  buildCacheKey,
  
  _internal: {
    triggerCache,
    mergeTriggers
  }
};
