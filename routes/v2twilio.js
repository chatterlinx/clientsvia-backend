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

// ═══════════════════════════════════════════════════════════════════════════
// TWILIO FALLBACK VOICE: Used by all <Say> verbs when ElevenLabs is down.
// Amazon Polly Neural tier — natural sounding, ~$0.006 per response.
// Only costs money when ElevenLabs fails; normal calls use ElevenLabs audio.
// ═══════════════════════════════════════════════════════════════════════════
const TWILIO_FALLBACK_VOICE = 'Polly.Matthew-Neural';

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
const { heartbeatKey, partialKey, resultKey } = require('../services/streaming/ClaudeStreamingService');
const { StateStore } = require('../services/engine/StateStore');
const LLM0ControlsLoader = require('../services/LLM0ControlsLoader');
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
// Apr 2026 — TTS provider router (per-tenant default TTS with Polly safety net).
// Routes synthesis through the tenant's chosen provider, auto-falls-through
// EL→Polly on failure using the tenant's chosen pollyVoiceId. Used by greeting
// path below; other synthesis sites migrate in C3.
const TTSProviderRouter = require('../services/tts/TTSProviderRouter');
const { getPollyFallbackVoice, getPrimaryProvider } = require('../services/tts/pollyHelpers');
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

// ─── Speculative LLM pre-warm (fires during partialResultCallback) ─────────────
const { runSpeculativeLLM, checkSpeculativeResult } = require('../services/speculative/SpeculativeLLMService');
// UAP runs on every partial (<1ms) to detect confident matches EARLY.
// When UAP first hits ≥0.80 confidence, we fire the speculative LLM immediately
// (no debounce). If the match changes on a later partial, we fire again.
// By the time the caller finishes speaking, the response is already in Redis.
const UtteranceActParser = require('../services/engine/kc/UtteranceActParser');
const UAP_PARTIAL_CONFIDENCE = 0.80; // same as KC pipeline threshold
const _uapPartialMatch = new Map();  // callSid → { matchKey, firedAt }
// Legacy debounce kept as fallback for when UAP never matches (confidence < 0.80)
const _speculativeDebounce = new Map(); // callSid → timer handle

// Helper: Get Redis client safely (returns null if unavailable)
async function getRedis() {
  if (!isRedisConfigured()) return null;
  try {
    return await getSharedRedisClient();
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🎙️ SPEECH DETECTION — Single source of truth (NEVER hardcode)
//
// CANONICAL UI SAVE PATH: company.aiAgentSettings.speechDetection
//   Set by routes/company/v2companyConfiguration.js L2703-2705:
//     aiAgentSettings.speechDetection.speechTimeout
//     aiAgentSettings.speechDetection.initialTimeout
//     aiAgentSettings.speechDetection.bargeIn
//
// LEGACY FALLBACKS (older companies that haven't re-saved from UI yet):
//   company.aiAgentSettings.agent2.speechDetection
//   company.aiAgentSettings.voiceSettings.speechDetection
//
// If we fall through to a legacy path we log [SPEECH_DETECTION_DRIFT] so
// "silent save" drift becomes visible in Render logs. Root cause of
// regression on call CA04f553d9fabebc32b7edf487d04d720a (April 21 2026):
// UI saved to aiAgentSettings.speechDetection, server read from
// aiAgentSettings.agent2.speechDetection → always got {}, fell to 1s default.
//
// Schema default: 1.0s (v2Company.js). Twilio Gather requires string.
// ═══════════════════════════════════════════════════════════════════════════

function _getSpeechDetection(company) {
  const isNonEmpty = (v) => v && typeof v === 'object' && Object.keys(v).length > 0;
  const canonical = company?.aiAgentSettings?.speechDetection;
  if (isNonEmpty(canonical)) return canonical;

  const legacyAgent2 = company?.aiAgentSettings?.agent2?.speechDetection;
  if (isNonEmpty(legacyAgent2)) {
    logger.warn('[SPEECH_DETECTION_DRIFT] Fell back to aiAgentSettings.agent2.speechDetection — UI should re-save to populate canonical path', { companyId: company?._id?.toString?.() });
    return legacyAgent2;
  }

  const legacyVoice = company?.aiAgentSettings?.voiceSettings?.speechDetection;
  if (isNonEmpty(legacyVoice)) {
    logger.warn('[SPEECH_DETECTION_DRIFT] Fell back to aiAgentSettings.voiceSettings.speechDetection — UI should re-save to populate canonical path', { companyId: company?._id?.toString?.() });
    return legacyVoice;
  }

  return {};
}

/**
 * Returns the company's speechTimeout as a string for Twilio Gather.
 * opts.pendingFollowUp = true → returns '2' (longer wait when agent asked a question)
 *
 * FALLBACK = 'auto' (Twilio's native VAD, ~1.5s adaptive). A hardcoded '1' was
 * cutting callers off mid-sentence ("Um, [breath]...") when the canonical DB
 * path had no saved value. 'auto' respects natural speech cadence while
 * companies that save an explicit speechTimeout still get their chosen value.
 * Ref: Apr 22 2026 investigation — CAeea4b4dc.../CA9271b532... speech cutoff.
 */
function _speechTimeout(company, opts) {
  if (opts?.pendingFollowUp) return '2';
  const sd = _getSpeechDetection(company);
  return sd.speechTimeout ? sd.speechTimeout.toString() : 'auto';
}

// ═══════════════════════════════════════════════════════════════════════════
// 🗑️ TEMP AUDIO CLEANUP — Auto-delete per-call MP3s after Twilio fetches them
// ═══════════════════════════════════════════════════════════════════════════
// Temp audio files (ai_respond, s0, s1..., patience_checkin) are written to
// public/audio/ and served via <Play>. Twilio fetches them once then they're
// dead weight. We delete them 2 minutes after creation — long enough for any
// slow Twilio fetch but short enough to prevent disk exhaustion.
// ═══════════════════════════════════════════════════════════════════════════

const TEMP_AUDIO_DELETE_DELAY_MS = 2 * 60 * 1000; // 2 minutes

function scheduleTempAudioDelete(filePath, delayMs = TEMP_AUDIO_DELETE_DELAY_MS) {
  setTimeout(() => {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') {
        logger.warn('[TEMP_AUDIO] Failed to delete temp audio file', {
          file: path.basename(filePath),
          error: err.message,
        });
      }
    });
  }, delayMs);
}

// Startup sweep: delete orphaned temp audio files older than 10 minutes.
// Protects against server restarts mid-call that leave files stranded.
(function sweepOrphanedTempAudio() {
  const audioDir = path.join(__dirname, '../public/audio');
  const ORPHAN_AGE_MS = 10 * 60 * 1000; // 10 minutes
  const TEMP_PREFIXES = ['ai_respond_', 's0_', 'bridge_synth_', 'patience_checkin_'];
  const SENTENCE_RE   = /^s\d+_/;  // matches s1_, s2_, s3_, etc.

  fs.readdir(audioDir, (err, files) => {
    if (err) return; // audio dir may not exist yet on first boot
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith('.mp3')) continue;
      const isTemp = TEMP_PREFIXES.some(p => file.startsWith(p)) || SENTENCE_RE.test(file);
      if (!isTemp) continue;
      const filePath = path.join(audioDir, file);
      fs.stat(filePath, (statErr, stat) => {
        if (statErr) return;
        if (now - stat.mtimeMs > ORPHAN_AGE_MS) {
          fs.unlink(filePath, () => {}); // best-effort
        }
      });
    }
  });
})();

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
// FLOW_CHECKPOINT — Structured checkpoint events for Call Console visibility
// ============================================================================
// Mirrors the 34-step Flow Builder. Each checkpoint shows:
// - stepId: matches flow-builder.js step IDs
// - stepNum: sequence number (1-34)
// - tier: which tier (1-8)
// - title: human-readable step name
// - status: FIRED | SKIPPED | FAILED | BLOCKED
// - details: why this status, what happened
// - duration: ms spent at this step
// ============================================================================
function emitFlowCheckpoint(callLogger, callSid, companyId, turn, checkpoint) {
  if (!callLogger?.logEvent) return;
  
  const { stepId, stepNum, tier, title, status, details, durationMs, data } = checkpoint;
  
  callLogger.logEvent({
    callId: callSid,
    companyId,
    turn: turn || 0,
    type: 'FLOW_CHECKPOINT',
    data: {
      stepId,
      stepNum,
      tier,
      title,
      status,
      details,
      durationMs: durationMs || null,
      ...data,
      // Visual trace for Call Console rendering
      visualTrace: {
        icon: status === 'FIRED' ? '✅' : 
              status === 'SKIPPED' ? '⏭️' : 
              status === 'BLOCKED' ? '🚫' : 
              status === 'FAILED' ? '❌' : '❓',
        stage: `Step ${stepNum}: ${title}`,
        status: status.toLowerCase(),
        details: details || ''
      }
    }
  }).catch(err => {
    logger.warn('[FLOW_CHECKPOINT] Failed to log checkpoint', { stepId, error: err.message });
  });
}

// Flow step definitions (matches flow-builder.js)
const FLOW_STEPS = {
  TWILIO_ENTRY:     { stepId: 'step_twilio_entry',     stepNum: 1,  tier: 1, title: 'Twilio Entry' },
  GATEKEEPER:       { stepId: 'step_gatekeeper',       stepNum: 2,  tier: 1, title: 'Gatekeeper Check' },
  SPAM_FILTER:      { stepId: 'step_spam_filter',      stepNum: 3,  tier: 1, title: 'Spam Filter' },
  CALL_GREETING:    { stepId: 'step_call_greeting',    stepNum: 4,  tier: 1, title: 'Call Start Greeting' },
  GATHER_SETUP:     { stepId: 'step_gather',           stepNum: 5,  tier: 1, title: 'Gather Setup' },
  CUSTOMER_SPEAKS:  { stepId: 'step_customer_speaks',  stepNum: 6,  tier: 2, title: 'Customer Speaks' },
  SPEECHRESULT:     { stepId: 'step_speechresult_post',stepNum: 7,  tier: 2, title: 'SpeechResult Posted' },
  SCRABENGINE:      { stepId: 'step_scrabengine',      stepNum: 8,  tier: 3, title: 'ScrabEngine Entry' },
  SE_STAGE1:        { stepId: 'step_se_stage1',        stepNum: 9,  tier: 3, title: 'SE Filler Removal' },
  SE_STAGE2:        { stepId: 'step_se_stage2',        stepNum: 10, tier: 3, title: 'SE Vocabulary' },
  SE_STAGE3:        { stepId: 'step_se_stage3',        stepNum: 11, tier: 3, title: 'SE Token Expansion' },
  SE_STAGE4:        { stepId: 'step_se_stage4',        stepNum: 12, tier: 3, title: 'SE Entity Extraction' },
  SE_STAGE5:        { stepId: 'step_se_stage5',        stepNum: 13, tier: 3, title: 'SE Quality Gate' },
  LOAD_STATE:       { stepId: 'step_loadstate',        stepNum: 14, tier: 4, title: 'Load Call State' },
  CALL_RUNTIME:     { stepId: 'step_callruntime',      stepNum: 15, tier: 4, title: 'CallRuntime Router' },
  CALL_ROUTER:      { stepId: 'step_agent2callrouter', stepNum: 16, tier: 4, title: 'Agent2CallRouter' },
  AGENT2_DISCOVERY: { stepId: 'step_agent2discovery',  stepNum: 17, tier: 4, title: 'Agent2DiscoveryRunner' },
  NAME_GREETING:    { stepId: 'step_name_greeting',    stepNum: 18, tier: 5, title: 'Name Greeting' },
  GREETING_CHECK:   { stepId: 'step_greeting_check',   stepNum: 19, tier: 5, title: 'Greeting Interceptor' },
  FOLLOWUP_CONSENT: { stepId: 'step_followup_consent', stepNum: 20, tier: 5, title: 'Follow-Up Consent Gate' },
  CLARIFIER_EXIT:   { stepId: 'step_patience_exit',    stepNum: 21, tier: 5, title: 'Clarifier/Pending' },
  PATIENCE_MODE:    { stepId: 'step_patience_mode',    stepNum: 22, tier: 5, title: 'Patience Mode' },
  TRIGGER_POOL:     { stepId: 'step_trigger_pool_load',stepNum: 23, tier: 5, title: 'Trigger Pool Load' },
  TRIGGER_EVAL:     { stepId: 'step_trigger_eval',     stepNum: 24, tier: 5, title: 'TriggerCardMatcher' },
  TRIGGER_RESPONSE: { stepId: 'step_trigger_response', stepNum: 25, tier: 5, title: 'Trigger Response' },
  GREETING_FALLBACK:{ stepId: 'step_greeting_fallback',stepNum: 26, tier: 6, title: 'Greeting Fallback' },
  LLM_FALLBACK:     { stepId: 'step_llm_fallback',     stepNum: 27, tier: 6, title: 'LLM Fallback' },
  GENERIC_FALLBACK: { stepId: 'step_generic_fallback', stepNum: 28, tier: 6, title: 'Generic Fallback' },
  BOOKING_HANDOFF:  { stepId: 'step_booking_handoff',  stepNum: 29, tier: 7, title: 'Booking Handoff' },
  BOOKING_ENGINE:   { stepId: 'step_booking_engine',   stepNum: 30, tier: 7, title: 'BookingLogicEngine' },
  ELEVENLABS_TTS:   { stepId: 'step_elevenlabs',       stepNum: 31, tier: 8, title: 'ElevenLabs TTS' },
  TWIML_BUILD:      { stepId: 'step_twiml',            stepNum: 32, tier: 8, title: 'TwiML Build' },
  VOICE_SEND:       { stepId: 'step_voice_send',       stepNum: 33, tier: 8, title: 'Voice Response Send' },
  TURN_COMPLETE:    { stepId: 'step_turn_complete',    stepNum: 34, tier: 8, title: 'Turn Complete' }
};

// ============================================================================
// RECOVERY MESSAGE HELPER — UI-controlled, per-company
// ============================================================================
// Multi-tenant rule: NO hardcoded English. Every word the agent speaks must be
// configured in the UI (Agent Console → Recovery Messages).
// If a company hasn't configured a message, we return null and the caller
// sees silence rather than unapproved speech. The caller-facing handler
// should check for null and decide whether to skip or transfer.
//
// Extracted to utils/recoveryMessage.js (Stage 14, Y94) so engine modules
// (KCDiscoveryRunner, etc.) can emit UI-owned recovery copy without importing
// this full voice route. v2twilio.js re-exports nothing — just uses the shared.
// ============================================================================
const { getRecoveryMessage } = require('../utils/recoveryMessage');
const { stripMarkdown, cleanTextForTTS, enforceVoiceResponseLength } = require('../utils/textUtils');
const { sanitizeForSpeech, SAFE_FALLBACK } = require('../utils/sanitizeForSpeech');
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

/**
 * Consolidated voice-decision audit log.
 * Call after EVERY TwiML verb choice for spoken output so every line can be
 * traced: what provider was desired, what was attempted, and what was actually
 * delivered.
 *
 * @param {object} CallLogger
 * @param {object} opts
 * @param {string} opts.callSid
 * @param {string} opts.companyId
 * @param {number} opts.turnNumber
 * @param {object} opts.decision
 */
function logVoiceDecision(CallLogger, { callSid, companyId, turnNumber, decision }) {
  if (!CallLogger || !callSid) return;
  CallLogger.logEvent({
    callId: callSid,
    companyId,
    type: 'VOICE_DECISION',
    turn: turnNumber,
    data: {
      responseSource: decision.responseSource,          // T1_CARD | T2_LLM | T3_FALLBACK | BRIDGE_HOLD | BRIDGE_RESULT | BRIDGE_STREAMING | BRIDGE_PARTIAL
      desiredProvider: decision.desiredProvider,         // elevenlabs | twilio
      audioUrlPresent: !!decision.audioUrlPresent,
      audioUrlPreflightPassed: decision.audioUrlPreflightPassed ?? null,
      elevenLabsAttempted: !!decision.elevenLabsAttempted,
      elevenLabsSuccess: !!decision.elevenLabsSuccess,
      finalTwimlVerb: decision.finalTwimlVerb,          // PLAY | SAY | PAUSE
      fallbackReasonCode: decision.fallbackReasonCode || 'NONE',
    }
  }).catch(() => {});
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
    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, transferMessage);
    twiml.dial(transferNumber);
  } else if (isTransferEnabled(company)) {
    logger.info('[AI AGENT] Transfer enabled but no number configured, connecting to team');
    // 🔥 Neutral transfer message - no generic empathy
    const configResponse = `I'm connecting you to our team.`;
    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, configResponse);
    twiml.hangup();
  } else {
    logger.info('[AI AGENT] Transfer disabled, providing fallback message and continuing conversation');

    // Only say fallback message if one was provided (not null)
    if (fallbackMessage) {
      twiml.say({ voice: TWILIO_FALLBACK_VOICE }, fallbackMessage);
    }
    
    // Continue conversation instead of hanging up [[memory:8276820]]
    const gather = twiml.gather({
      input: 'speech',
      actionOnEmptyResult: true, // CRITICAL: Post to action even if no speech (prevents loop)
      timeout: 7,
      speechTimeout: _speechTimeout(company),
      speechModel: 'phone_call',
      action: `/api/twilio/v2-agent-respond/${companyID || 'unknown'}`,
      method: 'POST'
    });
    
    gather.say('');
    
    // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
    const finalFallback = `Thank you for calling. We'll make sure someone gets back to you as soon as possible.`;
    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, finalFallback);
    twiml.hangup();
  }
}

