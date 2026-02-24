/**
 * ============================================================================
 * CALL REVIEW API — ENTERPRISE CALL DIAGNOSTIC ENDPOINTS
 * ClientVia Platform · Clean Architecture · Production Grade
 * 
 * ============================================================================
 * PURPOSE:
 * Provides API endpoints for the Call Console to:
 * - List calls with filtering and pagination
 * - Retrieve detailed call data with provenance tracking
 * - Export call data for compliance auditing
 * 
 * ============================================================================
 * PROVENANCE SYSTEM:
 * Every agent turn is tagged with its source:
 * - UI_OWNED:   Text comes from a UI-configured field
 * - FALLBACK:   Emergency fallback (allowed, but logged)
 * - HARDCODED:  VIOLATION — Text not from UI (forbidden)
 * 
 * The system traces the exact UI path where the text is configured,
 * enabling one-click navigation to fix violations.
 * 
 * ============================================================================
 * ENDPOINTS:
 * - GET    /:companyId/calls             — List calls with filters
 * - GET    /:companyId/calls/:callSid    — Get detailed call with provenance
 * - GET    /:companyId/calls/export      — Export calls for compliance
 * - DELETE /:companyId/calls/bulk-delete — Bulk delete calls
 * 
 * ============================================================================
 * @module routes/agentConsole/callReview
 * @version 1.0.0
 * @date February 2026
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');

const MODULE_ID = 'CALL_REVIEW_API';
const VERSION = 'CR1.0';

/* ============================================================================
   MODELS — Call Data Storage
   
   Real call data is stored in two models:
   - ConversationSession: Full session with turns, slots, discovery, booking state
   - CallTrace: Snapshot of call context after call ends
   
   ConversationSession is the primary source for Call Console as it has:
   - Full transcript (turns array)
   - Channel identifiers (twilioCallSid, callerPhone)
   - Discovery state, booking state, conversation memory
   ============================================================================ */

const ConversationSession = require('../../models/ConversationSession');
let CallTrace;
try {
  CallTrace = require('../../models/CallTrace');
} catch (err) {
  logger.warn(`[${MODULE_ID}] CallTrace model not found`);
  CallTrace = null;
}

/* ============================================================================
   PROVENANCE CONFIGURATION
   
   Maps backend code paths to their UI configuration locations.
   This is critical for the "If it's not in UI, it does NOT exist" rule.
   ============================================================================ */

