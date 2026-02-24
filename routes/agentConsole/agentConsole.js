/**
 * ============================================================================
 * AGENT CONSOLE — API ROUTES
 * ClientVia Platform · Standalone Admin Platform
 * 
 * RULES:
 * - Truth reads from canonical Mongo docs (NOT runtime caches)
 * - Short TTL cache (10s) prevents Mongo spam on UI refresh
 * - All secrets stripped recursively before response
 * - Runtime never uses these endpoints (admin JWT only)
 * 
 * ENDPOINTS:
 * - GET /:companyId/truth — Master Truth JSON (cached, sanitized)
 * - GET /:companyId/truth?force=true — Force refresh (bypass cache)
 * - POST /:companyId/agent2/test-turn — Test Agent 2.0 discovery turn
 * - POST /:companyId/booking/test-step — Test Booking Logic step
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const ConfigCacheService = require('../../services/ConfigCacheService');

// Trigger models for comprehensive truth assembly
const GlobalTriggerGroup = require('../../models/GlobalTriggerGroup');
const GlobalTrigger = require('../../models/GlobalTrigger');
const CompanyLocalTrigger = require('../../models/CompanyLocalTrigger');
const CompanyTriggerSettings = require('../../models/CompanyTriggerSettings');
const TriggerAudio = require('../../models/TriggerAudio');

const MODULE_ID = 'AGENT_CONSOLE_API';
const VERSION = 'AC1.0';

/* ============================================================================
   TRUTH CACHE — Short TTL to prevent Mongo hammering
   ============================================================================ */

const TRUTH_CACHE_TTL_MS = 10000; // 10 seconds

const truthCache = new Map();

function getCachedTruth(companyId) {
  const entry = truthCache.get(companyId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    truthCache.delete(companyId);
    return null;
  }
  return entry.data;
}

function setCachedTruth(companyId, data) {
  truthCache.set(companyId, {
    data,
    expiresAt: Date.now() + TRUTH_CACHE_TTL_MS,
    cachedAt: new Date().toISOString()
  });
}

/* ============================================================================
   SECRET SANITIZER — Strip sensitive keys recursively
   ============================================================================ */

const BANNED_KEYS = new Set([
  'token', 'secret', 'apikey', 'api_key', 'password', 'passwd',
  'auth', 'authtoken', 'auth_token', 'accesstoken', 'access_token',
  'refreshtoken', 'refresh_token', 'twilioauthtoken', 'elevenlabsapikey',
  'openaiapikey', 'mongouri', 'mongo_uri', 'connectionstring',
  'privatekey', 'private_key', 'secretkey', 'secret_key',
  'credentials', 'apiSecret', 'apisecret'
]);

function sanitizeTruth(obj, path = '', strippedKeys = []) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map((item, i) => sanitizeTruth(item, `${path}[${i}]`, strippedKeys));
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase().replace(/[^a-z]/g, '');
    
    if (BANNED_KEYS.has(keyLower)) {
      strippedKeys.push(`${path}.${key}`);
      continue;
    }
    
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeTruth(value, `${path}.${key}`, strippedKeys);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

function sanitizeAndLog(data, companyId) {
  const strippedKeys = [];
  const sanitized = sanitizeTruth(data, 'truth', strippedKeys);
  
  if (strippedKeys.length > 0) {
    logger.warn(`[${MODULE_ID}] Secrets stripped from truth response`, {
      companyId,
      strippedCount: strippedKeys.length,
      strippedPaths: strippedKeys
    });
  }
  
  return sanitized;
}

/* ============================================================================
   TRUTH ASSEMBLY — Canonical Document Readers
   ============================================================================ */

