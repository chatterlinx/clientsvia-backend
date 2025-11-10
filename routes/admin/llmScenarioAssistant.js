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
const { authenticateSingleSession, requireRole } = require('../../middleware/auth');

const router = express.Router();

/**
 * ============================================================================
 * PHASE A.4: Helper to sanitize & normalize draft scenario
 * ============================================================================
 * Ensures all fields match spec, weights are valid, counts are reasonable.
 */
function sanitizeDraft(raw) {
  const draft = {
    scenarioName: (raw.scenarioName || raw.name || 'Untitled Scenario').trim(),
    scenarioType: ['INFO_FAQ', 'ACTION_FLOW', 'SYSTEM_ACK', 'SMALL_TALK'].includes(raw.scenarioType) 
      ? raw.scenarioType 
      : 'INFO_FAQ',
    replyStrategy: ['AUTO', 'FULL_ONLY', 'QUICK_ONLY', 'QUICK_THEN_FULL', 'LLM_WRAP', 'LLM_CONTEXT'].includes(raw.replyStrategy)
      ? raw.replyStrategy
      : 'AUTO',

    exampleUserPhrases: Array.isArray(raw.exampleUserPhrases) 
      ? raw.exampleUserPhrases.filter(p => p && typeof p === 'string').slice(0, 18)
      : [],
    negativeUserPhrases: Array.isArray(raw.negativeUserPhrases)
      ? raw.negativeUserPhrases.filter(p => p && typeof p === 'string').slice(0, 6)
      : [],

    triggers: Array.isArray(raw.triggers)
      ? raw.triggers.filter(t => t && typeof t === 'string').slice(0, 18)
      : [],
    negativeTriggers: Array.isArray(raw.negativeTriggers)
      ? raw.negativeTriggers.filter(t => t && typeof t === 'string').slice(0, 6)
      : [],

    followUpMode: ['NONE', 'ASK_FOLLOWUP_QUESTION', 'ASK_IF_BOOK', 'TRANSFER'].includes(raw.followUpMode)
      ? raw.followUpMode
      : 'NONE',
    followUpQuestionText: (raw.followUpQuestionText && typeof raw.followUpQuestionText === 'string')
      ? raw.followUpQuestionText.trim()
      : null,
    transferTarget: (raw.transferTarget && typeof raw.transferTarget === 'string')
      ? raw.transferTarget.trim()
      : null,

    notes: (raw.notes && typeof raw.notes === 'string') ? raw.notes.trim() : '',
  };

  // Normalize weighted replies
  draft.quickReplies = normalizeWeightedReplies(raw.quickReplies, 4, 6, 'quick');
  draft.fullReplies = normalizeWeightedReplies(raw.fullReplies, 6, 10, 'full');
  draft.followUpPrompts = normalizeWeightedReplies(raw.followUpPrompts, 2, 3, 'followup');

  // minConfidence: clamp to [0.5, 0.9], default 0.7
  let minConf = typeof raw.minConfidence === 'number' ? raw.minConfidence : 0.7;
  draft.minConfidence = Math.min(0.9, Math.max(0.5, minConf));

  // priority: clamp to [-10, 10], default 0
  let prio = typeof raw.priority === 'number' ? raw.priority : 0;
  draft.priority = Math.min(10, Math.max(-10, prio));

  return draft;
}

/**
 * Normalize array of weighted replies or strings into { text, weight }[] format.
 * Slices to max count, defaults missing weights.
 */
function normalizeWeightedReplies(input, minTarget, maxTarget, type) {
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

  // If fewer than minTarget, still OK (best-effort)
  return items;
}

/**
 * POST /api/admin/scenario-assistant/draft
 * 
 * Generate a draft scenario from admin description using LLM
 * 
 * Body:
 *  - companyId: string (optional)
 *  - categoryName: string (e.g., "Business Hours")
 *  - behaviorName: string (e.g., "Empathetic & Reassuring")
 *  - notesFromAdmin: string (REQUIRED - what the scenario should do)
 *  - existingScenario: object (optional, if editing existing)
 */
