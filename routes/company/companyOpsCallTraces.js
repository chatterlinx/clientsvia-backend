/**
 * ============================================================================
 * COMPANYOPS CALL TRACES - READ-ONLY ROUTES
 * ============================================================================
 * 
 * PURPOSE: View call history for CompanyOps Console
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET /api/company/:companyId/call-traces
 * - GET /api/company/:companyId/call-traces/:callId
 * 
 * MODEL: CallTrace (Phase 1)
 * 
 * KEY FEATURES:
 * - Filter by date range, intent, outcome, tier usage
 * - Full transcript view
 * - FrontlineContext dump
 * - Tier trace visualization data
 * - Extracted context display
 * 
 * NOTE: This is READ-ONLY. CallTraces are created automatically by the
 * call engine (via usageService.finalizeCallTrace).
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const CallTrace = require('../../models/CallTrace');
const V2Contact = require('../../models/v2Contact');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/company/:companyId/call-traces
 * ============================================================================
 * Get all call traces for a company with filters
 * 
 * Query params:
 * - dateFrom: ISO date string
 * - dateTo: ISO date string
 * - intent: string (booking, info, troubleshooting, billing, spam, wrong number, other)
 * - outcome: string (Booked, Transferred, Message, Hung Up, Abandoned)
 * - usedTier3: boolean (filter calls that used Tier 3 LLM)
 * - contactId: string (filter by resolved contact)
 * - phoneNumber: string (search by phone)
 * - limit: number (default 50)
 * - offset: number (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      dateFrom,
      dateTo,
      intent,
      outcome,
      usedTier3,
      contactId,
      phoneNumber,
      limit = 50,
      offset = 0
    } = req.query;

    // Build query
    const query = { companyId };

    // Date range filter
    if (dateFrom || dateTo) {
      query.startedAt = {};
      if (dateFrom) query.startedAt.$gte = new Date(dateFrom).getTime();
      if (dateTo) query.startedAt.$lte = new Date(dateTo).getTime();
    }

    // Intent filter
    if (intent) {
      query.currentIntent = intent;
    }

    // Outcome filter (stored in extracted or inferred from tierTrace)
    if (outcome) {
      // This might need adjustment based on actual schema
      query['extracted.finalOutcome'] = outcome;
    }

    // Tier 3 usage filter
    if (usedTier3 === 'true') {
      query['tierTrace'] = {
        $elemMatch: { tier: 3 }
      };
    }

    // Contact filter
    if (contactId) {
      query['extracted.contactId'] = contactId;
    }

    // Phone number search
    if (phoneNumber) {
      query['extracted.callerPhone'] = new RegExp(phoneNumber, 'i');
    }

    // Get call traces
    const callTraces = await CallTrace.find(query)
      .sort({ startedAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .select('-transcript') // Exclude full transcript from list view for performance
      .lean();

    // Get total count
    const total = await CallTrace.countDocuments(query);

    // Enrich with contact names
    const enrichedCallTraces = await Promise.all(
      callTraces.map(async (trace) => {
        try {
          let contactName = null;
          
          // Try to resolve contact name
          if (trace.extracted?.contactId) {
            const contact = await V2Contact.findOne({
              _id: trace.extracted.contactId,
              companyId
            })
              .select('name')
              .lean();
            
            contactName = contact?.name || null;
          }

          // Calculate tier usage percentages
          const tierCounts = { tier1: 0, tier2: 0, tier3: 0 };
          if (trace.tierTrace && Array.isArray(trace.tierTrace)) {
            trace.tierTrace.forEach(t => {
              if (t.tier === 1) tierCounts.tier1++;
              if (t.tier === 2) tierCounts.tier2++;
              if (t.tier === 3) tierCounts.tier3++;
            });
          }

          const totalTiers = tierCounts.tier1 + tierCounts.tier2 + tierCounts.tier3;
          const tierUsage = totalTiers > 0 ? {
            tier1Percent: Math.round((tierCounts.tier1 / totalTiers) * 100),
            tier2Percent: Math.round((tierCounts.tier2 / totalTiers) * 100),
            tier3Percent: Math.round((tierCounts.tier3 / totalTiers) * 100),
            totalTurns: totalTiers
          } : null;

          // Calculate duration
          const durationSeconds = trace.endedAt && trace.startedAt
            ? Math.floor((trace.endedAt - trace.startedAt) / 1000)
            : 0;

          // Determine direction (if available in schema)
          const direction = trace.direction || 'Inbound';

          // Get phone number
          const phoneNumber = trace.extracted?.callerPhone || 'Unknown';

          // Determine final outcome (from extracted or inferred)
          const finalOutcome = trace.extracted?.finalOutcome || 
                              (trace.appointmentId ? 'Booked' : 
                               trace.readyToBook ? 'Booking Attempted' : 
                               'Unknown');

          return {
            _id: trace._id,
            callId: trace.callId,
            startedAt: trace.startedAt,
            durationSeconds,
            direction,
            phoneNumber,
            contactName,
            intentSummary: trace.currentIntent || 'Unknown',
            tierUsage,
            finalOutcome,
            readyToBook: trace.readyToBook || false,
            appointmentId: trace.appointmentId || null
          };
        } catch (err) {
          logger.error('[CompanyOps CallTraces] Error enriching trace', {
            callId: trace.callId,
            error: err.message
          });
          return {
            _id: trace._id,
            callId: trace.callId,
            startedAt: trace.startedAt,
            error: 'Failed to enrich data'
          };
        }
      })
    );

    res.json({
      ok: true,
      data: enrichedCallTraces,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: offset + callTraces.length < total
      }
    });

  } catch (error) {
    logger.error('[CompanyOps CallTraces] GET all failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch call traces'
    });
  }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/call-traces/:callId
 * ============================================================================
 * Get a single call trace with full details
 * 
 * Returns:
 * - Full transcript
 * - Complete FrontlineContext
 * - Tier trace with timestamps and confidence
 * - Extracted context
 * - Linked appointment (if exists)
 */