async function readCompanyProfileTruth(companyId) {
  const company = await v2Company.findById(companyId).lean();
  if (!company) {
    throw new Error(`Company not found: ${companyId}`);
  }
  
  return {
    companyId: company._id.toString(),
    companyName: company.companyName || 'Unknown',
    businessPhone: company.businessPhone || null,
    businessEmail: company.businessEmail || null,
    businessAddress: company.businessAddress || null,
    businessWebsite: company.businessWebsite || null,
    trade: company.trade || null,
    description: company.description || null,
    serviceArea: company.serviceArea || null,
    businessHours: company.businessHours || null,
    twilioConfig: {
      hasAccountSid: !!company.twilioConfig?.accountSid,
      hasAuthToken: !!company.twilioConfig?.authToken,
      phoneNumbersCount: company.twilioConfig?.phoneNumbers?.length || 0,
      callRoutingMode: company.twilioConfig?.callRoutingMode || 'unknown'
    },
    googleCalendar: {
      connected: !!company.googleCalendar?.connected,
      calendarId: company.googleCalendar?.calendarId || null,
      calendarName: company.googleCalendar?.calendarName || null,
      calendarEmail: company.googleCalendar?.calendarEmail || null,
      connectedAt: company.googleCalendar?.connectedAt || null,
      settings: {
        bufferMinutes: company.googleCalendar?.settings?.bufferMinutes || 60,
        defaultDurationMinutes: company.googleCalendar?.settings?.defaultDurationMinutes || 60,
        maxBookingDaysAhead: company.googleCalendar?.settings?.maxBookingDaysAhead || 30
      }
    },
    contactsCount: company.contacts?.length || 0
  };
}

async function readAgent2Truth(companyId) {
  const company = await v2Company.findById(companyId)
    .select('aiAgentSettings.agent2')
    .lean();
  
  if (!company) {
    throw new Error(`Company not found: ${companyId}`);
  }
  
  const agent2 = company.aiAgentSettings?.agent2 || {};
  
  // ─────────────────────────────────────────────────────────────────────────
  // TRIGGER CARDS: Full data assembly (mirrors buildMergedTriggerList)
  // ─────────────────────────────────────────────────────────────────────────
  const triggerData = await assembleTriggerTruth(companyId);
  
  return {
    enabled: agent2.enabled !== false,
    discoveryEnabled: agent2.discovery?.enabled !== false,
    greetings: {
      initial: agent2.greetings?.initial || null,
      returnCaller: agent2.greetings?.returnCaller || null
    },
    discoveryStyle: {
      ackWord: agent2.discovery?.style?.ackWord || 'Ok.',
      robotChallengeEnabled: agent2.discovery?.style?.robotChallenge?.enabled || false
    },
    llmFallback: {
      enabled: agent2.llmFallback?.enabled || false,
      model: agent2.llmFallback?.model || 'gpt-4o-mini'
    },
    // Full trigger data instead of just counts
    triggers: triggerData,
    clarifiersCount: agent2.clarifiers?.length || 0,
    vocabularyCount: agent2.discovery?.vocabulary?.length || 0,
    globalNegativeKeywordsCount: agent2.globalNegativeKeywords?.length || 0,
    bridge: {
      enabled: agent2.bridge?.enabled || false,
      thresholdMs: agent2.bridge?.thresholdMs || 1100
    }
  };
}

/**
 * Assemble comprehensive trigger truth for a company
 * Includes: global triggers, local triggers, overrides, audio status, company variables
 */
