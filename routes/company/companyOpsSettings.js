/**
 * ============================================================================
 * COMPANYOPS COMPANY SETTINGS - CONFIG ROUTES
 * ============================================================================
 * 
 * PURPOSE: Manage all high-level toggles and tech settings for the company
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET   /api/company/:companyId/settings
 * - PATCH /api/company/:companyId/settings/ai-agent
 * - PATCH /api/company/:companyId/settings/operating-hours
 * - PATCH /api/company/:companyId/settings/telephony
 * - PATCH /api/company/:companyId/settings/risk-safety
 * 
 * DATA MODEL: v2Company (multiple sections)
 * - aiAgentSettings (AI Agent Core)
 * - operatingHours (Operating Hours)
 * - twilioConfig (Telephony)
 * - riskSafetySettings (Risk & Safety)
 * 
 * SECTIONS:
 * 1. AI Agent Core (enabled, orchestrator, voice, language)
 * 2. Operating Hours (schedule, closed days, after-hours behavior)
 * 3. Telephony (Twilio numbers, SID, test call)
 * 4. Risk & Safety (same-day, weekend, emergency label)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const V2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/company/:companyId/settings
 * ============================================================================
 * Get all company settings
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await V2Company.findById(companyId).lean();

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // AI Agent Core settings
    const aiAgent = {
      enabled: company.aiAgentSettings?.enabled || false,
      orchestratorEnabled: company.aiAgentSettings?.orchestratorEnabled || false,
      debugOrchestrator: company.aiAgentSettings?.debugOrchestrator || false,
      voiceProvider: company.aiAgentSettings?.voiceProvider || 'Google',
      language: company.aiAgentSettings?.language || 'EN'
    };

    // Operating Hours settings
    const operatingHours = company.operatingHours || {
      schedule: {
        monday: { open: '08:00', close: '17:00', closed: false },
        tuesday: { open: '08:00', close: '17:00', closed: false },
        wednesday: { open: '08:00', close: '17:00', closed: false },
        thursday: { open: '08:00', close: '17:00', closed: false },
        friday: { open: '08:00', close: '17:00', closed: false },
        saturday: { open: '09:00', close: '13:00', closed: true },
        sunday: { open: '00:00', close: '00:00', closed: true }
      },
      afterHoursBehavior: 'take_message' // take_message | transfer | play_message_and_hang_up
    };

    // Telephony settings
    const telephony = {
      incomingNumbers: company.twilioConfig?.incomingNumbers || [],
      twilioSid: company.twilioConfig?.accountSid 
        ? `...${company.twilioConfig.accountSid.slice(-4)}` // Masked
        : null,
      isConfigured: !!(company.twilioConfig?.accountSid && company.twilioConfig?.authToken)
    };

    // Risk & Safety settings
    const riskSafety = company.riskSafetySettings || {
      allowSameDayBooking: false,
      allowWeekendBooking: false,
      allowEmergencyLabel: true
    };

    res.json({
      ok: true,
      data: {
        aiAgent,
        operatingHours,
        telephony,
        riskSafety
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Settings] GET failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch company settings'
    });
  }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/settings/ai-agent
 * ============================================================================
 * Update AI Agent Core settings
 * 
 * Body:
 * - enabled: boolean
 * - orchestratorEnabled: boolean
 * - debugOrchestrator: boolean
 * - voiceProvider: string (Google, ElevenLabs, etc.)
 * - language: string (EN, ES, Bilingual)
 */
router.patch('/ai-agent', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      enabled,
      orchestratorEnabled,
      debugOrchestrator,
      voiceProvider,
      language
    } = req.body;

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Initialize aiAgentSettings if doesn't exist
    if (!company.aiAgentSettings) {
      company.aiAgentSettings = {};
    }

    // Update fields
    if (enabled !== undefined) company.aiAgentSettings.enabled = enabled;
    if (orchestratorEnabled !== undefined) company.aiAgentSettings.orchestratorEnabled = orchestratorEnabled;
    if (debugOrchestrator !== undefined) company.aiAgentSettings.debugOrchestrator = debugOrchestrator;
    if (voiceProvider !== undefined) company.aiAgentSettings.voiceProvider = voiceProvider;
    if (language !== undefined) company.aiAgentSettings.language = language;

    company.markModified('aiAgentSettings');
    await company.save();

    logger.info('[CompanyOps Settings] AI Agent settings updated', {
      companyId,
      enabled: company.aiAgentSettings.enabled,
      orchestratorEnabled: company.aiAgentSettings.orchestratorEnabled
    });

    // Clear Redis cache
    try {
      const redisClient = require('../../src/config/redisClient');
      await redisClient.del(`company:${companyId}`);
    } catch (redisError) {
      logger.warn('[CompanyOps Settings] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'AI Agent settings updated successfully',
      data: company.aiAgentSettings     });

  } catch (error) {
    logger.error('[CompanyOps Settings] PATCH ai-agent failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update AI Agent settings'
    });
  }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/settings/operating-hours
 * ============================================================================
 * Update Operating Hours settings
 * 
 * Body:
 * - schedule: object (per-day: open, close, closed)
 * - afterHoursBehavior: string (take_message, transfer, play_message_and_hang_up)
 */
