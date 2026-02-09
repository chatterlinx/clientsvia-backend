/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TURN RECORD BUILDER - Incremental Builder for Turn Records (V111)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Builds TurnRecord objects incrementally during a conversation turn.
 * Each turn in the conversation gets exactly ONE TurnRecord that captures:
 * - What the caller said (raw + cleaned)
 * - What was extracted (slots, intent)
 * - How routing decided (handler selection + why)
 * - What the agent responded
 * - What changed in memory (delta)
 * 
 * USAGE:
 *   const builder = new TurnRecordBuilder(turnNumber);
 *   builder.setCallerInput(raw, cleaned, confidence, sttOps);
 *   builder.setExtraction(slots, intent, entities);
 *   builder.setTriage(candidates, topScenario, urgency);
 *   builder.setRouting(handler, why, rejected, phase);
 *   builder.setResponse(handler, text, latencyMs, tokens, actions);
 *   builder.setDelta(factsAdded, factsUpdated, phaseChanged);
 *   builder.setMemorySnapshot(facts, phase, bookingMode, captureProgress);
 *   const record = builder.build();
 * 
 * SPEC: docs/architecture/V111-ConversationMemory-Spec.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// VERSION
// ═══════════════════════════════════════════════════════════════════════════════
const VERSION = 'v111.0';

