'use strict';

/**
 * Turn1Engine — First-turn triage and personalized welcome
 *
 * Owns turn 1 entirely. Once the caller passes turn 1, normal UAP → KC → Booking
 * flow takes over. Turn1Engine is never called again.
 *
 * 4 triage lanes:
 *   SIMPLE_GREETING    — pure "hi/hello/hey", no intent detected
 *   RETURNING_CALLER   — known caller + minimal input + chart has a context signal
 *   CALLER_WITH_INTENT — substantive utterance → greet + ack prefix stitched to KC answer
 *   DIDNT_UNDERSTAND   — too short / no match → "I'm sorry, I missed that…"
 *
 * Design doc: memory/turn1-engine-design.md
 */

const KCDiscoveryRunner     = require('../kc/KCDiscoveryRunner');
const DiscoveryNotesService = require('../../discoveryNotes/DiscoveryNotesService');
const logger                = require('../../../utils/logger');

// ── Lazy-load UAP to avoid circular deps ─────────────────────────────────────
let _UAP = null;
function _getUAP() {
  if (!_UAP) _UAP = require('../kc/UtteranceActParser');
  return _UAP;
}

// ── Pure-greeting regex — UAP won't match these (no UAPArray entry) ──────────
const _GREETING_RE = /^(hi+|hey+|hello+|howdy|yo+|good\s+(morning|afternoon|evening))\W*$/i;

// ── Problem-signal keywords for acknowledgment composition ───────────────────
const _PRIOR_VISIT_RE = /\b(was\s+here|came\s+out|already\s+(came|been\s+out|sent\s+someone|repaired|fixed)|still\s+not\s+(working|cooling|fixed|running|heating|cold|warm|blowing)|didn[''']?t\s+fix|hasn[''']?t\s+(been\s+)?fixed|back\s+again|last\s+time\s+(you|the\s+tech|your|he|she|they)\s+came)\b/i;
const _PROBLEM_RE     = /\b(trouble|issue|problem|broken|not\s+work|fail|wrong|error|leak|flood|no\s+(heat|ac|cool|hot\s+water)|still|again)\b/i;
const _BOOKING_RE     = /\b(schedul|book|appoint|come\s+out|send\s+someone|service\s+call|set\s+up)\b/i;

// ─────────────────────────────────────────────────────────────────────────────

class Turn1Engine {

  /**
   * run() — same external signature as KCDiscoveryRunner.run()
   * Called from DiscoveryWire when turn === 1.
   */
  static async run(params) {
    const { company, companyId, callSid, userInput, state, emitEvent } = params;
    const emit     = emitEvent || (() => {});
    const t1Config = company?.aiAgentSettings?.turn1 || {};

    // Bail if admin disabled Turn1Engine — fall straight to KC
    if (t1Config.enabled === false) {
      emit('TURN1_DISABLED', { companyId });
      return KCDiscoveryRunner.run(params);
    }

    // 1. Load discoveryNotes (pre-warmed by CallerRecognition before turn 1)
    let dn = null;
    try { dn = await DiscoveryNotesService.load(companyId, callSid); } catch (_) {}

    const callerName = dn?.temp?.firstName || state?.callerName || null;
    const isKnown    = !!(dn?.callerProfile?.isKnown);

    // 2. Parse intent via UAP (zero-latency rule-based layer 1)
    let uapResult = null;
    try {
      const UAP = _getUAP();
      uapResult = await UAP.parse(companyId, userInput);
    } catch (e) {
      logger.warn('[TURN1] UAP parse failed (non-fatal)', { companyId, callSid, err: e.message });
    }

    // 3. Triage → lane
    const lane = Turn1Engine._triage(userInput, uapResult, dn, isKnown, t1Config);
    emit('TURN1_TRIAGE', {
      lane,
      callerName:   callerName || null,
      isKnown,
      uapDaType:    uapResult?.daType    || null,
      uapSubType:   uapResult?.daSubTypeKey || null,
      uapConfidence: uapResult?.confidence ?? null,
      turn:         params.turn,
    });

    // 4. Handle lane
    switch (lane) {

      case 'SIMPLE_GREETING':
        emit('TURN1_PATH', { path: 'SIMPLE_GREETING', turn: params.turn });
        return Turn1Engine._simpleGreeting(callerName, state);

      case 'RETURNING_CALLER':
        emit('TURN1_PATH', { path: 'RETURNING_CALLER', turn: params.turn });
        return Turn1Engine._returningCaller(dn, callerName, t1Config, state);

      case 'DIDNT_UNDERSTAND': {
        const text = (t1Config.didntUnderstandText || '').trim()
          || "I'm sorry, I missed that — could you say that again?";
        emit('TURN1_PATH', { path: 'DIDNT_UNDERSTAND', turn: params.turn });
        return {
          response:    text,
          matchSource: 'TURN1_ENGINE',
          state,
          _exitReason: 'TURN1_DIDNT_UNDERSTAND',
        };
      }

      default: { // CALLER_WITH_INTENT
        const prefix = Turn1Engine._composePrefix(dn, uapResult, userInput, callerName);
        emit('TURN1_PATH', {
          path:     'CALLER_WITH_INTENT',
          prefix:   prefix || null,
          uapDaType: uapResult?.daType || null,
          turn:     params.turn,
        });
        // Delegate the ACTION to KCDiscoveryRunner — it handles KC/booking/transfer
        const kcResult = await KCDiscoveryRunner.run(params);
        return Turn1Engine._stitch(prefix, kcResult, state);
      }
    }
  }

