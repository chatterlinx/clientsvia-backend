/**
 * ════════════════════════════════════════════════════════════════════════════
 * AGENT 2.0 DISCOVERY RUNNER (V125 - SCRABENGINE-FIRST ARCHITECTURE)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Orchestrates the Discovery phase of Agent 2.0 calls.
 * When enabled, Agent 2.0 OWNS THE MIC — no fallback to legacy. EVER.
 *
 * ✅ V125 CRITICAL FIX (Feb 27, 2026):
 * SCRABENGINE NOW RUNS FIRST, BEFORE GREETING INTERCEPTOR
 * 
 * WHY THIS MATTERS:
 * - User: "Hi I need emergency service"
 * - OLD: Greeting saw "Hi" → returned early → never checked triggers ❌
 * - NEW: ScrabEngine removes "Hi" → Greeting sees "need emergency service" → 
 *        no greeting match → triggers evaluate → EMERGENCY fires ✅
 * 
 * ENTERPRISE SEQUENCE (V125):
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 1. SCRABENGINE (4-step pipeline - runs FIRST on raw text)             │
 * │    a. Filler removal ("hi", "um", "uh" stripped)                       │
 * │    b. Vocabulary expansion ("acee" → "air conditioning")               │
 * │    c. Synonym mapping ("broken" → "not working")                       │
 * │    d. Entity extraction (name, phone, email, urgency)                  │
 * │                                                                         │
 * │ 2. GREETING INTERCEPTOR (now checks CLEANED text)                      │
 * │    - If greeting-only → stores for fallback use                        │
 * │    - No longer exits early → continues to triggers                     │
 * │                                                                         │
 * │ 3. TRIGGER CARD MATCHING (on CLEANED text from ScrabEngine)            │
 * │    - Keywords, phrases, negative keywords                              │
 * │    - PRIMARY PATH (instant response, pre-recorded audio)               │
 * │                                                                         │
 * │ 4. GREETING (if detected but no trigger matched)                        │
 * │    - Uses greeting response from step 2                                │
 * │                                                                         │
 * │ 5. LLM AGENT — 123RP TIER 2 (if nothing matched)                      │
 * │    - Claude-powered AI intelligence (NOT a fallback)                   │
 * │                                                                         │
 * │ 6. FALLBACK — 123RP TIER 3 (safety net)                               │
 * │    - Deterministic fallback if Tier 1 + Tier 2 cannot respond          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * HARD RULES (V119):
 * 1. ScrabEngine runs FIRST (V125) - text cleaning is mandatory
 * 2. Legacy owners are BLOCKED and we emit proof of blocking
 * 3. ScenarioEngine is OFF by default (opt-in via playbook.useScenarioFallback)
 * 4. Fallback distinguishes "reason captured" vs "no reason"
 * 5. Every turn emits A2_GATE → A2_PATH → A2_RESPONSE chain
 *
 * Flow Order (deterministic-first):
 * 1. ScrabEngine text processing (V125 - NEW, runs FIRST)
 * 2. Greeting detection (V125 - now on cleaned text, no early exit)
 * 3. Robot challenge detection (UI-controlled response)
 * 4. TRIGGER CARD MATCHING — keywords/phrases/negatives (PRIMARY PATH)
 * 5. Greeting fallback (V125 - if greeting detected but no trigger)
 * 6. Scenario engine fallback (ONLY if playbook.useScenarioFallback=true)
 * 7. Captured reason acknowledgment (if reason extracted but no match)
 * 8. 123RP Tier 2: LLM Agent (Claude — per-company config, one-shot per turn)
 * 9. 123RP Tier 3: Fallback (safety net if Tier 2 disabled/failed)
 *
 * Raw Events Emitted (MANDATORY - proof trail):
 * - A2_GATE               : Entry proof (enabled, uiBuild, configHash, legacyBlocked)
 * - SCRABENGINE_PROCESSED : Text processing result (V125)
 * - A2_GREETING_EVALUATED : Greeting detection (V125 - on cleaned text)
 * - A2_PATH_SELECTED      : Which path was taken (GREETING/TRIGGER/LLM/FALLBACK)
 * - A2_TRIGGER_EVAL       : Trigger card evaluation details
 * - A2_SCENARIO_EVAL      : Scenario engine fallback details (if enabled)
 * - A2_RESPONSE_READY     : Final response proof (text, audioUrl, source)
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../../utils/logger');
const { TriggerCardMatcher } = require('./TriggerCardMatcher');
const { Agent2VocabularyEngine } = require('./Agent2VocabularyEngine');
const { Agent2GreetingInterceptor } = require('./Agent2GreetingInterceptor');
const { Agent2CallReasonSanitizer } = require('./Agent2CallReasonSanitizer');
const { Agent2IntentPriorityGate } = require('./Agent2IntentPriorityGate');
const { Agent2CallRouter }         = require('./Agent2CallRouter');
const { TriggerBucketClassifier }  = require('./TriggerBucketClassifier');
const { resolveSpeakLine } = require('./Agent2SpeakGate');
const { computeComplexityScore } = require('./Agent2LLMFallbackService');
const { generateLLMTriggerResponse } = require('./Agent2LLMTriggerService');
// Agent2SpeechPreprocessor was removed: ScrabEngine (V125) fully replaces it.
// The preprocessor ran duplicate filler/greeting stripping that ScrabEngine already handles,
// creating hidden double-processing. Nuked to eliminate the hidden nightmare.

// ════════════════════════════════════════════════════════════════════════════
// 🔍 SCRABENGINE - Enterprise Text Processing Pipeline
// ════════════════════════════════════════════════════════════════════════════
// Unified text normalization replacing scattered preprocessing.
// Entry point for ALL text cleaning before trigger matching.
// ════════════════════════════════════════════════════════════════════════════
const { ScrabEngine } = require('../../ScrabEngine');
const Agent2EchoGuard = require('./Agent2EchoGuard');
const CompanyTriggerSettings = require('../../../models/CompanyTriggerSettings');
const { DEFAULT_LLM_AGENT_SETTINGS, DEFAULT_INTAKE_SETTINGS, composeSystemPrompt, composeIntakeSystemPrompt } = require('../../../config/llmAgentDefaults');
const { RESPONSE_TIER, FALLBACK_REASON_CODE, build123rpMeta } = require('../../../config/ResponseProtocol');
const { buildT3Context, validateT3Context } = require('./TierStateContract');
const { streamWithHeartbeat, streamWithRetry } = require('../../streaming/ClaudeStreamingService');
const { ConversationMemory } = require('../ConversationMemory');

// ScenarioEngine is lazy-loaded ONLY if useScenarioFallback is enabled
let ScenarioEngine = null;

// Cache for company trigger variables (per call, keyed by companyId)
const triggerVariablesCache = new Map();

// ────────────────────────────────────────────────────────────────────────────
// LLM AGENT — Follow-Up Consent Handler
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deep merge two objects (source overrides target).
 */