const PROVENANCE_UI_MAP = {
  // Agent 2.0 Discovery
  'greetings.callStart': {
    uiPage: 'agent2.html',
    uiTab: 'greetings',
    uiSection: 'Call Start Greeting',
    description: 'Initial greeting when call starts'
  },
  'greetings.interceptor': {
    uiPage: 'agent2.html',
    uiTab: 'greetings',
    uiSection: 'Greeting Interceptor',
    description: 'Contextual greeting based on caller input'
  },
  'discovery.recoveryMessages': {
    uiPage: 'agent2.html',
    uiTab: 'recovery',
    uiSection: 'Recovery Messages',
    description: 'Messages when caller input not understood'
  },
  'discovery.fallbackMessages': {
    uiPage: 'agent2.html',
    uiTab: 'fallback',
    uiSection: 'Discovery Fallback',
    description: 'Ultimate fallback when all else fails'
  },
  'discovery.acknowledgment': {
    uiPage: 'agent2.html',
    uiTab: 'style',
    uiSection: 'Acknowledgment Word',
    description: 'Word used to acknowledge caller (e.g., "Ok.")'
  },

  // Triggers
  'triggers.global': {
    uiPage: 'triggers.html',
    uiTab: 'triggers',
    uiSection: 'Global Triggers',
    description: 'Platform-wide trigger responses'
  },
  'triggers.local': {
    uiPage: 'triggers.html',
    uiTab: 'triggers',
    uiSection: 'Local Triggers',
    description: 'Company-specific trigger responses'
  },

  // Booking Logic
  'bookingPrompts.askName': {
    uiPage: 'booking.html',
    uiTab: 'prompts',
    uiSection: 'Ask Name Prompt',
    description: 'Prompt to ask caller name'
  },
  'bookingPrompts.askPhone': {
    uiPage: 'booking.html',
    uiTab: 'prompts',
    uiSection: 'Ask Phone Prompt',
    description: 'Prompt to confirm phone number'
  },
  'bookingPrompts.askAddress': {
    uiPage: 'booking.html',
    uiTab: 'prompts',
    uiSection: 'Ask Address Prompt',
    description: 'Prompt to ask service address'
  },
  'bookingPrompts.offerTimes': {
    uiPage: 'booking.html',
    uiTab: 'prompts',
    uiSection: 'Offer Times Prompt',
    description: 'Prompt to offer available times'
  },
  'bookingPrompts.confirmation': {
    uiPage: 'booking.html',
    uiTab: 'confirmation',
    uiSection: 'Booking Confirmation',
    description: 'Message after successful booking'
  },
  'bookingLogic.holdMessage': {
    uiPage: 'booking.html',
    uiTab: 'prompts',
    uiSection: 'Hold Message',
    description: 'Message while checking calendar'
  },

  // Consent Phrases
  'discovery.bookingConsentPhrases': {
    uiPage: 'agent2.html',
    uiTab: 'consent',
    uiSection: 'Booking Consent',
    description: 'Phrases to confirm booking intent'
  },
  'discovery.escalationPhrases': {
    uiPage: 'agent2.html',
    uiTab: 'consent',
    uiSection: 'Escalation Phrases',
    description: 'Phrases triggering human escalation'
  }
};

/* ============================================================================
   HELPER: Enrich Turn with Provenance
   ============================================================================ */

/**
 * Analyze a turn and determine its provenance
 * @param {Object} turn - Raw turn data from call log
 * @param {Object} callMeta - Call metadata including config snapshot
 * @returns {Object} Turn with provenance data
 */
function enrichTurnWithProvenance(turn, callMeta) {
  if (turn.speaker === 'caller') {
    return {
      ...turn,
      provenance: null
    };
  }

  // Agent turn — determine provenance
  const provenance = {
    type: 'UNKNOWN',
    uiPath: null,
    uiPage: null,
    uiTab: null,
    uiSection: null,
    triggerId: null,
    reason: null,
    isViolation: false,
    violationSeverity: null,
    fixInstructions: null
  };

  // Check if turn has explicit source attribution (added at runtime)
  if (turn.sourceAttribution) {
    const attr = turn.sourceAttribution;
    
    if (attr.uiPath) {
      provenance.type = 'UI_OWNED';
      provenance.uiPath = attr.uiPath;
      
      const uiMapping = PROVENANCE_UI_MAP[attr.uiPath];
      if (uiMapping) {
        provenance.uiPage = uiMapping.uiPage;
        provenance.uiTab = uiMapping.uiTab;
        provenance.uiSection = uiMapping.uiSection;
        provenance.reason = uiMapping.description;
      }

      if (attr.triggerId) {
        provenance.triggerId = attr.triggerId;
      }
    } else if (attr.isFallback) {
      provenance.type = 'FALLBACK';
      provenance.reason = attr.fallbackReason || 'Emergency fallback activated';
    } else if (attr.isHardcoded) {
      provenance.type = 'HARDCODED';
      provenance.isViolation = true;
      provenance.violationSeverity = 'CRITICAL';
      provenance.reason = 'Text not traced to any UI configuration';
      provenance.fixInstructions = 'Add this text to the appropriate UI field or remove the hardcoded response';
    }
  } else {
    // No explicit attribution — attempt to infer from turn context
    provenance.type = inferProvenanceFromContext(turn, callMeta);
    
    if (provenance.type === 'HARDCODED') {
      provenance.isViolation = true;
      provenance.violationSeverity = 'CRITICAL';
      provenance.reason = 'No source attribution found';
      provenance.fixInstructions = 'Ensure runtime code adds sourceAttribution to all agent responses';
    }
  }

  return {
    ...turn,
    provenance
  };
}

