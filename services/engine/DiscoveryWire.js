'use strict';

/**
 * ============================================================================
 * DISCOVERY WIRE
 * ============================================================================
 *
 * Thin routing layer. Wiring only — no ownership.
 *
 * Turn 1               → Turn1Engine (greet + ack + delegate action to KC)
 * Turn 2+, greeting    → Agent2GreetingInterceptor (pure greeting only)
 * Turn 2+, intent      → KCDiscoveryRunner (UAP → KC → booking detection)
 *
 * CallerName source:
 *   discoveryNotes.temp.firstName (pre-warmed by CallerRecognition before turn 1)
 *   → fallback: state.callerName (persisted across turns by StateStore)
 *
 * Agent2DiscoveryRunner is NOT called here. It exists only as a module that
 * exports callLLMAgentForFollowUp for KC's own LLM fallback path (GATE 4).
 *
 * ============================================================================
 */

const { Agent2GreetingInterceptor } = require('./agent2/Agent2GreetingInterceptor');
const { Turn1Engine }           = require('./turn1/Turn1Engine');
const KCDiscoveryRunner         = require('./kc/KCDiscoveryRunner');
const DiscoveryNotesService     = require('../discoveryNotes/DiscoveryNotesService');
const logger                    = require('../../utils/logger');

class DiscoveryWire {
  /**
   * @param {Object}   opts
   * @param {Object}   opts.company
   * @param {string}   opts.companyId
   * @param {string}   opts.callSid
   * @param {string}   opts.userInput      — STT transcript for this turn
   * @param {Object}   opts.state          — persisted call state (from StateStore)
   * @param {Function} opts.emitEvent      — event emitter (bufferEvent from CallRuntime)
   * @param {number}   opts.turn
   * @param {string}   [opts.bridgeToken]
   * @param {Object}   [opts.redis]
   * @param {Function} [opts.onSentence]   — streaming sentence callback
   *
   * @returns {Promise<{response, matchSource, state, _exitReason, _fallbackUsed, kcTrace?, audioUrl?}>}
   */
  static async run({
    company,
    companyId,
    callSid,
    userInput,
    state,
    emitEvent,
    turn,
    bridgeToken  = null,
    redis        = null,
    onSentence   = null,
  }) {
    const emit = emitEvent || (() => {});

    // ── Turn 1 — fully owned by Turn1Engine ───────────────────────────────
    // Turn1Engine handles all 4 first-turn scenarios:
    //   SIMPLE_GREETING | RETURNING_CALLER | CALLER_WITH_INTENT | DIDNT_UNDERSTAND
    // It reads the pre-warmed discoveryNotes, runs UAP, composes the
    // greeting + acknowledgment, then delegates the action to KCDiscoveryRunner.
    // Turn 2+ uses the existing greeting check → KC flow below.
    if (turn === 1) {
      emit('DISCOVERY_WIRE_PATH', { path: 'TURN1_ENGINE', turn });
      return Turn1Engine.run({
        company, companyId, callSid, userInput,
        state, emitEvent, turn, bridgeToken, redis, onSentence,
      });
    }

    // ── 1. Resolve callerName ──────────────────────────────────────────────
    // CallerRecognition pre-warms discoveryNotes.temp.firstName before turn 1.
    // Subsequent turns: callerName is persisted in state by StateStore.
    let callerName = state?.callerName || null;
    if (!callerName) {
      try {
        const dn = await DiscoveryNotesService.load(companyId, callSid);
        callerName = dn?.temp?.firstName || null;
      } catch (err) {
        logger.debug('[DiscoveryWire] discoveryNotes load skipped (graceful degrade)', {
          callSid, error: err?.message,
        });
      }
    }

    // ── 2. Greeting check ──────────────────────────────────────────────────
    // Greeting config lives at company.aiAgentSettings.agent2.greetings —
    // same path as before, nothing moved.
    const greetingConfig = company?.aiAgentSettings?.agent2?.greetings || {};

    const greetingResult = Agent2GreetingInterceptor.evaluate({
      input:      userInput,
      config:     greetingConfig,
      turn,
      state,
      callerName,
    });

    emit('A2_GREETING_EVALUATED', greetingResult.proof);

    // ── 3. Pure greeting (no intent words) → DiscoveryWire owns this turn ─
    // containsIntentWord=true means caller said something meaningful alongside
    // the greeting ("Hi, I need my AC fixed") — route to KC so UAP handles it.
    if (greetingResult.intercepted && !greetingResult.proof.containsIntentWord) {
      const nextState = { ...state };

      // Apply one-shot guard: sets state.agent2.greeted = true so greeting
      // never fires again after the first response.
      if (greetingResult.stateUpdate) {
        nextState.agent2 = { ...(nextState.agent2 || {}), ...greetingResult.stateUpdate };
      }

      // Persist greeting detection proof in state for downstream reference.
      nextState.agent2 = {
        ...(nextState.agent2 || {}),
        discovery: {
          ...(nextState.agent2?.discovery || {}),
          greetingDetected:     true,
          lastGreetingRuleId:   greetingResult.proof.matchedRuleId || null,
        },
      };

      emit('DISCOVERY_WIRE_PATH', {
        path:           'GREETING',
        matchedRuleId:  greetingResult.proof.matchedRuleId,
        responseSource: greetingResult.responseSource,
        turn,
      });

      logger.info('[DiscoveryWire] Greeting owned', {
        ruleId:   greetingResult.proof.matchedRuleId,
        source:   greetingResult.responseSource,
        callerName,
        turn,
      });

      return {
        response:      greetingResult.response,
        matchSource:   'GREETING',
        state:         nextState,
        _exitReason:   'GREETING',
        _fallbackUsed: 'GREETING',
        // audioUrl set only when greeting interceptor resolved a pre-recorded file
        audioUrl: greetingResult.responseSource === 'audio'
                    ? greetingResult.response
                    : null,
      };
    }

    // ── 4. Everything else → KCDiscoveryRunner ────────────────────────────
    // KCDiscoveryRunner runs the full UAP → KC pipeline:
    //   GATE 0.5 Transfer intent
    //   GATE 0.7 Pre-qualify / upsell state
    //   GATE 1   Booking intent
    //   GATE 2   Anchor container (discoveryNotes)
    //   GATE 3   Container scoring → Groq answer
    //   GATE 3.5 Pre-qualify intercept
    //   GATE 4   No match → KC_LLM_FALLBACK / KC_GRACEFUL_ACK
    //   GATE 4.5 Upsell chain
    emit('DISCOVERY_WIRE_PATH', {
      path:        'KC_ENGINE',
      hasGreeting: greetingResult.intercepted,
      turn,
    });

    return KCDiscoveryRunner.run({
      company,
      companyId,
      callSid,
      userInput,
      state,
      emitEvent,
      turn,
      bridgeToken,
      redis,
      onSentence,
    });
  }
}

module.exports = { DiscoveryWire };
