/**
 * ============================================================================
 * LLM AGENT — Discovery Configuration Routes
 * ============================================================================
 *
 * ENDPOINTS:
 * - GET  /:companyId/llm-agent/config              — Read merged config (defaults + saved)
 * - PATCH /:companyId/llm-agent/config              — Partial update config
 * - POST /:companyId/llm-agent/test-conversation    — Test message → Claude → response
 * - POST /:companyId/llm-agent/scrape-url           — Fetch URL → extract text for knowledge card
 * - GET  /:companyId/llm-agent/sync-triggers        — Pull active triggers as card drafts
 *
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const cheerio = require('cheerio');
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

// ════════════════════════════════════════════════════════════════════════════
// POST /:companyId/llm-agent/scrape-url — Scrape URL for knowledge card
// ════════════════════════════════════════════════════════════════════════════
router.post('/:companyId/llm-agent/scrape-url', authenticateJWT, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    // Basic URL validation
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Fetch the page
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(parsedUrl.href, {
      headers: {
        'User-Agent': 'ClientsVia-KnowledgeBot/1.0 (business knowledge extraction)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch URL: HTTP ${response.status}` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove script, style, nav, footer, header elements
    $('script, style, nav, footer, header, noscript, iframe, form, svg').remove();

    // Try to find main content
    let content = '';
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '.main-content', '#content', '#main'];
    for (const sel of mainSelectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 100) {
        content = el.text();
        break;
      }
    }

    // Fallback to body
    if (!content) {
      content = $('body').text();
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    // Extract page title
    const title = $('title').text().trim() ||
                  $('h1').first().text().trim() ||
                  parsedUrl.hostname;

    // Truncate if too long (max ~5000 words for a knowledge card)
    const words = content.split(/\s+/);
    if (words.length > 5000) {
      content = words.slice(0, 5000).join(' ') + '... (truncated)';
    }

    res.json({
      title,
      content,
      wordCount: words.length,
      sourceUrl: parsedUrl.href
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'URL fetch timed out after 15 seconds' });
    }
    logger.error(`[${MODULE_ID}] Scrape URL failed`, { error: error.message });
    res.status(500).json({ error: 'Failed to scrape URL: ' + error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /:companyId/llm-agent/sync-triggers — Pull active triggers as card drafts
// ════════════════════════════════════════════════════════════════════════════
router.get('/:companyId/llm-agent/sync-triggers', authenticateJWT, async (req, res) => {
  try {
    const { companyId } = req.params;

    // Load company to get active trigger group
    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const activeGroupId = company.aiAgentSettings?.agent2?.activeTriggerGroupId;

    // Load trigger models
    const CompanyLocalTrigger = require('../../models/CompanyLocalTrigger');
    const GlobalTrigger = require('../../models/GlobalTrigger');
    const CompanyBookingTrigger = require('../../models/CompanyBookingTrigger');

    // Get company-specific triggers (enabled, published, not deleted)
    const localTriggers = await CompanyLocalTrigger.find({
      companyId,
      enabled: true,
      isDeleted: { $ne: true },
      state: 'published'
    }).lean();

    // Get global triggers from active group (enabled, published, not deleted)
    let globalTriggers = [];
    if (activeGroupId) {
      globalTriggers = await GlobalTrigger.find({
        groupId: activeGroupId,
        enabled: true,
        isDeleted: { $ne: true },
        state: 'published'
      }).lean();
    }

    // Get booking INFO triggers — these are knowledge-only (no booking-step side effects)
    // and must be visible to the discovery LLM Agent so callers can ask about
    // promotions, coupons, and pricing before/during booking.
    const bookingInfoTriggers = await CompanyBookingTrigger.find({
      companyId,
      enabled: true,
      isDeleted: { $ne: true },
      state: 'published',
      behavior: 'INFO',
    }).lean();

    // Combine and format as card drafts
    const cardDrafts = [];

    for (const t of localTriggers) {
      const name = t.label || t.displayName || t.name || 'Local Trigger';
      cardDrafts.push({
        triggerId: t._id.toString(),
        triggerName: name,
        title: name,
        content: formatTriggerAsKnowledge(t),
        type: 'trigger',
        source: 'local',
        autoSynced: true
      });
    }

    for (const t of globalTriggers) {
      const name = t.label || t.displayName || t.name || 'Global Trigger';
      cardDrafts.push({
        triggerId: t._id.toString(),
        triggerName: name,
        title: name,
        content: formatTriggerAsKnowledge(t),
        type: 'trigger',
        source: 'global',
        autoSynced: true
      });
    }

    for (const t of bookingInfoTriggers) {
      const name = t.label || t.displayName || t.name || 'Booking Info';
      cardDrafts.push({
        triggerId: t._id.toString(),
        triggerName: name,
        title: name,
        content: formatTriggerAsKnowledge(t),
        type: 'booking-trigger',
        source: 'booking',
        autoSynced: true
      });
    }

    res.json({
      companyId,
      activeGroupId,
      triggers: cardDrafts,
      count: cardDrafts.length
    });
  } catch (error) {
    logger.error(`[${MODULE_ID}] Sync triggers failed`, { companyId: req.params.companyId, error: error.message });
    res.status(500).json({ error: 'Failed to sync triggers' });
  }
});

/**
 * Format a trigger document into a readable knowledge card content string.
 */
function formatTriggerAsKnowledge(trigger) {
  const parts = [];
  const name = trigger.label || trigger.displayName || trigger.name;

  if (name) {
    parts.push(`Service: ${name}`);
  }
  if (trigger.description) {
    parts.push(`Description: ${trigger.description}`);
  }
  if (trigger.answerText) {
    parts.push(`Standard Response: ${trigger.answerText}`);
  }
  if (trigger.keywords && trigger.keywords.length > 0) {
    parts.push(`Keywords: ${trigger.keywords.join(', ')}`);
  }
  if (trigger.phrases && trigger.phrases.length > 0) {
    parts.push(`Trigger Phrases: ${trigger.phrases.slice(0, 5).join(', ')}`);
  }

  return parts.join('\n') || 'No details available';
}

module.exports = router;
