/**
 * ============================================================================
 * CHEAT SHEET - BOOKING RULES CONFIG ROUTES
 * ============================================================================
 * 
 * PURPOSE: Define what "readyToBook" means per trade/serviceType
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET   /api/company/:companyId/booking-rules
 * - PATCH /api/company/:companyId/booking-rules
 * 
 * DATA MODEL: v2Company.aiAgentSettings.bookingRules
 * 
 * STRUCTURE:
 * bookingRules: {
 *   [trade]: {
 *     [serviceType]: {
 *       requiredFields: string[],
 *       timeRules: { allowedDays, sameDayCutoffHour, minLeadHours, maxDaysOut, timeWindows },
 *       behavior: { autoConfirm, requireHumanApproval, allowOverbooking, noteTemplate },
 *       llmHints: { scheduleExplanation, noSlotsAvailable }
 *     }
 *   }
 * }
 * 
 * USED BY:
 * - BookingHandler (validates readyToBook)
 * - LLM-0 Orchestrator (guides conversation)
 * - Active Instructions (exposes to LLM)
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

// Default booking rules template
const DEFAULT_BOOKING_RULE = {
  requiredFields: ['name', 'primaryPhone', 'location', 'problemDescription', 'timeWindow'],
  timeRules: {
    allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    allowWeekends: false,
    sameDayCutoffHour: 15,
    minLeadHours: 2,
    maxDaysOut: 30,
    timeWindows: ['8-10', '10-12', '12-2', '2-4']
  },
  behavior: {
    autoConfirmIfSlotAvailable: false,
    requireHumanApprovalForEmergency: true,
    allowOverbooking: false,
    noteTemplateForTech: ''
  },
  llmHints: {
    scheduleExplanationText: 'We have time slots available between 8 AM and 4 PM on weekdays.',
    noSlotsAvailableText: 'Our schedule is currently full, but I can add you to our priority waitlist.'
  }
};

/**
 * ============================================================================
 * GET /api/company/:companyId/booking-rules
 * ============================================================================
 * Get booking rules for all trades/serviceTypes
 * 
 * Query params:
 * - trade: string (optional, filter by specific trade)
 * - serviceType: string (optional, filter by specific serviceType)
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { trade, serviceType } = req.query;

    const company = await V2Company.findById(companyId).lean();

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Get booking rules or use empty object
    const bookingRules = company.aiAgentSettings?.bookingRules || {};

    // Filter by trade/serviceType if provided
    let filteredRules = bookingRules;

    if (trade) {
      filteredRules = bookingRules[trade] || {};
      
      if (serviceType) {
        filteredRules = {
          [trade]: {
            [serviceType]: filteredRules[serviceType] || DEFAULT_BOOKING_RULE
          }
        };
      } else {
        filteredRules = { [trade]: filteredRules };
      }
    }

    res.json({
      ok: true,
      data: {
        bookingRules: filteredRules,
        defaultTemplate: DEFAULT_BOOKING_RULE
      }
    });

  } catch (error) {
    logger.error('[Cheat Sheet BookingRules] GET failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch booking rules'
    });
  }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/booking-rules
 * ============================================================================
 * Update booking rules for a specific trade/serviceType
 * 
 * Body:
 * {
 *   trade: string (required),
 *   serviceType: string (required),
 *   rules: {
 *     requiredFields: string[],
 *     timeRules: { ... },
 *     behavior: { ... },
 *     llmHints: { ... }
 *   }
 * }
 */
router.patch('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { trade, serviceType, rules } = req.body;

    // Validation
    if (!trade || !serviceType) {
      return res.status(400).json({
        ok: false,
        error: 'Trade and serviceType are required'
      });
    }

    if (!rules || typeof rules !== 'object') {
      return res.status(400).json({
        ok: false,
        error: 'Rules object is required'
      });
    }

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Initialize nested structure if doesn't exist
    if (!company.aiAgentSettings) {
      company.aiAgentSettings = {};
    }
    if (!company.aiAgentSettings.bookingRules) {
      company.aiAgentSettings.bookingRules = {};
    }
    if (!company.aiAgentSettings.bookingRules[trade]) {
      company.aiAgentSettings.bookingRules[trade] = {};
    }

    // Validate required fields
    const validRequiredFields = [
      'name', 'primaryPhone', 'email', 'location', 'problemDescription',
      'preferredDate', 'timeWindow', 'accessNotes', 'photos'
    ];

    if (rules.requiredFields && Array.isArray(rules.requiredFields)) {
      const invalidFields = rules.requiredFields.filter(f => !validRequiredFields.includes(f));
      if (invalidFields.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `Invalid required fields: ${invalidFields.join(', ')}. Valid fields: ${validRequiredFields.join(', ')}`
        });
      }
    }

    // Validate time windows format if provided
    if (rules.timeRules?.timeWindows && Array.isArray(rules.timeRules.timeWindows)) {
      const invalidWindows = rules.timeRules.timeWindows.filter(w => !isValidTimeWindow(w));
      if (invalidWindows.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `Invalid time windows: ${invalidWindows.join(', ')}. Format should be like "8-10", "10-12", etc.`
        });
      }
    }

    // Merge with existing rules (preserve fields not being updated)
    const existingRules = company.aiAgentSettings.bookingRules[trade][serviceType] || {};
    
    company.aiAgentSettings.bookingRules[trade][serviceType] = {
      requiredFields: rules.requiredFields || existingRules.requiredFields || DEFAULT_BOOKING_RULE.requiredFields,
      timeRules: {
        ...(existingRules.timeRules || DEFAULT_BOOKING_RULE.timeRules),
        ...(rules.timeRules || {})
      },
      behavior: {
        ...(existingRules.behavior || DEFAULT_BOOKING_RULE.behavior),
        ...(rules.behavior || {})
      },
      llmHints: {
        ...(existingRules.llmHints || DEFAULT_BOOKING_RULE.llmHints),
        ...(rules.llmHints || {})
      }
    };

    company.markModified('aiAgentSettings');
    await company.save();

    logger.info('[Cheat Sheet BookingRules] Rules updated', {
      companyId,
      trade,
      serviceType
    });

    // Clear Redis cache
    try {
      const redisClient = require('../../src/config/redisClient');
      await redisClient.del(`company:${companyId}`);
      logger.info('[Cheat Sheet BookingRules] Redis cache cleared', { companyId });
    } catch (redisError) {
      logger.warn('[Cheat Sheet BookingRules] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'Booking rules updated successfully',
      data: {
        trade,
        serviceType,
        rules: company.aiAgentSettings.bookingRules[trade][serviceType]
      }
    });

  } catch (error) {
    logger.error('[Cheat Sheet BookingRules] PATCH failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update booking rules'
    });
  }
});

/**
 * Helper function to validate time window format
 */
function isValidTimeWindow(window) {
  // Format: "8-10", "10-12", "12-2", "2-4", etc.
  const regex = /^\d{1,2}-\d{1,2}$/;
  if (!regex.test(window)) return false;

  const [start, end] = window.split('-').map(Number);
  return start >= 0 && start < 24 && end > start && end <= 24;
}

module.exports = router;