/**
 * Attempt to infer provenance from turn context when no explicit attribution exists
 * @param {Object} turn - Turn data
 * @param {Object} callMeta - Call metadata
 * @returns {string} Provenance type
 */
function inferProvenanceFromContext(turn, callMeta) {
  const text = (turn.text || '').toLowerCase().trim();
  
  // Check if it matches known UI-configured texts from config snapshot
  if (callMeta?.configSnapshot) {
    const config = callMeta.configSnapshot;
    
    // Check greetings
    if (config.greetings?.callStart?.text?.toLowerCase().trim() === text) {
      return 'UI_OWNED';
    }
    
    // Check recovery messages
    const recoveryMsgs = config.recoveryMessages || [];
    if (recoveryMsgs.some(msg => msg.toLowerCase().trim() === text)) {
      return 'UI_OWNED';
    }
  }

  // If we can't determine, mark as potentially hardcoded for review
  return 'HARDCODED';
}

/* ============================================================================
   HELPER: Transform ConversationSession to Call Summary
   ============================================================================ */

/**
 * Transform a ConversationSession document to the call list summary format
 * @param {Object} session - ConversationSession document
 * @returns {Object} Call summary for list view
 */
function transformSessionToCallSummary(session) {
  const turns = session.turns || [];
  const agentTurns = turns.filter(t => t.role === 'assistant');
  const callerTurns = turns.filter(t => t.role === 'user');
  
  // Analyze provenance from turn metadata
  let uiOwnedCount = 0;
  let fallbackCount = 0;
  let hardcodedCount = 0;

  agentTurns.forEach(turn => {
    const source = turn.responseSource?.toLowerCase() || '';
    
    // Map responseSource to provenance types
    if (source === 'template' || source === 'triage' || source === 'state_machine' || 
        source === 'quick_answer' || source === 'greeting' || source === 'booking') {
      uiOwnedCount++;
    } else if (source === 'llm' || source === 'llm_fallback') {
      // LLM responses could be fallback - check if fallback was active
      if (session.conversationMemory?.isFallbackActive) {
        fallbackCount++;
      } else {
        uiOwnedCount++; // LLM with context is UI-driven
      }
    } else if (source === 'silence') {
      // Silence events don't count
    } else {
      // Unknown source - potentially hardcoded
      // For now, mark as UI-owned if it has a known source pattern
      if (source) {
        uiOwnedCount++;
      } else {
        hardcodedCount++;
      }
    }
  });

  // Calculate duration
  let durationSeconds = session.metrics?.durationSeconds;
  if (!durationSeconds && session.startedAt && session.endedAt) {
    durationSeconds = Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 1000);
  }

  // Detect problems
  const problems = [];
  if (session.conversationMemory?.offRailsCount > 2) {
    problems.push({ message: `Went off-rails ${session.conversationMemory.offRailsCount} times` });
  }
  if (session.status === 'error') {
    problems.push({ message: 'Session ended with error' });
  }

  return {
    callSid: session.channelIdentifiers?.twilioCallSid || session._id.toString(),
    fromPhone: session.channelIdentifiers?.callerPhone || 'Unknown',
    toPhone: session.channelIdentifiers?.calledNumber || '',
    startTime: session.startedAt,
    endTime: session.endedAt,
    durationSeconds: durationSeconds || 0,
    turnCount: turns.length,
    agentTurnCount: agentTurns.length,
    callerTurnCount: callerTurns.length,
    uiOwnedCount,
    fallbackCount,
    hardcodedCount,
    hasHardcodedViolation: hardcodedCount > 0,
    hasFallback: fallbackCount > 0 || session.conversationMemory?.isFallbackActive,
    problemCount: problems.length + hardcodedCount,
    status: session.status,
    outcome: session.outcome,
    mode: session.mode
  };
}

/* ============================================================================
   HELPER: Calculate Call Summary Metrics (for enriched turns)
   ============================================================================ */

