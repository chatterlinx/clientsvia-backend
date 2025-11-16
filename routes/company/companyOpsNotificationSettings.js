/**
 * ============================================================================
 * COMPANYOPS NOTIFICATION SETTINGS - CONFIG ROUTES
 * ============================================================================
 * 
 * PURPOSE: Manage who gets notified of what events for this company
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET   /api/company/:companyId/notification-settings
 * - PATCH /api/company/:companyId/notification-settings
 * 
 * DATA MODEL: v2Company.notificationSettings
 * 
 * STRUCTURE:
 * notificationSettings: {
 *   events: {
 *     newAppointment: {
 *       enabled: true,
 *       smsContacts: [contactId1, contactId2],
 *       emailContacts: [contactId3],
 *       webhookUrl: "https://..."
 *     },
 *     ...
 *   }
 * }
 * 
 * SUPPORTED EVENTS:
 * - newAppointment
 * - appointmentRescheduled
 * - emergencyCallDetected
 * - afterHoursMessage
 * - missedCall
 * - sameDayBooking
 * - paymentLinkSent
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const V2Company = require('../../models/v2Company');
const V2Contact = require('../../models/v2Contact');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

// Default notification settings structure
const DEFAULT_EVENTS = {
  newAppointment: {
    enabled: true,
    smsContacts: [],
    emailContacts: [],
    webhookUrl: null
  },
  appointmentRescheduled: {
    enabled: true,
    smsContacts: [],
    emailContacts: [],
    webhookUrl: null
  },
  emergencyCallDetected: {
    enabled: true,
    smsContacts: [],
    emailContacts: [],
    webhookUrl: null
  },
  afterHoursMessage: {
    enabled: true,
    smsContacts: [],
    emailContacts: [],
    webhookUrl: null
  },
  missedCall: {
    enabled: false,
    smsContacts: [],
    emailContacts: [],
    webhookUrl: null
  },
  sameDayBooking: {
    enabled: false,
    smsContacts: [],
    emailContacts: [],
    webhookUrl: null
  },
  paymentLinkSent: {
    enabled: false,
    smsContacts: [],
    emailContacts: [],
    webhookUrl: null
  }
};

/**
 * ============================================================================
 * GET /api/company/:companyId/notification-settings
 * ============================================================================
 * Get notification settings with resolved contact info
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

    // Get notification settings or use defaults
    const settings = company.notificationSettings || { events: DEFAULT_EVENTS };

    // Ensure all default events exist
    if (!settings.events) {
      settings.events = DEFAULT_EVENTS;
    } else {
      // Merge with defaults (in case new events were added)
      settings.events = {
        ...DEFAULT_EVENTS,
        ...settings.events
      };
    }

    // Get all contacts for this company for dropdown population
    const allContacts = await V2Contact.find({ companyId })
      .select('_id name primaryPhone email role')
      .sort({ name: 1 })
      .lean();

    // Resolve contact info for each event
    const enrichedEvents = {};
    for (const [eventKey, eventConfig] of Object.entries(settings.events)) {
      const smsContactsInfo = await V2Contact.find({
        _id: { $in: eventConfig.smsContacts || [] },
        companyId
      })
        .select('_id name primaryPhone')
        .lean();

      const emailContactsInfo = await V2Contact.find({
        _id: { $in: eventConfig.emailContacts || [] },
        companyId
      })
        .select('_id name email')
        .lean();

      enrichedEvents[eventKey] = {
        ...eventConfig,
        smsContactsInfo,
        emailContactsInfo
      };
    }

    res.json({
      ok: true,
      data: {
        events: enrichedEvents,
        availableContacts: allContacts
      }
    });

  } catch (error) {
    logger.error('[CompanyOps NotificationSettings] GET failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch notification settings'
    });
  }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/notification-settings
 * ============================================================================
 * Update notification settings
 * 
 * Body:
 * {
 *   events: {
 *     eventKey: {
 *       enabled: boolean,
 *       smsContacts: [contactId],
 *       emailContacts: [contactId],
 *       webhookUrl: string | null
 *     }
 *   }
 * }
 */
router.patch('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { events } = req.body;

    if (!events || typeof events !== 'object') {
      return res.status(400).json({
        ok: false,
        error: 'Events object is required'
      });
    }

    const company = await V2Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        ok: false,
        error: 'Company not found'
      });
    }

    // Validate webhook URLs
    for (const [eventKey, eventConfig] of Object.entries(events)) {
      if (eventConfig.webhookUrl) {
        try {
          new URL(eventConfig.webhookUrl);
        } catch (urlError) {
          return res.status(400).json({
            ok: false,
            error: `Invalid webhook URL for event "${eventKey}"`
          });
        }
      }

      // Validate contactIds exist
      if (eventConfig.smsContacts && eventConfig.smsContacts.length > 0) {
        const existingContacts = await V2Contact.countDocuments({
          _id: { $in: eventConfig.smsContacts },
          companyId
        });

        if (existingContacts !== eventConfig.smsContacts.length) {
          return res.status(400).json({
            ok: false,
            error: `Some SMS contacts for event "${eventKey}" do not exist`
          });
        }
      }

      if (eventConfig.emailContacts && eventConfig.emailContacts.length > 0) {
        const existingContacts = await V2Contact.countDocuments({
          _id: { $in: eventConfig.emailContacts },
          companyId
        });

        if (existingContacts !== eventConfig.emailContacts.length) {
          return res.status(400).json({
            ok: false,
            error: `Some email contacts for event "${eventKey}" do not exist`
          });
        }
      }
    }

    // Initialize notificationSettings if doesn't exist
    if (!company.notificationSettings) {
      company.notificationSettings = { events: {} };
    }
    if (!company.notificationSettings.events) {
      company.notificationSettings.events = {};
    }

    // Merge new settings with existing
    for (const [eventKey, eventConfig] of Object.entries(events)) {
      company.notificationSettings.events[eventKey] = {
        ...company.notificationSettings.events[eventKey],
        ...eventConfig
      };
    }

    // Mark as modified for Mongoose to detect nested object changes
    company.markModified('notificationSettings');

    await company.save();

    logger.info('[CompanyOps NotificationSettings] Settings updated', {
      companyId,
      eventsUpdated: Object.keys(events)
    });

    // Clear Redis cache for this company (if using caching)
    try {
      const redisClient = require('../../src/config/redisClient');
      await redisClient.del(`company:${companyId}`);
      logger.info('[CompanyOps NotificationSettings] Redis cache cleared', { companyId });
    } catch (redisError) {
      // Non-critical error
      logger.warn('[CompanyOps NotificationSettings] Failed to clear Redis cache', {
        companyId,
        error: redisError.message
      });
    }

    res.json({
      ok: true,
      message: 'Notification settings updated successfully',
      data: {
        events: company.notificationSettings.events
      }
    });

  } catch (error) {
    logger.error('[CompanyOps NotificationSettings] PATCH failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to update notification settings'
    });
  }
});

module.exports = router;

