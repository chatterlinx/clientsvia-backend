/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL CENTER ADMIN ROUTES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin API endpoints for the Call Center module.
 * Used by call-center.html for viewing calls, customers, and analytics.
 * 
 * ENDPOINTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * GET  /api/admin/call-center/:companyId/calls        - List calls
 * GET  /api/admin/call-center/:companyId/calls/:id    - Get single call
 * POST /api/admin/call-center/:companyId/calls/:id/flag     - Flag call
 * POST /api/admin/call-center/:companyId/calls/:id/note     - Add note
 * POST /api/admin/call-center/:companyId/calls/:id/review   - Mark reviewed
 * 
 * GET  /api/admin/call-center/:companyId/customers         - List customers
 * GET  /api/admin/call-center/:companyId/customers/:id     - Get customer
 * GET  /api/admin/call-center/:companyId/customers/:id/calls - Customer calls
 * 
 * GET  /api/admin/call-center/:companyId/stats/today       - Today's stats
 * GET  /api/admin/call-center/:companyId/stats/dashboard   - Dashboard stats
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();

// Authentication & Authorization
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const authorizeRole = requireRole; // Alias for consistency
const authorizeCompanyAccess = require('../../middleware/authorizeCompanyAccess');
const auditLog = require('../../middleware/auditLog');

// Services
const CallSummaryService = require('../../services/CallSummaryService');
const CustomerLookup = require('../../services/CustomerLookup');
const AnalyticsService = require('../../services/AnalyticsService');

// Jobs (for status endpoints)
const { getRollupStatus } = require('../../jobs/dailyStatsRollup');
const { getArchiverStatus } = require('../../jobs/transcriptArchiver');
const { getPurgeStatus } = require('../../jobs/dataPurge');

// Compliance
const ComplianceService = require('../../services/ComplianceService');

// Models
const CallSummary = require('../../models/CallSummary');
const Customer = require('../../models/Customer');
const CallDailyStats = require('../../models/CallDailyStats');

// Utilities
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE STACK (Applied to all routes)
// ═══════════════════════════════════════════════════════════════════════════

// All routes require JWT auth and company access
router.use('/:companyId', authenticateJWT, authorizeCompanyAccess);

// ═══════════════════════════════════════════════════════════════════════════
// CALL ROUTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/call-center/:companyId/calls
 * List calls with pagination and filtering
 */
router.get('/:companyId/calls',
  auditLog.logAccess('call.list_viewed'),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const {
        page = 1,
        limit = 50,
        outcome,
        intent,
        flagged,
        customerId,
        phone,
        startDate,
        endDate,
        sort = '-startedAt'
      } = req.query;
      
      const options = {
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 100)
      };
      
      // Build filters
      const filters = {};
      if (outcome) filters.outcome = outcome;
      if (intent) filters.primaryIntent = intent;
      if (flagged === 'true') filters.flagged = true;
      if (customerId) filters.customerId = customerId;
      if (phone) {
        // Normalize phone for search
        try {
          const normalizedPhone = CustomerLookup.normalizePhone(phone);
          filters.phone = normalizedPhone;
        } catch (err) {
          // If normalization fails, search as-is
          filters.phone = { $regex: phone.replace(/\D/g, '') };
        }
      }
      if (startDate || endDate) {
        filters.startedAt = {};
        if (startDate) filters.startedAt.$gte = new Date(startDate);
        if (endDate) filters.startedAt.$lte = new Date(endDate);
      }
      
      // Parse sort
      const sortOrder = {};
      if (sort.startsWith('-')) {
        sortOrder[sort.substring(1)] = -1;
      } else {
        sortOrder[sort] = 1;
      }
      
      const result = await CallSummaryService.getRecentCalls(companyId, {
        ...options,
        filters,
        sort: sortOrder
      });
      
      res.json({
        success: true,
        data: result.calls,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          pages: result.pages
        }
      });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error listing calls', {
        error: error.message,
        companyId: req.params.companyId
      });
      res.status(500).json({ success: false, error: 'Failed to fetch calls' });
    }
  }
);