/**
 * Calculate summary metrics for enriched turns
 * @param {Array} turns - Array of turns with provenance
 * @returns {Object} Summary metrics
 */
function calculateCallSummary(turns) {
  const agentTurns = turns.filter(t => t.speaker === 'agent');
  
  let uiOwnedCount = 0;
  let fallbackCount = 0;
  let hardcodedCount = 0;

  agentTurns.forEach(turn => {
    const type = turn.provenance?.type;
    if (type === 'UI_OWNED') uiOwnedCount++;
    else if (type === 'FALLBACK') fallbackCount++;
    else if (type === 'HARDCODED') hardcodedCount++;
  });

  return {
    turnCount: turns.length,
    agentTurnCount: agentTurns.length,
    callerTurnCount: turns.length - agentTurns.length,
    uiOwnedCount,
    fallbackCount,
    hardcodedCount,
    hasHardcodedViolation: hardcodedCount > 0,
    hasFallback: fallbackCount > 0
  };
}

/* ============================================================================
   HELPER: Build Date Range Filter
   ============================================================================ */

/**
 * Build MongoDB date filter based on range string
 * @param {string} range - Date range (today, yesterday, week, month, all)
 * @returns {Object|null} MongoDB date filter
 */
function buildDateFilter(range) {
  const now = new Date();
  let startDate;

  switch (range) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'yesterday':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const endYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { $gte: startDate, $lt: endYesterday };
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
    default:
      return null;
  }

  return { $gte: startDate };
}

/* ============================================================================
   API ENDPOINTS
   ============================================================================ */

/**
 * GET /:companyId/calls
 * 
 * List calls with filtering and pagination
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 25, max: 100)
 * - dateRange: today|yesterday|week|month|all (default: week)
 * - search: Search by phone or CallSid
 * - status: clean|violations|problems
 */
