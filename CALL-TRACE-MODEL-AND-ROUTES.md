# 📘 CallTrace Logging Model & Minimal Routes (v1)

**Purpose:** Capture complete audit trail per call for debugging, analytics, and platform operations.

---

## 🧱 MongoDB Model – `models/CallTrace.js`

```javascript
const mongoose = require('mongoose');

// ============================================================================
// TURN SCHEMA - One entry per AI interaction in a call
// ============================================================================
const turnSchema = new mongoose.Schema({
  turnIndex: Number,                    // Sequential turn number (1, 2, 3...)
  timestamp: Date,                      // When this turn occurred
  
  userInput: {
    text: String,                       // What caller said (ASR output)
    asrProvider: String,                // Deepgram, Twilio, etc.
    asrConfidence: Number,              // 0-1 confidence score
  },
  
  aiBrain: {
    tierUsed: Number,                   // 1, 2, 3, or null if no match
    tier1Score: Number,                 // Tier 1 confidence (if attempted)
    tier2Score: Number,                 // Tier 2 confidence (if attempted)
    tier3Confidence: Number,            // Tier 3 confidence (if attempted)
    
    scenarioId: String,                 // Which scenario was selected
    scenarioName: String,               // Scenario name for readability
    
    scenarioTypeResolved: String,       // INFO_FAQ, ACTION_FLOW, SYSTEM_ACK, SMALL_TALK
    replyStrategyResolved: String,      // AUTO, FULL_ONLY, QUICK_ONLY, QUICK_THEN_FULL
    responseStrategyUsed: String,       // What Response Engine actually did
    
    responseText: String,               // Final text sent to TTS/SMS
  },
  
  timing: {
    aiBrainTimeMs: Number,              // How long AI Brain took
    totalTurnTimeMs: Number,            // Total turn time (ASR + AI + TTS)
  },
  
  flags: {
    escalatedThisTurn: Boolean,         // Did this turn trigger escalation?
    nullResponse: Boolean,              // Did response engine return null?
    lowConfidence: Boolean,             // Confidence below threshold?
    configError: Boolean,               // Config issue detected (QUICK_ONLY on INFO_FAQ)?
  },
}, { _id: false });

// ============================================================================
// LLM CALL SCHEMA - Track every LLM call for cost + debugging
// ============================================================================
const llmCallSchema = new mongoose.Schema({
  timestamp: Date,
  model: String,                        // gpt-4o-mini, gpt-3.5-turbo, etc.
  purpose: String,                      // tier3_match, llm_wrap, llm_context
  promptTokens: Number,
  completionTokens: Number,
  costUsd: Number,
}, { _id: false });

// ============================================================================
// MAIN CALL TRACE SCHEMA
// ============================================================================
const callTraceSchema = new mongoose.Schema({
  // Identification
  callId: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'v2Company',
    index: true
  },
  
  // Call metadata
  channel: {
    type: String,
    enum: ['voice', 'sms', 'chat'],
    default: 'voice'
  },
  
  callerNumber: String,                 // Caller ID (optional, for voice)
  
  startedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  endedAt: Date,
  
  totalDurationMs: Number,              // Call length in ms
  
  // Outcome
  finalOutcome: {
    type: String,
    enum: ['ai_resolved', 'escalated_to_human', 'caller_hung_up', 'error'],
    default: 'ai_resolved'
  },
  
  // Full conversation
  turns: [turnSchema],
  
  // LLM usage tracking
  llmCalls: [llmCallSchema],
  
  // Aggregated stats (for quick querying)
  stats: {
    totalTurns: Number,
    tier1Hits: Number,
    tier2Hits: Number,
    tier3Hits: Number,
    nullResponses: Number,
    escalations: Number,
    totalLLMCostUsd: Number,
  },
  
  // TTL - auto-delete after 90 days (optional)
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
    expires: 7776000  // 90 days in seconds
  }
}, {
  timestamps: false
});

// Indexes for efficient querying
callTraceSchema.index({ companyId: 1, startedAt: -1 });
callTraceSchema.index({ callId: 1 });

module.exports = mongoose.model('CallTrace', callTraceSchema);
```

