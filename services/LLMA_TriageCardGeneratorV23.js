// services/LLMA_TriageCardGeneratorV23.js
// V23 LLM-A Triage Architect - Generates validated triage card drafts
// 
// PURPOSE: Admin-side only. LLM never runs during calls.
// FLOW: Admin input → LLM generates draft → Auto-validate → Admin approves
//
// CRITICAL: LLM-A generates ROUTING METADATA, not conversation scripts.
// See: docs/V23-TRIAGE-RUNTIME-AND-LLM-A-SPEC.md
//
// ═══════════════════════════════════════════════════════════════════════════

const OpenAI = require('openai');
const logger = require('../utils/logger');
const {
  validateAgainstTestPlan,
  checkRegionConflicts
} = require('./TriageValidatorHelper');

// ═══════════════════════════════════════════════════════════════════════════
// OPENAI CLIENT
// ═══════════════════════════════════════════════════════════════════════════

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - Enforces V23 Output Contract
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - V23 Guardrails (from authoritative spec)
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are LLM-A, an OFFLINE TRIAGE ARCHITECT for a multi-tenant AI receptionist platform.

Your job:
- Generate CLEAN, MINIMAL routing rules (TriageCards) used ONLY for keyword routing.
- You NEVER write conversational scripts or phone dialogues.
- You NEVER talk to callers.
- You ONLY output:
  - triageCardDraft
  - testPlan
  - guardrailFlags

Critical rules:
1) You are generating routing metadata, not phone answers.
2) mustHaveKeywords must be 1–3 short tokens, no sentences, no synonyms list.
3) excludeKeywords must be short tokens that disqualify this card.
4) Use regionProfile:
   - If climate is HOT_ONLY and supportsHeating=false:
     - Do NOT focus on furnaces, heaters, boilers.
     - If admin examples mention them, add a guardrail flag
       "REGION_HEATING_MENTIONED_IN_HOT_ONLY".
5) Synonyms are allowed in your reasoning, but do NOT stuff them into mustHaveKeywords.
   - Example: For AC maintenance:
     - Good mustHaveKeywords: ["ac", "tuneup"] or ["ac", "maintenance"]
6) You must produce a testPlan with both:
   - positiveUtterances: 5+ variants that SHOULD match.
   - negativeUtterances: 5+ variants that SHOULD NOT match.
7) threeTierLink is only a hint for humans:
   - categoryKey and scenarioKey used by admins later.
   - You are NOT creating 3-Tier scenarios.
8) All outputs must be valid JSON and strictly follow the schema.

OUTPUT SCHEMA (return exactly this structure):

{
  "triageCardDraft": {
    "displayName": "string - human readable name",
    "triageLabel": "string - UPPERCASE_SNAKE_CASE identifier",
    "quickRuleConfig": {
      "intent": "string - e.g. AC_MAINTENANCE, AC_REPAIR, EMERGENCY",
      "serviceType": "REPAIR | MAINTENANCE | EMERGENCY | OTHER",
      "action": "DIRECT_TO_3TIER | ESCALATE_TO_HUMAN | TAKE_MESSAGE | END_CALL_POLITE",
      "mustHaveKeywords": ["1-3 short tokens only"],
      "excludeKeywords": ["tokens that disqualify"]
    },
    "threeTierLink": {
      "categoryKey": "string or null",
      "scenarioKey": "string or null"
    },
    "adminNotes": "string - optional notes for admin"
  },
  "testPlan": {
    "positiveUtterances": ["5+ phrases that SHOULD match"],
    "negativeUtterances": ["5+ phrases that should NOT match"]
  },
  "guardrailFlags": ["array of flag strings if any conflicts detected"]
}`;

// ═══════════════════════════════════════════════════════════════════════════
// BUILD USER PROMPT (matches V23 spec input contract)
// ═══════════════════════════════════════════════════════════════════════════

function buildUserPrompt(input) {
  // Build the exact input structure from the spec
  const userPayload = {
    company: {
      id: input.companyId,
      name: input.companyName || 'Unknown Company',
      tradeKey: input.tradeKey,
      regionProfile: input.regionProfile || {
        climate: 'MIXED',
        supportsHeating: true,
        supportsCooling: true
      }
    },
    triageIdea: {
      adminTitle: input.triageIdea.adminTitle,
      desiredAction: input.triageIdea.desiredAction,
      intentHint: input.triageIdea.intentHint || input.triageIdea.serviceTypeHint,
      serviceTypeHint: input.triageIdea.serviceTypeHint,
      threeTierHint: input.triageIdea.threeTierHint || null,
      exampleUtterances: input.triageIdea.exampleUtterances || []
    }
  };
  
  return `Here is the input. Respond ONLY with a JSON object as specified:

