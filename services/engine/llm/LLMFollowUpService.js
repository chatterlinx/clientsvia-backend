'use strict';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LLM FOLLOW-UP SERVICE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Single export: callLLMAgentForFollowUp
 *
 * This is the GATE 4 (KC_LLM_FALLBACK) handler used by KCDiscoveryRunner.
 * It was extracted verbatim from Agent2DiscoveryRunner.js (now dead) during
 * the April 2026 legacy cleanup so the live code path no longer depends on
 * a 7k-line dead module.
 *
 * Responsibilities:
 *   - Compose the follow-up system prompt (answer-from-KB or discovery mode)
 *   - Inject enriched callContext (priorVisits, repeatIssue, rejectedTopics, …)
 *   - Stream Claude response sentence-by-sentence for low-latency TTS
 *   - Track cost per turn in DiscoveryNotesService.qaLog
 *   - Emit the standard T2_* / A2_LLM_* event trail
 *
 * Callers:
 *   - services/engine/kc/KCDiscoveryRunner.js (GATE 4 / KC_LLM_FALLBACK)
 *
 * Do-not-break invariant (from memory/legacy-map.md):
 *   The exported function signature MUST match the one KCDiscoveryRunner
 *   calls. Any parameter name change is a breaking change.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

const logger                    = require('../../../utils/logger');
const DiscoveryNotesService     = require('../../discoveryNotes/DiscoveryNotesService');
const costRates                 = require('../../costRates');
const {
  DEFAULT_LLM_AGENT_SETTINGS,
  composeSystemPrompt,
}                               = require('../../../config/llmAgentDefaults');
const { ConversationMemory }    = require('../ConversationMemory');
const { streamWithSentences }   = require('../../streaming/SentenceStreamingService');

// ────────────────────────────────────────────────────────────────────────────
// Internal helper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deep merge two objects (source overrides target).
 * Arrays are replaced wholesale. null/undefined in source is ignored.
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

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * 123RP Tier 2: Call LLM Agent for follow-up consent edge cases.
 * Fires when the caller's response to a follow-up question is not a clear
 * YES/NO — e.g., ambiguous, hesitant, complex, or multi-intent.
 * Returns { response, tokensUsed, latencyMs } or null-response shape if disabled/failed.
 * On null return, caller falls to Tier 3 (canned response).
 *
 * @param {Object} params
 * @param {Object} params.company          - Full company doc (or lean object)
 * @param {string} params.input            - Caller's raw input (from gather, no ScrabEngine)
 * @param {string} params.followUpQuestion - The question that was asked
 * @param {string} params.triggerSource    - Which trigger card asked the question
 * @param {string} params.bucket           - Classifier bucket (REPROMPT/HESITANT/COMPLEX/NO)
 * @param {string} params.channel          - 'call' | 'sms' | 'webchat'
 * @param {Function} params.emit           - Event emitter
 * @param {string} params.callSid
 * @param {number} params.turn
 * @param {string} [params.bridgeToken]
 * @param {Object} [params.redis]
 * @param {string} [params.callerName]
 * @param {boolean} [params.selfScheduling=false]
 * @param {Object} [params.callContext=null]
 * @param {Function} [params.onSentence=null]
 * @param {'discovery'|'answer-from-kb'} [params.mode='discovery']
 * @param {Object} [params.kcContext=null] - Top-ranked KC sections (replaces legacy knowledgeCards)
 *
 * @returns {Promise<{response: string|null, tokensUsed?: Object, latencyMs?: number, wasPartial?: boolean, usedCallerName?: boolean, failureReason?: string}>}
 */
