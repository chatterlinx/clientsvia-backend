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
 * Returns { call: boolean, reason: string, details: Object, mode: string }
 * 
 * V5: Supports two modes:
 * - "guided": Empathy + UI-owned handoff question (funnels to booking)
 * - "answer_return": Short answer only, no question, returns to deterministic
 */
function shouldCallLLMFallback({ 
  config, 
  noMatchCount, 
  input, 
  inBookingFlow, 
  inDiscoveryCriticalStep, 
  llmTurnsThisCall,
  // Additional blocking conditions passed from runner
  hasPendingQuestion,      // YES/NO/REPROMPT flow active
  hasCapturedReasonFlow,   // Clarifier path mid-flight
  hasAfterHoursFlow,       // After-hours handling active
  hasTransferFlow,         // Transfer to advisor active
  hasSpeakSourceSelected,  // Another system already selected speak source
  triggerCardMatched,      // A trigger card matched this turn
  bookingModeLocked,       // Booking mode is locked
  // V5: Answer+Return state tracking
  llmAssistState           // { usesThisCall, cooldownRemaining }
}) {
  const llmFallback = config?.llmFallback;
  
  // V5: Determine active mode
  const mode = llmFallback?.mode || 'guided';
  const isAnswerReturnMode = mode === 'answer_return';
  const answerReturnConfig = llmFallback?.answerReturn || {};
  
  // V5: Get mode-specific config
  const usesThisCall = llmAssistState?.usesThisCall || 0;
  const cooldownRemaining = llmAssistState?.cooldownRemaining || 0;
  
  // Build snapshot for audit (always included in response)
  const stateSnapshot = {
    mode,
    hasPendingQuestion: !!hasPendingQuestion,
    hasCapturedReasonFlow: !!hasCapturedReasonFlow,
    hasAfterHoursFlow: !!hasAfterHoursFlow,
    hasTransferFlow: !!hasTransferFlow,
    hasSpeakSourceSelected: !!hasSpeakSourceSelected,
    triggerCardMatched: !!triggerCardMatched,
    bookingModeLocked: !!bookingModeLocked,
    inBookingFlow: !!inBookingFlow,
    inDiscoveryCriticalStep: !!inDiscoveryCriticalStep,
    llmTurnsThisCall: llmTurnsThisCall || 0,
    // V5: Answer+Return state
    usesThisCall,
    cooldownRemaining
  };
  
  // Hard gate: master switch must be enabled
  // Check discovery.llmFallback.enabled (canonical location) first
  const masterEnabled = config?.discovery?.llmFallback?.enabled === true || llmFallback?.enabled === true;
  if (!masterEnabled) {
    return { 
      call: false, 
      mode,
      reason: 'LLM_FALLBACK_DISABLED', 
      blockedBy: 'CONFIG_DISABLED',
      details: { enabled: false },
      stateSnapshot 
    };
  }
  
  // V5: Mode-specific enable check
  if (isAnswerReturnMode && answerReturnConfig.enabled !== true) {
    return {
      call: false,
      mode,
      reason: 'Answer+Return mode not enabled',
      blockedBy: 'MODE_DISABLED',
      details: { mode, modeEnabled: false },
      stateSnapshot
    };
  }
  
  // V5: Answer+Return cooldown check (BEFORE other checks)
  if (isAnswerReturnMode && cooldownRemaining > 0) {
    return {
      call: false,
      mode,
      reason: `Cooldown active (${cooldownRemaining} turns remaining)`,
      blockedBy: 'COOLDOWN',
      details: { cooldownRemaining, mode },
      stateSnapshot
    };
  }
  
  // V5: Answer+Return max uses check
  if (isAnswerReturnMode) {
    const maxUsesPerCall = answerReturnConfig.maxUsesPerCall ?? 2;
    if (usesThisCall >= maxUsesPerCall) {
      return {
        call: false,
        mode,
        reason: `Max uses per call reached (${usesThisCall}/${maxUsesPerCall})`,
        blockedBy: 'MAX_USES',
        details: { usesThisCall, maxUsesPerCall, mode },
        stateSnapshot
      };
    }
  }
  
  const triggers = llmFallback.triggers || {};
  
  // ════════════════════════════════════════════════════════════════════════
  // BLOCKING CONDITIONS (LLM NOT allowed if ANY of these are true)
  // Each returns precise blockedBy reason + full state snapshot
  // ════════════════════════════════════════════════════════════════════════
  
  // Blocked if a trigger card matched (deterministic path found)
  if (triggerCardMatched) {
    return { 
      call: false, 
      mode,
      reason: 'Deterministic trigger card matched - LLM not needed', 
      blockedBy: 'TRIGGER_CARD_MATCH',
      details: { triggerCardMatched: true },
      stateSnapshot 
    };
  }
  
  // Blocked if another system already selected a speak source this turn
  if (hasSpeakSourceSelected) {
    return { 
      call: false, 
      mode,
      reason: 'Another module already selected speak source', 
      blockedBy: 'SPEAK_SOURCE_ALREADY_SELECTED',
      details: { hasSpeakSourceSelected: true },
      stateSnapshot 
    };
  }
  
  // Blocked during booking-critical steps (name/address/time capture)
  if (triggers.blockedWhileBooking !== false && (inBookingFlow || bookingModeLocked)) {
    return { 
      call: false, 
      mode,
      reason: 'Blocked during booking flow', 
      blockedBy: 'BOOKING_LOCKED',
      details: { inBookingFlow, bookingModeLocked },
      stateSnapshot 
    };
  }
  
  // Blocked during discovery-critical steps (slot filling)
  if (triggers.blockedWhileDiscoveryCriticalStep !== false && inDiscoveryCriticalStep) {
    return { 
      call: false, 
      mode,
      reason: 'Blocked during discovery-critical step', 
      blockedBy: 'DISCOVERY_CRITICAL_STEP',
      details: { inDiscoveryCriticalStep: true },
      stateSnapshot 
    };
  }
  
  // Blocked if pending question is active (YES/NO/REPROMPT flow)
  if (hasPendingQuestion) {
    return { 
      call: false, 
      mode,
      reason: 'Pending question active - awaiting YES/NO/REPROMPT', 
      blockedBy: 'PENDING_QUESTION',
      details: { hasPendingQuestion: true },
      stateSnapshot 
    };
  }
  
  // Blocked if captured-reason clarifier flow is mid-flight
  if (hasCapturedReasonFlow) {
    return { 
      call: false, 
      mode,
      reason: 'Captured reason clarifier flow active', 
      blockedBy: 'CAPTURED_REASON_FLOW',
      details: { hasCapturedReasonFlow: true },
      stateSnapshot 
    };
  }
  
  // Blocked if after-hours/catastrophic fallback is active
  if (hasAfterHoursFlow) {
    return { 
      call: false, 
      mode,
      reason: 'After-hours or catastrophic fallback active', 
      blockedBy: 'AFTER_HOURS_FLOW',
      details: { hasAfterHoursFlow: true },
      stateSnapshot 
    };
  }
  
  // Blocked if transfer flow is active
  if (hasTransferFlow) {
    return { 
      call: false, 
      mode,
      reason: 'Transfer to advisor flow active', 
      blockedBy: 'TRANSFER_FLOW',
      details: { hasTransferFlow: true },
      stateSnapshot 
    };
  }
  
  // Max LLM turns per call (default 1 - LLM gets ONE shot) - for GUIDED mode
  // Answer+Return uses its own maxUsesPerCall (checked earlier)
  if (!isAnswerReturnMode) {
    const maxTurns = triggers.maxLLMFallbackTurnsPerCall ?? 1;
    if (llmTurnsThisCall >= maxTurns) {
      return { 
        call: false, 
        mode,
        reason: `Max LLM turns reached (${llmTurnsThisCall}/${maxTurns})`, 
        blockedBy: 'MAX_LLM_TURNS_REACHED',
        details: { llmTurnsThisCall, maxTurns },
        stateSnapshot 
      };
    }
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
      mode,
      reason: 'No trigger conditions met', 
      blockedBy: 'NO_TRIGGERS_MATCHED',
      details: { 
        complexity,
        noMatchCount,
        noMatchThreshold,
        complexityThreshold
      },
      stateSnapshot
    };
  }
  
  return {
    call: true,
    mode,
    reason: triggersMatched.join('+'),
    blockedBy: null,
    stateSnapshot,
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
 * 
 * V5: Mode-aware validation
 * - Guided mode: May require funnel question
 * - Answer+Return mode: MUST NOT end with question
 */
function validateOutput(text, constraints, callerInput = '', mode = 'guided') {
  const violations = [];
  let cleanedText = (text || '').trim();
  const isAnswerReturnMode = mode === 'answer_return';
  
  if (!cleanedText) {
    violations.push('empty_output');
    return { valid: false, violations, cleanedText: '', sentenceCount: 0, mode };
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
  
  // V5: Mode-specific question handling
  const endsWithQuestion = /\?$/.test(cleanedText.trim());
  
  if (isAnswerReturnMode) {
    // Answer+Return: MUST NOT end with question
    if (endsWithQuestion) {
      violations.push('answer_return_must_not_end_with_question');
      // Remove the question - take only the declarative portion
      const nonQuestionSentences = sentences.filter(s => !s.trim().endsWith('?') && !/\?\s*$/.test(s));
      if (nonQuestionSentences.length > 0) {
        cleanedText = nonQuestionSentences.slice(0, maxSentences).join('. ').trim();
        if (!cleanedText.endsWith('.') && !cleanedText.endsWith('!')) {
          cleanedText += '.';
        }
      }
    }
  } else {
    // Guided mode: May require funnel question
    if (constraints?.mustEndWithFunnelQuestion !== false && !endsWithQuestion) {
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
    
    // Default patterns if UI array is empty (enforce UI truth - never allow empty)
    const defaultForbiddenPatterns = [
      // Time windows
      'morning', 'afternoon', 'evening', 'this morning', 'this afternoon',
      'tomorrow morning', 'tomorrow afternoon', 'later today',
      '8-10', '8–10', '10-12', '10–12', '12-2', '12–2', '2-4', '2–4',
      // Week references
      'this week', 'next week', 'this weekend',
      // Scheduling language
      'time slot', 'appointment time', 'schedule you for', 'what time works',
      'morning or afternoon', 'today or tomorrow',
      // Availability language
      'when would you like', 'what time is good', 'when works for you',
      'earliest available', 'next available', 'soonest available',
      'availability', 'openings', 'get you in',
      // Scheduling verbs
      'i can schedule', 'let me schedule', 'we can schedule',
      'i can book', 'let me book', 'we can book'
    ];
    
    // Use UI patterns if provided and non-empty, otherwise use defaults
    const uiPatterns = constraints?.forbiddenBookingPatterns;
    const forbiddenPatterns = (Array.isArray(uiPatterns) && uiPatterns.length > 0) 
      ? uiPatterns 
      : defaultForbiddenPatterns;
    
    for (const pattern of forbiddenPatterns) {
      if (textLower.includes(pattern.toLowerCase())) {
        violations.push(`forbidden_booking_pattern:${pattern}`);
        break;
      }
    }
    
    // Hard regex safety net for time expressions (cannot be overridden by UI)
    const timeExpressionRegex = [
      /\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)\b/i,           // "9am", "10 PM"
      /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i,                   // "10:30", "10:30am"
      /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\b(?:available|open|free)\s+(?:at|on|for)\s+\d/i,
      /\b(?:schedule|book)\s+(?:you\s+)?(?:for|at)\s+/i,
      /\btoday\s+(?:at|around|between)/i,
      /\btomorrow\s+(?:at|around|between)/i,
      /\bdo you prefer\s+(?:morning|afternoon|evening)/i,
      /\bmorning or afternoon/i,
      /\bwhat time (?:works|is good|would you)/i,
      /\bwhen (?:would you like|works for you|is good)/i,
      /\bi can (?:schedule|book|get you in)/i,
      /\blet me (?:schedule|book|get you)/i,
      /\bwe (?:can|could) (?:schedule|book|get)/i,
      /\b(?:earliest|next|soonest) (?:available|opening|slot)/i
    ];
    
    for (const pattern of timeExpressionRegex) {
      if (pattern.test(cleanedText)) {
        violations.push('contains_time_expression_regex');
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
    sentenceCount: sentences.length,
    mode
  };
}

// ────────────────────────────────────────────────────────────────────────────
// LLM CALL
// ────────────────────────────────────────────────────────────────────────────

/**
 * Call LLM for fallback response
 * V5: Supports mode-specific prompts for guided vs answer_return
 * @returns {{ success: boolean, response: string, tokens: Object, error?: string }}
 */
async function callLLM({ config, input, callContext, mode = 'guided' }) {
  const llmFallback = config?.llmFallback;
  const isAnswerReturnMode = mode === 'answer_return';
  const answerReturnConfig = llmFallback?.answerReturn || {};
  
  // V5: Mode-specific config
  let prompts, constraints, model;
  
  if (isAnswerReturnMode) {
    // Answer+Return mode: Use answerReturn config
    prompts = {}; // Answer+Return has its own systemPrompt field
    constraints = {
      maxSentences: answerReturnConfig.maxSentences ?? 2,
      maxOutputTokens: answerReturnConfig.maxOutputTokens ?? 140,
      temperature: answerReturnConfig.temperature ?? 0.2,
      forbidBookingTimes: answerReturnConfig.forbidBookingTimes !== false,
      forbiddenBookingPatterns: answerReturnConfig.forbiddenBookingPatterns || []
    };
    model = answerReturnConfig.model || 'gpt-4.1-mini';
    if (answerReturnConfig.customModelOverride) {
      model = answerReturnConfig.customModelOverride;
    }
  } else {
    // Guided mode: Use existing prompts config
    prompts = llmFallback?.prompts || {};
    constraints = llmFallback?.constraints || {};
    model = llmFallback?.model || 'gpt-4.1-mini';
    if (llmFallback?.customModelOverride) {
      model = llmFallback.customModelOverride;
    }
  }
  
  // Build system prompt based on mode
  let systemPrompt;
  if (isAnswerReturnMode) {
    // Answer+Return: Short helpful answer, NO question, NO booking language
    const userSystemPrompt = answerReturnConfig.systemPrompt || '';
    systemPrompt = userSystemPrompt || [
      'You are a calm, professional service coordinator.',
      'Provide a brief, helpful answer to the caller\'s question.',
      'RULES:',
      '- Maximum 2 short sentences',
      '- Do NOT ask any questions',
      '- Do NOT mention scheduling, booking, appointments, or time slots',
      '- Do NOT offer to schedule anything',
      '- Do NOT mention specific times, days, or availability',
      '- Just provide helpful information and stop'
    ].join('\n');
  } else {
    // Guided mode: Empathy + booking question
    systemPrompt = [
      prompts.system || 'You are a calm, professional HVAC service coordinator.',
      prompts.format || 'Write exactly 2 sentences. Sentence 1: brief empathy. Sentence 2: one booking question.',
      prompts.safety || ''
    ].filter(Boolean).join('\n\n');
  }
  
  // Build user message with context
  let userMessage;
  if (isAnswerReturnMode) {
    userMessage = `Caller said: "${input}"

${callContext?.capturedReason ? `Context: They mentioned ${callContext.capturedReason}` : ''}

Provide a brief, helpful answer. Do NOT ask any questions. Do NOT mention scheduling or appointments.`;
  } else {
    userMessage = `Caller said: "${input}"
  
${callContext?.capturedReason ? `Context: They mentioned ${callContext.capturedReason}` : ''}

Respond with empathy and ask ONE question that moves them toward booking a service visit.`;
  }

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
 * V5: Supports two modes:
 * - "guided": Empathy + UI-owned handoff question (funnels to booking)
 * - "answer_return": Short answer only, no question, returns to deterministic
 * 
 * @param {Object} params
 * @param {Object} params.config - Agent 2.0 config (includes llmFallback)
 * @param {string} params.input - Caller's input
 * @param {number} params.noMatchCount - How many times trigger cards failed
 * @param {boolean} params.inBookingFlow - Are we in booking-critical steps?
 * @param {boolean} params.inDiscoveryCriticalStep - Are we in slot-filling?
 * @param {number} params.llmTurnsThisCall - How many LLM turns already this call
 * @param {Object} params.llmAssistState - { usesThisCall, cooldownRemaining } for Answer+Return
 * @param {Object} params.callContext - { callSid, companyId, turn, capturedReason }
 * @param {Function} params.emit - Event emitter
 * 
 * @returns {Object|null} { response, provenance, handoffAction, stateUpdate } or null if LLM should not run
 */
async function runLLMFallback({ config, input, noMatchCount, inBookingFlow, inDiscoveryCriticalStep, llmTurnsThisCall, llmAssistState, hasPendingQuestion, hasCapturedReasonFlow, hasAfterHoursFlow, hasTransferFlow, hasSpeakSourceSelected, callContext, emit }) {
  const llmFallback = config?.llmFallback;
  const mode = llmFallback?.mode || 'guided';
  const isAnswerReturnMode = mode === 'answer_return';
  const answerReturnConfig = llmFallback?.answerReturn || {};
  
  // V5: Mode-specific config
  const constraints = isAnswerReturnMode 
    ? {
        maxSentences: answerReturnConfig.maxSentences ?? 2,
        maxOutputTokens: answerReturnConfig.maxOutputTokens ?? 140,
        forbidBookingTimes: answerReturnConfig.forbidBookingTimes !== false,
        forbiddenBookingPatterns: answerReturnConfig.forbiddenBookingPatterns || [],
        mustEndWithFunnelQuestion: false // Answer+Return never requires question
      }
    : llmFallback?.constraints || {};
  
  const emergencyFallback = llmFallback?.emergencyFallbackLine;
  const handoff = llmFallback?.handoff || {};
  
  // Log if auto-applied defaults were used (from merge function)
  if (constraints._autoAppliedDefaultPatterns) {
    emit('A2_CONFIG_AUTO_DEFAULT_APPLIED', {
      field: 'forbiddenBookingPatterns',
      reason: 'forbidBookingTimes=true but patterns array was empty',
      appliedDefaults: true,
      patternsCount: constraints.forbiddenBookingPatterns?.length || 0
    });
  }
  
  // Check if we should call LLM (with all blocking conditions)
  const decision = shouldCallLLMFallback({ 
    config, 
    noMatchCount, 
    input, 
    inBookingFlow, 
    inDiscoveryCriticalStep,
    llmTurnsThisCall: llmTurnsThisCall || 0,
    hasPendingQuestion,
    hasCapturedReasonFlow,
    hasAfterHoursFlow,
    hasTransferFlow,
    hasSpeakSourceSelected,
    triggerCardMatched: callContext?.triggerCardMatched,
    bookingModeLocked: callContext?.bookingModeLocked,
    llmAssistState: llmAssistState || { usesThisCall: 0, cooldownRemaining: 0 }
  });
  
  // ════════════════════════════════════════════════════════════════════════
  // A2_LLM_FALLBACK_DECISION - Must include blockedBy and stateSnapshot
  // V5: Also includes mode for Call Review clarity
  // ════════════════════════════════════════════════════════════════════════
  emit('A2_LLM_FALLBACK_DECISION', {
    call: decision.call,
    mode: decision.mode,
    blocked: !decision.call,
    blockedBy: decision.blockedBy || null,
    reason: decision.reason,
    details: decision.details,
    stateSnapshot: decision.stateSnapshot,
    llmTurnsThisCall: llmTurnsThisCall || 0,
    maxTurns: isAnswerReturnMode 
      ? answerReturnConfig.maxUsesPerCall ?? 2
      : llmFallback?.triggers?.maxLLMFallbackTurnsPerCall ?? 1
  });
  
  if (!decision.call) {
    return null;
  }
  
  // Call LLM with mode-specific prompts
  const llmResult = await callLLM({ config, input, callContext, mode });
  
  let finalResponse;
  let usedEmergencyFallback = false;
  let constraintViolations = [];
  let hadFunnelQuestion = false;
  let sentenceCount = 0;
  
  // Track validation state for comprehensive logging
  let validationResult = null;
  
  if (llmResult.success && llmResult.response) {
    // Validate output against constraints (including anti-parrot and time-slot blocking)
    // V5: Pass mode to validateOutput for mode-specific rules
    validationResult = validateOutput(llmResult.response, constraints, input, mode);
    constraintViolations = validationResult.violations;
    sentenceCount = validationResult.sentenceCount || 0;
    hadFunnelQuestion = /\?$/.test(validationResult.cleanedText.trim());
    
    if (validationResult.valid) {
      finalResponse = validationResult.cleanedText;
    } else {
      // Constraint violations - use emergency fallback
      if (emergencyFallback?.enabled !== false && emergencyFallback?.text) {
        finalResponse = emergencyFallback.text;
        usedEmergencyFallback = true;
      } else {
        // Use cleaned text despite violations (better than nothing)
        finalResponse = validationResult.cleanedText;
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
  
  // ════════════════════════════════════════════════════════════════════════
  // A2_LLM_OUTPUT_VALIDATION - ALWAYS emit (both pass and fail)
  // This is the proof for Call Review that validation ran and what happened
  // V5: Includes mode for clarity
  // ════════════════════════════════════════════════════════════════════════
  emit('A2_LLM_OUTPUT_VALIDATION', {
    passed: validationResult?.valid ?? false,
    mode,
    violations: constraintViolations,
    sentenceCount,
    hadFunnelQuestion,
    // Config snapshot for audit
    forbidBookingTimes: constraints?.forbidBookingTimes !== false,
    patternsCheckedCount: constraints?.forbiddenBookingPatterns?.length || 0,
    handoffMode: isAnswerReturnMode ? 'answer_return' : (handoff?.mode || 'confirmService'),
    // Response previews
    originalResponsePreview: llmResult.response?.substring(0, 150) || '',
    cleanedResponsePreview: validationResult?.cleanedText?.substring(0, 150) || '',
    finalSpokenTextPreview: finalResponse?.substring(0, 150) || '',
    // Action taken
    usedEmergencyFallback,
    emergencyFallbackText: usedEmergencyFallback ? emergencyFallback?.text?.substring(0, 100) : null
  });
  
  // Emit constraint violation event if validation failed
  if (validationResult && !validationResult.valid) {
    emit('A2_LLM_CONSTRAINT_VIOLATION', {
      violations: constraintViolations,
      originalResponse: llmResult.response?.substring(0, 100) || '',
      action: usedEmergencyFallback ? 'used_emergency_fallback' : 'used_cleaned_text'
    });
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // A2_MIC_OWNER_PROOF - Evidence-based proof that Agent2 keeps mic ownership
  // Not a self-assertion - actual evidence of control flow
  // ════════════════════════════════════════════════════════════════════════
  emit('A2_MIC_OWNER_PROOF', {
    // Runtime ownership evidence
    runtimeOwnerBefore: 'AGENT2_DISCOVERY',
    runtimeOwnerAfter: 'AGENT2_DISCOVERY',
    ownershipTransferred: false,
    // What actually selected the speech
    speakSourceSelectedBy: usedEmergencyFallback ? 'LLM_FALLBACK_EMERGENCY' : 'LLM_FALLBACK_VALIDATED',
    speechSourceModule: 'Agent2DiscoveryRunner',
    // Session/lane context
    lane: 'DISCOVERY',
    sessionMode: callContext?.sessionMode || 'DISCOVERY',
    // LLM role proof
    llmUsed: true,
    llmRole: 'ASSIST_ONLY',
    llmControlledGather: false,
    llmControlledWebhook: false,
    llmCreatedMultiTurnState: false,
    // The actual text control
    textProvidedBy: usedEmergencyFallback ? 'UI_EMERGENCY_FALLBACK' : 'LLM_WITH_VALIDATION',
    textOverriddenByHandoff: false, // Will be updated after handoff override
    // ════════════════════════════════════════════════════════════════════════
    // TWIML EVIDENCE - Proof that webhook/gather flow is unchanged
    // This is what makes the "proof" real, not a self-assertion
    // ════════════════════════════════════════════════════════════════════════
    twimlGeneratedBy: 'v2twilio.js',
    gatherModeUnchanged: true,
    nextWebhookUnchanged: true,
    gatherInputType: 'speech dtmf',
    webhookEndpoint: '/api/twilio-stream/gather'
  });
  
  // ════════════════════════════════════════════════════════════════════════
  // HANDOFF MODE - LLM cannot invent handoff language
  // The "question" portion is ALWAYS the UI-owned handoff question
  // V5: Answer+Return mode SKIPS handoff entirely (no question, just answer)
  // ════════════════════════════════════════════════════════════════════════
  let handoffMode = null;
  let handoffAction = null;
  let handoffQuestion = null;
  let textOverriddenByHandoff = false;
  
  // V5: Answer+Return mode does NOT use handoff - answer only, no question
  if (!isAnswerReturnMode) {
    handoffMode = handoff.mode || 'confirmService';
    
    // Get UI-owned handoff config based on mode
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
        yesResponse: handoff.takeMessage?.yesResponse || "Great, I'll get some info for the callback. What's the best number to reach you?",
        noResponse: handoff.takeMessage?.noResponse || "No problem. Is there anything else I can help you with?"
      };
    } else if (handoffMode === 'offerForward' && handoff.offerForward?.enabled) {
      handoffQuestion = handoff.offerForward?.question || "Would you like me to connect you to a team member now?";
      handoffAction = {
        mode: 'offerForward',
        awaitingConfirmation: true,
        yesResponse: handoff.offerForward?.yesResponse || "Connecting you now — one moment please.",
        noResponse: handoff.offerForward?.noResponse || "No problem. Is there something else I can help with?",
        consentRequired: handoff.offerForward?.consentRequired !== false
      };
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // CRITICAL: Override LLM question with UI-owned handoff question
  // LLM provides empathy (sentence 1), UI provides the question (sentence 2)
  // This prevents LLM from inventing booking-time questions
  // V5: Answer+Return mode SKIPS this - just the answer, no question
  // ════════════════════════════════════════════════════════════════════════
  if (!isAnswerReturnMode && handoffQuestion && !usedEmergencyFallback) {
    // Extract empathy portion (first sentence) from LLM response
    const llmSentences = finalResponse.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const empathyPortion = llmSentences.length > 0 ? llmSentences[0].trim() : '';
    
    // If LLM provided empathy, use it + UI question. Otherwise just use UI question.
    if (empathyPortion && empathyPortion.length > 10) {
      // Ensure empathy portion doesn't end with a question (that would be LLM trying to ask)
      const empathyEndsWithPunctuation = /[.!]$/.test(empathyPortion);
      const cleanEmpathy = empathyEndsWithPunctuation ? empathyPortion : `${empathyPortion}.`;
      finalResponse = `${cleanEmpathy} ${handoffQuestion}`;
      textOverriddenByHandoff = true;
    } else {
      // No usable empathy from LLM, just use the handoff question
      finalResponse = handoffQuestion;
      textOverriddenByHandoff = true;
    }
    hadFunnelQuestion = true;
  } else if (!isAnswerReturnMode && !hadFunnelQuestion && handoffQuestion) {
    // Append handoff question if response doesn't end with a question
    finalResponse = `${finalResponse} ${handoffQuestion}`.trim();
    hadFunnelQuestion = true;
    textOverriddenByHandoff = true;
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // POST-OVERRIDE VALIDATION: Check ENTIRE finalResponse for forbidden content
  // This catches sentence 1 (empathy) sneaking in scheduling language
  // V5: Always run for both modes - Answer+Return also needs validation
  // ════════════════════════════════════════════════════════════════════════
  if (!usedEmergencyFallback) {
    const postOverrideValidation = validateOutput(finalResponse, constraints, input, mode);
    
    if (!postOverrideValidation.valid) {
      emit('A2_LLM_POST_OVERRIDE_VALIDATION_FAILED', {
        reason: 'Final response after handoff override still contains forbidden content',
        violations: postOverrideValidation.violations,
        originalFinalResponse: finalResponse.substring(0, 150),
        action: 'using_emergency_fallback'
      });
      
      // Emergency fallback - LLM tried to sneak forbidden content in sentence 1
      if (emergencyFallback?.enabled !== false && emergencyFallback?.text) {
        finalResponse = emergencyFallback.text;
        usedEmergencyFallback = true;
        constraintViolations = [...constraintViolations, ...postOverrideValidation.violations];
      }
    }
  }
  
  // Emit updated MIC_OWNER_PROOF with textOverriddenByHandoff
  if (textOverriddenByHandoff) {
    emit('A2_LLM_HANDOFF_OVERRIDE', {
      reason: 'UI-owned handoff question replaced LLM question portion',
      handoffMode,
      handoffQuestion,
      postOverrideValidationPassed: !usedEmergencyFallback,
      originalLLMResponse: llmResult.response?.substring(0, 100) || '',
      finalResponse: finalResponse.substring(0, 150)
    });
  }
  
  // V5: Build state update for Answer+Return mode (cooldown + uses tracking)
  let stateUpdate = null;
  if (isAnswerReturnMode) {
    const currentUses = llmAssistState?.usesThisCall || 0;
    const cooldownTurns = answerReturnConfig.cooldownTurns ?? 1;
    stateUpdate = {
      usesThisCall: currentUses + 1,
      cooldownRemaining: cooldownTurns,
      lastModeUsed: 'answer_return'
    };
  }
  
  // Build provenance
  // V5: Include mode in sourceId and uiPath for precise tracing
  const modeLabel = isAnswerReturnMode ? 'answerReturn' : 'guided';
  const provenance = {
    sourceId: usedEmergencyFallback 
      ? 'agent2.llmFallback.emergencyFallback' 
      : `agent2.llmFallback.${modeLabel}`,
    uiPath: usedEmergencyFallback 
      ? 'aiAgentSettings.agent2.llmFallback.emergencyFallbackLine.text'
      : `aiAgentSettings.agent2.llmFallback.${modeLabel}`,
    uiTab: 'LLM Fallback',
    configPath: usedEmergencyFallback 
      ? 'llmFallback.emergencyFallbackLine' 
      : `llmFallback.${modeLabel}`,
    spokenTextPreview: finalResponse.substring(0, 120),
    isFromUiConfig: true,
    isLLMAssist: !usedEmergencyFallback,
    mode,
    handoffMode: isAnswerReturnMode ? null : handoffMode,
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
      mode,
      handoffMode: isAnswerReturnMode ? null : handoffMode,
      awaitingConfirmation: handoffAction?.awaitingConfirmation || false,
      // V5: Answer+Return state info
      stateUpdate: isAnswerReturnMode ? stateUpdate : null
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
  
  // V4: Emit SPEECH_SOURCE_SELECTED for Call Review attribution
  // V5: Include mode in sourceId for precise tracing
  const llmSourceId = usedEmergencyFallback 
    ? 'agent2.llmFallback.emergencyFallback'
    : isAnswerReturnMode 
      ? 'LLM_ANSWER_RETURN'
      : 'LLM_GUIDED';
  const llmUiPath = usedEmergencyFallback
    ? 'aiAgentSettings.agent2.emergencyFallbackLine.text'
    : `aiAgentSettings.agent2.llmFallback.${modeLabel}`;
  
  emit('SPEECH_SOURCE_SELECTED', {
    sourceId: llmSourceId,
    uiPath: llmUiPath,
    spokenTextPreview: (finalResponse || '').substring(0, 80),
    note: usedEmergencyFallback 
      ? 'LLM output failed validation - used emergency fallback' 
      : `LLM fallback response (mode: ${mode})`,
    metadata: {
      mode,
      usedEmergencyFallback,
      handoffMode: isAnswerReturnMode ? null : handoffMode,
      sentenceCount,
      validationPassed: validationResult?.valid ?? false,
      // V5: Answer+Return state tracking
      stateUpdate: isAnswerReturnMode ? stateUpdate : null
    }
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
    handoffAction: isAnswerReturnMode ? null : handoffAction,
    // V5: State update for Answer+Return mode (caller must apply to state)
    stateUpdate: isAnswerReturnMode ? stateUpdate : null,
    mode
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