async function assembleTriggerTruth(companyId) {
  // Load company trigger settings
  const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
  
  // Load global triggers if company has an active group
  let globalTriggers = [];
  let activeGroup = null;
  
  if (settings?.activeGroupId) {
    globalTriggers = await GlobalTrigger.findByGroupId(settings.activeGroupId);
    const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);
    if (group) {
      activeGroup = {
        groupId: group.groupId,
        name: group.name,
        icon: group.icon,
        version: group.version,
        publishedVersion: group.publishedVersion
      };
    }
  }
  
  // Load local triggers for this company
  const localTriggers = await CompanyLocalTrigger.findByCompanyId(companyId);
  
  // Load company-specific audio
  const audioRecordings = await TriggerAudio.findByCompanyId(companyId);
  const audioMap = new Map();
  audioRecordings.forEach(a => audioMap.set(a.ruleId, a));
  
  // Build disabled/override sets
  const disabledGlobalSet = new Set(settings?.disabledGlobalTriggerIds || []);
  const partialOverrideMap = new Map();
  if (settings?.partialOverrides) {
    const overrides = settings.partialOverrides instanceof Map 
      ? settings.partialOverrides 
      : new Map(Object.entries(settings.partialOverrides || {}));
    overrides.forEach((value, key) => partialOverrideMap.set(key, value));
  }
  
  // Full overrides by ruleId
  const fullOverrideByRuleId = new Map();
  localTriggers.forEach(lt => {
    if (lt.isOverride && lt.overrideOfRuleId) {
      fullOverrideByRuleId.set(lt.overrideOfRuleId, lt);
    }
  });
  
  // Company variables
  let companyVariables = {};
  if (settings?.companyVariables) {
    companyVariables = settings.companyVariables instanceof Map
      ? Object.fromEntries(settings.companyVariables)
      : (typeof settings.companyVariables === 'object' ? settings.companyVariables : {});
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Assemble merged trigger list
  // ─────────────────────────────────────────────────────────────────────────
  const triggers = [];
  
  // Process global triggers
  for (const gt of globalTriggers) {
    // Skip if fully overridden
    if (fullOverrideByRuleId.has(gt.ruleId)) continue;
    
    const partialOverride = partialOverrideMap.get(gt.triggerId);
    const isDisabled = disabledGlobalSet.has(gt.triggerId);
    const companyAudio = audioMap.get(gt.ruleId);
    
    const effectiveAnswerText = partialOverride?.answerText || gt.answerText;
    const hasValidAudio = companyAudio && companyAudio.isValid && 
                          companyAudio.textHash === TriggerAudio.hashText(effectiveAnswerText);
    
    triggers.push({
      triggerId: gt.triggerId,
      ruleId: gt.ruleId,
      label: gt.label,
      scope: 'GLOBAL',
      originGroupId: gt.groupId,
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
        hasAudio: Boolean(hasValidAudio),
        audioNeedsRegeneration: companyAudio && !hasValidAudio
      },
      followUp: {
        question: gt.followUpQuestion || '',
        nextAction: gt.followUpNextAction || ''
      },
      // LLM fact pack if applicable
      llmFactPack: gt.responseMode === 'llm' ? {
        includedFacts: gt.llmFactPack?.includedFacts || '',
        excludedFacts: gt.llmFactPack?.excludedFacts || '',
        backupAnswer: gt.llmFactPack?.backupAnswer || ''
      } : null
    });
  }
  
  // Process local triggers (pure local + full overrides)
  for (const lt of localTriggers) {
    const companyAudio = audioMap.get(lt.ruleId);
    const hasValidAudio = companyAudio && companyAudio.isValid && 
                          companyAudio.textHash === TriggerAudio.hashText(lt.answerText);
    
    triggers.push({
      triggerId: lt.triggerId,
      ruleId: lt.ruleId,
      label: lt.label,
      scope: 'LOCAL',
      isOverride: lt.isOverride || false,
      overrideOfRuleId: lt.overrideOfRuleId || null,
      isEnabled: lt.enabled !== false,
      priority: lt.priority,
      responseMode: lt.responseMode || 'standard',
      match: {
        keywords: lt.keywords || [],
        phrases: lt.phrases || [],
        negativeKeywords: lt.negativeKeywords || []
      },
      answer: {
        answerText: lt.answerText || '',
        hasAudio: Boolean(hasValidAudio),
        audioNeedsRegeneration: companyAudio && !hasValidAudio
      },
      followUp: {
        question: lt.followUpQuestion || '',
        nextAction: lt.followUpNextAction || ''
      },
      // LLM fact pack if applicable
      llmFactPack: lt.responseMode === 'llm' ? {
        includedFacts: lt.llmFactPack?.includedFacts || '',
        excludedFacts: lt.llmFactPack?.excludedFacts || '',
        backupAnswer: lt.llmFactPack?.backupAnswer || ''
      } : null
    });
  }
  
  // Sort by priority (higher = processed first in matching)
  triggers.sort((a, b) => b.priority - a.priority);
  
  return {
    activeGroup,
    companyVariables,
    summary: {
      totalTriggers: triggers.length,
      globalTriggers: triggers.filter(t => t.scope === 'GLOBAL').length,
      localTriggers: triggers.filter(t => t.scope === 'LOCAL').length,
      enabledTriggers: triggers.filter(t => t.isEnabled).length,
      disabledTriggers: triggers.filter(t => !t.isEnabled).length,
      llmTriggers: triggers.filter(t => t.responseMode === 'llm').length,
      standardTriggers: triggers.filter(t => t.responseMode === 'standard').length,
      triggersWithAudio: triggers.filter(t => t.answer.hasAudio).length,
      triggersNeedingAudio: triggers.filter(t => t.answer.audioNeedsRegeneration).length
    },
    triggers
  };
}