router.post('/draft', authenticateSingleSession, requireRole('admin'), async (req, res) => {
  try {
    const {
      companyId,
      categoryName,
      behaviorName,
      notesFromAdmin,
      existingScenario,
    } = req.body || {};

    // Validate required input
    if (!notesFromAdmin || !notesFromAdmin.trim()) {
      return res.status(400).json({
        success: false,
        error: 'notesFromAdmin is required - describe what this scenario should do',
      });
    }

    logger.info('[LLM SCENARIO ASSISTANT] Generating draft', {
      companyId,
      categoryName,
      behaviorName,
      notesLength: notesFromAdmin.length,
      isEdit: !!existingScenario,
    });

    // Build system prompt – PHASE A.4 SPEC
    const systemPrompt = `You are an expert contact-center conversation designer for ClientVia.ai.

Your job: turn the admin's description into a SINGLE scenario object with WEIGHTED REPLIES for our AI call assistant.

Respond ONLY with valid JSON. No explanations, no markdown, just pure JSON.

JSON shape (PHASE A.4 SPEC):
{
  "scenarioName": "Short human-readable scenario name",
  "scenarioType": "INFO_FAQ" | "ACTION_FLOW" | "SYSTEM_ACK" | "SMALL_TALK",
  "replyStrategy": "AUTO" | "FULL_ONLY" | "QUICK_ONLY" | "QUICK_THEN_FULL" | "LLM_WRAP" | "LLM_CONTEXT",

  "exampleUserPhrases": [ "phrase1", "phrase2", ... ],           // Target: 12–18
  "negativeUserPhrases": [ "phrase1", "phrase2", ... ],          // Target: 3–6

  "triggers": [ "keyword1", "keyword2", ... ],                   // Target: 12–18
  "negativeTriggers": [ "keyword1", "keyword2", ... ],           // Target: 3–6

  "quickReplies": [                                              // Target: 4–6
    { "text": "short natural intro", "weight": 3 },
    { "text": "another intro variant", "weight": 2 }
  ],
  "fullReplies": [                                               // Target: 6–10
    { "text": "full info with all details", "weight": 4 },
    { "text": "alternative full response", "weight": 3 }
  ],
  "followUpPrompts": [                                           // Target: 2–3
    { "text": "short follow-up sentence", "weight": 3 },
    { "text": "alternative follow-up", "weight": 2 }
  ],

  "followUpMode": "NONE" | "ASK_FOLLOWUP_QUESTION" | "ASK_IF_BOOK" | "TRANSFER",
  "followUpQuestionText": "question string or null",
  "transferTarget": "phone number or queue name or null",

  "minConfidence": 0.7,                                          // Numeric 0.5–0.9
  "priority": 0,                                                 // Numeric -10 to +10

  "notes": "Short internal note for admins"
}

REPLY WEIGHTING GUIDANCE:
- weight: higher = more likely to be selected by ResponseEngine.
- Typical range: 1–5 (1 = rarely selected, 5 = often selected).
- Distribute weights: don't put all weight on one reply.
- Example: 5 quickReplies might have weights [3, 3, 2, 2, 1].

TARGET COUNTS (best-effort):
- exampleUserPhrases: 12–18 natural phrases covering caller intent variety.
- negativeUserPhrases: 3–6 phrases that MUST NOT match (different intent).
- triggers: 12–18 keyword-style triggers; can overlap with exampleUserPhrases.
- negativeTriggers: 3–6 keywords that disqualify this scenario.
- quickReplies: 4–6 short, natural, spoken-friendly intros (5–15 words).
- fullReplies: 6–10 complete, detailed answers for voice (2–5 sentences).
- followUpPrompts: 2–3 short sentences for potential follow-up context (future use).

SCENARIO TYPE & STRATEGY:
- INFO_FAQ: for facts (hours, pricing, policies, address).
  - replyStrategy usually "AUTO".
- ACTION_FLOW: for processes (booking, scheduling, escalation).
  - replyStrategy usually "QUICK_THEN_FULL" or "AUTO".
- SYSTEM_ACK: for confirmations (got it, one moment, transferring).
  - replyStrategy usually "QUICK_ONLY" or "AUTO".
- SMALL_TALK: for rapport, jokes, greetings.
  - replyStrategy usually "QUICK_ONLY" or "AUTO".

FOLLOW-UP BEHAVIOR:
- followUpMode "NONE": no follow-up action (default).
- followUpMode "ASK_FOLLOWUP_QUESTION": append a question to invite continuation (set followUpQuestionText).
- followUpMode "ASK_IF_BOOK": offer booking ("Would you like to schedule?").
- followUpMode "TRANSFER": transfer to human (set transferTarget, e.g., "+15551234567" or "sales_queue").
- If unsure about follow-up, use "NONE" (safest).

MIN CONFIDENCE & PRIORITY:
- minConfidence: 0.5–0.9. Higher = only match if very confident.
  - Set 0.8–0.9 for critical or specific scenarios.
  - Set 0.5–0.7 for broad/fallback scenarios.
- priority: -10 to +10. Higher = prefer this scenario in ambiguous ties.
  - Use 0 for neutral.
  - Use +5 to +10 for high-priority scenarios.
  - Use -5 to -10 for fallback/generic scenarios.

RULES:
- Use simple, natural spoken English (short sentences).
- Each reply should be unique and useful (not duplicates).
- Weights reflect relative importance; balance them (don't clump all weight in one item).
- Provide realistic counts; if fewer than target, that's OK.
- Never return empty arrays; provide at least 1 of each type.
- notes: Brief internal comment (e.g., "Business hours FAQ. High confidence needed.").

Output ONLY the JSON object. No explanation, no markdown.`;

    const userPrompt = `Company: ${companyId || 'unknown'}
Category: ${categoryName || 'unspecified'}
Behavior: ${behaviorName || 'unspecified'}

Admin description:
"""
${notesFromAdmin}
"""

${existingScenario ? `\nExisting scenario (edit mode):\n${JSON.stringify(existingScenario, null, 2)}` : ''}`;

    // Call OpenAI
    logger.debug('[LLM SCENARIO ASSISTANT] Calling OpenAI GPT-4o-mini', {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    });

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 2000,
    });

    // Parse response
    let rawDraft;
    try {
      const rawContent = completion.choices[0].message.content;
      logger.debug('[LLM SCENARIO ASSISTANT] Raw LLM response', {
        length: rawContent.length,
        preview: rawContent.substring(0, 100),
      });
      
      rawDraft = JSON.parse(rawContent);
    } catch (parseErr) {
      logger.error('[LLM SCENARIO ASSISTANT] Failed to parse LLM JSON', {
        error: parseErr.message,
        rawContent: completion.choices[0].message.content,
      });
      return res.status(500).json({
        success: false,
        error: 'LLM response was not valid JSON',
        raw: completion.choices[0].message.content,
      });
    }

    // PHASE A.4: Sanitize & normalize draft to match spec
    const draft = sanitizeDraft(rawDraft);

    logger.info('[LLM SCENARIO ASSISTANT] ✅ Draft generated & sanitized (Phase A.4)', {
      scenarioName: draft.scenarioName,
      scenarioType: draft.scenarioType,
      replyStrategy: draft.replyStrategy,
      examplePhrasesCount: draft.exampleUserPhrases.length,
      triggersCount: draft.triggers.length,
      quickRepliesCount: draft.quickReplies.length,
      fullRepliesCount: draft.fullReplies.length,
      followUpPromptsCount: draft.followUpPrompts.length,
      minConfidence: draft.minConfidence,
      priority: draft.priority,
      followUpMode: draft.followUpMode,
    });

    return res.json({
      success: true,
      data: draft,
      metadata: {
        model: 'gpt-4o-mini',
        tokensUsed: completion.usage.total_tokens,
        generatedAt: new Date().toISOString(),
        phase: 'A.4-blueprint-spec',
      },
    });
  } catch (err) {
    logger.error('[LLM SCENARIO ASSISTANT] Error generating draft scenario', {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      success: false,
      error: 'Internal error generating draft scenario',
      details: err.message,
    });
  }
});

module.exports = router;