router.get('/:callId', async (req, res) => {
  try {
    const { companyId, callId } = req.params;

    const callTrace = await CallTrace.findOne({
      callId,
      companyId
    }).lean();

    if (!callTrace) {
      return res.status(404).json({
        ok: false,
        error: 'Call trace not found'
      });
    }

    // Try to resolve contact info
    let contact = null;
    if (callTrace.extracted?.contactId) {
      contact = await V2Contact.findOne({
        _id: callTrace.extracted.contactId,
        companyId
      })
        .select('name primaryPhone email')
        .lean();
    }

    // Calculate duration
    const durationSeconds = callTrace.endedAt && callTrace.startedAt
      ? Math.floor((callTrace.endedAt - callTrace.startedAt) / 1000)
      : 0;

    // Format transcript for display
    const formattedTranscript = callTrace.transcript?.map((turn, index) => ({
      turnNumber: index + 1,
      role: turn.role,
      text: turn.text,
      timestamp: turn.timestamp || null
    })) || [];

    // Format tier trace for display
    const formattedTierTrace = callTrace.tierTrace?.map((trace, index) => ({
      turnNumber: index + 1,
      tier: trace.tier,
      confidence: trace.confidence,
      sourceId: trace.sourceId || null,
      timestamp: trace.timestamp || null,
      action: trace.action || null,
      intent: trace.intent || null,
      reasoning: trace.reasoning || null
    })) || [];

    res.json({
      ok: true,
      data: {
        // Call metadata
        callId: callTrace.callId,
        companyId: callTrace.companyId,
        trade: callTrace.trade,
        startedAt: callTrace.startedAt,
        endedAt: callTrace.endedAt,
        durationSeconds,
        
        // Intent & outcome
        currentIntent: callTrace.currentIntent,
        readyToBook: callTrace.readyToBook,
        appointmentId: callTrace.appointmentId || null,
        
        // Configuration
        configVersion: callTrace.configVersion,
        
        // Resolved data
        contact,
        
        // Detailed context
        extracted: callTrace.extracted || {},
        triageMatches: callTrace.triageMatches || [],
        
        // Conversation data
        transcript: formattedTranscript,
        tierTrace: formattedTierTrace,
        
        // Timestamps
        createdAt: callTrace.createdAt,
        updatedAt: callTrace.updatedAt
      }
    });

  } catch (error) {
    logger.error('[CompanyOps CallTraces] GET one failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId,
      callId: req.params.callId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch call trace'
    });
  }
});

module.exports = router;