  // ── Triage ──────────────────────────────────────────────────────────────────

  static _triage(input, uap, dn, isKnown, cfg) {
    const norm      = (input || '').trim();
    const wordCount = norm.split(/\s+/).filter(Boolean).length;
    const noIntent  = !uap || uap.confidence < 0.3;
    const isGreeting = _GREETING_RE.test(norm);

    // Lane 4 — too short / no recognisable content at all
    if (wordCount <= 2 && noIntent && !isGreeting) return 'DIDNT_UNDERSTAND';

    // Lane 1 / 2 — pure greeting (or ≤3 words with no UAP match)
    if (isGreeting || (wordCount <= 3 && noIntent)) {
      if (isKnown && cfg.returningCallerEnabled !== false && Turn1Engine._hasContextSignal(dn)) {
        return 'RETURNING_CALLER';
      }
      return 'SIMPLE_GREETING';
    }

    // Lane 3 — has real intent
    return 'CALLER_WITH_INTENT';
  }

  // ── Lane 1 — Simple Greeting ─────────────────────────────────────────────────

  static _simpleGreeting(callerName, state) {
    const text = callerName
      ? `Hi ${callerName}, how can I help you today?`
      : 'Hi, how can I help you today?';
    return {
      response:    text,
      matchSource: 'TURN1_ENGINE',
      state:       { ...state, agent2: { ...(state?.agent2 || {}), greeted: true } },
      _exitReason: 'TURN1_SIMPLE_GREETING',
    };
  }

  // ── Lane 2 — Returning Caller with history context ───────────────────────────