---

## ⚙️ API Routes – `routes/admin/callTraces.js` (NEW FILE)

```javascript
const express = require('express');
const router = express.Router();
const CallTrace = require('../../models/CallTrace');
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ============================================================================
// LIST CALL TRACES (Paginated)
// ============================================================================
/**
 * GET /admin/call-traces
 * Query: ?companyId=...&dateFrom=...&dateTo=...&page=1&limit=20&outcome=ai_resolved
 */
router.get('/call-traces', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { companyId, dateFrom, dateTo, page = 1, limit = 20, outcome } = req.query;
    
    // Build filter
    const filter = {};
    if (companyId) filter.companyId = companyId;
    if (outcome) filter.finalOutcome = outcome;
    
    if (dateFrom || dateTo) {
      filter.startedAt = {};
      if (dateFrom) filter.startedAt.$gte = new Date(dateFrom);
      if (dateTo) filter.startedAt.$lte = new Date(dateTo);
    }
    
    // Fetch traces
    const traces = await CallTrace.find(filter)
      .sort({ startedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('callId companyId startedAt endedAt channel finalOutcome totalDurationMs stats.totalTurns stats.tier3Hits')
      .lean();
    
    // Get total count for pagination
    const total = await CallTrace.countDocuments(filter);
    
    logger.info('✅ [CALL TRACES] List fetched', {
      count: traces.length,
      total,
      page,
      limit
    });
    
    res.json({
      traces,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    logger.error('❌ [CALL TRACES] List error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// GET DETAILED CALL TRACE
// ============================================================================
/**
 * GET /admin/call-traces/:callId
 */
router.get('/call-traces/:callId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { callId } = req.params;
    
    const trace = await CallTrace.findOne({ callId })
      .populate('companyId', 'companyName')
      .lean();
    
    if (!trace) {
      return res.status(404).json({ error: 'Call trace not found' });
    }
    
    logger.info('✅ [CALL TRACES] Detail fetched', {
      callId,
      companyId: trace.companyId,
      turns: trace.turns.length
    });
    
    res.json(trace);
    
  } catch (error) {
    logger.error('❌ [CALL TRACES] Detail error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SAVE CALL TRACE (Called from runtime at call end)
// ============================================================================
/**
 * POST /api/call-traces/log
 * Internal API - called from Twilio handler or v2AIAgentRuntime
 */
router.post('/call-traces/log', async (req, res) => {
  try {
    const { callId, companyId, channel, callerNumber, startedAt, endedAt, turns, llmCalls, finalOutcome } = req.body;
    
    // Validate required fields
    if (!callId || !companyId) {
      return res.status(400).json({ error: 'callId and companyId required' });
    }
    
    // Aggregate stats from turns
    const stats = {
      totalTurns: turns ? turns.length : 0,
      tier1Hits: turns ? turns.filter(t => t.aiBrain?.tierUsed === 1).length : 0,
      tier2Hits: turns ? turns.filter(t => t.aiBrain?.tierUsed === 2).length : 0,
      tier3Hits: turns ? turns.filter(t => t.aiBrain?.tierUsed === 3).length : 0,
      nullResponses: turns ? turns.filter(t => t.flags?.nullResponse).length : 0,
      escalations: turns ? turns.filter(t => t.flags?.escalatedThisTurn).length : 0,
      totalLLMCostUsd: llmCalls ? llmCalls.reduce((sum, call) => sum + (call.costUsd || 0), 0) : 0,
    };
    
    // Create trace
    const trace = new CallTrace({
      callId,
      companyId,
      channel,
      callerNumber,
      startedAt,
      endedAt,
      totalDurationMs: endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : 0,
      turns,
      llmCalls,
      finalOutcome,
      stats
    });
    
    await trace.save();
    
    logger.info('✅ [CALL TRACES] Logged', {
      callId,
      companyId,
      turns: stats.totalTurns,
      tier3Hits: stats.tier3Hits,
      costUsd: stats.totalLLMCostUsd
    });
    
    res.json({ success: true, traceId: trace._id });
    
  } catch (error) {
    logger.error('❌ [CALL TRACES] Log error', { 
      error: error.message,
      callId: req.body.callId
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CALL TRACE STATS (For dashboard aggregation)
// ============================================================================
/**
 * GET /admin/call-traces/stats/daily
 * Query: ?companyId=...&dateFrom=...&dateTo=...
 */
router.get('/call-traces/stats/daily', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { companyId, dateFrom, dateTo } = req.query;
    
    const match = {};
    if (companyId) match.companyId = mongoose.Types.ObjectId(companyId);
    if (dateFrom || dateTo) {
      match.startedAt = {};
      if (dateFrom) match.startedAt.$gte = new Date(dateFrom);
      if (dateTo) match.startedAt.$lte = new Date(dateTo);
    }
    
    const stats = await CallTrace.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$startedAt' }
          },
          totalCalls: { $sum: 1 },
          aiResolved: { $sum: { $cond: [{ $eq: ['$finalOutcome', 'ai_resolved'] }, 1, 0] } },
          escalated: { $sum: { $cond: [{ $eq: ['$finalOutcome', 'escalated_to_human'] }, 1, 0] } },
          tier1Hits: { $sum: '$stats.tier1Hits' },
          tier2Hits: { $sum: '$stats.tier2Hits' },
          tier3Hits: { $sum: '$stats.tier3Hits' },
          nullResponses: { $sum: '$stats.nullResponses' },
          totalLLMCostUsd: { $sum: '$stats.totalLLMCostUsd' }
        }
      },
      { $sort: { _id: -1 } }
    ]);
    
    res.json(stats);
    
  } catch (error) {
    logger.error('❌ [CALL TRACES] Stats error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
```

