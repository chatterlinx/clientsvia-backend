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
    // GREETING INTERCEPTOR (V122 - RUNS BEFORE TRIGGER CARDS)
    // ══════════════════════════════════════════════════════════════════════════
    // Handles short greetings like "hi", "good morning" with strict gating.
    // SHORT-ONLY GATE: Only fires if input ≤ maxWordsToQualify AND no intent words.
    // If it fires → returns immediately, ends the turn.
    // ══════════════════════════════════════════════════════════════════════════
    const greetingsConfig = safeObj(agent2.greetings, {});
    const greetingResult = Agent2GreetingInterceptor.evaluate({
      input: input,
      config: greetingsConfig,
      turn: typeof turn === 'number' ? turn : 0
    });

    // Always emit greeting evaluation proof
    emit('A2_GREETING_EVALUATED', greetingResult.proof);

    if (greetingResult.intercepted) {
      // Greeting matched — return immediately, end the turn
      nextState.agent2.discovery.lastPath = 'GREETING_INTERCEPTED';
      nextState.agent2.discovery.lastGreetingRuleId = greetingResult.proof.matchedRuleId;

      emit('A2_PATH_SELECTED', {
        path: 'GREETING_INTERCEPTED',
        reason: `Matched greeting rule: ${greetingResult.proof.matchedRuleId}`,
        matchedTrigger: greetingResult.proof.matchedTrigger,
        responseSource: greetingResult.responseSource
      });

      emit('A2_RESPONSE_READY', {
        path: 'GREETING_INTERCEPTED',
        responsePreview: clip(greetingResult.response, 120),
        responseLength: greetingResult.response?.length || 0,
        hasAudio: greetingResult.responseSource === 'audio',
        audioUrl: greetingResult.responseSource === 'audio' ? greetingResult.response : null,
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
    
    // Emit vocabulary evaluation proof
    emit('A2_VOCAB_EVAL', {
      inputPreview: clip(input, 60),
      normalizedPreview: normalizedInput !== input ? clip(normalizedInput, 60) : null,
      wasNormalized: normalizedInput !== input,
      appliedCount: vocabularyResult.applied.length,
      applied: vocabularyResult.applied.slice(0, 10),
      hintsAdded: vocabularyResult.hints,
      stats: vocabularyResult.stats
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
        
        // For scheduling questions, ask for address/time
        const response = isSchedulingQuestion
          ? `${personalAck} Great, let's get you scheduled. What's the best address for the service call?`
          : `${personalAck} Great! Let me help you with that.`;
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_YES', 
          reason: `User confirmed: detected YES markers`,
          markers: { hasYesWord, hasYesPhrase, inputPreview: clip(inputLowerClean, 40) }
        });
        emit('A2_RESPONSE_READY', {
          path: 'PENDING_QUESTION_YES',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'pendingQuestion.yesPath',
          usedCallerName: usedName
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
        
        const response = `${personalAck} No problem. Is there anything else I can help you with today?`;
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_NO', 
          reason: `User declined: detected NO markers`,
          markers: { hasNoWord, hasNoPhrase, inputPreview: clip(inputLowerClean, 40) }
        });
        emit('A2_RESPONSE_READY', {
          path: 'PENDING_QUESTION_NO',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'pendingQuestion.noPath',
          usedCallerName: usedName
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }
      
      if (needsReprompt) {
        // ══════════════════════════════════════════════════════════════════════
        // PATH: PENDING_QUESTION_REPROMPT — Garbage/unclear input, ask again
        // ══════════════════════════════════════════════════════════════════════
        // DON'T clear pendingQuestion — we're re-asking
        nextState.agent2.discovery.lastPath = 'PENDING_REPROMPT';
        
        const response = isSchedulingQuestion
          ? `Sorry, I didn't catch that. Would you like to schedule service today? Just say yes or no.`
          : `I'm sorry, I didn't quite get that. Could you say yes or no?`;
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_REPROMPT', 
          reason: `Micro-utterance or unclear response`,
          inputLength,
          isMicroUtterance,
          looksLikeName,
          inputPreview: clip(input, 40)
        });
        emit('A2_RESPONSE_READY', {
          path: 'PENDING_QUESTION_REPROMPT',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'pendingQuestion.reprompt'
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
      const response = line ? `${ack} ${line}`.trim() : `${ack} How can I help you today?`;
      nextState.agent2.discovery.lastPath = 'ROBOT_CHALLENGE';

      // V119: Emit path selection proof
      emit('A2_PATH_SELECTED', {
        path: 'ROBOT_CHALLENGE',
        reason: 'Robot/human challenge detected in input',
        inputPreview: clip(input, 60)
      });

      // V119: Emit response ready proof
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

      // Build response
      let response;
      if (answerText) {
        response = afterQuestion
          ? `${personalAck} ${answerText} ${afterQuestion}`.trim()
          : `${personalAck} ${answerText}`.trim();
      } else {
        response = afterQuestion
          ? `${personalAck} ${afterQuestion}`.trim()
          : `${personalAck} How can I help you with that?`;
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
    const maxClarifiersPerCall = clarifiersConfig.maxAsksPerCall || 2;
    const clarifiersAskedThisCall = nextState.agent2.discovery.clarifiersAskedCount || 0;
    
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
      emit('A2_RESPONSE_READY', {
        path: 'SCENARIO',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: false,
        source: 'ScenarioEngine',
        usedCallerName: usedName
      });
      
    } else if (capturedReason) {
      // Path 4: We captured a call reason but couldn't match — acknowledge what they said
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
      
      let baseNoMatch;
      if (skipGenericQuestion) {
        // They gave us a complex response to our question — acknowledge and wait for more info
        baseNoMatch = `${personalAck} I see. Could you tell me more about what you're experiencing?`;
      } else {
        // V119: This is "noMatch_noReason" — it's OK to ask "how can I help?" here
        baseNoMatch = `${fallback.noMatchAnswer || ''}`.trim() || `${personalAck} How can I help you today?`;
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
