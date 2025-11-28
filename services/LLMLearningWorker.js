/**
 * ============================================================================
 * LLM LEARNING WORKER – BACKGROUND TASK PROCESSOR
 * ============================================================================
 * 
 * PURPOSE:
 * Process LLMLearningTask events (created when Tier-3 is used).
 * Turn each task into high-quality AIGatewaySuggestion docs via OpenAI.
 * 
 * FLOW:
 * 1. Find PENDING LLMLearningTask documents
 * 2. For each task: gather template/scenario context
 * 3. Call OpenAI with structured prompt
 * 4. Parse suggestions (ADD_KEYWORDS, ADD_SYNONYMS, etc.)
 * 5. Create AIGatewaySuggestion docs for admin console v2
 * 6. Mark task DONE/FAILED
 * 
 * DESIGN PRINCIPLES:
 * - Non-blocking: runs async, doesn't impact live calls
 * - Batched: processes max 20 tasks per cycle to avoid overwhelming OpenAI
 * - Defensive: if worker fails, logs error but doesn't crash
 * - Observant: logs every step for debugging
 * 
 * ============================================================================
 */

const LLMLearningTask = require('../models/LLMLearningTask');
// V22 NUKED: AIGatewaySuggestion removed (AI Gateway legacy)
// V22 uses IntentResolutionPath for learned patterns
// Stub to prevent crashes - use ProductionLLMSuggestion instead
const AIGatewaySuggestion = {
  create: async () => ({}),
  find: async () => [],
  findById: async () => null
};
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const CallTrace = require('../models/CallTrace');
const openaiClient = require('../config/openai');
const logger = require('../utils/logger');

class LLMLearningWorker {
  constructor() {
    this.processing = false;
    this.batchSize = 20;
  }

  /**
   * Start the worker
   * @param {number} intervalMs - How often to process tasks (default 30 seconds)
   */
  start(intervalMs = 30000) {
    setInterval(() => this.processPendingTasks(), intervalMs);
    logger.info('[LLM LEARNING WORKER] Started', { intervalMs });
  }

