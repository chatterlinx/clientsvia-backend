/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * V111 ROUTER - Config-Driven Handler Selection & Capture Injection
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * The governance brain for V111 Conversation Memory.
 * 
 * RESPONSIBILITIES:
 * 1. Select handler based on governance rules (not just matching scores)
 * 2. Inject capture prompts when progress stalls
 * 3. Detect loops and trigger escalation
 * 4. Enforce booking consent requirements
 * 
 * PRINCIPLES:
 * - Config is law: Everything comes from company.conversationMemory config
 * - Fail open: If unsure, allow handler (don't break calls)
 * - Log everything: Full audit trail for debugging
 * - Non-invasive: Can be disabled per-company
 * 
 * INTEGRATION:
 * - Called by FrontDeskRuntime before handler selection
 * - Receives ConversationMemory instance
 * - Returns routing decision + optional capture injection
 * 
 * SPEC: docs/architecture/V111-ConversationMemory-Spec.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const VERSION = 'v111.router.1';

// Handler types (normalized names)
const HANDLERS = {
  SCENARIO: 'SCENARIO',
  BOOKING: 'BOOKING',
  LLM: 'LLM',
  ESCALATION: 'ESCALATION',
  CAPTURE_INJECTION: 'CAPTURE_INJECTION'  // Special: prompts for missing field
};

// Routing decision reasons
const REASONS = {
  // Allow reasons
  SCENARIO_MATCH: 'scenario_matched_above_threshold',
  BOOKING_LOCKED: 'booking_mode_locked',
  BOOKING_CONSENT: 'booking_consent_detected',
  LLM_FALLBACK: 'llm_default_fallback',
  CAPTURE_NEEDED: 'capture_injection_required',
  
  // Block reasons
  SCENARIO_LOW_CONFIDENCE: 'scenario_confidence_below_threshold',
  SCENARIO_IN_BOOKING: 'scenario_blocked_in_booking_mode',
  SCENARIO_DISABLED: 'scenario_handler_disabled',
  BOOKING_NO_CONSENT: 'booking_requires_consent',
  BOOKING_DISABLED: 'booking_handler_disabled',
  LLM_DISABLED: 'llm_handler_disabled',
  
  // Escalation reasons
  EXPLICIT_REQUEST: 'explicit_escalation_request',
  FRUSTRATION: 'frustration_detected',
  LOOP_DETECTED: 'response_loop_detected',
  ESCALATION_DISABLED: 'escalation_handler_disabled'
};

// ═══════════════════════════════════════════════════════════════════════════════
// V111 ROUTER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class V111Router {
  /**
   * Create a V111Router instance
   * @param {ConversationMemory} memory - The conversation memory instance
   * @param {object} options - Additional options
   */
  constructor(memory, options = {}) {
    this.memory = memory;
    this.options = options;
    this.callId = memory?.callId || options.callId || 'unknown';
    this._decisions = [];  // Audit trail
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Route the current turn - main entry point
   * @param {object} context - Routing context
   * @param {object} context.scenarioMatch - Scenario matching result { confidence, scenario }
   * @param {object} context.consentSignal - Consent detection { detected, confidence }
   * @param {object} context.escalationSignal - Escalation signals { explicit, frustration }
   * @param {string} context.currentResponse - The response about to be sent
   * @returns {object} Routing decision
   */
  route(context = {}) {
    const startTime = Date.now();
    
    // Check if V111 is enabled
    if (!this.memory?.isV111Enabled?.()) {
      return this._passthrough(context, 'v111_disabled');
    }

    const decision = {
      version: VERSION,
      callId: this.callId,
      turn: this.memory?.turns?.length || 0,
      timestamp: new Date().toISOString(),
      handler: null,
      allowed: true,
      reason: null,
      captureInjection: null,
      escalation: null,
      governance: [],
      debug: {}
    };

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STEP 1: Check for escalation triggers (highest priority)
      // ─────────────────────────────────────────────────────────────────────
      const escalationResult = this._checkEscalation(context);
      if (escalationResult.shouldEscalate) {
        decision.handler = HANDLERS.ESCALATION;
        decision.reason = escalationResult.reason;
        decision.escalation = escalationResult;
        decision.governance.push({ step: 'escalation_check', result: 'triggered', reason: escalationResult.reason });
        
        this._logDecision(decision, startTime);
        return decision;
      }
      decision.governance.push({ step: 'escalation_check', result: 'not_triggered' });

      // ─────────────────────────────────────────────────────────────────────
      // STEP 2: Check if booking mode is locked (takes over)
      // ─────────────────────────────────────────────────────────────────────
      if (this.memory?.booking?.modeLocked) {
        const bookingCheck = this.memory.shouldUseBookingHandler(true, 1.0);
        if (bookingCheck.allowed) {
          decision.handler = HANDLERS.BOOKING;
          decision.reason = REASONS.BOOKING_LOCKED;
          decision.governance.push({ step: 'booking_lock_check', result: 'locked', allowed: true });
          
          this._logDecision(decision, startTime);
          return decision;
        }
      }
      decision.governance.push({ step: 'booking_lock_check', result: 'not_locked' });

      // ─────────────────────────────────────────────────────────────────────
      // STEP 3: Check for capture injection (before scenario/LLM)
      // ─────────────────────────────────────────────────────────────────────
      const captureCheck = this._checkCaptureInjection();
      if (captureCheck.inject) {
        decision.handler = HANDLERS.CAPTURE_INJECTION;
        decision.reason = REASONS.CAPTURE_NEEDED;
        decision.captureInjection = captureCheck;
        decision.governance.push({ 
          step: 'capture_injection_check', 
          result: 'inject', 
          field: captureCheck.field,
          priority: captureCheck.priority
        });
        
        this._logDecision(decision, startTime);
        return decision;
      }
      decision.governance.push({ step: 'capture_injection_check', result: 'not_needed' });

      // ─────────────────────────────────────────────────────────────────────
      // STEP 4: Check for booking consent (might start booking)
      // ─────────────────────────────────────────────────────────────────────
      if (context.consentSignal?.detected) {
        const bookingCheck = this.memory.shouldUseBookingHandler(
          true, 
          context.consentSignal.confidence || 0.8
        );
        
        if (bookingCheck.allowed) {
          decision.handler = HANDLERS.BOOKING;
          decision.reason = REASONS.BOOKING_CONSENT;
          decision.governance.push({ 
            step: 'consent_check', 
            result: 'consent_detected', 
            allowed: true,
            confidence: context.consentSignal.confidence
          });
          
          // Lock booking mode if configured
          if (this.memory.config?.handlerGovernance?.bookingHandler?.lockAfterConsent !== false) {
            this.memory.lockBookingMode();
          }
          
          this._logDecision(decision, startTime);
          return decision;
        } else {
          decision.governance.push({ 
            step: 'consent_check', 
            result: 'consent_rejected',
            reason: bookingCheck.reason
          });
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 5: Check scenario match
      // ─────────────────────────────────────────────────────────────────────
      if (context.scenarioMatch?.confidence > 0) {
        const scenarioCheck = this.memory.shouldUseScenarioHandler(
          context.scenarioMatch.confidence
        );
        
        if (scenarioCheck.allowed) {
          decision.handler = HANDLERS.SCENARIO;
          decision.reason = REASONS.SCENARIO_MATCH;
          decision.governance.push({ 
            step: 'scenario_check', 
            result: 'matched',
            confidence: context.scenarioMatch.confidence,
            scenario: context.scenarioMatch.scenario?.name
          });
          
          this._logDecision(decision, startTime);
          return decision;
        } else {
          decision.governance.push({ 
            step: 'scenario_check', 
            result: 'rejected',
            reason: scenarioCheck.reason,
            confidence: context.scenarioMatch.confidence
          });
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 6: Fall back to LLM (default)
      // ─────────────────────────────────────────────────────────────────────
      const llmCheck = this.memory.shouldUseLLMHandler();
      if (llmCheck.allowed) {
        decision.handler = HANDLERS.LLM;
        decision.reason = REASONS.LLM_FALLBACK;
        decision.governance.push({ step: 'llm_fallback', result: 'allowed' });
      } else {
        // LLM disabled - this is unusual, log warning
        logger.warn('[V111 ROUTER] LLM handler disabled with no alternative', {
          callId: this.callId,
          reason: llmCheck.reason
        });
        
        decision.handler = HANDLERS.LLM;  // Allow anyway (fail open)
        decision.reason = 'llm_fail_open';
        decision.governance.push({ 
          step: 'llm_fallback', 
          result: 'fail_open',
          reason: llmCheck.reason
        });
      }

      this._logDecision(decision, startTime);
      return decision;

    } catch (error) {
      // On any error, fail open and log
      logger.error('[V111 ROUTER] Routing error - failing open', {
        callId: this.callId,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join(' | ')
      });

      return this._passthrough(context, 'routing_error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCALATION DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if escalation should be triggered
   * @param {object} context - Routing context
   * @returns {object} { shouldEscalate, reason, trigger }
   * @private
   */
  _checkEscalation(context) {
    // Check explicit escalation request
    if (context.escalationSignal?.explicit) {
      const check = this.memory.shouldTriggerEscalation('explicit_request');
      if (check.shouldEscalate) {
        return { 
          shouldEscalate: true, 
          reason: REASONS.EXPLICIT_REQUEST,
          trigger: 'explicit_request'
        };
      }
    }

    // Check frustration
    if (context.escalationSignal?.frustration) {
      const check = this.memory.shouldTriggerEscalation('frustration_detected');
      if (check.shouldEscalate) {
        return { 
          shouldEscalate: true, 
          reason: REASONS.FRUSTRATION,
          trigger: 'frustration_detected'
        };
      }
    }

    // Check response loop
    if (context.currentResponse) {
      const loopCheck = this.memory.checkForResponseLoop(context.currentResponse);
      if (loopCheck.isLoop) {
        const check = this.memory.shouldTriggerEscalation('loop_detected');
        if (check.shouldEscalate) {
          return { 
            shouldEscalate: true, 
            reason: REASONS.LOOP_DETECTED,
            trigger: 'loop_detected',
            consecutiveRepeats: loopCheck.consecutiveRepeats
          };
        }
      }
    }

    return { shouldEscalate: false };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPTURE INJECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if capture injection should happen
   * @returns {object} { inject, field, priority, prompt }
   * @private
   */
  _checkCaptureInjection() {
    const check = this.memory.shouldInjectCapturePrompt();
    
    if (!check.inject) {
      return { inject: false };
    }

    // Get the prompt for the missing field
    const nextField = this.memory.getNextCaptureField();
    
    return {
      inject: true,
      field: check.field,
      priority: check.priority,
      prompt: nextField?.prompt || `Could you tell me your ${check.field}?`,
      reason: check.reason
    };
  }

  /**
   * Apply capture injection to a response
   * @param {string} originalResponse - The original response text
   * @param {object} captureInjection - The capture injection details
   * @returns {string} Modified response with capture prompt
   */
  applyCaptureInjection(originalResponse, captureInjection) {
    if (!captureInjection?.inject || !captureInjection.prompt) {
      return originalResponse;
    }

    // If there's already a response, append the capture prompt
    if (originalResponse && originalResponse.trim()) {
      // Add a natural transition
      const transitions = [
        'By the way,',
        'Also,',
        'Before we continue,',
        'Just to make sure I have this right,'
      ];
      const transition = transitions[Math.floor(Math.random() * transitions.length)];
      
      return `${originalResponse.trim()} ${transition} ${captureInjection.prompt}`;
    }

    // If no response, just use the capture prompt
    return captureInjection.prompt;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Passthrough - when V111 is disabled or errors
   * @param {object} context - Context
   * @param {string} reason - Reason for passthrough
   * @returns {object} Decision allowing everything
   * @private
   */
  _passthrough(context, reason) {
    return {
      version: VERSION,
      callId: this.callId,
      handler: null,  // Let original routing decide
      allowed: true,
      passthrough: true,
      reason,
      captureInjection: null,
      escalation: null,
      governance: []
    };
  }

  /**
   * Log the routing decision
   * @param {object} decision - The decision made
   * @param {number} startTime - When routing started
   * @private
   */
  _logDecision(decision, startTime) {
    decision.durationMs = Date.now() - startTime;
    this._decisions.push(decision);

    logger.info('[V111 ROUTER] 🎯 Routing decision', {
      callId: this.callId,
      turn: decision.turn,
      handler: decision.handler,
      reason: decision.reason,
      captureInjection: decision.captureInjection?.field || null,
      escalation: decision.escalation?.trigger || null,
      durationMs: decision.durationMs
    });
  }

  /**
   * Get audit trail of all decisions
   * @returns {array} All decisions made
   */
  getDecisions() {
    return this._decisions;
  }

  /**
   * Get the last decision
   * @returns {object|null} Last decision
   */
  getLastDecision() {
    return this._decisions[this._decisions.length - 1] || null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a router for a turn
 * @param {ConversationMemory} memory - Memory instance
 * @param {object} options - Options
 * @returns {V111Router}
 */
function createRouter(memory, options = {}) {
  return new V111Router(memory, options);
}

/**
 * Quick route - one-shot routing
 * @param {ConversationMemory} memory - Memory instance  
 * @param {object} context - Routing context
 * @returns {object} Routing decision
 */
function quickRoute(memory, context = {}) {
  const router = new V111Router(memory);
  return router.route(context);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  V111Router,
  createRouter,
  quickRoute,
  HANDLERS,
  REASONS,
  VERSION
};
