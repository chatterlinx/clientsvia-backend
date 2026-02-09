/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * V111 HEALTH CHECK API
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 *   GET /api/admin/v111/health              - Full system health check
 *   GET /api/admin/v111/health/:companyId   - Company-specific health check
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/v111/health - Full V111 system health check
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/health', async (req, res) => {
  const startTime = Date.now();
  const checks = {
    timestamp: new Date().toISOString(),
    version: 'v111.health.1',
    modules: {},
    redis: { status: 'unchecked' },
    mongodb: { status: 'unchecked' },
    summary: { passed: 0, failed: 0, warnings: 0 }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. MODULE IMPORTS
  // ─────────────────────────────────────────────────────────────────────────────
  const modules = [
    { name: 'ConversationMemory', path: '../../services/engine/ConversationMemory' },
    { name: 'TurnRecordBuilder', path: '../../services/engine/TurnRecordBuilder' },
    { name: 'V111Router', path: '../../services/engine/V111Router' },
    { name: 'TranscriptGenerator', path: '../../services/TranscriptGenerator' },
    { name: 'CallTranscript', path: '../../models/CallTranscript' },
    { name: 'BlackBoxRecording', path: '../../models/BlackBoxRecording' }
  ];

  for (const mod of modules) {
    try {
      const loaded = require(mod.path);
      checks.modules[mod.name] = {
        status: 'ok',
        version: loaded.VERSION || null
      };
      checks.summary.passed++;
    } catch (e) {
      checks.modules[mod.name] = {
        status: 'error',
        error: e.message
      };
      checks.summary.failed++;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. REDIS CONNECTION
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
    
    if (!isRedisConfigured()) {
      checks.redis = { status: 'not_configured', note: 'V111 works without Redis but loses cross-request persistence' };
      checks.summary.warnings++;
    } else {
      const redis = await getSharedRedisClient();
      if (redis) {
        const pong = await redis.ping();
        checks.redis = { status: pong === 'PONG' ? 'ok' : 'error', ping: pong };
        pong === 'PONG' ? checks.summary.passed++ : checks.summary.failed++;
      } else {
        checks.redis = { status: 'null_client' };
        checks.summary.warnings++;
      }
    }
  } catch (e) {
    checks.redis = { status: 'error', error: e.message };
    checks.summary.failed++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. MONGODB CONNECTION
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const mongoose = require('mongoose');
    
    if (mongoose.connection.readyState === 1) {
      checks.mongodb = { status: 'ok', database: mongoose.connection.name };
      checks.summary.passed++;
    } else {
      checks.mongodb = { status: 'disconnected', readyState: mongoose.connection.readyState };
      checks.summary.warnings++;
    }
  } catch (e) {
    checks.mongodb = { status: 'error', error: e.message };
    checks.summary.failed++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. INTEGRATION TEST (quick)
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const { ConversationMemory } = require('../../services/engine/ConversationMemory');
    const memory = new ConversationMemory({
      callId: `health-check-${Date.now()}`,
      companyId: 'health-check',
      callerPhone: '+10000000000'
    });
    
    const tb = memory.startTurn(0);
    tb.setCallerInput('test', 'test', 0.9, {});
    tb.setRouting('LLM', [], [], 'DISCOVERY');
    tb.setResponse('LLM', 'Test response', 100);
    const turn = memory.commitTurn();
    
    checks.integration = {
      status: turn && turn.turn === 0 ? 'ok' : 'error',
      turnCommitted: !!turn
    };
    turn ? checks.summary.passed++ : checks.summary.failed++;
  } catch (e) {
    checks.integration = { status: 'error', error: e.message };
    checks.summary.failed++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FINALIZE
  // ─────────────────────────────────────────────────────────────────────────────
  checks.durationMs = Date.now() - startTime;
  checks.healthy = checks.summary.failed === 0;

  res.status(checks.healthy ? 200 : 503).json(checks);
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/v111/health/:companyId - Company-specific health check
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/health/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const startTime = Date.now();
  
  const checks = {
    timestamp: new Date().toISOString(),
    companyId,
    v111Config: null,
    blackboxRecords: null,
    transcripts: null,
    summary: { passed: 0, failed: 0, warnings: 0 }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. COMPANY V111 CONFIG
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const v2Company = require('../../models/v2Company');
    const company = await v2Company.findById(companyId).lean();
    
    if (!company) {
      checks.v111Config = { status: 'company_not_found' };
      checks.summary.failed++;
    } else {
      const v111 = company.aiAgentSettings?.frontDeskBehavior?.conversationMemory;
      
      if (!v111) {
        checks.v111Config = { status: 'not_configured', note: 'Using defaults' };
        checks.summary.warnings++;
      } else {
        checks.v111Config = {
          status: 'ok',
          enabled: v111.enabled === true,
          version: v111.version || 'v111.0',
          captureGoals: {
            must: v111.captureGoals?.must?.fields || [],
            should: v111.captureGoals?.should?.fields || [],
            nice: v111.captureGoals?.nice?.fields || []
          },
          handlerGovernance: {
            scenario: v111.handlerGovernance?.scenarioHandler?.enabled !== false,
            booking: v111.handlerGovernance?.bookingHandler?.enabled !== false,
            llm: v111.handlerGovernance?.llmHandler?.enabled !== false,
            escalation: v111.handlerGovernance?.escalationHandler?.enabled !== false
          }
        };
        checks.summary.passed++;
      }
    }
  } catch (e) {
    checks.v111Config = { status: 'error', error: e.message };
    checks.summary.failed++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. BLACKBOX V111 RECORDS
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const BlackBoxRecording = require('../../models/BlackBoxRecording');
    
    const count = await BlackBoxRecording.countDocuments({
      companyId,
      'events.type': 'TURN_RECORDED'
    });
    
    const recent = await BlackBoxRecording.findOne({
      companyId,
      'events.type': 'TURN_RECORDED'
    }).sort({ startedAt: -1 }).select('callId startedAt').lean();
    
    checks.blackboxRecords = {
      status: 'ok',
      totalCalls: count,
      mostRecent: recent ? {
        callId: recent.callId,
        startedAt: recent.startedAt
      } : null
    };
    checks.summary.passed++;
  } catch (e) {
    checks.blackboxRecords = { status: 'error', error: e.message };
    checks.summary.failed++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. CALL TRANSCRIPTS
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const CallTranscript = require('../../models/CallTranscript');
    
    const count = await CallTranscript.countDocuments({ companyId });
    const recent = await CallTranscript.findOne({ companyId })
      .sort({ callStartTime: -1 })
      .select('callId callStartTime turnCount')
      .lean();
    
    checks.transcripts = {
      status: 'ok',
      total: count,
      mostRecent: recent ? {
        callId: recent.callId,
        callStartTime: recent.callStartTime,
        turnCount: recent.turnCount
      } : null
    };
    checks.summary.passed++;
  } catch (e) {
    checks.transcripts = { status: 'error', error: e.message };
    checks.summary.failed++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FINALIZE
  // ─────────────────────────────────────────────────────────────────────────────
  checks.durationMs = Date.now() - startTime;
  checks.healthy = checks.summary.failed === 0;

  res.status(checks.healthy ? 200 : 503).json(checks);
});

module.exports = router;