async function callLLMAgentForFollowUp({
  company,
  input,
  followUpQuestion,
  triggerSource,
  bucket,
  channel,
  emit,
  callSid,
  turn,
  bridgeToken,
  redis,
  callerName      = null,
  selfScheduling  = false,
  callContext     = null,
  onSentence      = null,
  mode            = 'discovery',
  kcContext       = null,
}) {
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

    // Build system prompt with follow-up context appended.
    // - mode='answer-from-kb' shifts posture when called from KC_LLM_FALLBACK
    //   (acknowledge → reflect → answer → directive; no dead-air defer).
    // - kcContext injects top-ranked KC sections (single source of truth);
    //   when provided it replaces legacy settings.knowledgeCards.
    const basePrompt = composeSystemPrompt(config, channel || 'call', mode, kcContext);

    const followUpParts = [
      '\n=== FOLLOW-UP CONTEXT ===',
      `The caller was asked: "${followUpQuestion}"`,
      triggerSource ? `(This was asked because trigger "${triggerSource}" matched.)` : '',
      `The caller responded: "${input}"`,
      `This was classified as: ${bucket} (not a clear yes or no)`,
      callerName ? `The caller's name is ${callerName}. Use their name naturally at most once.` : null,
      ''
    ];

    // Inject structured call context so LLM knows what's already established.
    // Enriched April 2026: priorVisits, visitCount, repeatIssue, rejectedTopics,
    // recentQA — enables "I see Tony was here last month" acknowledgment pattern.
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
      // Prior visit history — surfaces the "Tony was here last month" acknowledgment signal
      if (Array.isArray(callContext.priorVisits) && callContext.priorVisits.length > 0) {
        const pv = callContext.priorVisits[0];
        const when = (typeof pv.daysAgo === 'number')
          ? (pv.daysAgo === 0 ? 'today' : (pv.daysAgo === 1 ? 'yesterday' : `${pv.daysAgo} days ago`))
          : 'recently';
        const staff = pv.staff ? ` (technician: ${pv.staff})` : '';
        followUpParts.push(`Last visit: ${when} — ${pv.reason}${staff}`);
        followUpParts.push('USE THIS: open with an acknowledgment that references this prior visit when relevant.');
      }
      if (typeof callContext.visitCount === 'number' && callContext.visitCount > 1) {
        followUpParts.push(`Visit count: ${callContext.visitCount} (returning customer — treat warmly)`);
      }
      if (callContext.repeatIssue?.detected) {
        followUpParts.push(`REPEAT ISSUE DETECTED: caller has called about "${callContext.repeatIssue.reason}" multiple times.`);
        followUpParts.push('Acknowledge the frustration before proposing the solution.');
      }
      if (Array.isArray(callContext.rejectedTopics) && callContext.rejectedTopics.length > 0) {
        followUpParts.push(`Do NOT re-offer these (already declined this call): ${callContext.rejectedTopics.join(', ')}`);
      }
      if (Array.isArray(callContext.recentQA) && callContext.recentQA.length > 0) {
        followUpParts.push('Recent conversation turns (most recent last):');
        for (const qa of callContext.recentQA) {
          followUpParts.push(`  caller: "${qa.question}"  → you said: "${qa.answer}"`);
        }
        followUpParts.push('Do NOT repeat yourself — build on what you already said.');
      }
      if (callContext.behaviorBlock) {
        followUpParts.push('', callContext.behaviorBlock);
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

    // VOICE BREVITY — re-stated here because the follow-up job description above
    // otherwise overrides the base prompt's channel instruction.
    // The caller is on the phone — they cannot read, only listen.
    if ((channel || 'call') === 'call') {
      followUpParts.push(
        '',
        'VOICE BREVITY — MANDATORY:',
        'Max 2 SHORT sentences. No essays. No bullet points. No multi-part explanations.',
        'Pattern: one empathetic sentence that directly answers the question + one closing question.',
        'Example: "Drain lines can clog up again over time — that\'s exactly why we\'d send a tech to fix the root cause. Can I get someone scheduled for you today?"'
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

    // ── Sentence-streaming with heartbeat — first sentence fires TTS immediately ──
    const result = await streamWithSentences({
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
      onSentence,
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

    // Bug-2 fix — write Claude $ per turn to qaLog (fire-and-forget).
    // The Turn-1 intake path was instrumented (A2_LLM_INTAKE_TURN_1), but every
    // follow-up Claude call also costs real $ and was previously invisible to the
    // Est. Cost card. Now every LLM Agent turn contributes to the rollup.
    try {
      const _tIn  = result.tokensUsed?.input  || 0;
      const _tOut = result.tokensUsed?.output || 0;
      if (callSid && (_tIn > 0 || _tOut > 0)) {
        const _meta = costRates.computeClaudeCostWithMeta({ input: _tIn, output: _tOut }, company);
        DiscoveryNotesService.update(String(company?._id || ''), callSid, {
          qaLog: [{
            type:       'A2_LLM_FOLLOWUP',
            turn:       turn || 0,
            question:   input || null,
            source:     triggerSource || bucket || 'followup',
            provider:   'anthropic',
            latencyMs:  result.latencyMs || null,
            tokensUsed: { input: _tIn, output: _tOut },
            cost:       { usd: _meta.usd, input: _tIn, output: _tOut, model: 'claude-sonnet-4-5', rate: _meta.rate },
            timestamp:  new Date().toISOString(),
          }],
        }).catch(() => {});
      }
    } catch (_) { /* never break Claude for a log write */ }

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

module.exports = { callLLMAgentForFollowUp };
