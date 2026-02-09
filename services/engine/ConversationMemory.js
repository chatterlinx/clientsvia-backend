/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONVERSATION MEMORY - Runtime Truth for Call State (V111)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * The single source of truth for a call's runtime state.
 * 
 * PRINCIPLES:
 * 1. One ConversationMemory per call
 * 2. All components read from and write through this object
 * 3. Governed writes - only authorized components can write facts
 * 4. Full audit trail via TurnRecords
 * 
 * WHAT IT STORES:
 * - Call identity (callId, companyId, phones)
 * - Facts (slots extracted during call)
 * - Phase state (GREETING → DISCOVERY → BOOKING → COMPLETE)
 * - Booking state (consent, steps, progress)
 * - Capture progress (MUST/SHOULD/NICE goal tracking)
 * - Turn history (array of TurnRecords)
 * - Metrics (latency, LLM calls, etc.)
 * 
 * PERSISTENCE:
 * - During call: Redis (fast, TTL-based)
 * - After call: MongoDB via BlackBox (permanent archive)
 * 
 * SPEC: docs/architecture/V111-ConversationMemory-Spec.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');
const { TurnRecordBuilder } = require('./TurnRecordBuilder');
const { getSharedRedisClient, isRedisConfigured } = require('../redisClientFactory');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const VERSION = 'v111.1';  // Updated for Phase 3 - Config-driven governance
const REDIS_KEY_PREFIX = 'conversation-memory:';
const REDIS_TTL_SECONDS = 300; // 5 minutes after last activity

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIG (used when company has no V111 config)
// ═══════════════════════════════════════════════════════════════════════════════
const DEFAULT_V111_CONFIG = {
  version: 'v111',
  enabled: false,
  captureGoals: {
    must: { fields: ['name', 'issue'], deadline: 'before_booking_confirmation', onMissing: 'router_prompts' },
    should: { fields: ['phone', 'address'], deadline: 'end_of_discovery', onMissing: 'log_warning' },
    nice: { fields: [], deadline: 'none', onMissing: 'ignore' }
  },
  contextWindow: { maxTurns: 6, summarizeOlderTurns: true, alwaysIncludeFacts: true, maxTokenBudget: 600 },
  handlerGovernance: {
    scenarioHandler: { enabled: true, minConfidence: 0.75, allowInBookingMode: false },
    bookingHandler: { enabled: true, requiresConsent: true, consentConfidence: 0.8, lockAfterConsent: true },
    llmHandler: { enabled: true, isDefaultFallback: true, canWriteFacts: false },
    escalationHandler: { enabled: true, triggers: ['explicit_request', 'frustration_detected', 'loop_detected'] }
  },
  routerRules: {
    priority: ['escalation', 'booking_locked', 'scenario_match', 'llm_default'],
    captureInjection: { enabled: true, maxTurnsWithoutProgress: 2 },
    loopDetection: { enabled: true, maxRepeatedResponses: 2, onLoop: 'escalate' }
  },
  blackbox: { logTurnRecords: true, logMilestones: true, verbosity: 'standard' }
};

// Valid phases
const PHASES = {
  GREETING: 'GREETING',
  DISCOVERY: 'DISCOVERY',
  BOOKING: 'BOOKING',
  COMPLETE: 'COMPLETE'
};

