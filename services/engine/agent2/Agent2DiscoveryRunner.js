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

    // ──────────────────────────────────────────────────────────────────────
    // V119: PENDING QUESTION STATE MACHINE
    // ──────────────────────────────────────────────────────────────────────
    // If we asked a follow-up question last turn, the user's response should
    // be interpreted as an answer to that question, not as a new topic.
    // This prevents the agent from getting lost and asking the same question again.
    
    const pendingQuestion = nextState.agent2.discovery.pendingQuestion || null;
    const pendingQuestionTurn = nextState.agent2.discovery.pendingQuestionTurn || null;
    const hasPendingQuestion = pendingQuestion && typeof pendingQuestionTurn === 'number';
    
    // Check if user is responding to our pending question
    if (hasPendingQuestion && pendingQuestionTurn === (turn - 1)) {
      // User is responding to our follow-up question
      // Clear the pending question state
      nextState.agent2.discovery.pendingQuestion = null;
      nextState.agent2.discovery.pendingQuestionTurn = null;
      nextState.agent2.discovery.pendingQuestionResolved = true;
      
      emit('A2_PENDING_QUESTION_RESOLVED', {
        question: clip(pendingQuestion, 80),
        askedInTurn: pendingQuestionTurn,
        resolvedInTurn: turn,
        userResponse: clip(input, 80)
      });
      
      // If the response seems like a simple yes/no or confirmation, 
      // check if we should transition to booking
      const inputLowerClean = inputLower.replace(/[^a-z\s]/g, '').trim();
      const isYes = /^(yes|yeah|yep|sure|ok|okay|please|go ahead|schedule|book|do it)$/i.test(inputLowerClean) ||
                    /^(yes|yeah|yep|sure)\s+(please|i would|i do|that would)/.test(inputLowerClean);
      const isNo = /^(no|nope|nah|not yet|not now|maybe later|i('ll| will) (call|think))/.test(inputLowerClean);
      
      if (isYes) {
        // User wants to proceed — this could trigger booking transition
        // For now, acknowledge and ask about scheduling
        const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
        nextState.agent2.discovery.usedNameThisTurn = usedName;
        nextState.agent2.discovery.lastPath = 'PENDING_YES';
        
        const response = `${personalAck} Great, let's get you scheduled. What day works best for you?`;
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_YES', 
          reason: 'User confirmed to pending follow-up question'
        });
        emit('A2_RESPONSE_READY', {
          path: 'PENDING_QUESTION_YES',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'pendingQuestion.yesPath'
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }
      
      if (isNo) {
        // User declined — offer alternatives or close gracefully
        const { ack: personalAck, usedName } = buildAck(ack, callerName, state);
        nextState.agent2.discovery.usedNameThisTurn = usedName;
        nextState.agent2.discovery.lastPath = 'PENDING_NO';
        
        const response = `${personalAck} No problem. Is there anything else I can help you with?`;
        
        emit('A2_PATH_SELECTED', { 
          path: 'PENDING_QUESTION_NO', 
          reason: 'User declined pending follow-up question'
        });
        emit('A2_RESPONSE_READY', {
          path: 'PENDING_QUESTION_NO',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'pendingQuestion.noPath'
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
      }
      
      // User gave a more complex response — fall through to normal processing
      // but remember we just resolved a pending question
      emit('A2_PENDING_QUESTION_COMPLEX_RESPONSE', {
        question: clip(pendingQuestion, 80),
        userResponse: clip(input, 80),
        action: 'CONTINUE_NORMAL_PROCESSING'
      });
    } else if (hasPendingQuestion) {
      // Pending question exists but from a different turn — clear stale state
      nextState.agent2.discovery.pendingQuestion = null;
      nextState.agent2.discovery.pendingQuestionTurn = null;
    }

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
    const triggerCards = safeArr(playbook.rules);
    const cardPoolStats = TriggerCardMatcher.getPoolStats(triggerCards);
    const triggerResult = TriggerCardMatcher.match(input, triggerCards);

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
      evaluated: triggerResult.evaluated.slice(0, 10)
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
      
      // V119: If we have a clarifier question, use it. Otherwise, DON'T ask "how can I help?"
      // The clarifier should help narrow down the problem, not restart.
      let nextQ;
      if (clarifier) {
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
      
      response = `${finalAck} It sounds like ${capturedReason}. ${nextQ}`.replace(/\s+/g, ' ').trim();
      nextState.agent2.discovery.lastPath = 'FALLBACK_REASON_CAPTURED';
      pathSelected = 'FALLBACK_WITH_REASON';
      pathReason = 'No card/scenario match but call_reason_detail captured';
      
      // V119: Track pending question for state machine
      nextState.agent2.discovery.pendingQuestion = nextQ;
      nextState.agent2.discovery.pendingQuestionTurn = typeof turn === 'number' ? turn : null;
      nextState.agent2.discovery.pendingQuestionSource = 'fallback.clarifier';
      
      emit('A2_PATH_SELECTED', { 
        path: 'FALLBACK_WITH_REASON', 
        reason: pathReason,
        capturedReasonPreview: clip(capturedReason, 60)
      });
      emit('A2_RESPONSE_READY', {
        path: 'FALLBACK_WITH_REASON',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: false,
        source: 'fallback.noMatchWhenReasonCaptured',
        usedCallerName: usedName,
        hadClarifier: !!clarifier,
        pendingQuestion: nextQ
      });
      
    } else {
      // Path 5: No trigger match, no scenario match, no captured reason — true generic fallback
      // V119: This is "noMatch_noReason" — it's OK to ask "how can I help?" here
      const baseNoMatch = `${fallback.noMatchAnswer || ''}`.trim() || `${personalAck} How can I help you today?`;
      
      // V119: If noMatchAnswer already starts with ack, don't double-ack
      if (baseNoMatch.toLowerCase().startsWith('ok') || baseNoMatch.toLowerCase().startsWith(personalAck.toLowerCase().replace('.', ''))) {
        response = baseNoMatch;
      } else {
        response = `${personalAck} ${baseNoMatch}`.trim();
      }
      
      nextState.agent2.discovery.lastPath = 'FALLBACK_NO_MATCH';
      pathSelected = 'FALLBACK_NO_REASON';
      pathReason = 'No card/scenario match and no call_reason_detail';
      
      emit('A2_PATH_SELECTED', { 
        path: 'FALLBACK_NO_REASON', 
        reason: pathReason 
      });
      emit('A2_RESPONSE_READY', {
        path: 'FALLBACK_NO_REASON',
        responsePreview: clip(response, 120),
        responseLength: response.length,
        hasAudio: false,
        source: 'fallback.noMatchAnswer',
        usedCallerName: usedName
      });
    }

    return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
  }
}

module.exports = { Agent2DiscoveryRunner };
