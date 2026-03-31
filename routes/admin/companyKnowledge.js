'use strict';

/**
 * ============================================================================
 * COMPANY KNOWLEDGE — Admin API Routes
 * ============================================================================
 *
 * Full CRUD for Knowledge Containers — the unified informational content
 * system for the ClientsVia platform. One container = one topic the caller
 * might ask about. Groq reads the container and answers within a word limit.
 *
 * ISOLATION RULES:
 *   - Every route is scoped by companyId
 *   - MongoDB queries always include { companyId } filter
 *   - Redis cache key is namespaced: knowledge:{companyId}
 *
 * ROUTE REGISTRATION ORDER (critical for Express):
 *   Literal segment routes (/settings, /active, /reorder, /generate-keywords)
 *   MUST be registered BEFORE the parameterised route (/:id) or Express will
 *   match the literal string as an :id value → 400/500 errors.
 *
 * ENDPOINTS:
 *   GET    /:companyId/knowledge/settings               — Load knowledgeBaseSettings
 *   PATCH  /:companyId/knowledge/settings               — Save knowledgeBaseSettings
 *   GET    /:companyId/knowledge                        — List all containers (admin)
 *   GET    /:companyId/knowledge/active                 — List active only (runtime)
 *   POST   /:companyId/knowledge                        — Create container
 *   POST   /:companyId/knowledge/generate-keywords      — Groq keyword generation (pre-save)
 *   POST   /:companyId/knowledge/analyze-gaps           — Content Coach gap analysis (per section)
 *   POST   /:companyId/knowledge/reorder                — Bulk priority update
 * ⚠️ GET    /:companyId/knowledge/:id                   — Get single (AFTER literal routes)
 *   PATCH  /:companyId/knowledge/:id                    — Partial update
 *   DELETE /:companyId/knowledge/:id                    — Soft delete (isActive=false)
 *   DELETE /:companyId/knowledge/:id/hard               — Hard delete (permanent)
 *   POST   /:companyId/knowledge/:id/generate-keywords  — Regen keywords for existing
 *
 * ============================================================================
 */

const express                      = require('express');
const router                       = express.Router();
const mongoose                     = require('mongoose');
const logger                       = require('../../utils/logger');
const { authenticateJWT }          = require('../../middleware/auth');
const CompanyKnowledgeContainer    = require('../../models/CompanyKnowledgeContainer');
const KnowledgeContainerService    = require('../../services/engine/agent2/KnowledgeContainerService');
const CompanyTriggerSettings       = require('../../models/CompanyTriggerSettings');
const v2Company                    = require('../../models/v2Company');
const GroqStreamAdapter            = require('../../services/streaming/adapters/GroqStreamAdapter');
const KCKeywordHealthService       = require('../../services/kc/KCKeywordHealthService');
const UAPArray                     = require('../../models/UAPArray');
const BridgeService                = require('../../services/engine/kc/BridgeService');
const Customer                     = require('../../models/Customer');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _validateCompanyAccess(req, res, companyId) {
  if (!companyId) {
    res.status(400).json({ success: false, error: 'companyId is required' });
    return false;
  }
  const user    = req.user || {};
  const isAdmin = ['admin', 'super_admin', 'platform_admin'].includes(user.role);
  if (!isAdmin && user.companyId !== companyId) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return false;
  }
  return true;
}

/**
 * _resolveContainerQuery — build the right MongoDB filter for a container `:id` param.
 * Accepts both MongoDB ObjectId (24-char hex) and human-readable kcId (e.g. "700c4-25").
 * This is the SINGLE source of truth for all container lookups by route param.
 */
function _resolveContainerQuery(id, companyId) {
  return mongoose.Types.ObjectId.isValid(id)
    ? { _id: id, companyId }
    : { kcId: id, companyId };
}

// Allowed fields for container CRUD operations
const ALLOWED_FIELDS = [
  'title', 'category',
  // sections now carry per-section daSubTypeKey, bookingAction, preQualifyQuestion, upsellChain
  'sections',
  'keywords',
  'negativeKeywords',   // Exclusion phrases — any match disqualifies this container for that turn
  'wordLimit',
  'wordLimitEnabled',   // Boolean — when false, omits hard word cap from Groq prompt
  'sampleResponse',     // String — ideal example answer injected as guardrail into Groq prompt
  'followUpDepth',      // 2 | 4 | 6 — SPFUQ turn budget for this container (null = system default)
  'bookingAction',      // Container-level default; sections can override per-section
  'closingPrompt',
  'isActive',
  'priority',
  // UAP classification fields — owner can manually set daType, auto-classify sets the rest
  'daType',
  'daSubTypes',
  'classificationStatus',
];

// Allowed fields for settings PATCH
const SETTINGS_FIELDS = [
  'enabled', 'defaultWordLimit', 'bookingOfferMode', 'bookingOfferPhrase',
  'fallbackResponse',   // String — spoken by KC_GRACEFUL_ACK when all AI paths fail
  'callerScreening',    // Object — { enabled, vendorResponse, deliveryResponse, wrongNumberResponse, defaultResponse }
  'responseTone',       // enum: professional | friendly | casual | warm
  'responseStyle',      // enum: concise | balanced | detailed
  'greetByName',        // Boolean — address caller by name in KC answers
  'acknowledgeHistory', // Boolean — acknowledge returning customers
];

/**
 * _sanitiseBody — Strip fields not in ALLOWED_FIELDS and clean values.
 * Keywords are deduped and lowercased. Sections are validated minimally.
 *
 * @param {Object} body
 * @returns {Object}
 */
function _sanitiseBody(body) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) out[key] = body[key];
  }

  // Normalise keywords — trim, lowercase, deduplicate
  if (Array.isArray(out.keywords)) {
    out.keywords = [...new Set(
      out.keywords.map(k => `${k}`.toLowerCase().trim()).filter(Boolean)
    )];
  }

  // Normalise negativeKeywords — same rules as keywords
  if (Array.isArray(out.negativeKeywords)) {
    out.negativeKeywords = [...new Set(
      out.negativeKeywords.map(k => `${k}`.toLowerCase().trim()).filter(Boolean)
    )];
  }

  // Sanitise sections array — remove empty labels/content, preserve per-section fields
  if (Array.isArray(out.sections)) {
    out.sections = out.sections
      .filter(s => typeof s.label === 'string' && s.label.trim() &&
                   typeof s.content === 'string' && s.content.trim())
      .map((s, idx) => {
        const section = {
          label:   s.label.trim().slice(0, 80),
          content: s.content.trim().slice(0, 2000),
          order:   typeof s.order === 'number' ? s.order : idx,
          // Preserve existing _id if provided (for updates)
          ...(s._id ? { _id: s._id } : {}),
        };

        // UAP routing key — set by Auto-label, links section to UAPArray sub-type
        if (typeof s.daSubTypeKey === 'string' && s.daSubTypeKey.trim()) {
          section.daSubTypeKey = s.daSubTypeKey.trim().slice(0, 80);
        }

        // Per-section booking action override
        const BA_VALID = ['offer_to_book', 'advisor_callback', 'none'];
        if (s.bookingAction && BA_VALID.includes(s.bookingAction)) {
          section.bookingAction = s.bookingAction;
        }

        // Per-section pre-qualify question
        // Always saved when text exists — enabled is a mode switch, not a data gate.
        // enabled=false → agent reads text content above; enabled=true → agent asks prequal.
        if (s.preQualifyQuestion && typeof s.preQualifyQuestion === 'object') {
          const pq = s.preQualifyQuestion;
          if (typeof pq.text === 'string' && pq.text.trim()) {
            section.preQualifyQuestion = {
              enabled:  pq.enabled !== false,  // default true; false preserved when explicitly set
              text:     pq.text.trim().slice(0, 300),
              fieldKey: (typeof pq.fieldKey === 'string' && pq.fieldKey.trim())
                ? pq.fieldKey.trim().slice(0, 60)
                : 'preQualifyAnswer',
              options: Array.isArray(pq.options)
                ? pq.options.map(o => ({
                    label:           typeof o.label === 'string'           ? o.label.trim().slice(0, 100)           : '',
                    value:           typeof o.value === 'string'           ? o.value.trim().slice(0, 100)           : '',
                    keywords:        Array.isArray(o.keywords)             ? o.keywords.map(k => `${k}`.trim().toLowerCase()).filter(Boolean) : [],
                    responseContext: typeof o.responseContext === 'string' ? o.responseContext.trim().slice(0, 400) : '',
                  }))
                : [],
            };
          }
        }

        // Per-section upsell chain
        if (Array.isArray(s.upsellChain) && s.upsellChain.length) {
          section.upsellChain = s.upsellChain
            .filter(u => u && typeof u.offerScript === 'string' && u.offerScript.trim())
            .map(u => ({
              offerScript: u.offerScript.trim().slice(0, 600),
              yesScript:   typeof u.yesScript === 'string' ? u.yesScript.trim().slice(0, 400) : '',
              noScript:    typeof u.noScript  === 'string' ? u.noScript.trim().slice(0, 400)  : '',
              itemKey:     typeof u.itemKey   === 'string' ? u.itemKey.trim().slice(0, 60)    : '',
              price:       (typeof u.price === 'number' && !isNaN(u.price)) ? u.price : null,
            }));
        }

        return section;
      });
  }

  // Trim string fields
  if (typeof out.title    === 'string') out.title    = out.title.trim();
  if (typeof out.category === 'string') out.category = out.category.trim();

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET  /:companyId/knowledge/settings — Load knowledgeBaseSettings
// PATCH/:companyId/knowledge/settings — Save knowledgeBaseSettings
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:companyId/knowledge/settings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const company = await v2Company.findById(companyId, 'knowledgeBaseSettings').lean();
    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });
    return res.json({ success: true, knowledgeBaseSettings: company.knowledgeBaseSettings || {} });
  } catch (err) {
    logger.error('[companyKnowledge] GET settings error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load knowledge settings' });
  }
});