/**
 * GET /api/admin/call-center/:companyId/calls/:callId
 * Get single call with optional transcript
 */
router.get('/:companyId/calls/:callId',
  auditLog.logAccess('call.viewed'),
  async (req, res) => {
    try {
      const { companyId, callId } = req.params;
      const { includeTranscript = 'false' } = req.query;
      
      const call = await CallSummaryService.getCall(
        companyId, 
        callId, 
        includeTranscript === 'true'
      );
      
      if (!call) {
        return res.status(404).json({ success: false, error: 'Call not found' });
      }
      
      res.json({ success: true, data: call });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error fetching call', {
        error: error.message,
        callId: req.params.callId
      });
      res.status(500).json({ success: false, error: 'Failed to fetch call' });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/calls/:callId/flag
 * Flag a call for review
 */
router.post('/:companyId/calls/:callId/flag',
  auditLog.logModification('call.flagged'),
  async (req, res) => {
    try {
      const { companyId, callId } = req.params;
      const { reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({ success: false, error: 'Reason is required' });
      }
      
      const call = await CallSummaryService.flagCall(
        companyId, 
        callId, 
        reason, 
        req.user.email
      );
      
      res.json({ success: true, data: call });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error flagging call', {
        error: error.message,
        callId: req.params.callId
      });
      res.status(500).json({ success: false, error: 'Failed to flag call' });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/calls/:callId/note
 * Add a note to a call
 */
router.post('/:companyId/calls/:callId/note',
  auditLog.logModification('call.note_added'),
  async (req, res) => {
    try {
      const { companyId, callId } = req.params;
      const { note } = req.body;
      
      if (!note) {
        return res.status(400).json({ success: false, error: 'Note is required' });
      }
      
      const call = await CallSummaryService.addNote(
        companyId, 
        callId, 
        note, 
        req.user.email
      );
      
      res.json({ success: true, data: call });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error adding note', {
        error: error.message,
        callId: req.params.callId
      });
      res.status(500).json({ success: false, error: 'Failed to add note' });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/calls/:callId/review
 * Mark a call as reviewed
 */
router.post('/:companyId/calls/:callId/review',
  auditLog.logModification('call.reviewed'),
  async (req, res) => {
    try {
      const { companyId, callId } = req.params;
      const { rating, feedback } = req.body;
      
      const call = await CallSummaryService.markReviewed(
        companyId, 
        callId, 
        req.user.email,
        rating,
        feedback
      );
      
      res.json({ success: true, data: call });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error reviewing call', {
        error: error.message,
        callId: req.params.callId
      });
      res.status(500).json({ success: false, error: 'Failed to review call' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER ROUTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/call-center/:companyId/customers
 * Search and list customers
 */
router.get('/:companyId/customers',
  auditLog.logAccess('customer.list_viewed'),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const {
        query,
        status,
        tags,
        page = 1,
        limit = 50,
        sort = '-lastContactAt'
      } = req.query;
      
      // Parse sort
      const sortOrder = {};
      if (sort.startsWith('-')) {
        sortOrder[sort.substring(1)] = -1;
      } else {
        sortOrder[sort] = 1;
      }
      
      const result = await CustomerLookup.searchCustomers(
        companyId,
        {
          query,
          status,
          tags: tags ? tags.split(',') : undefined
        },
        {
          page: parseInt(page),
          limit: Math.min(parseInt(limit), 100),
          sort: sortOrder
        }
      );
      
      res.json({
        success: true,
        data: result.customers,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          pages: result.pages
        }
      });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error listing customers', {
        error: error.message,
        companyId: req.params.companyId
      });
      res.status(500).json({ success: false, error: 'Failed to fetch customers' });
    }
  }
);

/**
 * GET /api/admin/call-center/:companyId/customers/:customerId
 * Get customer with history
 */
router.get('/:companyId/customers/:customerId',
  auditLog.logAccess('customer.viewed'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      
      const customer = await CustomerLookup.getCustomerWithHistory(companyId, customerId);
      
      if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
      }
      
      res.json({ success: true, data: customer });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error fetching customer', {
        error: error.message,
        customerId: req.params.customerId
      });
      res.status(500).json({ success: false, error: 'Failed to fetch customer' });
    }
  }
);