// Helper function to escape text for TwiML Say verb.
// Also acts as the final safety gate: sanitizeForSpeech blocks internal/error
// text from ever reaching a caller's ear.
function escapeTwiML(text, _mousetrap) {
  if (!text) { return ''; }

  const _trap = _mousetrap ? {} : null;
  const safe = sanitizeForSpeech(text, _trap ? { _trap } : {});

  // MOUSETRAP: detect when sanitizer killed the original text
  if (_mousetrap && _trap?.reason) {
    _mousetrap.fired = true;
    _mousetrap.reason = _trap.reason;
    _mousetrap.originalPreview = String(text).substring(0, 300);
    _mousetrap.replacedWith = SAFE_FALLBACK;
  }

  return safe.replace(/&/g, '&amp;')
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
    
    const companyLookupStart = Date.now();
    const company = await getCompanyByPhoneNumber(calledNumber);
    const companyLookupMs = Date.now() - companyLookupStart;

    // ═══════════════════════════════════════════════════════════════════
    // CHECKPOINT 1: TWILIO_ENTRY — Platform entry point
    // ═══════════════════════════════════════════════════════════════════
    if (company && CallLogger) {
      emitFlowCheckpoint(CallLogger, req.body.CallSid, company._id, 0, {
        ...FLOW_STEPS.TWILIO_ENTRY,
        status: 'FIRED',
        details: `Webhook received from ${callerNumber} → ${calledNumber}`,
        durationMs: Date.now() - callStartTime,
        data: {
          from: callerNumber,
          to: calledNumber,
          companyFound: true,
          companyName: company.businessName || company.name || 'unknown',
          companyLookupMs
        }
      });
    }

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      logger.info(`[ERROR] [ERROR] No company found for phone number: ${calledNumber}`);
      
      // CHECKPOINT 1 (Failed case): No company for number
      // We can't log to CallLogger without a companyId, but we log to server
      logger.warn('[FLOW_CHECKPOINT] Step 1 FAILED - No company for phone', { 
        stepId: 'step_twilio_entry', 
        calledNumber, 
        callerNumber 
      });
      
      // Configuration error for unconfigured numbers
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(msg));
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // 🚫 SPAM FILTER - Check if call should be blocked
    const spamFilterStart = Date.now();
    const SmartCallFilter = require('../services/SmartCallFilter');
    const filterResult = await SmartCallFilter.checkCall({
      callerPhone: callerNumber,
      companyId: company._id.toString(),
      companyPhone: calledNumber,
      twilioCallSid: req.body.CallSid
    });
    const spamFilterMs = Date.now() - spamFilterStart;

    // ═══════════════════════════════════════════════════════════════════
    // CHECKPOINT 3: SPAM_FILTER — Security gate
    // ═══════════════════════════════════════════════════════════════════
    emitFlowCheckpoint(CallLogger, req.body.CallSid, company._id, 0, {
      ...FLOW_STEPS.SPAM_FILTER,
      status: filterResult.shouldBlock ? 'BLOCKED' : 'FIRED',
      details: filterResult.shouldBlock 
        ? `Call blocked: ${filterResult.reason}` 
        : `Passed security checks (score: ${filterResult.spamScore || 0})`,
      durationMs: spamFilterMs,
      data: {
        spamScore: filterResult.spamScore || 0,
        reason: filterResult.reason || 'passed_all_checks',
        flags: filterResult.flags || []
      }
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
    
    // ════════════════════════════════════════════════════════════════════════
    // 📼 CALL CONSOLE VISUAL TRACE - Spam Filter Check
    // ════════════════════════════════════════════════════════════════════════
    const spamTracePayload = {
      decision: filterResult.shouldBlock ? 'BLOCKED' : 'ALLOWED',
      spamScore: filterResult.spamScore || 0,
      reason: filterResult.reason || 'passed_all_checks',
      flags: filterResult.flags || [],
      fromNumber: callerNumber,
      visualTrace: {
        icon: filterResult.shouldBlock ? '🚫' : '✅',
        stage: 'Spam Filter',
        status: filterResult.shouldBlock ? 'blocked' : 'passed',
        details: filterResult.shouldBlock
          ? `Call blocked: ${filterResult.reason}`
          : `Passed security checks (score: ${filterResult.spamScore || 0})`
      }
    };
    if (CallLogger) {
      try {
        await CallLogger.logEvent({
          callId: req.body.CallSid,
          companyId: company._id,
          type: 'SPAM_FILTER_CHECK',
          turn: 0,
          data: spamTracePayload
        });
      } catch (logErr) {
        logger.warn('[SPAM FILTER] Failed to log event (non-blocking)', { error: logErr.message });
      }
    }
    try {
      const CallTranscriptV2 = require('../models/CallTranscriptV2');
      await CallTranscriptV2.appendTrace(company._id, req.body.CallSid, [
        {
          kind: 'SPAM_FILTER_CHECK',
          turnNumber: 0,
          ts: new Date().toISOString(),
          payload: spamTracePayload
        }
      ]);
    } catch (traceErr) {
      logger.warn('[SPAM FILTER] Failed to append trace (non-blocking)', { error: traceErr.message });
    }

    if (filterResult.shouldBlock) {
      logger.security(`🚫 [SPAM BLOCKED] Call from ${callerNumber} blocked. Reason: ${filterResult.reason}`);
      
      // Play rejection message and hangup
      twiml.say({ voice: TWILIO_FALLBACK_VOICE }, 'This call has been blocked. Goodbye.');
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
    // NOTE: spamScore/reason/flags are already persisted via CallLogger SPAM_FILTER_CHECK
    // event and CallTranscriptV2.appendTrace above. Prior code stashed them on req.session
    // for downstream Twilio webhooks, but Twilio does not send session cookies back on
    // subsequent webhook POSTs, so those session writes were never read. Removed April 2026.

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
    
    logger.debug('[CALL SOURCE]', {
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
        voice: TWILIO_FALLBACK_VOICE,
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
        voice: TWILIO_FALLBACK_VOICE,
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
        speechTimeout: _speechTimeout(company), // Auto speech timeout - let Twilio decide when user is done
        enhanced: true, // Enhanced speech recognition
        speechModel: 'phone_call', // Optimized for phone calls
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually' // Help recognize common filler words
      });
      gather.say({ voice: TWILIO_FALLBACK_VOICE }, greeting);

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
            voice: TWILIO_FALLBACK_VOICE,
            language: 'en-US'
        }, escapeTwiML(preActivationMessage));
        
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
        return;
    }
    
    logger.info(`[GO LIVE CHECK] ✅ AI Agent is LIVE - proceeding to handle call`);
    
    // ════════════════════════════════════════════════════════════════════════
    // 📼 CALL CONSOLE VISUAL TRACE - Gatekeeper Configuration Check
    // ════════════════════════════════════════════════════════════════════════
    const gatekeeperStatus = company.accountStatus?.status || 'active';
    const gatekeeperDecision = gatekeeperStatus === 'active' ? 'PROCEED' 
      : gatekeeperStatus === 'suspended' ? 'BLOCKED' 
      : gatekeeperStatus === 'call_forward' ? 'FORWARD' : 'PROCEED';
    
    // ═══════════════════════════════════════════════════════════════════
    // CHECKPOINT 2: GATEKEEPER — Account status gate
    // ═══════════════════════════════════════════════════════════════════
    emitFlowCheckpoint(CallLogger, req.body.CallSid, company._id, 0, {
      ...FLOW_STEPS.GATEKEEPER,
      status: gatekeeperDecision === 'PROCEED' ? 'FIRED' : gatekeeperDecision === 'BLOCKED' ? 'BLOCKED' : 'SKIPPED',
      details: gatekeeperDecision === 'PROCEED' 
        ? 'Account active → proceeding to AI Agent'
        : gatekeeperDecision === 'BLOCKED'
        ? `Account suspended → playing suspension message`
        : `Call forward enabled → transferring to ${company.accountStatus?.callForwardNumber || 'N/A'}`,
      data: {
        accountStatus: gatekeeperStatus,
        decision: gatekeeperDecision,
        callForwardNumber: gatekeeperDecision === 'FORWARD' ? company.accountStatus?.callForwardNumber : null
      }
    });
    
    if (CallLogger) {
      try {
        await CallLogger.logEvent({
          callId: req.body.CallSid,
          companyId: company._id,
          type: 'GATEKEEPER_CHECK',
          turn: 0,
          data: {
            configuration: gatekeeperStatus,
            decision: gatekeeperStatus === 'active' ? 'PROCEED' : gatekeeperStatus.toUpperCase(),
            visualTrace: {
              icon: gatekeeperStatus === 'active' ? '✅' : gatekeeperStatus === 'suspended' ? '🚫' : '📞',
              stage: 'Gatekeeper',
              status: gatekeeperStatus,
              details: gatekeeperStatus === 'active' 
                ? 'Configuration: Active - Call proceeding to AI Agent'
                : gatekeeperStatus === 'suspended'
                ? 'Configuration: Suspended - Blocked with message'
                : gatekeeperStatus === 'call_forward'
                ? `Configuration: Call Forward - Transferring to ${company.accountStatus?.callForwardNumber || 'N/A'}`
                : 'Unknown status'
            }
          }
        });
      } catch (logErr) {
        logger.warn('[GATEKEEPER] Failed to log event (non-blocking)', { error: logErr.message });
      }
    }
    
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
          twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(suspendedMessage));
        } else {
          // No custom message - use neutral transfer message
          logger.info(`[ACCOUNT SUSPENDED] No custom message set - using neutral transfer`);
          const defaultMessage = "This service is unavailable. Please contact support.";
          twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(defaultMessage));
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
          twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(forwardMessage));
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
    // 🧠 CALLER RECOGNITION PRE-WARM (Step 11): Non-blocking, fire-and-forget.
    // Looks up caller phone → finds prior confirmed discoveryNotes + LostLeads →
    // writes pre-warmed DN to Redis before turn 1. DiscoveryNotesService.init()
    // will find it and preserve it (never start from a blank canvas).
    // ════════════════════════════════════════════════════════════════════════════
    if (req.body.CallSid && req.body.From) {
      const CallerRecognitionService = require('../services/engine/CallerRecognitionService');
      CallerRecognitionService.preWarm(companyIdStr, req.body.CallSid, req.body.From)
        .catch(err => logger.warn('[CALLER RECOGNITION] Pre-warm failed (non-blocking)', {
          companyId: companyIdStr, callSid: req.body.CallSid, error: err.message
        }));
    }

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
        
        // NOTE: callContext is re-derived per turn in v2-agent-respond via
        // CallSummary.findOne({ twilioSid: CallSid }). No session stash needed —
        // Twilio webhooks do not carry session cookies back. Removed April 2026.

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
    //
    // LIFECYCLE: Success/failure is persisted to CallSummary.callLifecycle so
    // the dashboard can distinguish "callback never registered" from "callback
    // registered but never received".
    // ════════════════════════════════════════════════════════════════════════════
    if (company.twilioConfig?.accountSid && company.twilioConfig?.authToken && req.body.CallSid) {
      const statusCallbackUrl = `${getSecureBaseUrl(req)}/api/twilio/status-callback/${company._id}`;
      const _callSid = req.body.CallSid;
      const _companyId = company._id;
      try {
        const twilioClient = twilio(company.twilioConfig.accountSid, company.twilioConfig.authToken);
        twilioClient.calls(_callSid)
          .update({
            statusCallback: statusCallbackUrl,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer']
          })
          .then(async () => {
            logger.info('[CALL STATUS] Status callback registered', {
              callSid: _callSid,
              url: statusCallbackUrl
            });
            // Persist success to lifecycle
            try {
              const _CS = require('../models/CallSummary');
              await _CS.updateOne(
                { twilioSid: _callSid },
                { $set: {
                  'callLifecycle.statusCallbackRegistered': true,
                  'callLifecycle.statusCallbackRegisteredAt': new Date()
                }}
              );
            } catch (_e) { /* non-blocking */ }
          })
          .catch(async (err) => {
            logger.error('[CALL STATUS] ❌ FAILED to register status callback — duration will NOT be set for this call', {
              callSid: _callSid,
              companyId: _companyId,
              error: err.message,
              code: err.code,
              statusCallbackUrl
            });
            // Persist failure to lifecycle
            try {
              const _CS = require('../models/CallSummary');
              await _CS.updateOne(
                { twilioSid: _callSid },
                { $set: {
                  'callLifecycle.statusCallbackRegistered': false,
                  'callLifecycle.statusCallbackError': err.message
                }}
              );
            } catch (_e) { /* non-blocking */ }
          });
      } catch (twilioInitErr) {
        logger.error('[CALL STATUS] ❌ Could not init Twilio client for status callback', {
          callSid: _callSid,
          companyId: _companyId,
          error: twilioInitErr.message
        });
      }
    } else {
      logger.warn('[CALL STATUS] Skipping status callback registration — missing Twilio credentials or CallSid', {
        hasAccountSid: !!company.twilioConfig?.accountSid,
        hasAuthToken: !!company.twilioConfig?.authToken,
        hasCallSid: !!req.body.CallSid
      });
    }
    // ════════════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════════════
    // 🎙️ FULL-CALL RECORDING — Start dual-channel Twilio recording
    // ════════════════════════════════════════════════════════════════════════════
    // Records both sides of the conversation for QA/supervision via Call Intelligence.
    // Fire-and-forget: must NOT block the voice response.
    // Recording status callback fires when Twilio finishes processing the audio,
    // delivering RecordingUrl + RecordingSid which we persist to CallSummary.
    //
    // LIFECYCLE: Success/failure is persisted to CallSummary.callLifecycle so
    // the dashboard can show "recording never started" vs "recording started
    // but callback never received".
    // ════════════════════════════════════════════════════════════════════════════
    if (company.twilioConfig?.accountSid && company.twilioConfig?.authToken && req.body.CallSid) {
      const recordingCallbackUrl = `${getSecureBaseUrl(req)}/api/twilio/recording-status`;
      const _recCallSid = req.body.CallSid;
      const _recAccountSid = company.twilioConfig.accountSid;
      const _recAuthToken = company.twilioConfig.authToken;

      // ── DELAY recording start by 4 seconds ──────────────────────────────
      // The /voice webhook fires when Twilio connects the call, but the call
      // is NOT "in-progress" until our TwiML response is returned and Twilio
      // begins executing it. Twilio REST API recordings.create() requires the
      // call to be "in-progress" — calling it immediately returns
      // "Requested resource is not eligible for recording".
      // 4 seconds is conservative: TwiML return + Twilio processing < 2s.
      // ────────────────────────────────────────────────────────────────────
      setTimeout(() => {
        try {
          const twilioRecClient = twilio(_recAccountSid, _recAuthToken);
          twilioRecClient.calls(_recCallSid)
            .recordings.create({
              recordingStatusCallback: recordingCallbackUrl,
              recordingStatusCallbackMethod: 'POST',
              recordingStatusCallbackEvent: ['completed', 'failed']
            })
            .then(async (recording) => {
              logger.info('[CALL RECORDING] ✅ Recording started (after delay)', {
                callSid: _recCallSid,
                recordingSid: recording.sid
              });
              // Persist success to lifecycle
              try {
                const _CS = require('../models/CallSummary');
                await _CS.updateOne(
                  { twilioSid: _recCallSid },
                  { $set: {
                    recordingSid: recording.sid,
                    'callLifecycle.recordingRequested': true,
                    'callLifecycle.recordingRequestedAt': new Date()
                  }}
                );
              } catch (_e) { /* non-blocking */ }
            })
            .catch(async (recErr) => {
              logger.error('[CALL RECORDING] ❌ FAILED to start recording (after delay)', {
                callSid: _recCallSid,
                error: recErr.message,
                code: recErr.code,
                recordingCallbackUrl
              });
              // Persist failure to lifecycle
              try {
                const _CS = require('../models/CallSummary');
                await _CS.updateOne(
                  { twilioSid: _recCallSid },
                  { $set: {
                    'callLifecycle.recordingRequested': false,
                    'callLifecycle.recordingError': recErr.message
                  }}
                );
              } catch (_e) { /* non-blocking */ }
            });
        } catch (recInitErr) {
          logger.error('[CALL RECORDING] ❌ Could not init Twilio client for recording', {
            callSid: _recCallSid,
            error: recInitErr.message
          });
        }
      }, 4000); // 4-second delay — call must be "in-progress" before Twilio allows recording
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

    // NOTE: awHash / effectiveConfigVersion / traceRunId are persisted via
    // CallLogger.initCall() below (keyed by CallSid). Subsequent turns look them
    // up from the black box, not from session. Prior "V98 FIX" stashed them on
    // req.session, but Twilio does not return session cookies on webhook POSTs,
    // so those writes were never read. Removed April 2026.

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

    // ════════════════════════════════════════════════════════════════════════════
    // 🌊 MEDIA STREAMS BRANCH (C4/5) — Direct Deepgram Nova-3 live STT
    // ────────────────────────────────────────────────────────────────────────────
    // Per-tenant flag at company.aiAgentSettings.agent2.mediaStreams.enabled.
    // When true AND the platform circuit breaker is closed, we emit
    // <Connect><Stream> TwiML pointing at /api/twilio/media-stream (the
    // WebSocket endpoint mounted by services/mediaStream/MediaStreamServer).
    // That path bypasses Twilio Gather entirely — audio flows through the WS
    // and turns are driven by Deepgram live events, not Gather completions.
    //
    // Fail-safe: ANY error in this block falls through to the standard Gather
    // path below. No tenant can end up in a broken state because Media Streams
    // setup threw. Same contract as the rest of /voice — the call lives on.
    // ════════════════════════════════════════════════════════════════════════════
    try {
      const { isMediaStreamsEnabled } = require('../services/mediaStream/ConfigResolver');
      const DeepgramCircuitBreaker = require('../services/mediaStream/DeepgramCircuitBreaker');

      if (isMediaStreamsEnabled(company)) {
        const circuitOpen = await DeepgramCircuitBreaker.isOpen();
        if (!circuitOpen) {
          logger.info(`[MS] 🌊 Routing call to Media Streams (companyId=${company._id}, callSid=${req.body.CallSid?.slice?.(-8) || 'none'})`);

          // Fire a flow checkpoint so Call Console + Black Box can see the
          // STT path decision. Same shape used by Gather-path checkpoints.
          if (CallLogger) {
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'MS_STREAM_ROUTED',
              turn: 0,
              data: {
                reason: 'mediaStreams.enabled=true && circuit=closed',
                wssPath: '/api/twilio/media-stream'
              }
            }).catch(() => {});
          }

          const msTwiml = new twilio.twiml.VoiceResponse();
          const connect = msTwiml.connect();
          const stream = connect.stream({
            url: `wss://${req.get('host')}/api/twilio/media-stream`
          });
          stream.parameter({ name: 'companyId', value: company._id.toString() });
          stream.parameter({ name: 'callSid', value: req.body.CallSid || '' });
          stream.parameter({ name: 'from', value: callerNumber || '' });
          stream.parameter({ name: 'to', value: calledNumber || '' });

          res.type('text/xml');
          res.send(msTwiml.toString());
          return;
        } else {
          logger.warn(`[MS] Circuit breaker OPEN — falling back to Gather for companyId=${company._id}`);
          if (CallLogger) {
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'MS_CIRCUIT_OPEN_FALLBACK',
              turn: 0,
              data: { reason: 'DeepgramCircuitBreaker.isOpen() === true' }
            }).catch(() => {});
          }
          // Fall through to Gather path below.
        }
      }
    } catch (msErr) {
      // Any failure in the Media Streams branch is non-fatal — caller still
      // gets the standard Gather path. Log loudly so we notice if this regresses.
      logger.error('[MS] branch threw — falling through to Gather', {
        error: msErr.message,
        stack: msErr.stack,
        companyId: company._id?.toString?.()
      });
    }

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
      
      logger.debug(`[V2 AGENT] Call initialized, greeting: "${initResult.greeting}"`);
      logger.debug(`[V2 VOICE] Voice settings:`, JSON.stringify(initResult.voiceSettings, null, 2));
      
      // Set up speech gathering with V2 Agent response handler
      // 📞 SPEECH DETECTION: Agent 2.0 settings take priority, Voice Settings as fallback.
      // agent2.speechDetection is set from the Agent 2.0 admin panel (Speech Detection card).
      // voiceSettings.speechDetection is the older path kept for backward compat.
      const speechDetection = company.aiAgentSettings?.agent2?.speechDetection
        || company.aiAgentSettings?.voiceSettings?.speechDetection
        || {};
      
      // 🐰 RABBIT HOLE CHECKPOINT #1: WHERE WILL GATHER SEND USER INPUT?
      const actionUrl = `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`;
      // Build STT hints via STTHintsBuilder — reads per-company keywords from MongoDB,
      // emits Deepgram "phrase:boost" format for nova-2-phonecall/auto, flat CSV for Google.
      const hints = await STTHintsBuilder.buildHints(null, company);

      // enhanced=true enables Twilio's Google-backed premium STT model.
      // It must be false when using Deepgram (nova-2-phonecall / auto) — the two conflict.
      const activeSpeechModel = speechDetection.speechModel ?? 'phone_call';
      const isDeepgramProvider = (activeSpeechModel === 'nova-2-phonecall' || activeSpeechModel === 'auto');
      const enhancedEnabled = isDeepgramProvider ? false : (speechDetection.enhancedRecognition ?? true);

      const gatherConfig = {
        input: 'speech',
        action: actionUrl,
        method: 'POST',
        actionOnEmptyResult: true, // CRITICAL: Post to action even if no speech detected (prevents infinite loop)
        bargeIn: speechDetection.bargeIn ?? false,
        timeout: speechDetection.initialTimeout ?? 7,
        speechTimeout: _speechTimeout(company),
        enhanced: enhancedEnabled,
        speechModel: activeSpeechModel,
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
      // CHECKPOINT 5: GATHER_SETUP — STT listening configured
      // ═══════════════════════════════════════════════════════════════════════
      emitFlowCheckpoint(CallLogger, req.body.CallSid, company._id, 0, {
        ...FLOW_STEPS.GATHER_SETUP,
        status: 'FIRED',
        details: `Gather configured: timeout=${gatherConfig.timeout}s, speechTimeout=${gatherConfig.speechTimeout}, enhanced=${gatherConfig.enhanced}`,
        data: {
          actionUrl: gatherConfig.action,
          timeout: gatherConfig.timeout,
          speechTimeout: gatherConfig.speechTimeout,
          bargeIn: gatherConfig.bargeIn,
          enhanced: gatherConfig.enhanced,
          speechModel: gatherConfig.speechModel,
          hintsCount: hints.split(',').length
        }
      });
      
      // ═══════════════════════════════════════════════════════════════════════
      // GREETING PLAYBACK: Handle prerecorded audio vs TTS
      // ═══════════════════════════════════════════════════════════════════════
      const greetingMode = initResult.greetingConfig?.mode;
      const greetingSource = initResult.greetingConfig?.source || 'legacy';
      const elevenLabsVoice = initResult.voiceSettings?.voiceId;
      
      // ═══════════════════════════════════════════════════════════════════════
      // CHECKPOINT 4: CALL_GREETING — Initial greeting to caller
      // ═══════════════════════════════════════════════════════════════════════
      const greetingSkipped = !initResult.greeting && !initResult.greetingConfig?.audioUrl;
      emitFlowCheckpoint(CallLogger, req.body.CallSid, company._id, 0, {
        ...FLOW_STEPS.CALL_GREETING,
        status: greetingSkipped ? 'SKIPPED' : 'FIRED',
        details: greetingSkipped 
          ? 'No greeting configured'
          : greetingMode === 'prerecorded' 
            ? `Playing prerecorded audio (source: ${greetingSource})`
            : elevenLabsVoice 
              ? `TTS via ElevenLabs (voiceId: ${elevenLabsVoice?.slice(-8)})`
              : 'TTS via Twilio Say',
        data: {
          mode: greetingMode || 'unknown',
          source: greetingSource,
          hasText: Boolean(initResult.greeting),
          hasAudio: Boolean(initResult.greetingConfig?.audioUrl),
          voiceProvider: elevenLabsVoice ? 'elevenlabs' : 'twilio',
          textPreview: initResult.greeting?.slice(0, 60) || null,
          isReturningCaller: Boolean(callContext?.isReturning)
        }
      });
      
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
        if (rawAudioPath.startsWith('/audio-safe/')) {
          // /audio-safe/ is an Express route with MongoDB fallback — always trust it.
          // Disk cache is restored automatically from MongoDB if missing after deploy.
          audioFileExists = true;
        } else if (rawAudioPath.startsWith('/audio/')) {
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
          
          // 📼 BLACK BOX + CALL CONSOLE VISUAL TRACE: Log prerecorded greeting
          if (CallLogger) {
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'GREETING_PRERECORDED',
              turn: 0,
              data: {
                visualTrace: {
                  icon: '🎵',
                  stage: 'Greeting',
                  status: 'prerecorded_audio',
                  details: `Playing pre-recorded audio (Agent 2.0)`,
                  audioUrl: audioUrl,
                  source: greetingSource
                },
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
          
          // Determine what text will be spoken — prefer greeting text, then emergency fallback
          const emergencyFb = initResult.greetingConfig?.emergencyFallback;
          const fallbackText = initResult.greeting || emergencyFb || '';
          const hasUiConfiguredText = Boolean(initResult.greeting);
          const usedEmergencyFallback = !initResult.greeting && Boolean(emergencyFb);
          
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
                  : (usedEmergencyFallback ? 'agent2.greetings.callStart.emergencyFallback' : 'NO_CONFIG'),
                uiPath: hasUiConfiguredText 
                  ? 'aiAgentSettings.agent2.greetings.callStart.text' 
                  : (usedEmergencyFallback ? 'aiAgentSettings.agent2.greetings.callStart.emergencyFallback' : 'UNMAPPED - NO_GREETING_CONFIGURED'),
                uiTab: 'Greetings',
                configPath: hasUiConfiguredText ? 'agent2.greetings.callStart.text' : 'agent2.greetings.callStart.emergencyFallback',
                spokenTextPreview: fallbackText.substring(0, 100),
                note: usedEmergencyFallback
                  ? `Audio file missing (${rawAudioPath}), using EMERGENCY FALLBACK`
                  : `Audio file missing (${rawAudioPath}), using TTS fallback from text field`,
                isFromUiConfig: hasUiConfiguredText || usedEmergencyFallback,
                usedEmergencyFallback,
                audioMissing: true,
                originalAudioPath: rawAudioPath
              }
            }).catch(() => {});
          }
          
          // Fall through to TTS logic below by NOT using the prerecorded branch
          // We achieve this by re-checking TTS conditions
          // 🧹 STAGE 2 (R6) TODO: This TTS block duplicates ~100 lines of the realtime path below (~L2397).
          //                       Consolidate into a single `renderGreetingTTS(company, greetingText, gather)` helper
          //                       that handles: GreetingAudio cache check → ElevenLabs synth → disk write →
          //                       scheduleTempAudioDelete → gather.play. Keeps a single source of truth for
          //                       greeting playback & cleanup semantics.
          if (elevenLabsVoice && initResult.greeting) {
            try {
              logger.info(`[GREETING] 🎙️ TTS fallback for missing audio (ElevenLabs: ${elevenLabsVoice})`);
              const greetingText = cleanTextForTTS(stripMarkdown(initResult.greeting));

              // ── Try GreetingAudio MongoDB cache BEFORE calling ElevenLabs ──
              let greetFallbackPlayed = false;
              try {
                const GreetingAudio = require('../models/GreetingAudio');
                const crypto = require('crypto');
                const gTextHash = crypto.createHash('sha256').update(greetingText.trim()).digest('hex');
                const cachedGreeting = await GreetingAudio.findOne({
                  companyId: `${company._id}`, textHash: gTextHash
                }).select('audioData audioUrl').lean();
                if (cachedGreeting?.audioData) {
                  // Restore disk + play via /audio-safe/
                  const gAudioUrl = cachedGreeting.audioUrl || `/audio-safe/greetings/greet_fallback_${gTextHash.slice(0, 16)}.mp3`;
                  gather.play(`${getSecureBaseUrl(req)}${gAudioUrl}`);
                  greetFallbackPlayed = true;
                  logger.info('[GREETING] ✅ TTS fallback served from GreetingAudio MongoDB cache');
                }
              } catch (_gErr) { /* non-fatal — fall through to ElevenLabs */ }

              if (!greetFallbackPlayed) {
              const ttsStartTime = Date.now();

              // Apr 2026: Route through TTSProviderRouter — respects tenant's
              // chosen provider (elevenlabs | polly) and auto-falls-through to
              // Polly (with tenant's chosen voice) if EL fails. The router
              // never throws on provider failure; only bugs reach the outer catch.
              const tts = await TTSProviderRouter.synthesize({
                text: greetingText,
                company,
                callSid,
                ttsSource: 'greeting_initial'
              });

              const ttsTime = Date.now() - ttsStartTime;
              logger.info(`[GREETING] ✅ TTS routed via ${tts.sourceProvider} in ${ttsTime}ms${tts.fallbackReason ? ` (fallback: ${tts.fallbackReason})` : ''}`);

              if (tts.kind === 'buffer') {
                // ElevenLabs path — write buffer to disk + play via /audio/
                const fileName = `ai_greet_fallback_${Date.now()}.mp3`;
                const audioDir = path.join(__dirname, '../public/audio');
                if (!fs.existsSync(audioDir)) { fs.mkdirSync(audioDir, { recursive: true }); }
                const greetFallbackPath = path.join(audioDir, fileName);
                await fs.promises.writeFile(greetFallbackPath, tts.audio);
                scheduleTempAudioDelete(greetFallbackPath);
                gather.play(`${getSecureBaseUrl(req)}/audio/${fileName}`);
              } else {
                // Polly path (primary OR EL-fallback) — Twilio renders server-side
                gather.say({ voice: tts.voice }, escapeTwiML(cleanTextForTTS(stripMarkdown(greetingText))));
              }
              }
            } catch (ttsErr) {
              logger.error(`[GREETING] ❌ TTS routing failed: ${ttsErr.message}`);
              // Last-resort: tenant's chosen Polly fallback voice (or platform default).
              gather.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(cleanTextForTTS(stripMarkdown(initResult.greeting))));
            }
          } else if (fallbackText) {
            gather.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(cleanTextForTTS(stripMarkdown(fallbackText))));
          } else {
            // ──────────────────────────────────────────────────────────────────
            // 🚨 LAST-RESORT SAY (April 2026) — NEVER LEAVE CALLER WITH SILENCE
            // ──────────────────────────────────────────────────────────────────
            // Prerecorded audio missing on disk AND no ElevenLabs voice AND no
            // greeting text AND no emergencyFallback configured. Without this
            // branch the caller hears ~11 seconds of dead air while Gather's
            // timeout runs out — the single worst first-impression failure
            // mode the platform can produce. Pull copy from UI recovery
            // messages (multi-tenant rule — no hardcoded business strings);
            // fall back to a companyName-based acknowledgement so there is
            // always *something* audible between pickup and the first caller
            // utterance.
            logger.warn(`[GREETING] ⚠️ No greeting text / emergency fallback for company ${company._id} — firing last-resort say so caller is not met with silence.`);
            const lastResortText =
              (await getRecoveryMessage(company, 'generalError').catch(() => null))
              || `Thank you for calling ${company.companyName || 'us'}. One moment please.`;
            gather.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(cleanTextForTTS(stripMarkdown(lastResortText))));

            if (CallLogger) {
              CallLogger.logEvent({
                callId: req.body.CallSid,
                companyId: company._id,
                type: 'GREETING_EMERGENCY_SAY_FIRED',
                turn: 0,
                data: {
                  reason: 'prerecorded_missing_no_tts_no_fallback',
                  missingAudioPath: rawAudioPath,
                  source: greetingSource,
                  spokenTextPreview: lastResortText.substring(0, 120),
                  voiceProvider: 'twilio_say',
                  visualTrace: {
                    icon: '🚨',
                    stage: 'Greeting',
                    status: 'emergency_say_fired',
                    details: 'Prerecorded audio missing, no TTS, no emergency fallback — last-resort Say prevented silent start',
                  },
                }
              }).catch(() => {});

              // V4: SPEECH_SOURCE_SELECTED so the attribution trail shows
              // the emergency path on the Call Review transcript.
              CallLogger.logEvent({
                callId: req.body.CallSid,
                companyId: company._id,
                type: 'SPEECH_SOURCE_SELECTED',
                turn: 0,
                data: {
                  sourceId: 'platform.recoveryMessages.generalError',
                  uiPath: 'UI → Recovery Messages → generalError (or hardcoded company-name fallback)',
                  uiTab: 'Connection Messages',
                  configPath: 'recoveryMessages.generalError',
                  spokenTextPreview: lastResortText.substring(0, 120),
                  note: 'EMERGENCY SAY: greeting config had no playable audio, no TTS path, and no emergency fallback — last-resort copy used',
                  isFromUiConfig: true,
                  usedEmergencyFallback: true,
                  audioMissing: true,
                  originalAudioPath: rawAudioPath,
                }
              }).catch(() => {});
            }
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
      // 🧹 STAGE 2 (R6) TODO: This block (~100 lines) is the full realtime TTS greeting pipeline.
      //                       A near-duplicate lives above inside the "prerecorded missing" fallback (~L2317).
      //                       Consolidate into one `renderGreetingTTS()` helper — single source of truth for
      //                       GreetingAudio cache → synth → disk → cleanup → play.
      else if (elevenLabsVoice && initResult.greeting) {
        try {
          logger.debug(`[TTS START] ✅ Using ElevenLabs voice ${elevenLabsVoice} for initial greeting (source: ${greetingSource})`);
          const greetingText = cleanTextForTTS(stripMarkdown(initResult.greeting));

          // ── Try GreetingAudio MongoDB cache BEFORE calling ElevenLabs ──────
          // Greeting text is usually identical across calls. First call pays the
          // ElevenLabs cost; all subsequent calls play from cache for free.
          let _greetCacheHit = false;
          try {
            const GreetingAudio = require('../models/GreetingAudio');
            const crypto = require('crypto');
            const _gHash = crypto.createHash('sha256').update(greetingText.trim()).digest('hex');
            const _gCached = await GreetingAudio.findOne({
              companyId: `${company._id}`, textHash: _gHash
            }).select('audioData audioUrl').lean();
            if (_gCached?.audioData && _gCached.audioUrl) {
              gather.play(`${getSecureBaseUrl(req)}${_gCached.audioUrl}`);
              _greetCacheHit = true;
              logger.info('[GREETING] ✅ Realtime TTS skipped — served from GreetingAudio cache');
            }
          } catch (_gcErr) { /* non-fatal */ }

          if (!_greetCacheHit) {
          const ttsStartTime = Date.now();

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

          // Apr 2026: Route through TTSProviderRouter — respects tenant's
          // provider choice (elevenlabs | polly) with auto-fallback to Polly
          // on any EL failure. See services/tts/TTSProviderRouter.js.
          const tts = await TTSProviderRouter.synthesize({
            text: greetingText,
            company,
            callSid,
            ttsSource: 'greeting'
          });

          const ttsTime = Date.now() - ttsStartTime;
          logger.info(`[TTS COMPLETE] [OK] AI Agent Logic greeting via ${tts.sourceProvider} in ${ttsTime}ms (source: ${greetingSource})${tts.fallbackReason ? ` — fallback: ${tts.fallbackReason}` : ''}`);
          
          // 📼 CALL CONSOLE VISUAL TRACE: Log TTS greeting generation
          if (CallLogger) {
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'GREETING_TTS_GENERATED',
              turn: 0,
              data: {
                visualTrace: {
                  icon: '🎙️',
                  stage: 'Greeting',
                  status: 'tts_generated',
                  details: `Generated via ElevenLabs TTS (${ttsTime}ms)`,
                  voiceId: elevenLabsVoice,
                  textPreview: greetingText.substring(0, 80),
                  processingTimeMs: ttsTime,
                  source: greetingSource
                },
                ttsTimeMs: ttsTime,
                voiceId: elevenLabsVoice,
                textLength: greetingText.length
              }
            }).catch(() => {});
          }
          
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
          
          if (tts.kind === 'buffer') {
            // ElevenLabs path — write MP3 to disk + play via /audio/
            const fileName = `ai_greet_${Date.now()}.mp3`;
            const audioDir = path.join(__dirname, '../public/audio');
            if (!fs.existsSync(audioDir)) {fs.mkdirSync(audioDir, { recursive: true });}
            const filePath = path.join(audioDir, fileName);
            await fs.promises.writeFile(filePath, tts.audio);
            // 🧹 STAGE 2 (R5): Schedule disk cleanup for per-call temp greeting (was leaking to disk forever).
            // 📌 STAGE 2 (Y3): `/audio/` (not `/audio-safe/`) is INTENTIONAL here — this is ephemeral per-call TTS,
            //                  not meant to survive deploys. Deleted ~2min after Twilio fetches it.
            scheduleTempAudioDelete(filePath);
            gather.play(`${getSecureBaseUrl(req)}/audio/${fileName}`);
          } else {
            // Polly path (primary OR EL-fallback) — Twilio renders server-side.
            // No disk write, no cleanup, zero cost until spoken.
            gather.say({ voice: tts.voice }, escapeTwiML(cleanTextForTTS(stripMarkdown(greetingText))));
          }
          
          // 📼 BLACK BOX: Log greeting sent
          if (CallLogger) {
            CallLogger.QuickLog.greetingSent(
              req.body.CallSid,
              company._id,
              greetingText,
              ttsTime
            ).catch(() => {}); // Fire and forget
            
            // V4: SPEECH_SOURCE_SELECTED for Call Review transcript attribution
            const usedEmergencyFb = initResult.greetingConfig?.usedEmergencyFallback === true;
            const usedHardcodedFb = initResult.greetingConfig?.usedHardcodedFallback === true;
            const fallbackReason = initResult.greetingConfig?.fallbackReason || null;
            CallLogger.logEvent({
              callId: req.body.CallSid,
              companyId: company._id,
              type: 'SPEECH_SOURCE_SELECTED',
              turn: 0,
              data: {
                sourceId: usedEmergencyFb
                  ? 'agent2.greetings.callStart.emergencyFallback'
                  : (greetingSource === 'agent2' ? 'agent2.greetings.callStart' : 'legacy.greeting'),
                uiPath: usedHardcodedFb 
                  ? 'UNMAPPED - NO_EMERGENCY_FALLBACK_CONFIGURED' 
                  : (usedEmergencyFb
                    ? 'aiAgentSettings.agent2.greetings.callStart.emergencyFallback'
                    : (greetingSource === 'agent2' 
                      ? 'aiAgentSettings.agent2.greetings.callStart.text' 
                      : 'aiAgentSettings.connectionMessages.greeting')),
                uiTab: greetingSource === 'agent2' ? 'Greetings' : 'Connection Messages',
                configPath: usedEmergencyFb ? 'agent2.greetings.callStart.emergencyFallback' : (greetingSource === 'agent2' ? 'agent2.greetings.callStart.text' : 'connectionMessages.greeting'),
                spokenTextPreview: greetingText.substring(0, 120),
                note: usedEmergencyFb 
                  ? `EMERGENCY FALLBACK: ${fallbackReason}`
                  : (usedHardcodedFb ? `NO FALLBACK CONFIGURED: ${fallbackReason}` : 'Call start greeting'),
                isFromUiConfig: !usedHardcodedFb,
                usedEmergencyFallback: usedEmergencyFb,
                usedHardcodedFallback: usedHardcodedFb
              }
            }).catch(() => {});
          }
          } // end if (!_greetCacheHit)
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

          // Last-resort: tenant's chosen Polly fallback voice (default Matthew).
          gather.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(cleanTextForTTS(stripMarkdown(initResult.greeting))));
        }
      } else {
        // Fallback to Say if no voice or greeting
        logger.debug(`⚠️ Fallback to Twilio Say - Voice: ${elevenLabsVoice ? 'SET' : 'MISSING'}, Greeting: ${initResult.greeting ? 'SET' : 'MISSING'}`);
        // 🧹 STAGE 2 (R7): Multi-tenant rule — no hardcoded business-facing strings. Pull from UI recovery message.
        const fallbackGreeting = initResult.greeting
          || (await getRecoveryMessage(company, 'generalError').catch(() => null))
          || "We're experiencing a technical issue. Please try your call again in a moment.";
        gather.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(cleanTextForTTS(stripMarkdown(fallbackGreeting))));
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
      
      // 🧹 STAGE 2 (R7): Multi-tenant rule — no hardcoded business-facing strings. Pull from UI recovery message.
      // Fallback to UI-configured recovery message if V2 Agent fails (never leak "V2 Agent" internals to caller).
      const fallbackGreeting = (await getRecoveryMessage(company, 'generalError').catch(() => null))
        || "We're experiencing a technical issue. Please try your call again in a moment.";
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        actionOnEmptyResult: true,
        bargeIn: false,
        timeout: 7,
        speechTimeout: _speechTimeout(company),
        enhanced: true,
        speechModel: 'phone_call'
      });
      gather.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(fallbackGreeting));
      
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

    // ── WEBHOOK_TIMING: Persist Turn-0 timing for Call Intelligence ──────
    // Fire-and-forget — never delays TwiML delivery to Twilio.
    if (req.body.CallSid && company?._id) {
      const _voiceElapsedMs = Date.now() - callStartTime;
      const CallTranscriptV2_vt = require('../models/CallTranscriptV2');
      CallTranscriptV2_vt.appendTrace(company._id, req.body.CallSid, [{
        kind: 'WEBHOOK_TIMING',
        turnNumber: 0,
        ts: new Date(),
        payload: {
          route: '/voice',
          totalElapsedMs: _voiceElapsedMs,
          breakdown: {
            companyLoadMs: companyLookupMs || 0,
            coreRuntimeMs: _voiceElapsedMs - (companyLookupMs || 0),
            ttsMs: 0,
            eventFlushMs: 0
          },
          atRisk: _voiceElapsedMs >= 12000,
          timedOut: _voiceElapsedMs >= 15000,
          voiceProviderUsed: twimlString.includes('<Play') ? 'twilio_play' : 'twilio_say'
        }
      }]).catch(() => {}); // fire-and-forget
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 📝 TRANSCRIPT V2: Persist greeting (Turn 0) DURING the call (Mongo)
    // ════════════════════════════════════════════════════════════════════════════
    // Canonical persistence: append immediately to CallTranscriptV2 keyed by (companyId, callSid).
    // Redis/status-callback are not required for transcript safety (kept for other state/diagnostics).
    // ════════════════════════════════════════════════════════════════════════════
    const greetingText = (typeof initResult !== 'undefined' && initResult?.greeting) ? initResult.greeting : null;
    if (greetingText && req.body.CallSid) {
      const greetingPlayMatch = twimlString.match(/<Play[^>]*>([^<]+)<\/Play>/i);
      const greetingAudioUrl = greetingPlayMatch?.[1]?.trim?.() || null;
      const greetingVoiceProviderUsed = greetingAudioUrl ? 'twilio_play' : 'twilio_say';
      const greetingConfigSource = (typeof initResult !== 'undefined' && initResult?.greetingConfig?.source)
        ? `${initResult.greetingConfig.source}`
        : null;
      const greetingMode = (typeof initResult !== 'undefined' && initResult?.greetingConfig?.mode)
        ? `${initResult.greetingConfig.mode}`
        : null;
      
      // Determine provenance: UI_OWNED (normal), FALLBACK (emergency), HARDCODED (no config)
      const greetingUsedEmergency = initResult?.greetingConfig?.usedEmergencyFallback === true;
      const greetingUsedHardcoded = initResult?.greetingConfig?.usedHardcodedFallback === true;
      const greetingFallbackReason = initResult?.greetingConfig?.fallbackReason || null;
      
      let greetingProvenanceType = 'UI_OWNED';
      let greetingUiPath;
      let greetingReason = null;
      
      if (greetingUsedHardcoded) {
        greetingProvenanceType = 'HARDCODED';
        greetingUiPath = 'UNMAPPED - NO_GREETING_CONFIGURED';
        greetingReason = `No greeting or emergency fallback configured: ${greetingFallbackReason}`;
      } else if (greetingUsedEmergency) {
        greetingProvenanceType = 'FALLBACK';
        greetingUiPath = 'aiAgentSettings.agent2.greetings.callStart.emergencyFallback';
        greetingReason = `Emergency fallback used: ${greetingFallbackReason}`;
      } else if (greetingConfigSource === 'agent2') {
        greetingUiPath = greetingAudioUrl
          ? 'aiAgentSettings.agent2.greetings.callStart.audioUrl'
          : 'aiAgentSettings.agent2.greetings.callStart.text';
      } else {
        greetingUiPath = 'aiAgentSettings.connectionMessages.greeting';
      }

      try {
        const CallTranscriptV2 = require('../models/CallTranscriptV2');
        await CallTranscriptV2.appendTurns(
          company._id,
          req.body.CallSid,
          [
            {
              speaker: 'agent',
              kind: 'GREETING',
              text: greetingText.trim(),
              turnNumber: 0,
              ts: new Date(),
              sourceKey: greetingUsedEmergency
                ? 'agent2.greetings.callStart.emergencyFallback'
                : (greetingConfigSource === 'agent2' ? 'agent2.greetings.callStart' : 'legacy.greeting'),
              trace: {
                kind: 'greeting',
                provenance: {
                  type: greetingProvenanceType,
                  uiPath: greetingUiPath,
                  reason: greetingReason,
                  greeting: {
                    mode: greetingMode,
                    source: greetingConfigSource,
                    deliveredVia: greetingAudioUrl ? 'prerecorded_audio' : (greetingVoiceProviderUsed === 'twilio_say' ? 'twilio_tts' : 'elevenlabs_tts'),
                    usedEmergencyFallback: greetingUsedEmergency,
                    usedHardcodedFallback: greetingUsedHardcoded
                  },
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
    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, 'Service is temporarily unavailable. Please try again later.');
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
    // Settings: LLMSettings.callHandling.lowConfidenceHandling
    // ========================================================================
    confidence = parseFloat(req.body.Confidence || '0');
    const companyId = company._id.toString();

    // ═══════════════════════════════════════════════════════════════════════════
    // 🧪 AGENT LAB HOOK 1 — Match inbound call to active test session
    // Caller registers their phone in Redis before dialing; here we link callSid.
    // ═══════════════════════════════════════════════════════════════════════════
    if (redisClient && callSid && req.body.From) {
      try {
        const _labNormPhone = (req.body.From + '').replace(/\D/g, '');
        const _labSessionId = await redisClient.get(`agentlab:phone:${companyId}:${_labNormPhone}`);
        if (_labSessionId) {
          // Link callSid → sessionId so Hook 2 can emit turns
          await redisClient.set(`agentlab:callsid:${callSid}`, _labSessionId, 'EX', 14400);
          // Update session status to ACTIVE and record callSid
          const _labRaw = await redisClient.get(`agentlab:session:${companyId}:${_labSessionId}`);
          if (_labRaw) {
            const _labSession = JSON.parse(_labRaw);
            _labSession.status  = 'ACTIVE';
            _labSession.callSid = callSid;
            await redisClient.set(`agentlab:session:${companyId}:${_labSessionId}`, JSON.stringify(_labSession), 'EX', 14400);
          }
        }
      } catch (_labErr) {
        // Non-fatal — lab hook failure must never affect live call
      }
    }

    // Load low confidence settings from LLMSettings (with legacy fallback)
    const lcSettings = await LLM0ControlsLoader.loadLowConfidenceSettings(companyId);
    
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
              // Per-tenant Deepgram model via ConfigResolver — no hardcoded model.
              // Falls through to platform default (AdminSettings.globalHub.mediaStreams.defaultModel)
              // then to 'nova-3' hardcoded last-resort if neither is set.
              const { resolveMediaStreamConfig } = require('../services/mediaStream/ConfigResolver');
              const _resolvedModel = resolveMediaStreamConfig(company).model;
              const dgResult = await DeepgramFallback.transcribeWithDeepgram(recordingUrl, {
                model: _resolvedModel
              });
              
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
      const speechDetection = company.aiAgentSettings?.agent2?.speechDetection || company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        actionOnEmptyResult: true,
        bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
        timeout: speechDetection.initialTimeout ?? 7,
        speechTimeout: _speechTimeout(company),
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
      });

      // Select appropriate repeat phrase — UI-configured, no hardcoded English
      let retryMsg;
      let retrySource;
      if (isLikelyUnclear) {
        retryMsg = await getRecoveryMessage(company, 'audioUnclear');
        retrySource = retryMsg ? 'recovery:audioUnclear' : null;
      } else {
        retryMsg = await getRecoveryMessage(company, 'generalError');
        retrySource = retryMsg ? 'recovery:generalError' : null;
      }
      // Fallback to lcSettings.repeatPhrase if recovery messages not yet configured
      if (!retryMsg) {
        retryMsg = lcSettings.repeatPhrase;
        retrySource = 'lcSettings:repeatPhrase';
      }
      
      logger.info(`[LOW CONFIDENCE] 🔄 Asking to repeat (attempt ${repeats}/${lcSettings.maxRepeatsBeforeEscalation}) [source: ${retrySource}]: "${retryMsg}"`);
      
      // Use ElevenLabs TTS if configured
      const elevenLabsVoice = company.aiAgentSettings?.voiceSettings?.voiceId;

      // C3 Apr 2026: Provider-aware retry synthesis. Cache lookup gated on
      // EL primary (Polly tenants always render live via <Say>). Router handles
      // EL → Polly fallback automatically.
      try {
        const retryMsgClean = cleanTextForTTS(stripMarkdown(retryMsg));
        const _vs3 = company.aiAgentSettings?.voiceSettings || {};
        const _isElPrimary = getPrimaryProvider(company) === 'elevenlabs';

        // getStatus is pure (file-system check). Always call to get filePath
        // for caching after synthesis. Cache HIT only honored when EL primary.
        const _retryIAS = require('../services/instantAudio/InstantAudioService');
        const _retryStatus = (_isElPrimary && elevenLabsVoice) ? _retryIAS.getStatus({
          companyId: companyID, kind: 'RETRY_PROMPT', text: retryMsgClean, voiceSettings: _vs3,
        }) : null;

        if (_retryStatus && _retryStatus.exists) {
          // Cache hit — play prebuilt EL audio
          gather.play(`${getSecureBaseUrl(req)}${_retryStatus.url.replace('/audio/', '/audio-safe/')}`);
        } else {
          // Cache miss OR Polly primary — route through TTSProviderRouter
          const tts = await TTSProviderRouter.synthesize({
            text: retryMsgClean,
            company,
            callSid,
            ttsSource: 'retry'
          });

          if (tts.kind === 'buffer') {
            // EL produced audio — cache to disk + serve via redis streaming endpoint
            if (_retryStatus) { try { fs.writeFileSync(_retryStatus.filePath, tts.audio); } catch (_) {} }
            const audioKey = `audio:retry:${callSid}`;
            if (redisClient) await redisClient.setEx(audioKey, 300, tts.audio.toString('base64'));
            const audioUrl = `https://${req.get('host')}/api/twilio/audio/retry/${callSid}`;
            gather.play(audioUrl);
          } else {
            // Polly path (primary OR EL-fallback) — Twilio renders server-side via <Say>
            gather.say({ voice: tts.voice }, escapeTwiML(retryMsgClean));
          }
        }
      } catch (err) {
        logger.error('[LOW CONFIDENCE] TTS routing failed, last-resort Polly Say:', err);
        gather.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(cleanTextForTTS(stripMarkdown(retryMsg))));
      }

      res.type('text/xml');
      return res.send(twiml.toString());
      }
    }
    
    // Confidence OK - clear repeat counter and proceed
    if (redisClient) await redisClient.del(repeatKey);
    logger.debug(`[LOW CONFIDENCE] ✅ Confidence ${confidencePercent.toFixed(1)}% passed threshold - proceeding with normal flow`);

    // ☢️ NUKED Mar 2026: Legacy CompanyQnA.find() removed - V2 AI Agent Runtime handles all knowledge
    // V2 SYSTEM: Use Priority-Driven Knowledge Router instead of legacy Q&A lookup
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
        const speechDetection = company.aiAgentSettings?.agent2?.speechDetection || company.aiAgentSettings?.voiceSettings?.speechDetection || {};
        const gather = twiml.gather({
          input: 'speech',
          action: `https://${req.get('host')}/api/twilio/handle-speech`,
          method: 'POST',
          actionOnEmptyResult: true,
          bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
          timeout: speechDetection.initialTimeout ?? 7,
          speechTimeout: _speechTimeout(company),
          enhanced: speechDetection.enhancedRecognition ?? true,
          speechModel: speechDetection.speechModel ?? 'phone_call',
          partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
        });
        
        gather.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(clarification));
        
        // Add to conversation history
        conversationHistory.push({ role: 'user', text: speechText });
        conversationHistory.push({ role: 'assistant', text: clarification });
        if (redisClient) await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
        
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      
      logger.info(`[Q&A RESPONSE] [OK] Using Q&A response (no repetition detected)`);
      
      // Use configurable speech detection settings (fallback to defaults if not set)
      const speechDetection = company.aiAgentSettings?.agent2?.speechDetection || company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        actionOnEmptyResult: true,
        bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
        timeout: speechDetection.initialTimeout ?? 7,
        speechTimeout: _speechTimeout(company),
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
      });

      // C3 Apr 2026: Note — this branch is currently unreachable on V2
      // (cachedAnswer is forced to null above for V2 migration). Migrating
      // anyway so if the legacy Q&A path is ever re-enabled, it routes
      // through TTSProviderRouter and respects the tenant's provider choice.
      try {
        const tts = await TTSProviderRouter.synthesize({
          text: cachedAnswer,
          company,
          callSid,
          ttsSource: 'cached_answer'
        });

        if (tts.kind === 'buffer') {
          const audioKey = `audio:qa:${callSid}`;
          if (redisClient) await redisClient.setEx(audioKey, 300, tts.audio.toString('base64'));
          const audioUrl = `https://${req.get('host')}/api/twilio/audio/qa/${callSid}`;
          gather.play(audioUrl);
        } else {
          gather.say({ voice: tts.voice }, escapeTwiML(cachedAnswer));
        }
      } catch (err) {
        logger.error('[Q&A CACHED] TTS routing failed, last-resort Polly Say:', err);
        gather.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(cachedAnswer));
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
    const speechDetection = company.aiAgentSettings?.agent2?.speechDetection || company.aiAgentSettings?.voiceSettings?.speechDetection || {};
    const gather = twiml.gather({
      input: 'speech',
      action: `https://${req.get('host')}/api/twilio/handle-speech`,
      method: 'POST',
      actionOnEmptyResult: true,
      bargeIn: speechDetection.bargeIn ?? false,
      timeout: speechDetection.initialTimeout ?? 7,
      speechTimeout: _speechTimeout(company),
      enhanced: speechDetection.enhancedRecognition ?? true,
      speechModel: speechDetection.speechModel ?? 'phone_call',
      partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
    });

    const strippedAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    // C3 Apr 2026: Route through TTSProviderRouter — respects tenant provider.
    // EL → Polly auto-fallback handled inside the router. No-voiceId case is
    // handled inside the router too (returns Polly descriptor with tenant's
    // chosen voice or platform default).
    try {
      logger.debug(`[TTS START] [TTS] Starting synthesis for: "${strippedAnswer.substring(0, 50)}..."`);
      const ttsStartTime = Date.now();

      const tts = await TTSProviderRouter.synthesize({
        text: strippedAnswer,
        company,
        callSid,
        ttsSource: 'answer_legacy'
      });

      const ttsTime = Date.now() - ttsStartTime;
      logger.info(`[TTS COMPLETE] via ${tts.sourceProvider} in ${ttsTime}ms${tts.fallbackReason ? ` (fallback: ${tts.fallbackReason})` : ''}`);

      let audioUrl = null;
      if (tts.kind === 'buffer') {
        // Store audio in Redis for fast serving
        const audioKey = `audio:ai:${callSid}`;
        if (redisClient) await redisClient.setEx(audioKey, 300, tts.audio.toString('base64'));
        audioUrl = `https://${req.get('host')}/api/twilio/audio/ai/${callSid}`;
        gather.play(audioUrl);
      } else {
        // Polly path — Twilio renders <Say> server-side
        gather.say({ voice: tts.voice }, escapeTwiML(strippedAnswer));
      }

      // 📼 BLACK BOX: Log TTS generation
      if (CallLogger) {
        CallLogger.logEvent({
          callId: callSid,
          companyId,
          type: 'TTS_GENERATED',
          data: {
            engine: tts.sourceProvider,
            ms: ttsTime,
            textLength: strippedAnswer.length,
            audioUrl,
            twilioSayVoice: tts.kind === 'polly' ? tts.voice : null,
            fallbackReason: tts.fallbackReason || null
          }
        }).catch(() => {});
      }

    } catch (err) {
      logger.error('TTS routing failed, last-resort Polly Say:', err.message);
      gather.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(strippedAnswer));
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