// ═══════════════════════════════════════════════════════════════════════════════
// TURN RECORD BUILDER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class TurnRecordBuilder {
  /**
   * Create a new TurnRecordBuilder
   * @param {number} turnNumber - The turn number (0-indexed)
   */
  constructor(turnNumber) {
    this.turn = turnNumber;
    this.timestamp = new Date().toISOString();
    this.startTime = Date.now();
    
    // Initialize all sections with defaults
    this.caller = {
      raw: '',
      cleaned: '',
      confidence: 0,
      sttOps: {
        fillersRemoved: [],
        correctionsApplied: [],
        synonymsApplied: []
      }
    };
    
    this.extraction = {
      slots: {},
      intent: {
        detected: 'unknown',
        confidence: 0
      },
      entities: []
    };
    
    this.triage = {
      scenarioCandidates: [],
      topScenario: null,
      urgencyDetected: 'normal',
      triageSignals: []
    };
    
    this.routing = {
      selectedHandler: null,
      why: [],
      rejected: [],
      phase: 'DISCOVERY',
      captureInjected: false
    };
    
    this.response = {
      handler: null,
      text: '',
      latencyMs: 0,
      tokensUsed: 0,
      actions: []
    };
    
    this.delta = {
      factsAdded: [],
      factsUpdated: [],
      phaseChanged: false
    };
    
    this.memorySnapshot = {
      knownFacts: {},
      phase: 'DISCOVERY',
      bookingMode: false,
      captureProgress: {
        must: {},
        turnsWithoutProgress: 0
      }
    };
    
    // V111 Phase 4: Governance trail
    this.v111 = {
      governance: [],
      captureInjection: null,
      escalation: null,
      handler: null,
      reason: null
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CALLER INPUT
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Set the caller's input for this turn
   * @param {string} raw - Raw speech from STT
   * @param {string} cleaned - Cleaned speech after STT processing
   * @param {number} confidence - STT confidence (0-1)
   * @param {object} sttOps - STT operations applied
   */
  setCallerInput(raw, cleaned, confidence, sttOps = {}) {
    this.caller = {
      raw: raw || '',
      cleaned: cleaned || raw || '',
      confidence: confidence || 0,
      sttOps: {
        fillersRemoved: sttOps.fillersRemoved || sttOps.fillers || [],
        correctionsApplied: sttOps.correctionsApplied || sttOps.corrections || [],
        synonymsApplied: sttOps.synonymsApplied || sttOps.synonyms || []
      }
    };
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Set extraction results for this turn
   * @param {object} slots - Extracted slots { slotName: { value, confidence, source } }
   * @param {object} intent - Detected intent { detected, confidence }
   * @param {array} entities - Named entities [{ type, value, position }]
   */
  setExtraction(slots, intent, entities = []) {
    this.extraction = {
      slots: slots || {},
      intent: {
        detected: intent?.detected || intent?.intent || 'unknown',
        confidence: intent?.confidence || 0
      },
      entities: entities || []
    };
    return this;
  }

  /**
   * Add a single extracted slot
   * @param {string} slotName - Name of the slot
   * @param {string} value - Extracted value
   * @param {number} confidence - Confidence (0-1)
   * @param {string} source - Source of extraction
   */
  addSlot(slotName, value, confidence, source) {
    this.extraction.slots[slotName] = {
      value,
      confidence: confidence || 0,
      source: source || 'extracted'
    };
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TRIAGE
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Set triage/scenario matching results
   * @param {array} candidates - Scenario candidates [{ id, score, category }]
   * @param {object} topScenario - Best matching scenario (or null)
   * @param {string} urgency - Detected urgency level
   * @param {array} signals - Triage signals detected
   */
  setTriage(candidates, topScenario, urgency, signals = []) {
    this.triage = {
      scenarioCandidates: candidates || [],
      topScenario: topScenario || null,
      urgencyDetected: urgency || 'normal',
      triageSignals: signals || []
    };
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ROUTING
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Set routing decision for this turn
   * @param {string} handler - Selected handler (LLM, SCENARIO, BOOKING, ESCALATION)
   * @param {array} why - Reasons for selection [{ rule, score?, required? }]
   * @param {array} rejected - Rejected handlers [{ handler, reason }]
   * @param {string} phase - Current phase (GREETING, DISCOVERY, BOOKING, COMPLETE)
   * @param {boolean} captureInjected - Whether capture prompt was injected
   */
  setRouting(handler, why, rejected = [], phase = 'DISCOVERY', captureInjected = false) {
    this.routing = {
      selectedHandler: handler,
      why: Array.isArray(why) ? why : [{ rule: why }],
      rejected: rejected || [],
      phase: phase,
      captureInjected: captureInjected
    };
    return this;
  }

  /**
   * Add a rejection reason
   * @param {string} handler - Handler that was rejected
   * @param {string} reason - Why it was rejected
   */
  addRejection(handler, reason) {
    this.routing.rejected.push({ handler, reason });
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RESPONSE
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Set the agent's response for this turn
   * @param {string} handler - Which handler generated response
   * @param {string} text - Response text
   * @param {number} latencyMs - Response latency in ms
   * @param {number} tokens - Tokens used (if LLM)
   * @param {array} actions - Actions triggered ['transfer', 'book', etc.]
   */
  setResponse(handler, text, latencyMs, tokens = 0, actions = []) {
    this.response = {
      handler: handler,
      text: text || '',
      latencyMs: latencyMs || (Date.now() - this.startTime),
      tokensUsed: tokens || 0,
      actions: actions || []
    };
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DELTA
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Set what changed in memory this turn
   * @param {array} factsAdded - New facts added ['name', 'phone']
   * @param {array} factsUpdated - Facts that were updated
   * @param {boolean} phaseChanged - Whether phase transitioned
   */
  setDelta(factsAdded, factsUpdated = [], phaseChanged = false) {
    this.delta = {
      factsAdded: factsAdded || [],
      factsUpdated: factsUpdated || [],
      phaseChanged: phaseChanged
    };
    return this;
  }

  /**
   * Add a fact to the delta
   * @param {string} factName - Name of the fact
   * @param {boolean} isNew - True if new, false if updated
   */
  addFactDelta(factName, isNew = true) {
    if (isNew) {
      if (!this.delta.factsAdded.includes(factName)) {
        this.delta.factsAdded.push(factName);
      }
    } else {
      if (!this.delta.factsUpdated.includes(factName)) {
        this.delta.factsUpdated.push(factName);
      }
    }
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MEMORY SNAPSHOT
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Set the memory snapshot after this turn
   * @param {object} facts - Known facts { name: 'Mark', issue: 'AC not working' }
   * @param {string} phase - Current phase
   * @param {boolean} bookingMode - Whether in booking mode
   * @param {object} captureProgress - Capture goal progress
   */
  setMemorySnapshot(facts, phase, bookingMode, captureProgress) {
    this.memorySnapshot = {
      knownFacts: facts || {},
      phase: phase || 'DISCOVERY',
      bookingMode: bookingMode || false,
      captureProgress: captureProgress || {
        must: {},
        turnsWithoutProgress: 0
      }
    };
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // V111 GOVERNANCE (Phase 4)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set V111 Router governance decision
   * @param {object} decision - V111Router decision object
   */
  setV111Decision(decision) {
    if (!decision) return this;
    
    this.v111 = {
      governance: decision.governance || [],
      captureInjection: decision.captureInjection || null,
      escalation: decision.escalation || null,
      handler: decision.handler || null,
      reason: decision.reason || null,
      passthrough: decision.passthrough || false
    };
    return this;
  }

  /**
   * Add a V111 governance step
   * @param {string} step - Step name
   * @param {string} result - Result (triggered, allowed, rejected, etc.)
   * @param {object} details - Additional details
   */
  addGovernanceStep(step, result, details = {}) {
    this.v111.governance.push({
      step,
      result,
      ...details
    });
    return this;
  }

  /**
   * Set capture injection info
   * @param {string} field - Field being captured
   * @param {string} priority - Priority level
   * @param {string} reason - Reason for injection
   */
  setCaptureInjection(field, priority, reason) {
    this.v111.captureInjection = {
      inject: true,
      field,
      priority,
      reason
    };
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BUILD
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Build the final TurnRecord object
   * @returns {object} Complete TurnRecord
   */
  build() {
    // Calculate final latency if not set
    if (!this.response.latencyMs) {
      this.response.latencyMs = Date.now() - this.startTime;
    }

    const record = {
      turn: this.turn,
      timestamp: this.timestamp,
      caller: this.caller,
      extraction: this.extraction,
      triage: this.triage,
      routing: this.routing,
      response: this.response,
      delta: this.delta,
      memorySnapshot: this.memorySnapshot,
      // V111 Phase 4: Include governance trail
      v111: this.v111.governance.length > 0 || this.v111.captureInjection || this.v111.escalation 
        ? this.v111 
        : undefined,
      _meta: {
        version: VERSION,
        builtAt: new Date().toISOString(),
        durationMs: Date.now() - this.startTime
      }
    };

    logger.debug('[TURN RECORD] Built', {
      turn: this.turn,
      handler: this.routing.selectedHandler,
      factsAdded: this.delta.factsAdded.length,
      latencyMs: this.response.latencyMs
    });

    return record;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STATIC HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Create a minimal TurnRecord for error cases
   * @param {number} turn - Turn number
   * @param {string} error - Error message
   * @returns {object} Minimal TurnRecord with error
   */
  static createErrorRecord(turn, error) {
    const builder = new TurnRecordBuilder(turn);
    builder.setRouting('ERROR', [{ rule: 'error_occurred', error }]);
    builder.setResponse('ERROR', '', 0);
    return builder.build();
  }

  /**
   * Create from existing partial data
   * @param {number} turn - Turn number
   * @param {object} data - Partial TurnRecord data
   * @returns {TurnRecordBuilder} Builder pre-populated with data
   */
  static fromPartial(turn, data = {}) {
    const builder = new TurnRecordBuilder(turn);
    
    if (data.caller) builder.setCallerInput(data.caller.raw, data.caller.cleaned, data.caller.confidence, data.caller.sttOps);
    if (data.extraction) builder.setExtraction(data.extraction.slots, data.extraction.intent, data.extraction.entities);
    if (data.triage) builder.setTriage(data.triage.scenarioCandidates, data.triage.topScenario, data.triage.urgencyDetected);
    if (data.routing) builder.setRouting(data.routing.selectedHandler, data.routing.why, data.routing.rejected, data.routing.phase);
    if (data.response) builder.setResponse(data.response.handler, data.response.text, data.response.latencyMs, data.response.tokensUsed);
    if (data.delta) builder.setDelta(data.delta.factsAdded, data.delta.factsUpdated, data.delta.phaseChanged);
    if (data.memorySnapshot) builder.setMemorySnapshot(data.memorySnapshot.knownFacts, data.memorySnapshot.phase, data.memorySnapshot.bookingMode);
    
    return builder;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  TurnRecordBuilder,
  VERSION
};
