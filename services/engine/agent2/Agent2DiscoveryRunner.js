/**
 * ============================================================================
 * AGENT 2.0 DISCOVERY RUNNER (V119 - HARD ISOLATION)
 * ============================================================================
 *
 * Orchestrates the Discovery phase of Agent 2.0 calls.
 * When enabled, Agent 2.0 OWNS THE MIC — no fallback to legacy. EVER.
 *
 * HARD RULES (V119):
 * 1. Greetings are handled by GreetingInterceptor BEFORE this runs (not here)
 * 2. Legacy owners are BLOCKED and we emit proof of blocking
 * 3. ScenarioEngine is OFF by default (opt-in via playbook.useScenarioFallback)
 * 4. Fallback distinguishes "reason captured" vs "no reason"
 * 5. Every turn emits A2_GATE → A2_PATH → A2_RESPONSE chain
 *
 * Flow Order (deterministic-first):
 * 1. Robot challenge detection (UI-controlled response)
 * 2. TRIGGER CARD MATCHING — keywords/phrases/negatives (PRIMARY PATH)
 * 3. Scenario engine fallback (ONLY if playbook.useScenarioFallback=true)
 * 4. Captured reason acknowledgment (if reason extracted but no match)
 * 5. Generic fallback (last resort — different text if reason exists)
 *
 * Raw Events Emitted (MANDATORY - proof trail):
 * - A2_GATE           : Entry proof (enabled, uiBuild, configHash, legacyBlocked)
 * - A2_PATH_SELECTED  : Which path was taken (ROBOT/TRIGGER/SCENARIO/FALLBACK)
 * - A2_TRIGGER_EVAL   : Trigger card evaluation details
 * - A2_SCENARIO_EVAL  : Scenario engine fallback details (if enabled)
 * - A2_RESPONSE_READY : Final response proof (text, audioUrl, source)
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const { TriggerCardMatcher } = require('./TriggerCardMatcher');
const { Agent2VocabularyEngine } = require('./Agent2VocabularyEngine');
const { Agent2GreetingInterceptor } = require('./Agent2GreetingInterceptor');
const { Agent2CallReasonSanitizer } = require('./Agent2CallReasonSanitizer');
const { Agent2IntentPriorityGate } = require('./Agent2IntentPriorityGate');
const { resolveSpeakLine } = require('./Agent2SpeakGate');
const { runLLMFallback, computeComplexityScore } = require('./Agent2LLMFallbackService');
const { generateLLMTriggerResponse } = require('./Agent2LLMTriggerService');
const Agent2SpeechPreprocessor = require('./Agent2SpeechPreprocessor');

// ════════════════════════════════════════════════════════════════════════════
// 🔍 SCRABENGINE - Enterprise Text Processing Pipeline
// ════════════════════════════════════════════════════════════════════════════
// Unified text normalization replacing scattered preprocessing.
// Entry point for ALL text cleaning before trigger matching.
// ════════════════════════════════════════════════════════════════════════════
const { ScrabEngine } = require('../../ScrabEngine');
const Agent2EchoGuard = require('./Agent2EchoGuard');
const CompanyTriggerSettings = require('../../../models/CompanyTriggerSettings');

// ScenarioEngine is lazy-loaded ONLY if useScenarioFallback is enabled
let ScenarioEngine = null;

// Cache for company trigger variables (per call, keyed by companyId)
const triggerVariablesCache = new Map();

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Substitute trigger card variables in text (e.g., {diagnosticfee} → "80 dollars")
 * These are stored in CompanyTriggerSettings.companyVariables, separate from
 * the general aiAgentSettings.variables used by placeholderReplacer.
 * 
 * @param {string} text - Text potentially containing {variable} placeholders
 * @param {string} companyId - Company ID to load variables for
 * @returns {Promise<string>} Text with variables substituted
 */
async function substituteTriggerVariables(text, companyId) {
  if (!text || typeof text !== 'string' || !companyId) return text;
  
  // Check if text contains any placeholders
  if (!text.includes('{')) return text;
  
  try {
    // Check cache first
    let variables = triggerVariablesCache.get(companyId);
    
    if (!variables) {
      const settings = await CompanyTriggerSettings.findOne({ companyId }).lean();
      if (settings?.companyVariables) {
        variables = settings.companyVariables instanceof Map
          ? Object.fromEntries(settings.companyVariables)
          : settings.companyVariables;
      } else {
        variables = {};
      }
      triggerVariablesCache.set(companyId, variables);
    }
    
    if (Object.keys(variables).length === 0) return text;
    
    // Replace placeholders (case-insensitive)
    let result = text;
    for (const [varName, value] of Object.entries(variables)) {
      if (!value) continue;
      const regex = new RegExp(`\\{${varName}\\}`, 'gi');
      result = result.replace(regex, value);
    }
    
    return result;
  } catch (err) {
    logger.warn('[Agent2Discovery] Failed to substitute trigger variables', { 
      companyId, 
      error: err.message 
    });
    return text;
  }
}

function safeArr(v) {
  return Array.isArray(v) ? v : (v ? [v] : []);
}

function safeObj(v, fallback = {}) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
}

function clip(text, n) {
  return `${text || ''}`.substring(0, n);
}