/**
 * GET /api/admin/call-center/:companyId/customers/:customerId/calls
 * Get calls for a specific customer
 */
router.get('/:companyId/customers/:customerId/calls',
  auditLog.logAccess('customer.calls_viewed'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      const { limit = 50 } = req.query;
      
      const calls = await CallSummaryService.getCustomerCalls(
        companyId,
        customerId,
        parseInt(limit)
      );
      
      res.json({ success: true, data: calls });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error fetching customer calls', {
        error: error.message,
        customerId: req.params.customerId
      });
      res.status(500).json({ success: false, error: 'Failed to fetch customer calls' });
    }
  }
);

/**
 * PATCH /api/admin/call-center/:companyId/customers/:customerId
 * Update customer profile
 */
router.patch('/:companyId/customers/:customerId',
  auditLog.logModification('customer.updated'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      const updateData = req.body;
      
      // Prevent changing companyId
      delete updateData.companyId;
      delete updateData._id;
      
      const customer = await CustomerLookup.enrichCustomer(customerId, {
        ...updateData,
        companyId
      });
      
      res.json({ success: true, data: customer });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error updating customer', {
        error: error.message,
        customerId: req.params.customerId
      });
      res.status(500).json({ success: false, error: 'Failed to update customer' });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/customers/:customerId/properties
 * Add a new service address (property) to customer
 */
router.post('/:companyId/customers/:customerId/properties',
  auditLog.logModification('customer.property_added'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      const propertyData = req.body;
      
      if (!propertyData.nickname || !propertyData.street) {
        return res.status(400).json({ 
          success: false, 
          error: 'nickname and street are required' 
        });
      }
      
      const customer = await Customer.addServiceAddress(customerId, propertyData);
      
      if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
      }
      
      // Invalidate cache
      await CustomerLookup.invalidateCache(companyId, customer.phone);
      
      logger.info('[CALL_CENTER] Property added', {
        companyId,
        customerId,
        nickname: propertyData.nickname
      });
      
      res.json({ success: true, data: customer });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error adding property', {
        error: error.message,
        customerId: req.params.customerId
      });
      res.status(500).json({ success: false, error: 'Failed to add property' });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/customers/:customerId/household
 * Add a household member to customer
 */
router.post('/:companyId/customers/:customerId/household',
  auditLog.logModification('customer.household_member_added'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      const memberData = req.body;
      
      if (!memberData.name) {
        return res.status(400).json({ 
          success: false, 
          error: 'name is required' 
        });
      }
      
      const customer = await CustomerLookup.addHouseholdMember(companyId, customerId, memberData);
      
      if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
      }
      
      logger.info('[CALL_CENTER] Household member added', {
        companyId,
        customerId,
        memberName: memberData.name
      });
      
      res.json({ success: true, data: customer });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error adding household member', {
        error: error.message,
        customerId: req.params.customerId
      });
      res.status(500).json({ success: false, error: 'Failed to add household member' });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/customers/:customerId/convert-commercial
 * Convert a customer to a commercial account
 */
