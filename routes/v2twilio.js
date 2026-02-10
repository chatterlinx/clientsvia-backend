// Twilio Webhook Router - V3
// GLOBAL MULTI-TENANT PLATFORM
// CRITICAL: All changes affect ALL companies - no company-specific hardcoding
// POST-IT REMINDER: Use company.aiSettings for per-company configuration
// NEVER hardcode company IDs or special treatment for any single company
// ALWAYS design for global platform scalability
// TEST: "Would this work for company #1000 tomorrow?" If NO, fix it!
const express = require('express');
const logger = require('../utils/logger.js');
logger.debug('🚀 [V2TWILIO] ========== LOADING v2twilio.js FILE ==========');

// ============================================================================
// 📊 CALL FLOW TRACER - Real-time call journey tracking
// ============================================================================
const { getTracer, removeTracer, STAGES } = require('../services/CallFlowTracer');

const twilio = require('twilio');
const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const AdminSettings = require('../models/AdminSettings');
const HybridScenarioSelector = require('../services/HybridScenarioSelector');
const IntelligentRouter = require('../services/IntelligentRouter');  // 🧠 3-Tier Self-Improvement System
const STTHintsBuilder = require('../services/STTHintsBuilder');  // 🎤 STT Hints from vocabulary
const STTPreprocessor = require('../services/STTPreprocessor');  // 🎤 STT Intelligence - filler removal, corrections
const MatchDiagnostics = require('../services/MatchDiagnostics');
const AdminNotificationService = require('../services/AdminNotificationService');  // 🚨 Critical error reporting
// 🚀 V2 SYSTEM: Using V2 AI Agent Runtime for call initialization
const { initializeCall } = require('../services/v2AIAgentRuntime');
// NOTE: processUserInput REMOVED - HybridReceptionistLLM is the only brain now
// V2 DELETED: Legacy aiAgentRuntime - replaced with v2AIAgentRuntime
// const aiAgentRuntime = require('../services/aiAgentRuntime');
// V2: AI responses come from AIBrain3tierllm (3-Tier Intelligence System)

// ============================================================================
// 🧠 LLM-0 ORCHESTRATION LAYER (BRAIN 1)
// ============================================================================
// LLM-0 is the master orchestrator that sits BEFORE the 3-Tier system.
// It decides: ask question, run scenario, book appointment, transfer, etc.
// The 3-Tier system (Brain 2) only runs when LLM-0 says "RUN_SCENARIO".
// ============================================================================
// ARCHITECTURE (Dec 2025): ConversationEngine → HybridReceptionistLLM → OpenAI
// LLM0TurnHandler, LLM0OrchestratorService, decideNextStep - ALL REMOVED
// The only AI brain is HybridReceptionistLLM with lean ~400 token prompt
// ============================================================================

// ============================================================================
// 📞 CALL CENTER MODULE V2 - Customer Recognition
// ============================================================================
// Identifies returning customers at call start for personalized experience.
// Race-proof: 100 concurrent calls from same number = 1 customer
// See: PROPOSAL-CALL-CENTER-MODULE-V2.md
// ============================================================================
let CallSummaryService;
try {
    CallSummaryService = require('../services/CallSummaryService');
    logger.info('[V2TWILIO] ✅ Call Center Module loaded successfully');
} catch (err) {
    logger.warn('[V2TWILIO] ⚠️ Call Center Module not available', { error: err.message });
    CallSummaryService = null;
}

const fs = require('fs');
const path = require('path');
const { synthesizeSpeech } = require('../services/v2elevenLabsService');
const { getSharedRedisClient, isRedisConfigured } = require('../services/redisClientFactory');
const { normalizePhoneNumber, extractDigits, numbersMatch, } = require('../utils/phone');
const crypto = require('crypto');

// 🔌 V94: AWConfigReader for traced config reads in BookingFlowRunner (Phase B)
let AWConfigReader;
try {
    AWConfigReader = require('../services/wiring/AWConfigReader');
} catch (e) {
    logger.warn('[V2TWILIO] AWConfigReader not available - BookingFlowRunner will use direct config access');
}

// 🔒 V99: Control Plane Enforcer - Platform Law enforcement
let ControlPlaneEnforcer;
try {
    ControlPlaneEnforcer = require('../services/engine/ControlPlaneEnforcer');
    logger.info('[V2TWILIO] ✅ Control Plane Enforcer loaded - Platform Law active');
} catch (e) {
    logger.warn('[V2TWILIO] ⚠️ Control Plane Enforcer not available', { error: e.message });
}

// ═══════════════════════════════════════════════════════════════════════════
// 📊 V111: CONVERSATION MEMORY - Runtime Truth for Call State
// ═══════════════════════════════════════════════════════════════════════════
// Phase 0: Visibility only - parallel logging without behavior change
// Captures: STT result, slots extracted, routing decision, response, turn record
// Spec: docs/architecture/V111-ConversationMemory-Spec.md
// ═══════════════════════════════════════════════════════════════════════════
let ConversationMemory;
try {
    const memoryModule = require('../services/engine/ConversationMemory');
    ConversationMemory = memoryModule.ConversationMemory;
    logger.info('[V2TWILIO] ✅ V111 ConversationMemory loaded - Runtime truth active');
} catch (e) {
    logger.warn('[V2TWILIO] ⚠️ V111 ConversationMemory not available', { error: e.message });
    ConversationMemory = null;
}

// Helper: Get Redis client safely (returns null if unavailable)
async function getRedis() {
  if (!isRedisConfigured()) return null;
  try {
    return await getSharedRedisClient();
  } catch {
    return null;
  }
}

// ============================================================================
// 🔌 V94: AW TRUTH PROOF - Compute awHash + effectiveConfigVersion at CALL_START
// ============================================================================
// This ensures Raw Events can prove which config was used during the call.
// Without this, AW and RE cannot be correlated (ghost mode).
// ============================================================================
function computeAwProof(company) {
    let awHash = null;
    let effectiveConfigVersion = null;
    
    try {
        // Compute awHash first (independent of effectiveConfigVersion)
        const aiAgentSettings = company?.aiAgentSettings || {};
        const configStr = JSON.stringify(aiAgentSettings);
        awHash = 'sha256:' + crypto.createHash('sha256').update(configStr).digest('hex').substring(0, 16);
    } catch (e) {
        logger.warn('[AW PROOF] Failed to compute awHash', { error: e.message });
    }
    
    try {
        // Compute effectiveConfigVersion (separate try-catch for robustness)
        // V102: Handle both Date objects (from DB) and strings (from Redis cache)
        effectiveConfigVersion = company?.effectiveConfigVersion || 
                                 company?.aiAgentSettings?.effectiveConfigVersion ||
                                 null;
        
        if (!effectiveConfigVersion && company?.updatedAt) {
            // Handle Date object or ISO string
            if (company.updatedAt instanceof Date) {
                effectiveConfigVersion = company.updatedAt.toISOString();
            } else if (typeof company.updatedAt === 'string') {
                // Already a string (from Redis cache)
                effectiveConfigVersion = company.updatedAt;
            }
        }
    } catch (e) {
        logger.warn('[AW PROOF] Failed to compute effectiveConfigVersion', { error: e.message });
    }
    
    return { awHash, effectiveConfigVersion };
}

// ============================================================================
// V69: RECOVERY MESSAGE HELPER - Human-like random variant selection
// ============================================================================
// Instead of robotic "connection is choppy", use natural phrases like:
// - "I can hear you, just not clearly. Mind saying that again?"
// - "Say that again for me?"
// - "One more time?"
// ============================================================================
function getRecoveryMessage(company, type = 'audioUnclear') {
  const recoveryConfig = company?.aiAgentSettings?.llm0Controls?.recoveryMessages || {};
  
  // V69: Default human-like variants (no "choppy" language)
  const defaults = {
    audioUnclear: [
      "I can hear you, just not clearly. Mind saying that again?",
      "Sounds like the line cut out for a second. Can you repeat that for me?",
      "I'm here — the audio broke up a bit. Say that one more time?",
      "I caught part of that, but not all. Can you repeat it for me?",
      "Say that again for me?",
      "One more time?",
      "Sorry, didn't catch that — repeat it?"
    ],
    connectionCutOut: [
      "Sorry, the connection cut out for a second. What can I help you with?",
      "The line dropped for a moment there. What were you saying?",
      "I lost you for a second. Go ahead?"
    ],
    silenceRecovery: [
      "I'm here — go ahead, I'm listening.",
      "Still here! What can I help you with?",
      "I'm listening — go ahead."
    ],
    generalError: [
      "I missed that. Could you say that again?",
      "Say that one more time for me?",
      "One more time?",
      "Didn't quite catch that — repeat it?"
    ],
    technicalTransfer: [
      "I'm having some technical difficulties. Let me connect you to our team.",
      "Let me get someone on the line who can help you better."
    ]
  };
  
  // Get variants - prefer UI config, fall back to defaults
  let variants = recoveryConfig[type];
  
  // Handle legacy choppyConnection → audioUnclear mapping
  if (type === 'choppyConnection' || type === 'audioUnclear') {
    variants = recoveryConfig.audioUnclear || recoveryConfig.choppyConnection || defaults.audioUnclear;
  }
  
  // If variants is a string (legacy), wrap in array
  if (typeof variants === 'string') {
    variants = [variants];
  }
  
  // If still no variants, use defaults
  if (!Array.isArray(variants) || variants.length === 0) {
    variants = defaults[type] || defaults.generalError;
  }
  
  // Random selection for natural sound
  return variants[Math.floor(Math.random() * variants.length)];
}
const { stripMarkdown, cleanTextForTTS, enforceVoiceResponseLength } = require('../utils/textUtils');
// Legacy personality system removed - using modern AI Agent Logic responseCategories

// ============================================================================
// 📼 BLACK BOX RECORDER - Enterprise Call Flight Recorder
// ============================================================================
// Records every decision point for debugging. No more Render log archaeology.
// See: black-box.html for visualization and analysis.
// ============================================================================
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../services/BlackBoxLogger');
    logger.info('[V2TWILIO] ✅ Black Box Recorder loaded successfully');
} catch (err) {
    logger.warn('[V2TWILIO] ⚠️ Black Box Recorder not available', { error: err.message });
    BlackBoxLogger = null;
}

// ============================================================================
// 🎯 LOW CONFIDENCE HANDLER - STT Quality Guard
// ============================================================================
// When STT confidence is below threshold, ask caller to repeat instead of guessing.
// This prevents wrong interpretations, missed bookings, and lost revenue.
// Settings: company.aiAgentSettings.llm0Controls.lowConfidenceHandling
// ============================================================================
let LowConfidenceHandler;
try {
    LowConfidenceHandler = require('../services/LowConfidenceHandler');
    logger.info('[V2TWILIO] ✅ Low Confidence Handler loaded successfully');
} catch (err) {
    logger.warn('[V2TWILIO] ⚠️ Low Confidence Handler not available', { error: err.message });
    LowConfidenceHandler = null;
}

// ============================================================================
// 🎯 DEEPGRAM FALLBACK - Hybrid STT for Premium Accuracy
// ============================================================================
// When Twilio confidence is low, use Deepgram as a second opinion instead of
// asking the caller to repeat. Better accuracy, no UX penalty.
// Global platform API key - per-company toggle in lowConfidenceHandling settings.
// ============================================================================
let DeepgramFallback;
try {
    DeepgramFallback = require('../services/DeepgramFallback');
    if (DeepgramFallback.isDeepgramConfigured()) {
        logger.info('[V2TWILIO] ✅ Deepgram Fallback loaded (API key configured)');
    } else {
        logger.warn('[V2TWILIO] ⚠️ Deepgram Fallback loaded but no API key - fallback disabled');
    }
} catch (err) {
    logger.warn('[V2TWILIO] ⚠️ Deepgram Fallback not available', { error: err.message });
    DeepgramFallback = null;
}

// ════════════════════════════════════════════════════════════════════════════════
// 🔒 HTTPS URL HELPER
// ════════════════════════════════════════════════════════════════════════════════
// Render (and most reverse proxies) terminate SSL, so req.protocol returns 'http'.
// This helper forces HTTPS in production to ensure Twilio can fetch our audio files.
// Without this, <Play> URLs will fail and Gather will never complete.
// ════════════════════════════════════════════════════════════════════════════════
function getSecureBaseUrl(req) {
  const host = req.get('host');
  // Force HTTPS in production (behind Render proxy)
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
  return `${protocol}://${host}`;
}

// ============================================================================
// 🧠 3-TIER SELF-IMPROVEMENT SYSTEM CONFIGURATION
// ============================================================================
// The 3-tier intelligence system (Tier 1 → 2 → 3) is now controlled by:
// - GLOBAL MODE: AdminSettings.globalProductionIntelligence.enabled
// ☠️ REMOVED: aiAgentSettings (legacy nuked 2025-11-20)
// 
// This is checked DYNAMICALLY at request time, not via environment variable.
// UI and backend now use the SAME source of truth (database).
// ============================================================================

logger.info('🧠 [3-TIER SYSTEM] Configuration loaded from database (per-request check)');

const router = express.Router();
logger.info('🚀 [V2TWILIO] ========== EXPRESS ROUTER CREATED ==========');

// ════════════════════════════════════════════════════════════════════════════════
// 🔍 GLOBAL TWILIO REQUEST LOGGER
// ════════════════════════════════════════════════════════════════════════════════
// This middleware runs on EVERY request to /api/twilio/* BEFORE any handler.
// If a Twilio request hits our server, we log it here - even if the handler
// fails, throws, or never logs anything.
//
// If you see "📥 TWILIO INBOUND" but never see handler logs → middleware killed it.
// If you don't even see "📥 TWILIO INBOUND" → Twilio never called that URL.
// ════════════════════════════════════════════════════════════════════════════════
router.use((req, res, next) => {
    const now = new Date().toISOString();
    const isTwilioRequest = req.headers['user-agent']?.includes('Twilio') || 
                            req.headers['x-twilio-signature'];
    
    // Only log Twilio requests loudly
    if (isTwilioRequest) {
        console.log('════════════════════════════════════════════════════════════════════════════════');
        console.log(`📥 TWILIO INBOUND @ ${now}`);
        console.log(`   Path:   ${req.method} ${req.path}`);
        console.log(`   Full:   ${req.originalUrl}`);
        console.log(`   CallSid: ${req.body?.CallSid || 'N/A'}`);
        console.log(`   From:   ${req.body?.From || 'N/A'}`);
        console.log(`   Speech: "${(req.body?.SpeechResult || '').substring(0, 50)}${(req.body?.SpeechResult?.length > 50) ? '...' : ''}"`);
        console.log('════════════════════════════════════════════════════════════════════════════════');
    }
    
    next();
});

// ============================================
// 🧪 TEST RESULTS STORAGE (In-Memory)
// ============================================
// Store last 50 test results per template (circular buffer)
const testResultsStore = new Map(); // templateId -> array of results

function saveTestResult(templateId, testData) {
  if (!testResultsStore.has(templateId)) {
    testResultsStore.set(templateId, []);
  }
  
  const results = testResultsStore.get(templateId);
  results.unshift(testData); // Add to front
  
  // Keep only last 50
  if (results.length > 50) {
    results.pop();
  }
  
  logger.info(`🧪 [TEST STORE] Saved test result for template ${templateId}. Total: ${results.length}`);
}

function getTestResults(templateId, limit = 20) {
  const results = testResultsStore.get(templateId) || [];
  return results.slice(0, limit);
}

// ============================================
// 🎯 PHASE A – STEP 3B: FOLLOW-UP PLUMBING
// ============================================
/**
 * Build voice response text with follow-up question appended (if configured)
 * 
 * Applies only to voice channel.
 * Modes:
 *   - NONE: no modification
 *   - ASK_FOLLOWUP_QUESTION: append followUpQuestionText
 *   - ASK_IF_BOOK: append followUpQuestionText
 *   - TRANSFER: return unchanged (handled separately)
 * 
 * @param {String} mainText - The primary AI response text
 * @param {Object} followUpMetadata - { mode, questionText, transferTarget }
 * @returns {String} - Final text to speak (may include follow-up question)
 */
function buildFollowUpAwareText(mainText, followUpMetadata) {
  if (!followUpMetadata) {
    return mainText;
  }

  const mode = followUpMetadata.mode || 'NONE';
  const questionText = (followUpMetadata.questionText || '').trim();

  // If no mode or NONE → no change
  if (!mode || mode === 'NONE') {
    return mainText;
  }

  // For ASK_FOLLOWUP_QUESTION or ASK_IF_BOOK:
  // - Append the question text if present
  // - If missing questionText, use a safe generic fallback
  if (mode === 'ASK_FOLLOWUP_QUESTION' || mode === 'ASK_IF_BOOK') {
    const effectiveQuestion =
      questionText.length > 0
        ? questionText
        : 'Is there anything else I can help you with?';

    // Combine with a space. Keep it simple and natural.
    if (!mainText || !mainText.trim()) {
      return effectiveQuestion;
    }
    return `${mainText.trim()} ${effectiveQuestion}`;
  }

  // For TRANSFER we do NOT modify text here – transfer is handled separately
  return mainText;
}

// ============================================
// 🤖 AI ANALYSIS ENGINE
// ============================================

function analyzeTestResult(result, allScenarios) {
  const analysis = {
    missingKeywords: [],
    suggestions: [],
    issues: [],
    insights: []
  };
  
  // 1. ANALYZE MISSING KEYWORDS (caller said, but not in triggers)
  if (!result.matched && result.phrase) {
    const callerWords = result.phrase.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2) // Ignore short words
      .filter(w => !['the', 'a', 'an', 'and', 'or', 'but', 'can', 'could', 'would', 'should'].includes(w));
    
    // Find closest scenario
    const closestScenario = result.topCandidates && result.topCandidates.length > 0 
      ? result.topCandidates[0] 
      : null;
    
    if (closestScenario && closestScenario.scenarioId) {
      // Find actual scenario object
      const scenario = allScenarios.find(s => s.scenarioId === closestScenario.scenarioId || s._id?.toString() === closestScenario.scenarioId);
      
      if (scenario) {
        const triggerWords = (scenario.triggers || []).map(t => t.toLowerCase());
        const missingWords = callerWords.filter(w => !triggerWords.some(t => t.includes(w) || w.includes(t)));
        
        if (missingWords.length > 0) {
          analysis.missingKeywords = missingWords;
          analysis.suggestions.push({
            type: 'add_keyword',
            priority: 'high',
            scenarioId: scenario.scenarioId || scenario._id,
            scenarioName: scenario.name,
            keywords: missingWords,
            message: `Add "${missingWords.join('", "')}" to triggers`,
            expectedBoost: '+8-12%'
          });
        }
      }
    }
  }
  
  // 2. ANALYZE THRESHOLD ISSUES
  if (!result.matched && result.confidence >= 0.40 && result.confidence < result.threshold) {
    const gap = ((result.threshold - result.confidence) * 100).toFixed(0);
    analysis.suggestions.push({
      type: 'lower_threshold',
      priority: 'medium',
      message: `Confidence ${(result.confidence * 100).toFixed(0)}% is ${gap}% below threshold`,
      currentThreshold: result.threshold,
      suggestedThreshold: Math.max(0.35, result.confidence - 0.03),
      reason: 'Close but not quite - lower threshold or add triggers'
    });
  }
  
  // 3. ANALYZE SPEED ISSUES
  if (result.timing && result.timing.total > 100) {
    analysis.issues.push({
      type: 'slow_response',
      priority: 'medium',
      message: `Response time ${result.timing.total}ms exceeds 100ms target`,
      bottleneck: result.timing.scoring > 50 ? 'Scoring' : 'Unknown',
      suggestion: 'Consider reducing trigger count or optimizing'
    });
  }
  
  // 4. POSITIVE INSIGHTS
  if (result.matched && result.confidence > 0.70) {
    analysis.insights.push({
      type: 'strong_match',
      message: `Strong match! Confidence ${(result.confidence * 100).toFixed(0)}% indicates good trigger coverage`
    });
  }
  
  if (result.timing && result.timing.total < 50) {
    analysis.insights.push({
      type: 'excellent_speed',
      message: `⚡ Excellent speed! ${result.timing.total}ms is under 50ms target`
    });
  }
  
  return analysis;
}

// ============================================
// 🔬 FAILURE REASON ANALYZER
// ============================================

function determineFailureReason(result, allScenarios) {
  const reasons = [];
  
  // 1. Check if confidence was close
  if (result.confidence >= 0.35 && result.confidence < 0.45) {
    reasons.push({
      type: 'near_miss',
      severity: 'medium',
      message: `Close call! Only ${((0.45 - result.confidence) * 100).toFixed(0)}% below threshold`,
      fix: 'Add 1-2 more keywords or lower threshold slightly'
    });
  }
  
  // 2. Check if confidence was very low
  if (result.confidence < 0.20) {
    reasons.push({
      type: 'poor_match',
      severity: 'high',
      message: 'Very low confidence - phrase may be too vague or scenario missing',
      fix: 'Phrase needs more specific keywords or new scenario needed'
    });
  }
  
  // 3. Check if no scenarios at all
  if (allScenarios.length === 0) {
    reasons.push({
      type: 'no_scenarios',
      severity: 'CRITICAL',
      message: 'No scenarios configured in template!',
      fix: 'Add scenarios to this template'
    });
  }
  
  // 4. Check if too many scenarios (performance issue)
  if (allScenarios.length > 50) {
    reasons.push({
      type: 'too_many_scenarios',
      severity: 'low',
      message: `${allScenarios.length} scenarios may slow matching`,
      fix: 'Consider splitting into multiple templates'
    });
  }
  
  // 5. Check trace data for blocked scenarios
  if (result.trace?.scenariosBlocked > 0) {
    reasons.push({
      type: 'negative_trigger_block',
      severity: 'medium',
      message: `${result.trace.scenariosBlocked} scenarios blocked by negative triggers`,
      fix: 'Check if negative triggers are too aggressive'
    });
  }
  
  // 6. Default fuzzy matching explanation
  if (result.confidence > 0 && result.confidence < 0.45) {
    reasons.push({
      type: 'fuzzy_match_partial',
      severity: 'INFO',
      message: 'Fuzzy matching found partial keyword overlap but not enough',
      fix: 'Caller words exist in triggers but need more overlap'
    });
  }
  
  return reasons;
}

// 🚨 GLOBAL CHECKPOINT: Log ALL requests to ANY Twilio endpoint
router.use((req, res, next) => {
  logger.info('🔍 TWILIO ENDPOINT HIT:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    fullUrl: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(req.body || {}),
    hasCallSid: Boolean(req.body && req.body.CallSid)
  });
  next();
});

// Helper function to check if transfer is enabled
// ☠️ REMOVED: aiAgentSettings.callTransferConfig (legacy nuked 2025-11-20)
function isTransferEnabled(company) {
  // Transfer now requires explicit Twilio fallback configuration
  return company?.twilioConfig?.fallbackNumber ? true : false;
}

// Helper function to get the configured transfer number
// ☠️ REMOVED: aiAgentSettings.callTransferConfig (legacy nuked 2025-11-20)
function getTransferNumber(company) {
  // Use Twilio config fallback number only
  if (company?.twilioConfig?.fallbackNumber) {
    logger.info('[AI AGENT] Using Twilio fallback number:', company.twilioConfig.fallbackNumber);
    return company.twilioConfig.fallbackNumber;
  }
  
  // No fallback number - transfer disabled
  logger.info('[AI AGENT] No transfer number configured - transfer disabled');
  return null;
}

// Helper function to get the configured transfer message
// ☠️ REMOVED: aiAgentSettings.callTransferConfig (legacy nuked 2025-11-20)
function getTransferMessage(company) {
  // Professional transfer - never sounds like AI is giving up
  return company.connectionMessages?.voice?.transferMessage || 
         "One moment while I transfer you to our team.";
}

// Helper function to handle transfer logic with enabled check
// 🔥 NO generic fallback messages - neutral transfer only
function handleTransfer(twiml, company, fallbackMessage = "I'm connecting you to our team.", companyID = null, overrideTransferTarget = null) {
  // 🎯 PHASE A – STEP 3B: Allow scenario-specific transfer target to override company config
  const transferNumber = overrideTransferTarget || (isTransferEnabled(company) ? getTransferNumber(company) : null);
  
  if (transferNumber) {
    const transferMessage = getTransferMessage(company);
    logger.info('[AI AGENT] Transfer enabled, transferring to:', transferNumber);
    twiml.say(transferMessage);
    twiml.dial(transferNumber);
  } else if (isTransferEnabled(company)) {
    logger.info('[AI AGENT] Transfer enabled but no number configured, connecting to team');
    // 🔥 Neutral transfer message - no generic empathy
    const configResponse = `I'm connecting you to our team.`;
    twiml.say(configResponse);
    twiml.hangup();
  } else {
    logger.info('[AI AGENT] Transfer disabled, providing fallback message and continuing conversation');
    
    // Only say fallback message if one was provided (not null)
    if (fallbackMessage) {
      twiml.say(fallbackMessage);
    }
    
    // Continue conversation instead of hanging up [[memory:8276820]]
    const gather = twiml.gather({
      input: 'speech',
      speechTimeout: '3', // Matches production defaults for consistent experience
      speechModel: 'phone_call',
      action: `/api/twilio/v2-agent-respond/${companyID || 'unknown'}`,
      method: 'POST'
    });
    
    gather.say('');
    
    // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
    const finalFallback = `Thank you for calling. We'll make sure someone gets back to you as soon as possible.`;
    twiml.say(finalFallback);
    twiml.hangup();
  }
}

// Helper function to escape text for TwiML Say verb
function escapeTwiML(text) {
  if (!text) {return '';}
  
  // For TTS, we want clean text without HTML entities
  // Only do minimal escaping for XML structure
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
}

// Helper function to get company data, with caching
// NOW ALSO CHECKS: 
//   1. Notification Center Test (for system verification)
//   2. Global AI Brain Test Templates (for admin testing)
async function getCompanyByPhoneNumber(phoneNumber) {
  const cacheKey = `company-phone:${phoneNumber}`;
  let company = null;

  try {
    // 🔔 CHECK 0: Is this Notification Center test number?
    logger.debug(`[NOTIFICATION CENTER CHECK] Checking if ${phoneNumber} is notification center test...`);
    const AdminSettings = require('../models/AdminSettings');
    const adminSettings = await AdminSettings.findOne({});
    
    if (adminSettings?.notificationCenter?.twilioTest?.enabled && 
        adminSettings.notificationCenter.twilioTest.phoneNumber === phoneNumber) {
      logger.info(`🔔 [NOTIFICATION CENTER] Test number found: ${phoneNumber}`);
      // Return a special "company" object that signals this is notification center test
      return {
        isNotificationCenterTest: true,
        settings: adminSettings,
        _id: 'notification-center',
        name: 'Notification Center Test'
      };
    }
    
    // ============================================================================
    // 🎯 UNIFIED TEST PILOT MODE SWITCHING (Template vs Company Testing)
    // ============================================================================
    // ONE phone number, TWO modes based on UI toggle:
    // - mode='template' → Test global templates in isolation (template-test)
    // - mode='company' → Test real company configurations (company-test)
    // ============================================================================
    
    logger.info(`[TEST PILOT CHECK] Checking if ${phoneNumber} is the Test Pilot number...`);
    
    const testPilotConfig = adminSettings?.globalAIBrainTest;
    
    if (testPilotConfig?.enabled && testPilotConfig.phoneNumber === phoneNumber) {
      const mode = testPilotConfig.mode || 'template'; // Default to template mode
      
      logger.info(`🎯 [TEST PILOT] Test number matched! Mode: ${mode.toUpperCase()}`);
      
      // ========================================
      // MODE 1: TEMPLATE TESTING
      // ========================================
      if (mode === 'template') {
        logger.info(`🧠 [TEST PILOT - TEMPLATE MODE] Loading global template...`);
        
        // Load the template that's currently being tested
        const testTemplate = await GlobalInstantResponseTemplate.findById(
          testPilotConfig.activeTemplateId
        );
        
        if (testTemplate) {
          logger.info(`✅ [TEST PILOT - TEMPLATE MODE] Test routing to: ${testTemplate.name}`);
          // Return a special "company" object that signals this is a test template
          return {
            isGlobalTestTemplate: true,
            template: testTemplate,
            _id: testTemplate._id,
            name: testTemplate.name,
            globalTestConfig: testPilotConfig, // Include config for greeting, etc.
            callSource: 'template-test' // Explicit call source
          };
        } else {
          logger.warn(`⚠️ [TEST PILOT - TEMPLATE MODE] activeTemplateId points to non-existent template: ${testPilotConfig.activeTemplateId}`);
        }
      }
      
      // ========================================
      // MODE 2: COMPANY TESTING
      // ========================================
      else if (mode === 'company') {
        logger.info(`🏢 [TEST PILOT - COMPANY MODE] Loading REAL company from MongoDB...`);
        
        // Load the REAL company that's being tested
        const testCompany = await Company.findById(testPilotConfig.testCompanyId);
        
        if (testCompany) {
          logger.info(`✅ [TEST PILOT - COMPANY MODE] Test routing to REAL company: ${testCompany.companyName || testCompany.businessName}`);
          logger.info(`🎯 [TEST PILOT - COMPANY MODE] Using PRODUCTION code path - this tests the EXACT customer experience!`);
          
          // Mark this as test mode for optional debugging/logging
          testCompany.isTestMode = true;
          testCompany.testGreeting = testPilotConfig.greeting || 'Currently testing {company_name}.';
          testCompany.callSource = 'company-test'; // Explicit call source
          
          // Return the REAL company (not a fake one!)
          // This will use the EXACT same code path as production customer calls!
          return testCompany;
        } else {
          logger.warn(`⚠️ [TEST PILOT - COMPANY MODE] testCompanyId points to non-existent company: ${testPilotConfig.testCompanyId}`);
        }
      }
    }
    
    // 🏢 CHECK 3: Regular company lookup (production customer calls)
    const cacheStartTime = Date.now();
    const redisClient = await getRedis();
    const cachedCompany = redisClient ? await redisClient.get(cacheKey) : null;
    if (cachedCompany) {
      logger.debug(`[CACHE HIT] [FAST] Company found in cache for ${phoneNumber} in ${Date.now() - cacheStartTime}ms`);
      company = JSON.parse(cachedCompany);
    } else {
      logger.debug(`[CACHE MISS] [SEARCH] Company not cached for ${phoneNumber}, querying database...`);
      const dbStartTime = Date.now();
      
      const digits = extractDigits(phoneNumber);
      const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
      const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);

      // Search in both twilioConfig.phoneNumber and twilioConfig.phoneNumbers array
      company = await Company.findOne({
        $or: [
          { 'twilioConfig.phoneNumber': { $in: searchNumbers } },
          { 'twilioConfig.phoneNumbers.phoneNumber': { $in: searchNumbers } }
        ]
      }).exec();
      
      if (!company) {
        logger.info(`[DB FALLBACK] Trying broader search for ${phoneNumber}...`);
        const all = await Company.find({
          $or: [
            { 'twilioConfig.phoneNumber': { $ne: null } },
            { 'twilioConfig.phoneNumbers': { $exists: true, $ne: [] } }
          ]
        }).exec();
        
        company = all.find((c) => {
          // Check single phoneNumber field
          if (c.twilioConfig?.phoneNumber && numbersMatch(c.twilioConfig.phoneNumber, phoneNumber)) {
            return true;
          }
          // Check phoneNumbers array
          if (c.twilioConfig?.phoneNumbers && Array.isArray(c.twilioConfig.phoneNumbers)) {
            return c.twilioConfig.phoneNumbers.some(p => numbersMatch(p.phoneNumber, phoneNumber));
          }
          return false;
        });
      }

      if (company) {
        const dbEndTime = Date.now();
        logger.debug(`[DB SUCCESS] [OK] Company found in database in ${dbEndTime - dbStartTime}ms`);
        if (redisClient) {
          await redisClient.setEx(cacheKey, 3600, JSON.stringify(company)); // Cache for 1 hour
          logger.debug(`[CACHE SAVE] 💾 Company cached for phone: ${phoneNumber}`);
        }
      } else {
        const dbEndTime = Date.now();
        logger.debug(`[DB MISS] [ERROR] No company found in database for ${phoneNumber} (${dbEndTime - dbStartTime}ms)`);
      }
    }
  } catch (err) {
    logger.error(`[CACHE/DB ERROR] [ERROR] Error fetching company by phone ${phoneNumber}:`, err.message);
    logger.error(`[Redis/DB] Error fetching company by phone ${phoneNumber}:`, err.message, err.stack);
    // Fallback to direct DB fetch if Redis fails
    const digits = extractDigits(phoneNumber);
    const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);
    
    company = await Company.findOne({
      $or: [
        { 'twilioConfig.phoneNumber': { $in: searchNumbers } },
        { 'twilioConfig.phoneNumbers.phoneNumber': { $in: searchNumbers } }
      ]
    }).exec();
    
    if (!company) {
      const all = await Company.find({
        $or: [
          { 'twilioConfig.phoneNumber': { $ne: null } },
          { 'twilioConfig.phoneNumbers': { $exists: true, $ne: [] } }
        ]
      }).exec();
      
      company = all.find((c) => {
        // Check single phoneNumber field
        if (c.twilioConfig?.phoneNumber && numbersMatch(c.twilioConfig.phoneNumber, phoneNumber)) {
          return true;
        }
        // Check phoneNumbers array
        if (c.twilioConfig?.phoneNumbers && Array.isArray(c.twilioConfig.phoneNumbers)) {
          return c.twilioConfig.phoneNumbers.some(p => numbersMatch(p.phoneNumber, phoneNumber));
        }
        return false;
      });
    }
  }
  if (company) {
    // 🚀 V2 SYSTEM: Company Q&As loaded automatically by V2 AI Agent Runtime
    if (company._id) {
      // Legacy personality system removed - using modern AI Agent Logic responseCategories
      logger.info('🚀 Modern AI Agent Logic system active for company:', company._id.toString());
    }
  }
  return company;
}

router.post('/voice', async (req, res) => {
  const callStartTime = Date.now();
  
  // 🎯 PHASE 1 DIAGNOSTIC: Entry point marker
  console.log('═'.repeat(80));
  console.log('[🎯 ENTRY] Twilio /voice hit');
  console.log('CallSid:', req.body.CallSid);
  console.log('From:', req.body.From);
  console.log('To:', req.body.To);
  console.log('═'.repeat(80));
  
  // 🚨 CRITICAL CHECKPOINT: Log EVERYTHING at webhook entry
  logger.info('='.repeat(80));
  logger.info(`🚨 WEBHOOK HIT: /api/twilio/voice at ${new Date().toISOString()}`);
  logger.info(`🚨 FULL REQUEST BODY:`, JSON.stringify(req.body, null, 2));
  logger.info(`🚨 HEADERS:`, JSON.stringify(req.headers, null, 2));
  logger.info(`🚨 URL:`, req.url);
  logger.debug(`🚨 METHOD:`, req.method);
  logger.debug(`🚨 IP:`, req.ip || req.connection.remoteAddress);
  logger.debug('='.repeat(80));
  
  logger.debug(`[CALL START] [CALL] New call initiated at: ${new Date().toISOString()}`);
  logger.debug(`[CALL DEBUG] From: ${req.body.From} → To: ${req.body.To} | CallSid: ${req.body.CallSid}`);
  
  try {
    logger.debug('[POST /api/twilio/voice] Incoming call:', req.body);
    const calledNumber = normalizePhoneNumber(req.body.To);
    const callerNumber = normalizePhoneNumber(req.body.From);
    logger.info(`[PHONE LOOKUP] [SEARCH] Searching for company with phone: ${calledNumber}`);
    
    const company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      logger.info(`[ERROR] [ERROR] No company found for phone number: ${calledNumber}`);
      
      // Configuration error for unconfigured numbers
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      twiml.say(escapeTwiML(msg));
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // 🚫 SPAM FILTER - Check if call should be blocked
    const SmartCallFilter = require('../services/SmartCallFilter');
    const filterResult = await SmartCallFilter.checkCall({
      callerPhone: callerNumber,
      companyId: company._id.toString(),
      companyPhone: calledNumber,
      twilioCallSid: req.body.CallSid
    });

    // 📊 STRUCTURED SPAM LOG - For traceability
    logger.info('[SPAM-FIREWALL] decision', {
      route: '/voice',
      companyId: company._id.toString(),
      fromNumber: callerNumber,
      toNumber: calledNumber,
      decision: filterResult.shouldBlock ? 'BLOCK' : 'ALLOW',
      reason: filterResult.reason || null,
      spamScore: filterResult.spamScore || 0,
      spamFlags: filterResult.flags || [],
      callSid: req.body.CallSid,
      timestamp: new Date().toISOString()
    });

    if (filterResult.shouldBlock) {
      logger.security(`🚫 [SPAM BLOCKED] Call from ${callerNumber} blocked. Reason: ${filterResult.reason}`);
      
      // Play rejection message and hangup
      twiml.say('This call has been blocked. Goodbye.');
      twiml.hangup();
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    logger.security(`✅ [SPAM FILTER] Call from ${callerNumber} passed all security checks`);
    
    // ────────────────────────────────────────────────────────────────
    // 🛡️ SPAM CONTEXT: Attach spam data to session for edge case bridge
    // ────────────────────────────────────────────────────────────────
    // This allows Edge Cases to react to spam score even if call passed filter.
    // Edge cases can enforce "minSpamScore" thresholds for polite hangup.
    const spamContext = {
      spamScore: filterResult.spamScore || 0,
      spamReason: filterResult.reason || null,
      spamFlags: filterResult.flags || []
    };
    
    // Store in session for /v2-agent-respond to access
    req.session = req.session || {};
    req.session.spamContext = spamContext;

    // ============================================================================
    // 🎯 CALL SOURCE DETECTION (Phase 2: 3-Mode System)
    // ============================================================================
    // Determine call source: template-test | company-test | production
    // This context is passed to the AI runtime for proper 3-tier routing and LLM Learning
    let callSource = 'production';
    let isTest = false;
    
    if (company.isGlobalTestTemplate) {
      // Global AI Brain template testing (isolated template, no company)
      callSource = 'template-test';
      isTest = true;
    } else if (company.isTestMode) {
      // Company Test Mode (real company setup, test phone number)
      callSource = 'company-test';
      isTest = true;
    } else {
      // Real customer calling production number
      callSource = 'production';
      isTest = false;
    }
    
    // 🔍 Clear log marker for manual verification
    console.log('[CALL SOURCE]', {
      inboundNumber: calledNumber,
      callSource,
      companyId: company._id?.toString() || 'template-test',
      isGlobalTest: company.isGlobalTestTemplate || false,
      isCompanyTest: company.isTestMode || false
    });
    
    logger.info(`🎯 [CALL SOURCE] Detected: ${callSource.toUpperCase()} | Test Mode: ${isTest}`);
    
    // 🏢 COMPANY TEST MODE - Play test greeting
    if (company.isTestMode && company.testGreeting) {
      logger.info(`🏢 [COMPANY TEST MODE] Playing test greeting for company: ${company.companyName || company.businessName}`);
      
      // Replace {company_name} placeholder with actual company name
      const companyName = company.companyName || company.businessName || 'Unknown Company';
      const greeting = company.testGreeting.replace(/{company_name}/g, companyName);
      
      logger.info(`🎙️ [COMPANY TEST MODE] Greeting: "${greeting}"`);
      
      // Play test greeting
      twiml.say({
        voice: 'Polly.Matthew',
        language: 'en-US'
      }, greeting);
      
      // Brief pause after greeting
      twiml.pause({ length: 1 });
      
      logger.info(`✅ [COMPANY TEST MODE] Test greeting complete, continuing to AI agent...`);
      // Don't return here - let it continue to the AI agent below!
    }

    // 🔔 NOTIFICATION CENTER TEST MODE (Same pattern as Global AI Brain)
    if (company.isNotificationCenterTest) {
      logger.security(`🔔 [NOTIFICATION CENTER] Test mode activated`);
      
      const greeting = company.settings.notificationCenter.twilioTest.greeting;
      
      logger.info(`🎙️ [NOTIFICATION CENTER] Playing greeting: "${greeting.substring(0, 80)}..."`);
      
      twiml.say({
        voice: 'Polly.Matthew',
        language: 'en-US'
      }, greeting);
      
      twiml.hangup();
      
      // Update stats (same as Global Brain)
      company.settings.notificationCenter.twilioTest.testCallCount++;
      company.settings.notificationCenter.twilioTest.lastTestedAt = new Date();
      await company.settings.save();
      
      logger.info(`✅ [NOTIFICATION CENTER] Test call complete. Total calls: ${company.settings.notificationCenter.twilioTest.testCallCount}`);
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // 🧠 GLOBAL AI BRAIN TEST MODE
    if (company.isGlobalTestTemplate) {
      logger.debug(`🧠 [GLOBAL BRAIN] Test mode activated for template: ${company.template.name}`);
      
      // Build effective fillers (template + all categories)
      const templateFillers = company.template.fillerWords || [];
      const allFillers = [...templateFillers];
      company.template.categories.forEach(category => {
        if (category.additionalFillerWords && Array.isArray(category.additionalFillerWords)) {
          allFillers.push(...category.additionalFillerWords);
        }
      });
      const effectiveFillers = [...new Set(allFillers)];
      
      // Build effective synonym map (template + all categories)
      const effectiveSynonymMap = new Map();
      if (company.template.synonymMap) {
        for (const [term, aliases] of Object.entries(company.template.synonymMap)) {
          if (Array.isArray(aliases)) {
            effectiveSynonymMap.set(term, [...aliases]);
          }
        }
      }
      company.template.categories.forEach(category => {
        if (category.synonymMap) {
          for (const [term, aliases] of Object.entries(category.synonymMap || {})) {
            if (Array.isArray(aliases)) {
              if (effectiveSynonymMap.has(term)) {
                const existing = effectiveSynonymMap.get(term);
                effectiveSynonymMap.set(term, [...new Set([...existing, ...aliases])]);
              } else {
                effectiveSynonymMap.set(term, [...aliases]);
              }
            }
          }
        }
      });
      
      const urgencyKeywords = company.template.urgencyKeywords || [];
      logger.debug(`🧠 [GLOBAL BRAIN] Selector config - Fillers: ${effectiveFillers.length}, Urgency keywords: ${urgencyKeywords.length}, Synonym terms: ${effectiveSynonymMap.size}`);
      
      // Initialize selector with merged fillers, urgency keywords, and synonym map
      const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, effectiveSynonymMap);
      
      // NEW: Greet the tester with custom greeting from GLOBAL config
      const rawGreeting = company.globalTestConfig?.greeting || 
        'Welcome to the ClientsVia Global AI Brain Testing Center. You are currently testing the {template_name} template. Please ask questions or make statements to test the AI scenarios now.';
      const greeting = rawGreeting.replace('{template_name}', company.template.name);
      
      logger.info(`🎙️ [GLOBAL BRAIN] Using greeting: "${greeting.substring(0, 80)}..."`);
      
      // 🎯 CRITICAL: Test Pilot must use SAME speech detection settings as real customer calls
      // This ensures testing accuracy - what you test is what customers experience
      // Using production defaults: 3s speechTimeout, 5s initialTimeout
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${company.template._id}`,
        method: 'POST',
        timeout: 5, // Initial timeout (how long to wait for ANY speech)
        speechTimeout: '3', // Speech timeout (how long after they STOP talking) - MATCHES PRODUCTION!
        enhanced: true, // Enhanced speech recognition
        speechModel: 'phone_call', // Optimized for phone calls
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually' // Help recognize common filler words
      });
      gather.say(greeting);
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }
    
    logger.info(`[COMPANY FOUND] [OK] Company: ${company.companyName} (ID: ${company._id})`);
    
    // 🚦 CHECK IF AI AGENT IS LIVE (Go Live Gate)
    const isLive = company.configuration?.readiness?.isLive;
    logger.info(`[GO LIVE CHECK] AI Agent status: ${isLive ? '🟢 LIVE' : '🔴 NOT LIVE YET'}`);
    
    if (!isLive) {
        logger.warn(`[NOT LIVE] Company ${company.companyName} has not activated AI Agent yet (isLive = false)`);
        
        // Get custom pre-activation message or use default
        let preActivationMessage = company.configuration?.readiness?.preActivationMessage;
        
        if (!preActivationMessage || !preActivationMessage.trim()) {
            // Fallback to default
            preActivationMessage = "Thank you for calling {companyName}. Our AI receptionist is currently being configured and will be available shortly. For immediate assistance, please call our main office line. Thank you for your patience.";
        }
        
        // Replace {companyName} placeholder
        const companyName = company.companyName || company.businessName || 'our office';
        preActivationMessage = preActivationMessage.replace(/\{companyName\}/gi, companyName);
        
        logger.info(`[NOT LIVE] Playing pre-activation message: "${preActivationMessage.substring(0, 100)}..."`);
        
        twiml.say({
            voice: 'Polly.Matthew',
            language: 'en-US'
        }, escapeTwiML(preActivationMessage));
        
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
        return;
    }
    
    logger.info(`[GO LIVE CHECK] ✅ AI Agent is LIVE - proceeding to handle call`);
    
    // 🚨 CHECK ACCOUNT STATUS - Handle suspended/forwarded accounts
    if (company.accountStatus && company.accountStatus.status) {
      const accountStatus = company.accountStatus.status;
      logger.debug(`[ACCOUNT STATUS] Company status: ${accountStatus}`);
      
      if (accountStatus === 'suspended') {
        logger.debug(`[ACCOUNT SUSPENDED] Company ${company.companyName} account is suspended`);
        logger.debug(`[ACCOUNT SUSPENDED DEBUG] Raw suspendedMessage from DB:`, company.accountStatus.suspendedMessage);
        
        // Get custom suspended message from database (NO DEFAULT MESSAGE if empty)
        let suspendedMessage = company.accountStatus.suspendedMessage;
        
        if (suspendedMessage && suspendedMessage.trim()) {
          // Replace {Company Name} placeholder (case-insensitive, with or without space)
          logger.info(`[ACCOUNT SUSPENDED] Using custom message with placeholder replacement`);
          const companyName = company.companyName || company.businessName || 'the company';
          // Match: {company name}, {companyname}, {Company Name}, {CompanyName}, etc.
          suspendedMessage = suspendedMessage.replace(/\{company\s*name\}/gi, companyName);
          logger.info(`[ACCOUNT SUSPENDED] Final message: "${suspendedMessage}"`);
          twiml.say(escapeTwiML(suspendedMessage));
        } else {
          // No custom message - use neutral transfer message
          logger.info(`[ACCOUNT SUSPENDED] No custom message set - using neutral transfer`);
          const defaultMessage = "This service is unavailable. Please contact support.";
          twiml.say(escapeTwiML(defaultMessage));
        }
        
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }
      
      if (accountStatus === 'call_forward' && company.accountStatus.callForwardNumber) {
        logger.debug(`[CALL FORWARD] Forwarding call to ${company.accountStatus.callForwardNumber}`);
        logger.debug(`[CALL FORWARD DEBUG] Raw callForwardMessage from DB:`, company.accountStatus.callForwardMessage);
        const forwardNumber = company.accountStatus.callForwardNumber;
        
        // Get custom forward message from text box (NO DEFAULT MESSAGE)
        let forwardMessage = company.accountStatus.callForwardMessage;
        
        if (forwardMessage && forwardMessage.trim()) {
          // Replace {Company Name} placeholder (case-insensitive, with or without space)
          logger.info(`[CALL FORWARD] Using custom message from text box with placeholder replacement`);
          const companyName = company.companyName || company.businessName || 'the company';
          // Match: {company name}, {companyname}, {Company Name}, {CompanyName}, etc.
          forwardMessage = forwardMessage.replace(/\{company\s*name\}/gi, companyName);
          logger.info(`[CALL FORWARD] Final message: "${forwardMessage}"`);
          twiml.say(escapeTwiML(forwardMessage));
        } else {
          // No message in text box - forward silently (no greeting)
          logger.info(`[CALL FORWARD] No custom message set - forwarding silently (no greeting)`);
        }
        
        twiml.dial(forwardNumber);
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }
    }
    
    logger.info(`[AI AGENT LOGIC] Using new AI Agent Logic system for company: ${company._id}`);
    
    // ════════════════════════════════════════════════════════════════════════════
    // 📞 CALL CENTER MODULE V2: Customer Recognition
    // ════════════════════════════════════════════════════════════════════════════
    // Identify returning customers for personalized experience
    // This is race-proof - 100 concurrent calls = 1 customer
    // ════════════════════════════════════════════════════════════════════════════
    let callContext = null;
    if (CallSummaryService) {
      try {
        callContext = await CallSummaryService.startCall({
          companyId: company._id.toString(),
          phone: req.body.From,
          twilioSid: req.body.CallSid,
          direction: 'inbound'
        });
        
        logger.info('[CALL CENTER] Customer recognized', {
          callId: callContext.callId,
          companyId: company._id.toString(),
          isReturning: callContext.isReturning,
          customerId: callContext.customerId,
          customerName: callContext.customerContext?.name || null,
          lookupTime: callContext.customerLookupTime
        });
        
        // Store in session for v2-agent-respond to access (survives between requests)
        req.session = req.session || {};
        req.session.callCenterContext = callContext;
        
      } catch (callCenterErr) {
        // Non-blocking: Log but continue with call
        logger.warn('[CALL CENTER] Customer recognition failed (non-blocking)', {
          error: callCenterErr.message,
          companyId: company._id.toString(),
          phone: req.body.From
        });
      }
    }
    // ════════════════════════════════════════════════════════════════════════════
    
    // ════════════════════════════════════════════════════════════════════════════
    // 📼 BLACK BOX: Initialize call recording
    // ════════════════════════════════════════════════════════════════════════════
    // V94: Compute AW proof (awHash + effectiveConfigVersion) for CALL_START
    // This proves which config was used and enables AW ⇄ RE correlation.
    // ════════════════════════════════════════════════════════════════════════════
    const awProof = computeAwProof(company);
    const traceRunId = `tr-${req.body.CallSid || Date.now()}`;
    
    // ════════════════════════════════════════════════════════════════════════════
    // V98 FIX: Persist awHash + traceRunId to session for v2-agent-respond access
    // ════════════════════════════════════════════════════════════════════════════
    // Without this, Turn 1 has awHash=null because callState is created fresh.
    // ════════════════════════════════════════════════════════════════════════════
    req.session = req.session || {};
    req.session.awHash = awProof.awHash;
    req.session.effectiveConfigVersion = awProof.effectiveConfigVersion;
    req.session.traceRunId = traceRunId;
    
    if (BlackBoxLogger) {
      try {
        await BlackBoxLogger.initCall({
          callId: req.body.CallSid,
          companyId: company._id,
          from: req.body.From,
          to: req.body.To,
          customerId: callContext?.customerId || null,
          customerContext: callContext?.customerContext ? {
            isReturning: callContext.isReturning || false,
            totalCalls: callContext.customerContext.totalCalls || 1,
            customerName: callContext.customerContext.name || null
          } : null,
          // V94: AW ⇄ RE correlation keys (proves which config was used)
          awHash: awProof.awHash,
          effectiveConfigVersion: awProof.effectiveConfigVersion,
          traceRunId
        });
        
        logger.info('[BLACK BOX] ✅ V94: Call initialized with AW proof', {
          callId: req.body.CallSid,
          awHash: awProof.awHash,
          effectiveConfigVersion: awProof.effectiveConfigVersion
        });
      } catch (bbErr) {
        // Non-blocking: Don't let black box failures kill the call
        logger.warn('[BLACK BOX] Init failed (non-blocking)', { error: bbErr.message });
      }
    }
    // ════════════════════════════════════════════════════════════════════════════
    
    // 🚀 USE NEW V2 AI AGENT SYSTEM
    try {
      // Import V2 AI Agent Runtime - BRAND NEW SYSTEM
      const { initializeCall } = require('../services/v2AIAgentRuntime');
      
      // Initialize call with V2 Agent Personality system
      // 🎯 Phase 1: Pass callSource context for Test Pilot integration
      const initResult = await initializeCall(
        company._id.toString(),
        req.body.CallSid,
        req.body.From,
        req.body.To,
        callSource,  // 'company-test' | 'production'
        isTest       // boolean flag
      );
      
      logger.debug(`🔍 [CALL-1] Call initialized successfully`);
      logger.debug(`🔍 [CALL-2] Greeting from initializeCall:`, initResult.greeting);
      logger.debug(`🔍 [CALL-3] Voice settings from initializeCall:`, JSON.stringify(initResult.voiceSettings, null, 2));
      
      // ════════════════════════════════════════════════════════════════════════════
      // 👋 CALL CENTER V2: Personalize Initial Greeting
      // ════════════════════════════════════════════════════════════════════════════
      // If we recognized a returning customer, personalize the greeting
      let personalizedGreeting = initResult.greeting;
      if (callContext?.isReturning && callContext?.customerContext?.customerFirstName) {
        const { personalizeGreeting } = require('../utils/responseVariableSubstitution');
        personalizedGreeting = personalizeGreeting(initResult.greeting, callContext.customerContext, company);
        
        // If greeting doesn't already include their name, add a personal touch
        const firstName = callContext.customerContext.customerFirstName;
        if (!personalizedGreeting.toLowerCase().includes(firstName.toLowerCase())) {
          // Inject personalization at the start
          const companyName = company.companyName || company.businessName || 'us';
          personalizedGreeting = `Hi ${firstName}! Welcome back to ${companyName}. ${personalizedGreeting}`;
        }
        
        logger.info('[GREETING] Personalized for returning customer', {
          customerName: firstName,
          isReturning: true,
          totalCalls: callContext.customerContext.totalCalls
        });
      }
      initResult.greeting = personalizedGreeting;
      // ════════════════════════════════════════════════════════════════════════════
      
      // 📊 STRUCTURED LOG: Greeting initialized
      logger.info('[GREETING] initialized', {
        companyId: company._id.toString(),
        callSid: req.body.CallSid,
        route: '/voice',
        greetingMode: initResult.greetingConfig?.mode,
        textPreview: initResult.greeting?.slice(0, 80),
        voiceId: initResult.voiceSettings?.voiceId || null,
        timestamp: new Date().toISOString()
      });
      
      // DOUBLE-CHECK: Reload company to verify voiceSettings are in DB
      logger.debug(`🔍 [CALL-4] Double-checking voice settings from database...`);
      const freshCompany = await Company.findById(company._id);
      logger.debug(`🔍 [CALL-5] Fresh company.aiAgentSettings exists:`, Boolean(freshCompany.aiAgentSettings));
      logger.debug(`🔍 [CALL-6] Fresh company.aiAgentSettings.voiceSettings:`, JSON.stringify(freshCompany.aiAgentSettings?.voiceSettings, null, 2));
      
      logger.debug(`[V2 AGENT] Call initialized, greeting: "${initResult.greeting}"`);
      logger.debug(`[V2 VOICE] Voice settings:`, JSON.stringify(initResult.voiceSettings, null, 2));
      
      // Set up speech gathering with V2 Agent response handler
      // 📞 SPEECH DETECTION: Now configurable per company in Voice Settings
      const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      
      // 🐰 RABBIT HOLE CHECKPOINT #1: WHERE WILL GATHER SEND USER INPUT?
      const actionUrl = `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`;
      console.log('═'.repeat(80));
      console.log('[🐰 GATHER CHECKPOINT #1] Setting up <Gather> - WHERE will user speech go?');
      console.log('Action URL:', actionUrl);
      console.log('CompanyID:', company._id.toString());
      console.log('Host:', req.get('host'));
      console.log('Full Path:', `/api/twilio/v2-agent-respond/${company._id}`);
      console.log('═'.repeat(80));
      
      // Build business-relevant hints from company trade/services
      const tradeHints = company.trade ? [company.trade.toLowerCase()] : [];
      const serviceHints = (company.aiAgentSettings?.serviceTypes || [])
        .map(s => s.name?.toLowerCase())
        .filter(Boolean)
        .slice(0, 10); // Limit to 10 most important
      const defaultHints = ['appointment', 'schedule', 'emergency', 'question', 'help'];
      const hints = [...new Set([...tradeHints, ...serviceHints, ...defaultHints])].join(', ');
      
      const gatherConfig = {
        input: 'speech',
        action: actionUrl,
        method: 'POST',
        bargeIn: speechDetection.bargeIn ?? false,
        timeout: speechDetection.initialTimeout ?? 5,
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(),
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        hints: hints,
        partialResultCallback: `https://${req.get('host')}/api/twilio/v2-agent-partial/${company._id}`,
        partialResultCallbackMethod: 'POST'
      };
      
      const gather = twiml.gather(gatherConfig);
      
      // 📼 BLACK BOX: Log gather configuration for debugging
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: req.body.CallSid,
          companyId: company._id,
          type: 'GATHER_CONFIGURED',
          turn: 0,
          data: {
            actionUrl: actionUrl,
            timeout: gatherConfig.timeout,
            speechTimeout: gatherConfig.speechTimeout,
            bargeIn: gatherConfig.bargeIn,
            hintsCount: hints.split(',').length
          }
        }).catch(() => {});
      }

      // Use V2 Voice Settings for TTS
      const elevenLabsVoice = initResult.voiceSettings?.voiceId;
      logger.debug(`🔍 [CALL-7] Extracted voice ID from initResult: ${elevenLabsVoice || 'NOT SET'}`);
      logger.debug(`🔍 [CALL-8] Has greeting: ${Boolean(initResult.greeting)}`);
      logger.debug(`🔍 [CALL-9] Will use ElevenLabs: ${Boolean(elevenLabsVoice && initResult.greeting)}`);
      logger.debug(`[V2 VOICE CHECK] ElevenLabs Voice ID: ${elevenLabsVoice || 'NOT SET'}`);
      logger.debug(`[V2 VOICE CHECK] Has greeting: ${Boolean(initResult.greeting)}`);
      
      if (elevenLabsVoice && initResult.greeting) {
        try {
          logger.debug(`[TTS START] ✅ Using ElevenLabs voice ${elevenLabsVoice} for initial greeting`);
          const ttsStartTime = Date.now();
          const greetingText = cleanTextForTTS(stripMarkdown(initResult.greeting));
          
          // 📼 BLACK BOX: Log TTS started
          if (BlackBoxLogger) {
            BlackBoxLogger.QuickLog.ttsStarted(
              req.body.CallSid,
              company._id,
              0,
              elevenLabsVoice,
              greetingText.length
            ).catch(() => {});
          }
          
          const buffer = await synthesizeSpeech({
            text: greetingText,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company.aiAgentSettings?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentSettings?.voiceSettings?.aiModel,
            company
          });
          
          const ttsTime = Date.now() - ttsStartTime;
          logger.info(`[TTS COMPLETE] [OK] AI Agent Logic greeting TTS completed in ${ttsTime}ms`);
          
          // 📼 BLACK BOX: Log TTS completed
          if (BlackBoxLogger) {
            BlackBoxLogger.QuickLog.ttsCompleted(
              req.body.CallSid,
              company._id,
              0,
              elevenLabsVoice,
              ttsTime
            ).catch(() => {});
          }
          
          const fileName = `ai_greet_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) {fs.mkdirSync(audioDir, { recursive: true });}
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          gather.play(`${getSecureBaseUrl(req)}/audio/${fileName}`);
          
          // 📼 BLACK BOX: Log greeting sent
          if (BlackBoxLogger) {
            BlackBoxLogger.QuickLog.greetingSent(
              req.body.CallSid,
              company._id,
              greetingText,
              ttsTime
            ).catch(() => {}); // Fire and forget
          }
        } catch (err) {
          logger.error('❌ AI Agent Logic TTS failed, using Say:', err);
          
          // 📼 BLACK BOX: Log TTS failure
          if (BlackBoxLogger) {
            BlackBoxLogger.QuickLog.ttsFailed(
              req.body.CallSid,
              company._id,
              0,
              err.message,
              'twilio_say'
            ).catch(() => {});
          }
          
          gather.say(escapeTwiML(cleanTextForTTS(stripMarkdown(initResult.greeting))));
        }
      } else {
        // Fallback to Say if no voice or greeting
        logger.debug(`⚠️ Fallback to Twilio Say - Voice: ${elevenLabsVoice ? 'SET' : 'MISSING'}, Greeting: ${initResult.greeting ? 'SET' : 'MISSING'}`);
        const fallbackGreeting = initResult.greeting || "Configuration error - no greeting configured";
        gather.say(escapeTwiML(cleanTextForTTS(stripMarkdown(fallbackGreeting))));
      }
      
      // 🚫 NEVER HANG UP - Redirect silently to continue listening
      // FEB 2026 FIX: Removed Polly.Matthew voice - was causing "creepy voice" issue
      // The silence handler in ConversationEngine will handle prompts properly via ElevenLabs
      logger.debug(`[GATHER FALLBACK] No speech detected - redirecting to continue`);
      twiml.redirect(`https://${req.get('host')}/api/twilio/${company._id}/voice`);
      
    } catch (v2Error) {
      logger.error(`[V2 AGENT ERROR] Failed to initialize V2 Agent: ${v2Error.message}`);
      logger.debug(`[FALLBACK] Using simple fallback for call`);
      
      // 📼 BLACK BOX: Log V2 Agent initialization failure
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: req.body.CallSid,
          companyId: company._id,
          type: 'V2_AGENT_INIT_FAILED',
          turn: 0,
          data: {
            error: v2Error.message,
            stack: v2Error.stack?.substring(0, 300),
            usingFallback: true
          }
        }).catch(() => {});
      }
      
      // Fallback to simple greeting if V2 Agent fails
      const fallbackGreeting = `Configuration error - V2 Agent not configured for ${company.businessName || company.companyName}`;
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: false,
        timeout: 5,
        speechTimeout: '3', // Matches production defaults for consistent experience
        enhanced: true,
        speechModel: 'phone_call'
      });
      gather.say(escapeTwiML(fallbackGreeting));
      
      // 🚫 NEVER HANG UP - Redirect silently to continue listening
      // FEB 2026 FIX: Removed Polly.Matthew voice - was causing "creepy voice" issue
      twiml.redirect(`https://${req.get('host')}/api/twilio/${company._id}/voice`);
    }

    res.type('text/xml');
    const twimlString = twiml.toString();
    
    // 📼 BLACK BOX: Log TwiML sent - this is the last thing we control before Twilio takes over
    if (BlackBoxLogger) {
      BlackBoxLogger.logEvent({
        callId: req.body.CallSid,
        companyId: company._id,
        type: 'TWIML_SENT',
        turn: 0,
        data: {
          route: '/voice',
          twimlLength: twimlString.length,
          hasGather: twimlString.includes('<Gather'),
          hasPlay: twimlString.includes('<Play'),
          hasSay: twimlString.includes('<Say'),
          actionUrl: `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`,
          twimlPreview: twimlString.substring(0, 500)
        }
      }).catch(() => {});
    }
    
    // 🐰 RABBIT HOLE CHECKPOINT #2: WHAT TWIML ARE WE SENDING TO TWILIO?
    console.log('═'.repeat(80));
    console.log('[🐰 GATHER CHECKPOINT #2] Sending TwiML to Twilio - CHECK THE ACTION URL!');
    console.log('TwiML Length:', twimlString.length);
    console.log('TwiML Content:', twimlString);
    console.log('═'.repeat(80));
    
    // 📊 STRUCTURED LOG: Gather configured (note: initResult may not be in scope for fallback path)
    logger.info('[GATHER] first-turn configured', {
      companyId: company._id.toString(),
      callSid: req.body.CallSid,
      route: '/voice',
      actionUrl: `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`,
      partialUrl: `https://${req.get('host')}/api/twilio/v2-agent-partial/${company._id}`,
      twimlLength: twimlString.length,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`[Twilio Voice] Sending AI Agent Logic TwiML: ${twimlString}`);
    res.send(twimlString);
    
  } catch (error) {
    logger.error(`[ERROR] [CRITICAL] Voice endpoint error: ${error.message}`);
    logger.error(`[ERROR] Stack trace:`, error.stack);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // 🔥 Minimal error message - no generic fallback text
    twiml.say('Service is temporarily unavailable. Please try again later.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

router.post('/handle-speech', async (req, res) => {
  const requestStartTime = Date.now();
  let confidence = 0;
  let threshold = 0.5;
  
  logger.debug(`[SPEECH START] [SPEECH] Speech processing started at: ${new Date().toISOString()}`);
  
  try {
    // Get Redis client once at start (may be null if Redis unavailable)
    const redisClient = await getRedis();
    
    logger.debug(`[TWILIO TIMING] Speech webhook received at: ${new Date().toISOString()}`);
    logger.debug(`[TWILIO TIMING] Twilio sent SpeechResult: "${req.body.SpeechResult}" with confidence: ${req.body.Confidence}`);
    logger.debug('[POST /api/twilio/handle-speech] Incoming speech:', req.body);
    const speechText = req.body.SpeechResult || '';
    const twiml = new twilio.twiml.VoiceResponse();
    const callSid = req.body.CallSid;
    const repeatKey = `twilio-repeats:${callSid}`;

    // 🎯 CLEAR TIMED FOLLOW-UP: Caller responded, cancel any pending follow-up timer
    if (speechText && speechText.trim()) {
      try {
        const TimedFollowUpManager = require('../services/TimedFollowUpManager');
        const wasCleared = TimedFollowUpManager.clearFollowUp(callSid);
        if (wasCleared) {
          logger.info(`⏰ [TIMED FOLLOWUP] Cleared - caller responded`, { callSid });
        }
      } catch (e) {
        // Non-fatal - just log
        logger.debug(`[TIMED FOLLOWUP] Clear error (non-fatal)`, { error: e.message });
      }
    }

    if (!speechText) {
      logger.info(`[SPEECH ERROR] [ERROR] Empty speech result received from Twilio`);
      // Legacy personality system removed - using configuration error message
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    logger.debug(`[SPEECH RECEIVED] [TARGET] Processing speech: "${speechText}" (${speechText.length} chars)`);

    // Check for potentially unclear/incomplete speech OR rambling
    const isLikelyUnclear = (
      speechText.length < 3 || 
      /^[a-z]{1,2}\.?$/i.test(speechText.trim()) || // Single/double letters
      speechText.toLowerCase().includes('have on') || // Common misrecognition
      speechText.toLowerCase().includes('hello') && speechText.length < 10 // Just "hello"
    );
    
    const isLikelyRambling = (
      speechText.length > 300 || // Very long speech (300+ chars)
      speechText.split(' ').length > 50 || // 50+ words
      (speechText.match(/\b(and|then|so|but|also|actually|basically)\b/gi) || []).length > 5 // Too many filler words
    );
    
    if (isLikelyUnclear) {
      logger.info(`[SPEECH QUALITY] ⚠️ Potentially unclear speech detected: "${speechText}"`);
    }
    
    if (isLikelyRambling) {
      logger.info(`[SPEECH QUALITY] 📢 Rambling detected: ${speechText.length} chars, ${speechText.split(' ').length} words`);
    }

    const calledNumber = normalizePhoneNumber(req.body.To);
    logger.debug(`[COMPANY LOOKUP] [SEARCH] Looking up company for phone: ${calledNumber}`);
    const company = await getCompanyByPhoneNumber(calledNumber);
    if (!company) {
      logger.debug(`[COMPANY ERROR] [ERROR] No company found for phone: ${calledNumber} during speech processing`);
      // Legacy personality system removed - using configuration error message
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    logger.debug(`[COMPANY CONFIRMED] [OK] Processing speech for: ${company.companyName}`);

    // ========================================================================
    // 🎯 LOW CONFIDENCE HANDLING - STT Quality Guard (LLM-0 Controls)
    // ========================================================================
    // When STT confidence is below threshold, ask caller to repeat.
    // This prevents wrong interpretations and protects revenue.
    // Settings: company.aiAgentSettings.llm0Controls.lowConfidenceHandling
    // ========================================================================
    confidence = parseFloat(req.body.Confidence || '0');
    const companyId = company._id.toString();
    
    // Get LLM-0 low confidence settings (fall back to defaults if not configured)
    const lcSettings = {
      enabled: true,
      threshold: 60,  // 0-100%
      action: 'repeat',
      repeatPhrase: "Sorry, there's some background noise — could you say that again?",
      maxRepeatsBeforeEscalation: 2,
      escalatePhrase: "I'm having trouble hearing you clearly. Let me get someone to help you.",
      preserveBookingOnLowConfidence: true,
      bookingRepeatPhrase: "Sorry, I didn't catch that. Could you repeat that for me?",
      logToBlackBox: true,
      ...(company.aiAgentSettings?.llm0Controls?.lowConfidenceHandling || {})
    };
    
    // V69: Recovery messages now use getRecoveryMessage() for random variants
    // This object is kept for backward compat but uses the helper internally
    const recoveryMessages = {
      get audioUnclear() { return getRecoveryMessage(company, 'audioUnclear'); },
      get choppyConnection() { return getRecoveryMessage(company, 'audioUnclear'); }, // Legacy alias
      get connectionCutOut() { return getRecoveryMessage(company, 'connectionCutOut'); },
      get silenceRecovery() { return getRecoveryMessage(company, 'silenceRecovery'); },
      get generalError() { return getRecoveryMessage(company, 'generalError'); },
      get technicalTransfer() { return getRecoveryMessage(company, 'technicalTransfer'); }
    };
    
    // Convert 0-1 confidence to 0-100 for comparison
    const confidencePercent = confidence * 100;
    
    // Use legacy threshold if LLM-0 controls not configured (backward compatibility)
    const legacyThreshold = (company.aiSettings?.twilioSpeechConfidenceThreshold ?? 0.4) * 100;
    const effectiveThreshold = lcSettings.enabled ? lcSettings.threshold : legacyThreshold;
    
    logger.debug(`[LOW CONFIDENCE CHECK] Speech: "${speechText}" | Confidence: ${confidencePercent.toFixed(1)}% | Threshold: ${effectiveThreshold}% | ${confidencePercent >= effectiveThreshold ? 'PASS ✅' : 'LOW ⚠️'}`);
    
    // Store original values for comparison
    let effectiveSpeechText = speechText;
    let effectiveConfidence = confidencePercent;
    let usedDeepgram = false;
    
    if (lcSettings.enabled && confidencePercent < effectiveThreshold) {
      logger.info(`[LOW CONFIDENCE] ⚠️ STT confidence ${confidencePercent.toFixed(1)}% < ${effectiveThreshold}% threshold`);
      
      // ========================================================================
      // 🎯 DEEPGRAM FALLBACK - Try Deepgram before asking to repeat
      // ========================================================================
      if (lcSettings.useDeepgramFallback && DeepgramFallback && DeepgramFallback.isDeepgramConfigured()) {
        const dgThreshold = lcSettings.deepgramFallbackThreshold ?? effectiveThreshold;
        
        if (confidencePercent < dgThreshold) {
          logger.info(`[DEEPGRAM] 🎯 Triggering Deepgram fallback (Twilio: ${confidencePercent.toFixed(1)}% < ${dgThreshold}%)`);
          
          // Log start of Deepgram attempt
          if (lcSettings.logToBlackBox && BlackBoxLogger) {
            try {
              await BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'DEEPGRAM_FALLBACK_STARTED',
                data: {
                  twilioConfidence: confidencePercent,
                  twilioTranscript: speechText?.substring(0, 100) || '',
                  threshold: dgThreshold
                }
              });
            } catch (logErr) {
              logger.warn('[DEEPGRAM] Black Box log failed:', logErr.message);
            }
          }
          
          try {
            // Get recording URL from Twilio (if available)
            const recordingUrl = req.body.RecordingUrl || null;
            
            if (recordingUrl) {
              const dgResult = await DeepgramFallback.transcribeWithDeepgram(recordingUrl);
              
              if (dgResult && dgResult.transcript) {
                const dgAcceptThreshold = lcSettings.deepgramAcceptThreshold ?? 80;
                
                if (dgResult.confidencePercent >= dgAcceptThreshold) {
                  // 🎉 Deepgram gave us a better transcript!
                  logger.info(`[DEEPGRAM] ✅ SUCCESS! Using Deepgram transcript: "${dgResult.transcript.substring(0, 50)}..." (${dgResult.confidencePercent}%)`);
                  
                  effectiveSpeechText = dgResult.transcript;
                  effectiveConfidence = dgResult.confidencePercent;
                  usedDeepgram = true;
                  
                  // Generate vocabulary suggestions for Black Box
                  const vocabSuggestions = DeepgramFallback.generateVocabularySuggestions(speechText, dgResult.transcript);
                  
                  // Log success with comparison for vocabulary learning
                  if (lcSettings.logToBlackBox && BlackBoxLogger) {
                    try {
                      await BlackBoxLogger.logEvent({
                        callId: callSid,
                        companyId,
                        type: 'DEEPGRAM_FALLBACK_SUCCESS',
                        data: {
                          twilioConfidence: confidencePercent,
                          deepgramConfidence: dgResult.confidencePercent,
                          twilioTranscript: speechText?.substring(0, 100) || '',
                          deepgramTranscript: dgResult.transcript?.substring(0, 100) || '',
                          durationMs: dgResult.durationMs,
                          vocabSuggestions,
                          suggestion: 'Deepgram provided better transcript - consider adding corrections to STT Profile'
                        }
                      });
                    } catch (logErr) {
                      logger.warn('[DEEPGRAM] Success log failed:', logErr.message);
                    }
                  }
                } else {
                  // Deepgram confidence also low - log but don't use
                  logger.info(`[DEEPGRAM] ⚠️ Deepgram confidence ${dgResult.confidencePercent}% below accept threshold ${dgAcceptThreshold}%`);
                  
                  if (lcSettings.logToBlackBox && BlackBoxLogger) {
                    try {
                      await BlackBoxLogger.logEvent({
                        callId: callSid,
                        companyId,
                        type: 'DEEPGRAM_FALLBACK_DISCARDED',
                        data: {
                          twilioConfidence: confidencePercent,
                          deepgramConfidence: dgResult.confidencePercent,
                          twilioTranscript: speechText?.substring(0, 100) || '',
                          deepgramTranscript: dgResult.transcript?.substring(0, 100) || '',
                          acceptThreshold: dgAcceptThreshold,
                          suggestion: 'Both Twilio and Deepgram low confidence - audio quality issue or unclear speech'
                        }
                      });
                    } catch (logErr) {
                      logger.warn('[DEEPGRAM] Discarded log failed:', logErr.message);
                    }
                  }
                }
              } else {
                logger.warn('[DEEPGRAM] No result returned from Deepgram');
                
                if (lcSettings.logToBlackBox && BlackBoxLogger) {
                  try {
                    await BlackBoxLogger.logEvent({
                      callId: callSid,
                      companyId,
                      type: 'DEEPGRAM_FALLBACK_NO_RESULT',
                      data: { twilioConfidence: confidencePercent }
                    });
                  } catch (logErr) {
                    logger.warn('[DEEPGRAM] No result log failed:', logErr.message);
                  }
                }
              }
            } else {
              logger.debug('[DEEPGRAM] No recording URL available for fallback');
            }
          } catch (dgError) {
            logger.error('[DEEPGRAM] Fallback error:', dgError.message);
            
            if (lcSettings.logToBlackBox && BlackBoxLogger) {
              try {
                await BlackBoxLogger.logEvent({
                  callId: callSid,
                  companyId,
                  type: 'DEEPGRAM_FALLBACK_ERROR',
                  data: { error: dgError.message }
                });
              } catch (logErr) {
                logger.warn('[DEEPGRAM] Error log failed:', logErr.message);
              }
            }
          }
        }
      }
      
      // ========================================================================
      // If Deepgram gave us good confidence, skip the repeat flow!
      // ========================================================================
      if (usedDeepgram && effectiveConfidence >= effectiveThreshold) {
        logger.info(`[LOW CONFIDENCE] ✅ Deepgram saved the day! Using transcript with ${effectiveConfidence}% confidence`);
        speechText = effectiveSpeechText;
        // Clear repeat counter since we got a good transcript
        if (redisClient) await redisClient.del(repeatKey);
        // Continue to normal flow (fall through to after this block)
      } else {
        // Deepgram didn't help or wasn't used - proceed with repeat/escalation flow
        logger.info(`[LOW CONFIDENCE] ⚠️ Proceeding with repeat flow (confidence: ${effectiveConfidence.toFixed(1)}%)`);
        
        // Track repeat count in Redis
        const repeats = redisClient ? await redisClient.incr(repeatKey) : 1;
        if (repeats === 1 && redisClient) {
          await redisClient.expire(repeatKey, 600);
        }
        
        // 📦 Log to Black Box for vocabulary training
        if (lcSettings.logToBlackBox && BlackBoxLogger) {
          try {
            await BlackBoxLogger.logEvent({
              callId: callSid,
              companyId,
              type: 'LOW_CONFIDENCE_HIT',
              data: {
                confidence: effectiveConfidence,
                threshold: effectiveThreshold,
                transcript: effectiveSpeechText?.substring(0, 100) || '',
                repeatCount: repeats,
                deepgramAttempted: lcSettings.useDeepgramFallback && DeepgramFallback?.isDeepgramConfigured(),
                suggestion: 'STT confidence below threshold - caller asked to repeat. Consider adding this phrase to STT corrections.'
              }
            });
          } catch (logErr) {
            logger.warn('[LOW CONFIDENCE] Black Box log failed (non-fatal):', logErr.message);
          }
        }
        
        // Check if max repeats exceeded → escalate to human
        if (repeats > lcSettings.maxRepeatsBeforeEscalation) {
          logger.warn(`[LOW CONFIDENCE] 🚨 Max repeats exceeded (${repeats} > ${lcSettings.maxRepeatsBeforeEscalation}) - escalating to human`);
          
          // Log escalation to Black Box
          if (lcSettings.logToBlackBox && BlackBoxLogger) {
            try {
              await BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'LOW_CONFIDENCE_ESCALATION',
                data: {
                  repeatCount: repeats,
                  reason: 'Max repeats exceeded due to persistent low STT confidence',
                  suggestion: 'Consider lowering threshold or improving STT vocabulary for this company'
                }
              });
            } catch (logErr) {
              logger.warn('[LOW CONFIDENCE] Escalation log failed:', logErr.message);
            }
          }
          
          const escalateMsg = lcSettings.escalatePhrase;
          const fallbackText = `<Say>${escapeTwiML(escalateMsg)}</Say>`;
          twiml.hangup();  // TODO: Replace with transfer to configured number
          if (redisClient) await redisClient.del(repeatKey);
          res.type('text/xml');
          res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
          return;
        }
        
        // Ask caller to repeat
      const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
        timeout: speechDetection.initialTimeout ?? 5,
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(),
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
      });

      // Select appropriate repeat phrase
      let retryMsg;
      if (isLikelyUnclear) {
        // Speech was garbled - be extra helpful
        retryMsg = "I didn't quite catch that. Could you please speak a little louder and clearer?";
      } else {
        // Use configured repeat phrase from LLM-0 controls
        retryMsg = lcSettings.repeatPhrase;
      }
      
      logger.info(`[LOW CONFIDENCE] 🔄 Asking to repeat (attempt ${repeats}/${lcSettings.maxRepeatsBeforeEscalation}): "${retryMsg}"`);
      
      // Use ElevenLabs TTS if configured
      const elevenLabsVoice = company.aiAgentSettings?.voiceSettings?.voiceId;

      if (elevenLabsVoice) {
        try {
          const retryMsgClean = cleanTextForTTS(stripMarkdown(retryMsg));
          const buffer = await synthesizeSpeech({
            text: retryMsgClean,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company.aiAgentSettings?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentSettings?.voiceSettings?.aiModel,
            company
          });
          
          const audioKey = `audio:retry:${callSid}`;
          if (redisClient) await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
          
          const audioUrl = `https://${req.get('host')}/api/twilio/audio/retry/${callSid}`;
          gather.play(audioUrl);
        } catch (err) {
          logger.error('[LOW CONFIDENCE] ElevenLabs TTS failed, falling back to <Say>:', err);
          gather.say(escapeTwiML(cleanTextForTTS(stripMarkdown(retryMsg))));
        }
      } else {
        gather.say(escapeTwiML(cleanTextForTTS(stripMarkdown(retryMsg))));
      }

      res.type('text/xml');
      return res.send(twiml.toString());
      }
    }
    
    // Confidence OK - clear repeat counter and proceed
    if (redisClient) await redisClient.del(repeatKey);
    logger.debug(`[LOW CONFIDENCE] ✅ Confidence ${confidencePercent.toFixed(1)}% passed threshold - proceeding with normal flow`);

    // Process QA matching using new Company Q&A system
    // companyId already declared above in Low Confidence Handler
    const qnaEntries = await CompanyQnA.find({ companyId, isActive: true });
    logger.debug(`[Q&A] Loaded ${qnaEntries.length} Company Q&A entries for company ${companyId}`);
    logger.debug(`[Q&A DEBUG] Loaded Company Q&A entries for company ${companyId}:`, qnaEntries.map(e => ({
      question: e.question,
      keywords: e.keywords,
      answer: e.answer
    })));
    logger.debug(`[Q&A DEBUG] Incoming Speech: "${speechText}"`);
    
    const fuzzyThreshold = company.aiSettings?.fuzzyMatchThreshold ?? 0.3;
    logger.debug(`[Q&A MATCHING] [SEARCH] Searching ${qnaEntries.length} Q&A entries with fuzzy threshold: ${fuzzyThreshold}`);
    
    // V2 SYSTEM: Use Priority-Driven Knowledge Router instead of legacy findCachedAnswer
    logger.debug(`[V2 MIGRATION] Legacy Q&A matching disabled - use V2 AI Agent Runtime`);
    const cachedAnswer = null; // Force V2 system usage
    
    if (cachedAnswer) {
      logger.debug(`[Q&A MATCH FOUND] [OK] Found Q&A response for ${callSid}: ${cachedAnswer.substring(0, 100)}...`);
      
      // Check conversation history for repetition detection
      let conversationHistory = [];
      const historyKey = `conversation-history:${callSid}`;
      const storedHistory = redisClient ? await redisClient.get(historyKey) : null;
      if (storedHistory) {
        conversationHistory = JSON.parse(storedHistory);
      }
      
      // Check if this exact Q&A response was recently given (last 3 messages)
      const recentAssistantMessages = conversationHistory
        .filter(msg => msg.role === 'assistant')
        .slice(-3); // Last 3 assistant messages
      
      const isRepeatingQA = recentAssistantMessages.some(msg => 
        msg.text && msg.text.includes(cachedAnswer.substring(0, 50))
      );
      
      if (isRepeatingQA) {
        logger.debug(`[Q&A REPETITION] ⚠️ Same Q&A response was recently given, providing clarification instead`);
        // Generate a clarification response instead of repeating
        const clarificationResponses = [
          "I've already shared that information with you. Is there something specific you'd like to know more about?",
          `As I mentioned, ${  cachedAnswer.substring(0, 100)  }... Is there another way I can help you?`,
          "I provided those details already. Do you have any other questions I can help with?",
          "We covered that just now. What else would you like to know about our services?"
        ];
        const clarification = clarificationResponses[Math.floor(Math.random() * clarificationResponses.length)];
        
        // Use configurable speech detection settings (fallback to defaults if not set)
        const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
        const gather = twiml.gather({
          input: 'speech',
          action: `https://${req.get('host')}/api/twilio/handle-speech`,
          method: 'POST',
          bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
          timeout: speechDetection.initialTimeout ?? 5,
          speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10s (default: 3s)
          enhanced: speechDetection.enhancedRecognition ?? true,
          speechModel: speechDetection.speechModel ?? 'phone_call',
          partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
        });
        
        gather.say(escapeTwiML(clarification));
        
        // Add to conversation history
        conversationHistory.push({ role: 'user', text: speechText });
        conversationHistory.push({ role: 'assistant', text: clarification });
        if (redisClient) await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
        
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      
      logger.info(`[Q&A RESPONSE] [OK] Using Q&A response (no repetition detected)`);
      
      // Use configurable speech detection settings (fallback to defaults if not set)
      const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
        timeout: speechDetection.initialTimeout ?? 5,
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10s (default: 3s)
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
      });

      const elevenLabsVoice = company.aiAgentSettings?.voiceSettings?.voiceId;
      
      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: cachedAnswer,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company.aiAgentSettings?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentSettings?.voiceSettings?.aiModel,
            company
          });
          
          const audioKey = `audio:qa:${callSid}`;
          if (redisClient) await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
          
          const audioUrl = `https://${req.get('host')}/api/twilio/audio/qa/${callSid}`;
          gather.play(audioUrl);
        } catch (err) {
          logger.error('ElevenLabs TTS failed, falling back to <Say>:', err);
          gather.say(escapeTwiML(cachedAnswer));
        }
      } else {
        gather.say(escapeTwiML(cachedAnswer));
      }

      // Add to conversation history
      conversationHistory.push({ role: 'user', text: speechText });
      conversationHistory.push({ role: 'assistant', text: cachedAnswer });
      if (redisClient) await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      logger.debug(`[Q&A HISTORY] 💾 Saved Q&A exchange to conversation history`);

      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Continue with AI processing
    const mainAgentScript = company.agentSetup?.mainAgentScript || '';
    const personality = company.aiSettings?.personality || 'friendly';
    const responseLength = company.aiSettings?.responseLength || 'concise';
    const companySpecialties = company.agentSetup?.companySpecialties || '';
    const categoryQAs = company.agentSetup?.categoryQAs || '';

    // Retrieve conversation history
    let conversationHistory = [];
    const historyKey = `conversation-history:${callSid}`;
    const storedHistory = redisClient ? await redisClient.get(historyKey) : null;
    if (storedHistory) {
      conversationHistory = JSON.parse(storedHistory);
    }

    // Add current user speech to history with context flags
    let speechContext = speechText;
    if (isLikelyUnclear || confidence < 0.7) {
      speechContext = `[Speech unclear/low confidence: "${speechText}"]`;
    } else if (isLikelyRambling) {
      speechContext = `[Long explanation: "${speechText.substring(0, 200)}..."]`;
    }
    
    conversationHistory.push({ role: 'user', text: speechContext });

    // No need to store context in Redis anymore - processing synchronously

    // Process AI response using new AI Agent Logic system
    logger.debug(`[AI AGENT LOGIC] 🤖 Starting AI response generation...`);
    const aiStartTime = Date.now();
    
    let answerObj;
    try {
      // V2 DELETED: Legacy aiAgentRuntime.processUserInput - using simple fallback
      // This endpoint should be replaced with V2 system
      logger.debug(`[LEGACY WARNING] Using legacy handle-speech endpoint - should migrate to V2`);
      
      answerObj = {
        text: "I'm connecting you to our team.",  // 🔥 Neutral transfer message, no generic empathy
        escalate: true
      };
      
      const aiEndTime = Date.now();
      logger.info(`[AI AGENT LOGIC] [OK] AI response generated in ${aiEndTime - aiStartTime}ms`);
      logger.info(`[AI] answerQuestion result for ${callSid}:`, answerObj);

      // Add AI response to history
      conversationHistory.push({ role: 'assistant', text: answerObj.text });
      if (redisClient) await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      logger.debug(`[AI HISTORY] 💾 Saved conversation history (${conversationHistory.length} messages)`);

    } catch (err) {
      logger.error(`[AI ERROR] [ERROR] AI processing failed: ${err.message}`);
      logger.error(`[AI Processing Error for CallSid: ${callSid}]`, err.message, err.stack);
      // 🔥 NO FALLBACK TEXT - Transfer to human on AI error
      answerObj = { text: "I'm connecting you to our team.", escalate: true };
    }

    // Generate TTS and respond immediately - using configurable speech detection settings
    const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
    const gather = twiml.gather({
      input: 'speech',
      action: `https://${req.get('host')}/api/twilio/handle-speech`,
      method: 'POST',
      bargeIn: speechDetection.bargeIn ?? false,
      timeout: speechDetection.initialTimeout ?? 5,
      speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10 seconds (default: 3s)
      enhanced: speechDetection.enhancedRecognition ?? true,
      speechModel: speechDetection.speechModel ?? 'phone_call',
      partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
    });

    const strippedAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    const elevenLabsVoice = company.aiAgentSettings?.voiceSettings?.voiceId;
    // TTS without artificial timeouts - let it complete naturally
    if (elevenLabsVoice) {
      try {
        logger.debug(`[TTS START] [TTS] Starting ElevenLabs synthesis for: "${strippedAnswer.substring(0, 50)}..."`);
        const ttsStartTime = Date.now();
        
        // Direct TTS call without timeout interference
        const buffer = await synthesizeSpeech({
          text: strippedAnswer,
          voiceId: elevenLabsVoice,
          stability: company.aiSettings.elevenLabs?.stability,
          similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
          style: company.aiSettings.elevenLabs?.style,
          model_id: company.aiSettings.elevenLabs?.modelId,
          company
        });
        
        const ttsTime = Date.now() - ttsStartTime;
        logger.info(`[TTS COMPLETE] [OK] ElevenLabs synthesis completed in ${ttsTime}ms`);

        // Store audio in Redis for fast serving
        const audioKey = `audio:ai:${callSid}`;
        if (redisClient) await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
        
        const audioUrl = `https://${req.get('host')}/api/twilio/audio/ai/${callSid}`;
        gather.play(audioUrl);
        
        // 📼 BLACK BOX: Log TTS generation
        if (BlackBoxLogger) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId,
            type: 'TTS_GENERATED',
            data: {
              engine: 'ElevenLabs',
              ms: ttsTime,
              textLength: strippedAnswer.length,
              audioUrl
            }
          }).catch(() => {});
        }

      } catch (err) {
        logger.error('ElevenLabs synthesis failed, falling back to native TTS:', err.message);
        // Use Twilio's enhanced TTS with voice settings to maintain consistency
        const voice = company.aiSettings?.twilioVoice || 'Polly.Matthew';
        gather.say({ voice }, escapeTwiML(strippedAnswer));
      }
    } else {
      // Use consistent voice even when ElevenLabs is not configured
      const voice = company.aiSettings?.twilioVoice || 'Polly.Matthew';
      gather.say({ voice }, escapeTwiML(strippedAnswer));
    }

    res.type('text/xml');
    const responseXML = twiml.toString();
    const requestEndTime = Date.now();
    logger.debug(`[TWILIO TIMING] Sending response at: ${new Date().toISOString()}`);
    logger.debug(`[TWILIO TIMING] Total processing time: ${requestEndTime - requestStartTime}ms`);
    logger.debug(`[TWILIO TIMING] Response XML length: ${responseXML.length} characters`);
    logger.debug(`[CONFIDENCE SUMMARY] Successfully processed speech with confidence ${confidence} (threshold: ${threshold})`);
    logger.debug(`[SPEECH COMPLETE] [OK] Speech processing completed in ${requestEndTime - requestStartTime}ms`);
    res.send(responseXML);
  } catch (err) {
    logger.error(`[SPEECH ERROR] [ERROR] Speech processing failed: ${err.message}`);
    logger.error('[POST /api/twilio/handle-speech] Error:', err.message, err.stack);
    const twiml = new twilio.twiml.VoiceResponse();
    // Legacy personality system removed - using configuration error message
    const msg = 'Configuration error: Company must configure AI Agent Logic responses';
    const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
    twiml.hangup();
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
  }
});

// Partial speech results for faster response (experimental)
router.post('/partial-speech', async (req, res) => {
  logger.debug(`[PARTIAL SPEECH] Received at: ${new Date().toISOString()}`);
  logger.debug(`[PARTIAL SPEECH] Partial result: "${req.body.SpeechResult}" (Stability: ${req.body.Stability})`);
  
  // Just acknowledge - we'll process the final result
  res.status(200).send('OK');
});

// Diagnostic endpoint to measure exact Twilio speech timing
router.post('/speech-timing-test', async (req, res) => {
  const receiveTime = Date.now();
  logger.info(`[DIAGNOSTIC] Speech timing test received at: ${new Date().toISOString()}`);
  logger.info(`[DIAGNOSTIC] Twilio body:`, req.body);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Immediate response with timing info
  twiml.say(`Speech received at ${new Date().toLocaleTimeString()}. Processing took ${Date.now() - receiveTime} milliseconds.`);
  
  const respondTime = Date.now();
  logger.debug(`[DIAGNOSTIC] Responding at: ${new Date().toISOString()}`);
  logger.debug(`[DIAGNOSTIC] Total processing: ${respondTime - receiveTime}ms`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Polling endpoint removed - now processing synchronously

// Direct audio serving endpoint for faster delivery
router.get('/audio/:type/:callSid', async (req, res) => {
  try {
    const { type, callSid } = req.params;
    const audioKey = `audio:${type}:${callSid}`;
    
    const redisClient = await getRedis();
    const audioBase64 = redisClient ? await redisClient.get(audioKey) : null;
    if (!audioBase64) {
      return res.status(404).send('Audio not found');
    }
    
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    // Set optimal headers for Twilio
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex'
    });
    
    res.send(audioBuffer);
  } catch (err) {
    logger.error('[AUDIO ENDPOINT] Error:', err);
    res.status(500).send('Audio service error');
  }
});

// 🎛️ AGENT PERFORMANCE CONTROLS - LIVE TUNING DASHBOARD
// These values come from company.aiSettings - adjust via UI, not code
// For optimization: use company profile → AI Voice Settings → Agent Performance Controls
// NO HARDCODING - all tuning happens through the live dashboard

// Add company-specific voice endpoint for Blueprint compliance
router.post('/voice/:companyID', async (req, res) => {
  const callStartTime = Date.now();
  const { companyID } = req.params;
  
  // 🚨 HIGH-VISIBILITY LOG: This route should be deprecated - watch for traffic
  logger.warn('⚠️ [TWILIO] DEPRECATED ROUTE USED: /voice/:companyID', {
    companyId: companyID,
    fromNumber: req.body.From,
    toNumber: req.body.To,
    callSid: req.body.CallSid,
    timestamp: new Date().toISOString(),
    message: 'This route is deprecated. If you see this log, investigate why traffic is still using this endpoint.'
  });
  
  // 🚨 CRITICAL CHECKPOINT: Log EVERYTHING at company-specific webhook entry
  logger.info('='.repeat(80));
  logger.info(`🚨 COMPANY WEBHOOK HIT: /api/twilio/voice/${companyID} at ${new Date().toISOString()}`);
  logger.info(`🚨 FULL REQUEST BODY:`, JSON.stringify(req.body, null, 2));
  logger.info(`🚨 HEADERS:`, JSON.stringify(req.headers, null, 2));
  logger.info(`🚨 URL:`, req.url);
  logger.info(`🚨 METHOD:`, req.method);
  logger.debug(`🚨 IP:`, req.ip || req.connection.remoteAddress);
  logger.debug('='.repeat(80));
  
  logger.debug(`[AI AGENT VOICE] [CALL] New call for company ${companyID} at: ${new Date().toISOString()}`);
  logger.debug(`[AI AGENT DEBUG] From: ${req.body.From} → CallSid: ${req.body.CallSid}`);
  
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Normalize phone numbers
    const callerNumber = normalizePhoneNumber(req.body.From);
    const calledNumber = normalizePhoneNumber(req.body.To);
    
    // Load company by ID
    const company = await Company.findById(companyID);
    if (!company) {
      logger.error(`[ERROR] Company not found: ${companyID}`);
      
      // 🚨 CRITICAL ALERT: Send to Notification Center
      await AdminNotificationService.sendAlert({
        code: 'TWILIO_COMPANY_NOT_FOUND',
        severity: 'CRITICAL',
        companyId: companyID,
        companyName: `Company ${companyID}`,
        message: `🔴 CRITICAL: Twilio call failed - Company ${companyID} not found in database`,
        details: {
          endpoint: `/api/twilio/voice/${companyID}`,
          callSid: req.body.CallSid,
          from: req.body.From,
          to: req.body.To,
          error: `Company ${companyID} does not exist in database`,
          impact: 'Caller hears error message and call disconnects. All calls to this company fail.',
          action: 'Check if company was deleted, verify Twilio webhook URL, ensure company exists in database.',
          timestamp: new Date().toISOString()
        }
      }).catch(notifErr => logger.error('Failed to send company not found alert:', notifErr));
      
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      const companyNotFoundResponse = `Configuration error: Company ${companyID} not found. Each company must be properly configured in the platform.`;
      twiml.say(companyNotFoundResponse);
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    logger.info(`[AI AGENT COMPANY] ${company.businessName || company.companyName} (ID: ${companyID})`);
    
    // 🚫 SPAM FILTER - SECURED 2025-11-27
    // This deprecated route was bypassing spam filter - now secured with same logic as /voice
    const SmartCallFilter = require('../services/SmartCallFilter');
    const filterResult = await SmartCallFilter.checkCall({
      callerPhone: callerNumber,
      companyId: company._id.toString(),
      companyPhone: calledNumber,
      twilioCallSid: req.body.CallSid
    });
    
    // 📊 STRUCTURED SPAM LOG - For traceability
    logger.info('[SPAM-FIREWALL] decision', {
      route: '/voice/:companyID',
      companyId: company._id.toString(),
      fromNumber: callerNumber,
      toNumber: calledNumber,
      decision: filterResult.shouldBlock ? 'BLOCK' : 'ALLOW',
      reason: filterResult.reason || null,
      spamScore: filterResult.spamScore || 0,
      spamFlags: filterResult.flags || [],
      callSid: req.body.CallSid,
      timestamp: new Date().toISOString()
    });

    if (filterResult.shouldBlock) {
      logger.security(`🚫 [SPAM BLOCKED] Call from ${callerNumber} blocked on deprecated route. Reason: ${filterResult.reason}`);
      
      // Play rejection message and hangup
      twiml.say('This call has been blocked. Goodbye.');
      twiml.hangup();
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    logger.security(`✅ [SPAM FILTER] Call from ${callerNumber} passed all security checks on deprecated route`);
    
    // ────────────────────────────────────────────────────────────────
    // 🛡️ SPAM CONTEXT: Attach spam data to session for edge case bridge
    // ────────────────────────────────────────────────────────────────
    const spamContext = {
      spamScore: filterResult.spamScore || 0,
      spamReason: filterResult.reason || null,
      spamFlags: filterResult.flags || []
    };
    
    req.session = req.session || {};
    req.session.spamContext = spamContext;
    
    // ☠️ REMOVED: aiAgentSettings.enabled block (legacy nuked 2025-11-20)
    // This endpoint is now deprecated - V2 Agent handles all calls via /v2-agent-init/
    // NOTE: This route returns empty TwiML - if still in use, needs full implementation
    
    const twimlString = twiml.toString();
    logger.info('📤 CHECKPOINT 10: Sending final TwiML response');
    logger.info('📋 COMPLETE TwiML CONTENT:');
    logger.info(twimlString);
    logger.info('🚨 CRITICAL: If a "woman takes over" after this TwiML, it\'s NOT our code!');
    
    res.type('text/xml');
    res.send(twimlString);
    
  } catch (error) {
    logger.error(`[ERROR] AI Agent Voice error for company ${companyID}:`, error);
    
    // 🚨 CRITICAL ALERT: Send to Notification Center
    await AdminNotificationService.sendAlert({
      code: 'TWILIO_WEBHOOK_ERROR',
      severity: 'CRITICAL',
      companyId: companyID,
      companyName: `Company ${companyID}`,
      message: `🔴 CRITICAL: Twilio webhook /voice/${companyID} crashed`,
      details: {
        endpoint: `/api/twilio/voice/${companyID}`,
        callSid: req.body?.CallSid,
        from: req.body?.From,
        to: req.body?.To,
        error: error.message,
        stack: error.stack,
        impact: 'Caller hears error message and call disconnects. All incoming calls to this company fail until resolved.',
        action: 'Check error logs, verify company configuration, ensure AI Agent Logic is properly configured, check database connectivity.',
        timestamp: new Date().toISOString()
      },
      stackTrace: error.stack
    }).catch(notifErr => logger.error('Failed to send webhook error alert:', notifErr));
    
    const twiml = new twilio.twiml.VoiceResponse();
    // Use configurable response instead of hardcoded message [[memory:8276820]]
    const voiceErrorResponse = `Configuration error: Company ${companyID} must configure voice error responses in AI Agent Logic. Each company must have their own protocol.`;
    twiml.say(voiceErrorResponse);
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// V2 AI Agent response handler - NEW SYSTEM
router.post('/v2-agent-respond/:companyID', async (req, res) => {
  // ════════════════════════════════════════════════════════════════════════════════
  // 🚨🚨🚨 CRITICAL ENTRY POINT - v2-agent-respond HIT 🚨🚨🚨
  // ════════════════════════════════════════════════════════════════════════════════
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('🚨🚨🚨 [v2-agent-respond] ENDPOINT HIT! Twilio Gather COMPLETED! 🚨🚨🚨');
  console.log('Timestamp:', new Date().toISOString());
  console.log('CallSid:', req.body.CallSid);
  console.log('SpeechResult:', req.body.SpeechResult);
  console.log('Confidence:', req.body.Confidence);
  console.log('From:', req.body.From);
  console.log('════════════════════════════════════════════════════════════════════════════════');
  
  const callSid = req.body.CallSid || 'UNKNOWN';
  const fromNumber = req.body.From || 'UNKNOWN';
  let speechResult = req.body.SpeechResult || '';
  const rawSpeechResult = speechResult; // Keep original for logging
  const { companyID } = req.params;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // V86 P2: ACCURATE GATHER_TIMEOUT LOGGING
  // ═══════════════════════════════════════════════════════════════════════════
  // This is the REAL timeout - when Twilio's Gather completes with NO speech.
  // Previously this was logged prematurely in TwiML building.
  // ═══════════════════════════════════════════════════════════════════════════
  if (!speechResult || speechResult.trim().length === 0) {
    logger.info('[TWILIO GATHER] Real timeout - no caller speech detected');
    
    if (BlackBoxLogger) {
      BlackBoxLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'GATHER_TIMEOUT_ACTUAL',
        data: {
          reason: 'Twilio Gather completed with no speech',
          confidence: req.body.Confidence,
          timestamp: new Date().toISOString()
        }
      }).catch(() => {});
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 V111: CONVERSATION MEMORY - Initialize/Load Runtime Truth
  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 0: Visibility only - parallel logging without behavior change
  // This captures the turn lifecycle for debugging and analysis
  // ═══════════════════════════════════════════════════════════════════════════
  let v111Memory = null;
  let v111TurnNumber = 0;
  try {
    if (ConversationMemory && callSid && companyID) {
      v111Memory = await ConversationMemory.loadOrCreate({
        callId: callSid,
        companyId: companyID,
        callerPhone: fromNumber
      });
      v111TurnNumber = v111Memory.turns.length;
      v111Memory.startTurn(v111TurnNumber);
      logger.debug('[V111] 📊 ConversationMemory active', { 
        callSid, 
        turn: v111TurnNumber,
        existingTurns: v111Memory.turns.length 
      });
    }
  } catch (v111Err) {
    logger.debug('[V111] ConversationMemory init failed (non-fatal)', { error: v111Err.message });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 🎤 STT INTELLIGENCE - Apply preprocessing (fillers, corrections, impossible)
  // ═══════════════════════════════════════════════════════════════════════════
  // This is where the STT Intelligence UI settings actually get applied!
  // - Strips filler words: "um", "uh", "like"
  // - Applies corrections: "a c" -> "AC", "thermal stat" -> "thermostat"
  // - Detects impossible words (suggests additions to STT profile)
  // ═══════════════════════════════════════════════════════════════════════════
  let sttProcessResult = null;
  try {
    // Get template ID for this company
    // 📛 FEB 2026 FIX: Renamed to sttCompany to avoid TDZ conflict with outer `let company` at line ~2846
    // The original `const company` here caused ReferenceError: Cannot access 'company' before initialization
    const sttCompany = await Company.findById(companyID).select('aiAgentSettings.templateReferences aiAgentSettings.llm0Controls.recoveryMessages aiAgentSettings.frontDeskBehavior.sttProtectedWords').lean();
    const templateId = sttCompany?.aiAgentSettings?.templateReferences?.[0]?.templateId;
    
    if (templateId && speechResult) {
      // V111: Pass company-configured protected words from UI
      const companyProtectedWords = sttCompany?.aiAgentSettings?.frontDeskBehavior?.sttProtectedWords || [];
      sttProcessResult = await STTPreprocessor.process(speechResult, templateId, {
        callId: callSid,
        companyId: companyID,
        companyProtectedWords
      });
      
      // Use cleaned speech for all subsequent processing
      if (sttProcessResult.cleaned && sttProcessResult.cleaned !== speechResult) {
        speechResult = sttProcessResult.cleaned;
        
        logger.info('[STT INTELLIGENCE] 🎤 Preprocessing applied', {
          callSid,
          companyId: companyID,
          raw: rawSpeechResult.substring(0, 100),
          cleaned: speechResult.substring(0, 100),
          fillersRemoved: sttProcessResult.metrics.fillerCount,
          correctionsApplied: sttProcessResult.metrics.correctionCount,
          processingTimeMs: sttProcessResult.metrics.processingTimeMs
        });
      }
      
      // 📼 BLACK BOX: Log STT preprocessing results
      if (BlackBoxLogger && (sttProcessResult.metrics.fillerCount > 0 || sttProcessResult.metrics.correctionCount > 0)) {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'STT_PREPROCESSING',
          data: {
            raw: rawSpeechResult.substring(0, 200),
            cleaned: speechResult.substring(0, 200),
            fillersRemoved: sttProcessResult.transformations.fillersRemoved,
            correctionsApplied: sttProcessResult.transformations.correctionsApplied,
            impossibleDetected: sttProcessResult.transformations.impossibleWordsDetected,
            processingTimeMs: sttProcessResult.metrics.processingTimeMs
          }
        }).catch(() => {});
      }
      
      // 💡 Save any suggestions detected during STT processing (async, don't block)
      if (sttProcessResult.suggestions && sttProcessResult.suggestions.length > 0 && templateId) {
        Promise.all(sttProcessResult.suggestions.map(suggestion => 
          STTPreprocessor.addSuggestion(templateId, suggestion, callSid)
        )).catch(err => {
          logger.debug('[STT INTELLIGENCE] Failed to save suggestions', { error: err.message });
        });
        
        logger.info('[STT INTELLIGENCE] 💡 Detected suggestions for review', {
          callSid,
          suggestionCount: sttProcessResult.suggestions.length,
          types: sttProcessResult.suggestions.map(s => s.type)
        });
      }
    }
  } catch (sttErr) {
    logger.warn('[STT INTELLIGENCE] Preprocessing failed - using raw speech', {
      callSid,
      error: sttErr.message
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 V111: Log STT result to ConversationMemory
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    if (v111Memory && v111Memory._currentTurnBuilder) {
      v111Memory.addSTTResult(rawSpeechResult, speechResult, sttProcessResult);
      logger.debug('[V111] 📊 STT result captured', { 
        callSid, 
        turn: v111TurnNumber,
        hasSTTOps: !!(sttProcessResult?.transformations)
      });
    }
  } catch (v111Err) {
    logger.debug('[V111] STT capture failed (non-fatal)', { error: v111Err.message });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛡️ TURN IDEMPOTENCY (Twilio retry-safe)
  // ═══════════════════════════════════════════════════════════════════════════
  // Twilio will retry webhook calls if it doesn't receive a timely 200 OK.
  // Without idempotency, we can accidentally:
  // - increment turnCount twice
  // - double-log transcripts
  // - double-write KPI/end-call markers
  //
  // Strategy:
  // - Compute a deterministic fingerprint from request payload
  // - If we already cached the TwiML response for this fingerprint, return it immediately
  const normalizeSpeechForIdem = (t) => (t || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  const idemPayload = {
    v: 'twilio_v2_agent_respond_v1',
    companyID,
    callSid,
    from: fromNumber,
    to: req.body.To || null,
    digits: req.body.Digits || null,
    speech: normalizeSpeechForIdem(speechResult),
    confidence: req.body.Confidence || null
  };
  const turnFingerprint = crypto.createHash('sha1').update(JSON.stringify(idemPayload)).digest('hex');
  const turnCacheKey = `twilio:idem:v2-agent-respond:${companyID}:${callSid}:${turnFingerprint}`;

  try {
    const redisClient = await getRedis();
    if (redisClient) {
      const cachedTwiml = await redisClient.get(turnCacheKey);
      if (cachedTwiml && typeof cachedTwiml === 'string' && cachedTwiml.includes('<Response')) {
        logger.warn('[TWILIO IDEMPOTENCY] Returning cached TwiML for retry', {
          companyId: companyID,
          callSid,
          fingerprint: turnFingerprint.slice(0, 10),
          speechPreview: normalizeSpeechForIdem(speechResult).substring(0, 60)
        });
        res.type('text/xml');
        return res.send(cachedTwiml);
      }
    }
  } catch (idemErr) {
    logger.warn('[TWILIO IDEMPOTENCY] Cache check failed (non-fatal)', {
      callSid,
      error: idemErr.message
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 CALL FLOW TRACER - Track this turn
  // ═══════════════════════════════════════════════════════════════════════════
  const tracer = getTracer(callSid, companyID, fromNumber);
  tracer.newTurn(speechResult);
  tracer.step('SPEECH_RECEIVED', `Twilio delivered speech: "${speechResult?.substring(0, 40)}..."`, {
    confidence: req.body.Confidence,
    speechLength: speechResult?.length
  });
  
  try {
    const { companyID } = req.params;
    
    // 📊 STRUCTURED LOG 1: Agent Input
    logger.info('[AGENT-INPUT]', {
      companyId: companyID,
      callSid,
      fromNumber,
      toNumber: req.body.To || null,
      speechResult,
      confidence: req.body.Confidence || null,
      timestamp: new Date().toISOString()
    });
    
    // 📼 BLACK BOX: Log caller speech
    const turnCount = (req.session?.callState?.turnCount || 0) + 1;
    if (BlackBoxLogger) {
      BlackBoxLogger.QuickLog.gatherFinal(
        callSid,
        companyID,
        turnCount,
        speechResult,
        parseFloat(req.body.Confidence) || 0
      ).catch(() => {});
      
      // Also add to transcript
      BlackBoxLogger.addTranscript({
        callId: callSid,
        companyId: companyID,
        speaker: 'caller',
        turn: turnCount,
        text: speechResult,
        confidence: parseFloat(req.body.Confidence) || 0
      }).catch(() => {});
    }
    
    logger.debug('🎯 CHECKPOINT 12: Processing AI Agent Response');
    logger.debug(`🏢 Company ID: ${companyID}`);
    
    // V2 DELETED: Legacy aiAgentRuntime - replaced with v2AIAgentRuntime
    // const { processCallTurn } = require('../services/aiAgentRuntime');
    
    // 🎯 PERFORMANCE TRACKING: Start timing
    const perfStart = Date.now();
    const perfCheckpoints = { requestReceived: 0 };
    
    logger.security('🎯 CHECKPOINT 13: Initializing call state');
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🔒 CRITICAL: Load call state from Redis (NOT express-session)
    // ════════════════════════════════════════════════════════════════════════════
    // Express-session with MemoryStore + sameSite:lax FAILS for Twilio webhooks!
    // Twilio makes cross-origin POST requests, and cookies may not persist.
    // Redis-based state keyed by CallSid is 100% reliable.
    // ════════════════════════════════════════════════════════════════════════════
    let callState;
    let stateLoadSource = 'FRESH';  // Track where state came from
    let redisLoadError = null;
    
    try {
      const { getSharedRedisClient } = require('../services/redisClientFactory');
      const redisClient = await getSharedRedisClient();
      
      if (redisClient) {
        const stateKey = `callState:${callSid}`;
        const savedState = await redisClient.get(stateKey);
        
        if (savedState) {
          callState = JSON.parse(savedState);
          stateLoadSource = 'REDIS';
          logger.info('[CALL STATE] 🔒 Loaded from Redis', {
            callSid,
            bookingModeLocked: !!callState.bookingModeLocked,
            bookingState: callState.bookingState,
            turnCount: callState.turnCount
          });
        } else {
          stateLoadSource = 'REDIS_EMPTY';
        }
      } else {
        stateLoadSource = 'REDIS_NULL_CLIENT';
      }
    } catch (redisErr) {
      stateLoadSource = 'REDIS_ERROR';
      redisLoadError = redisErr.message;
      logger.warn('[CALL STATE] Redis load failed, using session fallback', { 
        callSid, 
        error: redisErr.message 
      });
    }
    
    // Fallback to session or create fresh state
    if (!callState) {
      if (req.session?.callState) {
        callState = req.session.callState;
        stateLoadSource = stateLoadSource === 'FRESH' ? 'SESSION' : stateLoadSource + '_SESSION_FALLBACK';
      } else {
        callState = {
          callId: callSid,
          from: fromNumber,
          consecutiveSilences: 0,
          failedAttempts: 0,
          startTime: new Date(),
          turnCount: 0,
          // V98 FIX: Initialize awHash from session (set in /voice route)
          // This ensures awHash is available from Turn 1, not null
          awHash: req.session?.awHash || null,
          effectiveConfigVersion: req.session?.effectiveConfigVersion || null,
          traceRunId: req.session?.traceRunId || `tr-${callSid || Date.now()}`
        };
      }
    }

    // Increment turn count
    callState.turnCount = (callState.turnCount || 0) + 1;
    
    // 📼 BLACK BOX: Log state load for diagnostics (visible in JSON!)
    if (BlackBoxLogger) {
      BlackBoxLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'STATE_LOADED',
        turn: callState.turnCount,
        data: {
          source: stateLoadSource,
          error: redisLoadError,
          bookingModeLocked: !!callState.bookingModeLocked,
          bookingState: callState.bookingState || null,
          currentBookingStep: callState.currentBookingStep || null,
          turnCount: callState.turnCount
        }
      }).catch(() => {});
    }
    
    // ────────────────────────────────────────────────────────────────
    // 🛡️ SPAM CONTEXT: Pass spam data into agent brain
    // ────────────────────────────────────────────────────────────────
    // This allows CheatSheetEngine to enforce minSpamScore thresholds
    // in edge case matching (spam → edge case bridge).
    if (req.session?.spamContext) {
      callState.spamContext = req.session.spamContext;
      logger.debug('[SPAM BRIDGE] Spam context attached to callState', {
        spamScore: callState.spamContext.spamScore,
        spamReason: callState.spamContext.spamReason
      });
    }
    
    // ────────────────────────────────────────────────────────────────
    // 👤 CALL CENTER V2: Pass caller identity context to AI Brain
    // ────────────────────────────────────────────────────────────────
    // Customer: enables personalization and smarter booking.
    // Vendor: prevents customer-directory pollution and enables vendor protocols.
    if (req.session?.callCenterContext?.customerContext) {
      callState.customerContext = req.session.callCenterContext.customerContext;
      callState.customerId = req.session.callCenterContext.customerId;
      callState.isReturning = req.session.callCenterContext.isReturning;
      callState.callSummaryId = req.session.callCenterContext.callId;
      callState.callerType = req.session.callCenterContext.callerType || 'customer';
      
      logger.info('[CALL CENTER] Customer context attached to callState', {
        callSid,
        isReturning: callState.isReturning,
        customerName: callState.customerContext?.customerName || null,
        customerId: callState.customerId
      });
    } else if (req.session?.callCenterContext?.callerType === 'vendor') {
      callState.callerType = 'vendor';
      callState.vendorId = req.session.callCenterContext.vendorId || null;
      callState.vendorContext = req.session.callCenterContext.vendorContext || null;
      callState.callSummaryId = req.session.callCenterContext.callId || null;

      logger.info('[CALL CENTER] Vendor context attached to callState', {
        callSid,
        vendorId: callState.vendorId,
        vendorName: callState.vendorContext?.vendorName || null
      });
    }
    
    perfCheckpoints.callStateInit = Date.now() - perfStart;
    
    // ========================================================================
    // 🧠 LLM-0 ORCHESTRATION LAYER (NEW - BRAIN 1)
    // ========================================================================
    // Check if LLM-0 is enabled for this company/globally
    // LLM-0 decides the ACTION, then routes to 3-Tier (Brain 2) if needed
    // ========================================================================
    
    const aiProcessStart = Date.now();
    let result;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 🏢 OUTER SCOPE VARIABLES (Feb 2026 Fix)
    // ═══════════════════════════════════════════════════════════════════════════
    // These variables must be in outer scope so:
    // 1. Error handlers can access them for recovery messages
    // 2. TURN_TRACE can access them after the try/catch
    // Previously declared inside try block, causing "X is not defined" errors.
    // ═══════════════════════════════════════════════════════════════════════════
    let company = null;
    let slotsBefore = {};
    let slotKeysBefore = [];
    let extractedSlots = {};
    let slotMergeDecisions = [];  // V96i: Declare at outer scope so trace code can access it
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96h: TURN_DECISION_TRACE_V1 - Mode & ownership tracking
    // ═══════════════════════════════════════════════════════════════════════════
    // Capture state BEFORE any processing for accurate before/after comparison.
    // This is the "single pane of glass" for debugging turn decisions.
    // ═══════════════════════════════════════════════════════════════════════════
    let modeBefore = callState?.sessionMode || 'DISCOVERY';
    let bookingModeLockedBefore = callState?.bookingModeLocked === true;
    let modeOwner = 'UNKNOWN';  // Will be set based on which responder handles the turn
    let ownerGateApplied = false;
    let ownerBypassedReason = null;
    let configProvenanceReads = {};  // Track resolvedFrom for critical configs
    let turnAwReader = null;  // V96h: Outer-scope AWConfigReader for trace
    
    try {
      // Load company and check LLM-0 feature flag
      company = await Company.findById(companyID).lean();
      
      // ═══════════════════════════════════════════════════════════════════════════
      // 🛡️ FEB 2026 FIX: HARD GUARD - Company must exist before proceeding
      // ═══════════════════════════════════════════════════════════════════════════
      // Without this guard, downstream code crashes with TDZ errors or null refs.
      // If company is null, log error and return safe recovery (NOT auto-transfer).
      // ═══════════════════════════════════════════════════════════════════════════
      if (!company) {
        logger.error('[PIPELINE ERROR] Company not found - cannot process turn', {
          companyId: companyID,
          callSid,
          speechResult: speechResult?.substring(0, 100)
        });
        
        // 📼 BLACK BOX: Log the critical error
        if (BlackBoxLogger) {
          await BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'PIPELINE_ERROR',
            data: {
              error: 'Company not found in database',
              errorType: 'COMPANY_NOT_FOUND',
              phase: 'v2-agent-respond-company-load',
              speechResult: speechResult?.substring(0, 200),
              recovery: 'SAFE_RETRY_PROMPT'
            }
          }).catch(() => {});
        }
        
        // Return a safe retry prompt - NOT "connecting you to our team" (that requires transfer config)
        const twiml = new twilio.twiml.VoiceResponse();
        const safeRecovery = "I'm sorry, I didn't quite catch that. Could you please say that again?";
        twiml.say(safeRecovery);
        
        // Set up gather to let caller retry
        const gather = twiml.gather({
          input: 'speech',
          action: `/api/twilio/v2-agent-respond/${companyID}`,
          method: 'POST',
          timeout: 5,
          speechTimeout: '3',
          speechModel: 'phone_call'
        });
        gather.say('');
        
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // V94: Ensure single call identity (traceRunId + awHash) across all events
      // ═══════════════════════════════════════════════════════════════════════════
      const awProofForTurn = computeAwProof(company);
      const traceRunIdForTurn = callState.traceRunId || `tr-${callSid || Date.now()}`;
      
      // ═══════════════════════════════════════════════════════════════════════════
      // 📊 V111 Phase 3: Load Config from Company Settings
      // ═══════════════════════════════════════════════════════════════════════════
      // Now that company is loaded, we can set the V111 config on ConversationMemory.
      // This enables config-driven governance (handler rules, capture goals, etc.)
      // Config comes from: company.aiAgentSettings.frontDeskBehavior.conversationMemory
      // ═══════════════════════════════════════════════════════════════════════════
      try {
        if (v111Memory) {
          const v111Config = company?.aiAgentSettings?.frontDeskBehavior?.conversationMemory;
          if (v111Config) {
            v111Memory.setConfig(v111Config);
            logger.debug('[V111] 🎛️ Config loaded from company settings', { 
              callSid,
              v111Enabled: v111Config.enabled,
              mustCapture: v111Config.captureGoals?.must?.fields,
              shouldCapture: v111Config.captureGoals?.should?.fields
            });
          } else {
            logger.debug('[V111] No V111 config in company settings, using defaults', { callSid });
          }
        }
      } catch (v111ConfigErr) {
        // Config loading errors are non-fatal
        logger.debug('[V111] Config loading failed (non-fatal)', { 
          error: v111ConfigErr.message, 
          callSid 
        });
      }
      callState.traceRunId = traceRunIdForTurn;
      callState.awHash = callState.awHash || awProofForTurn.awHash;
      callState.effectiveConfigVersion = callState.effectiveConfigVersion || awProofForTurn.effectiveConfigVersion;
      
      // ═══════════════════════════════════════════════════════════════════════════
      // V99: CONTROL_PLANE_HEADER - Platform Law Enforcement
      // ═══════════════════════════════════════════════════════════════════════════
      // IF IT'S NOT IN FRONT DESK UI, IT DOES NOT EXIST.
      // Every turn validates config against contract and logs header.
      // If controlPlaneLoaded=false → fail closed (safe escalation).
      // ═══════════════════════════════════════════════════════════════════════════
      const controlPlaneLoaded = !!(callState.awHash && callState.effectiveConfigVersion);
      
      // V99: Initialize decision trace for this turn
      if (ControlPlaneEnforcer) {
        ControlPlaneEnforcer.getTrace(callSid, callState.turnCount);
      }
      
      // V99: Build enhanced header with contract validation
      let controlPlaneHeader;
      if (ControlPlaneEnforcer && company?.aiAgentSettings) {
        controlPlaneHeader = ControlPlaneEnforcer.buildControlPlaneHeader(
          company.aiAgentSettings,
          callState.awHash,
          callState.effectiveConfigVersion,
          callSid,
          companyID  // V102: Pass companyId explicitly
        );
      } else {
        controlPlaneHeader = {
          companyId: companyID,
          awHash: callState.awHash || null,
          effectiveConfigVersion: callState.effectiveConfigVersion || null,
          controlPlaneLoaded,
          resolvedFrom: controlPlaneLoaded ? 'controlPlane' : 'FAILED',
          contractVersion: 'unknown',
          enforcementMode: 'unknown'
        };
      }
      
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'CONTROL_PLANE_HEADER',
          turn: callState.turnCount,
          data: {
            ...controlPlaneHeader,
            traceRunId: callState.traceRunId,
            bookingModeLocked: !!callState.bookingModeLocked,
            consentPending: !!callState.bookingConsentPending,
            sessionMode: callState.sessionMode || 'DISCOVERY',
            bookingPatternsSource: controlPlaneLoaded ? 'controlPlane' : 'globalDefaults'
          }
        }).catch(() => {});
      }
      
      // V100: Fail closed if Control Plane not loaded and strict mode enabled
      // Check both enforcement.level and strictControlPlaneOnly for backward compatibility
      const enforcementLevel = company?.aiAgentSettings?.frontDesk?.enforcement?.level;
      const strictControlPlaneOnly = company?.aiAgentSettings?.frontDesk?.enforcement?.strictControlPlaneOnly;
      const strictMode = enforcementLevel === 'strict' || (strictControlPlaneOnly === true && enforcementLevel !== 'warn');
      
      if (!controlPlaneLoaded && strictMode) {
        logger.error('[V2TWILIO] CONTROL_PLANE_LOAD_FAILED - Fail closed', {
          callId: callSid,
          companyId: companyID,
          awHash: callState.awHash,
          effectiveConfigVersion: callState.effectiveConfigVersion
        });
        
        if (BlackBoxLogger) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'CONTROL_PLANE_LOAD_FAILED',
            turn: callState.turnCount,
            data: { reason: 'strictMode=true, config not loaded' }
          }).catch(() => {});
        }
        
        // Safe escalation response
        const failResponse = ControlPlaneEnforcer?.getFailClosedResponse?.('CONTROL_PLANE_LOAD_FAILED');
        const safeResponse = failResponse?.response || 
          "I apologize, but I'm having a technical issue. Let me connect you with someone who can help.";
        
        // Return safe response instead of continuing
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'Polly.Joanna' }, safeResponse);
        twiml.redirect('/twilio/transfer-to-agent');
        return res.type('text/xml').send(twiml.toString());
      }
      
      const adminSettings = await AdminSettings.findOne({}).lean();
      
      // 🧠 LOAD LLM-0 CONTROLS (Dec 2025) - Configurable brain behavior
      const LLM0ControlsLoader = require('../services/LLM0ControlsLoader');
      const llm0Controls = await LLM0ControlsLoader.load(companyID, company);
      callState.llm0Controls = llm0Controls;
      
      logger.debug('[LLM-0] Controls loaded for call', {
        callId: callSid,
        companyId: companyID,
        silenceThreshold: llm0Controls.silenceHandling.thresholdSeconds,
        spamPhraseCount: llm0Controls.spamFilter.telemarketerPhrases.length,
        neverAutoHangup: llm0Controls.customerPatience.neverAutoHangup
      });
      
      // ═══════════════════════════════════════════════════════════════════════════
      // 🎯 SLOT EXTRACTION (Feb 2026) - RUNS BEFORE ANY ROUTING
      // ═══════════════════════════════════════════════════════════════════════════
      // Extract slots from EVERY utterance, even in discovery mode.
      // This ensures we capture "Hi I'm Mark" and don't re-ask later.
      // Slots are persisted to Redis with confidence metadata.
      // ═══════════════════════════════════════════════════════════════════════════
      const { SlotExtractor } = require('../services/engine/booking');
      
      // Initialize slots from existing state or empty
      callState.slots = callState.slots || {};
      
      // ═══════════════════════════════════════════════════════════════════════════
      // 📊 TURN TRACE CHECKPOINT A: State loaded (capture BEFORE any changes)
      // ═══════════════════════════════════════════════════════════════════════════
      slotsBefore = JSON.parse(JSON.stringify(callState.slots || {}));
      slotKeysBefore = Object.keys(slotsBefore);
      
      // Extract slots from current utterance
      // FEB 2026 FIX: Pass confirmedSlots to gate extraction properly
      // V92 FIX: Pass bookingModeLocked and sessionMode to prevent premature time/address extraction
      extractedSlots = SlotExtractor.extractAll(speechResult, {
        turnCount: callState.turnCount || 1,
        callerPhone: fromNumber,
        existingSlots: callState.slots,
        company,
        expectingSlot: callState.currentBookingStep || null,
        currentBookingStep: callState.currentBookingStep || null,
        confirmedSlots: callState.confirmedSlots || {},
        // V92: Booking mode gating - prevents time/address extraction in discovery
        bookingModeLocked: callState.bookingModeLocked === true,
        sessionMode: callState.sessionMode || 'DISCOVERY'
      });
      
      // Merge new extractions with existing slots (with confidence rules)
      // V96g: Track merge decisions for turn trace
      // V96i FIX: slotMergeDecisions declared at outer scope (line ~2852)
      
      if (Object.keys(extractedSlots).length > 0) {
        const mergedSlots = SlotExtractor.mergeSlots(callState.slots, extractedSlots);
        
        // V96g: Extract merge decisions before assigning back
        slotMergeDecisions = mergedSlots._mergeDecisions || [];
        delete mergedSlots._mergeDecisions;  // Remove internal tracking property
        callState.slots = mergedSlots;
        
        // 📼 BLACK BOX: Log slot extraction with FULL merge decision trace
        // V96i: Wrapped in try/catch - tracing must NEVER crash the call
        try {
          if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'SLOTS_MERGED',
              turn: callState.turnCount,
              data: {
                extracted: Object.fromEntries(
                  Object.entries(extractedSlots || {}).map(([k, v]) => [k, { 
                    value: k === 'phone' ? '***MASKED***' : v?.value, 
                    confidence: v?.confidence, 
                    source: v?.source,
                    patternSource: v?.patternSource,
                    nameLocked: v?.nameLocked
                  }])
                ),
                mergeDecisions: slotMergeDecisions || [],  // V96g: Full audit trail
                totalSlots: Object.keys(callState.slots || {}).length,
                currentSlotValues: Object.fromEntries(
                  Object.entries(callState.slots || {})
                    .filter(([k]) => !k.startsWith('_'))  // Exclude internal keys
                    .map(([k, v]) => [k, {
                      value: k === 'phone' ? '***MASKED***' : v?.value,
                      confidence: v?.confidence,
                      confirmed: v?.confirmed,
                      immutable: v?.immutable,
                      nameLocked: v?.nameLocked
                    }])
                )
              }
            }).catch(() => {});
          }
        } catch (traceErr) {
          logger.warn('[TRACE ERROR] SLOTS_MERGED trace failed (call continues)', { error: traceErr.message });
        }
        
        logger.info('[SLOT EXTRACTOR] Slots extracted pre-routing', {
          callSid,
          turnCount: callState.turnCount,
          extracted: Object.keys(extractedSlots),
          totalSlots: Object.keys(callState.slots)
        });
      }
      
      // Also sync slots to bookingCollected for backward compatibility
      if (callState.slots && Object.keys(callState.slots).length > 0) {
        callState.bookingCollected = callState.bookingCollected || {};
        for (const [key, slot] of Object.entries(callState.slots)) {
          if (slot?.value && !callState.bookingCollected[key]) {
            callState.bookingCollected[key] = slot.value;
          }
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════════════════════
      // 🔒 V94 P0: ABSOLUTE BOOKING GATE - RUNS FIRST, NO EXCEPTIONS
      // ═══════════════════════════════════════════════════════════════════════════════════
      // If bookingModeLocked === true, run BookingFlowRunner IMMEDIATELY.
      // NOTHING ELSE RUNS FIRST:
      // - No ConversationEngine
      // - No scenario matching
      // - No meta intent handlers
      // - No urgency detection
      // - No LLM fallback
      // 
      // This is the "clipboard takes over" moment. Once caller accepts booking,
      // they get the deterministic booking prompts, line by line, until complete.
      //
      // The old code had: if (bookingModeLocked && !result) - making booking a FALLBACK.
      // Now booking is a TOP-LEVEL GATE that cannot be bypassed.
      // ═══════════════════════════════════════════════════════════════════════════════════
      
      if (callState?.bookingModeLocked === true) {
        // 🔒 BOOKING GATE FIRED - Skip everything else
        
        // V96h: Track mode ownership for TURN_DECISION_TRACE_V1
        modeOwner = 'BOOKING_FLOW_RUNNER';
        ownerGateApplied = true;
        
        // Auto-init bookingFlowState if missing (prevents "lock evaporates" bug)
        if (!callState.bookingFlowState) {
          logger.warn('[BOOKING GATE] bookingModeLocked=true but bookingFlowState missing - auto-initializing', {
            callSid,
            turnCount: callState.turnCount
          });
          callState.bookingFlowState = {
            bookingModeLocked: true,
            bookingFlowId: 'auto_init_' + callSid,
            currentStepId: callState.currentBookingStep || 'name',
            bookingCollected: callState.bookingCollected || {},
            bookingState: 'ACTIVE',
            autoInitReason: 'MISSING_STATE_ON_LOCKED_TURN'
          };
        }
        
        try {
          const { BookingFlowRunner, BookingFlowResolver } = require('../services/engine/booking');
          
          tracer.step('BOOKING_GATE_ABSOLUTE', '🔒 BOOKING GATE: bookingModeLocked=true, running BookingFlowRunner FIRST');
          
          // 📼 BLACK BOX: Log checkpoint_booking_gate
          if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'CHECKPOINT_BOOKING_GATE',
              turn: callState.turnCount,
              data: {
                bookingModeLocked: true,
                bookingFlowStateExists: !!callState.bookingFlowState,
                currentStepId: callState.bookingFlowState?.currentStepId || callState.currentBookingStep,
                bookingCollectedKeys: Object.keys(callState.bookingCollected || {}),
                userText: (speechResult || '').substring(0, 100),
                gateResult: 'BOOKING_FLOW_RUNNER_WILL_EXECUTE'
              }
            }).catch(() => {});
          }
          
          // Resolve the booking flow from company config
          const flow = BookingFlowResolver.resolve({
            companyId: companyID,
            trade: callState.trade || null,
            serviceType: callState.serviceType || null,
            company
          });
          
          // Build state from Redis callState
          const bookingState = {
            bookingModeLocked: true,
            bookingFlowId: callState.bookingFlowId || flow.flowId,
            currentStepId: callState.currentStepId || callState.currentBookingStep || flow.steps[0]?.id,
            bookingCollected: callState.bookingCollected || {},
            slotMetadata: callState.slotMetadata || {},
            confirmedSlots: callState.confirmedSlots || {},
            askCount: callState.bookingAskCount || {},
            pendingConfirmation: callState.pendingConfirmation || null
          };
          
          // Create AWConfigReader for traced config reads
          // V96h: Also store in outer scope for TURN_DECISION_TRACE_V1
          let awReader = null;
          if (AWConfigReader && company) {
            try {
              awReader = AWConfigReader.forCall({
                callId: callSid,
                companyId: companyID,
                turn: callState.turnCount || 0,
                runtimeConfig: company,
                readerId: 'v2twilio.BookingGate',
                awHash: callState.awHash || null,
                traceRunId: callState.traceRunId || null
              });
              turnAwReader = awReader;  // V96h: Store in outer scope for trace
            } catch (awErr) {
              logger.warn('[BOOKING GATE] Failed to create AWConfigReader', { error: awErr.message });
            }
          }
          
          // Run booking flow
          const bookingResult = await BookingFlowRunner.runStep({
            flow,
            state: bookingState,
            userInput: speechResult,
            callSid,
            company,
            session: { _id: callSid, mode: 'BOOKING', collectedSlots: callState.slots || {} },
            awReader
          });
          
          // ═══════════════════════════════════════════════════════════════════════════
          // V110: GATE NEVER SPEAKS INVARIANT
          // ═══════════════════════════════════════════════════════════════════════════
          // CRITICAL: The gate must ONLY route to runner. It cannot generate text.
          // The reply must come from BookingFlowRunner with valid promptSource.
          // If bookingResult.debug.promptSource is missing, it's a violation.
          // ═══════════════════════════════════════════════════════════════════════════
          const runnerDebug = bookingResult.debug || {};
          const promptSource = runnerDebug.promptSource || runnerDebug.source;
          
          // ═══════════════════════════════════════════════════════════════════════════
          // V110: FAIL-CLOSED INVARIANT - Gate must never speak
          // ═══════════════════════════════════════════════════════════════════════════
          let gateViolationDetected = false;
          let originalReply = bookingResult.reply;
          
          // V110: Detect GATE_SPOKE_VIOLATION - prompt without proper source
          if (bookingResult.reply && !promptSource) {
            gateViolationDetected = true;
            logger.error('[BOOKING GATE] ❌ GATE_SPOKE_VIOLATION: Prompt returned without promptSource! CLEARING REPLY.', {
              callSid,
              turnCount: callState.turnCount,
              action: bookingResult.action,
              replyPreview: (bookingResult.reply || '').substring(0, 50),
              debug: runnerDebug,
              resolution: 'FAIL_CLOSED_CLEAR_REPLY'
            });
            
            // 📼 BLACK BOX: Log gate spoke violation
            if (BlackBoxLogger) {
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'GATE_SPOKE_VIOLATION',
                turn: callState.turnCount,
                data: {
                  violation: 'PROMPT_WITHOUT_SOURCE',
                  action: bookingResult.action,
                  replyLength: (bookingResult.reply || '').length,
                  debugKeys: Object.keys(runnerDebug),
                  resolution: 'FAIL_CLOSED'
                }
              }).catch(() => {});
            }
          }
          
          // V110: Detect ADDRESS_BREAKDOWN actions - these are banned
          if (bookingResult.action && bookingResult.action.includes('ADDRESS_BREAKDOWN')) {
            gateViolationDetected = true;
            logger.error('[BOOKING GATE] ❌ GATE_SPOKE_VIOLATION: ADDRESS_BREAKDOWN action detected! FORCING CONTINUE.', {
              callSid,
              turnCount: callState.turnCount,
              action: bookingResult.action,
              resolution: 'FAIL_CLOSED_FORCE_CONTINUE'
            });
            
            if (BlackBoxLogger) {
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'GATE_SPOKE_VIOLATION',
                turn: callState.turnCount,
                data: {
                  violation: 'ADDRESS_BREAKDOWN_ACTION',
                  action: bookingResult.action,
                  expected: 'CONTINUE',
                  resolution: 'FAIL_CLOSED'
                }
              }).catch(() => {});
            }
            
            // Force action to CONTINUE
            bookingResult.action = 'CONTINUE';
          }
          
          // V110: FAIL-CLOSED ENFORCEMENT
          // If violation detected, clear the reply and force transfer/escalation
          if (gateViolationDetected) {
            logger.warn('[BOOKING GATE] ⚠️ FAIL-CLOSED: Forcing transfer due to gate violation', {
              callSid,
              originalReply: (originalReply || '').substring(0, 50)
            });
            
            // Clear the tainted reply - gate violations must not produce user-facing text
            bookingResult.reply = null;
            bookingResult.action = 'ESCALATE';
            bookingResult.transferReason = 'GATE_SPOKE_VIOLATION_FAIL_CLOSED';
            bookingResult.requiresTransfer = true;
            
            // Add fail-closed marker to debug
            bookingResult.debug = {
              ...bookingResult.debug,
              gateViolation: true,
              failClosed: true,
              originalReply: (originalReply || '').substring(0, 100)
            };
          }
          
          // Map result to expected format
          result = {
            text: bookingResult.reply,
            response: bookingResult.reply,
            action: bookingResult.action === 'COMPLETE' ? 'COMPLETE' :
                    bookingResult.action === 'ESCALATE' ? 'transfer' : 'BOOKING',
            shouldTransfer: bookingResult.requiresTransfer === true,
            transferReason: bookingResult.transferReason || null,
            matchSource: bookingResult.matchSource || 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            callState: {
              ...callState,
              bookingModeLocked: bookingResult.state?.bookingModeLocked !== false,
              bookingFlowId: bookingResult.state?.bookingFlowId || flow.flowId,
              currentStepId: bookingResult.state?.currentStepId,
              currentBookingStep: bookingResult.state?.currentStepId,
              currentSlotId: bookingResult.state?.currentSlotId,  // V110: Add slotId
              slotSubStep: bookingResult.state?.slotSubStep,      // V110: Add sub-step
              bookingCollected: bookingResult.state?.bookingCollected || {},
              slotMetadata: bookingResult.state?.slotMetadata || callState.slotMetadata || {},
              confirmedSlots: bookingResult.state?.confirmedSlots || callState.confirmedSlots || {},
              lockedSlots: bookingResult.state?.lockedSlots || callState.lockedSlots || {},  // V110
              repromptCount: bookingResult.state?.repromptCount || {},  // V110
              bookingState: bookingResult.isComplete ? 'COMPLETE' : 'ACTIVE',
              bookingFlowState: {
                bookingModeLocked: bookingResult.state?.bookingModeLocked !== false,
                bookingFlowId: bookingResult.state?.bookingFlowId || flow.flowId,
                currentStepId: bookingResult.state?.currentStepId,
                currentSlotId: bookingResult.state?.currentSlotId,
                slotSubStep: bookingResult.state?.slotSubStep,
                bookingCollected: bookingResult.state?.bookingCollected || {},
                bookingState: bookingResult.isComplete ? 'COMPLETE' : 'ACTIVE'
              },
              slots: callState.slots || {}
            },
            debug: {
              mode: 'booking',
              // V110: Full prompt tracing
              source: 'BOOKING_FLOW_RUNNER',
              promptSource: promptSource,
              stepId: runnerDebug.step || bookingResult.state?.currentStepId,
              slotId: runnerDebug.slotId || bookingResult.state?.currentSlotId,
              slotSubStep: runnerDebug.slotSubStep || bookingResult.state?.slotSubStep,
              flowId: flow.flowId,
              currentStep: bookingResult.state?.currentStepId,
              isComplete: bookingResult.isComplete,
              gateType: 'ABSOLUTE_TOP_LEVEL',
              repromptCount: runnerDebug.repromptCount
            }
          };
          
          const bookingLatencyMs = Date.now() - (callState._gateStartTime || Date.now());
          
          // 📼 BLACK BOX: Log BOOKING_RUNNER_PROMPT - the runner spoke, not the gate
          // V110: GATE_SUCCESS no longer includes responsePreview (gate doesn't speak)
          if (BlackBoxLogger) {
            // Event 1: Gate routed successfully (no text)
            BlackBoxLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'BOOKING_GATE_ROUTED',  // V110: Renamed from BOOKING_GATE_SUCCESS
              turn: callState.turnCount,
              data: {
                latencyMs: bookingLatencyMs,
                routedTo: 'BOOKING_FLOW_RUNNER',
                isComplete: bookingResult.isComplete,
                bookingModeLocked: result.callState.bookingModeLocked
                // V110: NO responsePreview - gate doesn't speak
              }
            }).catch(() => {});
            
            // Event 2: Runner produced the prompt (with full tracing)
            BlackBoxLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'BOOKING_RUNNER_PROMPT',  // V110: New event - runner speaks
              turn: callState.turnCount,
              data: {
                action: bookingResult.action,
                stepId: runnerDebug.step || bookingResult.state?.currentStepId,
                slotId: runnerDebug.slotId || bookingResult.state?.currentSlotId,
                slotSubStep: runnerDebug.slotSubStep || null,
                promptSource: promptSource,
                repromptCount: runnerDebug.repromptCount || 0,
                responsePreview: (bookingResult.reply || '').substring(0, 100)  // Preview is on RUNNER event
              }
            }).catch(() => {});
          }
          
          logger.info('[BOOKING GATE] ✅ Gate routed to BookingFlowRunner', {
            callSid,
            turnCount: callState.turnCount,
            action: bookingResult.action,
            stepId: runnerDebug.step || bookingResult.state?.currentStepId,
            slotId: runnerDebug.slotId,
            slotSubStep: runnerDebug.slotSubStep,
            promptSource: promptSource,
            isComplete: bookingResult.isComplete,
            latencyMs: bookingLatencyMs
          });
          
          // ═══════════════════════════════════════════════════════════════════
          // V96j: BOOKING GATE HANDLED - Mark that we should skip all other processing
          // ═══════════════════════════════════════════════════════════════════
          // Set this flag so downstream code knows booking gate already responded.
          // This is defense-in-depth - the !result checks should work, but this
          // makes it explicit and traceable.
          // ═══════════════════════════════════════════════════════════════════
          callState._bookingGateHandled = true;
          
        } catch (bookingGateErr) {
          logger.error('[BOOKING GATE] ❌ BookingFlowRunner failed', {
            callSid,
            turnCount: callState.turnCount,
            error: bookingGateErr.message,
            stack: bookingGateErr.stack?.split('\n').slice(0, 3).join(' | ')
          });
          
          // 📼 BLACK BOX: Log booking gate failure
          if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'BOOKING_GATE_ERROR',
              turn: callState.turnCount,
              data: {
                error: bookingGateErr.message,
                stack: bookingGateErr.stack?.split('\n').slice(0, 3).join(' | ')
              }
            }).catch(() => {});
          }
          
          // On error, unlock booking to prevent infinite loop and fall through to ConversationEngine
          callState.bookingModeLocked = false;
          callState.bookingFlowState = null;
          // result stays null, will fall through to normal processing
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // 🧠 LLM-0 ENABLEMENT LOGIC (Dec 2025 Update)
      // ═══════════════════════════════════════════════════════════════════════════
      // LLM-0 ROUTING DECISION - ALWAYS USE LLM-0 FOR VOICE CALLS
      // ═══════════════════════════════════════════════════════════════════════════
      // The legacy path creates "split-brain" behavior where first turn is robotic
      // and subsequent turns are conversational. This confuses callers.
      // FIX: LLM-0 is now DEFAULT ON for all voice calls.
      // Only explicitly disabled for specific use cases (after-hours, DTMF menus)
      // ═══════════════════════════════════════════════════════════════════════════
      const bookingInProgress = callState?.bookingModeLocked === true || callState?.bookingState === 'ACTIVE';
      const routingPath = bookingInProgress ? 'BOOKING_FLOW_RUNNER' : 'HybridReceptionistLLM';
      
      // ═══════════════════════════════════════════════════════════════════════════
      // 🚀 LLM-0 IS NOW ALWAYS ON - Dec 2025 SIMPLIFICATION
      // ═══════════════════════════════════════════════════════════════════════════
      // The legacy path is DEAD. Every call uses HybridReceptionistLLM.
      // This gives: fast responses (<1.5s), smart conversation, name capture.
      // Only exception: after-hours voicemail mode.
      // ═══════════════════════════════════════════════════════════════════════════
      const afterHoursMode = company?.agentSettings?.afterHoursMode === true;
      const llm0Enabled = !afterHoursMode; // ON unless after-hours
      
      // 📼 BLACK BOX: Log routing decision
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'ROUTING_DECISION',
          turn: turnCount,
          data: {
            llm0Enabled,
            reason: afterHoursMode ? 'After-hours mode active' : 'LLM-0 ALWAYS ON (Dec 2025)',
            bookingModeLocked: !!callState?.bookingModeLocked,
            bookingState: callState?.bookingState || null,
            currentBookingStep: callState?.currentBookingStep || null,
            path: routingPath
          }
        }).catch(() => {});
      }
      
      // LLM-0 is ALWAYS ON now (simplified Dec 2025)
      // No more forceBookingPath logic needed - hybrid handles everything

      // ────────────────────────────────────────────────────────────────
      // 🌙 AFTER-HOURS MESSAGE MODE (deterministic, no LLM)
      // ────────────────────────────────────────────────────────────────
      // Enterprise KPI rule:
      // - After-hours "message-taking" counts as containment success ONLY if:
      //   - required message fields are collected AND
      //   - confirmation is spoken AND caller confirms.
      if (afterHoursMode === true && company) {
        try {
          const AfterHoursCallTurnHandler = require('../services/AfterHoursCallTurnHandler');
          const { result: ahResult, updatedCallState } = await AfterHoursCallTurnHandler.handleTurn({
            companyId: companyID,
            company,
            callSid,
            userText: speechResult,
            callState
          });

          result = ahResult;
          result.callState = updatedCallState;
          tracer.step('AFTER_HOURS_FLOW', 'After-hours deterministic message flow executed', {
            step: updatedCallState.afterHoursFlow?.step || null,
            completed: updatedCallState.afterHoursFlow?.completed === true,
            confirmed: updatedCallState.afterHoursFlow?.confirmed === true
          });

          // KPI: only mark success when contract is confirmed complete
          try {
            const CallSummary = require('../models/CallSummary');
            const completed = updatedCallState.afterHoursFlow?.completed === true && updatedCallState.afterHoursFlow?.confirmed === true;
            const flow = updatedCallState.afterHoursFlow || {};
            const message = flow.message || {};
            const slots = flow.slots || {};
            const contract = flow.contract || {};
            const baseline = ['name', 'phone', 'address', 'problemSummary', 'preferredTime'];
            const effectiveFieldKeys = Array.isArray(contract.effectiveFieldKeys) && contract.effectiveFieldKeys.length > 0
              ? contract.effectiveFieldKeys
              : baseline;

            const getVal = (k) => {
              if (k === 'name') return message.name;
              if (k === 'phone') return message.phone;
              if (k === 'address') return message.address;
              if (k === 'problemSummary') return message.problem;
              if (k === 'preferredTime') return message.preferredTime;
              return slots[k];
            };

            const missing = effectiveFieldKeys.filter(k => !getVal(k));

            await CallSummary.updateLiveProgress(callSid, {
              kpi: {
                afterHoursMessageCaptured: completed === true && missing.length === 0,
                containmentOutcome: completed === true && missing.length === 0 ? 'INTENTIONAL_HANDOFF' : undefined,
                containmentCountedAsSuccess: completed === true && missing.length === 0 ? true : undefined,
                failureReason: completed === true && missing.length === 0 ? 'UNKNOWN' : (missing.length ? 'SLOT_MISSING' : 'UNKNOWN'),
                missingRequiredSlotsCount: missing.length,
                missingRequiredSlotsSample: missing.slice(0, 5),
                bucket: 'FAQ_ONLY'
              }
            });
          } catch (e) {
            logger.warn('[AFTER_HOURS] Failed to update CallSummary KPI (non-fatal)', { callSid, error: e.message });
          }
        } catch (afterHoursErr) {
          logger.warn('[AFTER_HOURS] After-hours flow failed (non-fatal)', {
            callSid,
            companyId: companyID,
            error: afterHoursErr.message
          });
        }
      }
      
      if (!result && llm0Enabled && company) {

        // ────────────────────────────────────────────────────────────────
        // 🏷️ VENDOR CALL FAST-PATH (deterministic)
        // ────────────────────────────────────────────────────────────────
        // If the caller is a known Vendor (by phone) and the company has enabled
        // vendorHandling, we run a bounded "take-a-message" flow and record a VendorCall.
        const vendorHandling = company?.aiAgentSettings?.frontDeskBehavior?.vendorHandling || {};
        if (callState?.callerType === 'vendor' && vendorHandling.enabled === true && vendorHandling.mode !== 'ignore') {
          try {
            const VendorCallTurnHandler = require('../services/VendorCallTurnHandler');
            const { result: vendorResult, updatedCallState } = await VendorCallTurnHandler.handleTurn({
              companyId: companyID,
              company,
              callSid,
              fromNumber,
              userText: speechResult,
              callState
            });
            
            if (vendorResult) {
              result = vendorResult;
              result.callState = updatedCallState;
              tracer.step('VENDOR_FLOW', 'Vendor call handled by deterministic flow', {
                vendorId: updatedCallState.vendorId || null,
                vendorName: updatedCallState.vendorContext?.vendorName || null,
                vendorCallId: updatedCallState.vendorFlow?.vendorCallId || null,
                step: updatedCallState.vendorFlow?.step || null
              });

              // KPI: vendor message-taking is an intentional handoff (counts as success per policy)
              try {
                const CallSummary = require('../models/CallSummary');
                await CallSummary.updateLiveProgress(callSid, {
                  kpi: {
                    callerType: 'vendor',
                    vendorMessageCaptured: updatedCallState.vendorFlow?.completed === true,
                    containmentOutcome: updatedCallState.vendorFlow?.completed === true ? 'INTENTIONAL_HANDOFF' : undefined,
                    containmentCountedAsSuccess: updatedCallState.vendorFlow?.completed === true ? true : undefined,
                    failureReason: updatedCallState.vendorFlow?.completed === true ? 'UNKNOWN' : undefined
                  }
                });
              } catch (e) {
                logger.warn('[VENDOR_FLOW] Failed to update CallSummary KPI (non-fatal)', { callSid, error: e.message });
              }
            }
          } catch (vendorErr) {
            logger.warn('[VENDOR_FLOW] Failed to run vendor flow (non-blocking)', {
              callSid,
              companyId: companyID,
              error: vendorErr.message
            });
          }
        }

        // ════════════════════════════════════════════════════════════════════════════════════
        // 🎯 BOOKING FLOW SHORT-CIRCUIT (Feb 2026) - NOW A FALLBACK
        // ════════════════════════════════════════════════════════════════════════════════════
        // V94 NOTE: The ABSOLUTE BOOKING GATE above (line ~3002) should handle booking.
        // This block is now a FALLBACK for edge cases where:
        // - bookingModeLocked got set MID-TURN by ConversationEngine
        // - result wasn't set by the absolute gate for some reason
        // 
        // In normal operation, the absolute gate runs first and this never fires.
        // ════════════════════════════════════════════════════════════════════════════════════
        if (callState?.bookingModeLocked === true && !result) {
          logger.info('[BOOKING FALLBACK] Absolute gate missed, running fallback booking handler', {
            callSid,
            turnCount: callState.turnCount
          });
          try {
            const { BookingFlowRunner, BookingFlowResolver } = require('../services/engine/booking');
            
            tracer.step('BOOKING_FLOW_START', '📋 Booking flow locked - running deterministic booking runner');
            
            // Resolve the booking flow from company config
            const flow = BookingFlowResolver.resolve({
              companyId: companyID,
              trade: callState.trade || null,
              serviceType: callState.serviceType || null,
              company
            });

            // 📼 BLACK BOX: Log booking flow resolution source (truth vs fallback)
            if (BlackBoxLogger) {
              const resolution = flow?.resolution || {};
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'BOOKING_FLOW_RESOLVED',
                turn: turnCount,
                data: {
                  flowId: flow?.flowId || null,
                  source: resolution.source || flow?.source || 'unknown',
                  status: resolution.status || 'UNKNOWN',
                  slotCount: resolution.slotCount ?? flow?.steps?.length ?? null,
                  checkedPaths: resolution.checkedPaths || null,
                  hasFrontDeskSlots: resolution.hasFrontDeskSlots ?? null,
                  hasLegacySlots: resolution.hasLegacySlots ?? null
                }
              }).catch(() => {});
            }
            
            // Build state from Redis callState
            const bookingState = {
              bookingModeLocked: true,
              bookingFlowId: callState.bookingFlowId || flow.flowId,
              currentStepId: callState.currentStepId || callState.currentBookingStep || flow.steps[0]?.id,
              bookingCollected: callState.bookingCollected || {},
              slotMetadata: callState.slotMetadata || {},
              confirmedSlots: callState.confirmedSlots || {},
              askCount: callState.bookingAskCount || {},
              pendingConfirmation: callState.pendingConfirmation || null
            };
            
            // ═══════════════════════════════════════════════════════════════════
            // V94: Create AWConfigReader for traced config reads in BookingFlowRunner
            // ═══════════════════════════════════════════════════════════════════
            // This enables CONFIG_READ events for address verification settings
            // and ensures booking flow reads are visible in Raw Events (AW ⇄ RE).
            // ═══════════════════════════════════════════════════════════════════
            let awReader = null;
            if (AWConfigReader && company) {
              try {
                awReader = AWConfigReader.forCall({
                  callId: callSid,
                  companyId: companyID,
                  turn: callState?.totalTurns || callState?.turnCount || 0,
                  runtimeConfig: company,
                  readerId: 'v2twilio.BookingFlowRunner',
                  awHash: callState?.awHash || null,
                  traceRunId: callState?.traceRunId || null
                });
                turnAwReader = awReader;  // V96h: Store in outer scope for trace
              } catch (awErr) {
                logger.warn('[V2TWILIO] Failed to create AWConfigReader for booking flow', { 
                  callSid, 
                  error: awErr.message 
                });
              }
            }
            
            // Handle confirmation response if awaiting confirmation
            let bookingResult;
            if (bookingState.currentStepId === 'CONFIRMATION' || callState.awaitingConfirmation) {
              // V92: Pass company for SMS notifications on completion
              bookingResult = BookingFlowRunner.handleConfirmationResponse(speechResult, flow, bookingState, company);
            } else {
              // Pass slots (with metadata) to BookingFlowRunner for confirm-vs-collect logic
              // V94: Pass awReader for traced config reads (address verification, etc.)
              bookingResult = await BookingFlowRunner.runStep({
                flow,
                state: bookingState,
                userInput: speechResult,
                company,
                callSid,
                slots: callState.slots || {},  // 🎯 Pre-extracted slots with confidence
                awReader  // 🔌 V94: For CONFIG_READ tracing in booking flow
              });
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V110: FAIL-CLOSED INVARIANT (secondary gate) - Gate must never speak
            // ═══════════════════════════════════════════════════════════════════════════
            const runnerDebug2 = bookingResult.debug || {};
            const promptSource2 = runnerDebug2.promptSource || runnerDebug2.source;
            let gateViolation2 = false;
            let originalReply2 = bookingResult.reply;
            
            // V110: Detect GATE_SPOKE_VIOLATION - prompt without proper source
            if (bookingResult.reply && !promptSource2) {
              gateViolation2 = true;
              logger.error('[BOOKING FLOW] ❌ GATE_SPOKE_VIOLATION: Prompt without promptSource! CLEARING REPLY.', {
                callSid,
                action: bookingResult.action,
                replyPreview: (bookingResult.reply || '').substring(0, 50),
                resolution: 'FAIL_CLOSED_CLEAR_REPLY'
              });
              
              if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                  callId: callSid,
                  companyId: companyID,
                  type: 'GATE_SPOKE_VIOLATION',
                  turn: turnCount,
                  data: { 
                    violation: 'PROMPT_WITHOUT_SOURCE', 
                    action: bookingResult.action,
                    resolution: 'FAIL_CLOSED'
                  }
                }).catch(() => {});
              }
            }
            
            // V110: Detect ADDRESS_BREAKDOWN actions - banned
            if (bookingResult.action && bookingResult.action.includes('ADDRESS_BREAKDOWN')) {
              gateViolation2 = true;
              logger.error('[BOOKING FLOW] ❌ GATE_SPOKE_VIOLATION: ADDRESS_BREAKDOWN detected! FORCING CONTINUE.', {
                callSid,
                action: bookingResult.action,
                resolution: 'FAIL_CLOSED_FORCE_CONTINUE'
              });
              
              if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                  callId: callSid,
                  companyId: companyID,
                  type: 'GATE_SPOKE_VIOLATION',
                  turn: turnCount,
                  data: { 
                    violation: 'ADDRESS_BREAKDOWN_ACTION', 
                    action: bookingResult.action,
                    resolution: 'FAIL_CLOSED'
                  }
                }).catch(() => {});
              }
              
              // Force action to CONTINUE
              bookingResult.action = 'CONTINUE';
            }
            
            // V110: FAIL-CLOSED ENFORCEMENT
            if (gateViolation2) {
              logger.warn('[BOOKING FLOW] ⚠️ FAIL-CLOSED: Forcing transfer due to gate violation', {
                callSid,
                originalReply: (originalReply2 || '').substring(0, 50)
              });
              
              // Clear the tainted reply
              bookingResult.reply = null;
              bookingResult.action = 'ESCALATE';
              bookingResult.transferReason = 'GATE_SPOKE_VIOLATION_FAIL_CLOSED';
              bookingResult.requiresTransfer = true;
              
              bookingResult.debug = {
                ...bookingResult.debug,
                gateViolation: true,
                failClosed: true,
                originalReply: (originalReply2 || '').substring(0, 100)
              };
            }
            
            // Map BookingFlowRunner result to expected format
            result = {
              text: bookingResult.reply,
              response: bookingResult.reply,
              action: bookingResult.action === 'COMPLETE' ? 'COMPLETE' :
                      bookingResult.action === 'ESCALATE' ? 'transfer' : 'BOOKING',
              shouldTransfer: bookingResult.requiresTransfer === true,
              transferReason: bookingResult.transferReason || null,
              matchSource: bookingResult.matchSource || 'BOOKING_FLOW_RUNNER',
              tier: 'tier1',
              tokensUsed: 0,  // 🎯 0 tokens - 100% deterministic!
              callState: {
                ...callState,
                bookingModeLocked: bookingResult.state?.bookingModeLocked !== false,
                bookingFlowId: bookingResult.state?.bookingFlowId || flow.flowId,
                currentStepId: bookingResult.state?.currentStepId,
                currentBookingStep: bookingResult.state?.currentStepId,
                currentSlotId: bookingResult.state?.currentSlotId,  // V110
                slotSubStep: bookingResult.state?.slotSubStep,      // V110
                bookingCollected: bookingResult.state?.bookingCollected || {},
                slotMetadata: bookingResult.state?.slotMetadata || callState.slotMetadata || {},
                confirmedSlots: bookingResult.state?.confirmedSlots || {},
                lockedSlots: bookingResult.state?.lockedSlots || {},  // V110
                pendingConfirmation: bookingResult.state?.pendingConfirmation || null,
                bookingAskCount: bookingResult.state?.askCount || {},
                repromptCount: bookingResult.state?.repromptCount || {},  // V110
                awaitingConfirmation: bookingResult.state?.awaitingConfirmation || false,
                bookingState: bookingResult.isComplete ? 'COMPLETE' : 'ACTIVE',
                bookingComplete: bookingResult.isComplete || false,
                slots: callState.slots || {}
              },
              debug: {
                mode: 'booking',
                source: 'BOOKING_FLOW_RUNNER',
                // V110: Full prompt tracing
                promptSource: promptSource2,
                stepId: runnerDebug2.step || bookingResult.state?.currentStepId,
                slotId: runnerDebug2.slotId || bookingResult.state?.currentSlotId,
                slotSubStep: runnerDebug2.slotSubStep || bookingResult.state?.slotSubStep,
                flowId: flow.flowId,
                currentStep: bookingResult.state?.currentStepId,
                isComplete: bookingResult.isComplete,
                bookingCollected: bookingResult.state?.bookingCollected,
                repromptCount: runnerDebug2.repromptCount
              }
            };
            
            const bookingLatencyMs = Date.now() - aiProcessStart;
            
            tracer.step('BOOKING_FLOW_ROUTED', `📋 Booking flow routed in ${bookingLatencyMs}ms (0 tokens)`);
            
            // 📼 BLACK BOX: V110 - Gate routed, runner spoke
            if (BlackBoxLogger) {
              // Event 1: Gate routed (no text)
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'BOOKING_GATE_ROUTED',  // V110: Renamed
                turn: turnCount,
                data: {
                  latencyMs: bookingLatencyMs,
                  routedTo: 'BOOKING_FLOW_RUNNER',
                  flowId: flow.flowId,
                  isComplete: bookingResult.isComplete
                }
              }).catch(() => {});
              
              // Event 2: Runner prompt (with full tracing)
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'BOOKING_RUNNER_PROMPT',  // V110: Runner spoke
                turn: turnCount,
                data: {
                  action: bookingResult.action,
                  stepId: runnerDebug2.step || bookingResult.state?.currentStepId,
                  slotId: runnerDebug2.slotId || bookingResult.state?.currentSlotId,
                  slotSubStep: runnerDebug2.slotSubStep,
                  promptSource: promptSource2,
                  repromptCount: runnerDebug2.repromptCount || 0,
                  responsePreview: (bookingResult.reply || '').substring(0, 100)
                }
              }).catch(() => {});
            }
            
            logger.info('[BOOKING FLOW] ✅ Gate routed to runner', {
              callSid,
              flowId: flow.flowId,
              stepId: runnerDebug2.step || bookingResult.state?.currentStepId,
              slotId: runnerDebug2.slotId,
              promptSource: promptSource2,
              latencyMs: bookingLatencyMs
            });
            
          } catch (bookingFlowErr) {
            logger.error('[BOOKING FLOW] ❌ Booking flow failed - falling back to ConversationEngine', {
              callSid,
              companyId: companyID,
              error: bookingFlowErr.message,
              stack: bookingFlowErr.stack?.substring(0, 500)
            });
            
            // 📼 BLACK BOX: Log booking flow failure
            if (BlackBoxLogger) {
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'BOOKING_FLOW_FAILED',
                turn: turnCount,
                data: {
                  error: bookingFlowErr.message?.substring(0, 200),
                  recovery: 'ConversationEngine_fallback'
                }
              }).catch(() => {});
            }
            
            // Clear the result so we fall through to ConversationEngine
            result = null;
            // Unlock booking mode to prevent infinite loop
            callState.bookingModeLocked = false;
          }
        }

        // ════════════════════════════════════════════════════════════════════════════════════
        // 🚀 UNIFIED AI PATH (Feb 2026 - STRICT MODE REFACTOR)
        // ════════════════════════════════════════════════════════════════════════════════════
        // V102: CHECK STRICT MODE FIRST - if strict, hybrid path is IMPOSSIBLE
        // This ensures FrontDeskRuntime is the ONLY orchestrator when strict=true
        // ════════════════════════════════════════════════════════════════════════════════════
        
        const hybridStartTime = Date.now();
        let usedPath = result
          ? ((bookingInProgress || result?.matchSource === 'BOOKING_FLOW_RUNNER')
              ? 'booking'
              : 'vendor')
          : 'legacy';
        
        // V102: Determine strict mode FIRST (before any path decisions)
        const runtimeEnforcementLevel = company?.aiAgentSettings?.frontDesk?.enforcement?.level;
        const runtimeStrictOnly = company?.aiAgentSettings?.frontDesk?.enforcement?.strictControlPlaneOnly;
        const strictControlPlaneMode = runtimeEnforcementLevel === 'strict' || 
          (runtimeStrictOnly === true && runtimeEnforcementLevel !== 'warn');
        
        // V103: Log strict mode evaluation for debugging
        const strictModeReason = strictControlPlaneMode 
          ? (runtimeEnforcementLevel === 'strict' ? 'level=strict' : 'strictOnly=true')
          : (runtimeEnforcementLevel === 'warn' ? 'level=warn' : 'not_configured');
        
        logger.info('[V103] STRICT MODE EVALUATION', {
          callSid,
          companyId: companyID,
          runtimeEnforcementLevel,
          runtimeStrictOnly,
          strictControlPlaneMode,
          reason: strictModeReason
        });
        
        // V103: BlackBox event for strict mode evaluation (shows in trace!)
        if (BlackBoxLogger) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'STRICT_MODE_EVALUATION',
            turn: turnCount,
            data: {
              strictMode: strictControlPlaneMode,
              enforcementLevel: runtimeEnforcementLevel || 'not_set',
              strictControlPlaneOnly: runtimeStrictOnly || false,
              reason: strictModeReason,
              hybridPathPossible: !strictControlPlaneMode
            }
          }).catch(() => {});
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V96j: BOOKING GATE BYPASS PROTECTION
        // ═══════════════════════════════════════════════════════════════════════════
        if (callState?._bookingGateHandled && result) {
          logger.info('[V96j] Skipping ConversationEngine - booking gate already handled', {
            callSid,
            matchSource: result?.matchSource,
            debugSource: result?.debug?.source
          });
        } else if (strictControlPlaneMode && !result) {
          // ════════════════════════════════════════════════════════════════════════
          // V102: STRICT MODE = FRONT DESK RUNTIME ONLY (hybrid path is BLOCKED)
          // ════════════════════════════════════════════════════════════════════════
          // PLATFORM LAW: When enforcement.level === 'strict', FrontDeskRuntime is
          // the ONLY orchestrator. Hybrid/ConversationEngine paths are IMPOSSIBLE.
          // ════════════════════════════════════════════════════════════════════════
          try {
            usedPath = 'frontDeskRuntime';  // V102: NOT 'hybrid'
            
            if (BlackBoxLogger) {
              // Log scenario match attempt (BEFORE processing)
              BlackBoxLogger.QuickLog.scenarioMatchAttempt(
                callSid,
                companyID,
                turnCount,
                rawSpeechResult || speechResult || '[empty]',
                speechResult || '[empty]',
                'checking...'
              ).catch(() => {});
            }
            
            // Route through FrontDeskRuntime - THE ONLY ORCHESTRATOR
            const FrontDeskRuntime = require('../services/engine/FrontDeskRuntime');
            
            logger.info('[V102] STRICT CONTROL PLANE MODE - Routing through FrontDeskRuntime', {
                callSid,
                turnCount,
                enforcementLevel: runtimeEnforcementLevel || 'strict',
                userInput: speechResult?.substring(0, 50)
              });
              
              if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                  callId: callSid,
                  companyId: companyID,
                  type: 'FRONT_DESK_RUNTIME_ENTRY',
                  turn: turnCount,
                  data: {
                    strictMode: true,
                    userInput: speechResult?.substring(0, 100),
                    bookingModeLocked: !!callState?.bookingModeLocked,
                    consentPending: !!callState?.bookingConsentPending
                  }
                }).catch(() => {});
              }
              
              // Build context for FrontDeskRuntime
              const runtimeContext = {
                company,
                callSid,
                turnCount,
                companyId: companyID,
                callState,  // V101 fix: pass callState instead of undefined 'session'
                callerPhone: fromNumber,
                // V111: STT confidence for Connection Quality Gate
                sttConfidence: parseFloat(req.body.Confidence) || 0,
                // V111 Phase 4: Pass ConversationMemory for governance enforcement
                v111Memory: v111Memory || null,
                // V111: Signals will be determined by FrontDeskRuntime internally
                scenarioMatch: null,
                consentSignal: { detected: false },
                escalationSignal: { explicit: false, frustration: false }
              };
              
              // Call FrontDeskRuntime - THE SINGLE ORCHESTRATOR
              const runtimeResult = await FrontDeskRuntime.handleTurn(
                company.aiAgentSettings,
                callState,
                speechResult,
                runtimeContext
              );
              
              // Update callState from runtime result
              if (runtimeResult.state) {
                Object.assign(callState, runtimeResult.state);
              }
              
              // V111: Handle Connection Quality Gate DTMF escape
              if (runtimeResult.action === 'DTMF_ESCAPE' && runtimeResult.signals?.dtmfEscape) {
                const transferDest = runtimeResult.signals?.transferDestination || 
                    company?.aiAgentSettings?.frontDeskBehavior?.connectionQualityGate?.transferDestination || '';
                result = {
                  response: runtimeResult.response,
                  text: runtimeResult.response,
                  conversationMode: 'catastrophic_fallback',
                  matchSource: 'CONNECTION_QUALITY_GATE',
                  catastrophicFallback: {
                    enabled: true,
                    forwardNumber: transferDest || company?.phoneNumber || '',
                    announcement: runtimeResult.response,
                    option2Action: 'voicemail'
                  }
                };
                
                logger.info('[V111] CONNECTION QUALITY GATE → DTMF ESCAPE', {
                  callSid,
                  companyId: companyID,
                  transferDest: transferDest?.replace(/\d(?=\d{4})/g, '*'),
                  troubleCount: runtimeResult.metadata?.connectionTroubleCount
                });
              }
              // Handle escalation/transfer
              else if (runtimeResult.signals?.escalate || runtimeResult.action === 'TRANSFER') {
                result = {
                  response: runtimeResult.response,
                  text: runtimeResult.response,
                  requiresTransfer: true,
                  conversationMode: 'transfer',
                  matchSource: runtimeResult.matchSource || 'FRONT_DESK_RUNTIME',
                  // V111 Phase 4: Include governance decision
                  v111: runtimeResult.v111 || null
                };
              } else {
                result = {
                  response: runtimeResult.response,
                  text: runtimeResult.response,
                  conversationMode: runtimeResult.lane === 'BOOKING' ? 'booking' : 'discovery',
                  matchSource: runtimeResult.matchSource || 'FRONT_DESK_RUNTIME',
                  bookingFlowState: {
                    bookingModeLocked: callState.bookingModeLocked,
                    bookingConsentPending: callState.bookingConsentPending
                  },
                  signals: runtimeResult.signals,
                  // V111 Phase 4: Include governance decision
                  v111: runtimeResult.v111 || null
                };
              }
              
              // Log successful routing
              if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                  callId: callSid,
                  companyId: companyID,
                  type: 'FRONT_DESK_RUNTIME_RESULT',
                  turn: turnCount,
                  data: {
                    lane: runtimeResult.lane,
                    responsePreview: runtimeResult.response?.substring(0, 100),
                    matchSource: runtimeResult.matchSource,
                    bookingModeLocked: !!callState.bookingModeLocked,
                    escalate: !!runtimeResult.signals?.escalate
                  }
                }).catch(() => {});
              }
              
            // Skip legacy ConversationEngine path
            modeOwner = runtimeResult.lane === 'BOOKING' ? 'BOOKING_FLOW_RUNNER' :
                        runtimeResult.lane === 'ESCALATE' ? 'TRANSFER_HANDLER' :
                        'FRONT_DESK_RUNTIME';
            ownerGateApplied = true;
            
          } catch (strictModeError) {
            // ════════════════════════════════════════════════════════════════════════
            // V102: STRICT MODE FAILED - Return helpful response (NO LEGACY FALLBACK)
            // ════════════════════════════════════════════════════════════════════════
            usedPath = 'frontDeskRuntime_error_recovery';
            const strictLatencyMs = Date.now() - hybridStartTime;
            
            logger.error('[V102] Strict mode FrontDeskRuntime failed - using simple recovery', {
              error: strictModeError.message,
              stack: strictModeError.stack?.substring(0, 500),
              latencyMs: strictLatencyMs,
              callSid
            });
            
            if (BlackBoxLogger) {
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'FRONT_DESK_RUNTIME_FAILED',
                turn: turnCount,
                data: {
                  error: strictModeError.message?.substring(0, 200),
                  stack: strictModeError.stack?.substring(0, 500),
                  latencyMs: strictLatencyMs,
                  recovery: 'attempting_llm_fallback'
                }
              }).catch(() => {});
            }
            
            // ════════════════════════════════════════════════════════════════════════
            // V111: SMART ERROR RECOVERY - Try LLM before giving up
            // ════════════════════════════════════════════════════════════════════════
            // Instead of immediately returning a hardcoded message, try LLM as fallback
            // This ensures we don't lose calls due to bugs in the runtime
            // ════════════════════════════════════════════════════════════════════════
            try {
              logger.info('[V111] Attempting LLM fallback after runtime error', { callSid, speechResult: speechResult?.substring(0, 50) });
              
              const llmFallbackResult = await HybridReceptionistLLM.processConversation({
                company,
                userInput: speechResult || '',
                conversationHistory: callState?.conversationHistory || [],
                callState: callState || {},
                mode: 'DISCOVERY',
                turnCount,
                callerPhone: fromNumber,
                // Tell LLM this is error recovery so it can be extra helpful
                systemNote: 'Previous processing failed. Respond naturally to the caller input.'
              });
              
              if (llmFallbackResult && llmFallbackResult.text) {
                logger.info('[V111] LLM fallback succeeded', { 
                  callSid, 
                  responseLength: llmFallbackResult.text.length,
                  tokensUsed: llmFallbackResult.tokensUsed || 0
                });
                
                if (BlackBoxLogger) {
                  BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId: companyID,
                    type: 'ERROR_RECOVERY_LLM_SUCCESS',
                    turn: turnCount,
                    data: {
                      originalError: strictModeError.message?.substring(0, 100),
                      llmResponseLength: llmFallbackResult.text.length,
                      tokensUsed: llmFallbackResult.tokensUsed || 0
                    }
                  }).catch(() => {});
                }
                
                result = {
                  text: llmFallbackResult.text,
                  response: llmFallbackResult.text,
                  conversationMode: 'discovery',
                  matchSource: 'ERROR_RECOVERY_LLM_FALLBACK',
                  tier: 'tier3',
                  tokensUsed: llmFallbackResult.tokensUsed || 0
                };
              } else {
                throw new Error('LLM returned empty response');
              }
            } catch (llmFallbackError) {
              // LLM also failed - check for catastrophic fallback settings
              logger.error('[V111] LLM fallback also failed, checking catastrophic fallback', {
                callSid,
                llmError: llmFallbackError.message
              });
              
              const recoveryMsgs = company.aiAgentSettings?.llm0Controls?.recoveryMessages || {};
              
              if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                  callId: callSid,
                  companyId: companyID,
                  type: 'ERROR_RECOVERY_LLM_FAILED',
                  turn: turnCount,
                  data: {
                    originalError: strictModeError.message?.substring(0, 100),
                    llmError: llmFallbackError.message?.substring(0, 100),
                    catastrophicFallbackEnabled: recoveryMsgs.catastrophicFallbackEnabled || false
                  }
                }).catch(() => {});
              }
              
              // ════════════════════════════════════════════════════════════════════════
              // V111: CATASTROPHIC FALLBACK - Offer DTMF menu when everything fails
              // ════════════════════════════════════════════════════════════════════════
              if (recoveryMsgs.catastrophicFallbackEnabled && recoveryMsgs.catastrophicForwardNumber) {
                logger.warn('[V111] 🚨 CATASTROPHIC FALLBACK ACTIVATED - Offering DTMF menu', {
                  callSid,
                  forwardNumber: recoveryMsgs.catastrophicForwardNumber
                });
                
                if (BlackBoxLogger) {
                  BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId: companyID,
                    type: 'CATASTROPHIC_FALLBACK_ACTIVATED',
                    turn: turnCount,
                    data: {
                      forwardNumber: recoveryMsgs.catastrophicForwardNumber?.replace(/\d(?=\d{4})/g, '*'),
                      option2Action: recoveryMsgs.catastrophicOption2Action || 'voicemail'
                    }
                  }).catch(() => {});
                }
                
                // Return special result that triggers DTMF menu in TwiML generation
                result = {
                  text: recoveryMsgs.catastrophicAnnouncement || "We're experiencing technical difficulties. Press 1 to speak with a representative, or press 2 to leave a message.",
                  response: recoveryMsgs.catastrophicAnnouncement || "We're experiencing technical difficulties. Press 1 to speak with a representative, or press 2 to leave a message.",
                  conversationMode: 'catastrophic_fallback',
                  matchSource: 'CATASTROPHIC_FALLBACK',
                  catastrophicFallback: {
                    enabled: true,
                    forwardNumber: recoveryMsgs.catastrophicForwardNumber,
                    option2Action: recoveryMsgs.catastrophicOption2Action || 'voicemail',
                    announcement: recoveryMsgs.catastrophicAnnouncement
                  }
                };
              } else {
                // No catastrophic fallback configured - use simple recovery message
                result = {
                  text: recoveryMsgs.connectionCutOut || "I'm sorry, the connection cut out for a second. What can I help you with?",
                  response: recoveryMsgs.connectionCutOut || "I'm sorry, the connection cut out for a second. What can I help you with?",
                  conversationMode: 'discovery',
                  matchSource: 'FRONT_DESK_RUNTIME_ERROR_RECOVERY_FINAL'
                };
              }
            }
          }
        } else if (strictControlPlaneMode && !result) {
          // ════════════════════════════════════════════════════════════════════════
          // V109: LEGACY_PATH_BLOCKED_VIOLATION - This should NEVER happen
          // ════════════════════════════════════════════════════════════════════════
          // If we're here with strictControlPlaneMode=true and no result yet,
          // that means FrontDeskRuntime failed to produce a result. This is a
          // critical violation that must be logged and handled.
          // ════════════════════════════════════════════════════════════════════════
          logger.error('[V109] LEGACY_PATH_BLOCKED_VIOLATION: Strict mode is ON but no result from FrontDeskRuntime!', {
            callSid,
            companyId: companyID,
            turnCount,
            strictMode: true,
            resultIsNull: !result,
            violation: 'STRICT_MODE_NO_RESULT'
          });
          
          if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'LEGACY_PATH_BLOCKED_VIOLATION',
              turn: turnCount,
              data: {
                violation: 'STRICT_MODE_NO_RESULT',
                strictMode: true,
                resultIsNull: true,
                remediation: 'Using fail-closed escalation response',
                message: 'FrontDeskRuntime should have produced a result in strict mode. Legacy path is BLOCKED.'
              }
            }).catch(() => {});
          }
          
          // Fail closed with FrontDesk-controlled message
          const failClosedMsg = company?.aiAgentSettings?.frontDeskBehavior?.errorMessages?.systemError ||
            "I apologize, but I'm having a technical issue. Let me connect you with someone who can help.";
          
          result = {
            text: failClosedMsg,
            response: failClosedMsg,
            conversationMode: 'transfer',
            requiresTransfer: true,
            matchSource: 'LEGACY_PATH_BLOCKED_VIOLATION'
          };
          usedPath = 'frontDeskRuntime_strict_fallback';
          modeOwner = 'FRONT_DESK_RUNTIME';
          ownerGateApplied = true;
        } else if (!strictControlPlaneMode && !result) {
          // ════════════════════════════════════════════════════════════════════════
          // V102: LEGACY PATH - ConversationEngine (ONLY when strict mode is OFF)
          // ════════════════════════════════════════════════════════════════════════
          // This path runs ONLY when enforcement.level !== 'strict'
          // When strict mode is ON, this path is IMPOSSIBLE to reach.
          // ════════════════════════════════════════════════════════════════════════
          try {
            usedPath = 'hybrid';
            
            if (BlackBoxLogger) {
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'HYBRID_PATH_START',
                turn: turnCount,
                data: {
                  reason: 'Legacy path (strict mode OFF)',
                  bookingModeLocked: !!callState?.bookingModeLocked,
                  userInput: speechResult?.substring(0, 100)
                }
              }).catch(() => {});
              
              BlackBoxLogger.QuickLog.scenarioMatchAttempt(
                callSid,
                companyID,
                turnCount,
                rawSpeechResult || speechResult || '[empty]',
                speechResult || '[empty]',
                'checking...'
              ).catch(() => {});
            }
            
            const ConversationEngine = require('../services/ConversationEngine');
            
            // ════════════════════════════════════════════════════════════════════════
            // 🚨 TIMEOUT: 8 seconds (increased from 4s on Jan 18, 2026)
            // Root cause: OpenAI gpt-4o-mini can take 2-4s under load, plus ~1s for
            // scenario matching, session management, etc. 4s was too tight.
            // ════════════════════════════════════════════════════════════════════════
            const CONVERSATION_ENGINE_TIMEOUT_MS = parseInt(process.env.CONVERSATION_ENGINE_TIMEOUT_MS) || 8000;
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 FEB 2026 FIX: Pass pre-extracted slots to ConversationEngine
            // ═══════════════════════════════════════════════════════════════════
            // CRITICAL: Without this, slots extracted in v2twilio (stored in Redis)
            // are NOT visible to ConversationEngine's booking logic.
            // This caused "What's your name?" to be asked even when name was collected.
            // ═══════════════════════════════════════════════════════════════════
            const preExtractedSlots = {};
            if (callState.slots && Object.keys(callState.slots).length > 0) {
              for (const [key, slot] of Object.entries(callState.slots)) {
                if (slot?.value) {
                  preExtractedSlots[key] = slot.value;
                }
              }
            }
            
            const engineResult = await Promise.race([
              ConversationEngine.processTurn({
                companyId: companyID,
                channel: 'phone',
                userText: speechResult,
                callSid,
                callerPhone: fromNumber,
                metadata: {
                  calledNumber: req.body.To,
                  confidence: parseFloat(req.body.Confidence) || 0,
                  sttProcessResult
                },
                preExtractedSlots,  // 🎯 Slots from Redis state
                // V97 FIX: Pass bookingConsentPending from Redis so consent detection works
                bookingConsentPending: callState.bookingConsentPending === true,
                includeDebug: false  // No debug for production calls
              }),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`ConversationEngine timeout (${CONVERSATION_ENGINE_TIMEOUT_MS}ms)`)), CONVERSATION_ENGINE_TIMEOUT_MS)
              )
            ]);
            
            // ═══════════════════════════════════════════════════════════════════
            // 🚨 CHECK FOR ENGINE ERROR - Log it for debugging!
            // ═══════════════════════════════════════════════════════════════════
            if (engineResult.success === false) {
              logger.error('[V2 TWILIO] ❌ ConversationEngine returned error!', {
                callSid,
                error: engineResult.error,
                errorType: engineResult.errorType,
                lastCheckpoint: engineResult.debug?.lastCheckpoint,
                stackPreview: engineResult.debug?.stackPreview
              });
              
              // Log to BlackBox for debugging
              if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                  callId: callSid,
                  companyId: companyID,
                  type: 'CONVERSATION_ENGINE_ERROR',
                  turn: turnCount,
                  data: {
                    error: engineResult.error,
                    errorType: engineResult.errorType,
                    lastCheckpoint: engineResult.debug?.lastCheckpoint,
                    stackPreview: engineResult.debug?.stackPreview,
                    latencyMs: engineResult.latencyMs
                  }
                }).catch(() => {});
              }
            }
            
            // V96h: Track mode ownership for TURN_DECISION_TRACE_V1
            modeOwner = engineResult.requiresTransfer === true ? 'TRANSFER_HANDLER' :
                        engineResult.conversationMode === 'complete' ? 'BOOKING_FLOW_RUNNER' :
                        'DISCOVERY_ENGINE';
            ownerGateApplied = modeOwner !== 'DISCOVERY_ENGINE';  // Gate was applied if not discovery
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V96i: BOOKING GATE VIOLATION DETECTION
            // ═══════════════════════════════════════════════════════════════════════════
            // If ConversationEngine just set bookingModeLocked=true but responded with
            // STATE_MACHINE, that means the booking prompts are NOT coming from 
            // BookingFlowRunner. This is a gate violation that must be logged.
            // 
            // The CORRECT behavior: BookingFlowRunner should have spoken FIRST.
            // If we're here with bookingModeLocked=true, something bypassed the gate.
            // ═══════════════════════════════════════════════════════════════════════════
            const engineSetBookingLock = engineResult.bookingFlowState?.bookingModeLocked === true ||
                                         engineResult.signals?.bookingModeLocked === true;
            const engineUsedStateMachine = engineResult.fromStateMachine === true ||
                                           engineResult.debug?.source?.includes('STATE_MACHINE');
            
            if (engineSetBookingLock && engineUsedStateMachine) {
              logger.warn('[BOOKING GATE VIOLATION] ⚠️ ConversationEngine used STATE_MACHINE while booking locked!', {
                callSid,
                turnCount: callState.turnCount,
                bookingModeLocked: engineResult.bookingFlowState?.bookingModeLocked,
                responseSource: engineResult.debug?.source,
                expected: 'BookingFlowRunner should have handled this turn',
                violation: 'STATE_MACHINE_WHILE_BOOKING_LOCKED'
              });
              
              if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                  callId: callSid,
                  companyId: companyID,
                  type: 'BOOKING_GATE_VIOLATION',
                  turn: callState.turnCount,
                  data: {
                    violation: 'STATE_MACHINE_WHILE_BOOKING_LOCKED',
                    bookingModeLocked: true,
                    responseSource: engineResult.debug?.source,
                    responsePreview: (engineResult.reply || '').substring(0, 100),
                    explanation: 'ConversationEngine responded with STATE_MACHINE while booking was supposed to be locked. BookingFlowRunner gate was bypassed.'
                  }
                }).catch(() => {});
              }
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V96j: DEFER TO BOOKING RUNNER SIGNAL HANDLING
            // ═══════════════════════════════════════════════════════════════════════════
            // If ConversationEngine returns deferToBookingRunner=true, it means:
            // - bookingModeLocked was already true when ConversationEngine ran
            // - ConversationEngine correctly refused to generate a booking response
            // - We must now run BookingFlowRunner to generate the actual response
            // 
            // This is a safety net for when ConversationEngine is called while locked
            // (shouldn't happen but provides defense in depth).
            // ═══════════════════════════════════════════════════════════════════════════
            if (engineResult.signals?.deferToBookingRunner === true) {
              logger.info('[V96j] ConversationEngine deferred to BookingFlowRunner - running booking gate now', {
                callSid,
                turnCount: callState.turnCount,
                reason: engineResult.debug?.reason
              });
              
              // Update callState with bookingFlowState from ConversationEngine
              if (engineResult.bookingFlowState) {
                callState.bookingModeLocked = true;
                callState.bookingFlowState = engineResult.bookingFlowState;
              }
              
              try {
                const { BookingFlowRunner, BookingFlowResolver } = require('../services/engine/booking');
                
                // Resolve the booking flow from company config
                const deferredFlow = BookingFlowResolver.resolve({
                  companyId: companyID,
                  trade: callState.trade || null,
                  serviceType: callState.serviceType || null,
                  company
                });
                
                // Build state from Redis callState
                const deferredBookingState = {
                  bookingModeLocked: true,
                  bookingFlowId: callState.bookingFlowId || deferredFlow.flowId,
                  currentStepId: callState.currentStepId || callState.currentBookingStep || deferredFlow.steps[0]?.id,
                  bookingCollected: callState.bookingCollected || {},
                  slotMetadata: callState.slotMetadata || {},
                  confirmedSlots: callState.confirmedSlots || {},
                  askCount: callState.bookingAskCount || {},
                  pendingConfirmation: callState.pendingConfirmation || null
                };
                
                // Run booking flow
                const deferredResult = await BookingFlowRunner.runStep({
                  flow: deferredFlow,
                  state: deferredBookingState,
                  userInput: speechResult,
                  callSid,
                  company,
                  session: { _id: callSid, mode: 'BOOKING', collectedSlots: callState.slots || {} }
                });
                
                // Map to result format
                result = {
                  text: deferredResult.reply,
                  response: deferredResult.reply,
                  action: deferredResult.action || 'BOOKING',
                  matchSource: 'BOOKING_FLOW_RUNNER',
                  tier: 'tier0',
                  bookingFlowState: deferredResult.state,
                  callState: {
                    ...callState,
                    ...(deferredResult.state || {}),
                    bookingModeLocked: true
                  },
                  debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    reason: 'V96j_DEFERRED_FROM_CONVERSATION_ENGINE',
                    flowId: deferredFlow.flowId,
                    currentStep: deferredResult.state?.currentStepId
                  }
                };
                
                // Log successful deferred execution
                if (BlackBoxLogger) {
                  BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId: companyID,
                    type: 'BOOKING_RUNNER_DEFERRED_EXECUTION',
                    turn: turnCount,
                    data: {
                      reason: 'ConversationEngine deferred to BookingFlowRunner',
                      flowId: deferredFlow.flowId,
                      responsePreview: (deferredResult.reply || '').substring(0, 100)
                    }
                  }).catch(() => {});
                }
              } catch (deferErr) {
                logger.error('[V96j] BookingFlowRunner deferred execution failed', {
                  callSid,
                  error: deferErr.message,
                  stack: deferErr.stack?.substring(0, 500)
                });
                // Fall through to use ConversationEngine result as fallback
              }
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V97e FIX: SAFETY NET - Booking locked but deferToBookingRunner NOT signaled
            // ═══════════════════════════════════════════════════════════════════════════
            // BUG: When LLM offers to schedule (not deterministic path), and user says
            // "yes", consent is detected LATE in ConversationEngine. bookingModeLocked
            // becomes true, but deferToBookingRunner wasn't set. LLM generates "I'm sorry,
            // could you repeat that?" while booking is locked → ROUTING_INVARIANT_VIOLATION.
            //
            // FIX: If booking got locked during this turn but we haven't run BookingFlowRunner
            // yet, discard the LLM response and run BookingFlowRunner now.
            // ═══════════════════════════════════════════════════════════════════════════
            const bookingGotLockedThisTurn = (
              engineResult.bookingFlowState?.bookingModeLocked === true ||
              engineResult.signals?.bookingModeLocked === true
            );
            const notYetDeferred = !result; // result is still null = haven't run BookingFlowRunner
            
            if (bookingGotLockedThisTurn && notYetDeferred && engineResult.matchSource !== 'BOOKING_FLOW_RUNNER') {
              logger.info('[V97e] SAFETY NET: Booking locked during turn but defer not signaled - running BookingFlowRunner', {
                callSid,
                turnCount: callState.turnCount,
                matchSource: engineResult.matchSource,
                bookingModeLocked: true
              });
              
              try {
                const { BookingFlowRunner, BookingFlowResolver } = require('../services/engine/booking');
                
                // Resolve the booking flow from company config
                const safetyNetFlow = BookingFlowResolver.resolve({
                  companyId: companyID,
                  trade: callState.trade || null,
                  serviceType: callState.serviceType || null,
                  company
                });
                
                // Build state from engineResult.bookingFlowState or defaults
                const safetyNetState = {
                  bookingModeLocked: true,
                  bookingFlowId: engineResult.bookingFlowState?.bookingFlowId || safetyNetFlow.flowId,
                  currentStepId: engineResult.bookingFlowState?.currentStepId || safetyNetFlow.steps[0]?.id,
                  bookingCollected: engineResult.bookingFlowState?.bookingCollected || callState.bookingCollected || {},
                  slotMetadata: callState.slotMetadata || {},
                  confirmedSlots: callState.confirmedSlots || {},
                  askCount: callState.bookingAskCount || {},
                  pendingConfirmation: callState.pendingConfirmation || null
                };
                
                // Run booking flow
                const safetyNetResult = await BookingFlowRunner.runStep({
                  flow: safetyNetFlow,
                  state: safetyNetState,
                  userInput: speechResult,
                  callSid,
                  company,
                  session: { _id: callSid, mode: 'BOOKING', collectedSlots: callState.slots || {} }
                });
                
                // Map to result format
                result = {
                  text: safetyNetResult.reply,
                  response: safetyNetResult.reply,
                  action: safetyNetResult.action || 'BOOKING',
                  matchSource: 'BOOKING_FLOW_RUNNER',
                  tier: 'tier0',
                  bookingFlowState: safetyNetResult.state,
                  callState: {
                    ...callState,
                    ...(safetyNetResult.state || {}),
                    bookingModeLocked: true
                  },
                  debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    reason: 'V97e_SAFETY_NET_LATE_LOCK',
                    flowId: safetyNetFlow.flowId,
                    currentStep: safetyNetResult.state?.currentStepId,
                    originalMatchSource: engineResult.matchSource
                  }
                };
                
                logger.info('[V97e] Safety net BookingFlowRunner executed successfully', {
                  callSid,
                  flowId: safetyNetFlow.flowId,
                  currentStep: safetyNetResult.state?.currentStepId,
                  responsePreview: (safetyNetResult.reply || '').substring(0, 50)
                });
              } catch (safetyNetError) {
                logger.error('[V97e] Safety net BookingFlowRunner failed', {
                  callSid,
                  error: safetyNetError.message
                });
                // Fall through to use ConversationEngine result as fallback
              }
            }
            
            // Only map ConversationEngine result if result wasn't set by deferred booking runner
            if (!result) {
              // Map ConversationEngine result to expected format
              result = {
                text: engineResult.reply,
                response: engineResult.reply,
                // If ConversationEngine requests a transfer, honor it (Twilio handles transfer separately)
                action: engineResult.requiresTransfer === true ? 'transfer' :
                      (engineResult.conversationMode === 'complete' ? 'COMPLETE' : 
                       engineResult.wantsBooking ? 'BOOKING' : 'DISCOVERY'),
              transferTarget: engineResult.requiresTransfer === true
                ? (company?.twilioConfig?.fallbackNumber || null)
                : null,
              transferReason: engineResult.requiresTransfer === true
                ? (engineResult.transferReason || 'runtime_requires_transfer')
                : null,
              // ═══════════════════════════════════════════════════════════════════
              // 🎯 RESPONSE SOURCE TRACKING (Jan 18, 2026)
              // These fields power BlackBox "source" tracking so we can see
              // WHERE each response came from (scenario, LLM, state machine, etc.)
              // ═══════════════════════════════════════════════════════════════════
              matchSource: engineResult.matchSource || 'LLM_FALLBACK',
              tier: engineResult.tier || 'tier3',
              tokensUsed: engineResult.tokensUsed || 0,
              callState: {
                ...callState,
                sessionId: engineResult.sessionId,
                phase: engineResult.phase,
                collectedSlots: engineResult.slotsCollected,
                // ═══════════════════════════════════════════════════════════════════
                // V97 FIX: SAVE bookingConsentPending TO REDIS
                // ═══════════════════════════════════════════════════════════════════
                // BUG: When consent question was asked (Turn 2), the pending flag was
                // only saved to MongoDB session, not Redis. On Turn 3, Redis had no
                // record of the pending consent, so "Yes please" wasn't recognized.
                // FIX: Save consent pending state to Redis.
                // CLEAR when: consent granted (bookingModeLocked becomes true)
                // PERSIST when: consent question just asked (signal is true)
                // ═══════════════════════════════════════════════════════════════════
                bookingConsentPending: (engineResult.bookingFlowState?.bookingModeLocked === true || engineResult.signals?.bookingModeLocked === true)
                  ? false  // Consent granted → clear pending
                  : (engineResult.signals?.bookingConsentPending === true || callState.bookingConsentPending === true),
                // ═══════════════════════════════════════════════════════════════════
                // 🔒 BOOKING FLOW STATE (Feb 2026)
                // ═══════════════════════════════════════════════════════════════════
                // These fields are saved to Redis and checked at the TOP of the next turn.
                // If bookingModeLocked === true, BookingFlowRunner runs instead of LLM.
                // 
                // V96 FIX: Store BOTH individual fields AND bookingFlowState object.
                // The individual fields are for backward compatibility.
                // The bookingFlowState object prevents auto-init from creating defaults.
                // ═══════════════════════════════════════════════════════════════════
                ...(engineResult.bookingFlowState ? {
                  bookingModeLocked: engineResult.bookingFlowState.bookingModeLocked,
                  bookingFlowId: engineResult.bookingFlowState.bookingFlowId,
                  currentStepId: engineResult.bookingFlowState.currentStepId,
                  currentBookingStep: engineResult.bookingFlowState.currentStepId, // Alias
                  bookingCollected: engineResult.bookingFlowState.bookingCollected || {},
                  bookingState: engineResult.bookingFlowState.bookingState || 'ACTIVE',
                  // V96 FIX: Store the full object so next turn's auto-init doesn't override
                  bookingFlowState: {
                    bookingModeLocked: engineResult.bookingFlowState.bookingModeLocked,
                    bookingFlowId: engineResult.bookingFlowState.bookingFlowId,
                    currentStepId: engineResult.bookingFlowState.currentStepId,
                    bookingCollected: engineResult.bookingFlowState.bookingCollected || {},
                    bookingState: engineResult.bookingFlowState.bookingState || 'ACTIVE'
                  }
                } : {})
              },
              debug: {
                mode: engineResult.conversationMode,
                filledSlots: engineResult.slotsCollected,
                latencyMs: engineResult.latencyMs,
                engine: 'ConversationEngine',
                // V33: Include error info if present
                engineError: engineResult.error || null,
                engineErrorType: engineResult.errorType || null,
                lastCheckpoint: engineResult.debug?.lastCheckpoint || null,
                // 🆕 Response source for debugging
                matchSource: engineResult.matchSource || 'LLM_FALLBACK',
                tier: engineResult.tier || 'tier3',
                // 🔒 Booking flow state for debugging
                bookingModeLocked: engineResult.bookingFlowState?.bookingModeLocked || false,
                bookingFlowId: engineResult.bookingFlowState?.bookingFlowId || null
              }
            };
            }  // End of if (!result) - V96j defer handling
            
            const hybridLatencyMs = Date.now() - hybridStartTime;
            
            tracer.step(engineResult.success === false ? 'HYBRID_PATH_ERROR' : 'HYBRID_PATH_SUCCESS', 
              `🚀 Hybrid completed in ${hybridLatencyMs}ms${engineResult.success === false ? ' (WITH ERROR)' : ''}`);
            
            // 📼 BLACK BOX: Log hybrid success with source tracking
            if (BlackBoxLogger) {
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'HYBRID_PATH_SUCCESS',
                turn: turnCount,
                data: {
                  latencyMs: hybridLatencyMs,
                  responsePreview: (result?.text || result?.response || '').substring(0, 100),
                  mode: result?.debug?.mode,
                  filledSlots: result?.debug?.filledSlots,
                  // 🆕 Source tracking for debugging
                  matchSource: result?.matchSource || 'UNKNOWN',
                  tier: result?.tier || 'tier3',
                  tokensUsed: result?.tokensUsed || 0
                }
              }).catch(() => {});
            }
            
          } catch (hybridError) {
            // ════════════════════════════════════════════════════════════════════════════
            // HYBRID FAILED - Return simple helpful response (NO LEGACY FALLBACK)
            // ════════════════════════════════════════════════════════════════════════════
            // We don't fall back to the slow legacy path anymore.
            // Just return a helpful response and log the error for debugging.
            // ════════════════════════════════════════════════════════════════════════════
            usedPath = 'hybrid_error_recovery';
            const hybridLatencyMs = Date.now() - hybridStartTime;
            
            logger.error('[V2 TWILIO] ❌ Hybrid path failed - using simple recovery', {
              error: hybridError.message,
              stack: hybridError.stack?.substring(0, 500),
              latencyMs: hybridLatencyMs,
              callSid
            });
            
            // 📼 BLACK BOX: Log hybrid failure
            if (BlackBoxLogger) {
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'HYBRID_PATH_FAILED',
                turn: turnCount,
                data: {
                  error: hybridError.message?.substring(0, 200),
                  stack: hybridError.stack?.substring(0, 500),
                  latencyMs: hybridLatencyMs,
                  recovery: 'simple_response'
                }
              }).catch(() => {});
            }
            
            // Simple recovery response - CONTEXT-AWARE, blame connection not caller
            // 🚨 UI-CONTROLLED: Use recovery message from database
            const recoveryMsgs = company.aiAgentSettings?.llm0Controls?.recoveryMessages || {};
            let recoveryText = recoveryMsgs.connectionCutOut || "I'm sorry, the connection cut out for a second. What can I help you with?";
            let recoveryAction = 'DISCOVERY';
            
            // Check if we're in booking mode - don't reset!
            // 🚨 Use UI-configured questions for recovery
            if (callState?.bookingModeLocked || callState?.bookingState === 'ACTIVE') {
              const currentStep = callState?.currentBookingStep;
              const HybridReceptionistLLM = require('../services/HybridReceptionistLLM');
              const frontDeskConfig = company?.aiAgentSettings?.frontDeskBehavior || {};
              
              if (currentStep === 'ASK_NAME' || currentStep === 'name') {
                const nameQ = HybridReceptionistLLM.getSlotPrompt('name', frontDeskConfig);
                recoveryText = `I'm sorry, I think the connection dropped. ${nameQ}`;
                recoveryAction = 'BOOKING';
              } else if (currentStep === 'ASK_ADDRESS' || currentStep === 'address') {
                const addressQ = HybridReceptionistLLM.getSlotPrompt('address', frontDeskConfig);
                recoveryText = `Sorry, I didn't catch that. ${addressQ}`;
                recoveryAction = 'BOOKING';
              } else if (currentStep === 'ASK_PHONE' || currentStep === 'phone') {
                const phoneQ = HybridReceptionistLLM.getSlotPrompt('phone', frontDeskConfig);
                recoveryText = `The connection cut out. ${phoneQ}`;
                recoveryAction = 'BOOKING';
              } else if (currentStep === 'ASK_TIME' || currentStep === 'time') {
                const timeQ = HybridReceptionistLLM.getSlotPrompt('time', frontDeskConfig);
                recoveryText = `Sorry about that — ${timeQ}`;
                recoveryAction = 'BOOKING';
              } else {
                recoveryText = recoveryMsgs.generalError || "I'm sorry, I missed that. Could you say that again?";
                recoveryAction = 'BOOKING';
              }
              logger.info('[HYBRID] Booking-aware fallback used', { currentStep, recoveryText });
            }
            
            result = {
              text: recoveryText,
              action: recoveryAction,
              callState: callState
            };
          }
        }
        
        // 📼 BLACK BOX: Log which path was used
        if (BlackBoxLogger) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'PATH_RESOLVED',
            turn: turnCount,
            data: {
              usedPath,
              latencyMs: Date.now() - hybridStartTime,
              responseLength: (result?.text || result?.response || '').length
            }
          }).catch(() => {});
        }
        
        // 📼 BLACK BOX: Log turn completion with booking state
        // V103: handler now reflects actual path taken (was hardcoded 'ConversationEngine')
        if (BlackBoxLogger) {
          // Map usedPath to handler name for clarity
          const handlerFromPath = {
            'frontDeskRuntime': 'FrontDeskRuntime',
            'frontDeskRuntime_error_recovery': 'FrontDeskRuntime_ErrorRecovery',
            'hybrid': 'ConversationEngine',
            'booking': 'BookingFlowRunner',
            'vendor': 'VendorScenario',
            'legacy': 'LegacyPath'
          };
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'TURN_COMPLETE',
            turn: turnCount,
            data: {
              handler: handlerFromPath[usedPath] || usedPath || 'Unknown',
              usedPath,  // V103: Include raw path for debugging
              action: result.action,
              responsePreview: (result.text || result.response || '').substring(0, 100),
              bookingModeLocked: !!result.callState?.bookingModeLocked,
              bookingState: result.callState?.bookingState || null,
              currentBookingStep: result.callState?.currentBookingStep || null,
              bookingCollected: result.callState?.bookingCollected || null
            }
          }).catch(() => {});
        }
        
        logger.info('[HYBRID] Turn complete', {
          companyId: companyID,
          callSid,
          finalAction: result.action,
          shouldTransfer: result.shouldTransfer,
          shouldHangup: result.shouldHangup
        });
        
      }
      // LEGACY PATHS REMOVED - Dec 2025
      // HybridReceptionistLLM is the ONLY brain now.
      // If it fails, we return a simple recovery response (already handled above).
      // No more slow legacy LLM fallbacks.
      
    } catch (llm0Error) {
      // Simple error recovery - no legacy fallback
      logger.error('[HYBRID] Critical error - using simple recovery', {
        error: llm0Error.message,
        stack: llm0Error.stack?.substring(0, 500),
        callSid,
        companyLoaded: !!company
      });
      
      // ═══════════════════════════════════════════════════════════════════════════
      // 📼 BLACK BOX: Log the LLM-0 error (Feb 2026)
      // This was missing - errors were hidden causing "tier: unknown" in TURN_TRACE
      // ═══════════════════════════════════════════════════════════════════════════
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'LLM0_ERROR',
          turn: turnCount,
          data: {
            error: llm0Error.message,
            errorType: llm0Error.name || 'Error',
            stack: llm0Error.stack?.substring(0, 300),
            speechResult: (speechResult || '').substring(0, 100),
            companyLoaded: !!company,
            recovery: 'CONTEXT_AWARE_FALLBACK'
          }
        }).catch(() => {});
      }
      
      // CONTEXT-AWARE recovery - blame connection, respect booking state!
      // V69: Use random human-like recovery message
      // Safety: company may be null if loading failed, so use fallback
      let errorRecoveryText = company 
        ? getRecoveryMessage(company, 'audioUnclear')
        : "Sorry, I didn't catch that. Could you repeat what you said?";
      let errorRecoveryAction = 'DISCOVERY';
      
      // 🚨 Use UI-configured questions for error recovery
      if (callState?.bookingModeLocked || callState?.bookingState === 'ACTIVE') {
        const currentStep = callState?.currentBookingStep;
        const HybridReceptionistLLM = require('../services/HybridReceptionistLLM');
        const frontDeskConfig = company?.aiAgentSettings?.frontDeskBehavior || {};
        
        if (currentStep === 'ASK_NAME' || currentStep === 'name') {
          const nameQ = HybridReceptionistLLM.getSlotPrompt('name', frontDeskConfig);
          errorRecoveryText = `Sorry, I think the connection dropped. ${nameQ}`;
          errorRecoveryAction = 'BOOKING';
        } else if (currentStep === 'ASK_ADDRESS' || currentStep === 'address') {
          const addressQ = HybridReceptionistLLM.getSlotPrompt('address', frontDeskConfig);
          errorRecoveryText = `Sorry about that — ${addressQ}`;
          errorRecoveryAction = 'BOOKING';
        } else if (currentStep === 'ASK_PHONE' || currentStep === 'phone') {
          const phoneQ = HybridReceptionistLLM.getSlotPrompt('phone', frontDeskConfig);
          errorRecoveryText = `I missed that. ${phoneQ}`;
          errorRecoveryAction = 'BOOKING';
        } else {
          const recoveryMsgs = company?.aiAgentSettings?.llm0Controls?.recoveryMessages || {};
          errorRecoveryText = recoveryMsgs.generalError || "Sorry, the connection cut out. Could you repeat that?";
          errorRecoveryAction = 'BOOKING';
        }
      }
      
      result = {
        text: errorRecoveryText,
        action: errorRecoveryAction,
        callState: callState,
        // ═══════════════════════════════════════════════════════════════════════════
        // 🎯 ADD TRACKING FIELDS (Feb 2026)
        // Without these, TURN_TRACE shows "tier: unknown" and we can't debug
        // ═══════════════════════════════════════════════════════════════════════════
        tier: 'recovery',
        matchSource: 'LLM0_ERROR_RECOVERY',
        tokensUsed: 0,
        debug: {
          source: 'LLM0_ERROR_RECOVERY',
          error: llm0Error.message,
          errorType: llm0Error.name || 'Error'
        }
      };
      
      tracer.error('Hybrid failed, using context-aware recovery', llm0Error);
    }
    
    perfCheckpoints.aiProcessing = Date.now() - aiProcessStart;
    
    logger.security('🎯 CHECKPOINT 15: AI Agent Runtime response received');
    logger.security('🤖 AI Response:', JSON.stringify(result, null, 2));
    
    // ════════════════════════════════════════════════════════════════════════════
    // 📊 TURN TRACE LOG (Feb 2026) - PRODUCTION-GRADE WIRING VERIFICATION
    // ════════════════════════════════════════════════════════════════════════════
    // 6 Checkpoints that PROVE slots + booking wiring is correct:
    // A. State loaded (before any changes)
    // B. SlotExtractor ran (before vs after, delta, candidates with confidence)
    // C. Booking short-circuit decision (which branch taken)
    // D. Booking runner decision (confirm vs collect vs skip)
    // E. Scenario/LLM path (if not booking)
    // F. State saved (what persists for next turn)
    // ════════════════════════════════════════════════════════════════════════════
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96h: PII MASKING for TURN_DECISION_TRACE_V1 (production-safe)
    // ═══════════════════════════════════════════════════════════════════════════
    // Masking strategy:
    // - phone: last 4 digits only (***1234)
    // - email: first char + *** + domain (j***@example.com)
    // - address: partial (*** Main St, City)
    // - ssn/account: always ****
    // - names: keep full (not PII in context of debugging)
    // ═══════════════════════════════════════════════════════════════════════════
    const maskSlotValue = (key, slot) => {
      if (!slot?.value) return null;
      const val = String(slot.value);
      const keyLower = key.toLowerCase();
      
      // Phone: last 4 only
      if (keyLower.includes('phone')) {
        return val.length > 4 ? '***' + val.slice(-4) : '****';
      }
      
      // Email: mask middle
      if (keyLower.includes('email')) {
        const atIndex = val.indexOf('@');
        if (atIndex > 0) {
          return val[0] + '***' + val.slice(atIndex);
        }
        return '****';
      }
      
      // Address: keep street type and city, mask number and street name
      if (keyLower.includes('address')) {
        // "123 Main Street, Denver" → "*** Main St, Denver"
        // Simple approach: mask first word if it's numeric
        const parts = val.split(' ');
        if (parts.length > 0 && /^\d+$/.test(parts[0])) {
          parts[0] = '***';
        }
        return parts.join(' ');
      }
      
      // SSN/Account: always mask
      if (keyLower.includes('ssn') || keyLower.includes('account')) {
        return '****';
      }
      
      return val;
    };
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96i: TRACE BLOCK - Wrapped in try/catch so it can NEVER crash the call
    // Rule: Tracing can fail; the call cannot.
    // ═══════════════════════════════════════════════════════════════════════════
    let checkpointA = null;
    let checkpointB = null;
    
    try {
      // Checkpoint A: State loaded
      checkpointA = {
        turn: callState?.turnCount || 1,
        bookingModeLocked: !!callState?.bookingModeLocked,
        currentBookingStep: callState?.currentBookingStep || null,
        slotsSummary: Object.fromEntries(
          Object.entries(slotsBefore || {}).map(([k, v]) => [k, maskSlotValue(k, v)])
        )
      };
      
      // Checkpoint B: SlotExtractor ran
      const slotsAfter = callState?.slots || {};
      const slotKeysAfter = Object.keys(slotsAfter);
      const slotDelta = slotKeysAfter.filter(k => !(slotKeysBefore || []).includes(k));
      checkpointB = {
        slotsBefore: slotKeysBefore || [],
        slotsAfter: slotKeysAfter,
        delta: slotDelta,
        extractedCandidates: Object.fromEntries(
          Object.entries(extractedSlots || {}).map(([k, v]) => [
            k, 
            { 
              value: maskSlotValue(k, v), 
              confidence: v?.confidence || 0, 
              source: v?.source || 'unknown',
              needsConfirmation: v?.needsConfirmation || false,
              patternSource: v?.patternSource || 'unknown',
              nameLocked: v?.nameLocked || false
            }
          ])
        ),
        // V96g: Full merge decision audit trail
        mergeDecisions: slotMergeDecisions || []
      };
    } catch (traceInitErr) {
      logger.warn('[TRACE ERROR] Checkpoint A/B construction failed (call continues)', { error: traceInitErr.message });
      checkpointA = { turn: callState?.turnCount || 1, error: traceInitErr.message };
      checkpointB = { error: traceInitErr.message };
    }
    
    // Checkpoint C1: Booking intent detection (V94 - runs BEFORE meta intents)
    // This is the new early detection that catches "as soon as possible" before
    // REPAIR_CONVERSATION or other meta intents can intercept it
    const checkpointC_bookingIntent = result?.bookingIntentTrace || {
      requiresExplicitConsent: null,
      intentMatched: null,
      intentConfidence: null,
      consentPending: null,
      consentMatched: null,
      branchTaken: 'NO_TRACE'
    };
    
    // Checkpoint C2: Booking short-circuit decision (original checkpoint C)
    // V96j FIX: Check BOTH debug.source AND matchSource for BOOKING_FLOW_RUNNER
    const branchTaken = (result?.debug?.source === 'BOOKING_FLOW_RUNNER' || result?.matchSource === 'BOOKING_FLOW_RUNNER') ? 'BOOKING_RUNNER' :
                        result?.matchSource === 'AFTER_HOURS_FLOW' ? 'AFTER_HOURS' :
                        result?.matchSource === 'VENDOR_FLOW' ? 'VENDOR' :
                        result?.matchSource === 'BOOKING_CONSENT_QUESTION' ? 'BOOKING_CONSENT_QUESTION' :
                        result?.matchSource === 'BOOKING_DIRECT_INTENT_TRIGGERED' ? 'BOOKING_DIRECT_INTENT' :
                        'NORMAL_ROUTING';
    const checkpointC = {
      bookingModeLocked: !!result?.callState?.bookingModeLocked || !!callState?.bookingModeLocked,
      branchTaken
    };
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96j: BOOKING_ROUTING_INVARIANT_VIOLATION DETECTION
    // ═══════════════════════════════════════════════════════════════════════════
    // THE INVARIANT:
    //   If bookingModeLocked === true, then branchTaken MUST be BOOKING_RUNNER
    //   
    // VIOLATION:
    //   bookingModeLocked=true but branchTaken=NORMAL_ROUTING means:
    //   1. The booking gate was bypassed (split brain)
    //   2. Something else generated the response while booking was locked
    //   3. BookingFlowRunner never ran or returned null
    //
    // This is a CRITICAL violation that must be investigated immediately.
    // ═══════════════════════════════════════════════════════════════════════════
    const isRoutingInvariantViolation = 
      (checkpointC.bookingModeLocked === true) && 
      (branchTaken === 'NORMAL_ROUTING');
    
    if (isRoutingInvariantViolation) {
      logger.error('[V96j] 🚨 BOOKING_ROUTING_INVARIANT_VIOLATION DETECTED', {
        callSid,
        turn: checkpointA?.turn || 1,
        bookingModeLocked: true,
        branchTaken,
        expectedBranch: 'BOOKING_RUNNER',
        actualResponseOwner: result?.matchSource || result?.debug?.source || 'UNKNOWN',
        responsePreview: (result?.text || result?.response || '').substring(0, 80),
        explanation: 'bookingModeLocked=true but BookingFlowRunner did NOT generate the response. Split brain detected.'
      });
      
      // Emit to Black Box for alerting/analysis
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'BOOKING_ROUTING_INVARIANT_VIOLATION',
          turn: checkpointA?.turn || 1,
          data: {
            bookingModeLocked: true,
            branchTaken,
            expectedBranch: 'BOOKING_RUNNER',
            actualResponseOwner: result?.matchSource || result?.debug?.source || 'UNKNOWN',
            responsePreview: (result?.text || result?.response || '').substring(0, 100),
            possibleCauses: [
              'BookingFlowRunner returned null (check for errors)',
              'ConversationEngine bypassed the booking gate',
              'Absolute booking gate never executed',
              'bookingModeLocked was set by ConversationEngine after gate check'
            ],
            remediation: 'Ensure BookingFlowRunner always executes when bookingModeLocked=true and always returns a valid response.'
          }
        }).catch(() => {});
      }
    }
    
    // Checkpoint D: Booking runner decision (only if booking branch)
    const bookingSlotKey = result?.debug?.fieldKey || result?.debug?.slotToConfirm || result?.debug?.confirmedField || null;
    const checkpointD = branchTaken === 'BOOKING_RUNNER' ? {
      currentStepId: result?.callState?.currentStepId || result?.debug?.currentStep || result?.stepCompleted || null,
      action: result?.debug?.mode || 'UNKNOWN',  // CONFIRM, COLLECT, CONFIRMED, SKIP
      slotKey: bookingSlotKey,
      slotValueIfExists: bookingSlotKey ? maskSlotValue(bookingSlotKey, slotsAfter[bookingSlotKey]) : null,
      pendingConfirmation: result?.callState?.pendingConfirmation || null,
      nextStep: result?.nextStep || null,
      flowId: result?.debug?.flowId || null
    } : null;
    
    // Checkpoint E: Scenario/LLM path (only if not booking)
    // V92 FIX: HONEST matchSource - if scenarioId is null, it's NOT a scenario match!
    const scenarioSelected = result?.debug?.scenarioName || result?.debug?.scenarioId || null;
    let rawMatchSource = result?.matchSource || 'unknown';
    
    // V92: If matchSource claims SCENARIO_MATCHED but there's no scenarioId, that's dishonest
    // This was causing confusion: response "Don't worry..." labeled as SCENARIO_MATCHED with null scenarioId
    if ((rawMatchSource === 'SCENARIO_MATCHED' || rawMatchSource === 'SCENARIO_MATCH') && !scenarioSelected) {
      logger.warn('[V92] matchSource claims SCENARIO_MATCHED but scenarioId is null - correcting to DEFAULT_DISCOVERY', {
        originalMatchSource: rawMatchSource,
        debugScenarioId: result?.debug?.scenarioId,
        debugScenarioName: result?.debug?.scenarioName
      });
      rawMatchSource = 'DEFAULT_DISCOVERY';  // Honest label
    }
    
    const checkpointE = branchTaken === 'NORMAL_ROUTING' ? {
      tier: result?.tier || 'unknown',
      scenarioSelected,
      scenarioConfidence: result?.debug?.confidence || null,
      llmUsed: result?.tier === 'tier3' || result?.matchSource === 'LLM_FALLBACK',
      matchSource: rawMatchSource,
      tokensUsed: result?.tokensUsed || result?.debug?.tokensUsed || 0
    } : null;
    
    // Checkpoint F: State to be saved (will be verified after save)
    const updatedState = result?.callState || callState;
    const checkpointF = {
      savedSlotsKeys: Object.keys(updatedState.slots || {}),
      bookingModeLocked: !!updatedState.bookingModeLocked,
      currentStepId: updatedState.currentStepId || updatedState.currentBookingStep || null,
      confirmedSlots: Object.keys(updatedState.confirmedSlots || {})
    };
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V92: FLOW TREE BINDING - Map runtime state to flow nodes
    // ═══════════════════════════════════════════════════════════════════════════
    // Every TURN_TRACE must include flowNodeId for truth bundle compliance
    // If path isn't in tree, emit OUT_OF_TREE_PATH warning
    // ═══════════════════════════════════════════════════════════════════════════
    let flowNodeId = null;
    let flowEdgeId = null;
    let outOfTreePath = null;
    
    try {
      const TruthBundleExporter = require('../services/wiring/TruthBundleExporter');
      
      const runtimeState = {
        matchSource: checkpointE.matchSource,
        checkpoint: checkpointD ? 'CHECKPOINT_9b' : (checkpointE.llmUsed ? 'CHECKPOINT_9e' : 'CHECKPOINT_SCENARIO_MATCH'),
        branchTaken: checkpointC.branchTaken
      };
      
      const pathCheck = TruthBundleExporter.checkPathInTree(runtimeState);
      
      if (pathCheck.inTree) {
        flowNodeId = pathCheck.flowNodeId;
      } else {
        // OUT_OF_TREE_PATH detected - this is a wiring gap!
        flowNodeId = null;
        outOfTreePath = pathCheck.warning;
        
        logger.warn('[FLOW TREE] ⚠️ OUT_OF_TREE_PATH detected', {
          callSid,
          turn: checkpointA?.turn || 1,
          ...outOfTreePath
        });
      }
    } catch (e) {
      // Flow tree module not loaded - continue without
      logger.debug('[FLOW TREE] Module not available:', e.message);
    }
    
    // Full turn trace object
    const turnTrace = {
      callSid,
      companyId: companyID,
      timestamp: new Date().toISOString(),
      // V92: Flow tree binding
      flowNodeId,
      flowEdgeId,
      outOfTreePath,
      // Existing checkpoints
      checkpointA_stateLoaded: checkpointA,
      checkpointB_slotsExtracted: checkpointB,
      // V94: New booking intent checkpoint (runs BEFORE meta intents)
      checkpointC_bookingIntent,
      checkpointC_branchDecision: checkpointC,
      checkpointD_bookingRunner: checkpointD,
      checkpointE_scenarioLLM: checkpointE,
      checkpointF_stateSaved: checkpointF,
      responsePreview: (result?.text || result?.response || '').substring(0, 100)
    };
    
    logger.info('[TURN TRACE] 📊 Full turn verification', turnTrace);
    
    // 📼 BLACK BOX: Log comprehensive turn trace for debugging
    // V96i: Wrapped in try/catch - tracing must NEVER crash the call
    try {
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'TURN_TRACE',
          turn: checkpointA?.turn || 1,
          data: turnTrace
        }).catch(() => {});
        
        // V92: Log OUT_OF_TREE_PATH separately for easy filtering
        if (outOfTreePath) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'OUT_OF_TREE_PATH',
            turn: checkpointA?.turn || 1,
            data: outOfTreePath
          }).catch(() => {});
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V96h: TURN_DECISION_TRACE_V1 - Single Pane of Glass
      // ═══════════════════════════════════════════════════════════════════════════
      // This is THE canonical event for debugging any turn. It tells you:
      // - Mode before/after (what changed?)
      // - Who owned the turn (modeOwner)?
      // - Why was that branch taken (branchReason)?
      // - What config values drove the decision (configReads)?
      // - What intent signals were detected (wantsBooking, consent)?
      // - What slots were extracted, merged, and what's final?
      // - Who generated the response (responder)?
      // ═══════════════════════════════════════════════════════════════════════════
      const modeAfter = result?.callState?.sessionMode || callState?.sessionMode || modeBefore;
      const bookingModeLockedAfter = !!result?.callState?.bookingModeLocked || !!callState?.bookingModeLocked;
      
      // Build intent signals from booking intent trace
      const intentSignals = {
        wantsBooking: checkpointC_bookingIntent.intentMatched ? {
          matched: true,
          pattern: checkpointC_bookingIntent.intentMatched,
          confidence: checkpointC_bookingIntent.intentConfidence
        } : { matched: false },
        consent: checkpointC_bookingIntent.requiresExplicitConsent !== null ? {
          required: checkpointC_bookingIntent.requiresExplicitConsent,
          pending: checkpointC_bookingIntent.consentPending,
          matched: checkpointC_bookingIntent.consentMatched,
          pattern: checkpointC_bookingIntent.consentMatched || null
        } : null
      };
      
      // Build slots section with masked values
      const finalSlotState = {};
      for (const [key, slot] of Object.entries(callState.slots || {})) {
        if (slot && !key.startsWith('_')) {
          finalSlotState[key] = {
            valueMasked: maskSlotValue(key, slot),
            confidence: slot.confidence,
            confirmed: slot.confirmed || false,
            immutable: slot.immutable || false,
            nameLocked: slot.nameLocked || false,
            confirmedAt: slot.confirmedAt || null
          };
        }
      }
      
      // Build extracted slots with masked values
      const extractedSlotsMasked = {};
      for (const [key, slot] of Object.entries(extractedSlots || {})) {
        extractedSlotsMasked[key] = {
          valueMasked: maskSlotValue(key, slot),
          confidence: slot.confidence,
          source: slot.patternSource || slot.source || 'unknown'
        };
      }
      
      // Determine branch reason
      let branchReason = 'UNKNOWN';
      if (branchTaken === 'BOOKING_RUNNER') {
        branchReason = bookingModeLockedBefore ? 'bookingModeLocked_from_prior_turn' : 'booking_consent_granted';
      } else if (branchTaken === 'BOOKING_DIRECT_INTENT') {
        branchReason = 'wantsBooking + consentSatisfied';
      } else if (branchTaken === 'BOOKING_CONSENT_QUESTION') {
        branchReason = 'wantsBooking + consentPending';
      } else if (branchTaken === 'NORMAL_ROUTING') {
        branchReason = 'discovery_mode_no_booking_signal';
      } else if (branchTaken === 'AFTER_HOURS') {
        branchReason = 'after_hours_schedule_match';
      } else if (branchTaken === 'VENDOR') {
        branchReason = 'vendor_flow_triggered';
      }
      
      const decisionTrace = {
        _format: 'TURN_DECISION_TRACE_V1',
        turn: checkpointA?.turn || 1,
        modeBefore,
        modeAfter,
        bookingModeLocked: {
          before: bookingModeLockedBefore,
          after: bookingModeLockedAfter
        },
        modeOwner,
        ownerGateApplied,
        ownerBypassedReason,
        branch: {
          taken: branchTaken,
          reason: branchReason
        },
        configReads: turnAwReader?.getCriticalConfigReads?.() || configProvenanceReads,
        intentSignals,
        slots: {
          extracted: extractedSlotsMasked,
          mergeDecisions: slotMergeDecisions || [],  // V96i: Safe fallback
          final: finalSlotState
        },
        responder: {
          matchSource: checkpointE?.matchSource || result?.matchSource || branchTaken,
          scenarioId: checkpointE?.scenarioSelected || null,
          tier: checkpointE?.tier || (branchTaken === 'BOOKING_RUNNER' ? 'deterministic' : 'unknown'),
          responsePreview: (result?.text || result?.response || '').substring(0, 100)
        }
      };
      
      // V96h: Check trace level before emitting detailed trace
      // Default to 'normal' which includes TURN_DECISION_TRACE_V1
      const traceLevel = company?.aiAgentSettings?.traceLevel || 'normal';
      
      if (traceLevel !== 'off') {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'TURN_DECISION_TRACE_V1',
          turn: checkpointA?.turn || 1,
          data: decisionTrace
        }).catch(() => {});
      }
    }
    } catch (traceBlockErr) {
      // V96i: Trace errors must NEVER crash the call
      logger.warn('[TRACE ERROR] TURN_TRACE/TURN_DECISION_TRACE_V1 failed (call continues)', { 
        error: traceBlockErr.message,
        stack: traceBlockErr.stack?.split('\n').slice(0, 3).join(' | ')
      });
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 📊 V111 Phase 4: Finalize ConversationMemory TurnRecord
    // ════════════════════════════════════════════════════════════════════════════
    // - Captures routing decision and response
    // - Records V111 governance decisions
    // - Tracks capture progress (turns without new facts)
    // - Detects response loops
    // - Commits turn and saves to Redis & BlackBox
    // ════════════════════════════════════════════════════════════════════════════
    try {
      if (v111Memory && v111Memory._currentTurnBuilder) {
        // Extract routing info from the turn
        const matchSource = checkpointE?.matchSource || result?.matchSource || branchTaken || 'UNKNOWN';
        const routingWhy = [];
        if (branchReason) routingWhy.push({ rule: branchReason });
        if (branchTaken) routingWhy.push({ rule: `branch_${branchTaken.toLowerCase()}` });
        
        // ─────────────────────────────────────────────────────────────────────────
        // V111 Phase 4: Record governance decision from FrontDeskRuntime
        // ─────────────────────────────────────────────────────────────────────────
        if (result?.v111 && v111Memory._currentTurnBuilder.setV111Decision) {
          v111Memory._currentTurnBuilder.setV111Decision(result.v111);
          
          // Also add governance steps to routing why for unified view
          if (result.v111.governance?.length > 0) {
            result.v111.governance.forEach(g => {
              routingWhy.push({ rule: `v111_${g.step}`, result: g.result });
            });
          }
          
          if (result.v111.captureInjection?.inject) {
            routingWhy.push({ 
              rule: 'v111_capture_applied', 
              field: result.v111.captureInjection.field 
            });
          }
          
          if (result.v111.escalation) {
            routingWhy.push({ 
              rule: 'v111_escalation', 
              trigger: result.v111.escalation.trigger 
            });
          }
        }
        
        // Add routing decision
        v111Memory.addRoutingDecision(matchSource, routingWhy, []);
        
        // Add response
        const responseText = result?.text || result?.response || '';
        const latencyMs = Date.now() - (checkpointA?.timestamp ? new Date(checkpointA.timestamp).getTime() : Date.now());
        v111Memory.addResponse(matchSource, responseText, latencyMs, result?.action ? [result.action] : []);
        
        // ─────────────────────────────────────────────────────────────────────────
        // V111 Phase 3: Track capture progress
        // ─────────────────────────────────────────────────────────────────────────
        // If no facts were added this turn, increment turnsWithoutProgress
        const factsAddedThisTurn = v111Memory._currentTurnBuilder?.delta?.factsAdded?.length || 0;
        if (factsAddedThisTurn === 0) {
          v111Memory.incrementTurnsWithoutProgress();
        } else {
          // Reset counter when progress is made
          v111Memory.captureProgress.turnsWithoutProgress = 0;
        }
        
        // ─────────────────────────────────────────────────────────────────────────
        // V111 Phase 3: Loop detection
        // ─────────────────────────────────────────────────────────────────────────
        // Check if the agent is repeating the same response
        const loopCheck = v111Memory.checkForResponseLoop(responseText);
        if (loopCheck.isLoop && v111Memory.isV111Enabled()) {
          logger.warn('[V111] 🔄 Response loop detected', {
            callSid,
            consecutiveRepeats: loopCheck.consecutiveRepeats,
            action: loopCheck.action,
            response: responseText?.substring(0, 50)
          });
          
          // Log loop detection to turn record
          routingWhy.push({ rule: 'loop_detected', repeats: loopCheck.consecutiveRepeats });
        }
        
        // ─────────────────────────────────────────────────────────────────────────
        // V111 Phase 3: Capture injection check (visibility only)
        // ─────────────────────────────────────────────────────────────────────────
        // In Phase 3, we only LOG when capture injection WOULD happen.
        // Actual injection (modifying responses) comes in Phase 4.
        if (v111Memory.isV111Enabled()) {
          const captureCheck = v111Memory.shouldInjectCapturePrompt();
          if (captureCheck.inject) {
            logger.info('[V111] 🎯 Capture injection recommended', {
              callSid,
              field: captureCheck.field,
              priority: captureCheck.priority,
              reason: captureCheck.reason,
              turnsWithoutProgress: v111Memory.captureProgress.turnsWithoutProgress
            });
            
            // Log to turn record for visibility
            routingWhy.push({ 
              rule: 'capture_injection_recommended', 
              field: captureCheck.field,
              priority: captureCheck.priority
            });
          }
        }
        
        // Commit the turn
        const turnRecord = v111Memory.commitTurn();
        
        // Save ConversationMemory to Redis
        await v111Memory.save();
        
        // Log TurnRecord to BlackBox (one structured event instead of many)
        if (BlackBoxLogger && turnRecord) {
          await BlackBoxLogger.logTurnRecord({
            callId: callSid,
            companyId: companyID,
            turnRecord
          });
        }
        
        // ─────────────────────────────────────────────────────────────────────────
        // V111 Phase 3: Enhanced debug logging
        // ─────────────────────────────────────────────────────────────────────────
        logger.debug('[V111] 📊 Turn completed and saved', {
          callSid,
          turn: turnRecord?.turn,
          handler: turnRecord?.routing?.selectedHandler,
          latencyMs: turnRecord?.response?.latencyMs,
          v111Enabled: v111Memory.isV111Enabled(),
          factsCount: Object.keys(v111Memory.facts || {}).length,
          factsAddedThisTurn,
          captureProgress: {
            missingMust: v111Memory.getMissingMustFields?.() || [],
            missingShould: v111Memory.getMissingShouldFields?.() || [],
            turnsWithoutProgress: v111Memory.captureProgress?.turnsWithoutProgress || 0
          }
        });
      }
    } catch (v111Err) {
      // V111 errors must NEVER crash the call
      logger.warn('[V111] Turn finalization failed (non-fatal)', { 
        error: v111Err.message,
        stack: v111Err.stack?.split('\n').slice(0, 3).join(' | '),
        callSid
      });
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🔒 CRITICAL: Save call state to Redis (NOT just express-session)
    // ════════════════════════════════════════════════════════════════════════════
    // This ensures bookingModeLocked persists between Twilio webhook calls!
    // ════════════════════════════════════════════════════════════════════════════
    const updatedCallState = result.callState || callState;
    updatedCallState.turnCount = callState.turnCount; // Preserve turn count
    
    // 🎯 CRITICAL: Ensure slots persist every turn (shared memory contract)
    if (callState.slots && Object.keys(callState.slots).length > 0) {
      updatedCallState.slots = updatedCallState.slots || callState.slots;
    }
    
    // Also save to session for backwards compatibility
    req.session = req.session || {};
    req.session.callState = updatedCallState;
    
    // 🔒 Save to Redis (primary persistence)
    let stateSaveResult = 'PENDING';
    let redisSaveError = null;
    
    try {
      const { getSharedRedisClient } = require('../services/redisClientFactory');
      const redisClient = await getSharedRedisClient();
      
      if (redisClient) {
        const stateKey = `callState:${callSid}`;
        // Expire after 1 hour (calls shouldn't last longer)
        await redisClient.setEx(stateKey, 3600, JSON.stringify(updatedCallState));
        stateSaveResult = 'REDIS_OK';
        
        logger.info('[CALL STATE] 🔒 Saved to Redis', {
          callSid,
          bookingModeLocked: !!updatedCallState.bookingModeLocked,
          bookingState: updatedCallState.bookingState,
          turnCount: updatedCallState.turnCount,
          slotsCount: Object.keys(updatedCallState.slots || {}).length
        });
      } else {
        stateSaveResult = 'REDIS_NULL_CLIENT';
      }
    } catch (redisErr) {
      stateSaveResult = 'REDIS_ERROR';
      redisSaveError = redisErr.message;
      logger.error('[CALL STATE] Redis save failed!', { 
        callSid, 
        error: redisErr.message,
        bookingModeLocked: !!updatedCallState.bookingModeLocked
      });
    }
    
    // 📼 BLACK BOX: Log state save for diagnostics (visible in JSON!)
    if (BlackBoxLogger) {
      // Build slots preview for logging (show values + confidence)
      const slotsPreview = {};
      if (updatedCallState.slots) {
        for (const [key, slot] of Object.entries(updatedCallState.slots)) {
          if (slot?.value) {
            slotsPreview[key] = { v: slot.value, c: slot.confidence, s: slot.source };
          }
        }
      }
      
      BlackBoxLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'STATE_SAVED',
        turn: updatedCallState.turnCount,
        data: {
          result: stateSaveResult,
          error: redisSaveError,
          bookingModeLocked: !!updatedCallState.bookingModeLocked,
          bookingState: updatedCallState.bookingState || null,
          currentBookingStep: updatedCallState.currentBookingStep || null,
          bookingCollected: updatedCallState.bookingCollected || null,
          // 🎯 Slots are now first-class in state logging!
          slots: slotsPreview,
          slotsCount: Object.keys(slotsPreview).length
        }
      }).catch(() => {});
    }
    
    logger.security('🎯 CHECKPOINT 16: Creating TwiML response');
    const twiml = new twilio.twiml.VoiceResponse();
    
    // 🔧 FIX: Map action-based responses to legacy boolean flags for compatibility
    if (result.action === 'transfer') {
      result.shouldTransfer = true;
      result.text = result.response || "I'm connecting you to our team.";
    } else if (result.action === 'hangup') {
      // 🚫 NEVER HANG UP ON CALLER - Always transfer to human instead!
      // Business rule: We never abandon callers. Always connect them to someone.
      logger.warn('[HANGUP PREVENTED] AI tried to hangup - converting to transfer', {
        originalAction: 'hangup',
        convertedTo: 'transfer'
      });
      result.shouldTransfer = true;  // Transfer instead of hangup!
      result.shouldHangup = false;
      result.text = result.response || "Let me connect you to our team.";
    }
    
    // 📊 STRUCTURED LOG 5: Agent Output (before TwiML generation)
    logger.info('[AGENT-OUTPUT]', {
      companyId: companyID,
      callSid,
      finalAction: result.action || 'continue',
      shortResponsePreview: (result.text || '').slice(0, 160),
      willTransfer: Boolean(result.shouldTransfer),
      willHangup: Boolean(result.shouldHangup),
      timestamp: new Date().toISOString()
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96j: SPEAKER_OWNER_TRACE_V1 - THE ONLY TRACE THAT MATTERS
    // ═══════════════════════════════════════════════════════════════════════════
    // This trace ends all debugging arguments about "who spoke?"
    // It shows exactly which code path generated the outbound response.
    // ═══════════════════════════════════════════════════════════════════════════
    try {
      if (BlackBoxLogger) {
        // Determine responseOwner based on result properties
        let responseOwner = 'UNKNOWN';
        if (result.matchSource === 'BOOKING_FLOW_RUNNER' || result.debug?.source === 'BOOKING_FLOW_RUNNER') {
          responseOwner = 'BOOKING_FLOW_RUNNER';
        } else if (result.matchSource === 'BOOKING_SNAP' || result.debug?.source === 'BOOKING_SNAP') {
          responseOwner = 'BOOKING_SNAP'; // Ghost - should never appear after fix
        } else if (result.fromStateMachine && (result.debug?.source?.includes('BOOKING') || result.mode === 'BOOKING')) {
          responseOwner = 'CONVERSATION_ENGINE_BOOKING_MODE';
        } else if (result.fromStateMachine) {
          responseOwner = 'STATE_MACHINE';
        } else if (result.matchSource === 'SCENARIO_MATCHED' || result.matchSource === 'SCENARIO_MATCH') {
          responseOwner = 'SCENARIO_ENGINE';
        } else if (result.matchSource === 'LLM_FALLBACK' || result.tier === 'tier3') {
          responseOwner = 'HYBRID_LLM';
        } else if (result.matchSource === 'SILENCE_HANDLER') {
          responseOwner = 'SILENCE_HANDLER';
        } else {
          responseOwner = 'FALLBACK';
        }
        
        // V96j: Determine exact prompt source (user directive #5)
        let promptSource = 'UNKNOWN';
        if (result.debug?.confirmationTemplateSource) {
          promptSource = `booking.confirmationTemplate:${result.debug.confirmationTemplateSource}`;
        } else if (result.debug?.promptSource) {
          promptSource = result.debug.promptSource;
        } else if (result.debug?.currentStep) {
          promptSource = `booking.step:${result.debug.currentStep}`;
        } else if (result.scenarioId) {
          promptSource = `scenario:${result.scenarioId}`;
        } else if (result.matchSource === 'LLM_FALLBACK' || result.tier === 'tier3') {
          promptSource = 'LLM_DYNAMIC';
        } else if (result.matchSource === 'SCENARIO_MATCH' || result.matchSource === 'SCENARIO_MATCHED') {
          promptSource = `scenario:${result.scenarioId || result.debug?.scenarioId || 'matched'}`;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96j: BOOKING_VOICE_COLLISION DETECTION
        // ═══════════════════════════════════════════════════════════════════════
        // When bookingModeLocked=true, ONLY BookingFlowRunner should speak.
        // If any other speaker generates a response, that's a VOICE COLLISION.
        // This is the smoking gun for "multiple booking systems alive" bug.
        // ═══════════════════════════════════════════════════════════════════════
        const isVoiceCollision = 
          callState?.bookingModeLocked === true && 
          responseOwner !== 'BOOKING_FLOW_RUNNER' &&
          responseOwner !== 'SILENCE_HANDLER' && // Silence handling is OK
          responseOwner !== 'UNKNOWN'; // Don't flag if we can't determine owner
        
        if (isVoiceCollision) {
          logger.error('[V96j] 🚨 BOOKING_VOICE_COLLISION DETECTED', {
            callSid,
            turn: turnCount,
            bookingModeLocked: true,
            unexpectedSpeaker: responseOwner,
            expectedSpeaker: 'BOOKING_FLOW_RUNNER',
            matchSource: result.matchSource,
            responsePreview: (result.response || result.text || '').substring(0, 80)
          });
          
          // Emit BOOKING_VOICE_COLLISION event to Black Box
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'BOOKING_VOICE_COLLISION',
            turn: turnCount,
            data: {
              turn: turnCount,
              bookingModeLocked: true,
              unexpectedSpeaker: responseOwner,
              expectedSpeaker: 'BOOKING_FLOW_RUNNER',
              matchSource: result.matchSource || 'UNKNOWN',
              debugSource: result.debug?.source || 'UNKNOWN',
              responsePreview: (result.response || result.text || '').substring(0, 100),
              remediation: 'Ensure BookingFlowRunner is the ONLY speaker when bookingModeLocked=true. Delete/disable competing responders.'
            }
          }).catch(() => {});
        }
        
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'SPEAKER_OWNER_TRACE_V1',
          turn: turnCount,
          data: {
            turn: turnCount,
            bookingModeLocked: !!callState?.bookingModeLocked,
            branchTaken: result.debug?.source || result.matchSource || 'UNKNOWN',
            responseOwner,
            matchSource: result.matchSource || 'UNKNOWN',
            fromStateMachine: !!result.fromStateMachine,
            mode: result.mode || result.callState?.sessionMode || 'UNKNOWN',
            responsePreview: (result.response || result.text || '').substring(0, 100),
            // V96j: Exact prompt source (user directive #5)
            promptSource,
            isHardcodedTemplate: result.debug?.isHardcodedTemplate || false,
            callsite: result.debug?.source ? `ConversationEngine:${result.debug.source}` : 
                      result.matchSource === 'BOOKING_FLOW_RUNNER' ? 'BookingFlowRunner' :
                      'v2twilio:UNKNOWN'
          }
        }).catch(() => {});
      }
    } catch (traceErr) {
      // Trace errors must never crash the call
      logger.warn('[TRACE ERROR] SPEAKER_OWNER_TRACE_V1 failed (call continues)', { error: traceErr.message });
    }
    
    // 📼 BLACK BOX V2: Log agent response with full source tracking
    if (BlackBoxLogger) {
      const responseText = result.response || result.text || '';
      const matchSource = result.matchSource || 'UNKNOWN';
      const tier = result.tier || 'tier3';
      const tokensUsed = result.tokensUsed || result.debug?.tokensUsed || 0;
      
      BlackBoxLogger.QuickLog.responseBuilt(
        callSid,
        companyID,
        turnCount,
        responseText,
        matchSource,  // V2: Separate source field
        tier,         // V2: Tier field (tier1, tier2, tier3)
        tokensUsed    // V2: Token count for cost tracking
      ).catch(() => {});
      
      // Add to transcript with source tracking and token cost
      BlackBoxLogger.addTranscript({
        callId: callSid,
        companyId: companyID,
        speaker: 'agent',
        turn: turnCount,
        text: responseText,
        source: `${matchSource}:${tier}`,  // V2: Combined source:tier
        tokensUsed: tokensUsed || 0         // V76: Token cost tracking
      }).catch(() => {});
      
      // V2: Log tier-specific events with detailed tracking
      if (tier === 'tier3' || matchSource === 'LLM_FALLBACK') {
        // Log that no scenario matched FIRST (helps debug what was tried)
        BlackBoxLogger.QuickLog.scenarioNoMatch(
          callSid, companyID, turnCount,
          speechResult || '[unknown input]',  // speechResult is already cleaned
          result.debug?.bestCandidate || null,
          result.debug?.bestConfidence || 0,
          result.debug?.matchThreshold || 0.7,
          result.debug?.fallbackReason || 'no_scenario_match'
        ).catch(() => {});
        
        // Then log the LLM fallback
        BlackBoxLogger.QuickLog.tier3Fallback(
          callSid, companyID, turnCount,
          result.debug?.fallbackReason || 'no_scenario_match',
          result.debug?.latencyMs || result.latencyMs || 0,
          tokensUsed
        ).catch(() => {});
      } else if (matchSource === 'SCENARIO_MATCH' || matchSource === 'STATE_MACHINE' || matchSource === 'SCENARIO_MATCHED') {
        BlackBoxLogger.QuickLog.scenarioMatched(
          callSid, companyID, turnCount,
          result.debug?.scenarioId || null,
          result.debug?.scenarioName || matchSource,
          tier,
          result.debug?.confidence || 0.9,
          result.debug?.matchReason || 'rule_match',
          result.debug?.latencyMs || 0
        ).catch(() => {});
      }
      
      // Legacy: Log triage decision if present
      if (result.triageCardMatched) {
        BlackBoxLogger.QuickLog.triageDecision(
          callSid, companyID, turnCount,
          result.action || 'MESSAGE_ONLY',
          result.triageCardId,
          result.triageCardMatched
        ).catch(() => {});
      }
      
      // ═══════════════════════════════════════════════════════════════════
      // V77: CALLER CLASSIFICATION (First 2 turns only)
      // ═══════════════════════════════════════════════════════════════════
      // Detect if caller is customer, vendor, commercial, etc.
      // Updates CallSummary.cardData for Call Center dashboard
      // ═══════════════════════════════════════════════════════════════════
      if (turnCount <= 2 && speechResult) {
        try {
          const { classifyCaller, buildCardData } = require('../services/CallerClassificationService');
          
          const classification = await classifyCaller({
            companyId: companyID,
            phone: fromNumber,
            userText: speechResult,
            existingClassification: callState?.callerClassification || null,
            customerLookupResult: callState?.customerContext ? {
              customer: { _id: callState.customerId, name: callState.customerContext },
              isReturning: callState.isReturning
            } : null
          });
          
          // Update call state
          callState.callerClassification = classification;
          if (classification.type === 'vendor') {
            callState.callerType = 'vendor';
            callState.vendorId = classification.vendorId;
          }
          
          // Update CallSummary with classification and card data
          if (classification.type && classification.confidence > 0.5) {
            const cardData = buildCardData(classification, {
              summary: result.debug?.discoveryIssue || null,
              intent: result.debug?.intent || null,
              urgency: result.debug?.urgency || 'normal',
              outcome: null
            });
            
            const CallSummary = require('../models/CallSummary');
            await CallSummary.updateOne(
              { $or: [{ callId: callSid }, { twilioCallSid: callSid }] },
              {
                $set: {
                  callerType: classification.type,
                  callerSubType: classification.subType,
                  vendorId: classification.vendorId || null,
                  'cardData.headline': cardData.headline,
                  'cardData.brief': cardData.brief,
                  'cardData.color': cardData.color,
                  'cardData.tags': cardData.tags,
                  'cardData.vendorType': cardData.vendorType,
                  'cardData.reference': cardData.reference,
                  'cardData.linkedCustomerName': cardData.linkedCustomerName,
                  'aiExtracted.intent': classification.detectedInfo?.intent || null,
                  'aiExtracted.poNumber': classification.detectedInfo?.poNumber || null,
                  'aiExtracted.relatedCustomerName': classification.detectedInfo?.customerName || null
                }
              }
            ).catch(() => {});
            
            logger.info('[CALLER CLASSIFICATION] 🏷️ Caller classified', {
              callSid,
              type: classification.type,
              subType: classification.subType,
              vendorName: classification.vendorName || null,
              confidence: classification.confidence
            });
          }
        } catch (classifyErr) {
          // Non-blocking
          logger.debug('[CALLER CLASSIFICATION] Classification failed (non-fatal)', { 
            callSid, 
            error: classifyErr.message 
          });
        }
      }
      
      if (result.shouldTransfer) {
        BlackBoxLogger.QuickLog.transferInitiated(
          callSid, companyID, turnCount,
          result.transferTarget || 'unknown',
          result.transferReason || 'user request'
        ).catch(() => {});
      }
      
      if (result.loopDetected) {
        BlackBoxLogger.QuickLog.loopDetected(
          callSid, companyID, turnCount
        ).catch(() => {});
      }
      
      if (result.bailout) {
        BlackBoxLogger.QuickLog.bailoutTriggered(
          callSid, companyID, turnCount,
          result.bailoutType || 'unknown',
          result.bailoutReason || 'no usable response'
        ).catch(() => {});
      }
    }
    
    // Handle different response types
    
    // ════════════════════════════════════════════════════════════════════════════
    // V111: CATASTROPHIC FALLBACK - DTMF Menu when everything fails
    // ════════════════════════════════════════════════════════════════════════════
    if (result.conversationMode === 'catastrophic_fallback' && result.catastrophicFallback?.enabled) {
      logger.warn('🚨 CHECKPOINT 17A: CATASTROPHIC FALLBACK - Generating DTMF menu', {
        callSid,
        forwardNumber: result.catastrophicFallback.forwardNumber?.replace(/\d(?=\d{4})/g, '*'),
        option2Action: result.catastrophicFallback.option2Action
      });
      
      // Generate TwiML with DTMF gather
      const catastrophicAnnouncement = result.catastrophicFallback.announcement || 
        "We're experiencing technical difficulties. Press 1 to speak with a representative, or press 2 to leave a message.";
      
      // Use ElevenLabs for announcement if configured
      const elevenLabsVoice = company?.aiAgentSettings?.voiceSettings?.voiceId;
      
      // V111 FIX: Explicitly set input="dtmf" to ensure ONLY keypad presses
      // are captured. Without this, Twilio defaults to "dtmf speech" which can
      // capture speech input ("one") instead of the digit press, causing Digits
      // to be undefined in the handler and the forward to fail.
      const gather = twiml.gather({
        input: 'dtmf',
        numDigits: 1,
        action: `${getSecureBaseUrl(req)}/api/twilio/catastrophic-dtmf/${companyID}`,
        method: 'POST',
        timeout: 10
      });
      
      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: catastrophicAnnouncement,
            voiceId: elevenLabsVoice,
            stability: company?.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company?.aiAgentSettings?.voiceSettings?.similarityBoost,
            company
          });
          const fileName = `catastrophic_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) { fs.mkdirSync(audioDir, { recursive: true }); }
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          const audioUrl = `${getSecureBaseUrl(req)}/audio/${fileName}`;
          gather.play(audioUrl);
        } catch (err) {
          logger.error('ElevenLabs catastrophic TTS failed, using Say:', err);
          gather.say(escapeTwiML(catastrophicAnnouncement));
        }
      } else {
        gather.say(escapeTwiML(catastrophicAnnouncement));
      }
      
      // If no input, repeat the message
      twiml.say(escapeTwiML("I didn't receive a response. Please call back or try again later."));
      twiml.hangup();
      
      // Store catastrophic fallback config in Redis for the DTMF handler
      try {
        const { getSharedRedisClient } = require('../services/redisClientFactory');
        const redisClient = await getSharedRedisClient();
        if (redisClient) {
          await redisClient.setEx(`catastrophic:${callSid}`, 300, JSON.stringify({
            forwardNumber: result.catastrophicFallback.forwardNumber,
            option2Action: result.catastrophicFallback.option2Action,
            companyId: companyID,
            // V111 FIX: Store the Twilio number so the DTMF handler can use it
            // as callerId for outbound Dial (Twilio requires a number owned by the account)
            twilioNumber: req.body.To || ''
          }));
        }
      } catch (redisErr) {
        logger.error('Failed to store catastrophic config in Redis', { error: redisErr.message });
      }
      
      // BlackBox logging
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'CATASTROPHIC_DTMF_MENU_SENT',
          turn: turnCount,
          data: {
            announcement: catastrophicAnnouncement.substring(0, 100),
            forwardNumber: result.catastrophicFallback.forwardNumber?.replace(/\d(?=\d{4})/g, '*'),
            option2Action: result.catastrophicFallback.option2Action
          }
        }).catch(() => {});
      }
      
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    
    if (result.shouldHangup) {
      logger.info('🎯 CHECKPOINT 17: AI decided to hang up');
      logger.info(`🗣️ Final message: "${result.text}"`);
      twiml.say(escapeTwiML(result.text));
      twiml.hangup();
      
      // 📼 BLACK BOX: Finalize call on hangup
      if (BlackBoxLogger) {
        BlackBoxLogger.finalizeCall({
          callId: callSid,
          companyId: companyID,
          callOutcome: 'COMPLETED'
        }).catch(() => {});
      }
    } else if (result.shouldTransfer) {
      logger.info('🎯 CHECKPOINT 18: AI decided to transfer call');
      logger.info(`🗣️ Transfer message: "${result.text}"`);
      
      // Get company transfer number and check if transfer is enabled
      // 🔧 PHASE 2 FIX: Use consistent company loading
      const company = await Company.findById(companyID)
        .select('+aiAgentSettings')
        .lean();
      
      // 🎤 FIX: Use ElevenLabs for transfer message, not Twilio <Say>
      const elevenLabsVoice = company?.aiAgentSettings?.voiceSettings?.voiceId;
      const transferMessage = result.text || "I'm connecting you to our team.";
      
      if (elevenLabsVoice && transferMessage) {
        try {
          logger.info(`🎤 V2 ELEVENLABS: Generating transfer message with voice ${elevenLabsVoice}`);
          const buffer = await synthesizeSpeech({
            text: transferMessage,
            voiceId: elevenLabsVoice,
            stability: company?.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company?.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company?.aiAgentSettings?.voiceSettings?.styleExaggeration,
            model_id: company?.aiAgentSettings?.voiceSettings?.aiModel,
            company
          });
          // Save audio file and play it
          const fileName = `transfer_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) { fs.mkdirSync(audioDir, { recursive: true }); }
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          const audioUrl = `${getSecureBaseUrl(req)}/audio/${fileName}`;
          twiml.play(audioUrl);
          logger.info(`🎤 V2 ELEVENLABS: Transfer message audio generated: ${audioUrl}`);
        } catch (err) {
          logger.error('❌ ElevenLabs transfer TTS failed, using Say fallback:', err);
          twiml.say(escapeTwiML(transferMessage));
        }
      } else {
        // Fallback to Twilio Say if no voice configured
        twiml.say(escapeTwiML(transferMessage));
      }
      
      logger.info('🎯 CHECKPOINT 19: Calling handleTransfer function');
      // Pass null for fallbackMessage since we already spoke the transfer message above
      handleTransfer(twiml, company, null, companyID);
      
      // 📼 BLACK BOX: Finalize call on transfer
      if (BlackBoxLogger) {
        BlackBoxLogger.finalizeCall({
          callId: callSid,
          companyId: companyID,
          callOutcome: 'TRANSFERRED'
        }).catch(() => {});
      }
    } else {
      logger.info('🎯 CHECKPOINT 20: AI continuing conversation');
      logger.info(`🗣️ AI Response: "${result.response}"`);
      
      // 🎤 V2 ELEVENLABS INTEGRATION: Use ElevenLabs if configured
      // 🔧 PHASE 2 FIX: Explicitly load voice settings + frontDeskBehavior for forbidden phrases
      const company = await Company.findById(companyID)
        .select('+aiAgentSettings +frontDeskBehavior')
        .lean();
      
      // 🎯 PHASE 2 DIAGNOSTIC: Enhanced voice settings debug
      console.log('═'.repeat(80));
      console.log('[🔍 VOICE DEBUG] Second leg company load:');
      console.log('Company exists:', Boolean(company));
      console.log('Company ID:', company?._id?.toString());
      console.log('aiAgentSettings exists:', Boolean(company?.aiAgentSettings));
      console.log('voiceSettings exists:', Boolean(company?.aiAgentSettings?.voiceSettings));
      console.log('voiceId:', company?.aiAgentSettings?.voiceSettings?.voiceId || 'UNDEFINED');
      console.log('Full voiceSettings:', JSON.stringify(company?.aiAgentSettings?.voiceSettings, null, 2));
      console.log('═'.repeat(80));
      
      // 🔍 DIAGNOSTIC: Log voice settings check
      logger.info('🔍 V2 VOICE CHECK: Company loaded:', Boolean(company));
      logger.info('🔍 V2 VOICE CHECK: aiAgentSettings exists:', Boolean(company?.aiAgentSettings));
      logger.info('🔍 V2 VOICE CHECK: voiceSettings exists:', Boolean(company?.aiAgentSettings?.voiceSettings));
      logger.info('🔍 V2 VOICE CHECK: Full voiceSettings:', JSON.stringify(company?.aiAgentSettings?.voiceSettings, null, 2));
      
      const elevenLabsVoice = company?.aiAgentSettings?.voiceSettings?.voiceId;
      logger.info('🔍 V2 VOICE CHECK: Extracted voiceId:', elevenLabsVoice || 'NOT FOUND');
      
      // 🎯 PHASE A – STEP 3B: Check for follow-up mode (TRANSFER handling)
      const followUp = result.metadata?.followUp || { mode: 'NONE' };
      const followUpMode = followUp.mode || 'NONE';
      
      // 🎯 PHASE A – STEP 3B: Handle TRANSFER mode separately
      if (followUpMode === 'TRANSFER') {
        const transferTarget = (followUp.transferTarget || '').trim();
        
        if (!transferTarget) {
          logger.warn('[TWILIO] followUp mode TRANSFER configured but transferTarget is missing', {
            companyId: companyID,
            callSid: callSid,
            scenarioId: result.metadata?.scenarioId,
            scenarioName: result.metadata?.scenarioName
          });
          // Fallback: continue as normal, just speak mainText
          logger.info('🎯 CHECKPOINT 20A: TRANSFER mode but no target, continuing as NONE');
        } else {
          // Handle transfer using existing logic
          logger.info('🎯 CHECKPOINT 20A: TRANSFER mode with target, initiating transfer', {
            transferTarget,
            mainText: (result.response || result.text || '').substring(0, 50)
          });

          // Persist transfer initiation for KPI/containment (status-callback often reports "completed")
          try {
            const CallSummary = require('../models/CallSummary');
            await CallSummary.updateLiveProgress(callSid, {
              kpi: {
                transferInitiated: true,
                bucket: 'TRANSFER'
              }
            });
          } catch (e) {
            logger.warn('[TWILIO] Failed to mark transferInitiated on CallSummary (non-fatal)', {
              callSid,
              error: e.message
            });
          }
          
          const mainText = result.response || result.text;
          if (mainText && mainText.trim()) {
            twiml.say(escapeTwiML(mainText));
          }
          
          // Use existing transfer/handoff logic
          handleTransfer(twiml, company, null, companyID, transferTarget);
          
          logger.info('📤 CHECKPOINT 22A: Sending TRANSFER TwiML response to Twilio');
          const twimlString = twiml.toString();
          logger.info('📋 TwiML Content (TRANSFER):', twimlString);

          // Cache for Twilio retries (idempotency)
          try {
            const redisClient = await getRedis();
            if (redisClient) {
              await redisClient.setEx(turnCacheKey, 180, twimlString);
            }
          } catch {}

          return res.type('text/xml').send(twimlString);
        }
      }
      
      // ════════════════════════════════════════════════════════════════════════
      // 🎯 RUNTIME EXECUTION: Action Hooks, Effects, and Timed Follow-Up
      // ════════════════════════════════════════════════════════════════════════
      
      // 1. Execute Action Hooks (if any)
      const actionHooks = result.metadata?.actionHooks || [];
      if (actionHooks.length > 0) {
        try {
          const ActionHookExecutor = require('../services/ActionHookExecutor');
          const hookResults = await ActionHookExecutor.executeHooks(actionHooks, {
            callId: callSid,
            companyId: companyID,
            scenarioId: result.metadata?.scenarioId,
            conversationState: callState || {}
          });
          
          // Store hook flags in call state for later use
          if (hookResults.flags && Object.keys(hookResults.flags).length > 0) {
            if (!callState) callState = {};
            callState.hookFlags = { ...callState.hookFlags, ...hookResults.flags };
            
            // Persist to Redis
            const redisClient = await getRedis();
            if (redisClient) {
              await redisClient.setEx(`call:state:${callSid}`, 3600, JSON.stringify(callState));
            }
          }
          
          logger.info(`⚡ [HOOKS] Executed ${hookResults.executed.length} hooks`, {
            callSid,
            flags: hookResults.flags
          });
        } catch (hookError) {
          logger.error(`❌ [HOOKS] Error executing hooks`, { callSid, error: hookError.message });
        }
      }
      
      // 2. Apply State Effects (if any)
      const effects = result.metadata?.effects || {};
      if (effects && Object.keys(effects).length > 0) {
        try {
          const StateEffectsProcessor = require('../services/StateEffectsProcessor');
          const effectResult = StateEffectsProcessor.applyEffects(effects, callState || {}, {
            callId: callSid,
            scenarioId: result.metadata?.scenarioId
          });
          
          if (!effectResult.unchanged) {
            callState = effectResult.state;
            
            // Persist updated state to Redis
            const redisClient = await getRedis();
            if (redisClient) {
              await redisClient.setEx(`call:state:${callSid}`, 3600, JSON.stringify(callState));
            }
            
            logger.info(`🔄 [EFFECTS] Applied ${effectResult.applied.length} state effects`, {
              callSid,
              applied: effectResult.applied.map(a => a.key)
            });
          }
        } catch (effectError) {
          logger.error(`❌ [EFFECTS] Error applying effects`, { callSid, error: effectError.message });
        }
      }
      
      // 3. Schedule Timed Follow-Up (if enabled)
      const timedFollowUp = result.metadata?.timedFollowUp;
      if (timedFollowUp && timedFollowUp.enabled) {
        try {
          const TimedFollowUpManager = require('../services/TimedFollowUpManager');
          TimedFollowUpManager.scheduleFollowUp(callSid, timedFollowUp, {
            companyId: companyID,
            scenarioId: result.metadata?.scenarioId
          }, async (followUpData) => {
            // This callback fires when the timer triggers
            logger.info(`⏰ [TIMED FOLLOWUP] Timer fired for call ${callSid}`, {
              message: followUpData.message,
              attemptCount: followUpData.attemptCount
            });
            
            // Log to BlackBox for tracking
            if (BlackBoxLogger) {
              BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'TIMED_FOLLOWUP_TRIGGERED',
                data: {
                  message: followUpData.message,
                  attemptCount: followUpData.attemptCount,
                  scenarioId: result.metadata?.scenarioId
                }
              }).catch(() => {});
            }
          });
          
          logger.info(`⏰ [TIMED FOLLOWUP] Scheduled for call ${callSid}`, {
            delaySeconds: timedFollowUp.delaySeconds,
            messagesCount: timedFollowUp.messages?.length || 0
          });
        } catch (timedError) {
          logger.error(`❌ [TIMED FOLLOWUP] Error scheduling`, { callSid, error: timedError.message });
        }
      }
      
      // ════════════════════════════════════════════════════════════════════════
      
      // 🎯 PHASE A – STEP 3B: Build response text with follow-up question (if ASK_FOLLOWUP_QUESTION or ASK_IF_BOOK)
      let responseText = result.response || result.text || "";
      
      // ════════════════════════════════════════════════════════════════════════
      // 🛡️ SAFETY NET: Prevent empty/generic responses that cause Twilio fallback
      // ════════════════════════════════════════════════════════════════════════
      if (!responseText || responseText.trim().length < 10) {
        logger.warn('[TWILIO] ⚠️ Empty or too-short response detected - using safety fallback');
        // 🚨 UI-CONTROLLED: Use recovery message from database
        responseText = company?.aiAgentSettings?.llm0Controls?.recoveryMessages?.silenceRecovery 
          || "I'm here — go ahead, I'm listening. How can I help you today?";
        
        if (BlackBoxLogger) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'SAFETY_FALLBACK_TRIGGERED',
            data: { 
              reason: 'Empty or too-short response',
              originalResponse: result.response || result.text || null,
              turnCount 
            }
          }).catch(() => {});
        }
      }
      
      // 🛡️ Filter out forbidden/robotic phrases
      // 100% UI-CONTROLLED - No hardcoded defaults. You control the full list.
      // If you want certain phrases blocked, add them in the UI.
      // If you delete them from UI, they're gone.
      const forbiddenPhrases = company?.frontDeskBehavior?.forbiddenPhrases || [];
      
      logger.debug('[TWILIO] 🚫 Forbidden phrases from UI', {
        companyId: companyID,
        count: forbiddenPhrases.length,
        phrases: forbiddenPhrases.slice(0, 5) // Log first 5
      });
      
      const lowerResponse = responseText.toLowerCase();
      for (const phrase of forbiddenPhrases) {
        if (phrase && lowerResponse.includes(phrase.toLowerCase())) {
          logger.warn(`[TWILIO] ⚠️ Forbidden phrase detected: "${phrase}" - replacing response`);
          
          // 📼 BLACK BOX: Log forbidden phrase caught
          if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'FORBIDDEN_PHRASE_CAUGHT',
              data: {
                phrase: phrase,
                originalResponse: responseText.substring(0, 100),
                source: 'UI_CONFIGURED'
              }
            }).catch(() => {});
          }
          
          // 🚨 Use UI-configured question for forbidden phrase replacement
          const HybridReceptionistLLM = require('../services/HybridReceptionistLLM');
          const frontDeskConfig = company?.aiAgentSettings?.frontDeskBehavior || {};
          const nameQ = HybridReceptionistLLM.getSlotPrompt('name', frontDeskConfig);
          responseText = `I can definitely help with that! ${nameQ}`;
          break;
        }
      }
      
      responseText = buildFollowUpAwareText(responseText, followUp);
      
      if (followUpMode === 'ASK_FOLLOWUP_QUESTION' || followUpMode === 'ASK_IF_BOOK') {
        logger.info(`[TWILIO] Follow-up mode applied: ${followUpMode}`, {
          mainText: result.response?.substring(0, 50),
          finalText: responseText.substring(0, 100)
        });
      }
      
      // ════════════════════════════════════════════════════════════════════════
      // V86 P1: ENFORCE SHORT VOICE RESPONSES
      // ════════════════════════════════════════════════════════════════════════
      // Long chatty responses cause:
      // - Longer TTS generation (scales with length)
      // - Dead air while playing
      // - Caller can't interrupt (if bargeIn=false)
      // 
      // Pattern: "Ack + Question" (1-2 sentences max, under 180 chars)
      // ════════════════════════════════════════════════════════════════════════
      const originalLength = responseText.length;
      responseText = enforceVoiceResponseLength(responseText, 180, true);
      
      if (responseText.length < originalLength) {
        logger.info(`[V86 SHORT RESPONSE] Truncated: ${originalLength} → ${responseText.length} chars`);
        
        if (BlackBoxLogger) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'RESPONSE_TRUNCATED_FOR_SPEED',
            data: {
              originalLength,
              truncatedLength: responseText.length,
              reason: 'V86 short voice response policy'
            }
          }).catch(() => {});
        }
      }
      
      // ════════════════════════════════════════════════════════════════════════
      // V86 P0: ALWAYS SANITIZE TEXT BEFORE TTS
      // ════════════════════════════════════════════════════════════════════════
      // Ensures we never speak UI artifacts like:
      //   "What's your name 3?" / "Did I get that right 1?" / etc.
      // Also normalizes phone/address pronunciation for voice.
      responseText = cleanTextForTTS(stripMarkdown(responseText));

      logger.info('🔍 V2 VOICE CHECK: Response text:', responseText);
      logger.info('🔍 V2 VOICE CHECK: Will use ElevenLabs:', Boolean(elevenLabsVoice && responseText));
      
      if (elevenLabsVoice && responseText) {
        try {
          logger.info(`🎤 V2 ELEVENLABS: Using voice ${elevenLabsVoice} for response`);
          
          // 📼 BLACK BOX: Log TTS started for agent response
          if (BlackBoxLogger) {
            BlackBoxLogger.QuickLog.ttsStarted(
              callSid,
              companyID,
              turnCount,
              elevenLabsVoice,
              responseText.length
            ).catch(() => {});
          }
          
          // Generate ElevenLabs audio
          const ttsStart = Date.now();
          const { synthesizeSpeech } = require('../services/v2elevenLabsService');
          
          // 🎯 TTS OVERRIDE: Apply scenario-level voice settings if present
          const ttsOverride = result.metadata?.ttsOverride || {};
          const baseVoiceSettings = company.aiAgentSettings?.voiceSettings || {};
          
          // Map scenario ttsOverride to ElevenLabs parameters
          // ttsOverride: { rate: '1.1', pitch: '+5%', volume: 'normal' }
          // ElevenLabs: { stability, similarity_boost, style, use_speaker_boost }
          let stability = baseVoiceSettings.stability;
          let similarity_boost = baseVoiceSettings.similarityBoost;
          let style = baseVoiceSettings.styleExaggeration;
          
          // Apply rate override (maps to stability - slower = more stable)
          if (ttsOverride.rate) {
            const rate = parseFloat(ttsOverride.rate);
            if (!isNaN(rate)) {
              // Rate 0.8 (slow) → higher stability, Rate 1.2 (fast) → lower stability
              stability = Math.max(0.2, Math.min(0.9, (1.5 - rate) * 0.5 + 0.3));
            }
          }
          
          // Apply stability override directly if provided as number
          if (typeof ttsOverride.stability === 'number') {
            stability = ttsOverride.stability;
          }
          
          // Apply similarity override directly if provided
          if (typeof ttsOverride.similarity === 'number') {
            similarity_boost = ttsOverride.similarity;
          }
          
          if (Object.keys(ttsOverride).length > 0) {
            logger.info(`🎤 [TTS OVERRIDE] Applying scenario overrides`, {
              callSid,
              scenarioId: result.metadata?.scenarioId,
              overrides: ttsOverride,
              computedStability: stability
            });
          }
          
          const audioBuffer = await synthesizeSpeech({
            text: responseText,
            voiceId: elevenLabsVoice,
            stability: stability,
            similarity_boost: similarity_boost,
            style: style,
            use_speaker_boost: baseVoiceSettings.speakerBoost,
            model_id: baseVoiceSettings.aiModel,
            company  // ✅ CRITICAL FIX: Pass company object for API key lookup
          });
          perfCheckpoints.ttsGeneration = Date.now() - ttsStart;
          
          const timestamp = Date.now();
          let audioUrl;
          let storageMethod = 'unknown';
          
          // 🔥 CRITICAL FIX: Fallback to disk if Redis unavailable
          const storageStart = Date.now();
          const audioRedis = await getRedis();
          if (audioRedis) {
            // Store audio in Redis for serving (preferred method)
            const audioKey = `audio:v2:${callSid}_${timestamp}`;
            await audioRedis.setEx(audioKey, 300, audioBuffer.toString('base64'));
            audioUrl = `https://${req.get('host')}/api/twilio/audio/v2/${callSid}_${timestamp}`;
            storageMethod = 'Redis';
            logger.info(`✅ V2 ELEVENLABS: Audio stored in Redis at ${audioUrl}`);
          } else {
            // Fallback: Save to disk if Redis is unavailable
            const fileName = `ai_response_${timestamp}.mp3`;
            const audioDir = path.join(__dirname, '../public/audio');
            if (!fs.existsSync(audioDir)) {
              fs.mkdirSync(audioDir, { recursive: true });
            }
            const filePath = path.join(audioDir, fileName);
            fs.writeFileSync(filePath, audioBuffer);
            audioUrl = `${getSecureBaseUrl(req)}/audio/${fileName}`;
            storageMethod = 'Disk (Redis unavailable)';
            logger.warn(`⚠️ V2 ELEVENLABS: Redis unavailable, saved to disk at ${audioUrl}`);
          }
          perfCheckpoints.audioStorage = Date.now() - storageStart;
          perfCheckpoints.storageMethod = storageMethod;
          
          // 📼 BLACK BOX: Log TTS completed for agent response
          if (BlackBoxLogger) {
            BlackBoxLogger.QuickLog.ttsCompleted(
              callSid,
              companyID,
              turnCount,
              elevenLabsVoice,
              perfCheckpoints.ttsGeneration
            ).catch(() => {});
          }
          
          twiml.play(audioUrl);
          
        } catch (elevenLabsError) {
          logger.error('❌ V2 ELEVENLABS: Failed, falling back to Twilio voice:', {
            error: elevenLabsError.message,
            stack: elevenLabsError.stack,
            voiceId: elevenLabsVoice,
            responseTextLength: responseText?.length,
            hasCompany: !!company
          });
          
          // 📼 BLACK BOX: Log TTS failure
          if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'TTS_FAILED',
              turn: turnCount,
              data: {
                error: elevenLabsError.message?.substring(0, 200),
                voiceId: elevenLabsVoice,
                textLength: responseText?.length,
                fallback: 'TWILIO_SAY'
              }
            }).catch(() => {});
          }
          
          // Fallback to Twilio voice
          twiml.say({
            voice: result.controlFlags?.tone === 'robotic' ? 'Polly.Joanna' : 'Polly.Matthew'
          }, escapeTwiML(responseText));
        }
      } else {
        // Use Twilio voice as fallback
        logger.info('🎤 V2 FALLBACK: Using Twilio voice (no ElevenLabs configured)');
        
        // 📼 BLACK BOX: Log Twilio fallback voice used
        if (BlackBoxLogger) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'TWILIO_VOICE_FALLBACK',
            turn: turnCount,
            data: {
              reason: !elevenLabsVoice ? 'no_voice_configured' : 'no_response_text',
              textLength: responseText?.length || 0
            }
          }).catch(() => {});
        }
        
        twiml.say({
          voice: result.controlFlags?.tone === 'robotic' ? 'Polly.Joanna' : 'Polly.Matthew'
        }, escapeTwiML(responseText));
      }
      
      logger.info('🎯 CHECKPOINT 21: Setting up next speech gathering');
      // Set up next gather - using configurable speech detection settings
      const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      
      // 🎤 Build STT hints from template vocabulary
      const templateId = company.aiAgentSettings?.templateReferences?.[0]?.templateId;
      const sttHints = await STTHintsBuilder.buildHints(templateId, company);
      
      // 📦 BLACK BOX: Log STT hints loaded (first turn only to avoid spam)
      if (BlackBoxLogger && sttHints && !callState.sttHintsLogged) {
        try {
          BlackBoxLogger.logEvent({
            callId: callState?.CallSid || callState?.callId,
            companyId: companyID,
            type: 'STT_HINTS_LOADED',
            data: {
              templateId: templateId || 'none',
              hintsCount: sttHints.split(',').length,
              hintsPreview: sttHints.substring(0, 200),
              source: templateId ? 'STT_PROFILE' : 'COMPANY_FALLBACK'
            }
          });
          callState.sttHintsLogged = true;
        } catch (logErr) {
          logger.debug('[V2 TWILIO] Failed to log STT hints to Black Box');
        }
      }
      
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10 seconds (default: 3s)
        speechModel: speechDetection.speechModel ?? 'phone_call',
        bargeIn: speechDetection.bargeIn ?? false,
        timeout: speechDetection.initialTimeout ?? 5,
        enhanced: speechDetection.enhancedRecognition ?? true,
        action: `/api/twilio/v2-agent-respond/${companyID}`,
        method: 'POST',
        hints: sttHints  // 🎤 Template-specific vocabulary for better STT accuracy
      });
      
      gather.say('');
      
      // 🚫 NEVER HANG UP - Just redirect, silence handler will manage prompts
      // FEB 2026 FIX: Removed Polly.Matthew voice - was causing "creepy voice" issue
      // The SILENCE_HANDLER in ConversationEngine handles prompts via ElevenLabs
      twiml.redirect(`/api/twilio/v2-agent-respond/${companyID}`);
    }
    
    const twimlString = twiml.toString();
    logger.info('📤 CHECKPOINT 22: Sending TwiML response to Twilio');
    logger.info('📋 TwiML Content:', twimlString);

    // Cache for Twilio retries (idempotency)
    try {
      const redisClient = await getRedis();
      if (redisClient) {
        await redisClient.setEx(turnCacheKey, 180, twimlString);
      }
    } catch {}
    
    // 🎯 COMPREHENSIVE PERFORMANCE SUMMARY
    const totalTime = Date.now() - perfStart;
    perfCheckpoints.total = totalTime;
    
    // Calculate percentages
    const aiPercent = ((perfCheckpoints.aiProcessing / totalTime) * 100).toFixed(1);
    const ttsPercent = perfCheckpoints.ttsGeneration ? ((perfCheckpoints.ttsGeneration / totalTime) * 100).toFixed(1) : 0;
    const storagePercent = perfCheckpoints.audioStorage ? ((perfCheckpoints.audioStorage / totalTime) * 100).toFixed(1) : 0;
    
    console.log('\n' + '═'.repeat(80));
    console.log('🎯 TWILIO CALL PERFORMANCE BREAKDOWN');
    console.log('═'.repeat(80));
    console.log(`📞 User Said: "${speechResult.substring(0, 60)}${speechResult.length > 60 ? '...' : ''}"`);
    console.log(`🤖 AI Response: "${(result.response || result.text || '').substring(0, 60)}..."`);
    console.log(`⏱️  TOTAL TIME: ${totalTime}ms`);
    console.log('');
    console.log('📊 TIME BREAKDOWN:');
    console.log(`   ├─ Call State Init: ${perfCheckpoints.callStateInit}ms`);
    console.log(`   ├─ AI Processing: ${perfCheckpoints.aiProcessing}ms (${aiPercent}%)`);
    if (perfCheckpoints.ttsGeneration) {
      console.log(`   ├─ ElevenLabs TTS: ${perfCheckpoints.ttsGeneration}ms (${ttsPercent}%) ⚠️ BOTTLENECK`);
      console.log(`   ├─ Audio Storage: ${perfCheckpoints.audioStorage}ms (${storagePercent}%) [${perfCheckpoints.storageMethod}]`);
      if (perfCheckpoints.storageMethod.includes('Disk')) {
        console.log(`   │  └─ ⚠️ WARNING: Redis unavailable, using disk fallback`);
      }
    } else {
      console.log(`   ├─ Voice: Twilio (no ElevenLabs)`);
    }
    console.log(`   └─ TwiML Generation: <1ms`);
    console.log('');
    console.log('💡 PERFORMANCE INSIGHTS:');
    if (perfCheckpoints.ttsGeneration && perfCheckpoints.ttsGeneration > 1500) {
      console.log('   • ElevenLabs TTS (~1.8s) is the main bottleneck - THIS IS NORMAL');
      console.log('   • High-quality voice synthesis requires this time');
    }
    if (perfCheckpoints.aiProcessing < 700) {
      console.log('   • ✅ AI Brain is performing excellently (<700ms)');
    }
    if (perfCheckpoints.storageMethod && perfCheckpoints.storageMethod.includes('Disk')) {
      console.log('   • ⚠️ Redis is down - investigate connection issue');
      console.log('   • Disk fallback working, but Redis would be faster');
    }
    console.log('═'.repeat(80) + '\n');
    
    tracer.step('TWIML_SEND', `Sending TwiML (${twimlString.length} bytes)`, {
      hasGather: twimlString.includes('<Gather'),
      hasHangup: twimlString.includes('<Hangup'),
      hasDial: twimlString.includes('<Dial')
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V99: DECISION_TRACE - Emit what config keys were used this turn
    // ═══════════════════════════════════════════════════════════════════════════
    // Platform Law: Every turn must prove what config it used
    // This enables "If it's not on Front Desk UI, it does not exist" enforcement
    // ═══════════════════════════════════════════════════════════════════════════
    if (ControlPlaneEnforcer && BlackBoxLogger) {
      const decisionTrace = ControlPlaneEnforcer.finalizeTrace(callSid, turnCount);
      if (decisionTrace) {
        BlackBoxLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'DECISION_TRACE',
          turn: turnCount,
          data: {
            keysUsed: decisionTrace.keysUsed,
            sourcesUsed: decisionTrace.sourcesUsed,
            decisionReasons: decisionTrace.decisionReasons,
            modeChanges: decisionTrace.modeChanges,
            violations: decisionTrace.violations,
            durationMs: decisionTrace.durationMs
          }
        }).catch(() => {});
      }
    }
    
    res.type('text/xml');
    res.send(twimlString);
    
    logger.info('✅ CHECKPOINT 23: Response sent successfully', { perfCheckpoints });
    
  } catch (error) {
    const tracer = getTracer(req.body.CallSid, req.params.companyID);
    tracer.error('AI Agent Respond failed', error);
    
    logger.error('❌ CHECKPOINT ERROR: AI Agent Respond error:', error);
    logger.error('❌ Error stack:', error.stack);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 📼 BLACK BOX: CRITICAL ERROR LOGGING (Feb 2026)
    // This was missing - errors were swallowed without visibility!
    // ═══════════════════════════════════════════════════════════════════════════
    if (BlackBoxLogger) {
      try {
        await BlackBoxLogger.logEvent({
          callId: req.body.CallSid || 'UNKNOWN',
          companyId: req.params.companyID || 'UNKNOWN',
          type: 'PIPELINE_ERROR',
          data: {
            error: error.message,
            errorType: error.name || 'Error',
            stack: error.stack?.substring(0, 500),
            speechResult: (req.body.SpeechResult || '').substring(0, 200),
            phase: 'v2-agent-respond',
            turnCount: req.body.turnCount || 'unknown',
            recovery: 'FALLBACK_TRANSFER'
          }
        });
      } catch (bbErr) {
        logger.warn('[BLACKBOX] Failed to log pipeline error', { error: bbErr.message });
      }
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Try to get the company and check if transfer is enabled
    try {
      const { companyID } = req.params;
      const company = await Company.findById(companyID);
      
      logger.info('🎯 CHECKPOINT ERROR RECOVERY: Attempting graceful error handling');
      
      // 🔥 Minimal error message - no generic empathy or explanation
      const errorResponse = `I'm connecting you to our team.`;
      
      twiml.say(errorResponse);
      handleTransfer(twiml, company, "Our team will be happy to assist you.", companyID);
      
      // 📼 BLACK BOX: Log fallback response
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: req.body.CallSid || 'UNKNOWN',
          companyId: companyID,
          type: 'FALLBACK_RESPONSE_SENT',
          data: {
            reason: 'PIPELINE_ERROR',
            response: errorResponse,
            transferEnabled: isTransferEnabled(company),
            transferNumber: getTransferNumber(company) || null
          }
        }).catch(() => {});
      }
    } catch (companyError) {
      logger.error('❌ CHECKPOINT DOUBLE ERROR: Could not load company for transfer:', companyError);
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      const doubleErrorResponse = `Configuration error: Company ${req.params.companyID} must configure error responses in AI Agent Logic. Each company must have their own protocol.`;
      twiml.say(doubleErrorResponse);
      twiml.hangup();
      
      // 📼 BLACK BOX: Log double error
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: req.body.CallSid || 'UNKNOWN',
          companyId: req.params.companyID || 'UNKNOWN',
          type: 'PIPELINE_DOUBLE_ERROR',
          data: {
            primaryError: error.message,
            secondaryError: companyError.message,
            response: doubleErrorResponse,
            action: 'HANGUP'
          }
        }).catch(() => {});
      }
    }
    
    logger.info('📤 CHECKPOINT ERROR RESPONSE: Sending error TwiML');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// AI Agent Logic partial results handler (for real-time processing)
router.post('/ai-agent-partial/:companyID', async (req, res) => {
  try {
    const { companyID } = req.params;
    const { PartialSpeechResult, CallSid } = req.body;
    
    logger.info(`[AI AGENT PARTIAL] Company: ${companyID}, CallSid: ${CallSid}, Partial: "${PartialSpeechResult}"`);
    
    // For now, just acknowledge - could be used for real-time intent detection
    res.json({ success: true });
    
  } catch (error) {
    logger.error('[ERROR] AI Agent Partial error:', error);
    res.json({ success: false });
  }
});

// 🎯 V2 AGENT PARTIAL SPEECH CALLBACK (for real-time speech streaming)
// This is called by Twilio during speech recognition for partial results
// We return EMPTY response - NO greeting, NO Say, NO Gather
router.post('/v2-agent-partial/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { UnstableSpeechResult, StableSpeechResult, CallSid, Stability, SequenceNumber } = req.body;
    
    // 🔍 SPEECH TRACKING: Log what caller is saying in real-time
    const hasContent = Boolean(StableSpeechResult || UnstableSpeechResult);
    console.log(`📢 [PARTIAL #${SequenceNumber || '?'}] CallSid: ${CallSid?.slice(-8)}, Stable: "${StableSpeechResult || '-'}", Unstable: "${UnstableSpeechResult || '-'}", Stability: ${Stability || '?'}`);
    
    // Log cumulative speech for debugging
    if (StableSpeechResult) {
      logger.info('[V2 PARTIAL] 🎤 STABLE speech fragment detected', {
        companyId,
        callSid: CallSid?.slice(-8),
        stableSpeech: StableSpeechResult,
        stability: Stability,
        sequence: SequenceNumber
      });
      
      // 📼 BLACK BOX: Log partial speech (useful for STT debugging)
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: CallSid,
          companyId,
          type: 'GATHER_PARTIAL',
          data: {
            text: StableSpeechResult,
            unstableText: UnstableSpeechResult || null,
            confidence: parseFloat(Stability) || 0,
            sequence: parseInt(SequenceNumber) || 0
          }
        }).catch(() => {}); // Fire and forget
      }
    }
    
    // Return EMPTY TwiML - do NOT interrupt the call, do NOT greet
    // This is just for logging/monitoring real-time speech
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    
  } catch (error) {
    logger.error('[ERROR] V2 Agent Partial error:', error);
    // Still return empty response, never interrupt
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// 🚨 WEBHOOK CONNECTIVITY TEST ENDPOINT
router.all('/webhook-test', (req, res) => {
  const timestamp = new Date().toISOString();
  
  logger.info('🧪 WEBHOOK TEST HIT:', {
    timestamp,
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress
  });
  
  // Return both JSON and TwiML for testing
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    res.json({
      success: true,
      message: 'Webhook connectivity test successful',
      timestamp,
      receivedData: {
        method: req.method,
        headers: req.headers,
        body: req.body,
        query: req.query
      }
    });
  } else {
    // Return TwiML for voice webhook testing
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Webhook test successful! Your Twilio configuration is working correctly.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// ============================================
// 🧠 GLOBAL AI BRAIN TEST RESPONSE HANDLER
// ============================================
logger.info('🔍 [ROUTE REGISTRATION] Registering /test-respond/:templateId route...');
router.post('/test-respond/:templateId', async (req, res) => {
  logger.info(`\n${'='.repeat(80)}`);
  logger.info(`🧠 [CHECKPOINT 1] ===== ROUTE HIT ===== test-respond endpoint triggered`);
  logger.info(`🧠 [CHECKPOINT 1] Template ID: ${req.params.templateId}`);
  logger.info(`🧠 [CHECKPOINT 1] Request Method: ${req.method}`);
  logger.info(`🧠 [CHECKPOINT 1] Request Path: ${req.path}`);
  logger.info(`${'='.repeat(80)}\n`);
  
  try {
    logger.info(`🧠 [CHECKPOINT 2] Extracting parameters...`);
    const { templateId } = req.params;
    const speechText = req.body.SpeechResult || '';
    let allScenarios = []; // Declare at function scope for later use
    logger.debug(`🧠 [CHECKPOINT 2] ✅ Template ID: ${templateId}`);
    logger.debug(`🧠 [CHECKPOINT 2] ✅ Speech Input: "${speechText}"`);
    
    logger.debug(`🧠 [CHECKPOINT 3] Loading template from database...`);
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    logger.debug(`🧠 [CHECKPOINT 3] ✅ Template loaded: ${template ? template.name : 'NOT FOUND'}`);
    
    // 🎯 FIX: Check GLOBAL config instead of deprecated per-template config
    logger.debug(`🧠 [CHECKPOINT 3.5] Checking global AI Brain test config...`);
    const adminSettings = await AdminSettings.getSettings();
    const globalTestEnabled = adminSettings?.globalAIBrainTest?.enabled || false;
    logger.info(`🧠 [CHECKPOINT 3] Template exists: ${Boolean(template)}`);
    logger.info(`🧠 [CHECKPOINT 3] Global testing enabled: ${globalTestEnabled}`);
    
    if (!template) {
      logger.debug(`🧠 [CHECKPOINT 3] ❌ Template not found`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Test template not found.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    
    if (!globalTestEnabled) {
      logger.debug(`🧠 [CHECKPOINT 3] ❌ Global testing is disabled`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Testing is currently disabled. Please enable it in the admin settings.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    
    logger.debug(`🧠 [CHECKPOINT 4] Initializing HybridScenarioSelector...`);
    logger.debug(`🧠 [CHECKPOINT 4] Categories count: ${template.categories?.length || 0}`);
    
    // ============================================
    // BUILD EFFECTIVE FILLERS (Template + All Categories)
    // ============================================
    const templateFillers = template.fillerWords || [];
    const allFillers = [...templateFillers];
    
    // Add all category-specific fillers
    template.categories.forEach(category => {
        if (category.additionalFillerWords && Array.isArray(category.additionalFillerWords)) {
            allFillers.push(...category.additionalFillerWords);
        }
    });
    
    // Deduplicate
    const effectiveFillers = [...new Set(allFillers)];
    
    // ============================================
    // BUILD EFFECTIVE SYNONYM MAP (Template + All Categories)
    // ============================================
    const effectiveSynonymMap = new Map();
    
    // Start with template-level synonyms
    if (template.synonymMap) {
        if (template.synonymMap instanceof Map) {
            for (const [term, aliases] of template.synonymMap.entries()) {
                effectiveSynonymMap.set(term, [...aliases]);
            }
        } else if (typeof template.synonymMap === 'object') {
            for (const [term, aliases] of Object.entries(template.synonymMap)) {
                if (Array.isArray(aliases)) {
                    effectiveSynonymMap.set(term, [...aliases]);
                }
            }
        }
    }
    
    // Merge category-level synonyms
    template.categories.forEach(category => {
        if (category.synonymMap) {
            const catMap = category.synonymMap instanceof Map 
                ? category.synonymMap 
                : new Map(Object.entries(category.synonymMap || {}));
            
            for (const [term, aliases] of catMap.entries()) {
                if (effectiveSynonymMap.has(term)) {
                    // Merge aliases
                    const existing = effectiveSynonymMap.get(term);
                    effectiveSynonymMap.set(term, [...new Set([...existing, ...aliases])]);
                } else {
                    effectiveSynonymMap.set(term, [...aliases]);
                }
            }
        }
    });
    
    const urgencyKeywords = template.urgencyKeywords || [];
    logger.debug(`🧠 [CHECKPOINT 4] Effective fillers: ${effectiveFillers.length} (template: ${templateFillers.length}), Urgency keywords: ${urgencyKeywords.length}, Synonym terms: ${effectiveSynonymMap.size}`);
    
    // ============================================================================
    // 🧠 3-TIER INTELLIGENCE ROUTING
    // ============================================================================
    // Route through IntelligentRouter (Tier 1 → 2 → 3) if enabled
    // Otherwise, use traditional HybridScenarioSelector (Tier 1 only)
    // ============================================================================
    
    let result;
    let tierUsed = 1;  // Track which tier was used
    let routingDetails = {};  // Store routing metadata
    
    // Extract all scenarios from template (needed for diagnostics)
    allScenarios = [];
    template.categories.forEach(category => {
      if (category.scenarios && Array.isArray(category.scenarios)) {
        allScenarios.push(...category.scenarios);
      }
    });
    
    // ============================================
    // 🧪 CRITICAL: TEST MODE - ALWAYS TEST YOUR RULES DIRECTLY!
    // ============================================
    // For testing, we MUST test the HybridScenarioSelector (your rules) directly.
    // 3-tier intelligence is for PRODUCTION calls, not for TESTING your scenarios.
    // 
    // Why? If 3-tier is enabled during testing:
    // - Tier 1 fails → escalates to Tier 3 (LLM)
    // - LLM matches the scenario instead of your rules
    // - You never know if YOUR scenarios/fillers/synonyms are working!
    // - You're just testing if OpenAI works (we already know it does!)
    //
    // Instead, we should:
    // 1. Test HybridScenarioSelector directly (your rules)
    // 2. Get confidence score (70%, 85%, etc.)
    // 3. If it fails, LLM ANALYZES WHY and suggests improvements
    // 4. You improve your template, test again until 100% without LLM
    //
    // This is how the system worked before 3-tier was added.
    // ============================================
    
    // ============================================
    // 🧠 V2: Check if 3-Tier is enabled for template testing
    // ============================================
    // Reuse adminSettings already loaded at line 1889
    const globalIntelligence = adminSettings?.globalProductionIntelligence || {};
    const USE_3_TIER_FOR_TESTING = globalIntelligence.enabled === true && globalIntelligence.testingEnabled === true;
    
    if (USE_3_TIER_FOR_TESTING) {
      // ✅ Admin enabled 3-tier for template testing
      logger.info('🧠 [3-TIER ROUTING] Starting intelligent cascade (Tier 1 → 2 → 3) for template testing');
      
      // Route through 3-tier system
      const routingResult = await IntelligentRouter.route({
        callerInput: speechText,
        template,
        company: null,  // Test mode (no company context)
        callId: `test-${templateId}-${Date.now()}`,
        context: {
          testMode: true,
          templateId,
          timestamp: new Date()
        }
      });
      
      if (routingResult.success && routingResult.matched) {
        // ✅ Match found via 3-tier system
        tierUsed = routingResult.tierUsed;
        result = {
          scenario: routingResult.scenario,
          confidence: routingResult.confidence,
          match: routingResult.scenario,
          score: routingResult.confidence
        };
        
        routingDetails = {
          tierUsed,
          tier1Confidence: routingResult.tier1Result?.confidence || 0,
          tier2Confidence: routingResult.tier2Result?.confidence || 0,
          tier3Confidence: routingResult.tier3Result?.confidence || 0,
          cost: routingResult.cost?.total || 0,
          responseTime: routingResult.performance?.totalTime || 0,
          patternsLearned: routingResult.patternsLearned?.length || 0
        };
        
        logger.info(`🧠 [3-TIER ROUTING] ✅ MATCH FOUND via Tier ${tierUsed}`);
        logger.info(`🧠 [3-TIER ROUTING] Scenario: ${result.scenario?.name}`);
        logger.info(`🧠 [3-TIER ROUTING] Confidence: ${(result.confidence * 100).toFixed(1)}%`);
        logger.info(`🧠 [3-TIER ROUTING] Cost: $${routingDetails.cost.toFixed(4)}`);
        logger.info(`🧠 [3-TIER ROUTING] Response Time: ${routingDetails.responseTime}ms`);
        
        if (tierUsed === 3 && routingDetails.patternsLearned > 0) {
          logger.info(`🧠 [3-TIER LEARNING] 🎓 Learned ${routingDetails.patternsLearned} pattern(s) - Next call will be FREE!`);
        }
        
      } else {
        // ❌ No match even after all 3 tiers
        logger.warn(`🧠 [3-TIER ROUTING] ⚠️ NO MATCH after all 3 tiers`);
        logger.warn(`🧠 [3-TIER ROUTING] Tier 1: ${(routingResult.tier1Result?.confidence * 100 || 0).toFixed(1)}%`);
        logger.warn(`🧠 [3-TIER ROUTING] Tier 2: ${(routingResult.tier2Result?.confidence * 100 || 0).toFixed(1)}%`);
        logger.warn(`🧠 [3-TIER ROUTING] Tier 3: ${(routingResult.tier3Result?.confidence * 100 || 0).toFixed(1)}%`);
        
        result = {
          scenario: null,
          confidence: routingResult.confidence || 0,
          match: null,
          score: 0
        };
        
        tierUsed = routingResult.tierUsed || 3;
        routingDetails = {
          tierUsed,
          allTiersFailed: true,
          cost: routingResult.cost?.total || 0
        };
      }
      
    } else {
      // Traditional Tier 1 only (HybridScenarioSelector)
      logger.debug(`🧠 [CHECKPOINT 4] Initializing HybridScenarioSelector (Tier 1 only)...`);
      
      // Initialize selector with merged fillers, urgency keywords, and synonym map
      const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, effectiveSynonymMap);
      logger.debug(`🧠 [CHECKPOINT 4] ✅ Selector initialized with ${effectiveFillers.length} filler words, ${urgencyKeywords.length} urgency keywords, and ${effectiveSynonymMap.size} synonym mappings`);
      
      logger.debug(`🧠 [CHECKPOINT 5] Running scenario matching...`);
      logger.info(`🧠 [CHECKPOINT 5] Total scenarios to match: ${allScenarios.length}`);
      result = await selector.selectScenario(speechText, allScenarios);
      logger.info(`🧠 [CHECKPOINT 5] ✅ Matching complete`);
      logger.info(`🧠 [CHECKPOINT 5] Match found: ${Boolean(result.match)}`);
      logger.info(`🧠 [CHECKPOINT 5] Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    }
    
    logger.info(`🧠 [CHECKPOINT 6] Building TwiML response...`);
    const twiml = new twilio.twiml.VoiceResponse();
    logger.info(`🧠 [CHECKPOINT 6] ✅ TwiML response object created`);
    
    if (result.scenario) {  // FIXED: was result.match, should be result.scenario
      logger.info(`🧠 [CHECKPOINT 7] ✅ MATCH FOUND!`);
      logger.info(`🧠 [CHECKPOINT 7] Scenario: ${result.scenario.name}`);
      logger.info(`🧠 [CHECKPOINT 7] Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      
      logger.info(`🧠 [CHECKPOINT 8] Selecting random reply...`);
      // Pick a random reply
      const replies = result.scenario.fullReplies && result.scenario.fullReplies.length > 0 
        ? result.scenario.fullReplies 
        : result.scenario.quickReplies || [];
      
      logger.info(`🧠 [CHECKPOINT 8] Available replies: ${replies.length}`);
      const reply = replies[Math.floor(Math.random() * replies.length)] || null;  // 🔥 NO FALLBACK
      logger.debug(`🧠 [CHECKPOINT 8] ✅ Selected reply: "${reply.substring(0, 50)}..."`);
      
      logger.debug(`🧠 [CHECKPOINT 9] Adding reply to TwiML...`);
      // Say the matched reply + debug info
      twiml.say(reply);
      twiml.pause({ length: 1 });
      
      // Build debug message with tier information if 3-tier is enabled
      let debugMessage = `You triggered the scenario: ${result.scenario.name}. Confidence: ${(result.confidence * 100).toFixed(0)} percent.`;
      
      if (USE_3_TIER_FOR_TESTING && routingDetails.tierUsed) {
        const tierNames = { 1: 'Tier 1: Rule-based', 2: 'Tier 2: Semantic', 3: 'Tier 3: LLM' };
        debugMessage += ` Matched via ${tierNames[routingDetails.tierUsed]}.`;
        
        if (routingDetails.tierUsed === 3) {
          debugMessage += ` Cost: ${(routingDetails.cost * 100).toFixed(1)} cents.`;
          if (routingDetails.patternsLearned > 0) {
            debugMessage += ` Learned ${routingDetails.patternsLearned} new pattern${routingDetails.patternsLearned > 1 ? 's' : ''}.`;
          }
        } else if (routingDetails.tierUsed === 1) {
          debugMessage += ` Cost: Free. Response time: ${routingDetails.responseTime} milliseconds.`;
        }
      } else {
        debugMessage += ` Score: ${(result.score * 100).toFixed(0)} percent.`;
      }
      
      twiml.say(debugMessage);
      logger.debug(`🧠 [CHECKPOINT 9] ✅ TwiML reply added`);
      
      logger.info(`🧠 [CHECKPOINT 10] Creating gather for continuation...`);
      // Continue conversation
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${templateId}`,
        method: 'POST',
        timeout: 5,
        speechTimeout: '3', // Matches production defaults - what you test is what customers get!
        enhanced: true,
        speechModel: 'phone_call',
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually' // Help recognize common filler words
      });
      gather.say('Say something else to test another scenario, or hang up to end the test.');
      logger.info(`🧠 [CHECKPOINT 10] ✅ Gather created`);
      
    } else {
      logger.info(`🧠 [CHECKPOINT 7] ❌ NO MATCH`);
      logger.info(`🧠 [CHECKPOINT 7] Confidence too low: ${(result.confidence * 100).toFixed(1)}%`);
      twiml.say(`No scenario matched your input. Confidence was ${(result.confidence * 100).toFixed(0)} percent, which is below the threshold.`);
      twiml.pause({ length: 1 });
      
      logger.info(`🧠 [CHECKPOINT 8] Creating gather for retry...`);
      // Continue conversation
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${templateId}`,
        method: 'POST',
        timeout: 5,
        speechTimeout: '3', // Matches production defaults - what you test is what customers get!
        enhanced: true,
        speechModel: 'phone_call',
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually' // Help recognize common filler words
      });
      gather.say('Try saying something else.');
      logger.info(`🧠 [CHECKPOINT 8] ✅ Gather created`);
    }
    
    logger.info(`🧠 [CHECKPOINT 11] Updating test stats in database...`);
    // Update test stats
    await GlobalInstantResponseTemplate.findByIdAndUpdate(templateId, {
      $inc: { 'twilioTest.testCallCount': 1 },
      $set: { 'twilioTest.lastTestedAt': new Date() }
    });
    logger.info(`🧠 [CHECKPOINT 11] ✅ Stats updated`);
    
    // ============================================
    // 🧪 SAVE TEST RESULT TO MEMORY
    // ============================================
    const testResult = {
      timestamp: new Date().toISOString(),
      phrase: speechText,
      matched: Boolean(result.scenario),  // FIXED: was result.match, should be result.scenario
      confidence: result.confidence || 0,
      threshold: result.trace?.threshold || 0.45,
      scenario: result.scenario ? {
        id: result.scenario.scenarioId || result.scenario._id,
        name: result.scenario.name,
        category: result.scenario.category
      } : null,
      topCandidates: result.trace?.topCandidates || [],
      timing: result.trace?.timingMs || {},
      callSid: req.body.CallSid,
      
      // ============================================
      // 🧠 3-TIER ROUTING METADATA (if enabled)
      // ============================================
      ...(USE_3_TIER_FOR_TESTING && routingDetails.tierUsed && {
        intelligenceRouting: {
          enabled: true,
          tierUsed: routingDetails.tierUsed,
          tierName: { 1: 'Rule-based', 2: 'Semantic', 3: 'LLM' }[routingDetails.tierUsed],
          tier1Confidence: routingDetails.tier1Confidence || 0,
          tier2Confidence: routingDetails.tier2Confidence || 0,
          tier3Confidence: routingDetails.tier3Confidence || 0,
          cost: routingDetails.cost || 0,
          responseTime: routingDetails.responseTime || 0,
          patternsLearned: routingDetails.patternsLearned || 0,
          allTiersFailed: routingDetails.allTiersFailed || false
        }
      })
    };
    
    // 🤖 Run AI analysis with detailed diagnostics
    const aiAnalysis = analyzeTestResult(testResult, allScenarios);
    testResult.analysis = aiAnalysis;
    
    // 🔬 WORLD-CLASS DIAGNOSTICS: Generate comprehensive debug card
    const debugCard = MatchDiagnostics.generateDebugCard(
      result,
      allScenarios,
      speechText,
      {
        channel: 'voice',
        language: 'en',
        asrConfidence: null // Twilio doesn't provide this
      }
    );
    
    testResult.diagnostics = debugCard;
    
    if (aiAnalysis.suggestions.length > 0 || aiAnalysis.issues.length > 0) {
      logger.debug(`🤖 [AI ANALYSIS] Found ${aiAnalysis.suggestions.length} suggestions, ${aiAnalysis.issues.length} issues`);
    }
    
    // ============================================
    // 🎯 ENTERPRISE TEST PILOT: DEEP LLM ANALYSIS
    // ============================================
    // If the template has Enterprise Test Pilot enabled (intelligenceMode set),
    // use the EnterpriseAISuggestionEngine for comprehensive analysis.
    // This provides:
    // - LLM qualitative analysis (missing fillers, triggers, context confusion)
    // - Statistical pattern frequency (how often patterns appear in failed tests)
    // - Impact scoring (priority ranking based on frequency × confidence gain × cost)
    // - Conflict detection (trigger collisions, routing ambiguity)
    // - Cost projection (ROI analysis for applying suggestions)
    // - Before/after simulation (predicted impact)
    // ============================================
    
    const shouldRunEnterpriseAnalysis = template.intelligenceMode && 
                                        template.testPilotSettings &&
                                        (!testResult.matched || testResult.confidence < testResult.threshold);
    
    if (shouldRunEnterpriseAnalysis) {
      logger.info(`🎯 [ENTERPRISE TEST PILOT] Running deep analysis with ${template.intelligenceMode} mode...`);
      
      try {
        const EnterpriseAISuggestionEngine = require('../services/EnterpriseAISuggestionEngine');
        const enterpriseEngine = new EnterpriseAISuggestionEngine();
        
        // ============================================
        // 🛡️ CONSTRUCT TIER RESULTS FOR ANALYSIS
        // ============================================
        // Build tierResults object from available data (either 3-tier routing or test mode)
        let tierResults;
        
        if (USE_3_TIER_FOR_TESTING && routingDetails.tierUsed) {
          // 3-tier mode: Use routing details
          tierResults = {
            finalTier: `tier${routingDetails.tierUsed}`,
            finalConfidence: result.confidence,
            tier1: {
              confidence: routingDetails.tier1Confidence || 0,
              matchedFillers: result.trace?.matchedFillers || [],
              matchedTriggers: result.trace?.matchedTriggers || [],
              matchedKeywords: result.trace?.matchedKeywords || []
            },
            tier2: {
              confidence: routingDetails.tier2Confidence || 0
            },
            tier3: {
              confidence: routingDetails.tier3Confidence || 0,
              scenario: result.scenario || null
            }
          };
        } else {
          // Test mode: Construct from result object (HybridScenarioSelector output)
          tierResults = {
            finalTier: 'tier1',
            finalConfidence: result.confidence,
            tier1: {
              confidence: result.confidence,
              matchedFillers: result.trace?.matchedFillers || [],
              matchedTriggers: result.trace?.matchedTriggers || [],
              matchedKeywords: result.trace?.matchedKeywords || []
            },
            tier2: {
              confidence: 0
            },
            tier3: {
              confidence: 0,
              scenario: null
            }
          };
        }
        
        logger.info(`🧠 [ENTERPRISE TEST PILOT] Built tierResults:`, {
          finalTier: tierResults.finalTier,
          finalConfidence: tierResults.finalConfidence,
          mode: USE_3_TIER_FOR_TESTING ? '3-tier' : 'test'
        });
        
        // Run comprehensive analysis with tierResults
        const enterpriseAnalysis = await enterpriseEngine.analyzeTestCall(
          speechText,
          templateId,
          tierResults
        );
        
        // Store enterprise analysis
        testResult.enterpriseAnalysis = {
          mode: template.intelligenceMode,
          analyzed: true,
          analysisId: enterpriseAnalysis.analysis?._id?.toString(),
          suggestions: enterpriseAnalysis.suggestions || [],
          conflicts: enterpriseAnalysis.conflicts || [],
          trends: enterpriseAnalysis.trends || null,
          costImpact: enterpriseAnalysis.costProjection || null,
          coloredTranscript: enterpriseAnalysis.coloredTranscript || null,
          timestamp: new Date().toISOString()
        };
        
        logger.info(`✅ [ENTERPRISE TEST PILOT] Analysis complete: ${enterpriseAnalysis.suggestions.length} suggestions, ${enterpriseAnalysis.conflicts.length} conflicts`);
        
        // Backward compatibility: also populate legacy llmDiagnostic
        testResult.llmDiagnostic = {
          analyzed: true,
          reason: !testResult.matched ? 'No match found' : `Confidence ${(testResult.confidence * 100).toFixed(0)}% below threshold ${(testResult.threshold * 100).toFixed(0)}%`,
          suggestions: enterpriseAnalysis.suggestions.slice(0, 5).map(s => s.description || s.reason), // Top 5 for backward compat
          enterpriseMode: true,
          analysisId: enterpriseAnalysis.analysis?._id?.toString(),
          timestamp: new Date().toISOString()
        };
        
      } catch (enterpriseError) {
        logger.error(`❌ [ENTERPRISE TEST PILOT] Analysis failed:`, {
          error: enterpriseError.message,
          stack: enterpriseError.stack
        });
        
        // Fallback to basic analysis
        testResult.enterpriseAnalysis = {
          mode: template.intelligenceMode,
          analyzed: false,
          error: enterpriseError.message,
          fallbackToBasic: true
        };
        
        testResult.llmDiagnostic = {
          analyzed: true,
          reason: !testResult.matched ? 'No match found' : `Confidence ${(testResult.confidence * 100).toFixed(0)}% below threshold ${(testResult.threshold * 100).toFixed(0)}%`,
          suggestions: aiAnalysis.suggestions || [],
          enterpriseMode: false,
          enterpriseError: enterpriseError.message,
          timestamp: new Date().toISOString()
        };
        
        logger.info(`🤖 [FALLBACK] Using basic AI analysis - ${aiAnalysis.suggestions.length} suggestions`);
      }
      
    } else if (!testResult.matched || testResult.confidence < testResult.threshold) {
      // ============================================
      // 🤖 BASIC LLM DIAGNOSTIC (Legacy Mode)
      // ============================================
      logger.info(`🤖 [LLM DIAGNOSTIC] Test failed - running basic analysis...`);
      testResult.llmDiagnostic = {
        analyzed: true,
        reason: !testResult.matched ? 'No match found' : `Confidence ${(testResult.confidence * 100).toFixed(0)}% below threshold ${(testResult.threshold * 100).toFixed(0)}%`,
        suggestions: aiAnalysis.suggestions || [],
        enterpriseMode: false,
        timestamp: new Date().toISOString()
      };
      
      logger.info(`🤖 [LLM DIAGNOSTIC] Generated ${aiAnalysis.suggestions.length} improvement suggestions`);
      
    } else {
      // ============================================
      // ✅ TEST PASSED - NO ANALYSIS NEEDED
      // ============================================
      testResult.llmDiagnostic = {
        analyzed: false,
        reason: 'Test passed - no LLM analysis needed',
        message: '✅ Your template rules are working perfectly! No improvements needed.'
      };
      logger.info(`✅ [TEST SUCCESS] Template rules working perfectly - confidence ${(testResult.confidence * 100).toFixed(0)}%`);
    }
    
    // ============================================
    // 🛡️ DECISION-CONTRACT SAFETY RAIL
    // ============================================
    // CRITICAL: If confidence ≥ threshold but NO scenario, this is an ENGINE BUG
    const threshold = testResult.threshold || 0.45;
    const confidence = testResult.confidence || 0;
    const hasScenario = Boolean(result.scenario);
    
    if (confidence >= threshold && !hasScenario) {
      // 🚨 RED ALERT: Decision contract violation
      const violation = {
        type: 'DECISION_CONTRACT_VIOLATION',
        severity: 'CRITICAL',
        message: `Confidence ${(confidence * 100).toFixed(0)}% ≥ threshold ${(threshold * 100).toFixed(0)}% but NO scenario returned`,
        confidence,
        threshold,
        gap: confidence - threshold,
        possibleCauses: [
          'Precondition failed after confidence check',
          'Scenario filtering bug (channel/language mismatch)',
          'Cooldown triggered after scoring',
          'Cache corruption or stale data',
          'Race condition in selector logic'
        ],
        debugInfo: {
          resultKeys: Object.keys(result),
          hasScenario,
          hasTrace: Boolean(result.trace),
          topCandidates: result.trace?.topCandidates || []
        }
      };
      
      logger.error(`\n${'🚨'.repeat(40)}`);
      logger.error(`🚨 DECISION-CONTRACT VIOLATION DETECTED!`);
      logger.error(`🚨 Confidence: ${(confidence * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(1)}%)`);
      logger.error(`🚨 Scenario returned: ${hasScenario}`);
      logger.error(`🚨 This should NEVER happen - engine logic bug!`);
      logger.error(JSON.stringify(violation, null, 2));
      logger.error(`${'🚨'.repeat(40)}\n`);
      
      // Add to test result for debugging
      testResult.contractViolation = violation;
      
      // Override reason code to E01: EngineBug
      if (testResult.diagnostics && testResult.diagnostics.reasonCodes) {
        testResult.diagnostics.primaryReasonCode = 'E01';
        testResult.diagnostics.reasonCodes.unshift({
          code: 'E01',
          name: 'EngineBug',
          type: 'error',
          severity: 'CRITICAL',
          message: 'DECISION CONTRACT VIOLATION: Confidence above threshold but no scenario returned',
          impact: 'Engine logic error - requires immediate investigation',
          rootCause: violation.possibleCauses.join(', '),
          fix: 'Review selector logic and add defensive checks',
          primaryMetric: 'confidenceGap',
          primaryMetricValue: ((confidence - threshold) * 100).toFixed(1)
        });
      }
    }
    
    saveTestResult(templateId, testResult);
    logger.info(`🧪 [CHECKPOINT 11.5] Test result saved to memory with AI analysis + diagnostics`);
    
    logger.info(`🧠 [CHECKPOINT 12] Sending TwiML response to Twilio...`);
    res.type('text/xml').status(200).send(twiml.toString());
    logger.info(`🧠 [CHECKPOINT 12] ✅ Response sent successfully`);
    logger.info(`${'='.repeat(80)}\n`);
    
  } catch (error) {
    logger.error(`\n${'!'.repeat(80)}`);
    logger.error(`🚨 [ERROR CHECKPOINT] EXCEPTION CAUGHT IN test-respond`);
    logger.error(`🚨 [ERROR CHECKPOINT] Error Message: ${error.message}`);
    logger.error(`🚨 [ERROR CHECKPOINT] Error Stack:`);
    logger.error(error.stack);
    logger.error(`${'!'.repeat(80)}\n`);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('An error occurred during testing. Please check the server logs.');
    twiml.hangup();
    res.type('text/xml').status(200).send(twiml.toString());
  }
});

// ============================================
// 🧪 GET TEST RESULTS FOR TEMPLATE
// ============================================
router.get('/test-results/:templateId', (req, res) => {
  const { templateId } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  
  logger.debug(`🧪 [TEST RESULTS] Fetching last ${limit} results for template ${templateId}`);
  
  const results = getTestResults(templateId, limit);
  
  res.json({
    success: true,
    templateId,
    count: results.length,
    results
  });
});

// 📊 GET endpoint for aggregate quality report
router.get('/quality-report/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const limit = parseInt(req.query.limit) || 100; // Analyze more for quality metrics
    
    logger.info(`📊 [QUALITY REPORT] Generating report for template ${templateId} (last ${limit} tests)`);
    
    const results = getTestResults(templateId, limit);
    logger.info(`📊 [QUALITY REPORT] Retrieved ${results.length} test results`);
    
    const qualityReport = MatchDiagnostics.generateQualityReport(results);
    logger.info(`📊 [QUALITY REPORT] Generated quality report successfully`);
    
    res.json({
      success: true,
      templateId,
      report: qualityReport,
      count: results.length
    });
  } catch (error) {
    logger.error(`❌ [QUALITY REPORT] Error generating report:`, {
      error: error.message,
      stack: error.stack,
      templateId: req.params.templateId
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to generate quality report',
      message: error.message
    });
  }
});

// ============================================================================
// 📞 VOICE WEBHOOK - SYSTEM TEST CALL
// ============================================================================
// Purpose: Handle incoming calls to verify Twilio voice integration
// Plays customizable greeting from AdminSettings.notificationCenter.testCallGreeting
// NOTE: This route is mounted at /api/twilio, so /voice-test becomes /api/twilio/voice-test
// ============================================================================

router.post('/voice-test', async (req, res) => {
    try {
        const from = req.body.From;
        const to = req.body.To;
        
        logger.info(`📞 [VOICE WEBHOOK] Incoming call from ${from} to ${to}`);
        
        // Get custom greeting from AdminSettings
        const AdminSettings = require('../models/AdminSettings');
        const settings = await AdminSettings.getSettings();
        const greeting = settings.notificationCenter?.testCallGreeting || 
            'This is a ClientsVia system check. Your Twilio integration is working correctly.';
        
        logger.info(`🗣️ [VOICE WEBHOOK] Playing greeting (${greeting.length} chars)`);
        
        // Create TwiML response
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        
        twiml.say({
            voice: 'Polly.Matthew',
            language: 'en-US'
        }, greeting);
        
        // Hang up after message
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
        
        logger.debug('✅ [VOICE WEBHOOK] TwiML response sent');
        
    } catch (error) {
        logger.error('❌ [VOICE WEBHOOK] Error processing call:', error);
        
        // Always return valid TwiML even on error
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        twiml.say('System error. Please try again later.');
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// ============================================================================
// 📱 SMS WEBHOOK - ADMIN ALERT ACKNOWLEDGMENTS
// ============================================================================
// Purpose: Handle admin responses to notification alerts via SMS
// Supports: "ACK ALT-20251020-001", "SNOOZE ALT-###", "REOPEN ALT-###"
//
// Related Files:
// - services/AdminNotificationService.js
// - services/AlertEscalationService.js
// - models/NotificationLog.js
// ============================================================================

router.post('/sms', async (req, res) => {
    try {
        const from = req.body.From;        // Admin phone number
        const message = req.body.Body;     // SMS text content
        
        logger.info(`📱 [SMS WEBHOOK] Received SMS from ${from}: "${message}"`);
        
        // ====================================================================
        // CHECK FOR ACKNOWLEDGMENT: "ACK ALT-20251020-001"
        // ====================================================================
        const ackMatch = message.match(/ACK\s+(ALT-\d{8}-\d{3})/i);
        
        if (ackMatch) {
            const alertId = ackMatch[1].toUpperCase();
            
            logger.info(`✅ [SMS WEBHOOK] Acknowledgment detected for alert: ${alertId}`);
            
            try {
                // Find admin name from Notification Center
                const v2Company = require('../models/v2Company');
                const notificationCenter = await v2Company.findOne({
                    'metadata.isNotificationCenter': true
                });
                
                const admin = notificationCenter?.contacts.find(c => 
                    c.type === 'admin-alert' && c.phoneNumber === from
                );
                const adminName = admin?.name || from;
                
                // Acknowledge the alert
                const AdminNotificationService = require('../services/AdminNotificationService');
                await AdminNotificationService.acknowledgeAlert(alertId, adminName, 'SMS', message);
                
                logger.info(`✅ [SMS WEBHOOK] Alert ${alertId} acknowledged by ${adminName}`);
                
                // Send TwiML response (empty - confirmation will be sent separately)
                res.type('text/xml');
                res.send('<Response></Response>');
                return;
                
            } catch (error) {
                logger.error(`❌ [SMS WEBHOOK] Failed to acknowledge alert ${alertId}:`, error);
                
                // Send error response
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`Error: Failed to acknowledge alert ${alertId}. Please try again or use the web interface.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
            }
        }
        
        // ====================================================================
        // CHECK FOR SNOOZE: "SNOOZE ALT-20251020-001 30"
        // ====================================================================
        const snoozeMatch = message.match(/SNOOZE\s+(ALT-\d{8}-\d{3})(?:\s+(\d+))?/i);
        
        if (snoozeMatch) {
            const alertId = snoozeMatch[1].toUpperCase();
            const minutes = parseInt(snoozeMatch[2]) || 60; // Default 1 hour
            
            logger.info(`🔕 [SMS WEBHOOK] Snooze detected for alert: ${alertId} (${minutes} minutes)`);
            
            try {
                const AlertEscalationService = require('../services/AlertEscalationService');
                await AlertEscalationService.snoozeAlert(alertId, minutes, 'Snoozed via SMS');
                
                logger.info(`✅ [SMS WEBHOOK] Alert ${alertId} snoozed for ${minutes} minutes`);
                
                res.type('text/xml');
                res.send('<Response></Response>');
                return;
                
            } catch (error) {
                logger.error(`❌ [SMS WEBHOOK] Failed to snooze alert ${alertId}:`, error);
                
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`Error: Failed to snooze alert ${alertId}. Please try again.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
            }
        }
        
        // ====================================================================
        // CHECK FOR REOPEN: "REOPEN ALT-20251020-001"
        // ====================================================================
        const reopenMatch = message.match(/REOPEN\s+(ALT-\d{8}-\d{3})/i);
        
        if (reopenMatch) {
            const alertId = reopenMatch[1].toUpperCase();
            
            logger.info(`🔄 [SMS WEBHOOK] Reopen detected for alert: ${alertId}`);
            
            try {
                const AlertEscalationService = require('../services/AlertEscalationService');
                await AlertEscalationService.resumeEscalation(alertId);
                
                logger.info(`✅ [SMS WEBHOOK] Alert ${alertId} reopened`);
                
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`✅ Alert ${alertId} has been reopened and escalation resumed.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
                
            } catch (error) {
                logger.error(`❌ [SMS WEBHOOK] Failed to reopen alert ${alertId}:`, error);
                
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`Error: Failed to reopen alert ${alertId}. Please try again.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
            }
        }
        
        // ====================================================================
        // CHECK FOR TEST COMMAND: "TEST" or "PING"
        // ====================================================================
        if (message.match(/^(TEST|PING|HELLO|HI)$/i)) {
            logger.debug(`✅ [SMS WEBHOOK] Test command received from ${from}`);
            logger.debug('📧 [SMS WEBHOOK] STARTING email notification process...');
            
            // 📧 Send email notification to admins (Gmail - clientsvia@gmail.com)
            // ARCHITECTURE: Admin notifications use Gmail, customer emails use SendGrid (future)
            try {
                logger.debug('📧 [SMS WEBHOOK] Step 1: Requiring emailClient...');
                const emailClient = require('../clients/emailClient');
                logger.debug('📧 [SMS WEBHOOK] Step 2: emailClient loaded successfully');
                
                logger.debug('📧 [SMS WEBHOOK] Step 3: Creating timestamp...');
                const timestamp = new Date().toLocaleString('en-US', { 
                    timeZone: 'America/New_York',
                    dateStyle: 'short',
                    timeStyle: 'long'
                });
                logger.debug(`📧 [SMS WEBHOOK] Step 4: Timestamp created: ${timestamp}`);
                
                logger.debug('📧 [SMS WEBHOOK] Step 5: Calling emailClient.sendAdminAlert()...');
                const result = await emailClient.sendAdminAlert(
                    '✅ SMS Test Received',
                    `SMS Test Command Received!\n\nFrom: ${from}\nMessage: "${message}"\nTime: ${timestamp} ET\n\n✅ Webhook is working correctly!\n📱 SMS system is LIVE!`,
                    `<h2>✅ SMS Test Command Received!</h2><p><strong>From:</strong> ${from}</p><p><strong>Message:</strong> "${message}"</p><p><strong>Time:</strong> ${timestamp} ET</p><hr><p>✅ Webhook is working correctly!</p><p>📱 SMS system is LIVE!</p>`
                );
                logger.debug('📧 [SMS WEBHOOK] Step 6: sendAdminAlert() returned:', JSON.stringify(result));
                
                if (result.success) {
                    logger.debug(`📧 [SMS WEBHOOK] ✅ SUCCESS! Admin alert sent to ${result.recipients} recipient(s)`);
                } else {
                    logger.error(`❌ [SMS WEBHOOK] FAILED! Error: ${result.error}`);
                }
                
            } catch (emailError) {
                logger.error('⚠️ [SMS WEBHOOK] EXCEPTION caught:', emailError.message);
                logger.error('⚠️ [SMS WEBHOOK] Error stack:', emailError.stack);
            }
            
            logger.debug('📧 [SMS WEBHOOK] Email notification process COMPLETE');
            
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(`✅ ClientsVia SMS System is LIVE!\n\n🚀 2-way SMS confirmed working.\n📱 Webhook connected.\n⏰ ${new Date().toLocaleString()}`);
            
            res.type('text/xml');
            res.send(twiml.toString());
            return;
        }
        
        // ====================================================================
        // CUSTOMER CONVERSATION - Route to AI Brain
        // ====================================================================
        // If we get here, it's not an admin command - treat as customer SMS
        logger.info(`💬 [SMS WEBHOOK] Customer message from ${from}, routing to AI Brain`);
        
        try {
            const SMSConversationHandler = require('../services/SMSConversationHandler');
            const to = req.body.To;
            const messageSid = req.body.MessageSid;
            
            // Check if this is an admin phone (if so, show help instead)
            const isAdmin = await SMSConversationHandler.isAdminPhone(from);
            
            if (isAdmin) {
                // Admin sent unrecognized command - show help
                logger.info(`ℹ️ [SMS WEBHOOK] Admin ${from} sent unrecognized command`);
                
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`
ClientsVia Alert Commands:
• TEST - Verify SMS system
• ACK ALT-###-### - Acknowledge alert
• SNOOZE ALT-###-### 30 - Snooze for 30 min
• REOPEN ALT-###-### - Reopen alert

Example: ACK ALT-20251020-001
                `.trim());
                
                res.type('text/xml');
                res.send(twiml.toString());
                return;
            }
            
            // Process as customer conversation
            const result = await SMSConversationHandler.processMessage({
                fromPhone: from,
                toPhone: to,
                message,
                messageSid
            });
            
            // Send AI response
            const twiml = new twilio.twiml.MessagingResponse();
            
            if (result.shouldReply && result.response) {
                twiml.message(result.response);
            }
            
            res.type('text/xml');
            res.send(twiml.toString());
            
            logger.info(`✅ [SMS WEBHOOK] Customer conversation processed`, {
                from,
                sessionId: result.sessionId,
                customerId: result.customerId
            });
            
        } catch (error) {
            logger.error(`❌ [SMS WEBHOOK] Failed to process customer SMS:`, error);
            
            // Fallback - still acknowledge the message
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message("Thanks for your message! We'll get back to you shortly.");
            
            res.type('text/xml');
            res.send(twiml.toString());
        }
        
    } catch (error) {
        logger.error('❌ [SMS WEBHOOK] Error processing SMS:', error);
        
        // Always return valid TwiML even on error
        res.type('text/xml');
        res.send('<Response></Response>');
    }
});

// 🚨 CATCH-ALL ENDPOINT - Must be LAST to log any unmatched Twilio requests
router.all('*', (req, res) => {
  logger.info('❌ UNMATCHED TWILIO REQUEST:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    fullUrl: req.originalUrl,
    path: req.path,
    params: req.params,
    hasCallSid: Boolean(req.body?.CallSid)
  });
  
  // CRITICAL: Always return TwiML for Twilio requests, NEVER JSON!
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('This endpoint is not configured. Please check your Twilio webhook settings.');
  twiml.hangup();
  res.type('text/xml').status(200).send(twiml.toString());
});

// ============================================================================
// 📞 CALL STATUS CALLBACK - CALL CENTER V2 INTEGRATION
// ============================================================================
// Purpose: Handle Twilio status callbacks when calls end
// This is the ONLY reliable way to know a call has completed
// Configure this URL as the StatusCallback in your Twilio webhook settings
// ============================================================================

router.post('/status-callback', async (req, res) => {
  const {
    CallSid,
    CallStatus,
    CallDuration,
    From,
    To,
    Direction,
    AnsweredBy,
    Timestamp
  } = req.body;
  
  logger.info('[CALL STATUS] Status callback received', {
    callSid: CallSid,
    status: CallStatus,
    duration: CallDuration,
    from: From,
    to: To
  });
  
  try {
    // Only process completed calls
    if (['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(CallStatus)) {
      
      // ────────────────────────────────────────────────────────────────
      // CALL CENTER V2: End the call and update CallSummary
      // ────────────────────────────────────────────────────────────────
      if (CallSummaryService) {
        try {
          // Find the call by Twilio SID
          const CallSummary = require('../models/CallSummary');
          const callSummary = await CallSummary.findOne({ twilioSid: CallSid });
          
          if (callSummary) {
            // Map Twilio status to our outcome
            const outcomeMap = {
              'completed': 'completed',
              'busy': 'abandoned',
              'no-answer': 'abandoned',
              'canceled': 'abandoned',
              'failed': 'error'
            };
            
            // Update the call summary
            await CallSummaryService.endCall(callSummary.callId, {
              outcome: outcomeMap[CallStatus] || 'completed',
              durationSeconds: parseInt(CallDuration) || 0,
              answeredBy: AnsweredBy,
              endedAt: new Date(Timestamp) || new Date()
            });
            
            logger.info('[CALL STATUS] CallSummary updated', {
              callId: callSummary.callId,
              outcome: outcomeMap[CallStatus],
              duration: CallDuration
            });
          } else {
            logger.debug('[CALL STATUS] No CallSummary found for this call (may be test/spam)', {
              twilioSid: CallSid
            });
          }
        } catch (callCenterErr) {
          // Non-blocking: Log but don't fail the webhook
          logger.warn('[CALL STATUS] Failed to update CallSummary', {
            error: callCenterErr.message,
            twilioSid: CallSid
          });
        }
      }
      // ────────────────────────────────────────────────────────────────
      
      // ────────────────────────────────────────────────────────────────
      // V111 Phase 5: Generate transcript at call end
      // ────────────────────────────────────────────────────────────────
      // Non-blocking: Load ConversationMemory and generate transcripts
      // ────────────────────────────────────────────────────────────────
      (async () => {
        try {
          const { ConversationMemory } = require('../services/engine/ConversationMemory');
          const { generateAllTranscripts } = require('../services/TranscriptGenerator');
          const CallTranscript = require('../models/CallTranscript');
          const v2Company = require('../models/v2Company');
          
          // Try to load ConversationMemory from Redis
          const memory = await ConversationMemory.load(CallSid);
          
          if (!memory) {
            logger.debug('[V111 TRANSCRIPT] No ConversationMemory found for call (V111 may not be enabled)', {
              callSid: CallSid
            });
            return;
          }
          
          // Set the outcome on the memory
          memory.setOutcome({
            endReason: CallStatus === 'completed' ? 'caller_hangup' : CallStatus,
            duration: parseInt(CallDuration) * 1000 || 0,  // Convert to ms
            finalPhase: memory.phase?.current || 'DISCOVERY'
          });
          
          // Load company for branding
          const company = await v2Company.findById(memory.companyId).lean();
          
          // Generate all transcripts
          const transcripts = generateAllTranscripts(memory.toJSON(), company);
          
          // Save to MongoDB
          await CallTranscript.createFromMemory(memory.toJSON(), transcripts, company);
          
          logger.info('[V111 TRANSCRIPT] Transcript generated and saved', {
            callSid: CallSid,
            companyId: memory.companyId,
            turnCount: memory.turns?.length || 0,
            v111Enabled: memory.config?.enabled || false
          });
          
          // Archive memory (delete from Redis after saving transcript)
          await memory.archive();
          
        } catch (transcriptErr) {
          // Non-blocking: Log but don't fail
          logger.warn('[V111 TRANSCRIPT] Failed to generate transcript (non-fatal)', {
            callSid: CallSid,
            error: transcriptErr.message
          });
        }
      })();
      // ────────────────────────────────────────────────────────────────
    }
    
    // Always return 200 to Twilio.
    // IMPORTANT: Return valid TwiML (not plain text). This endpoint is sometimes
    // (incorrectly) referenced by <Dial action="..."> in legacy paths, where Twilio
    // expects TwiML and will throw "check your webhook settings" if it receives "OK".
    res.type('text/xml').status(200).send('<Response></Response>');
    
  } catch (error) {
    logger.error('[CALL STATUS] Status callback error', {
      error: error.message,
      callSid: CallSid
    });
    // Still return 200 to prevent Twilio retries
    res.type('text/xml').status(200).send('<Response></Response>');
  }
});

// Status callback for calls made TO customers (outbound)
router.post('/status-callback/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { CallSid, CallStatus, CallDuration, From, To } = req.body;
  
  logger.info('[CALL STATUS] Company-specific status callback', {
    companyId,
    callSid: CallSid,
    status: CallStatus,
    duration: CallDuration
  });
  
  // Handle same as generic callback
  try {
    if (CallSummaryService && ['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(CallStatus)) {
      const CallSummary = require('../models/CallSummary');
      const callSummary = await CallSummary.findOne({ twilioSid: CallSid, companyId });
      
      if (callSummary) {
        const outcomeMap = {
          'completed': 'completed',
          'busy': 'abandoned',
          'no-answer': 'abandoned', 
          'canceled': 'abandoned',
          'failed': 'error'
        };
        
        await CallSummaryService.endCall(callSummary.callId, {
          outcome: outcomeMap[CallStatus] || 'completed',
          durationSeconds: parseInt(CallDuration) || 0,
          endedAt: new Date()
        });
        
        logger.info('[CALL STATUS] Company CallSummary updated', {
          companyId,
          callId: callSummary.callId,
          outcome: outcomeMap[CallStatus]
        });
      }
    }
    
    // Return TwiML so this can safely be used in any TwiML action path.
    res.type('text/xml').status(200).send('<Response></Response>');
    
  } catch (error) {
    logger.error('[CALL STATUS] Company callback error', {
      companyId,
      error: error.message
    });
    res.type('text/xml').status(200).send('<Response></Response>');
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 🚨 V111: CATASTROPHIC DTMF HANDLER - Process caller's choice when everything fails
// ════════════════════════════════════════════════════════════════════════════════
// Called when caller presses 1 (forward to human) or 2 (leave message/callback)
// ════════════════════════════════════════════════════════════════════════════════
router.post('/catastrophic-dtmf/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { CallSid, Digits, From, To } = req.body;
  
  logger.warn('🚨 [CATASTROPHIC DTMF] Processing caller choice', {
    companyId,
    callSid: CallSid,
    digits: Digits,
    from: From,
    to: To,
    // V111: Log all body keys for debugging
    bodyKeys: Object.keys(req.body || {}).join(',')
  });
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  try {
    // Get stored config from Redis
    let config = null;
    let configSource = 'none';
    try {
      const { getSharedRedisClient } = require('../services/redisClientFactory');
      const redisClient = await getSharedRedisClient();
      if (redisClient) {
        const stored = await redisClient.get(`catastrophic:${CallSid}`);
        if (stored) {
          config = JSON.parse(stored);
          configSource = 'redis';
        }
      }
    } catch (redisErr) {
      logger.error('Failed to get catastrophic config from Redis', { error: redisErr.message });
    }
    
    // Fallback: load from company settings if Redis failed
    if (!config) {
      const Company = require('../models/v2Company');
      const company = await Company.findById(companyId)
        .select('aiAgentSettings.llm0Controls.recoveryMessages aiAgentSettings.frontDeskBehavior.connectionQualityGate phoneNumber')
        .lean();
      const rm = company?.aiAgentSettings?.llm0Controls?.recoveryMessages || {};
      const cqGate = company?.aiAgentSettings?.frontDeskBehavior?.connectionQualityGate || {};
      
      // V111: Check both catastrophic config sources (LLM-0 and Connection Quality Gate)
      config = {
        forwardNumber: rm.catastrophicForwardNumber || cqGate.transferDestination || company?.phoneNumber || '',
        option2Action: rm.catastrophicOption2Action || 'voicemail',
        companyId,
        twilioNumber: '' // Not available from DB, will use req.body.To
      };
      configSource = 'mongodb_fallback';
    }
    
    // V111 FIX: Determine callerId for outbound Dial — Twilio requires a number
    // owned by the account. Chain: req.body.To (the Twilio number) → config.twilioNumber → From
    const dialCallerId = To || config.twilioNumber || From;
    
    logger.info('🚨 [CATASTROPHIC DTMF] Config resolved', {
      callSid: CallSid,
      configSource,
      hasForwardNumber: !!config.forwardNumber,
      forwardNumberMasked: config.forwardNumber?.replace(/\d(?=\d{4})/g, '*'),
      option2Action: config.option2Action,
      dialCallerId: dialCallerId?.replace(/\d(?=\d{4})/g, '*')
    });
    
    // Log to BlackBox (fire-and-forget but BEFORE twiml generation)
    const BlackBoxLogger = require('../services/BlackBoxLogger');
    BlackBoxLogger.logEvent({
      callId: CallSid,
      companyId,
      type: 'CATASTROPHIC_DTMF_RECEIVED',
      turn: 0,
      data: {
        digits: Digits,
        action: Digits === '1' ? 'forward' : (Digits === '2' ? config.option2Action : 'unknown'),
        configSource,
        hasForwardNumber: !!config.forwardNumber,
        dialCallerId: dialCallerId?.replace(/\d(?=\d{4})/g, '*')
      }
    }).catch(() => {});
    
    if (Digits === '1' && config.forwardNumber) {
      // Option 1: Forward to human
      logger.info('🚨 [CATASTROPHIC] Forwarding call to human', {
        callSid: CallSid,
        forwardTo: config.forwardNumber.replace(/\d(?=\d{4})/g, '*'),
        callerId: dialCallerId?.replace(/\d(?=\d{4})/g, '*')
      });
      
      twiml.say(escapeTwiML("Connecting you now. Please hold."));
      // V111 FIX: twiml.dial(attributes) returns a Dial object — you MUST
      // call .number() to add the destination. The two-arg form dial(attrs, num)
      // is NOT supported; the second arg was silently ignored, producing an
      // empty <Dial> that Twilio rejected with "check your webhook settings".
      const dial = twiml.dial({
        callerId: dialCallerId,
        timeout: 30,
        action: `${getSecureBaseUrl(req)}/api/twilio/status-callback/${companyId}`
      });
      dial.number(config.forwardNumber);
      
    } else if (Digits === '2') {
      // Option 2: Handle based on configured action
      const action = config.option2Action || 'voicemail';
      
      if (action === 'voicemail') {
        logger.info('🚨 [CATASTROPHIC] Recording voicemail', { callSid: CallSid });
        
        twiml.say(escapeTwiML("Please leave your message after the tone. Press pound when finished."));
        twiml.record({
          maxLength: 120,
          finishOnKey: '#',
          transcribe: true,
          transcribeCallback: `${getSecureBaseUrl(req)}/api/twilio/voicemail-transcribe/${companyId}`,
          action: `${getSecureBaseUrl(req)}/api/twilio/voicemail-complete/${companyId}`
        });
        
      } else if (action === 'callback') {
        logger.info('🚨 [CATASTROPHIC] Callback requested', { callSid: CallSid, from: From });
        
        // Store callback request
        try {
          const CallbackRequest = require('../models/CallbackRequest');
          if (CallbackRequest) {
            await CallbackRequest.create({
              companyId,
              callSid: CallSid,
              callerPhone: From,
              requestedAt: new Date(),
              status: 'pending',
              source: 'catastrophic_fallback'
            });
          }
        } catch (cbErr) {
          logger.error('Failed to create callback request', { error: cbErr.message });
        }
        
        twiml.say(escapeTwiML("We've noted your callback request. Someone will call you back as soon as possible. Goodbye."));
        twiml.hangup();
        
      } else {
        // hangup option
        twiml.say(escapeTwiML("Thank you for calling. Please try again later. Goodbye."));
        twiml.hangup();
      }
      
    } else {
      // Invalid input - repeat menu or end
      twiml.say(escapeTwiML("I didn't understand that option. Please try again later. Goodbye."));
      twiml.hangup();
    }
    
  } catch (err) {
    logger.error('🚨 [CATASTROPHIC DTMF] Error processing choice', {
      error: err.message,
      callSid: CallSid
    });
    twiml.say(escapeTwiML("An error occurred. Please try again later."));
    twiml.hangup();
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ════════════════════════════════════════════════════════════════════════════════
// 🧪 MINIMAL TEST-GATHER ROUTE - Proves Twilio → Server → Action works
// ════════════════════════════════════════════════════════════════════════════════
// Use this to isolate whether the problem is:
//   A) Twilio can't reach your server at all, OR
//   B) Something specific to your v2 agent TwiML/flow
//
// To test: Point a Twilio phone number to /api/twilio/test-gather-twiml
// Or use TwiML Bin with the XML below.
// ════════════════════════════════════════════════════════════════════════════════

// Step 1: Returns minimal TwiML that triggers Gather → action
router.post('/test-gather-twiml', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const actionUrl = `https://${req.get('host')}/api/twilio/test-gather`;
  
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('🧪 [TEST-GATHER-TWIML] Sending minimal TwiML');
  console.log('Action URL:', actionUrl);
  console.log('════════════════════════════════════════════════════════════════════════════════');
  
  const gather = twiml.gather({
    input: 'speech',
    action: actionUrl,
    method: 'POST',
    timeout: 5,
    speechTimeout: 'auto'
  });
  gather.say('Say anything after this message, then wait.');
  
  twiml.say("We didn't get anything. Goodbye.");
  
  res.type('text/xml').send(twiml.toString());
});

// Step 2: Receives speech result - if this logs, Twilio → action path works
router.post('/test-gather', (req, res) => {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('🔥 /test-gather HIT! Twilio successfully called action URL!');
  console.log('CallSid:', req.body.CallSid);
  console.log('SpeechResult:', req.body.SpeechResult);
  console.log('From:', req.body.From);
  console.log('To:', req.body.To);
  console.log('════════════════════════════════════════════════════════════════════════════════');
  
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(`We heard: ${req.body.SpeechResult || 'nothing'}. Goodbye.`);
  res.type('text/xml').send(twiml.toString());
});

logger.info('🚀 [V2TWILIO] ========== EXPORTING ROUTER (FILE LOADED SUCCESSFULLY) ==========');
module.exports = router;