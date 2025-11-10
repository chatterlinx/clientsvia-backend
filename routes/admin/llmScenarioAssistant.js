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

    // Build system prompt
    const systemPrompt = `You are an expert contact-center conversation designer for ClientVia.ai.

Your job: turn the admin's description into a SINGLE scenario object for our AI call assistant.

Respond ONLY with valid JSON. No explanations, no markdown, just pure JSON.

JSON shape:
{
  "name": "Short human-readable scenario name",
  "scenarioType": "INFO_FAQ" | "ACTION_FLOW" | "SYSTEM_ACK" | "SMALL_TALK",
  "replyStrategy": "AUTO" | "FULL_ONLY" | "QUICK_ONLY" | "QUICK_THEN_FULL",
  "exampleUserPhrases": [ "phrase1", "phrase2", ... ],
  "negativeUserPhrases": [ "phrase1", "phrase2", ... ],
  "triggers": [ "keyword1", "keyword2", ... ],
  "negativeTriggers": [ "keyword1", "keyword2", ... ],
  "quickReplies": [ "short natural intro 1", "short natural intro 2", ... ],
  "fullReplies": [ "full info with all details 1", "full info 2", ... ],
  "followUpMode": "NONE" | "ASK_FOLLOWUP_QUESTION" | "ASK_IF_BOOK" | "TRANSFER",
  "followUpQuestionText": null,
  "transferTarget": null,
  "notes": "Short internal note for admins"
}

Rules:
- Use simple, natural spoken English (short sentences).
- Provide 10–15 exampleUserPhrases with varied wording.
- Provide 2–5 negativeUserPhrases for things that should NOT match this scenario.
- triggers: 5–10 keywords that identify this scenario.
- negativeTriggers: 1–3 keywords that should block this scenario.
- quickReplies: 3–5 short natural voice intros (5–15 words each).
- fullReplies: 3–5 full responses with complete information (2–3 sentences each).
- scenarioType:
  * "INFO_FAQ" for facts (hours, pricing, policies, address).
  * "ACTION_FLOW" for processes (booking, scheduling, escalation).
  * "SYSTEM_ACK" for confirmations (got it, one moment, transferring).
  * "SMALL_TALK" for rapport/jokes/greetings.
- replyStrategy:
  * "AUTO" by default (will choose best reply intelligently).
  * "FULL_ONLY" if you want complete info in voice.
  * "QUICK_ONLY" for very short confirmations.
- followUpMode:
  * "NONE" if nothing special after response.
  * "ASK_FOLLOWUP_QUESTION" if user should be invited to continue.
  * "ASK_IF_BOOK" if you want to offer booking ("Would you like to book?").
  * "TRANSFER" only if admin explicitly wants human transfer.
- If unsure, use sensible defaults: "AUTO", "ASK_FOLLOWUP_QUESTION", followUpQuestionText = "Is there anything else I can help you with?".
- notes: Brief internal comment (e.g., "Handles all business hours queries").

Output ONLY the JSON object. No explanation.`;

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
    let draft;
    try {
      const rawContent = completion.choices[0].message.content;
      logger.debug('[LLM SCENARIO ASSISTANT] Raw LLM response', {
        length: rawContent.length,
        preview: rawContent.substring(0, 100),
      });
      
      draft = JSON.parse(rawContent);
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

    logger.info('[LLM SCENARIO ASSISTANT] ✅ Draft generated successfully', {
      scenarioName: draft.name,
      scenarioType: draft.scenarioType,
      replyStrategy: draft.replyStrategy,
      triggersCount: (draft.triggers || []).length,
      quickRepliesCount: (draft.quickReplies || []).length,
      fullRepliesCount: (draft.fullReplies || []).length,
      followUpMode: draft.followUpMode,
    });

    return res.json({
      success: true,
      data: draft,
      metadata: {
        model: 'gpt-4o-mini',
        tokensUsed: completion.usage.total_tokens,
        generatedAt: new Date().toISOString(),
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

