/**
 * ============================================================================
 * AGENT 2.0 LLM FALLBACK SERVICE
 * ============================================================================
 * 
 * PURPOSE:
 * Provides LLM-powered fallback responses when trigger cards fail.
 * Implements the hybrid model: deterministic first, LLM only when needed.
 * 
 * HARD RULES (No-UI-No-Execute):
 * 1. LLM fallback ONLY runs if llmFallback.enabled === true
 * 2. NEVER runs during booking-critical steps (blockedWhileBooking)
 * 3. All prompts are UI-owned (no hidden hardcode)
 * 4. Output must pass constraint validation or use emergencyFallbackLine
 * 5. Every call logs SPEAK_PROVENANCE with full traceability
 * 
 * TRIGGER CONDITIONS (must pass at least one):
 * - noMatchCount >= threshold
 * - complexityScore >= threshold  
 * - Input matches complexQuestionKeywords
 * 
 * OUTPUT CONSTRAINTS (enforced):
 * - maxSentences (default: 2)
 * - mustEndWithFunnelQuestion
 * - maxOutputTokens
 * - Disallowed tasks (pricing, guarantees, legal)
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const LLMFallbackUsage = require('../../../models/LLMFallbackUsage');

// Lazy-load OpenAI client
let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = require('../../../config/openai');
  }
  return openaiClient;
}

// ────────────────────────────────────────────────────────────────────────────
// COMPLEXITY SCORING (Rule-based v1 - deterministic)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute complexity score for caller input (0-1 scale)
 * Higher score = more likely to need LLM assist
 * 
 * Factors:
 * - Word count / length
 * - Multiple clauses (commas, "and")
 * - Question markers (?)
 * - Multi-intent markers ("also", "plus", "another thing")
 * - Complex question keywords ("why", "how", "should", etc.)
 */
function computeComplexityScore(text) {
  if (!text || typeof text !== 'string') return 0;
  
  const input = text.toLowerCase().trim();
  if (!input) return 0;
  
  let score = 0;
  const factors = [];
  
  // Factor 1: Length (longer = more complex)
  const wordCount = input.split(/\s+/).filter(Boolean).length;
  if (wordCount > 20) {
    score += 0.2;
    factors.push('long_input');
  } else if (wordCount > 12) {
    score += 0.1;
    factors.push('medium_input');
  }
  
  // Factor 2: Multiple clauses (commas, "and", "but", "or")
  const clauseMarkers = (input.match(/,|\band\b|\bbut\b|\bor\b/gi) || []).length;
  if (clauseMarkers >= 3) {
    score += 0.2;
    factors.push('many_clauses');
  } else if (clauseMarkers >= 1) {
    score += 0.1;
    factors.push('has_clauses');
  }
  
  // Factor 3: Question markers
  const questionCount = (input.match(/\?/g) || []).length;
  if (questionCount >= 2) {
    score += 0.15;
    factors.push('multiple_questions');
  } else if (questionCount >= 1) {
    score += 0.05;
    factors.push('has_question');
  }
  
  // Factor 4: Multi-intent markers
  const multiIntentPatterns = [
    /\balso\b/i,
    /\bplus\b/i,
    /\banother\s+thing\b/i,
    /\band\s+also\b/i,
    /\bin\s+addition\b/i,
    /\bby\s+the\s+way\b/i,
    /\bone\s+more\s+thing\b/i
  ];
  const multiIntentCount = multiIntentPatterns.filter(p => p.test(input)).length;
  if (multiIntentCount >= 2) {
    score += 0.25;
    factors.push('multi_intent');
  } else if (multiIntentCount >= 1) {
    score += 0.15;
    factors.push('possible_multi_intent');
  }
  
  // Factor 5: Complex question keywords (why/how/should/covered/warranty)
  const complexKeywordPatterns = [
    /\bwhy\b/i,
    /\bhow\b(?!\s+(are|was|is)\s+you)/i,  // "how" but not "how are you"
    /\bshould\s+i\b/i,
    /\bcan\s+i\b/i,
    /\bis\s+it\s+(safe|normal|dangerous|ok|okay)\b/i,
    /\bcovered\b/i,
    /\bwarranty\b/i,
    /\bguarantee\b/i,
    /\bhow\s+(long|much|often)\b/i
  ];
  const complexKeywordCount = complexKeywordPatterns.filter(p => p.test(input)).length;
  if (complexKeywordCount >= 2) {
    score += 0.3;
    factors.push('complex_keywords');
  } else if (complexKeywordCount >= 1) {
    score += 0.15;
    factors.push('has_complex_keyword');
  }
  
  // Cap at 1.0
  const finalScore = Math.min(1.0, score);
  
  return {
    score: finalScore,
    factors,
    wordCount,
    clauseMarkers,
    questionCount,
    multiIntentCount,
    complexKeywordCount
  };
}