router.get(
  '/:companyId/calls',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const { 
      page = '1', 
      limit = '25', 
      dateRange = 'week',
      search = '',
      status = ''
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const requestId = `calls_list_${Date.now()}`;

    logger.info(`[${MODULE_ID}] List calls request`, {
      companyId,
      requestId,
      page: pageNum,
      limit: limitNum,
      dateRange,
      search: search ? `"${search}"` : 'none',
      status
    });

    try {
      // Build query for ConversationSession
      // Note: companyId in ConversationSession is ObjectId, need to handle both string and ObjectId
      const query = { 
        companyId: companyId,
        channel: 'voice' // Only show voice calls in Call Console
      };

      // Date filter - ConversationSession uses startedAt
      const dateFilter = buildDateFilter(dateRange);
      if (dateFilter) {
        query.startedAt = dateFilter;
      }

      // Search filter
      if (search) {
        query.$or = [
          { 'channelIdentifiers.twilioCallSid': { $regex: search, $options: 'i' } },
          { 'channelIdentifiers.callerPhone': { $regex: search, $options: 'i' } },
          { 'channelIdentifiers.calledNumber': { $regex: search, $options: 'i' } }
        ];
      }

      // Execute query on ConversationSession
      const [sessions, total] = await Promise.all([
        ConversationSession.find(query)
          .sort({ startedAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        ConversationSession.countDocuments(query)
      ]);

      // Transform sessions to call list format
      const calls = sessions.map(session => transformSessionToCallSummary(session));

      // Status filter (post-processing)
      let filteredCalls = calls;
      if (status === 'clean') {
        filteredCalls = calls.filter(c => !c.hasHardcodedViolation && c.problemCount === 0);
      } else if (status === 'violations') {
        filteredCalls = calls.filter(c => c.hasHardcodedViolation);
      } else if (status === 'problems') {
        filteredCalls = calls.filter(c => c.problemCount > 0);
      }

      logger.info(`[${MODULE_ID}] List calls success`, {
        requestId,
        returned: filteredCalls.length,
        total
      });

      res.json({
        success: true,
        requestId,
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        calls: filteredCalls
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] List calls failed: ${error.message}`, {
        requestId,
        companyId,
        stack: error.stack
      });

      res.status(500).json({
        error: 'Failed to list calls',
        message: error.message,
        requestId
      });
    }
  }
);

/**
 * GET /:companyId/calls/export
 * 
 * Export calls for compliance auditing
 */
router.get(
  '/:companyId/calls/export',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const { dateRange = 'week', search = '' } = req.query;
    const requestId = `calls_export_${Date.now()}`;

    logger.info(`[${MODULE_ID}] Export calls request`, { companyId, requestId, dateRange });

    try {
      // Build query
      const query = { 
        companyId,
        channel: 'voice'
      };
      
      const dateFilter = buildDateFilter(dateRange);
      if (dateFilter) {
        query.startedAt = dateFilter;
      }
      if (search) {
        query.$or = [
          { 'channelIdentifiers.twilioCallSid': { $regex: search, $options: 'i' } },
          { 'channelIdentifiers.callerPhone': { $regex: search, $options: 'i' } }
        ];
      }

      const sessions = await ConversationSession.find(query)
        .sort({ startedAt: -1 })
        .limit(1000)
        .lean();

      // Process with summaries
      const exportData = sessions.map(session => {
        const summary = transformSessionToCallSummary(session);
        return {
          ...summary,
          discovery: session.discovery || null,
          booking: session.booking || null,
          conversationMemory: {
            currentStage: session.conversationMemory?.currentStage,
            offRailsCount: session.conversationMemory?.offRailsCount || 0
          },
          turns: (session.turns || []).map(t => ({
            role: t.role,
            content: t.content,
            timestamp: t.timestamp,
            responseSource: t.responseSource
          }))
        };
      });

      res.json({
        success: true,
        requestId,
        exportedAt: new Date().toISOString(),
        companyId,
        dateRange,
        totalCalls: exportData.length,
        calls: exportData
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Export calls failed: ${error.message}`, {
        requestId,
        companyId,
        stack: error.stack
      });

      res.status(500).json({
        error: 'Failed to export calls',
        message: error.message,
        requestId
      });
    }
  }
);

/**
 * GET /:companyId/calls/:callSid
 * 
 * Get detailed call data with full provenance tracking
 */
router.get(
  '/:companyId/calls/:callSid',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId, callSid } = req.params;
    const requestId = `call_detail_${Date.now()}`;

    logger.info(`[${MODULE_ID}] Get call detail`, { companyId, callSid, requestId });

    try {
      // Find session by twilioCallSid or _id
      let session = await ConversationSession.findOne({
        companyId,
        'channelIdentifiers.twilioCallSid': callSid
      }).lean();

      // If not found by callSid, try by _id
      if (!session) {
        try {
          session = await ConversationSession.findOne({
            companyId,
            _id: callSid
          }).lean();
        } catch (e) {
          // Invalid ObjectId, ignore
        }
      }

      if (!session) {
        return res.status(404).json({
          error: 'Call not found',
          callSid,
          requestId
        });
      }

      // Transform turns to our format with provenance
      const enrichedTurns = (session.turns || []).map((turn, index) => {
        const isCaller = turn.role === 'user';
        
        const baseTurn = {
          turnNumber: index + 1,
          speaker: isCaller ? 'caller' : 'agent',
          text: turn.content || '',
          timestamp: turn.timestamp
        };

        if (isCaller) {
          return { ...baseTurn, provenance: null };
        }

        // Agent turn - determine provenance from responseSource
        const source = turn.responseSource?.toLowerCase() || '';
        let provenance = {
          type: 'UNKNOWN',
          uiPath: null,
          reason: null,
          isViolation: false
        };

        if (source === 'template' || source === 'triage') {
          provenance.type = 'UI_OWNED';
          provenance.uiPath = 'triggers';
          provenance.reason = 'Response from trigger card match';
        } else if (source === 'state_machine' || source === 'booking') {
          provenance.type = 'UI_OWNED';
          provenance.uiPath = 'bookingPrompts';
          provenance.reason = 'Response from booking state machine';
        } else if (source === 'quick_answer') {
          provenance.type = 'UI_OWNED';
          provenance.uiPath = 'triggers';
          provenance.reason = 'Quick answer from trigger';
        } else if (source === 'greeting') {
          provenance.type = 'UI_OWNED';
          provenance.uiPath = 'greetings.callStart';
          provenance.reason = 'Configured greeting';
        } else if (source === 'llm' || source === 'llm_fallback') {
          // Check if in fallback mode
          if (session.conversationMemory?.isFallbackActive) {
            provenance.type = 'FALLBACK';
            provenance.reason = 'LLM fallback - conversation went off-rails';
          } else {
            provenance.type = 'UI_OWNED';
            provenance.uiPath = 'discovery';
            provenance.reason = 'LLM response with UI-configured context';
          }
        } else if (source === 'silence') {
          provenance.type = 'UI_OWNED';
          provenance.reason = 'Silence handler';
        } else if (source) {
          provenance.type = 'UI_OWNED';
          provenance.reason = `Source: ${source}`;
        } else {
          // No source - mark as potentially hardcoded
          provenance.type = 'HARDCODED';
          provenance.isViolation = true;
          provenance.violationSeverity = 'CRITICAL';
          provenance.reason = 'No responseSource attribute found';
          provenance.fixInstructions = 'Add responseSource to this turn in runtime code';
        }

        return { ...baseTurn, provenance };
      });

      const summary = calculateCallSummary(enrichedTurns);

      // Build problems list
      const problems = [];
      if (summary.hardcodedCount > 0) {
        problems.push({
          message: `${summary.hardcodedCount} agent turn(s) without proper source attribution`,
          severity: 'CRITICAL'
        });
      }
      if (session.conversationMemory?.offRailsCount > 2) {
        problems.push({
          message: `Conversation went off-rails ${session.conversationMemory.offRailsCount} times`,
          severity: 'HIGH'
        });
      }
      if (session.status === 'error') {
        problems.push({
          message: 'Session ended with error status',
          severity: 'MEDIUM'
        });
      }

      // Build events from audit trail
      const events = (session.conversationMemory?.auditTrail || []).map(entry => ({
        timestamp: entry.timestamp,
        type: entry.type,
        data: {
          stage: entry.stage,
          step: entry.step,
          ...entry.data
        }
      }));

      // Calculate duration
      let durationSeconds = session.metrics?.durationSeconds;
      if (!durationSeconds && session.startedAt && session.endedAt) {
        durationSeconds = Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 1000);
      }

      res.json({
        success: true,
        requestId,
        callSid: session.channelIdentifiers?.twilioCallSid || session._id.toString(),
        fromPhone: session.channelIdentifiers?.callerPhone || 'Unknown',
        toPhone: session.channelIdentifiers?.calledNumber || '',
        startTime: session.startedAt,
        endTime: session.endedAt,
        durationSeconds: durationSeconds || 0,
        status: session.status,
        outcome: session.outcome,
        mode: session.mode,
        
        // Provenance summary
        provenanceSummary: {
          totalAgentTurns: summary.agentTurnCount,
          uiOwned: summary.uiOwnedCount,
          fallbacks: summary.fallbackCount,
          violations: summary.hardcodedCount
        },

        // LLM usage
        llmUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: session.metrics?.totalTokens || 0
        },

        // Problems detected
        problems,

        // Full transcript with provenance
        turns: enrichedTurns,

        // Events from audit trail
        events,

        // Discovery context
        discovery: session.discovery || null,

        // Booking state
        booking: session.booking || null,

        // Config snapshot reference
        configSnapshotId: null
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Get call detail failed: ${error.message}`, {
        requestId,
        companyId,
        callSid,
        stack: error.stack
      });

      res.status(500).json({
        error: 'Failed to get call details',
        message: error.message,
        requestId
      });
    }
  }
);

/**
 * DELETE /:companyId/calls/bulk-delete
 * 
 * Bulk delete multiple calls by their session IDs/CallSids
 * Supports deletion by twilioCallSid or MongoDB _id
 */
router.delete(
  '/:companyId/calls/bulk-delete',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    const { companyId } = req.params;
    const { callSids } = req.body;
    const requestId = `bulk_delete_${Date.now()}`;

    logger.info(`[${MODULE_ID}] Bulk delete calls request`, {
      companyId,
      callSidsCount: callSids?.length,
      requestId
    });

    if (!Array.isArray(callSids) || callSids.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'callSids must be a non-empty array',
        requestId
      });
    }

    if (callSids.length > 100) {
      return res.status(400).json({
        error: 'Limit exceeded',
        message: 'Cannot delete more than 100 calls at once',
        requestId
      });
    }

    try {
      // Build query to match by twilioCallSid OR by _id
      const mongoObjectIds = [];
      const twilioCallSids = [];

      for (const sid of callSids) {
        if (sid.match(/^[a-f0-9]{24}$/i)) {
          mongoObjectIds.push(sid);
        } else {
          twilioCallSids.push(sid);
        }
      }

      const query = {
        companyId,
        $or: []
      };

      if (twilioCallSids.length > 0) {
        query.$or.push({ 'channelIdentifiers.twilioCallSid': { $in: twilioCallSids } });
      }
      if (mongoObjectIds.length > 0) {
        query.$or.push({ _id: { $in: mongoObjectIds } });
      }

      // If no valid identifiers, return early
      if (query.$or.length === 0) {
        return res.json({
          success: true,
          deletedCount: 0,
          requestId
        });
      }

      // Perform deletion
      const result = await ConversationSession.deleteMany(query);

      logger.info(`[${MODULE_ID}] Bulk delete completed`, {
        requestId,
        companyId,
        requestedCount: callSids.length,
        deletedCount: result.deletedCount
      });

      res.json({
        success: true,
        deletedCount: result.deletedCount,
        requestId
      });
    } catch (error) {
      logger.error(`[${MODULE_ID}] Bulk delete failed: ${error.message}`, {
        requestId,
        companyId,
        callSidsCount: callSids.length,
        stack: error.stack
      });

      res.status(500).json({
        error: 'Bulk delete failed',
        message: error.message,
        requestId
      });
    }
  }
);

/* ============================================================================
   MOCK DATA GENERATORS — For Development/Testing
   ============================================================================ */

/**
 * Generate mock call list data
 * @param {string} companyId - Company ID
 * @param {number} count - Number of mock calls
 * @returns {Array} Mock call array
 */
function generateMockCalls(companyId, count) {
  const calls = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const hasViolation = Math.random() < 0.15;
    const hasFallback = !hasViolation && Math.random() < 0.25;
    const problemCount = hasViolation ? Math.floor(Math.random() * 3) + 1 : 0;

    calls.push({
      callSid: `CA${Math.random().toString(36).substring(2, 10).toUpperCase()}${Date.now()}`,
      fromPhone: `+1${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
      toPhone: '+18005551234',
      startTime: new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      durationSeconds: Math.floor(Math.random() * 300) + 30,
      turnCount: Math.floor(Math.random() * 12) + 4,
      hasHardcodedViolation: hasViolation,
      hasFallback,
      problemCount
    });
  }

  return calls.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
}