${JSON.stringify(userPayload, null, 2)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATE INPUT
// ═══════════════════════════════════════════════════════════════════════════

function validateInput(input) {
  const errors = [];
  
  if (!input.companyId) errors.push('companyId is required');
  if (!input.tradeKey) errors.push('tradeKey is required');
  if (!input.regionProfile) errors.push('regionProfile is required');
  if (!input.triageIdea) errors.push('triageIdea is required');
  
  if (input.triageIdea) {
    if (!input.triageIdea.adminTitle) errors.push('triageIdea.adminTitle is required');
    if (!input.triageIdea.exampleUtterances || input.triageIdea.exampleUtterances.length < 1) {
      errors.push('At least 1 example utterance is required');
    }
    if (!input.triageIdea.desiredAction) errors.push('triageIdea.desiredAction is required');
    if (!input.triageIdea.serviceTypeHint) errors.push('triageIdea.serviceTypeHint is required');
  }
  
  const validActions = ['DIRECT_TO_3TIER', 'ESCALATE_TO_HUMAN', 'TAKE_MESSAGE', 'END_CALL_POLITE', 'EXPLAIN_AND_PUSH'];
  if (input.triageIdea?.desiredAction && !validActions.includes(input.triageIdea.desiredAction)) {
    errors.push(`desiredAction must be one of: ${validActions.join(', ')}`);
  }
  
  const validServiceTypes = ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER'];
  if (input.triageIdea?.serviceTypeHint && !validServiceTypes.includes(input.triageIdea.serviceTypeHint)) {
    errors.push(`serviceTypeHint must be one of: ${validServiceTypes.join(', ')}`);
  }
  
  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATE LLM OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

function validateLLMOutput(output) {
  const errors = [];
  const draft = output?.triageCardDraft;
  
  if (!draft) {
    errors.push('Missing triageCardDraft in output');
    return errors;
  }
  
  // Required fields
  if (!draft.displayName) errors.push('Missing displayName');
  if (!draft.triageLabel) errors.push('Missing triageLabel');
  
  // Quick rule config
  const qrc = draft.quickRuleConfig;
  if (!qrc) {
    errors.push('Missing quickRuleConfig');
  } else {
    if (!qrc.intent) errors.push('Missing quickRuleConfig.intent');
    if (!qrc.serviceType) errors.push('Missing quickRuleConfig.serviceType');
    if (!qrc.action) errors.push('Missing quickRuleConfig.action');
    
    if (!qrc.mustHaveKeywords || qrc.mustHaveKeywords.length === 0) {
      errors.push('mustHaveKeywords must have at least 1 keyword');
    }
    if (qrc.mustHaveKeywords && qrc.mustHaveKeywords.length > 5) {
      errors.push('mustHaveKeywords should have 1-3 keywords (max 5)');
    }
  }
  
  // Test plan
  const tp = draft.testPlan;
  if (!tp) {
    errors.push('Missing testPlan');
  } else {
    if (!tp.positiveUtterances || tp.positiveUtterances.length < 3) {
      errors.push('testPlan.positiveUtterances should have at least 3 entries');
    }
    if (!tp.negativeUtterances || tp.negativeUtterances.length < 3) {
      errors.push('testPlan.negativeUtterances should have at least 3 entries');
    }
  }
  
  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN AUTO-VALIDATION (uses TriageValidatorHelper for consistent matching)
// ═══════════════════════════════════════════════════════════════════════════

function runAutoValidation(draft, testPlan, regionProfile) {
  // Use the helper to validate against test plan
  const quickRuleConfig = draft.quickRuleConfig || {};
  const validationReport = validateAgainstTestPlan(quickRuleConfig, testPlan);
  
  // Check for region conflicts in the keywords
  const allKeywords = [
    ...(quickRuleConfig.mustHaveKeywords || []),
    ...(quickRuleConfig.excludeKeywords || [])
  ];
  
  const regionFlags = checkRegionConflicts(allKeywords, regionProfile);
  
  // Merge region flags into the report
  if (regionFlags.length > 0) {
    validationReport.guardrailFlags = regionFlags;
    if (validationReport.status === 'PASSED') {
      validationReport.status = 'NEEDS_REVIEW';
    }
  }
  
  return validationReport;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a V23 triage card draft using LLM-A
 * 
 * @param {Object} input - Input specification
 * @param {string} input.companyId - Company ID
 * @param {string} input.tradeKey - Trade key (HVAC, PLUMBING, etc.)
 * @param {Object} input.regionProfile - Company region profile
 * @param {Object} input.triageIdea - Admin's triage request
 * @returns {Object} { ok, draft, validationReport, errors }
 */
async function generateTriageCardV23(input) {
  const startTime = Date.now();
  
  logger.info('[LLM-A V23] Starting card generation', {
    companyId: input.companyId,
    tradeKey: input.tradeKey,
    adminTitle: input.triageIdea?.adminTitle
  });
  
  // 1. Validate input
  const inputErrors = validateInput(input);
  if (inputErrors.length > 0) {
    logger.warn('[LLM-A V23] Input validation failed', { errors: inputErrors });
    return {
      ok: false,
      draft: null,
      validationReport: null,
      errors: inputErrors
    };
  }
  
  // 2. Call OpenAI
  let llmOutput;
  try {
    const userPrompt = buildUserPrompt(input);
    
    logger.info('[LLM-A V23] Calling OpenAI', {
      model: 'gpt-4o',
      promptLength: userPrompt.length
    });
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }
    
    llmOutput = JSON.parse(content);
    
    logger.info('[LLM-A V23] OpenAI response received', {
      tokensUsed: response.usage?.total_tokens,
      hasTriageCardDraft: !!llmOutput?.triageCardDraft
    });
    
  } catch (err) {
    logger.error('[LLM-A V23] OpenAI call failed', {
      error: err.message,
      stack: err.stack
    });
    return {
      ok: false,
      draft: null,
      validationReport: null,
      errors: [`LLM call failed: ${err.message}`]
    };
  }
  
  // 3. Validate LLM output
  const outputErrors = validateLLMOutput(llmOutput);
  if (outputErrors.length > 0) {
    logger.warn('[LLM-A V23] LLM output validation failed', { errors: outputErrors });
    return {
      ok: false,
      draft: llmOutput?.triageCardDraft || null,
      validationReport: null,
      errors: outputErrors
    };
  }
  
  const draft = llmOutput.triageCardDraft;
  const testPlan = llmOutput.testPlan || {};
  const llmGuardrailFlags = llmOutput.guardrailFlags || [];
  
  // 4. Run auto-validation (local simulation, no DB calls)
  let validationReport;
  try {
    validationReport = runAutoValidation(
      draft,
      testPlan,
      input.regionProfile
    );
    
    // Merge LLM-provided guardrail flags
    if (llmGuardrailFlags.length > 0) {
      validationReport.guardrailFlags = [
        ...(validationReport.guardrailFlags || []),
        ...llmGuardrailFlags
      ];
    }
    
    logger.info('[LLM-A V23] Auto-validation complete', {
      status: validationReport.status,
      positiveMatched: validationReport.coverage.positiveMatchedCount,
      positiveTotal: validationReport.coverage.positiveTotal,
      guardrailFlags: validationReport.guardrailFlags?.length || 0
    });
  } catch (err) {
    logger.error('[LLM-A V23] Auto-validation failed', { error: err.message });
    validationReport = {
      status: 'ERROR',
      coverage: { positiveMatchedCount: 0, positiveTotal: 0, negativeMatchedCount: 0, negativeTotal: 0 },
      failures: [{ type: 'VALIDATION_ERROR', reason: err.message }]
    };
  }
  
  const elapsed = Date.now() - startTime;
  logger.info('[LLM-A V23] Generation complete', {
    elapsed,
    status: validationReport.status,
    cardLabel: draft.triageLabel
  });
  
  // Return the exact contract from V23 spec
  return {
    ok: true,
    triageCardDraft: draft,
    testPlan,
    guardrailFlags: validationReport.guardrailFlags || [],
    validationReport: {
      status: validationReport.status,
      coverage: validationReport.coverage,
      failures: validationReport.failures || []
    },
    errors: []
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERT DRAFT TO TRIAGE CARD (matches V23 spec TriageCard contract)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert LLM-A draft to actual TriageCard document
 * Follows the exact schema from V23-TRIAGE-RUNTIME-AND-LLM-A-SPEC.md
 */
function draftToTriageCard(companyId, tradeKey, draft, validationReport) {
  const qrc = draft.quickRuleConfig || {};
  
  return {
    companyId,
    tradeKey,
    active: false, // Admin must explicitly activate
    priority: qrc.priority || 100,
    
    displayName: draft.displayName,
    triageLabel: draft.triageLabel,
    
    // The core routing config
    quickRuleConfig: {
      intent: qrc.intent || 'UNKNOWN',
      serviceType: qrc.serviceType || 'OTHER',
      action: qrc.action || 'DIRECT_TO_3TIER',
      mustHaveKeywords: qrc.mustHaveKeywords || [],
      excludeKeywords: qrc.excludeKeywords || []
    },
    
    // 3-Tier hint (admin uses this to map to scenario later)
    threeTierLink: {
      categoryKey: draft.threeTierLink?.categoryKey || null,
      scenarioKey: draft.threeTierLink?.scenarioKey || null
    },
    
    // Stats (initialized)
    stats: {
      uses: 0,
      successRate: 0,
      lastMatchedAt: null
    },
    
    adminNotes: draft.adminNotes || `Generated by LLM-A V23 on ${new Date().toISOString()}`,
    
    // V23 metadata (for debugging/auditing)
    llmaMetadata: {
      generatedAt: new Date(),
      version: 'V23',
      validationStatus: validationReport?.status || 'UNKNOWN',
      guardrailFlags: validationReport?.guardrailFlags || []
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  generateTriageCardV23,
  draftToTriageCard,
  validateInput,
  validateLLMOutput,
  runAutoValidation
};