router.post('/:companyId/customers/:customerId/convert-commercial',
  auditLog.logModification('customer.converted_to_commercial'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      const commercialData = req.body;
      
      if (!commercialData.businessName) {
        return res.status(400).json({ 
          success: false, 
          error: 'businessName is required' 
        });
      }
      
      // Find and update customer
      const customer = await Customer.findOneAndUpdate(
        { _id: customerId, companyId },
        {
          $set: {
            accountType: 'commercial',
            'commercial.businessName': commercialData.businessName,
            'commercial.industryType': commercialData.industryType,
            'commercial.serviceEntrance': commercialData.serviceEntrance,
            'commercial.unitLocation': commercialData.unitLocation,
            'commercial.siteContact': commercialData.siteContact,
            'commercial.billingAddress': commercialData.billingAddress,
            'commercial.billingContact': commercialData.billingContact
          }
        },
        { new: true }
      );
      
      if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
      }
      
      // Invalidate cache
      await CustomerLookup.invalidateCache(companyId, customer.phone);
      
      logger.info('[CALL_CENTER] Customer converted to commercial', {
        companyId,
        customerId,
        businessName: commercialData.businessName
      });
      
      res.json({ success: true, data: customer });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error converting to commercial', {
        error: error.message,
        customerId: req.params.customerId
      });
      res.status(500).json({ success: false, error: 'Failed to convert to commercial' });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/customers/:customerId/link
 * Link this customer to another account
 */