async function readBookingLogicTruth(companyId) {
  const company = await v2Company.findById(companyId)
    .select('aiAgentSettings.bookingLogic googleCalendar')
    .lean();
  
  if (!company) {
    throw new Error(`Company not found: ${companyId}`);
  }
  
  const bookingLogic = company.aiAgentSettings?.bookingLogic || {};
  
  return {
    version: 'BL1.0',
    calendarConnected: !!company.googleCalendar?.accessToken,
    calendarId: company.googleCalendar?.calendarId || null,
    appointmentDuration: bookingLogic.slotDuration || 60,
    bufferMinutes: bookingLogic.bufferMinutes || 0,
    advanceBookingDays: bookingLogic.advanceBookingDays || 14,
    businessHoursOverride: bookingLogic.businessHoursOverride || null,
    confirmationMessage: bookingLogic.confirmationMessage || null,
    enableSmsConfirmation: bookingLogic.enableSmsConfirmation || false
  };
}

async function readGlobalHubTruth() {
  let firstNamesCount = 0;
  let platformDefaultsLoaded = false;
  
  try {
    const GlobalFirstNames = require('../../models/GlobalFirstNames');
    const count = await GlobalFirstNames.countDocuments({});
    firstNamesCount = count;
  } catch (err) {
    logger.warn(`[${MODULE_ID}] Could not count GlobalFirstNames: ${err.message}`);
  }
  
  try {
    const PlatformDefaultTriggers = require('../../services/engine/PlatformDefaultTriggers');
    platformDefaultsLoaded = typeof PlatformDefaultTriggers.getDefaults === 'function';
  } catch (err) {
    logger.warn(`[${MODULE_ID}] Could not check PlatformDefaultTriggers: ${err.message}`);
  }
  
  return {
    firstNames: {
      count: firstNamesCount,
      status: firstNamesCount > 0 ? 'loaded' : 'empty'
    },
    platformDefaults: {
      loaded: platformDefaultsLoaded,
      status: platformDefaultsLoaded ? 'active' : 'not_loaded'
    },
    version: 'GH1.0'
  };
}

/* ============================================================================
   API ENDPOINTS
   ============================================================================ */

/**
 * GET /:companyId/truth
 * GET /:companyId/truth?force=true (bypass cache)
 * 
 * Master Download Truth JSON — Complete platform state snapshot
 * - Uses 10s TTL cache to prevent Mongo spam
 * - All secrets stripped recursively
 */
router.get(
  '/:companyId/truth',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const forceRefresh = req.query.force === 'true';
    const requestId = `truth_${Date.now()}`;
    
    logger.info(`[${MODULE_ID}] Truth request`, {
      companyId,
      requestId,
      forceRefresh
    });
    
    try {
      // Check cache unless force refresh
      if (!forceRefresh) {
        const cached = getCachedTruth(companyId);
        if (cached) {
          logger.info(`[${MODULE_ID}] Truth served from cache`, { companyId, requestId });
          return res.json({
            ...cached,
            _meta: {
              ...cached._meta,
              fromCache: true,
              cacheHitAt: new Date().toISOString()
            }
          });
        }
      }
      
      // Assemble truth from all sources in parallel
      const [companyProfile, agent2, bookingLogic, globalHub] = await Promise.all([
        readCompanyProfileTruth(companyId),
        readAgent2Truth(companyId),
        readBookingLogicTruth(companyId),
        readGlobalHubTruth()
      ]);
      
      const rawPayload = {
        _meta: {
          version: VERSION,
          requestId,
          timestamp: new Date().toISOString(),
          companyId,
          fromCache: false
        },
        companyProfile,
        agent2,
        bookingLogic,
        globalHub
      };
      
      // Sanitize secrets before caching and responding
      const sanitizedPayload = sanitizeAndLog(rawPayload, companyId);
      
      // Cache the sanitized result
      setCachedTruth(companyId, sanitizedPayload);
      
      logger.info(`[${MODULE_ID}] Truth assembled and cached`, {
        companyId,
        requestId,
        sections: 4,
        cacheTTL: TRUTH_CACHE_TTL_MS
      });
      
      res.json(sanitizedPayload);
    } catch (error) {
      logger.error(`[${MODULE_ID}] Truth assembly failed: ${error.message}`, {
        companyId,
        requestId,
        stack: error.stack
      });
      
      res.status(500).json({
        error: 'Truth assembly failed',
        message: error.message,
        requestId
      });
    }
  }
);

