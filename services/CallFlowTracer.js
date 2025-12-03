/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL FLOW TRACER - Real-time call journey tracking
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Provides clear, structured logging for every step of a Twilio call.
 * Makes it easy to understand: WHERE the call is → WHAT happened → WHERE it goes next
 * 
 * Usage:
 *   const tracer = new CallFlowTracer(callSid, companyId);
 *   tracer.step('GREETING', 'Playing initial greeting');
 *   tracer.step('GATHER', 'Waiting for caller speech');
 *   tracer.step('AI_PROCESSING', 'Brain-1 analyzing input');
 *   tracer.decision('ROUTE_TO_SCENARIO', { scenario: 'AC Not Cooling' });
 *   tracer.step('RESPONSE', 'Speaking AI response');
 *   tracer.complete('CONTINUE');
 */

const logger = require('../utils/logger');

// Call flow stages in order
const STAGES = {
  INCOMING: '📞 INCOMING',
  SPAM_CHECK: '🛡️ SPAM_CHECK',
  CUSTOMER_LOOKUP: '👤 CUSTOMER_LOOKUP',
  GREETING: '👋 GREETING',
  GATHER_START: '🎤 GATHER_START',
  SPEECH_RECEIVED: '🗣️ SPEECH_RECEIVED',
  PREPROCESSING: '🧹 PREPROCESSING',
  BRAIN1_START: '🧠 BRAIN-1 START',
  BRAIN1_DECISION: '🎯 BRAIN-1 DECISION',
  TRIAGE_CHECK: '📋 TRIAGE_CHECK',
  BRAIN2_START: '🤖 BRAIN-2 START',
  BRAIN2_RESULT: '📦 BRAIN-2 RESULT',
  RESPONSE_BUILD: '🔧 RESPONSE_BUILD',
  TTS_START: '🎤 TTS_START',
  TTS_COMPLETE: '✅ TTS_COMPLETE',
  TWIML_SEND: '📤 TWIML_SEND',
  TRANSFER: '📲 TRANSFER',
  HANGUP: '📴 HANGUP',
  ERROR: '❌ ERROR',
  COMPLETE: '✅ COMPLETE'
};

const ACTIONS = {
  RUN_SCENARIO: 'Route to Brain-2 (3-Tier)',
  BOOK_APPOINTMENT: 'Booking flow',
  TRANSFER: 'Transfer to human',
  TAKE_MESSAGE: 'Take message',
  END_CALL: 'End call',
  ASK_FOLLOWUP: 'Ask follow-up question',
  CONTINUE: 'Continue conversation'
};

class CallFlowTracer {
  constructor(callSid, companyId, callerPhone = null) {
    this.callSid = callSid?.substring(0, 12) || 'UNKNOWN'; // Shortened for readability
    this.companyId = companyId?.substring(0, 8) || 'UNKNOWN';
    this.callerPhone = callerPhone?.substring(-4) || '****'; // Last 4 digits only
    this.startTime = Date.now();
    this.steps = [];
    this.turnNumber = 0;
    
    this._log('═'.repeat(70));
    this._log(`📞 CALL STARTED | SID: ${this.callSid}... | Company: ${this.companyId}...`);
    this._log(`   Caller: ...${this.callerPhone} | Time: ${new Date().toLocaleTimeString()}`);
    this._log('═'.repeat(70));
  }

  /**
   * Log a step in the call flow
   */
  step(stage, message, data = null) {
    const elapsed = Date.now() - this.startTime;
    const stageIcon = STAGES[stage] || `📍 ${stage}`;
    
    this.steps.push({ stage, message, elapsed, data });
    
    let logLine = `[${elapsed}ms] ${stageIcon}: ${message}`;
    if (data) {
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
      if (dataStr.length < 100) {
        logLine += ` | ${dataStr}`;
      }
    }
    
    this._log(logLine);
    
    // Also log to structured logger for production monitoring
    logger.info(`[CALL FLOW] ${stage}`, {
      callSid: this.callSid,
      companyId: this.companyId,
      stage,
      message,
      elapsedMs: elapsed,
      data
    });
  }