router.post('/:companyId/customers/:customerId/link',
  auditLog.logModification('customer.account_linked'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      const { accountId, relationship, note } = req.body;
      
      if (!accountId) {
        return res.status(400).json({ 
          success: false, 
          error: 'accountId is required' 
        });
      }
      
      // Find the target account to get its details
      const targetAccount = await Customer.findOne({
        companyId,
        $or: [
          { customerId: accountId },
          { _id: accountId.match(/^[0-9a-fA-F]{24}$/) ? accountId : null }
        ]
      }).lean();
      
      if (!targetAccount) {
        return res.status(404).json({ success: false, error: 'Target account not found' });
      }
      
      // Add to relatedAccounts
      const customer = await Customer.findOneAndUpdate(
        { _id: customerId, companyId },
        {
          $push: {
            relatedAccounts: {
              accountId: targetAccount.customerId,
              accountType: targetAccount.accountType || 'residential',
              relationship,
              businessName: targetAccount.commercial?.businessName || targetAccount.fullName,
              note
            }
          }
        },
        { new: true }
      );
      
      if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
      }
      
      // Optionally, create reverse link on target
      await Customer.findByIdAndUpdate(targetAccount._id, {
        $push: {
          relatedAccounts: {
            accountId: customer.customerId,
            accountType: customer.accountType || 'residential',
            relationship: `Linked from ${customer.fullName || customer.customerId}`,
            businessName: customer.commercial?.businessName || customer.fullName
          }
        }
      });
      
      // Invalidate cache
      await CustomerLookup.invalidateCache(companyId, customer.phone);
      
      logger.info('[CALL_CENTER] Accounts linked', {
        companyId,
        customerId: customer.customerId,
        linkedTo: targetAccount.customerId
      });
      
      res.json({ success: true, data: customer });
      
    } catch (error) {
      logger.error('[CALL_CENTER] Error linking accounts', {
        error: error.message,
        customerId: req.params.customerId
      });
      res.status(500).json({ success: false, error: 'Failed to link accounts' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// STATS ROUTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/call-center/:companyId/stats/today
 * Get today's quick stats
 */
router.get('/:companyId/stats/today', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const stats = await CallSummaryService.getTodayStats(companyId);
    
    res.json({ success: true, data: stats });
    
  } catch (error) {
    logger.error('[CALL_CENTER] Error fetching today stats', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/admin/call-center/:companyId/stats/dashboard
 * Get full dashboard stats (uses pre-computed daily stats)
 */
router.get('/:companyId/stats/dashboard', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 7 } = req.query;
    
    // Get date range
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    startDate.setHours(0, 0, 0, 0);
    
    // Get pre-computed daily stats
    const dailyStats = await CallDailyStats.find({
      companyId,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 }).lean();
    
    // Get today's live stats (not yet rolled up)
    const todayStats = await CallSummaryService.getTodayStats(companyId);
    
    // Get customer stats
    const customerStats = await Customer.aggregate([
      { $match: { companyId: require('mongoose').Types.ObjectId.createFromHexString(companyId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Get flagged calls count
    const flaggedCount = await CallSummary.countDocuments({
      companyId,
      flagged: true
    });
    
    res.json({
      success: true,
      data: {
        today: todayStats,
        daily: dailyStats,
        customers: customerStats.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {}),
        flaggedCalls: flaggedCount,
        dateRange: {
          start: startDate,
          end: endDate,
          days: parseInt(days)
        }
      }
    });
    
  } catch (error) {
    logger.error('[CALL_CENTER] Error fetching dashboard stats', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS ROUTES (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/call-center/:companyId/analytics/report
 * Get detailed analytics report for a date range
 */
router.get('/:companyId/analytics/report', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: 'startDate and endDate are required' 
      });
    }
    
    const report = await AnalyticsService.getReport(companyId, startDate, endDate);
    res.json({ success: true, data: report });
    
  } catch (error) {
    logger.error('[CALL_CENTER] Error fetching analytics report', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({ success: false, error: 'Failed to fetch report' });
  }
});

/**
 * GET /api/admin/call-center/:companyId/analytics/intents
 * Get top intents
 */
router.get('/:companyId/analytics/intents', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 30, limit = 10 } = req.query;
    
    const intents = await AnalyticsService.getTopIntents(
      companyId, 
      parseInt(days), 
      parseInt(limit)
    );
    
    res.json({ success: true, data: intents });
    
  } catch (error) {
    logger.error('[CALL_CENTER] Error fetching top intents', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({ success: false, error: 'Failed to fetch intents' });
  }
});

/**
 * GET /api/admin/call-center/:companyId/analytics/tiers
 * Get tier usage breakdown
 */
router.get('/:companyId/analytics/tiers', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 30 } = req.query;
    
    const tiers = await AnalyticsService.getTierUsage(companyId, parseInt(days));
    res.json({ success: true, data: tiers });
    
  } catch (error) {
    logger.error('[CALL_CENTER] Error fetching tier usage', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({ success: false, error: 'Failed to fetch tier usage' });
  }
});

/**
 * GET /api/admin/call-center/:companyId/analytics/peak-hours
 * Get peak hours analysis
 */
router.get('/:companyId/analytics/peak-hours', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 30 } = req.query;
    
    const peakHours = await AnalyticsService.getPeakHours(companyId, parseInt(days));
    res.json({ success: true, data: peakHours });
    
  } catch (error) {
    logger.error('[CALL_CENTER] Error fetching peak hours', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({ success: false, error: 'Failed to fetch peak hours' });
  }
});

/**
 * GET /api/admin/call-center/:companyId/analytics/trend
 * Get call volume trend (for charts)
 */
router.get('/:companyId/analytics/trend', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 30 } = req.query;
    
    const trend = await AnalyticsService.getCallVolumeTrend(companyId, parseInt(days));
    res.json({ success: true, data: trend });
    
  } catch (error) {
    logger.error('[CALL_CENTER] Error fetching call trend', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({ success: false, error: 'Failed to fetch trend' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPLIANCE ROUTES (Phase 4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/call-center/:companyId/compliance/consent-requirements
 * Get consent requirements based on caller state
 */
router.get('/:companyId/compliance/consent-requirements', async (req, res) => {
  try {
    const { state } = req.query;
    const requirements = ComplianceService.getConsentRequirements(state);
    res.json({ success: true, data: requirements });
  } catch (error) {
    logger.error('[CALL_CENTER] Error getting consent requirements', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/call-center/:companyId/compliance/record-consent
 * Record consent for a call
 */
router.post('/:companyId/compliance/record-consent',
  auditLog.logModification('consent.recorded'),
  async (req, res) => {
    try {
      const { callId, consentType, callerState, method } = req.body;
      
      if (!callId || !consentType) {
        return res.status(400).json({ 
          success: false, 
          error: 'callId and consentType are required' 
        });
      }
      
      const call = await ComplianceService.recordConsent(callId, {
        consentType,
        callerState,
        method,
        agentId: req.user?.email
      });
      
      res.json({ success: true, data: call });
    } catch (error) {
      logger.error('[CALL_CENTER] Error recording consent', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/compliance/export/:customerId
 * Export all customer data (GDPR/CCPA)
 */
router.post('/:companyId/compliance/export/:customerId',
  auditLog.logAccess('customer.data_exported'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      const { format = 'json' } = req.body;
      
      const exportData = await ComplianceService.exportCustomerData(
        companyId,
        customerId,
        format,
        req.user?.email || 'admin'
      );
      
      res.json({ success: true, data: exportData });
    } catch (error) {
      logger.error('[CALL_CENTER] Error exporting customer data', { 
        error: error.message,
        customerId: req.params.customerId 
      });
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * DELETE /api/admin/call-center/:companyId/compliance/delete/:customerId
 * Delete all customer data (GDPR right to erasure)
 */
router.delete('/:companyId/compliance/delete/:customerId',
  authorizeRole(['admin', 'super_admin']),
  auditLog.logModification('customer.data_deleted'),
  async (req, res) => {
    try {
      const { companyId, customerId } = req.params;
      const { reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({ 
          success: false, 
          error: 'Deletion reason is required' 
        });
      }
      
      const result = await ComplianceService.deleteCustomerData(
        companyId,
        customerId,
        req.user?.email || 'admin',
        reason
      );
      
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('[CALL_CENTER] Error deleting customer data', { 
        error: error.message,
        customerId: req.params.customerId 
      });
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /api/admin/call-center/:companyId/compliance/merge
 * Merge duplicate customers
 */
router.post('/:companyId/compliance/merge',
  authorizeRole(['admin', 'super_admin']),
  auditLog.logModification('customer.merged'),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { primaryCustomerId, secondaryCustomerId } = req.body;
      
      if (!primaryCustomerId || !secondaryCustomerId) {
        return res.status(400).json({ 
          success: false, 
          error: 'primaryCustomerId and secondaryCustomerId are required' 
        });
      }
      
      const result = await ComplianceService.mergeCustomers(
        companyId,
        primaryCustomerId,
        secondaryCustomerId,
        req.user?.email || 'admin'
      );
      
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('[CALL_CENTER] Error merging customers', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /api/admin/call-center/:companyId/compliance/duplicates
 * Find potential duplicate customers
 */
router.get('/:companyId/compliance/duplicates', async (req, res) => {
  try {
    const { companyId } = req.params;
    const duplicates = await ComplianceService.findDuplicates(companyId);
    res.json({ success: true, data: duplicates });
  } catch (error) {
    logger.error('[CALL_CENTER] Error finding duplicates', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/call-center/:companyId/compliance/retention
 * Get data retention status
 */
router.get('/:companyId/compliance/retention', async (req, res) => {
  try {
    const { companyId } = req.params;
    const status = await ComplianceService.getRetentionStatus(companyId);
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('[CALL_CENTER] Error getting retention status', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/call-center/health
 * Health check (no auth required)
 */
router.get('/health', async (req, res) => {
  try {
    const [serviceHealth, rollupStatus, archiverStatus, purgeStatus] = await Promise.all([
      CallSummaryService.healthCheck(),
      getRollupStatus().catch(() => ({ status: 'UNKNOWN' })),
      getArchiverStatus().catch(() => ({ status: 'UNKNOWN' })),
      getPurgeStatus().catch(() => ({ status: 'UNKNOWN' }))
    ]);
    
    res.json({
      success: true,
      data: {
        module: 'Call Center',
        version: '2.0.0',
        service: serviceHealth,
        jobs: {
          dailyRollup: rollupStatus,
          transcriptArchiver: archiverStatus,
          dataPurge: purgeStatus
        }
      }
    });
    
  } catch (error) {
    res.status(503).json({
      success: false,
      error: 'Health check failed',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MODULE EXPORT
// ═══════════════════════════════════════════════════════════════════════════

module.exports = router;