/**
 * POST /:companyId/agent2/test-turn
 * 
 * Test a single Agent 2.0 discovery turn
 * Returns: replyText, sessionUpdates, handoffPayload (if booking triggered), events
 */
router.post(
  '/:companyId/agent2/test-turn',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const { text, session } = req.body;
    const requestId = `test_${Date.now()}`;
    
    logger.info(`[${MODULE_ID}] Test turn`, {
      companyId,
      requestId,
      textLength: text?.length || 0
    });
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid text parameter',
        requestId
      });
    }
    
    try {
      const Agent2DiscoveryEngine = require('../../services/engine/agent2/Agent2DiscoveryEngine');
      
      const result = await Agent2DiscoveryEngine.processTurn({
        session: session || {},
        text,
        companyId,
        callSid: `TEST_${requestId}`,
        fromPhone: '+15555555555',
        isTest: true
      });
      
      res.json({
        success: true,
        requestId,
        result
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Test turn failed: ${error.message}`, {
        companyId,
        requestId,
        stack: error.stack
      });
      
      res.status(500).json({
        error: 'Test turn failed',
        message: error.message,
        requestId
      });
    }
  }
);

/**
 * POST /:companyId/booking/test-step
 * 
 * Test a Booking Logic step with payload and bookingCtx
 */
router.post(
  '/:companyId/booking/test-step',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const { payload, bookingCtx, userInput } = req.body;
    const requestId = `booking_test_${Date.now()}`;
    
    logger.info(`[${MODULE_ID}] Booking test step`, { companyId, requestId });
    
    try {
      const BookingLogicEngine = require('../../services/engine/booking/BookingLogicEngine');
      
      const result = await BookingLogicEngine.processStep({
        companyId,
        payload: payload || {},
        bookingCtx: bookingCtx || null,
        userInput: userInput || null,
        isTest: true
      });
      
      res.json({
        success: true,
        requestId,
        result
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Booking test step failed: ${error.message}`, {
        companyId,
        requestId,
        stack: error.stack
      });
      
      res.status(500).json({
        error: 'Booking test step failed',
        message: error.message,
        requestId
      });
    }
  }
);

/**
 * GET /:companyId/agent2/config
 * 
 * Get full Agent 2.0 config for editing in Agent Console
 */