  /**
   * Log the start of a new turn (caller spoke)
   */
  newTurn(speechText) {
    this.turnNumber++;
    this._log('─'.repeat(70));
    this._log(`🔄 TURN ${this.turnNumber} | Caller said: "${speechText?.substring(0, 60)}${speechText?.length > 60 ? '...' : ''}"`);
    this._log('─'.repeat(70));
  }

  /**
   * Log a decision point
   */
  decision(action, details = {}) {
    const elapsed = Date.now() - this.startTime;
    const actionDesc = ACTIONS[action] || action;
    
    this._log(`[${elapsed}ms] 🎯 DECISION: ${actionDesc}`);
    
    if (details.intent) this._log(`   Intent: ${details.intent}`);
    if (details.scenario) this._log(`   Scenario: ${details.scenario}`);
    if (details.confidence) this._log(`   Confidence: ${(details.confidence * 100).toFixed(1)}%`);
    if (details.tier) this._log(`   Tier: ${details.tier}`);
    if (details.transferTo) this._log(`   Transfer To: ${details.transferTo}`);
    
    logger.info(`[CALL FLOW] DECISION`, {
      callSid: this.callSid,
      companyId: this.companyId,
      action,
      actionDesc,
      details,
      elapsedMs: elapsed
    });
  }

  /**
   * Log AI response
   */
  response(responseText, metadata = {}) {
    const elapsed = Date.now() - this.startTime;
    const preview = responseText?.substring(0, 80) || 'No response';
    
    this._log(`[${elapsed}ms] 💬 AI RESPONSE: "${preview}${responseText?.length > 80 ? '...' : ''}"`);
    
    if (metadata.voiceSource) this._log(`   Voice: ${metadata.voiceSource}`);
    if (metadata.ttsTime) this._log(`   TTS Time: ${metadata.ttsTime}ms`);
  }

  /**
   * Log an error
   */
  error(message, error = null) {
    const elapsed = Date.now() - this.startTime;
    
    this._log(`[${elapsed}ms] ❌ ERROR: ${message}`);
    if (error?.message) this._log(`   Details: ${error.message}`);
    
    logger.error(`[CALL FLOW] ERROR`, {
      callSid: this.callSid,
      companyId: this.companyId,
      message,
      error: error?.message,
      stack: error?.stack?.substring(0, 500),
      elapsedMs: elapsed
    });
  }

  /**
   * Log call completion
   */
  complete(outcome, summary = '') {
    const elapsed = Date.now() - this.startTime;
    
    this._log('═'.repeat(70));
    this._log(`✅ CALL COMPLETE | Outcome: ${outcome} | Total: ${elapsed}ms | Turns: ${this.turnNumber}`);
    if (summary) this._log(`   Summary: ${summary}`);
    this._log('═'.repeat(70));
    
    logger.info(`[CALL FLOW] COMPLETE`, {
      callSid: this.callSid,
      companyId: this.companyId,
      outcome,
      summary,
      totalMs: elapsed,
      turnCount: this.turnNumber,
      stepCount: this.steps.length
    });
  }

  /**
   * Get a summary of the call flow
   */
  getSummary() {
    return {
      callSid: this.callSid,
      companyId: this.companyId,
      turnCount: this.turnNumber,
      totalMs: Date.now() - this.startTime,
      steps: this.steps
    };
  }

  _log(message) {
    console.log(`[CALL ${this.callSid}] ${message}`);
  }
}

// Store active tracers by callSid
const activeTracers = new Map();

/**
 * Get or create a tracer for a call
 */
function getTracer(callSid, companyId, callerPhone) {
  if (!activeTracers.has(callSid)) {
    activeTracers.set(callSid, new CallFlowTracer(callSid, companyId, callerPhone));
  }
  return activeTracers.get(callSid);
}

/**
 * Remove a tracer when call ends
 */
function removeTracer(callSid) {
  if (activeTracers.has(callSid)) {
    const tracer = activeTracers.get(callSid);
    activeTracers.delete(callSid);
    return tracer.getSummary();
  }
  return null;
}

module.exports = {
  CallFlowTracer,
  getTracer,
  removeTracer,
  STAGES,
  ACTIONS
};