// Valid fact sources (for governance)
const VALID_SOURCES = [
  'self_identified',    // Caller explicitly stated
  'extracted',          // Extracted from speech
  'confirmed',          // Confirmed by caller
  'caller_id',          // From phone system
  'triage',            // From scenario matching
  'booking'            // From booking flow
];

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION MEMORY CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class ConversationMemory {
  /**
   * Private constructor - use static factory methods
   * @param {object} data - Initial memory data
   */
  constructor(data = {}) {
    // ─────────────────────────────────────────────────────────────────────────
    // CALL IDENTITY
    // ─────────────────────────────────────────────────────────────────────────
    this.callId = data.callId || null;
    this.companyId = data.companyId || null;
    this.templateId = data.templateId || null;
    this.startTime = data.startTime || new Date().toISOString();
    this.callerPhone = data.callerPhone || null;
    this.companyPhone = data.companyPhone || null;
    
    // ─────────────────────────────────────────────────────────────────────────
    // FACTS - Accumulated knowledge (extractor-written ONLY)
    // ─────────────────────────────────────────────────────────────────────────
    this.facts = data.facts || {};
    
    // ─────────────────────────────────────────────────────────────────────────
    // PHASE STATE
    // ─────────────────────────────────────────────────────────────────────────
    this.phase = data.phase || {
      current: PHASES.GREETING,
      previous: null,
      transitionedAt: null,
      transitionReason: null
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING STATE
    // ─────────────────────────────────────────────────────────────────────────
    this.booking = data.booking || {
      consentDetected: false,
      consentTurn: null,
      modeLocked: false,
      currentStep: null,
      completedSteps: [],
      remainingSteps: []
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // CAPTURE PROGRESS
    // ─────────────────────────────────────────────────────────────────────────
    this.captureProgress = data.captureProgress || {
      must: {},
      should: {},
      nice: {},
      turnsWithoutProgress: 0
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // TURNS - The conversation log
    // ─────────────────────────────────────────────────────────────────────────
    this.turns = data.turns || [];
    
    // ─────────────────────────────────────────────────────────────────────────
    // METRICS
    // ─────────────────────────────────────────────────────────────────────────
    this.metrics = data.metrics || {
      totalTurns: 0,
      avgResponseLatencyMs: 0,
      llmCallCount: 0,
      scenarioMatchCount: 0,
      escalationTriggered: false,
      totalLatencyMs: 0
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // OUTCOME (populated at call end)
    // ─────────────────────────────────────────────────────────────────────────
    this.outcome = data.outcome || null;
    
    // ─────────────────────────────────────────────────────────────────────────
    // V111 CONFIG (loaded from company settings)
    // ─────────────────────────────────────────────────────────────────────────
    this.config = data.config || { ...DEFAULT_V111_CONFIG };
    
    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL STATE
    // ─────────────────────────────────────────────────────────────────────────
    this._currentTurnBuilder = null;
    this._dirty = false;
    this._version = VERSION;
    this._lastResponseText = null;  // For loop detection
    this._consecutiveRepeats = 0;   // For loop detection
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATIC FACTORY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load existing memory from Redis, or return null if not found
   * @param {string} callId - Call SID
   * @returns {Promise<ConversationMemory|null>}
   */
  static async load(callId) {
    if (!callId) return null;
    
    try {
      if (!isRedisConfigured()) {
        logger.debug('[CONVERSATION MEMORY] Redis not configured, returning null');
        return null;
      }
      
      const redis = await getSharedRedisClient();
      if (!redis) return null;
      
      const key = `${REDIS_KEY_PREFIX}${callId}`;
      const data = await redis.get(key);
      
      if (!data) {
        logger.debug('[CONVERSATION MEMORY] Not found in Redis', { callId });
        return null;
      }
      
      const parsed = JSON.parse(data);
      logger.debug('[CONVERSATION MEMORY] Loaded from Redis', { 
        callId, 
        turns: parsed.turns?.length || 0 
      });
      
      return new ConversationMemory(parsed);
      
    } catch (error) {
      logger.warn('[CONVERSATION MEMORY] Load failed (non-fatal)', { 
        callId, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Create a new ConversationMemory for a call
   * @param {object} options - Creation options
   * @returns {ConversationMemory}
   */
  static create({ callId, companyId, templateId, callerPhone, companyPhone }) {
    const memory = new ConversationMemory({
      callId,
      companyId,
      templateId,
      callerPhone,
      companyPhone,
      startTime: new Date().toISOString()
    });
    
    memory._dirty = true;
    
    logger.info('[CONVERSATION MEMORY] Created', { 
      callId, 
      companyId 
    });
    
    return memory;
  }

  /**
   * Load existing or create new
   * @param {object} options - Load/create options
   * @returns {Promise<ConversationMemory>}
   */
  static async loadOrCreate({ callId, companyId, templateId, callerPhone, companyPhone }) {
    // Try to load existing
    const existing = await ConversationMemory.load(callId);
    if (existing) {
      return existing;
    }
    
    // Create new
    return ConversationMemory.create({
      callId,
      companyId,
      templateId,
      callerPhone,
      companyPhone
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TURN MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start a new turn
   * @param {number} turnNumber - Turn number (optional, auto-increments)
   * @returns {TurnRecordBuilder}
   */
  startTurn(turnNumber = null) {
    const turn = turnNumber ?? this.turns.length;
    this._currentTurnBuilder = new TurnRecordBuilder(turn);
    
    logger.debug('[CONVERSATION MEMORY] Turn started', { 
      callId: this.callId, 
      turn 
    });
    
    return this._currentTurnBuilder;
  }

  /**
   * Get the current turn builder
   * @returns {TurnRecordBuilder|null}
   */
  getCurrentTurnBuilder() {
    return this._currentTurnBuilder;
  }

  /**
   * Commit the current turn and add to history
   * @returns {object} The committed TurnRecord
   */
  commitTurn() {
    if (!this._currentTurnBuilder) {
      logger.warn('[CONVERSATION MEMORY] No active turn to commit', { 
        callId: this.callId 
      });
      return null;
    }
    
    // Build the snapshot
    this._currentTurnBuilder.setMemorySnapshot(
      this.getFactsSimple(),
      this.phase.current,
      this.booking.modeLocked,
      this.captureProgress
    );
    
    // Build and add to turns
    const turnRecord = this._currentTurnBuilder.build();
    this.turns.push(turnRecord);
    
    // Update metrics
    this.metrics.totalTurns = this.turns.length;
    this.metrics.totalLatencyMs += turnRecord.response.latencyMs || 0;
    this.metrics.avgResponseLatencyMs = Math.round(
      this.metrics.totalLatencyMs / this.metrics.totalTurns
    );
    
    if (turnRecord.routing.selectedHandler === 'LLM' || 
        turnRecord.routing.selectedHandler === 'LLM_DEFAULT') {
      this.metrics.llmCallCount++;
    }
    
    if (turnRecord.routing.selectedHandler === 'SCENARIO') {
      this.metrics.scenarioMatchCount++;
    }
    
    this._dirty = true;
    this._currentTurnBuilder = null;
    
    logger.debug('[CONVERSATION MEMORY] Turn committed', { 
      callId: this.callId, 
      turn: turnRecord.turn,
      handler: turnRecord.routing.selectedHandler,
      latencyMs: turnRecord.response.latencyMs
    });
    
    return turnRecord;
  }

  /**
   * Get the current turn record (without committing)
   * @returns {object|null}
   */
  getCurrentTurnRecord() {
    if (!this._currentTurnBuilder) return null;
    return this._currentTurnBuilder.build();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STT RESULT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add STT preprocessing result to current turn
   * @param {string} raw - Raw speech
   * @param {string} cleaned - Cleaned speech
   * @param {object} sttResult - Full STT result with metrics
   */
  addSTTResult(raw, cleaned, sttResult = {}) {
    if (!this._currentTurnBuilder) {
      logger.warn('[CONVERSATION MEMORY] No active turn for STT result', { 
        callId: this.callId 
      });
      return;
    }
    
    const sttOps = {
      fillersRemoved: sttResult?.transformations?.fillersRemoved || [],
      correctionsApplied: sttResult?.transformations?.correctionsApplied || [],
      synonymsApplied: sttResult?.transformations?.synonymsApplied || []
    };
    
    this._currentTurnBuilder.setCallerInput(
      raw,
      cleaned,
      sttResult?.confidence || 0,
      sttOps
    );
    
    this._dirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FACT MANAGEMENT (GOVERNED)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Commit a fact to memory (governed write)
   * @param {string} factId - Fact identifier (name, phone, issue, etc.)
   * @param {*} value - The value
   * @param {string} source - Source of the fact
   * @param {number} confidence - Confidence (0-1)
   * @returns {object} { success, reason }
   */
  commitFact(factId, value, source, confidence = 0) {
    // Validate source
    if (!VALID_SOURCES.includes(source)) {
      logger.warn('[CONVERSATION MEMORY] Invalid fact source', { 
        factId, 
        source,
        callId: this.callId 
      });
      return { success: false, reason: 'invalid_source' };
    }
    
    // Check if fact exists and if overwrite is allowed
    const existing = this.facts[factId];
    const isNew = !existing;
    
    // Store the fact
    this.facts[factId] = {
      value,
      confidence,
      source,
      capturedTurn: this.turns.length,
      capturedAt: new Date().toISOString(),
      confirmed: source === 'confirmed',
      previous: existing?.value || null
    };
    
    // Update turn builder delta
    if (this._currentTurnBuilder) {
      this._currentTurnBuilder.addFactDelta(factId, isNew);
    }
    
    // Update capture progress
    this._updateCaptureProgress(factId);
    
    this._dirty = true;
    
    logger.debug('[CONVERSATION MEMORY] Fact committed', { 
      callId: this.callId,
      factId,
      source,
      confidence,
      isNew
    });
    
    return { success: true };
  }

  /**
   * Get a fact value
   * @param {string} factId - Fact identifier
   * @returns {*} The fact value or null
   */
  getFact(factId) {
    return this.facts[factId]?.value || null;
  }

  /**
   * Get all facts as simple key-value pairs
   * @returns {object}
   */
  getFactsSimple() {
    const simple = {};
    for (const [key, fact] of Object.entries(this.facts)) {
      simple[key] = fact.value;
    }
    return simple;
  }

  /**
   * Check if a fact exists
   * @param {string} factId - Fact identifier
   * @returns {boolean}
   */
  hasFact(factId) {
    return !!this.facts[factId];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIAGE RESULT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add triage/scenario matching result to current turn
   * @param {array} candidates - Scenario candidates
   * @param {object} topScenario - Best match
   * @param {string} urgency - Detected urgency
   */
  addTriageResult(candidates, topScenario, urgency) {
    if (!this._currentTurnBuilder) {
      logger.warn('[CONVERSATION MEMORY] No active turn for triage result', { 
        callId: this.callId 
      });
      return;
    }
    
    this._currentTurnBuilder.setTriage(candidates, topScenario, urgency);
    this._dirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTING DECISION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add routing decision to current turn
   * @param {string} handler - Selected handler
   * @param {array} why - Reasons for selection
   * @param {array} rejected - Rejected handlers
   */
  addRoutingDecision(handler, why, rejected = []) {
    if (!this._currentTurnBuilder) {
      logger.warn('[CONVERSATION MEMORY] No active turn for routing decision', { 
        callId: this.callId 
      });
      return;
    }
    
    this._currentTurnBuilder.setRouting(
      handler,
      why,
      rejected,
      this.phase.current,
      false // captureInjected - will be set separately if needed
    );
    
    this._dirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add response to current turn
   * @param {string} handler - Handler that generated response
   * @param {string} text - Response text
   * @param {number} latencyMs - Latency in ms
   * @param {array} actions - Actions taken
   */
  addResponse(handler, text, latencyMs, actions = []) {
    if (!this._currentTurnBuilder) {
      logger.warn('[CONVERSATION MEMORY] No active turn for response', { 
        callId: this.callId 
      });
      return;
    }
    
    this._currentTurnBuilder.setResponse(handler, text, latencyMs, 0, actions);
    this._dirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Transition to a new phase
   * @param {string} newPhase - New phase (GREETING, DISCOVERY, BOOKING, COMPLETE)
   * @param {string} reason - Reason for transition
   */
  transitionPhase(newPhase, reason) {
    if (!PHASES[newPhase]) {
      logger.warn('[CONVERSATION MEMORY] Invalid phase', { 
        newPhase, 
        callId: this.callId 
      });
      return;
    }
    
    const oldPhase = this.phase.current;
    
    this.phase = {
      current: newPhase,
      previous: oldPhase,
      transitionedAt: new Date().toISOString(),
      transitionReason: reason
    };
    
    // Update turn builder if active
    if (this._currentTurnBuilder) {
      this._currentTurnBuilder.delta.phaseChanged = true;
    }
    
    this._dirty = true;
    
    logger.info('[CONVERSATION MEMORY] Phase transitioned', { 
      callId: this.callId,
      from: oldPhase,
      to: newPhase,
      reason
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKING STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set booking consent detected
   * @param {number} turn - Turn when consent was detected
   */
  setBookingConsent(turn) {
    this.booking.consentDetected = true;
    this.booking.consentTurn = turn ?? this.turns.length;
    this._dirty = true;
    
    logger.info('[CONVERSATION MEMORY] Booking consent detected', { 
      callId: this.callId,
      turn: this.booking.consentTurn
    });
  }

  /**
   * Lock booking mode
   */
  lockBookingMode() {
    this.booking.modeLocked = true;
    this.transitionPhase(PHASES.BOOKING, 'booking_mode_locked');
    
    logger.info('[CONVERSATION MEMORY] Booking mode locked', { 
      callId: this.callId 
    });
  }

  /**
   * Set current booking step
   * @param {string} step - Current step
   */
  setBookingStep(step) {
    this.booking.currentStep = step;
    this._dirty = true;
  }

  /**
   * Complete a booking step
   * @param {string} step - Completed step
   */
  completeBookingStep(step) {
    if (!this.booking.completedSteps.includes(step)) {
      this.booking.completedSteps.push(step);
    }
    this.booking.remainingSteps = this.booking.remainingSteps.filter(s => s !== step);
    this._dirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPTURE PROGRESS (INTERNAL)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update capture progress when a fact is captured
   * @param {string} factId - Captured fact
   * @private
   */
  _updateCaptureProgress(factId) {
    // Check MUST
    if (this.captureProgress.must[factId] !== undefined) {
      this.captureProgress.must[factId] = { 
        captured: true, 
        turn: this.turns.length 
      };
      this.captureProgress.turnsWithoutProgress = 0;
    }
    // Check SHOULD
    else if (this.captureProgress.should[factId] !== undefined) {
      this.captureProgress.should[factId] = { 
        captured: true, 
        turn: this.turns.length 
      };
    }
    // Check NICE
    else if (this.captureProgress.nice[factId] !== undefined) {
      this.captureProgress.nice[factId] = { 
        captured: true, 
        turn: this.turns.length 
      };
    }
  }

  /**
   * Initialize capture goals from config
   * @param {object} config - V111 capture goals config
   */
  initCaptureGoals(config) {
    if (!config) return;
    
    const { must = {}, should = {}, nice = {} } = config;
    
    // Initialize MUST fields
    if (must.fields) {
      for (const field of must.fields) {
        this.captureProgress.must[field] = { captured: false, turn: null };
      }
    }
    
    // Initialize SHOULD fields
    if (should.fields) {
      for (const field of should.fields) {
        this.captureProgress.should[field] = { captured: false, turn: null };
      }
    }
    
    // Initialize NICE fields
    if (nice.fields) {
      for (const field of nice.fields) {
        this.captureProgress.nice[field] = { captured: false, turn: null };
      }
    }
    
    this._dirty = true;
  }

  /**
   * Increment turns without progress
   */
  incrementTurnsWithoutProgress() {
    this.captureProgress.turnsWithoutProgress++;
    this._dirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT FOR LLM
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get context window for LLM
   * @param {number} maxTurns - Maximum turns to include (default 6)
   * @returns {object} Context for LLM
   */
  getContextForLLM(maxTurns = 6) {
    // Get recent turns
    const recentTurns = this.turns.slice(-maxTurns);
    
    // Format for LLM
    const history = recentTurns.map(turn => ({
      role: 'user',
      content: turn.caller.cleaned
    })).concat(recentTurns.map(turn => ({
      role: 'assistant',
      content: turn.response.text
    })));
    
    // Interleave properly
    const interleaved = [];
    for (let i = 0; i < recentTurns.length; i++) {
      interleaved.push({
        role: 'user',
        content: recentTurns[i].caller.cleaned
      });
      if (recentTurns[i].response.text) {
        interleaved.push({
          role: 'assistant',
          content: recentTurns[i].response.text
        });
      }
    }
    
    return {
      facts: this.getFactsSimple(),
      phase: this.phase.current,
      bookingMode: this.booking.modeLocked,
      history: interleaved,
      turnCount: this.turns.length
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTCOME
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set call outcome (at call end)
   * @param {object} outcome - Outcome details
   */
  setOutcome(outcome) {
    this.outcome = {
      endReason: outcome.endReason || 'unknown',
      duration: outcome.duration || (Date.now() - new Date(this.startTime).getTime()),
      finalPhase: this.phase.current,
      bookingCompleted: this.booking.completedSteps.length > 0,
      factsCollected: Object.keys(this.facts),
      ...outcome
    };
    this._dirty = true;
    
    logger.info('[CONVERSATION MEMORY] Outcome set', { 
      callId: this.callId,
      outcome: this.outcome 
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save to Redis
   * @returns {Promise<boolean>} Success
   */
  async save() {
    if (!this.callId) {
      logger.warn('[CONVERSATION MEMORY] Cannot save - no callId');
      return false;
    }
    
    try {
      if (!isRedisConfigured()) {
        logger.debug('[CONVERSATION MEMORY] Redis not configured, skip save');
        return false;
      }
      
      const redis = await getSharedRedisClient();
      if (!redis) {
        logger.debug('[CONVERSATION MEMORY] Redis client unavailable');
        return false;
      }
      
      const key = `${REDIS_KEY_PREFIX}${this.callId}`;
      const data = JSON.stringify(this.toJSON());
      
      await redis.setEx(key, REDIS_TTL_SECONDS, data);
      
      this._dirty = false;
      
      logger.debug('[CONVERSATION MEMORY] Saved to Redis', { 
        callId: this.callId,
        turns: this.turns.length,
        ttl: REDIS_TTL_SECONDS
      });
      
      return true;
      
    } catch (error) {
      logger.error('[CONVERSATION MEMORY] Save failed', { 
        callId: this.callId,
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Delete from Redis
   * @returns {Promise<boolean>} Success
   */
  async delete() {
    if (!this.callId) return false;
    
    try {
      if (!isRedisConfigured()) return false;
      
      const redis = await getSharedRedisClient();
      if (!redis) return false;
      
      const key = `${REDIS_KEY_PREFIX}${this.callId}`;
      await redis.del(key);
      
      logger.debug('[CONVERSATION MEMORY] Deleted from Redis', { 
        callId: this.callId 
      });
      
      return true;
      
    } catch (error) {
      logger.warn('[CONVERSATION MEMORY] Delete failed', { 
        callId: this.callId,
        error: error.message 
      });
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SERIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Serialize to JSON
   * @returns {object}
   */
  toJSON() {
    return {
      _version: this._version,
      callId: this.callId,
      companyId: this.companyId,
      templateId: this.templateId,
      startTime: this.startTime,
      callerPhone: this.callerPhone,
      companyPhone: this.companyPhone,
      facts: this.facts,
      phase: this.phase,
      booking: this.booking,
      captureProgress: this.captureProgress,
      turns: this.turns,
      metrics: this.metrics,
      outcome: this.outcome,
      config: this.config  // Persist config for session continuity
    };
  }

  /**
   * Create from JSON
   * @param {object} data - JSON data
   * @returns {ConversationMemory}
   */
  static fromJSON(data) {
    return new ConversationMemory(data);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // V111 CONFIG MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  // These methods manage the V111 config loaded from company settings.
  // Config drives all governance decisions during the call.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set the V111 config (call early in session)
   * @param {object} config - V111 config from company settings
   */
  setConfig(config) {
    if (!config) {
      logger.debug('[CONVERSATION MEMORY] No config provided, using defaults', { 
        callId: this.callId 
      });
      return;
    }
    
    // Merge with defaults to ensure all fields exist
    this.config = {
      ...DEFAULT_V111_CONFIG,
      ...config,
      captureGoals: {
        ...DEFAULT_V111_CONFIG.captureGoals,
        ...config.captureGoals
      },
      contextWindow: {
        ...DEFAULT_V111_CONFIG.contextWindow,
        ...config.contextWindow
      },
      handlerGovernance: {
        ...DEFAULT_V111_CONFIG.handlerGovernance,
        ...config.handlerGovernance
      },
      routerRules: {
        ...DEFAULT_V111_CONFIG.routerRules,
        ...config.routerRules
      },
      blackbox: {
        ...DEFAULT_V111_CONFIG.blackbox,
        ...config.blackbox
      }
    };
    
    // Initialize capture progress from config
    this.initCaptureGoals(this.config.captureGoals);
    
    this._dirty = true;
    
    logger.info('[CONVERSATION MEMORY] 🎛️ Config loaded', { 
      callId: this.callId,
      enabled: this.config.enabled,
      mustCapture: this.config.captureGoals?.must?.fields,
      shouldCapture: this.config.captureGoals?.should?.fields,
      maxTurns: this.config.contextWindow?.maxTurns
    });
  }

  /**
   * Check if V111 is enabled for this company
   * @returns {boolean}
   */
  isV111Enabled() {
    return this.config?.enabled === true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLER GOVERNANCE
  // ═══════════════════════════════════════════════════════════════════════════
  // These methods enforce the handler governance rules from config.
  // Call these before selecting a handler to check if it's allowed.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if scenario handler should be used
   * @param {number} matchConfidence - Confidence score from scenario matching
   * @returns {object} { allowed, reason }
   */
  shouldUseScenarioHandler(matchConfidence = 0) {
    const gov = this.config?.handlerGovernance?.scenarioHandler || {};
    
    // Check if enabled
    if (gov.enabled === false) {
      return { 
        allowed: false, 
        reason: 'scenario_handler_disabled',
        debug: { gov }
      };
    }
    
    // Check minimum confidence
    const minConfidence = gov.minConfidence ?? 0.75;
    if (matchConfidence < minConfidence) {
      return { 
        allowed: false, 
        reason: 'confidence_below_threshold',
        debug: { matchConfidence, minConfidence }
      };
    }
    
    // Check booking mode restriction
    if (this.booking.modeLocked && gov.allowInBookingMode === false) {
      return { 
        allowed: false, 
        reason: 'blocked_in_booking_mode',
        debug: { bookingLocked: true, allowInBookingMode: gov.allowInBookingMode }
      };
    }
    
    return { 
      allowed: true, 
      reason: 'scenario_allowed',
      debug: { matchConfidence, minConfidence }
    };
  }

  /**
   * Check if booking handler should be used
   * @param {boolean} consentDetected - Was booking consent detected this turn?
   * @param {number} consentConfidence - Confidence of consent detection
   * @returns {object} { allowed, reason }
   */
  shouldUseBookingHandler(consentDetected = false, consentConfidence = 0) {
    const gov = this.config?.handlerGovernance?.bookingHandler || {};
    
    // Check if enabled
    if (gov.enabled === false) {
      return { 
        allowed: false, 
        reason: 'booking_handler_disabled',
        debug: { gov }
      };
    }
    
    // If already locked, always allow
    if (this.booking.modeLocked) {
      return { 
        allowed: true, 
        reason: 'booking_mode_locked',
        debug: { modeLocked: true }
      };
    }
    
    // Check consent requirement
    if (gov.requiresConsent !== false) {
      if (!consentDetected && !this.booking.consentDetected) {
        return { 
          allowed: false, 
          reason: 'no_consent',
          debug: { requiresConsent: true, consentDetected }
        };
      }
      
      // Check consent confidence
      const minConfidence = gov.consentConfidence ?? 0.8;
      if (consentDetected && consentConfidence < minConfidence) {
        return { 
          allowed: false, 
          reason: 'consent_confidence_low',
          debug: { consentConfidence, minConfidence }
        };
      }
    }
    
    return { 
      allowed: true, 
      reason: 'booking_allowed',
      debug: { consentDetected, modeLocked: this.booking.modeLocked }
    };
  }

  /**
   * Check if LLM handler should be used
   * @returns {object} { allowed, reason }
   */
  shouldUseLLMHandler() {
    const gov = this.config?.handlerGovernance?.llmHandler || {};
    
    // Check if enabled
    if (gov.enabled === false) {
      return { 
        allowed: false, 
        reason: 'llm_handler_disabled',
        debug: { gov }
      };
    }
    
    return { 
      allowed: true, 
      reason: gov.isDefaultFallback !== false ? 'llm_default_fallback' : 'llm_allowed',
      debug: { isDefaultFallback: gov.isDefaultFallback !== false }
    };
  }

  /**
   * Check if a handler is allowed to write facts
   * @param {string} handler - Handler name
   * @returns {boolean}
   */
  canHandlerWriteFacts(handler) {
    // Extractors and booking flow always can
    if (['EXTRACTOR', 'BOOKING', 'BOOKING_RUNNER'].includes(handler)) {
      return true;
    }
    
    // LLM check from config
    if (['LLM', 'LLM_DEFAULT'].includes(handler)) {
      return this.config?.handlerGovernance?.llmHandler?.canWriteFacts === true;
    }
    
    // Scenario handlers can write (they use extractors)
    if (['SCENARIO', 'SCENARIO_MATCHED'].includes(handler)) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if escalation should trigger
   * @param {string} trigger - The trigger type
   * @returns {object} { shouldEscalate, reason }
   */
  shouldTriggerEscalation(trigger) {
    const gov = this.config?.handlerGovernance?.escalationHandler || {};
    
    if (gov.enabled === false) {
      return { 
        shouldEscalate: false, 
        reason: 'escalation_disabled' 
      };
    }
    
    const triggers = gov.triggers || ['explicit_request', 'frustration_detected', 'loop_detected'];
    
    if (triggers.includes(trigger)) {
      this.metrics.escalationTriggered = true;
      return { 
        shouldEscalate: true, 
        reason: trigger 
      };
    }
    
    return { 
      shouldEscalate: false, 
      reason: 'trigger_not_configured' 
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPTURE GOAL TRACKING
  // ═══════════════════════════════════════════════════════════════════════════
  // These methods track progress toward configured capture goals.
  // Use these to determine if capture injection is needed.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get missing MUST fields
   * @returns {array} Array of field names not yet captured
   */
  getMissingMustFields() {
    const mustConfig = this.config?.captureGoals?.must?.fields || [];
    const missing = [];
    
    for (const field of mustConfig) {
      const progress = this.captureProgress.must[field];
      if (!progress?.captured && !this.hasFact(field)) {
        missing.push(field);
      }
    }
    
    return missing;
  }

  /**
   * Get missing SHOULD fields
   * @returns {array} Array of field names not yet captured
   */
  getMissingShouldFields() {
    const shouldConfig = this.config?.captureGoals?.should?.fields || [];
    const missing = [];
    
    for (const field of shouldConfig) {
      const progress = this.captureProgress.should[field];
      if (!progress?.captured && !this.hasFact(field)) {
        missing.push(field);
      }
    }
    
    return missing;
  }

  /**
   * Get all missing capture fields (MUST + SHOULD)
   * @returns {object} { must: [], should: [], nice: [] }
   */
  getMissingCaptureFields() {
    return {
      must: this.getMissingMustFields(),
      should: this.getMissingShouldFields(),
      nice: [] // Nice fields don't block
    };
  }

  /**
   * Check if capture injection should happen this turn
   * @returns {object} { inject, field, reason }
   */
  shouldInjectCapturePrompt() {
    const rules = this.config?.routerRules?.captureInjection || {};
    
    // Check if capture injection is enabled
    if (rules.enabled === false) {
      return { inject: false, field: null, reason: 'capture_injection_disabled' };
    }
    
    // Check turns without progress threshold
    const maxTurns = rules.maxTurnsWithoutProgress ?? 2;
    if (this.captureProgress.turnsWithoutProgress < maxTurns) {
      return { 
        inject: false, 
        field: null, 
        reason: 'progress_threshold_not_reached',
        debug: { 
          turnsWithoutProgress: this.captureProgress.turnsWithoutProgress, 
          maxTurns 
        }
      };
    }
    
    // Get first missing MUST field
    const missingMust = this.getMissingMustFields();
    if (missingMust.length > 0) {
      return { 
        inject: true, 
        field: missingMust[0], 
        priority: 'must',
        reason: 'must_field_missing',
        debug: { missingMust }
      };
    }
    
    // Get first missing SHOULD field (only if in discovery phase)
    if (this.phase.current === PHASES.DISCOVERY) {
      const missingShould = this.getMissingShouldFields();
      if (missingShould.length > 0) {
        return { 
          inject: true, 
          field: missingShould[0], 
          priority: 'should',
          reason: 'should_field_missing',
          debug: { missingShould }
        };
      }
    }
    
    return { inject: false, field: null, reason: 'all_goals_met' };
  }

  /**
   * Get the next field to capture (for prompt generation)
   * @returns {object|null} { field, priority, prompt }
   */
  getNextCaptureField() {
    const missingMust = this.getMissingMustFields();
    if (missingMust.length > 0) {
      return {
        field: missingMust[0],
        priority: 'must',
        prompt: this._getFieldPrompt(missingMust[0])
      };
    }
    
    const missingShould = this.getMissingShouldFields();
    if (missingShould.length > 0) {
      return {
        field: missingShould[0],
        priority: 'should',
        prompt: this._getFieldPrompt(missingShould[0])
      };
    }
    
    return null;
  }

  /**
   * Get default prompt for a field
   * @param {string} field - Field name
   * @returns {string} Prompt text
   * @private
   */
  _getFieldPrompt(field) {
    // Default prompts for common fields
    const prompts = {
      name: 'May I have your name?',
      'name.first': 'May I have your first name?',
      'name.last': 'And your last name?',
      phone: 'What\'s the best number to reach you?',
      address: 'What\'s the service address?',
      issue: 'What can we help you with today?',
      email: 'And what\'s your email address?'
    };
    
    return prompts[field] || `Could you tell me your ${field}?`;
  }

  /**
   * Check if all MUST goals are met (for booking readiness)
   * @returns {boolean}
   */
  areMustGoalsMet() {
    const missing = this.getMissingMustFields();
    return missing.length === 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP DETECTION
  // ═══════════════════════════════════════════════════════════════════════════
  // Detects when the agent is repeating responses (stuck in a loop).
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check for response loop and track
   * @param {string} responseText - Current response text
   * @returns {object} { isLoop, consecutiveRepeats, action }
   */
  checkForResponseLoop(responseText) {
    const rules = this.config?.routerRules?.loopDetection || {};
    
    if (rules.enabled === false) {
      return { isLoop: false, consecutiveRepeats: 0, action: 'none' };
    }
    
    // Normalize for comparison
    const normalized = (responseText || '').toLowerCase().trim();
    const lastNormalized = (this._lastResponseText || '').toLowerCase().trim();
    
    // Check if same as last response
    if (normalized && normalized === lastNormalized) {
      this._consecutiveRepeats++;
    } else {
      this._consecutiveRepeats = 0;
    }
    
    this._lastResponseText = responseText;
    
    const maxRepeats = rules.maxRepeatedResponses ?? 2;
    const isLoop = this._consecutiveRepeats >= maxRepeats;
    
    if (isLoop) {
      const action = rules.onLoop || 'escalate';
      
      logger.warn('[CONVERSATION MEMORY] 🔄 Loop detected', { 
        callId: this.callId,
        consecutiveRepeats: this._consecutiveRepeats,
        maxRepeats,
        action
      });
      
      return { 
        isLoop: true, 
        consecutiveRepeats: this._consecutiveRepeats, 
        action 
      };
    }
    
    return { 
      isLoop: false, 
      consecutiveRepeats: this._consecutiveRepeats, 
      action: 'none' 
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENHANCED CONTEXT FOR LLM (CONFIG-DRIVEN)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get context window for LLM (uses config settings)
   * @param {number} maxTurnsOverride - Override max turns (optional)
   * @returns {object} Context for LLM
   */
  getContextForLLM(maxTurnsOverride = null) {
    // Use config settings
    const configWindow = this.config?.contextWindow || {};
    const maxTurns = maxTurnsOverride ?? configWindow.maxTurns ?? 6;
    const includeFacts = configWindow.alwaysIncludeFacts !== false;
    
    // Get recent turns
    const recentTurns = this.turns.slice(-maxTurns);
    
    // Build interleaved history
    const interleaved = [];
    for (let i = 0; i < recentTurns.length; i++) {
      interleaved.push({
        role: 'user',
        content: recentTurns[i].caller?.cleaned || recentTurns[i].caller?.raw || ''
      });
      if (recentTurns[i].response?.text) {
        interleaved.push({
          role: 'assistant',
          content: recentTurns[i].response.text
        });
      }
    }
    
    // Build context
    const context = {
      phase: this.phase.current,
      bookingMode: this.booking.modeLocked,
      turnCount: this.turns.length,
      history: interleaved,
      configMaxTurns: maxTurns
    };
    
    // Include facts if configured
    if (includeFacts) {
      context.facts = this.getFactsSimple();
    }
    
    // Include capture progress summary
    context.captureStatus = {
      missingMust: this.getMissingMustFields(),
      missingShould: this.getMissingShouldFields(),
      turnsWithoutProgress: this.captureProgress.turnsWithoutProgress
    };
    
    return context;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUG HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get full debug state for logging
   * @returns {object}
   */
  getDebugState() {
    return {
      callId: this.callId,
      companyId: this.companyId,
      v111Enabled: this.isV111Enabled(),
      phase: this.phase.current,
      bookingLocked: this.booking.modeLocked,
      factsCount: Object.keys(this.facts).length,
      turnsCount: this.turns.length,
      captureProgress: {
        missingMust: this.getMissingMustFields(),
        missingShould: this.getMissingShouldFields(),
        turnsWithoutProgress: this.captureProgress.turnsWithoutProgress
      },
      metrics: this.metrics,
      config: {
        enabled: this.config?.enabled,
        maxTurns: this.config?.contextWindow?.maxTurns,
        captureGoals: {
          must: this.config?.captureGoals?.must?.fields,
          should: this.config?.captureGoals?.should?.fields
        }
      }
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  ConversationMemory,
  PHASES,
  VALID_SOURCES,
  VERSION,
  REDIS_KEY_PREFIX,
  REDIS_TTL_SECONDS,
  DEFAULT_V111_CONFIG
};
