/**
 * ============================================================================
 * LLM SCENARIO ASSISTANT - ADMIN ROUTE
 * ============================================================================
 * 
 * Purpose: Help admins draft scenarios using LLM intelligence
 * 
 * Endpoint: POST /api/admin/scenario-assistant/draft
 * 
 * Flow:
 * 1. Admin enters description of what scenario should do
 * 2. LLM generates: triggers, user phrases, replies, type, strategy, follow-ups
 * 3. Frontend applies draft to form fields for review/editing
 * 4. Admin saves scenario normally
 * 
 * No impact on live calls; purely admin-side tooling.
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger');
const openaiClient = require('../../config/openai');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { getSettings } = require('../../services/llmSettingsService');
const {
  DEFAULT_LLM_ENTERPRISE_SETTINGS,
  buildScenarioArchitectSystemPromptFromSettings,
  getEffectiveModelParams
} = require('../../config/llmScenarioPrompts');

const router = express.Router();

// ============================================================================
// ADMIN-ONLY PROTECTION
// ============================================================================
// Apply JWT auth + admin role requirement to ALL routes in this file
router.use(authenticateJWT);
router.use(requireRole('admin'));

// LLM Settings helpers are now in config/llmScenarioPrompts.js
// This keeps all prompt text and configuration in one place

/**
 * ============================================================================
 * EXTENDED: Sanitize & normalize RICH draft scenario (Phase C.1)
 * ============================================================================
 * Now handles full scenario shape including entities, variables, advanced settings.
 */
function sanitizeScenarioDraft(raw) {
  const draft = {
    // BASIC
    name: (raw.name || raw.scenarioName || 'Untitled Scenario').trim(),
    scenarioType: ['INFO_FAQ', 'ACTION_FLOW', 'SYSTEM_ACK', 'SMALL_TALK'].includes(raw.scenarioType) 
      ? raw.scenarioType 
      : 'INFO_FAQ',
    replyStrategy: ['AUTO', 'FULL_ONLY', 'QUICK_ONLY', 'QUICK_THEN_FULL', 'LLM_WRAP', 'LLM_CONTEXT'].includes(raw.replyStrategy)
      ? raw.replyStrategy
      : 'AUTO',

    // TRIGGERS & PHRASES
    triggerPhrases: Array.isArray(raw.triggerPhrases) 
      ? raw.triggerPhrases.filter(t => t && typeof t === 'string').slice(0, 20)
      : [],
    negativeTriggers: Array.isArray(raw.negativeTriggers)
      ? raw.negativeTriggers.filter(t => t && typeof t === 'string').slice(0, 15)
      : [],
    regexTriggers: Array.isArray(raw.regexTriggers)
      ? raw.regexTriggers.filter(t => t && typeof t === 'string').slice(0, 10)
      : [],

    // REPLIES (weighted)
    quickReplies: normalizeWeightedReplies(raw.quickReplies, 3, 5),
    fullReplies: normalizeWeightedReplies(raw.fullReplies, 4, 8),
    followUpPrompts: normalizeWeightedReplies(raw.followUpPrompts, 2, 3),

    // FOLLOW-UP BEHAVIOR
    followUpMode: ['NONE', 'ASK_IF_BOOK', 'ASK_FOLLOWUP_QUESTION', 'TRANSFER'].includes(raw.followUpMode)
      ? raw.followUpMode
      : 'NONE',
    followUpQuestionText: (raw.followUpQuestionText && typeof raw.followUpQuestionText === 'string')
      ? raw.followUpQuestionText.trim()
      : null,
    transferTarget: (raw.transferTarget && typeof raw.transferTarget === 'string')
      ? raw.transferTarget.trim()
      : null,

    // ENTITIES & VARIABLES
    entities: Array.isArray(raw.entities)
      ? raw.entities.filter(e => e && typeof e === 'string').slice(0, 20)
      : [],
    dynamicTemplateVariables: normalizeVariables(raw.dynamicTemplateVariables),

    // CONFIDENCE & PRIORITY
    minConfidence: clampNumber(raw.minConfidence, 0.5, 0.9, 0.7),
    priority: clampNumber(raw.priority, -10, 10, 0),

    // ADVANCED BEHAVIOR
    cooldownSeconds: typeof raw.cooldownSeconds === 'number' ? Math.max(0, raw.cooldownSeconds) : 0,
    handoffPolicy: ['NEVER', 'LOW_CONFIDENCE_ONLY', 'ALWAYS_IF_REQUESTED'].includes(raw.handoffPolicy)
      ? raw.handoffPolicy
      : 'NEVER',

    // SILENCE POLICY
    silencePolicy: normalizeSilencePolicy(raw.silencePolicy),

    // TIMED FOLLOW-UP
    timedFollowup: normalizeTimedFollowup(raw.timedFollowup),

    // HOOKS & TESTS
    actionHooks: Array.isArray(raw.actionHooks)
      ? raw.actionHooks.filter(h => h && typeof h === 'string').slice(0, 20)
      : [],
    testPhrases: Array.isArray(raw.testPhrases)
      ? raw.testPhrases.filter(p => p && typeof p === 'string').slice(0, 10)
      : [],

    // NLP SUGGESTIONS
    suggestedFillerWords: Array.isArray(raw.suggestedFillerWords)
      ? raw.suggestedFillerWords.filter(w => w && typeof w === 'string').slice(0, 30)
      : [],
    suggestedSynonyms: normalizeSynonyms(raw.suggestedSynonyms),

    // NOTES
    notes: (raw.notes && typeof raw.notes === 'string') ? raw.notes.trim() : '',
  };

  return draft;
}

