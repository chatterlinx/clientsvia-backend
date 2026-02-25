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
// ☢️ NUKED Feb 2026: FrontDeskCoreRuntime references removed - CallRuntime is the sole runtime
const { CallRuntime } = require('../services/engine/CallRuntime');
const { StateStore } = require('../services/engine/StateStore');
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
// V116: Instant audio cache for ultra-fast <Play> on known lines
const InstantAudioService = require('../services/instantAudio/InstantAudioService');

// 🔌 V94: AWConfigReader for traced config reads in BookingFlowRunner (Phase B)
let AWConfigReader;
try {
    AWConfigReader = require('../services/wiring/AWConfigReader');
} catch (e) {
    logger.warn('[V2TWILIO] AWConfigReader not available - BookingFlowRunner will use direct config access');
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

/**
 * Ensure a CallSummary exists for this Twilio call.
 * This protects against direct webhooks to /:companyID/voice that bypass /voice.
 */
async function ensureCallSummaryRegistered({ companyId, fromNumber, callSid, direction = 'inbound' }) {
  if (!CallSummaryService || !companyId || !callSid || !fromNumber) {
    return { ok: false, reason: 'missing_prerequisites' };
  }

  try {
    const CallSummary = require('../models/CallSummary');
    const existing = await CallSummary.findOne({ companyId, twilioSid: callSid })
      .select('_id callId')
      .lean();

    if (existing) {
      return { ok: true, existing: true, callId: existing.callId };
    }

    const context = await CallSummaryService.startCall({
      companyId: String(companyId),
      phone: fromNumber,
      twilioSid: callSid,
      direction
    });

    return { ok: true, existing: false, callId: context?.callId || null };
  } catch (error) {
    logger.error('[CALL CENTER] Failed to ensure call registration (non-blocking)', {
      companyId: String(companyId),
      callSid,
      error: error.message,
      stack: error.stack
    });
    return { ok: false, reason: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ GREETING TEXT VALIDATOR - Prevents code/JSON from being read aloud
// ═══════════════════════════════════════════════════════════════════════════
// Data corruption can cause greeting text to contain code, JSON, or objects.
// This validator ensures only plain human-readable text reaches TTS/Say.
// ═══════════════════════════════════════════════════════════════════════════
function validateGreetingText(text, fallback = 'Thank you for calling. How can I help you today?') {
  // Must be a string
  if (typeof text !== 'string') {
    logger.error('[GREETING VALIDATOR] ❌ Text is not a string', { type: typeof text });
    return fallback;
  }
  
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }
  
  // Detect JSON objects/arrays
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    logger.error('[GREETING VALIDATOR] ❌ Text appears to be JSON', { preview: trimmed.substring(0, 100) });
    return fallback;
  }
  
  // Detect JavaScript code patterns
  const codePatterns = [
    /^function\s/,           // function declarations
    /^const\s/,              // const declarations
    /^let\s/,                // let declarations
    /^var\s/,                // var declarations
    /^module\.exports/,      // module exports
    /^require\(/,            // require statements
    /^import\s/,             // import statements
    /^export\s/,             // export statements
    /=>\s*\{/,               // arrow functions
    /\bclass\s+\w+\s*\{/,    // class declarations
  ];
  
  // 🆕 DETECT BUSINESS/FILE IDENTIFIERS (prevents "connection greeting code" being read aloud)
  const businessIdPatterns = [
    /CONNECTION_GREETING/i,           // Business constant
    /fd_CONNECTION_GREETING/i,        // File prefix
    /^fd_[A-Z_]+_\d+$/,              // Generic file ID pattern
    /\/audio\//i,                     // File path leak
    /\.mp3/i,                         // Audio file extension
    /\.wav/i,                         // Audio file extension
    /\.ogg/i,                         // Audio file extension
    /^https?:\/\//i,                  // URL leak
    /^\/.*\.(mp3|wav|ogg)$/i         // Any audio file path
  ];
  
  for (const pattern of codePatterns) {
    if (pattern.test(trimmed)) {
      logger.error('[GREETING VALIDATOR] ❌ Text appears to be code', { preview: trimmed.substring(0, 100) });
      return fallback;
    }
  }
  
  // 🆕 CHECK FOR BUSINESS/FILE IDENTIFIERS
  for (const pattern of businessIdPatterns) {
    if (pattern.test(trimmed)) {
      logger.error('[GREETING VALIDATOR] ❌ Text contains internal identifier', { 
        preview: trimmed.substring(0, 100),
        pattern: pattern.toString()
      });
      return fallback;
    }
  }
  
  // Detect excessive brackets/braces (likely code or config)
  const bracketCount = (trimmed.match(/[{}\[\]]/g) || []).length;
  if (bracketCount > 5 && bracketCount / trimmed.length > 0.02) {
    logger.error('[GREETING VALIDATOR] ❌ Text has excessive brackets (likely code)', { preview: trimmed.substring(0, 100), bracketCount });
    return fallback;
  }
  
  return trimmed;
}

function slotBagValue(slots, slotId) {
  const entry = slots?.[slotId];
  if (entry == null) return null;
  if (typeof entry === 'object' && !Array.isArray(entry)) {
    if (entry.v != null) return entry.v;
    if (entry.value != null) return entry.value;
  }
  return entry;
}

function hasSlotValue(slots, slotId) {
  const value = slotBagValue(slots, slotId);
  return value != null && `${value}`.trim() !== '';
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
// NOTE: BlackBox/CallLogger deprecated Feb 2026 - stub provides no-op methods
// ============================================================================
let CallLogger;
try {
    CallLogger = require('../services/CallLogger');
} catch (err) {
    CallLogger = null;
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

/**
 * Normalize audio URL for Twilio <Play>.
 * Twilio needs a publicly resolvable absolute URL; Agent 2.0 often stores relative paths.
 */
function toAbsoluteAudioUrl(req, rawUrl) {
  const url = `${rawUrl || ''}`.trim();
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${getSecureBaseUrl(req)}${url}`;
  return `${getSecureBaseUrl(req)}/${url}`;
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
      actionOnEmptyResult: true, // CRITICAL: Post to action even if no speech (prevents loop)
      timeout: 7,
      speechTimeout: 'auto',
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

// ════════════════════════════════════════════════════════════════════════════════
// 🏓 PING ENDPOINT - Instant health check for Twilio webhook verification
// ════════════════════════════════════════════════════════════════════════════════
// Use: GET /api/twilio/ping → 200 "ok" (proves Render deploy is alive)
// This is critical for diagnosing 11200 errors vs actual route issues.
// ════════════════════════════════════════════════════════════════════════════════
router.get('/ping', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'clientsvia-twilio-webhooks',
    routes: ['/voice', '/:companyId/voice', '/v2-agent-respond/:companyId']
  });
});

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
      // Using robust defaults: auto speechTimeout, 7s initialTimeout, actionOnEmptyResult
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${company.template._id}`,
        method: 'POST',
        actionOnEmptyResult: true, // CRITICAL: Post to action even if no speech (prevents loop)
        timeout: 7, // Initial timeout (how long to wait for ANY speech)
        speechTimeout: 'auto', // Auto speech timeout - let Twilio decide when user is done
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
    // 🔥 CONFIG PRE-WARM: Fire-and-forget cache warming at call start
    // ════════════════════════════════════════════════════════════════════════════
    // DO NOT AWAIT — this runs in background while call setup continues.
    // Loads: agent2Config, bookingConfig, calendarStatus, globalFirstNames
    // By the time first turn runs, cache should be warm.
    // ════════════════════════════════════════════════════════════════════════════
    const ConfigCacheService = require('../services/ConfigCacheService');
    const companyIdStr = company._id.toString();
    
    ConfigCacheService.prewarmForCall(companyIdStr)
      .then(result => {
        logger.info('[CONFIG PRE-WARM] Complete', {
          companyId: companyIdStr,
          t_total_ms: result?.perf?.t_total_ms,
          cacheHits: result?.perf?.cacheHit
        });
      })
      .catch(err => {
        logger.warn('[CONFIG PRE-WARM] Failed (non-blocking)', {
          error: err?.message,
          companyId: companyIdStr
        });
      });
    
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
          toPhone: req.body.To || null,
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
        // Non-blocking: call still continues even if recognition fails,
        // but log with full stack so issues surface in monitoring.
        logger.error('[CALL CENTER] Customer recognition failed (non-blocking)', {
          error: callCenterErr.message,
          stack: callCenterErr.stack,
          companyId: company._id.toString(),
          phone: req.body.From,
          callSid: req.body.CallSid
        });
      }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 📞 REGISTER STATUS CALLBACK — Ensures endCall fires when Twilio hangs up
    // ════════════════════════════════════════════════════════════════════════════
    // Twilio sends a status callback (completed/failed/busy/no-answer) only if a
    // StatusCallback URL is configured.  We register it here via the REST API so
    // every inbound call gets duration + transcript generation — even if the Twilio
    // phone-number settings don't have it pre-configured.
    // Fire-and-forget: must NOT block the voice response.
    // ════════════════════════════════════════════════════════════════════════════
    if (company.twilioConfig?.accountSid && company.twilioConfig?.authToken && req.body.CallSid) {
      const statusCallbackUrl = `${getSecureBaseUrl(req)}/api/twilio/status-callback/${company._id}`;
      try {
        const twilioClient = twilio(company.twilioConfig.accountSid, company.twilioConfig.authToken);
        twilioClient.calls(req.body.CallSid)
          .update({
            statusCallback: statusCallbackUrl,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer']
          })
          .then(() => {
            logger.debug('[CALL STATUS] Status callback registered', {
              callSid: req.body.CallSid,
              url: statusCallbackUrl
            });
          })
          .catch(err => {
            logger.warn('[CALL STATUS] Failed to register status callback (non-blocking)', {
              callSid: req.body.CallSid,
              error: err.message
            });
          });
      } catch (twilioInitErr) {
        logger.warn('[CALL STATUS] Could not init Twilio client for status callback', {
          error: twilioInitErr.message
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
    
    if (CallLogger) {
      try {
        await CallLogger.initCall({
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
        actionOnEmptyResult: true, // CRITICAL: Post to action even if no speech detected (prevents infinite loop)
        bargeIn: speechDetection.bargeIn ?? false,
        timeout: speechDetection.initialTimeout ?? 7,
        speechTimeout: speechDetection.speechTimeout ? speechDetection.speechTimeout.toString() : 'auto',
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        hints: hints,
        partialResultCallback: `https://${req.get('host')}/api/twilio/v2-agent-partial/${company._id}`,
        partialResultCallbackMethod: 'POST'
      };
      
      const gather = twiml.gather(gatherConfig);
      
      // 📼 BLACK BOX: Log gather configuration for debugging
      if (CallLogger) {
        CallLogger.logEvent({
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

      // ═══════════════════════════════════════════════════════════════════════
      // GREETING PLAYBACK: Handle prerecorded audio vs TTS
      // ═══════════════════════════════════════════════════════════════════════
      const greetingMode = initResult.greetingConfig?.mode;
      const greetingSource = initResult.greetingConfig?.source || 'legacy';
      const elevenLabsVoice = initResult.voiceSettings?.voiceId;
      
      // 🛡️ CRITICAL: Validate greeting text before use (prevents code/JSON being read aloud)
      const validatedGreeting = validateGreetingText(initResult.greeting);
      initResult.greeting = validatedGreeting;
      
      logger.debug(`🔍 [CALL-7] Greeting mode: ${greetingMode}, source: ${greetingSource}`);
      logger.debug(`🔍 [CALL-8] Has greeting text: ${Boolean(initResult.greeting)}`);
      logger.debug(`🔍 [CALL-9] Has audioUrl: ${Boolean(initResult.greetingConfig?.audioUrl)}`);
      logger.debug(`[V2 VOICE CHECK] ElevenLabs Voice ID: ${elevenLabsVoice || 'NOT SET'}`);
      
      // MODE: PRERECORDED AUDIO (Agent 2.0 or legacy)
      // 🛡️ RENDER EPHEMERAL FIX: Check if audio file exists before using <Play>
      // Instant-lines MP3s are stored on local disk which gets wiped on redeploy.
      // If file doesn't exist, fall through to TTS instead of causing Twilio 404.
      if (greetingMode === 'prerecorded' && initResult.greetingConfig?.audioUrl) {
        const rawAudioPath = initResult.greetingConfig.audioUrl;
        let audioFileExists = false;
        
        // Check if this is a local file path we can verify
        if (rawAudioPath.startsWith('/audio/')) {
          const localFilePath = path.join(__dirname, '../public', rawAudioPath);
          audioFileExists = fs.existsSync(localFilePath);
          if (!audioFileExists) {
            logger.warn(`[GREETING] ⚠️ Prerecorded audio file missing (ephemeral storage): ${localFilePath}`);
          }
        } else if (rawAudioPath.startsWith('http')) {
          // External URL - assume it exists (can't check synchronously)
          audioFileExists = true;
        }
        
        if (audioFileExists) {
          const audioUrl = toAbsoluteAudioUrl(req, rawAudioPath);
          logger.info(`[GREETING] 🎵 Playing pre-recorded audio (source: ${greetingSource}): ${audioUrl}`);
          gather.play(audioUrl);
          
          // 📼 BLACK BOX: Log prerecorded greeting played
          if (CallLogger) {
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'GREETING_PRERECORDED',
              turn: 0,
              data: {
                audioUrl,
                source: greetingSource
              }
            }).catch(() => {});
            
            // V4: SPEECH_SOURCE_SELECTED for Call Review transcript attribution
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'SPEECH_SOURCE_SELECTED',
              turn: 0,
              data: {
                sourceId: greetingSource === 'agent2' ? 'agent2.greetings.callStart' : 'legacy.greeting',
                uiPath: greetingSource === 'agent2' 
                  ? 'aiAgentSettings.agent2.greetings.callStart.audioUrl' 
                  : 'aiAgentSettings.connectionMessages.greeting',
                uiTab: greetingSource === 'agent2' ? 'Greetings' : 'Connection Messages',
                configPath: greetingSource === 'agent2' ? 'agent2.greetings.callStart.audioUrl' : 'connectionMessages.greeting',
                spokenTextPreview: '(prerecorded audio)',
                audioUrl,
                note: 'Call start greeting (prerecorded audio)',
                isFromUiConfig: true
              }
            }).catch(() => {});
          }
        } else {
          // 🛡️ FALLBACK: Audio file missing, use TTS instead
          logger.warn(`[GREETING] 🔄 Prerecorded audio missing, falling back to TTS`);
          
          // Determine what text will be spoken
          const fallbackText = initResult.greeting || 'Thank you for calling. How may I help you today?';
          const hasUiConfiguredText = Boolean(initResult.greeting);
          
          if (CallLogger) {
            // Log the audio missing event
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'GREETING_AUDIO_MISSING_TTS_FALLBACK',
              turn: 0,
              data: {
                missingAudioPath: rawAudioPath,
                source: greetingSource,
                fallbackMode: elevenLabsVoice ? 'elevenlabs' : 'twilio_say',
                fallbackText: fallbackText.substring(0, 100),
                hasUiConfiguredText
              }
            }).catch(() => {});
            
            // V4: SPEECH_SOURCE_SELECTED for Call Review transcript attribution
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'SPEECH_SOURCE_SELECTED',
              turn: 0,
              data: {
                sourceId: hasUiConfiguredText 
                  ? 'agent2.greetings.callStart.text' 
                  : 'HARDCODED_FALLBACK',
                uiPath: hasUiConfiguredText 
                  ? 'aiAgentSettings.agent2.greetings.callStart.text' 
                  : 'UNMAPPED - HARDCODED_FALLBACK',
                uiTab: 'Greetings',
                configPath: 'agent2.greetings.callStart.text',
                spokenTextPreview: fallbackText.substring(0, 100),
                note: `Audio file missing (${rawAudioPath}), using TTS fallback from text field`,
                isFromUiConfig: hasUiConfiguredText,
                audioMissing: true,
                originalAudioPath: rawAudioPath
              }
            }).catch(() => {});
          }
          
          // Fall through to TTS logic below by NOT using the prerecorded branch
          // We achieve this by re-checking TTS conditions
          if (elevenLabsVoice && initResult.greeting) {
            try {
              logger.info(`[GREETING] 🎙️ TTS fallback for missing audio (ElevenLabs: ${elevenLabsVoice})`);
              const ttsStartTime = Date.now();
              const greetingText = cleanTextForTTS(stripMarkdown(initResult.greeting));
              
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
              logger.info(`[GREETING] ✅ TTS fallback completed in ${ttsTime}ms`);
              
              const fileName = `ai_greet_fallback_${Date.now()}.mp3`;
              const audioDir = path.join(__dirname, '../public/audio');
              if (!fs.existsSync(audioDir)) { fs.mkdirSync(audioDir, { recursive: true }); }
              fs.writeFileSync(path.join(audioDir, fileName), buffer);
              gather.play(`${getSecureBaseUrl(req)}/audio/${fileName}`);
            } catch (ttsErr) {
              logger.error(`[GREETING] ❌ TTS fallback failed: ${ttsErr.message}`);
              gather.say(escapeTwiML(cleanTextForTTS(stripMarkdown(initResult.greeting))));
            }
          } else if (initResult.greeting) {
            gather.say(escapeTwiML(cleanTextForTTS(stripMarkdown(initResult.greeting))));
          } else {
            gather.say('Thank you for calling. How may I help you today?');
          }
        }
      }
      // MODE: DISABLED (skip greeting, go straight to listening)
      else if (greetingMode === 'disabled') {
        logger.info(`[GREETING] ⏭️ Greeting disabled (source: ${greetingSource}) — going straight to AI listening`);
        // No greeting played, just the gather will listen
        
        if (CallLogger) {
          CallLogger.logEvent({
            callId: req.body.CallSid,
            companyId: company._id,
            type: 'GREETING_SKIPPED',
            turn: 0,
            data: { source: greetingSource, reason: 'disabled' }
          }).catch(() => {});
        }
      }
      // MODE: REALTIME TTS (ElevenLabs)
      else if (elevenLabsVoice && initResult.greeting) {
        try {
          logger.debug(`[TTS START] ✅ Using ElevenLabs voice ${elevenLabsVoice} for initial greeting (source: ${greetingSource})`);
          const ttsStartTime = Date.now();
          const greetingText = cleanTextForTTS(stripMarkdown(initResult.greeting));
          
          // 📼 BLACK BOX: Log TTS started
          if (CallLogger) {
            CallLogger.QuickLog.ttsStarted(
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
          logger.info(`[TTS COMPLETE] [OK] AI Agent Logic greeting TTS completed in ${ttsTime}ms (source: ${greetingSource})`);
          
          // 📼 BLACK BOX: Log TTS completed
          if (CallLogger) {
            CallLogger.QuickLog.ttsCompleted(
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
          if (CallLogger) {
            CallLogger.QuickLog.greetingSent(
              req.body.CallSid,
              company._id,
              greetingText,
              ttsTime
            ).catch(() => {}); // Fire and forget
            
            // V4: SPEECH_SOURCE_SELECTED for Call Review transcript attribution
            const usedFallback = initResult.greetingConfig?.usedHardcodedFallback === true;
            const fallbackReason = initResult.greetingConfig?.fallbackReason || null;
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'SPEECH_SOURCE_SELECTED',
              turn: 0,
              data: {
                sourceId: greetingSource === 'agent2' ? 'agent2.greetings.callStart' : 'legacy.greeting',
                uiPath: usedFallback 
                  ? 'UNMAPPED - HARDCODED_FALLBACK' 
                  : (greetingSource === 'agent2' 
                    ? 'aiAgentSettings.agent2.greetings.callStart.text' 
                    : 'aiAgentSettings.connectionMessages.greeting'),
                uiTab: greetingSource === 'agent2' ? 'Greetings' : 'Connection Messages',
                configPath: greetingSource === 'agent2' ? 'agent2.greetings.callStart.text' : 'connectionMessages.greeting',
                spokenTextPreview: greetingText.substring(0, 120),
                note: usedFallback 
                  ? `FALLBACK: ${fallbackReason}` 
                  : 'Call start greeting',
                isFromUiConfig: !usedFallback,
                usedHardcodedFallback: usedFallback
              }
            }).catch(() => {});
          }
        } catch (err) {
          logger.error('❌ AI Agent Logic TTS failed, using Say:', err);
          
          // 📼 BLACK BOX: Log TTS failure
          if (CallLogger) {
            CallLogger.QuickLog.ttsFailed(
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
      if (CallLogger) {
        CallLogger.logEvent({
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
        actionOnEmptyResult: true,
        bargeIn: false,
        timeout: 7,
        speechTimeout: 'auto',
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
    // NOTE: initResult may not be defined if we hit the catch block (fallback path)
    if (CallLogger) {
      CallLogger.logEvent({
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
          twimlPreview: twimlString.substring(0, 500),
          // V4: responsePreview for Turn-0 greeting (Call Review needs this)
          // Guard against initResult not being defined in fallback path
          responsePreview: (typeof initResult !== 'undefined' && initResult?.greeting) ? initResult.greeting.substring(0, 80) : null
        }
      }).catch(() => {});
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 📝 TRANSCRIPT V2: Persist greeting (Turn 0) DURING the call (Mongo)
    // ════════════════════════════════════════════════════════════════════════════
    // Canonical persistence: append immediately to CallTranscriptV2 keyed by (companyId, callSid).
    // Redis/status-callback are not required for transcript safety (kept for other state/diagnostics).
    // ════════════════════════════════════════════════════════════════════════════
    const greetingText = (typeof initResult !== 'undefined' && initResult?.greeting) ? initResult.greeting : null;
    if (greetingText && req.body.CallSid) {
      // Derive how the greeting was delivered (Play vs Say) from the actual TwiML we just sent.
      // This is critical for diagnosis (e.g., Twilio default voice vs ElevenLabs audio).
      const greetingPlayMatch = twimlString.match(/<Play[^>]*>([^<]+)<\/Play>/i);
      const greetingAudioUrl = greetingPlayMatch?.[1]?.trim?.() || null;
      const greetingVoiceProviderUsed = greetingAudioUrl ? 'twilio_play' : 'twilio_say';
      const greetingConfigSource = (typeof initResult !== 'undefined' && initResult?.greetingConfig?.source)
        ? `${initResult.greetingConfig.source}`
        : null;
      const greetingMode = (typeof initResult !== 'undefined' && initResult?.greetingConfig?.mode)
        ? `${initResult.greetingConfig.mode}`
        : null;
      const greetingUiPath = greetingConfigSource === 'agent2'
        ? (greetingAudioUrl
          ? 'aiAgentSettings.agent2.greetings.callStart.audioUrl'
          : 'aiAgentSettings.agent2.greetings.callStart.text')
        : 'aiAgentSettings.connectionMessages.greeting';

      try {
        const CallTranscriptV2 = require('../models/CallTranscriptV2');
        await CallTranscriptV2.appendTurns(
          company._id,
          req.body.CallSid,
          [
            {
              speaker: 'agent',
              kind: 'CONVERSATION_AGENT',
              text: greetingText.trim(),
              turnNumber: 0,
              ts: new Date(),
              sourceKey: greetingConfigSource === 'agent2' ? 'agent2.greetings.callStart' : 'legacy.greeting',
              trace: {
                kind: 'greeting',
                provenance: {
                  type: 'UI_OWNED',
                  uiPath: greetingUiPath,
                  greeting: { mode: greetingMode, source: greetingConfigSource },
                  voiceProviderUsed: greetingVoiceProviderUsed,
                  audioUrl: greetingAudioUrl
                },
                uiPath: greetingUiPath,
                greeting: { mode: greetingMode, source: greetingConfigSource },
                voiceProviderUsed: greetingVoiceProviderUsed,
                audioUrl: greetingAudioUrl
              }
            }
          ],
          { from: req.body.From || null, to: req.body.To || null, startedAt: new Date() }
        );

        // Telephony action (what Twilio actually played)
        await CallTranscriptV2.appendTurns(
          company._id,
          req.body.CallSid,
          [
            {
              speaker: 'system',
              kind: greetingAudioUrl ? 'TWIML_PLAY' : 'TWIML_SAY',
              text: greetingText.trim(),
              turnNumber: 0,
              ts: new Date(),
              sourceKey: 'twiml',
              trace: {
                action: greetingAudioUrl ? 'PLAY' : 'SAY',
                audioUrl: greetingAudioUrl || null,
                voiceProviderUsed: greetingVoiceProviderUsed,
                origin: greetingUiPath,
                gather: {
                  actionUrl: `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`,
                  partialUrl: `https://${req.get('host')}/api/twilio/v2-agent-partial/${company._id}`
                }
              }
            }
          ]
        );
      } catch (mongoV2Err) {
        logger.warn('[VOICE] Failed to append greeting turn to CallTranscriptV2 (non-blocking)', {
          error: mongoV2Err.message
        });
      }

      try {
        const redis = await getRedis();
        if (redis) {
          const redisKey = `call:${req.body.CallSid}`;
          const existingRaw = await redis.get(redisKey);
          const callState = existingRaw ? JSON.parse(existingRaw) : {};
          
          // Initialize turns array with greeting as first agent turn
          // Preserve any existing turns (shouldn't be any at greeting time, but be safe)
          if (!callState.turns) {
            callState.turns = [];
          }
          callState.turns.unshift({
            speaker: 'agent',
            text: greetingText.trim(),
            turn: 0,
            timestamp: new Date().toISOString(),
            source: 'GREETING',
            provenance: {
              type: 'UI_OWNED',
              uiPath: greetingUiPath,
              greeting: {
                mode: greetingMode,
                source: greetingConfigSource
              },
              voiceProviderUsed: greetingVoiceProviderUsed,
              audioUrl: greetingAudioUrl
            }
          });
          
          await redis.set(redisKey, JSON.stringify(callState), { EX: 60 * 60 * 4 });
          logger.info('[VOICE] Saved greeting to Redis for transcript', {
            callSid: req.body.CallSid.slice(-8),
            textPreview: greetingText.slice(0, 50)
          });
        }
      } catch (greetingRedisErr) {
        logger.warn('[VOICE] Failed to save greeting to Redis (non-blocking)', {
          error: greetingRedisErr.message
        });
      }
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
          if (lcSettings.logToBlackBox && CallLogger) {
            try {
              await CallLogger.logEvent({
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
                  if (lcSettings.logToBlackBox && CallLogger) {
                    try {
                      await CallLogger.logEvent({
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
                  
                  if (lcSettings.logToBlackBox && CallLogger) {
                    try {
                      await CallLogger.logEvent({
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
                
                if (lcSettings.logToBlackBox && CallLogger) {
                  try {
                    await CallLogger.logEvent({
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
            
            if (lcSettings.logToBlackBox && CallLogger) {
              try {
                await CallLogger.logEvent({
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
        if (lcSettings.logToBlackBox && CallLogger) {
          try {
            await CallLogger.logEvent({
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
          if (lcSettings.logToBlackBox && CallLogger) {
            try {
              await CallLogger.logEvent({
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
        actionOnEmptyResult: true,
        bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
        timeout: speechDetection.initialTimeout ?? 7,
        speechTimeout: speechDetection.speechTimeout ? speechDetection.speechTimeout.toString() : 'auto',
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
          actionOnEmptyResult: true,
          bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
          timeout: speechDetection.initialTimeout ?? 7,
          speechTimeout: speechDetection.speechTimeout ? speechDetection.speechTimeout.toString() : 'auto',
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
        actionOnEmptyResult: true,
        bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
        timeout: speechDetection.initialTimeout ?? 7,
        speechTimeout: speechDetection.speechTimeout ? speechDetection.speechTimeout.toString() : 'auto',
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
      actionOnEmptyResult: true,
      bargeIn: speechDetection.bargeIn ?? false,
      timeout: speechDetection.initialTimeout ?? 7,
      speechTimeout: speechDetection.speechTimeout ? speechDetection.speechTimeout.toString() : 'auto',
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
        if (CallLogger) {
          CallLogger.logEvent({
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

// ════════════════════════════════════════════════════════════════════════════════
// COMPANY VOICE ENDPOINT - /:companyId/voice format (matches <Redirect> in TwiML)
// ════════════════════════════════════════════════════════════════════════════════
// The /voice route uses <Redirect> to /:companyId/voice for continuation.
// This route MUST exist or Twilio gets 404 after the initial greeting.
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:companyID/voice', async (req, res) => {
  const { companyID } = req.params;
  logger.info(`[TWILIO] /:companyId/voice hit for company ${companyID}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  try {
    const company = await Company.findById(companyID);
    if (!company) {
      logger.error(`[TWILIO] Company not found: ${companyID}`);
      twiml.say('Sorry, there was a configuration error. Please try again later.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Safety net: if Twilio webhook is pointed directly at this route,
    // register the call summary so Call Review does not stay blank.
    const callSid = req.body?.CallSid;
    const fromNumber = req.body?.From;
    if (callSid && fromNumber) {
      const registration = await ensureCallSummaryRegistered({
        companyId: company._id,
        fromNumber,
        callSid,
        direction: 'inbound'
      });

      logger.info('[CALL CENTER] /:companyId/voice registration guard', {
        companyId: companyID,
        callSid,
        registered: registration.ok,
        existing: registration.existing === true,
        callId: registration.callId || null,
        reason: registration.reason || null
      });
    }
    
    // Set up gather for continued conversation
    const gather = twiml.gather({
      input: 'speech',
      action: `${getSecureBaseUrl(req)}/api/twilio/v2-agent-respond/${companyID}`,
      method: 'POST',
      actionOnEmptyResult: true, // CRITICAL: Post to action even if no speech (prevents loop)
      timeout: 7,
      speechTimeout: 'auto',
      enhanced: true,
      speechModel: 'phone_call'
    });
    
    // Silent gather - just listening for next input
    gather.pause({ length: 1 });
    
    // If no input, redirect back to continue listening
    twiml.redirect(`${getSecureBaseUrl(req)}/api/twilio/${companyID}/voice`);
    
  } catch (err) {
    logger.error(`[TWILIO] /:companyId/voice error: ${err.message}`);
    twiml.say('Sorry, there was a technical issue. Please try again.');
    twiml.hangup();
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ════════════════════════════════════════════════════════════════════════════════
// LEGACY ALIAS: /voice/:companyID → redirects to canonical /:companyId/voice
// ════════════════════════════════════════════════════════════════════════════════
// This is a legacy URL format that some old TwiML or configs may still use.
// Instead of duplicating logic, we redirect to the canonical route.
// ════════════════════════════════════════════════════════════════════════════════
router.post('/voice/:companyID', (req, res) => {
  const { companyID } = req.params;
  
  logger.info(`[TWILIO] Legacy /voice/:companyId hit - redirecting to canonical /:companyId/voice`, {
    companyId: companyID,
    callSid: req.body.CallSid
  });
  
  // Redirect via TwiML to canonical route
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.redirect(`${getSecureBaseUrl(req)}/api/twilio/${companyID}/voice`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ═══════════════════════════════════════════════════════════════════════════
// V129: BRIDGE CONTINUATION ENDPOINT (TWO-PHASE TWIML)
// ═══════════════════════════════════════════════════════════════════════════
// Used only when /v2-agent-respond returns bridge TwiML early.
// This endpoint does NOT run core runtime and does NOT increment turn count.
// It polls Redis for cached final TwiML and returns it when ready.
router.post('/v2-agent-bridge-continue/:companyID', async (req, res) => {
  const companyID = req.params.companyID;
  const callSid = req.body.CallSid;
  const token = `${req.query.token || ''}`.trim();
  const turnNumber = parseInt(req.query.turn || 0, 10) || 0;
  // NOTE: attempt is not trusted as the sole cap (query params can be replayed).
  const attemptHint = parseInt(req.query.attempt || 0, 10) || 0;

  let twimlString = '';
  let voiceProviderUsed = 'twilio_say';

  try {
    const redis = await getRedis();
    const company = await Company.findById(companyID).lean();

    const bridgeCfg = company?.aiAgentSettings?.agent2?.bridge || {};
    const hardCapMs = Number.isFinite(bridgeCfg.hardCapMs) ? bridgeCfg.hardCapMs : 6000;
    const maxRedirectAttempts = Number.isFinite(bridgeCfg.maxRedirectAttempts) ? bridgeCfg.maxRedirectAttempts : 2;

    const cacheKey = callSid && token ? `a2bridge:twiml:${callSid}:${turnNumber}:${token}` : null;
    const startedKey = callSid && token ? `a2bridge:t0:${callSid}:${turnNumber}:${token}` : null;
    const attemptsKey = callSid && token ? `a2bridge:attempts:${callSid}:${turnNumber}:${token}` : null;

    // Redis-backed redirect attempts counter (hard cap that can't be reset by query params)
    let attempt = attemptHint;
    if (redis && attemptsKey) {
      try {
        attempt = await redis.incr(attemptsKey);
        if (attempt === 1) {
          // Attempt cap TTL: short-lived per bridged turn/token
          await redis.expire(attemptsKey, 60 * 5);
        }
      } catch (_) {
        // If Redis errors here, fall back to attemptHint (still capped, but weaker).
        attempt = attemptHint;
      }
    }

    let startedAtMs = 0;
    if (redis && startedKey) {
      const raw = await redis.get(startedKey);
      startedAtMs = parseInt(raw || 0, 10) || 0;
    }
    const elapsedMs = startedAtMs ? (Date.now() - startedAtMs) : null;

    let cached = null;
    if (redis && cacheKey) {
      const raw = await redis.get(cacheKey);
      cached = raw ? JSON.parse(raw) : null;
    }

    if (cached?.twimlString) {
      voiceProviderUsed = cached.voiceProviderUsed || voiceProviderUsed;

      // ═══════════════════════════════════════════════════════════════════════════
      // V130: BUILD BRIDGE-SAFE TWIML
      // ═══════════════════════════════════════════════════════════════════════════
      // The cached TwiML has <Gather> wrapping the response, which causes issues:
      // - Caller speech during playback triggers the Gather's action URL
      // - This cuts off the intended response and starts a new turn
      //
      // FIX: Build new TwiML that:
      // 1. Plays the response WITHOUT Gather (so it can't be interrupted)
      // 2. Redirects to a listen endpoint that sets up the Gather for next input
      // ═══════════════════════════════════════════════════════════════════════════
      const hostHeader = req.get('host');
      const twiml = new twilio.twiml.VoiceResponse();
      
      if (cached.audioUrl) {
        twiml.play(cached.audioUrl);
      } else if (cached.responseText) {
        twiml.say(escapeTwiML(cached.responseText));
      } else {
        const playUrlMatch = cached.twimlString.match(/<Play[^>]*>([^<]+)<\/Play>/);
        const sayMatch = cached.twimlString.match(/<Say[^>]*>([^<]+)<\/Say>/);
        if (playUrlMatch) {
          twiml.play(playUrlMatch[1]);
        } else if (sayMatch) {
          twiml.say(sayMatch[1]);
        } else {
          twimlString = cached.twimlString;
          res.type('text/xml');
          return res.send(twimlString);
        }
      }
      
      const listenUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-listen/${companyID}`;
      twiml.redirect({ method: 'POST' }, listenUrl);
      
      twimlString = twiml.toString();

      // ═══════════════════════════════════════════════════════════════════════════
      // TRANSCRIPT SAFETY NET: Log agent turn from cached data.
      // The computeTurnPromise IIFE logs internally, but if it failed partway
      // through, this ensures the delivered response is still recorded.
      // CallTranscriptV2 read-side dedup prevents double entries.
      // ═══════════════════════════════════════════════════════════════════════════
      if (cached.agentTurn && cached.agentTurn.text && callSid) {
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          await CallTranscriptV2.appendTurns(companyID, callSid, [
            {
              speaker: 'agent',
              kind: 'CONVERSATION_AGENT',
              text: cached.agentTurn.text,
              turnNumber: cached.agentTurn.turnNumber || turnNumber,
              ts: new Date(),
              sourceKey: cached.agentTurn.sourceKey || cached.matchSource || 'AGENT2_BRIDGE_CONTINUE',
              trace: {
                provenance: cached.agentTurn.provenance || null,
                deliveredVia: 'bridge_continuation',
                matchSource: cached.matchSource || null,
                timings: cached.timings || null
              }
            },
            {
              speaker: 'system',
              kind: cached.audioUrl ? 'TWIML_PLAY' : 'TWIML_SAY',
              text: cached.responseText || cached.agentTurn.text || '',
              turnNumber: cached.agentTurn.turnNumber || turnNumber,
              ts: new Date(),
              sourceKey: 'twiml',
              trace: {
                action: cached.audioUrl ? 'PLAY' : 'SAY',
                audioUrl: cached.audioUrl || null,
                voiceProviderUsed: cached.voiceProviderUsed || null,
                deliveredVia: 'bridge_continuation'
              }
            }
          ]);
        } catch (v2Err) {
          logger.warn('[V2 BRIDGE CONTINUE] Failed to append agent turn to CallTranscriptV2', {
            callSid: callSid?.slice(-8),
            error: v2Err.message
          });
        }
      }

      if (CallLogger && callSid) {
        await CallLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'TWIML_SENT',
          turn: turnNumber,
          data: {
            section: 'S7_VOICE_PROVIDER',
            route: '/v2-agent-bridge-continue',
            twimlLength: twimlString.length,
            hasGather: twimlString.includes('<Gather'),
            hasPlay: twimlString.includes('<Play'),
            hasSay: twimlString.includes('<Say'),
            voiceProviderUsed,
            responsePreview: `${cached.responsePreview || ''}`.substring(0, 80),
            matchSource: cached.matchSource || null,
            twimlPreview: twimlString.substring(0, 800),
            playUrl: cached.audioUrl || null,
            bridge: {
              token: token ? `${token}`.slice(0, 8) : null,
              attempt,
              elapsedMs,
              hasAgentTurn: !!cached.agentTurn
            },
            timings: cached.timings || { totalMs: elapsedMs }
          }
        }).catch(err => {
          logger.error('[V2 BRIDGE CONTINUE] TWIML_SENT log failed', { error: err.message });
        });
      }

      res.type('text/xml');
      return res.send(twimlString);
    }

    // If background compute failed OR caps hit: fall back to transfer policy.
    const capHit = attempt >= maxRedirectAttempts || (typeof elapsedMs === 'number' && elapsedMs >= hardCapMs);
    if (cached?.error || capHit) {
      if (CallLogger && callSid) {
        await CallLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'AGENT2_BRIDGE_TIMEOUT',
          turn: turnNumber,
          data: {
            attempt,
            maxRedirectAttempts,
            hardCapMs,
            elapsedMs,
            error: cached?.error || null
          }
        }).catch(() => {});
      }

      const twiml = new twilio.twiml.VoiceResponse();
      const transferText = "I'm connecting you to our team.";
      handleTransfer(twiml, company || {}, transferText, companyID);
      twimlString = twiml.toString();

      // Log the transfer fallback to CallTranscriptV2 so it appears in transcripts
      if (callSid) {
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          await CallTranscriptV2.appendTurns(companyID, callSid, [
            {
              speaker: 'agent',
              kind: 'CONVERSATION_AGENT',
              text: transferText,
              turnNumber,
              ts: new Date(),
              sourceKey: 'AGENT2_BRIDGE_TIMEOUT',
              trace: {
                provenance: {
                  type: 'UI_OWNED',
                  uiPath: 'aiAgentSettings.agent2.bridge',
                  reason: cached?.error ? 'bridge_compute_failed' : 'bridge_timeout',
                  voiceProviderUsed: 'twilio_say',
                  isBridge: true
                },
                deliveredVia: 'bridge_timeout_transfer',
                attempt,
                elapsedMs,
                error: cached?.error || null
              }
            }
          ]);
        } catch (v2Err) {
          logger.warn('[V2 BRIDGE CONTINUE] Failed to append transfer turn to CallTranscriptV2', {
            callSid: callSid?.slice(-8),
            error: v2Err.message
          });
        }
      }

      if (CallLogger && callSid) {
        await CallLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'TWIML_SENT',
          turn: turnNumber,
          data: {
            section: 'S7_VOICE_PROVIDER',
            route: '/v2-agent-bridge-continue',
            twimlLength: twimlString.length,
            hasGather: twimlString.includes('<Gather'),
            hasPlay: twimlString.includes('<Play'),
            hasSay: twimlString.includes('<Say'),
            voiceProviderUsed: 'twilio_say',
            isFallback: true,
            fallbackReason: cached?.error ? 'bridge_compute_failed' : 'bridge_timeout',
            bridge: { attempt, elapsedMs }
          }
        }).catch(() => {});
      }

      res.type('text/xml');
      return res.send(twimlString);
    }

    // Not ready: pause briefly and redirect to poll again.
    const redirectUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-bridge-continue/${companyID}?turn=${turnNumber}&token=${encodeURIComponent(token)}&attempt=${attempt}`;
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.pause({ length: 1 });
    // CRITICAL: method=POST so CallSid stays in request body (safe state correlation)
    twiml.redirect({ method: 'POST' }, redirectUrl);
    twimlString = twiml.toString();

    res.type('text/xml');
    return res.send(twimlString);
  } catch (error) {
    logger.error('[V2 BRIDGE CONTINUE] Route crashed', {
      callSid,
      companyID,
      error: error.message
    });
    const crashText = "I'm connecting you to our team.";
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(crashText);
    twimlString = twiml.toString();

    if (callSid) {
      try {
        const CallTranscriptV2 = require('../models/CallTranscriptV2');
        await CallTranscriptV2.appendTurns(companyID, callSid, [
          {
            speaker: 'agent',
            kind: 'CONVERSATION_AGENT',
            text: crashText,
            turnNumber,
            ts: new Date(),
            sourceKey: 'BRIDGE_CONTINUE_CRASH',
            trace: {
              provenance: { type: 'HARDCODED', reason: 'route_crash', voiceProviderUsed: 'twilio_say' },
              error: error.message
            }
          }
        ]);
      } catch (_) { /* best-effort */ }
    }

    res.type('text/xml');
    return res.send(twimlString);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// V130: LISTEN ENDPOINT (POST-BRIDGE GATHER)
// ═══════════════════════════════════════════════════════════════════════════
// Called after bridge continuation plays the response.
// Sets up a Gather to capture the caller's next input.
// This is a lightweight endpoint - no core runtime, just TwiML generation.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/v2-agent-listen/:companyID', async (req, res) => {
  const companyID = req.params.companyID;
  const callSid = req.body.CallSid;
  
  let twimlString = '';
  
  try {
    const hostHeader = req.get('host');
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
      input: 'speech',
      action: `/api/twilio/v2-agent-respond/${companyID}`,
      method: 'POST',
      actionOnEmptyResult: true,
      timeout: 7,
      speechTimeout: 'auto',
      speechModel: 'phone_call',
      partialResultCallback: `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`,
      partialResultCallbackMethod: 'POST'
    });
    
    // No prompt - just listen for the next input
    // The response was already played by the bridge-continue endpoint
    
    twimlString = twiml.toString();
    
    if (CallLogger && callSid) {
      CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'TWIML_SENT',
        data: {
          section: 'S7_VOICE_PROVIDER',
          route: '/v2-agent-listen',
          twimlLength: twimlString.length,
          hasGather: true,
          hasPlay: false,
          hasSay: false,
          voiceProviderUsed: 'none',
          purpose: 'post_bridge_gather'
        }
      }).catch(() => {});
    }
    
    res.type('text/xml');
    return res.send(twimlString);
  } catch (error) {
    logger.error('[V2 LISTEN] Route crashed', {
      callSid,
      companyID,
      error: error.message
    });
    
    // Fallback: just gather without partial callbacks
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.gather({
      input: 'speech',
      action: `/api/twilio/v2-agent-respond/${companyID}`,
      method: 'POST',
      actionOnEmptyResult: true,
      timeout: 7,
      speechTimeout: 'auto'
    });
    twimlString = twiml.toString();
    res.type('text/xml');
    return res.send(twimlString);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// V2 AI Agent response handler - PLUMBING ONLY CORE PATH
// ═══════════════════════════════════════════════════════════════════════════
// TRACE CONTINUITY GUARANTEE:
// This route MUST always emit TWIML_SENT at the end, success or failure.
// Critical events from turnEventBuffer are AWAITED before sending response.
// No silent truncation - if events are missing, we know something crashed.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/v2-agent-respond/:companyID', async (req, res) => {
  // T0: Webhook received
  const T0 = Date.now();
  const timings = { T0 };
  
  const companyID = req.params.companyID;
  const callSid = req.body.CallSid;
  const fromNumber = normalizePhoneNumber(req.body.From || req.body.Caller || '');
  let speechResult = req.body.SpeechResult || '';
  const turnCountFromBody = parseInt(req.body.turnCount || 0, 10) || 0;
  
  // Track for guaranteed TWIML_SENT logging
  let turnNumber = 0;
  let voiceProviderUsed = 'twilio_say';
  let twimlString = '';
  let routeError = null;

  try {
    // T1: Company load start
    const T1_start = Date.now();
    const company = await Company.findById(companyID).lean();
    timings.companyLoadMs = Date.now() - T1_start;
    if (!company) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say("I'm sorry, I didn't catch that. Could you repeat that?");
      twiml.gather({
        input: 'speech',
        action: `/api/twilio/v2-agent-respond/${companyID}`,
        method: 'POST',
        actionOnEmptyResult: true,
        timeout: 7,
        speechTimeout: 'auto',
        speechModel: 'phone_call'
      });
      twimlString = twiml.toString();
      res.type('text/xml');
      return res.send(twimlString);
    }

    // Registration safety net: if calls reach v2-agent-respond directly,
    // ensure CallSummary exists so Call Review can display the call.
    if (callSid && fromNumber) {
      const registration = await ensureCallSummaryRegistered({
        companyId: company._id,
        fromNumber,
        callSid,
        direction: 'inbound'
      });

      logger.debug('[CALL CENTER] v2-agent-respond registration guard', {
        companyId: companyID,
        callSid,
        registered: registration.ok,
        existing: registration.existing === true,
        callId: registration.callId || null,
        reason: registration.reason || null
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INPUT TEXT SOURCE: SpeechResult + Cached Partial (TRUTH FINALIZATION)
    // ═══════════════════════════════════════════════════════════════════════════
    // Twilio sometimes sends a truncated SpeechResult even when partial callbacks
    // contain the full stabilized transcript. We prefer:
    // 1) SpeechResult (if good)
    // 2) Cached stable partial transcript when SpeechResult missing OR clearly truncated
    //
    // This is critical for deterministic slot extraction (call_reason_detail).
    // ═══════════════════════════════════════════════════════════════════════════
    let inputTextSource = 'speechResult';
    const redis = await getRedis();
    const speechRaw = `${speechResult || ''}`.trim();
    let cachedTranscript = null;
    let cacheReadError = null;
    
    // ─────────────────────────────────────────────────────────────────────────
    // CACHE KEY FIX (V124): Prevent cross-turn text reuse
    // ─────────────────────────────────────────────────────────────────────────
    // The partial cache stores the "best" transcript from speech partials.
    // Problem: If cache key doesn't include turn info, stale text from turn N
    // can be reused in turn N+1, causing "repeat turn one" bugs.
    //
    // Solution: After using cached text, DELETE it immediately. The partial
    // handler will write fresh data for the next turn. This is safer than
    // keying by turn (which requires knowing turn number before state load).
    // ─────────────────────────────────────────────────────────────────────────
    let cacheWasUsed = false;
    
    if (redis && callSid) {
      const cacheKey = `partial:${callSid}`;
      try {
        cachedTranscript = await redis.get(cacheKey);
      } catch (err) {
        cacheReadError = err.message;
        logger.warn('[V2 RESPOND] Failed to read cached transcript', { error: err.message });
      }
    }
    
    const cachedRaw = `${cachedTranscript || ''}`.trim();
    const hasSpeech = speechRaw.length > 0;
    const hasCached = cachedRaw.length > 0;
    
    // Use cached when SpeechResult is missing
    if (!hasSpeech && hasCached) {
      speechResult = cachedRaw;
      inputTextSource = 'partialCache';
      cacheWasUsed = true;
      logger.info('[V2 RESPOND] Using cached partial transcript (SpeechResult missing)', {
        callSid: callSid?.slice(-8),
        textLength: speechResult.length
      });
    }
    
    // Use cached when SpeechResult is likely truncated
    // Heuristic: cached starts with speech AND is meaningfully longer.
    if (hasSpeech && hasCached) {
      const cachedLooksLikeSuperset = cachedRaw.toLowerCase().startsWith(speechRaw.toLowerCase());
      const cachedIsMeaningfullyLonger = cachedRaw.length >= speechRaw.length + 40;
      const speechLooksCutOff = !/[.!?]\s*$/.test(speechRaw) && /\b(?:and|but|so|because|however|since)\b\s*$/i.test(speechRaw);
      
      if (cachedLooksLikeSuperset && cachedIsMeaningfullyLonger) {
        speechResult = cachedRaw;
        inputTextSource = 'partialCachePreferred';
        cacheWasUsed = true;
        logger.info('[V2 RESPOND] Using cached partial transcript (preferred over truncated SpeechResult)', {
          callSid: callSid?.slice(-8),
          speechLen: speechRaw.length,
          cachedLen: cachedRaw.length,
          speechLooksCutOff
        });
      }
    }
    
    // V124 FIX: Clear cache after reading to prevent cross-turn reuse
    // This ensures stale text from turn N cannot pollute turn N+1
    if (redis && callSid && hasCached) {
      const cacheKey = `partial:${callSid}`;
      redis.del(cacheKey).catch(err => {
        logger.warn('[V2 RESPOND] Failed to clear partial cache', { error: err.message });
      });
      logger.debug('[V2 RESPOND] Cleared partial cache after read', {
        callSid: callSid?.slice(-8),
        cacheWasUsed,
        cachedLen: cachedRaw.length
      });
    }
    
    // Proof event: what text we finalized for downstream extraction
    if (CallLogger && callSid) {
      await CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'INPUT_TEXT_FINALIZED',
        turn: turnCountFromBody || 0,
        data: {
          sourceUsed: inputTextSource,
          finalTextLen: `${speechResult || ''}`.length,
          finalPreview: `${speechResult || ''}`.substring(0, 140),
          speechResultLen: speechRaw.length,
          cachedLen: cachedRaw.length,
          cacheReadError,
          cacheCleared: hasCached  // V124: proves cache was cleared to prevent cross-turn reuse
        }
      }).catch(() => {});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S0: STATE INTEGRITY - LOAD PHASE
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: This section exposes state drift. If turnCount resets mid-call,
    // SECTION_S0_STATE_LOAD will show found=false or wrong turnCount.
    // The state key is ALWAYS: `call:${callSid}` - never phone, never sequence.
    // ═══════════════════════════════════════════════════════════════════════════
    let callState = null;
    const redisKey = callSid ? `call:${callSid}` : null;
    let stateSource = 'none';
    let stateLoadError = null;
    let previousStateKey = null;
    
    if (redis && redisKey) {
      try {
        const raw = await redis.get(redisKey);
        if (raw) {
          callState = JSON.parse(raw);
          stateSource = 'redis';
          // Track previous state key for drift detection
          previousStateKey = callState._stateKey || null;
        }
      } catch (err) {
        stateLoadError = err.message;
        logger.warn('[V2TWILIO] Redis read failed', { callSid, error: err.message });
      }
    }
    if (!callState) {
      callState = req.session?.callState || null;
      if (callState) stateSource = 'session';
    }
    
    // Capture loaded state values BEFORE any modifications
    const loadedTurnCount = callState?.turnCount || 0;
    const loadedLane = callState?.sessionMode || 'DISCOVERY';
    const loadedStepId = callState?.discoveryCurrentStepId || callState?.currentStepId || null;
    const loadedDiscoveryComplete = callState?.discoveryComplete === true;
    const loadedCallReasonCaptured = hasSlotValue(callState?.slots, 'call_reason_detail') ||
      hasSlotValue(callState?.pendingSlots, 'call_reason_detail');
    const loadedNamePresent = hasSlotValue(callState?.slots, 'name') ||
      hasSlotValue(callState?.slots, 'name.first') ||
      hasSlotValue(callState?.slots, 'name.last') ||
      hasSlotValue(callState?.slots, 'lastName');
    const loadedAddressPresent = hasSlotValue(callState?.slots, 'address');
    const stateFound = !!callState;
    
    // EMIT S0 STATE LOAD EVENT (CRITICAL - exposes state drift)
    if (CallLogger && callSid) {
      await CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'SECTION_S0_STATE_LOAD',
        turn: loadedTurnCount,
        data: {
          stateKey: redisKey,
          found: stateFound,
          stateSource,
          stateLoadError,
          loaded: {
            turnCount: loadedTurnCount,
            lane: loadedLane,
            stepId: loadedStepId,
            discoveryComplete: loadedDiscoveryComplete,
            callReasonCaptured: loadedCallReasonCaptured,
            namePresent: loadedNamePresent,
            addressPresent: loadedAddressPresent,
            lastUpdatedTs: callState?._lastUpdatedTs || null
          }
        }
      }).catch(err => {
        logger.error('[V2TWILIO] S0_STATE_LOAD log failed', { error: err.message });
      });
    }
    
    // STATE KEY DRIFT DETECTION
    // If we had a previous state key that differs from current, something is WRONG
    if (previousStateKey && previousStateKey !== redisKey) {
      logger.error('[V2TWILIO] STATE KEY DRIFT DETECTED', {
        callSid,
        previousKey: previousStateKey,
        currentKey: redisKey
      });
      
      if (CallLogger && callSid) {
        await CallLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'SECTION_S0_STATE_KEY_CHANGED',
          turn: loadedTurnCount,
          data: {
            prevKey: previousStateKey,
            newKey: redisKey,
            severity: 'CRITICAL'
          }
        }).catch(() => {});
      }
    }
    
    // MISSING CALLSID DETECTION - This would cause state chaos
    if (!callSid) {
      logger.error('[V2TWILIO] MISSING CALLSID - state will not persist correctly');
      
      if (CallLogger) {
        await CallLogger.logEvent({
          callId: 'MISSING',
          companyId: companyID,
          type: 'SECTION_S0_MISSING_CALLSID',
          turn: 0,
          data: {
            fromNumber,
            severity: 'CRITICAL',
            requestBody: Object.keys(req.body || {})
          }
        }).catch(() => {});
      }
    }
    
    if (!callState) {
      callState = initializeCall(callSid, fromNumber, companyID);
      stateSource = 'initialized';
    }

    // Store state key in state for drift detection on next turn
    callState._stateKey = redisKey;
    callState.callSid = callSid;
    callState.companyId = companyID;
    callState.slots = callState.slots || {};
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TURN COUNT FIX: Must come from persisted state ONLY
    // ═══════════════════════════════════════════════════════════════════════════
    // OLD (BROKEN): Math.max(callState.turnCount || 0, turnCountFromBody) + 1
    // This allowed turnCountFromBody (from request) to override persisted state,
    // causing resets when request param was 0.
    // 
    // NEW (FIXED): turnCount comes ONLY from persisted state, then incremented.
    // turnCountFromBody is IGNORED for turn computation.
    // ═══════════════════════════════════════════════════════════════════════════
    const previousTurnCount = callState.turnCount || 0;
    callState.turnCount = previousTurnCount + 1;
    turnNumber = callState.turnCount;
    
    // Log if turnCountFromBody was different (diagnostic only, not used for computation)
    if (turnCountFromBody > 0 && turnCountFromBody !== previousTurnCount) {
      logger.debug('[V2TWILIO] turnCountFromBody differs from persisted', {
        callSid: callSid?.slice(-8),
        turnCountFromBody,
        persistedTurnCount: previousTurnCount,
        newTurnCount: turnNumber
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 📝 TRANSCRIPT: Initialize turns array in call state
    // ═══════════════════════════════════════════════════════════════════════════
    // Turns are stored in Redis call state and persisted to CallTranscript at call end.
    // This is the clean Mongoose+Redis path - no legacy BlackBox.
    // ═══════════════════════════════════════════════════════════════════════════
    if (!callState.turns) {
      callState.turns = [];
    }
    
    // Add caller turn (what they said)
    let callerTurn = null;
    if (speechResult && speechResult.trim()) {
      callerTurn = {
        speaker: 'caller',
        text: speechResult.trim(),
        turn: turnNumber,
        timestamp: new Date().toISOString()
      };
      callState.turns.push(callerTurn);

      try {
        const CallTranscriptV2 = require('../models/CallTranscriptV2');
        logger.info('[V2TWILIO] CALLER_TURN_WRITE_START', {
          callSid: callSid?.slice(-8),
          companyId: companyID,
          turnNumber,
          textLen: callerTurn.text.length,
          textPreview: callerTurn.text.substring(0, 40)
        });
        await CallTranscriptV2.appendTurns(companyID, callSid, [
          {
            speaker: 'caller',
            kind: 'CONVERSATION_CALLER',
            text: callerTurn.text,
            turnNumber: callerTurn.turn,
            ts: callerTurn.timestamp,
            sourceKey: 'stt',
            trace: { inputTextSource }
          }
        ], { from: fromNumber || null, to: req.body.To || null });
        logger.info('[V2TWILIO] CALLER_TURN_WRITE_OK', {
          callSid: callSid?.slice(-8),
          turnNumber
        });
      } catch (mongoV2Err) {
        logger.error('[V2TWILIO] CALLER_TURN_WRITE_FAILED', {
          callSid: callSid?.slice(-8),
          companyId: companyID,
          turnNumber,
          error: mongoV2Err.message,
          stack: mongoV2Err.stack?.substring(0, 300)
        });
      }
    }
    // Diagnostics: STT_EMPTY (no caller transcript captured this turn)
    else if (callSid) {
      const sttDiag = {
        speaker: 'system',
        kind: 'STT_EMPTY',
        text: 'STT_EMPTY',
        turn: turnNumber,
        timestamp: new Date().toISOString(),
        source: 'stt',
        provenance: {
          type: 'UI_OWNED',
          uiPath: 'voice.stt',
          reason: 'speech_result_empty'
        }
      };
      callState.turns.push(sttDiag);
      try {
        const CallTranscriptV2 = require('../models/CallTranscriptV2');
        await CallTranscriptV2.appendTurns(companyID, callSid, [
          {
            speaker: 'system',
            kind: 'STT_EMPTY',
            text: 'SpeechResult empty (no caller text captured)',
            turnNumber,
            ts: sttDiag.timestamp,
            sourceKey: 'stt',
            trace: {
              inputTextSource,
              speechResultLen: (req.body?.SpeechResult || '').length,
              callSid: callSid,
              actionOnEmptyResult: true
            }
          }
        ], { from: fromNumber || null, to: req.body.To || null });
      } catch (mongoV2Err) {
        logger.warn('[V2TWILIO] Failed to append STT_EMPTY diagnostic to CallTranscriptV2 (non-blocking)', {
          callSid: callSid?.slice(-8),
          error: mongoV2Err.message
        });
      }
    }

    const hostHeader = req.get('host');
    const bridgeCfg = company?.aiAgentSettings?.agent2?.bridge || {};
    const bridgeEnabled = bridgeCfg?.enabled === true;
    const bridgeThresholdMs = Number.isFinite(bridgeCfg.thresholdMs) ? bridgeCfg.thresholdMs : 1100;
    const bridgeHardCapMs = Number.isFinite(bridgeCfg.hardCapMs) ? bridgeCfg.hardCapMs : 6000;
    const bridgeMaxPerCall = Number.isFinite(bridgeCfg.maxBridgesPerCall) ? bridgeCfg.maxBridgesPerCall : 2;
    const bridgeMaxRedirectAttempts = Number.isFinite(bridgeCfg.maxRedirectAttempts) ? bridgeCfg.maxRedirectAttempts : 2;

    const pendingQ = callState?.agent2?.discovery?.pendingQuestion || null;
    const pendingQTurn = callState?.agent2?.discovery?.pendingQuestionTurn;
    const isRespondingToPendingYesNo = !!pendingQ && typeof pendingQTurn === 'number' && pendingQTurn === (turnNumber - 1);
    const isAlreadyTransferLane = (callState?.sessionMode === 'TRANSFER');

    const mayBridge =
      bridgeEnabled &&
      !!redis &&
      !!callSid &&
      bridgeThresholdMs >= 200 &&
      bridgeHardCapMs >= bridgeThresholdMs &&
      bridgeMaxPerCall > 0 &&
      !isRespondingToPendingYesNo &&
      !isAlreadyTransferLane;

    const computeTurnPromise = (async () => {
      let localVoiceProviderUsed = 'twilio_say';
      const buildTurnKey = (t) => {
        const turn = typeof t?.turn === 'number' ? t.turn : 'na';
        const speaker = t?.speaker || 'unknown';
        const source = t?.source || '';
        const textPrefix = `${t?.text || ''}`.trim().substring(0, 48);
        return `${turn}:${speaker}:${source}:${textPrefix}`;
      };

      const mergeTurns = (existingTurns, nextTurns) => {
        const out = [];
        const seen = new Set();
        for (const t of (Array.isArray(existingTurns) ? existingTurns : [])) {
          const key = buildTurnKey(t);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(t);
        }
        for (const t of (Array.isArray(nextTurns) ? nextTurns : [])) {
          const key = buildTurnKey(t);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(t);
        }
        return out;
      };

      // ═══════════════════════════════════════════════════════════════════════════
      // CORE RUNTIME - Process turn and collect events in buffer
      // ═══════════════════════════════════════════════════════════════════════════
      const T2_start = Date.now();
      const runtimeResult = await CallRuntime.processTurn(
        company.aiAgentSettings || {},
        callState,
        speechResult,
        {
          company,
          callSid,
          companyId: companyID,
          callerPhone: fromNumber,
          turnCount: callState.turnCount,
          inputTextSource
        }
      );
      timings.coreRuntimeMs = Date.now() - T2_start;

      const T3_start = Date.now();
      if (runtimeResult.turnEventBuffer && runtimeResult.turnEventBuffer.length > 0) {
        await CallRuntime.flushEventBuffer(runtimeResult.turnEventBuffer);
      }
      timings.eventFlushMs = Date.now() - T3_start;

      const persistedState = runtimeResult.state || StateStore.persist(callState, StateStore.load(callState));
      persistedState._lastUpdatedTs = new Date().toISOString();
      persistedState._stateKey = redisKey;
      
      // Ensure turns array is preserved in persisted state
      persistedState.turns = callState.turns || [];

      let stateSaveError = null;
      if (redis && redisKey) {
        try {
          // Merge against any existing Redis state to avoid race overwrites (e.g., bridge line vs runtime save).
          try {
            const existingRaw = await redis.get(redisKey);
            const existingState = existingRaw ? JSON.parse(existingRaw) : null;
            if (existingState && Array.isArray(existingState.turns)) {
              persistedState.turns = mergeTurns(existingState.turns, persistedState.turns);
            }
          } catch (mergeErr) {
            // Non-blocking: merge is best-effort.
          }
          await redis.set(redisKey, JSON.stringify(persistedState), { EX: 60 * 60 * 4 });
        } catch (err) {
          stateSaveError = err.message;
          logger.warn('[V2TWILIO] Redis write failed', { callSid, error: err.message });
        }
      }
      req.session.callState = persistedState;

      if (CallLogger && callSid) {
        await CallLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'SECTION_S0_STATE_SAVE',
          turn: turnNumber,
          data: {
            stateKey: redisKey,
            stateSaveError,
            saved: {
              turnCount: persistedState.turnCount,
              lane: persistedState.sessionMode || 'DISCOVERY',
              stepId: persistedState.discoveryCurrentStepId || persistedState.currentStepId || null,
              discoveryComplete: persistedState.discoveryComplete === true,
              callReasonCaptured: hasSlotValue(persistedState.slots, 'call_reason_detail') ||
                hasSlotValue(persistedState.pendingSlots, 'call_reason_detail'),
              namePresent: hasSlotValue(persistedState.slots, 'name') ||
                hasSlotValue(persistedState.slots, 'name.first') ||
                hasSlotValue(persistedState.slots, 'name.last') ||
                hasSlotValue(persistedState.slots, 'lastName'),
              addressPresent: hasSlotValue(persistedState.slots, 'address'),
              lastUpdatedTs: persistedState._lastUpdatedTs
            }
          }
        }).catch(err => {
          logger.error('[V2TWILIO] S0_STATE_SAVE log failed', { error: err.message });
        });
      }

      const voiceSettings = company.aiAgentSettings?.voiceSettings || {};
      const elevenLabsVoice = voiceSettings.voiceId;
      const responseText = runtimeResult.response || "I'm sorry, I didn't catch that. Could you repeat that?";

      // ═══════════════════════════════════════════════════════════════════════════
      // 📊 UPDATE CALL SUMMARY TURN COUNT
      // ═══════════════════════════════════════════════════════════════════════════
      // Increment the turnCount in CallSummary so Call Review list shows accurate counts.
      // This is a non-blocking atomic increment (fire-and-forget).
      // ═══════════════════════════════════════════════════════════════════════════
      if (callSid && companyID) {
        const CallSummary = require('../models/CallSummary');
        CallSummary.findOneAndUpdate(
          { companyId: companyID, twilioSid: callSid },
          { $set: { turnCount: turnNumber } },
          { upsert: false }
        ).catch(err => {
          logger.warn('[V2TWILIO] Failed to update CallSummary turnCount (non-blocking)', {
            callSid: callSid?.slice(-8),
            error: err.message
          });
        });
      }

      let audioUrl = null;
      let ttsLatencyMs = null;

      try {
        const isGreetingIntercept = runtimeResult?.matchSource === 'GREETING_INTERCEPTOR';
        if (!audioUrl && isGreetingIntercept && elevenLabsVoice && responseText) {
          const status = InstantAudioService.getStatus({
            companyId: companyID,
            kind: 'GREETING_RULE',
            text: responseText,
            voiceSettings
          });

          if (status.exists) {
            audioUrl = `${getSecureBaseUrl(req)}${status.url}`;
            localVoiceProviderUsed = 'instant_audio_cache';
            if (CallLogger) {
              CallLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'INSTANT_AUDIO_CACHE_HIT',
                turn: turnNumber,
                data: {
                  kind: status.kind,
                  fileName: status.fileName,
                  url: status.url,
                  matchSource: runtimeResult?.matchSource || null
                }
              }).catch(() => {});
            }
          } else if (CallLogger) {
            CallLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'INSTANT_AUDIO_CACHE_MISS',
              turn: turnNumber,
              data: { kind: 'GREETING_RULE', matchSource: runtimeResult?.matchSource || null }
            }).catch(() => {});
          }
        }
      } catch (e) {
        logger.warn('[V2 RESPOND] Instant audio cache check failed', { error: e.message });
      }

      try {
        const isAgent2Discovery = runtimeResult?.matchSource === 'AGENT2_DISCOVERY';
        const agent2AudioUrl = runtimeResult?.audioUrl;
        if (!audioUrl && isAgent2Discovery && agent2AudioUrl) {
          let audioFileExists = false;

          if (agent2AudioUrl.startsWith('/audio/') || agent2AudioUrl.startsWith('/instant-lines/')) {
            const localFilePath = path.join(__dirname, '../public', agent2AudioUrl);
            audioFileExists = fs.existsSync(localFilePath);

            if (!audioFileExists) {
              logger.warn('[V2 RESPOND] ⚠️ Agent2 audio file missing', {
                path: localFilePath,
                rawUrl: agent2AudioUrl,
                triggerCardId: runtimeResult?.triggerCard?.id
              });

              if (CallLogger) {
                CallLogger.logEvent({
                  callId: callSid,
                  companyId: companyID,
                  type: 'AUDIO_URL_PREFLIGHT_FAILED',
                  turn: turnNumber,
                  data: {
                    audioUrl: agent2AudioUrl,
                    localPath: localFilePath,
                    reason: 'file_not_found',
                    triggerCardId: runtimeResult?.triggerCard?.id,
                    triggerCardLabel: runtimeResult?.triggerCard?.label,
                    fallbackAction: 'will_use_tts'
                  }
                }).catch(() => {});
              }
            }
          } else if (agent2AudioUrl.startsWith('http')) {
            audioFileExists = true;
          }

          if (audioFileExists) {
            audioUrl = agent2AudioUrl.startsWith('http')
              ? agent2AudioUrl
              : `${getSecureBaseUrl(req)}${agent2AudioUrl}`;
            localVoiceProviderUsed = 'instant_audio_agent2';

            if (CallLogger) {
              CallLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'INSTANT_AUDIO_AGENT2_HIT',
                turn: turnNumber,
                data: {
                  triggerCardId: runtimeResult?.triggerCard?.id || null,
                  triggerCardLabel: runtimeResult?.triggerCard?.label || null,
                  audioUrl: agent2AudioUrl,
                  matchSource: runtimeResult?.matchSource || null,
                  preflightPassed: true
                }
              }).catch(() => {});
            }
          } else if (CallLogger) {
            CallLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'FELL_BACK_TO_TTS',
              turn: turnNumber,
              data: {
                reason: 'instant_audio_file_missing',
                missingAudioUrl: agent2AudioUrl,
                triggerCardId: runtimeResult?.triggerCard?.id,
                triggerCardLabel: runtimeResult?.triggerCard?.label
              }
            }).catch(() => {});
          }
        }
      } catch (e) {
        logger.warn('[V2 RESPOND] Agent2 instant audio check failed', { error: e.message });
      }

      if (!audioUrl && elevenLabsVoice && responseText) {
        const ttsStartTime = Date.now();
        try {
          if (CallLogger) {
            CallLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'TTS_STARTED',
              turn: turnNumber,
              data: { voiceId: elevenLabsVoice, textLength: responseText.length }
            }).catch(() => {});
          }

          const buffer = await synthesizeSpeech({
            text: responseText,
            voiceId: elevenLabsVoice,
            stability: voiceSettings.stability,
            similarity_boost: voiceSettings.similarityBoost,
            style: voiceSettings.styleExaggeration,
            model_id: voiceSettings.aiModel,
            company
          });

          ttsLatencyMs = Date.now() - ttsStartTime;

          const fileName = `ai_respond_${callSid}_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
          }
          fs.writeFileSync(path.join(audioDir, fileName), buffer);

          audioUrl = `https://${hostHeader}/audio/${fileName}`;
          localVoiceProviderUsed = 'elevenlabs';

          if (CallLogger) {
            CallLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'TTS_COMPLETED',
              turn: turnNumber,
              data: { voiceId: elevenLabsVoice, latencyMs: ttsLatencyMs }
            }).catch(() => {});
          }
        } catch (ttsError) {
          logger.error('[V2 RESPOND] ElevenLabs TTS failed', {
            callSid: callSid?.slice(-8),
            error: ttsError.message
          });

          if (CallLogger) {
            CallLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'TTS_FAILED',
              turn: turnNumber,
              data: { error: ttsError.message, fallback: 'twilio_say' }
            }).catch(() => {});
          }
        }
      }

      const twiml = new twilio.twiml.VoiceResponse();
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/v2-agent-respond/${companyID}`,
        method: 'POST',
        actionOnEmptyResult: true,
        timeout: 7,
        speechTimeout: 'auto',
        speechModel: 'phone_call',
        partialResultCallback: `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`,
        partialResultCallbackMethod: 'POST'
      });

      if (audioUrl) gather.play(audioUrl);
      else gather.say(escapeTwiML(responseText));

      // ═══════════════════════════════════════════════════════════════════════════
      // 📝 TRANSCRIPT: Persist agent turn with provenance + voice provider
      // ═══════════════════════════════════════════════════════════════════════════
      // This must happen AFTER audio selection so we can explain what the caller actually heard
      // (<Play> vs <Say>, ElevenLabs vs Twilio voice).
      if (responseText && responseText.trim()) {
        const turnEvents = Array.isArray(runtimeResult?.turnEventBuffer) ? runtimeResult.turnEventBuffer : [];
        const provEvent = [...turnEvents].reverse().find(e => e?.type === 'SPEAK_PROVENANCE' || e?.type === 'SPEECH_SOURCE_SELECTED');
        const provData = provEvent?.data && typeof provEvent.data === 'object' ? provEvent.data : {};
        const triggerId = runtimeResult?.triggerCard?.id || null;
        const triggerLabel = runtimeResult?.triggerCard?.label || null;
        const triggerAnchor = triggerId ? `trigger-${triggerId}` : null;

        // If this was a trigger-card response, force a UI-friendly path that the Call Console can deep-link.
        const inferredUiPath = (runtimeResult?.matchSource === 'AGENT2_DISCOVERY' && triggerId)
          ? 'triggers'
          : null;
        const isUiOwned = provData?.isFromUiConfig === true || !!inferredUiPath;
        const provType = isUiOwned ? 'UI_OWNED' : 'HARDCODED';
        const uiPath = provData?.uiPath || provData?.configPath || inferredUiPath || null;

        // Enterprise Trace Pack — minimum viable decision chain + audio/TwiML layer.
        const tracePack = {
          resolver: (() => {
            const ms = `${runtimeResult?.matchSource || ''}`.toUpperCase();
            if (ms.startsWith('AGENT2')) return 'triggers';
            if (ms.includes('BOOKING')) return 'bookingHub';
            if (ms.includes('GREETING')) return 'greetings';
            if (ms.includes('LLM')) return 'llm';
            if (ms.includes('FALLBACK')) return 'fallback';
            return 'unknown';
          })(),
          uiPath,
          uiAnchor: triggerAnchor,
          uiLabel: triggerLabel,
          configVersionHash: req.session?.awHash || null,
          effectiveConfigVersion: req.session?.effectiveConfigVersion || null,
          match: {
            engine: runtimeResult?.matchSource ? 'rules' : 'unknown',
            score: runtimeResult?.confidence ?? null,
            matchedId: runtimeResult?.triggerCard?.id || null,
            matchedLabel: runtimeResult?.triggerCard?.label || null,
            matchSource: runtimeResult?.matchSource || null
          },
          toolRefs: [],
          tts: {
            provider: (localVoiceProviderUsed === 'elevenlabs' ? 'elevenlabs' : (audioUrl ? 'twilio_play' : 'twilio_say')),
            voiceId: company?.aiAgentSettings?.voiceSettings?.voiceId || null
          },
          twiml: {
            outputMode: audioUrl ? 'play' : 'say',
            actions: [
              audioUrl ? { type: 'PLAY', url: audioUrl } : { type: 'SAY', text: responseText.trim().substring(0, 240) },
              { type: 'GATHER_START', action: `/api/twilio/v2-agent-respond/${companyID}` }
            ]
          }
        };
        const agentTurn = {
          speaker: 'agent',
          text: responseText.trim(),
          turn: turnNumber,
          timestamp: new Date().toISOString(),
          source: runtimeResult?.matchSource || 'UNKNOWN',
          provenance: {
            type: provType,
            uiPath,
            uiAnchor: triggerAnchor,
            triggerId,
            triggerLabel,
            reason: provData?.reason || null,
            voiceProviderUsed: localVoiceProviderUsed,
            audioUrl: audioUrl || null,
            matchSource: runtimeResult?.matchSource || null,
            triggerCardId: runtimeResult?.triggerCard?.id || null,
            triggerCardLabel: runtimeResult?.triggerCard?.label || null,
            tracePack
          }
        };

        persistedState.turns = persistedState.turns || callState.turns || [];
        persistedState.turns.push(agentTurn);

        if (redis && redisKey) {
          try {
            const existingRaw = await redis.get(redisKey);
            const existingState = existingRaw ? JSON.parse(existingRaw) : null;
            if (existingState && Array.isArray(existingState.turns)) {
              persistedState.turns = mergeTurns(existingState.turns, persistedState.turns);
            }
            await redis.set(redisKey, JSON.stringify(persistedState), { EX: 60 * 60 * 4 });
          } catch (err) {
            logger.warn('[V2TWILIO] Redis re-save after agent turn failed', { callSid: callSid?.slice(-8), error: err.message });
          }
        }

        // Canonical Mongo: persist turns DURING the call (CallTranscriptV2).
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');

          const turnsToAppendV2 = [
            {
              speaker: 'agent',
              kind: 'CONVERSATION_AGENT',
              text: agentTurn.text,
              turnNumber: agentTurn.turn,
              ts: agentTurn.timestamp,
              sourceKey: agentTurn.source || runtimeResult?.matchSource || 'UNKNOWN',
              trace: {
                provenance: agentTurn.provenance || null,
                matchSource: runtimeResult?.matchSource || null,
                triggerCard: runtimeResult?.triggerCard || null,
                lane: runtimeResult?.lane || persistedState?.sessionMode || null,
                awHash: req.session?.awHash || null,
                effectiveConfigVersion: req.session?.effectiveConfigVersion || null,
                traceRunId: req.session?.traceRunId || null
              }
            }
          ];

          await CallTranscriptV2.appendTurns(companyID, callSid, turnsToAppendV2, {
            from: fromNumber || null,
            to: req.body.To || null
          });

          // Telephony action for this turn (what was actually played to the caller)
          await CallTranscriptV2.appendTurns(companyID, callSid, [
            {
              speaker: 'system',
              kind: audioUrl ? 'TWIML_PLAY' : 'TWIML_SAY',
              text: responseText.trim(),
              turnNumber,
              ts: new Date(),
              sourceKey: 'twiml',
              trace: {
                action: audioUrl ? 'PLAY' : 'SAY',
                audioUrl: audioUrl || null,
                voiceProviderUsed: localVoiceProviderUsed,
                origin: agentTurn?.provenance?.uiPath || null,
                gather: {
                  action: `/api/twilio/v2-agent-respond/${companyID}`,
                  partialResultCallback: `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`
                }
              }
            }
          ]);

          await CallTranscriptV2.appendTrace(companyID, callSid, [
            {
              kind: 'matcher',
              turnNumber,
              ts: new Date(),
              payload: {
                provenance: agentTurn.provenance || null,
                matchSource: runtimeResult?.matchSource || null,
                triggerCard: runtimeResult?.triggerCard || null,
                lane: runtimeResult?.lane || persistedState?.sessionMode || null,
                inputTextSource,
                awHash: req.session?.awHash || null,
                effectiveConfigVersion: req.session?.effectiveConfigVersion || null,
                traceRunId: req.session?.traceRunId || null
              }
            }
          ]);
        } catch (mongoV2Err) {
          logger.warn('[V2TWILIO] Failed to append turns/trace to CallTranscriptV2 (non-blocking)', {
            callSid: callSid?.slice(-8),
            error: mongoV2Err.message
          });
        }
      }

      const outTwimlString = twiml.toString();

      timings.ttsMs = ttsLatencyMs || 0;
      timings.totalMs = Date.now() - T0;

      return {
        twimlString: outTwimlString,
        voiceProviderUsed: localVoiceProviderUsed,
        responseText,
        matchSource: runtimeResult.matchSource,
        timings: {
          companyLoadMs: timings.companyLoadMs || 0,
          coreRuntimeMs: timings.coreRuntimeMs || 0,
          eventFlushMs: timings.eventFlushMs || 0,
          ttsMs: timings.ttsMs || 0,
          totalMs: timings.totalMs || 0
        },
        agentTurnForCache: (responseText && responseText.trim()) ? {
          text: responseText.trim(),
          turnNumber,
          sourceKey: runtimeResult?.matchSource || 'UNKNOWN',
          provenance: {
            type: (runtimeResult?.triggerCard?.id || runtimeResult?.matchSource === 'AGENT2_DISCOVERY') ? 'UI_OWNED' : 'HARDCODED',
            uiPath: runtimeResult?.triggerCard?.id ? 'triggers' : null,
            matchSource: runtimeResult?.matchSource || null,
            voiceProviderUsed: localVoiceProviderUsed,
            audioUrl: audioUrl || null
          }
        } : null
      };
    })();

    const logTwimlSent = async ({ route, twimlString, voiceProviderUsed, responsePreview, matchSource, isBridge = false, bridgeMeta = null, isFallback = false, fallbackReason = null, timings = null }) => {
      if (!CallLogger || !callSid) return;
      const playUrlMatch = twimlString.match(/<Play[^>]*>([^<]+)<\/Play>/);
      const playUrl = playUrlMatch ? playUrlMatch[1] : null;

      await CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'TWIML_SENT',
        turn: turnNumber,
        data: {
          section: 'S7_VOICE_PROVIDER',
          route,
          twimlLength: twimlString.length,
          hasGather: twimlString.includes('<Gather'),
          hasPlay: twimlString.includes('<Play'),
          hasSay: twimlString.includes('<Say'),
          voiceProviderUsed,
          responsePreview: `${responsePreview || ''}`.substring(0, 80),
          matchSource: matchSource || null,
          runtimeCommitSha: process.env.GIT_SHA || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || null,
          twimlPreview: twimlString.substring(0, 800),
          playUrl,
          isBridge: isBridge === true,
          isFallback: isFallback === true,
          fallbackReason: fallbackReason || null,
          bridge: bridgeMeta || null,
          timings: timings || undefined
        }
      }).catch(err => {
        logger.error('[V2 RESPOND] TWIML_SENT log failed', { error: err.message });
      });
    };

    if (!mayBridge) {
      const result = await computeTurnPromise;
      twimlString = result.twimlString;
      voiceProviderUsed = result.voiceProviderUsed;
      await logTwimlSent({
        route: '/v2-agent-respond',
        twimlString,
        voiceProviderUsed,
        responsePreview: result.responseText,
        matchSource: result.matchSource,
        timings: result.timings
      });
      res.type('text/xml');
      return res.send(twimlString);
    }

    const thresholdPromise = new Promise((resolve) => setTimeout(resolve, bridgeThresholdMs));
    const first = await Promise.race([
      computeTurnPromise.then((r) => ({ kind: 'result', r })),
      thresholdPromise.then(() => ({ kind: 'threshold' }))
    ]);

    if (first.kind === 'result') {
      const result = first.r;
      twimlString = result.twimlString;
      voiceProviderUsed = result.voiceProviderUsed;
      await logTwimlSent({
        route: '/v2-agent-respond',
        twimlString,
        voiceProviderUsed,
        responsePreview: result.responseText,
        matchSource: result.matchSource,
        timings: result.timings
      });
      res.type('text/xml');
      return res.send(twimlString);
    }

    // Threshold crossed first: attempt bridge with caps + per-turn guard.
    const bridgeCountKey = `a2bridge:count:${callSid}`;
    const bridgeTurnKey = `a2bridge:turn:${callSid}:${turnNumber}`;
    const lastLineKey = `a2bridge:lastLine:${callSid}`;

    const bridgesUsedRaw = await redis.get(bridgeCountKey);
    const bridgesUsed = parseInt(bridgesUsedRaw || 0, 10) || 0;
    if (bridgesUsed >= bridgeMaxPerCall) {
      const result = await computeTurnPromise;
      twimlString = result.twimlString;
      voiceProviderUsed = result.voiceProviderUsed;
      await logTwimlSent({
        route: '/v2-agent-respond',
        twimlString,
        voiceProviderUsed,
        responsePreview: result.responseText,
        matchSource: result.matchSource,
        timings: result.timings
      });
      res.type('text/xml');
      return res.send(twimlString);
    }

    const guardSet = await redis.set(bridgeTurnKey, '1', { EX: 60 * 10, NX: true });
    if (!guardSet) {
      const result = await computeTurnPromise;
      twimlString = result.twimlString;
      voiceProviderUsed = result.voiceProviderUsed;
      await logTwimlSent({
        route: '/v2-agent-respond',
        twimlString,
        voiceProviderUsed,
        responsePreview: result.responseText,
        matchSource: result.matchSource,
        timings: result.timings
      });
      res.type('text/xml');
      return res.send(twimlString);
    }

    const rawLines = Array.isArray(bridgeCfg.lines) ? bridgeCfg.lines : [];
    const bridgeLines = rawLines.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).slice(0, 12);
    const usableLines = bridgeLines.length > 0 ? bridgeLines : ['Ok — one moment.'];

    let idx = 0;
    try {
      const h = crypto.createHash('sha256').update(`${callSid}:${turnNumber}`).digest('hex');
      idx = parseInt(h.substring(0, 8), 16) % usableLines.length;
    } catch (_) {
      idx = 0;
    }

    const lastIdxRaw = await redis.get(lastLineKey);
    const lastIdx = parseInt(lastIdxRaw || -1, 10);
    if (usableLines.length > 1 && idx === lastIdx) {
      idx = (idx + 1) % usableLines.length;
    }
    await redis.set(lastLineKey, String(idx), { EX: 60 * 60 * 4 }).catch(() => {});

    const newCount = await redis.incr(bridgeCountKey);
    if (newCount === 1) await redis.expire(bridgeCountKey, 60 * 60 * 4).catch(() => {});

    // State flag (best-effort, for traceability; guard keys remain authoritative)
    callState.agent2Bridge = callState.agent2Bridge || {};
    callState.agent2Bridge.lastBridgeTurn = turnNumber;
    callState.agent2Bridge.bridgesUsedThisCall = newCount;

    const token = crypto.randomBytes(8).toString('hex');
    const cacheKey = `a2bridge:twiml:${callSid}:${turnNumber}:${token}`;
    const startedKey = `a2bridge:t0:${callSid}:${turnNumber}:${token}`;
    await redis.set(startedKey, String(Date.now()), { EX: 60 * 10 }).catch(() => {});

    computeTurnPromise
      .then(async (result) => {
        const playUrlMatch = result.twimlString.match(/<Play[^>]*>([^<]+)<\/Play>/);
        const audioUrl = playUrlMatch ? playUrlMatch[1] : null;
        
        const payload = {
          twimlString: result.twimlString,
          voiceProviderUsed: result.voiceProviderUsed,
          responsePreview: `${result.responseText || ''}`.substring(0, 120),
          matchSource: result.matchSource,
          timings: result.timings,
          audioUrl,
          responseText: result.responseText,
          agentTurn: result.agentTurnForCache || null
        };
        await redis.set(cacheKey, JSON.stringify(payload), { EX: 90, NX: true });
        if (CallLogger && callSid) {
          CallLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'AGENT2_BRIDGE_FINAL_CACHED',
            turn: turnNumber,
            data: {
              cacheTtlSec: 90,
              matchSource: result.matchSource || null,
              twimlLength: result.twimlString?.length || 0,
              timings: result.timings || null,
              hasAgentTurn: !!result.agentTurnForCache
            }
          }).catch(() => {});
        }
      })
      .catch(async (err) => {
        await redis.set(cacheKey, JSON.stringify({ error: err?.message || 'compute_failed' }), { EX: 90, NX: true }).catch(() => {});
      });

    const elapsedMs = Date.now() - T0;
    const bridgeLine = usableLines[idx];
    const continueUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-bridge-continue/${companyID}?turn=${turnNumber}&token=${encodeURIComponent(token)}&attempt=0`;

    // ═══════════════════════════════════════════════════════════════════════════
    // BRIDGE AUDIO: Use cached ElevenLabs MP3 via <Play>, never Twilio <Say>.
    // If no cached audio exists, use <Pause> (silence > wrong voice).
    // ═══════════════════════════════════════════════════════════════════════════
    const BridgeAudioService = require('../services/bridgeAudio/BridgeAudioService');
    const bridgeVoiceSettings = company?.aiAgentSettings?.voiceSettings || {};
    const bridgeAudioUrl = BridgeAudioService.getAudioUrl({
      companyId: companyID,
      text: bridgeLine,
      voiceSettings: bridgeVoiceSettings,
      hostHeader
    });
    const bridgeOutputMode = bridgeAudioUrl ? 'play' : 'pause';
    const bridgeVoiceProvider = bridgeAudioUrl ? 'elevenlabs_cached' : 'silence';

    if (CallLogger && callSid) {
      await CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'AGENT2_BRIDGE_SPOKEN',
        turn: turnNumber,
        data: {
          elapsedMs,
          thresholdMs: bridgeThresholdMs,
          hardCapMs: bridgeHardCapMs,
          maxRedirectAttempts: bridgeMaxRedirectAttempts,
          bridgesUsedBefore: bridgesUsed,
          bridgesUsedAfter: newCount,
          lineIdx: idx,
          linePreview: bridgeLine.substring(0, 80),
          reason: 'threshold_exceeded',
          voiceProvider: bridgeVoiceProvider,
          outputMode: bridgeOutputMode,
          audioUrl: bridgeAudioUrl || null
        }
      }).catch(() => {});
    }

    try {
      const bridgeTurnKind = bridgeAudioUrl ? 'TWIML_PLAY' : 'TWIML_PAUSE';
      const bridgeTurn = {
        speaker: 'system',
        kind: bridgeTurnKind,
        text: `${bridgeLine || ''}`.trim(),
        turn: turnNumber,
        timestamp: new Date().toISOString(),
        source: 'AGENT2_BRIDGE',
        provenance: {
          type: 'UI_OWNED',
          uiPath: 'aiAgentSettings.agent2.bridge.lines',
          reason: 'threshold_exceeded',
          voiceProviderUsed: bridgeVoiceProvider,
          audioUrl: bridgeAudioUrl || null,
          isBridge: true,
          bridge: {
            elapsedMs,
            thresholdMs: bridgeThresholdMs,
            hardCapMs: bridgeHardCapMs
          }
        }
      };

      if (!callState.turns) callState.turns = [];
      if (bridgeTurn.text) callState.turns.push(bridgeTurn);

      if (bridgeTurn.text) {
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          await CallTranscriptV2.appendTurns(companyID, callSid, [
            {
              speaker: 'system',
              kind: bridgeTurnKind,
              text: bridgeAudioUrl ? bridgeTurn.text : `[BRIDGE_PAUSE] ${bridgeTurn.text}`,
              turnNumber,
              ts: bridgeTurn.timestamp,
              sourceKey: 'AGENT2_BRIDGE',
              trace: {
                provenance: {
                  ...bridgeTurn.provenance,
                  tracePack: {
                    resolver: 'bridge',
                    uiPath: 'aiAgentSettings.agent2.bridge.lines',
                    configVersionHash: req.session?.awHash || null,
                    effectiveConfigVersion: req.session?.effectiveConfigVersion || null,
                    match: { engine: 'rules', score: null, matchedId: null, matchSource: 'AGENT2_BRIDGE' },
                    toolRefs: [],
                    tts: {
                      provider: bridgeAudioUrl ? 'elevenlabs' : 'none',
                      voiceId: bridgeAudioUrl ? (bridgeVoiceSettings.voiceId || null) : null,
                      cached: !!bridgeAudioUrl
                    },
                    twiml: {
                      outputMode: bridgeOutputMode,
                      actions: bridgeAudioUrl
                        ? [{ type: 'PLAY', url: bridgeAudioUrl }]
                        : [{ type: 'PAUSE', length: 1 }]
                    },
                    latency: {
                      bridgeElapsedMs: elapsedMs,
                      thresholdMs: bridgeThresholdMs,
                      hardCapMs: bridgeHardCapMs
                    }
                  }
                }
              }
            }
          ]);
        } catch (v2Err) {
          logger.warn('[V2TWILIO] Failed to append bridge turns to CallTranscriptV2 (non-blocking)', {
            callSid: callSid?.slice(-8),
            error: v2Err.message
          });
        }
      }

      if (redis && redisKey && bridgeTurn.text) {
        try {
          const buildKey = (t) => {
            const turn = typeof t?.turn === 'number' ? t.turn : 'na';
            const speaker = t?.speaker || 'unknown';
            const source = t?.source || '';
            const textPrefix = `${t?.text || ''}`.trim().substring(0, 48);
            return `${turn}:${speaker}:${source}:${textPrefix}`;
          };
          const existingRaw = await redis.get(redisKey);
          const existingState = existingRaw ? JSON.parse(existingRaw) : {};
          const existingTurns = Array.isArray(existingState?.turns) ? existingState.turns : [];
          const merged = [];
          const seen = new Set();
          for (const t of existingTurns) {
            const k = buildKey(t);
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(t);
          }
          const k2 = buildKey(bridgeTurn);
          if (!seen.has(k2)) merged.push(bridgeTurn);
          existingState.turns = merged;
          await redis.set(redisKey, JSON.stringify(existingState), { EX: 60 * 60 * 4 });
        } catch (err) {
          logger.warn('[V2TWILIO] Failed to persist bridge turn to Redis (non-blocking)', { callSid: callSid?.slice(-8), error: err.message });
        }
      }
    } catch (bridgePersistErr) {
      logger.warn('[V2TWILIO] Bridge turn persist failed (non-blocking)', { error: bridgePersistErr.message });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BUILD BRIDGE TWIML: <Play> cached audio or <Pause> — NEVER <Say>
    // ═══════════════════════════════════════════════════════════════════════════
    const bridgeTwiml = new twilio.twiml.VoiceResponse();
    if (bridgeAudioUrl) {
      bridgeTwiml.play(bridgeAudioUrl);
    } else {
      logger.warn('[V2TWILIO] No cached bridge audio — using silence instead of Twilio <Say>', {
        callSid: callSid?.slice(-8),
        companyId: companyID,
        bridgeLine: bridgeLine.substring(0, 60)
      });
      bridgeTwiml.pause({ length: 1 });
    }
    bridgeTwiml.redirect({ method: 'POST' }, continueUrl);
    twimlString = bridgeTwiml.toString();
    voiceProviderUsed = bridgeVoiceProvider;

    await logTwimlSent({
      route: '/v2-agent-respond',
      twimlString,
      voiceProviderUsed,
      responsePreview: bridgeLine,
      matchSource: 'AGENT2_BRIDGE',
      isBridge: true,
      bridgeMeta: {
        token: token.slice(0, 8),
        elapsedMs,
        thresholdMs: bridgeThresholdMs,
        outputMode: bridgeOutputMode,
        audioUrl: bridgeAudioUrl || null
      }
    });

    res.type('text/xml');
    return res.send(twimlString);
    
  } catch (error) {
    routeError = error;
    logger.error('[V2TWILIO] plumbing route CRASHED', {
      callSid,
      companyID,
      error: error.message,
      stack: error.stack?.substring(0, 500)
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ROUTE_ERROR + FALLBACK TWIML_SENT - CRITICAL - MUST AWAIT
    // ═══════════════════════════════════════════════════════════════════════════
    if (CallLogger && callSid) {
      // Log the error
      await CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'ROUTE_ERROR',
        turn: turnNumber,
        data: {
          route: '/v2-agent-respond',
          error: error.message,
          stack: error.stack?.substring(0, 500)
        }
      }).catch(() => {});
    }
    
    const crashText = "I'm connecting you to our team.";
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(crashText);
    twimlString = twiml.toString();

    // Log to CallTranscriptV2 so crash fallbacks appear in transcripts
    if (callSid) {
      try {
        const CallTranscriptV2 = require('../models/CallTranscriptV2');
        await CallTranscriptV2.appendTurns(companyID, callSid, [
          {
            speaker: 'agent',
            kind: 'CONVERSATION_AGENT',
            text: crashText,
            turnNumber,
            ts: new Date(),
            sourceKey: 'ROUTE_CRASH',
            trace: {
              provenance: { type: 'HARDCODED', reason: 'route_crash', voiceProviderUsed: 'twilio_say' },
              error: error.message
            }
          }
        ]);
      } catch (_) { /* best-effort */ }
    }

    if (CallLogger && callSid) {
      await CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'TWIML_SENT',
        turn: turnNumber,
        data: {
          section: 'S7_VOICE_PROVIDER',
          route: '/v2-agent-respond',
          twimlLength: twimlString.length,
          hasGather: false,
          hasPlay: false,
          hasSay: true,
          voiceProviderUsed: 'twilio_say',
          isFallback: true,
          fallbackReason: error.message
        }
      }).catch(() => {});
    }
    
    res.type('text/xml');
    return res.send(twimlString);
  }
});

// Legacy disabled route physically removed in Phase 3 purge.
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
      if (CallLogger) {
        CallLogger.logEvent({
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
      
      // ═══════════════════════════════════════════════════════════════════════════
      // CACHE PARTIAL TRANSCRIPT - Fallback for when SpeechResult is missing
      // ═══════════════════════════════════════════════════════════════════════════
      // Store the last stable partial transcript in Redis so v2-agent-respond
      // can use it when Twilio fails to send SpeechResult
      const redis = await getRedis();
      if (redis && CallSid) {
        const cacheKey = `partial:${CallSid}`;
        try {
          await redis.set(cacheKey, StableSpeechResult, { EX: 300 }); // 5 min TTL
          logger.debug('[V2 PARTIAL] Cached transcript for fallback', {
            callSid: CallSid?.slice(-8),
            textLength: StableSpeechResult.length
          });
        } catch (err) {
          logger.warn('[V2 PARTIAL] Failed to cache transcript', { error: err.message });
        }
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
        actionOnEmptyResult: true, // CRITICAL: Post to action even if no speech (prevents loop)
        timeout: 7,
        speechTimeout: 'auto',
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
        actionOnEmptyResult: true, // CRITICAL: Post to action even if no speech (prevents loop)
        timeout: 7,
        speechTimeout: 'auto',
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
            // Safe endedAt for both CallSummary + transcript finalization
            const endedAtCandidate = Timestamp ? new Date(Timestamp) : new Date();
            const endedAtSafe = Number.isNaN(endedAtCandidate.getTime()) ? new Date() : endedAtCandidate;

            // Finalize CallTranscriptV2 metadata (endedAt, Twilio duration) — transcript turns were already persisted during the call.
            try {
              const CallTranscriptV2 = require('../models/CallTranscriptV2');
              await CallTranscriptV2.finalizeCall(callSummary.companyId, CallSid, {
                endedAt: endedAtSafe,
                twilioDurationSeconds: parseInt(CallDuration) || 0
              });
            } catch (v2FinalizeErr) {
              logger.warn('[CALL STATUS] Failed to finalize CallTranscriptV2 (non-blocking)', {
                callSid: CallSid,
                error: v2FinalizeErr.message
              });
            }

            // Map Twilio status to our outcome
            const outcomeMap = {
              'completed': 'completed',
              'busy': 'abandoned',
              'no-answer': 'abandoned',
              'canceled': 'abandoned',
              'failed': 'error'
            };
            
            // ════════════════════════════════════════════════════════════════
            // Load transcript from Redis call state
            // ════════════════════════════════════════════════════════════════
            let transcript = [];
            try {
              const redis = await getRedis();
              if (redis) {
                const redisKey = `call:${CallSid}`;
                const raw = await redis.get(redisKey);
                if (raw) {
                  const callState = JSON.parse(raw);
                  transcript = callState.turns || [];
                  logger.info('[CALL STATUS] Loaded transcript from Redis', {
                    callSid: CallSid,
                    turnCount: transcript.length
                  });
                }
              }
            } catch (redisErr) {
              logger.warn('[CALL STATUS] Failed to load transcript from Redis (non-blocking)', {
                callSid: CallSid,
                error: redisErr.message
              });
            }
            
            // Update the call summary with transcript

            await CallSummaryService.endCall(callSummary.callId, {
              outcome: outcomeMap[CallStatus] || 'completed',
              durationSeconds: parseInt(CallDuration) || 0,
              answeredBy: AnsweredBy,
              endedAt: endedAtSafe,
              transcript,
              turnCount: transcript.length
            });
            
            logger.info('[CALL STATUS] CallSummary updated', {
              callId: callSummary.callId,
              outcome: outcomeMap[CallStatus],
              duration: CallDuration,
              transcriptTurns: transcript.length
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
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          await CallTranscriptV2.finalizeCall(companyId, CallSid, {
            endedAt: new Date(),
            twilioDurationSeconds: parseInt(CallDuration) || 0
          });
        } catch (v2FinalizeErr) {
          logger.warn('[CALL STATUS] Failed to finalize CallTranscriptV2 (company callback, non-blocking)', {
            companyId,
            callSid: CallSid,
            error: v2FinalizeErr.message
          });
        }

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
        .select('aiAgentSettings.llm0Controls.recoveryMessages phoneNumber')
        .lean();
      const rm = company?.aiAgentSettings?.llm0Controls?.recoveryMessages || {};
      // ☢️ NUKED Feb 2026: frontDeskBehavior.connectionQualityGate removed
      
      config = {
        forwardNumber: rm.catastrophicForwardNumber || company?.phoneNumber || '',
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
    const CallLogger = require('../services/CallLogger');
    CallLogger.logEvent({
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
    actionOnEmptyResult: true,
    timeout: 7,
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

// ════════════════════════════════════════════════════════════════════════════════
// 🚨 CATCH-ALL ENDPOINT - MUST be the ABSOLUTE LAST route registered!
// ════════════════════════════════════════════════════════════════════════════════
// Express routes match in registration order. If this appears before other routes,
// it swallows ALL requests and makes everything below it unreachable dead code.
// This was the root cause of the "check your Twilio webhook settings" error —
// the catastrophic-dtmf, status-callback, and test-gather routes were shadowed.
// ════════════════════════════════════════════════════════════════════════════════
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

logger.info('🚀 [V2TWILIO] ========== EXPORTING ROUTER (FILE LOADED SUCCESSFULLY) ==========');
module.exports = router;