// 🚨 DEPRECATED — Partial speech results for the legacy /handle-speech pipeline.
// This endpoint ONLY serves the V2-agent-init-failure disaster fallback at ~L2608.
// The active V2 pipeline uses /v2-agent-partial/:companyId (L8262) instead.
// 🧹 STAGE 4 (R13): Leave in place until /handle-speech itself is retired, then delete
//                   together in a single cleanup pass.
router.post('/partial-speech', async (req, res) => {
  logger.debug(`[PARTIAL SPEECH] Received at: ${new Date().toISOString()}`);
  logger.debug(`[PARTIAL SPEECH] Partial result: "${req.body.SpeechResult}" (Stability: ${req.body.Stability})`);

  // Just acknowledge - we'll process the final result
  res.status(200).send('OK');
});

// 🧹 STAGE 4 (R15): Deleted `/speech-timing-test` diagnostic endpoint.
//                   Contained hardcoded English "Speech received at X..." (multi-tenant
//                   violation). Only referenced in admin UI (public/js/company-profile-modern.js)
//                   as a display-only webhook URL string, never actually invoked as a Twilio
//                   callback. Removed the admin UI reference in the same commit.

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
      twiml.say({ voice: TWILIO_FALLBACK_VOICE }, 'Sorry, there was a configuration error. Please try again later.');
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
      speechTimeout: _speechTimeout(company),
      enhanced: true,
      speechModel: 'phone_call'
    });
    
    // Silent gather - just listening for next input
    gather.pause({ length: 1 });
    
    // If no input, redirect back to continue listening
    twiml.redirect(`${getSecureBaseUrl(req)}/api/twilio/${companyID}/voice`);
    
  } catch (err) {
    logger.error(`[TWILIO] /:companyId/voice error: ${err.message}`);
    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, 'Sorry, there was a technical issue. Please try again.');
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
// TRANSFER WHISPER ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════
// Called by Twilio's <Number url="..."> whisper attribute on warm transfers.
// Twilio dials the destination, and BEFORE connecting the caller it calls
// this URL and plays the response as a whisper to the RECEIVING agent only.
//
// The context brief is written to Redis by GATE 0.5 (KCDiscoveryRunner)
// at the moment of transfer intent detection, keyed by callSid.
//
// Redis key: transfer-brief:{companyId}:{callSid}  TTL: 5 min
// ═══════════════════════════════════════════════════════════════════════════
router.post('/transfer-whisper/:companyId/:callSid', async (req, res) => {
  const { companyId, callSid } = req.params;
  const VoiceResponse = require('twilio').twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  try {
    const redis = await getSharedRedisClient().catch(() => null);
    const brief = redis
      ? await redis.get(`transfer-brief:${companyId}:${decodeURIComponent(callSid)}`)
      : null;

    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, brief || 'Incoming transferred call.');
    logger.info('[V2TWILIO] Transfer whisper served', {
      companyId, callSid: callSid?.slice(-8), hasCustomBrief: !!brief,
    });
  } catch (_e) {
    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, 'Incoming transferred call.');
  }

  res.type('text/xml').send(twiml.toString());
});