/**
 * Normalize array of weighted replies or strings into { text, weight }[] format.
 */
function normalizeWeightedReplies(input, minTarget, maxTarget) {
  if (!Array.isArray(input)) return [];

  let items = input
    .filter(item => {
      if (!item) return false;
      if (typeof item === 'string') return item.trim().length > 0;
      if (typeof item === 'object' && item.text) return String(item.text).trim().length > 0;
      return false;
    })
    .map(item => {
      if (typeof item === 'string') {
        return { text: item.trim(), weight: 3 };
      }
      const weight = typeof item.weight === 'number' && item.weight > 0 ? item.weight : 3;
      return { text: String(item.text).trim(), weight: Math.min(5, Math.max(1, weight)) };
    })
    .slice(0, maxTarget);

  return items;
}

/**
 * Clamp a number to [min, max] with a default fallback.
 */
function clampNumber(value, min, max, defaultValue) {
  if (typeof value !== 'number') return defaultValue;
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalize dynamic template variables (keys must not contain {})
 */
function normalizeVariables(input) {
  if (!input || typeof input !== 'object') return {};
  
  const normalized = {};
  Object.keys(input).forEach(key => {
    const cleanKey = key.trim().replace(/[{}]/g, '');
    if (cleanKey && typeof input[key] === 'string') {
      normalized[cleanKey] = input[key].trim();
    }
  });
  
  return normalized;
}

/**
 * Normalize silence policy object
 */
function normalizeSilencePolicy(input) {
  if (!input || typeof input !== 'object') {
    return { enabled: false };
  }

  return {
    enabled: !!input.enabled,
    firstPrompt: (input.firstPrompt && typeof input.firstPrompt === 'string') ? input.firstPrompt.trim() : '',
    repeatPrompt: (input.repeatPrompt && typeof input.repeatPrompt === 'string') ? input.repeatPrompt.trim() : '',
    maxPrompts: typeof input.maxPrompts === 'number' ? Math.max(1, input.maxPrompts) : 3,
    delaySeconds: typeof input.delaySeconds === 'number' ? Math.max(0, input.delaySeconds) : 3,
  };
}

/**
 * Normalize timed followup object
 */
function normalizeTimedFollowup(input) {
  if (!input || typeof input !== 'object') {
    return { enabled: false };
  }

  return {
    enabled: !!input.enabled,
    delaySeconds: typeof input.delaySeconds === 'number' ? Math.max(0, input.delaySeconds) : 0,
    extensionSeconds: typeof input.extensionSeconds === 'number' ? Math.max(0, input.extensionSeconds) : 0,
  };
}

/**
 * Normalize synonyms object { base: [variants...] }
 */
function normalizeSynonyms(input) {
  if (!input || typeof input !== 'object') return {};

  const normalized = {};
  Object.keys(input).forEach(base => {
    const variants = input[base];
    if (Array.isArray(variants)) {
      const cleanVariants = variants
        .filter(v => v && typeof v === 'string')
        .map(v => v.trim())
        .slice(0, 10);
      if (cleanVariants.length > 0) {
        normalized[base.trim()] = cleanVariants;
      }
    }
  });

  return normalized;
}

/**
 * POST /api/admin/scenario-assistant/draft
 * 
 * Generate a full-form scenario draft from admin description using LLM
 * Supports clarifying questions for nuanced scenarios
 * 
 * PHASE C.1: Full-form scenario architect with conversational questions
 * 
 * Request Body:
 *  - description: string (REQUIRED - admin's description of scenario)
 *  - channel: string (default 'voice')
 *  - templateVariables: string[] (list of available variables like {companyname}, {phone})
 * 
 * Response:
 *  - status: "ready" | "needs_clarification"
 *  - questions: string[] (only if needs_clarification)
 *  - draft: object (only if status === "ready")
 */
router.post('/draft', async (req, res) => {
  try {
    const {
      description,
      conversationLog = [],
      channel = 'voice',
      templateVariables = [],
    } = req.body || {};

    // Validate required input
    if (!description || !description.trim()) {
      return res.status(400).json({
        success: false,
        error: 'description is required - describe what this scenario should do',
      });
    }

    // Load enterprise LLM settings
    let llmSettings;
    try {
      llmSettings = await getSettings('global');
      logger.debug('[LLM SCENARIO ASSISTANT] Loaded LLM enterprise settings', {
        activeProfile: llmSettings.defaults?.activeProfile,
        strictCompliance: llmSettings.compliance?.strictComplianceMode,
      });
    } catch (err) {
      logger.warn('[LLM SCENARIO ASSISTANT] Failed to load settings, using defaults', {
        error: err.message,
      });
      llmSettings = DEFAULT_LLM_ENTERPRISE_SETTINGS;
    }

    // Get effective model parameters based on active profile
    const modelParams = getEffectiveModelParams(llmSettings);

    logger.info('[LLM SCENARIO ASSISTANT] Processing scenario request with LLM settings', {
      descriptionLength: description.length,
      channel,
      templateVarCount: templateVariables.length,
      conversationTurns: Array.isArray(conversationLog) ? conversationLog.length : 0,
      profile: modelParams.profileKey,
      model: modelParams.model,
      temperature: modelParams.temperature,
    });

    // Build system prompt using centralized function (includes base + profile + compliance)
    let systemPrompt = buildScenarioArchitectSystemPromptFromSettings(llmSettings);

    // Append the scenario-specific instructions (output format, rules, etc.)
    systemPrompt += `\n\n===== SCENARIO DRAFTING INSTRUCTIONS =====

Your specific task:
- Help admins design WORLD-CLASS call-handling scenarios
- Ask THOROUGH clarifying questions (never lazy, never skip)
- Validate settings against scenario type and reply strategy
- Cross-check confidence thresholds, entity captures, follow-up modes
- Generate comprehensive scenario drafts with all 30+ fields
- ACT LIKE A CODE REVIEWER — verify every detail before sign-off

ENTERPRISE-GRADE VALIDATION CHECKLIST (YOUR INTERNAL PROCESS):
Before generating a draft, mentally verify:
1. ✓ Is scenarioType aligned with the described intent?
2. ✓ Does replyStrategy match the scenarioType (e.g., ACTION_FLOW → QUICK_THEN_FULL)?
3. ✓ Is minConfidence appropriate for the scenario specificity?
4. ✓ Are entities captured if the scenario needs data (booking, rescheduling)?
5. ✓ Is followUpMode set correctly (TRANSFER for escalations, ASK_IF_BOOK for bookings)?
6. ✓ Are all required trigger phrases covered (12–18 variants)?
7. ✓ Are negative triggers preventing false matches?
8. ✓ Are replies natural and spoken-friendly?
9. ✓ Is priority set correctly (high for urgent, low for fallback)?
10. ✓ Do NLP suggestions (filler words, synonyms) make sense?

IF ANY CHECKLIST ITEM SEEMS QUESTIONABLE:
Ask clarifying questions to resolve it. NEVER assume. NEVER take shortcuts.

RESPONSE FORMAT:
You MUST respond with ONLY valid JSON. No markdown, no explanations.

{
  "status": "ready" | "needs_clarification",
  "questions": [ "question1?", "question2?" ],   // ONLY if status === "needs_clarification"
  "draft": { ... }                               // ONLY if status === "ready"
}

WHEN TO ASK CLARIFYING QUESTIONS:
Set status="needs_clarification" if ANY of these apply:
1. The description is vague or missing key details
2. Scenario type seems misaligned with the intent
3. You're unsure about entity capture needs
4. Follow-up behavior is unclear (escalate vs. ask question?)
5. Settings alignment needs verification (e.g., ACTION_FLOW + confidence level)
6. Negative triggers seem insufficient to prevent false matches
7. Priority or minConfidence need admin guidance
8. The scenario needs data capture but no entities defined

Return 1–4 FOCUSED questions. Be specific.
Set draft=null in this case.

WHEN TO GENERATE A FULL DRAFT:
ONLY when you're 100% confident about ALL checklist items.
If ANY doubt remains, ask questions instead.
Set status="ready" and return a complete "draft" object.

FULL DRAFT SPECIFICATION (Phase C.1):
{
  "name": "Human-readable scenario name",

  "scenarioType": "INFO_FAQ" | "ACTION_FLOW" | "SYSTEM_ACK" | "SMALL_TALK",
  "replyStrategy": "AUTO" | "FULL_ONLY" | "QUICK_ONLY" | "QUICK_THEN_FULL" | "LLM_WRAP" | "LLM_CONTEXT",

  // 1. TRIGGERS & EXAMPLES (many variants for matching robustness)
  "triggerPhrases": [ "phrase1", ... ],          // 12–18 natural caller phrases
  "negativeTriggers": [ "phrase1", ... ],        // 5–10 phrases that should NOT match
  "regexTriggers": [ "pattern1", ... ],          // Optional regex patterns

  // 2. REPLIES (weighted for selective delivery)
  "quickReplies": [
    { "text": "short acknowledgement", "weight": 3 },
    { "text": "another variant", "weight": 2 }
  ],
  "fullReplies": [
    { "text": "complete answer with all details", "weight": 4 },
    { "text": "alternative full response", "weight": 3 }
  ],
  "followUpPrompts": [
    { "text": "follow-up question or suggestion", "weight": 3 }
  ],

  // 3. FOLLOW-UP BEHAVIOR (shape next interaction)
  "followUpMode": "NONE" | "ASK_IF_BOOK" | "ASK_FOLLOWUP_QUESTION" | "TRANSFER",
  "followUpQuestionText": "Will you be scheduling a visit?" | null,
  "transferTarget": "+15551234567" | "sales_queue" | null,

  // 4. ENTITIES & VARIABLES (capture caller data)
  "entities": [ "preferred_date", "preferred_time", "customer_name" ],  // What to capture from caller
  "dynamicTemplateVariables": {
    "companyname": "Your service provider's name",
    "phone": "Your main phone number",
    "office_city": "City where you're located"
  },
  // NOTE: ALWAYS use templates like {companyname}, {phone}, {office_city}.
  // NEVER insert real values. The template will substitute them per company.

  // 5. CONFIDENCE & PRIORITY
  "minConfidence": 0.7,                          // 0.5–0.9: when to accept this scenario
  "priority": 0,                                 // -10..+10: tiebreaker preference

  // 6. ADVANCED BEHAVIOR
  "cooldownSeconds": 30,                         // Avoid repeating this scenario too soon
  "handoffPolicy": "NEVER" | "LOW_CONFIDENCE_ONLY" | "ALWAYS_IF_REQUESTED",

  "silencePolicy": {
    "enabled": true,
    "firstPrompt": "Are you still there?",
    "repeatPrompt": "I'm here to help.",
    "maxPrompts": 3,
    "delaySeconds": 3
  },

  "timedFollowup": {
    "enabled": false,
    "delaySeconds": 0,
    "extensionSeconds": 0
  },

  // 7. ACTION HOOKS & TESTING
  "actionHooks": [ "offer_scheduling", "capture_email" ],  // Backend triggers
  "testPhrases": [ "Can I reschedule my appointment?", "I need to move my visit", ... ],  // 5–10 phrases

  // 8. NLP SUGGESTIONS (for template-level learning)
  "suggestedFillerWords": [ "uh", "like", "you know", ... ],
  "suggestedSynonyms": {
    "appointment": [ "visit", "meeting", "consultation", "session" ],
    "cancel": [ "reschedule", "change", "move", "delay" ]
  },

  "notes": "Internal note for admins (e.g., 'High-volume scenario, needs robust triggers')"
}

GUIDELINES:

1. TRIGGERS & EXAMPLES:
   - Provide 12–18 triggerPhrases covering realistic caller language
   - Provide 5–10 negativeTriggers to prevent false matches
   - Use natural, conversational phrases, not formal business-speak

2. REPLIES:
   - quickReplies (3–5): Brief acknowledgements, 5–15 words, spoken-friendly
   - fullReplies (4–8): Complete answers with context, 2–5 sentences
   - followUpPrompts (2–3): Gentle next-step invitations
   - Balance weights so no single reply dominates

3. ENTITIES:
   - Identify what data the scenario should capture (date, time, name, email, etc.)
   - These become variables in the conversation

4. VARIABLES:
   - Use ONLY template placeholders: {companyname}, {phone}, {address}, {website_url}, etc.
   - NEVER insert real values
   - Provide descriptions so the template admin understands what should be filled

5. SCENARIO TYPE DEFAULTS:
   - INFO_FAQ (facts): replyStrategy often "AUTO" or "FULL_ONLY"
   - ACTION_FLOW (flows): replyStrategy often "QUICK_THEN_FULL"
   - SYSTEM_ACK (internal): replyStrategy often "QUICK_ONLY"
   - SMALL_TALK: replyStrategy often "QUICK_ONLY"

6. FOLLOW-UP MODES:
   - NONE: scenario ends, no further action
   - ASK_FOLLOWUP_QUESTION: append followUpQuestionText to the response
   - ASK_IF_BOOK: offer booking ("Would you like to schedule?")
   - TRANSFER: hand off to {transferTarget} (person or queue)

7. CONFIDENCE & PRIORITY:
   - minConfidence: 0.5–0.9 (higher for specific, lower for generic)
   - priority: -10 to +10 (higher priority wins ties)
   - Use minConfidence 0.8–0.9 for critical scenarios (emergencies, account cancellation)
   - Use priority +5 to +10 for high-urgency scenarios

8. NLP SUGGESTIONS:
   - suggestedFillerWords: junk phrases to strip from caller input
   - suggestedSynonyms: colloquial phrases → normalized terms for matching
   - These improve Tier 1 (rule-based) matching over time

OUTPUT RULES:
- ALWAYS respond with valid JSON only.
- If questions are needed, set status="needs_clarification" and draft=null.
- If ready, set status="ready" and populate draft completely.
- CRITICAL: When status="ready", ALSO include a "checklistSummary" object:
  {
    "coverageScore": 0.85,                           // 0–1: how complete is the form
    "settingsNeedingAttention": [
      {
        "field": "handoffPolicy",
        "reason": "Not mentioned; defaulting to LOW_CONFIDENCE_ONLY. Verify this is correct."
      },
      {
        "field": "silencePolicy",
        "reason": "No mention of dead air handling; set to conservative defaults."
      }
    ]
  }
- Never leave arrays empty; provide at least 1 item per array.
- Never use real company names, phone numbers, or personal data.
- Use {variable} syntax for template placeholders.
- When you make an assumption (e.g., default cooldown, guess at priority), LIST it in checklistSummary.
- This ensures admin can see EXACTLY what you decided and why.`.trim();

    const templateVarList = Array.isArray(templateVariables) && templateVariables.length > 0
      ? `\nKnown template variables (available to use as {variable} placeholders):\n${templateVariables.map(v => `- {${v}}`).join('\n')}`
      : '';

    // Build conversation history for multi-turn (Phase C.1 conversational)
    const conversationHistory = Array.isArray(conversationLog) && conversationLog.length > 0
      ? `\nPrevious conversation:\n${conversationLog.map(msg => `${msg.role === 'assistant' ? 'AI' : 'Admin'}: ${msg.content}`).join('\n')}\n`
      : '';

    const userPrompt = `Channel: ${channel}

Admin's scenario description:
"""
${description.trim()}
"""
${conversationHistory}${templateVarList}

If you need clarification before creating a full-quality scenario, return status="needs_clarification" with 1–3 clear questions.
Otherwise, return status="ready" with a comprehensive "draft" object.`.trim();

    // Call OpenAI with enterprise settings
    logger.debug('[LLM SCENARIO ASSISTANT] Calling OpenAI with enterprise settings', {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      channel,
      model: modelParams.model,
      temperature: modelParams.temperature,
      topP: modelParams.topP,
      maxTokens: modelParams.maxTokens,
      profile: modelParams.profileName,
    });

    const completion = await openaiClient.chat.completions.create({
      model: modelParams.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: modelParams.temperature,
      top_p: modelParams.topP,
      max_tokens: modelParams.maxTokens,
    });

    // Parse response
    let parsed;
    try {
      const rawContent = completion.choices[0].message.content;
      logger.debug('[LLM SCENARIO ASSISTANT] LLM response received', {
        length: rawContent.length,
        preview: rawContent.substring(0, 150),
      });
      
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      logger.error('[LLM SCENARIO ASSISTANT] Failed to parse LLM JSON', {
        error: parseErr.message,
      });
      return res.status(500).json({
        success: false,
        error: 'LLM response was not valid JSON',
      });
    }

    // Route based on status
    const status = parsed.status === 'needs_clarification' ? 'needs_clarification' : 'ready';
    const questions = Array.isArray(parsed.questions) 
      ? parsed.questions.filter(q => q && typeof q === 'string').slice(0, 5)
      : [];

    let draft = null;

    if (status === 'ready' && parsed.draft && typeof parsed.draft === 'object') {
      // Sanitize & normalize the draft (Phase C.1 extended)
      draft = sanitizeScenarioDraft(parsed.draft);

      logger.info('[LLM SCENARIO ASSISTANT] ✅ Full scenario draft generated (Phase C.1)', {
        name: draft.name,
        scenarioType: draft.scenarioType,
        replyStrategy: draft.replyStrategy,
        triggersCount: draft.triggerPhrases.length,
        negativesCount: draft.negativeTriggers.length,
        quickRepliesCount: draft.quickReplies.length,
        fullRepliesCount: draft.fullReplies.length,
        entitiesCount: draft.entities.length,
        variablesCount: Object.keys(draft.dynamicTemplateVariables).length,
      });
    } else if (status === 'needs_clarification') {
      logger.info('[LLM SCENARIO ASSISTANT] Clarifying questions needed', {
        questionCount: questions.length,
      });
    }

    // Extract checklistSummary if LLM provided it
    const checklistSummary = status === 'ready' && parsed.checklistSummary
      ? parsed.checklistSummary
      : {
          coverageScore: draft ? 0.9 : 0.5,
          settingsNeedingAttention: [],
        };

    return res.json({
      success: true,
      status,
      questions: status === 'needs_clarification' ? questions : undefined,
      draft: status === 'ready' ? draft : null,
      checklistSummary: status === 'ready' ? checklistSummary : undefined,
      metadata: {
        model: modelParams.model,
        profile: modelParams.profileKey,
        profileLabel: modelParams.profileLabel,
        temperature: modelParams.temperature,
        topP: modelParams.topP,
        maxTokens: modelParams.maxTokens,
        safetyMode: modelParams.safetyMode,
        tokensUsed: completion.usage.total_tokens,
        generatedAt: new Date().toISOString(),
        phase: 'C.1-full-scenario-architect-with-enterprise-settings',
      },
    });
  } catch (err) {
    logger.error('[LLM SCENARIO ASSISTANT] Error processing scenario request', {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      success: false,
      error: 'Internal error processing scenario',
      details: err.message,
    });
  }
});

module.exports = router;

