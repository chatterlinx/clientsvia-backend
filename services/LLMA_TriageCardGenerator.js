// services/LLMA_TriageCardGenerator.js
// V22 LLM-A: Admin-only triage card draft generator
// This service is NEVER called during live calls - only from admin UI

const { OpenAI } = require('openai');
const logger = require('../utils/logger');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `
You are an expert AI triage architect for a service-business call receptionist.

Your job:
- Take a triage scenario description.
- Output ONE JSON object with all required fields.
- Do NOT include any text outside valid JSON.
- Do NOT invent prices, discounts, or company-specific policies.
- Use short, reusable sentences suitable for many callers.
- If unsure, keep wording neutral and safe.

Actions allowed: "DIRECT_TO_3TIER", "EXPLAIN_AND_PUSH", "ESCALATE_TO_HUMAN", "TAKE_MESSAGE", "END_CALL_POLITE".

Service types allowed: "REPAIR", "MAINTENANCE", "EMERGENCY", "OTHER".

Output ONLY valid JSON with this exact structure:

{
  "triageLabel": "STRING_SNAKE_CASE",
  "displayName": "Short human name for UI",
  "description": "One-sentence explanation of this card",
  "intent": "HIGH_LEVEL_INTENT",
  "triageCategory": "CATEGORY_STRING",
  "serviceType": "REPAIR|MAINTENANCE|EMERGENCY|OTHER",
  "priority": 100,

  "quickRuleConfig": {
    "keywordsMustHave": ["keyword1", "keyword2"],
    "keywordsExclude": ["exclude1", "exclude2"],
    "action": "DIRECT_TO_3TIER|EXPLAIN_AND_PUSH|ESCALATE_TO_HUMAN|TAKE_MESSAGE|END_CALL_POLITE",
    "explanation": "Why this rule exists",
    "qnaCardRef": null
  },

  "frontlinePlaybook": {
    "frontlineGoal": "What the frontline agent should achieve",
    "openingLines": ["Opening line 1", "Opening line 2"],
    "explainAndPushLines": ["Explain line 1", "Push line 2"],
    "objectionHandling": [
      { "customer": "Customer objection", "agent": "Agent response" }
    ]
  },

  "actionPlaybooks": {
    "explainAndPush": {
      "explanationLines": ["Explanation 1", "Explanation 2"],
      "pushLines": ["Push 1", "Push 2"],
      "objectionPairs": [
        { "customer": "Objection", "agent": "Response" }
      ]
    },
    "escalateToHuman": {
      "reasonLabel": "Why we escalate",
      "preTransferLines": ["Transfer line 1"]
    },
    "takeMessage": {
      "introLines": ["Message intro"],
      "fieldsToCollect": ["name", "phone", "address", "issueSummary"],
      "closingLines": ["Closing line"]
    },
    "endCallPolite": {
      "reasonLabel": "Why we end",
      "closingLines": ["Polite closing"]
    }
  },

  "threeTierPackageDraft": {
    "categoryName": "Category name",
    "categoryDescription": "Category description",
    "scenarioName": "Scenario name",
    "scenarioObjective": "What the scenario should do",
    "scenarioExamples": ["Example 1", "Example 2"],
    "suggestedStepsOutline": ["Step 1", "Step 2", "Step 3"],
    "notesForAdmin": "Admin notes"
  }
}

RULES:
- keywordsMustHave: Include 3-8 phrases that MUST appear in user input to match. Use lowercase.
- keywordsExclude: Include 2-5 phrases that should PREVENT matching. Use lowercase.
- All lines should be short (1-2 sentences), professional, and caller-friendly.
- Never include dollar amounts, specific times, or company-specific details.
- Generate at least 3 objection pairs for common pushback scenarios.
`.trim();

// ═══════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a triage card draft from admin scenario spec.
 * 
 * @param {Object} triageScenarioSpec - Input from Admin UI
 * @param {string} triageScenarioSpec.companyId - Company ID
 * @param {string} triageScenarioSpec.trade - Trade (e.g., "HVAC", "PLUMBING")
 * @param {string} triageScenarioSpec.scenarioTitle - Brief title
 * @param {string} triageScenarioSpec.scenarioDescription - Detailed description
 * @param {string[]} [triageScenarioSpec.targetServiceTypes] - Hints for service types
 * @param {string} [triageScenarioSpec.preferredAction] - Hint for action
 * @param {string} [triageScenarioSpec.adminNotes] - Additional context
 * @param {string} [triageScenarioSpec.language] - Language code (default: en-US)
 * 
 * @returns {Object} triageCardDraft - Ready to insert into TriageCard model
 */
