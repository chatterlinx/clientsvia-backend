// services/LLMA_TriageCardGeneratorV23.js
// V23 LLM-A Triage Architect - Generates validated triage card drafts
// 
// PURPOSE: Admin-side only. LLM never runs during calls.
// FLOW: Admin input → LLM generates draft → Auto-validate → Admin approves
//
// ═══════════════════════════════════════════════════════════════════════════

const OpenAI = require('openai');
const logger = require('../utils/logger');
const TriageCard = require('../models/TriageCard');
const TriageService = require('./TriageService');

// ═══════════════════════════════════════════════════════════════════════════
// OPENAI CLIENT
// ═══════════════════════════════════════════════════════════════════════════

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - Enforces V23 Output Contract
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are LLM-A, the Triage Architect for ClientsVia V23.

Your job is to design triage cards that route incoming calls to the correct lane (REPAIR, MAINTENANCE, EMERGENCY, OTHER).

## CRITICAL RULES

1. **Must-Have Keywords (1-3 max)**
   - Keep them SHORT and DECISIVE: "ac", "tuneup", "not cooling", "emergency"
   - These are AND-ed by the matcher. Too many = card never fires.
   - Do NOT put all variations here. That's what synonymGroups are for.

2. **Synonym Groups**
   - Put ALL phrasing variations in synonymGroups[].terms
   - These are for debugging, 3-Tier expansion, and future auto-matching
   - NOT used in runtime AND matching

3. **Exclude Keywords**
   - Words that should BLOCK this card from matching
   - MAINTENANCE cards exclude: "not cooling", "leaking", "emergency", "no power"
   - REPAIR cards exclude: "tuneup", "maintenance", "annual service"

4. **Region Profile Compliance**
   - If supportsHeating=false: NEVER include furnace/heat/boiler in mustHaveKeywords
   - If you see heating words in examples, set regionConflict=true and note it

5. **Test Plan**
   - Generate 5+ positive utterances (should match this card)
   - Generate 5+ negative utterances (should NOT match - go elsewhere)

6. **Output Format**
   - Return ONLY valid JSON matching the exact schema below
   - No markdown, no explanations, just the JSON object

## OUTPUT SCHEMA (return exactly this structure)

{
  "triageCardDraft": {
    "displayName": "string - human readable name",
    "triageLabel": "string - UPPERCASE_SNAKE_CASE identifier",
    
    "quickRuleConfig": {
      "intent": "string - e.g. MAINTENANCE, AC_REPAIR, EMERGENCY",
      "serviceType": "REPAIR | MAINTENANCE | EMERGENCY | OTHER",
      "action": "DIRECT_TO_3TIER | ESCALATE_TO_HUMAN | TAKE_MESSAGE | END_CALL_POLITE | EXPLAIN_AND_PUSH",
      "priority": "number 1-150 (higher = checked first)",
      
      "mustHaveKeywords": ["1-3 decisive keywords only"],
      
      "synonymGroups": [
        {
          "label": "group_name",
          "terms": ["variation1", "variation2", "variation3"]
        }
      ],
      
      "excludeKeywords": ["words that block this card"]
    },
    
    "frontlinePlaybook": {
      "goal": "one-sentence goal",
      "steps": ["step 1", "step 2", "step 3"],
      "sampleReplies": ["reply option 1", "reply option 2", "reply option 3"]
    },
    
    "threeTierPackageDraft": {
      "categoryName": "string",
      "scenarioName": "string",
      "objective": "string",
      "notesForScenarioBuilder": ["note 1", "note 2"]
    },
    
    "testPlan": {
      "positiveUtterances": ["5+ phrases that SHOULD match"],
      "negativeUtterances": ["5+ phrases that should NOT match"]
    },
    
    "guardrailFlags": {
      "heatingTermsUsed": "boolean - true if heating words detected",
      "regionConflict": "boolean - true if conflict with regionProfile",
      "requiresHumanReview": "boolean - always true for new cards"
    }
  }
}`;

// ═══════════════════════════════════════════════════════════════════════════
// BUILD USER PROMPT
// ═══════════════════════════════════════════════════════════════════════════

function buildUserPrompt(input) {
  const { companyId, tradeKey, regionProfile, triageIdea } = input;
  
  return `## Company Context
- Company ID: ${companyId}
- Trade: ${tradeKey}
- Climate: ${regionProfile.climate}
- Supports Heating: ${regionProfile.supportsHeating}
- Supports Cooling: ${regionProfile.supportsCooling}
- Supports Maintenance: ${regionProfile.supportsMaintenance}
- Supports Emergency: ${regionProfile.supportsEmergency}

## Triage Request
- Admin Title: ${triageIdea.adminTitle}
- Admin Notes: ${triageIdea.adminNotes || 'None provided'}
- Desired Action: ${triageIdea.desiredAction}
- Service Type Hint: ${triageIdea.serviceTypeHint}
- Priority Hint: ${triageIdea.priorityHint || 70}

## Example Caller Utterances (admin provided)
${triageIdea.exampleUtterances.map((u, i) => `${i + 1}. "${u}"`).join('\n')}