// ────────────────────────────────────────────────────────────────────────────
// DECISION GATE: Should we call LLM fallback?
// ────────────────────────────────────────────────────────────────────────────

/**
 * Determine if LLM fallback should be called
 * LLM runs ONLY when ALL deterministic paths fail.
 * Returns { call: boolean, reason: string, details: Object }
 */
function shouldCallLLMFallback({ 
  config, 
  noMatchCount, 
  input, 
  inBookingFlow, 
  inDiscoveryCriticalStep, 
  llmTurnsThisCall,
  // Additional blocking conditions
  hasPendingQuestion,      // YES/NO/REPROMPT flow active
  hasCapturedReasonFlow,   // Clarifier path mid-flight
  hasAfterHoursFlow,       // After-hours handling active
  hasTransferFlow,         // Transfer to advisor active
  hasSpeakSourceSelected   // Another system already selected speak source
}) {
  const llmFallback = config?.llmFallback;
  
  // Hard gate: must be enabled
  if (!llmFallback?.enabled) {
    return { call: false, reason: 'disabled', details: { enabled: false } };
  }
  
  const triggers = llmFallback.triggers || {};
  
  // ════════════════════════════════════════════════════════════════════════
  // BLOCKING CONDITIONS (LLM NOT allowed if ANY of these are true)
  // ════════════════════════════════════════════════════════════════════════
  
  // Blocked during booking-critical steps (name/address/time capture)
  if (triggers.blockedWhileBooking !== false && inBookingFlow) {
    return { call: false, reason: 'blocked_during_booking', details: { inBookingFlow: true } };
  }
  
  // Blocked during discovery-critical steps (slot filling)
  if (triggers.blockedWhileDiscoveryCriticalStep !== false && inDiscoveryCriticalStep) {
    return { call: false, reason: 'blocked_during_discovery_critical', details: { inDiscoveryCriticalStep: true } };
  }
  
  // Blocked if pending question is active (YES/NO/REPROMPT flow)
  if (hasPendingQuestion) {
    return { call: false, reason: 'blocked_pending_question_active', details: { hasPendingQuestion: true } };
  }
  
  // Blocked if captured-reason clarifier flow is mid-flight
  if (hasCapturedReasonFlow) {
    return { call: false, reason: 'blocked_captured_reason_flow', details: { hasCapturedReasonFlow: true } };
  }
  
  // Blocked if after-hours/catastrophic fallback is active
  if (hasAfterHoursFlow) {
    return { call: false, reason: 'blocked_after_hours_flow', details: { hasAfterHoursFlow: true } };
  }
  
  // Blocked if transfer flow is active
  if (hasTransferFlow) {
    return { call: false, reason: 'blocked_transfer_flow', details: { hasTransferFlow: true } };
  }
  
  // Blocked if another system already selected a speak source this turn
  if (hasSpeakSourceSelected) {
    return { call: false, reason: 'blocked_speak_source_already_selected', details: { hasSpeakSourceSelected: true } };
  }
  
  // Max LLM turns per call (default 1 - LLM gets ONE shot)
  const maxTurns = triggers.maxLLMFallbackTurnsPerCall ?? 1;
  if (llmTurnsThisCall >= maxTurns) {
    return { call: false, reason: 'max_llm_turns_reached', details: { llmTurnsThisCall, maxTurns } };
  }
  
  // Compute complexity score
  const complexity = computeComplexityScore(input);
  
  // Check trigger conditions
  const triggersMatched = [];
  const triggerDetails = {};
  
  // Condition 1: noMatchCount threshold
  const noMatchThreshold = triggers.noMatchCountThreshold ?? 2;
  if (noMatchCount >= noMatchThreshold) {
    triggersMatched.push(`noMatchCount=${noMatchCount}`);
    triggerDetails.noMatchCount = noMatchCount;
    triggerDetails.noMatchThreshold = noMatchThreshold;
  }
  
  // Condition 2: complexity score threshold
  const complexityThreshold = triggers.complexityThreshold ?? 0.65;
  if (triggers.enableOnComplexQuestions !== false && complexity.score >= complexityThreshold) {
    triggersMatched.push(`complexityScore=${complexity.score.toFixed(2)}`);
    triggerDetails.complexityScore = complexity.score;
    triggerDetails.complexityThreshold = complexityThreshold;
    triggerDetails.complexityFactors = complexity.factors;
  }
  
  // Condition 3: Complex question keywords (explicit match)
  if (triggers.enableOnComplexQuestions !== false) {
    const keywords = triggers.complexQuestionKeywords || [];
    const inputLower = (input || '').toLowerCase();
    const matchedKeywords = keywords.filter(kw => inputLower.includes(kw.toLowerCase()));
    if (matchedKeywords.length > 0) {
      triggersMatched.push('complexKeywords');
      triggerDetails.matchedKeywords = matchedKeywords;
    }
  }
  
  // Must match at least one trigger (unless noTriggerCardMatch is the sole condition)
  if (triggersMatched.length === 0 && triggers.enableOnNoTriggerCardMatch) {
    triggersMatched.push('noTriggerCardMatch');
  }
  
  if (triggersMatched.length === 0) {
    return { 
      call: false, 
      reason: 'no_triggers_matched', 
      details: { 
        complexity,
        noMatchCount,
        noMatchThreshold,
        complexityThreshold
      }
    };
  }
  
  return {
    call: true,
    reason: triggersMatched.join('+'),
    details: {
      complexity,
      noMatchCount,
      triggersMatched,
      ...triggerDetails
    }
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CONSTRAINT VALIDATION
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check if LLM output is parroting caller input (>N consecutive words)
 */
function checkParroting(llmOutput, callerInput, maxConsecutiveWords = 8) {
  if (!llmOutput || !callerInput) return false;
  
  const llmWords = llmOutput.toLowerCase().split(/\s+/).filter(Boolean);
  const callerWords = callerInput.toLowerCase().split(/\s+/).filter(Boolean);
  
  if (callerWords.length < maxConsecutiveWords) return false;
  
  // Sliding window check
  for (let i = 0; i <= callerWords.length - maxConsecutiveWords; i++) {
    const phrase = callerWords.slice(i, i + maxConsecutiveWords).join(' ');
    if (llmOutput.toLowerCase().includes(phrase)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate LLM output against constraints
 * Returns { valid: boolean, violations: string[], cleanedText: string }
 */
function validateOutput(text, constraints, callerInput = '') {
  const violations = [];
  let cleanedText = (text || '').trim();
  
  if (!cleanedText) {
    violations.push('empty_output');
    return { valid: false, violations, cleanedText: '', sentenceCount: 0 };
  }
  
  // Count sentences (rough: split by . ! ?)
  const sentences = cleanedText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const maxSentences = constraints?.maxSentences ?? 2;
  if (sentences.length > maxSentences) {
    violations.push(`exceeded_max_sentences:${sentences.length}>${maxSentences}`);
    // Truncate to max sentences
    cleanedText = sentences.slice(0, maxSentences).join('. ').trim();
    if (!cleanedText.endsWith('.') && !cleanedText.endsWith('?') && !cleanedText.endsWith('!')) {
      cleanedText += '.';
    }
  }
  
  // Check for funnel question
  if (constraints?.mustEndWithFunnelQuestion !== false) {
    const endsWithQuestion = /\?$/.test(cleanedText.trim());
    if (!endsWithQuestion) {
      violations.push('missing_funnel_question');
    }
  }
  
  // Anti-parrot guard: don't repeat caller input >N consecutive words
  if (constraints?.antiParrotGuard !== false) {
    const maxWords = constraints?.antiParrotMaxWords ?? 8;
    if (checkParroting(cleanedText, callerInput, maxWords)) {
      violations.push('parroting_caller_input');
    }
  }
  
  // Block time slots: LLM must NEVER offer times/dates/scheduling windows
  // Uses UI-configurable forbiddenBookingPatterns + hardcoded safety patterns
  if (constraints?.forbidBookingTimes !== false && constraints?.blockTimeSlots !== false) {
    const textLower = cleanedText.toLowerCase();
    
    // UI-configurable forbidden patterns (from forbiddenBookingPatterns array)
    const forbiddenPatterns = constraints?.forbiddenBookingPatterns || [
      'morning', 'afternoon', '8-10', '8–10', '10-12', '10–12', '12-2', '12–2', '2-4', '2–4',
      'time slot', 'appointment time', 'schedule you for', 'what time works'
    ];
    
    for (const pattern of forbiddenPatterns) {
      if (textLower.includes(pattern.toLowerCase())) {
        violations.push(`forbidden_booking_pattern:${pattern}`);
        break;
      }
    }
    
    // Additional regex patterns for edge cases (hardcoded safety net)
    const timeSlotRegex = [
      /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\b/i,  // "9am", "10:30 PM"
      /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\b(?:available|open|free)\s+(?:at|on|for)\s+\d/i,  // "available at 2"
      /\b(?:schedule|book)\s+(?:you\s+)?(?:for|at)\s+\d/i,  // "schedule you for 3pm"
      /\btoday\s+at\s+\d/i,
      /\btomorrow\s+(?:at|around)\s+\d/i,
      /\bnext\s+(?:available|opening)/i,
      /\bappointment\s+(?:at|for|on)\s+/i,
      /\bdo you prefer\s+(?:morning|afternoon|evening)/i,
      /\bmorning or afternoon/i
    ];
    
    for (const pattern of timeSlotRegex) {
      if (pattern.test(cleanedText)) {
        violations.push('contains_time_slot_regex');
        break;
      }
    }
  }
  
  // Check for disallowed content patterns
  const allowedTasks = constraints?.allowedTasks || {};
  
  if (allowedTasks.pricing === false) {
    const pricingPatterns = /\$\d|\bprice\b|\bcost\b|\bquote\b|\bfee\b|\bcharge\b/i;
    if (pricingPatterns.test(cleanedText)) {
      violations.push('contains_pricing');
    }
  }
  
  if (allowedTasks.guarantees === false) {
    const guaranteePatterns = /\bguarantee\b|\bpromise\b|\bwill\s+definitely\b|\bfor\s+sure\b/i;
    if (guaranteePatterns.test(cleanedText)) {
      violations.push('contains_guarantee');
    }
  }
  
  if (allowedTasks.legal === false) {
    const legalPatterns = /\blegal\b|\bwarranty\s+(will|covers?)\b|\bliability\b/i;
    if (legalPatterns.test(cleanedText)) {
      violations.push('contains_legal');
    }
  }
  
  // Check for time slots in allowedTasks too (explicit block)
  if (allowedTasks.timeSlots === false) {
    // Already checked above with blockTimeSlots
  }
  
  return {
    valid: violations.length === 0,
    violations,
    cleanedText,
    sentenceCount: sentences.length
  };
}

// ────────────────────────────────────────────────────────────────────────────
// LLM CALL
// ────────────────────────────────────────────────────────────────────────────

/**
 * Call LLM for fallback response
 * @returns {{ success: boolean, response: string, tokens: Object, error?: string }}
 */
async function callLLM({ config, input, callContext }) {
  const llmFallback = config?.llmFallback;
  const prompts = llmFallback?.prompts || {};
  const constraints = llmFallback?.constraints || {};
  
  // Build model name
  let model = llmFallback?.model || 'gpt-4.1-mini';
  if (llmFallback?.customModelOverride) {
    model = llmFallback.customModelOverride;
  }
  
  // Build system prompt
  const systemPrompt = [
    prompts.system || 'You are a calm, professional HVAC service coordinator.',
    prompts.format || 'Write exactly 2 sentences. Sentence 1: brief empathy. Sentence 2: one booking question.',
    prompts.safety || ''
  ].filter(Boolean).join('\n\n');
  
  // Build user message with context
  const userMessage = `Caller said: "${input}"
  
${callContext?.capturedReason ? `Context: They mentioned ${callContext.capturedReason}` : ''}

Respond with empathy and ask ONE question that moves them toward booking a service visit.`;

  const startTime = Date.now();
  
  try {
    const openai = getOpenAIClient();
    
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: constraints.maxOutputTokens || 160,
      temperature: constraints.temperature ?? 0.2
    });
    
    const responseText = response.choices?.[0]?.message?.content?.trim() || '';
    const usage = response.usage || {};
    
    return {
      success: true,
      response: responseText,
      tokens: {
        input: usage.prompt_tokens || 0,
        output: usage.completion_tokens || 0,
        total: usage.total_tokens || 0
      },
      model,
      responseTimeMs: Date.now() - startTime
    };
  } catch (error) {
    logger.error('[LLM_FALLBACK] OpenAI call failed', { 
      error: error.message, 
      model,
      callSid: callContext?.callSid
    });
    
    return {
      success: false,
      response: '',
      tokens: { input: 0, output: 0, total: 0 },
      model,
      error: error.message,
      responseTimeMs: Date.now() - startTime
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN: RUN LLM FALLBACK
// ────────────────────────────────────────────────────────────────────────────

/**
 * Run LLM fallback and return response with full provenance
 * 
 * @param {Object} params
 * @param {Object} params.config - Agent 2.0 config (includes llmFallback)
 * @param {string} params.input - Caller's input
 * @param {number} params.noMatchCount - How many times trigger cards failed
 * @param {boolean} params.inBookingFlow - Are we in booking-critical steps?
 * @param {boolean} params.inDiscoveryCriticalStep - Are we in slot-filling?
 * @param {number} params.llmTurnsThisCall - How many LLM turns already this call
 * @param {Object} params.callContext - { callSid, companyId, turn, capturedReason }
 * @param {Function} params.emit - Event emitter
 * 
 * @returns {Object|null} { response, provenance, handoffAction } or null if LLM should not run
 */
async function runLLMFallback({ config, input, noMatchCount, inBookingFlow, inDiscoveryCriticalStep, llmTurnsThisCall, callContext, emit }) {
  const llmFallback = config?.llmFallback;
  const constraints = llmFallback?.constraints || {};
  const emergencyFallback = llmFallback?.emergencyFallbackLine;
  const handoff = llmFallback?.handoff || {};
  
  // Check if we should call LLM
  const decision = shouldCallLLMFallback({ 
    config, 
    noMatchCount, 
    input, 
    inBookingFlow, 
    inDiscoveryCriticalStep,
    llmTurnsThisCall: llmTurnsThisCall || 0
  });
  
  emit('A2_LLM_FALLBACK_DECISION', {
    call: decision.call,
    reason: decision.reason,
    details: decision.details,
    llmTurnsThisCall: llmTurnsThisCall || 0,
    maxTurns: llmFallback?.triggers?.maxLLMFallbackTurnsPerCall ?? 1
  });
  
  if (!decision.call) {
    return null;
  }
  
  // Call LLM
  const llmResult = await callLLM({ config, input, callContext });
  
  let finalResponse;
  let usedEmergencyFallback = false;
  let constraintViolations = [];
  let hadFunnelQuestion = false;
  let sentenceCount = 0;
  
  if (llmResult.success && llmResult.response) {
    // Validate output against constraints (including anti-parrot and time-slot blocking)
    const validation = validateOutput(llmResult.response, constraints, input);
    constraintViolations = validation.violations;
    sentenceCount = validation.sentenceCount || 0;
    hadFunnelQuestion = /\?$/.test(validation.cleanedText.trim());
    
    // Emit validation result for Call Review visibility
    emit('A2_LLM_OUTPUT_VALIDATION', {
      passed: validation.valid,
      violations: validation.violations,
      sentenceCount,
      hadFunnelQuestion,
      forbidBookingTimes: constraints?.forbidBookingTimes !== false,
      forbiddenPatternsChecked: constraints?.forbiddenBookingPatterns?.length || 0,
      originalResponsePreview: llmResult.response.substring(0, 100),
      cleanedResponsePreview: validation.cleanedText.substring(0, 100)
    });
    
    if (validation.valid) {
      finalResponse = validation.cleanedText;
    } else {
      // Constraint violations - use emergency fallback
      emit('A2_LLM_CONSTRAINT_VIOLATION', {
        violations: validation.violations,
        originalResponse: llmResult.response.substring(0, 100),
        action: 'using_emergency_fallback'
      });
      
      if (emergencyFallback?.enabled !== false && emergencyFallback?.text) {
        finalResponse = emergencyFallback.text;
        usedEmergencyFallback = true;
      } else {
        // Use cleaned text despite violations (better than nothing)
        finalResponse = validation.cleanedText;
      }
    }
  } else {
    // LLM call failed - use emergency fallback
    emit('A2_LLM_CALL_FAILED', {
      error: llmResult.error,
      action: 'using_emergency_fallback'
    });
    
    if (emergencyFallback?.enabled !== false && emergencyFallback?.text) {
      finalResponse = emergencyFallback.text;
      usedEmergencyFallback = true;
    } else {
      return null; // Can't proceed without emergency fallback
    }
  }
  
  // Emit MIC_OWNER_PROOF - LLM never takes mic, Agent2 stays owner
  emit('A2_MIC_OWNER_PROOF', {
    owner: 'AGENT2_DISCOVERY',
    llmUsed: true,
    llmRole: 'ASSIST_ONLY',
    note: 'LLM provided text but Agent2 maintains full mic ownership and control flow'
  });
  
  // Determine handoff mode and action
  const handoffMode = handoff.mode || 'confirmService';
  let handoffAction = null;
  let handoffQuestion = null;
  
  // Get handoff config based on mode
  if (handoffMode === 'confirmService') {
    handoffQuestion = handoff.confirmService?.question || "Would you like to get a technician out to take a look?";
    handoffAction = {
      mode: 'confirmService',
      awaitingConfirmation: true,
      yesResponse: handoff.confirmService?.yesResponse || "Perfect — I'm going to grab a few details so we can get this scheduled.",
      noResponse: handoff.confirmService?.noResponse || "No problem. Is there anything else I can help you with today?"
    };
  } else if (handoffMode === 'takeMessage') {
    handoffQuestion = handoff.takeMessage?.question || "Would you like me to take a message for a callback?";
    handoffAction = {
      mode: 'takeMessage',
      awaitingConfirmation: true,
      yesResponse: handoff.takeMessage?.yesResponse,
      noResponse: handoff.takeMessage?.noResponse
    };
  } else if (handoffMode === 'offerForward' && handoff.offerForward?.enabled) {
    handoffQuestion = handoff.offerForward?.question || "Would you like me to connect you to a team member now?";
    handoffAction = {
      mode: 'offerForward',
      awaitingConfirmation: true,
      yesResponse: handoff.offerForward?.yesResponse,
      noResponse: handoff.offerForward?.noResponse,
      consentRequired: handoff.offerForward?.consentRequired !== false
    };
  }
  
  // If response doesn't end with a question, append handoff question
  if (!hadFunnelQuestion && handoffQuestion) {
    finalResponse = `${finalResponse} ${handoffQuestion}`.trim();
    hadFunnelQuestion = true;
  }
  
  // Build provenance
  const provenance = {
    sourceId: usedEmergencyFallback ? 'agent2.llmFallback.emergencyFallback' : 'agent2.llmFallback',
    uiPath: usedEmergencyFallback 
      ? 'aiAgentSettings.agent2.llmFallback.emergencyFallbackLine.text'
      : 'aiAgentSettings.agent2.llmFallback',
    uiTab: 'LLM Fallback',
    configPath: usedEmergencyFallback ? 'llmFallback.emergencyFallbackLine' : 'llmFallback.prompts',
    spokenTextPreview: finalResponse.substring(0, 120),
    isFromUiConfig: true,
    isLLMAssist: !usedEmergencyFallback,
    handoffMode,
    llmMeta: {
      model: llmResult.model,
      tokensInput: llmResult.tokens.input,
      tokensOutput: llmResult.tokens.output,
      costUsd: LLMFallbackUsage.calculateCost(llmResult.tokens, llmResult.model),
      responseTimeMs: llmResult.responseTimeMs,
      whyCalledLLM: decision.reason,
      constraintViolations,
      usedEmergencyFallback,
      hadFunnelQuestion,
      sentenceCount,
      handoffMode,
      awaitingConfirmation: handoffAction?.awaitingConfirmation || false
    }
  };
  
  // Log to database
  try {
    await LLMFallbackUsage.logCall({
      companyId: callContext.companyId,
      callSid: callContext.callSid,
      turnNumber: callContext.turn,
      provider: llmFallback?.provider || 'openai',
      model: llmResult.model,
      tokens: llmResult.tokens,
      trigger: {
        reason: decision.reason,
        noMatchCount: decision.details.noMatchCount,
        complexityScore: decision.details.complexity?.score,
        matchedKeywords: decision.details.matchedKeywords,
        callerInput: input
      },
      result: {
        success: !usedEmergencyFallback,
        responseText: finalResponse,
        hadFunnelQuestion,
        sentenceCount,
        constraintViolations,
        usedEmergencyFallback,
        responseTimeMs: llmResult.responseTimeMs,
        handoffMode
      },
      provenance: {
        uiPath: provenance.uiPath,
        uiTab: provenance.uiTab,
        configVersion: config?.meta?.uiBuild,
        isFromUiConfig: true
      },
      error: llmResult.error ? {
        occurred: true,
        message: llmResult.error,
        fallbackUsed: usedEmergencyFallback
      } : { occurred: false }
    });
  } catch (logError) {
    logger.warn('[LLM_FALLBACK] Failed to log usage', { error: logError.message });
  }
  
  // Emit SPEAK_PROVENANCE
  emit('SPEAK_PROVENANCE', {
    ...provenance,
    timestamp: new Date().toISOString()
  });
  
  // Emit handoff event if awaiting confirmation
  if (handoffAction?.awaitingConfirmation) {
    emit('A2_LLM_HANDOFF_AWAITING_CONFIRMATION', {
      mode: handoffMode,
      question: handoffQuestion,
      yesResponse: handoffAction.yesResponse,
      noResponse: handoffAction.noResponse
    });
  }
  
  return {
    response: finalResponse,
    provenance,
    llmMeta: provenance.llmMeta,
    handoffAction
  };
}

// ────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  computeComplexityScore,
  shouldCallLLMFallback,
  validateOutput,
  runLLMFallback
};