---

## 🔌 Integration Points

### In `routes/v2twilio.js` (Second Leg - AI Response)

At the end of the call, before sending TwiML response:

```javascript
// Build CallTrace data
const callTrace = {
  callId: companyID,  // Twilio CallSid
  companyId: company._id,
  channel: 'voice',
  callerNumber: req.body.Caller,
  startedAt: callStartTime,  // Stored at call start
  endedAt: new Date(),
  turns: callTurns,  // Array built throughout call
  llmCalls: aiMetrics.llmCalls || [],
  finalOutcome: shouldEscalate ? 'escalated_to_human' : 'ai_resolved'
};

// Log asynchronously (don't block response)
axios.post(`${process.env.BACKEND_URL}/api/call-traces/log`, callTrace)
  .catch(err => logger.error('Failed to log call trace', { error: err.message }));
```

### In `services/AIBrain3tierllm.js`

Each time you query the AI Brain:

```javascript
// After Response Engine returns:
const turnData = {
  turnIndex: turnCount,
  timestamp: new Date(),
  userInput: {
    text: userInput,
    asrProvider: context.asrProvider || 'twilio',
    asrConfidence: context.asrConfidence || null
  },
  aiBrain: {
    tierUsed: result.metadata.tierUsed,
    scenarioName: result.metadata.scenarioName,
    scenarioTypeResolved: result.metadata.scenarioTypeResolved,
    replyStrategyResolved: result.metadata.replyStrategyResolved,
    responseStrategyUsed: result.metadata.responseStrategyUsed,
    responseText: result.response
  },
  timing: {
    aiBrainTimeMs: Date.now() - startTime,
    totalTurnTimeMs: totalTurnTime
  },
  flags: {
    escalatedThisTurn: result.shouldEscalate,
    nullResponse: !result.response,
    lowConfidence: result.confidence < 0.5,
    configError: result.metadata.scenarioTypeResolved === 'INFO_FAQ' && 
                 result.metadata.replyStrategyResolved === 'QUICK_ONLY'
  }
};

callTurns.push(turnData);  // Append to session array
```

---

## ✅ What's Now Available

After implementing this:

- ✅ Complete audit trail per call
- ✅ Ground truth for debugging
- ✅ Data for monitoring dashboard
- ✅ Foundation for call trace UI
- ✅ Cost tracking (Tier 3 LLM usage)
- ✅ Quality metrics (escalations, nulls, errors)

Next: Build the UI to visualize this data.

---

**Status:** Copy-paste ready model + routes. Implement in next step.