// ═══════════════════════════════════════════════════════════════════════════
// 🎧 LAP HOLD LOOP — ListenerActParser hold-state poller
// ═══════════════════════════════════════════════════════════════════════════
// Called by Twilio Gather during an active LAP hold.
// Each invocation checks hold state and either:
//   a) Detects a resume keyword → clears hold, returns to normal pipeline
//   b) Force-resumes after MAX_HOLD_CHECKINS dead-air cycles
//   c) Detects speech (any non-resume word) → treat as resume signal
//   d) Timeout / dead air → increment check-in, play prompt, loop back
//
// Wire: LAP gate (v2-agent-respond) sets hold state → this route loops →
//       resume → v2-agent-respond continues booking normally.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/lap-hold-loop/:companyId/:callSid', async (req, res) => {
  const { companyId }   = req.params;
  const callSid         = decodeURIComponent(req.params.callSid);
  const speechResult    = (req.body.SpeechResult || '').trim();
  const twiml           = new twilio.twiml.VoiceResponse();
  const LAPService      = require('../services/engine/lap/LAPService');
  const resumeToUrl     = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-respond/${companyId}`;
  const holdLoopUrl     = `${getSecureBaseUrl(req)}/api/twilio/lap-hold-loop/${companyId}/${encodeURIComponent(callSid)}`;

  try {
    // ── 1. Load hold state ─────────────────────────────────────────────────
    const holdState = await LAPService.getHoldState(companyId, callSid);

    if (!holdState) {
      // No hold state — safety fallback: redirect straight to normal pipeline
      logger.warn('[LAP HOLD] No hold state found — resuming normally', {
        companyId, callSid: callSid?.slice(-8)
      });
      const fallbackGather = twiml.gather({
        input:              'speech',
        action:             resumeToUrl,
        method:             'POST',
        actionOnEmptyResult: true,
        timeout:            7,
        speechTimeout: _speechTimeout(company),
        speechModel:        'phone_call',
      });
      fallbackGather.pause({ length: 1 });
      return res.type('text/xml').send(twiml.toString());
    }

    const hc            = holdState.holdConfig || {};
    const checkInCount  = holdState.checkInCount || 0;
    const resumeWords   = (hc.resumeKeywords || []).map(w => w.toLowerCase().trim());
    const maxCheckins   = LAPService.MAX_HOLD_CHECKINS || 3;

    // ── 2. Detect resume condition ─────────────────────────────────────────
    const speechLower   = speechResult.toLowerCase();
    const hasResumeWord = resumeWords.some(w => speechLower.includes(w));
    const hasSpeech     = speechResult.length > 0;
    const forceResume   = checkInCount >= maxCheckins;

    if (hasResumeWord || hasSpeech || forceResume) {
      // ── RESUME: clear hold state, hand back to normal pipeline ─────────
      await LAPService.clearHoldState(companyId, callSid);

      const reason = forceResume ? 'max_checkins' : hasResumeWord ? 'resume_word' : 'speech_detected';
      logger.info('[LAP HOLD] ✅ Resuming call', {
        companyId, callSid: callSid?.slice(-8), reason, checkInCount
      });

      twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML("Great — I'm ready when you are."));
      const resumeGather = twiml.gather({
        input:              'speech',
        action:             resumeToUrl,
        method:             'POST',
        actionOnEmptyResult: true,
        timeout:            7,
        speechTimeout: _speechTimeout(company),
        speechModel:        'phone_call',
      });
      resumeGather.pause({ length: 1 });
      return res.type('text/xml').send(twiml.toString());
    }

    // ── 3. Dead air / timeout — play check-in prompt, loop back ───────────
    const newCount = await LAPService.incrementHoldCheckIn(companyId, callSid);
    const prompt   = (hc.deadAirPrompt || '').trim()
                     || 'Take your time — let me know when you are ready to continue.';

    logger.info('[LAP HOLD] Dead air check-in', {
      companyId, callSid: callSid?.slice(-8), checkInCount: newCount
    });

    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(prompt));
    const loopGather = twiml.gather({
      input:              'speech',
      action:             holdLoopUrl,
      method:             'POST',
      actionOnEmptyResult: true,
      timeout:            hc.deadAirCheckSeconds || 8,
      speechTimeout: _speechTimeout(company),
      speechModel:        'phone_call',
    });
    loopGather.pause({ length: 1 });

  } catch (err) {
    // Graceful degrade on any error — resume the call
    logger.warn('[LAP HOLD] Error — force resuming', {
      companyId, callSid: callSid?.slice(-8), error: err.message
    });
    await LAPService.clearHoldState(companyId, callSid).catch(() => {});
    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML("Sorry about that — let's continue."));
    const errGather = twiml.gather({
      input:              'speech',
      action:             resumeToUrl,
      method:             'POST',
      actionOnEmptyResult: true,
      timeout:            7,
      speechTimeout: _speechTimeout(company),
      speechModel:        'phone_call',
    });
    errGather.pause({ length: 1 });
  }

  res.type('text/xml').send(twiml.toString());
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

    // V-FIX: Hoist voice settings so all bridge paths can attempt ElevenLabs
    const hostHeader = req.get('host');
    const voiceSettings = company?.aiAgentSettings?.voiceSettings || {};
    const elevenLabsVoice = voiceSettings.voiceId || null;

    /**
     * Attempt bounded synthesis for bridge delivery paths.
     * Returns a descriptor for the caller to act on:
     *   { kind: 'play', url }   — caller does .play(url)
     *   { kind: 'say', voice, text } — caller does .say({voice}, text)
     *   null                    — synthesis failed (caller falls back)
     *
     * C3 Apr 2026: Routes through TTSProviderRouter so tenant provider is
     * respected. Polly tenants get a 'say' descriptor (no buffer to disk).
     */
    async function synthesizeForBridge(text, { timeoutMs = 4000 } = {}) {
      if (!text) return null;
      try {
        const tts = await Promise.race([
          TTSProviderRouter.synthesize({
            text,
            company,
            callSid,
            ttsSource: 'bridge_primary'
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('BRIDGE_TTS_TIMEOUT')), timeoutMs))
        ]);
        if (tts.kind === 'buffer') {
          const fileName = `bridge_synth_${callSid}_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
          const bridgeSynthPath = path.join(audioDir, fileName);
          await fs.promises.writeFile(bridgeSynthPath, tts.audio);
          scheduleTempAudioDelete(bridgeSynthPath);
          return { kind: 'play', url: `https://${hostHeader}/audio/${fileName}`, sourceProvider: tts.sourceProvider };
        } else {
          // Polly path — caller emits Say with tenant's chosen voice
          return { kind: 'say', voice: tts.voice, text, sourceProvider: tts.sourceProvider, fallbackReason: tts.fallbackReason || null };
        }
      } catch (err) {
        logger.warn('[V2 BRIDGE CONTINUE] synthesizeForBridge failed', {
          callSid: callSid?.slice(-8),
          textLen: text?.length,
          error: err.message
        });
        return null;
      }
    }

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
      // hostHeader, voiceSettings, elevenLabsVoice hoisted above (V-FIX)
      const twiml = new twilio.twiml.VoiceResponse();
      const _mt_cached = {};

      if (cached.audioUrl) {
        twiml.play(cached.audioUrl);
      } else if (cached.responseText) {
        // C3 Apr 2026: Route through TTSProviderRouter — Polly tenants get
        // {kind:'say'} descriptor and we emit Twilio Say with their voice.
        const synthRes = await synthesizeForBridge(cached.responseText);
        if (synthRes && synthRes.kind === 'play') {
          twiml.play(synthRes.url);
          voiceProviderUsed = 'elevenlabs';
        } else if (synthRes && synthRes.kind === 'say') {
          twiml.say({ voice: synthRes.voice }, escapeTwiML(cached.responseText, _mt_cached));
          voiceProviderUsed = synthRes.fallbackReason ? 'polly_fallback' : 'polly';
        } else {
          // Synthesis failed entirely — last-resort tenant Polly Say
          twiml.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(cached.responseText, _mt_cached));
          voiceProviderUsed = 'polly_fallback';
        }
      } else {
        const playUrlMatch = cached.twimlString.match(/<Play[^>]*>([^<]+)<\/Play>/);
        const sayMatch = cached.twimlString.match(/<Say[^>]*>([^<]+)<\/Say>/);
        if (playUrlMatch) {
          twiml.play(playUrlMatch[1]);
        } else if (sayMatch) {
          // C3 Apr 2026: Route through TTSProviderRouter
          const synthRes = await synthesizeForBridge(sayMatch[1]);
          if (synthRes && synthRes.kind === 'play') {
            twiml.play(synthRes.url);
            voiceProviderUsed = 'elevenlabs';
          } else if (synthRes && synthRes.kind === 'say') {
            twiml.say({ voice: synthRes.voice }, sayMatch[1]);
            voiceProviderUsed = synthRes.fallbackReason ? 'polly_fallback' : 'polly';
          } else {
            twiml.say({ voice: getPollyFallbackVoice(company) }, sayMatch[1]);
            voiceProviderUsed = 'polly_fallback';
          }
        } else {
          twimlString = cached.twimlString;
          res.type('text/xml');
          return res.send(twimlString);
        }
      }
      
      // ── ACTUAL DELIVERY: record what the caller will actually hear ──────
      if (callSid) {
        try {
          const intended = cached.responseText || cached.agentTurn?.text || '';
          const actual = _mt_cached.fired ? SAFE_FALLBACK : intended;
          const verb = (cached.audioUrl || voiceProviderUsed === 'elevenlabs') ? 'PLAY' : 'SAY';
          const CallTranscriptV2_ad = require('../models/CallTranscriptV2');
          await CallTranscriptV2_ad.appendTurns(companyID, callSid, [{
            speaker: 'system',
            kind: 'ACTUAL_DELIVERY',
            text: actual,
            turnNumber,
            ts: new Date(),
            sourceKey: 'actual_delivery',
            trace: {
              bridgePath: 'cached_result',
              voiceProvider: voiceProviderUsed,
              twimlVerb: verb,
              intended: intended.substring(0, 300),
              mismatch: actual !== intended,
              sanitizerReason: _mt_cached.reason || null
            }
          }]);
        } catch (_) {}
      }

      const _sdCached = _getSpeechDetection(company);
      const listenUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-listen/${companyID}`
        + `?st=${encodeURIComponent(_speechTimeout(company))}`
        + `&bi=${_sdCached.bargeIn ? '1' : '0'}`
        + `&en=${_sdCached.enhancedRecognition !== false ? '1' : '0'}`
        + `&sm=${encodeURIComponent(_sdCached.speechModel || 'phone_call')}`;
      twiml.redirect({ method: 'POST' }, listenUrl);

      twimlString = twiml.toString();

      // V-FIX: Voice decision audit log for bridge-continue cached result
      logVoiceDecision(CallLogger, {
        callSid, companyId: companyID, turnNumber,
        decision: {
          responseSource: 'BRIDGE_RESULT',
          desiredProvider: elevenLabsVoice ? 'elevenlabs' : 'twilio',
          audioUrlPresent: !!cached.audioUrl,
          audioUrlPreflightPassed: cached.audioUrl ? true : null,
          elevenLabsAttempted: !cached.audioUrl && !!elevenLabsVoice,
          elevenLabsSuccess: voiceProviderUsed === 'elevenlabs',
          finalTwimlVerb: twimlString.includes('<Play') ? 'PLAY' : 'SAY',
          fallbackReasonCode: voiceProviderUsed === 'twilio_say' ? 'BRIDGE_RESULT_NO_AUDIOURL' : 'NONE'
        }
      });

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

    // ═══════════════════════════════════════════════════════════════════════════
    // STAGED BRIDGE CONTROL UNIT (replaces old timer-based cap logic)
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // ARCHITECTURE (agreed design — bridge timing overhaul):
    //   T2 dispatches immediately on route decision.
    //   Bridge is optional and reactive — heartbeat governs, not elapsed time.
    //
    //   0–500ms:  Silent quiet window (no audio to caller)
    //   500ms:    First Redis check — deliver if ready
    //   Not ready: Short hold messages (1–1.5s each, ElevenLabs cached audio)
    //   Heartbeat alive: Keep cycling hold messages
    //   Heartbeat silent 5s: Declare stall → recover
    //   15s ceiling: Emergency-only safety stop
    //
    // THREE SEPARATE TIMING CONCEPTS (never blended):
    //   A. LLM dispatch timing → immediate (handled in v2-agent-respond)
    //   B. Bridge onset timing → immediate hold phrase on first poll (no dead-air pause)
    //   C. T2 death detection → heartbeat silence threshold, NOT raw elapsed time
    //
    // WHAT WAS KILLED:
    //   - hardCapMs as a decision-maker (removed from schema V132)
    //   - maxRedirectAttempts as a cap (was cutting live responses)
    //   - Twilio <Say> for hold lines (now uses BridgeAudioService cached audio)
    //   - Attempt-1 silent pause (bridgeQuietWindowMs) — was always 1s due to Twilio floor
    //   - postBridgePauseMs — Math.round(150ms/1000)=0, condition never fired
    //
    // ═══════════════════════════════════════════════════════════════════════════
    const maxCeilingMs = Number.isFinite(bridgeCfg.maxCeilingMs) ? bridgeCfg.maxCeilingMs : 15000;
    const heartbeatSilenceMs = Number.isFinite(bridgeCfg.heartbeatSilenceMs) ? bridgeCfg.heartbeatSilenceMs : 5000;
    const heartbeatCyclingEnabled = bridgeCfg.heartbeatCyclingEnabled !== false;

    // ── Check streaming heartbeat ───────────────────────────────────────────
    let heartbeatAlive = false;
    let heartbeatData = null;
    if (redis && callSid && token && heartbeatCyclingEnabled) {
      try {
        const hbKey = heartbeatKey(callSid, turnNumber, token);
        const raw = await redis.get(hbKey);
        if (raw) {
          heartbeatData = JSON.parse(raw);
          heartbeatAlive = (Date.now() - heartbeatData.ts) < heartbeatSilenceMs;
        }
      } catch (_) {
        // Heartbeat read failure = assume not alive (safe default)
      }
    }

    // ── Check for streaming result (fast path — deliver immediately) ────────
    let streamingResult = null;
    if (redis && callSid && token) {
      try {
        const rKey = resultKey(callSid, turnNumber, token);
        const raw = await redis.get(rKey);
        if (raw && raw.length > 0) {
          streamingResult = raw;
        }
      } catch (_) {
        // Non-fatal
      }
    }

    // ── FAST PATH: Streaming result ready → deliver immediately ─────────────
    if (streamingResult && !cached?.twimlString) {
      const twiml = new twilio.twiml.VoiceResponse();
      const _mt_stream = {};

      // ── Sanitizer gate: block structured LLM output from reaching ElevenLabs ──
      // skipResultKey=true means intake raw JSON/YAML should never be in this key.
      // But as defense-in-depth, sanitizeForSpeech catches any leak (responseText:,
      // extraction:, firstName: patterns) BEFORE they reach ElevenLabs synthesis.
      // If the sanitizer fires, use a neutral bridge phrase rather than SAFE_FALLBACK
      // (caller has already spoken — a cold generic greeting would be jarring).
      const _mt_sanity = {};
      const safeStreamingResult = sanitizeForSpeech(streamingResult, { _trap: _mt_sanity });
      const deliverText = (_mt_sanity.fired)
        ? 'One moment, let me pull that up for you.'
        : safeStreamingResult;

      // Strip markdown (e.g. *italic*, **bold**) from LLM responses before ElevenLabs
      // synthesis. Every other TTS path runs cleanTextForTTS — streaming_fast must too.
      const deliverTextClean = cleanTextForTTS(deliverText);

      // Dynamic timeout: flat 4 s is too short for long LLM answers (~95+ words).
      // Scale at 15 ms/char — Turn 2 (~560 chars) gets ~8.4 s instead of 4 s.
      const elBridgeTimeoutMs = Math.min(Math.max(5000, deliverTextClean.length * 15), 15000);

      // C3 Apr 2026: Route through TTSProviderRouter — Polly tenants get
      // {kind:'say'} descriptor and we emit Twilio Say with their chosen voice.
      const synthRes = await synthesizeForBridge(deliverTextClean, { timeoutMs: elBridgeTimeoutMs });
      if (synthRes && synthRes.kind === 'play') {
        twiml.play(synthRes.url);
        voiceProviderUsed = 'elevenlabs';
      } else if (synthRes && synthRes.kind === 'say') {
        twiml.say({ voice: synthRes.voice }, escapeTwiML(deliverTextClean, _mt_stream));
        voiceProviderUsed = synthRes.fallbackReason ? 'polly_fallback' : 'polly';
      } else {
        twiml.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(deliverTextClean, _mt_stream));
        voiceProviderUsed = 'polly_fallback';
      }

      // ── ACTUAL DELIVERY: record what the caller will actually hear ──────
      if (callSid) {
        try {
          const intended = streamingResult;
          const actual = _mt_stream.fired ? SAFE_FALLBACK : deliverText;
          const verb = voiceProviderUsed === 'elevenlabs' ? 'PLAY' : 'SAY';
          const CallTranscriptV2_ad = require('../models/CallTranscriptV2');
          await CallTranscriptV2_ad.appendTurns(companyID, callSid, [{
            speaker: 'system',
            kind: 'ACTUAL_DELIVERY',
            text: actual,
            turnNumber,
            ts: new Date(),
            sourceKey: 'actual_delivery',
            trace: {
              bridgePath: 'streaming_fast',
              voiceProvider: voiceProviderUsed,
              twimlVerb: verb,
              intended: intended.substring(0, 300),
              mismatch: actual !== intended,
              sanitizerReason: _mt_stream.reason || _mt_sanity.reason || null,
              sanitizerIntercept: _mt_sanity.fired || false,
            }
          }]);
        } catch (_) {}
      }

      const _sdStream = _getSpeechDetection(company);
      const listenUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-listen/${companyID}`
        + `?st=${encodeURIComponent(_speechTimeout(company))}`
        + `&bi=${_sdStream.bargeIn ? '1' : '0'}`
        + `&en=${_sdStream.enhancedRecognition !== false ? '1' : '0'}`
        + `&sm=${encodeURIComponent(_sdStream.speechModel || 'phone_call')}`;
      twiml.redirect({ method: 'POST' }, listenUrl);
      twimlString = twiml.toString();

      if (CallLogger && callSid) {
        await CallLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'AGENT2_BRIDGE_STREAMING_RESULT',
          turn: turnNumber,
          data: {
            resultLength: streamingResult.length,
            heartbeatAlive,
            heartbeatTokens: heartbeatData?.tokens || 0,
            elapsedMs,
            attempt,
            deliveryPath: 'streaming_fast_path',
          }
        }).catch(() => {});
      }

      logVoiceDecision(CallLogger, {
        callSid, companyId: companyID, turnNumber,
        decision: {
          responseSource: 'BRIDGE_STREAMING',
          desiredProvider: elevenLabsVoice ? 'elevenlabs' : 'twilio',
          audioUrlPresent: false,
          elevenLabsAttempted: !!elevenLabsVoice,
          elevenLabsSuccess: voiceProviderUsed === 'elevenlabs',
          finalTwimlVerb: voiceProviderUsed === 'elevenlabs' ? 'PLAY' : 'SAY',
          fallbackReasonCode: voiceProviderUsed === 'twilio_say' ? 'BRIDGE_STREAMING_TTS_FAILED' : 'NONE'
        }
      });

      res.type('text/xml');
      return res.send(twimlString);
    }

    // ── RECOVERY DECISION: heartbeat-governed, not timer-governed ────────────
    //
    // Decision matrix:
    //   1. ceiling hit (15s)         → ALWAYS recover (emergency stop)
    //   2. compute error             → ALWAYS recover (nothing to wait for)
    //   3. heartbeat dead (5s silent)→ recover (T2 stalled)
    //   4. heartbeat alive           → KEEP WAITING (T2 is working)
    //   5. no heartbeat data yet     → keep waiting if within quiet window
    //
    // NOTE: maxRedirectAttempts is INTENTIONALLY not used here.
    // They were the old "dumb timer" that cut live responses. Heartbeat decides.
    // ─────────────────────────────────────────────────────────────────────────
    const ceilingHit = typeof elapsedMs === 'number' && elapsedMs >= maxCeilingMs;
    const heartbeatStalled = heartbeatData && !heartbeatAlive; // had heartbeat, now silent
    const shouldRecover = ceilingHit || cached?.error || heartbeatStalled;

    if (shouldRecover) {
      // ── Before falling back, check for partial response ─────────────────
      let partialText = null;
      if (redis && callSid && token) {
        try {
          const pKey = partialKey(callSid, turnNumber, token);
          const raw = await redis.get(pKey);
          if (raw && raw.length >= 40) {
            partialText = raw;
          }
        } catch (_) { /* non-fatal */ }
      }

      // Determine specific fallback reason for observability
      const fallbackReason = cached?.error
        ? 'bridge_compute_failed'
        : ceilingHit
          ? 'bridge_ceiling_hit'
          : 'bridge_heartbeat_dead';

      if (CallLogger && callSid) {
        await CallLogger.logEvent({
          callId: callSid,
          companyId: companyID,
          type: 'AGENT2_BRIDGE_TIMEOUT',
          turn: turnNumber,
          data: {
            attempt,
            maxCeilingMs,
            heartbeatSilenceMs,
            elapsedMs,
            fallbackReason,
            heartbeatAlive,
            heartbeatTokens: heartbeatData?.tokens || 0,
            heartbeatStatus: heartbeatData?.status || null,
            heartbeatAge: heartbeatData ? (Date.now() - heartbeatData.ts) : null,
            hasPartial: !!partialText,
            partialChars: partialText?.length || 0,
            error: cached?.error || null
          }
        }).catch(() => {});
      }

      // ── If we have a usable partial response, deliver it ──────────────
      if (partialText) {
        const twiml = new twilio.twiml.VoiceResponse();
        const _mt_partial = {};

        // C3 Apr 2026: Route through TTSProviderRouter
        const synthRes = await synthesizeForBridge(partialText);
        if (synthRes && synthRes.kind === 'play') {
          twiml.play(synthRes.url);
          voiceProviderUsed = 'elevenlabs';
        } else if (synthRes && synthRes.kind === 'say') {
          twiml.say({ voice: synthRes.voice }, escapeTwiML(partialText, _mt_partial));
          voiceProviderUsed = synthRes.fallbackReason ? 'polly_fallback' : 'polly';
        } else {
          twiml.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(partialText, _mt_partial));
          voiceProviderUsed = 'polly_fallback';
        }

        // ── ACTUAL DELIVERY: record what the caller will actually hear ──────
        if (callSid) {
          try {
            const intended = partialText;
            const actual = _mt_partial.fired ? SAFE_FALLBACK : intended;
            const verb = voiceProviderUsed === 'elevenlabs' ? 'PLAY' : 'SAY';
            const CallTranscriptV2_ad = require('../models/CallTranscriptV2');
            await CallTranscriptV2_ad.appendTurns(companyID, callSid, [{
              speaker: 'system',
              kind: 'ACTUAL_DELIVERY',
              text: actual,
              turnNumber,
              ts: new Date(),
              sourceKey: 'actual_delivery',
              trace: {
                bridgePath: 'recovery_partial',
                voiceProvider: voiceProviderUsed,
                twimlVerb: verb,
                intended: intended.substring(0, 300),
                mismatch: actual !== intended,
                sanitizerReason: _mt_partial.reason || null
              }
            }]);
          } catch (_) {}
        }

        const _sdPartial = _getSpeechDetection(company);
        const listenUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-listen/${companyID}`
          + `?st=${encodeURIComponent(_speechTimeout(company))}`
          + `&bi=${_sdPartial.bargeIn ? '1' : '0'}`
          + `&en=${_sdPartial.enhancedRecognition !== false ? '1' : '0'}`
          + `&sm=${encodeURIComponent(_sdPartial.speechModel || 'phone_call')}`;
        twiml.redirect({ method: 'POST' }, listenUrl);
        twimlString = twiml.toString();

        if (callSid) {
          try {
            const CallTranscriptV2 = require('../models/CallTranscriptV2');
            await CallTranscriptV2.appendTurns(companyID, callSid, [
              {
                speaker: 'agent',
                kind: 'CONVERSATION_AGENT',
                text: partialText,
                turnNumber,
                ts: new Date(),
                sourceKey: 'AGENT2_BRIDGE_PARTIAL',
                trace: {
                  provenance: {
                    type: 'LLM_PARTIAL',
                    reason: fallbackReason,
                    voiceProviderUsed,
                    isBridge: true,
                  },
                  deliveredVia: 'bridge_partial_response',
                  attempt,
                  elapsedMs,
                  heartbeatTokens: heartbeatData?.tokens || 0,
                }
              }
            ]);
          } catch (v2Err) {
            logger.warn('[V2 BRIDGE CONTINUE] Failed to append partial turn to CallTranscriptV2', {
              callSid: callSid?.slice(-8),
              error: v2Err.message
            });
          }
        }

        logVoiceDecision(CallLogger, {
          callSid, companyId: companyID, turnNumber,
          decision: {
            responseSource: 'BRIDGE_PARTIAL',
            desiredProvider: elevenLabsVoice ? 'elevenlabs' : 'twilio',
            audioUrlPresent: false,
            elevenLabsAttempted: !!elevenLabsVoice,
            elevenLabsSuccess: voiceProviderUsed === 'elevenlabs',
            finalTwimlVerb: voiceProviderUsed === 'elevenlabs' ? 'PLAY' : 'SAY',
            fallbackReasonCode: voiceProviderUsed === 'twilio_say' ? 'BRIDGE_PARTIAL_TTS_FAILED' : 'NONE'
          }
        });

        res.type('text/xml');
        return res.send(twimlString);
      }

      // ── No partial: fall back to T3 pathway (Gather for next input) ───
      const twiml = new twilio.twiml.VoiceResponse();
      const fallbackText = "I'm sorry about the wait. Could you tell me a bit more about what you need help with?";

      // C3 Apr 2026: Cache lookup gated by provider — Polly tenants skip
      // the EL-cached audio entirely (it's the wrong voice for their call).
      const BridgeAudioServiceT3 = require('../services/bridgeAudio/BridgeAudioService');
      const _isElPrimaryT3 = getPrimaryProvider(company) === 'elevenlabs';
      const t3AudioUrl = _isElPrimaryT3 ? BridgeAudioServiceT3.getAudioUrl({
        companyId: companyID,
        text: fallbackText,
        voiceSettings,
        hostHeader
      }) : null;

      let t3PlayUrl = t3AudioUrl || null;     // URL string (cached EL audio)
      let t3SynthRes = null;                   // descriptor from synthesizeForBridge
      if (!t3PlayUrl) {
        t3SynthRes = await synthesizeForBridge(fallbackText, { timeoutMs: 3000 });
        if (t3SynthRes && t3SynthRes.kind === 'play') t3PlayUrl = t3SynthRes.url;
      }

      const gather = twiml.gather({
        input: 'speech',
        action: `${getSecureBaseUrl(req)}/api/twilio/v2-agent-respond/${companyID}`,
        method: 'POST',
        timeout: 5,
        speechTimeout: _speechTimeout(company),
        actionOnEmptyResult: false,
      });

      if (t3PlayUrl) {
        gather.play(t3PlayUrl);
        voiceProviderUsed = t3AudioUrl ? 'elevenlabs_cached' : 'elevenlabs';
      } else if (t3SynthRes && t3SynthRes.kind === 'say') {
        gather.say({ voice: t3SynthRes.voice }, escapeTwiML(fallbackText));
        voiceProviderUsed = t3SynthRes.fallbackReason ? 'polly_fallback' : 'polly';
      } else {
        gather.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(fallbackText));
        voiceProviderUsed = 'polly_fallback';
      }
      twimlString = twiml.toString();

      if (callSid) {
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          await CallTranscriptV2.appendTurns(companyID, callSid, [
            {
              speaker: 'agent',
              kind: 'CONVERSATION_AGENT',
              text: fallbackText,
              turnNumber,
              ts: new Date(),
              sourceKey: 'AGENT2_BRIDGE_TIMEOUT',
              trace: {
                provenance: {
                  type: 'T3_BRIDGE_FALLBACK',
                  uiPath: 'aiAgentSettings.agent2.bridge',
                  reason: fallbackReason,
                  voiceProviderUsed,
                  isBridge: true
                },
                deliveredVia: 'bridge_t3_fallback',
                attempt,
                elapsedMs,
                heartbeatAlive,
                error: cached?.error || null
              }
            }
          ]);
        } catch (v2Err) {
          logger.warn('[V2 BRIDGE CONTINUE] Failed to append T3 fallback turn to CallTranscriptV2', {
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
            isFallback: true,
            fallbackReason,
            bridge: { attempt, elapsedMs, heartbeatAlive }
          }
        }).catch(() => {});
      }

      logVoiceDecision(CallLogger, {
        callSid, companyId: companyID, turnNumber,
        decision: {
          responseSource: 'T3_FALLBACK',
          desiredProvider: elevenLabsVoice ? 'elevenlabs' : 'twilio',
          audioUrlPresent: false,
          elevenLabsAttempted: !!(elevenLabsVoice && voiceProviderUsed !== 'elevenlabs_cached'),
          elevenLabsSuccess: voiceProviderUsed === 'elevenlabs' || voiceProviderUsed === 'elevenlabs_cached',
          finalTwimlVerb: twimlString.includes('<Play') ? 'PLAY' : 'SAY',
          fallbackReasonCode: voiceProviderUsed === 'twilio_say' ? 'FINAL_FALLBACK_TWILIO_SAY' : 'NONE'
        }
      });

      res.type('text/xml');
      return res.send(twimlString);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HOLD MESSAGE: T2 still working — play cached bridge phrase immediately
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Every poll (attempt 1, 2, 3...) plays a bridge phrase right away.
    // No silent pause on attempt 1 — the old "quiet window" was always rounded
    // up to 1 second by Twilio's floor, adding 1s of dead air on every bridge.
    //
    //   - ElevenLabs cached audio (consistent voice) — cycles through lines
    //   - Falls back to <Pause> on cache miss if ElevenLabs configured
    //   - Falls back to <Say> for non-ElevenLabs companies
    //
    // No redirect attempt cap — heartbeat governs, ceiling is the hard stop.
    // ═══════════════════════════════════════════════════════════════════════════
    const redirectUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-bridge-continue/${companyID}?turn=${turnNumber}&token=${encodeURIComponent(token)}&attempt=${attempt}`;
    const twiml = new twilio.twiml.VoiceResponse();

    // ── HOLD MESSAGE: short ElevenLabs cached audio ───────────────────────────
    // Determine which bridge phrase to use based on call lane context
    const bridgeContext = req.body?.bridgeContext || 'thinking'; // thinking | booking | transfer
    let lanePhrase = null;
    if (bridgeContext === 'booking' && bridgeCfg.bookingBridgePhrase) {
      lanePhrase = bridgeCfg.bookingBridgePhrase;
    } else if (bridgeContext === 'transfer' && bridgeCfg.transferBridgePhrase) {
      lanePhrase = bridgeCfg.transferBridgePhrase;
    }

    const bridgeLines = bridgeCfg.lines || ['One moment please.'];
    const usableLines = bridgeLines.filter(l => l && l.trim());
    const lineIdx = (attempt - 1) % (usableLines.length || 1);
    const holdLine = lanePhrase || usableLines[lineIdx] || 'One moment please.';

    // Use BridgeAudioService cached ElevenLabs audio; never <Say> for ElevenLabs companies.
    // Apr 2026: Polly-primary tenants skip the EL cache entirely → always Say with their voice.
    const BridgeAudioService = require('../services/bridgeAudio/BridgeAudioService');
    const _isElPrimaryBridge = getPrimaryProvider(company) === 'elevenlabs';
    const holdAudioUrl = _isElPrimaryBridge ? BridgeAudioService.getAudioUrl({
      companyId: companyID,
      text: holdLine,
      voiceSettings,
      hostHeader
    }) : null;

    if (holdAudioUrl) {
      twiml.play(holdAudioUrl);
      voiceProviderUsed = 'elevenlabs_cached';
    } else if (_isElPrimaryBridge && elevenLabsVoice) {
      // Cache miss but ElevenLabs configured — silence is better than wrong voice
      logger.warn('[V2 BRIDGE CONTINUE] No cached bridge audio — using <Pause>', {
        callSid: callSid?.slice(-8),
        companyId: companyID,
        holdLine: holdLine.substring(0, 60),
        attempt,
      });
      twiml.pause({ length: 1 });
      voiceProviderUsed = 'silence';
    } else {
      // Either Polly primary OR no ElevenLabs configured —
      // <Say> with the tenant's chosen Polly voice.
      twiml.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(holdLine));
      voiceProviderUsed = _isElPrimaryBridge ? 'twilio_say' : 'polly';
    }

    // CRITICAL: method=POST so CallSid stays in request body (safe state correlation)
    twiml.redirect({ method: 'POST' }, redirectUrl);
    twimlString = twiml.toString();

    logVoiceDecision(CallLogger, {
      callSid, companyId: companyID, turnNumber,
      decision: {
        responseSource: 'BRIDGE_HOLD',
        desiredProvider: elevenLabsVoice ? 'elevenlabs' : 'twilio',
        audioUrlPresent: false,
        elevenLabsAttempted: false,
        elevenLabsSuccess: voiceProviderUsed === 'elevenlabs_cached',
        finalTwimlVerb: voiceProviderUsed === 'elevenlabs_cached' ? 'PLAY'
          : voiceProviderUsed === 'silence' ? 'PAUSE' : 'SAY',
        fallbackReasonCode: voiceProviderUsed === 'twilio_say' ? 'BRIDGE_HOLD_TWILIO_SAY'
          : voiceProviderUsed === 'silence' ? 'BRIDGE_HOLD_CACHE_MISS' : 'NONE'
      }
    });

    res.type('text/xml');
    return res.send(twimlString);
  } catch (error) {
    logger.error('[V2 BRIDGE CONTINUE] Route crashed', {
      callSid,
      companyID,
      error: error.message
    });
    // CRASH RECOVERY: UI-configured generalError message + Gather so the call continues.
    const crashText = (company ? await getRecoveryMessage(company, 'generalError').catch(() => null) : null)
      || 'I apologize for the interruption. Please go ahead.';
    const _bridgeCrashSd = _getSpeechDetection(company);
    const twiml = new twilio.twiml.VoiceResponse();
    const crashGather = twiml.gather({
      input: 'speech',
      action: `/api/twilio/v2-agent-respond/${companyID}`,
      method: 'POST',
      actionOnEmptyResult: true,
      timeout: _bridgeCrashSd.initialTimeout ?? 7,
      speechTimeout: _speechTimeout(company),
    });
    crashGather.say({ voice: TWILIO_FALLBACK_VOICE }, crashText);
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
// SENTENCE-CONTINUE ENDPOINT — Sentence-by-sentence TTS streaming
// ═══════════════════════════════════════════════════════════════════════════
// Called by Twilio after each sentence plays. Serves the next sentence.
//
// Flow:
//   s0 plays (served by v2-agent-respond firstSentence path)
//     → <Redirect /v2-agent-sentence-continue?idx=1>
//   s1 synthesized → plays → <Redirect ...?idx=2>
//   ...until no more sentences → final <Gather> to listen for caller
//
// Edge cases:
//   - LLM full result ready → serve remaining sentences batched
//   - Next sentence not yet synthesized → brief poll + self-redirect
//   - Total sentences exceeded cap (10) → finalize
// ═══════════════════════════════════════════════════════════════════════════
router.post('/v2-agent-sentence-continue/:companyID', async (req, res) => {
  const companyID = req.params.companyID;
  const turn      = parseInt(req.query.turn || '0', 10);
  const token     = req.query.token || '';
  const idx       = parseInt(req.query.idx || '1', 10);
  const callSid   = req.query.callSid || req.body?.CallSid || '';
  const attempt   = parseInt(req.query.attempt || '0', 10);

  const MAX_SENTENCES  = 10;
  const MAX_POLL_TRIES = 6;   // 6 × 1s Twilio pause = 6s max wait for next sentence

  res.type('text/xml');

  try {
    const redis = await getRedis();

    // ── Read gather config saved by v2-agent-respond ──────────────────────
    const gatherConfigRaw = redis ? await redis.get(`a2sentence:gather:${callSid}:${turn}`).catch(() => null) : null;
    const gatherCfg       = gatherConfigRaw ? JSON.parse(gatherConfigRaw) : null;
    const hostHeader      = gatherCfg?.hostHeader || req.get('host') || '';
    const voiceId         = gatherCfg?.voiceId || null;
    const voiceSettings   = gatherCfg?.voiceSettings || {};

    // ── Helper: build final <Gather> TwiML to listen for caller ──────────
    const buildFinalGather = (extraAudioUrl = null) => {
      const twiml  = new twilio.twiml.VoiceResponse();
      const gather = twiml.gather({
        input:                    'speech',
        action:                   gatherCfg?.action || `/api/twilio/v2-agent-respond/${companyID}`,
        method:                   'POST',
        actionOnEmptyResult:      true,
        timeout:                  gatherCfg?.timeout ?? 7,
        speechTimeout:            gatherCfg?.speechTimeout ?? _speechTimeout(company),
        bargeIn:                  gatherCfg?.bargeIn ?? false,
        enhanced:                 gatherCfg?.enhanced ?? true,
        speechModel:              gatherCfg?.speechModel || 'phone_call',
        partialResultCallback:    `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`,
        partialResultCallbackMethod: 'POST',
      });
      if (extraAudioUrl) gather.play(extraAudioUrl);
      return twiml.toString();
    };

    // ── Safety cap: too many sentences or no redis → finalize ────────────
    if (idx >= MAX_SENTENCES || !redis || !callSid) {
      return res.send(buildFinalGather());
    }

    // ── Check if full LLM result is already in Redis ──────────────────────
    // If the full result key exists (set by SentenceStreamingService),
    // all sentences are done — serve any remaining and finalize.
    const fullResultKey = resultKey(callSid, turn, token);
    const fullResult    = redis ? await redis.get(fullResultKey).catch(() => null) : null;

    // ── Read next sentence audio URL ──────────────────────────────────────
    const sAudioKey = `a2sentence:audio:${callSid}:${turn}:${idx}`;
    let   sAudioUrl = redis ? await redis.get(sAudioKey).catch(() => null) : null;

    // ── If audio not ready yet, poll briefly ─────────────────────────────
    let sSayPolly = null; // set when provider is Polly — emit Say with sentence text
    if (!sAudioUrl && attempt < MAX_POLL_TRIES) {
      // Check if sentence text exists (being synthesized)
      const sTextKey  = `a2sentence:${callSid}:${turn}:${idx}`;
      const sText     = redis ? await redis.get(sTextKey).catch(() => null) : null;

      if (sText) {
        // Load company to determine provider
        const company = await require('../models/v2Company').findById(companyID).lean();

        // C3 Apr 2026: Route through TTSProviderRouter. If Polly primary OR
        // EL falls back to Polly, the descriptor's `voice` lets us emit Say
        // directly — no file write, no Redis URL. Faster + correct.
        try {
          const tts = await TTSProviderRouter.synthesize({
            text:    sText,
            company,
            callSid,
            ttsSource: 'sentence_stream_seed'
          });
          if (tts.kind === 'buffer') {
            const sFile     = `s${idx}_${callSid}_${turn}_${Date.now()}.mp3`;
            const sFilePath = path.join(__dirname, '../public/audio', sFile);
            await fs.promises.writeFile(sFilePath, tts.audio);
            scheduleTempAudioDelete(sFilePath);
            sAudioUrl = `https://${hostHeader}/audio/${sFile}`;
            await redis.set(sAudioKey, sAudioUrl, { EX: 60 }).catch(() => {});
          } else {
            // Polly path — capture voice + sentence text for direct Say emission below
            sSayPolly = { voice: tts.voice, text: sText };
          }
        } catch (synthErr) {
          logger.warn('[SENTENCE_CONTINUE] Synthesis failed for idx=' + idx, { error: synthErr.message, callSid: callSid?.slice(-8) });
        }
      }

      if (!sAudioUrl && !sSayPolly) {
        // Not ready — self-redirect to poll again after brief pause
        const twiml    = new twilio.twiml.VoiceResponse();
        const nextTry  = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-sentence-continue/${companyID}?turn=${turn}&token=${encodeURIComponent(token)}&idx=${idx}&callSid=${encodeURIComponent(callSid)}&attempt=${attempt + 1}`;
        twiml.pause({ length: 1 });  // 1s pause before retry (Twilio minimum)
        twiml.redirect({ method: 'POST' }, nextTry);
        return res.send(twiml.toString());
      }
    }

    if (sAudioUrl || sSayPolly) {
      // Sentence ready — play (EL) or say (Polly), then redirect for next
      const twiml   = new twilio.twiml.VoiceResponse();
      const isLast  = !!fullResult && !(redis ? await redis.get(`a2sentence:${callSid}:${turn}:${idx + 1}`).catch(() => null) : null);

      // C3 Apr 2026: Helper to emit either Play or Say based on what we have
      const emitSentence = (target) => {
        if (sAudioUrl) {
          target.play(sAudioUrl);
        } else if (sSayPolly) {
          target.say({ voice: sSayPolly.voice }, escapeTwiML(sSayPolly.text));
        }
      };

      if (isLast) {
        // Last sentence — final gather
        const gather = twiml.gather({
          input:                    'speech',
          action:                   gatherCfg?.action || `/api/twilio/v2-agent-respond/${companyID}`,
          method:                   'POST',
          actionOnEmptyResult:      true,
          timeout:                  gatherCfg?.timeout ?? 7,
          speechTimeout:            gatherCfg?.speechTimeout ?? _speechTimeout(company),
          bargeIn:                  gatherCfg?.bargeIn ?? false,
          enhanced:                 gatherCfg?.enhanced ?? true,
          speechModel:              gatherCfg?.speechModel || 'phone_call',
          partialResultCallback:    `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`,
          partialResultCallbackMethod: 'POST',
        });
        emitSentence(gather);
      } else {
        const nextUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-sentence-continue/${companyID}?turn=${turn}&token=${encodeURIComponent(token)}&idx=${idx + 1}&callSid=${encodeURIComponent(callSid)}&attempt=0`;
        emitSentence(twiml);
        twiml.redirect({ method: 'POST' }, nextUrl);
      }
      return res.send(twiml.toString());
    }

    // Nothing ready and poll exhausted — finalize with gather
    return res.send(buildFinalGather());

  } catch (err) {
    logger.error('[SENTENCE_CONTINUE] Endpoint error', { error: err.message, callSid: callSid?.slice(-8) });
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.gather({
      input: 'speech',
      action: `/api/twilio/v2-agent-respond/${companyID}`,
      method: 'POST', actionOnEmptyResult: true, timeout: 7,
    });
    return res.send(twiml.toString());
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
    
    // Speech detection settings passed as query params by bridge-continue.
    // This avoids a DB read while still honouring admin-configured values.
    const _listenSt = req.query.st || '1.5';
    const _listenBi = req.query.bi === '1';
    const _listenEn = req.query.en !== '0';
    const _listenSm = req.query.sm || 'phone_call';

    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
      input: 'speech',
      action: `/api/twilio/v2-agent-respond/${companyID}`,
      method: 'POST',
      actionOnEmptyResult: true,
      timeout: 7,
      speechTimeout: _listenSt,
      bargeIn: _listenBi,
      enhanced: _listenEn,
      speechModel: _listenSm,
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
      speechTimeout: _speechTimeout(company)
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
  const sttConfidence = parseFloat(req.body.Confidence) || null;
  const turnCountFromBody = parseInt(req.body.turnCount || 0, 10) || 0;
  
  // ═══════════════════════════════════════════════════════════════════════
  // CHECKPOINT 6 & 7: CUSTOMER_SPEAKS + SPEECHRESULT_POSTED
  // ═══════════════════════════════════════════════════════════════════════
  emitFlowCheckpoint(CallLogger, callSid, companyID, turnCountFromBody + 1, {
    ...FLOW_STEPS.CUSTOMER_SPEAKS,
    status: speechResult ? 'FIRED' : 'SKIPPED',
    details: speechResult 
      ? `Customer spoke: "${speechResult.slice(0, 50)}${speechResult.length > 50 ? '...' : ''}"` 
      : 'No speech detected (silence/timeout)',
    data: {
      rawLength: speechResult?.length || 0,
      confidence: sttConfidence,
      hasContent: Boolean(speechResult && speechResult.trim())
    }
  });
  
  // Emit STT confidence and audio quality info to call console
  const confidencePercent = sttConfidence ? (sttConfidence * 100).toFixed(1) : 'N/A';
  const confidenceQuality = !sttConfidence ? 'unknown' :
                            sttConfidence >= 0.9 ? 'excellent' :
                            sttConfidence >= 0.7 ? 'good' :
                            sttConfidence >= 0.5 ? 'fair' : 'poor';
  
  emitFlowCheckpoint(CallLogger, callSid, companyID, turnCountFromBody + 1, {
    ...FLOW_STEPS.SPEECHRESULT,
    status: 'FIRED',
    details: `Twilio STT: ${confidencePercent}% confidence (${confidenceQuality}) - "${speechResult?.substring(0, 60) || 'empty'}"`,
    data: {
      speechResultLength: speechResult?.length || 0,
      confidence: sttConfidence,
      confidencePercent: confidencePercent,
      confidenceQuality: confidenceQuality,
      fromNumber: fromNumber?.slice(-4) || 'unknown',
      transcriptPreview: speechResult?.substring(0, 100) || '',
      audioQualityWarning: sttConfidence < 0.5 ? 'Poor audio quality or unclear speech detected' : null
    }
  });
  
  // ════════════════════════════════════════════════════════════════════════
  // 📼 CALL CONSOLE VISUAL TRACE - Deepgram STT Result Received
  // ════════════════════════════════════════════════════════════════════════
  if (CallLogger && speechResult) {
    try {
      CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'DEEPGRAM_STT_RESULT',
        turn: turnCountFromBody + 1,
        data: {
          rawTranscript: speechResult,
          confidence: sttConfidence,
          visualTrace: {
            icon: '🎧',
            stage: 'Deepgram STT',
            status: 'transcribed',
            details: `Speech-to-Text: "${speechResult.substring(0, 80)}${speechResult.length > 80 ? '...' : ''}"`,
            confidence: sttConfidence,
            note: 'Raw transcript from Deepgram (via Twilio) - sent to ScrabEngine for processing'
          }
        }
      }).catch(() => {});
    } catch (logErr) {
      // Non-blocking
    }
  }
  
  // Track for guaranteed TWIML_SENT logging
  let turnNumber = 0;
  let voiceProviderUsed = 'twilio_say';
  let twimlString = '';
  let routeError = null;
  let company = null;  // hoisted so catch block can reference it for UI-configured crashText

  try {
    // T1: Company load start
    const T1_start = Date.now();
    company = await Company.findById(companyID).lean();
    timings.companyLoadMs = Date.now() - T1_start;
    if (!company) {
      // CRITICAL: Company not found - cannot resolve UI config
      // Use system-level minimal safe response (not "repeat that" which frustrates callers)
      // 📌 STAGE 3 (R9/R10): Hardcoded string + Gather defaults below are INTENTIONAL last-resort
      //                      safety net. `company` is null here, so getRecoveryMessage() and
      //                      agent2.speechDetection are inaccessible. Nothing better is possible
      //                      at this code path — goal is to keep the call alive until the next
      //                      webhook (which may succeed if it was a transient Mongo error).
      logger.error('[V2TWILIO] Company not found - cannot load UI config', { companyID });
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({ voice: TWILIO_FALLBACK_VOICE }, "I can help you with that. One moment please.");
      twiml.gather({
        input: 'speech',
        action: `/api/twilio/v2-agent-respond/${companyID}`,
        method: 'POST',
        actionOnEmptyResult: true,
        timeout: 7,
        speechTimeout: _speechTimeout(company),
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
    //
    // 🧹 STAGE 3 (R11) TODO: This ~75-line block (Redis read → superset heuristic →
    //                        DEL cache) is a prime extraction target. Consolidate into
    //                        `_finalizeSpeechFromPartialCache(callSid, speechResult, redis)`
    //                        returning `{ text, sourceUsed, cacheCleared, cachedLen, error }`.
    //                        Keeps the main /v2-agent-respond handler focused on dispatch.
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
    // 🎧 LAP GATE — ListenerActParser
    // ═══════════════════════════════════════════════════════════════════════════
    // Fires on EVERY turn, EVERY objective state, before ConversationEngine,
    // KC, and BookingLogicEngine. Detects attention signals (connection distress,
    // hold requests, repeat requests) and returns recovery TwiML immediately.
    //
    // Global entries:  AdminSettings.lapEntries  (phrase-response table)
    // Audio:           LAPResponseAudio  (per-company, pre-cached)
    //
    // Voice: Pre-cached LAPResponseAudio → ElevenLabs live TTS → Polly fallback.
    // Logging: Both caller + agent turns written to CallTranscriptV2 so LAP
    //          intercepts appear in call intelligence.
    //
    // If no match → falls through to normal pipeline, zero overhead.
    // Any error     → graceful degrade, call continues normally.
    // ═══════════════════════════════════════════════════════════════════════════
    if (speechResult && company?.lapConfig?.enabled !== false) {
      try {
        const LAPService = require('../services/engine/lap/LAPService');
        const lapMatch   = await LAPService.match(companyID, speechResult);

        if (lapMatch?.matched) {
          const lapTwiml     = new twilio.twiml.VoiceResponse();
          const lapActionUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-respond/${companyID}`;
          let   lapResponseText = null;

          // ── Audio helper — pre-cached LAPResponseAudio → InstantAudio → router → Say ──
          // C3 Apr 2026: Cache layers gated by provider (EL primary only — Polly
          // tenants render live via <Say>). Synthesis path routes through
          // TTSProviderRouter so provider toggle is respected.
          const lapSayOrPlay = async (text) => {
            if (!text) return;
            const cleanText = cleanTextForTTS(stripMarkdown(text));
            const _vs = company.aiAgentSettings?.voiceSettings || {};
            const _isElPrimaryLAP = getPrimaryProvider(company) === 'elevenlabs';

            // ── 1. Check LAPResponseAudio (MongoDB-backed, EL audio — only valid for EL primary) ──
            if (_isElPrimaryLAP) {
              try {
                const LAPResponseAudio = require('../models/LAPResponseAudio');
                const textHash = LAPResponseAudio.hashText(cleanText);
                const fileHash = textHash.substring(textHash.length - 16);
                const audioDoc = await LAPResponseAudio.findAudioDataByHash(companyID, fileHash);
                if (audioDoc?.audioUrl) {
                  // Ensure file on disk (restore from MongoDB if missing)
                  const diskPath = require('path').join(__dirname, '..', 'public', audioDoc.audioUrl);
                  if (!fs.existsSync(diskPath) && audioDoc.audioData) {
                    const dir = require('path').dirname(diskPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(diskPath, audioDoc.audioData);
                  }
                  lapTwiml.play(`${getSecureBaseUrl(req)}${audioDoc.audioUrl}`);
                  return;
                }
              } catch (_lapAudioErr) { /* fall through to InstantAudio / TTS */ }
            }

            // ── 2. InstantAudioService cache (EL audio only — gated on provider) ──
            const _lapIAS = require('../services/instantAudio/InstantAudioService');
            const _lapStatus = (_isElPrimaryLAP && _vs.voiceId) ? _lapIAS.getStatus({
              companyId: companyID, kind: 'LAP_RESPONSE', text: cleanText, voiceSettings: _vs,
            }) : null;

            if (_lapStatus && _lapStatus.exists) {
              lapTwiml.play(`${getSecureBaseUrl(req)}${_lapStatus.url.replace('/audio/', '/audio-safe/')}`);
              return;
            }

            // ── 3. Synthesize via TTSProviderRouter ──
            try {
              const tts = await TTSProviderRouter.synthesize({
                text:    cleanText,
                company,
                callSid,
                ttsSource: 'lap_patience'
              });
              if (tts.kind === 'buffer') {
                if (_lapStatus) {
                  try { fs.writeFileSync(_lapStatus.filePath, tts.audio); } catch (_) {}
                  lapTwiml.play(`${getSecureBaseUrl(req)}${_lapStatus.url.replace('/audio/', '/audio-safe/')}`);
                } else {
                  // No cache target (Polly tenant) — write ephemeral file
                  const fileName = `lap_${callSid}_${Date.now()}.mp3`;
                  const filePath = require('path').join(__dirname, '../public/audio', fileName);
                  await fs.promises.writeFile(filePath, tts.audio);
                  scheduleTempAudioDelete(filePath);
                  lapTwiml.play(`${getSecureBaseUrl(req)}/audio/${fileName}`);
                }
              } else {
                // Polly path — emit Say with tenant's chosen voice
                lapTwiml.say({ voice: tts.voice }, escapeTwiML(cleanText));
              }
              return;
            } catch (ttsErr) {
              logger.warn('[LAP GATE] TTS routing failed, falling back to Polly Say', { error: ttsErr.message });
            }

            // ── 4. Last-resort Polly fallback (tenant's chosen voice) ──
            lapTwiml.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(cleanText));
          };

          // ── action: hold — play hold message, enter hold loop ───────────────
          if (lapMatch.action === 'hold' && lapMatch.holdConfig) {
            const hc = lapMatch.holdConfig;
            const holdLoopUrl = `${getSecureBaseUrl(req)}/api/twilio/lap-hold-loop/${companyID}/${encodeURIComponent(callSid)}`;

            // Persist hold state so the loop route knows where to return
            await LAPService.setHoldState(companyID, callSid, {
              actionUrl:  lapActionUrl,
              holdConfig: hc,
            });

            lapResponseText = lapMatch.response || null;
            await lapSayOrPlay(lapMatch.response);
            const holdGather = lapTwiml.gather({
              input:               'speech',
              action:              holdLoopUrl,
              method:              'POST',
              actionOnEmptyResult: true,
              timeout:             hc.deadAirCheckSeconds || 8,
              speechTimeout:       _speechTimeout(company),
              speechModel:         'phone_call',
            });
            holdGather.pause({ length: 1 });  // brief silence while waiting

          // ── action: repeat_last — re-read last agent sentence ───────────────
          } else if (lapMatch.action === 'repeat_last') {
            let lastText = null;
            try {
              const CallSummary = require('../models/CallSummary');
              const cs = await CallSummary.findOne({ twilioSid: callSid })
                .select('liveProgress.lastResponse')
                .lean();
              lastText = cs?.liveProgress?.lastResponse?.trim() || null;
            } catch (_e) { /* non-fatal */ }

            lapResponseText = lastText || "Let me repeat that. I didn't catch a previous response — how can I help you?";
            await lapSayOrPlay(lapResponseText);
            const repeatGather = lapTwiml.gather({
              input:               'speech',
              action:              lapActionUrl,
              method:              'POST',
              actionOnEmptyResult: true,
              timeout:             7,
              speechTimeout:       _speechTimeout(company),
              speechModel:         'phone_call',
            });
            repeatGather.pause({ length: 1 });

          // ── action: respond — play response, return to pipeline ─────────────
          } else {
            lapResponseText = lapMatch.response || null;
            await lapSayOrPlay(lapMatch.response);
            const respondGather = lapTwiml.gather({
              input:               'speech',
              action:              lapActionUrl,
              method:              'POST',
              actionOnEmptyResult: true,
              timeout:             7,
              speechTimeout:       _speechTimeout(company),
              speechModel:         'phone_call',
            });
            respondGather.pause({ length: 1 });
          }

          // ── Log both turns to call intelligence (CallTranscriptV2) ──────────
          // Without this, LAP intercepts are invisible in the turn log.
          try {
            const CallTranscriptV2 = require('../models/CallTranscriptV2');
            const lapTurnNum = (turnCountFromBody || 0) + 1;
            await CallTranscriptV2.appendTurns(companyID, callSid, [
              {
                speaker:         'caller',
                kind:            'CONVERSATION_CALLER',
                text:            speechResult,
                turnNumber:      lapTurnNum,
                ts:              new Date(),
                sourceKey:       'stt',
                provenanceType:  'UNKNOWN',
                provenanceLabel: 'Unknown',
                provenancePath:  'stt',
              },
              {
                speaker:         'agent',
                kind:            'CONVERSATION_AGENT',
                text:            lapResponseText || lapMatch.phrase,
                turnNumber:      lapTurnNum,
                ts:              new Date(),
                sourceKey:       'LAP_INTERCEPT',
                provenanceType:  'SYSTEM',
                provenanceLabel: 'LAP Intercept',
                provenancePath:  `LAP_INTERCEPT/${lapMatch.entryId || lapMatch.phrase}`,
                flags: [
                  { type: 'LAP_ACTION',  value: lapMatch.action },
                  { type: 'LAP_PHRASE',  value: lapMatch.phrase },
                  { type: 'LAP_ENTRY',   value: lapMatch.entryId || '' },
                ],
              },
            ]);
          } catch (_lapLogErr) { /* non-fatal — call must not crash on log failure */ }

          logger.info('[LAP GATE] Intercepted — returning recovery TwiML', {
            companyId: companyID, callSid, action: lapMatch.action, phrase: lapMatch.phrase,
            voiceMode: (company.aiAgentSettings?.voiceSettings?.voiceId) ? 'elevenlabs' : 'twilio_say',
          });
          twimlString = lapTwiml.toString();
          res.type('text/xml');
          return res.send(twimlString);
        }
      } catch (lapErr) {
        // Any LAP error → graceful degrade, call continues normally
        logger.warn('[LAP GATE] Error — graceful degrade', {
          companyId: companyID, error: lapErr.message
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S0: STATE INTEGRITY - LOAD PHASE
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: This section exposes state drift. If turnCount resets mid-call,
    // SECTION_S0_STATE_LOAD will show found=false or wrong turnCount.
    // The state key is ALWAYS: `call:${callSid}` - never phone, never sequence.
    // ═══════════════════════════════════════════════════════════════════════════
    const T_stateLoad = Date.now();
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
    // 🧹 STAGE 3 (R12): Deleted dead `req.session.callState` fallback read.
    //                   Twilio webhook POSTs do not return session cookies → express-session
    //                   MemoryStore never carries callState across requests. The only real
    //                   state path is Redis (`call:{callSid}`). Session fallback was never
    //                   reachable. Removed to kill confusion. (Matches Stage 1 cleanup of
    //                   dead session writes in /voice.)

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
      // BUG-FIX: args were swapped (callSid passed as companyID → CastError on every call).
      // Also missing await — caused unhandled promise rejection instead of proper state init.
      // initializeCall returns { greeting, callState: {...}, voiceSettings } — extract .callState.
      const _initResult = await initializeCall(companyID, callSid, fromNumber, req.body.To || '');
      callState = _initResult?.callState || {};
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
    // callerTurnWriteOk — must be declared in outer scope so computeTurnPromise closure can read it.
    // Set true after successful primary write; safety-net at ~line 6423 skips if true.
    let callerTurnWriteOk = false;
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
        callerTurnWriteOk = true;
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

    timings.stateLoadMs = Date.now() - T_stateLoad;

    const hostHeader = req.get('host');
    const bridgeCfg = company?.aiAgentSettings?.agent2?.bridge || {};
    const bridgeEnabled = bridgeCfg?.enabled === true;

    // Turn-1 welcome: company-configurable branded greeting that plays INSTANTLY
    // when the caller finishes speaking on turn 1 (e.g. "Hi, thanks for calling!").
    // Stored at bridge.turn1Welcome = { enabled: bool, line: string, thresholdMs?: number }
    const turn1WelcomeCfg = bridgeCfg.turn1Welcome || {};
    const isTurn1Welcome = (
      turnNumber === 1 &&
      turn1WelcomeCfg.enabled === true &&
      typeof turn1WelcomeCfg.line === 'string' &&
      turn1WelcomeCfg.line.trim().length > 0
    );

    // V131: Post-gather delay replaces the old threshold race.
    // Bridge fires this many ms after gather completes (unless compute already resolved).
    // UI-configurable starting at 200ms. Old thresholdMs kept for backward compat reads.
    // Turn-1 welcome overrides to near-zero delay so it fires immediately after gather.
    const turn1WelcomeDelayMs = Number.isFinite(turn1WelcomeCfg.thresholdMs) ? turn1WelcomeCfg.thresholdMs : 0;
    const bridgePostGatherDelayMs = isTurn1Welcome ? turn1WelcomeDelayMs
      : (Number.isFinite(bridgeCfg.postGatherDelayMs) ? bridgeCfg.postGatherDelayMs
        : (Number.isFinite(bridgeCfg.thresholdMs) ? bridgeCfg.thresholdMs : 200));  // thresholdMs fallback for pre-V131 data
    const bridgeMaxCeilingMs = Number.isFinite(bridgeCfg.maxCeilingMs) ? bridgeCfg.maxCeilingMs : 15000;

    // V131: Only suppress bridge during active transfers (legitimate).
    // Pending yes/no and PFUQ guards REMOVED — these are internal state concepts
    // that have no voice UX justification. The caller hears dead air regardless
    // of whether the system is in a "follow-up state."
    const isAlreadyTransferLane = (callState?.sessionMode === 'TRANSFER');

    // BOOKING lane: BookingLogicEngine is deterministic (no LLM inference).
    // Responses are sub-100ms or served from cache — no bridge filler needed.
    // Bridging during booking adds dead air + an extra audio clip before the
    // actual response, making the agent sound robotic and repetitive.
    const isAlreadyBookingLane = (callState?.sessionMode === 'BOOKING');

    const mayBridge =
      bridgeEnabled &&
      !!redis &&
      !!callSid &&
      (isTurn1Welcome || bridgePostGatherDelayMs >= 50) &&   // turn1Welcome bypasses 50ms minimum
      !isAlreadyTransferLane &&
      !isAlreadyBookingLane;

    // ── Pre-generate bridge token ─────────────────────────────────────────
    // Generated early so streaming heartbeat can write to the same Redis keys
    // that bridge-continue will poll. Reused in bridge init (line 5335→ below).
    const preGeneratedBridgeToken = crypto.randomBytes(8).toString('hex');

    // ── Smart bridge: fast-path signal ────────────────────────────────────────
    // When any InstantAudio cache hit is detected inside computeTurnPromise,
    // _fastPathResolve() fires immediately — the bridge race sees this before
    // the 200ms delay and skips the bridge. The pipeline finishes in <50ms after
    // fastPath fires so computeTurnPromise races to completion right behind it.
    let _fastPathResolve;
    const fastPathPromise = new Promise(resolve => { _fastPathResolve = resolve; });

    // firstSentenceAudioPromise — resolves when s0 ElevenLabs synthesis is done.
    // Defined in outer scope so the bridge race (also outer scope) can see it.
    // BUG-16 FIX: only create the 4000ms safety timeout when mayBridge is true.
    // When mayBridge=false, the promise is never entered in the race, so no timer needed.
    let _firstSentenceAudioResolve;
    const firstSentenceAudioPromise = new Promise(resolve => {
      _firstSentenceAudioResolve = resolve;
      if (mayBridge) {
        setTimeout(() => resolve(null), 4000);  // Safety: never hang the bridge race
      }
    });

    const computeTurnPromise = (async () => {
      let localVoiceProviderUsed = 'twilio_say';
      // V-FIX: Voice decision tracking for observability
      let vd_audioUrlPresent = false;
      let vd_preflightPassed = null;   // null = not checked, true/false = result
      let vd_elevenLabsAttempted = false;
      let vd_elevenLabsSuccess = false;

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

      // ── Internal guard: wrap entire pipeline so computeTurnPromise never rejects ──
      // An uncaught exception here propagates to `await computeTurnPromise` (no local
      // try/catch at call sites) → outer route catch → ROUTE_CRASH.  Instead, return a
      // graceful recovery TwiML with a Gather so the call continues.
      try {

      // ═══════════════════════════════════════════════════════════════════════════
      // PATIENCE MODE CHECK — "Still there?" when timeout expires with no speech
      // If caller asked to hold and then the 45s gather timed out without any
      // speech, give a gentle check-in instead of running the full pipeline.
      // The listener stays on — caller can speak at any time.
      // ═══════════════════════════════════════════════════════════════════════════
      const wasPatienceMode = callState?.agent2?.discovery?.patienceMode === true;
      const speechIsEmpty = !speechResult || !speechResult.trim();
      const psCfg = company?.aiAgentSettings?.agent2?.discovery?.patienceSettings || {};
      const psTimeoutEnabled = psCfg.timeoutEnabled !== false;
      const psTimeout = Math.max(10, Math.min(180, parseInt(psCfg.timeoutSeconds) || 45));
      const psMaxCheckins = Math.max(1, Math.min(10, parseInt(psCfg.maxCheckins) || 2));
      
      if (wasPatienceMode && speechIsEmpty && psTimeoutEnabled) {
        const checkinCount = (callState?.agent2?.discovery?.patienceCheckinCount || 0) + 1;
        callState.agent2.discovery.patienceCheckinCount = checkinCount;
        
        const isLastCheckin = checkinCount >= psMaxCheckins;
        const checkinText = isLastCheckin
          ? (`${psCfg.finalResponse || ''}`.trim() || "I'm still here whenever you're ready. Just let me know how I can help.")
          : (`${psCfg.checkinResponse || ''}`.trim() || "Are you still there? No rush — take your time.");
        
        if (isLastCheckin) {
          callState.agent2.discovery.patienceMode = false;
        }
        
        if (CallLogger && callSid) {
          CallLogger.logEvent({
            callId: callSid, companyId: companyID,
            type: 'PATIENCE_TIMEOUT_CHECK_IN',
            turn: turnNumber,
            data: { timeoutSeconds: psTimeout, checkinNumber: checkinCount, maxCheckins: psMaxCheckins, isLastCheckin }
          }).catch(() => {});
        }
        
        // Persist patience check-in to transcript (this early return skips normal persistence)
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          
          // Record the STT_EMPTY (caller was silent during patience wait)
          await CallTranscriptV2.appendTurns(companyID, callSid, [
            {
              speaker: 'system',
              kind: 'PATIENCE_WAIT',
              text: `Patience mode: caller silent for ${psTimeout}s (check-in ${checkinCount}/${psMaxCheckins})`,
              turnNumber,
              ts: new Date(),
              sourceKey: 'patience',
              trace: { patienceCheckin: checkinCount, maxCheckins: psMaxCheckins, timeoutSeconds: psTimeout }
            }
          ], { from: fromNumber || null, to: req.body.To || null });
          
          // Record the agent check-in response
          await CallTranscriptV2.appendTurns(companyID, callSid, [
            {
              speaker: 'agent',
              kind: isLastCheckin ? 'PATIENCE_FINAL_CHECKIN' : 'PATIENCE_CHECKIN',
              text: checkinText,
              turnNumber,
              ts: new Date(),
              sourceKey: 'patience_check_in',
              trace: {
                provenance: {
                  type: 'UI_OWNED',
                  uiPath: 'aiAgentSettings.agent2.discovery.patienceSettings',
                  reason: `patience_checkin_${checkinCount}`
                },
                checkinNumber: checkinCount,
                isLastCheckin
              }
            }
          ], { from: fromNumber || null, to: req.body.To || null });
        } catch (mongoErr) {
          logger.warn('[V2TWILIO] Failed to persist patience check-in to transcript', {
            callSid: callSid?.slice(-8), error: mongoErr.message
          });
        }
        
        if (redis && redisKey) {
          try { await redis.set(redisKey, JSON.stringify(callState), { EX: 60 * 60 * 4 }); } catch (_) {}
        }
        
        const twiml = new twilio.twiml.VoiceResponse();
        const nextTimeout = isLastCheckin ? 7 : psTimeout;
        const gather = twiml.gather({
          input: 'speech',
          action: `/api/twilio/v2-agent-respond/${companyID}`,
          method: 'POST',
          actionOnEmptyResult: true,
          timeout: nextTimeout,
          speechTimeout: _speechTimeout(company),
          speechModel: 'phone_call',
          partialResultCallback: `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`,
          partialResultCallbackMethod: 'POST'
        });
        
        const voiceSettings = company.aiAgentSettings?.voiceSettings || {};

        // C3 Apr 2026: Cache lookup gated on EL primary (Polly tenants render
        // live via <Say>). Synthesis routes through TTSProviderRouter.
        try {
          const _pClean = cleanTextForTTS(checkinText);
          const _isElPrimaryPC = getPrimaryProvider(company) === 'elevenlabs';
          const _pIAS = require('../services/instantAudio/InstantAudioService');
          const _pStatus = (_isElPrimaryPC && voiceSettings.voiceId) ? _pIAS.getStatus({
            companyId: companyID, kind: 'PATIENCE_CHECKIN', text: _pClean, voiceSettings,
          }) : null;

          if (_pStatus && _pStatus.exists) {
            gather.play(`https://${hostHeader}${_pStatus.url.replace('/audio/', '/audio-safe/')}`);
          } else {
            const tts = await TTSProviderRouter.synthesize({
              text: checkinText, company, callSid, ttsSource: 'checkin'
            });
            if (tts.kind === 'buffer') {
              if (_pStatus) {
                // Cache for next patience cycle (EL primary)
                try { fs.writeFileSync(_pStatus.filePath, tts.audio); } catch (__) {}
                gather.play(`https://${hostHeader}${_pStatus.url.replace('/audio/', '/audio-safe/')}`);
              } else {
                // Polly tenant whose EL fallback returned a buffer — write ephemeral
                const fileName = `checkin_${callSid}_${Date.now()}.mp3`;
                const filePath = require('path').join(__dirname, '../public/audio', fileName);
                await fs.promises.writeFile(filePath, tts.audio);
                scheduleTempAudioDelete(filePath);
                gather.play(`https://${hostHeader}/audio/${fileName}`);
              }
            } else {
              // Polly path — emit Say with tenant's chosen voice
              gather.say({ voice: tts.voice }, escapeTwiML(checkinText));
            }
          }
        } catch (_) {
          gather.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(checkinText));
        }
        
        return {
          twimlString: twiml.toString(),
          voiceProviderUsed: 'patience_check_in',
          responseText: checkinText,
          matchSource: 'PATIENCE_CHECK_IN',
          timings: { totalMs: Date.now() - T0 }
        };
      }
      
      if (wasPatienceMode && !speechIsEmpty) {
        callState.agent2.discovery.patienceMode = false;
        callState.agent2.discovery.patienceCheckinCount = 0;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // GHOST TURN GUARD — Empty-input from bridge timeout with pending question
      // ═══════════════════════════════════════════════════════════════════════════
      // When bridge timeout fires actionOnEmptyResult:true, it creates a ghost
      // turn with empty speechResult. If there's a pending follow-up question
      // (PFUQ) or legacy pending question (PQ) waiting for the caller's response,
      // skip the full pipeline (no bridge, no runtime, no ScrabEngine) and just
      // re-open the listener. Bump the pending question turn forward so it
      // survives for the next real turn.
      // ═══════════════════════════════════════════════════════════════════════════
      // BUG FIX (2026-04-16): ghostSpeechDet was NEVER declared — every ghost
      // turn guard hit crashed with ReferenceError. The catch block swallowed it,
      // so the feature appeared to work but actually fell through to crash recovery.
      const ghostSpeechDet = _getSpeechDetection(company);
      const ghostPFUQ = callState?.agent2?.discovery?.pendingFollowUpQuestion || null;
      const ghostPFUQTurn = callState?.agent2?.discovery?.pendingFollowUpQuestionTurn;
      const ghostPQ = callState?.agent2?.discovery?.pendingQuestion || null;
      const ghostPQTurn = callState?.agent2?.discovery?.pendingQuestionTurn;
      const hasAnyPendingQ = !!ghostPFUQ || !!ghostPQ;
      // Never ghost-guard in BOOKING lane — the booking redirect arrives with
      // empty SpeechResult and must reach BookingLogicEngine, not be silenced.
      const ghostGuardIsBookingLane = (
        callState?.lane === 'BOOKING' || callState?.sessionMode === 'BOOKING'
      );

      if (speechIsEmpty && hasAnyPendingQ && !ghostGuardIsBookingLane) {
        // Bump pending question turns forward so they survive for the next real turn
        if (ghostPFUQ && typeof ghostPFUQTurn === 'number') {
          callState.agent2.discovery.pendingFollowUpQuestionTurn = turnNumber;
        }
        if (ghostPQ && typeof ghostPQTurn === 'number') {
          callState.agent2.discovery.pendingQuestionTurn = turnNumber;
        }

        logger.info('[V2TWILIO] GHOST_TURN_EARLY_EXIT — empty input with pending question, skipping pipeline', {
          callSid: callSid?.slice(-8),
          turnNumber,
          hasPFUQ: !!ghostPFUQ,
          hasPQ: !!ghostPQ,
          pfuqTurnBumped: ghostPFUQ ? `${ghostPFUQTurn} → ${turnNumber}` : null,
          pqTurnBumped: ghostPQ ? `${ghostPQTurn} → ${turnNumber}` : null
        });

        // Trace event for Call Intelligence turn-by-turn
        if (CallLogger && callSid) {
          CallLogger.logEvent({
            callId: callSid,
            companyId: companyID,
            type: 'GHOST_TURN_EARLY_EXIT',
            turn: turnNumber,
            data: {
              reason: 'Empty input (bridge ghost turn) — preserving pending question, skipping full pipeline',
              hasPFUQ: !!ghostPFUQ,
              hasPQ: !!ghostPQ,
              pfuqTurnOriginal: ghostPFUQTurn,
              pfuqTurnBumped: ghostPFUQ ? turnNumber : null,
              pqTurnOriginal: ghostPQTurn,
              pqTurnBumped: ghostPQ ? turnNumber : null,
              pfuqText: typeof ghostPFUQ === 'string' ? ghostPFUQ.substring(0, 80) : null,
              pqText: typeof ghostPQ === 'string' ? ghostPQ.substring(0, 80) : null
            }
          }).catch(() => {});
        }

        // Persist transcript trace for this ghost turn
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          await CallTranscriptV2.appendTurns(companyID, callSid, [
            {
              speaker: 'system',
              kind: 'GHOST_TURN_SKIPPED',
              text: `Ghost turn skipped — empty input, pending question preserved for next real turn`,
              turnNumber,
              ts: new Date(),
              sourceKey: 'ghost_guard',
              trace: {
                hasPFUQ: !!ghostPFUQ,
                hasPQ: !!ghostPQ,
                pfuqText: typeof ghostPFUQ === 'string' ? ghostPFUQ.substring(0, 80) : null
              }
            }
          ], { from: fromNumber || null, to: req.body.To || null });
        } catch (mongoErr) {
          logger.warn('[V2TWILIO] Failed to persist ghost turn trace', {
            callSid: callSid?.slice(-8), error: mongoErr.message
          });
        }

        // Persist state with bumped turn numbers
        if (redis && redisKey) {
          try { await redis.set(redisKey, JSON.stringify(callState), { EX: 60 * 60 * 4 }); } catch (_) {}
        }

        // Return fresh Gather TwiML — silently re-open listener for caller
        // Use 2s when a pending question is active (avoid cutting mid-sentence).
        // Otherwise use admin-configured speechTimeout via _speechTimeout(company).
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
          input: 'speech',
          action: `/api/twilio/v2-agent-respond/${companyID}`,
          method: 'POST',
          actionOnEmptyResult: true,
          timeout: ghostSpeechDet.initialTimeout ?? 7,
          speechTimeout: _speechTimeout(company, { pendingFollowUp: hasAnyPendingQ }),
          bargeIn: ghostSpeechDet.bargeIn ?? false,
          enhanced: ghostSpeechDet.enhancedRecognition ?? true,
          speechModel: ghostSpeechDet.speechModel || 'phone_call',
          partialResultCallback: `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`,
          partialResultCallbackMethod: 'POST'
        });
        gather.say(''); // Silent — just listen for caller's response

        return {
          twimlString: twiml.toString(),
          voiceProviderUsed: 'ghost_turn_skip',
          responseText: '',
          matchSource: 'GHOST_TURN_EARLY_EXIT',
          timings: { totalMs: Date.now() - T0 }
        };
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // SILENT RE-LISTEN — Caller hasn't spoken yet, just needs more time
      // ═══════════════════════════════════════════════════════════════════════════
      // BUG FIX (2026-04-16): When Gather's initial timeout fires with no speech
      // (actionOnEmptyResult:true), the full pipeline ran on empty input — the agent
      // responded to nothing, interrupting a caller who was thinking or explaining.
      //
      // Humans take time to formulate their thoughts. A 7-second silence does NOT
      // mean "I'm done" — it means "I'm thinking." We track consecutive empty turns
      // and silently re-listen up to a configurable max before gently prompting.
      //
      // Flow:
      //   1st empty → silently re-listen (caller is thinking)
      //   2nd empty → silently re-listen (still thinking)
      //   3rd empty → falls through to pipeline (agent gently prompts)
      //
      // Booking lane is excluded — booking redirect arrives with empty SpeechResult.
      // ═══════════════════════════════════════════════════════════════════════════
      if (speechIsEmpty && !ghostGuardIsBookingLane) {
        const consecutiveEmpties = (callState?.agent2?.discovery?.consecutiveEmptyTurns || 0) + 1;

        // Configurable max silent re-listens before prompting. Default: 2 re-listens
        // (meaning the 3rd consecutive empty turn falls through to the pipeline).
        const maxSilentRelistens = company?.aiAgentSettings?.agent2?.discovery?.maxSilentRelistens ?? 2;

        if (consecutiveEmpties <= maxSilentRelistens) {
          // Persist the consecutive empty count
          callState.agent2 = callState.agent2 || {};
          callState.agent2.discovery = callState.agent2.discovery || {};
          callState.agent2.discovery.consecutiveEmptyTurns = consecutiveEmpties;

          logger.info('[V2TWILIO] SILENT_RELISTEN — caller needs more time, re-opening listener', {
            callSid: callSid?.slice(-8),
            turnNumber,
            consecutiveEmpties,
            maxSilentRelistens,
          });

          if (CallLogger && callSid) {
            CallLogger.logEvent({
              callId: callSid, companyId: companyID,
              type: 'SILENT_RELISTEN',
              turn: turnNumber,
              data: {
                reason: 'Caller silent — re-opening listener (humans need time to think)',
                consecutiveEmpties,
                maxSilentRelistens,
              }
            }).catch(() => {});
          }

          // Persist transcript trace
          try {
            const CallTranscriptV2 = require('../models/CallTranscriptV2');
            await CallTranscriptV2.appendTurns(companyID, callSid, [
              {
                speaker: 'system',
                kind: 'SILENT_RELISTEN',
                text: `Silent re-listen ${consecutiveEmpties}/${maxSilentRelistens} — caller needs more time`,
                turnNumber,
                ts: new Date(),
                sourceKey: 'silence_guard',
              }
            ], { from: fromNumber || null, to: req.body.To || null });
          } catch (mongoErr) {
            logger.warn('[V2TWILIO] Failed to persist silent re-listen trace', {
              callSid: callSid?.slice(-8), error: mongoErr.message
            });
          }

          // Persist state with updated consecutive empty count
          if (redis && redisKey) {
            try { await redis.set(redisKey, JSON.stringify(callState), { EX: 60 * 60 * 4 }); } catch (_) {}
          }

          // Silently re-open listener — no speech, no prompt, just wait for the caller
          const twiml = new twilio.twiml.VoiceResponse();
          const _relistenSd = _getSpeechDetection(company);
          const gather = twiml.gather({
            input: 'speech',
            action: `/api/twilio/v2-agent-respond/${companyID}`,
            method: 'POST',
            actionOnEmptyResult: true,
            timeout: _relistenSd.initialTimeout ?? 7,
            speechTimeout: _speechTimeout(company),
            bargeIn: _relistenSd.bargeIn ?? false,
            enhanced: _relistenSd.enhancedRecognition ?? true,
            speechModel: _relistenSd.speechModel || 'phone_call',
            partialResultCallback: `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`,
            partialResultCallbackMethod: 'POST'
          });
          gather.say(''); // Silent — just listen

          return {
            twimlString: twiml.toString(),
            voiceProviderUsed: 'silent_relisten',
            responseText: '',
            matchSource: 'SILENT_RELISTEN',
            timings: { totalMs: Date.now() - T0 }
          };
        }

        // Fell through maxSilentRelistens — reset counter and let the pipeline
        // handle it (agent will gently prompt "Are you still there?" via fallback).
        callState.agent2 = callState.agent2 || {};
        callState.agent2.discovery = callState.agent2.discovery || {};
        callState.agent2.discovery.consecutiveEmptyTurns = 0;

        logger.info('[V2TWILIO] SILENT_RELISTEN_EXHAUSTED — max re-listens reached, letting pipeline handle', {
          callSid: callSid?.slice(-8),
          turnNumber,
          consecutiveEmpties,
          maxSilentRelistens,
        });
      }

      // Reset consecutive empty counter when caller actually speaks
      if (!speechIsEmpty && callState?.agent2?.discovery?.consecutiveEmptyTurns) {
        callState.agent2.discovery.consecutiveEmptyTurns = 0;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // CHECKPOINT 14: LOAD_STATE — Call state loaded
      // ═══════════════════════════════════════════════════════════════════════════
      emitFlowCheckpoint(CallLogger, callSid, companyID, turnNumber, {
        ...FLOW_STEPS.LOAD_STATE,
        status: 'FIRED',
        details: `State loaded: turn=${turnNumber}, sessionMode=${callState?.sessionMode || 'DISCOVERY'}`,
        data: {
          turn: turnNumber,
          sessionMode: callState?.sessionMode || 'DISCOVERY',
          lane: callState?.lane || 'DISCOVERY',
          hasBookingCtx: Boolean(callState?.bookingCtx),
          hasPendingFollowUp: Boolean(callState?.agent2?.discovery?.pendingFollowUpQuestion)
        }
      });

      // ═══════════════════════════════════════════════════════════════════════════
      // CHECKPOINT 15: CALL_RUNTIME — Session mode router
      // ═══════════════════════════════════════════════════════════════════════════
      emitFlowCheckpoint(CallLogger, callSid, companyID, turnNumber, {
        ...FLOW_STEPS.CALL_RUNTIME,
        status: 'FIRED',
        details: `Routing to ${callState?.lane === 'BOOKING' || callState?.sessionMode === 'BOOKING' ? 'BOOKING_ENGINE' : 'AGENT2_DISCOVERY'}`,
        data: {
          lane: callState?.lane || 'DISCOVERY',
          sessionMode: callState?.sessionMode || 'DISCOVERY',
          routingTo: callState?.lane === 'BOOKING' || callState?.sessionMode === 'BOOKING' ? 'BOOKING_ENGINE' : 'AGENT2_DISCOVERY'
        }
      });
      
      // ═══════════════════════════════════════════════════════════════════════════
      // SENTENCE STREAMING — First-sentence TTS fast path
      // ═══════════════════════════════════════════════════════════════════════════
      // onSentence fires per-sentence as the LLM streams tokens.
      //   idx=0 → immediately synthesize s0 with ElevenLabs → resolve firstSentenceAudioPromise
      //           This lets the bridge race skip its delay and play s0 to the caller
      //           while s1, s2... are still being generated.
      //   idx>0 → write sentence text to Redis for /v2-agent-sentence-continue to serve
      // ═══════════════════════════════════════════════════════════════════════════
      // _firstSentenceAudioResolve and firstSentenceAudioPromise are defined in
      // outer scope (above computeTurnPromise) so the bridge race can see them.
      const _sentenceVoiceSettings   = company?.aiAgentSettings?.voiceSettings || {};
      // BUG-FIX: `elevenLabsVoice` is declared with `const` at line 5665 (below), causing a TDZ
      // crash when referenced here. Use _sentenceVoiceSettings.voiceId directly instead.
      const _sentenceElevenLabsVoice = _sentenceVoiceSettings.voiceId || null;
      const _sentenceHostHeader      = hostHeader;

      // ── BUG-28 FIX: Write preflight gather config BEFORE LLM starts ──────────
      // sentence-continue may be called moments after s0 plays (race window ~200ms).
      // We write defaults now and overwrite with accurate values after the LLM
      // completes (patience timeout, pendingFollowUp speechTimeout).
      const _preflightSpeechDet = company.aiAgentSettings?.agent2?.speechDetection
        || company.aiAgentSettings?.voiceSettings?.speechDetection
        || {};
      if (redis && callSid && mayBridge) {
        redis.set(`a2sentence:gather:${callSid}:${turnNumber}`, JSON.stringify({
          action:        `/api/twilio/v2-agent-respond/${companyID}`,
          timeout:       7,         // default; overwritten after runtimeResult with patience value
          speechTimeout: _speechTimeout(company),    // default; overwritten after runtimeResult if pendingFollowUp
          bargeIn:       _preflightSpeechDet.bargeIn ?? false,
          enhanced:      _preflightSpeechDet.enhancedRecognition ?? true,
          speechModel:   _preflightSpeechDet.speechModel || 'phone_call',
          hostHeader:    _sentenceHostHeader,
          companyID,
          voiceSettings: _sentenceVoiceSettings,
          voiceId:       _sentenceElevenLabsVoice || null,
        }), { EX: 120 }).catch(() => {});
      }

      // C3 Apr 2026: Determine provider once for the whole turn.
      // Polly tenants skip pre-synthesis entirely — sentence-continue will
      // route through the same TTSProviderRouter and emit Say with sentence
      // text directly (see L4938 area). Avoids wasted Polly API calls and
      // ensures voice consistency across the turn.
      const _isElPrimarySentence = getPrimaryProvider(company) === 'elevenlabs';

      const onSentence = async (sentence, idx) => {
        try {
          // Write ALL sentences to Redis for sentence-continue endpoint
          if (redis && callSid) {
            await redis.set(
              `a2sentence:${callSid}:${turnNumber}:${idx}`,
              sentence,
              { EX: 60 }
            ).catch(() => {});
          }

          // ALL idx>0: pre-synthesize ONLY for EL primary tenants
          if (idx > 0 && _isElPrimarySentence && _sentenceElevenLabsVoice) {
            (async () => {
              try {
                const tts = await TTSProviderRouter.synthesize({
                  text: sentence,
                  company,
                  callSid,
                  ttsSource: 'sentence_batch'
                });
                if (tts.kind === 'buffer') {
                  const sFile     = `s${idx}_${callSid}_${turnNumber}_${Date.now()}.mp3`;
                  const sFilePath = path.join(__dirname, '../public/audio', sFile);
                  await fs.promises.writeFile(sFilePath, tts.audio);
                  scheduleTempAudioDelete(sFilePath);
                  const sUrl = `https://${_sentenceHostHeader}/audio/${sFile}`;
                  if (redis && callSid) {
                    await redis.set(`a2sentence:audio:${callSid}:${turnNumber}:${idx}`, sUrl, { EX: 60 }).catch(() => {});
                  }
                }
                // If kind === 'polly' (EL fell back mid-stream), don't cache —
                // sentence-continue will see no URL and emit Say with sentence text.
              } catch { /* non-fatal — sentence-continue will synthesize on demand */ }
            })();
          }

          // idx=0: synthesize immediately → fire firstSentenceAudioPromise
          // For Polly tenants: resolve immediately with null so bridge falls
          // through to the Polly Say path (no pre-synth needed for one-shot Say).
          if (idx === 0 && mayBridge) {
            if (!_isElPrimarySentence) {
              // Polly primary — no pre-synth, signal bridge to take Polly Say path
              _firstSentenceAudioResolve(null);
              return;
            }
            if (_sentenceElevenLabsVoice) {
              const tts = await TTSProviderRouter.synthesize({
                text:    sentence,
                company,
                callSid,
                ttsSource: 'sentence_first'
              });
              if (tts.kind === 'buffer') {
                const s0FileName = `s0_${callSid}_${turnNumber}_${Date.now()}.mp3`;
                const s0Path     = path.join(__dirname, '../public/audio', s0FileName);
                await fs.promises.writeFile(s0Path, tts.audio);
                scheduleTempAudioDelete(s0Path);
                const s0Url = `https://${_sentenceHostHeader}/audio/${s0FileName}`;
                // Write s0 audio URL to Redis so sentence-continue can pick it up
                if (redis && callSid) {
                  await redis.set(`a2sentence:audio:${callSid}:${turnNumber}:0`, s0Url, { EX: 60 }).catch(() => {});
                }
                _firstSentenceAudioResolve({ audioUrl: s0Url, sentence });
              } else {
                // EL → Polly fallback mid-call — bridge will take Polly Say path
                _firstSentenceAudioResolve(null);
              }
            }
          }
        } catch (err) {
          logger.warn('[SENTENCE_STREAM] onSentence synthesis failed (non-fatal)', {
            idx, error: err.message, callSid: callSid?.slice(-8),
          });
          // On s0 failure, resolve with null so bridge race doesn't hang
          if (idx === 0) _firstSentenceAudioResolve(null);
        }
      };

      // ═══════════════════════════════════════════════════════════════════════════
      // SPECULATIVE PRE-WARM CHECK
      // While the caller was speaking, partialResultCallback fired the LLM early.
      // If that result is in Redis and matches the final transcript (≥75% token
      // containment), skip the LLM call entirely — ~1–2s saved on every turn.
      // Falls through to normal processTurn on any error or mismatch.
      // ═══════════════════════════════════════════════════════════════════════════
      const _specPrewarm = await checkSpeculativeResult(
        callSid, speechResult, callState.turnCount || 0, redis
      );
      if (_specPrewarm) {
        // Cancel any in-flight debounce timer and UAP partial match for this call
        if (_speculativeDebounce.has(callSid)) {
          clearTimeout(_speculativeDebounce.get(callSid));
          _speculativeDebounce.delete(callSid);
        }
        _uapPartialMatch.delete(callSid);
        // Signal fast path immediately — bridge will either not fire or
        // bridge-continue will find audio almost instantly (TTS still starts now)
        _fastPathResolve?.();

        logger.info('[SPEC_PRE_WARM] 🚀 Using UAP-gated pre-warm result', {
          callSid: callSid.slice(-8),
          turnCount: callState.turnCount,
          path: _specPrewarm?._123rp?.lastPath || '?',
        });
      } else {
        // No speculative hit — clean up tracking (turn is starting fresh)
        _uapPartialMatch.delete(callSid);
        if (_speculativeDebounce.has(callSid)) {
          clearTimeout(_speculativeDebounce.get(callSid));
          _speculativeDebounce.delete(callSid);
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // CORE RUNTIME - Process turn and collect events in buffer
      // ═══════════════════════════════════════════════════════════════════════════
      const T2_start = Date.now();
      const runtimeResult = _specPrewarm || await CallRuntime.processTurn(
        company.aiAgentSettings || {},
        callState,
        speechResult,
        {
          company,
          callSid,
          companyId: companyID,
          callerPhone: fromNumber,
          turnCount: callState.turnCount,
          inputTextSource,
          bridgeToken: mayBridge ? preGeneratedBridgeToken : null,
          redis: redis || null,
          onSentence,
        }
      );
      timings.coreRuntimeMs = Date.now() - T2_start;

      const T3_start = Date.now();
      if (runtimeResult.turnEventBuffer && runtimeResult.turnEventBuffer.length > 0) {
        await CallRuntime.flushEventBuffer(runtimeResult.turnEventBuffer);
      }
      timings.eventFlushMs = Date.now() - T3_start;

      // Persist runtime trace events for Call Console (ScrabEngine, greeting, etc.)
      if (runtimeResult.turnEventBuffer && runtimeResult.turnEventBuffer.length > 0) {
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          const traceEntries = runtimeResult.turnEventBuffer.map(ev => ({
            kind: `${ev.type || ''}`,
            turnNumber: Number.isFinite(ev.turn) ? ev.turn : turnNumber,
            ts: ev.ts || new Date().toISOString(),
            payload: ev.data || {}
          }));
          await CallTranscriptV2.appendTrace(companyID, callSid, traceEntries);
        } catch (traceErr) {
          logger.warn('[V2TWILIO] Failed to append runtime trace events (non-blocking)', {
            callSid: callSid?.slice(-8),
            error: traceErr.message
          });
        }
      }

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
      // 🧹 STAGE 3 (R12): Deleted `req.session.callState = persistedState` — dead write.
      //                   Twilio webhooks don't return session cookies, so the next request
      //                   never sees this. Companion read (~L5468) was also deleted.
      //                   Redis (`call:{callSid}`) is the single source of truth for call state.

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
      
      // Resolve response text - use runtimeResult.response, fallback to UI config (not hardcoded)
      let responseText = runtimeResult.response;
      if (!responseText || !responseText.trim()) {
        // ── SILENT TURN SENTINEL ──────────────────────────────────────────────
        // If the engine returned empty/null response during a BOOKING turn, log
        // it immediately — this is the root cause of caller-heard silence.
        // BLE always returns nextPrompt (never null), so this firing during BOOKING
        // means a code path upstream failed to set runtimeResult.response.
        const _isBookingTurn = persistedState?.sessionMode === 'BOOKING' || persistedState?.lane === 'BOOKING';
        if (_isBookingTurn && CallLogger && callSid) {
          CallLogger.logEvent({
            callId:    callSid,
            companyId: companyID,
            type:      'BL1_SILENT_TURN_DETECTED',
            turn:      turnNumber,
            data: {
              bookingStep:    persistedState?.bookingCtx?.step || 'UNKNOWN',
              matchSource:    runtimeResult?.matchSource || null,
              rawResponse:    runtimeResult?.response   || null,
              note:           'responseText was empty for a BOOKING turn — caller heard silence'
            }
          }).catch(() => {});
        }
        responseText = (await getRecoveryMessage(company, 'generalError')) || 'I can help you with that.';
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // 🧪 AGENT LAB HOOK 2 — Emit per-turn data to Redis for live X-ray
      // Only fires when this callSid is tagged as an active test session.
      // ═══════════════════════════════════════════════════════════════════════════
      if (redis && callSid) {
        try {
          const _labSessionId = await redis.get(`agentlab:callsid:${callSid}`);
          if (_labSessionId) {
            const _labTurn = JSON.stringify({
              turnNumber:  turnNumber || null,
              speechText:  effectiveSpeechText || speechText || '',
              responseText: (responseText || '').slice(0, 400),
              matchSource: runtimeResult?.matchSource || null,
              lane:        runtimeResult?.lane || persistedState?.lane || null,
              kcTitle:     runtimeResult?.triggerCard?.label || runtimeResult?.kcTitle || null,
              kcId:        runtimeResult?.triggerCard?.id   || runtimeResult?.kcId   || null,
              noKcMatch:   (runtimeResult?.matchSource === 'KC_GRACEFUL_ACK' || runtimeResult?.matchSource === 'KC_LLM_FALLBACK'),
              ts:          new Date().toISOString(),
            });
            await redis.rpush(`agentlab:turns:${_labSessionId}`, _labTurn);
            await redis.expire(`agentlab:turns:${_labSessionId}`, 14400);
          }
        } catch (_labErr) {
          // Non-fatal — lab hook failure must never affect live call
        }
      }

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

      // ═══════════════════════════════════════════════════════════════════════════
      // EMPTY STT PROTOCOL (emptysttprotocol) — Transcript Logging
      // ═══════════════════════════════════════════════════════════════════════════
      // When the Empty STT Protocol engaged and the LLM produced a recovery
      // response, log a system diagnostic turn so Call Review Console can display
      // a clear "STT Empty — LLM Recovery" indicator. This supplements the
      // STT_EMPTY diagnostic already written at line ~4851.
      // ═══════════════════════════════════════════════════════════════════════════
      if (runtimeResult?.diagEvent === 'STT_EMPTY_LLM_RECOVERY') {
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          await CallTranscriptV2.appendTurns(companyID, callSid, [{
            speaker: 'system',
            kind: 'STT_EMPTY_LLM_RECOVERY',
            text: 'Empty STT Protocol — LLM re-engagement response generated',
            turnNumber,
            ts: new Date().toISOString(),
            sourceKey: 'emptysttprotocol',
            trace: {
              protocol: 'emptysttprotocol',
              callerName: persistedState?.callerName || null,
              hadCallContext: !!(persistedState?.agent2?.callContext),
              hadIssueSummary: !!(persistedState?.agent2?.callContext?.issue?.summary),
              responsePreview: responseText?.substring(0, 100) || null,
            }
          }], { from: fromNumber || null, to: req.body.To || null });
        } catch (sttProtoTranscriptErr) {
          // Non-blocking — don't crash the response pipeline
          logger.warn('[V2TWILIO] Failed to log STT_EMPTY_LLM_RECOVERY transcript (non-blocking)', {
            callSid: callSid?.slice(-8),
            error: sttProtoTranscriptErr.message
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // LLM HANDOFF CONFIRMED — Transcript Entry (llmhandoff)
      // ═══════════════════════════════════════════════════════════════════════════
      // When PATH 1.5 confirms booking intent, log a system transcript turn so
      // the Call Review Console shows the transition from discovery to booking.
      // ═══════════════════════════════════════════════════════════════════════════
      if (runtimeResult?.diagEvent === 'LLM_HANDOFF_CONFIRMED') {
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          await CallTranscriptV2.appendTurns(companyID, callSid, [{
            speaker: 'system',
            kind: 'LLM_HANDOFF_CONFIRMED',
            text: 'LLM Handoff — caller confirmed booking intent, transitioning to BookingLogicEngine',
            turnNumber,
            ts: new Date().toISOString(),
            sourceKey: 'llmhandoff',
            trace: {
              protocol: 'llmhandoff',
              fromPath: 'LLM_AGENT_NO_MATCH',
              toMode: 'BOOKING',
            }
          }], { from: fromNumber || null, to: req.body.To || null });
        } catch (handoffTranscriptErr) {
          // Non-blocking — don't crash the response pipeline
          logger.warn('[V2TWILIO] Failed to log LLM_HANDOFF_CONFIRMED transcript (non-blocking)', {
            callSid: callSid?.slice(-8),
            error: handoffTranscriptErr.message
          });
        }
      }

      let audioUrl = null;
      let ttsLatencyMs = null;
      const T_audioBlock = Date.now();

      // Apr 2026: Cache layers (InstantAudioService, BridgeAudioService) hold
      // ElevenLabs-rendered MP3s. When a tenant flips primary provider to Polly,
      // a cache hit would play the *old* EL audio with the wrong voice — wrong.
      // Gate every cache lookup on EL primary so Polly tenants always cache-miss,
      // routing through TTSProviderRouter → emit Say with the tenant's Polly voice.
      const _isElPrimaryCache = getPrimaryProvider(company) === 'elevenlabs';

      try {
        const isGreetingIntercept = runtimeResult?.matchSource === 'GREETING_INTERCEPTOR' || runtimeResult?.matchSource === 'GREETING';
        if (!audioUrl && _isElPrimaryCache && isGreetingIntercept && elevenLabsVoice && responseText) {
          const status = InstantAudioService.getStatus({
            companyId: companyID,
            kind: 'GREETING_RULE',
            text: responseText,
            voiceSettings
          });

          if (status.exists) {
            audioUrl = `${getSecureBaseUrl(req)}${status.url}`;
            localVoiceProviderUsed = 'instant_audio_cache';
            _fastPathResolve?.();  // Smart bridge: skip bridge delay, audio ready now
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

      // ── INSTANT AUDIO: Pre-cached trigger response (disk, fastest path) ──
      // Gated on EL primary — Polly tenants skip cache so they don't play stale EL audio.
      try {
        const isTriggerHit = runtimeResult?.triggerCard && runtimeResult?.matchSource === 'AGENT2_DISCOVERY';
        if (!audioUrl && _isElPrimaryCache && isTriggerHit && responseText) {
          const InstantAudioService = require('../services/instantAudio/InstantAudioService');
          const iaStatus = InstantAudioService.getStatus({
            companyId: companyID,
            kind: 'TRIGGER_RESPONSE',
            text: responseText,
            voiceSettings
          });

          if (iaStatus.exists) {
            audioUrl = `${getSecureBaseUrl(req)}${iaStatus.url}`;
            localVoiceProviderUsed = 'instant_audio_trigger';
            vd_audioUrlPresent = true;
            vd_preflightPassed = true;
            _fastPathResolve?.();  // Smart bridge: skip bridge delay, audio ready now

            if (CallLogger) {
              CallLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'INSTANT_AUDIO_TRIGGER_HIT',
                turn: turnNumber,
                data: {
                  triggerCardId: runtimeResult?.triggerCard?.id || null,
                  triggerCardLabel: runtimeResult?.triggerCard?.label || null,
                  fileName: iaStatus.fileName,
                  url: iaStatus.url,
                  matchSource: runtimeResult?.matchSource || null
                }
              }).catch(() => {});
            }
          } else {
            // BRIDGE-SKIP FIX: Trigger card matched but audio not pre-cached.
            // Fire fast-path signal so the race skips the 200ms bridge delay.
            // Outer scope awaits computeTurnPromise (which continues to synthesize audio).
            // Twilio webhook timeout is 15s — ElevenLabs synthesis (~300-500ms) is well within budget.
            _fastPathResolve?.();
            if (CallLogger) {
              CallLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'TRIGGER_BRIDGE_SKIPPED',
                turn: turnNumber,
                data: {
                  triggerCardId: runtimeResult?.triggerCard?.id || null,
                  triggerCardLabel: runtimeResult?.triggerCard?.label || null,
                  reason: 'trigger_match_no_instant_audio',
                  matchSource: runtimeResult?.matchSource || null
                }
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        logger.warn('[V2 RESPOND] Instant audio trigger cache check failed', { error: e.message });
      }

      // ── INSTANT AUDIO: Pre-cached text-hash response (disk, zero-latency path) ──
      // Fires for KC, Booking, and Turn1 responses. Only prompts that were pre-generated
      // via preview-fixed-audio will have a matching hash on disk — all others return
      // exists:false and fall through silently to ElevenLabs. Cost: ~0.1ms synchronous file stat.
      //
      // audioHintText: KC Fixed Response appends a booking CTA after variable
      // resolution — the CTA changes the text-hash so the pre-cached audio
      // (generated from section content ONLY) wouldn't match. audioHintText
      // carries the resolved content WITHOUT the CTA for correct hash lookup.
      try {
        const isPreCachedAudioCandidate = [
          'KC_ENGINE',
          'BOOKING_LOGIC_ENGINE',
          'TURN1_ENGINE',
        ].includes(runtimeResult?.matchSource) && responseText;
        // Gated on EL primary — Polly tenants skip cache (would play stale EL audio).
        if (!audioUrl && _isElPrimaryCache && isPreCachedAudioCandidate) {
          const InstantAudioService = require('../services/instantAudio/InstantAudioService');
          const audioHashText = runtimeResult?.audioHintText || responseText;
          const kcStatus = InstantAudioService.getStatus({
            companyId:    companyID,
            kind:         'KC_RESPONSE',
            text:         audioHashText,
            voiceSettings,
          });

          if (kcStatus.exists) {
            const kcSafeUrl        = kcStatus.url.replace('/audio/', '/audio-safe/');
            audioUrl               = `${getSecureBaseUrl(req)}${kcSafeUrl}`;
            localVoiceProviderUsed = 'instant_audio_kc';
            vd_audioUrlPresent     = true;
            vd_preflightPassed     = true;
            _fastPathResolve?.();  // Smart bridge: skip delay — audio is ready now

            if (CallLogger) {
              CallLogger.logEvent({
                callId:    callSid,
                companyId: companyID,
                type:      'INSTANT_AUDIO_TEXT_HASH_HIT',
                turn:      turnNumber,
                data: {
                  fileName:    kcStatus.fileName,
                  url:         kcStatus.url,
                  matchSource: runtimeResult?.matchSource || 'KC_ENGINE',
                }
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        logger.warn('[V2 RESPOND] Instant audio KC cache check failed', { error: e.message });
      }

      try {
        const isAgent2Discovery = runtimeResult?.matchSource === 'AGENT2_DISCOVERY';
        const agent2AudioUrl = runtimeResult?.audioUrl;
        // Gated on EL primary — agent2 audio URL was synthesized with EL voice
        // at admin-save time; Polly tenants skip it and re-route through the router.
        if (!audioUrl && _isElPrimaryCache && isAgent2Discovery && agent2AudioUrl) {
          vd_audioUrlPresent = true;
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
            // V-FIX: HTTP URLs must be validated — a stale/unreachable URL
            // would block ElevenLabs synthesis and fall through to Twilio <Say>.
            const { isAudioUrlReachable } = require('../utils/audioUrlPreflight');
            audioFileExists = await isAudioUrlReachable(agent2AudioUrl, { timeoutMs: 2000 });

            if (!audioFileExists) {
              logger.warn('[V2 RESPOND] HTTP audio URL preflight FAILED', {
                url: agent2AudioUrl.substring(0, 120),
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
                    reason: 'http_url_unreachable',
                    triggerCardId: runtimeResult?.triggerCard?.id,
                    triggerCardLabel: runtimeResult?.triggerCard?.label,
                    fallbackAction: 'will_use_tts'
                  }
                }).catch(() => {});
              }
            }
          }

          if (audioFileExists) {
            audioUrl = agent2AudioUrl.startsWith('http')
              ? agent2AudioUrl
              : `${getSecureBaseUrl(req)}${agent2AudioUrl}`;
            localVoiceProviderUsed = 'instant_audio_agent2';
            vd_preflightPassed = true;
            _fastPathResolve?.();  // Smart bridge: skip bridge delay, audio ready now

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
          } else {
            vd_preflightPassed = false;
            if (CallLogger) {
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
        }
      } catch (e) {
        logger.warn('[V2 RESPOND] Agent2 instant audio check failed', { error: e.message });
      }

      // ── Provider-aware say voice (computed once for this turn) ──────────
      // Apr 2026: tenant chooses Polly voice in admin UI; respect it on every
      // <Say> fallback path. getPollyFallbackVoice handles null company / stale
      // voiceId / unset preference and returns the platform default last-resort.
      const _localSayVoice = getPollyFallbackVoice(company);
      const _isElPrimaryFinal = getPrimaryProvider(company) === 'elevenlabs';

      // ── Time-budget guard: skip ElevenLabs if webhook time nearly blown ──
      // Twilio hard-kills webhooks at 15s. ElevenLabs typically takes 2-5s.
      // If we've already burned 12s+ on company load + LLM + events, attempting
      // TTS will almost certainly push us past 15s → "application error".
      // Fall through to the tenant's Polly <Say> fallback instead.
      // (Polly-primary tenants always skip the EL synth too — the router is
      //  the source of truth for "is EL even being attempted on this call".)
      const _elapsedBeforeTts = Date.now() - T0;
      if (!audioUrl && _isElPrimaryFinal && elevenLabsVoice && responseText && _elapsedBeforeTts >= 12000) {
        logger.warn('[V2 RESPOND] Time-budget guard: skipping ElevenLabs TTS', {
          callSid, turn: turnNumber, elapsedMs: _elapsedBeforeTts,
          reason: 'Webhook time budget nearly exhausted (>=12s). Falling back to Polly <Say>.'
        });
        if (CallLogger) {
          CallLogger.logEvent({
            callId: callSid, companyId: companyID, type: 'TTS_SKIPPED_TIME_BUDGET',
            turn: turnNumber,
            data: { elapsedMs: _elapsedBeforeTts, threshold: 12000, sayVoice: _localSayVoice }
          }).catch(() => {});
        }
        localVoiceProviderUsed = 'polly_time_budget_guard';
        vd_elevenLabsAttempted = false;
        // audioUrl stays null → falls through to <Say> with tenant's Polly voice
      }

      if (!audioUrl && responseText && localVoiceProviderUsed !== 'polly_time_budget_guard') {
        // Apr 2026: route through TTSProviderRouter — single source of truth
        // for tenant-chosen provider. Polly-primary tenants get Polly directly;
        // EL-primary tenants attempt EL and the router auto-falls-through to
        // Polly on any classified failure (timeout/circuit_open/quota/etc.).
        // Forensic accuracy: localVoiceProviderUsed reflects what the caller
        // actually heard — never lies about which provider rendered the audio.
        vd_elevenLabsAttempted = _isElPrimaryFinal;
        const ttsStartTime = Date.now();
        try {
          if (CallLogger) {
            CallLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'TTS_STARTED',
              turn: turnNumber,
              data: {
                primaryProvider: _isElPrimaryFinal ? 'elevenlabs' : 'polly',
                voiceId: _isElPrimaryFinal ? (elevenLabsVoice || null) : null,
                pollySayVoice: _localSayVoice,
                textLength: responseText.length
              }
            }).catch(() => {});
          }

          const tts = await TTSProviderRouter.synthesize({
            text: responseText,
            company,
            callSid,
            ttsSource: 'answer_fallback'
          });

          ttsLatencyMs = Date.now() - ttsStartTime;

          if (tts && tts.kind === 'buffer') {
            // ElevenLabs success — write file, emit <Play>.
            const fileName       = `ai_respond_${callSid}_${Date.now()}.mp3`;
            const audioDir       = path.join(__dirname, '../public/audio');
            await fs.promises.mkdir(audioDir, { recursive: true });  // no-op if already exists
            const aiRespondPath  = path.join(audioDir, fileName);
            await fs.promises.writeFile(aiRespondPath, tts.audio);
            scheduleTempAudioDelete(aiRespondPath);

            audioUrl = `https://${hostHeader}/audio/${fileName}`;
            localVoiceProviderUsed = 'elevenlabs';
            vd_elevenLabsSuccess = true;

            if (CallLogger) {
              CallLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'TTS_COMPLETED',
                turn: turnNumber,
                data: {
                  provider: 'elevenlabs',
                  voiceId: elevenLabsVoice || null,
                  latencyMs: ttsLatencyMs
                }
              }).catch(() => {});
            }
          } else if (tts && tts.kind === 'polly') {
            // Polly path — either tenant-chosen primary OR EL→Polly auto-fallback.
            // audioUrl stays null so the gather.say(_localSayVoice) path runs.
            // sourceProvider tells us forensically which case fired.
            localVoiceProviderUsed = (tts.sourceProvider === 'polly-fallback' || tts.sourceProvider === 'polly_fallback')
              ? 'polly_fallback'
              : 'polly';
            vd_elevenLabsSuccess = false; // even on EL primary, EL did not produce audio

            if (CallLogger) {
              CallLogger.logEvent({
                callId: callSid,
                companyId: companyID,
                type: 'TTS_COMPLETED',
                turn: turnNumber,
                data: {
                  provider: localVoiceProviderUsed,
                  voice: tts.voice || _localSayVoice,
                  fallbackReason: tts.fallbackReason || null,
                  latencyMs: ttsLatencyMs
                }
              }).catch(() => {});
            }
          } else {
            // Router returned an unknown shape — should not happen, but fail
            // safe by leaving audioUrl null so the <Say> path emits the response.
            logger.warn('[V2 RESPOND] TTSProviderRouter returned unexpected descriptor', {
              callSid: callSid?.slice(-8), kind: tts?.kind || 'undefined'
            });
            localVoiceProviderUsed = 'twilio_say';
          }
        } catch (ttsError) {
          // Router rarely throws (it catches & falls back internally), but if it
          // does, leave audioUrl null and emit Say with the tenant's Polly voice.
          logger.error('[V2 RESPOND] TTSProviderRouter threw', {
            callSid: callSid?.slice(-8),
            error: ttsError.message
          });

          if (CallLogger) {
            CallLogger.logEvent({
              callId: callSid,
              companyId: companyID,
              type: 'TTS_FAILED',
              turn: turnNumber,
              data: { error: ttsError.message, fallback: 'twilio_say', sayVoice: _localSayVoice }
            }).catch(() => {});
          }
          localVoiceProviderUsed = 'twilio_say';
        }
      }

      timings.audioBlockMs = Date.now() - T_audioBlock;

      const T_twimlBuild = Date.now();
      const twiml = new twilio.twiml.VoiceResponse();

      // SPEECH DETECTION: read admin-configured settings (Agent 2.0 panel).
      // agent2.speechDetection is the authoritative path. voiceSettings is legacy fallback.
      // MUST be declared before gatherTimeout which reads speechDet.initialTimeout.
      const speechDet = company.aiAgentSettings?.agent2?.speechDetection
        || company.aiAgentSettings?.voiceSettings?.speechDetection
        || {};

      // PATIENCE MODE: When caller asked to hold/wait, extend the silence
      // timeout so we don't interrupt them. Uses UI-configured timeout.
      const patienceCfg = company?.aiAgentSettings?.agent2?.discovery?.patienceSettings || {};
      const isPatienceMode = runtimeResult?.patienceMode === true
        || persistedState?.agent2?.discovery?.patienceMode === true;
      const patienceTimeout = Math.max(10, Math.min(180, parseInt(patienceCfg.timeoutSeconds) || 45));
      // Use admin-configured initialTimeout (agent2.html → "Initial Wait (s)").
      // Fallback to 7s for companies that haven't configured it yet.
      const adminInitialTimeout = speechDet.initialTimeout ?? 7;
      const gatherTimeout = isPatienceMode ? patienceTimeout : adminInitialTimeout;

      if (isPatienceMode && CallLogger) {
        CallLogger.logEvent({
          callId: callSid, companyId: companyID,
          type: 'PATIENCE_MODE_ACTIVE',
          turn: turnNumber,
          data: { timeout: gatherTimeout, reason: 'Caller requested hold/wait' }
        }).catch(() => {});
      }

      // FOLLOW-UP MODE: When a pending follow-up question is active, use a
      // fixed 2s speechTimeout so Twilio doesn't cut off mid-sentence pauses.
      // Otherwise use the admin-configured value via _speechTimeout(company).
      const hasPendingFollowUp = !!persistedState?.agent2?.discovery?.pendingFollowUpQuestion;
      const speechTimeoutValue = _speechTimeout(company, { pendingFollowUp: hasPendingFollowUp });

      // ── BOOKING HANDOFF REDIRECT ──────────────────────────────────────────────
      // When this turn JUST transitioned to BOOKING mode (HANDOFF_BOOKING fired),
      // the agent played "great, one moment — let me pull up our schedule."
      // Instead of a Gather (which would sit silent for 7s waiting for the caller
      // to speak), immediately Redirect to v2-agent-respond so BookingLogicEngine
      // fires and ASKS the first question (name/phone) without any dead-air gap.
      //
      // Guards: persistedState has BOOKING but callState (previous turn) did NOT.
      // This ensures the Redirect only fires once — on the transition turn — and
      // subsequent BOOKING turns get normal Gather so the caller can respond.
      // ─────────────────────────────────────────────────────────────────────────
      const wasBookingBefore = (callState?.sessionMode === 'BOOKING' || callState?.lane === 'BOOKING');
      const isBookingNow     = (persistedState?.sessionMode === 'BOOKING' || persistedState?.lane === 'BOOKING');
      const justTransitionedToBooking = isBookingNow && !wasBookingBefore;

      // ── TRANSFER: justTransitionedToTransfer flag set by KC GATE 0.5 or SmartInterceptor
      // transferTarget is an E.164 phone string (legacy) or we pull it from transferMeta.
      const justTransitionedToTransfer = persistedState?.justTransitionedToTransfer === true;

      // ── CALLER SCREENING: speak response then end the call ────────────────────
      // Set when Agent2DiscoveryRunner's caller screening gate intercepts a
      // non-customer caller (VENDOR_SALES, DELIVERY, WRONG_NUMBER).
      // Play/say the screening message and hang up — no Gather, no booking.
      if (persistedState?.endCallAfterResponse === true) {
        if (audioUrl) twiml.play(audioUrl);
        else twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(responseText));
        twiml.hangup();

        if (CallLogger && callSid) {
          CallLogger.logEvent({
            callId: callSid, companyId: companyID,
            type: 'CALLER_SCREENING_HANGUP',
            turn: turnNumber,
            data: { reason: 'endCallAfterResponse — caller screening intercept' }
          }).catch(() => {});
        }

      } else if (justTransitionedToTransfer) {
        // ── TRANSFER HANDOFF ──────────────────────────────────────────────────
        // Set by KC GATE 0.5 (KCTransferIntentDetector) or SmartInterceptor.
        // transferTarget is an E.164 phone string or null if no number is configured.
        // transferMeta carries enriched routing context (name, mode, overflow).
        //
        // Flow: say announcement (if any) → dial transferTarget.
        // If no phone number configured: play fallback and hang up gracefully.
        // ─────────────────────────────────────────────────────────────────────
        const transferPhone = persistedState?.transferTarget || null;
        const transferMeta  = persistedState?.transferMeta  || {};
        const transferMode  = transferMeta.mode || 'warm';

        // Speak the transfer announcement first (e.g. "I'm connecting you now…")
        if (responseText && responseText.trim()) {
          if (audioUrl) twiml.play(audioUrl);
          else twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(responseText));
        }

        if (transferPhone) {
          // ── Execute the dial ────────────────────────────────────────────────
          logger.info('[V2TWILIO] 🔀 Transfer dialing', {
            callSid: callSid?.slice(-8),
            destName: transferMeta.name,
            mode: transferMode,
            hasPhone: true,
            hasContextBrief: !!transferMeta.contextBrief,
          });

          // Build caller ID: use the company's Twilio number (From on the inbound
          // leg) so the receiving agent sees the business number, not the caller's.
          const dialCallerId = company?.twilioPhoneNumber
            || company?.aiAgentSettings?.twilioPhoneNumber
            || null;

          const dialOpts = {
            timeout:  30,
            action:   `${getSecureBaseUrl(req)}/api/twilio/status-callback/${companyID}`,
            ...(dialCallerId ? { callerId: dialCallerId } : {}),
          };
          const dialVerb = twiml.dial(dialOpts);

          // ── Warm transfer: whisper context brief to receiving agent ──────────
          // For warm transfers with a contextBrief, store the brief in Redis and
          // attach a whisper URL to <Number>. Twilio calls the URL and plays the
          // response to the RECEIVING agent before connecting the caller.
          // Cold transfers skip this — agent is bridged directly with no brief.
          if (transferMode === 'warm' && transferMeta.contextBrief) {
            getSharedRedisClient()
              .then(r => r?.set(
                `transfer-brief:${companyID}:${callSid}`,
                transferMeta.contextBrief,
                'EX', 300
              ))
              .catch(() => {});

            const whisperUrl = `${getSecureBaseUrl(req)}/api/twilio/transfer-whisper/${companyID}/${encodeURIComponent(callSid)}`;
            dialVerb.number({ url: whisperUrl }, transferPhone);
          } else {
            dialVerb.number(transferPhone);
          }

          if (CallLogger && callSid) {
            CallLogger.logEvent({
              callId: callSid, companyId: companyID,
              type: 'TRANSFER_DIAL_INITIATED',
              turn: turnNumber,
              data: {
                destName:  transferMeta.name       || null,
                destId:    transferMeta.destinationId || null,
                mode:      transferMode,
                urgency:   transferMeta.urgency     || 'normal',
                department: transferMeta.department || null,
              }
            }).catch(() => {});
          }

        } else {
          // ── No phone number configured — play overflow and hang up ──────────
          const fallbackMsg = transferMeta.overflowMessage
            || "I'm sorry, I'm unable to connect you right now. Please call back and we'll make sure someone assists you.";

          logger.info('[V2TWILIO] Transfer: no phone number configured — overflow fallback', {
            callSid: callSid?.slice(-8), destName: transferMeta.name,
          });

          twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML(fallbackMsg));
          twiml.hangup();

          if (CallLogger && callSid) {
            CallLogger.logEvent({
              callId: callSid, companyId: companyID,
              type: 'TRANSFER_NO_PHONE_OVERFLOW',
              turn: turnNumber,
              data: { destName: transferMeta.name || null, reason: 'no_phone_number' }
            }).catch(() => {});
          }
        }

      } else if (justTransitionedToBooking) {
        // Play consent YES response, then booking bridge phrase, then redirect.
        // BookingLogicEngine fires on the redirect and immediately asks its
        // first question — no dead-air gap waiting for caller input.
        // Apr 2026: Say voice is the tenant's chosen Polly voice, not platform default.
        if (audioUrl) twiml.play(audioUrl);
        else twiml.say({ voice: _localSayVoice }, escapeTwiML(responseText));

        // Play Booking Bridge phrase ("Alright, lets get that scheduled for you..")
        // configured in Agent 2.0 Settings → Bridge → Booking Bridge.
        // Apr 2026: BridgeAudioService is gated on EL primary — Polly tenants
        // skip the cache lookup so we always emit Say with the tenant's voice.
        const bookingBridgePhrase = (bridgeCfg.bookingBridgePhrase || '').trim();
        if (bookingBridgePhrase) {
          const BridgeAudioService = require('../services/bridgeAudio/BridgeAudioService');
          const bookingBridgeAudio = _isElPrimaryFinal ? BridgeAudioService.getAudioUrl({
            companyId: companyID,
            text: bookingBridgePhrase,
            voiceSettings: company?.aiAgentSettings?.voiceSettings || {},
            hostHeader
          }) : null;
          if (bookingBridgeAudio) {
            twiml.play(bookingBridgeAudio);
          } else {
            twiml.say({ voice: _localSayVoice }, escapeTwiML(bookingBridgePhrase));
          }
        }

        twiml.redirect({ method: 'POST' }, `${getSecureBaseUrl(req)}/api/twilio/v2-agent-respond/${companyID}`);

        if (CallLogger && callSid) {
          CallLogger.logEvent({
            callId: callSid, companyId: companyID,
            type: 'BOOKING_HANDOFF_REDIRECT',
            turn: turnNumber,
            data: { reason: 'Transitioned to BOOKING lane — redirecting immediately so BookingLogicEngine asks first question' }
          }).catch(() => {});
        }
      } else {
        // Normal path: Gather so caller can respond to agent's question
        const gather = twiml.gather({
          input: 'speech',
          action: `/api/twilio/v2-agent-respond/${companyID}`,
          method: 'POST',
          actionOnEmptyResult: true,
          timeout: gatherTimeout,
          speechTimeout: speechTimeoutValue,
          bargeIn: speechDet.bargeIn ?? false,
          enhanced: speechDet.enhancedRecognition ?? true,
          speechModel: speechDet.speechModel || 'phone_call',
          partialResultCallback: `https://${hostHeader}/api/twilio/v2-agent-partial/${companyID}`,
          partialResultCallbackMethod: 'POST'
        });

        // ── RESPONSE TIMING — UI-configurable thinking pause ──────────────
        // personalitySystem.conversationPatterns.thinkingTime (0-3 seconds)
        // Adds a brief pause before the agent speaks so it feels more human.
        // 'immediate' = 0s, 'brief' = thinkingTime, 'thoughtful' = thinkingTime
        // Only fires on non-bridge paths (bridge already has natural delay).
        // Read from agent2.personalitySystem (PATCH endpoint saves here) → fallback to top-level schema path.
        const _convPatternsAgent2 = company?.aiAgentSettings?.agent2?.personalitySystem?.conversationPatterns;
        const _convPatternsTop    = company?.aiAgentSettings?.personalitySystem?.conversationPatterns;
        const _convPatterns       = _convPatternsAgent2 || _convPatternsTop || {};
        const _convPatternsPath   = _convPatternsAgent2
          ? 'aiAgentSettings.agent2.personalitySystem.conversationPatterns'
          : (_convPatternsTop ? 'aiAgentSettings.personalitySystem.conversationPatterns' : 'NONE');
        const _responseDelay = _convPatterns.responseDelay || 'brief';
        const _thinkingTime = Math.min(3, Math.max(0, Number(_convPatterns.thinkingTime) || 0));
        const _pauseFired   = (_responseDelay !== 'immediate' && _thinkingTime > 0);
        if (_pauseFired) {
          gather.pause({ length: _thinkingTime });
        }

        // ── FORENSICS: log resolved conversation-patterns so silent mis-config surfaces in audits
        if (CallLogger && callSid) {
          CallLogger.logEvent({
            callId: callSid, companyId: companyID,
            type: 'CONV_PATTERNS_RESOLVED',
            turn: turnNumber,
            data: {
              resolvedPath:    _convPatternsPath,
              responseDelay:   _responseDelay,
              thinkingTime:    _thinkingTime,
              pauseFired:      _pauseFired,
              rawThinkingTime: _convPatterns.thinkingTime ?? null,
              rawResponseDelay:_convPatterns.responseDelay ?? null
            }
          }).catch(() => {});
        }

        // Apr 2026: Say voice is the tenant's chosen Polly voice, not platform default.
        if (audioUrl) gather.play(audioUrl);
        else gather.say({ voice: _localSayVoice }, escapeTwiML(responseText));

        // ── BUG-28 FIX: Overwrite preflight gather config with accurate post-LLM values ──
        // Correct patience timeout and pendingFollowUp speechTimeout now that we have runtimeResult.
        if (redis && callSid) {
          redis.set(`a2sentence:gather:${callSid}:${turnNumber}`, JSON.stringify({
            action:         `/api/twilio/v2-agent-respond/${companyID}`,
            timeout:        gatherTimeout,
            speechTimeout:  speechTimeoutValue,
            bargeIn:        speechDet.bargeIn ?? false,
            enhanced:       speechDet.enhancedRecognition ?? true,
            speechModel:    speechDet.speechModel || 'phone_call',
            hostHeader,
            companyID,
            voiceSettings:  _sentenceVoiceSettings,
            voiceId:        elevenLabsVoice || null,
          }), { EX: 120 }).catch(() => {});
        }
      }

      // V-FIX: Voice decision audit log
      logVoiceDecision(CallLogger, {
        callSid, companyId: companyID, turnNumber,
        decision: {
          responseSource: runtimeResult?.matchSource === 'AGENT2_DISCOVERY' ? 'T1_CARD' : 'T2_LLM',
          desiredProvider: elevenLabsVoice ? 'elevenlabs' : 'twilio',
          audioUrlPresent: vd_audioUrlPresent,
          audioUrlPreflightPassed: vd_preflightPassed,
          elevenLabsAttempted: vd_elevenLabsAttempted,
          elevenLabsSuccess: vd_elevenLabsSuccess,
          finalTwimlVerb: audioUrl ? 'PLAY' : 'SAY',
          fallbackReasonCode: audioUrl ? 'NONE'
            : (!vd_elevenLabsAttempted && vd_audioUrlPresent) ? 'ELEVENLABS_SKIPPED_STALE_AUDIOURL'
            : (vd_elevenLabsAttempted && !vd_elevenLabsSuccess) ? 'ELEVENLABS_TTS_FAILED'
            : !elevenLabsVoice ? 'NO_ELEVENLABS_CONFIGURED'
            : 'FINAL_FALLBACK_TWILIO_SAY'
        }
      });

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
        const isLlmGenerated = runtimeResult?.matchSource === 'LLM_AGENT';
        const provType = isUiOwned ? 'UI_OWNED' : isLlmGenerated ? 'LLM_GENERATED' : 'HARDCODED';
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
            // Forensic provider — what actually rendered the audio the caller heard.
            provider: localVoiceProviderUsed,
            // The voiceId is meaningful only for ElevenLabs. For Polly paths the
            // voice is the tenant's pollyVoiceId; for fallback Say it's _localSayVoice.
            voiceId: (localVoiceProviderUsed === 'elevenlabs')
              ? (company?.aiAgentSettings?.voiceSettings?.voiceId || null)
              : null,
            sayVoice: (audioUrl ? null : _localSayVoice)
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

        // ── Stamp lastResponse for LAP repeat_last ────────────────────────────
        // Every agent response — Turn1, KC, Booking, Groq — must update
        // CallSummary.liveProgress.lastResponse so LAP repeat_last can replay it.
        // ConversationEngine does this internally but Turn1Engine/KC bypass it.
        if (responseText && responseText.trim()) {
          try {
            const _CSforLR = require('../models/CallSummary');
            await _CSforLR.updateLiveProgress(callSid, {
              lastResponse: responseText.trim().substring(0, 500),
            });
          } catch (_lrErr) {
            // Non-fatal: LAP repeat will use fallback if this fails
          }
        }

        // Canonical Mongo: persist turns DURING the call (CallTranscriptV2).
        try {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');

          // Safety net: re-write caller turn only if the primary write failed.
          // callerTurnWriteOk is set to true after a successful primary write above.
          // Guarding here prevents duplicate transcript entries on every successful turn.
          if (callerTurn && callerTurn.text && !callerTurnWriteOk) {
            await CallTranscriptV2.appendTurns(companyID, callSid, [
              {
                speaker: 'caller',
                kind: 'CONVERSATION_CALLER',
                text: callerTurn.text,
                turnNumber: callerTurn.turn,
                ts: callerTurn.timestamp,
                sourceKey: 'stt',
                trace: { inputTextSource, safetyNet: true }
              }
            ]).catch(err => {
              logger.warn('[V2TWILIO] Caller turn safety-net write failed', {
                callSid: callSid?.slice(-8), error: err.message
              });
            });
          }

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
                traceRunId: req.session?.traceRunId || null,
                // ⬇️ KC containerId lives here — callIntelligence.js reads trace.kcTrace.containerId
                // to resolve kcCard. Without this the KC card is always null in the turn log.
                kcTrace: runtimeResult?.kcTrace || null,
              }
            }
          ];

          await CallTranscriptV2.appendTurns(companyID, callSid, turnsToAppendV2, {
            from: fromNumber || null,
            to: req.body.To || null
          });

          // Telephony action for this turn (what was actually played to the caller).
          // DEDUP FIX: Skip this log when the bridge path is active — bridge-continue logs TWIML_PLAY
          // instead, after it actually plays the audio. Both logging it would double the entry in
          // spokenLines. The bridge guard key is set at ~200ms when delay wins the race; this IIFE
          // always finishes >200ms later, so the check is reliable.
          const _twimlLogBridgeKey = `a2bridge:turn:${callSid}:${turnNumber}`;
          const _bridgeIsActive = !!(redis && await redis.get(_twimlLogBridgeKey).catch(() => null));
          if (!_bridgeIsActive) {
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
          }

          // Consent gate diagnostic: log the follow-up consent decision to transcript.
          // GUARD: only write when lastPath CHANGED this turn.
          // agent2.discovery.lastPath is set to 'FOLLOWUP_YES_HANDOFF_BOOKING' when the
          // caller first says YES and is carried unchanged through all subsequent booking
          // turns. Without this guard, a CONSENT_GATE_BOOKING entry is written on every
          // booking turn (3–10 phantom entries per call that pollute the transcript).
          const prevLastPath    = callState?.agent2?.discovery?.lastPath || '';
          const runtimeLastPath = persistedState?.agent2?.discovery?.lastPath || '';
          const isFollowUpPath  = runtimeLastPath.startsWith('FOLLOWUP_') && runtimeLastPath !== prevLastPath;
          if (isFollowUpPath) {
            const consentCardId = persistedState?.agent2?.discovery?.lastTriggerId || null;
            const consentCardLabel = persistedState?.agent2?.discovery?.lastTriggerLabel || null;
            const consentBucket = runtimeLastPath.replace('FOLLOWUP_', '').replace('_HANDOFF_BOOKING', '');
            const isBookingHandoff = runtimeLastPath === 'FOLLOWUP_YES_HANDOFF_BOOKING';
            const consentKind = isBookingHandoff ? 'CONSENT_GATE_BOOKING' : `CONSENT_GATE_${consentBucket}`;

            const CONSENT_DESCRIPTIONS = {
              'YES_HANDOFF_BOOKING': 'Caller confirmed YES → handing off to Booking Logic',
              'YES': 'Caller confirmed YES → continuing conversation',
              'NO': 'Caller declined → continuing conversation',
              'REPROMPT': 'Caller unclear → re-asking the follow-up question',
              'HESITANT': 'Caller hesitant → gentle clarification + re-asking',
              'COMPLEX': 'Caller gave substantive response → routing to normal agent'
            };

            await CallTranscriptV2.appendTurns(companyID, callSid, [
              {
                speaker: 'system',
                kind: consentKind,
                text: CONSENT_DESCRIPTIONS[consentBucket] || `Follow-up consent: ${consentBucket}`,
                turnNumber,
                ts: new Date(),
                sourceKey: 'followup_consent_gate',
                trace: {
                  provenance: {
                    type: 'UI_OWNED',
                    uiPath: 'triggers',
                    reason: `followup_consent_${consentBucket.toLowerCase()}`,
                    voiceProviderUsed: localVoiceProviderUsed
                  },
                  consentGate: {
                    bucket: consentBucket,
                    decision: isBookingHandoff ? 'HANDOFF_BOOKING' : consentBucket,
                    previousMode: isBookingHandoff ? 'DISCOVERY' : null,
                    nextMode: isBookingHandoff ? 'BOOKING' : null,
                    cardId: consentCardId,
                    cardLabel: consentCardLabel
                  }
                }
              }
            ]);
          }

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
      timings.twimlBuildMs = Date.now() - T_twimlBuild;
      timings.totalMs = Date.now() - T0;

      return {
        twimlString: outTwimlString,
        voiceProviderUsed: localVoiceProviderUsed,
        responseText,
        matchSource: runtimeResult.matchSource,
        timings: {
          companyLoadMs: timings.companyLoadMs || 0,
          stateLoadMs: timings.stateLoadMs || 0,
          coreRuntimeMs: timings.coreRuntimeMs || 0,
          eventFlushMs: timings.eventFlushMs || 0,
          audioBlockMs: timings.audioBlockMs || 0,
          ttsMs: timings.ttsMs || 0,
          twimlBuildMs: timings.twimlBuildMs || 0,
          totalMs: timings.totalMs || 0
        },
        agentTurnForCache: (responseText && responseText.trim()) ? {
          text: responseText.trim(),
          turnNumber,
          sourceKey: runtimeResult?.matchSource || 'UNKNOWN',
          provenance: (() => {
            // ═══════════════════════════════════════════════════════════════════════════
            // PROVENANCE DETERMINATION - WHITELIST-BASED (NOT HARDCODED UNLESS PROVEN)
            // ═══════════════════════════════════════════════════════════════════════════
            // UI_OWNED sources: any matchSource that resolves text from UI config
            // ═══════════════════════════════════════════════════════════════════════════
            const UI_DRIVEN_SOURCES = new Set([
              'AGENT2_DISCOVERY',
              'AGENT2_LLM_FALLBACK',
              'AGENT2_GREETING',
              'AGENT2_TRIGGER_MATCH',
              'AGENT2_PLAYBOOK',
              'AGENT2_EMPATHY',
              'AGENT2_HANDOFF',
              'BOOKING_LOGIC_ENGINE',
              'SCENARIO_MATCH',
              'UI_ERROR_FALLBACK',                    // NEW: Error fallbacks resolved from UI
              'BOOKING_LOGIC_ERROR_FALLBACK',         // Booking errors now use UI config
              'BOOKING_LOGIC_REJECTED',               // Booking rejected now uses UI config
              'BREAK_GLASS_NO_FALLBACK',              // Break glass now uses UI config
              'OPENER_ENGINE',
              'BRIDGE_LINE'
            ]);
            
            const matchSource = runtimeResult?.matchSource || null;
            const hasTriggerCard = !!runtimeResult?.triggerCard?.id;
            const hasUiPath = !!runtimeResult?.errorFallbackUiPath || !!runtimeResult?.uiPath;
            
            const isUiOwned = hasTriggerCard || 
                              UI_DRIVEN_SOURCES.has(matchSource) || 
                              hasUiPath;
            
            // Determine uiPath for Call Review linking
            let uiPath = null;
            if (hasTriggerCard) {
              uiPath = 'triggers';
            } else if (runtimeResult?.errorFallbackUiPath) {
              uiPath = runtimeResult.errorFallbackUiPath;
            } else if (matchSource === 'AGENT2_DISCOVERY') {
              uiPath = 'aiAgentSettings.agent2.discovery';
            } else if (matchSource === 'UI_ERROR_FALLBACK') {
              uiPath = 'LLMSettings.callHandling.recoveryMessages';
            }
            
            const isLlmGenerated = runtimeResult?.matchSource === 'LLM_AGENT';
            const provType = isUiOwned ? 'UI_OWNED' : isLlmGenerated ? 'LLM_GENERATED' : 'HARDCODED';

            return {
              type: provType,
              uiPath,
              matchSource,
              voiceProviderUsed: localVoiceProviderUsed,
              audioUrl: audioUrl || null
            };
          })()
        } : null
      };

      } catch (computeErr) {
        // ── computeTurnPromise internal crash recovery ────────────────────────
        // Log the full error so it's visible in Render logs + Call Intelligence.
        logger.error('[V2TWILIO] computeTurnPromise internal crash — returning recovery TwiML', {
          callSid: callSid?.slice(-8),
          companyID,
          turnNumber,
          error: computeErr.message,
          stack: computeErr.stack?.substring(0, 500)
        });
        if (CallLogger && callSid) {
          CallLogger.logEvent({
            callId: callSid, companyId: companyID,
            type: 'COMPUTE_TURN_CRASH',
            turn: turnNumber,
            data: { error: computeErr.message, stack: computeErr.stack?.substring(0, 400) }
          }).catch(() => {});
        }
        // Signal fast-path so any pending race doesn't hang forever
        _fastPathResolve?.();
        // Return recovery TwiML with Gather so the call continues
        // Use UI-configured generalError message (same as ROUTE_CRASH path).
        const _rcvTwiml = new twilio.twiml.VoiceResponse();
        const _rcvSd = _getSpeechDetection(company);
        const _rcvGather = _rcvTwiml.gather({
          input: 'speech',
          action: `/api/twilio/v2-agent-respond/${companyID}`,
          method: 'POST',
          actionOnEmptyResult: true,
          timeout: _rcvSd.initialTimeout ?? 7,
          speechTimeout: _speechTimeout(company),
        });
        const _rcvText = (await getRecoveryMessage(company, 'generalError').catch(() => null))
          || 'I apologize for the interruption. Please go ahead and tell me how I can help.';
        _rcvGather.say({ voice: TWILIO_FALLBACK_VOICE }, _rcvText);
        // Persist agent turn so the crash phrase appears in call intelligence transcript
        if (callSid) {
          const CallTranscriptV2 = require('../models/CallTranscriptV2');
          CallTranscriptV2.appendTurns(companyID, callSid, [{
            speaker:    'agent',
            kind:       'CONVERSATION_AGENT',
            text:       _rcvText,
            turnNumber,
            ts:         new Date(),
            sourceKey:  'COMPUTE_CRASH',
            trace: { provenance: { type: 'HARDCODED', reason: 'compute_crash', voiceProviderUsed: 'twilio_say' }, error: computeErr.message }
          }]).catch(() => {});
        }
        return {
          twimlString: _rcvTwiml.toString(),
          voiceProviderUsed: 'twilio_say',
          responseText: _rcvText,   // set so report can display it
          matchSource: 'INTERNAL_ERROR',
          timings: { totalMs: Date.now() - T0 }
        };
      }
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

      // ── WEBHOOK_TIMING: Persist per-turn timing for Call Intelligence ──
      // Fire-and-forget — never delays TwiML delivery to Twilio.
      if (timings && callSid && companyID) {
        const _wt_totalMs = timings.totalMs
          || (timings.companyLoadMs || 0) + (timings.stateLoadMs || 0) + (timings.coreRuntimeMs || 0) + (timings.eventFlushMs || 0) + (timings.audioBlockMs || 0) + (timings.twimlBuildMs || 0);
        const CallTranscriptV2_wt = require('../models/CallTranscriptV2');
        CallTranscriptV2_wt.appendTrace(companyID, callSid, [{
          kind: 'WEBHOOK_TIMING',
          turnNumber: turnNumber,
          ts: new Date(),
          payload: {
            route: route,
            totalElapsedMs: _wt_totalMs,
            breakdown: {
              companyLoadMs: timings.companyLoadMs || 0,
              stateLoadMs: timings.stateLoadMs || 0,
              coreRuntimeMs: timings.coreRuntimeMs || 0,
              eventFlushMs: timings.eventFlushMs || 0,
              audioBlockMs: timings.audioBlockMs || 0,
              ttsMs: timings.ttsMs || 0,
              twimlBuildMs: timings.twimlBuildMs || 0,
            },
            atRisk: _wt_totalMs >= 12000,
            timedOut: _wt_totalMs >= 15000,
            voiceProviderUsed: voiceProviderUsed || null
          }
        }]).catch(() => {}); // fire-and-forget
      }
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

    // ══════════════════════════════════════════════════════════════════════════
    // V131: POST-GATHER BRIDGE — Fire bridge after fixed delay, not a race.
    // Bridge fires every turn unless compute resolves first.
    // No per-call cap. No follow-up/yes-no suppression. Per-turn dedup only.
    //
    // SMART BRIDGE: fastPathPromise short-circuits the delay for InstantAudio
    // hits. When any cached audio is detected inside computeTurnPromise,
    // _fastPathResolve fires immediately — bridge is skipped and we wait for
    // compute to finish (which completes in <10ms after fastPath signals).
    //
    // FIRST-SENTENCE STREAMING: firstSentenceAudioPromise fires when s0 TTS is
    // ready (~400-600ms). The bridge plays s0 immediately then redirects to
    // /v2-agent-sentence-continue for s1, s2... while LLM is still generating.
    // ══════════════════════════════════════════════════════════════════════════
    const delayPromise = new Promise((resolve) => setTimeout(resolve, bridgePostGatherDelayMs));
    const first = await Promise.race([
      fastPathPromise.then(() => ({ kind: 'fast' })),
      firstSentenceAudioPromise.then((r) => ({ kind: 'firstSentence', r })),
      computeTurnPromise.then((r) => ({ kind: 'result', r })),
      delayPromise.then(() => ({ kind: 'delay' }))
    ]);

    if (first.kind === 'result' || first.kind === 'fast') {
      // Compute beat the post-gather delay (or InstantAudio fast-path fired) —
      // no bridge needed, deliver response directly.
      const result = first.kind === 'result' ? first.r : await computeTurnPromise;
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

    if (first.kind === 'firstSentence' && first.r?.audioUrl) {
      // ── FIRST-SENTENCE FAST PATH ─────────────────────────────────────────
      // s0 is synthesized and ready. Play it immediately, then redirect to
      // sentence-continue for s1, s2... Caller hears audio in ~500ms.
      const { audioUrl: s0Url } = first.r;
      const sentContinueUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-sentence-continue/${companyID}?turn=${turnNumber}&token=${encodeURIComponent(preGeneratedBridgeToken)}&idx=1&callSid=${encodeURIComponent(callSid)}`;

      const s0Twiml = new twilio.twiml.VoiceResponse();
      s0Twiml.play(s0Url);
      s0Twiml.redirect({ method: 'POST' }, sentContinueUrl);
      twimlString    = s0Twiml.toString();
      voiceProviderUsed = 'elevenlabs_sentence_streaming';

      if (CallLogger) {
        CallLogger.logEvent({
          callId: callSid, companyId: companyID,
          type:   'SENTENCE_STREAM_S0_DELIVERED',
          turn:   turnNumber,
          data:   { audioUrl: s0Url, elapsedMs: Date.now() - T0 }
        }).catch(() => {});
      }

      await logTwimlSent({
        route: '/v2-agent-respond',
        twimlString, voiceProviderUsed,
        responsePreview: first.r.sentence,
        matchSource: 'SENTENCE_STREAM',
      });
      res.type('text/xml');
      return res.send(twimlString);
    }

    // Post-gather delay elapsed, compute still running — fire bridge.
    // Per-call cap: maxBridgesPerCall (default -1 = uncapped).
    // Set to 0 to disable bridges entirely. Set to a positive integer to cap.
    // Default is -1 (uncapped) so every turn gets a bridge phrase while the
    // LLM computes — prevents dead air on turns 2+.
    // Companies can override via bridgeCfg.maxBridgesPerCall in their DB config.
    const maxBridgesPerCall = Number.isFinite(bridgeCfg.maxBridgesPerCall)
      ? bridgeCfg.maxBridgesPerCall
      : -1;
    const callBridgeCountKey = `a2bridge:callcount:${callSid}`;
    const currentBridgeCount = parseInt(await redis.get(callBridgeCountKey).catch(() => '0') || '0', 10);

    if (maxBridgesPerCall >= 0 && currentBridgeCount >= maxBridgesPerCall) {
      // Per-call cap reached — skip bridge, wait for compute
      logger.info('A2_BRIDGE_CAP_REACHED', {
        maxBridgesPerCall,
        currentBridgeCount,
        turnNumber,
        callSid,
      });
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

    const bridgeTurnKey = `a2bridge:turn:${callSid}:${turnNumber}`;
    const lastLineKey = `a2bridge:lastLine:${callSid}`;

    const guardSet = await redis.set(bridgeTurnKey, '1', { EX: 60 * 10, NX: true });
    if (!guardSet) {
      // Already fired bridge this turn (dedup) — wait for compute
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

    // Increment per-call bridge counter (enforces maxBridgesPerCall cap).
    callState.agent2Bridge = callState.agent2Bridge || {};
    callState.agent2Bridge.lastBridgeTurn = turnNumber;
    callState.agent2Bridge.bridgeCount = (callState.agent2Bridge.bridgeCount || 0) + 1;
    await redis.incr(callBridgeCountKey).catch(() => {});
    await redis.expire(callBridgeCountKey, 60 * 60 * 4).catch(() => {});

    // Use pre-generated token (matches the one passed to streaming heartbeat)
    const token = preGeneratedBridgeToken;
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
    // Turn-1 welcome overrides the random bridge line with the branded greeting
    const bridgeLine = isTurn1Welcome ? turn1WelcomeCfg.line.trim() : usableLines[idx];
    const continueUrl = `${getSecureBaseUrl(req)}/api/twilio/v2-agent-bridge-continue/${companyID}?turn=${turnNumber}&token=${encodeURIComponent(token)}&attempt=0`;

    // ═══════════════════════════════════════════════════════════════════════════
    // BRIDGE AUDIO: Use cached ElevenLabs MP3 via <Play>, never Twilio <Say>.
    // If no cached audio exists, use <Pause> (silence > wrong voice for EL tenants).
    // Apr 2026: Polly-primary tenants skip the EL cache and emit <Say> with their voice.
    // ═══════════════════════════════════════════════════════════════════════════
    const BridgeAudioService = require('../services/bridgeAudio/BridgeAudioService');
    const bridgeVoiceSettings = company?.aiAgentSettings?.voiceSettings || {};
    const _isElPrimaryAgent2Bridge = getPrimaryProvider(company) === 'elevenlabs';
    const bridgeAudioUrl = _isElPrimaryAgent2Bridge ? BridgeAudioService.getAudioUrl({
      companyId: companyID,
      text: bridgeLine,
      voiceSettings: bridgeVoiceSettings,
      hostHeader
    }) : null;
    const bridgeOutputMode = bridgeAudioUrl ? 'play' : (_isElPrimaryAgent2Bridge ? 'pause' : 'say');
    const bridgeVoiceProvider = bridgeAudioUrl
      ? 'elevenlabs_cached'
      : (_isElPrimaryAgent2Bridge ? 'silence' : 'polly');

    if (CallLogger && callSid) {
      await CallLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'AGENT2_BRIDGE_SPOKEN',
        turn: turnNumber,
        data: {
          elapsedMs,
          postGatherDelayMs: bridgePostGatherDelayMs,
          maxCeilingMs: bridgeMaxCeilingMs,
          bridgeTurn: turnNumber,
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
            postGatherDelayMs: bridgePostGatherDelayMs,
            maxCeilingMs: bridgeMaxCeilingMs
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
                      postGatherDelayMs: bridgePostGatherDelayMs,
                      maxCeilingMs: bridgeMaxCeilingMs
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
    // BUILD BRIDGE TWIML: <Play> cached audio or <Pause> for EL primary —
    // <Say> with tenant's Polly voice for Polly primary tenants.
    // ═══════════════════════════════════════════════════════════════════════════
    const bridgeTwiml = new twilio.twiml.VoiceResponse();
    if (bridgeAudioUrl) {
      bridgeTwiml.play(bridgeAudioUrl);
    } else if (_isElPrimaryAgent2Bridge) {
      logger.warn('[V2TWILIO] No cached bridge audio — using silence instead of Twilio <Say>', {
        callSid: callSid?.slice(-8),
        companyId: companyID,
        bridgeLine: bridgeLine.substring(0, 60)
      });
      bridgeTwiml.pause({ length: 1 });
    } else {
      // Polly-primary tenant — emit <Say> with their chosen voice (no cache, no silence).
      bridgeTwiml.say({ voice: getPollyFallbackVoice(company) }, escapeTwiML(bridgeLine));
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
        postGatherDelayMs: bridgePostGatherDelayMs,
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
    
    // CRASH RECOVERY: use UI-configured generalError message if available.
    // Never say "I'm connecting you to our team." — that implies a transfer that
    // isn't happening. Include a Gather so the call continues, not dead-ends.
    const crashText = (company ? await getRecoveryMessage(company, 'generalError').catch(() => null) : null)
      || 'I apologize for the interruption. Please go ahead and tell me how I can help.';
    const _routeCrashSd = company ? _getSpeechDetection(company) : {};
    const twiml = new twilio.twiml.VoiceResponse();
    const crashGather = twiml.gather({
      input: 'speech',
      action: `/api/twilio/v2-agent-respond/${companyID}`,
      method: 'POST',
      actionOnEmptyResult: true,
      timeout: _routeCrashSd.initialTimeout ?? 7,
      speechTimeout: _speechTimeout(company),
    });
    crashGather.say({ voice: TWILIO_FALLBACK_VOICE }, crashText);
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
          hasGather: true,
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

// 🧹 STAGE 4 (R14): Deleted `/ai-agent-partial/:companyID` — 100% dead route.
//                   Grep confirmed zero references across the codebase as
//                   `partialResultCallback` or otherwise. It only logged and returned
//                   `{ success: true }` — no functional behavior. The active V2 pipeline
//                   uses `/v2-agent-partial/:companyId` below.

// 🎯 V2 AGENT PARTIAL SPEECH CALLBACK (for real-time speech streaming)
// This is called by Twilio during speech recognition for partial results
// We return EMPTY response - NO greeting, NO Say, NO Gather
router.post('/v2-agent-partial/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { UnstableSpeechResult, StableSpeechResult, CallSid, Stability, SequenceNumber } = req.body;
    
    const hasContent = Boolean(StableSpeechResult || UnstableSpeechResult);
    
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

      // ══════════════════════════════════════════════════════════════════════════
      // UAP-GATED SPECULATIVE PRE-WARM
      // ══════════════════════════════════════════════════════════════════════════
      // UAP runs on EVERY partial (<1ms). The moment it detects a confident match
      // (≥0.80), we fire the full speculative LLM pipeline IMMEDIATELY — no debounce.
      // This gives Groq a 10-15 second head start while the caller is still talking.
      //
      // OLD: debounced 350ms from LAST partial → speculative always fires too late
      // NEW: fires on FIRST confident UAP match → response ready before caller finishes
      //
      // If the UAP match CHANGES on a later partial, we fire again (overwrite).
      // If UAP never matches (confidence < 0.80), fall back to debounce.
      // ══════════════════════════════════════════════════════════════════════════
      if (CallSid && StableSpeechResult.length > 15) {
        let uapFired = false;

        try {
          const uapResult = await UtteranceActParser.parse(companyId, StableSpeechResult);

          if (uapResult && uapResult.confidence >= UAP_PARTIAL_CONFIDENCE) {
            const matchKey = `${uapResult.containerId}:${uapResult.sectionIdx ?? '-'}`;
            const prev = _uapPartialMatch.get(CallSid);

            // Only fire if this is a NEW match (first hit or different section)
            if (!prev || prev.matchKey !== matchKey) {
              _uapPartialMatch.set(CallSid, { matchKey, firedAt: Date.now() });

              logger.info('[V2 PARTIAL] 🎯 UAP MATCH — firing speculative NOW', {
                callSid: CallSid.slice(-8),
                matchType: uapResult.matchType,
                confidence: uapResult.confidence,
                kcId: uapResult.kcId,
                section: uapResult.sectionLabel,
                textLen: StableSpeechResult.length,
                isNewMatch: !prev,
              });

              // Cancel any legacy debounce timer
              if (_speculativeDebounce.has(CallSid)) {
                clearTimeout(_speculativeDebounce.get(CallSid));
                _speculativeDebounce.delete(CallSid);
              }

              // Fire speculative IMMEDIATELY — no debounce
              runSpeculativeLLM(CallSid, companyId, StableSpeechResult).catch(() => {});
              uapFired = true;
            }
            // Same match as before — don't re-fire, speculative is already running
          }
        } catch (uapErr) {
          // UAP error is non-fatal — fall through to debounce
          logger.debug('[V2 PARTIAL] UAP parse failed (non-fatal)', {
            callSid: CallSid.slice(-8),
            error: uapErr.message,
          });
        }

        // ── Debounce fallback — only when UAP doesn't match ──────────────────
        // If UAP never reaches 0.80 confidence, the debounce ensures we still
        // attempt a speculative pre-warm on the last substantial partial.
        if (!uapFired && !_uapPartialMatch.has(CallSid)) {
          if (_speculativeDebounce.has(CallSid)) clearTimeout(_speculativeDebounce.get(CallSid));
          const _sid = CallSid;
          const _cid = companyId;
          const _txt = StableSpeechResult;
          _speculativeDebounce.set(_sid, setTimeout(() => {
            _speculativeDebounce.delete(_sid);
            runSpeculativeLLM(_sid, _cid, _txt).catch(() => {});
          }, 350));
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
        speechTimeout: _speechTimeout(company),
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
        speechTimeout: _speechTimeout(company),
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
            voice: TWILIO_FALLBACK_VOICE,
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
        twiml.say({ voice: TWILIO_FALLBACK_VOICE }, 'System error. Please try again later.');
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
// 🎙️ RECORDING STATUS CALLBACK — Twilio recording completion
// ============================================================================
// Purpose: Persist recording URL + metadata to CallSummary when Twilio
// finishes processing the full-call recording started in /voice.
// ============================================================================

router.post('/recording-status', async (req, res) => {
  const {
    CallSid,
    RecordingSid,
    RecordingUrl,
    RecordingStatus,
    RecordingDuration,
    RecordingChannels
  } = req.body;

  logger.info('[CALL RECORDING] Recording status callback received', {
    callSid: CallSid,
    recordingSid: RecordingSid,
    status: RecordingStatus,
    duration: RecordingDuration,
    channels: RecordingChannels
  });

  try {
    if (RecordingStatus === 'completed' && RecordingUrl && CallSid) {
      const CallSummary = require('../models/CallSummary');
      const result = await CallSummary.findOneAndUpdate(
        { twilioSid: CallSid },
        {
          $set: {
            hasRecording: true,
            recordingUrl: RecordingUrl,
            recordingSid: RecordingSid,
            recordingDuration: parseInt(RecordingDuration) || 0,
            'callLifecycle.recordingCallbackReceived': true,
            'callLifecycle.recordingCallbackReceivedAt': new Date()
          }
        },
        { new: true }
      );

      if (result) {
        logger.info('[CALL RECORDING] Recording URL saved to CallSummary', {
          callSid: CallSid,
          callId: result.callId,
          recordingSid: RecordingSid,
          duration: RecordingDuration,
          recordingUrl: RecordingUrl
        });
      } else {
        // ── CRITICAL: This means callbacks arrive but can't find the row ──
        logger.error('[CALL RECORDING] No CallSummary found for recording — recording data LOST', {
          callSid: CallSid,
          recordingSid: RecordingSid,
          recordingUrl: RecordingUrl,
          recordingDuration: RecordingDuration
        });
      }
    } else if (RecordingStatus === 'failed') {
      // Mark the failure on the lifecycle so the dashboard can show "recording failed"
      const CallSummary = require('../models/CallSummary');
      await CallSummary.updateOne(
        { twilioSid: CallSid },
        { $set: {
          'callLifecycle.recordingCallbackReceived': true,
          'callLifecycle.recordingCallbackReceivedAt': new Date(),
          'callLifecycle.recordingError': `Recording failed (SID: ${RecordingSid || 'unknown'})`
        }}
      );
      logger.error('[CALL RECORDING] Recording failed', {
        callSid: CallSid,
        recordingSid: RecordingSid
      });
    }
  } catch (error) {
    logger.error('[CALL RECORDING] Error processing recording callback', {
      error: error.message,
      callSid: CallSid
    });
  }

  // Always return 200 to Twilio
  res.type('text/xml').status(200).send('<Response></Response>');
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

      // 🧹 STAGE 4 (R16): Memory leak fix — clean up in-process speculative tracking Maps.
      //                   `_uapPartialMatch` and `_speculativeDebounce` are cleared on
      //                   /v2-agent-respond, but if a call dies mid-partial (caller hangup,
      //                   network drop, timeout before final SpeechResult), /v2-agent-respond
      //                   may never fire → entries leak forever. Status-callback is the one
      //                   guaranteed terminal signal, so clean up here too.
      if (CallSid) {
        try {
          if (_speculativeDebounce.has(CallSid)) {
            clearTimeout(_speculativeDebounce.get(CallSid));
            _speculativeDebounce.delete(CallSid);
          }
          _uapPartialMatch.delete(CallSid);
        } catch (_) { /* never block call teardown on cleanup */ }
      }

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

// ────────────────────────────────────────────────────────────────────────────
// Status callback for company-scoped calls (registered at call start)
// ────────────────────────────────────────────────────────────────────────────
// FIX: Primary lookup is now CallSid-only (globally unique). CompanyId from
// the URL is validated but NOT used as a query filter — Mongoose string→ObjectId
// casting in findOne is a known source of silent null results.
// ────────────────────────────────────────────────────────────────────────────
router.post('/status-callback/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { CallSid, CallStatus, CallDuration, From, To } = req.body;
  const now = new Date();

  logger.info('[CALL STATUS] Company-specific status callback received', {
    companyId,
    callSid: CallSid,
    status: CallStatus,
    duration: CallDuration,
    from: From,
    to: To
  });

  try {
    if (CallSummaryService && ['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(CallStatus)) {
      // 🧹 STAGE 4 (R16): Memory leak fix — clean up speculative tracking Maps.
      //                   Mirrors the cleanup in the global /status-callback handler above.
      //                   Either callback can be the terminal signal depending on how Twilio
      //                   is configured, so both must clean up.
      if (CallSid) {
        try {
          if (_speculativeDebounce.has(CallSid)) {
            clearTimeout(_speculativeDebounce.get(CallSid));
            _speculativeDebounce.delete(CallSid);
          }
          _uapPartialMatch.delete(CallSid);
        } catch (_) { /* never block call teardown on cleanup */ }
      }

      const CallSummary = require('../models/CallSummary');

      // ── PRIMARY LOOKUP: CallSid only (globally unique) ──────────────────
      const callSummary = await CallSummary.findOne({ twilioSid: CallSid });

      if (!callSummary) {
        logger.error('[CALL STATUS] No CallSummary found for status callback — duration will NOT be set', {
          callSid: CallSid,
          companyId,
          status: CallStatus,
          duration: CallDuration
        });
        res.type('text/xml').status(200).send('<Response></Response>');
        return;
      }

      // ── VALIDATE companyId (log mismatch but do NOT skip update) ────────
      if (callSummary.companyId.toString() !== companyId) {
        logger.warn('[CALL STATUS] CompanyId mismatch between URL param and CallSummary — proceeding with update', {
          callSid: CallSid,
          urlCompanyId: companyId,
          summaryCompanyId: callSummary.companyId.toString()
        });
      }

      // ── MARK: Status callback received (lifecycle observability) ────────
      await CallSummary.updateOne(
        { _id: callSummary._id },
        { $set: {
          'callLifecycle.statusCallbackReceived': true,
          'callLifecycle.statusCallbackReceivedAt': now
        }}
      );

      // ── FINALIZE CallTranscriptV2 (non-blocking) ───────────────────────
      try {
        const CallTranscriptV2 = require('../models/CallTranscriptV2');
        await CallTranscriptV2.finalizeCall(callSummary.companyId, CallSid, {
          endedAt: now,
          twilioDurationSeconds: parseInt(CallDuration) || 0
        });
      } catch (v2FinalizeErr) {
        logger.warn('[CALL STATUS] Failed to finalize CallTranscriptV2 (company callback, non-blocking)', {
          companyId: callSummary.companyId,
          callSid: CallSid,
          error: v2FinalizeErr.message
        });
      }

      // ── END CALL: Persist authoritative Twilio duration ─────────────────
      const outcomeMap = {
        'completed': 'completed',
        'busy': 'abandoned',
        'no-answer': 'abandoned',
        'canceled': 'abandoned',
        'failed': 'error'
      };

      const parsedDuration = parseInt(CallDuration);
      const durationSeconds = Number.isFinite(parsedDuration) && parsedDuration >= 0
        ? parsedDuration
        : 0;

      logger.info('[CALL STATUS] About to call endCall()', {
        callId: callSummary.callId,
        callSid: CallSid,
        durationSeconds,
        rawCallDuration: CallDuration,
        callStatus: CallStatus
      });

      try {
        await CallSummaryService.endCall(callSummary.callId, {
          outcome: outcomeMap[CallStatus] || 'completed',
          durationSeconds,
          endedAt: now
        });

        // ── MARK: endCall persisted with source (lifecycle observability) ───
        await CallSummary.updateOne(
          { _id: callSummary._id },
          { $set: {
            'callLifecycle.endCallPersisted': true,
            'callLifecycle.endCallPersistedAt': new Date(),
            'callLifecycle.finalDurationSource': 'twilio_callback'
          }}
        );

        // ── DISCOVERY NOTES: persist → purge → classify → chart stamp ───────
        // Non-blocking chain — runs after call end, never affects response path.
        // Order matters: persist must complete before classify reads from MongoDB.
        if (callSummary.customerId) {
          const DiscoveryNotesService   = require('../services/discoveryNotes/DiscoveryNotesService');
          const CallOutcomeClassifier   = require('../services/engine/CallOutcomeClassifier');
          const CustomerProfileService  = require('../services/engine/CustomerProfileService');
          const _parsedDur              = parseInt(CallDuration) || 0;
          const _customerId             = String(callSummary.customerId);
          const _companyId              = String(callSummary.companyId);
          const _callSummaryId          = String(callSummary._id);

          DiscoveryNotesService.persist(_companyId, CallSid, _customerId)
            .then(() => DiscoveryNotesService.purge(_companyId, CallSid))
            .then(() => CallOutcomeClassifier.persist(_companyId, CallSid, _customerId, _callSummaryId, _parsedDur))
            .then(() => CustomerProfileService.stamp(_companyId, CallSid, _customerId, _parsedDur))
            .catch(e => logger.warn('[CALL STATUS] End-of-call chain failed (non-fatal)', {
              callSid: CallSid,
              error: e.message
            }));
        }

        logger.info('[CALL STATUS] Company CallSummary updated successfully', {
          companyId: callSummary.companyId,
          callId: callSummary.callId,
          outcome: outcomeMap[CallStatus],
          durationSeconds,
          rawCallDuration: CallDuration
        });
      } catch (endCallErr) {
        // Capture the EXACT error so we can diagnose via lifecycle
        logger.error('[CALL STATUS] ❌ endCall() FAILED — falling back to direct duration write', {
          callId: callSummary.callId,
          callSid: CallSid,
          error: endCallErr.message,
          stack: endCallErr.stack?.split('\n').slice(0, 5).join(' | ')
        });

        // ── FALLBACK: Write duration + outcome directly even if endCall() fails ──
        // endCall() does many things (transcript, customer events, KPI). If ANY of
        // those throw, we must still persist the authoritative Twilio duration so
        // the dashboard doesn't show "--" forever.
        try {
          await CallSummary.updateOne(
            { _id: callSummary._id },
            { $set: {
              durationSeconds,
              endedAt: now,
              outcome: outcomeMap[CallStatus] || 'completed',
              processingStatus: 'complete',
              'callLifecycle.endCallPersisted': false,
              'callLifecycle.endCallPersistedAt': new Date(),
              'callLifecycle.statusCallbackError': `endCall failed: ${endCallErr.message}`,
              'callLifecycle.finalDurationSource': 'twilio_callback_fallback'
            }}
          );
          logger.info('[CALL STATUS] ✅ Fallback direct-write succeeded — duration saved despite endCall failure', {
            callId: callSummary.callId,
            durationSeconds
          });
        } catch (fallbackErr) {
          logger.error('[CALL STATUS] ❌ Even fallback direct-write failed', {
            callId: callSummary.callId,
            error: fallbackErr.message
          });
        }
      }
    }

    res.type('text/xml').status(200).send('<Response></Response>');

  } catch (error) {
    logger.error('[CALL STATUS] Company callback error', {
      companyId,
      callSid: CallSid,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join(' | ')
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
    
    // Fallback: load from LLMSettings if Redis failed
    if (!config) {
      const rm = await LLM0ControlsLoader.loadRecoveryMessages(companyId);
      const Company = require('../models/v2Company');
      const company = await Company.findById(companyId).select('phoneNumber').lean();

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
      
      twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML("Connecting you now. Please hold."));
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
        
        twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML("Please leave your message after the tone. Press pound when finished."));
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
        
        twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML("We've noted your callback request. Someone will call you back as soon as possible. Goodbye."));
        twiml.hangup();
        
      } else {
        // hangup option
        twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML("Thank you for calling. Please try again later. Goodbye."));
        twiml.hangup();
      }
      
    } else {
      // Invalid input - repeat menu or end
      twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML("I didn't understand that option. Please try again later. Goodbye."));
      twiml.hangup();
    }
    
  } catch (err) {
    logger.error('🚨 [CATASTROPHIC DTMF] Error processing choice', {
      error: err.message,
      callSid: CallSid
    });
    twiml.say({ voice: TWILIO_FALLBACK_VOICE }, escapeTwiML("An error occurred. Please try again later."));
    twiml.hangup();
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ════════════════════════════════════════════════════════════════════════════════
// 🚨 TWILIO FALLBACK URL — Captures webhook failures (timeout, invalid TwiML)
// ════════════════════════════════════════════════════════════════════════════════
// Twilio calls this when the primary webhook (/voice or /v2-agent-respond) fails.
// ErrorCode 11200 = HTTP retrieval failure, 12100 = invalid TwiML,
// 11205 = HTTP connection failure, etc.
//
// CRITICAL: Return valid TwiML immediately. The caller has already heard
// "application error" — best we can do is log the failure for post-call analysis.
// ════════════════════════════════════════════════════════════════════════════════
router.post('/fallback', async (req, res) => {
  const { ErrorCode, ErrorUrl, CallSid, From, To, CallStatus } = req.body;

  logger.error('[TWILIO FALLBACK] ⚠️ Primary webhook failed — Twilio hit fallback URL', {
    errorCode: ErrorCode,
    errorUrl: ErrorUrl,
    callSid: CallSid,
    from: From,
    to: To,
    callStatus: CallStatus
  });

  // Return valid empty TwiML immediately — do NOT delay the response
  const twiml = new twilio.twiml.VoiceResponse();
  res.type('text/xml');
  res.send(twiml.toString());

  // Fire-and-forget: persist error trace to CallTranscriptV2 + CallSummary
  try {
    const calledNumber = normalizePhoneNumber(To);
    const company = await getCompanyByPhoneNumber(calledNumber);
    if (company && CallSid) {
      const CallTranscriptV2 = require('../models/CallTranscriptV2');
      CallTranscriptV2.appendTrace(company._id, CallSid, [{
        kind: 'TWILIO_ERROR',
        turnNumber: null,
        ts: new Date(),
        payload: {
          errorCode: ErrorCode || 'UNKNOWN',
          errorUrl: ErrorUrl || null,
          callStatus: CallStatus || null,
          from: normalizePhoneNumber(From),
          to: calledNumber,
          source: 'twilio_fallback_url'
        }
      }]).catch(() => {});

      // Stamp callLifecycle on CallSummary
      const CallSummary = require('../models/CallSummary');
      CallSummary.updateOne(
        { companyId: company._id, twilioSid: CallSid },
        {
          $push: {
            'callLifecycle.twilioErrors': {
              errorCode: ErrorCode || 'UNKNOWN',
              errorUrl: ErrorUrl || null,
              ts: new Date(),
              source: 'twilio_fallback_url'
            }
          }
        }
      ).catch(() => {});
    }
  } catch (persistErr) {
    logger.warn('[TWILIO FALLBACK] Failed to persist error (non-blocking)', {
      callSid: CallSid,
      error: persistErr.message
    });
  }
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
    speechTimeout: _speechTimeout(company)
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