router.patch('/operating-hours', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { schedule, afterHoursBehavior } = req.body;

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Initialize operatingHours if doesn't exist
    if (!company.operatingHours) {
      company.operatingHours = { schedule: {} };
    }

    // Update schedule
    if (schedule) {
      company.operatingHours.schedule = {
        ...company.operatingHours.schedule,
        ...schedule
      };
    }

    // Update after-hours behavior
    if (afterHoursBehavior) {
      const validBehaviors = ['take_message', 'transfer', 'play_message_and_hang_up'];
      if (!validBehaviors.includes(afterHoursBehavior)) {
        return res.status(400).json({
          ok: false,
          error: `After-hours behavior must be one of: ${validBehaviors.join(', ')}`
        });
      }
      company.operatingHours.afterHoursBehavior = afterHoursBehavior;
    }

    company.markModified('operatingHours');
    await company.save();

    logger.info('[CompanyOps Settings] Operating hours updated', {
      companyId,
      afterHoursBehavior: company.operatingHours.afterHoursBehavior
    });

    // Clear Redis cache
    try {
      const redisClient = require('../../src/config/redisClient');
      await redisClient.del(`company:${companyId}`);
    } catch (redisError) {
      logger.warn('[CompanyOps Settings] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'Operating hours updated successfully',
      data: company.operatingHours
    });

  } catch (error) {
    logger.error('[CompanyOps Settings] PATCH operating-hours failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update operating hours'
    });
  }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/settings/telephony
 * ============================================================================
 * Update Telephony settings
 * 
 * Body:
 * - incomingNumbers: string[] (Twilio phone numbers)
 * - accountSid: string (Twilio SID)
 * - authToken: string (Twilio Auth Token)
 */
router.patch('/telephony', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { incomingNumbers, accountSid, authToken } = req.body;

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Initialize twilioConfig if doesn't exist
    if (!company.twilioConfig) {
      company.twilioConfig = {};
    }

    // Update fields
    if (incomingNumbers !== undefined) company.twilioConfig.incomingNumbers = incomingNumbers;
    if (accountSid !== undefined) company.twilioConfig.accountSid = accountSid;
    if (authToken !== undefined) company.twilioConfig.authToken = authToken;

    company.markModified('twilioConfig');
    await company.save();

    logger.info('[CompanyOps Settings] Telephony settings updated', {
      companyId,
      incomingNumbersCount: company.twilioConfig.incomingNumbers?.length || 0
    });

    // Clear Redis cache
    try {
      const redisClient = require('../../src/config/redisClient');
      await redisClient.del(`company:${companyId}`);
    } catch (redisError) {
      logger.warn('[CompanyOps Settings] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'Telephony settings updated successfully',
      data: {
        incomingNumbers: company.twilioConfig.incomingNumbers,
        accountSid: company.twilioConfig.accountSid 
          ? `...${company.twilioConfig.accountSid.slice(-4)}`
          : null
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Settings] PATCH telephony failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update telephony settings'
    });
  }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/settings/risk-safety
 * ============================================================================
 * Update Risk & Safety settings
 * 
 * Body:
 * - allowSameDayBooking: boolean
 * - allowWeekendBooking: boolean
 * - allowEmergencyLabel: boolean
 */
router.patch('/risk-safety', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      allowSameDayBooking,
      allowWeekendBooking,
      allowEmergencyLabel
    } = req.body;

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Initialize riskSafetySettings if doesn't exist
    if (!company.riskSafetySettings) {
      company.riskSafetySettings = {};
    }

    // Update fields
    if (allowSameDayBooking !== undefined) company.riskSafetySettings.allowSameDayBooking = allowSameDayBooking;
    if (allowWeekendBooking !== undefined) company.riskSafetySettings.allowWeekendBooking = allowWeekendBooking;
    if (allowEmergencyLabel !== undefined) company.riskSafetySettings.allowEmergencyLabel = allowEmergencyLabel;

    company.markModified('riskSafetySettings');
    await company.save();

    logger.info('[CompanyOps Settings] Risk & Safety settings updated', {
      companyId,
      allowSameDayBooking: company.riskSafetySettings.allowSameDayBooking
    });

    // Clear Redis cache
    try {
      const redisClient = require('../../src/config/redisClient');
      await redisClient.del(`company:${companyId}`);
    } catch (redisError) {
      logger.warn('[CompanyOps Settings] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'Risk & Safety settings updated successfully',
      data: company.riskSafetySettings
    });

  } catch (error) {
    logger.error('[CompanyOps Settings] PATCH risk-safety failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update Risk & Safety settings'
    });
  }
});

module.exports = router;