router.patch('/:companyId/knowledge/settings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const updates = {};
  for (const field of SETTINGS_FIELDS) {
    if (field in req.body) {
      updates[`knowledgeBaseSettings.${field}`] = req.body[field];
    }
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No valid settings fields provided' });
  }

  try {
    const company = await v2Company.findByIdAndUpdate(
      companyId,
      { $set: updates },
      { new: true, select: 'knowledgeBaseSettings', runValidators: true }
    ).lean();

    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });

    logger.info('[companyKnowledge] Settings updated', { companyId, fields: Object.keys(updates) });
    return res.json({ success: true, knowledgeBaseSettings: company.knowledgeBaseSettings || {} });
  } catch (err) {
    logger.error('[companyKnowledge] PATCH settings error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save knowledge settings' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge — List ALL containers (admin view, includes inactive)
// Also returns companyVariables so services.html can render the same auto-detected
// variables table as triggers.html — same store, same PUT /variables endpoint.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const [containers, triggerSettings] = await Promise.all([
      CompanyKnowledgeContainer.findAllForCompany(companyId),
      CompanyTriggerSettings.findOne({ companyId }).lean().catch(() => null),
    ]);
    const companyVariables = triggerSettings?.companyVariables instanceof Map
      ? Object.fromEntries(triggerSettings.companyVariables)
      : (triggerSettings?.companyVariables || {});
    return res.json({ success: true, containers, total: containers.length, companyVariables });
  } catch (err) {
    logger.error('[companyKnowledge] GET list error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load knowledge containers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/active — Active containers only (runtime view)
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/active', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const containers = await CompanyKnowledgeContainer.findActiveForCompany(companyId);
    return res.json({ success: true, containers, total: containers.length });
  } catch (err) {
    logger.error('[companyKnowledge] GET active error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load active knowledge containers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge — Create a knowledge container
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const body = _sanitiseBody(req.body || {});

  if (!body.title) {
    return res.status(400).json({ success: false, error: 'title is required' });
  }
  if (!body.sections?.length) {
    return res.status(400).json({ success: false, error: 'At least one section is required' });
  }

  try {
    // ── Atomic KC ID generation ──────────────────────────────────────────────
    // $inc guarantees no two containers ever share a seq number, even under
    // concurrent POSTs. Counter never resets — deleted numbers are never reused.
    // Format: {last5charsOfCompanyId}-{seq padded to 2 digits}  e.g. "700c4-01"
    const updatedCompany = await v2Company.findOneAndUpdate(
      { _id: companyId },
      { $inc: { 'aiAgentSettings.kcSeq': 1 } },
      { new: true, select: 'aiAgentSettings.kcSeq' }
    );
    const seq    = updatedCompany?.aiAgentSettings?.kcSeq ?? 1;
    const prefix = String(companyId).slice(-5);
    const kcId   = `${prefix}-${String(seq).padStart(2, '0')}`;
    // ────────────────────────────────────────────────────────────────────────

    const container = await CompanyKnowledgeContainer.create({ companyId, kcId, ...body });

    // Invalidate runtime cache — next call sees fresh data
    KnowledgeContainerService.invalidateCache(companyId).catch(e =>
      logger.warn('[companyKnowledge] cache invalidation failed on POST', { companyId, e: e.message })
    );

    // Invalidate Bridge if container has a daType (it's now part of the routing table)
    if (body.daType) {
      BridgeService.invalidate(companyId).catch(() => {});
    }

    // Generate semantic embedding fire-and-forget — failure never blocks the response
    setImmediate(() =>
      KCKeywordHealthService.generateAndStoreEmbedding(container._id).catch(() => {})
    );

    logger.info('[companyKnowledge] Created container', { companyId, id: container._id, kcId, title: container.title });
    return res.status(201).json({ success: true, container });
  } catch (err) {
    logger.error('[companyKnowledge] POST create error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to create knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD GENERATION HELPER — shared by both generate-keywords endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _runKeywordGeneration — Call Groq to generate keyword phrases for a container.
 * Used by both the pre-save and existing-container generate-keywords endpoints.
 *
 * @param {string} companyId — for logging
 * @param {string} title     — container title
 * @param {Array}  sections  — [{label, content}]
 * @param {Object} res       — Express response object
 * @returns {Promise<Response>} — sends JSON response and returns
 */
async function _runKeywordGeneration(companyId, title, sections, res) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  // Build content summary for the Groq prompt
  const sectionSummary = (sections || [])
    .filter(s => s.label?.trim() && s.content?.trim())
    .map(s => `${s.label.trim()}: ${s.content.trim().slice(0, 300)}`)
    .join('\n');

  const promptContent = [
    title?.trim() ? `Topic: ${title.trim()}` : '',
    sectionSummary ? `Content:\n${sectionSummary}` : ''
  ].filter(Boolean).join('\n\n');

  if (!promptContent) {
    return res.status(400).json({ success: false, error: 'No usable content for keyword generation' });
  }

  try {
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   300,
      temperature: 0.4,
      system: `You are a keyword generation expert for a phone AI agent.
Given a knowledge container for a service company, generate 12-18 short keyword phrases that a caller might say when asking about this topic over the phone.
Think about all natural ways a caller would ask: pricing, what's included, availability, specials, warranties, etc.
Return ONLY a valid JSON array of strings. No extra text. Example: ["how much is a service call","what does it include","is there a fee"]`,
      messages: [{ role: 'user', content: promptContent }],
      jsonMode: false,   // raw JSON array, not object mode
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    // Parse — expect a JSON array; handle any leading/trailing prose
    let keywords = [];
    try {
      const raw        = result.response.trim();
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      keywords = JSON.parse(arrayMatch ? arrayMatch[0] : raw);
    } catch (_e) {
      // Fallback: split on newlines and strip punctuation
      keywords = result.response
        .split(/[\n,]+/)
        .map(k => k.replace(/^[\s"'\-*•\d.]+|[\s"',]+$/g, '').trim())
        .filter(k => k.length > 2 && k.length < 80);
    }

    if (!Array.isArray(keywords)) {
      return res.status(500).json({ success: false, error: 'Failed to parse Groq keyword response' });
    }

    // Clean and deduplicate; cap at 20
    const cleaned = [...new Set(
      keywords
        .filter(k => typeof k === 'string')
        .map(k => k.toLowerCase().trim())
        .filter(k => k.length > 2 && k.length < 80)
    )].slice(0, 20);

    logger.info('[companyKnowledge] Generated keywords', { companyId, count: cleaned.length });
    return res.json({ success: true, keywords: cleaned });

  } catch (err) {
    logger.error('[companyKnowledge] generate-keywords error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Keyword generation failed' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVALUATION HELPER — AI quality audit for a knowledge container
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _runEvaluation — Single Groq call that scores a KC container across 6
 * dimensions and returns actionable fixes.
 *
 * Dimensions: CONTENT_QUALITY | LABEL_ALIGNMENT | KEYWORD_QUALITY |
 *             COMPLETENESS | RESPONSE_SETTINGS | FUNNEL_CONFIG
 *
 * @param {string} companyId
 * @param {Object} payload   — { title, category, sections, keywords, negativeKeywords,
 *                               wordLimit, wordLimitEnabled, sampleResponse,
 *                               bookingAction, closingPrompt }
 * @param {Object} res       — Express response object
 */
async function _runEvaluation(companyId, payload, res) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  const {
    title = '', category = '', sections = [], keywords = [], negativeKeywords = [],
    wordLimit = null, wordLimitEnabled = true, sampleResponse = '',
    bookingAction = 'offer_to_book', closingPrompt = '',
  } = payload;

  // ── Build rich section block — includes prequal + upsell per section ────────
  const sectionBlock = (sections || [])
    .filter(s => s.label?.trim() && s.content?.trim())
    .map(s => {
      const lines = [`[SECTION: ${s.label.trim().toUpperCase()}]`];
      lines.push(`Content: ${s.content.trim().slice(0, 500)}`);
      if (s.daSubTypeKey) lines.push(`Sub-type key: ${s.daSubTypeKey}`);
      const pq = s.preQualifyQuestion;
      if (pq?.enabled && pq.text?.trim()) {
        const opts = (pq.options || []).map(o => o.label || o.value).filter(Boolean).join(', ');
        lines.push(`Pre-qualify question: "${pq.text.trim()}"${opts ? ` — options: [${opts}]` : ''}`);
      } else if (pq?.text?.trim()) {
        lines.push(`Pre-qualify question (disabled): "${pq.text.trim()}"`);
      }
      const upsells = (s.upsellChain || []).filter(u => u.offerScript?.trim());
      if (upsells.length) {
        upsells.forEach((u, i) => {
          const price = u.price ? ` ($${u.price})` : '';
          lines.push(`Upsell ${i + 1}${price}: "${u.offerScript.trim()}"${u.yesScript ? ` → Yes: "${u.yesScript.trim()}"` : ''}${u.noScript ? ` / No: "${u.noScript.trim()}"` : ''}`);
        });
      }
      return lines.join('\n');
    })
    .join('\n\n') || '(no sections)';

  const kwList    = (keywords || []).slice(0, 20).join(', ') || '(none)';
  const negKwList = (negativeKeywords || []).slice(0, 10).join(', ') || '(none)';
  const wlDisplay = !wordLimitEnabled
    ? 'DISABLED — agent may use as many words as needed'
    : wordLimit ? `${wordLimit} words` : 'not set (falls back to global default ~40)';

  const userContent = `CONTAINER:
Title: "${title}"
Category: "${category || 'none'}"
Keywords: [${kwList}]
Negative keywords (exclude-triggers): [${negKwList}]
Word Limit: ${wlDisplay} | Booking Action: ${bookingAction}
Closing Prompt: "${closingPrompt || '(none)'}"
Sample Response (ideal example): "${sampleResponse?.trim() || '(none)'}"

SECTIONS:
${sectionBlock}`;

  try {
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   1500,
      temperature: 0.15,
      jsonMode:    true,   // forces strict JSON output — system prompt contains "json" ✓
      system: `You are a quality auditor for a phone-call AI knowledge base. The voice agent must answer callers ONLY from this container — no improvisation allowed. Your job is to catch every mistake that would cause the agent to fail on live calls.

Evaluate across exactly 6 dimensions. Return ONLY valid JSON — no markdown, no extra text.

SCORING RUBRIC:

1. CONTENT_QUALITY (0-100): Is the content specific and complete enough to answer the 3 most likely caller questions about this topic? Penalize: vague or generic text, missing key facts (prices, availability, what's included, duration), content too short to be actionable, sections that just say "call us for details".

2. LABEL_ALIGNMENT (0-100): Do the section labels accurately describe their content so the agent can locate the right information quickly? Penalize: generic labels ("Section 1", "Notes", "Info"), labels that don't match the actual content, missing labels.

3. KEYWORD_QUALITY (0-100): Are keywords phrased the way real callers speak on the phone? Are they specific enough to this topic that they won't accidentally trigger other cards? CRITICAL FLAG: Penalize heavily (–30 pts each) any generic pronoun, filler word, or common verb: "it", "that", "this", "they", "what", "how", "yes", "no", "tell", "get", "need", "want", "help", "about", "the", "a" — these break topic anchoring. Also check negative keywords are not so broad they suppress legitimate matches. Flag every dangerous keyword by name in the finding.

4. COMPLETENESS (0-100): What sections would a world-class phone KB entry include that are MISSING? Consider: pricing, what's included, duration/timing, availability/scheduling, warranty/guarantees, eligibility requirements, common caller objections, FAQs. Penalize for missing sections callers will definitely ask about.

5. RESPONSE_SETTINGS (0-100): Evaluate all response configuration: (a) Word limit — is it appropriate for this content's complexity? Simple answers = 30–50 words; multi-option or complex topics = 60–100 words; disabling word limit is only justified for very complex topics where truncation would hurt the caller. (b) Sample Response — if provided, does it demonstrate the right length, tone and information density? Is it specific enough to teach the agent? (c) Booking action — does it match this topic type (informational topics should not force booking; service requests should). (d) Closing prompt — if set, is it natural and caller-friendly?

6. FUNNEL_CONFIG (0-100): Evaluate the per-section pre-qualify and upsell configuration. (a) Pre-qualify questions — if set, are they clear, are the options exhaustive, would a real caller understand them without confusion? If a section has significant cost variance or eligibility criteria and has NO pre-qualify question, penalize. (b) Upsell chain — are offer scripts natural and non-pushy? Are yes/no response scripts appropriate? Are there high-revenue sections that have no upsell configured where one would be appropriate? If no funnel is configured anywhere, score 60 as neutral (no penalty for not using funnels, but no reward either).

Status rules: score >= 75 = PASS, 50-74 = WARN, below 50 = FAIL.
Grade: 90+ = A, 80-89 = B+, 70-79 = B, 60-69 = C+, 50-59 = C, below 50 = D or F.

Return ONLY this JSON structure:
{"overallScore":<0-100>,"grade":"<A|B+|B|C+|C|D|F>","summary":"<2 sentences: what is good and what is the biggest problem>","dimensions":[{"id":"<DIMENSION_ID>","label":"<short display label>","score":<0-100>,"status":"<PASS|WARN|FAIL>","finding":"<1 specific sentence — be concrete, mention actual content>","fixes":["<specific actionable fix>","<specific actionable fix>"]}],"suggestedKeywords":["<phrase a caller would actually say>"],"missingSections":["<section label name>"],"suggestedWordLimit":<null or recommended number>,"topFixes":["<fix 1>","<fix 2>","<fix 3>"]}`,
      messages: [{ role: 'user', content: userContent }],
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    // Parse — jsonMode:true means Groq output should be clean JSON, but still be defensive
    let evaluation;
    try {
      const raw = result.response.trim()
        .replace(/^```(?:json)?\s*/i, '')   // strip any accidental fences
        .replace(/\s*```$/, '');
      const objMatch = raw.match(/\{[\s\S]*\}/);
      evaluation = JSON.parse(objMatch ? objMatch[0] : raw);
      if (typeof evaluation.overallScore !== 'number') throw new Error('missing overallScore field');
    } catch (parseErr) {
      logger.warn('[companyKnowledge] evaluate: JSON parse failed', {
        companyId,
        err:     parseErr.message,
        preview: result.response?.slice(0, 300),   // log first 300 chars for debugging
      });
      return res.status(500).json({ success: false, error: 'Could not parse AI evaluation response' });
    }

    logger.info('[companyKnowledge] evaluate complete', {
      companyId, title, overallScore: evaluation.overallScore, grade: evaluation.grade
    });
    return res.json({ success: true, evaluation });

  } catch (err) {
    logger.error('[companyKnowledge] evaluate error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'AI evaluation failed' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/generate-keywords — Generate keywords via Groq
// ⚠️ MUST be registered BEFORE /:id
//
// Accepts { title, sections: [{label, content}] } — works pre-save (no :id needed).
// Returns { keywords: [...] } — admin reviews, edits, saves via POST/PATCH separately.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/generate-keywords', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { title = '', sections = [] } = req.body || {};
  if (!title.trim() && !sections.length) {
    return res.status(400).json({ success: false, error: 'title or sections are required for keyword generation' });
  }

  return _runKeywordGeneration(companyId, title, sections, res);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/evaluate — AI quality audit
// ⚠️ MUST be registered BEFORE /:id
//
// Accepts full container payload (works pre-save). Returns a structured
// evaluation with 6 dimension scores, fixes, suggested keywords, and missing sections.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/evaluate', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { title = '', sections = [] } = req.body || {};
  if (!title.trim() && !sections.length) {
    return res.status(400).json({ success: false, error: 'title or sections are required for evaluation' });
  }

  return _runEvaluation(companyId, req.body || {}, res);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/reorder — Bulk priority update (drag-and-drop)
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/reorder', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  if (!order.length) {
    return res.status(400).json({ success: false, error: 'order array is required' });
  }

  try {
    const ops = order
      .filter(o => o.id && typeof o.priority === 'number')
      .map(o => ({
        updateOne: {
          filter: { _id: o.id, companyId },
          update: { $set: { priority: o.priority } }
        }
      }));

    if (ops.length) await CompanyKnowledgeContainer.bulkWrite(ops);

    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    return res.json({ success: true, message: `Reordered ${ops.length} containers` });
  } catch (err) {
    logger.error('[companyKnowledge] reorder error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to reorder containers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/test-match
// Diagnostic: run the live KC scoring algorithm against a test utterance and
// return a ranked breakdown of every container's score, the winning container,
// which containers were negatively excluded, and why.
//
// Body: { utterance: string, callReason?: string }
// Returns: { winner, scores[], excluded[], utteranceNorm }
//
// ⚠️ MUST be before GET /:id — Express will match 'test-match' as id otherwise
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/test-match', authenticateJWT, async (req, res) => {
  const { companyId }  = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { utterance, callReason } = req.body || {};
  if (!utterance || typeof utterance !== 'string' || !utterance.trim()) {
    return res.status(400).json({ ok: false, error: 'utterance is required' });
  }

  try {
    const KCS = require('../../services/engine/agent2/KnowledgeContainerService');
    const containers = await KCS.getActiveForCompany(companyId);

    if (!containers.length) {
      return res.json({ ok: true, winner: null, scores: [], excluded: [], utteranceNorm: utterance.trim(), note: 'No active containers found for this company.' });
    }

    const norm = utterance.toLowerCase().replace(/[^a-z\s]/g, ' ');

    // ── Score EVERY container (including negatively-excluded ones for the report)
    const scores   = [];
    const excluded = [];

    const _scoreContainer = (container, inputNorm) => {
      const keywords = container.keywords || [];
      let bestKw = null, bestScore = 0;
      for (const kw of keywords) {
        const kwNorm = kw.toLowerCase().trim();
        if (!kwNorm) continue;
        let score = 0;
        if (kwNorm.includes(' ')) {
          if (inputNorm.includes(kwNorm)) {
            score = kwNorm.length * 2;
          } else {
            const iWords = new Set(inputNorm.split(/\s+/));
            const cWords = kwNorm.split(/\s+/).filter(w => w.length >= 5);
            const hits   = cWords.filter(w => iWords.has(w));
            if (hits.length) score = hits.reduce((s, w) => s + w.length, 0);
          }
        } else {
          score = inputNorm.split(/\s+/).includes(kwNorm) ? kwNorm.length : 0;
        }
        if (score > bestScore) { bestScore = score; bestKw = kw; }
      }
      return { score: bestScore, matchedKeyword: bestKw };
    };

    const _checkNegative = (container) => {
      const negKws = container.negativeKeywords || [];
      const iWords = new Set(norm.split(/\s+/));
      for (const nk of negKws) {
        const nkNorm = nk.toLowerCase().trim();
        if (!nkNorm) continue;
        if (nkNorm.includes(' ') ? norm.includes(nkNorm) : iWords.has(nkNorm)) {
          return nk;   // Return the trigger negative keyword
        }
      }
      return null;
    };

    for (const c of containers) {
      const negHit = _checkNegative(c);
      const { score, matchedKeyword } = _scoreContainer(c, norm);

      if (negHit) {
        excluded.push({
          id:                String(c._id),
          title:             c.title,
          positiveScore:     score,
          matchedKeyword:    matchedKeyword || null,
          excludedBy:        negHit,
          negativeKeywords:  c.negativeKeywords || [],
        });
      } else {
        scores.push({
          id:               String(c._id),
          title:            c.title,
          score,
          matchedKeyword:   matchedKeyword || null,
          keywords:         c.keywords     || [],
          negativeKeywords: c.negativeKeywords || [],
          wouldWin:         false, // filled below
        });
      }
    }

    // Sort by score desc, mark winner
    scores.sort((a, b) => b.score - a.score);
    const winner = scores.find(s => s.score > 0) || null;
    if (winner) winner.wouldWin = true;

    // Also run context-augmented pass if callReason provided and no winner
    let contextWinner = null;
    if (!winner && callReason) {
      const augNorm = `${callReason} ${utterance}`.toLowerCase().replace(/[^a-z\s]/g, ' ');
      for (const c of containers) {
        if (_checkNegative(c)) continue;
        const { score, matchedKeyword } = _scoreContainer(c, augNorm);
        if (score > 0) {
          contextWinner = { id: String(c._id), title: c.title, score, matchedKeyword, contextAssisted: true };
          break;
        }
      }
    }

    return res.json({
      ok:           true,
      utterance:    utterance.trim(),
      utteranceNorm: norm.trim(),
      callReason:   callReason || null,
      winner:       winner   || contextWinner || null,
      scores,
      excluded,
      totalContainers:  containers.length,
      activeScored:     scores.length,
      negativeExcluded: excluded.length,
      threshold:        KCS.KEYWORD_CONFIDENCE_THRESHOLD,
      note: winner
        ? `"${winner.matchedKeyword}" scored ${winner.score} in "${winner.title}"`
        : (contextWinner ? `Context-assisted match via callReason: "${contextWinner.matchedKeyword}" → "${contextWinner.title}"` : 'No container matched — would fall through to LLM'),
    });

  } catch (err) {
    logger.error('[companyKnowledge] test-match error', { companyId, err: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/keyword-health
// Runs the full semantic + keyword conflict analysis.
// If containers are missing embeddings, backfills them first (synchronous so
// the first call always returns a complete report).
// Returns: full conflict report with severity levels, shared keywords,
//          semantic similarity scores, Groq conflict type classifications,
//          conflictMap (for edit-page chip indicators), and per-container counts.
// ⚠️ MUST be before GET /:id — Express will match 'keyword-health' as id otherwise
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/keyword-health', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  // ── OpenAI live connectivity check ─────────────────────────────────────────
  // Don't just check if the key string exists — actually call the embeddings
  // API with a minimal probe so we fail fast with a clear diagnosis rather
  // than burning time on batch work that will silently fail anyway.
  let semanticAvailable  = false;
  let semanticError      = null;  // human-readable reason if unavailable

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    semanticError = 'OPENAI_API_KEY is not set in the Render environment.';
  } else {
    try {
      const OpenAI  = require('openai');
      const _oa     = new OpenAI({ apiKey: openaiKey });
      const _probe  = await _oa.embeddings.create({
        model:      'text-embedding-3-small',
        input:      'health-check',
        dimensions: 8,   // Smallest possible — just verifies auth + quota
      });
      if (_probe?.data?.[0]?.embedding?.length) {
        semanticAvailable = true;
      } else {
        semanticError = 'OpenAI returned an unexpected response during the connectivity probe.';
      }
    } catch (_oaErr) {
      // Map OpenAI error codes to actionable messages
      if (_oaErr.status === 401)       semanticError = 'OpenAI API key is invalid or revoked. Check platform.openai.com/api-keys.';
      else if (_oaErr.status === 429)  semanticError = 'OpenAI rate limit hit or billing quota exhausted. Check platform.openai.com/account/billing.';
      else if (_oaErr.status === 403)  semanticError = 'OpenAI API key does not have permission to use embeddings. Verify key scope.';
      else                             semanticError = `OpenAI connectivity failed: ${_oaErr.message}`;
      logger.warn('[companyKnowledge] keyword-health: OpenAI probe failed', { companyId, err: _oaErr.message, status: _oaErr.status });
    }
  }

  try {
    let embeddingBackfill = { processed: 0, failed: 0 };

    if (semanticAvailable) {
      // Backfill any containers missing embeddings before analysing
      embeddingBackfill = await KCKeywordHealthService.batchGenerateEmbeddings(companyId);
      if (embeddingBackfill.processed > 0) {
        logger.info('[companyKnowledge] keyword-health: backfilled embeddings', {
          companyId,
          processed: embeddingBackfill.processed,
          failed:    embeddingBackfill.failed,
        });
      }
    }

    // Run conflict analysis + keyword quality in parallel — independent queries
    const [report, quality] = await Promise.all([
      KCKeywordHealthService.analyzeConflicts(companyId),
      KCKeywordHealthService.analyzeKeywordQuality(companyId),
    ]);

    return res.json({
      success: true,
      semanticAvailable,
      semanticError:     semanticError || null,
      embeddingBackfill: semanticAvailable ? embeddingBackfill : null,
      ...report,
      quality,
    });
  } catch (err) {
    logger.error('[companyKnowledge] keyword-health error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Keyword health analysis failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/uap-arrays — UAP array list for classification card
// Returns daType, label, and daSubTypes key/label for the UI dropdown.
// ⚠️ MUST be before GET /:id — Express will match 'uap-arrays' as :id otherwise
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/uap-arrays', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const arrays = await UAPArray.find({ companyId, isActive: true })
      .select('daType label daSubTypes.key daSubTypes.label')
      .sort({ daType: 1 })
      .lean();

    return res.json({ success: true, arrays });
  } catch (err) {
    logger.error('[companyKnowledge] uap-arrays error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load UAP arrays' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/by-subtype-key/:key
// Lookup which KC container+section owns a given daSubTypeKey.
// Used by UAP Arrays page to show linked KC card per sub-type.
// Returns { found, containerId, containerTitle, sectionId, sectionLabel }
// ⚠️ MUST be before GET /:id — Express will match 'by-subtype-key' as :id otherwise
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/by-subtype-key/:key', async (req, res) => {
  const { companyId, key } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const container = await CompanyKnowledgeContainer.findOne({
      companyId,
      'sections.daSubTypeKey': key,
    }).select('_id title sections').lean();

    if (!container) {
      return res.json({ success: true, found: false });
    }

    const section = (container.sections || []).find(s => s.daSubTypeKey === key);
    return res.json({
      success:        true,
      found:          true,
      containerId:    String(container._id),
      containerTitle: container.title || '',
      sectionId:      section?._id ? String(section._id) : null,
      sectionLabel:   section?.label || '',
    });
  } catch (err) {
    logger.error('[companyKnowledge] by-subtype-key error', { companyId, key, err: err.message });
    return res.status(500).json({ success: false, error: 'Lookup failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/analyze-gaps — Content Coach: "Callers will also ask"
//
// Two sources — combined in one Groq call, gracefully:
//   1. ALWAYS: Groq industry knowledge (training on service-trade FAQ, forums, etc.)
//   2. IF EXISTS: Company's own callHistory — real callReasons matching this topic
//
// Body: { containerTitle, sectionLabel, sectionContent }
// Returns: { questions: string[], callsAnalyzed: number, sourceNote: string }
//
// callsAnalyzed = 0 at onboarding (no history yet) — feature still works fine.
// ⚠️ MUST be registered BEFORE /:id — Express matches 'analyze-gaps' as :id
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/analyze-gaps', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { containerTitle = '', sectionLabel = '', sectionContent = '' } = req.body || {};

  if (!sectionContent.trim()) {
    return res.status(400).json({ success: false, error: 'sectionContent is required' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  try {
    // ── 1. Load company context ───────────────────────────────────────────────
    const company     = await v2Company.findById(companyId, 'companyName tradeCategories').lean();
    const companyName = company?.companyName?.trim() || null;
    const trades      = (company?.tradeCategories || []).filter(Boolean);
    const tradeString = trades.length ? trades.join(', ') : null;

    // ── 2. Mine call history for real caller questions on this topic ──────────
    // Keywords extracted from KC title + section label — used for fuzzy matching
    const topicText     = `${containerTitle} ${sectionLabel}`.toLowerCase();
    const topicKeywords = [...new Set(
      topicText.split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(w => w.length > 3)
    )];

    let callReasons     = [];
    let callsAnalyzed   = 0;

    if (topicKeywords.length > 0) {
      // Pull only callHistory field — lean, no hydration needed
      const customers = await Customer.find(
        { companyId },
        { 'callHistory.callReason': 1, 'callHistory.serviceType': 1 }
      ).lean();

      // Flatten + filter by topic relevance
      const allHistory = customers.flatMap(c => c.callHistory || []);
      const relevant   = allHistory.filter(h => {
        const text = `${h.callReason || ''} ${h.serviceType || ''}`.toLowerCase();
        return topicKeywords.some(kw => text.includes(kw));
      });

      callsAnalyzed = relevant.length;

      // Deduplicate callReasons — cap at 15 to keep prompt tight
      callReasons = [...new Set(
        relevant.map(h => h.callReason).filter(Boolean)
      )].slice(0, 15);
    }

    // ── 3. Build Groq prompt ──────────────────────────────────────────────────
    const contextLines = [];
    if (companyName)           contextLines.push(`Company: "${companyName}"`);
    if (tradeString)           contextLines.push(`Trade / Industry: ${tradeString}`);
    if (containerTitle.trim()) contextLines.push(`Knowledge card topic: "${containerTitle.trim()}"`);
    if (sectionLabel.trim())   contextLines.push(`Section label: "${sectionLabel.trim()}"`);

    const historyBlock = callReasons.length
      ? `\nReal questions this company's callers have asked about this topic:\n${callReasons.map(r => `- "${r}"`).join('\n')}`
      : '';

    const userPrompt = [
      contextLines.join('\n'),
      `\nContent the agent currently has:\n"""\n${sectionContent.trim().slice(0, 2000)}\n"""`,
      historyBlock,
    ].filter(Boolean).join('\n');

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   400,
      temperature: 0.3,
      jsonMode:    true,
      system: `You are a phone-call receptionist expert for ${tradeString || 'service'} companies.

A business owner has written content for their AI receptionist. Your job: list the questions a real caller would ask about this topic that are NOT answered by the content above.

Rules:
- Think like a caller on the phone, not a search engine user.
- Use the company's real call history (if provided) as strong evidence of actual gaps.
- Add industry knowledge for gaps not yet seen in real calls.
- Write each question exactly as a caller would say it — natural, conversational.
- Max 6 questions. No duplicates.
- If the content already answers everything a caller would reasonably ask, return an empty array.

Return ONLY valid JSON — no markdown, no extra text:
{ "questions": ["question 1", "question 2", ...] }`,
      messages: [{ role: 'user', content: userPrompt }],
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    let parsed;
    try {
      const raw       = result.response.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed          = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (pe) {
      logger.warn('[companyKnowledge] analyze-gaps: parse failed', { companyId, err: pe.message });
      return res.status(500).json({ success: false, error: 'Could not parse response' });
    }

    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter(q => typeof q === 'string' && q.trim()).slice(0, 6)
      : [];

    // Human-readable source note shown below the question list in the UI
    const sourceNote = callsAnalyzed > 0
      ? `Industry knowledge for ${tradeString || 'this trade'} · ${callsAnalyzed} real call${callsAnalyzed !== 1 ? 's' : ''} analysed`
      : `Industry knowledge for ${tradeString || 'this trade'}`;

    logger.info('[companyKnowledge] analyze-gaps complete', {
      companyId, questions: questions.length, callsAnalyzed,
    });

    return res.json({ success: true, questions, callsAnalyzed, sourceNote });

  } catch (err) {
    logger.error('[companyKnowledge] analyze-gaps error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Gap analysis failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/:id — Get single container
// Accepts BOTH MongoDB _id (24-char ObjectId) AND kcId (e.g. "700c4-25").
// If the param is not a valid ObjectId, falls back to kcId lookup.
// This makes kcId a real stable address — not just a display label.
// ⚠️ Must be AFTER all literal-segment routes above
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const container = await CompanyKnowledgeContainer.findOne(_resolveContainerQuery(id, companyId)).lean();
    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });
    return res.json({ success: true, container });
  } catch (err) {
    logger.error('[companyKnowledge] GET single error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:companyId/knowledge/:id — Partial update
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:companyId/knowledge/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const updates = _sanitiseBody(req.body || {});
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    // ── Option C: capture old daSubTypeKeys before update ──────────────────
    // When sections change, diff old vs new to find orphaned UAP sub-types
    let oldSubTypeKeys = [];
    if (updates.sections !== undefined) {
      const old = await CompanyKnowledgeContainer.findOne(_resolveContainerQuery(id, companyId))
        .select('sections.daSubTypeKey').lean();
      if (old) {
        oldSubTypeKeys = (old.sections || []).map(s => s.daSubTypeKey).filter(Boolean);
      }
    }

    const container = await CompanyKnowledgeContainer.findOneAndUpdate(
      _resolveContainerQuery(id, companyId),
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    KnowledgeContainerService.invalidateCache(companyId).catch(e =>
      logger.warn('[companyKnowledge] cache invalidation failed on PATCH', { companyId, e: e.message })
    );

    // Invalidate Bridge if daType, isActive, or sections changed (routing table must be rebuilt)
    if (updates.daType !== undefined || updates.isActive !== undefined || updates.sections !== undefined) {
      BridgeService.invalidate(companyId).catch(e =>
        logger.warn('[companyKnowledge] Bridge invalidation failed (non-blocking)', { companyId, e: e.message })
      );
    }

    // ── Option C: pull orphaned daSubTypeKeys from UAPArray (fire-and-forget) ─
    if (updates.sections !== undefined && oldSubTypeKeys.length) {
      const newSubTypeKeys = new Set(
        (container.sections || []).map(s => s.daSubTypeKey).filter(Boolean)
      );
      const orphaned = oldSubTypeKeys.filter(k => !newSubTypeKeys.has(k));
      if (orphaned.length) {
        setImmediate(async () => {
          try {
            await UAPArray.updateMany(
              { companyId },
              { $pull: { daSubTypes: { key: { $in: orphaned } } } }
            );
            logger.info('[companyKnowledge] Pulled orphaned daSubTypeKeys on PATCH', { companyId, id, orphaned });
          } catch (e) {
            logger.warn('[companyKnowledge] Orphaned daSubType cleanup failed (non-blocking)', { companyId, e: e.message });
          }
        });
      }
    }

    // Re-embed if title or sections changed (the fields that affect semantic meaning)
    if (updates.title !== undefined || updates.sections !== undefined) {
      setImmediate(() =>
        KCKeywordHealthService.generateAndStoreEmbedding(id).catch(() => {})
      );
    }

    logger.info('[companyKnowledge] Updated container', { companyId, id, fields: Object.keys(updates) });
    return res.json({ success: true, container });
  } catch (err) {
    logger.error('[companyKnowledge] PATCH error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:companyId/knowledge/:id — Soft delete (isActive = false)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/knowledge/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    // Capture section daSubTypeKeys BEFORE deactivation for Option C cleanup
    const preDelete = await CompanyKnowledgeContainer.findOne(_resolveContainerQuery(id, companyId))
      .select('sections.daSubTypeKey').lean();
    const keysToOrphan = preDelete
      ? (preDelete.sections || []).map(s => s.daSubTypeKey).filter(Boolean)
      : [];

    const container = await CompanyKnowledgeContainer.findOneAndUpdate(
      _resolveContainerQuery(id, companyId),
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    BridgeService.invalidate(companyId).catch(() => {});

    // Option C: pull orphaned sub-types from UAPArray (fire-and-forget)
    if (keysToOrphan.length) {
      setImmediate(async () => {
        try {
          await UAPArray.updateMany(
            { companyId },
            { $pull: { daSubTypes: { key: { $in: keysToOrphan } } } }
          );
          logger.info('[companyKnowledge] Pulled orphaned daSubTypeKeys on soft-delete', { companyId, id, keysToOrphan });
        } catch (e) {
          logger.warn('[companyKnowledge] Orphaned daSubType cleanup on soft-delete failed', { companyId, e: e.message });
        }
      });
    }

    logger.info('[companyKnowledge] Soft-deleted container', { companyId, id });
    return res.json({ success: true, message: 'Knowledge container deactivated' });
  } catch (err) {
    logger.error('[companyKnowledge] DELETE error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to deactivate knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:companyId/knowledge/:id/hard — Permanent delete
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/knowledge/:id/hard', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    // Capture section daSubTypeKeys BEFORE deletion for Option C cleanup
    const preDelete = await CompanyKnowledgeContainer.findOne(_resolveContainerQuery(id, companyId))
      .select('sections.daSubTypeKey').lean();
    const keysToOrphan = preDelete
      ? (preDelete.sections || []).map(s => s.daSubTypeKey).filter(Boolean)
      : [];

    const result = await CompanyKnowledgeContainer.deleteOne(_resolveContainerQuery(id, companyId));
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    BridgeService.invalidate(companyId).catch(() => {});

    // Option C: pull orphaned sub-types from UAPArray (fire-and-forget)
    if (keysToOrphan.length) {
      setImmediate(async () => {
        try {
          await UAPArray.updateMany(
            { companyId },
            { $pull: { daSubTypes: { key: { $in: keysToOrphan } } } }
          );
          logger.info('[companyKnowledge] Pulled orphaned daSubTypeKeys on hard-delete', { companyId, id, keysToOrphan });
        } catch (e) {
          logger.warn('[companyKnowledge] Orphaned daSubType cleanup on hard-delete failed', { companyId, e: e.message });
        }
      });
    }

    logger.info('[companyKnowledge] Hard-deleted container', { companyId, id });
    return res.json({ success: true, message: 'Knowledge container permanently deleted' });
  } catch (err) {
    logger.error('[companyKnowledge] hard DELETE error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to delete knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/:id/generate-keywords — Regen for existing container
// Uses the same Groq logic as the pre-save endpoint — loads container from DB
// then delegates to _runKeywordGeneration.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/:id/generate-keywords', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const container = await CompanyKnowledgeContainer.findOne(_resolveContainerQuery(id, companyId)).lean();
    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    return _runKeywordGeneration(companyId, container.title, container.sections, res);
  } catch (err) {
    logger.error('[companyKnowledge] generate-keywords (existing) error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to generate keywords' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/optimize-priorities
// Analyzes ALL containers for the company and returns AI-proposed priority
// numbers. Does NOT write — caller applies via POST /reorder when confirmed.
// Returns: { success, proposals: [{ id, title, kcId, oldPriority, newPriority }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/optimize-priorities', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  try {
    const containers = await CompanyKnowledgeContainer.find({ companyId })
      .select('_id title category keywords kcId priority isActive')
      .sort({ priority: 1, createdAt: 1 })
      .lean();

    if (!containers.length) {
      return res.status(400).json({ success: false, error: 'No containers found for this company' });
    }

    // Compact summary for Groq — titles, categories, sample keywords only
    const summary = containers.map((c, i) => {
      const kwSample = (c.keywords || []).slice(0, 6).join(', ');
      const kwExtra  = (c.keywords || []).length > 6 ? ` +${(c.keywords||[]).length - 6} more` : '';
      return `${i + 1}. ID:${c._id} | "${c.title}" | cat:${c.category || 'none'} | kw:[${kwSample}${kwExtra}]`;
    }).join('\n');

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   400,
      temperature: 0.15,
      system: `You are a priority optimizer for a phone AI knowledge base used by home-service companies.
Given a list of Knowledge Containers, assign each a priority number so the most relevant container wins when a caller's question could match multiple containers.

PRIORITY RULES:
- Lower number = higher priority = wins tie-breaks when two containers score equally on keyword matching
- Use multiples of 10 ONLY (10, 20, 30 … 990) — leaves room for future manual adjustments
- SPECIFIC topic beats GENERAL: "Refrigerant Recharge (Freon)" beats "General Service Pricing"
- Unique-keyword containers (little overlap risk) → higher numbers (200–500) — they rarely compete
- High-overlap broad containers (general pricing, FAQs) → lower numbers so they serve as catch-all last resort
- Promotions/Specials → medium range (40–100), specific trigger words reduce overlap risk
- If only 1 container, assign priority 10

Return ONLY a valid JSON array — no markdown, no explanation:
[{"id":"...","priority":10},{"id":"...","priority":20}]`,
      messages: [{ role: 'user', content: `CONTAINERS:\n${summary}` }],
      jsonMode: false,
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    // Strip any accidental markdown fences then parse
    const raw = result.response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let proposed;
    try {
      proposed = JSON.parse(raw);
      if (!Array.isArray(proposed)) throw new Error('not an array');
    } catch (_e) {
      return res.status(500).json({ success: false, error: 'Groq returned unparseable priority list' });
    }

    // Build before/after proposals for the preview modal
    const idToContainer = Object.fromEntries(containers.map(c => [String(c._id), c]));
    const proposals = proposed
      .filter(p => p.id && typeof p.priority === 'number' && idToContainer[String(p.id)])
      .map(p => {
        const c = idToContainer[String(p.id)];
        return {
          id:          String(p.id),
          title:       c.title,
          kcId:        c.kcId   || null,
          isActive:    c.isActive,
          oldPriority: c.priority ?? 100,
          newPriority: Math.max(10, Math.round(p.priority / 10) * 10),
        };
      })
      .sort((a, b) => a.newPriority - b.newPriority);

    logger.info('[companyKnowledge] optimize-priorities', { companyId, count: proposals.length });
    return res.json({ success: true, proposals });

  } catch (err) {
    logger.error('[companyKnowledge] optimize-priorities error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to optimize priorities' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/suggest-label
// Body: { content: string, sectionLabel?: string, containerId?: string }
// — sectionLabel: existing label if already typed (improves classification accuracy)
// — containerId: loads container title+category + used for attachedTo on upsert
//
// Groq receives: company name + trade/industry + container title + category + section content
// → industry-specific trigger phrases, not generic ones (multi-tenant requirement)
//
// Single Groq call → returns:
//   { success, suggestion, daType, daTypeLabel, subTypeKey, subTypeLabel,
//     triggerPhrases[], arrayExists, needsArray, suggestedArrayLabel }
//
// If arrayExists → fire-and-forget upsert sub-type into UAPArray.
// If !arrayExists → needsArray:true, UI shows "Create '[label]' array" prompt.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/suggest-label', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { content, sectionLabel = '', containerId = null, isPrequalSection = false } = req.body;
  if (!content?.trim()) {
    return res.status(400).json({ success: false, error: 'No content provided' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  try {
    // Build container query — accepts both MongoDB _id AND kcId (e.g. "700c4-25")
    const _containerQuery = containerId
      ? (mongoose.Types.ObjectId.isValid(containerId)
          ? { _id: containerId, companyId }
          : { kcId: containerId, companyId })
      : null;

    // Load in parallel: UAP arrays + company identity + container meta
    const [uapArrays, company, container] = await Promise.all([
      UAPArray.find({ companyId, isActive: true }).lean(),
      v2Company.findById(companyId, 'companyName tradeCategories').lean(),
      _containerQuery
        ? CompanyKnowledgeContainer.findOne(_containerQuery, '_id title category').lean()
        : Promise.resolve(null),
    ]);

    // ── Company context for trade-aware trigger phrases ─────────────────────
    const companyName  = company?.companyName?.trim()   || null;
    const trades       = (company?.tradeCategories || []).filter(Boolean);
    const tradeString  = trades.length > 0 ? trades.join(', ') : null;

    // ── Container context (title + category tell us the topic scope) ─────────
    const containerTitle    = container?.title?.trim()    || null;
    const containerCategory = container?.category?.trim() || null;

    // ── UAP arrays catalogue ─────────────────────────────────────────────────
    const arraysCat = uapArrays.length > 0
      ? uapArrays.map(a => `${a.daType}: "${a.label}"`).join('\n')
      : 'No arrays seeded yet — infer the most logical daType for this content.';

    // ── Build context block for Groq ─────────────────────────────────────────
    const contextLines = [];
    if (companyName)         contextLines.push(`Company: "${companyName}"`);
    if (tradeString)         contextLines.push(`Trade/Industry: ${tradeString}`);
    if (containerTitle)      contextLines.push(`Container title: "${containerTitle}"`);
    if (containerCategory)   contextLines.push(`Container category: "${containerCategory}"`);
    if (sectionLabel?.trim())  contextLines.push(`Current section label hint: "${sectionLabel.trim()}"`);
    if (isPrequalSection)      contextLines.push(`Section type: PRE-QUALIFYING (asks caller a qualifying question before answering — trigger phrases must match what the caller says to ARRIVE at this fork, not what the answer says)`);
    const contextBlock = contextLines.length > 0
      ? `CONTEXT:\n${contextLines.join('\n')}\n\n`
      : '';

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   260,
      temperature: 0.2,
      jsonMode:    true,
      system: `You are a Knowledge Section classifier for a phone AI platform used by service companies.
Given a section's content and company context, you will:
1. Write a concise label (5-10 words, plain English, title-case, describes the caller's question NOT the answer)
2. Classify which intent category (daType) this section answers
3. Generate 6-10 trigger phrases — phrases must be INDUSTRY-SPECIFIC using the company's trade (e.g. for HVAC: "how much is an AC tune-up", not just "how much does it cost")

STANDARD daType vocabulary (prefer these unless a better fit exists):
PRICING_QUERY | AVAILABILITY_QUERY | BOOKING_INTENT | SERVICE_DETAILS_QUERY
PROMOTIONS_QUERY | WARRANTY_QUERY | EMERGENCY_QUERY | COMPANY_INFO_QUERY
PAYMENT_QUERY | CANCELLATION_QUERY | COMPLAINT_QUERY

If none fit, invent a logical UPPERCASE_SNAKE_CASE daType.

Critical for multi-tenant accuracy:
- Use the company's trade/industry to make trigger phrases specific (not generic)
- Use the container title + category to scope the sub-type key correctly
- subTypeKey must reflect BOTH the topic and the trade (e.g. "hvac_maintenance_pricing" not "pricing")

Return ONLY valid JSON — no markdown:
{"suggestion":"Annual Maintenance Plan Cost","daType":"PRICING_QUERY","daTypeLabel":"Pricing Questions","subTypeKey":"hvac_maintenance_pricing","subTypeLabel":"HVAC Maintenance Plan Pricing","triggerPhrases":["how much is the AC maintenance plan","what does the annual HVAC service cost","price for the maintenance agreement"]}`,
      messages: [{
        role: 'user',
        content: `UAP ARRAYS:\n${arraysCat}\n\n${contextBlock}SECTION CONTENT:\n${content.trim().slice(0, 600)}`
      }],
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    // Parse response
    let parsed;
    try {
      const raw = result.response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const m   = raw.match(/\{[\s\S]*\}/);
      parsed    = JSON.parse(m ? m[0] : raw);
      if (!parsed.suggestion) throw new Error('missing suggestion field');
    } catch (pe) {
      logger.warn('[companyKnowledge] suggest-label: parse failed', { companyId, err: pe.message });
      return res.status(500).json({ success: false, error: 'Could not parse Groq response' });
    }

    const {
      suggestion,
      daType        = null,
      daTypeLabel   = daType,
      subTypeKey    = null,
      subTypeLabel  = null,
      triggerPhrases = [],
    } = parsed;

    const cleanPhrases = [...new Set(
      (Array.isArray(triggerPhrases) ? triggerPhrases : [])
        .filter(p => typeof p === 'string')
        .map(p => p.toLowerCase().trim())
        .filter(p => p.length > 2 && p.length < 120)
    )].slice(0, 14);

    // Check if matching UAPArray already exists for this company
    const matchingArray = daType
      ? uapArrays.find(a => a.daType === daType)
      : null;
    const arrayExists   = !!matchingArray;
    const needsArray    = !!daType && !arrayExists;

    // Resolve the stable MongoDB _id for attachedTo (container may have been looked up by kcId)
    const attachedToId = container ? String(container._id) : null;

    // If array exists → fire-and-forget upsert sub-type + trigger phrases
    if (arrayExists && cleanPhrases.length > 0) {
      setImmediate(async () => {
        try {
          if (subTypeKey) {
            const subExists = (matchingArray.daSubTypes || []).some(s => s.key === subTypeKey);
            if (subExists) {
              await UAPArray.updateOne(
                { companyId, daType, 'daSubTypes.key': subTypeKey },
                {
                  $addToSet: { 'daSubTypes.$.triggerPhrases': { $each: cleanPhrases },
                               ...(attachedToId ? { 'daSubTypes.$.attachedTo': attachedToId } : {}) },
                }
              );
            } else {
              await UAPArray.findOneAndUpdate(
                { companyId, daType },
                { $push: { daSubTypes: {
                    key: subTypeKey, label: subTypeLabel || subTypeKey,
                    triggerPhrases: cleanPhrases,
                    attachedTo: attachedToId ? [attachedToId] : [],
                    classificationStatus: 'AUTO_CONFIRMED',
                } } }
              );
            }
          }
          BridgeService.invalidate(companyId).catch(() => {});
          logger.info('[companyKnowledge] suggest-label: UAP sub-type upserted', {
            companyId, daType, subTypeKey, phrasesAdded: cleanPhrases.length
          });
        } catch (uapErr) {
          logger.warn('[companyKnowledge] suggest-label: UAP upsert failed (non-blocking)', {
            companyId, daType, err: uapErr.message
          });
        }
      });
    }

    logger.debug('[companyKnowledge] suggest-label', { companyId, suggestion, daType, arrayExists });
    return res.json({
      success:            true,
      suggestion:         suggestion.trim().replace(/^["'`]|["'`]$/g, ''),
      daType,
      daTypeLabel,
      subTypeKey,
      subTypeLabel,
      triggerPhrases:     cleanPhrases,
      arrayExists,
      needsArray,
      suggestedArrayLabel: daTypeLabel || daType,
    });

  } catch (err) {
    logger.error('[companyKnowledge] suggest-label error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to generate label suggestion' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/generate-embeddings
// Backfills embeddings for all containers missing them.
// Returns: { processed: N, failed: N }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/generate-embeddings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const result = await KCKeywordHealthService.batchGenerateEmbeddings(companyId);
    logger.info('[companyKnowledge] generate-embeddings complete', { companyId, ...result });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('[companyKnowledge] generate-embeddings error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Embedding generation failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/:id/auto-classify
// ⚠️  MUST be registered AFTER /:id routes to avoid :id capturing the literal
//
// Uses Groq to:
//   1. Infer the best daType from company's UAPArrays
//   2. Generate trigger phrases for the matching UAPArray sub-type
//   3. Upsert those trigger phrases onto the UAPArray (fire-and-forget)
//   4. Update container: daType, classificationStatus, classificationScore, autoClassifiedAt
//
// Returns:
//   { success, daType, daTypeLabel, triggerPhrases, classificationScore, message }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/:id/auto-classify', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  try {
    // Load container
    const container = await CompanyKnowledgeContainer.findOne(_resolveContainerQuery(id, companyId)).lean();
    if (!container) {
      return res.status(404).json({ success: false, error: 'Knowledge container not found' });
    }

    // Load company's UAP arrays — if none seeded, can still classify (result won't attach)
    const uapArrays = await UAPArray.find({ companyId, isActive: true }).lean();

    // Build content block for Groq
    const sectionBlock = (container.sections || [])
      .filter(s => s.label?.trim() && s.content?.trim())
      .map(s => `${s.label.trim()}: ${s.content.trim().slice(0, 400)}`)
      .join('\n');

    const containerContent = [
      `Title: "${container.title || ''}"`,
      container.category ? `Category: "${container.category}"` : null,
      sectionBlock ? `Sections:\n${sectionBlock}` : null,
    ].filter(Boolean).join('\n\n');

    // Build UAP array catalogue for Groq
    const arraysCatalogue = uapArrays.length > 0
      ? uapArrays.map(a =>
          `daType: ${a.daType} | label: "${a.label}" | subTypes: [${
            (a.daSubTypes || []).map(s => `${s.key}: "${s.label}"`).join(', ')
          }]`
        ).join('\n')
      : 'No UAP arrays seeded yet — infer the most logical daType for this content.';

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   600,
      temperature: 0.15,
      jsonMode:    true,
      system: `You are a UAP (Utterance Act Parser) classifier for a phone AI platform.
Given a Knowledge Container and a catalogue of daType arrays, classify the container into the BEST matching daType.
Then generate 8–14 trigger phrases a caller might say that would route to this container.

Rules:
- Pick the SINGLE best daType. If no array matches well, invent the most logical daType key (UPPERCASE_SNAKE_CASE).
- Trigger phrases must sound like real caller speech ("how much does it cost", "what's covered", "can I get a tune-up").
- confidence: 0.0–1.0 — how certain you are this daType is correct.
- subTypeKey: snake_case key for the sub-type within this daType that best describes this container (or null if not applicable).
- subTypeLabel: human-readable label for that sub-type (or null).

Return ONLY valid JSON. No markdown.
{"daType":"PRICING_QUERY","daTypeLabel":"Pricing Questions","subTypeKey":"maintenance","subTypeLabel":"Maintenance Visit Pricing","confidence":0.92,"triggerPhrases":["how much is a tune-up","what does the maintenance cost","price for annual service"]}`,
      messages: [{
        role: 'user',
        content: `UAP ARRAYS:\n${arraysCatalogue}\n\nCONTAINER:\n${containerContent}`
      }],
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    // Parse Groq response
    let classification;
    try {
      const raw = result.response.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      const objMatch = raw.match(/\{[\s\S]*\}/);
      classification = JSON.parse(objMatch ? objMatch[0] : raw);
      if (!classification.daType) throw new Error('missing daType field');
    } catch (parseErr) {
      logger.warn('[companyKnowledge] auto-classify: parse failed', {
        companyId, id, err: parseErr.message, preview: result.response?.slice(0, 300)
      });
      return res.status(500).json({ success: false, error: 'Could not parse classification response' });
    }

    const {
      daType,
      daTypeLabel    = daType,
      subTypeKey     = null,
      subTypeLabel   = null,
      confidence     = null,
      triggerPhrases = [],
    } = classification;

    // Clean trigger phrases
    const cleanedPhrases = [...new Set(
      (Array.isArray(triggerPhrases) ? triggerPhrases : [])
        .filter(p => typeof p === 'string')
        .map(p => p.toLowerCase().trim())
        .filter(p => p.length > 2 && p.length < 120)
    )].slice(0, 16);

    // ── 1. Update the container record ───────────────────────────────────────
    const containerUpdate = {
      $set: {
        daType,
        classificationStatus: 'AUTO_CONFIRMED',
        classificationScore:  typeof confidence === 'number' ? Math.round(confidence * 100) / 100 : null,
        autoClassifiedAt:     new Date(),
      },
    };
    if (subTypeKey) {
      containerUpdate.$addToSet = { daSubTypes: subTypeKey };
    }
    await CompanyKnowledgeContainer.findOneAndUpdate(
      _resolveContainerQuery(id, companyId),
      containerUpdate,
      { new: true }
    );

    // ── 2. Upsert trigger phrases onto matching UAPArray (fire-and-forget) ───
    if (cleanedPhrases.length > 0 && uapArrays.length > 0) {
      setImmediate(async () => {
        try {
          const matchingArray = uapArrays.find(a => a.daType === daType);
          if (matchingArray) {
            // If subTypeKey specified — upsert into that sub-type's triggerPhrases
            if (subTypeKey) {
              const subExists = (matchingArray.daSubTypes || []).some(s => s.key === subTypeKey);
              if (subExists) {
                // Add trigger phrases + attachedTo to existing sub-type in one atomic update.
                // $push with $each and $addToSet can be combined on DIFFERENT paths in the same update.
                await UAPArray.updateOne(
                  { companyId, daType, 'daSubTypes.key': subTypeKey },
                  {
                    $push:    { 'daSubTypes.$.triggerPhrases': { $each: cleanedPhrases } },
                    $addToSet: { 'daSubTypes.$.attachedTo': String(id) },
                  }
                );
              } else {
                // Create new sub-type entry
                await UAPArray.findOneAndUpdate(
                  { companyId, daType },
                  {
                    $push: {
                      daSubTypes: {
                        key:              subTypeKey,
                        label:            subTypeLabel || subTypeKey,
                        triggerPhrases:   cleanedPhrases,
                        attachedTo:       [String(id)],
                        classificationStatus: 'AUTO_CONFIRMED',
                        classificationScore:  typeof confidence === 'number' ? confidence : null,
                      }
                    }
                  }
                );
              }
            } else {
              // No sub-type — just ensure container is listed in first sub-type's attachedTo
              // (graceful degrade — not blocking)
            }
          } else {
            // No matching UAPArray found — create it so owner can see + edit it
            await UAPArray.create({
              companyId,
              daType,
              label:     daTypeLabel,
              isStandard: false,
              daSubTypes: subTypeKey ? [{
                key:              subTypeKey,
                label:            subTypeLabel || subTypeKey,
                triggerPhrases:   cleanedPhrases,
                attachedTo:       [String(id)],
                classificationStatus: 'AUTO_CONFIRMED',
                classificationScore:  typeof confidence === 'number' ? confidence : null,
              }] : [],
              isActive: true,
            });
          }
          logger.info('[companyKnowledge] auto-classify: UAPArray upserted', {
            companyId, daType, subTypeKey, phrasesAdded: cleanedPhrases.length
          });
        } catch (uapErr) {
          logger.warn('[companyKnowledge] auto-classify: UAPArray upsert failed (non-blocking)', {
            companyId, id, daType, err: uapErr.message
          });
        }
      });
    }

    // Invalidate KC cache + Bridge (daType field changed)
    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    BridgeService.invalidate(companyId).catch(() => {});

    logger.info('[companyKnowledge] auto-classify complete', {
      companyId, id, daType, confidence, phrasesGenerated: cleanedPhrases.length
    });

    return res.json({
      success:           true,
      daType,
      daTypeLabel,
      subTypeKey,
      subTypeLabel,
      classificationScore: typeof confidence === 'number' ? confidence : null,
      triggerPhrases:    cleanedPhrases,
      message:           `Classified as ${daTypeLabel} (${daType}) with ${cleanedPhrases.length} trigger phrases generated`,
    });

  } catch (err) {
    logger.error('[companyKnowledge] auto-classify error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Auto-classification failed' });
  }
});

module.exports = router;