function naturalizeReason(text) {
  const raw = `${text || ''}`.trim();
  if (!raw) return null;
  const parts = raw
    .split(';')
    .map((p) => `${p}`.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function sanitizeScenarioText(text) {
  const raw = `${text || ''}`.trim();
  if (!raw) return null;

  // Remove booking/CTA sentences so Discovery stays "answer-first" without pushing booking.
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => `${s}`.trim())
    .filter(Boolean)
    .filter((s) => !/\b(would you like|why don'?t we|can i|get (?:a|the) technician|schedule (?:a|an)|book (?:a|an)|let me get you scheduled|i can get you scheduled)\b/i.test(s));

  const kept = sentences.length > 0 ? sentences.slice(0, 2).join(' ') : raw;
  const clipped = kept.length > 360 ? `${kept.substring(0, 357).trim()}...` : kept;
  return clipped || null;
}

function detectRobotChallenge(text) {
  const t = `${text || ''}`.toLowerCase();
  return /\b(are you real|real person|is this a robot|machine|automated|human)\b/i.test(t);
}

function normalizeScenarioType(scenario) {
  const t = scenario?.type || scenario?.scenarioType || scenario?.categoryType || scenario?.category || scenario?.intentType || null;
  if (!t) return null;
  return `${t}`.trim().toUpperCase();
}

/**
 * V125: Build SPEECH_SOURCE_SELECTED event payload
 * Every spoken line must be traceable to a UI path.
 * If uiPath is null → that source is invalid and must be UI-wired.
 */
function buildSpeechSourceEvent(sourceId, uiPath, textPreview, audioUrl, reason) {
  return {
    sourceId,
    uiPath: uiPath || null,
    textPreview: clip(textPreview, 80),
    audioUrl: audioUrl || null,
    reason,
    hasUiPath: !!uiPath
  };
}

/**
 * V126: SPEECH PROVENANCE - Complete traceability for every spoken line
 * This is the single source of truth for "what spoke and why"
 */
function buildSpeakProvenance(sourceId, uiPath, uiTab, configPath, spokenText, audioUrl, reason, isFromUiConfig) {
  return {
    sourceId,
    uiPath,
    uiTab,
    configPath,
    spokenTextPreview: clip(spokenText, 120),
    audioUrl: audioUrl || null,
    reason,
    isFromUiConfig,
    timestamp: new Date().toISOString()
  };
}

/**
 * V126: NO-UI-NO-SPEAK GUARD
 * If a response cannot be mapped to a UI-owned config path, block it.
 * Returns the validated response or an emergency fallback (which MUST also be UI-owned).
 * 
 * @param {Object} params
 * @param {string} params.response - The text/audio to speak
 * @param {string} params.sourceId - Source identifier
 * @param {string} params.uiPath - UI config path (null = not UI-owned)
 * @param {Object} params.emergencyFallback - UI-owned emergency line
 * @param {Function} params.emit - Event emitter
 * @returns {{ response: string, blocked: boolean, provenance: Object }}
 */
function validateSpeechSource({ response, sourceId, uiPath, configPath, uiTab, audioUrl, reason, emergencyFallback, emit }) {
  const isFromUiConfig = !!uiPath && uiPath !== 'HARDCODED_FALLBACK';
  
  const provenance = buildSpeakProvenance(
    sourceId,
    uiPath || 'UNMAPPED',
    uiTab || 'UNKNOWN',
    configPath || 'UNMAPPED',
    response,
    audioUrl,
    reason,
    isFromUiConfig
  );
  
  // If response IS from UI config, allow it
  if (isFromUiConfig) {
    emit('SPEAK_PROVENANCE', provenance);
    return { response, blocked: false, provenance };
  }
  
  // Response is NOT from UI config - this is a violation
  // Log CRITICAL and use emergency fallback (which MUST be UI-owned)
  emit('SPOKEN_TEXT_UNMAPPED_BLOCKED', {
    blockedSourceId: sourceId,
    blockedText: clip(response, 80),
    reason: 'No UI path mapped - Prime Directive violation',
    severity: 'CRITICAL'
  });
  
  if (emergencyFallback?.text && emergencyFallback?.uiPath) {
    // Emergency fallback is UI-owned, use it
    const fallbackProvenance = buildSpeakProvenance(
      'emergencyFallback',
      emergencyFallback.uiPath,
      emergencyFallback.uiTab || 'Configuration',
      emergencyFallback.configPath,
      emergencyFallback.text,
      null,
      `FALLBACK: Original source "${sourceId}" was blocked (no UI path)`,
      true
    );
    emit('SPEAK_PROVENANCE', fallbackProvenance);
    return { response: emergencyFallback.text, blocked: true, provenance: fallbackProvenance };
  }
  
  // No valid emergency fallback - this is a critical system failure
  // We MUST speak something, so log double CRITICAL and use minimal safe text
  emit('EMERGENCY_FALLBACK_ALSO_UNMAPPED', {
    severity: 'CRITICAL',
    message: 'Both primary response and emergency fallback lack UI paths - system misconfiguration'
  });
  
  // Last resort: speak nothing meaningful, just acknowledge
  const lastResort = 'One moment please.';
  const lastResortProvenance = buildSpeakProvenance(
    'SYSTEM_LAST_RESORT',
    'NONE - CRITICAL SYSTEM ERROR',
    'NONE',
    'NONE',
    lastResort,
    null,
    'CRITICAL: All speech sources failed UI validation',
    false
  );
  emit('SPEAK_PROVENANCE', lastResortProvenance);
  return { response: lastResort, blocked: true, provenance: lastResortProvenance };
}

/**
 * V119: Compute a short hash of the agent2 config for proof trail.
 * This lets us verify which config version was active during a turn.
 */
function computeConfigHash(agent2Config) {
  try {
    const rulesCount = safeArr(agent2Config?.discovery?.playbook?.rules).length;
    const ackWord = agent2Config?.discovery?.style?.ackWord || 'Ok.';
    const useScenario = agent2Config?.discovery?.playbook?.useScenarioFallback === true;
    const updatedAt = agent2Config?.discovery?.updatedAt || null;
    // Simple hash: combine key config properties
    const hashInput = `${rulesCount}|${ackWord}|${useScenario}|${updatedAt}`;
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `cfg_${Math.abs(hash).toString(16).substring(0, 8)}`;
  } catch (_e) {
    return 'cfg_unknown';
  }
}

/**
 * V119: Build personalized ack with caller name (max once, high confidence only)
 */
function buildAck(baseAck, callerName, state) {
  const ack = `${baseAck || 'Ok.'}`.trim();
  // Only use name if high confidence (explicit extraction, not guessed)
  const nameMeta = state?.slotMeta?.name || {};
  const confidence = nameMeta.confidence || 0;
  const usedNameThisTurn = state?.agent2?.discovery?.usedNameThisTurn === true;
  
  // Use name if: confidence >= 0.85, not already used this turn, and name exists
  if (callerName && confidence >= 0.85 && !usedNameThisTurn) {
    return { ack: `${ack.replace(/\.$/, '')}, ${callerName}.`, usedName: true };
  }
  return { ack, usedName: false };
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN RUNNER
// ────────────────────────────────────────────────────────────────────────────

class Agent2DiscoveryRunner {
  /**
   * Run the Discovery phase for a single turn.
   *
   * @param {Object} params
   * @param {Object} params.company - Company document
   * @param {string} params.companyId - Company ID
   * @param {string} params.callSid - Twilio call SID
   * @param {string} params.userInput - Caller's utterance
   * @param {Object} params.state - Current call state
   * @param {Function} params.emitEvent - Raw event emitter
   * @param {number} params.turn - Current turn number
   * @returns {Object|null} { response, matchSource, state } or null if disabled
   */
  static async run({ company, companyId, callSid, userInput, state, emitEvent = null, turn = null }) {
    const emit = (type, data) => {
      try {
        if (typeof emitEvent === 'function') emitEvent(type, data);
      } catch (_e) {
        // Never let observability break the call.
      }
    };

    // ──────────────────────────────────────────────────────────────────────
    // CONFIG EXTRACTION
    // ──────────────────────────────────────────────────────────────────────
    const agent2 = safeObj(company?.aiAgentSettings?.agent2, {});
    const enabled = agent2.enabled === true && agent2.discovery?.enabled === true;
    const discoveryCfg = safeObj(agent2.discovery, {});
    const style = safeObj(discoveryCfg.style, {});
    const playbook = safeObj(discoveryCfg.playbook, {});
    const fallback = safeObj(playbook.fallback, {});
    
    // V126: EMERGENCY FALLBACK LINE - UI-OWNED LAST RESORT
    // This is the ONLY acceptable fallback when other sources fail validation.
    // If not configured, log CRITICAL - system should never use hardcoded text.
    const emergencyFallbackConfig = agent2.emergencyFallbackLine || {};
    const emergencyFallback = emergencyFallbackConfig.enabled !== false && emergencyFallbackConfig.text
      ? {
          text: emergencyFallbackConfig.text,
          uiPath: 'aiAgentSettings.agent2.emergencyFallbackLine.text',
          uiTab: 'Configuration',
          configPath: 'agent2.emergencyFallbackLine.text'
        }
      : null;
    
    if (!emergencyFallback) {
      emit('EMERGENCY_FALLBACK_NOT_CONFIGURED', {
        severity: 'WARNING',
        message: 'agent2.emergencyFallbackLine is not configured. If other sources fail, system will use minimal acknowledgment.',
        configPath: 'aiAgentSettings.agent2.emergencyFallbackLine'
      });
    }

    // V119: ScenarioEngine is OFF by default
    const useScenarioFallback = playbook.useScenarioFallback === true;

    const input = `${userInput || ''}`.trim();
    const inputLower = input.toLowerCase();
    
    // ──────────────────────────────────────────────────────────────────────
    // CALL REASON SANITIZATION (V4 - Prevents "echo" problem)
    // ──────────────────────────────────────────────────────────────────────
    // Raw call_reason_detail can be the caller's full transcript which sounds
    // terrible when echoed back ("It sounds like I'm having AC problems...")
    // Sanitize it to a clean, short label instead.
    const rawReason = state?.plainSlots?.call_reason_detail || state?.slots?.call_reason_detail || null;
    const reasonSanitizerConfig = discoveryCfg?.callReasonCapture || {};
    let capturedReason = null;
    let capturedReasonRaw = null;
    
    if (rawReason) {
      capturedReasonRaw = naturalizeReason(rawReason);
      
      // Apply sanitization if enabled (default: enabled)
      if (reasonSanitizerConfig.enabled !== false) {
        const sanitized = Agent2CallReasonSanitizer.sanitize(rawReason, reasonSanitizerConfig);
        capturedReason = sanitized.sanitized || capturedReasonRaw;
        
        logger.debug('[Agent2DiscoveryRunner] Call reason sanitized', {
          rawPreview: clip(capturedReasonRaw, 60),
          sanitized: capturedReason,
          mode: sanitized.mode,
          matched: sanitized.matched
        });
      } else {
        capturedReason = capturedReasonRaw;
      }
    }
    
    const callerName = state?.plainSlots?.name || null;

    // ──────────────────────────────────────────────────────────────────────
    // V119: COMPUTE CONFIG HASH FOR PROOF
    // ──────────────────────────────────────────────────────────────────────
    const configHash = computeConfigHash(agent2);

    // ──────────────────────────────────────────────────────────────────────
    // STATE SETUP
    // ──────────────────────────────────────────────────────────────────────
    const nextState = { ...(state || {}) };
    nextState.lane = 'DISCOVERY';
    nextState.consent = { pending: false, askedExplicitly: false };
    nextState.agent2 = safeObj(nextState.agent2, {});
    nextState.agent2.discovery = safeObj(nextState.agent2.discovery, {});
    nextState.agent2.discovery.turnLastRan = typeof turn === 'number' ? turn : null;
    
    // ══════════════════════════════════════════════════════════════════════════
    // V5: LLM ASSIST STATE INITIALIZATION & COOLDOWN MANAGEMENT
    // Tracks uses per call and cooldown remaining for Answer+Return mode
    // ══════════════════════════════════════════════════════════════════════════
    nextState.agent2.llmAssist = safeObj(nextState.agent2.llmAssist, {
      usesThisCall: 0,
      cooldownRemaining: 0,
      lastModeUsed: null
    });
    
    // Decrement cooldown at start of each turn
    if (nextState.agent2.llmAssist.cooldownRemaining > 0) {
      nextState.agent2.llmAssist.cooldownRemaining -= 1;
      emit('A2_LLM_COOLDOWN_DECREMENTED', {
        newCooldownRemaining: nextState.agent2.llmAssist.cooldownRemaining,
        usesThisCall: nextState.agent2.llmAssist.usesThisCall
      });
    }

    // ──────────────────────────────────────────────────────────────────────
    // V119: A2_GATE — MANDATORY ENTRY PROOF
    // ──────────────────────────────────────────────────────────────────────
    // This event MUST fire every turn to prove:
    // 1. Agent 2.0 was evaluated
    // 2. Legacy owners were blocked
    // 3. Config version is known
    emit('A2_GATE', {
      enabled,
      uiBuild: agent2?.meta?.uiBuild || null,
      configHash,
      turn: typeof turn === 'number' ? turn : null,
      legacyBlocked: enabled ? ['ALL_LEGACY_DELETED'] : [],
      scenarioFallbackEnabled: useScenarioFallback,
      inputPreview: clip(input, 60),
      hasCallerName: !!callerName,
      hasCapturedReason: !!capturedReason
    });

    if (!enabled) {
      emit('A2_PATH_SELECTED', { path: 'DISABLED', reason: 'agent2.enabled=false or discovery.enabled=false' });
      return null;
    }

    const ack = `${style.ackWord || 'Ok.'}`.trim() || 'Ok.';

    // ══════════════════════════════════════════════════════════════════════════
    // GREETING INTERCEPTOR (V122/V124 - RUNS BEFORE TRIGGER CARDS)
    // ══════════════════════════════════════════════════════════════════════════
    // Handles short greetings like "hi", "good morning" with strict gating.
    // SHORT-ONLY GATE: Only fires if input ≤ maxWordsToQualify AND no intent words.
    // ONE-SHOT GUARD (V124): Once greeted, never re-greet on subsequent turns.
    // If it fires → returns immediately, ends the turn.
    // ══════════════════════════════════════════════════════════════════════════
    const greetingsConfig = safeObj(agent2.greetings, {});
    const greetingResult = Agent2GreetingInterceptor.evaluate({
      input: input,
      config: greetingsConfig,
      turn: typeof turn === 'number' ? turn : 0,
      state: nextState  // V124: Pass state for one-shot guard check
    });

    // Always emit greeting evaluation proof
    emit('A2_GREETING_EVALUATED', greetingResult.proof);

    if (greetingResult.intercepted) {
      // Greeting matched — return immediately, end the turn
      nextState.agent2.discovery.lastPath = 'GREETING_INTERCEPTED';
      nextState.agent2.discovery.lastGreetingRuleId = greetingResult.proof.matchedRuleId;
      
      // V124: Apply state update (sets greeted=true for one-shot guard)
      if (greetingResult.stateUpdate) {
        nextState.agent2 = { ...nextState.agent2, ...greetingResult.stateUpdate };
      }

      emit('A2_PATH_SELECTED', {
        path: 'GREETING_INTERCEPTED',
        reason: `Matched greeting rule: ${greetingResult.proof.matchedRuleId}`,
        matchedTrigger: greetingResult.proof.matchedTrigger,
        responseSource: greetingResult.responseSource
      });

      const greetingAudioUrl = greetingResult.responseSource === 'audio' ? greetingResult.response : null;
      emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
        `agent2.greetings.interceptor.rules[${greetingResult.ruleIndex || 0}]`,
        'aiAgentSettings.agent2.greetings.interceptor.rules',
        greetingResult.response,
        greetingAudioUrl,
        `Greeting rule matched: ${greetingResult.matchedTrigger || 'unknown'}`
      ));
      emit('A2_RESPONSE_READY', {
        path: 'GREETING_INTERCEPTED',
        responsePreview: clip(greetingResult.response, 120),
        responseLength: greetingResult.response?.length || 0,
        hasAudio: !!greetingAudioUrl,
        audioUrl: greetingAudioUrl,
        source: `greeting:${greetingResult.proof.matchedRuleId}`
      });

      // Return audio URL if audio, otherwise TTS response
      if (greetingResult.responseSource === 'audio') {
        return {
          response: null, // No TTS needed
          matchSource: 'AGENT2_DISCOVERY',
          state: nextState,
          audioUrl: greetingResult.response
        };
      }

      return {
        response: greetingResult.response,
        matchSource: 'AGENT2_DISCOVERY',
        state: nextState
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 🔍 SCRABENGINE - UNIFIED TEXT PROCESSING PIPELINE
    // ══════════════════════════════════════════════════════════════════════════
    // Enterprise-grade normalization & token expansion.
    // Replaces: Agent2SpeechPreprocessor + Agent2VocabularyEngine (scattered logic)
    // 
    // PIPELINE: Fillers → Vocabulary → Synonyms → Quality Gate
    // GUARANTEE: Raw text preserved, expansion adds tokens (never replaces)
    // PERFORMANCE TARGET: < 30ms
    // 
    // WIRING: This is the ENTRY POINT for all text cleaning
    // ══════════════════════════════════════════════════════════════════════════
    
    logger.info('[ScrabEngine] 🚀 WIRING ENTRY - Agent2DiscoveryRunner calling ScrabEngine', {
      companyId,
      callSid,
      turn,
      inputPreview: clip(input, 60)
    });
    
    const scrabResult = await ScrabEngine.process({
      rawText: input,
      company: company,
      context: {
        companyName: company?.name || company?.businessName || '',
        callSid,
        turn
      }
    });
    
    // ──────────────────────────────────────────────────────────────────────────
    // EXTRACT SCRABENGINE OUTPUTS
    // ──────────────────────────────────────────────────────────────────────────
    const normalizedInput = scrabResult.normalizedText;
    const normalizedInputLower = normalizedInput.toLowerCase();
    const originalTokens = scrabResult.originalTokens;
    const expandedTokens = scrabResult.expandedTokens;
    const expansionMap = scrabResult.expansionMap;
    
    logger.info('[ScrabEngine] ✅ WIRING EXIT - ScrabEngine processing complete', {
      companyId,
      callSid,
      turn,
      rawPreview: clip(input, 40),
      normalizedPreview: clip(normalizedInput, 40),
      tokensOriginal: originalTokens.length,
      tokensExpanded: expandedTokens.length,
      expansionRatio: (expandedTokens.length / (originalTokens.length || 1)).toFixed(2),
      transformations: scrabResult.transformations.length,
      qualityPassed: scrabResult.quality.passed,
      processingTimeMs: scrabResult.performance.totalTimeMs
    });
    
    // ──────────────────────────────────────────────────────────────────────────
    // EMIT SCRABENGINE EVENTS (for Call Review debugging)
    // ──────────────────────────────────────────────────────────────────────────
    
    // V4: INPUT_TEXT_FINALIZED - Raw input captured (for audit trail)
    emit('INPUT_TEXT_FINALIZED', {
      raw: clip(input, 120),
      turn,
      charCount: (input || '').length,
      timestamp: new Date().toISOString()
    });
    
    // ScrabEngine processing summary
    emit('SCRABENGINE_PROCESSED', {
      rawPreview: clip(input, 60),
      normalizedPreview: clip(normalizedInput, 60),
      wasChanged: normalizedInput !== input,
      transformations: scrabResult.transformations,
      tokensOriginal: originalTokens.length,
      tokensExpanded: expandedTokens.length,
      expansionMap: Object.keys(expansionMap).length > 0 ? expansionMap : null,
      quality: scrabResult.quality,
      performance: scrabResult.performance,
      note: 'ScrabEngine: Fillers → Vocabulary → Synonyms → Quality Gate'
    });
    
    // Quality gate check
    if (!scrabResult.quality.passed && scrabResult.quality.shouldReprompt) {
      emit('SCRABENGINE_QUALITY_FAILED', {
        reason: scrabResult.quality.reason,
        confidence: scrabResult.quality.confidence,
        details: scrabResult.quality.details,
        shouldReprompt: true
      });
      
      logger.warn('[ScrabEngine] ⚠️ Quality gate failed - input too low quality', {
        reason: scrabResult.quality.reason,
        inputPreview: clip(input, 60)
      });
      
      // Could add reprompt logic here if needed
    }
    
    // Store ScrabEngine result in state for downstream access
    nextState.agent2.scrabEngine = {
      rawText: scrabResult.rawText,
      normalizedText: scrabResult.normalizedText,
      expandedTokens: scrabResult.expandedTokens,
      transformations: scrabResult.transformations
    };
    
    // ══════════════════════════════════════════════════════════════════════════
    // CLARIFIER RESOLUTION CHECK
    // ══════════════════════════════════════════════════════════════════════════
    // If we asked a clarifier question last turn, check if user answered YES/NO
    // YES → lock the component and boost matching
    // NO → fall through normally
    // ══════════════════════════════════════════════════════════════════════════
    const pendingClarifier = nextState.agent2.discovery.pendingClarifier || null;
    const pendingClarifierTurn = nextState.agent2.discovery.pendingClarifierTurn || null;
    const isRespondingToClarifier = pendingClarifier && typeof pendingClarifierTurn === 'number' && pendingClarifierTurn === (turn - 1);
    
    if (isRespondingToClarifier) {
      const inputLowerClean = normalizedInputLower.replace(/[^a-z\s]/g, '').trim();
      const inputWords = inputLowerClean.split(/\s+/).filter(Boolean);
      
      const YES_WORDS = new Set(['yes', 'yeah', 'yep', 'yea', 'sure', 'ok', 'okay', 'correct', 'right', 'exactly', 'thats it', 'that is it']);
      const NO_WORDS = new Set(['no', 'nope', 'nah', 'negative', 'not really', 'not exactly']);
      
      const hasYesWord = inputWords.some(w => YES_WORDS.has(w)) || inputLowerClean.includes('thats it') || inputLowerClean.includes('yes');
      const hasNoWord = inputWords.some(w => NO_WORDS.has(w));
      
      if (hasYesWord && !hasNoWord) {
        // User confirmed the clarifier — set lock
        nextState.agent2.locks = nextState.agent2.locks || {};
        nextState.agent2.locks.component = pendingClarifier.locksTo || null;
        nextState.agent2.discovery.clarifierResolved = { id: pendingClarifier.id, resolvedAs: 'YES', turn };
        
        emit('A2_CLARIFIER_RESOLVED', {
          clarifierId: pendingClarifier.id,
          resolvedAs: 'YES',
          lockedTo: pendingClarifier.locksTo,
          locks: nextState.agent2.locks
        });
        
        // Clear pending clarifier
        nextState.agent2.discovery.pendingClarifier = null;
        nextState.agent2.discovery.pendingClarifierTurn = null;
        
        // Now continue to trigger card matching with the lock in place
      } else if (hasNoWord) {
        // User said no — clear hints related to this clarifier and continue
        const hintToRemove = pendingClarifier.hintTrigger;
        nextState.agent2.hints = (nextState.agent2.hints || []).filter(h => h !== hintToRemove);
        nextState.agent2.discovery.clarifierResolved = { id: pendingClarifier.id, resolvedAs: 'NO', turn };
        
        emit('A2_CLARIFIER_RESOLVED', {
          clarifierId: pendingClarifier.id,
          resolvedAs: 'NO',
          removedHint: hintToRemove,
          locks: nextState.agent2.locks || {}
        });
        
        // Clear pending clarifier
        nextState.agent2.discovery.pendingClarifier = null;
        nextState.agent2.discovery.pendingClarifierTurn = null;
        
        // Continue to trigger card matching without the lock
      } else {
        // Unclear response — keep the clarifier pending but don't re-ask immediately
        // Fall through to normal processing
        nextState.agent2.discovery.pendingClarifier = null;
        nextState.agent2.discovery.pendingClarifierTurn = null;
        
        emit('A2_CLARIFIER_RESOLVED', {
          clarifierId: pendingClarifier.id,
          resolvedAs: 'UNCLEAR',
          inputPreview: clip(normalizedInput, 40),
          action: 'FALL_THROUGH'
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PENDING FOLLOW-UP QUESTION (Trigger Card Consent Gate)
    // ══════════════════════════════════════════════════════════════════════════
    // Separate from pendingQuestion. Only fires when a trigger card had a
    // follow-up question with text. Uses configurable 5-bucket classification
    // from discovery.followUpConsent (UI: Follow-up Consent Cards).
    // ══════════════════════════════════════════════════════════════════════════
    const pfuq = nextState.agent2?.discovery?.pendingFollowUpQuestion || null;
    const pfuqTurn = nextState.agent2?.discovery?.pendingFollowUpQuestionTurn;
    const pfuqSource = nextState.agent2?.discovery?.pendingFollowUpQuestionSource || null;
    const pfuqNextAction = nextState.agent2?.discovery?.pendingFollowUpQuestionNextAction || 'CONTINUE';
    const hasPFUQ = pfuq && typeof pfuqTurn === 'number';
    const isRespondingToPFUQ = hasPFUQ && pfuqTurn === (turn - 1);

    if (isRespondingToPFUQ) {
      const inputLowerCleanFUQ = inputLower.replace(/[^a-z\s]/g, '').trim();
      const inputWordsFUQ = inputLowerCleanFUQ.split(/\s+/).filter(Boolean);
      const inputLenFUQ = input.trim().length;

      // Load configurable keywords from followUpConsent (company-level)
      const fuc = safeObj(discoveryCfg?.followUpConsent, {});
      const yesPhrases = safeArr(fuc.yes?.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);
      const noPhrases = safeArr(fuc.no?.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);
      const repromptPhrases = safeArr(fuc.reprompt?.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);
      const hesitantPhrases = safeArr(fuc.hesitant?.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);

      // Classify: check exact word matches and phrase containment
      const matchesList = (list) => {
        for (const phrase of list) {
          if (phrase.includes(' ')) {
            if (inputLowerCleanFUQ.includes(phrase)) return true;
          } else {
            if (inputWordsFUQ.includes(phrase)) return true;
          }
        }
        return false;
      };

      const isYesFUQ = matchesList(yesPhrases);
      const isNoFUQ = matchesList(noPhrases);
      const isHesitantFUQ = matchesList(hesitantPhrases);
      const isRepromptFUQ = matchesList(repromptPhrases) || (inputLenFUQ <= 8 && !isYesFUQ && !isNoFUQ && !isHesitantFUQ);

      // Priority: YES > NO > HESITANT > REPROMPT > COMPLEX
      let bucket;
      if (isYesFUQ && !isNoFUQ) bucket = 'YES';
      else if (isNoFUQ && !isYesFUQ) bucket = 'NO';
      else if (isHesitantFUQ) bucket = 'HESITANT';
      else if (isRepromptFUQ) bucket = 'REPROMPT';
      else bucket = 'COMPLEX';

      const direction = `${fuc[bucket.toLowerCase()]?.direction || 'CONTINUE'}`.toUpperCase();

      emit('A2_FOLLOWUP_CONSENT_CLASSIFIED', {
        bucket,
        direction,
        inputPreview: clip(inputLowerCleanFUQ, 60),
        cardId: pfuqSource?.replace('card:', '') || null,
        question: clip(pfuq, 60),
        nextAction: pfuqNextAction,
        markers: { isYesFUQ, isNoFUQ, isHesitantFUQ, isRepromptFUQ }
      });

      const { ack: fuqAck, usedName: fuqUsedName } = buildAck(ack, callerName, state);
      nextState.agent2.discovery.usedNameThisTurn = fuqUsedName;

      // ── REPROMPT: re-ask the question ──
      if (bucket === 'REPROMPT') {
        const repromptText = `${fuc.reprompt?.response || ''}`.trim() || `Sorry, I missed that. ${pfuq}`;
        nextState.agent2.discovery.lastPath = 'FOLLOWUP_REPROMPT';
        const repromptResponse = `${fuqAck} ${repromptText}`.trim();

        emit('A2_RESPONSE_READY', { path: 'FOLLOWUP_REPROMPT', responsePreview: clip(repromptResponse, 120) });
        return { response: repromptResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }

      // ── HESITANT: gentle clarification, keep question pending ──
      if (bucket === 'HESITANT') {
        const hesitantText = `${fuc.hesitant?.response || ''}`.trim()
          || `No worries — I just need to know so we send the right team. ${pfuq}`;
        nextState.agent2.discovery.lastPath = 'FOLLOWUP_HESITANT';
        const hesitantResponse = `${fuqAck} ${hesitantText}`.trim();

        emit('A2_RESPONSE_READY', { path: 'FOLLOWUP_HESITANT', responsePreview: clip(hesitantResponse, 120) });
        return { response: hesitantResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }

      // Clear the pending follow-up for YES, NO, and COMPLEX (resolved)
      nextState.agent2.discovery.pendingFollowUpQuestion = null;
      nextState.agent2.discovery.pendingFollowUpQuestionTurn = null;
      nextState.agent2.discovery.pendingFollowUpQuestionSource = null;
      nextState.agent2.discovery.pendingFollowUpQuestionNextAction = null;

      // ── YES: execute the configured direction ──
      if (bucket === 'YES') {
        const yesText = `${fuc.yes?.response || ''}`.trim() || 'Great — let me get that scheduled for you.';
        const yesDirection = `${fuc.yes?.direction || pfuqNextAction || 'CONTINUE'}`.toUpperCase();

        if (yesDirection === 'HANDOFF_BOOKING') {
          nextState.sessionMode = 'BOOKING';
          nextState.consent = { pending: false, given: true, turn, source: 'followup_consent_gate' };
          nextState.agent2.discovery.lastPath = 'FOLLOWUP_YES_HANDOFF_BOOKING';

          emit('A2_CONSENT_GATE_BOOKING', {
            reason: 'Caller confirmed YES to trigger follow-up → booking handoff',
            cardId: pfuqSource?.replace('card:', '') || null,
            inputPreview: clip(inputLowerCleanFUQ, 60)
          });
        } else {
          nextState.agent2.discovery.lastPath = 'FOLLOWUP_YES';
        }

        const yesResponse = `${fuqAck} ${yesText}`.trim();
        emit('A2_RESPONSE_READY', { path: nextState.agent2.discovery.lastPath, responsePreview: clip(yesResponse, 120), direction: yesDirection });
        return { response: yesResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }

      // ── NO: acknowledge and continue ──
      if (bucket === 'NO') {
        const noText = `${fuc.no?.response || ''}`.trim() || 'No problem. How can I help you today?';
        nextState.agent2.discovery.lastPath = 'FOLLOWUP_NO';
        const noResponse = `${fuqAck} ${noText}`.trim();

        emit('A2_RESPONSE_READY', { path: 'FOLLOWUP_NO', responsePreview: clip(noResponse, 120) });
        return { response: noResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }

      // ── COMPLEX: clear pending, fall through to normal agent ──
      nextState.agent2.discovery.lastPath = 'FOLLOWUP_COMPLEX';
      emit('A2_FOLLOWUP_COMPLEX_FALLTHROUGH', {
        reason: 'Caller gave substantive non-yes/no response to follow-up — routing through normal discovery',
        inputPreview: clip(inputLowerCleanFUQ, 80)
      });
      // Fall through — normal trigger matching / LLM will handle this turn
    }

    // ══════════════════════════════════════════════════════════════════════════
    // V120: PENDING QUESTION STATE MACHINE (BULLETPROOF VERSION)
    // ══════════════════════════════════════════════════════════════════════════
    // If we asked a follow-up question last turn, the user's response MUST be
    // interpreted as an answer to that question. Only 3 outcomes allowed:
    //   1. YES → transition to booking/next step
    //   2. NO → offer alternatives
    //   3. REPROMPT → if input is garbage/unclear, ask again cleanly
    // 
    // NO "continue normal processing" — that's how we get lost.
    // ══════════════════════════════════════════════════════════════════════════
    
    const pendingQuestion = nextState.agent2.discovery.pendingQuestion || null;
    const pendingQuestionTurn = nextState.agent2.discovery.pendingQuestionTurn || null;
    const pendingQuestionSource = nextState.agent2.discovery.pendingQuestionSource || null;
    const hasPendingQuestion = pendingQuestion && typeof pendingQuestionTurn === 'number';
    const isRespondingToPending = hasPendingQuestion && pendingQuestionTurn === (turn - 1);
    
    // V127: Build pendingInfo object for logging and state management
    // This was previously undefined causing "pendingInfo is not defined" crashes
    const pendingInfo = hasPendingQuestion ? {
      question: pendingQuestion,
      turn: pendingQuestionTurn,
      source: pendingQuestionSource,
      cardId: pendingQuestionSource?.startsWith('card:') ? pendingQuestionSource.replace('card:', '') : null
    } : null;
    
    // Check if this is a scheduling-related pending question
    const isSchedulingQuestion = pendingQuestion && (
      /schedule|book|appointment|service today/i.test(pendingQuestion) ||
      pendingQuestionSource?.includes('card:') ||
      pendingQuestionSource === 'fallback.clarifier'
    );
    
    if (isRespondingToPending) {
      // ────────────────────────────────────────────────────────────────────────
      // STEP 1: Classify the user's response as YES / NO / MICRO / OTHER
      // ────────────────────────────────────────────────────────────────────────
      const inputLowerClean = inputLower.replace(/[^a-z\s]/g, '').trim();
      const inputWords = inputLowerClean.split(/\s+/).filter(Boolean);
      const inputLength = input.trim().length;
      
      // V120: EXPANDED YES PATTERNS (aggressive matching)
      // Matches: "yes", "yeah please", "yes uh please", "let's do it", "sure thing", etc.
      const YES_WORDS = new Set(['yes', 'yeah', 'yep', 'yea', 'sure', 'ok', 'okay', 'please', 'absolutely', 'definitely', 'certainly']);
      const YES_PHRASES = ['go ahead', 'do it', 'lets do it', 'let us do it', 'sounds good', 'that works', 'works for me', 'schedule', 'book', 'book it', 'set it up', 'im ready', 'i am ready', 'i would', 'i do', 'that would be great', 'perfect', 'great'];
      
      // Check if any word is a yes-word OR input contains a yes-phrase
      const hasYesWord = inputWords.some(w => YES_WORDS.has(w));
      const hasYesPhrase = YES_PHRASES.some(phrase => inputLowerClean.includes(phrase));
      
      // V120: EXPANDED NO PATTERNS
      const NO_WORDS = new Set(['no', 'nope', 'nah', 'negative']);
      const NO_PHRASES = ['not yet', 'not now', 'not today', 'maybe later', 'ill call', 'i will call', 'ill think', 'i will think', 'just asking', 'just a question', 'dont schedule', 'do not schedule', 'not right now', 'another time', 'later'];
      
      const hasNoWord = inputWords.some(w => NO_WORDS.has(w));
      const hasNoPhrase = NO_PHRASES.some(phrase => inputLowerClean.includes(phrase));
      
      // V120: MICRO-UTTERANCE DETECTION (garbage/partial STT)
      // If input is very short and doesn't clearly match yes/no, it's likely garbage
      const isMicroUtterance = inputLength <= 8 && !hasYesWord && !hasNoWord;
      const looksLikeName = inputLength <= 15 && /^[a-z]+,?$/i.test(input.trim()); // "mark," pattern
      
      // Final classification
      const isYes = (hasYesWord || hasYesPhrase) && !hasNoWord && !hasNoPhrase;
      const isNo = (hasNoWord || hasNoPhrase) && !hasYesWord && !hasYesPhrase;
      const needsReprompt = isMicroUtterance || looksLikeName || (!isYes && !isNo && inputLength <= 15);
      
      // ────────────────────────────────────────────────────────────────────────
      // STEP 2: Handle each outcome
      // ────────────────────────────────────────────────────────────────────────
      
      emit('A2_PENDING_QUESTION_RESOLVED', {
        question: clip(pendingQuestion, 80),
        askedInTurn: pendingQuestionTurn,
        resolvedInTurn: turn,
        userResponse: clip(input, 80),
        classification: isYes ? 'YES' : isNo ? 'NO' : needsReprompt ? 'REPROMPT' : 'COMPLEX',
        isSchedulingQuestion
      });
      
      if (isYes) {
        // ══════════════════════════════════════════════════════════════════════
        // PATH: PENDING_QUESTION_YES — User confirmed (generic pendingQuestion)
        // NOTE: Trigger card follow-ups use pendingFollowUpQuestion (separate handler above).
        // This path handles LLM follow-ups, discovery consent, and other non-trigger questions.
        // ══════════════════════════════════════════════════════════════════════
        nextState.agent2.discovery.pendingQuestion = null;
        nextState.agent2.discovery.pendingQuestionTurn = null;
        nextState.agent2.discovery.pendingQuestionResolved = true;
        nextState.agent2.discovery.lastPath = 'PENDING_YES';
        
        const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
        nextState.agent2.discovery.usedNameThisTurn = usedName;
        
        const pendingResponses = safeObj(discoveryCfg?.pendingQuestionResponses, {});
        const pendingYes = `${pendingResponses.yes || fallback.pendingYesResponse || ''}`.trim();
        let response;
        let responseUiPath;
        
        if (pendingYes) {
          response = `${personalAck} ${pendingYes}`.trim();
          responseUiPath = pendingResponses.yes
            ? 'aiAgentSettings.agent2.discovery.pendingQuestionResponses.yes'
            : 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingYesResponse';
        } else {
          response = personalAck || '';
          responseUiPath = null;
        }
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_YES', 
          reason: `User confirmed: detected YES markers`,
          markers: { hasYesWord, hasYesPhrase, inputPreview: clip(inputLowerClean, 40) },
          pendingInfo: { cardId: pendingInfo?.cardId, source: pendingInfo?.source }
        });
        
        const yesValidation = validateSpeechSource({
          response,
          sourceId: 'agent2.discovery.pendingQuestion.yesPath',
          uiPath: responseUiPath,
          configPath: pendingResponses.yes
            ? 'discovery.pendingQuestionResponses.yes'
            : 'discovery.playbook.fallback.pendingYesResponse',
          uiTab: 'Configuration',
          audioUrl: null,
          reason: `User confirmed YES to pending question from card: ${pendingInfo?.cardId || 'unknown'}`,
          emergencyFallback,
          emit
        });
        response = yesValidation.response;
        
        emit('A2_RESPONSE_READY', {
          path: 'PENDING_QUESTION_YES',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'pendingQuestion.yesPath',
          usedCallerName: usedName,
          wasBlocked: yesValidation.blocked
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }
      
      if (isNo) {
        // ══════════════════════════════════════════════════════════════════════
        // PATH: PENDING_QUESTION_NO — User declined
        // ══════════════════════════════════════════════════════════════════════
        nextState.agent2.discovery.pendingQuestion = null;
        nextState.agent2.discovery.pendingQuestionTurn = null;
        nextState.agent2.discovery.pendingQuestionResolved = true;
        nextState.agent2.discovery.lastPath = 'PENDING_NO';
        
        const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
        nextState.agent2.discovery.usedNameThisTurn = usedName;
        
        // V128: Pending question NO response (new namespace with legacy fallback)
        const pendingResponses = safeObj(discoveryCfg?.pendingQuestionResponses, {});
        const pendingNo = `${pendingResponses.no || fallback.pendingNoResponse || ''}`.trim();
        let response;
        let noResponseUiPath;
        
        if (pendingNo) {
          response = `${personalAck} ${pendingNo}`.trim();
          noResponseUiPath = pendingResponses.no
            ? 'aiAgentSettings.agent2.discovery.pendingQuestionResponses.no'
            : 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingNoResponse';
        } else {
          // No UI-configured pendingNoResponse - validateSpeechSource will handle fallback
          response = personalAck || '';
          noResponseUiPath = null;
        }
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_NO', 
          reason: `User declined: detected NO markers`,
          markers: { hasNoWord, hasNoPhrase, inputPreview: clip(inputLowerClean, 40) },
          pendingInfo: { cardId: pendingInfo?.cardId, source: pendingInfo?.source }
        });
        
        // V127: Use validateSpeechSource for consistent SPEAK_PROVENANCE logging
        const noValidation = validateSpeechSource({
          response,
          sourceId: 'agent2.discovery.pendingQuestion.noPath',
          uiPath: noResponseUiPath,
          configPath: pendingResponses.no
            ? 'discovery.pendingQuestionResponses.no'
            : 'discovery.playbook.fallback.pendingNoResponse',
          uiTab: 'Configuration',
          audioUrl: null,
          reason: `User said NO to pending question from card: ${pendingInfo?.cardId || 'unknown'}`,
          emergencyFallback,
          emit
        });
        response = noValidation.response;
        
        emit('A2_RESPONSE_READY', {
          path: 'PENDING_QUESTION_NO',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'pendingQuestion.noPath',
          usedCallerName: usedName,
          wasBlocked: noValidation.blocked
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }
      
      if (needsReprompt) {
        // ══════════════════════════════════════════════════════════════════════
        // PATH: PENDING_QUESTION_REPROMPT — Garbage/unclear input, ask again
        // ══════════════════════════════════════════════════════════════════════
        // DON'T clear pendingQuestion — we're re-asking
        nextState.agent2.discovery.lastPath = 'PENDING_REPROMPT';
        
        // V128: Build response - prefer UI-configured reprompt, then original question, then emergency
        const pendingResponses = safeObj(discoveryCfg?.pendingQuestionResponses, {});
        const pendingRepromptConfig = `${pendingResponses.reprompt || fallback.pendingReprompt || ''}`.trim();
        const pendingQ = pendingInfo?.question || '';
        let response;
        let repromptUiPath;
        let repromptConfigPath;
        
        if (pendingRepromptConfig) {
          response = pendingRepromptConfig;
          repromptUiPath = pendingResponses.reprompt
            ? 'aiAgentSettings.agent2.discovery.pendingQuestionResponses.reprompt'
            : 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingReprompt';
          repromptConfigPath = pendingResponses.reprompt
            ? 'discovery.pendingQuestionResponses.reprompt'
            : 'discovery.playbook.fallback.pendingReprompt';
        } else if (pendingQ) {
          // No reprompt configured: re-ask the UI-owned question without adding hardcoded prefix text
          response = pendingQ;
          repromptUiPath = `aiAgentSettings.agent2.discovery.playbook.rules[id=${pendingInfo?.cardId}].followUp.question`;
          repromptConfigPath = repromptUiPath.replace('aiAgentSettings.agent2.', '');
        } else {
          // No reprompt config and no question - validateSpeechSource will handle fallback
          response = '';
          repromptUiPath = null;
          repromptConfigPath = 'UNMAPPED';
        }
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_REPROMPT', 
          reason: `Micro-utterance or unclear response`,
          inputLength,
          isMicroUtterance,
          looksLikeName,
          inputPreview: clip(input, 40),
          pendingInfo: { cardId: pendingInfo?.cardId, source: pendingInfo?.source }
        });
        
        // V127: Use validateSpeechSource for consistent SPEAK_PROVENANCE logging
        const repromptValidation = validateSpeechSource({
          response,
          sourceId: 'agent2.discovery.pendingQuestion.reprompt',
          uiPath: repromptUiPath,
          configPath: repromptUiPath ? (repromptConfigPath || 'UNMAPPED') : 'UNMAPPED',
          uiTab: 'Configuration',
          audioUrl: null,
          reason: 'Reprompting after unclear response to pending question',
          emergencyFallback,
          emit
        });
        response = repromptValidation.response;
        
        emit('A2_RESPONSE_READY', {
          path: 'PENDING_QUESTION_REPROMPT',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'pendingQuestion.reprompt',
          wasBlocked: repromptValidation.blocked
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // PATH: PENDING_QUESTION_COMPLEX — User gave a substantive but unclear response
      // ══════════════════════════════════════════════════════════════════════
      // This should be RARE. Only for genuinely complex responses (15+ chars, not yes/no).
      // We clear the pending question but mark it so downstream doesn't re-ask.
      nextState.agent2.discovery.pendingQuestion = null;
      nextState.agent2.discovery.pendingQuestionTurn = null;
      nextState.agent2.discovery.pendingQuestionResolved = true;
      nextState.agent2.discovery.pendingQuestionWasComplex = true;
      
      emit('A2_PENDING_QUESTION_COMPLEX_RESPONSE', {
        question: clip(pendingQuestion, 80),
        userResponse: clip(input, 80),
        action: 'FALL_THROUGH_TO_TRIGGER_CARDS',
        reason: 'Response was substantive (15+ chars) but not clear yes/no'
      });
      
      // Fall through to trigger card matching, but DON'T let it ask the same question again
    } else if (hasPendingQuestion) {
      // Pending question exists but from a different turn — clear stale state
      nextState.agent2.discovery.pendingQuestion = null;
      nextState.agent2.discovery.pendingQuestionTurn = null;
    }
    
    // V120: Flag if we just resolved a pending question (for downstream logic)
    const justResolvedPending = nextState.agent2.discovery.pendingQuestionResolved === true;

    // ──────────────────────────────────────────────────────────────────────
    // PATH 1: ROBOT CHALLENGE
    // ──────────────────────────────────────────────────────────────────────
    if (style?.robotChallenge?.enabled === true && detectRobotChallenge(input)) {
      const line = `${style.robotChallenge?.line || ''}`.trim();
      const audioUrl = `${style.robotChallenge?.audioUrl || ''}`.trim();
      // V126: Robot challenge MUST have a UI-configured line. If missing, use fallback.noMatchAnswer or emergencyFallback.
      let response;
      let responseUiPath;
      if (line) {
        response = `${ack} ${line}`.trim();
        responseUiPath = 'aiAgentSettings.agent2.discovery.style.robotChallenge.line';
      } else if (fallback.noMatchAnswer) {
        response = `${ack} ${fallback.noMatchAnswer}`.trim();
        responseUiPath = 'aiAgentSettings.agent2.discovery.playbook.fallback.noMatchAnswer';
      } else if (emergencyFallback?.text) {
        response = `${ack} ${emergencyFallback.text}`.trim();
        responseUiPath = emergencyFallback.uiPath;
      } else {
        // CRITICAL: No UI-configured text available
        emit('SPOKEN_TEXT_UNMAPPED_BLOCKED', {
          blockedSourceId: 'agent2.discovery.robotChallenge',
          blockedText: 'robotChallenge.line is empty and no fallback configured',
          reason: 'No UI path mapped - Prime Directive violation',
          severity: 'CRITICAL'
        });
        response = ack; // Speak only the ack word, nothing else
        responseUiPath = 'UNMAPPED - CRITICAL';
      }
      nextState.agent2.discovery.lastPath = 'ROBOT_CHALLENGE';

      // V119: Emit path selection proof
      emit('A2_PATH_SELECTED', {
        path: 'ROBOT_CHALLENGE',
        reason: 'Robot/human challenge detected in input',
        inputPreview: clip(input, 60)
      });

      // V119: Emit response ready proof
      // V125: SPEECH_SOURCE_SELECTED for UI traceability
      emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
        'agent2.discovery.robotChallenge',
        'aiAgentSettings.agent2.discovery.style.robotChallenge',
        response,
        audioUrl,
        'Robot/human challenge detected - custom response triggered'
      ));
      emit('A2_RESPONSE_READY', {
        path: 'ROBOT_CHALLENGE',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: !!audioUrl,
        audioUrl: audioUrl || null,
        source: 'style.robotChallenge'
      });

      return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState, audioUrl: audioUrl || null };
    }

    // ──────────────────────────────────────────────────────────────────────
    // PATH 1.5: LLM HANDOFF CONFIRMATION CHECK
    // ──────────────────────────────────────────────────────────────────────
    // If LLM asked a service-confirm question last turn, check for YES/NO response.
    // If YES → set bookingIntentConfirmed, emit event, respond with UI-owned handoff line.
    // If NO → offer alternative (message/forward if enabled) or continue discovery.
    // ──────────────────────────────────────────────────────────────────────
    const llmHandoffPending = state?.agent2?.discovery?.llmHandoffPending;
    
    if (llmHandoffPending && typeof llmHandoffPending === 'object') {
      const inputLower = (input || '').toLowerCase().trim();
      
      // Simple YES detection
      const isYes = /^(yes|yeah|yep|sure|ok|okay|absolutely|definitely|please|go ahead|let's do it|sounds good|that works)/.test(inputLower);
      // Simple NO detection
      const isNo = /^(no|nope|nah|not|i don't|i'm not|never mind|cancel|forget|actually)/.test(inputLower);
      
      if (isYes) {
        // Caller confirmed service intent — hand off to deterministic flow
        nextState.agent2.discovery.bookingIntentConfirmed = true;
        nextState.agent2.discovery.llmHandoffPending = null; // Clear pending state
        nextState.agent2.discovery.lastPath = 'LLM_HANDOFF_CONFIRMED';
        
        emit('A2_LLM_HANDOFF_CONFIRMED_SERVICE', {
          mode: llmHandoffPending.mode,
          turn,
          response: 'yes'
        });
        
        // Use UI-owned response
        const handoffResponse = llmHandoffPending.yesResponse || "Perfect — I'm going to grab a few details so we can get this scheduled.";
        
        emit('A2_PATH_SELECTED', {
          path: 'LLM_HANDOFF_CONFIRMED',
          reason: 'Caller confirmed service intent after LLM assist',
          handoffMode: llmHandoffPending.mode,
          bookingIntentConfirmed: true
        });
        
        emit('A2_RESPONSE_READY', {
          path: 'LLM_HANDOFF_CONFIRMED',
          responsePreview: clip(handoffResponse, 120),
          responseLength: handoffResponse.length,
          hasAudio: false,
          source: 'llmFallback.handoff.confirmService.yesResponse'
        });
        
        return {
          response: handoffResponse,
          matchSource: 'AGENT2_DISCOVERY',
          state: nextState
        };
      } else if (isNo) {
        // Caller declined — clear pending, offer alternative
        nextState.agent2.discovery.llmHandoffPending = null;
        nextState.agent2.discovery.lastPath = 'LLM_HANDOFF_DECLINED';
        
        emit('A2_LLM_HANDOFF_DECLINED', {
          mode: llmHandoffPending.mode,
          turn,
          response: 'no'
        });
        
        // Use UI-owned response
        const declineResponse = llmHandoffPending.noResponse || "No problem. Is there anything else I can help you with today?";
        
        emit('A2_PATH_SELECTED', {
          path: 'LLM_HANDOFF_DECLINED',
          reason: 'Caller declined service intent after LLM assist',
          handoffMode: llmHandoffPending.mode
        });
        
        emit('A2_RESPONSE_READY', {
          path: 'LLM_HANDOFF_DECLINED',
          responsePreview: clip(declineResponse, 120),
          responseLength: declineResponse.length,
          hasAudio: false,
          source: 'llmFallback.handoff.confirmService.noResponse'
        });
        
        return {
          response: declineResponse,
          matchSource: 'AGENT2_DISCOVERY',
          state: nextState
        };
      }
      // If neither YES nor NO, clear pending and fall through to normal processing
      // (Caller might have asked a different question)
      nextState.agent2.discovery.llmHandoffPending = null;
    }

    // ──────────────────────────────────────────────────────────────────────
    // PATH 2: TRIGGER CARD MATCHING (PRIMARY — DETERMINISTIC)
    // ──────────────────────────────────────────────────────────────────────
    // Uses NORMALIZED input from vocabulary processing
    // Passes hints for optional card boosting (if TriggerCardMatcher supports it)
    // V4: Intent Priority Gate config controls FAQ card disqualification
    // ──────────────────────────────────────────────────────────────────────
    const triggerCards = safeArr(playbook.rules);
    const cardPoolStats = TriggerCardMatcher.getPoolStats(triggerCards);
    const activeHints = nextState.agent2.hints || [];
    const activeLocks = nextState.agent2.locks || {};
    const intentGateConfig = discoveryCfg.intentGate || {};
    const globalNegativeKeywords = agent2.globalNegativeKeywords || [];
    
    // ──────────────────────────────────────────────────────────────────────────
    // TRIGGER MATCHING with ScrabEngine enhanced tokens
    // ──────────────────────────────────────────────────────────────────────────
    const triggerResult = TriggerCardMatcher.match(normalizedInput, triggerCards, {
      hints: activeHints,
      locks: activeLocks,
      intentGateConfig,
      globalNegativeKeywords,
      // 🔍 SCRABENGINE: Pass expanded tokens for flexible matching
      expandedTokens: expandedTokens,
      originalTokens: originalTokens,
      expansionMap: expansionMap
    });
    
    // Store intent gate result for empathy layer (V4)
    if (triggerResult.intentGateResult) {
      nextState.agent2.discovery.lastIntentGateResult = triggerResult.intentGateResult;
    }

    // Emit detailed trigger evaluation for debugging
    emit('A2_TRIGGER_EVAL', {
      matched: triggerResult.matched,
      matchType: triggerResult.matchType,
      matchedOn: triggerResult.matchedOn,
      cardId: triggerResult.cardId,
      cardLabel: triggerResult.cardLabel,
      totalCards: triggerResult.totalCards,
      enabledCards: triggerResult.enabledCards,
      negativeBlocked: triggerResult.negativeBlocked,
      // V4: Intent Priority Gate info
      intentGateBlocked: triggerResult.intentGateBlocked || 0,
      intentGateResult: triggerResult.intentGateResult ? {
        serviceDownDetected: triggerResult.intentGateResult.serviceDownDetected,
        emergencyDetected: triggerResult.intentGateResult.emergencyDetected,
        urgencyScore: triggerResult.intentGateResult.urgencyScore,
        matchedPatterns: triggerResult.intentGateResult.matchedPatterns?.length || 0
      } : null,
      evaluated: triggerResult.evaluated.slice(0, 10),
      // Vocabulary integration info
      usedNormalizedInput: normalizedInput !== input,
      normalizedPreview: normalizedInput !== input ? clip(normalizedInput, 60) : null,
      activeHints: activeHints.length > 0 ? activeHints : null,
      activeLocks: Object.keys(activeLocks).length > 0 ? activeLocks : null,
      hintBoostApplied: triggerResult.hintBoostApplied || false
    });
    
    // V4: TRIGGER_CARDS_EVALUATED - Show all candidates and single winner
    // This proves exactly one card was selected (or none)
    const matchedCards = triggerResult.evaluated.filter(e => e.matched);
    const candidateCards = triggerResult.evaluated.filter(e => 
      !e.skipped && (e.keywordHit || e.phraseHit)
    );
    emit('TRIGGER_CARDS_EVALUATED', {
      inputPreview: clip(normalizedInput, 60),
      totalCardsInPool: triggerResult.totalCards,
      enabledCards: triggerResult.enabledCards,
      candidatesFound: candidateCards.length,
      winnersSelected: matchedCards.length,
      winner: triggerResult.matched ? {
        cardId: triggerResult.cardId,
        cardLabel: triggerResult.cardLabel,
        matchType: triggerResult.matchType,
        matchedOn: triggerResult.matchedOn
      } : null,
      candidates: candidateCards.map(c => ({
        cardId: c.cardId,
        cardLabel: c.cardLabel,
        effectivePriority: c.effectivePriority,
        keywordHit: c.keywordHit,
        phraseHit: c.phraseHit
      })),
      blocked: {
        byNegativeKeywords: triggerResult.negativeBlocked,
        byIntentGate: triggerResult.intentGateBlocked || 0,
        byGlobalNegative: triggerResult.globalNegativeBlocked ? triggerResult.globalNegativeHit : null
      },
      singleWinnerEnforced: true,
      rule: 'First match by priority wins. Only ONE card can be selected per turn.'
    });

    if (triggerResult.matched && triggerResult.card) {
      const card = triggerResult.card;
      const cardAnswer = card.answer || {};
      const answerText = `${cardAnswer.answerText || ''}`.trim();
      const audioUrl = `${cardAnswer.audioUrl || ''}`.trim();
      const followUpQuestion = `${card.followUp?.question || ''}`.trim();
      const nextAction = card.followUp?.nextAction || 'CONTINUE';
      const defaultAfter = `${fallback.afterAnswerQuestion || ''}`.trim();
      const afterQuestion = followUpQuestion || defaultAfter || null;
      
      // ════════════════════════════════════════════════════════════════════════
      // LLM TRIGGER MODE CHECK
      // If responseMode === 'llm', generate response from fact pack instead of
      // using static answerText. Audio is NEVER used for LLM triggers.
      // ════════════════════════════════════════════════════════════════════════
      const isLLMTrigger = card.responseMode === 'llm' && card.llmFactPack;

      // V119: Build personalized ack
      const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
      nextState.agent2.discovery.usedNameThisTurn = usedName;

      // Update state
      nextState.agent2.discovery.lastPath = isLLMTrigger ? 'TRIGGER_CARD_LLM' : 'TRIGGER_CARD_ANSWER';
      nextState.agent2.discovery.lastTriggerId = card.id || null;
      nextState.agent2.discovery.lastTriggerLabel = card.label || null;
      nextState.agent2.discovery.lastNextAction = nextAction;
      
      // Track follow-up question for consent gate or generic pending question.
      // If trigger card has its OWN follow-up → dedicated pendingFollowUpQuestion (5-bucket system).
      // If only the company-level default afterAnswer → legacy pendingQuestion system.
      if (followUpQuestion) {
        nextState.agent2.discovery.pendingFollowUpQuestion = followUpQuestion;
        nextState.agent2.discovery.pendingFollowUpQuestionTurn = typeof turn === 'number' ? turn : null;
        nextState.agent2.discovery.pendingFollowUpQuestionSource = `card:${card.id}`;
        nextState.agent2.discovery.pendingFollowUpQuestionNextAction = nextAction;
      } else if (afterQuestion) {
        nextState.agent2.discovery.pendingQuestion = afterQuestion;
        nextState.agent2.discovery.pendingQuestionTurn = typeof turn === 'number' ? turn : null;
        nextState.agent2.discovery.pendingQuestionSource = `card:${card.id}`;
      }

      // ════════════════════════════════════════════════════════════════════════
      // LLM TRIGGER PATH: Generate response from fact pack
      // ════════════════════════════════════════════════════════════════════════
      if (isLLMTrigger) {
        emit('A2_PATH_SELECTED', {
          path: 'TRIGGER_CARD_LLM',
          reason: `Matched LLM card: ${card.label || card.id}`,
          matchType: triggerResult.matchType,
          matchedOn: triggerResult.matchedOn,
          cardId: card.id,
          cardLabel: card.label,
          responseMode: 'llm',
          factPackIncludedLength: (card.llmFactPack.includedFacts || '').length,
          factPackExcludedLength: (card.llmFactPack.excludedFacts || '').length
        });
        
        const llmTriggerResult = await generateLLMTriggerResponse({
          callerInput: normalizedInput,
          factPack: card.llmFactPack,
          backupAnswer: card.llmFactPack?.backupAnswer || '',
          triggerLabel: card.label,
          triggerId: card.id,
          companyId,
          emit
        });
        
        let response = llmTriggerResult.response;
        
        // LLM responses don't need ack prefix if they sound natural
        const responseStartsWithAck = /^(ok|okay|sure|i|that|the|our|we|yes)/i.test(response);
        if (!responseStartsWithAck) {
          response = `${personalAck} ${response}`.trim();
        }
        
        // Add follow-up question if configured
        if (afterQuestion) {
          response = `${response} ${afterQuestion}`.trim();
        }
        
        emit('A2_RESPONSE_READY', {
          path: 'TRIGGER_CARD_LLM',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          audioUrl: null,
          source: `card:${card.id}:llm`,
          usedCallerName: usedName,
          nextAction,
          llmMeta: llmTriggerResult.llmMeta
        });
        
        emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
          `agent2.discovery.triggerCard[${card.id}]:llm`,
          `aiAgentSettings.agent2.discovery.playbook.rules[id=${card.id}].llmFactPack`,
          response,
          null,
          `LLM Trigger matched: ${card.label || card.id} - response generated from fact pack`
        ));
        
        return {
          response,
          matchSource: 'AGENT2_DISCOVERY',
          state: nextState,
          audioUrl: null,
          triggerCard: {
            id: card.id,
            label: card.label,
            matchType: triggerResult.matchType,
            matchedOn: triggerResult.matchedOn,
            nextAction,
            responseMode: 'llm',
            llmMeta: llmTriggerResult.llmMeta
          }
        };
      }

      // ════════════════════════════════════════════════════════════════════════
      // STANDARD TRIGGER PATH: Use static answerText and/or audio
      // ════════════════════════════════════════════════════════════════════════
      
      // Build response - V126: No hardcoded text allowed
      let response;
      if (answerText) {
        response = afterQuestion
          ? `${personalAck} ${answerText} ${afterQuestion}`.trim()
          : `${personalAck} ${answerText}`.trim();
      } else if (afterQuestion) {
        // Card has no answerText but has a follow-up question
        response = `${personalAck} ${afterQuestion}`.trim();
      } else if (emergencyFallback?.text) {
        // Card has no answerText and no follow-up - use emergency fallback
        response = `${personalAck} ${emergencyFallback.text}`.trim();
        emit('TRIGGER_CARD_EMPTY_ANSWER', {
          cardId: card.id,
          cardLabel: card.label,
          severity: 'WARNING',
          message: 'Trigger card matched but has no answerText or followUp - using emergencyFallback'
        });
      } else {
        // CRITICAL: Card matched but has nothing to say
        emit('SPOKEN_TEXT_UNMAPPED_BLOCKED', {
          blockedSourceId: `agent2.discovery.triggerCard[${card.id}]`,
          blockedText: `Card ${card.label || card.id} has no answerText or followUp`,
          reason: 'Trigger card matched but has no UI-configured response',
          severity: 'CRITICAL'
        });
        response = personalAck; // Speak only the ack word
      }

      // V119: Emit path selection proof
      emit('A2_PATH_SELECTED', {
        path: 'TRIGGER_CARD',
        reason: `Matched card: ${card.label || card.id}`,
        matchType: triggerResult.matchType,
        matchedOn: triggerResult.matchedOn,
        cardId: card.id,
        cardLabel: card.label
      });
      
      // ════════════════════════════════════════════════════════════════════════
      // A2_LLM_FALLBACK_DECISION - Log that LLM was blocked due to trigger card
      // This provides complete audit trail even when LLM code path is never reached
      // ════════════════════════════════════════════════════════════════════════
      emit('A2_LLM_FALLBACK_DECISION', {
        call: false,
        blocked: true,
        blockedBy: 'TRIGGER_CARD_MATCH',
        reason: `Trigger card matched: ${card.label || card.id}`,
        details: {
          triggerCardMatched: true,
          cardId: card.id,
          cardLabel: card.label,
          matchType: triggerResult.matchType
        },
        stateSnapshot: {
          triggerCardMatched: true,
          hasPendingQuestion: false,
          hasCapturedReasonFlow: false,
          hasAfterHoursFlow: false,
          hasTransferFlow: false,
          hasSpeakSourceSelected: true,
          bookingModeLocked: !!nextState.bookingModeLocked,
          inBookingFlow: false,
          inDiscoveryCriticalStep: false,
          llmTurnsThisCall: nextState.agent2?.discovery?.llmTurnsThisCall || 0
        },
        llmTurnsThisCall: nextState.agent2?.discovery?.llmTurnsThisCall || 0,
        maxTurns: agent2?.llmFallback?.triggers?.maxLLMFallbackTurnsPerCall ?? 1
      });

      // V119: Emit response ready proof
      // V125: SPEECH_SOURCE_SELECTED for UI traceability
      emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
        `agent2.discovery.triggerCard[${card.id}]`,
        `aiAgentSettings.agent2.discovery.playbook.rules[id=${card.id}]`,
        response,
        audioUrl,
        `Trigger card matched: ${card.label || card.id} (${triggerResult.matchType}: ${triggerResult.matchedOn})`
      ));
      emit('A2_RESPONSE_READY', {
        path: 'TRIGGER_CARD',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: !!audioUrl,
        audioUrl: audioUrl || null,
        source: `card:${card.id}`,
        usedCallerName: usedName,
        nextAction
      });

      // Substitute trigger card variables in response text for TTS fallback
      // e.g., {diagnosticfee} → "80 dollars"
      // This ensures if audio is missing/invalid, TTS reads actual values not placeholders
      const finalResponse = await substituteTriggerVariables(response, companyId);
      
      if (finalResponse !== response) {
        emit('A2_TRIGGER_VARIABLES_SUBSTITUTED', {
          cardId: card.id,
          originalLength: response.length,
          finalLength: finalResponse.length,
          hadPlaceholders: true
        });
      }

      return {
        response: finalResponse,
        matchSource: 'AGENT2_DISCOVERY',
        state: nextState,
        audioUrl: audioUrl || null,
        triggerCard: {
          id: card.id,
          label: card.label,
          matchType: triggerResult.matchType,
          matchedOn: triggerResult.matchedOn,
          nextAction
        }
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PATH 2.5: CLARIFIER QUESTIONS (when hints exist but no trigger match)
    // ══════════════════════════════════════════════════════════════════════════
    // If vocabulary added SOFT_HINTs (e.g., "maybe_thermostat") but no trigger card
    // matched, ask a clarifying question BEFORE guessing wrong.
    // This prevents the agent from assuming "thingy on the wall" means thermostat.
    // ══════════════════════════════════════════════════════════════════════════
    const clarifiersConfig = safeObj(discoveryCfg.clarifiers, {});
    const clarifiersEnabled = clarifiersConfig.enabled === true;
    const clarifierEntries = safeArr(clarifiersConfig.entries);
    const enabledClarifiers = clarifierEntries.filter(c => c.enabled !== false);
    const maxClarifiersPerCall = clarifiersConfig.maxAsksPerCall || 2;
    const clarifiersAskedThisCall = nextState.agent2.discovery.clarifiersAskedCount || 0;
    
    // V124: Emit clarifier config visibility (like vocab) so you can diagnose "clarifiers not running"
    emit('A2_CLARIFIERS_CONFIG', {
      clarifiersEnabled,
      totalEntriesLoaded: clarifierEntries.length,
      enabledEntries: enabledClarifiers.length,
      maxAsksPerCall: maxClarifiersPerCall,
      askedThisCall: clarifiersAskedThisCall,
      activeHintsForClarification: activeHints.length
    });
    
    // Check if we have active hints that need clarification
    if (clarifiersEnabled && activeHints.length > 0 && clarifiersAskedThisCall < maxClarifiersPerCall) {
      // Find a clarifier that matches one of our active hints
      const sortedClarifiers = [...clarifierEntries]
        .filter(c => c.enabled !== false)
        .sort((a, b) => (a.priority || 100) - (b.priority || 100));
      
      for (const clarifier of sortedClarifiers) {
        const hintTrigger = clarifier.hintTrigger;
        if (activeHints.includes(hintTrigger)) {
          // Found a clarifier for one of our hints
          const clarifierQuestion = `${clarifier.question || ''}`.trim();
          
          if (clarifierQuestion) {
            // Build personalized ack
            const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
            nextState.agent2.discovery.usedNameThisTurn = usedName;
            
            // Store clarifier state
            nextState.agent2.discovery.pendingClarifier = {
              id: clarifier.id,
              hintTrigger: hintTrigger,
              locksTo: clarifier.locksTo || null
            };
            nextState.agent2.discovery.pendingClarifierTurn = typeof turn === 'number' ? turn : null;
            nextState.agent2.discovery.clarifiersAskedCount = clarifiersAskedThisCall + 1;
            nextState.agent2.discovery.lastPath = 'CLARIFIER_ASKED';
            
            const response = clarifierQuestion;
            
            emit('A2_PATH_SELECTED', {
              path: 'CLARIFIER',
              reason: `Hint "${hintTrigger}" needs clarification before matching`,
              hint: hintTrigger,
              clarifierId: clarifier.id
            });
            
            emit('A2_CLARIFIER_ASKED', {
              clarifierId: clarifier.id,
              hintTrigger: hintTrigger,
              questionPreview: clip(clarifierQuestion, 80),
              locksTo: clarifier.locksTo,
              askNumber: clarifiersAskedThisCall + 1,
              maxAllowed: maxClarifiersPerCall
            });
            
            // V125: SPEECH_SOURCE_SELECTED
            emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
              `agent2.discovery.clarifiers[${clarifier.id}]`,
              `aiAgentSettings.agent2.discovery.clarifiers.entries[id=${clarifier.id}]`,
              response,
              null,
              `Clarifier question triggered by hint: ${hintTrigger}`
            ));
            emit('A2_RESPONSE_READY', {
              path: 'CLARIFIER',
              responsePreview: clip(response, 120),
              responseLength: response.length,
              hasAudio: false,
              source: `clarifier:${clarifier.id}`,
              usedCallerName: usedName
            });
            
            return {
              response,
              matchSource: 'AGENT2_DISCOVERY',
              state: nextState
            };
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // PATH 3: SCENARIO ENGINE FALLBACK (OPT-IN ONLY - V119)
    // ──────────────────────────────────────────────────────────────────────
    // HARD GATE: ScenarioEngine is OFF by default. 
    // ONLY runs if playbook.useScenarioFallback === true (strict equality)
    // This is legacy code that will be removed once Trigger Cards cover all scenarios.
    
    let answerText = null;
    let scenarioUsed = false;
    
    // V119: HARD GATE - strict equality check, not truthy
    if (useScenarioFallback === true) {
      // Lazy-load ScenarioEngine only if needed
      if (!ScenarioEngine) {
        try {
          ScenarioEngine = require('../../ScenarioEngine');
        } catch (e) {
          logger.warn('[AGENT2] ScenarioEngine not available', { error: e.message });
        }
      }

      if (ScenarioEngine) {
        const globalAllowedTypes = new Set(safeArr(playbook.allowedScenarioTypes).map((t) => `${t}`.trim().toUpperCase()).filter(Boolean));
        const minScore = Number.isFinite(playbook.minScenarioScore) ? playbook.minScenarioScore : 0.72;

        let scenarioPicked = null;
        let scenarioConfidence = 0;
        let scenarioCandidates = [];
        let scenarioDebug = { error: null, message: null, enforcement: null, templateMeta: null, queryMeta: null, tier1BestScore: 0, tier2BestScore: 0 };

        try {
          const engine = new ScenarioEngine();
          const result = await engine.selectResponse({
            companyId: companyId || company?._id?.toString?.() || null,
            tradeKey: company?.tradeKey || company?.industryType || 'universal',
            text: input,
            session: {
              sessionId: callSid || 'unknown',
              callerPhone: null,
              signals: { lane: 'DISCOVERY', agent2: true }
            },
            options: {
              allowTier3: false,
              maxCandidates: 5
            }
          });

          scenarioConfidence = Number(result?.confidence || 0);
          scenarioPicked = result?.scenario || null;
          scenarioDebug = {
            error: result?.error || null,
            message: result?.message || null,
            enforcement: result?.enforcement || null,
            templateMeta: result?.templateMeta || null,
            queryMeta: result?.queryMeta || null,
            tier1BestScore: Number(result?.matchMeta?.tier1?.bestScore || 0),
            tier2BestScore: Number(result?.matchMeta?.tier2?.bestScore || 0)
          };
          scenarioCandidates = safeArr(result?.matchMeta?.tier2?.topCandidates).slice(0, 5).map((c) => ({
            scenarioId: c?.scenarioId || c?._id || null,
            title: c?.title || c?.name || null,
            score: c?.score ?? c?.confidence ?? null,
            type: c?.type || c?.scenarioType || null
          }));
        } catch (e) {
          logger.warn('[AGENT2] Scenario selection failed (non-fatal)', { callSid, error: e.message });
          scenarioDebug.error = e.message;
        }

        const scenarioType = normalizeScenarioType(scenarioPicked);
        const typeAllowedByGlobal = globalAllowedTypes.size === 0 ? true : (scenarioType ? globalAllowedTypes.has(scenarioType) : false);
        const scoreAllowed = scenarioConfidence >= minScore;

        const totalPool = Number(scenarioDebug?.enforcement?.totalScenarios || 0);
        const eligiblePool = Number(scenarioDebug?.enforcement?.enterpriseReadyCount || 0);
        let zeroWhy = null;
        if (scenarioDebug?.error) zeroWhy = scenarioDebug.error;
        else if (totalPool === 0) zeroWhy = 'POOL_EMPTY';
        else if (eligiblePool === 0 && totalPool > 0 && scenarioDebug?.enforcement?.enabled === true) zeroWhy = 'FILTERED_BY_ENTERPRISE_ENFORCEMENT';
        else if (scenarioConfidence < minScore) zeroWhy = 'TOP_SCORE_BELOW_MIN';

        // Emit scenario evaluation for debugging
        emit('A2_SCENARIO_EVAL', {
          tried: true,
          enabled: true,
          minScore,
          confidence: scenarioConfidence,
          scoreAllowed,
          scenarioType,
          typeAllowed: typeAllowedByGlobal,
          scenarioId: scenarioPicked?._id?.toString?.() || scenarioPicked?.id || null,
          poolTotal: totalPool,
          poolEligible: eligiblePool,
          zeroWhy,
          candidates: scenarioCandidates.slice(0, 3)
        });

        // Check if scenario is usable
        if (scenarioPicked && scoreAllowed && typeAllowedByGlobal) {
          const rawScenarioResponse =
            scenarioPicked.response ||
            scenarioPicked.responseText ||
            scenarioPicked.answer ||
            scenarioPicked.text ||
            null;
          answerText = sanitizeScenarioText(rawScenarioResponse);
          nextState.agent2.discovery.lastScenarioId = scenarioPicked?._id?.toString?.() || scenarioPicked?.id || null;
          scenarioUsed = true;
        }
      }
    } else {
      // V119: ScenarioEngine is OFF — emit proof
      emit('A2_SCENARIO_EVAL', {
        tried: false,
        enabled: false,
        reason: 'playbook.useScenarioFallback is not true (V119 default: OFF)'
      });
    }

    const defaultAfter = `${fallback.afterAnswerQuestion || ''}`.trim();
    const afterQuestion = defaultAfter || null;

    // ──────────────────────────────────────────────────────────────────────
    // RESPONSE COMPOSITION (V119 - DISTINCT FALLBACK PATHS)
    // ──────────────────────────────────────────────────────────────────────
    // CRITICAL: Fallback MUST distinguish "reason captured" vs "no reason"
    // Never say "How can I help?" when we already know the reason.
    
    let response = null;
    let pathSelected = null;
    let pathReason = null;

    // V119: Build personalized ack
    const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
    nextState.agent2.discovery.usedNameThisTurn = usedName;

    if (answerText && scenarioUsed) {
      // Path 3a: Scenario engine provided an answer (only if enabled and matched)
      response = afterQuestion
        ? `${personalAck} ${answerText} ${afterQuestion}`.trim()
        : `${personalAck} ${answerText}`.trim();
      nextState.agent2.discovery.lastPath = 'SCENARIO_ANSWER';
      pathSelected = 'SCENARIO';
      pathReason = 'ScenarioEngine matched with sufficient score';
      
      emit('A2_PATH_SELECTED', { path: 'SCENARIO', reason: pathReason });
      // V125: SPEECH_SOURCE_SELECTED - ScenarioEngine is a global fallback
      emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
        'scenarioEngine.fallback',
        'aiAgentSettings.agent2.discovery.playbook.useScenarioFallback (global scenarios)',
        response,
        null,
        `ScenarioEngine matched: ${scenarioText?.substring(0, 40)}...`
      ));
      emit('A2_RESPONSE_READY', {
        path: 'SCENARIO',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: false,
        source: 'ScenarioEngine',
        usedCallerName: usedName
      });
      
    } else {
      // ──────────────────────────────────────────────────────────────────────
      // PATH 4+: LLM FALLBACK (ASSIST-ONLY - UI-Controlled)
      // ──────────────────────────────────────────────────────────────────────
      // LLM is NOT a responder — it's a helper. Gets ONE shot, then funnels.
      // LLM NEVER offers time slots — only confirms service intent + hands off.
      
      // Track no-match count for this call
      const noMatchCount = (nextState.agent2.discovery.noMatchCount || 0) + 1;
      nextState.agent2.discovery.noMatchCount = noMatchCount;
      
      // Track LLM turns this call (max 1 by default)
      const llmTurnsThisCall = nextState.agent2.discovery.llmTurnsThisCall || 0;
      
      // Compute complexity score for logging
      const complexityResult = computeComplexityScore(input);
      emit('A2_COMPLEXITY_SCORE', {
        score: complexityResult.score,
        factors: complexityResult.factors,
        wordCount: complexityResult.wordCount,
        inputPreview: clip(input, 60)
      });
      
      // Check if we're in booking flow (block LLM during booking-critical steps)
      const inBookingFlow = !!(
        nextState.booking?.step === 'NAME' ||
        nextState.booking?.step === 'ADDRESS' ||
        nextState.booking?.step === 'TIME' ||
        nextState.booking?.step === 'CONFIRM' ||
        nextState.bookingModeLocked
      );
      
      // Check if we're in discovery-critical step (slot filling)
      const inDiscoveryCriticalStep = !!(
        nextState.slotFilling?.activeSlot
      );
      
      // Check additional blocking conditions
      const hasPendingQuestion = !!(
        nextState.agent2?.discovery?.pendingQuestion ||
        nextState.agent2?.discovery?.llmHandoffPending
      );
      
      const hasCapturedReasonFlow = !!(
        capturedReason && 
        nextState.agent2?.discovery?.clarifierPending
      );
      
      const hasAfterHoursFlow = !!(
        nextState.afterHours?.active ||
        nextState.catastrophicFallback?.active
      );
      
      const hasTransferFlow = !!(
        nextState.transfer?.pending ||
        nextState.transfer?.active
      );
      
      // Try LLM fallback (passes all blocking conditions)
      // By definition, if we reached this point, no trigger card matched
      // V5: Pass llmAssist state for Answer+Return mode tracking
      const llmResult = await runLLMFallback({
        config: agent2,
        input,
        noMatchCount,
        inBookingFlow,
        inDiscoveryCriticalStep,
        llmTurnsThisCall,
        llmAssistState: nextState.agent2.llmAssist, // V5: Pass state for cooldown/uses tracking
        hasPendingQuestion,
        hasCapturedReasonFlow,
        hasAfterHoursFlow,
        hasTransferFlow,
        hasSpeakSourceSelected: false, // At this point, no source selected yet
        callContext: {
          callSid,
          companyId: companyId || company?._id?.toString?.() || null,
          turn,
          capturedReason,
          sessionMode: nextState.sessionMode || 'DISCOVERY',
          triggerCardMatched: false, // By definition - we only reach here if no card matched
          bookingModeLocked: !!nextState.bookingModeLocked
        },
        emit
      });
      
      if (llmResult) {
        // LLM fallback provided a response — increment turn counter
        nextState.agent2.discovery.llmTurnsThisCall = llmTurnsThisCall + 1;
        nextState.agent2.discovery.lastPath = 'LLM_FALLBACK';
        nextState.agent2.discovery.lastLLMMode = llmResult.mode || 'guided';
        
        // V5: Apply state updates from Answer+Return mode
        if (llmResult.stateUpdate) {
          nextState.agent2.llmAssist = {
            ...nextState.agent2.llmAssist,
            ...llmResult.stateUpdate
          };
          emit('A2_LLM_ASSIST_STATE_UPDATED', {
            mode: llmResult.mode,
            newState: nextState.agent2.llmAssist,
            reason: 'LLM assist completed - cooldown and uses updated'
          });
        }
        
        // Store handoff state if awaiting confirmation (Guided mode only)
        if (llmResult.handoffAction?.awaitingConfirmation) {
          nextState.agent2.discovery.llmHandoffPending = {
            mode: llmResult.handoffAction.mode,
            yesResponse: llmResult.handoffAction.yesResponse,
            noResponse: llmResult.handoffAction.noResponse,
            turn: turn
          };
        }
        
        // Use personalized ack if appropriate  
        const { ack: llmAck, usedName: llmUsedName } = buildAck(ack, callerName, state);
        nextState.agent2.discovery.usedNameThisTurn = llmUsedName;
        
        // Don't double-ack if LLM response already sounds complete
        const llmStartsWithAck = /^(ok|okay|i'm sorry|i understand|that sounds|give me)/i.test(llmResult.response);
        response = llmStartsWithAck 
          ? llmResult.response 
          : `${llmAck} ${llmResult.response}`.trim();
        
        pathSelected = 'LLM_FALLBACK';
        pathReason = `LLM assist triggered: ${llmResult.llmMeta?.whyCalledLLM || 'unknown'}`;
        
        emit('A2_PATH_SELECTED', {
          path: 'LLM_FALLBACK',
          reason: pathReason,
          // V5: Include mode for clarity
          llmMode: llmResult.mode || 'guided',
          llmModel: llmResult.llmMeta?.model,
          tokensUsed: llmResult.llmMeta?.tokensInput + llmResult.llmMeta?.tokensOutput,
          costUsd: llmResult.llmMeta?.costUsd,
          usedEmergencyFallback: llmResult.llmMeta?.usedEmergencyFallback,
          constraintViolations: llmResult.llmMeta?.constraintViolations,
          handoffMode: llmResult.llmMeta?.handoffMode,
          awaitingConfirmation: llmResult.llmMeta?.awaitingConfirmation,
          // V5: Answer+Return state info
          llmAssistState: llmResult.mode === 'answer_return' ? nextState.agent2.llmAssist : null
        });
        
        emit('A2_RESPONSE_READY', {
          path: 'LLM_FALLBACK',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: llmResult.llmMeta?.usedEmergencyFallback ? 'llmFallback.emergencyFallback' : 'llmFallback.llm',
          usedCallerName: llmUsedName,
          isLLMAssist: !llmResult.llmMeta?.usedEmergencyFallback,
          handoffMode: llmResult.llmMeta?.handoffMode
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }
      
      // LLM fallback didn't run or failed - fall through to deterministic fallback paths
      // (the code continues in the else-if chain below)
    }
    
    // ──────────────────────────────────────────────────────────────────────
    // PATH 5: DETERMINISTIC FALLBACK (when scenario + LLM don't provide response)
    // ──────────────────────────────────────────────────────────────────────
    // These paths execute if we haven't returned yet (no scenario, no LLM success)
    
    if (response) {
      // Response already set by scenario path - skip fallback
    } else if (capturedReason) {
      // Path 5a: We captured a call reason but couldn't match — acknowledge and help
      // V119: This is the "noMatch_withReason" path — NEVER restart conversation
      // V4: NEVER echo caller text verbatim — use Human Tone + Discovery Handoff
      //
      // NO-UI-NO-SPEAK ENFORCEMENT:
      // ALL text MUST come from UI via resolveSpeakLine(). Zero literal strings.
      
      const humanToneConfig = discoveryCfg?.humanTone || {};
      const discoveryHandoffConfig = discoveryCfg?.discoveryHandoff || {};
      
      // V120: If we just resolved a pending question (complex response), DON'T ask another one
      const skipClarifierQuestion = justResolvedPending || nextState.agent2.discovery.pendingQuestionWasComplex;
      
      // ─────────────────────────────────────────────────────────────────────
      // V4: HUMAN TONE - Empathy from UI (via SpeakGate)
      // ─────────────────────────────────────────────────────────────────────
      // Determine which empathy template to use based on intent
      const intentGateResult = nextState.agent2?.discovery?.lastIntentGateResult;
      const isServiceDown = intentGateResult?.serviceDownDetected || 
                            /not\s+(cool|heat|work)|down|broken|emergency/i.test(capturedReasonRaw || '');
      
      // Pick the right UI path based on detected intent
      let empathyPrimaryPath;
      if (humanToneConfig.enabled !== false) {
        if (isServiceDown) {
          empathyPrimaryPath = 'discovery.humanTone.templates.serviceDown';
        } else {
          empathyPrimaryPath = 'discovery.humanTone.templates.general';
        }
      }
      
      // Use SpeakGate to resolve empathy line with proper fallback chain
      const empathyResult = resolveSpeakLine({
        uiPath: empathyPrimaryPath,
        fallbackUiPath: 'discovery.playbook.fallback.noMatchWhenReasonCaptured',
        emergencyUiPath: 'emergencyFallbackLine.text',
        config: agent2,
        emit,
        sourceId: 'agent2.discovery.humanTone',
        reason: isServiceDown ? 'Service-down intent detected' : 'General empathy'
      });
      
      let empathyLine = empathyResult.text;
      let empathyUiPath = empathyResult.uiPath;
      
      // ─────────────────────────────────────────────────────────────────────
      // V4: DISCOVERY HANDOFF - Consent question from UI (via SpeakGate)
      // ─────────────────────────────────────────────────────────────────────
      let nextQ = '';
      let nextQUiPath = '';
      
      if (!skipClarifierQuestion) {
        const handoffResult = resolveSpeakLine({
          uiPath: 'discovery.discoveryHandoff.consentQuestion',
          fallbackUiPath: 'discovery.playbook.fallback.noMatchClarifierQuestion',
          emergencyUiPath: null, // No emergency for question - just skip if not configured
          config: agent2,
          emit,
          sourceId: 'agent2.discovery.discoveryHandoff',
          reason: 'Handoff consent question'
        });
        
        // Only use question if it resolved (not blocked)
        if (!handoffResult.blocked && handoffResult.text) {
          nextQ = handoffResult.text;
          nextQUiPath = handoffResult.uiPath;
        }
        // If no question configured, that's OK - just use empathy alone
      }

      // Build final response: empathy + next question (NO echo, NO hardcoded text)
      if (empathyResult.blocked) {
        // CRITICAL: No empathy text available - response will be empty
        response = '';
        logger.error('[Agent2DiscoveryRunner] CRITICAL - No UI text for empathy response');
      } else {
        // Check if empathy already starts with an ack-like word
        const empathyLower = empathyLine.toLowerCase();
        const empathyStartsWithAck = empathyLower.startsWith('ok') ||
                                     empathyLower.startsWith('got it') ||
                                     empathyLower.startsWith('i hear') ||
                                     empathyLower.startsWith('i understand') ||
                                     empathyLower.startsWith('i can help') ||
                                     empathyLower.startsWith('i get it');
        
        // Use personalized ack if we have caller name and empathy doesn't start with ack
        const finalEmpathy = empathyStartsWithAck ? empathyLine : `${personalAck} ${empathyLine}`.trim();
        
        if (nextQ) {
          response = `${finalEmpathy} ${nextQ}`.replace(/\s+/g, ' ').trim();
        } else {
          response = finalEmpathy;
        }
      }
      
      nextState.agent2.discovery.lastPath = 'FALLBACK_REASON_CAPTURED';
      pathSelected = 'FALLBACK_WITH_REASON';
      pathReason = skipClarifierQuestion 
        ? 'No card/scenario match, reason captured, clarifier skipped (just resolved pending)'
        : 'No card/scenario match but call_reason_detail captured';
      
      // V120: Only track pending question if we actually asked one
      if (nextQ && !skipClarifierQuestion) {
        nextState.agent2.discovery.pendingQuestion = nextQ;
        nextState.agent2.discovery.pendingQuestionTurn = typeof turn === 'number' ? turn : null;
        nextState.agent2.discovery.pendingQuestionSource = 'discoveryHandoff.consentQuestion';
      }
      
      // V120: Clear the complex flag after using it
      if (nextState.agent2.discovery.pendingQuestionWasComplex) {
        delete nextState.agent2.discovery.pendingQuestionWasComplex;
      }
      
      emit('A2_PATH_SELECTED', { 
        path: 'FALLBACK_WITH_REASON', 
        reason: pathReason,
        capturedReasonPreview: clip(capturedReason, 60),
        capturedReasonRaw: clip(capturedReasonRaw, 60),
        sanitizedReason: capturedReason !== capturedReasonRaw,
        skippedClarifier: skipClarifierQuestion,
        usedHumanTone: humanToneConfig.enabled !== false,
        empathyUiPath,
        empathySeverity: empathyResult.severity,
        nextQUiPath: nextQUiPath || null
      });
      // V125: SPEECH_SOURCE_SELECTED - Must have valid UI path
      emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
        'agent2.discovery.humanTone',
        empathyUiPath,
        response,
        null,
        `HumanTone[${empathyResult.severity}]: ${empathyUiPath}, Handoff: ${nextQUiPath || 'none'}`
      ));
      emit('A2_RESPONSE_READY', {
        path: 'FALLBACK_WITH_REASON',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: false,
        source: humanToneConfig.enabled !== false ? 'empathyLayer' : 'fallback.noMatchWhenReasonCaptured',
        usedCallerName: usedName,
        hadClarifier: !!nextQ && !skipClarifierQuestion,
        pendingQuestion: nextQ || null,
        skippedClarifier: skipClarifierQuestion,
        noEchoMode: true
      });
      
    } else {
      // Path 5: No trigger match, no scenario match, no captured reason — true generic fallback
      // V120: If we just resolved a pending question, don't ask "how can I help?" — that's a restart
      const skipGenericQuestion = justResolvedPending || nextState.agent2.discovery.pendingQuestionWasComplex;
      
      // V126: All fallback text MUST come from UI config - no hardcoded strings
      let baseNoMatch;
      let noMatchUiPath;
      if (skipGenericQuestion) {
        // Complex response follow-up - use noMatchClarifierQuestion or emergencyFallback
        const clarifierQ = `${fallback.noMatchClarifierQuestion || ''}`.trim();
        if (clarifierQ) {
          baseNoMatch = clarifierQ;
          noMatchUiPath = 'aiAgentSettings.agent2.discovery.playbook.fallback.noMatchClarifierQuestion';
        } else if (emergencyFallback?.text) {
          baseNoMatch = emergencyFallback.text;
          noMatchUiPath = emergencyFallback.uiPath;
        } else {
          // CRITICAL: No UI-configured follow-up text
          emit('SPOKEN_TEXT_UNMAPPED_BLOCKED', {
            blockedSourceId: 'agent2.discovery.fallback.complexFollowup',
            blockedText: 'No noMatchClarifierQuestion or emergencyFallback configured',
            reason: 'No UI path mapped for complex response follow-up',
            severity: 'CRITICAL'
          });
          baseNoMatch = '';
          noMatchUiPath = 'UNMAPPED - CRITICAL';
        }
      } else {
        // True generic fallback - use noMatchAnswer or emergencyFallback
        const noMatchAnswer = `${fallback.noMatchAnswer || ''}`.trim();
        if (noMatchAnswer) {
          baseNoMatch = noMatchAnswer;
          noMatchUiPath = 'aiAgentSettings.agent2.discovery.playbook.fallback.noMatchAnswer';
        } else if (emergencyFallback?.text) {
          baseNoMatch = emergencyFallback.text;
          noMatchUiPath = emergencyFallback.uiPath;
        } else {
          // CRITICAL: No UI-configured fallback text
          emit('SPOKEN_TEXT_UNMAPPED_BLOCKED', {
            blockedSourceId: 'agent2.discovery.fallback.noMatchAnswer',
            blockedText: 'No noMatchAnswer or emergencyFallback configured',
            reason: 'No UI path mapped for generic fallback',
            severity: 'CRITICAL'
          });
          baseNoMatch = '';
          noMatchUiPath = 'UNMAPPED - CRITICAL';
        }
      }
      
      // V119: If noMatchAnswer already starts with ack, don't double-ack
      if (baseNoMatch.toLowerCase().startsWith('ok') || baseNoMatch.toLowerCase().startsWith(personalAck.toLowerCase().replace('.', ''))) {
        response = baseNoMatch;
      } else {
        response = `${personalAck} ${baseNoMatch}`.trim();
      }
      
      // V120: Clear the complex flag after using it
      if (nextState.agent2.discovery.pendingQuestionWasComplex) {
        delete nextState.agent2.discovery.pendingQuestionWasComplex;
      }
      
      nextState.agent2.discovery.lastPath = 'FALLBACK_NO_MATCH';
      pathSelected = 'FALLBACK_NO_REASON';
      pathReason = skipGenericQuestion 
        ? 'No card/scenario match, no reason, but just resolved pending (asking for more info)'
        : 'No card/scenario match and no call_reason_detail';
      
      emit('A2_PATH_SELECTED', { 
        path: 'FALLBACK_NO_REASON', 
        reason: pathReason,
        skippedGenericQuestion: skipGenericQuestion
      });
      // V125: SPEECH_SOURCE_SELECTED
      const fallbackSourceId = skipGenericQuestion 
        ? 'agent2.discovery.fallback.pendingComplexFollowup'
        : 'agent2.discovery.fallback.noMatchAnswer';
      const fallbackUiPath = skipGenericQuestion
        ? 'aiAgentSettings.agent2.discovery.playbook.fallback (implicit followup)'
        : 'aiAgentSettings.agent2.discovery.playbook.fallback.noMatchAnswer';
      emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
        fallbackSourceId,
        fallbackUiPath,
        response,
        null,
        skipGenericQuestion ? 'Following up after complex pending question response' : 'No trigger/scenario match, no reason captured - generic fallback'
      ));
      emit('A2_RESPONSE_READY', {
        path: 'FALLBACK_NO_REASON',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: false,
        source: skipGenericQuestion ? 'fallback.pendingComplexFollowup' : 'fallback.noMatchAnswer',
        usedCallerName: usedName,
        skippedGenericQuestion: skipGenericQuestion
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // V4: ECHO GUARD - FINAL CHECK BEFORE SPEAKING
    // ══════════════════════════════════════════════════════════════════════════
    // HARD RULE: The agent must NEVER echo raw caller text.
    // If the response contains suspicious overlap with caller input, BLOCK it
    // and replace with UI-owned emergency fallback.
    // ══════════════════════════════════════════════════════════════════════════
    if (response && input) {
      const echoCheck = Agent2EchoGuard.checkForEcho(input, response);
      
      if (echoCheck.blocked) {
        // CRITICAL: Response echoes caller text - this is a Prime Directive violation
        const emergencyText = agent2.emergencyFallbackLine?.text || '';
        const blockedEvent = Agent2EchoGuard.buildBlockedEvent(
          echoCheck,
          input,
          response,
          nextState.agent2?.discovery?.lastPath || 'unknown',
          turn
        );
        
        emit('A2_SPOKEN_ECHO_BLOCKED', blockedEvent);
        
        logger.error('[Agent2DiscoveryRunner] ECHO BLOCKED - Response contained caller text', {
          reason: echoCheck.reason,
          details: echoCheck.details,
          turn,
          responsePreview: clip(response, 60)
        });
        
        if (emergencyText) {
          // Use emergency fallback
          response = emergencyText;
          emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
            'agent2.echoGuard.emergencyFallback',
            'aiAgentSettings.agent2.emergencyFallbackLine.text',
            response,
            null,
            `Echo blocked (${echoCheck.reason}) - using emergency fallback`
          ));
        } else {
          // No emergency fallback configured - use minimal safe acknowledgment
          response = 'I can help you with that.';
          emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
            'agent2.echoGuard.minimalSafe',
            'UNMAPPED - Echo blocked, no emergency fallback configured',
            response,
            null,
            `Echo blocked (${echoCheck.reason}) - no emergency fallback, using minimal safe response`
          ));
          emit('EMERGENCY_FALLBACK_NOT_CONFIGURED', {
            severity: 'CRITICAL',
            message: 'Echo was blocked but no emergency fallback is configured',
            configPath: 'aiAgentSettings.agent2.emergencyFallbackLine.text'
          });
        }
      }
    }

    return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
  }
}

module.exports = { Agent2DiscoveryRunner };
