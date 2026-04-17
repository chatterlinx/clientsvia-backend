/**
 * ============================================================================
 * LLM AGENT — Agent Studio Configuration Routes (April 2026)
 * ============================================================================
 *
 * Consumed by services.html (Agent Studio tabs: Behavior / Intake / Model /
 * System Prompt). All writes land on company.aiAgentSettings.llmAgent.
 *
 * ENDPOINTS:
 * - GET  /:companyId/llm-agent/config              — Read merged config (defaults + saved)
 * - PATCH /:companyId/llm-agent/config              — Partial update config
 * - POST /:companyId/llm-agent/preview-prompt       — Render live system prompt (C.5)
 * - POST /:companyId/llm-agent/ping                 — Verify Anthropic API is live
 * - POST /:companyId/llm-agent/ping-groq            — Verify Groq API is live
 * - POST /:companyId/llm-agent/test-conversation    — Test message → Claude → response
 *
 * Removed (April 2026 clean sweep — llmagent.html retired):
 * - POST /scrape-url      — legacy website knowledge scraper (dead)
 * - GET  /sync-triggers   — legacy trigger→knowledgeCard bridge (dead)
 *
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { DEFAULT_LLM_AGENT_SETTINGS, AVAILABLE_MODELS, AVAILABLE_PROVIDERS, composeSystemPrompt } = require('../../config/llmAgentDefaults');

const MODULE_ID = 'LLM_AGENT_ROUTES';

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Deep merge two objects. Source values override target values.
 * Arrays are replaced (not merged). Null/undefined in source are skipped.
 */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] === null || source[key] === undefined) continue;
    if (Array.isArray(source[key])) {
      result[key] = source[key];
    } else if (typeof source[key] === 'object' && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /:companyId/llm-agent/config — Read merged config
// ════════════════════════════════════════════════════════════════════════════
router.get('/:companyId/llm-agent/config', authenticateJWT, async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const saved = company.aiAgentSettings?.llmAgent || {};
    const merged = deepMerge(DEFAULT_LLM_AGENT_SETTINGS, saved);

    // Sanitize modelId — if saved value is no longer a valid model, reset to default
    const validModelIds = AVAILABLE_MODELS.map(m => m.id);
    if (merged.model?.modelId && !validModelIds.includes(merged.model.modelId)) {
      logger.warn(`[${MODULE_ID}] Invalid modelId in saved config, resetting to default`, { bad: merged.model.modelId });
      merged.model.modelId = DEFAULT_LLM_AGENT_SETTINGS.model.modelId;
    }

    res.json({
      companyId,
      companyName:        company.companyName || company.name || '',
      config:             merged,
      availableProviders: AVAILABLE_PROVIDERS,
      availableModels:    AVAILABLE_MODELS,
      // providerStatus: tells the UI which providers are wired on this server.
      // UI should warn / disable Groq selector when groq === false.
      providerStatus: {
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        groq:      !!process.env.GROQ_API_KEY,
      },
      defaults: DEFAULT_LLM_AGENT_SETTINGS
    });
  } catch (error) {
    logger.error(`[${MODULE_ID}] GET config failed`, { companyId: req.params.companyId, error: error.message });
    res.status(500).json({ error: 'Failed to load LLM Agent config' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /:companyId/llm-agent/config — Partial update
// ════════════════════════════════════════════════════════════════════════════
router.patch('/:companyId/llm-agent/config', authenticateJWT, async (req, res) => {
  try {
    const { companyId } = req.params;
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Request body must be an object' });
    }

    const company = await v2Company.findById(companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Deep merge updates into existing saved config
    const existing = company.aiAgentSettings?.llmAgent || {};
    const merged = deepMerge(existing, updates);

    // Ensure aiAgentSettings exists
    if (!company.aiAgentSettings) company.aiAgentSettings = {};
    company.aiAgentSettings.llmAgent = merged;
    company.markModified('aiAgentSettings');

    await company.save();

    // Return full merged config (defaults + saved)
    const fullConfig = deepMerge(DEFAULT_LLM_AGENT_SETTINGS, merged);

    logger.info(`[${MODULE_ID}] Config saved`, { companyId, keys: Object.keys(updates) });

    res.json({
      companyId,
      config: fullConfig,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`[${MODULE_ID}] PATCH config failed`, { companyId: req.params.companyId, error: error.message });
    res.status(500).json({ error: 'Failed to save LLM Agent config' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /:companyId/llm-agent/preview-prompt — Render live system prompt
//
// Used by the Agent Studio "System Prompt" tab (C.5) to show EXACTLY what
// Claude receives at runtime. Uses the company's real saved config.
//
// Body (all optional):
//   mode:        'discovery' | 'answer-from-kb'  (default 'discovery')
//   channel:     'call' | 'sms' | 'webchat'       (default 'call')
//   sampleQuery: string  — if mode='answer-from-kb' this is the caller query
//                         used to build a SAMPLE kcContext (top KC sections).
//
// Returns:
//   { prompt, charCount, estimatedTokens, mode, channel, sampleKcSections }
//
// Token estimation: 4 chars ≈ 1 token (Anthropic rough avg). Not exact.
// ════════════════════════════════════════════════════════════════════════════
router.post('/:companyId/llm-agent/preview-prompt', authenticateJWT, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { mode = 'discovery', channel = 'call', sampleQuery = '' } = req.body || {};

    if (!['discovery', 'answer-from-kb'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const saved = company.aiAgentSettings?.llmAgent || {};
    const settings = deepMerge(DEFAULT_LLM_AGENT_SETTINGS, saved);

    // In answer-from-kb mode we try to build a sample kcContext by ranking
    // real KC sections against the sampleQuery. If no query supplied, we show
    // the prompt WITHOUT kcContext so admin can see the shape.
    let kcContext = null;
    const sampleKcSections = [];
    if (mode === 'answer-from-kb' && sampleQuery && sampleQuery.trim().length >= 3) {
      try {
        const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');
        const containers = await CompanyKnowledgeContainer.find({
          companyId, isActive: { $ne: false },
        }).lean();
        // Minimal inline ranker — same signals as _scoreSectionsForGap
        const q = sampleQuery.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        const words = new Set(q.split(/\s+/).filter(w => w.length >= 3));
        const ranked = [];
        for (const c of containers) {
          if (c.noAnchor) continue;
          for (const s of (c.sections || [])) {
            if (s.isActive === false) continue;
            let score = 0;
            // Label words
            const lw = (s.label || '').toLowerCase().split(/\s+/).filter(x => x.length >= 3);
            for (const w of lw) if (words.has(w)) score += 4;
            // CallerPhrase best hit
            let bestPhrase = 0;
            for (const p of (s.callerPhrases || [])) {
              const pw = (p.text || p || '').toLowerCase().split(/\s+/).filter(x => x.length >= 3);
              const hits = pw.filter(x => words.has(x)).length;
              if (hits > bestPhrase) bestPhrase = hits;
            }
            score += bestPhrase * 3;
            // contentKeywords substring
            for (const kw of (s.contentKeywords || [])) {
              if (q.includes((kw || '').toLowerCase())) score += 2;
            }
            if (score > 0) {
              ranked.push({ container: c, section: s, score });
              sampleKcSections.push({
                container: c.title, section: s.label, score,
              });
            }
          }
        }
        ranked.sort((a, b) => b.score - a.score);
        kcContext = ranked.slice(0, 5);
        sampleKcSections.sort((a, b) => b.score - a.score);
        sampleKcSections.length = Math.min(sampleKcSections.length, 5);
      } catch (_e) {
        // KC loading failed — render without kcContext, still useful
      }
    }

    const prompt = composeSystemPrompt(settings, channel, mode, kcContext);
    const charCount = prompt.length;
    const estimatedTokens = Math.ceil(charCount / 4);

    res.json({
      prompt,
      charCount,
      estimatedTokens,
      mode,
      channel,
      sampleKcSections,
    });
  } catch (error) {
    logger.error(`[${MODULE_ID}] preview-prompt failed`, { companyId: req.params.companyId, error: error.message });
    res.status(500).json({ error: 'Failed to render prompt preview' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /:companyId/llm-agent/ping — Verify Anthropic API is live
// Sends a minimal 1-token request so the round-trip is fast & cheap.
// ════════════════════════════════════════════════════════════════════════════
router.post('/:companyId/llm-agent/ping', authenticateJWT, async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'ANTHROPIC_API_KEY not set on server' });
    }

    const startMs = Date.now();
    const pingRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: DEFAULT_LLM_AGENT_SETTINGS.model.modelId,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      signal: AbortSignal.timeout(8000)
    });
    const latencyMs = Date.now() - startMs;

    if (!pingRes.ok) {
      const errBody = await pingRes.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `Anthropic ${pingRes.status}`, details: errBody, latencyMs });
    }

    res.json({ ok: true, latencyMs, model: DEFAULT_LLM_AGENT_SETTINGS.model.modelId });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /:companyId/llm-agent/ping-groq — Verify Groq API is live
// Sends a minimal request to llama-3.1-8b-instant (fastest model).
// Returns latencyMs so the UI can display real TTFT to the admin.
// ════════════════════════════════════════════════════════════════════════════
router.post('/:companyId/llm-agent/ping-groq', authenticateJWT, async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'GROQ_API_KEY not set on server. Add it to Render env group and redeploy.' });
    }

    const startMs  = Date.now();
    const groqRes  = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:      'llama-3.1-8b-instant',
        max_tokens: 5,
        messages:   [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - startMs;

    if (!groqRes.ok) {
      const errBody = await groqRes.text().catch(() => '');
      logger.warn(`[${MODULE_ID}] Groq ping failed`, { status: groqRes.status, companyId: req.params.companyId });
      return res.status(502).json({ ok: false, error: `Groq API ${groqRes.status}`, details: errBody, latencyMs });
    }

    logger.info(`[${MODULE_ID}] Groq ping OK`, { latencyMs, companyId: req.params.companyId });
    res.json({ ok: true, latencyMs, model: 'llama-3.1-8b-instant', provider: 'groq' });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /:companyId/llm-agent/test-conversation — Test message via Claude
// ════════════════════════════════════════════════════════════════════════════
router.post('/:companyId/llm-agent/test-conversation', authenticateJWT, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { messages, channel = 'call' } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Load company config
    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const saved = company.aiAgentSettings?.llmAgent || {};
    const config = deepMerge(DEFAULT_LLM_AGENT_SETTINGS, saved);

    // Build system prompt
    const systemPrompt = composeSystemPrompt(config, channel);

    // Validate Anthropic API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY env variable.' });
    }

    const validModelIds = AVAILABLE_MODELS.map(m => m.id);
    const rawModelId = config.model?.modelId;
    const modelId = (rawModelId && validModelIds.includes(rawModelId))
      ? rawModelId
      : DEFAULT_LLM_AGENT_SETTINGS.model.modelId;
    const temperature = config.model?.temperature ?? 0.7;
    const maxTokens = config.model?.maxTokens || 300;

    // Call Anthropic Messages API
    const startMs = Date.now();

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }))
      })
    });

    const latencyMs = Date.now() - startMs;

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      logger.error(`[${MODULE_ID}] Anthropic API error`, { status: anthropicRes.status, body: errBody });
      return res.status(502).json({ error: `Anthropic API error: ${anthropicRes.status}`, details: errBody });
    }

    const data = await anthropicRes.json();
    const responseText = data.content?.[0]?.text || '';
    const tokensUsed = {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0
    };

    res.json({
      response: responseText,
      tokensUsed,
      latencyMs,
      model: modelId
    });
  } catch (error) {
    logger.error(`[${MODULE_ID}] Test conversation failed`, { companyId: req.params.companyId, error: error.message });
    res.status(500).json({ error: 'Test conversation failed: ' + error.message });
  }
});
module.exports = router;
