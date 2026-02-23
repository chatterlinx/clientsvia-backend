/**
 * ============================================================================
 * AGENT CONSOLE — API ROUTES
 * ClientVia Platform · Clean Architecture · Production Grade
 * 
 * This is a CLEAN module — no legacy imports, no registry dependencies.
 * All truth data is assembled directly from canonical DB documents.
 * 
 * ENDPOINTS:
 * - GET /:companyId/truth — Master Truth JSON (complete platform snapshot)
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
   TRUTH ASSEMBLY — Canonical Document Readers
   ============================================================================ */

/**
 * Reads company profile truth from canonical v2Company document
 */
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

/**
 * Reads Agent 2.0 discovery config truth
 */
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

/**
 * Reads Booking Logic truth
 */
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
    slotDuration: bookingLogic.slotDuration || 60,
    bufferMinutes: bookingLogic.bufferMinutes || 0,
    advanceBookingDays: bookingLogic.advanceBookingDays || 14,
    businessHoursOverride: bookingLogic.businessHoursOverride || null,
    confirmationMessage: bookingLogic.confirmationMessage || null,
    enableSmsConfirmation: bookingLogic.enableSmsConfirmation || false
  };
}

/**
 * Reads Global Hub truth (dictionary counts, platform defaults status)
 */
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
 * 
 * Master Download Truth JSON — Complete platform state snapshot
 * Used by the "Master Download Truth JSON" button in Agent Console
 */
router.get(
  '/:companyId/truth',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const requestId = `truth_${Date.now()}`;
    
    logger.info(`[${MODULE_ID}] Truth request: companyId=${companyId}, requestId=${requestId}`);
    
    try {
      // Assemble truth from all sources in parallel
      const [companyProfile, agent2, bookingLogic, globalHub] = await Promise.all([
        readCompanyProfileTruth(companyId),
        readAgent2Truth(companyId),
        readBookingLogicTruth(companyId),
        readGlobalHubTruth()
      ]);
      
      const truthPayload = {
        _meta: {
          version: VERSION,
          requestId,
          timestamp: new Date().toISOString(),
          companyId
        },
        companyProfile,
        agent2,
        bookingLogic,
        globalHub
      };
      
      logger.info(`[${MODULE_ID}] Truth assembled: companyId=${companyId}, sections=4`);
      
      res.json(truthPayload);
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
 * Returns: replyText, sessionUpdates, handoffPayload (if booking triggered)
 */
router.post(
  '/:companyId/agent2/test-turn',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const { text, session } = req.body;
    const requestId = `test_${Date.now()}`;
    
    logger.info(`[${MODULE_ID}] Test turn: companyId=${companyId}, text="${text?.slice(0, 50)}..."`);
    
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
    
    logger.info(`[${MODULE_ID}] Booking test step: companyId=${companyId}`);
    
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
    
    logger.info(`[${MODULE_ID}] Updating Agent 2 config: companyId=${companyId}`);
    
    try {
      const company = await v2Company.findById(companyId);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }
      
      // Initialize aiAgentSettings.agent2 if missing
      if (!company.aiAgentSettings) {
        company.aiAgentSettings = {};
      }
      if (!company.aiAgentSettings.agent2) {
        company.aiAgentSettings.agent2 = {};
      }
      
      // Merge updates
      Object.assign(company.aiAgentSettings.agent2, updates);
      
      await company.save();
      
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