/**
 * Generate mock detailed call data
 * @param {string} companyId - Company ID
 * @param {string} callSid - Call SID
 * @returns {Object} Mock call detail
 */
function generateMockCallDetail(companyId, callSid) {
  const startTime = new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000);
  const durationSeconds = Math.floor(Math.random() * 300) + 60;

  const turns = [
    {
      turnNumber: 1,
      speaker: 'agent',
      text: 'Hi, thanks for calling! How can I help you today?',
      timestamp: startTime.toISOString(),
      sourceAttribution: {
        uiPath: 'greetings.callStart',
        type: 'UI_OWNED'
      }
    },
    {
      turnNumber: 2,
      speaker: 'caller',
      text: 'Hi, I need to schedule an appointment for my AC unit.',
      timestamp: new Date(startTime.getTime() + 5000).toISOString()
    },
    {
      turnNumber: 3,
      speaker: 'agent',
      text: 'Ok. I can help you schedule an AC service appointment. Let me check our available times.',
      timestamp: new Date(startTime.getTime() + 8000).toISOString(),
      sourceAttribution: {
        uiPath: 'discovery.acknowledgment',
        triggerId: 'trigger_ac_service',
        type: 'UI_OWNED'
      }
    },
    {
      turnNumber: 4,
      speaker: 'agent',
      text: 'Please hold while I check our calendar.',
      timestamp: new Date(startTime.getTime() + 10000).toISOString(),
      sourceAttribution: {
        uiPath: 'bookingLogic.holdMessage',
        type: 'UI_OWNED'
      }
    },
    {
      turnNumber: 5,
      speaker: 'agent',
      text: 'I have availability tomorrow at 9 AM, 11 AM, or 2 PM. Which works best for you?',
      timestamp: new Date(startTime.getTime() + 15000).toISOString(),
      sourceAttribution: {
        uiPath: 'bookingPrompts.offerTimes',
        type: 'UI_OWNED'
      }
    },
    {
      turnNumber: 6,
      speaker: 'caller',
      text: '2 PM works great.',
      timestamp: new Date(startTime.getTime() + 20000).toISOString()
    },
    {
      turnNumber: 7,
      speaker: 'agent',
      text: 'Perfect! Can I get your name for the appointment?',
      timestamp: new Date(startTime.getTime() + 22000).toISOString(),
      sourceAttribution: {
        uiPath: 'bookingPrompts.askName',
        type: 'UI_OWNED'
      }
    },
    {
      turnNumber: 8,
      speaker: 'caller',
      text: 'John Smith.',
      timestamp: new Date(startTime.getTime() + 25000).toISOString()
    },
    {
      turnNumber: 9,
      speaker: 'agent',
      text: "Great, John! You're all set for tomorrow at 2 PM for AC service. We'll send you a confirmation text. Is there anything else I can help with?",
      timestamp: new Date(startTime.getTime() + 28000).toISOString(),
      sourceAttribution: {
        uiPath: 'bookingPrompts.confirmation',
        type: 'UI_OWNED'
      }
    },
    {
      turnNumber: 10,
      speaker: 'caller',
      text: "No, that's all. Thank you!",
      timestamp: new Date(startTime.getTime() + 32000).toISOString()
    }
  ];

  return {
    success: true,
    requestId: `mock_${Date.now()}`,
    callSid,
    fromPhone: '+15551234567',
    toPhone: '+18005551234',
    startTime: startTime.toISOString(),
    endTime: new Date(startTime.getTime() + durationSeconds * 1000).toISOString(),
    durationSeconds,
    status: 'completed',
    provenanceSummary: {
      totalAgentTurns: 6,
      uiOwned: 6,
      fallbacks: 0,
      violations: 0
    },
    llmUsage: {
      promptTokens: 245,
      completionTokens: 89,
      totalTokens: 334
    },
    problems: [],
    turns: turns.map(turn => enrichTurnWithProvenance(turn, {})),
    events: [
      { timestamp: startTime.toISOString(), type: 'call.started', data: { direction: 'inbound' } },
      { timestamp: new Date(startTime.getTime() + 5000).toISOString(), type: 'speech.recognized', data: { confidence: 0.95 } },
      { timestamp: new Date(startTime.getTime() + 15000).toISOString(), type: 'calendar.checked', data: { slotsFound: 3 } },
      { timestamp: new Date(startTime.getTime() + 28000).toISOString(), type: 'booking.created', data: { appointmentId: 'apt_123' } },
      { timestamp: new Date(startTime.getTime() + durationSeconds * 1000).toISOString(), type: 'call.ended', data: { reason: 'completed' } }
    ],
    configSnapshotId: null,
    _mock: true
  };
}

module.exports = router;