  static _returningCaller(dn, callerName, cfg, state) {
    const cp      = dn?.callerProfile || {};
    const llc     = dn?.lostLeadContext || {};
    const name    = callerName ? ` ${callerName}` : '';
    const depthMs = ((cfg.historyDepthDays || 180) * 86_400_000);
    const now     = Date.now();

    let text;

    // Priority 1 — open lost lead (highest value: caller tried to book, didn't finish)
    if (llc.hasOpenLead) {
      text = `Hi${name}! I see you were looking to schedule something recently — would you like to pick that up?`;

    // Priority 2 — recent service call within historyDepthDays
    } else if (cp.lastCallDate) {
      const diffMs = now - new Date(cp.lastCallDate).getTime();
      if (diffMs > 0 && diffMs < depthMs) {
        const days = Math.round(diffMs / 86_400_000);
        const ago  = days <= 1   ? 'yesterday'
                   : days < 14   ? `${days} days ago`
                   : days < 60   ? `${Math.round(days / 7)} weeks ago`
                   : `${Math.round(days / 30)} months ago`;
        text = `Hi${name}! We were in touch ${ago} — is everything still going well?`;
      }
    }

    // Priority 3 — repeat issue (same callReason appeared 2+ times in recent history)
    if (!text && cp.repeatIssueDetected) {
      text = `Hi${name}! I can see you've reached out about this a couple of times — let's make sure we get it sorted for you today. How can I help?`;
    }

    // Priority 4 — prior call reason known
    if (!text && cp.lastCallReason) {
      text = `Hi${name}! Last time you called about ${cp.lastCallReason} — is that what you're calling about today?`;
    }

    // Priority 5 / 6 — known caller, no specific signal
    if (!text) {
      text = callerName
        ? `Hi ${callerName}, great to hear from you! How can I help you today?`
        : `Hi there, how can I help you today?`;
    }

    return {
      response:    text,
      matchSource: 'TURN1_ENGINE',
      state:       { ...state, agent2: { ...(state?.agent2 || {}), greeted: true } },
      _exitReason: 'TURN1_RETURNING_CALLER',
    };
  }

  // ── Lane 3 helpers ────────────────────────────────────────────────────────────

  /**
   * _composePrefix — builds "Hi John! I'm sorry to hear that —" style opener.
   * Returns empty string for inquiry-only intent (no empathy needed).
   */
  static _composePrefix(dn, uap, input, callerName) {
    const cp   = dn?.callerProfile || {};
    const name = callerName ? ` ${callerName}` : '';
    const greet = `Hi${name}!`;

    // Repeat-issue caller — elevated empathy regardless of what they say
    if (cp.repeatIssueDetected) {
      return `${greet} I'm sorry you're still dealing with this —`;
    }

    // Prior-visit signal — caller mentions a tech already came out / still not fixed
    if (_PRIOR_VISIT_RE.test(input)) {
      return `${greet} I'm sorry it's still not resolved —`;
    }

    // Problem / frustration expressed
    if (_PROBLEM_RE.test(input)) {
      return `${greet} I'm sorry to hear that —`;
    }

    // Booking request
    if (_BOOKING_RE.test(input)) {
      return `${greet} Absolutely —`;
    }

    // Transfer / staff mention
    if (uap?.daType === 'TRANSFER' || /\b(speak|talk|get|reach)\s+(to|with)\b/i.test(input)) {
      return `${greet} Let me check on that for you —`;
    }

    // Inquiry / general intent — just greet, let KC answer stand on its own
    return greet;
  }

  /**
   * _stitch — joins the Turn1Engine prefix with the KC response.
   * Lowercases the first char of kcText when it follows a dash, capitalises
   * when it follows a full stop.
   */
  static _stitch(prefix, kcResult, _state) {
    const kcText = (kcResult?.response || '').trim();

    if (!prefix || !kcText) {
      return { ...(kcResult || {}), response: kcText, matchSource: 'TURN1_ENGINE' };
    }

    // Prefix ends with "—" → lowercase continuation
    // Prefix ends with "!" or "." → kcText starts as its own sentence
    const endsWithDash = prefix.trimEnd().endsWith('—');
    const joined = endsWithDash
      ? `${prefix} ${kcText.charAt(0).toLowerCase()}${kcText.slice(1)}`
      : `${prefix} ${kcText}`;

    return {
      ...(kcResult || {}),
      response:    joined,
      matchSource: 'TURN1_ENGINE',
      _exitReason: 'TURN1_CALLER_WITH_INTENT',
    };
  }

  // ── Utility ───────────────────────────────────────────────────────────────────

  static _hasContextSignal(dn) {
    const cp  = dn?.callerProfile || {};
    const llc = dn?.lostLeadContext || {};
    return !!(llc.hasOpenLead || cp.lastCallDate || cp.lastCallReason || cp.repeatIssueDetected);
  }
}

module.exports = { Turn1Engine };