router.get(
  '/:companyId/agent2/config',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    
    try {
      const company = await v2Company.findById(companyId)
        .select('aiAgentSettings.agent2 companyName')
        .lean();
      
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }
      
      // Load trigger stats
      const CompanyTriggerSettings = require('../../models/CompanyTriggerSettings');
      const GlobalTrigger = require('../../models/GlobalTrigger');
      const CompanyLocalTrigger = require('../../models/CompanyLocalTrigger');
      const GlobalTriggerGroup = require('../../models/GlobalTriggerGroup');
      
      const triggerSettings = await CompanyTriggerSettings.findOne({ companyId });
      const activeGroupId = triggerSettings?.activeGroupId;
      
      let triggerCount = 0;
      let activeGroupInfo = null;
      
      if (activeGroupId) {
        const group = await GlobalTriggerGroup.findByGroupId(activeGroupId);
        if (group) {
          activeGroupInfo = {
            groupId: group.groupId,
            name: group.name,
            icon: group.icon
          };
        }
        
        const globalTriggers = await GlobalTrigger.findByGroupId(activeGroupId);
        const disabledSet = new Set(triggerSettings?.disabledGlobalTriggerIds || []);
        const globalEnabledCount = globalTriggers.filter(gt => !disabledSet.has(gt.triggerId)).length;
        triggerCount += globalEnabledCount;
      }
      
      const localTriggers = await CompanyLocalTrigger.findByCompanyId(companyId);
      const localEnabledCount = localTriggers.filter(lt => !lt.isOverride && lt.enabled !== false && lt.isDeleted !== true).length;
      triggerCount += localEnabledCount;
      
      res.json({
        companyId,
        companyName: company.companyName,
        agent2: company.aiAgentSettings?.agent2 || {},
        triggerStats: {
          activeGroupId,
          activeGroupName: activeGroupInfo?.name || null,
          activeGroupIcon: activeGroupInfo?.icon || null,
          totalActiveCount: triggerCount
        }
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Get Agent 2 config failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PATCH /:companyId/agent2/config
 * 
 * Update Agent 2.0 config from Agent Console
 */
router.patch(
  '/:companyId/agent2/config',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    const { companyId } = req.params;
    const updates = req.body;
    
    logger.info(`[${MODULE_ID}] Updating Agent 2 config`, { companyId });
    
    try {
      const company = await v2Company.findById(companyId);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }
      
      if (!company.aiAgentSettings) {
        company.aiAgentSettings = {};
      }
      if (!company.aiAgentSettings.agent2) {
        company.aiAgentSettings.agent2 = {};
      }
      
      Object.assign(company.aiAgentSettings.agent2, updates);
      await company.save();
      
      // Invalidate truth cache for this company
      truthCache.delete(companyId);
      
      // Invalidate Redis cache so runtime sees changes immediately
      await ConfigCacheService.invalidateAgent2Config(companyId);
      
      res.json({
        success: true,
        agent2: company.aiAgentSettings.agent2
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Update Agent 2 config failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /:companyId/booking/config
 * 
 * Get Booking Logic config for editing
 */
router.get(
  '/:companyId/booking/config',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    
    try {
      const company = await v2Company.findById(companyId)
        .select('aiAgentSettings.bookingLogic googleCalendar companyName businessHours')
        .lean();
      
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }
      
      res.json({
        companyId,
        companyName: company.companyName,
        bookingLogic: company.aiAgentSettings?.bookingLogic || {},
        calendarConnected: !!company.googleCalendar?.accessToken,
        businessHours: company.businessHours
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Get Booking config failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  }
);

/* ============================================================================
   GOOGLE CALENDAR ENDPOINTS — Agent Console Calendar Management
   ============================================================================ */

const GoogleCalendarService = require('../../services/GoogleCalendarService');

/**
 * GET /:companyId/calendar/status
 * 
 * Get calendar connection status
 */
router.get(
  '/:companyId/calendar/status',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    
    try {
      const status = await GoogleCalendarService.getStatus(companyId);
      
      res.json({
        connected: status.connected,
        email: status.calendarEmail || null,
        calendarId: status.calendarId || null,
        calendarName: status.calendarName || null,
        connectedAt: status.connectedAt || null,
        healthy: status.healthy,
        lastError: status.lastError || null
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Calendar status check failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /:companyId/calendar/connect/start
 * 
 * Start OAuth flow — returns authUrl for redirect
 */
router.post(
  '/:companyId/calendar/connect/start',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    const { companyId } = req.params;
    
    try {
      if (!GoogleCalendarService.isConfigured()) {
        return res.status(503).json({ 
          error: 'Google Calendar OAuth not configured on server' 
        });
      }
      
      const authUrl = GoogleCalendarService.generateAuthUrl(companyId, 'agent-console');
      
      logger.info(`[${MODULE_ID}] Calendar OAuth started`, { companyId, source: 'agent-console' });
      
      res.json({ authUrl });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Calendar connect start failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /:companyId/calendar/disconnect
 * 
 * Disconnect calendar — revokes tokens and clears stored credentials
 */
router.post(
  '/:companyId/calendar/disconnect',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    const { companyId } = req.params;
    
    try {
      const result = await GoogleCalendarService.disconnectCalendar(companyId);
      
      // Invalidate truth cache
      truthCache.delete(companyId);
      
      // Invalidate Redis cache so runtime sees changes immediately
      await ConfigCacheService.invalidateCalendarStatus(companyId);
      await ConfigCacheService.invalidateBookingConfig(companyId);
      
      logger.info(`[${MODULE_ID}] Calendar disconnected`, { companyId });
      
      res.json({ success: result.success, message: 'Calendar disconnected' });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Calendar disconnect failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /:companyId/calendar/test
 * 
 * Test calendar connection — verifies API access
 */
router.get(
  '/:companyId/calendar/test',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    
    try {
      const result = await GoogleCalendarService.testConnection(companyId);
      
      res.json(result);
    } catch (error) {
      logger.error(`[${MODULE_ID}] Calendar test failed: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /:companyId/calendar/calendars
 * 
 * List available calendars (requires connection)
 */
router.get(
  '/:companyId/calendar/calendars',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    
    try {
      const result = await GoogleCalendarService.listCalendars(companyId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error, calendars: [] });
      }
      
      res.json({ calendars: result.calendars });
    } catch (error) {
      logger.error(`[${MODULE_ID}] List calendars failed: ${error.message}`);
      res.status(500).json({ error: error.message, calendars: [] });
    }
  }
);

/**
 * POST /:companyId/calendar/select
 * 
 * Select which calendar to use for bookings
 */
router.post(
  '/:companyId/calendar/select',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    const { companyId } = req.params;
    const { calendarId } = req.body;
    
    if (!calendarId) {
      return res.status(400).json({ error: 'Missing calendarId' });
    }
    
    try {
      const result = await GoogleCalendarService.selectCalendar(companyId, calendarId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      // Invalidate truth cache
      truthCache.delete(companyId);
      
      // Invalidate Redis cache so runtime sees changes immediately
      await ConfigCacheService.invalidateCalendarStatus(companyId);
      await ConfigCacheService.invalidateBookingConfig(companyId);
      
      logger.info(`[${MODULE_ID}] Calendar selected`, { 
        companyId, 
        calendarId,
        calendarName: result.calendarName
      });
      
      res.json(result);
    } catch (error) {
      logger.error(`[${MODULE_ID}] Select calendar failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /:companyId/calendar/test-availability
 * 
 * Preview available time options for a given date range
 * This is what Booking Logic will consume
 * 
 * Returns BOTH UTC and local times to ensure DST correctness
 */
router.post(
  '/:companyId/calendar/test-availability',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const { startDate, durationMinutes } = req.body;
    
    if (!startDate) {
      return res.status(400).json({ error: 'Missing startDate' });
    }
    
    try {
      // Get company timezone
      const company = await v2Company.findById(companyId).select('timezone').lean();
      const timezone = company?.timezone || 'America/New_York';
      
      const start = new Date(startDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // Look ahead 7 days
      
      const result = await GoogleCalendarService.findAvailableSlots(companyId, {
        dayPreference: 'asap',
        durationMinutes: durationMinutes || 60,
        maxSlots: 20
      });
      
      // Helper to format local time
      const formatLocal = (date, tz) => {
        return new Date(date).toLocaleString('en-US', {
          timeZone: tz,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
      };
      
      // Transform to our "time options" format with both UTC and local
      const slots = result.slots || [];
      const availableTimeOptions = slots.map(slot => ({
        startUtc: slot.start.toISOString(),
        endUtc: slot.end.toISOString(),
        startLocal: formatLocal(slot.start, timezone),
        endLocal: formatLocal(slot.end, timezone),
        displayText: slot.display || null,
        duration: durationMinutes || 60,
        timezone
      }));
      
      res.json({
        success: true,
        timezone,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        durationMinutes: durationMinutes || 60,
        availableTimeOptions,
        count: availableTimeOptions.length,
        message: result.message || null,
        fallback: result.fallback || false
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Test availability failed: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: error.message,
        availableTimeOptions: [] 
      });
    }
  }
);

module.exports = router;