function deepMergeLLMAgent(target, source) {
  if (!source || typeof source !== 'object') return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] === null || source[key] === undefined) continue;
    if (Array.isArray(source[key])) {
      result[key] = source[key];
    } else if (typeof source[key] === 'object' && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMergeLLMAgent(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * 123RP Tier 2: Call LLM Agent for follow-up consent edge cases.
 * Fires when the caller's response to a follow-up question is not a clear
 * YES/NO — e.g., ambiguous, hesitant, complex, or multi-intent.
 * Returns { response, tokensUsed, latencyMs } or null if disabled/failed.
 * On null return, caller falls to Tier 3 (canned response).
 *
 * @param {Object} params
 * @param {Object} params.company       - Full company doc (or lean object)
 * @param {string} params.input         - Caller's raw input (from gather, no ScrabEngine)
 * @param {string} params.followUpQuestion - The question that was asked
 * @param {string} params.triggerSource - Which trigger card asked the question
 * @param {string} params.bucket        - Classifier bucket (REPROMPT/HESITANT/COMPLEX/NO)
 * @param {string} params.channel       - 'call' | 'sms' | 'webchat'
 * @param {Function} params.emit        - Event emitter
 * @returns {Promise<{response: string, tokensUsed: Object, latencyMs: number}|null>}
 */
async function callLLMAgentForFollowUp({ company, input, followUpQuestion, triggerSource, bucket, channel, emit, callSid, turn, bridgeToken, redis, callerName = null, selfScheduling = false, callContext = null }) {
  try {
    // Load company LLM Agent config, merge with defaults
    const saved = company?.aiAgentSettings?.llmAgent || {};
    let config = deepMergeLLMAgent(DEFAULT_LLM_AGENT_SETTINGS, saved);

    // Gate: LLM Agent must be enabled for this company
    if (!config.enabled) {
      emit('T2_FOLLOW_UP_GATE_BLOCKED', { reason: 'disabled', turn, bucket });
      return { response: null, failureReason: 'disabled' };
    }

    // Gate: Anthropic API key must exist
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logger.warn('[LLM_AGENT] ANTHROPIC_API_KEY not set — skipping LLM Agent for follow-up');
      emit('T2_FOLLOW_UP_GATE_BLOCKED', { reason: 'missing_api_key', turn, bucket });
      return { response: null, failureReason: 'missing_api_key' };
    }

    // FIX: When self-scheduling, disable the noScheduling guardrail so the LLM
    // does not produce transfer language ("I'll connect you to scheduling team")
    // while the conversation is actually handling booking directly.
    if (selfScheduling) {
      config = {
        ...config,
        guardrails: { ...(config.guardrails || {}), noScheduling: false }
      };
    }

    // Build system prompt with follow-up context appended
    const basePrompt = composeSystemPrompt(config, channel || 'call');

    const followUpParts = [
      '\n=== FOLLOW-UP CONTEXT ===',
      `The caller was asked: "${followUpQuestion}"`,
      triggerSource ? `(This was asked because trigger "${triggerSource}" matched.)` : '',
      `The caller responded: "${input}"`,
      `This was classified as: ${bucket} (not a clear yes or no)`,
      callerName ? `The caller's name is ${callerName}. Use their name naturally at most once.` : null,
      ''
    ];

    // V131: Inject structured call context so LLM knows what's already established
    if (callContext) {
      followUpParts.push('=== CALL CONTEXT (already established) ===');
      if (callContext.caller?.firstName && callContext.caller?.speakable) {
        followUpParts.push(`Caller name: ${callContext.caller.firstName}`);
      }
      if (callContext.issue?.summary) {
        followUpParts.push(`Issue: ${callContext.issue.summary}`);
        followUpParts.push('IMPORTANT: The caller already explained their issue. Do NOT ask them what the issue is again.');
      }
      if (callContext.urgency?.level === 'high') {
        followUpParts.push(`Urgency: HIGH — ${callContext.urgency.reason || 'caller requested urgent service'}`);
      }
      followUpParts.push('=== END CALL CONTEXT ===');
      followUpParts.push('');
    }

    if (selfScheduling) {
      // LANE LOCK: self-scheduling — hard rule, no transfer language allowed
      followUpParts.push(
        '=== LANE: SELF-SCHEDULING ===',
        'Scheduling is handled directly in this conversation. You are the scheduling agent.',
        'NEVER say: "I\'ll connect you to our scheduling team", "one moment while I connect you",',
        '"let me transfer you", or any variation of transfer/handoff wording.',
        'After an affirmative response, ask the next booking question directly.',
        'Examples: "What day works best for you?" or "Do you prefer morning or afternoon?"',
        '=== END LANE RULE ==='
      );
    } else {
      followUpParts.push(
        'Your job: Understand what the caller is saying. If they are confirming with conditions,',
        'acknowledge the conditions and guide them. If they have a question, answer it using',
        'your knowledge base. Then smoothly guide the conversation forward.'
      );
    }

    followUpParts.push('=== END FOLLOW-UP CONTEXT ===');

    const followUpContext = followUpParts.filter(Boolean).join('\n');
    const systemPrompt = basePrompt + followUpContext;

    const modelId = config.model?.modelId || 'claude-3-5-haiku-20241022';
    const temperature = config.model?.temperature ?? 0.7;
    const maxTokens = config.model?.maxTokens || 300;

    // V131: Load conversation history for multi-turn context
    let conversationMessages = [{ role: 'user', content: input }];
    try {
      const memory = await ConversationMemory.load(callSid);
      if (memory) {
        const ctx = memory.getContextForLLM(4);
        if (ctx?.history?.length > 0) {
          // Deduplicate: filter to unique entries only (avoid TWIML_PLAY echoes)
          const seen = new Set();
          const deduped = ctx.history.filter(msg => {
            const key = `${msg.role}:${(msg.content || '').substring(0, 80)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          // Prepend history before current input
          conversationMessages = [...deduped, { role: 'user', content: input }];
          // Ensure messages alternate properly (Claude requires user/assistant alternation)
          // Remove any trailing user message from history since we're adding current input as user
          if (deduped.length > 0 && deduped[deduped.length - 1].role === 'user') {
            conversationMessages = [...deduped.slice(0, -1), { role: 'user', content: input }];
          }
        }
      }
    } catch (memErr) {
      logger.debug('[LLM_AGENT] ConversationMemory load failed (non-blocking, using single-turn)', { error: memErr.message });
    }

    emit('A2_LLM_AGENT_CALLED', {
      mode: 'TIER_2_FOLLOW_UP',
      bucket,
      model: modelId,
      followUpQuestion: followUpQuestion?.substring(0, 80),
      inputPreview: input?.substring(0, 80),
      triggerSource,
      historyTurns: conversationMessages.length
    });

    // ── Streaming with heartbeat (replaces batch fetch + 6s AbortSignal) ──
    const result = await streamWithHeartbeat({
      apiKey,
      model: modelId,
      maxTokens,
      temperature,
      system: systemPrompt,
      messages: conversationMessages,
      callSid,
      turn,
      token: bridgeToken,
      redis,
      emit,
    });

    // Complete failure — no response at all
    if (!result?.response) {
      logger.warn('[LLM_AGENT] Follow-up streaming returned no response', {
        failureReason: result?.failureReason,
        latencyMs: result?.latencyMs,
      });
      emit('A2_LLM_AGENT_ERROR', {
        mode: 'TIER_2_FOLLOW_UP',
        failureReason: result?.failureReason,
        latencyMs: result?.latencyMs,
      });
      emit('T2_FOLLOW_UP_RESULT', {
        llmAttempted: true,
        llmSucceeded: false,
        llmFailureReason: result?.failureReason || 'null_response',
        fallbackInvoked: true,
        selfScheduling,
        bucket,
        turn,
      });
      return { response: null, failureReason: result?.failureReason || 'null_response' };
    }

    const usedCallerName = !!(callerName && result.response.toLowerCase().includes(callerName.toLowerCase()));

    // Success (full or partial)
    emit('A2_LLM_AGENT_RESPONSE', {
      mode: 'TIER_2_FOLLOW_UP',
      latencyMs: result.latencyMs,
      model: modelId,
      tokensInput: result.tokensUsed?.input || 0,
      tokensOutput: result.tokensUsed?.output || 0,
      responsePreview: result.response.substring(0, 120),
      wasPartial: result.wasPartial,
      selfScheduling,
      usedCallerName,
    });
    emit('T2_FOLLOW_UP_RESULT', {
      llmAttempted: true,
      llmSucceeded: true,
      llmFailureReason: null,
      fallbackInvoked: false,
      selfScheduling,
      usedCallerName,
      bucket,
      turn,
    });

    return {
      response: result.response,
      tokensUsed: result.tokensUsed || { input: 0, output: 0 },
      latencyMs: result.latencyMs,
      wasPartial: result.wasPartial,
      usedCallerName,
    };

  } catch (error) {
    logger.error('[LLM_AGENT] Follow-up call failed', { error: error.message });
    emit('A2_LLM_AGENT_ERROR', { mode: 'TIER_2_FOLLOW_UP', error: error.message });
    emit('T2_FOLLOW_UP_RESULT', {
      llmAttempted: true,
      llmSucceeded: false,
      llmFailureReason: 'exception',
      fallbackInvoked: true,
      selfScheduling,
      bucket,
      turn,
    });
    return { response: null, failureReason: 'exception' }; // Tier 3: canned response will handle it
  }
}

/**
 * 123RP Tier 2: Call LLM Agent when no trigger card matches (AI intelligence layer).
 * When no trigger card matches the caller's input, the LLM Agent steps in
 * to understand what the caller needs and provide an intelligent response.
 * After responding, control returns to the normal discovery pipeline — the
 * LLM Agent does NOT persist across turns. It only fires again if the NEXT
 * response also fails trigger matching.
 *
 * @param {Object} params
 * @param {Object} params.company          - Full company doc (or lean object)
 * @param {string} params.input            - Caller's cleaned input
 * @param {string} params.capturedReason   - Extracted call reason (if any)
 * @param {string} params.channel          - 'call' | 'sms' | 'webchat'
 * @param {number} params.turn             - Current turn number
 * @param {Function} params.emit           - Event emitter
 * @returns {Promise<{response: string, tokensUsed: Object, latencyMs: number}|null>}
 */
async function callLLMAgentForNoMatch({ company, input, capturedReason, channel, turn, emit, llmTurnsThisCall = 0, callSid, bridgeToken, redis, t3RecoveryCtx, callerName = null, callContext = null }) {
  try {
    // Load company LLM Agent config, merge with defaults
    const saved = company?.aiAgentSettings?.llmAgent || {};
    const config = deepMergeLLMAgent(DEFAULT_LLM_AGENT_SETTINGS, saved);

    // Gate: LLM Agent must be enabled for this company
    if (!config.enabled) {
      emit('T2_NO_MATCH_RESULT', { llmAttempted: false, llmSucceeded: false, llmFailureReason: 'disabled', fallbackInvoked: true, turn });
      return null;
    }

    // Gate: triggerFallback activation must be enabled
    if (config.activation?.triggerFallback === false) {
      logger.info('[LLM_AGENT] triggerFallback activation is disabled — skipping no-match agent');
      emit('T2_NO_MATCH_RESULT', { llmAttempted: false, llmSucceeded: false, llmFailureReason: 'trigger_fallback_disabled', fallbackInvoked: true, turn });
      return null;
    }

    // Gate: max turns per session (prevents runaway LLM usage on repeated no-matches)
    const maxTurnsPerSession = config.activation?.maxTurnsPerSession ?? 10;
    if (llmTurnsThisCall >= maxTurnsPerSession) {
      logger.info('[LLM_AGENT] maxTurnsPerSession reached — skipping no-match agent', { llmTurnsThisCall, maxTurnsPerSession });
      emit('A2_LLM_STREAM_FAILED', { reason: FALLBACK_REASON_CODE.T2_MAX_TURNS, turn, llmTurnsThisCall });
      emit('T2_NO_MATCH_RESULT', { llmAttempted: false, llmSucceeded: false, llmFailureReason: 'max_turns_reached', fallbackInvoked: true, turn });
      return null;
    }

    // Gate: Anthropic API key must exist
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logger.warn('[LLM_AGENT] ANTHROPIC_API_KEY not set — skipping LLM Agent for no-match');
      emit('T2_NO_MATCH_RESULT', { llmAttempted: false, llmSucceeded: false, llmFailureReason: 'missing_api_key', fallbackInvoked: true, turn });
      return null;
    }

    // Build system prompt with no-match context appended
    const basePrompt = composeSystemPrompt(config, channel || 'call');
    const noMatchParts = [
      '\n=== NO-MATCH CONTEXT ===',
      'No trigger card matched the caller\'s input. You are Tier 2 of the 123 Response Protocol — the AI intelligence layer.',
      `The caller said: "${input}"`,
      capturedReason ? `Detected intent/reason: "${capturedReason}"` : 'No specific call reason was detected.',
      callerName ? `The caller's name is ${callerName}. Use their name naturally at most once.` : null,
      `This is turn ${turn || 'unknown'} of the conversation.`,
      '',
      'Your job: Understand what the caller needs. Answer their question using your knowledge base.',
      'If you can identify their intent, acknowledge it and guide them toward the right service.',
      'Keep your response concise and natural — this is a phone call.',
      'After you respond, the caller\'s next message will go back through normal trigger matching.',
      '=== END NO-MATCH CONTEXT ==='
    ];

    // V131: Inject structured call context so LLM knows what's already established
    if (callContext) {
      noMatchParts.push('');
      noMatchParts.push('=== CALL CONTEXT (already established) ===');
      if (callContext.caller?.firstName && callContext.caller?.speakable) {
        noMatchParts.push(`Caller name: ${callContext.caller.firstName}`);
      }
      if (callContext.issue?.summary) {
        noMatchParts.push(`Issue: ${callContext.issue.summary}`);
        noMatchParts.push('IMPORTANT: The caller already explained their issue. Do NOT ask them what the issue is again.');
      }
      if (callContext.urgency?.level === 'high') {
        noMatchParts.push(`Urgency: HIGH — ${callContext.urgency.reason || 'caller requested urgent service'}`);
      }
      noMatchParts.push('=== END CALL CONTEXT ===');
    }

    // ── Cross-turn recovery context (Package 4) ─────────────────────────────
    // If T3 fired last turn, enrich Claude with context about what happened
    // so it can recover gracefully instead of starting from scratch.
    if (t3RecoveryCtx) {
      noMatchParts.push('');
      noMatchParts.push('=== RECOVERY CONTEXT ===');
      noMatchParts.push('The previous turn failed to respond properly (Tier 3 fallback fired).');
      if (t3RecoveryCtx.intent) {
        noMatchParts.push(`The caller\'s original intent was: "${t3RecoveryCtx.intent}"`);
      }
      if (t3RecoveryCtx.callerName) {
        noMatchParts.push(`The caller\'s name is: ${t3RecoveryCtx.callerName}`);
      }
      noMatchParts.push('Prioritize acknowledging what happened and addressing their needs directly.');
      noMatchParts.push('=== END RECOVERY CONTEXT ===');
    }

    const systemPrompt = basePrompt + noMatchParts.join('\n');

    const modelId = config.model?.modelId || 'claude-3-5-haiku-20241022';
    const temperature = config.model?.temperature ?? 0.7;
    const maxTokens = config.model?.maxTokens || 300;

    // V131: Load conversation history for multi-turn context
    let conversationMessages = [{ role: 'user', content: input }];
    try {
      const memory = await ConversationMemory.load(callSid);
      if (memory) {
        const ctx = memory.getContextForLLM(4);
        if (ctx?.history?.length > 0) {
          const seen = new Set();
          const deduped = ctx.history.filter(msg => {
            const key = `${msg.role}:${(msg.content || '').substring(0, 80)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          conversationMessages = [...deduped, { role: 'user', content: input }];
          if (deduped.length > 0 && deduped[deduped.length - 1].role === 'user') {
            conversationMessages = [...deduped.slice(0, -1), { role: 'user', content: input }];
          }
        }
      }
    } catch (memErr) {
      logger.debug('[LLM_AGENT] ConversationMemory load failed (non-blocking, using single-turn)', { error: memErr.message });
    }

    emit('A2_LLM_AGENT_CALLED', {
      mode: 'TIER_2_NO_MATCH',
      model: modelId,
      inputPreview: input?.substring(0, 80),
      capturedReason: capturedReason?.substring(0, 80) || null,
      turn,
      isRecovery: !!t3RecoveryCtx,
      historyTurns: conversationMessages.length
    });

    // ── Streaming with heartbeat (replaces batch fetch + 6s AbortSignal) ──
    // Bridge config ceiling can be company-specific via opts.maxCeilingMs
    const bridgeCfg = company?.voiceSettings?.agent2?.bridge || {};
    const maxCeilingMs = bridgeCfg.maxCeilingMs || undefined;  // undefined = use service default (25s)

    const result = await streamWithHeartbeat({
      apiKey,
      model: modelId,
      maxTokens,
      temperature,
      system: systemPrompt,
      messages: conversationMessages,
      callSid,
      turn,
      token: bridgeToken,
      redis,
      emit,
      ...(maxCeilingMs ? { maxCeilingMs } : {}),
    });

    // Complete failure — no response at all
    if (!result?.response) {
      logger.warn('[LLM_AGENT] No-match streaming returned no response', {
        failureReason: result?.failureReason,
        latencyMs: result?.latencyMs,
      });
      emit('A2_LLM_AGENT_ERROR', {
        mode: 'TIER_2_NO_MATCH',
        failureReason: result?.failureReason,
        latencyMs: result?.latencyMs,
      });
      emit('T2_NO_MATCH_RESULT', {
        llmAttempted: true,
        llmSucceeded: false,
        llmFailureReason: result?.failureReason || 'null_response',
        fallbackInvoked: true,
        turn,
      });
      // Return failure info so caller can set accurate t2FailureReason
      return { response: null, failureReason: result?.failureReason || null };
    }

    const usedCallerName = !!(callerName && result.response.toLowerCase().includes(callerName.toLowerCase()));

    // Success (full or partial)
    emit('A2_LLM_AGENT_RESPONSE', {
      mode: 'TIER_2_NO_MATCH',
      latencyMs: result.latencyMs,
      model: modelId,
      tokensInput: result.tokensUsed?.input || 0,
      tokensOutput: result.tokensUsed?.output || 0,
      responsePreview: result.response.substring(0, 120),
      wasPartial: result.wasPartial,
      usedCallerName,
    });
    emit('T2_NO_MATCH_RESULT', {
      llmAttempted: true,
      llmSucceeded: true,
      llmFailureReason: null,
      fallbackInvoked: false,
      usedCallerName,
      turn,
    });

    return {
      response: result.response,
      tokensUsed: result.tokensUsed || { input: 0, output: 0 },
      latencyMs: result.latencyMs,
      wasPartial: result.wasPartial,
      usedCallerName,
    };

  } catch (error) {
    logger.error('[LLM_AGENT] No-match call failed', { error: error.message });
    emit('A2_LLM_AGENT_ERROR', { mode: 'TIER_2_NO_MATCH', error: error.message });
    emit('T2_NO_MATCH_RESULT', {
      llmAttempted: true,
      llmSucceeded: false,
      llmFailureReason: 'exception',
      fallbackInvoked: true,
      turn,
    });
    return null; // Graceful degradation to Tier 3 — deterministic paths will handle it
  }
}

// ────────────────────────────────────────────────────────────────────────────
// LLM AGENT — Turn-1 Intake (Entity Extraction + Warm Acknowledgment)
// ────────────────────────────────────────────────────────────────────────────
// On turn 1, sends raw caller speech to Claude for structured JSON extraction.
// Returns extracted entities + warm response text + nextLane recommendation.
// On failure: returns null → caller falls through to normal pipeline.
//
// CRITICAL: This function does NOT write state. It returns structured data.
// The caller (run()) is responsible for writing state to match ScrabEngine format.
// ────────────────────────────────────────────────────────────────────────────

async function callLLMAgentForIntake({ company, input, channel, turn, emit, callSid, bridgeToken, redis }) {
  const FUNC_TAG = '[LLM_INTAKE]';

  try {
    // ── Load & merge config ──────────────────────────────────────────────
    const savedLlm = company?.aiAgentSettings?.llmAgent || {};
    const llmConfig = deepMergeLLMAgent(DEFAULT_LLM_AGENT_SETTINGS, savedLlm);

    const savedIntake = savedLlm?.intake || {};
    const intakeConfig = deepMergeLLMAgent(DEFAULT_INTAKE_SETTINGS, savedIntake);

    // ── Gate: LLM Agent must be enabled ──────────────────────────────────
    if (!llmConfig.enabled) {
      emit('T2_INTAKE_GATE_BLOCKED', { reason: 'llm_agent_disabled', turn });
      return null;
    }

    // ── Gate: Intake must be enabled ─────────────────────────────────────
    if (!intakeConfig.enabled) {
      emit('T2_INTAKE_GATE_BLOCKED', { reason: 'intake_disabled', turn });
      return null;
    }

    // ── Gate: Must be correct turn ───────────────────────────────────────
    const triggerTurn = intakeConfig.triggerOnTurn || 1;
    if (turn !== triggerTurn) {
      emit('T2_INTAKE_GATE_BLOCKED', { reason: 'wrong_turn', turn, expected: triggerTurn });
      return null;
    }

    // ── Gate: API key ────────────────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logger.warn(`${FUNC_TAG} ANTHROPIC_API_KEY not set — skipping intake`);
      emit('T2_INTAKE_GATE_BLOCKED', { reason: 'missing_api_key', turn });
      return null;
    }

    // ── Gate: Non-empty input ────────────────────────────────────────────
    if (!input || input.trim().length < 3) {
      emit('T2_INTAKE_GATE_BLOCKED', { reason: 'input_too_short', turn, inputLength: (input || '').length });
      return null;
    }

    // ── Build system prompt ──────────────────────────────────────────────
    const systemPrompt = composeIntakeSystemPrompt(llmConfig, intakeConfig, channel || 'call');

    const modelId = intakeConfig.model?.modelId || llmConfig.model?.modelId || 'claude-haiku-4-5-20251001';
    const temperature = intakeConfig.model?.temperature ?? 0.3;
    const maxTokens = intakeConfig.model?.maxTokens || 600;

    emit('A2_LLM_AGENT_CALLED', {
      mode: 'TIER_2_INTAKE',
      model: modelId,
      inputPreview: clip(input, 80),
      turn,
    });

    // ── Call Claude via streaming infrastructure ─────────────────────────
    const result = await streamWithHeartbeat({
      apiKey,
      model: modelId,
      maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: input }],  // Turn 1 = no history
      callSid,
      turn,
      token: bridgeToken,
      redis,
      emit,
    });

    // ── Handle streaming failure ─────────────────────────────────────────
    if (!result?.response) {
      logger.warn(`${FUNC_TAG} Streaming returned no response`, {
        failureReason: result?.failureReason,
        latencyMs: result?.latencyMs,
      });
      emit('A2_LLM_AGENT_ERROR', {
        mode: 'TIER_2_INTAKE',
        failureReason: result?.failureReason,
        latencyMs: result?.latencyMs,
      });
      return null;
    }

    // ── Parse JSON response ──────────────────────────────────────────────
    let parsed = null;
    try {
      parsed = JSON.parse(result.response);
    } catch (_jsonErr) {
      // Fallback: extract JSON from markdown code blocks or surrounding text
      const jsonMatch = result.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (_innerErr) { /* JSON extraction failed completely */ }
      }
    }

    if (!parsed || !parsed.responseText) {
      logger.warn(`${FUNC_TAG} Failed to parse JSON from LLM response`, {
        responsePreview: clip(result.response, 200),
        callSid, turn
      });
      emit('A2_LLM_INTAKE_PARSE_FAILED', {
        responsePreview: clip(result.response, 120),
        latencyMs: result.latencyMs,
      });
      // Use raw response as acknowledgment with empty extraction
      parsed = {
        responseText: result.response.replace(/[{}"\\]/g, '').trim().substring(0, 300),
        extraction: {},
        confidence: {},
        nextLane: 'DISCOVERY_CONTINUE',
        doNotReask: []
      };
    }

    // ── Validate and sanitize ────────────────────────────────────────────
    const VALID_LANES = ['BOOKING_HANDOFF', 'DISCOVERY_CONTINUE', 'TRANSFER', 'UNKNOWN'];
    if (!VALID_LANES.includes(parsed.nextLane)) {
      parsed.nextLane = 'DISCOVERY_CONTINUE';
    }
    if (!Array.isArray(parsed.doNotReask)) {
      parsed.doNotReask = [];
    }
    parsed.extraction = parsed.extraction || {};
    parsed.confidence = parsed.confidence || {};

    // ── Emit success ─────────────────────────────────────────────────────
    emit('A2_LLM_AGENT_RESPONSE', {
      mode: 'TIER_2_INTAKE',
      latencyMs: result.latencyMs,
      model: modelId,
      tokensInput: result.tokensUsed?.input || 0,
      tokensOutput: result.tokensUsed?.output || 0,
      responsePreview: clip(parsed.responseText, 120),
      wasPartial: result.wasPartial,
      nextLane: parsed.nextLane,
      entitiesExtracted: Object.keys(parsed.extraction).filter(k => parsed.extraction[k] != null).length,
      doNotReaskCount: parsed.doNotReask.length,
    });

    return {
      ...parsed,
      tokensUsed: result.tokensUsed || { input: 0, output: 0 },
      latencyMs: result.latencyMs,
      wasPartial: result.wasPartial,
    };

  } catch (error) {
    logger.error(`${FUNC_TAG} Intake call failed`, { error: error.message, callSid, turn });
    emit('A2_LLM_AGENT_ERROR', { mode: 'TIER_2_INTAKE', error: error.message });
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP STATE MANAGEMENT
// ────────────────────────────────────────────────────────────────────────────
// Non-terminal consent buckets (COMPLEX, HESITANT, REPROMPT) preserve follow-up
// state so the NEXT turn stays in the protected follow-up lane:
//   - ScrabEngine bypass (raw STT → consent classifier)
//   - Bridge suppression (no filler audio while caller is responding)
//   - Lenient speechTimeout (caller gets time to finish thought)
//   - LLM receives follow-up context (original question + conversation thread)
//
// Terminal buckets (YES, NO, MAINTENANCE, SERVICE_CALL) clear immediately —
// the question was answered.
//
// MAX_FOLLOWUP_CONTINUATIONS caps non-terminal cycles to prevent infinite
// consent gate loops. After the cap, state clears and normal discovery resumes.
// ────────────────────────────────────────────────────────────────────────────

const MAX_FOLLOWUP_CONTINUATIONS = 3;

/**
 * Clear pending follow-up question state (terminal resolution).
 * Called when the caller gives a definitive answer (YES/NO/MAINTENANCE/SERVICE_CALL)
 * or when continuation cap is exhausted.
 */
function clearPendingFollowUp(nextState) {
  nextState.agent2.discovery.pendingFollowUpQuestion = null;
  nextState.agent2.discovery.pendingFollowUpQuestionTurn = null;
  nextState.agent2.discovery.pendingFollowUpQuestionSource = null;
  nextState.agent2.discovery.pendingFollowUpQuestionNextAction = null;
  nextState.agent2.discovery.followUpContinuationCount = 0;
}

/**
 * Preserve follow-up state for the next turn (non-terminal continuation).
 * Bumps the turn number to refresh the ±2 tolerance window so the consent
 * gate remains active. Increments the continuation counter toward the cap.
 *
 * Does NOT touch pendingFollowUpQuestion, pendingFollowUpQuestionSource, or
 * pendingFollowUpQuestionNextAction — the original question stays intact.
 */
function preserveFollowUpForNextTurn(nextState, turn) {
  nextState.agent2.discovery.pendingFollowUpQuestionTurn = turn;
  nextState.agent2.discovery.followUpContinuationCount =
    (nextState.agent2.discovery.followUpContinuationCount || 0) + 1;
}

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
/**
 * Substitute trigger card variables in text.
 * 
 * Two kinds of variables:
 * 1. STATIC (company): {diagnosticfee}, {maintenanceplanprice} — from CompanyTriggerSettings
 * 2. RUNTIME (per-call): {name} — from ScrabEngine extraction / caller identity
 * 
 * Runtime variables are resolved first, then static company variables.
 * {name} resolves to ", CallerName" or "" (empty) so triggers read naturally:
 *   "Got it{name}." → "Got it, Marc." or "Got it."
 * 
 * @param {string} text - Text potentially containing {variable} placeholders
 * @param {string} companyId - Company ID to load static variables for
 * @param {Object} [runtimeVars] - Runtime variables (e.g., { name: "Marc" })
 * @returns {Promise<string>} Text with variables substituted
 */
async function substituteTriggerVariables(text, companyId, runtimeVars = {}) {
  if (!text || typeof text !== 'string' || !companyId) return text;
  if (!text.includes('{')) return text;
  
  let result = text;
  
  try {
    // STATIC VARIABLES (company-level, e.g., {diagnosticfee})
    // Loaded first so static overrides for runtime vars take precedence
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
    
    for (const [varName, value] of Object.entries(variables)) {
      if (!value) continue;
      const regex = new RegExp(`\\{${varName}\\}`, 'gi');
      result = result.replace(regex, value);
    }
    
    // RUNTIME VARIABLE: {name}
    // Always stripped from trigger text — name personalization is handled
    // separately by buildAck() once per call, not in every trigger response.
    result = result.replace(/\{name\}/gi, '');
    
    return result;
  } catch (err) {
    logger.warn('[Agent2Discovery] Failed to substitute trigger variables', { 
      companyId, 
      error: err.message 
    });
    return result;
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
 * Build ack word for response prefix ("Ok.", "Sure.", etc.).
 * Name Greeting is now handled by applyFirstTurnGreeting() as a
 * universal post-processor — no longer part of ack construction.
 */
function buildAck(baseAck) {
  return { ack: `${baseAck || 'Ok.'}`.trim() };
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
  static async run({ company, companyId, callSid, userInput, state, emitEvent = null, turn = null, bridgeToken = null, redis = null }) {
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

    // ══════════════════════════════════════════════════════════════════════════
    // 123RP CROSS-TURN MEMORY (Package 4A) — Recovery Detection
    // ══════════════════════════════════════════════════════════════════════════
    // If the previous turn was a T3 fallback, this turn is a recovery turn.
    // Load the recovery context so T2 (LLM Agent) can be enriched with what
    // happened last turn instead of starting from scratch.
    // ══════════════════════════════════════════════════════════════════════════
    const prevLastPath = state?.agent2?.discovery?.lastPath || null;
    const prevTier = prevLastPath?.startsWith('FALLBACK_') ? 3 : null;
    const isRecoveryTurn = prevTier === 3;
    const t3RecoveryCtx = isRecoveryTurn
      ? (state?.agent2?.discovery?.t3RecoveryContext || null)
      : null;

    if (isRecoveryTurn) {
      emit('A2_RECOVERY_TURN', {
        prevPath: prevLastPath,
        consecutiveT3Count: t3RecoveryCtx?.consecutiveT3Count || 0,
        prevIntent: t3RecoveryCtx?.intent ? clip(t3RecoveryCtx.intent, 60) : null,
        prevCallerName: t3RecoveryCtx?.callerName || null,
        turn,
      });
    }

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
    
    // V129: Use 'let' so we can update after ScrabEngine extracts name on Turn 1
    // Primary: persisted callerName (survives across turns via StateStore)
    // Fallback: plainSlots.name (legacy, rarely populated)
    let callerName = state?.callerName || state?.plainSlots?.name || null;

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

    // 123RP Package 4C: Reset recovery counters at start of every turn.
    // T3 section re-sets these if it fires. If T1/T2 succeeds (early return),
    // the counters stay at 0 — consecutive streak is broken.
    nextState.agent2.discovery.consecutiveT3Count = 0;
    nextState.agent2.discovery.t3RecoveryContext = null;
    nextState.agent2.discovery.t3Context = null;
    
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
    // TURN-1 LLM INTAKE — Structured Entity Extraction (before ScrabEngine)
    // ══════════════════════════════════════════════════════════════════════════
    // On turn 1, if LLM Intake is enabled, bypass ScrabEngine and triggers.
    // Send raw speech to Claude for entity extraction + warm acknowledgment.
    // Extracted entities are written to the SAME state paths ScrabEngine uses,
    // so turn 2+ sees pre-filled slots and does not re-ask.
    //
    // On failure: falls through to normal pipeline (ScrabEngine → triggers → LLM).
    // ══════════════════════════════════════════════════════════════════════════
    if (turn === 1) {
      const intakeResult = await callLLMAgentForIntake({
        company,
        input,
        channel: 'call',
        turn,
        emit,
        callSid,
        bridgeToken,
        redis,
      });

      if (intakeResult?.responseText) {
        // ── SUCCESS: Write extracted entities into ScrabEngine state format ──
        const ext = intakeResult.extraction || {};
        const conf = intakeResult.confidence || {};

        // Load intake config for confidence thresholds
        const savedIntake = company?.aiAgentSettings?.llmAgent?.intake || {};
        const intakeConf = deepMergeLLMAgent(DEFAULT_INTAKE_SETTINGS, savedIntake);
        const thresholds = intakeConf.confidence || {};

        // Build ScrabEngine-compatible entity structure
        const intakeEntities = {};
        const intakeHandoff = {};

        if (ext.firstName && (conf.firstName || 0) >= (thresholds.nameThreshold || 0.70)) {
          intakeEntities.firstName = ext.firstName;
          intakeHandoff.firstName = ext.firstName;
          intakeHandoff._firstNameMeta = { source: 'llm_intake', confidence: conf.firstName };
        }
        if (ext.lastName) {
          intakeEntities.lastName = ext.lastName;
          intakeHandoff.lastName = ext.lastName;
          intakeHandoff._lastNameMeta = { source: 'llm_intake', confidence: conf.lastName };
        }
        if (ext.firstName && ext.lastName) {
          intakeEntities.fullName = `${ext.firstName} ${ext.lastName}`.trim();
        } else if (ext.firstName) {
          intakeEntities.fullName = ext.firstName;
        }
        if (ext.phone && (conf.phone || 0) >= (thresholds.phoneThreshold || 0.80)) {
          intakeEntities.phone = ext.phone;
          intakeHandoff.phone = ext.phone;
        }
        if (ext.email) {
          intakeEntities.email = ext.email;
          intakeHandoff.email = ext.email;
        }
        if (ext.address && (conf.address || 0) >= (thresholds.addressThreshold || 0.60)) {
          intakeEntities.address = ext.address;
          intakeHandoff.address = ext.address;
        }

        // Write to ScrabEngine state paths (so turn 2+ sees pre-filled data)
        nextState.agent2.scrabEngine = nextState.agent2.scrabEngine || {};
        nextState.agent2.scrabEngine.entities = intakeEntities;
        nextState.agent2.scrabEngine.handoffEntities = intakeHandoff;
        nextState.agent2.scrabEngine.rawText = input;
        nextState.agent2.scrabEngine.normalizedText = input;

        // Write name metadata (matches ScrabEngine name confidence gate pattern)
        const nameConfidence = conf.firstName || 0;
        const NAME_CONFIDENCE_THRESHOLD = 0.70;
        const nameIsSpeakable = nameConfidence >= NAME_CONFIDENCE_THRESHOLD;

        if (ext.firstName) {
          nextState.agent2.scrabEngine.tentativeFirstName = ext.firstName;
          nextState.agent2.scrabEngine.firstNameConfidence = nameConfidence;
          nextState.agent2.scrabEngine.firstNameSpeakable = nameIsSpeakable;

          if (nameIsSpeakable) {
            nextState.callerName = ext.firstName;
            callerName = ext.firstName;
          }
        }

        // Write callContext (matches V131 structured call context format)
        nextState.agent2.callContext = {
          caller: {
            firstName: ext.firstName || null,
            firstNameConfidence: conf.firstName || 0,
            speakable: nameIsSpeakable
          },
          issue: {
            summary: ext.callReason || null,
            rawInput: input,
            system: null,
            location: ext.address || null,
            risk: ext.urgency === 'emergency' ? 'emergency' : null
          },
          urgency: {
            level: ext.urgency || 'normal',
            sameDayRequested: ext.sameDayRequested || false,
            reason: ext.urgency === 'high' || ext.urgency === 'emergency' ? 'caller_stated' : null
          },
          intent: {
            primary: ext.callReason || null,
            source: 'llm_intake'
          },
          questionsAsked: [],
          questionsAnswered: [],
          discoveryComplete: false
        };

        // Write intake-specific state (for turn 2+ to reference)
        nextState.agent2.discovery.lastPath = 'LLM_INTAKE_TURN_1';
        nextState.agent2.discovery.intakeResult = {
          nextLane: intakeResult.nextLane,
          doNotReask: intakeResult.doNotReask || [],
          technicianMentioned: ext.technicianMentioned || null,
          priorVisit: ext.priorVisit,
          extractionSummary: Object.keys(ext).filter(k => ext[k] != null),
          latencyMs: intakeResult.latencyMs,
          wasPartial: intakeResult.wasPartial,
        };
        nextState.agent2.discovery.llmTurnsThisCall = 1;

        // Write to capturedReason slot if call reason was extracted
        if (ext.callReason) {
          nextState.plainSlots = nextState.plainSlots || {};
          nextState.plainSlots.call_reason_detail = ext.callReason;
        }

        // ── Emit extraction details for Call Intelligence ─────────────────
        emit('LLM_INTAKE_EXTRACTION', {
          entities: intakeEntities,
          handoffEntities: intakeHandoff,
          callReason: ext.callReason || null,
          urgency: ext.urgency || null,
          nextLane: intakeResult.nextLane,
          doNotReask: intakeResult.doNotReask || [],
          technicianMentioned: ext.technicianMentioned || null,
          priorVisit: ext.priorVisit != null ? ext.priorVisit : null,
          sameDayRequested: ext.sameDayRequested != null ? ext.sameDayRequested : null,
          extractionSummary: Object.keys(ext).filter(k => ext[k] != null),
          confidence: conf,
          wasPartial: intakeResult.wasPartial || false,
          latencyMs: intakeResult.latencyMs,
        });

        // ── Build response and return ─────────────────────────────────────
        const response = intakeResult.responseText;

        emit('A2_PATH_SELECTED', {
          path: 'LLM_INTAKE_TURN_1',
          reason: 'Turn-1 LLM Intake extracted entities and generated acknowledgment',
          _123rpTier: RESPONSE_TIER.TIER_2,
          _123rpLabel: 'LLM_AGENT',
          model: 'claude',
          latencyMs: intakeResult.latencyMs,
          tokensInput: intakeResult.tokensUsed?.input,
          tokensOutput: intakeResult.tokensUsed?.output,
          nextLane: intakeResult.nextLane,
          entitiesExtracted: Object.keys(ext).filter(k => ext[k] != null).length,
        });
        emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
          'agent2.llmAgent.intake',
          null,
          response,
          null,
          '123RP Tier 2: LLM Intake — Turn-1 entity extraction + acknowledgment'
        ));
        emit('A2_RESPONSE_READY', {
          path: 'LLM_INTAKE_TURN_1',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'llmAgent.intake',
          usedCallerName: !!(callerName && response.toLowerCase().includes(callerName.toLowerCase())),
          isLLMAgent: true,
          isIntake: true,
          latencyMs: intakeResult.latencyMs,
        });

        return {
          response,
          matchSource: 'AGENT2_DISCOVERY',
          state: nextState,
          _123rp: build123rpMeta('LLM_INTAKE_TURN_1')
        };
      }

      // Intake returned null or no responseText — fall through to normal pipeline
      emit('A2_INTAKE_FALLTHROUGH', {
        reason: 'Intake disabled, gated, or failed — proceeding to normal pipeline',
        turn,
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 123RP: FOLLOW-UP CONSENT GATE — Raw from Gather (before ScrabEngine)
    // ══════════════════════════════════════════════════════════════════════════
    // When a trigger card asked a follow-up question last turn (e.g., "Would
    // you like to book an appointment?"), the caller's raw response routes
    // DIRECTLY here — bypassing ScrabEngine entirely.
    //
    // 123RP applies:
    //   Tier 1 (Deterministic): YES/NO/MAINTENANCE/SERVICE_CALL phrase match
    //   Tier 2 (LLM Agent):     REPROMPT/HESITANT/COMPLEX/NO/YES+residual → Claude
    //   Tier 3 (Canned):        If LLM Agent disabled/failed → UI-owned response
    //
    // Input: raw from gather → lowercase → strip punctuation (Tier 1 only)
    //        raw from gather → as-is to Claude (Tier 2)
    // ══════════════════════════════════════════════════════════════════════════
    const pfuq = nextState.agent2?.discovery?.pendingFollowUpQuestion || null;
    const pfuqTurn = nextState.agent2?.discovery?.pendingFollowUpQuestionTurn;
    const pfuqSource = nextState.agent2?.discovery?.pendingFollowUpQuestionSource || null;
    const hasPFUQ = pfuq && typeof pfuqTurn === 'number';
    // Allow ±1 turn tolerance: bridge ghost turns (actionOnEmptyResult) increment
    // the counter without real caller speech, so pfuqTurn may be turn-2 instead of turn-1
    const isRespondingToPFUQ = hasPFUQ && (turn - pfuqTurn) >= 1 && (turn - pfuqTurn) <= 2;

    // Ghost turn guard: if PFUQ is active but input is empty (bridge timeout
    // Gather with actionOnEmptyResult:true), bump pfuqTurn forward instead of
    // consuming the consent gate with an empty input.
    const inputTrimmed = (input || '').trim();
    if (isRespondingToPFUQ && inputTrimmed.length === 0) {
      nextState.agent2.discovery.pendingFollowUpQuestionTurn = turn;
      emit('PFUQ_GHOST_TURN_SKIPPED', {
        reason: 'Empty input (bridge ghost turn) — preserving PFUQ for next real turn',
        question: clip(pfuq, 60),
        pfuqTurn,
        currentTurn: turn
      });
      // Fall through to normal pipeline which will handle the empty input
    } else if (isRespondingToPFUQ) {
      emit('PFUQ_SCRABENGINE_BYPASSED', {
        reason: 'Pending follow-up question active — skipping ScrabEngine, routing to Consent Card classifier',
        question: clip(pfuq, 60),
        cardId: pfuqSource?.replace('card:', '') || null,
        inputPreview: clip(input, 60),
        turn
      });

      const inputLowerCleanFUQ = inputLower.replace(/[^a-z\s]/g, '').trim();
      const inputWordsFUQ = inputLowerCleanFUQ.split(/\s+/).filter(Boolean);
      const inputLenFUQ = input.trim().length;

      // Load configurable keywords from followUpConsent (company-level)
      const fuc = safeObj(discoveryCfg?.followUpConsent, {});
      const yesPhrases = safeArr(fuc.yes?.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);
      const noPhrases = safeArr(fuc.no?.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);
      const maintenancePhrases = safeArr(fuc.maintenance?.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);
      const serviceCallPhrases = safeArr(fuc.service_call?.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);
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
      const matchedPhrasesFor = (list) => {
        const matches = [];
        for (const phrase of list) {
          if (phrase.includes(' ')) {
            if (inputLowerCleanFUQ.includes(phrase)) matches.push(phrase);
          } else if (inputWordsFUQ.includes(phrase)) {
            matches.push(phrase);
          }
        }
        return matches;
      };

      const isMaintenanceFUQ = matchesList(maintenancePhrases);
      const isServiceCallFUQ = matchesList(serviceCallPhrases);
      const isYesFUQ = matchesList(yesPhrases);
      const isNoFUQ = matchesList(noPhrases);
      const isHesitantFUQ = matchesList(hesitantPhrases);
      const hasServiceChoiceConflict = isMaintenanceFUQ && isServiceCallFUQ;
      const isRepromptFUQ = matchesList(repromptPhrases) || (
        inputLenFUQ <= 8 &&
        !isYesFUQ &&
        !isNoFUQ &&
        !isHesitantFUQ &&
        !isMaintenanceFUQ &&
        !isServiceCallFUQ
      );

      // Priority: SERVICE_CALL > MAINTENANCE > YES > NO > HESITANT > REPROMPT > COMPLEX
      let bucket;
      if (hasServiceChoiceConflict) bucket = 'HESITANT';
      else if (isServiceCallFUQ && !isMaintenanceFUQ) bucket = 'SERVICE_CALL';
      else if (isMaintenanceFUQ && !isServiceCallFUQ) bucket = 'MAINTENANCE';
      else if (isYesFUQ && !isNoFUQ) bucket = 'YES';
      else if (isNoFUQ && !isYesFUQ) bucket = 'NO';
      else if (isHesitantFUQ) bucket = 'HESITANT';
      else if (isRepromptFUQ) bucket = 'REPROMPT';
      else bucket = 'COMPLEX';

      const bucketKey = bucket.toLowerCase();
      const bucketConfig = safeObj(fuc[bucketKey], {});
      const inferredBookingMode = bucket === 'MAINTENANCE'
        ? 'maintenance'
        : bucket === 'SERVICE_CALL'
          ? 'service_call'
          : '';
      const bookingMode = `${bucketConfig.bookingMode || inferredBookingMode || ''}`.trim().toLowerCase();
      const defaultDirection = (bucket === 'MAINTENANCE' || bucket === 'SERVICE_CALL')
        ? 'HANDOFF_BOOKING'
        : 'CONTINUE';
      const direction = `${bucketConfig.direction || defaultDirection}`.toUpperCase();
      const matchedByBucket = {
        yes: matchedPhrasesFor(yesPhrases),
        no: matchedPhrasesFor(noPhrases),
        maintenance: matchedPhrasesFor(maintenancePhrases),
        service_call: matchedPhrasesFor(serviceCallPhrases),
        reprompt: matchedPhrasesFor(repromptPhrases),
        hesitant: matchedPhrasesFor(hesitantPhrases)
      };
      const matchedPhrases = hasServiceChoiceConflict
        ? [...new Set([...matchedByBucket.maintenance, ...matchedByBucket.service_call])]
        : (matchedByBucket[bucketKey] || []);
      const missingResponseAction = `${fuc.missingResponseAction || 'REASK_FOLLOWUP'}`.trim().toUpperCase();
      const responseRequiredBuckets = new Set(['YES', 'NO', 'MAINTENANCE', 'SERVICE_CALL', 'REPROMPT', 'HESITANT']);
      const bucketResponse = `${bucketConfig.response || ''}`.trim();

      emit('A2_FOLLOWUP_CONSENT_CLASSIFIED', {
        bucket,
        direction,
        inputPreview: clip(inputLowerCleanFUQ, 60),
        cardId: pfuqSource?.replace('card:', '') || null,
        question: clip(pfuq, 60),
        bookingMode: bookingMode || null,
        matchedPhrases,
        scrabEngineSkipped: true,
        markers: { isMaintenanceFUQ, isServiceCallFUQ, isYesFUQ, isNoFUQ, isHesitantFUQ, isRepromptFUQ, hasServiceChoiceConflict }
      });

      const { ack: fuqAck } = buildAck(ack);

      // ── Missing response config: re-ask follow-up (UI-owned) or fall through ──
      let fallthroughMissingConfig = false;
      if (responseRequiredBuckets.has(bucket) && !bucketResponse) {
        const missingFields = [`followUpConsent.${bucketKey}.response`];
        const fallbackAction = missingResponseAction === 'BACK_TO_AGENT' ? 'BACK_TO_AGENT' : 'REASK_FOLLOWUP';
        const missingResponse = `${fuqAck} ${pfuq}`.trim();
        nextState.agent2.discovery.lastPath = fallbackAction === 'BACK_TO_AGENT'
          ? 'FOLLOWUP_MISSING_CONFIG_AGENT'
          : 'FOLLOWUP_MISSING_CONFIG_REASK';

        emit('A2_FOLLOWUP_CONSENT_CONFIG_MISSING', {
          bucket,
          cardId: pfuqSource?.replace('card:', '') || null,
          missingFields,
          fallbackAction,
          matchedPhrases
        });

        if (fallbackAction === 'BACK_TO_AGENT') {
          // Clear pending follow-up and fall through to normal discovery processing
          clearPendingFollowUp(nextState);
          fallthroughMissingConfig = true;
        } else {
          emit('A2_RESPONSE_READY', {
            path: nextState.agent2.discovery.lastPath,
            responsePreview: clip(missingResponse, 120),
            fallbackAction
          });

          return { response: missingResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta(nextState.agent2.discovery.lastPath) };
        }
      }

      if (!fallthroughMissingConfig) {

        // ────────────────────────────────────────────────────────────────
        // 123RP TIER 1: Deterministic phrase-match buckets
        // ────────────────────────────────────────────────────────────────

        // ── YES (Tier 1 or Tier 2 if residual content) ──
        if (bucket === 'YES') {
          // Detect residual content: "yes but I also want to know about X"
          // Strip matched YES phrases — if meaningful content remains,
          // caller said more than a pure yes → Tier 2 (LLM Agent) handles
          const residualAfterYes = matchedByBucket.yes
            .reduce((text, phrase) => {
              const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '').trim();
            }, inputLowerCleanFUQ)
            .replace(/^[\s,]+|[\s,]+$/g, '')
            .replace(/^(but|and|also|however|though|although|i\b)\s*/i, '')
            .trim();
          const hasResidualContent = residualAfterYes.length > 6;

          if (hasResidualContent) {
            // YES + extra content → fall through to Tier 2 (LLM Agent) below
            emit('A2_FOLLOWUP_YES_WITH_QUESTION', {
              residualPreview: clip(residualAfterYes, 60),
              reason: 'YES with substantive extra content — routing to Tier 2 (LLM Agent)',
              cardId: pfuqSource?.replace('card:', '') || null
            });
          } else {
            // Pure YES → Tier 1 deterministic: execute consent card direction
            clearPendingFollowUp(nextState);
            const yesDirection = `${fuc.yes?.direction || 'CONTINUE'}`.toUpperCase();
            const yesText = bucketResponse;

            if (yesDirection === 'HANDOFF_BOOKING') {
              nextState.sessionMode = 'BOOKING';
              nextState.consent = {
                pending: false,
                given: true,
                turn,
                source: 'followup_consent_gate',
                bucket: bucketKey,
                matchedPhrases,
                grantedAt: new Date().toISOString()
              };
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
            return { response: yesResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta(nextState.agent2.discovery.lastPath) };
          }
        }

        // ── MAINTENANCE / SERVICE_CALL (Tier 1): handoff with booking mode ──
        if (bucket === 'MAINTENANCE' || bucket === 'SERVICE_CALL') {
          clearPendingFollowUp(nextState);
          const choiceText = bucketResponse;

          if (direction === 'HANDOFF_BOOKING') {
            nextState.sessionMode = 'BOOKING';
            nextState.consent = {
              pending: false,
              given: true,
              turn,
              source: 'followup_consent_gate',
              bookingMode: bookingMode || null,
              bucket: bucketKey,
              matchedPhrases,
              grantedAt: new Date().toISOString()
            };
            if (!nextState.agent2.discovery) nextState.agent2.discovery = {};
            nextState.agent2.discovery.bookingMode = bookingMode || null;
            nextState.agent2.discovery.lastPath = `FOLLOWUP_${bucket}_HANDOFF_BOOKING`;

            emit('A2_CONSENT_GATE_BOOKING', {
              reason: `Caller chose ${bookingMode || bucketKey} via follow-up consent → booking handoff`,
              cardId: pfuqSource?.replace('card:', '') || null,
              inputPreview: clip(inputLowerCleanFUQ, 60),
              bookingMode: bookingMode || null
            });
          } else {
            nextState.agent2.discovery.lastPath = `FOLLOWUP_${bucket}`;
          }

          const choiceResponse = `${fuqAck} ${choiceText}`.trim();
          emit('A2_RESPONSE_READY', {
            path: nextState.agent2.discovery.lastPath,
            responsePreview: clip(choiceResponse, 120),
            direction,
            bookingMode: bookingMode || null
          });
          return { response: choiceResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta(nextState.agent2.discovery.lastPath) };
        }

        // ────────────────────────────────────────────────────────────────
        // 123RP TIER 2 → TIER 3: LLM Agent, then canned response
        // ────────────────────────────────────────────────────────────────

        // ── NO (Tier 2 → 3): try LLM Agent first, then canned response ──
        if (bucket === 'NO') {
          const selfScheduling = direction === 'HANDOFF_BOOKING' || nextState.sessionMode === 'BOOKING' || !!nextState.agent2?.discovery?.bookingMode;
          const llmAgentResult = await callLLMAgentForFollowUp({
            company, input, followUpQuestion: pfuq,
            triggerSource: pfuqSource?.replace('card:', '') || null,
            bucket, channel: 'call', emit,
            callSid, turn, bridgeToken, redis,
            callerName, selfScheduling,
            callContext: nextState.agent2?.callContext || null,
          });
          if (llmAgentResult) {
            nextState.agent2.discovery.lastPath = 'FOLLOWUP_LLM_AGENT';
            clearPendingFollowUp(nextState);
            const noLlmResponse = `${fuqAck} ${llmAgentResult.response}`.trim();
            emit('A2_RESPONSE_READY', { path: 'FOLLOWUP_LLM_AGENT', responsePreview: clip(noLlmResponse, 120), source: 'llmAgent' });
            return { response: noLlmResponse, matchSource: 'LLM_AGENT', state: nextState, _123rp: build123rpMeta('FOLLOWUP_LLM_AGENT') };
          }
          // Tier 3: canned response if LLM Agent disabled/failed
          clearPendingFollowUp(nextState);
          const noText = bucketResponse;
          nextState.agent2.discovery.lastPath = 'FOLLOWUP_NO';
          const noResponse = `${fuqAck} ${noText}`.trim();
          emit('A2_RESPONSE_READY', { path: 'FOLLOWUP_NO', responsePreview: clip(noResponse, 120) });
          return { response: noResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta('FOLLOWUP_NO') };
        }

        // ── REPROMPT (Tier 2 → 3): ambiguous short response ──
        // Non-terminal: caller gave a short/unclear response. Follow-up
        // state is preserved so the next turn stays in the consent gate.
        if (bucket === 'REPROMPT') {
          const selfScheduling = direction === 'HANDOFF_BOOKING' || nextState.sessionMode === 'BOOKING' || !!nextState.agent2?.discovery?.bookingMode;
          const llmAgentResult = await callLLMAgentForFollowUp({
            company, input, followUpQuestion: pfuq,
            triggerSource: pfuqSource?.replace('card:', '') || null,
            bucket, channel: 'call', emit,
            callSid, turn, bridgeToken, redis,
            callerName, selfScheduling,
            callContext: nextState.agent2?.callContext || null,
          });
          if (llmAgentResult) {
            const continuationCount = (nextState.agent2.discovery.followUpContinuationCount || 0) + 1;

            if (continuationCount > MAX_FOLLOWUP_CONTINUATIONS) {
              clearPendingFollowUp(nextState);
              nextState.agent2.discovery.lastPath = 'FOLLOWUP_LLM_AGENT';
              emit('PFUQ_CONTINUATION_EXHAUSTED', {
                reason: `Follow-up reached max continuations (${MAX_FOLLOWUP_CONTINUATIONS}) — clearing state`,
                bucket, continuationCount, question: clip(pfuq, 60),
                cardId: pfuqSource?.replace('card:', '') || null
              });
            } else {
              preserveFollowUpForNextTurn(nextState, turn);
              nextState.agent2.discovery.lastPath = 'FOLLOWUP_LLM_AGENT_CONTINUED';
              emit('PFUQ_STATE_CONTINUED', {
                reason: 'Non-terminal bucket — follow-up question still unresolved, preserving state for next turn',
                bucket, continuationCount, question: clip(pfuq, 60),
                cardId: pfuqSource?.replace('card:', '') || null
              });
            }

            const resolvedPath = nextState.agent2.discovery.lastPath;
            const agentResponse = `${fuqAck} ${llmAgentResult.response}`.trim();
            emit('A2_RESPONSE_READY', { path: resolvedPath, responsePreview: clip(agentResponse, 120), source: 'llmAgent' });
            return { response: agentResponse, matchSource: 'LLM_AGENT', state: nextState, _123rp: build123rpMeta(resolvedPath) };
          }
          // Tier 3: canned re-ask if LLM Agent disabled/failed
          // State already preserved (no clearPendingFollowUp call) — T3 re-asks the question
          const repromptText = bucketResponse || `${pfuq}`;
          nextState.agent2.discovery.lastPath = 'FOLLOWUP_REPROMPT';
          const repromptResponse = `${fuqAck} ${repromptText}`.trim();

          emit('A2_RESPONSE_READY', { path: 'FOLLOWUP_REPROMPT', responsePreview: clip(repromptResponse, 120) });
          return { response: repromptResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta('FOLLOWUP_REPROMPT') };
        }

        // ── HESITANT (Tier 2 → 3): caller expressing doubt/conflict ──
        // Non-terminal: caller is unsure. Follow-up state is preserved so
        // the next turn stays in the consent gate for continued resolution.
        if (bucket === 'HESITANT') {
          const selfScheduling = direction === 'HANDOFF_BOOKING' || nextState.sessionMode === 'BOOKING' || !!nextState.agent2?.discovery?.bookingMode;
          const llmAgentResult = await callLLMAgentForFollowUp({
            company, input, followUpQuestion: pfuq,
            triggerSource: pfuqSource?.replace('card:', '') || null,
            bucket, channel: 'call', emit,
            callSid, turn, bridgeToken, redis,
            callerName, selfScheduling,
            callContext: nextState.agent2?.callContext || null,
          });
          if (llmAgentResult) {
            const continuationCount = (nextState.agent2.discovery.followUpContinuationCount || 0) + 1;

            if (continuationCount > MAX_FOLLOWUP_CONTINUATIONS) {
              clearPendingFollowUp(nextState);
              nextState.agent2.discovery.lastPath = 'FOLLOWUP_LLM_AGENT';
              emit('PFUQ_CONTINUATION_EXHAUSTED', {
                reason: `Follow-up reached max continuations (${MAX_FOLLOWUP_CONTINUATIONS}) — clearing state`,
                bucket, continuationCount, question: clip(pfuq, 60),
                cardId: pfuqSource?.replace('card:', '') || null
              });
            } else {
              preserveFollowUpForNextTurn(nextState, turn);
              nextState.agent2.discovery.lastPath = 'FOLLOWUP_LLM_AGENT_CONTINUED';
              emit('PFUQ_STATE_CONTINUED', {
                reason: 'Non-terminal bucket — follow-up question still unresolved, preserving state for next turn',
                bucket, continuationCount, question: clip(pfuq, 60),
                cardId: pfuqSource?.replace('card:', '') || null
              });
            }

            const resolvedPath = nextState.agent2.discovery.lastPath;
            const agentResponse = `${fuqAck} ${llmAgentResult.response}`.trim();
            emit('A2_RESPONSE_READY', { path: resolvedPath, responsePreview: clip(agentResponse, 120), source: 'llmAgent' });
            return { response: agentResponse, matchSource: 'LLM_AGENT', state: nextState, _123rp: build123rpMeta(resolvedPath) };
          }
          // Tier 3: canned clarification if LLM Agent disabled/failed
          // State already preserved (no clearPendingFollowUp call) — T3 re-asks with clarification
          const hesitantText = bucketResponse || `${pfuq}`;
          nextState.agent2.discovery.lastPath = 'FOLLOWUP_HESITANT';
          const hesitantResponse = `${fuqAck} ${hesitantText}`.trim();

          emit('A2_RESPONSE_READY', { path: 'FOLLOWUP_HESITANT', responsePreview: clip(hesitantResponse, 120) });
          return { response: hesitantResponse, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta('FOLLOWUP_HESITANT') };
        }

        // ── COMPLEX / YES+residual (Tier 2 → fallthrough): substantive response ──
        // Non-terminal: question is still unresolved. LLM handles the response
        // contextually, then follow-up state is PRESERVED (not cleared) so the
        // next turn stays in the protected consent gate lane.
        const selfScheduling = direction === 'HANDOFF_BOOKING' || nextState.sessionMode === 'BOOKING' || !!nextState.agent2?.discovery?.bookingMode;
        const llmAgentResult = await callLLMAgentForFollowUp({
          company, input, followUpQuestion: pfuq,
          triggerSource: pfuqSource?.replace('card:', '') || null,
          bucket, channel: 'call', emit,
          callSid, turn, bridgeToken, redis,
          callerName, selfScheduling,
          callContext: nextState.agent2?.callContext || null,
        });
        if (llmAgentResult) {
          const continuationCount = (nextState.agent2.discovery.followUpContinuationCount || 0) + 1;

          if (continuationCount > MAX_FOLLOWUP_CONTINUATIONS) {
            // Continuation cap exhausted — clear state, return LLM response normally
            clearPendingFollowUp(nextState);
            nextState.agent2.discovery.lastPath = 'FOLLOWUP_LLM_AGENT';
            emit('PFUQ_CONTINUATION_EXHAUSTED', {
              reason: `Follow-up reached max continuations (${MAX_FOLLOWUP_CONTINUATIONS}) — clearing state, returning to normal discovery`,
              bucket,
              continuationCount,
              question: clip(pfuq, 60),
              cardId: pfuqSource?.replace('card:', '') || null
            });
          } else {
            // Preserve follow-up state — next turn re-enters consent gate
            preserveFollowUpForNextTurn(nextState, turn);
            nextState.agent2.discovery.lastPath = 'FOLLOWUP_LLM_AGENT_CONTINUED';
            emit('PFUQ_STATE_CONTINUED', {
              reason: 'Non-terminal bucket — follow-up question still unresolved, preserving state for next turn',
              bucket,
              continuationCount,
              question: clip(pfuq, 60),
              cardId: pfuqSource?.replace('card:', '') || null
            });
          }

          const { ack: complexAck } = buildAck(ack);
          const agentResponse = `${complexAck} ${llmAgentResult.response}`.trim();
          const resolvedPath = nextState.agent2.discovery.lastPath;
          emit('A2_RESPONSE_READY', { path: resolvedPath, responsePreview: clip(agentResponse, 120), source: 'llmAgent' });
          return { response: agentResponse, matchSource: 'LLM_AGENT', state: nextState, _123rp: build123rpMeta(resolvedPath) };
        }

        // Tier 3: LLM Agent unavailable — fall through to ScrabEngine + trigger matching
        // When LLM is down, there's no contextual handler for COMPLEX — falling
        // through to normal discovery is the correct degradation path.
        clearPendingFollowUp(nextState);
        nextState.agent2.discovery.lastPath = 'FOLLOWUP_COMPLEX';
        emit('A2_FOLLOWUP_COMPLEX_FALLTHROUGH', {
          reason: 'Caller gave substantive non-yes/no response — LLM Agent unavailable, routing through normal discovery',
          inputPreview: clip(inputLowerCleanFUQ, 80)
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 🔍 SCRABENGINE - UNIFIED TEXT PROCESSING PIPELINE
    // ══════════════════════════════════════════════════════════════════════════
    // ✅ V125 SEQUENCE FIX: ScrabEngine moved BEFORE greeting interceptor
    // 
    // CRITICAL: This must run FIRST to clean text before any decision logic.
    // 
    // WHY THIS ORDER MATTERS:
    // - User says: "Hi I need emergency service"
    // - ScrabEngine removes "Hi" → "need emergency service"
    // - Greeting interceptor sees cleaned text → NO match (has intent)
    // - Triggers evaluate cleaned text → EMERGENCY trigger fires ✅
    // 
    // OLD (BROKEN): Greeting ran first, saw "Hi", returned early, never reached triggers
    // NEW (FIXED): ScrabEngine runs first, greeting sees cleaned text, triggers work
    // 
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
    
    // ──────────────────────────────────────────────────────────────────────────
    // SCRABENGINE VISUAL TRACE - Generate Call Console events
    // ──────────────────────────────────────────────────────────────────────────
    // Create detailed trace events showing the complete text processing journey
    // These appear in Call Console transcript for debugging and transparency
    const scrabTraceEvents = ScrabEngine.generateCallConsoleTrace(scrabResult);
    
    // Emit each stage as a separate event for Call Console rendering
    for (const traceEvent of scrabTraceEvents) {
      emit(traceEvent.stage, traceEvent);
    }
    
    // ScrabEngine processing summary (overview event)
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
      note: 'ScrabEngine: Fillers → Vocabulary → Synonyms → Quality Gate',
      // Visual trace events for Call Console
      visualTrace: scrabTraceEvents
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
    // ACCUMULATION: Merge entities across turns instead of overwriting.
    // Null from current turn means "no extraction" — preserve previous turn's value.
    // Prevents name loss when consent turns ("yes please") yield no entities.
    const previousScrab = state?.agent2?.scrabEngine || {};

    const mergeEntities = (prev, curr) => {
      if (!prev) return curr || {};
      if (!curr) return prev;
      const merged = { ...prev };
      for (const [key, value] of Object.entries(curr)) {
        if (value != null) merged[key] = value;
      }
      return merged;
    };

    const mergedEntities = mergeEntities(previousScrab.entities, scrabResult.entities);
    const mergedHandoff = mergeEntities(
      previousScrab.handoffEntities,
      scrabResult.handoffEntities || scrabResult.entities
    );

    nextState.agent2.scrabEngine = {
      rawText: scrabResult.rawText,
      normalizedText: scrabResult.normalizedText,
      expandedTokens: scrabResult.expandedTokens,
      transformations: scrabResult.transformations,
      entities: mergedEntities,
      handoffEntities: mergedHandoff,
      // Stage 4: current turn's extraction if available, else preserve previous
      stage4_extraction: (scrabResult.stage4_extraction ? {
        extractions: scrabResult.stage4_extraction.extractions,
        validations: scrabResult.stage4_extraction.validations
      } : null) || previousScrab.stage4_extraction || null
    };

    // Diagnostic: log when accumulation preserves a name from a previous turn
    if (previousScrab.entities?.firstName && !scrabResult.entities?.firstName) {
      logger.info('[ScrabEngine] Accumulation preserved firstName from previous turn', {
        preserved: previousScrab.entities.firstName,
        currentInput: clip(input, 40),
        callSid, turn
      });
    }
    if (previousScrab.entities?.lastName && !scrabResult.entities?.lastName) {
      logger.info('[ScrabEngine] Accumulation preserved lastName from previous turn', {
        preserved: previousScrab.entities.lastName,
        currentInput: clip(input, 40),
        callSid, turn
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCRABENGINE → TRIGGER HANDOFF REPORT
    // Shows EXACTLY what ScrabEngine delivers to the trigger matching system
    // ═══════════════════════════════════════════════════════════════════════════
    emit('SCRABENGINE_HANDOFF_TO_TRIGGERS', {
      handoffStep: 'ScrabEngine → Trigger Matching',
      
      // WHAT TRIGGERS WILL RECEIVE
      normalizedInput: normalizedInput,
      expandedTokens: expandedTokens,
      originalTokenCount: originalTokens.length,
      expandedTokenCount: expandedTokens.length,
      tokensAdded: expandedTokens.length - originalTokens.length,
      
      // QUALITY CHECK RESULTS
      qualityPassed: scrabResult.quality.passed,
      qualityReason: scrabResult.quality.reason,
      qualityConfidence: scrabResult.quality.confidence,
      
      // TRANSFORMATIONS APPLIED
      transformationCount: scrabResult.transformations.length,
      transformationSummary: scrabResult.transformations.map(t => ({
        stage: t.stage,
        type: t.type,
        detail: t.value || t.pattern?.join('+') || t.addedTokens?.slice(0, 3).join(', ')
      })),
      
      // SAMPLE OF EXPANDED TOKENS FOR MATCHING
      sampleExpandedTokens: expandedTokens.slice(0, 15),
      
      // ENTITIES EXTRACTED
      entitiesFound: Object.keys(scrabResult.entities || {}).filter(k => scrabResult.entities[k]).length,
      entities: scrabResult.entities,
      
      turn,
      callSid,
      
      note: 'This normalized text + expanded tokens will now be matched against trigger keywords/phrases'
    });
    
    // ══════════════════════════════════════════════════════════════════════════
    // ENTITY EXTRACTION - Use ScrabEngine extracted entities
    // ══════════════════════════════════════════════════════════════════════════
    // ScrabEngine Stage 4 has already extracted names, phone, address, email
    // Use these instead of running separate extraction logic
    
    if (scrabResult.entities?.firstName && !nextState.callerName) {
      const firstNameExtraction = scrabResult.stage4_extraction?.extractions?.find(e => e.type === 'firstName');
      const lastNameExtraction = scrabResult.stage4_extraction?.extractions?.find(e => e.type === 'lastName');
      const nameConfidence = firstNameExtraction?.confidence || 0.9;

      // V131: NAME CONFIDENCE GATE — never speak a low-confidence name.
      // Wrong name is catastrophically worse than no name.
      // Threshold: 0.70 — below this, name is stored as tentative but never spoken.
      const NAME_CONFIDENCE_THRESHOLD = 0.70;
      const nameIsSpeakable = nameConfidence >= NAME_CONFIDENCE_THRESHOLD;

      if (nameIsSpeakable) {
        nextState.callerName = scrabResult.entities.firstName;

        // V129 FIX: Update local callerName variable so Name Greeting can use it
        // Previously, callerName was captured from state BEFORE ScrabEngine ran,
        // so on Turn 1 it was always null even though we extracted a name.
        callerName = scrabResult.entities.firstName;
      } else {
        logger.warn('[ScrabEngine] ⚠️ Name confidence below threshold — suppressed from spoken output', {
          extractedName: scrabResult.entities.firstName,
          confidence: nameConfidence,
          threshold: NAME_CONFIDENCE_THRESHOLD,
          verificationMode: firstNameExtraction?.verificationMode || null,
          callSid,
          turn
        });
      }

      // Store tentative name in state metadata regardless of confidence
      // so later turns or booking can reference it if needed
      nextState.agent2 = nextState.agent2 || {};
      nextState.agent2.scrabEngine = nextState.agent2.scrabEngine || {};
      nextState.agent2.scrabEngine.tentativeFirstName = scrabResult.entities.firstName;
      nextState.agent2.scrabEngine.firstNameConfidence = nameConfidence;
      nextState.agent2.scrabEngine.firstNameSpeakable = nameIsSpeakable;

      emit('CALLER_NAME_EXTRACTED', {
        firstName: scrabResult.entities.firstName,
        lastName: scrabResult.entities.lastName || null,
        source: 'scrabengine_stage4',
        pattern: firstNameExtraction?.pattern || 'unknown',
        confidence: nameConfidence,
        speakable: nameIsSpeakable,
        suppressedReason: nameIsSpeakable ? null : 'confidence_below_threshold',
        // Name verification metadata
        verificationMode: firstNameExtraction?.verificationMode || null,
        correctedFrom: firstNameExtraction?.correctedFrom || null,
        candidates: firstNameExtraction?.candidates || null,
        lastNameVerificationMode: lastNameExtraction?.verificationMode || null,
        lastNameCorrectedFrom: lastNameExtraction?.correctedFrom || null
      });

      logger.info(`[ScrabEngine] ${nameIsSpeakable ? '✅' : '⚠️'} Caller name extracted${nameIsSpeakable ? ' and stored' : ' (tentative — not speakable)'}`, {
        firstName: scrabResult.entities.firstName,
        lastName: scrabResult.entities.lastName,
        confidence: nameConfidence,
        speakable: nameIsSpeakable,
        callSid,
        turn
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // V131: STRUCTURED CALL CONTEXT — Live Working Memory
    // ══════════════════════════════════════════════════════════════════════════
    // Built after ScrabEngine runs, persisted across turns in state.
    // Every component reads this: trigger cards, LLM agent, booking handoff.
    // Contains: who called, why, what urgency, what's been asked/answered.
    // ══════════════════════════════════════════════════════════════════════════
    {
      // Initialize callContext on first turn, update on subsequent turns
      const existingCtx = nextState.agent2.callContext || null;
      const callContext = existingCtx || {
        caller: { firstName: null, firstNameConfidence: 0, speakable: false },
        issue: { summary: null, rawInput: null, system: null, location: null, risk: null },
        urgency: { level: 'normal', sameDayRequested: false, reason: null },
        intent: { primary: null, source: null },
        questionsAsked: [],
        questionsAnswered: [],
        discoveryComplete: false
      };

      // Update caller name from ScrabEngine (respects confidence gate)
      if (scrabResult.entities?.firstName) {
        const fnExtraction = scrabResult.stage4_extraction?.extractions?.find(e => e.type === 'firstName');
        callContext.caller.firstName = scrabResult.entities.firstName;
        callContext.caller.firstNameConfidence = fnExtraction?.confidence || 0.9;
        callContext.caller.speakable = (fnExtraction?.confidence || 0.9) >= 0.70;
      }

      // Extract issue details from normalized input on turn 1 (or update if not set)
      if (!callContext.issue.summary && normalizedInput) {
        const inputLow = normalizedInput.toLowerCase();

        // Issue detection: look for problem-indicator words
        const problemIndicators = [
          'leak', 'leaking', 'broken', 'not working', 'not cooling', 'not heating',
          'water', 'noise', 'smell', 'smoke', 'frozen', 'ice', 'dripping', 'flooding',
          'no power', 'no air', 'hot air', 'cold air', 'damage', 'emergency'
        ];
        const matchedProblems = problemIndicators.filter(p => inputLow.includes(p));

        if (matchedProblems.length > 0) {
          // Build a concise issue summary from the matched indicators
          const systemKeywords = ['ac', 'air conditioning', 'furnace', 'heater', 'hvac', 'thermostat', 'unit', 'system', 'heat pump', 'duct', 'vent'];
          const locationKeywords = ['garage', 'attic', 'basement', 'kitchen', 'bedroom', 'bathroom', 'living room', 'ceiling', 'wall', 'roof', 'closet', 'hallway', 'upstairs', 'downstairs'];
          const riskKeywords = ['damage', 'damaging', 'flooding', 'fire', 'mold', 'dangerous', 'emergency', 'unsafe'];
          const urgencyKeywords = ['today', 'asap', 'right away', 'immediately', 'urgent', 'emergency', 'as soon as possible', 'right now'];

          const detectedSystem = systemKeywords.find(s => inputLow.includes(s)) || null;
          const detectedLocation = locationKeywords.find(l => inputLow.includes(l)) || null;
          const detectedRisk = riskKeywords.find(r => inputLow.includes(r)) || null;
          const hasSameDayUrgency = urgencyKeywords.some(u => inputLow.includes(u));

          // Build summary: "water leaking from AC unit" style
          const summaryParts = [];
          if (matchedProblems.includes('water') || matchedProblems.includes('leak') || matchedProblems.includes('leaking')) {
            summaryParts.push('water leak');
          } else {
            summaryParts.push(matchedProblems[0]);
          }
          if (detectedSystem) summaryParts.push(`from ${detectedSystem === 'ac' ? 'AC unit' : detectedSystem}`);
          if (detectedLocation) summaryParts.push(`in ${detectedLocation}`);

          callContext.issue.summary = summaryParts.join(' ');
          callContext.issue.rawInput = normalizedInput.substring(0, 200);
          callContext.issue.system = detectedSystem === 'ac' ? 'AC unit' : detectedSystem;
          callContext.issue.location = detectedLocation;
          callContext.issue.risk = detectedRisk;

          if (hasSameDayUrgency || detectedRisk) {
            callContext.urgency.level = 'high';
            callContext.urgency.sameDayRequested = hasSameDayUrgency;
            callContext.urgency.reason = detectedRisk
              ? `${detectedRisk} risk reported`
              : 'same-day service requested';
          }
        }
      }

      // Update captured reason if available
      if (capturedReason && !callContext.intent.primary) {
        callContext.intent.primary = capturedReason;
        callContext.intent.source = 'scrabengine_reason_capture';
      }

      // Persist to state
      nextState.agent2.callContext = callContext;

      emit('CALL_CONTEXT_UPDATED', {
        turn,
        callerName: callContext.caller.firstName,
        callerNameSpeakable: callContext.caller.speakable,
        issueSummary: callContext.issue.summary,
        urgencyLevel: callContext.urgency.level,
        sameDayRequested: callContext.urgency.sameDayRequested,
        intent: callContext.intent.primary
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GREETING INTERCEPTOR (V125 - NOW RUNS ON CLEANED TEXT)
    // ══════════════════════════════════════════════════════════════════════════
    // ✅ V125 FIX: Moved AFTER ScrabEngine to receive cleaned text
    // 
    // CRITICAL IMPROVEMENT:
    // - Now checks CLEANED text (after filler removal)
    // - "Hi I need emergency" → sees "need emergency" (no greeting match)
    // - Fewer false positives, better intent detection
    // 
    // Handles short greetings like "hi", "good morning" with strict gating.
    // SHORT-ONLY GATE: Only fires if input ≤ maxWordsToQualify AND no intent words.
    // ONE-SHOT GUARD (V124): Once greeted, never re-greet on subsequent turns.
    // 
    // NOTE: Early return REMOVED - now continues to trigger matching even if greeting detected
    // This allows combined greeting+intent: "Hi I have emergency" → triggers still fire
    // ══════════════════════════════════════════════════════════════════════════
    const greetingsConfig = safeObj(agent2.greetings, {});
    const greetingResult = Agent2GreetingInterceptor.evaluate({
      input: normalizedInput,  // ✅ V125: Use CLEANED text from ScrabEngine
      config: greetingsConfig,
      turn: typeof turn === 'number' ? turn : 0,
      state: nextState,  // V124: Pass state for one-shot guard check
      callerName: callerName || null  // V126: Pass name for {name} replacement in greeting responses
    });

    // Always emit greeting evaluation proof
    emit('A2_GREETING_EVALUATED', greetingResult.proof);

    // ✅ V125: NO MORE EARLY RETURN - greeting detection is now informational only
    // Store greeting detection result for potential use in response prioritization
    let greetingDetected = false;
    let greetingResponse = null;
    let greetingAudioUrl = null;
    
    if (greetingResult.intercepted) {
      greetingDetected = true;
      greetingResponse = greetingResult.response;
      greetingAudioUrl = greetingResult.responseSource === 'audio' ? greetingResult.response : null;
      
      // Store in state but don't exit - continue to trigger matching
      nextState.agent2.discovery.greetingDetected = true;
      nextState.agent2.discovery.lastGreetingRuleId = greetingResult.proof.matchedRuleId;
      
      // V124: Apply state update (sets greeted=true for one-shot guard)
      if (greetingResult.stateUpdate) {
        nextState.agent2 = { ...nextState.agent2, ...greetingResult.stateUpdate };
      }

      emit('A2_PATH_SELECTED', {
        path: 'GREETING_DETECTED_CONTINUE',
        reason: `Matched greeting rule: ${greetingResult.proof.matchedRuleId} (continuing to triggers)`,
        matchedTrigger: greetingResult.proof.matchedTrigger,
        responseSource: greetingResult.responseSource
      });

      logger.info('[Greeting] Greeting detected but continuing to trigger matching', {
        greetingRule: greetingResult.proof.matchedRuleId,
        cleanedInput: normalizedInput.substring(0, 80)
      });
      
      // ✅ Continue to trigger matching instead of returning early
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
    // Allow ±1 turn tolerance: bridge ghost turns (actionOnEmptyResult) increment
    // the counter without real caller speech, so pendingQuestionTurn may be turn-2
    const isRespondingToPending = hasPendingQuestion && (turn - pendingQuestionTurn) >= 1 && (turn - pendingQuestionTurn) <= 2;

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

    // Ghost turn guard: if pending question is active but input is empty
    // (bridge timeout Gather with actionOnEmptyResult:true), bump turn forward
    // to preserve the pending question for the next real caller turn.
    if (isRespondingToPending && (input || '').trim().length === 0) {
      nextState.agent2.discovery.pendingQuestionTurn = turn;
      emit('PQ_GHOST_TURN_SKIPPED', {
        reason: 'Empty input (bridge ghost turn) — preserving pending question for next real turn',
        question: clip(pendingQuestion, 60),
        pendingQuestionTurn,
        currentTurn: turn
      });
    } else if (isRespondingToPending) {
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
        
        const { ack: personalAck } = buildAck(ack);

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
          usedCallerName: false,
          wasBlocked: yesValidation.blocked
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta('PENDING_YES') };
      }

      if (isNo) {
        // ══════════════════════════════════════════════════════════════════════
        // PATH: PENDING_QUESTION_NO — User declined
        // ══════════════════════════════════════════════════════════════════════
        nextState.agent2.discovery.pendingQuestion = null;
        nextState.agent2.discovery.pendingQuestionTurn = null;
        nextState.agent2.discovery.pendingQuestionResolved = true;
        nextState.agent2.discovery.lastPath = 'PENDING_NO';
        
        const { ack: personalAck } = buildAck(ack);

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
          usedCallerName: false,
          wasBlocked: noValidation.blocked
        });
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta('PENDING_NO') };
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
        
        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta('PENDING_REPROMPT') };
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

      return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState, audioUrl: audioUrl || null, _123rp: build123rpMeta('ROBOT_CHALLENGE') };
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
          state: nextState,
          _123rp: build123rpMeta('LLM_HANDOFF_CONFIRMED')
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
          state: nextState,
          _123rp: build123rpMeta('LLM_HANDOFF_DECLINED')
        };
      }
      // If neither YES nor NO, clear pending and fall through to normal processing
      // (Caller might have asked a different question)
      nextState.agent2.discovery.llmHandoffPending = null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PATIENCE MODE — "Hold on" / "wait" detection (BEFORE trigger matching)
    // Uses UI-configured phrases from patienceSettings. Separate from triggers.
    // ══════════════════════════════════════════════════════════════════════════
    const patienceConfig = safeObj(discoveryCfg?.patienceSettings, {});
    const patienceEnabled = patienceConfig.enabled !== false;
    const patiencePhrases = safeArr(patienceConfig.phrases).map(p => `${p}`.toLowerCase().trim()).filter(Boolean);

    if (patienceEnabled && patiencePhrases.length > 0 && inputLower.length <= 80) {
      const isPatienceMatch = patiencePhrases.some(phrase => {
        if (phrase.includes(' ')) return inputLower.includes(phrase);
        return inputLower.split(/\s+/).includes(phrase);
      });

      if (isPatienceMatch) {
        const patienceResponse = `${patienceConfig.initialResponse || ''}`.trim()
          || "Take your time — I'm right here whenever you're ready.";

        nextState.agent2.discovery.patienceMode = true;
        nextState.agent2.discovery.patienceModeTurn = typeof turn === 'number' ? turn : null;
        nextState.agent2.discovery.patienceCheckinCount = 0;
        nextState.agent2.discovery.lastPath = 'PATIENCE_MODE';

        emit('A2_PATH_SELECTED', {
          path: 'PATIENCE_MODE',
          reason: `Caller requested hold/wait`,
          matchedPhrase: patiencePhrases.find(p => inputLower.includes(p)),
          inputPreview: clip(input, 60)
        });
        emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
          'agent2.discovery.patienceSettings',
          'aiAgentSettings.agent2.discovery.patienceSettings.initialResponse',
          patienceResponse,
          null,
          'Patience mode activated: caller asked to hold/wait'
        ));

        return {
          response: patienceResponse,
          matchSource: 'AGENT2_DISCOVERY',
          state: nextState,
          patienceMode: true,
          _123rp: build123rpMeta('PATIENCE_MODE')
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 🧭 AGENT2CALLROUTER — TOP-LEVEL INTENT GATE (5-BUCKET CLASSIFIER)
    // ══════════════════════════════════════════════════════════════════════════
    // Classifies caller intent into one of 5 business buckets BEFORE trigger scan.
    // Runs on ScrabEngine-normalized text. Zero API calls, < 5ms.
    //
    // Phase 1 (current): ADVISORY ONLY — emits events, no filtering yet.
    //   callRouterResult stored in state and passed to TriggerCardMatcher.
    // Phase 2 (next):    ACTIVE — when confidence >= filterThreshold, TriggerCardMatcher
    //   pre-filters to bucket-matching cards only (200+ cards → ~15-30).
    //
    // Buckets: booking_service | billing_payment | membership_plan |
    //          existing_appointment | other_operator
    //
    // UI config: company.aiAgentSettings.agent2.discovery.callRouter
    // ══════════════════════════════════════════════════════════════════════════
    const callRouterConfig = safeObj(discoveryCfg.callRouter, {});
    const callRouterEnabled = callRouterConfig.enabled !== false;
    let callRouterResult = null;

    if (callRouterEnabled) {
      // Pass multi-turn prior for context-aware classification
      const priorBucket     = nextState.agent2.discovery?.lastCallBucket     || null;
      const priorConfidence = nextState.agent2.discovery?.lastCallConfidence  || 0;

      callRouterResult = Agent2CallRouter.classify(
        normalizedInput,
        callRouterConfig,
        { turn, priorBucket, priorConfidence }
      );

      // Persist bucket in call state for multi-turn awareness
      nextState.agent2.discovery.lastCallBucket     = callRouterResult.bucket;
      nextState.agent2.discovery.lastCallConfidence = callRouterResult.confidence;

      // Emit classification event — visible in Call Console transcript
      emit('A2_CALL_ROUTER_CLASSIFIED', {
        bucket:         callRouterResult.bucket,
        subBucket:      callRouterResult.subBucket,
        confidence:     callRouterResult.confidence,
        tier:           callRouterResult.tier,
        matchedAnchor:  callRouterResult.matchedAnchor,
        shouldFilter:   callRouterResult.shouldFilter,
        turn,
        inputPreview:   clip(normalizedInput, 60),
        scores: Object.fromEntries(
          Object.entries(callRouterResult.scores || {}).map(([k, v]) => [k, v.total])
        )
      });

      logger.info('[Agent2CallRouter] 🧭 Intent classified', {
        bucket:     callRouterResult.bucket,
        subBucket:  callRouterResult.subBucket,
        confidence: callRouterResult.confidence,
        tier:       callRouterResult.tier,
        anchor:     callRouterResult.matchedAnchor || null,
        turn,
        companyId
      });
    }

    // ──────────────────────────────────────────────────────────────────────
    // PATH 2: TRIGGER CARD MATCHING (PRIMARY — DETERMINISTIC)
    // ──────────────────────────────────────────────────────────────────────
    // Uses TriggerService to load the full trigger pool (global + local),
    // falling back to legacy playbook.rules when no global group is active.
    // V4: Intent Priority Gate config controls FAQ card disqualification
    // ──────────────────────────────────────────────────────────────────────
    const activeHints = nextState.agent2.hints || [];
    const activeLocks = nextState.agent2.locks || {};
    const intentGateConfig = discoveryCfg.intentGate || {};
    const globalNegativeKeywords = agent2.globalNegativeKeywords || [];

    const matchOptions = {
      hints: activeHints,
      locks: activeLocks,
      intentGateConfig,
      globalNegativeKeywords,
      expandedTokens: expandedTokens,
      originalTokens: originalTokens,
      expansionMap: expansionMap,
      callRouterResult: callRouterResult  // Pass router result to matcher
    };

    // ──────────────────────────────────────────────────────────────────────────
    // TRIGGER LOADING via TriggerService (global + local + legacy fallback)
    // Loads from GlobalTrigger + CompanyLocalTrigger when a global group is
    // active for this company, falling back to playbook.rules otherwise.
    // Single load, used for both matching and pool stats.
    // ──────────────────────────────────────────────────────────────────────────
    let triggerCards = await TriggerCardMatcher.getCompiledTriggers(companyId, agent2);

    // ═══════════════════════════════════════════════════════════════════════════
    // STRICT TRIGGER SYSTEM - VISIBILITY EVENTS (V131)
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Extract load metadata from trigger array (attached by TriggerService)
    const loadMetadata = triggerCards._loadMetadata || { strictMode: true, legacyUsed: false };
    
    // ── CRITICAL: Emit LEGACY_FALLBACK_USED if legacy was loaded ──
    if (loadMetadata.legacyUsed) {
      emit('LEGACY_FALLBACK_USED', {
        companyId,
        callSid,
        turn,
        legacyCardCount: loadMetadata.legacyCardCount,
        source: loadMetadata.source,
        strictMode: false,
        severity: 'WARNING',
        message: 'Legacy playbook.rules loaded — modern trigger system bypassed',
        remediation: 'Admin → Triggers → Enable Strict Mode to disable legacy fallback'
      });
      logger.warn('[Agent2] ⚠️ LEGACY_FALLBACK_USED — playbook.rules active', {
        companyId,
        callSid,
        turn,
        legacyCardCount: loadMetadata.legacyCardCount
      });
    }
    
    // ── VISIBILITY: TRIGGER_POOL_SOURCE — show exactly where triggers came from ──
    if (triggerCards.length > 0) {
      const scopes = {};
      const ruleIdsByScope = { GLOBAL: [], LOCAL: [], LEGACY: [], UNKNOWN: [] };
      
      triggerCards.forEach(c => { 
        const s = c._scope || 'UNKNOWN'; 
        scopes[s] = (scopes[s] || 0) + 1;
        
        // Track actual ruleIds by scope for forensics
        const ruleId = c.ruleId || c.id || c.triggerId || 'NO_ID';
        if (ruleIdsByScope[s]) {
          ruleIdsByScope[s].push(ruleId);
        } else {
          ruleIdsByScope.UNKNOWN.push(ruleId);
        }
      });
      
      const hasLegacy = triggerCards.some(c => c._scope === 'LEGACY');
      const hasUnknown = triggerCards.some(c => !c._scope || c._scope === 'UNKNOWN');
      
      emit('TRIGGER_POOL_SOURCE', {
        total: triggerCards.length,
        scopes,
        ruleIdsByScope,  // FORENSIC: Expose exact IDs by scope
        hasLegacyCards: hasLegacy,
        hasUnknownScope: hasUnknown,
        strictMode: loadMetadata.strictMode,
        source: loadMetadata.source,
        activeGroupId: loadMetadata.activeGroupId || null,  // CRITICAL: Show if group is assigned
        isGroupPublished: loadMetadata.isGroupPublished || false,
        warning: hasLegacy ? 'Legacy playbook.rules cards in pool. Click "Clear Legacy" in Triggers admin.' : 
                 hasUnknown ? 'UNKNOWN scope triggers detected — investigate trigger source immediately' : null,
        turn
      });
      
      if (hasLegacy) {
        logger.warn('[Agent2] ⚠️ Legacy trigger cards still in pool', { 
          legacyCount: scopes['LEGACY'] || 0, 
          legacyIds: ruleIdsByScope.LEGACY,
          companyId, 
          turn 
        });
      }
      
      if (hasUnknown) {
        logger.error('[Agent2] 🚨 UNKNOWN scope triggers in pool - DATA INTEGRITY ISSUE', {
          unknownCount: scopes['UNKNOWN'] || 0,
          unknownIds: ruleIdsByScope.UNKNOWN,
          companyId,
          turn,
          action: 'INVESTIGATE_TRIGGER_SOURCE'
        });
      }
    }

    // ── APPLY COMPANY BUCKET CLASSIFICATION ───────────────────────────────────
    // Classify caller intent into company-defined buckets, then optionally
    // pre-filter the trigger pool to matching bucket + untagged cards.
    let bucketFilteredPool = null; // for safety retry
    let bucketClassifierResult = null;
    try {
      bucketClassifierResult = await TriggerBucketClassifier.classify({
        companyId,
        normalizedText: normalizedInput,
        expandedTokens,
        originalTokens
      });

      nextState.agent2.discovery.bucketClassifier = {
        bucket: bucketClassifierResult.bucket || null,
        confidence: bucketClassifierResult.confidence || 0,
        reason: bucketClassifierResult.reason || null,
        bucketCount: bucketClassifierResult.bucketCount || 0,
        candidateCount: (bucketClassifierResult.candidates || []).length
      };

      if (bucketClassifierResult.bucket) {
        emit('A2_BUCKET_CLASSIFIED', {
          bucket: bucketClassifierResult.bucket,
          confidence: bucketClassifierResult.confidence,
          matchedKeywords: bucketClassifierResult.matchedKeywords || [],
          bucketCount: bucketClassifierResult.bucketCount || 0,
          candidateCount: (bucketClassifierResult.candidates || []).length,
          turn
        });

        const poolResult = TriggerBucketClassifier.applyToTriggerPool(triggerCards, bucketClassifierResult);
        if (poolResult.filtered && poolResult.filteredCards.length > 0) {
          bucketFilteredPool = triggerCards; // save full pool for retry
          triggerCards = poolResult.filteredCards;
          emit('A2_BUCKET_POOL_FILTERED', {
            bucket: bucketClassifierResult.bucket,
            confidence: bucketClassifierResult.confidence,
            beforeFilter: poolResult.totalCards,
            afterFilter: poolResult.filteredCards.length,
            excluded: poolResult.excludedCount,
            safetyRule: 'zero-match retry with full pool active',
            turn
          });
          logger.info('[TriggerBucketClassifier] 🗂️ Trigger pool filtered', {
            bucket: bucketClassifierResult.bucket,
            before: poolResult.totalCards,
            after: poolResult.filteredCards.length,
            excluded: poolResult.excludedCount,
            companyId
          });
        } else if (poolResult.filtered && poolResult.filteredCards.length === 0) {
          logger.warn('[TriggerBucketClassifier] ⚠️ Filtered pool empty — using full pool', {
            bucket: bucketClassifierResult.bucket,
            totalCards: poolResult.totalCards,
            companyId
          });
        }
      }
    } catch (error) {
      logger.warn('[TriggerBucketClassifier] Classification failed — skipping bucket filtering', {
        companyId,
        error: error.message
      });
    }

    // ── APPLY CALL ROUTER POOL FILTERING ─────────────────────────────────────
    // When Agent2CallRouter classifies with confidence >= filterThreshold (0.70),
    // pre-filter the card pool to bucket-matching cards.
    // Untagged cards (bucket: null) always pass through regardless of bucket.
    //
    // THREE SAFETY RULES (all enforced here):
    // 1. ADVISORY BY DEFAULT: only filter if callRouter.filteringEnabled === true
    // 2. UNTAGGED ALWAYS INCLUDED: applyToTriggerPool always includes bucket:null cards
    // 3. ZERO-MATCH RETRY: if filtered pool produces 0 matches → retry with full pool
    //    This prevents mixed-intent calls ("charged AND AC broken") from missing triggers
    //    when CallRouter picks one bucket and the other intent's triggers are filtered out.
    let callRouterFilteredPool = null; // track for retry logic
    if (callRouterResult && callRouterEnabled) {
      const filteringEnabled = callRouterConfig.filteringEnabled === true;
      if (filteringEnabled) {
        const poolResult = Agent2CallRouter.applyToTriggerPool(triggerCards, callRouterResult);
        if (poolResult.filtered && poolResult.filteredCards.length > 0) {
          callRouterFilteredPool = triggerCards; // save full pool for zero-match retry
          triggerCards = poolResult.filteredCards;
          emit('A2_CALL_ROUTER_POOL_FILTERED', {
            bucket:        callRouterResult.bucket,
            confidence:    callRouterResult.confidence,
            beforeFilter:  poolResult.totalCards,
            afterFilter:   poolResult.filteredCards.length,
            excluded:      poolResult.filteredCount,
            safetyRule2:   'untagged cards included regardless of bucket',
            safetyRule3:   'zero-match retry with full pool active',
            turn
          });
          logger.info('[Agent2CallRouter] 🗂️ Trigger pool filtered', {
            bucket:   callRouterResult.bucket,
            before:   poolResult.totalCards,
            after:    poolResult.filteredCards.length,
            excluded: poolResult.filteredCount,
            companyId
          });
        } else if (poolResult.filtered && poolResult.filteredCards.length === 0) {
          // Filtered pool is completely empty — skip filtering, use full pool
          logger.warn('[Agent2CallRouter] ⚠️ Filtered pool empty — using full pool (safety rule 3 pre-check)', {
            bucket: callRouterResult.bucket, totalCards: poolResult.totalCards, companyId
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRICT TRIGGER SYSTEM - EMPTY POOL WARNING (V131)
    // This event surfaces in Call Console transcript so admins can see EXACTLY
    // why every turn falls through to LLM. Previously this failed silently.
    // ═══════════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════════
    // DATABASE CONNECTION & TRIGGER LOADING REPORT
    // Shows EXACTLY what database we're connected to and what triggers we got
    // ═══════════════════════════════════════════════════════════════════════════
    const mongoose = require('mongoose');
    emit('DATABASE_CONNECTION_INFO', {
      mongoDbName: mongoose.connection.name,
      mongoHost: mongoose.connection.host,
      mongoReadyState: mongoose.connection.readyState,
      readyStateText: mongoose.connection.readyState === 1 ? 'connected' : 
                      mongoose.connection.readyState === 0 ? 'disconnected' : 'connecting',
      companyId,
      callSid,
      turn
    });

    emit('TRIGGER_LOADING_REPORT', {
      totalTriggersLoaded: triggerCards.length,
      loadSource: loadMetadata.source,
      strictMode: loadMetadata.strictMode,
      activeGroupId: loadMetadata.activeGroupId,
      isGroupPublished: loadMetadata.isGroupPublished,
      globalSkippedReason: loadMetadata.globalSkippedReason,
      companyId,
      callSid,
      turn,
      sampleTriggers: triggerCards.slice(0, 3).map(t => ({
        ruleId: t.ruleId,
        label: t.label,
        scope: t._scope,
        keywords: (t.match?.keywords || []).slice(0, 5)
      }))
    });

    if (triggerCards.length === 0) {
      const isStrictEmpty = loadMetadata.source === 'EMPTY_STRICT';
      
      // Enhanced diagnostic information
      emit('TRIGGER_POOL_EMPTY', {
        companyId,
        callSid,
        turn,
        strictMode: loadMetadata.strictMode,
        source: loadMetadata.source,
        severity: 'CRITICAL',
        
        // DATABASE INFO
        mongoDbName: mongoose.connection.name,
        mongoHost: mongoose.connection.host,
        
        // LOADING DETAILS
        activeGroupId: loadMetadata.activeGroupId,
        isGroupPublished: loadMetadata.isGroupPublished,
        globalSkippedReason: loadMetadata.globalSkippedReason,
        
        // USER-FRIENDLY MESSAGE
        message: isStrictEmpty 
          ? 'STRICT MODE: No triggers loaded — legacy fallback blocked' 
          : 'No trigger cards loaded — all turns will fall through to LLM fallback',
        
        // SPECIFIC DIAGNOSTICS
        possibleCauses: [
          !loadMetadata.activeGroupId ? '❌ No global trigger group assigned to company' : null,
          loadMetadata.activeGroupId && !loadMetadata.isGroupPublished ? '❌ Global trigger group not published' : null,
          mongoose.connection.name === 'test' ? '❌ CRITICAL: Connected to "test" database instead of production' : null,
          'Check local triggers: enabled=true, isDeleted=false, state=published',
          'Verify companyId matches between call routing and database query'
        ].filter(Boolean),
        
        action: isStrictEmpty
          ? 'Create local triggers OR assign a global trigger group. Legacy is disabled in strict mode.'
          : 'Go to Admin → Triggers → Verify group is assigned and published, then click Refresh Cache'
      });
      
      logger.warn('[Agent2] ⚠️ TRIGGER_POOL_EMPTY — no cards to evaluate', {
        companyId, callSid, turn, mongoDbName: mongoose.connection.name
      });
    }

    let triggerResult = TriggerCardMatcher.match(normalizedInput, triggerCards, matchOptions);
    let cardPoolStats = TriggerCardMatcher.getPoolStats(triggerCards);

    // ── SAFETY RULE 3: ZERO-MATCH RETRY WITH FULL POOL ────────────────────────
    // If pool filtering was active and produced no match, retry with the complete
    // unfiltered pool. This handles mixed-intent calls where CallRouter picked the
    // wrong bucket (e.g., "I got charged AND my AC isn't cooling" classified as
    // billing_payment → AC triggers filtered out → retry fires AC trigger).
    if (!triggerResult.matched && callRouterFilteredPool && callRouterFilteredPool.length > 0) {
      logger.info('[Agent2CallRouter] 🔄 ZERO-MATCH RETRY: filtered pool had no match — retrying with full pool', {
        bucket:          callRouterResult?.bucket,
        filteredPoolSize: triggerCards.length,
        fullPoolSize:    callRouterFilteredPool.length,
        companyId,
        callSid,
        turn
      });

      const retryResult = TriggerCardMatcher.match(normalizedInput, callRouterFilteredPool, matchOptions);

      emit('A2_CALL_ROUTER_RETRY_FULL_POOL', {
        bucket:          callRouterResult?.bucket,
        confidence:      callRouterResult?.confidence,
        filteredPoolSize: triggerCards.length,
        fullPoolSize:    callRouterFilteredPool.length,
        retryMatched:    retryResult.matched,
        retryCardId:     retryResult.cardId,
        retryCardLabel:  retryResult.cardLabel,
        turn,
        note: 'Safety Rule 3: filtered pool had no match — expanded to full pool'
      });

      if (retryResult.matched) {
        // Retry succeeded — use the full-pool result
        triggerResult = retryResult;
        cardPoolStats  = TriggerCardMatcher.getPoolStats(callRouterFilteredPool);
        logger.info('[Agent2CallRouter] ✅ RETRY SUCCEEDED — full pool match found', {
          cardId: retryResult.cardId, cardLabel: retryResult.cardLabel, companyId, turn
        });
      }
      // Whether retry matched or not, clear the saved pool — don't retry twice
      callRouterFilteredPool = null;
    }

    // ── SAFETY: BUCKET ZERO-MATCH RETRY WITH FULL POOL ────────────────────────
    if (!triggerResult.matched && bucketFilteredPool && bucketFilteredPool.length > 0) {
      logger.info('[TriggerBucketClassifier] 🔄 ZERO-MATCH RETRY: bucket pool had no match — retrying with full pool', {
        bucket: bucketClassifierResult?.bucket,
        filteredPoolSize: triggerCards.length,
        fullPoolSize: bucketFilteredPool.length,
        companyId,
        callSid,
        turn
      });

      const retryResult = TriggerCardMatcher.match(normalizedInput, bucketFilteredPool, matchOptions);

      emit('A2_BUCKET_RETRY_FULL_POOL', {
        bucket: bucketClassifierResult?.bucket,
        confidence: bucketClassifierResult?.confidence,
        filteredPoolSize: triggerCards.length,
        fullPoolSize: bucketFilteredPool.length,
        retryMatched: retryResult.matched,
        retryCardId: retryResult.cardId,
        retryCardLabel: retryResult.cardLabel,
        turn,
        note: 'Bucket filter had no match — expanded to full pool'
      });

      if (retryResult.matched) {
        triggerResult = retryResult;
        cardPoolStats = TriggerCardMatcher.getPoolStats(bucketFilteredPool);
        logger.info('[TriggerBucketClassifier] ✅ RETRY SUCCEEDED — full pool match found', {
          cardId: retryResult.cardId,
          cardLabel: retryResult.cardLabel,
          companyId,
          turn
        });
      }
      bucketFilteredPool = null;
    }
    
    // Store intent gate result for empathy layer (V4)
    if (triggerResult.intentGateResult) {
      nextState.agent2.discovery.lastIntentGateResult = triggerResult.intentGateResult;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TRIGGER MATCHING EXPECTATIONS vs REALITY
    // Shows what triggers NEED vs what they HAVE
    // ═══════════════════════════════════════════════════════════════════════════
    emit('TRIGGER_MATCHING_ANALYSIS', {
      // WHAT WE HAVE (Input from ScrabEngine)
      inputProvided: {
        normalizedText: normalizedInput,
        expandedTokenCount: expandedTokens.length,
        sampleTokens: expandedTokens.slice(0, 10)
      },
      
      // WHAT WE NEED (Triggers available to match against)
      triggersAvailable: {
        totalCount: triggerCards.length,
        enabledCount: cardPoolStats.enabled,
        disabledCount: cardPoolStats.disabled,
        scopes: {
          global: triggerCards.filter(t => t._scope === 'GLOBAL').length,
          local: triggerCards.filter(t => t._scope === 'LOCAL').length
        },
        sampleTriggerKeywords: triggerCards.slice(0, 3).map(t => ({
          label: t.label,
          keywords: t.match?.keywords || [],
          phrases: t.match?.phrases || []
        }))
      },
      
      // MATCHING ATTEMPT RESULT
      matchingResult: {
        matched: triggerResult.matched,
        matchType: triggerResult.matchType,
        matchedOn: triggerResult.matchedOn,
        cardLabel: triggerResult.cardLabel,
        candidatesEvaluated: triggerResult.totalCards,
        blockedByNegatives: triggerResult.negativeBlocked
      },
      
      // DIAGNOSIS
      diagnosis: triggerCards.length === 0 
        ? '❌ NO TRIGGERS AVAILABLE - Cannot match with empty pool'
        : !triggerResult.matched
        ? '⚠️ TRIGGERS AVAILABLE BUT NO MATCH - Input tokens did not match any trigger keywords'
        : '✅ MATCH SUCCESSFUL',
      
      turn,
      callSid
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
      negativePhraseBlocked: triggerResult.negativePhraseBlocked || 0,
      maxWordsBlocked: triggerResult.maxWordsBlocked || 0,
      // Call Router context
      callRouter: callRouterResult ? {
        bucket:     callRouterResult.bucket,
        subBucket:  callRouterResult.subBucket,
        confidence: callRouterResult.confidence,
        tier:       callRouterResult.tier,
        filtered:   callRouterConfig.filteringEnabled === true && callRouterResult.shouldFilter
      } : null,
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

    // ══════════════════════════════════════════════════════════════════════════
    // 123RP TIER 1: DETERMINISTIC MATCH (Trigger Card)
    // ══════════════════════════════════════════════════════════════════════════
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

      const { ack: personalAck } = buildAck(ack);

      // Update state
      nextState.agent2.discovery.lastPath = isLLMTrigger ? 'TRIGGER_CARD_LLM' : 'TRIGGER_CARD_ANSWER';
      nextState.agent2.discovery.lastTriggerId = card.id || null;
      nextState.agent2.discovery.lastTriggerLabel = card.label || null;
      nextState.agent2.discovery.lastNextAction = nextAction;
      
      // Track follow-up question for consent gate or generic pending question.
      // If trigger card has its OWN follow-up → dedicated pendingFollowUpQuestion (7-bucket system).
      // If only the company-level default afterAnswer → legacy pendingQuestion system.
      if (followUpQuestion) {
        nextState.agent2.discovery.pendingFollowUpQuestion = followUpQuestion;
        nextState.agent2.discovery.pendingFollowUpQuestionTurn = typeof turn === 'number' ? turn : null;
        nextState.agent2.discovery.pendingFollowUpQuestionSource = `card:${card.id}`;
        // DEPRECATED: kept for call review tools; consent card direction is source of truth
        nextState.agent2.discovery.pendingFollowUpQuestionNextAction = nextAction;
        nextState.agent2.discovery.followUpContinuationCount = 0;
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
          _123rpTier: RESPONSE_TIER.TIER_1,
          _123rpLabel: 'DETERMINISTIC',
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
          usedCallerName: false,
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
          },
          // TURN_TRACE_SUMMARY metadata
          _triggerPoolCount: triggerCards?.length ?? null,
          _exitReason: null,
          _fallbackUsed: null,
          _123rp: build123rpMeta('TRIGGER_CARD_LLM'),
          uiPath: `aiAgentSettings.agent2.discovery.playbook.rules[id=${card.id}].llmFactPack`
        };
      }

      // ════════════════════════════════════════════════════════════════════════
      // STANDARD TRIGGER PATH: Use static answerText and/or audio
      // ════════════════════════════════════════════════════════════════════════
      
      // Build response - V126: No hardcoded text allowed
      // If answerText contains {name}, skip buildAck name insertion to prevent
      // double-naming (buildAck says "Ok, Marc." + answerText says "Got it, Marc.")
      const textHasNameVar = answerText && /\{name\}/i.test(answerText);
      const ackToUse = textHasNameVar ? ack : personalAck;
      
      let response;
      if (answerText) {
        response = afterQuestion
          ? `${ackToUse} ${answerText} ${afterQuestion}`.trim()
          : `${ackToUse} ${answerText}`.trim();
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
        _123rpTier: RESPONSE_TIER.TIER_1,
        _123rpLabel: 'DETERMINISTIC',
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
        usedCallerName: false,
        nextAction
      });

      // Substitute trigger card variables in response text
      // Static: {diagnosticfee} → "80 dollars"  |  Runtime: {name} → ", Marc" or ""
      const callCtx = nextState.agent2?.callContext || null;
      const runtimeVars = {
        name: callerName || null,
        callerIssue: callCtx?.issue?.summary || null,
        callerSystem: callCtx?.issue?.system || null,
        callerLocation: callCtx?.issue?.location || null,
      };
      let finalResponse = await substituteTriggerVariables(response, companyId, runtimeVars);

      // V131: CONTEXT-AWARE CARD RESPONSE — if caller already explained the issue,
      // don't ask "what issue are you experiencing?" or "what's going on?"
      // Replace generic re-ask phrases with acknowledgment of known issue.
      if (callCtx?.issue?.summary) {
        const genericReaskPatterns = [
          /just let me know what issue you(?:'re| are) experiencing/gi,
          /what(?:'s| is) (?:the )?(?:issue|problem) you(?:'re| are) (?:experiencing|having)/gi,
          /can you tell me (?:more )?(?:about )?what(?:'s| is) (?:going on|happening)/gi,
          /what (?:seems to be|is) the (?:problem|issue|trouble)/gi,
          /what can (?:we|I) help you with/gi,
          /what do you need help with/gi,
        ];
        const issueSummary = callCtx.issue.summary;
        const urgencyNote = callCtx.urgency?.level === 'high'
          ? ` Since this seems urgent, I'll prioritize getting someone out quickly.`
          : '';
        const replacement = `I see you're dealing with a ${issueSummary}.${urgencyNote}`;

        for (const pattern of genericReaskPatterns) {
          if (pattern.test(finalResponse)) {
            finalResponse = finalResponse.replace(pattern, replacement);
            emit('A2_CARD_REASK_REPLACED', {
              cardId: card.id,
              issueSummary,
              urgencyLevel: callCtx.urgency?.level || 'normal',
              reason: 'Caller already explained issue — replaced generic re-ask with acknowledgment'
            });
            break;
          }
        }
      }

      if (finalResponse !== response) {
        emit('A2_TRIGGER_VARIABLES_SUBSTITUTED', {
          cardId: card.id,
          originalLength: response.length,
          finalLength: finalResponse.length,
          hadPlaceholders: true
        });
      }

      // V131: Track what questions the agent asked (for call context)
      if (afterQuestion && callCtx) {
        callCtx.questionsAsked.push(afterQuestion.substring(0, 100));
        nextState.agent2.callContext = callCtx;
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
        },
        // TURN_TRACE_SUMMARY metadata
        _triggerPoolCount: triggerCards?.length ?? null,
        _exitReason: null,
        _fallbackUsed: null,
        _123rp: build123rpMeta('TRIGGER_CARD_ANSWER'),
        uiPath: `aiAgentSettings.agent2.discovery.playbook.rules[id=${card.id}]`
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
            const { ack: personalAck } = buildAck(ack);

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
              usedCallerName: false
            });
            
            return {
              response,
              matchSource: 'AGENT2_DISCOVERY',
              state: nextState,
              _123rp: build123rpMeta('CLARIFIER_ASKED'),
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

    const { ack: personalAck } = buildAck(ack);

    // Declared at response-composition scope so T3 state contract (line ~3476)
    // can safely read T2 failure reason regardless of which branch executed.
    let llmAgentResult = null;

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
        usedCallerName: false
      });
      
    } else {
      // ══════════════════════════════════════════════════════════════════════════
      // 123RP TIER 1: DETERMINISTIC MATCH (Greeting Response)
      // ══════════════════════════════════════════════════════════════════════════
      // If greeting was detected earlier AND no trigger matched, use greeting response.
      // This handles pure greetings like "hi" or "hello" without business intent.
      // ══════════════════════════════════════════════════════════════════════════
      if (greetingDetected && greetingResponse) {
        nextState.agent2.discovery.lastPath = 'GREETING_ONLY';
        
        emit('A2_PATH_SELECTED', {
          path: 'GREETING_ONLY',
          reason: 'Greeting detected, no trigger matched, using greeting response',
          _123rpTier: RESPONSE_TIER.TIER_1,
          _123rpLabel: 'DETERMINISTIC',
          greetingRuleId: nextState.agent2.discovery.lastGreetingRuleId
        });
        
        const finalGreetingAudioUrl = greetingAudioUrl;
        emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
          `agent2.greetings.interceptor.rules[${greetingResult.ruleIndex || 0}]`,
          'aiAgentSettings.agent2.greetings.interceptor.rules',
          greetingResponse,
          finalGreetingAudioUrl,
          `Greeting-only response (no trigger matched)`
        ));
        
        emit('A2_RESPONSE_READY', {
          path: 'GREETING_ONLY',
          responsePreview: clip(greetingResponse, 120),
          responseLength: greetingResponse?.length || 0,
          hasAudio: !!finalGreetingAudioUrl,
          audioUrl: finalGreetingAudioUrl,
          source: `greeting:${nextState.agent2.discovery.lastGreetingRuleId}`
        });

        logger.info('[Greeting] Using greeting response (no trigger matched)', {
          greetingRule: nextState.agent2.discovery.lastGreetingRuleId,
          hasAudio: !!finalGreetingAudioUrl
        });

        // Return greeting response
        if (greetingAudioUrl) {
          return {
            response: null,
            matchSource: 'AGENT2_DISCOVERY',
            state: nextState,
            audioUrl: greetingAudioUrl,
            _123rp: build123rpMeta('GREETING_ONLY'),
          };
        }

        return {
          response: greetingResponse,
          matchSource: 'AGENT2_DISCOVERY',
          state: nextState,
          _123rp: build123rpMeta('GREETING_ONLY'),
        };
      }
      
      // ══════════════════════════════════════════════════════════════════════════
      // 123RP TIER 2: LLM AGENT (Claude — Per-Company Config)
      // ══════════════════════════════════════════════════════════════════════════
      // When no trigger matches, the LLM Agent (Claude) steps in for ONE turn.
      // This is TIER 2 intelligence — NOT a fallback. It is the AI handling
      // the conversation when deterministic matching cannot.
      // After responding, control returns to normal discovery pipeline.
      // The agent does NOT persist — triggers are tried again on the next turn.

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
      
      // ────────────────────────────────────────────────────────────────
      // 123RP TIER 2: LLM Agent — Primary no-match intelligence
      // ────────────────────────────────────────────────────────────────
      // The LLM Agent (Claude) steps in when no trigger card matches.
      // It responds ONE time, then control returns to normal discovery.
      // It does NOT persist — only fires again if NEXT turn also misses.
      // If disabled/failed → falls through to TIER 3 (Fallback).
      // ────────────────────────────────────────────────────────────────
      llmAgentResult = await callLLMAgentForNoMatch({
        company,
        input,
        capturedReason,
        channel: 'call',
        turn,
        emit,
        llmTurnsThisCall,
        callSid,
        bridgeToken,
        redis,
        t3RecoveryCtx,  // Package 4B: cross-turn recovery context
        callerName,     // Thread caller name so T2 can personalize response
        callContext: nextState.agent2?.callContext || null,
      });

      if (llmAgentResult?.response) {
        // LLM Agent handled this turn — set state and return
        nextState.agent2.discovery.lastPath = 'LLM_AGENT_NO_MATCH';
        nextState.agent2.discovery.llmTurnsThisCall = llmTurnsThisCall + 1;
        if (llmAgentResult.wasPartial) {
          nextState.agent2.discovery.lastResponseWasPartial = true;
        }

        const { ack: llmAck } = buildAck(ack);

        // Don't double-ack if LLM Agent response already sounds natural
        const agentStartsWithAck = /^(ok|okay|i'm sorry|i understand|that sounds|sure|absolutely|of course|i can help|i'd be happy)/i.test(llmAgentResult.response);
        response = agentStartsWithAck
          ? llmAgentResult.response
          : `${llmAck} ${llmAgentResult.response}`.trim();

        pathSelected = 'LLM_AGENT_NO_MATCH';
        pathReason = 'No trigger match — LLM Agent (Claude) handled the turn';

        emit('A2_PATH_SELECTED', {
          path: 'LLM_AGENT_NO_MATCH',
          reason: pathReason,
          _123rpTier: RESPONSE_TIER.TIER_2,
          _123rpLabel: 'LLM_AGENT',
          model: llmAgentResult.tokensUsed ? 'claude' : null,
          latencyMs: llmAgentResult.latencyMs,
          tokensInput: llmAgentResult.tokensUsed?.input,
          tokensOutput: llmAgentResult.tokensUsed?.output
        });
        emit('SPEECH_SOURCE_SELECTED', buildSpeechSourceEvent(
          'agent2.llmAgent.noMatch',
          null, // LLM Agent generates dynamic text — no static UI path
          response,
          null,
          '123RP Tier 2: LLM Agent (Claude) — AI intelligence response'
        ));
        emit('A2_RESPONSE_READY', {
          path: 'LLM_AGENT_NO_MATCH',
          responsePreview: clip(response, 120),
          responseLength: response.length,
          hasAudio: false,
          source: 'llmAgent.noMatch',
          usedCallerName: llmAgentResult.usedCallerName || false,
          isLLMAgent: true,
          latencyMs: llmAgentResult.latencyMs
        });

        return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState, _123rp: build123rpMeta('LLM_AGENT_NO_MATCH') };
      }

      // 123RP: Tier 2 didn't run (disabled) or failed — fall through to Tier 3 (Fallback)
      // This preserves existing behavior for companies without LLM Agent enabled
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 123RP STATE CONTRACT — Preserve context for T3
    // ══════════════════════════════════════════════════════════════════════════
    // When T2 fails or is disabled, T3 MUST have all captured context.
    // This contract ensures T3 never fires with amnesia.
    // ══════════════════════════════════════════════════════════════════════════
    const llmCfgRaw = company?.aiAgentSettings?.llmAgent || {};
    const llmEnabled = deepMergeLLMAgent(DEFAULT_LLM_AGENT_SETTINGS, llmCfgRaw)?.enabled === true;
    // Use specific failure reason from streaming service if available,
    // otherwise fall back to generic reason based on enabled state
    const t2FailureReason = llmAgentResult?.failureReason
      || (llmEnabled ? FALLBACK_REASON_CODE.T2_PROVIDER_ERROR : FALLBACK_REASON_CODE.T2_DISABLED);

    const t3Context = buildT3Context(state, scrabResult, callerName, t2FailureReason);
    nextState.agent2.discovery.t3Context = t3Context;

    const t3Validation = validateT3Context(t3Context);
    if (!t3Validation.valid) {
      emit('T3_STATE_CONTRACT_WARNING', {
        warnings: t3Validation.warnings,
        t2FailureReason,
        intent: t3Context.intent ? clip(t3Context.intent, 60) : null,
        callerName: t3Context.callerName || null,
        hasInput: !!t3Context.normalizedInput,
        tokenCount: t3Context.expandedTokens?.length || 0,
        turn
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 123RP TIER 3: FALLBACK (safety net when Tier 1 + Tier 2 cannot respond)
    // ══════════════════════════════════════════════════════════════════════════
    // These paths execute if we haven't returned yet (no trigger, no LLM success)

    // ── T3 Recovery Tracking (Package 3C) ───────────────────────────────────
    // Track consecutive T3 fires. If 3+ in a row, escalation is needed.
    const prevConsecutiveT3 = nextState.agent2?.discovery?.consecutiveT3Count || 0;
    const consecutiveT3Count = prevConsecutiveT3 + 1;
    nextState.agent2.discovery.consecutiveT3Count = consecutiveT3Count;
    nextState.agent2.discovery.t3RecoveryContext = {
      firedAt: turn,
      intent: t3Context?.intent || capturedReason || null,
      callerName: t3Context?.callerName || callerName || null,
      t2FailureReason: t3Context?.t2FailureReason || t2FailureReason || null,
      consecutiveT3Count,
    };

    if (consecutiveT3Count >= 3) {
      emit('T3_CONSECUTIVE_LIMIT', {
        count: consecutiveT3Count,
        turn,
        intent: t3Context?.intent ? clip(t3Context.intent, 60) : null,
        t2FailureReason: t3Context?.t2FailureReason || null,
      });
    }

    // ── T3 Reason Code Emission (Package 6B) ────────────────────────────────
    const t3OutcomeReason = capturedReason
      ? FALLBACK_REASON_CODE.T3_REASON_CAPTURED
      : FALLBACK_REASON_CODE.T3_NO_REASON;
    emit('A2_FALLBACK_REASON', {
      t2FailureReason: t3Context?.t2FailureReason || t2FailureReason || null,
      t3OutcomeReason,
      consecutiveT3Count,
      intent: t3Context?.intent ? clip(t3Context.intent, 60) : null,
      callerName: t3Context?.callerName || null,
      turn,
    });

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
        _123rpTier: RESPONSE_TIER.TIER_3,
        _123rpLabel: 'FALLBACK',
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
        usedCallerName: false,
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
        _123rpTier: RESPONSE_TIER.TIER_3,
        _123rpLabel: 'FALLBACK',
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
        usedCallerName: false,
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

    // 123RP: Determine response tier and fallback status for TURN_TRACE_SUMMARY
    const lastPath = nextState.agent2?.discovery?.lastPath || 'UNKNOWN';
    const _123rp = build123rpMeta(lastPath);

    // _fallbackUsed: Only set for TRUE Tier 3 fallbacks (backward compat).
    // LLM Agent is Tier 2 intelligence — NOT a fallback.
    let fallbackUsed = null;
    if (_123rp.tier === RESPONSE_TIER.TIER_3) {
      if (lastPath.includes('CAPTURED_REASON')) fallbackUsed = 'CAPTURED_REASON_ACK';
      else if (lastPath.includes('NO_MATCH')) fallbackUsed = 'GENERIC_FALLBACK';
    } else if (lastPath.includes('GREETING')) {
      fallbackUsed = 'GREETING';
    } else if (lastPath.includes('SCENARIO')) {
      fallbackUsed = 'SCENARIO_ENGINE';
    }
    
    return {
      response,
      matchSource: 'AGENT2_DISCOVERY',
      state: nextState,
      // TURN_TRACE_SUMMARY metadata
      _triggerPoolCount: typeof triggerCards !== 'undefined' ? triggerCards?.length : null,
      _exitReason: lastPath,
      _fallbackUsed: fallbackUsed,
      _123rp,
    };
  }

  /**
   * First-turn greeting decorator.
   *
   * Applies the Name Greeting (one-time opening line) as a universal
   * post-processor AFTER the core response is determined, regardless of
   * which path produced it (greeting interceptor, trigger, LLM, fallback).
   *
   * Runs once per call. Avoids double-naming when the base response
   * already contains the caller's name.
   *
   * @param {Object} result - Return value from run()
   * @param {Object} company - Company document (for nameGreeting config)
   * @returns {Object} Decorated result
   */
  static applyFirstTurnGreeting(result, company) {
    if (!result || !result.response || !result.state) return result;

    const state = result.state;

    // One-shot: already used this call
    if (state.agent2?.discovery?.usedNameGreetingThisCall) return result;

    // Load config
    const nameGreetingConfig = company?.aiAgentSettings?.agent2?.discovery?.nameGreeting;
    if (!nameGreetingConfig) return result;

    const greetingLine = `${nameGreetingConfig.greetingLine || ''}`.trim();
    if (!greetingLine) return result;

    const callerName = state.callerName
      || state.agent2?.scrabEngine?.entities?.firstName
      || null;
    const alwaysGreet = nameGreetingConfig.alwaysGreet === true;

    // Need a name or alwaysGreet to fire
    if (!callerName && !alwaysGreet) return result;

    // Resolve {name} placeholder
    let resolved;
    if (callerName) {
      resolved = greetingLine.replace(/\{name\}/gi, callerName);
    } else {
      resolved = greetingLine
        .replace(/\s*\{name\}\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Nothing meaningful after resolving (e.g., "{name}," with no name → just ",")
    if (!resolved || /^[,.\s]*$/.test(resolved)) {
      state.agent2 = state.agent2 || {};
      state.agent2.discovery = state.agent2.discovery || {};
      state.agent2.discovery.usedNameGreetingThisCall = true;
      return result;
    }

    // DOUBLE-NAME GUARD: skip prepend if response already contains the name
    if (callerName && result.response.toLowerCase().includes(callerName.toLowerCase())) {
      state.agent2 = state.agent2 || {};
      state.agent2.discovery = state.agent2.discovery || {};
      state.agent2.discovery.usedNameGreetingThisCall = true;
      return result;
    }

    // Apply greeting as opening wrapper
    result.response = `${resolved} ${result.response}`.trim();
    state.agent2 = state.agent2 || {};
    state.agent2.discovery = state.agent2.discovery || {};
    state.agent2.discovery.usedNameGreetingThisCall = true;

    return result;
  }
}

module.exports = { Agent2DiscoveryRunner };
