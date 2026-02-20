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
const { runLLMFallback, computeComplexityScore } = require('./Agent2LLMFallbackService');

// ScenarioEngine is lazy-loaded ONLY if useScenarioFallback is enabled
let ScenarioEngine = null;

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

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
    const capturedReason = naturalizeReason(state?.plainSlots?.call_reason_detail || state?.slots?.call_reason_detail || null);
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
      legacyBlocked: enabled ? ['DiscoveryFlowRunner', 'ScenarioEngine_auto'] : [],
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
    // VOCABULARY PROCESSING (BEFORE trigger matching)
    // ══════════════════════════════════════════════════════════════════════════
    // 1. HARD_NORMALIZE: Replace mishears (e.g., "acee" → "ac")
    // 2. SOFT_HINT: Add hints for ambiguous phrases (e.g., "thingy on wall" → maybe_thermostat)
    // ══════════════════════════════════════════════════════════════════════════
    const vocabularyConfig = safeObj(discoveryCfg.vocabulary, {});
    
    // V124: Get vocab stats for visibility — shows exactly what was loaded
    const vocabStats = Agent2VocabularyEngine.getStats(vocabularyConfig);
    
    const vocabularyResult = Agent2VocabularyEngine.process({
      userInput: input,
      state: nextState,
      config: vocabularyConfig
    });
    
    // Use normalized text for downstream processing
    const normalizedInput = vocabularyResult.normalizedText;
    const normalizedInputLower = normalizedInput.toLowerCase();
    
    // Store hints in state for downstream use (TriggerCardMatcher boosts, clarifier logic)
    nextState.agent2.hints = vocabularyResult.hints;
    nextState.agent2.discovery.lastVocabApplied = vocabularyResult.applied;
    
    // V124: Emit vocabulary evaluation proof with FULL config visibility
    // This shows exactly what was loaded so you can diagnose "vocab not running" issues
    emit('A2_VOCAB_EVAL', {
      inputPreview: clip(input, 60),
      normalizedPreview: normalizedInput !== input ? clip(normalizedInput, 60) : null,
      wasNormalized: normalizedInput !== input,
      appliedCount: vocabularyResult.applied.length,
      applied: vocabularyResult.applied.slice(0, 10),
      hintsAdded: vocabularyResult.hints,
      stats: vocabularyResult.stats,
      // V124: Config load proof — if these are 0 when you expect entries, check config path
      configLoaded: {
        vocabEnabled: vocabStats.enabled,
        totalEntriesLoaded: vocabStats.totalEntries,
        enabledEntries: vocabStats.enabledEntries,
        hardNormalizeCount: vocabStats.hardNormalizeCount,
        softHintCount: vocabStats.softHintCount
      }
    });
    
    // Emit active hints if any
    if (vocabularyResult.hints.length > 0) {
      emit('A2_HINTS_ACTIVE', {
        hints: vocabularyResult.hints,
        locks: nextState.agent2.locks || {}
      });
    }
    
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
        // PATH: PENDING_QUESTION_YES — User confirmed, transition to booking
        // ══════════════════════════════════════════════════════════════════════
        nextState.agent2.discovery.pendingQuestion = null;
        nextState.agent2.discovery.pendingQuestionTurn = null;
        nextState.agent2.discovery.pendingQuestionResolved = true;
        nextState.agent2.discovery.lastPath = 'PENDING_YES';
        
        const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
        nextState.agent2.discovery.usedNameThisTurn = usedName;
        
        // V126: Pending question YES response - UI-configured field
        const pendingYes = `${fallback.pendingYesResponse || ''}`.trim();
        let response;
        let responseUiPath;
        
        // V127: Build response and validate through SPEAK_PROVENANCE system
        if (pendingYes) {
          response = `${personalAck} ${pendingYes}`.trim();
          responseUiPath = 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingYesResponse';
        } else {
          // No UI-configured pendingYesResponse - validateSpeechSource will handle fallback
          response = personalAck || 'Let me help you with that.';
          responseUiPath = null;
        }
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_YES', 
          reason: `User confirmed: detected YES markers`,
          markers: { hasYesWord, hasYesPhrase, inputPreview: clip(inputLowerClean, 40) },
          pendingInfo: { cardId: pendingInfo?.cardId, source: pendingInfo?.source }
        });
        
        // V127: Use validateSpeechSource for consistent SPEAK_PROVENANCE logging
        const yesValidation = validateSpeechSource({
          response,
          sourceId: 'agent2.discovery.pendingQuestion.yesPath',
          uiPath: responseUiPath,
          configPath: 'discovery.playbook.fallback.pendingYesResponse',
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
        
        // V127: Build response and validate through SPEAK_PROVENANCE system
        const pendingNo = `${fallback.pendingNoResponse || ''}`.trim();
        let response;
        let noResponseUiPath;
        
        if (pendingNo) {
          response = `${personalAck} ${pendingNo}`.trim();
          noResponseUiPath = 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingNoResponse';
        } else {
          // No UI-configured pendingNoResponse - validateSpeechSource will handle fallback
          response = personalAck || 'No problem.';
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
          configPath: 'discovery.playbook.fallback.pendingNoResponse',
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
        
        // V127: Build response - prefer UI-configured reprompt, then original question, then emergency
        const pendingRepromptConfig = `${fallback.pendingReprompt || ''}`.trim();
        const pendingQ = pendingInfo?.question || '';
        let response;
        let repromptUiPath;
        
        if (pendingRepromptConfig) {
          response = pendingRepromptConfig;
          repromptUiPath = 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingReprompt';
        } else if (pendingQ) {
          response = `Sorry, I missed that. ${pendingQ}`;
          repromptUiPath = `aiAgentSettings.agent2.discovery.playbook.rules[id=${pendingInfo?.cardId}].followUp.question`;
        } else {
          // No reprompt config and no question - validateSpeechSource will handle fallback
          response = 'Sorry, I missed that.';
          repromptUiPath = null;
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
          configPath: repromptUiPath ? 'discovery.playbook.fallback.pendingReprompt' : 'UNMAPPED',
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
    // PATH 2: TRIGGER CARD MATCHING (PRIMARY — DETERMINISTIC)
    // ──────────────────────────────────────────────────────────────────────
    // Uses NORMALIZED input from vocabulary processing
    // Passes hints for optional card boosting (if TriggerCardMatcher supports it)
    // ──────────────────────────────────────────────────────────────────────
    const triggerCards = safeArr(playbook.rules);
    const cardPoolStats = TriggerCardMatcher.getPoolStats(triggerCards);
    const activeHints = nextState.agent2.hints || [];
    const activeLocks = nextState.agent2.locks || {};
    
    // Use normalized input for matching (vocabulary engine may have corrected mishears)
    const triggerResult = TriggerCardMatcher.match(normalizedInput, triggerCards, {
      hints: activeHints,
      locks: activeLocks
    });

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
      evaluated: triggerResult.evaluated.slice(0, 10),
      // Vocabulary integration info
      usedNormalizedInput: normalizedInput !== input,
      normalizedPreview: normalizedInput !== input ? clip(normalizedInput, 60) : null,
      activeHints: activeHints.length > 0 ? activeHints : null,
      activeLocks: Object.keys(activeLocks).length > 0 ? activeLocks : null,
      hintBoostApplied: triggerResult.hintBoostApplied || false
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

      // V119: Build personalized ack
      const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
      nextState.agent2.discovery.usedNameThisTurn = usedName;

      // Update state
      nextState.agent2.discovery.lastPath = 'TRIGGER_CARD_ANSWER';
      nextState.agent2.discovery.lastTriggerId = card.id || null;
      nextState.agent2.discovery.lastTriggerLabel = card.label || null;
      nextState.agent2.discovery.lastNextAction = nextAction;
      
      // V119: Track pending question for state machine
      if (afterQuestion) {
        nextState.agent2.discovery.pendingQuestion = afterQuestion;
        nextState.agent2.discovery.pendingQuestionTurn = typeof turn === 'number' ? turn : null;
        nextState.agent2.discovery.pendingQuestionSource = `card:${card.id}`;
      }

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

      return {
        response,
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
      // PATH 4+: LLM FALLBACK (Hybrid Assist - UI-Controlled)
      // ──────────────────────────────────────────────────────────────────────
      // Try LLM fallback BEFORE generic fallback paths
      // LLM is UI-controlled and only runs when conditions are met
      
      // Track no-match count for this call
      const noMatchCount = (nextState.agent2.discovery.noMatchCount || 0) + 1;
      nextState.agent2.discovery.noMatchCount = noMatchCount;
      
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
        nextState.slotFilling?.activeSlot
      );
      
      // Try LLM fallback
      const llmResult = await runLLMFallback({
        config: agent2,
        input,
        noMatchCount,
        inBookingFlow,
        callContext: {
          callSid,
          companyId: companyId || company?._id?.toString?.() || null,
          turn,
          capturedReason
        },
        emit
      });
      
      if (llmResult) {
        // LLM fallback provided a response
        nextState.agent2.discovery.lastPath = 'LLM_FALLBACK';
        
        // Use personalized ack if appropriate  
        const { ack: llmAck, usedName: llmUsedName } = buildAck(ack, callerName, state);
        nextState.agent2.discovery.usedNameThisTurn = llmUsedName;
        
        // Don't double-ack if LLM response already sounds complete
        const llmStartsWithAck = /^(ok|okay|i'm sorry|i understand|that sounds)/i.test(llmResult.response);
        response = llmStartsWithAck 
          ? llmResult.response 
          : `${llmAck} ${llmResult.response}`.trim();
        
        pathSelected = 'LLM_FALLBACK';
        pathReason = `LLM assist triggered: ${llmResult.llmMeta?.whyCalledLLM || 'unknown'}`;
        
        emit('A2_PATH_SELECTED', {
          path: 'LLM_FALLBACK',
          reason: pathReason,
          llmModel: llmResult.llmMeta?.model,
          tokensUsed: llmResult.llmMeta?.tokensInput + llmResult.llmMeta?.tokensOutput,
          costUsd: llmResult.llmMeta?.costUsd,
          usedEmergencyFallback: llmResult.llmMeta?.usedEmergencyFallback,
          constraintViolations: llmResult.llmMeta?.constraintViolations
        });
        
        emit('A2_RESPONSE_READY', {
          path: 'LLM_FALLBACK',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: llmResult.llmMeta?.usedEmergencyFallback ? 'llmFallback.emergencyFallback' : 'llmFallback.llm',
          usedCallerName: llmUsedName,
          isLLMAssist: !llmResult.llmMeta?.usedEmergencyFallback
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
      // Path 5a: We captured a call reason but couldn't match — acknowledge what they said
      // V119: This is the "noMatch_withReason" path — NEVER restart conversation
      const reasonAck = `${fallback.noMatchWhenReasonCaptured || ''}`.trim() || "I'm sorry to hear that.";
      const clarifier = `${fallback.noMatchClarifierQuestion || ''}`.trim();
      
      // V120: If we just resolved a pending question (complex response), DON'T ask another one
      // Just acknowledge and let them continue the conversation naturally
      const skipClarifierQuestion = justResolvedPending || nextState.agent2.discovery.pendingQuestionWasComplex;
      
      // V119: If we have a clarifier question, use it. Otherwise, DON'T ask "how can I help?"
      // The clarifier should help narrow down the problem, not restart.
      let nextQ;
      if (skipClarifierQuestion) {
        // Don't ask another question — they just gave us a complex response
        nextQ = '';
      } else if (clarifier) {
        nextQ = clarifier;
      } else {
        // Default clarifier based on the fact we HAVE a reason
        nextQ = 'Would you like to schedule a technician to take a look?';
      }

      // V119: Avoid double-ack — if reasonAck already starts with the ack word, don't prepend again
      const ackLower = ack.toLowerCase().replace(/[^a-z]/g, '');
      const reasonAckStartsWithAck = reasonAck.toLowerCase().startsWith(ackLower) || 
                                       reasonAck.toLowerCase().startsWith('ok') ||
                                       reasonAck.toLowerCase().startsWith('i\'m sorry');
      const finalAck = reasonAckStartsWithAck ? reasonAck : `${personalAck} ${reasonAck}`.trim();
      
      // V120: Build response — omit trailing question if we're skipping it
      if (nextQ) {
        response = `${finalAck} It sounds like ${capturedReason}. ${nextQ}`.replace(/\s+/g, ' ').trim();
      } else {
        response = `${finalAck} It sounds like ${capturedReason}. How can I help with that?`.replace(/\s+/g, ' ').trim();
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
        nextState.agent2.discovery.pendingQuestionSource = 'fallback.clarifier';
      }
      
      // V120: Clear the complex flag after using it
      if (nextState.agent2.discovery.pendingQuestionWasComplex) {
        delete nextState.agent2.discovery.pendingQuestionWasComplex;
      }
      
      emit('A2_PATH_SELECTED', { 
        path: 'FALLBACK_WITH_REASON', 
        reason: pathReason,
        capturedReasonPreview: clip(capturedReason, 60),
        skippedClarifier: skipClarifierQuestion
      });
      // V125: SPEECH_SOURCE_SELECTED
      emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
        'agent2.discovery.fallback.noMatchWhenReasonCaptured',
        'aiAgentSettings.agent2.discovery.playbook.fallback.noMatchWhenReasonCaptured',
        response,
        null,
        'No trigger matched but caller provided a reason - acknowledging'
      ));
      emit('A2_RESPONSE_READY', {
        path: 'FALLBACK_WITH_REASON',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: false,
        source: 'fallback.noMatchWhenReasonCaptured',
        usedCallerName: usedName,
        hadClarifier: !!clarifier && !skipClarifierQuestion,
        pendingQuestion: nextQ || null,
        skippedClarifier: skipClarifierQuestion
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

    return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
  }
}

module.exports = { Agent2DiscoveryRunner };