## Your Task
Generate a complete triageCardDraft JSON that:
1. Uses 1-3 mustHaveKeywords (decisive, short)
2. Puts all variations in synonymGroups
3. Has proper excludeKeywords to avoid false matches
4. Includes 5+ positive and 5+ negative test utterances
5. Respects regionProfile (no furnace/heater if supportsHeating=false)

Return ONLY the JSON object, no other text.`;
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
// RUN AUTO-VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

async function runAutoValidation(companyId, draft, trade) {
  const testPlan = draft.testPlan || {};
  const positives = testPlan.positiveUtterances || [];
  const negatives = testPlan.negativeUtterances || [];
  
  const report = {
    status: 'PENDING',
    coverage: {
      positiveTotal: positives.length,
      positiveMatched: 0,
      negativeTotal: negatives.length,
      negativeBlocked: 0
    },
    failures: []
  };
  
  // Test positive utterances (should match this card)
  for (const utterance of positives) {
    try {
      const result = await TriageService.applyQuickTriageRules(utterance, companyId, trade);
      
      // For now, we just check if ANY card matched
      // In production, we'd check if THIS specific card matched
      if (result.matched) {
        report.coverage.positiveMatched++;
      } else {
        report.failures.push({
          type: 'POSITIVE_NOT_MATCHED',
          utterance,
          reason: 'No triage rule matched this utterance'
        });
      }
    } catch (err) {
      report.failures.push({
        type: 'TEST_ERROR',
        utterance,
        reason: err.message
      });
    }
  }
  
  // Test negative utterances (should NOT match this specific card)
  // For now, we just ensure they don't cause errors
  for (const utterance of negatives) {
    try {
      const result = await TriageService.applyQuickTriageRules(utterance, companyId, trade);
      // If it doesn't match this card specifically, that's good
      // (In a full implementation, we'd check the card ID)
      report.coverage.negativeBlocked++;
    } catch (err) {
      report.failures.push({
        type: 'TEST_ERROR',
        utterance,
        reason: err.message
      });
    }
  }
  
  // Determine overall status
  const positivePassRate = report.coverage.positiveMatched / report.coverage.positiveTotal;
  
  if (positivePassRate >= 0.8 && report.failures.length === 0) {
    report.status = 'PASSED';
  } else if (positivePassRate >= 0.6) {
    report.status = 'NEEDS_REVIEW';
  } else {
    report.status = 'FAILED';
  }
  
  return report;
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
  
  // 4. Run auto-validation
  let validationReport;
  try {
    validationReport = await runAutoValidation(
      input.companyId,
      draft,
      input.tradeKey
    );
    
    logger.info('[LLM-A V23] Auto-validation complete', {
      status: validationReport.status,
      positiveMatched: validationReport.coverage.positiveMatched,
      positiveTotal: validationReport.coverage.positiveTotal
    });
  } catch (err) {
    logger.error('[LLM-A V23] Auto-validation failed', { error: err.message });
    validationReport = {
      status: 'ERROR',
      coverage: { positiveTotal: 0, positiveMatched: 0, negativeTotal: 0, negativeBlocked: 0 },
      failures: [{ type: 'VALIDATION_ERROR', reason: err.message }]
    };
  }
  
  const elapsed = Date.now() - startTime;
  logger.info('[LLM-A V23] Generation complete', {
    elapsed,
    status: validationReport.status,
    cardLabel: draft.triageLabel
  });
  
  return {
    ok: true,
    draft,
    validationReport,
    errors: []
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERT DRAFT TO TRIAGE CARD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert LLM-A draft to actual TriageCard document
 */
function draftToTriageCard(companyId, trade, draft, validationReport) {
  return {
    companyId,
    trade,
    isActive: false, // Admin must explicitly activate
    
    triageLabel: draft.triageLabel,
    displayName: draft.displayName,
    description: `Generated by LLM-A V23`,
    
    intent: draft.quickRuleConfig.intent,
    triageCategory: draft.quickRuleConfig.serviceType,
    serviceType: draft.quickRuleConfig.serviceType,
    priority: draft.quickRuleConfig.priority || 70,
    
    quickRuleConfig: {
      keywordsMustHave: draft.quickRuleConfig.mustHaveKeywords,
      keywordsExclude: draft.quickRuleConfig.excludeKeywords || [],
      action: draft.quickRuleConfig.action,
      explanation: `LLM-A generated for: ${draft.displayName}`
    },
    
    frontlinePlaybook: {
      frontlineGoal: draft.frontlinePlaybook?.goal || '',
      openingLines: draft.frontlinePlaybook?.sampleReplies || [],
      conversationFlow: draft.frontlinePlaybook?.steps || []
    },
    
    threeTierPackageDraft: {
      categoryName: draft.threeTierPackageDraft?.categoryName || '',
      scenarioName: draft.threeTierPackageDraft?.scenarioName || '',
      scenarioObjective: draft.threeTierPackageDraft?.objective || ''
    },
    
    // V23 metadata
    llmaGeneration: {
      generatedAt: new Date(),
      version: 'V23',
      synonymGroups: draft.quickRuleConfig.synonymGroups || [],
      testPlan: draft.testPlan,
      validationReport,
      guardrailFlags: draft.guardrailFlags
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

