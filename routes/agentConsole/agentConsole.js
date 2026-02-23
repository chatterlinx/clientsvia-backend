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
      isConnected: !!company.googleCalendar?.accessToken,
      calendarId: company.googleCalendar?.calendarId || null
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
    triggerCardsCount: agent2.triggerCards?.length || 0,
    clarifiersCount: agent2.clarifiers?.length || 0,
    vocabularyCount: agent2.discovery?.vocabulary?.length || 0,
    globalNegativeKeywordsCount: agent2.globalNegativeKeywords?.length || 0,
    bridge: {
      enabled: agent2.bridge?.enabled || false,
      thresholdMs: agent2.bridge?.thresholdMs || 1100
    }
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
      
      res.json({
        companyId,
        companyName: company.companyName,
        agent2: company.aiAgentSettings?.agent2 || {}
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

module.exports = router;