  /**
   * Process all PENDING tasks in a batch
   */
  async processPendingTasks() {
    if (this.processing) {
      return;
    }
    this.processing = true;

    try {
      const tasks = await LLMLearningTask.find({ status: 'PENDING' })
        .sort({ createdAt: 1 })
        .limit(this.batchSize);

      if (!tasks.length) {
        this.processing = false;
        return;
      }

      logger.info('[LLM LEARNING WORKER] Processing batch', { count: tasks.length });

      for (const task of tasks) {
        await this.processTask(task);
      }

      logger.info('[LLM LEARNING WORKER] Batch complete', { count: tasks.length });
    } catch (err) {
      logger.error('[LLM LEARNING WORKER] Batch error', err);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single LLMLearningTask
   * @param {object} task - LLMLearningTask document
   */
  async processTask(task) {
    try {
      task.status = 'PROCESSING';
      await task.save();

      logger.info('[LLM LEARNING WORKER] Processing task', {
        taskId: task._id.toString(),
        callId: task.callId,
      });

      // 1. Gather context
      const template = await GlobalInstantResponseTemplate.findById(
        task.templateId
      );
      const scenarios = template?.scenarios || [];

      let callTrace = null;
      try {
        callTrace = await CallTrace.findOne({ callId: task.callId });
      } catch (err) {
        // CallTrace may not exist; that's fine
      }

      // 2. Build prompt for OpenAI
      const prompt = this.buildPrompt({ task, template, scenarios, callTrace });

      // 3. Call OpenAI
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4.1-mini',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `
You are an AI QA coach for ClientsVia's 3-tier router (Tier1, Tier2, Tier3).
Given routing details and scenarios, propose SMALL, TARGETED improvements so Tier3 is needed less often.

Return JSON only:
{
  "suggestions": [
    {
      "issueCode": "ADD_KEYWORDS" | "ADD_SYNONYMS" | "TIGHTEN_NEGATIVE_TRIGGERS" | "SPLIT_SCENARIO" | "ADD_NEW_SCENARIO",
      "severity": "low" | "medium" | "high",
      "impact": "low" | "medium" | "high",
      "summary": "one-line summary",
      "details": "short explanation",
      "targetScenarioId": "scenarioId-from-list-or-null",
      "suggestedKeywords": [ "..." ],
      "suggestedSynonyms": [
        { "base": "maintenance plan", "variants": ["service plan", "membership plan"] }
      ],
      "suggestedNegativePhrases": [ "..." ]
    }
  ]
}
            `.trim(),
          },
          { role: 'user', content: prompt },
        ],
      });

      // 4. Parse LLM response
      let parsed;
      try {
        parsed = JSON.parse(completion.choices[0].message.content);
      } catch (err) {
        throw new Error('Failed to parse JSON suggestions from OpenAI');
      }

      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions
        : [];

      logger.info('[LLM LEARNING WORKER] Parsed suggestions', {
        taskId: task._id.toString(),
        count: suggestions.length,
      });

      // 5. Create AIGatewaySuggestion docs
      const suggestionIds = [];

      for (const s of suggestions) {
        const sugDoc = await AIGatewaySuggestion.create({
          type: this.mapIssueCodeToType(s.issueCode),
          templateId: task.templateId,
          companyId: task.companyId,
          callLogId: task._id, // link back to task
          priority: s.severity || 'medium',
          confidence:
            typeof task.tier3Confidence === 'number'
              ? task.tier3Confidence
              : 0.7,
          status: 'pending',
          llmReasoning: s.details || '',
          llmModel: 'gpt-4.1-mini',
          llmCost: task.tier3Cost || 0,
          impact: {
            affectedCalls: 1,
            similarCallsThisMonth: 1,
          },

          // Extra metadata for console v2 to display rich "WHY" text
          metadata: {
            issueCode: s.issueCode,
            summary: s.summary,
            targetScenarioId: s.targetScenarioId || null,
            suggestedKeywords: s.suggestedKeywords || [],
            suggestedSynonyms: s.suggestedSynonyms || [],
            suggestedNegativePhrases: s.suggestedNegativePhrases || [],
            tierPath: task.tierPath,
            tier1Score: task.tier1Score,
            tier1Threshold: task.tier1Threshold,
            tier2Score: task.tier2Score,
            tier2Threshold: task.tier2Threshold,
            tier3Confidence: task.tier3Confidence,
            tier3Rationale: task.tier3Rationale,
            latencyMs: task.tier3LatencyMs,
          },
        });

        suggestionIds.push(sugDoc._id);
      }

      // 6. Mark task as DONE
      task.status = 'DONE';
      task.suggestionsCreatedCount = suggestionIds.length;
      task.suggestionsCreatedIds = suggestionIds;
      task.processedAt = new Date();
      await task.save();

      logger.info('[LLM LEARNING WORKER] Task completed', {
        taskId: task._id.toString(),
        suggestionsCount: suggestionIds.length,
      });
    } catch (err) {
      logger.error('[LLM LEARNING WORKER] Task failed', {
        taskId: task._id.toString(),
        error: err.message,
      });

      task.status = 'FAILED';
      task.workerError = err.message;
      task.processedAt = new Date();
      await task.save();
    }
  }

  /**
   * Build the LLM prompt with context
   */
  buildPrompt({ task, template, scenarios, callTrace }) {
    const callTranscript =
      callTrace && callTrace.turns
        ? JSON.stringify(callTrace.turns, null, 2)
        : '(no call trace available)';

    const scenarioSummaries = (scenarios || []).map(s => ({
      id: s._id?.toString(),
      name: s.scenarioName || s.name || '',
      triggers: s.triggers || [],
      negativeTriggers: s.negativeTriggers || [],
      examples: (s.exampleUserPhrases || []).slice(0, 3), // first 3
      negativeExamples: (s.negativeUserPhrases || []).slice(0, 2),
    }));

    return `
Template: ${template?.name || 'Unknown'}
CompanyId: ${task.companyId || 'Global'}

Tier path: ${task.tierPath}
Tier1 score/threshold: ${task.tier1Score ?? 'n/a'} / ${
      task.tier1Threshold ?? 'n/a'
    }
Tier2 score/threshold: ${task.tier2Score ?? 'n/a'} / ${
      task.tier2Threshold ?? 'n/a'
    }
Tier3 confidence: ${task.tier3Confidence ?? 'n/a'}
Tier3 rationale: ${task.tier3Rationale || 'n/a'}
Latency (ms): ${task.tier3LatencyMs ?? 'n/a'}

Primary caller utterance:
"${task.primaryUtterance || ''}"

Available scenarios:
${JSON.stringify(scenarioSummaries, null, 2)}

Call transcript (if available):
${callTranscript}

What small, targeted improvements would help this template avoid needing Tier3 next time?
    `.trim();
  }

  /**
   * Map issueCode to AIGatewaySuggestion.type
   */
  mapIssueCodeToType(issueCode) {
    const mapping = {
      ADD_KEYWORDS: 'keywords',
      ADD_SYNONYMS: 'synonym',
      TIGHTEN_NEGATIVE_TRIGGERS: 'negative-keywords',
      SPLIT_SCENARIO: 'missing-scenario',
      ADD_NEW_SCENARIO: 'missing-scenario',
    };
    return mapping[issueCode] || 'keywords';
  }
}

module.exports = new LLMLearningWorker();