async function generateTriageCardDraft(triageScenarioSpec) {
  const {
    trade,
    scenarioTitle,
    scenarioDescription,
    targetServiceTypes,
    preferredAction,
    adminNotes,
    language
  } = triageScenarioSpec;

  const userMessage = JSON.stringify(
    {
      trade: trade || 'GENERAL',
      scenarioTitle: scenarioTitle || 'Untitled Scenario',
      scenarioDescription: scenarioDescription || '',
      targetServiceTypes: targetServiceTypes || ['OTHER'],
      preferredAction: preferredAction || null,
      adminNotes: adminNotes || '',
      language: language || 'en-US'
    },
    null,
    2
  );

  logger.info('[LLM-A] Generating triage card draft', {
    trade,
    scenarioTitle,
    preferredAction
  });

  let responseText;
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    responseText = completion.choices[0]?.message?.content;
    
    if (!responseText) {
      throw new Error('Empty response from LLM');
    }
  } catch (err) {
    logger.error('[LLM-A] OpenAI API error', {
      error: err.message,
      trade,
      scenarioTitle
    });
    throw new Error(`LLM-A generation failed: ${err.message}`);
  }

  // Parse JSON response
  let draft;
  try {
    draft = JSON.parse(responseText);
  } catch (parseErr) {
    logger.error('[LLM-A] JSON parse error', {
      error: parseErr.message,
      responsePreview: responseText?.substring(0, 200)
    });
    throw new Error('LLM-A returned invalid JSON');
  }

  // Validate required fields
  if (!draft.triageLabel || !draft.displayName || !draft.quickRuleConfig) {
    logger.error('[LLM-A] Missing required fields', {
      hasTriageLabel: !!draft.triageLabel,
      hasDisplayName: !!draft.displayName,
      hasQuickRuleConfig: !!draft.quickRuleConfig
    });
    throw new Error('LLM-A response missing required fields');
  }

  // Normalize triageLabel
  draft.triageLabel = String(draft.triageLabel)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  // Ensure priority
  if (typeof draft.priority !== 'number') {
    draft.priority = 100;
  }

  // Ensure serviceType is valid
  const validServiceTypes = ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER'];
  if (!validServiceTypes.includes(draft.serviceType)) {
    draft.serviceType = 'OTHER';
  }

  // Ensure action is valid
  const validActions = ['DIRECT_TO_3TIER', 'EXPLAIN_AND_PUSH', 'ESCALATE_TO_HUMAN', 'TAKE_MESSAGE', 'END_CALL_POLITE'];
  if (!validActions.includes(draft.quickRuleConfig?.action)) {
    draft.quickRuleConfig.action = 'DIRECT_TO_3TIER';
  }

  // Lowercase keywords for matching
  if (draft.quickRuleConfig.keywordsMustHave) {
    draft.quickRuleConfig.keywordsMustHave = draft.quickRuleConfig.keywordsMustHave
      .map(k => String(k).toLowerCase().trim())
      .filter(Boolean);
  }
  if (draft.quickRuleConfig.keywordsExclude) {
    draft.quickRuleConfig.keywordsExclude = draft.quickRuleConfig.keywordsExclude
      .map(k => String(k).toLowerCase().trim())
      .filter(Boolean);
  }

  logger.info('[LLM-A] ✅ Generated triage card draft', {
    triageLabel: draft.triageLabel,
    displayName: draft.displayName,
    intent: draft.intent,
    serviceType: draft.serviceType,
    action: draft.quickRuleConfig.action,
    keywordCount: draft.quickRuleConfig.keywordsMustHave?.length || 0
  });

  return draft;
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH GENERATION (for seeding)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate multiple triage cards from a list of specs.
 * Useful for seeding a company with common scenarios.
 */
async function generateMultipleCards(specs) {
  const results = [];
  
  for (const spec of specs) {
    try {
      const draft = await generateTriageCardDraft(spec);
      results.push({ success: true, spec, draft });
    } catch (err) {
      results.push({ success: false, spec, error: err.message });
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  generateTriageCardDraft,
  generateMultipleCards
};

