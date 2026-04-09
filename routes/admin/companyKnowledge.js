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
 *   POST   /:companyId/knowledge/generate-phrases       — Groq caller phrase generation (per section)
 *   POST   /:companyId/knowledge/analyze-gaps           — Content Coach gap analysis (per section)
 *   POST   /:companyId/knowledge/generate-sample        — Groq-generated response style guide
 *   POST   /:companyId/knowledge/preview-fixed-audio    — 🎙️ Generate + return URL for ⚡ Fixed section audio
 *   POST   /:companyId/knowledge/regenerate-audio       — Batch-regenerate all missing KC section audio
 *   POST   /:companyId/knowledge/enable-all-fixed       — Bulk-enable useFixedResponse on all sections
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
const BridgeService                = require('../../services/engine/kc/BridgeService');
const CueExtractorService          = require('../../services/cueExtractor/CueExtractorService');
const SemanticMatchService         = require('../../services/engine/kc/SemanticMatchService');
const Customer                     = require('../../models/Customer');
const InstantAudioService          = require('../../services/instantAudio/InstantAudioService');
const KCResponseAudio              = require('../../models/KCResponseAudio');
const { replacePlaceholders }      = require('../../utils/placeholderReplacer');
const PhraseReducerService         = require('../../services/phraseIntelligence/PhraseReducerService');

const fs   = require('fs');

// ── Raw-driver container query — converts id string → ObjectId for collection.findOne() ──
// Mongoose Model.findOne() auto-casts string IDs; collection.findOne() (raw driver) does NOT.
function _resolveRawQuery(id, companyId) {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return { _id: new mongoose.Types.ObjectId(id), companyId };
  }
  return { kcId: id, companyId }; // kcId is a string — no cast needed
}

// ── Cosine similarity between two equal-length numeric vectors ───────────────
function _cosineSimilarity(a, b) {
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma  += a[i] * a[i];
    mb  += b[i] * b[i];
  }
  if (!ma || !mb) return 0;
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}

// ── Helper: persist KC audio to MongoDB for deploy-proof serving ─────────────
// Extracts the 16-char fileHash from the InstantAudioService filename,
// reads the MP3 from disk, and upserts into KCResponseAudio.
// Fire-and-forget — errors are logged but never block the caller.
function _persistKcAudioToMongo(companyId, status, sourceText, voiceId) {
  const hashMatch = status.fileName?.match(/([a-f0-9]{16})\.mp3$/);
  if (!hashMatch) return;
  const fileHash = hashMatch[1];
  const safeUrl  = status.url.replace('/audio/', '/audio-safe/');

  (async () => {
    try {
      const buffer = fs.readFileSync(status.filePath);
      await KCResponseAudio.saveAudio(companyId, fileHash, safeUrl, sourceText, voiceId, buffer);
    } catch (err) {
      logger.warn('[companyKnowledge] MongoDB audio backup failed (non-fatal)', {
        companyId, fileHash, error: err.message,
      });
    }
  })();
}

// ── Helper: persist audioUrl to a container's section immediately ────────────
// Same pattern as greeting audio: when the owner clicks "Generate Audio",
// the URL is written to the container document in the same API call —
// no separate "Save Container" needed.
// Fire-and-forget — errors are logged but never block the response.
function _persistAudioUrlToContainer(companyId, containerId, sectionIndex, audioKey, audioUrl) {
  (async () => {
    try {
      const container = await CompanyKnowledgeContainer.findOne(
        _resolveContainerQuery(containerId, companyId)
      );
      if (!container) return;

      const section = container.sections?.[sectionIndex];
      if (!section) {
        logger.warn('[companyKnowledge] _persistAudioUrlToContainer — section not found', {
          companyId, containerId, sectionIndex, audioKey,
        });
        return;
      }

      // Route to the right field based on audioKey
      if (audioKey === 'content') {
        section.audioUrl = audioUrl;
      } else if (audioKey === 'pq') {
        if (section.preQualifyQuestion) section.preQualifyQuestion.audioUrl = audioUrl;
      } else {
        // upsell-{idx}-{offer|yes|no}
        const m = audioKey.match(/^upsell-(\d+)-(offer|yes|no)$/);
        if (m && section.upsellChain?.[+m[1]]) {
          const fieldMap = { offer: 'offerAudioUrl', yes: 'yesAudioUrl', no: 'noAudioUrl' };
          section.upsellChain[+m[1]][fieldMap[m[2]]] = audioUrl;
        }
      }

      container.markModified('sections');
      await container.save();

      logger.info('[companyKnowledge] audioUrl persisted to container', {
        companyId, containerId, sectionIndex, audioKey,
      });
    } catch (err) {
      logger.warn('[companyKnowledge] _persistAudioUrlToContainer failed (non-fatal)', {
        companyId, containerId, sectionIndex, audioKey, error: err.message,
      });
    }
  })();
}

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
  // sections carry callerPhrases, bookingAction, preQualifyQuestion, upsellChain per section
  'sections',
  // negativeKeywords removed from container level — exclusion is per-section now (inside sections[])
  'sampleQuestions',    // Example caller utterances generated alongside keywords — display + analytics
  'wordLimit',
  'wordLimitEnabled',   // Boolean — when false, omits hard word cap from Groq prompt
  'useFixedResponse',   // Boolean — when true, bypasses Groq; agent reads Section 1 verbatim with pre-cached audio
  'sampleResponse',     // String — ideal example answer injected as guardrail into Groq prompt
  'bookingAction',      // Container-level default; sections can override per-section
  'closingPrompt',
  'isActive',
  'priority',
  'tradeVocabularyKey', // GlobalShare trade vocabulary link — CueExtractor reads global terms for this container
];

// Allowed fields for settings PATCH
const SETTINGS_FIELDS = [
  'enabled', 'defaultWordLimit', 'bookingOfferMode', 'bookingOfferPhrase',
  'responseTone',       // enum: professional | friendly | casual | warm
  'responseStyle',      // enum: concise | balanced | detailed
  'greetByName',        // Boolean — address caller by name in KC answers
  'acknowledgeHistory', // Boolean — acknowledge returning customers
];

/**
 * _extractContentKeywords — Synchronous NLP extraction of bigrams + significant
 * unigrams from section label + content. Used by Gate 3 keyword fallback.
 *
 * @param {string} label
 * @param {string} content
 * @returns {string[]}
 */
function _extractContentKeywords(label, content) {
  // Shared stop words — single source of truth (utils/stopWords.js)
  const StopWords = require('../../utils/stopWords');
  const STOP = StopWords.getStopWords();

  const text = `${label || ''} ${content || ''}`.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = text.split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  if (!words.length) return [];

  const keywords = new Set();

  // Significant unigrams (≥5 chars, domain words)
  for (const w of words) {
    if (w.length >= 5) keywords.add(w);
  }

  // Bigrams — consecutive meaningful word pairs
  for (let i = 0; i < words.length - 1; i++) {
    keywords.add(`${words[i]} ${words[i + 1]}`);
  }

  return [...keywords].slice(0, 40); // cap at 40 keywords
}

/**
 * _sanitiseBody — Strip fields not in ALLOWED_FIELDS and clean values.
 * Sections are validated minimally. contentKeywords auto-extracted on save.
 *
 * @param {Object} body
 * @returns {Object}
 */
function _sanitiseBody(body) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) out[key] = body[key];
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
          groqContent: (typeof s.groqContent === 'string' ? s.groqContent.trim() : '').slice(0, 4000),
          order:   typeof s.order === 'number' ? s.order : idx,
          // Per-section active toggle — false = skipped at runtime, content preserved
          isActive: s.isActive !== false,   // default true; only false when explicitly set
          // Preserve existing _id if provided (for updates)
          ...(s._id ? { _id: s._id } : {}),
        };

        // Caller phrases — full sentences that callers use when asking about this section.
        // Each phrase carries anchorWords[] (gate words) and score (3TSM result).
        // Score is round-tripped on save so Re-score is the ONLY thing that recalculates it.
        // Phrase-score endpoint uses targeted $set — it never overwrites anchors.
        if (Array.isArray(s.callerPhrases)) {
          section.callerPhrases = s.callerPhrases
            .filter(p => (typeof p === 'string' ? p.trim() : p?.text?.trim()))
            .map(p => {
              const text        = (typeof p === 'string' ? p : p.text).trim().slice(0, 200);
              const anchorWords = Array.isArray(p?.anchorWords)
                ? [...new Set(p.anchorWords.map(w => `${w}`.toLowerCase().trim()).filter(Boolean))]
                : [];
              // Preserve existing score so save never wipes it — only Re-score may update it
              const score       = p?.score && typeof p.score === 'object' ? p.score : undefined;
              return { text, anchorWords, addedAt: p?.addedAt || new Date(), ...(score ? { score } : {}) };
            });
        }

        // Auto-extract contentKeywords from section label + content (+ groqContent when available)
        const keywordSource = section.groqContent
          ? `${section.content} ${section.groqContent}`
          : section.content;
        section.contentKeywords = _extractContentKeywords(section.label, keywordSource);

        // Per-section exclusion keywords — trim, lowercase, deduplicate
        if (Array.isArray(s.negativeKeywords)) {
          section.negativeKeywords = [...new Set(
            s.negativeKeywords.map(k => `${k}`.toLowerCase().trim()).filter(Boolean)
          )];
        }

        // Per-section booking action override
        const BA_VALID = ['offer_to_book', 'advisor_callback', 'none'];
        if (s.bookingAction && BA_VALID.includes(s.bookingAction)) {
          section.bookingAction = s.bookingAction;
        }

        // Per-section Fixed Response Mode (bypass Groq, read verbatim, audio pre-cached)
        if (typeof s.useFixedResponse === 'boolean') {
          section.useFixedResponse = s.useFixedResponse;
        }
        if (typeof s.audioUrl === 'string' && s.audioUrl.trim()) {
          section.audioUrl = s.audioUrl.trim();
        }

        // Per-section Promotion flag + label
        if (typeof s.isPromotion === 'boolean') {
          section.isPromotion = s.isPromotion;
        }
        if (typeof s.promotionLabel === 'string') {
          section.promotionLabel = s.promotionLabel.trim().slice(0, 120);
        }

        // Preserve computed cores — Re-score is the only thing that recalculates these.
        // Round-tripped from UI payload so saves never wipe them.
        // Embeddings (phraseCoreEmbedding, contentEmbedding) are server-only and
        // regenerated by Re-score — not sent through the UI save path.
        if (typeof s.phraseCore === 'string' && s.phraseCore.trim()) {
          section.phraseCore = s.phraseCore.trim();
        }
        if (typeof s.contentCore === 'string' && s.contentCore.trim()) {
          section.contentCore = s.contentCore.trim();
        }

        // Per-section daSubTypeKey (UAP sub-type routing link)
        if (typeof s.daSubTypeKey === 'string' && s.daSubTypeKey.trim()) {
          section.daSubTypeKey = s.daSubTypeKey.trim();
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
              // Audio URL — persisted so pre-cached audio survives page refreshes + deploys
              audioUrl: typeof pq.audioUrl === 'string' && pq.audioUrl.trim() ? pq.audioUrl.trim() : null,
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
              offerScript:   u.offerScript.trim().slice(0, 600),
              yesScript:     typeof u.yesScript === 'string' ? u.yesScript.trim().slice(0, 400) : '',
              noScript:      typeof u.noScript  === 'string' ? u.noScript.trim().slice(0, 400)  : '',
              itemKey:       typeof u.itemKey   === 'string' ? u.itemKey.trim().slice(0, 60)    : '',
              price:         (typeof u.price === 'number' && !isNaN(u.price)) ? u.price : null,
              // Audio URLs — persisted so pre-cached audio survives page refreshes + deploys
              offerAudioUrl: typeof u.offerAudioUrl === 'string' && u.offerAudioUrl.trim() ? u.offerAudioUrl.trim() : null,
              yesAudioUrl:   typeof u.yesAudioUrl   === 'string' && u.yesAudioUrl.trim()   ? u.yesAudioUrl.trim()   : null,
              noAudioUrl:    typeof u.noAudioUrl    === 'string' && u.noAudioUrl.trim()    ? u.noAudioUrl.trim()    : null,
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
    // Also fetch company trade for card badges
    const company = await v2Company.findById(companyId).select('settings.trade').lean().catch(() => null);
    const trade = company?.settings?.trade || null;

    return res.json({ success: true, containers, total: containers.length, companyVariables, trade });
  } catch (err) {
    logger.error('[companyKnowledge] GET list error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load knowledge containers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/card-analytics — Per-container hit counts + misses
// Aggregates Customer.discoveryNotes[].qaLog[] to power enterprise KC cards.
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/card-analytics', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const pipeline = [
      { $match: { companyId } },
      { $unwind: { path: '$discoveryNotes', preserveNullAndEmptyArrays: false } },
      { $unwind: { path: '$discoveryNotes.qaLog', preserveNullAndEmptyArrays: false } },
      // Skip UAP_LAYER1 diagnostic-only entries (same as calibration.js)
      {
        $match: {
          $or: [
            { 'discoveryNotes.qaLog.type': { $exists: false } },  // standard KC match
            { 'discoveryNotes.qaLog.type': 'KC_LLM_FALLBACK' },
            { 'discoveryNotes.qaLog.type': 'KC_GRACEFUL_ACK' },
          ],
        },
      },
      {
        $facet: {
          // Per-container hit counts (successful KC matches have containerId)
          byContainer: [
            { $match: { 'discoveryNotes.qaLog.containerId': { $exists: true, $ne: null } } },
            {
              $group: {
                _id: '$discoveryNotes.qaLog.containerId',
                hitCount:  { $sum: 1 },
                lastHitAt: { $max: '$discoveryNotes.qaLog.timestamp' },
              },
            },
          ],
          // LLM fallback count — Groq took over (near-miss, needs better sections)
          fallbacks: [
            { $match: { 'discoveryNotes.qaLog.type': 'KC_LLM_FALLBACK' } },
            { $count: 'total' },
          ],
          // Graceful ACK — total misses (no KC + no LLM)
          misses: [
            { $match: { 'discoveryNotes.qaLog.type': 'KC_GRACEFUL_ACK' } },
            { $count: 'total' },
          ],
          // Total actionable entries
          totals: [
            { $count: 'total' },
          ],
        },
      },
    ];

    const [result] = await Customer.aggregate(pipeline);

    // Shape: containerId string → { hitCount, lastHitAt }
    const containerStats = {};
    for (const row of (result?.byContainer || [])) {
      containerStats[String(row._id)] = {
        hitCount:  row.hitCount,
        lastHitAt: row.lastHitAt,
      };
    }

    return res.json({
      success:        true,
      containerStats,
      fallbackCount:  result?.fallbacks?.[0]?.total || 0,
      missCount:      result?.misses?.[0]?.total || 0,
      totalEntries:   result?.totals?.[0]?.total || 0,
    });
  } catch (err) {
    logger.error('[companyKnowledge] card-analytics error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load analytics' });
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

    // Invalidate runtime cache + Bridge phrase index — next call sees fresh data
    KnowledgeContainerService.invalidateCache(companyId).catch(e =>
      logger.warn('[companyKnowledge] cache invalidation failed on POST', { companyId, e: e.message })
    );
    BridgeService.invalidate(companyId).catch(() => {});
    CueExtractorService.invalidateTradeIndex(companyId).catch(() => {});

    // Fire-and-forget: embed callerPhrases + section content via SemanticMatchService
    setImmediate(async () => {
      try {
        const sections = container.sections || [];
        const phraseCount   = await SemanticMatchService.embedCallerPhrases(sections);
        const contentCount  = await SemanticMatchService.embedSectionContent(sections);
        if (phraseCount > 0 || contentCount > 0) {
          await CompanyKnowledgeContainer.updateOne(
            { _id: container._id },
            { $set: { sections } }
          );
        }
      } catch (_e) { /* non-fatal */ }
      KCKeywordHealthService.generateAndStoreEmbedding(container._id).catch(() => {});
    });

    // Pre-generate instant audio when any Fixed Response Mode is active on creation
    // Covers: container.useFixedResponse (Section 1) AND per-section useFixedResponse
    const anyFixedOnCreate = container.useFixedResponse
      || (container.sections || []).some(s => s.useFixedResponse);
    if (anyFixedOnCreate) {
      _preGenAudioFixed(companyId, container, 'created');
    }

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
      maxTokens:   700,  // bumped — now returns 3 arrays: keywords + exclusions + sample questions
      temperature: 0.4,
      jsonMode:    true,
      system: `You are a keyword expert for an AI phone receptionist at a service company.

Given a knowledge card topic and content, return a JSON object with EXACTLY these three fields:

"keywords" — array of 12-18 short phrases that a caller might say when asking about this topic over the phone. Multi-word phrases score higher than single words, so prefer them. Cover natural variations: pricing, scheduling, what's included, availability, refunds, emergency, same-day, etc.

"negativeKeywords" — array of 3-6 adjacent topics this card should NOT handle. Use multi-word phrases when possible ("dryer vent cleaning" not just "dryer") for precision. Think: what other services or topics share some of the same words but mean something completely different?

"sampleQuestions" — array of exactly 3 real caller phrases that SHOULD trigger this card. Natural phone-call language, not formal. These validate that the keywords are correct.

Return ONLY this JSON object — no markdown, no extra text, no other field names:
{
  "keywords": ["phrase 1", "phrase 2", ...],
  "negativeKeywords": ["exclusion 1", "exclusion 2", ...],
  "sampleQuestions": ["question 1", "question 2", "question 3"]
}`,
      messages: [{ role: 'user', content: promptContent }],
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    // Parse JSON object
    let parsed = {};
    try {
      const raw       = result.response.trim();
      const objMatch  = raw.match(/\{[\s\S]*\}/);
      parsed          = JSON.parse(objMatch ? objMatch[0] : raw);
    } catch (_e) {
      logger.warn('[companyKnowledge] generate-keywords: parse failed, raw:', result.response.slice(0, 300));
      return res.status(500).json({ success: false, error: 'Failed to parse keyword response' });
    }

    // Helper: clean a string array field
    const _cleanArr = (arr, cap) => [...new Set(
      (Array.isArray(arr) ? arr : [])
        .filter(k => typeof k === 'string')
        .map(k => k.toLowerCase().trim())
        .filter(k => k.length > 2 && k.length < 80)
    )].slice(0, cap);

    // Field-name fallbacks — Groq occasionally uses trigger_keywords, exclusionKeywords, etc.
    const kwRaw  = parsed.keywords         || parsed.triggerKeywords  || parsed.trigger_keywords  || parsed.phrases       || [];
    const negRaw = parsed.negativeKeywords || parsed.exclusionKeywords || parsed.exclusion_keywords || parsed.negKeywords  || [];
    const sqRaw  = parsed.sampleQuestions  || parsed.sampleCalls      || parsed.sample_questions  || parsed.examples      || [];

    const keywords         = _cleanArr(kwRaw,  20);
    const negativeKeywords = _cleanArr(negRaw,  8);
    // sampleQuestions kept as-is (not lowercased — they're display strings)
    const sampleQuestions  = (Array.isArray(sqRaw) ? sqRaw : [])
      .filter(q => typeof q === 'string' && q.trim())
      .slice(0, 3);

    // Warn if Groq returned something unexpected — shows actual keys for diagnosis
    if (keywords.length === 0) {
      logger.warn('[companyKnowledge] generate-keywords: keywords empty after parse', {
        companyId, parsedKeys: Object.keys(parsed), raw: result.response.slice(0, 400),
      });
    }

    logger.info('[companyKnowledge] Generated keywords', {
      companyId, keywords: keywords.length, negativeKeywords: negativeKeywords.length,
    });
    return res.json({ success: true, keywords, negativeKeywords, sampleQuestions });

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
 * @param {Object} payload   — { title, category, sections,
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
    title = '', category = '', sections = [],
    wordLimit = null, wordLimitEnabled = true, sampleResponse = '',
    bookingAction = 'offer_to_book', closingPrompt = '',
  } = payload;

  // ── Build rich section block — includes negKw + prequal + upsell per section ──
  const sectionBlock = (sections || [])
    .filter(s => s.label?.trim() && s.content?.trim())
    .map(s => {
      const lines = [`[SECTION: ${s.label.trim().toUpperCase()}]`];
      lines.push(`Content: ${s.content.trim().slice(0, 500)}`);
      // Per-section exclusion keywords
      const secNeg = (s.negativeKeywords || []).filter(Boolean);
      if (secNeg.length) {
        lines.push(`Exclusion keywords: [${secNeg.join(', ')}]`);
      }
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

  const wlDisplay = !wordLimitEnabled
    ? 'DISABLED — agent may use as many words as needed'
    : wordLimit ? `${wordLimit} words` : 'not set (falls back to global default ~40)';

  const userContent = `CONTAINER:
Title: "${title}"
Category: "${category || 'none'}"
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
    const UAP = require('../../services/engine/kc/UtteranceActParser');
    const containers = await KCS.getActiveForCompany(companyId);

    if (!containers.length) {
      return res.json({ ok: true, winner: null, paths: {}, utteranceNorm: utterance.trim(), note: 'No active containers found for this company.' });
    }

    const results = { uap: null, semantic: null, keyword: null };

    // ── Path 1: UAP phrase match ──────────────────────────────────────────
    try {
      const uapResult = await UAP.parse(companyId, utterance);
      if (uapResult.containerId) {
        const c = containers.find(ct => String(ct._id) === uapResult.containerId);
        results.uap = {
          containerId:  uapResult.containerId,
          sectionIdx:   uapResult.sectionIdx,
          sectionLabel: uapResult.sectionLabel || c?.sections?.[uapResult.sectionIdx]?.label || null,
          containerTitle: c?.title || null,
          confidence:   uapResult.confidence,
          matchType:    uapResult.matchType,
          matchedPhrase: uapResult.matchedPhrase,
        };
      }
    } catch (_) { /* non-fatal */ }

    // ── Path 2: Semantic embedding match ──────────────────────────────────
    try {
      const embContainers = await CompanyKnowledgeContainer
        .find({ companyId, isActive: true })
        .select('+sections.callerPhrases.embedding +sections.contentEmbedding')
        .lean();
      const semResult = await SemanticMatchService.findBestSection(companyId, utterance, embContainers);
      if (semResult) {
        results.semantic = {
          containerId:    String(semResult.container._id),
          containerTitle: semResult.container.title,
          sectionIdx:     semResult.sectionIdx,
          sectionLabel:   semResult.section?.label || null,
          similarity:     semResult.similarity,
          matchSource:    semResult.matchSource,
        };
      }
    } catch (_) { /* non-fatal */ }

    // ── Path 3: Keyword scoring ───────────────────────────────────────────
    const context = callReason ? { callReason } : null;
    const kwMatch = KCS.findContainer(containers, utterance, context);
    if (kwMatch) {
      results.keyword = {
        containerId:    String(kwMatch.container._id),
        containerTitle: kwMatch.container.title,
        score:          kwMatch.score,
        bestSection:    kwMatch.bestSection?.label || null,
        contextAssisted: kwMatch.contextAssisted || false,
      };
    }

    // Determine overall winner (same priority as runtime: UAP > Semantic > Keyword)
    const winner = results.uap?.confidence >= 0.80
      ? { ...results.uap, via: 'UAP' }
      : results.semantic
        ? { ...results.semantic, via: 'SEMANTIC' }
        : results.keyword
          ? { ...results.keyword, via: 'KEYWORD' }
          : null;

    return res.json({
      ok:              true,
      utterance:       utterance.trim(),
      callReason:      callReason || null,
      winner,
      paths:           results,
      totalContainers: containers.length,
      note: winner
        ? `Matched via ${winner.via}: "${winner.containerTitle}"${winner.sectionLabel ? ` → ${winner.sectionLabel}` : ''}`
        : 'No match — would fall through to LLM',
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

  const {
    containerTitle    = '',
    sectionLabel      = '',
    sectionContent    = '',
    allSectionsContent = [],   // [{label, content}] for every section in this KC
  } = req.body || {};
  const blankMode = !sectionContent.trim();  // true = writer's block mode — no content yet

  // Require at least a title or section label so Groq has something to work with
  if (blankMode && !containerTitle.trim() && !sectionLabel.trim()) {
    return res.status(400).json({ success: false, error: 'Add a section label or KC title first so we know what topic to generate questions for' });
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
    if (sectionLabel.trim())   contextLines.push(`Section being written: "${sectionLabel.trim()}"`);

    // Build "already covered" block from sibling sections so Groq doesn't suggest duplicates
    const otherSections = (Array.isArray(allSectionsContent) ? allSectionsContent : [])
      .filter(s => s && (s.label || '').trim() !== (sectionLabel || '').trim() && (s.content || '').trim());
    const coveredBlock = otherSections.length
      ? `\nAlready covered in other sections of this knowledge card:\n${otherSections.map(s => `- ${s.label || 'Section'}: ${(s.content || '').trim().slice(0, 300)}`).join('\n')}`
      : '';

    const historyBlock = callReasons.length
      ? `\nReal questions this company's callers have asked about this topic:\n${callReasons.map(r => `- "${r}"`).join('\n')}`
      : '';

    const userPrompt = blankMode
      ? [
          contextLines.join('\n'),
          coveredBlock,
          historyBlock,
        ].filter(Boolean).join('\n')
      : [
          contextLines.join('\n'),
          `\nContent written so far for this section:\n"""\n${sectionContent.trim().slice(0, 2000)}\n"""`,
          coveredBlock,
          historyBlock,
        ].filter(Boolean).join('\n');

    const jsonSchema = `{ "questions": [{"q": "question as the caller would say it", "sample": "2-3 sentence sample answer in natural phone agent voice — use [brackets] for company-specific values the owner needs to fill in"}] }`;

    const systemPrompt = blankMode
      ? `You are a phone-call receptionist expert for ${tradeString || 'service'} companies.

A business owner is writing content for their AI receptionist but hasn't started this section yet. Your job: list the questions a real caller would ask about this topic — these become the owner's writing guide. For each question, also write a short sample answer to help the owner know WHAT to write (they'll customise it).

Rules:
- Think like a caller on the phone, not a search engine user.
- Use the company's real call history (if provided) as strong evidence of what callers actually ask.
- Do NOT suggest questions already covered in other sections of this knowledge card.
- Add industry knowledge for questions not yet seen in real calls.
- Write each question exactly as a caller would say it — natural, conversational, short.
- Sample answers: 2-3 sentences, natural phone-agent tone, use [brackets] for values the owner must fill in (e.g. [price], [time window], [area]).
- Max 6 questions. Cover the most important ones first.
- No duplicates.

Return ONLY valid JSON — no markdown, no extra text:
${jsonSchema}`
      : `You are a phone-call receptionist expert for ${tradeString || 'service'} companies.

A business owner has written content for one section of their AI receptionist knowledge card. Your job: list the questions a real caller would ask about this topic that are NOT yet answered — either in the current section content or in other sections already written. For each gap, write a short sample answer to help the owner know what to add.

Rules:
- Think like a caller on the phone, not a search engine user.
- Only flag gaps not covered anywhere in the knowledge card (current section + other sections shown).
- Use the company's real call history (if provided) as strong evidence of actual gaps.
- Add industry knowledge for gaps not yet seen in real calls.
- Write each question exactly as a caller would say it — natural, conversational.
- Sample answers: 2-3 sentences, natural phone-agent tone, use [brackets] for values the owner must fill in.
- Max 6 questions. No duplicates.
- If everything a caller would reasonably ask is already covered, return an empty array.

Return ONLY valid JSON — no markdown, no extra text:
${jsonSchema}`;

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   900,  // bumped — now returns {q, sample} pairs, ~150 tokens each × 6
      temperature: 0.3,
      jsonMode:    true,
      system:      systemPrompt,
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

    // Normalise to [{q, sample}] — handle both new schema and legacy string arrays
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions
          .map(item => {
            if (typeof item === 'string') return { q: item.trim(), sample: '' };
            if (item && typeof item.q === 'string') return { q: item.q.trim(), sample: (item.sample || '').trim() };
            return null;
          })
          .filter(item => item && item.q)
          .slice(0, 6)
      : [];

    // Human-readable source note shown below the question list in the UI
    const sourceNote = callsAnalyzed > 0
      ? `Industry knowledge for ${tradeString || 'this trade'} · ${callsAnalyzed} real call${callsAnalyzed !== 1 ? 's' : ''} analysed`
      : `Industry knowledge for ${tradeString || 'this trade'}`;

    logger.info('[companyKnowledge] analyze-gaps complete', {
      companyId, questions: questions.length, callsAnalyzed,
    });

    return res.json({ success: true, questions, callsAnalyzed, sourceNote, blankMode });

  } catch (err) {
    logger.error('[companyKnowledge] analyze-gaps error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Gap analysis failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/preview-fixed-audio — Generate + return audio URL
// ─────────────────────────────────────────────────────────────────────────────
// Used by the ⚡ Fixed strip's 🎙️ Preview button in services-item.html.
// Checks if audio for the given text is already cached on disk. If not,
// synthesises it now (ElevenLabs → disk). Returns the /audio-safe URL so
// the browser can play the file immediately for owner review.
//
// Body: { text: string }  (section content — max 420 chars)
// Returns: { success, url, generated, chars }
//   generated: true  = freshly synthesised now
//   generated: false = already existed in cache (instant)
//
// ⚠️ MUST be registered BEFORE :id
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/preview-fixed-audio', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const { text, containerId, sectionIndex, audioKey } = req.body || {};
    if (!text?.trim()) {
      return res.status(400).json({ success: false, error: 'text is required' });
    }

    const trimmed = text.trim();

    // Load company (needed for both voice settings and variable resolution)
    const company = await v2Company.findById(companyId).lean();
    const vs      = company?.aiAgentSettings?.voiceSettings;
    if (!vs?.voiceId) {
      return res.status(400).json({
        success: false,
        error: 'No voice configured — set your ElevenLabs voice in Agent Settings first.',
      });
    }

    // ── Resolve company-level variables before TTS ──────────────────────
    // System vars ({companyName}, {serviceAreas}, etc.) + custom vars
    // ({reg_diagnostic_fee}, etc.) are known at edit time and can be baked
    // into the audio.  Caller-specific runtime vars ({customerName}, etc.)
    // remain unresolved and must block generation.
    //
    // Custom variables live in CompanyTriggerSettings.companyVariables —
    // pass them as additionalVars so replacePlaceholders resolves them too.
    const triggerSettings = await CompanyTriggerSettings.findOne({ companyId }).lean();
    const customVars = triggerSettings?.companyVariables instanceof Map
      ? Object.fromEntries(triggerSettings.companyVariables)
      : (triggerSettings?.companyVariables || {});
    const resolvedText = replacePlaceholders(trimmed, company, customVars);
    const remainingVars = resolvedText.match(/\{[^}]+\}/g);
    if (remainingVars?.length) {
      const unique = [...new Set(remainingVars)];
      return res.status(400).json({
        success: false,
        error: `Cannot pre-record: ${unique.join(', ')} ${unique.length === 1 ? 'is a' : 'are'} caller-specific variable${unique.length === 1 ? '' : 's'} resolved at call time`,
      });
    }

    if (resolvedText.length > 420) {
      return res.status(400).json({
        success: false,
        error: `Content too long for pre-caching (${resolvedText.length} chars — max 420). Shorten the section to enable instant audio.`,
      });
    }

    // ── Check disk cache first — may already exist from last save ─────────
    const existing = InstantAudioService.getStatus({
      companyId,
      kind:          'KC_RESPONSE',
      text:          resolvedText,
      voiceSettings: vs,
    });

    let safeUrl;
    let generated;

    if (existing.exists) {
      // Ensure MongoDB backup exists (covers files generated before this feature)
      _persistKcAudioToMongo(companyId, existing, resolvedText, vs.voiceId);
      safeUrl   = existing.url.replace('/audio/', '/audio-safe/');
      generated = false;
      logger.info('[companyKnowledge] preview-fixed-audio — cache hit', { companyId, chars: resolvedText.length });
    } else {
      // ── Not cached — synthesise now (synchronous for immediate playback) ──
      await InstantAudioService.generate({
        companyId,
        kind:          'KC_RESPONSE',
        text:          resolvedText,
        company,
        voiceSettings: vs,
      });

      const fresh = InstantAudioService.getStatus({
        companyId,
        kind:          'KC_RESPONSE',
        text:          resolvedText,
        voiceSettings: vs,
      });

      if (!fresh.exists) {
        return res.status(500).json({ success: false, error: 'Generation succeeded but file not found — try again.' });
      }

      // Persist to MongoDB for deploy-proof serving
      _persistKcAudioToMongo(companyId, fresh, resolvedText, vs.voiceId);
      safeUrl   = fresh.url.replace('/audio/', '/audio-safe/');
      generated = true;
      logger.info('[companyKnowledge] preview-fixed-audio — generated', { companyId, chars: resolvedText.length });
    }

    // ── BULLETPROOF PERSISTENCE: write audioUrl to container immediately ────
    // Same pattern as greeting audio: the Generate button persists the URL to
    // the database in a single API call — no separate "Save Container" needed.
    // This prevents the URL from being lost if the user refreshes/navigates
    // before clicking Save.
    if (containerId && sectionIndex != null && sectionIndex >= 0) {
      _persistAudioUrlToContainer(companyId, containerId, sectionIndex, audioKey || 'content', safeUrl);
    }

    return res.json({ success: true, url: safeUrl, generated, chars: resolvedText.length, resolvedText });

  } catch (err) {
    logger.error('[companyKnowledge] preview-fixed-audio error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: err.message || 'Audio generation failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/generate-sample — ✨ Generate Response Style Guide
//
// Groq reads the KC section content and writes a ~30-word spoken-word sample
// answer in the company's trade/service context. Owner reviews before saving.
// Body: { title, category, sectionText }
// Returns: { success, sample }
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/generate-sample', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  const { title = '', category = '', sectionText = '' } = req.body || {};
  if (!sectionText.trim()) {
    return res.status(400).json({ success: false, error: 'sectionText is required' });
  }

  try {
    const company = await v2Company.findById(companyId).lean();
    const trade   = company?.trade || (company?.tradeCategories || [])[0] || 'home services';
    const name    = company?.companyName || 'the company';

    const system = `You are a coaching assistant for ${name}, a ${trade} company.
Your job is to write a RESPONSE STYLE GUIDE that tells an AI phone agent HOW to answer questions about the topic below. This is NOT the answer itself — it is coaching instructions for the agent.

Write 2-4 concise directive sentences covering:
- TONE: How should the agent sound? (warm, confident, reassuring, etc.)
- KEY FACTS: Which specific details (prices, timeframes, features) MUST be mentioned?
- OFFER: What should the agent naturally suggest? (booking, follow-up, upgrade, etc.)
- AVOID: Anything the agent should NOT say or assume?

Rules:
- Write as directives: "Mention the $89 price point", "Keep it reassuring", "Offer to schedule"
- Be specific — reference actual numbers, features, and terms from the content
- Keep it under 60 words total — punchy coaching, not a paragraph
- Do NOT write the actual phone response — write the style instructions
- Return ONLY the directive text — no quotes, no labels, no bullet markers, no numbering`;

    const userMsg = `Topic: ${title || category || 'general service question'}
${category ? `Category: ${category}` : ''}

Content:
${sectionText.trim().slice(0, 1200)}`;

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      system,
      messages:    [{ role: 'user', content: userMsg }],
      maxTokens:   180,
      temperature: 0.5,
    });

    const sample = (result.response || '').trim().replace(/^["']|["']$/g, '');
    if (!sample) throw new Error(result.failureReason || 'Empty response from Groq');

    logger.info('[companyKnowledge] generate-sample complete', { companyId, words: sample.split(/\s+/).length });
    return res.json({ success: true, sample });

  } catch (err) {
    logger.error('[companyKnowledge] generate-sample error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Sample generation failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/regenerate-audio — Batch-regenerate KC audio
// ─────────────────────────────────────────────────────────────────────────────
// Default: regenerates only MISSING audio (no MongoDB backup).
// With { force: true }: regenerates ALL qualifying fixed sections (overwrites).
// Writes audioUrl back to each section and persists audio to MongoDB (deploy-proof).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/regenerate-audio', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const force = req.body?.force === true || req.query?.force === 'true';

  try {
    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });

    const vs = company?.aiAgentSettings?.voiceSettings;
    if (!vs?.voiceId) {
      return res.status(400).json({
        success: false,
        error: 'No voice configured — set your ElevenLabs voice in Agent Settings first.',
      });
    }

    // Load custom company variables for placeholder resolution
    const triggerSettings = await CompanyTriggerSettings.findOne({ companyId }).lean();
    const customVars = triggerSettings?.companyVariables instanceof Map
      ? Object.fromEntries(triggerSettings.companyVariables)
      : (triggerSettings?.companyVariables || {});

    // Full Mongoose docs (not lean) — need .save() for audioUrl writeback
    const containers = await CompanyKnowledgeContainer.find({
      companyId, isActive: true,
    });

    let regenerated = 0, skipped = 0, errors = 0, alreadyCached = 0;

    for (const container of containers) {
      const sections = container.sections || [];
      let containerDirty = false;

      for (const section of sections) {
        if (!section.useFixedResponse) continue;
        const rawText = section.content?.trim();
        if (!rawText) { skipped++; continue; }

        // Resolve company-level variables (same logic as preview-fixed-audio)
        const resolvedText = replacePlaceholders(rawText, company, customVars);
        const remainingVars = resolvedText.match(/\{[^}]+\}/g);
        if (remainingVars?.length) { skipped++; continue; } // has runtime vars
        if (resolvedText.length > 420) { skipped++; continue; } // too long

        // Check if InstantAudioService knows the hash
        const status = InstantAudioService.getStatus({
          companyId, kind: 'KC_RESPONSE', text: resolvedText, voiceSettings: vs,
        });
        const hashMatch = status.fileName?.match(/([a-f0-9]{16})\.mp3$/);
        if (!hashMatch) { skipped++; continue; }

        // When not force: only regenerate if MongoDB backup missing
        if (!force) {
          const existing = await KCResponseAudio.findOne({
            companyId, fileHash: hashMatch[1], isValid: true,
          }).select('_id').lean();

          if (existing) { alreadyCached++; continue; }
        }

        // Generate audio + persist to MongoDB (awaited, not fire-and-forget)
        try {
          const genResult = await InstantAudioService.generate({
            companyId, kind: 'KC_RESPONSE', text: resolvedText, company, voiceSettings: vs,
            force,
          });

          const safeUrl = genResult.url.replace('/audio/', '/audio-safe/');
          const fh = hashMatch[1];

          // Await MongoDB persist for batch reliability
          try {
            const buffer = fs.readFileSync(genResult.filePath);
            await KCResponseAudio.saveAudio(companyId, fh, safeUrl, resolvedText, vs.voiceId, buffer);
          } catch (persistErr) {
            logger.warn('[companyKnowledge] regenerate-audio — MongoDB persist failed', {
              companyId, fileHash: fh, error: persistErr.message,
            });
          }

          // Write audioUrl back to section document
          if (!section.audioUrl || section.audioUrl !== safeUrl) {
            section.audioUrl = safeUrl;
            containerDirty = true;
          }

          regenerated++;
          logger.info('[companyKnowledge] regenerate-audio — generated', {
            companyId, container: container.title, hash: fh, force,
          });
        } catch (genErr) {
          errors++;
          logger.warn('[companyKnowledge] regenerate-audio — generation failed', {
            companyId, container: container.title, error: genErr.message,
          });
        }
      }

      // Save container if any audioUrl was updated
      if (containerDirty) {
        try { await container.save(); } catch (saveErr) {
          logger.warn('[companyKnowledge] regenerate-audio — container save failed', {
            companyId, containerId: container._id, error: saveErr.message,
          });
        }
      }
    }

    // Invalidate runtime cache after bulk changes
    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});

    logger.info('[companyKnowledge] regenerate-audio complete', {
      companyId, regenerated, alreadyCached, skipped, errors, force,
    });

    res.json({ success: true, regenerated, alreadyCached, skipped, errors });
  } catch (err) {
    logger.error('[companyKnowledge] regenerate-audio error', { companyId, err: err.message });
    res.status(500).json({ success: false, error: err.message || 'Batch regeneration failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/enable-all-fixed — Bulk-enable useFixedResponse
// ─────────────────────────────────────────────────────────────────────────────
// Flips useFixedResponse=true on EVERY section of EVERY active container.
// One-click bulk toggle from the Audio Health dashboard.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/enable-all-fixed', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const containers = await CompanyKnowledgeContainer.find({
      companyId, isActive: true,
    });

    let containersUpdated = 0, sectionsEnabled = 0, alreadyEnabled = 0;

    for (const container of containers) {
      let changed = false;

      // Container-level toggle
      if (!container.useFixedResponse) {
        container.useFixedResponse = true;
        changed = true;
      }

      // Per-section toggles
      for (const section of (container.sections || [])) {
        if (section.useFixedResponse) {
          alreadyEnabled++;
        } else {
          section.useFixedResponse = true;
          sectionsEnabled++;
          changed = true;
        }
      }

      if (changed) {
        await container.save();
        containersUpdated++;
      }
    }

    // Invalidate runtime caches
    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    BridgeService.invalidate(companyId).catch(() => {});
    CueExtractorService.invalidateTradeIndex(companyId).catch(() => {});

    logger.info('[companyKnowledge] enable-all-fixed complete', {
      companyId, containersUpdated, sectionsEnabled, alreadyEnabled,
    });

    res.json({
      success: true,
      containersUpdated,
      sectionsEnabled,
      alreadyEnabled,
      totalSections: sectionsEnabled + alreadyEnabled,
    });
  } catch (err) {
    logger.error('[companyKnowledge] enable-all-fixed error', { companyId, err: err.message });
    res.status(500).json({ success: false, error: err.message || 'Bulk enable failed' });
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
    const container = await CompanyKnowledgeContainer.findOneAndUpdate(
      _resolveContainerQuery(id, companyId),
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    // Invalidate runtime cache + Bridge phrase index on every save
    KnowledgeContainerService.invalidateCache(companyId).catch(e =>
      logger.warn('[companyKnowledge] cache invalidation failed on PATCH', { companyId, e: e.message })
    );
    BridgeService.invalidate(companyId).catch(() => {});
    CueExtractorService.invalidateTradeIndex(companyId).catch(() => {});

    // Fire-and-forget: embed callerPhrases + section content + keyword health
    // ⚠️ CRITICAL: use targeted dot-notation $set for embeddings ONLY.
    // Never replace the full sections array here — that would race against atomic
    // Re-score updates (phraseCore, contentCore, phraseCoreEmbedding) and wipe them.
    if (updates.title !== undefined || updates.sections !== undefined) {
      setImmediate(async () => {
        try {
          const sections = container.sections || [];
          const phraseCount  = await SemanticMatchService.embedCallerPhrases(sections);
          const contentCount = await SemanticMatchService.embedSectionContent(sections);
          if (phraseCount > 0 || contentCount > 0) {
            // Build dot-notation $set — only touch embedding fields, never phraseCore/contentCore
            const embeddingSet = {};
            sections.forEach((sec, sIdx) => {
              if (sec.contentEmbedding?.length) {
                embeddingSet[`sections.${sIdx}.contentEmbedding`]   = sec.contentEmbedding;
                embeddingSet[`sections.${sIdx}.contentEmbeddingAt`] = sec.contentEmbeddingAt || new Date();
              }
              (sec.callerPhrases || []).forEach((phrase, pIdx) => {
                if (phrase.embedding?.length) {
                  embeddingSet[`sections.${sIdx}.callerPhrases.${pIdx}.embedding`] = phrase.embedding;
                }
              });
            });
            if (Object.keys(embeddingSet).length) {
              await CompanyKnowledgeContainer.updateOne(
                { _id: container._id },
                { $set: embeddingSet }
              );
            }
          }
        } catch (_e) { /* non-fatal */ }
        KCKeywordHealthService.generateAndStoreEmbedding(id).catch(() => {});
      });
    }

    // Pre-generate instant audio for Fixed Response Mode — four trigger cases:
    //   Case A — container.useFixedResponse just turned ON
    //   Case B — container.useFixedResponse already ON, sections content changed
    //   Case C — sections updated and any section now has useFixedResponse:true
    //            (catches: per-section fixed just enabled, OR content changed on a fixed section)
    const fixedJustEnabled    = updates.useFixedResponse === true;
    const fixedAlreadyOnEdit  = updates.useFixedResponse !== false
      && updates.sections !== undefined
      && container.useFixedResponse === true;
    const sectionFixedTouched = updates.sections !== undefined
      && (container.sections || []).some(s => s.useFixedResponse);

    if (fixedJustEnabled || fixedAlreadyOnEdit || sectionFixedTouched) {
      _preGenAudioFixed(companyId, container, fixedJustEnabled ? 'enabled' : 'sections_updated');
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
    const container = await CompanyKnowledgeContainer.findOneAndUpdate(
      _resolveContainerQuery(id, companyId),
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    BridgeService.invalidate(companyId).catch(() => {});
    CueExtractorService.invalidateTradeIndex(companyId).catch(() => {});

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
    const result = await CompanyKnowledgeContainer.deleteOne(_resolveContainerQuery(id, companyId));
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    BridgeService.invalidate(companyId).catch(() => {});
    CueExtractorService.invalidateTradeIndex(companyId).catch(() => {});

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
      .select('_id title category sections.label sections.contentKeywords sections.callerPhrases.text sections.negativeKeywords kcId priority isActive')
      .sort({ priority: 1, createdAt: 1 })
      .lean();

    if (!containers.length) {
      return res.status(400).json({ success: false, error: 'No containers found for this company' });
    }

    // Compact summary for Groq — titles, categories, section callerPhrases + contentKeywords
    const summary = containers.map((c, i) => {
      const sections = c.sections || [];
      // Collect unique keywords from all sections' contentKeywords + callerPhrase text
      const allKw = new Set();
      for (const s of sections) {
        for (const kw of (s.contentKeywords || [])) allKw.add(kw);
        for (const cp of (s.callerPhrases || [])) if (cp.text) allKw.add(cp.text.toLowerCase().slice(0, 40));
      }
      const kwArr    = [...allKw];
      const kwSample = kwArr.slice(0, 6).join(', ');
      const kwExtra  = kwArr.length > 6 ? ` +${kwArr.length - 6} more` : '';
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
// INSTANT AUDIO PRE-GENERATION — Fixed Response Mode (container + per-section)
// ─────────────────────────────────────────────────────────────────────────────
// Called fire-and-forget when a container is saved with any fixed response
// mode active — either container.useFixedResponse:true (reads Section 1) or
// any section.useFixedResponse:true (reads that section's content verbatim).
//
// Collects all unique texts that need pre-caching, then fires one
// InstantAudioService.generate() call per unique text in a single async IIFE.
// Hash-based filenames mean re-generating the same text is a no-op on disk.
//
// PATTERN: async IIFE, non-blocking,
// all failures logged as warn (never surfaced to caller).
//
// GUARDS per text:
//   - Skips if content exceeds 420 chars (InstantAudioService limit)
//   - Skips if no voice configured for the company
// ─────────────────────────────────────────────────────────────────────────────
function _preGenAudioFixed(companyId, container, reason) {
  const sections = container?.sections || [];
  const sorted   = [...sections].sort((a, b) => (a.order || 0) - (b.order || 0));

  // ── Collect unique texts to pre-generate ──────────────────────────────────
  // textsToGen is a Set — deduplication prevents double-generating the same MP3.
  const textsToGen = new Set();

  // 1. Container-level useFixedResponse → pre-gen Section 1 content
  if (container.useFixedResponse) {
    const section1 = sorted.find(s => s.content?.trim());
    if (section1?.content?.trim()) textsToGen.add(section1.content.trim());
  }

  // 2. Per-section useFixedResponse → pre-gen each qualifying section's content
  sorted.forEach(s => {
    if (s.useFixedResponse && s.content?.trim()) {
      textsToGen.add(s.content.trim());
    }
  });

  if (!textsToGen.size) return;

  (async () => {
    try {
      const company = await v2Company.findById(companyId).lean();
      const vs      = company?.aiAgentSettings?.voiceSettings;

      // Guard: voice must be configured — skip silently if not
      if (!vs?.voiceId) return;

      // ── Resolve company-level variables ────────────────────────────────────
      // Must match what preview-fixed-audio does so the text-hash (and thus
      // filename) is identical. Without this, _preGenAudioFixed would create
      // duplicate MongoDB entries with raw {variable} text that nothing ever
      // references.
      const triggerSettings = await CompanyTriggerSettings.findOne({ companyId }).lean();
      const customVars = triggerSettings?.companyVariables instanceof Map
        ? Object.fromEntries(triggerSettings.companyVariables)
        : (triggerSettings?.companyVariables || {});

      for (const rawText of textsToGen) {
        // Resolve {companyName}, {serviceAreas}, {reg_diagnostic_fee}, etc.
        const text = replacePlaceholders(rawText, company, customVars);

        // Skip if unresolved runtime variables remain ({customerName}, etc.)
        if (text.match(/\{[^}]+\}/)) {
          logger.info('[companyKnowledge] Fixed response audio skipped — runtime variables present', {
            companyId, title: container.title, vars: text.match(/\{[^}]+\}/g), reason,
          });
          continue;
        }

        // Guard: InstantAudioService hard limit for non-TRIGGER kinds
        if (text.length > 420) {
          logger.info('[companyKnowledge] Fixed response audio skipped — content exceeds 420 chars', {
            companyId, title: container.title, chars: text.length, reason,
          });
          continue;
        }

        const genResult = await InstantAudioService.generate({
          companyId,
          kind:          'KC_RESPONSE',
          text,
          company,
          voiceSettings: vs,
        });

        // Persist to MongoDB for deploy-proof serving
        _persistKcAudioToMongo(companyId, genResult, text, vs.voiceId);

        logger.info('[companyKnowledge] Fixed response audio pre-generated', {
          companyId, title: container.title, chars: text.length, reason,
        });
      }
    } catch (err) {
      logger.warn('[companyKnowledge] Fixed response audio pre-generation failed (non-fatal)', {
        companyId, title: container.title, error: err.message, reason,
      });
    }
  })();
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/phrase-score
// Phrase quality scoring + Logic 2 core summary for the KC section editor.
//
// Body: { containerId, sectionIndex, phrases: string[] }
//
// Tier 1 — Confidence:  phrase core word coverage in section content ≥ 0.75
//                        What fraction of the phrase's core words (from PhraseReducerService)
//                        appear (exact or stemmed) in the section content? Admin diagnostic.
// Tier 2 — Clarity:     gap between T1 coverage and best competing section coverage ≥ 0.20.
// Tier 3 — Core Match:  Reduce phrase → embed core → compare vs stored phrases/content.
// TC     — Topic Corr:  cosine(phraseCore, contentCore) — phrase space vs content space.
//
// phraseCore — run summary of ALL phrases combined (Logic 2 runtime target).
//   Computed by reducing all phrase texts together via PhraseReducerService.
//   Embedded → phraseCoreEmbedding persisted to MongoDB (select:false, runtime gate).
//   Distinct from contentCore (derived from section content, not phrases).
//
// Returns: { scores: { [phrase]: { t1, t1Source, t2, t3, t3Score, tc, core, status } }, phraseCore, contentCore }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/phrase-score', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { containerId, sectionIndex, phrases } = req.body;
  if (!containerId || typeof sectionIndex !== 'number' || !Array.isArray(phrases) || !phrases.length) {
    return res.status(400).json({ success: false, error: 'containerId, sectionIndex, and phrases[] required' });
  }

  try {
    // ── Load target section (callerPhrases.text for fresh T1 embedding) ──
    const targetRaw = await CompanyKnowledgeContainer.collection.findOne(
      _resolveRawQuery(containerId, companyId),
      { projection: { 'sections.contentEmbedding': 1, 'sections.callerPhrases.text': 1, 'sections.isActive': 1, 'sections.label': 1, 'sections.content': 1 } }
    );
    if (!targetRaw) return res.status(404).json({ success: false, error: 'Container not found' });

    const targetSection = targetRaw.sections?.[sectionIndex];
    if (!targetSection) return res.status(400).json({ success: false, error: 'Section index out of range' });

    // Section content text for PhraseReducerService (protected phrases extraction)
    const sectionContentText = `${targetSection.label || ''}: ${targetSection.content || ''}`.trim();

    // Auto-generate content embedding if missing (used as T1/T3 fallback + T2)
    let targetEmb = targetSection.contentEmbedding;
    if (!targetEmb?.length) {
      if (!sectionContentText) {
        return res.status(400).json({ success: false, error: 'Section has no content — add content before scoring phrases' });
      }
      const [generated] = await SemanticMatchService.embedBatch([sectionContentText]);
      if (!generated?.length) {
        return res.status(500).json({ success: false, error: 'Failed to generate content embedding' });
      }
      targetEmb = generated;
      // Persist so future calls don't re-embed (fire-and-forget)
      CompanyKnowledgeContainer.collection.updateOne(
        _resolveRawQuery(containerId, companyId),
        { $set: { [`sections.${sectionIndex}.contentEmbedding`]: generated, [`sections.${sectionIndex}.contentEmbeddingAt`]: new Date() } }
      ).catch(e => logger.warn('[companyKnowledge] Failed to persist auto-generated contentEmbedding', { error: e.message }));
    }

    // ── Load all other sections for Tier 2 clarity gap ──────────────────
    // T2 checks word coverage in competing sections' content to measure
    // if the phrase fits better HERE or elsewhere. Also loads embeddings
    // as fallback for sections without content text.
    const allRaw = await CompanyKnowledgeContainer.collection.find(
      { companyId, isActive: { $ne: false } },
      { projection: { 'sections.contentEmbedding': 1, 'sections.content': 1, 'sections.label': 1, 'sections.isActive': 1, _id: 1 } }
    ).toArray();

    const otherEmbeddings = [];
    const otherContentTexts = [];
    const targetId = targetRaw._id.toString();
    for (const doc of allRaw) {
      const docId = doc._id.toString();
      (doc.sections || []).forEach((sec, idx) => {
        if (sec.isActive === false) return;
        if (docId === targetId && idx === sectionIndex) return;
        if (sec.contentEmbedding?.length) otherEmbeddings.push(sec.contentEmbedding);
        const txt = `${sec.label || ''} ${sec.content || ''}`.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        if (txt) otherContentTexts.push(txt);
      });
    }

    // ── Clean phrases ────────────────────────────────────────────────────
    const cleanPhrases = phrases.map(p => `${p}`.trim()).filter(Boolean);

    // ── Stored phrase texts for T1/T3 (fresh embed — never trust stored embeddings) ─
    // Re-embedding from text guarantees phrase-space accuracy regardless of when
    // or how stored embeddings were originally generated.
    const storedPhraseTxts = (targetSection.callerPhrases || [])
      .map(p => p.text)
      .filter(Boolean);

    // ── Reduce: individual phrase cores + content core + phraseCore ──────
    // phraseCore = run summary of ALL phrases combined → Logic 2 runtime target.
    // contentCore = reduced essence of section content → TC comparison target.
    const allPhrasesText = cleanPhrases.join(' ');
    const [reductions, contentReduction, phraseCoreReduction] = await Promise.all([
      PhraseReducerService.reduceBatch(cleanPhrases, sectionContentText),
      PhraseReducerService.reduce(sectionContentText, sectionContentText),
      PhraseReducerService.reduce(allPhrasesText, allPhrasesText),
    ]);
    const cores       = reductions.map(r => r.core);
    const contentCore = contentReduction?.core   || null;
    const phraseCore  = phraseCoreReduction?.core || null;

    // ── Embed everything in one shot ─────────────────────────────────────
    const coreTexts  = [];
    const coreIdxMap = [];                       // maps coreTexts[j] → original index i
    cores.forEach((c, i) => { if (c) { coreTexts.push(c); coreIdxMap.push(i); } });

    const [rawEmbeddings, coreEmbeddingsRaw, storedPhraseEmbs, contentCoreEmbArr, phraseCoreEmbArr] = await Promise.all([
      SemanticMatchService.embedBatch(cleanPhrases),
      coreTexts.length        ? SemanticMatchService.embedBatch(coreTexts)        : Promise.resolve([]),
      storedPhraseTxts.length ? SemanticMatchService.embedBatch(storedPhraseTxts) : Promise.resolve([]),
      contentCore             ? SemanticMatchService.embedBatch([contentCore])     : Promise.resolve([]),
      phraseCore              ? SemanticMatchService.embedBatch([phraseCore])      : Promise.resolve([]),
    ]);
    const contentCoreEmb = contentCoreEmbArr[0] || null;
    const phraseCoreEmb  = phraseCoreEmbArr[0]  || null;

    // Spread core embeddings back to original indices
    const coreEmbeddings = new Array(cores.length).fill(null);
    coreIdxMap.forEach((origIdx, j) => { coreEmbeddings[origIdx] = coreEmbeddingsRaw[j]; });

    // ── Score each phrase ─────────────────────────────────────────────────
    const scores = {};
    for (let i = 0; i < cleanPhrases.length; i++) {
      const phrase    = cleanPhrases[i];
      const emb       = rawEmbeddings[i];
      const coreEmb   = coreEmbeddings[i];
      const reduction = reductions[i];

      if (!emb?.length) {
        scores[phrase] = { t1: 0, t2: 0, t3: false, t3Score: 0, tc: null, core: reduction.core, status: 'red' };
        continue;
      }

      // T1 — Confidence: phrase core word coverage in section content.
      // Admin-facing metric — "are my phrase's key words actually in the content?"
      // Not used at runtime (UAP + anchor gate handle that). Pure diagnostic.
      //
      // Takes the phrase's core words (already stop-word-stripped by PhraseReducerService),
      // checks what fraction appear (exact or stemmed) in the section content text.
      // Simple, intuitive, no embedding asymmetry — the admin can see exactly
      // which words match and which don't.
      let t1Score   = 0;
      let t1Source  = 'words';
      if (reduction.core) {
        const coreWords = reduction.core.toLowerCase().split(/\s+/).filter(Boolean);
        const contentLower = sectionContentText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        const contentWords = new Set(contentLower.split(/\s+/).filter(Boolean));
        // Also build stemmed set for inflection matching (weekend/weekends, holiday/holidays)
        const _t1Stem = w => w.replace(/ings?$/, '').replace(/ing$/, '').replace(/ations?$/, '')
          .replace(/ers?$/, '').replace(/ed$/, '').replace(/ly$/, '')
          .replace(/ies$/, 'y').replace(/ves$/, 'f').replace(/s$/, '');
        const contentStems = new Set([...contentWords].map(_t1Stem));
        let hits = 0;
        for (const w of coreWords) {
          if (contentWords.has(w) || contentStems.has(_t1Stem(w))) hits++;
        }
        t1Score = coreWords.length ? hits / coreWords.length : 0;
      } else {
        // Fallback: raw embedding vs contentEmbedding (core not available)
        t1Score = _cosineSimilarity(emb, targetEmb);
        t1Source = 'embedding';
      }
      const t1Pass = t1Score >= 0.75;

      // T2 — Clarity: gap between word coverage in THIS section vs best competing section.
      // Same word-based approach as T1 — checks core word coverage in each competing
      // section's content. Gap = T1 (here) - best competing coverage.
      // High gap = phrase clearly belongs here. Low/negative = phrase fits elsewhere too.
      let bestCompeting = 0;
      if (reduction.core) {
        const coreWordsT2 = reduction.core.toLowerCase().split(/\s+/).filter(Boolean);
        const _t2Stem = w => w.replace(/ings?$/, '').replace(/ing$/, '').replace(/ations?$/, '')
          .replace(/ers?$/, '').replace(/ed$/, '').replace(/ly$/, '')
          .replace(/ies$/, 'y').replace(/ves$/, 'f').replace(/s$/, '');
        for (const otherText of otherContentTexts) {
          const oWords = new Set(otherText.split(/\s+/).filter(Boolean));
          const oStems = new Set([...oWords].map(_t2Stem));
          let oHits = 0;
          for (const w of coreWordsT2) {
            if (oWords.has(w) || oStems.has(_t2Stem(w))) oHits++;
          }
          const oCoverage = coreWordsT2.length ? oHits / coreWordsT2.length : 0;
          if (oCoverage > bestCompeting) bestCompeting = oCoverage;
        }
      }
      const t2Gap  = t1Score - bestCompeting;
      const t2Pass = t2Gap >= 0.20;

      // T3 — Core Match: reduced phrase core vs stored callerPhrase embeddings (or content)
      // No self-match issue here — core text differs from full phrase text, so
      // cosine is naturally < 1.00 and gives real signal.
      let t3Score = 0;
      let t3Pass  = null;
      if (coreEmb?.length && reduction.core) {
        if (storedPhraseEmbs.length) {
          for (const pEmb of storedPhraseEmbs) {
            const sim = _cosineSimilarity(coreEmb, pEmb);
            if (sim > t3Score) t3Score = sim;
          }
        } else {
          t3Score = _cosineSimilarity(coreEmb, targetEmb);
        }
        t3Pass = t3Score >= 0.70;
      }

      // TC — Topic Correlation: phrase core vs content core (both reduced to topic signals)
      let tcScore = null;
      if (coreEmb?.length && contentCoreEmb?.length && reduction.core) {
        tcScore = Math.round(_cosineSimilarity(coreEmb, contentCoreEmb) * 100) / 100;
      }

      // Determine status
      let status;
      if (!t1Pass) {
        status = 'red';
      } else if (!t2Pass) {
        status = 'orange';
      } else if (t3Pass === false) {
        status = 'yellow';
      } else {
        status = 'green';
      }

      scores[phrase] = {
        t1:                 Math.round(t1Score * 100) / 100,
        t1Source,
        t2:                 Math.round(t2Gap   * 100) / 100,
        t3:                 t3Pass,
        t3Score:            Math.round(t3Score * 100) / 100,
        tc:                 tcScore,
        core:               reduction.core,
        protectedEntities:  reduction.protectedEntities,
        normalizedPatterns: reduction.normalizedPatterns,
        status,
      };
    }

    // ── Persist scores + cores + phraseCoreEmbedding (fire-and-forget) ──
    (async () => {
      try {
        const phraseIdxMap = {};
        (targetSection.callerPhrases || []).forEach((p, i) => { phraseIdxMap[p.text] = i; });
        const setOps = {};
        for (const [phraseText, scoreData] of Object.entries(scores)) {
          const idx = phraseIdxMap[phraseText];
          if (idx !== undefined) {
            setOps[`sections.${sectionIndex}.callerPhrases.${idx}.score`] = { ...scoreData, scoredAt: new Date() };
          }
        }
        if (contentCore) {
          setOps[`sections.${sectionIndex}.contentCore`]         = contentCore;
          setOps[`sections.${sectionIndex}.contentCoreScoredAt`] = new Date();
        }
        if (phraseCore) {
          setOps[`sections.${sectionIndex}.phraseCore`]          = phraseCore;
          setOps[`sections.${sectionIndex}.phraseCoreScoredAt`]  = new Date();
        }
        if (phraseCoreEmb?.length) {
          setOps[`sections.${sectionIndex}.phraseCoreEmbedding`] = phraseCoreEmb;
        }
        if (Object.keys(setOps).length) {
          await CompanyKnowledgeContainer.collection.updateOne(
            _resolveRawQuery(containerId, companyId),
            { $set: setOps }
          );
        }
      } catch (e) {
        logger.warn('[companyKnowledge] Failed to persist phrase scores', { error: e.message });
      }
    })();

    // ── Core Alignment: what % of contentCore words are covered by phraseCore?
    // Direction: content → phrases. High score = callers' phrases cover the
    // answer topics well. Low score = answer has words no phrase mentions.
    // Shared stop words — single source of truth (utils/stopWords.js)
    const CA_STOP = require('../../utils/stopWords').getStopWords();
    let coreAlignment = null;
    if (phraseCore && contentCore) {
      const _caStem = w => w.replace(/ings?$/, '').replace(/ing$/, '').replace(/ations?$/, '')
        .replace(/ers?$/, '').replace(/ed$/, '').replace(/ly$/, '')
        .replace(/ies$/, 'y').replace(/ves$/, 'f').replace(/s$/, '');

      // Content words = denominator (what we're checking coverage OF)
      const ccWords = [...new Set(
        contentCore.toLowerCase().split(/\s+/)
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => w && !CA_STOP.has(w))
      )];

      // Phrase words = the pool we check against (callers' vocabulary)
      const pcText  = phraseCore.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
      const pcSet   = new Set(pcText.split(/\s+/).filter(Boolean));
      const pcStems = new Set([...pcSet].map(_caStem));

      let caHits = 0;
      for (const w of ccWords) {
        if (pcSet.has(w) || pcStems.has(_caStem(w))) caHits++;
      }
      coreAlignment = ccWords.length ? Math.round((caHits / ccWords.length) * 100) : null;
    }

    return res.json({ success: true, scores, phraseCore, contentCore, coreAlignment });
  } catch (err) {
    logger.error('[companyKnowledge] phrase-score error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Phrase scoring failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/cross-scan
// Compare phrases against ALL sections across ALL KCs in the company.
// Two modes:
//   With sourceContainerId/sourceSectionIndex → flags current section (Feature A)
//   Without source → pure discovery mode (Feature B / Phrase Finder)
//
// Returns top 3 content matches per phrase + duplicate phrase detection.
// Body: { phrases[], sourceContainerId?, sourceSectionIndex? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/cross-scan', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { phrases, sourceContainerId, sourceSectionIndex } = req.body;
  if (!Array.isArray(phrases) || !phrases.length) {
    return res.status(400).json({ success: false, error: 'phrases[] required' });
  }

  try {
    const cleanPhrases = phrases.map(p => `${p}`.trim()).filter(Boolean);

    // ── Load ALL containers with embeddings + caller phrases ────────────
    const allDocs = await CompanyKnowledgeContainer.collection.find(
      { companyId, isActive: { $ne: false } },
      { projection: {
        title: 1,
        'sections.label': 1,
        'sections.contentEmbedding': 1,
        'sections.isActive': 1,
        'sections.callerPhrases': 1,
      } }
    ).toArray();

    // ── Build section index: every scorable section with its embedding ──
    const sectionIndex = [];
    for (const doc of allDocs) {
      const docId = doc._id.toString();
      (doc.sections || []).forEach((sec, idx) => {
        if (!sec.contentEmbedding?.length) return;
        sectionIndex.push({
          containerId:    docId,
          containerName:  doc.title || 'Untitled',
          sectionIndex:   idx,
          sectionLabel:   sec.label || `Section ${idx + 1}`,
          contentEmb:     sec.contentEmbedding,
          callerPhrases:  (sec.callerPhrases || []).map(p => typeof p === 'string' ? p : p.text || '').filter(Boolean),
          isActive:       sec.isActive !== false,
          isCurrentSection: sourceContainerId
            ? (docId === sourceContainerId && idx === sourceSectionIndex)
            : false,
        });
      });
    }

    // ── Embed input phrases ─────────────────────────────────────────────
    const phraseEmbeddings = await SemanticMatchService.embedBatch(cleanPhrases);

    // ── Pre-embed all caller phrases for duplicate detection ────────────
    // Collect unique caller phrases across all sections
    const allCallerPhrases = [];
    const callerPhraseMap  = [];     // { sectionIdx in sectionIndex, phraseText }
    for (let sIdx = 0; sIdx < sectionIndex.length; sIdx++) {
      for (const cp of sectionIndex[sIdx].callerPhrases) {
        allCallerPhrases.push(cp);
        callerPhraseMap.push({ sIdx, text: cp });
      }
    }
    const callerPhraseEmbeddings = allCallerPhrases.length
      ? await SemanticMatchService.embedBatch(allCallerPhrases)
      : [];

    // ── Score each input phrase ─────────────────────────────────────────
    const results = [];
    for (let i = 0; i < cleanPhrases.length; i++) {
      const phrase = cleanPhrases[i];
      const emb    = phraseEmbeddings[i];

      if (!emb?.length) {
        results.push({ phrase, matches: [], duplicates: [] });
        continue;
      }

      // Score vs every section's content embedding
      const contentScores = sectionIndex.map((sec, sIdx) => ({
        sIdx,
        containerId:      sec.containerId,
        containerName:    sec.containerName,
        sectionIndex:     sec.sectionIndex,
        sectionLabel:     sec.sectionLabel,
        contentScore:     _cosineSimilarity(emb, sec.contentEmb),
        isCurrentSection: sec.isCurrentSection,
        isActive:         sec.isActive,
      }));

      // Sort by score descending, take top 5
      contentScores.sort((a, b) => b.contentScore - a.contentScore);
      const topMatches = contentScores.slice(0, 5).map(m => ({
        containerId:      m.containerId,
        containerName:    m.containerName,
        sectionIndex:     m.sectionIndex,
        sectionLabel:     m.sectionLabel,
        contentScore:     Math.round(m.contentScore * 1000) / 1000,
        isCurrentSection: m.isCurrentSection,
        isActive:         m.isActive,
      }));

      // Check for duplicate caller phrases (cosine ≥ 0.92)
      const duplicates = [];
      for (let cpIdx = 0; cpIdx < callerPhraseEmbeddings.length; cpIdx++) {
        const cpEmb = callerPhraseEmbeddings[cpIdx];
        if (!cpEmb?.length) continue;
        const sim = _cosineSimilarity(emb, cpEmb);
        if (sim >= 0.92) {
          const { sIdx, text } = callerPhraseMap[cpIdx];
          const sec = sectionIndex[sIdx];
          // Don't flag duplicates in the source section itself
          if (sec.isCurrentSection) continue;
          duplicates.push({
            phrase:         text,
            similarity:     Math.round(sim * 1000) / 1000,
            containerId:    sec.containerId,
            containerName:  sec.containerName,
            sectionIndex:   sec.sectionIndex,
            sectionLabel:   sec.sectionLabel,
          });
        }
      }

      // Deduplicate — keep highest similarity per section
      const dedupMap = new Map();
      for (const d of duplicates) {
        const key = `${d.containerId}:${d.sectionIndex}`;
        const existing = dedupMap.get(key);
        if (!existing || d.similarity > existing.similarity) dedupMap.set(key, d);
      }

      results.push({
        phrase,
        matches:    topMatches,
        duplicates: [...dedupMap.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 5),
      });
    }

    return res.json({ success: true, results });
  } catch (err) {
    logger.error('[companyKnowledge] cross-scan error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Cross-scan failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/suggest-negatives
// LLM-powered exclusion keyword suggestions. Analyzes sibling sections in
// the same KC to find words that belong elsewhere and could cause misroutes.
//
// Body: { containerId, sectionIndex }
// Returns: { suggestions: [{ word, reason, fromSection }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/suggest-negatives', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { containerId, sectionIndex } = req.body;
  if (!containerId || sectionIndex == null) {
    return res.status(400).json({ success: false, error: 'containerId and sectionIndex required' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: 'GROQ_API_KEY not configured' });

  try {
    // ── Load the KC document ────────────────────────────────────────────
    const doc = await CompanyKnowledgeContainer.findById(containerId).lean();
    if (!doc) return res.status(404).json({ success: false, error: 'Container not found' });

    const sections = doc.sections || [];
    const idx = parseInt(sectionIndex, 10);
    if (idx < 0 || idx >= sections.length) {
      return res.status(400).json({ success: false, error: 'Invalid sectionIndex' });
    }

    const target = sections[idx];
    const existingNegs = (target.negativeKeywords || []).map(w => w.toLowerCase().trim());

    // ── Build sibling context ───────────────────────────────────────────
    const siblings = sections
      .map((s, i) => ({ ...s, _idx: i }))
      .filter((s, i) => i !== idx && s.isActive !== false);

    if (!siblings.length) {
      return res.json({ success: true, suggestions: [], note: 'No sibling sections to compare' });
    }

    const _fmtSection = (s) => {
      const phrases = (s.callerPhrases || []).map(p => typeof p === 'string' ? p : p.text).join(', ');
      const terms   = (s.tradeTerms || []).join(', ');
      return `[${s.label || 'Untitled'}] Content: ${(s.content || '').substring(0, 300)}${phrases ? ` | Phrases: ${phrases}` : ''}${terms ? ` | Trade terms: ${terms}` : ''}`;
    };

    const targetPhrases = (target.callerPhrases || []).map(p => typeof p === 'string' ? p : p.text).join(', ');
    const targetTerms   = (target.tradeTerms || []).join(', ');

    const systemPrompt = `You are a routing disambiguation expert for an AI phone receptionist system.

A Knowledge Container has multiple sections. Each section answers a different topic. When a caller speaks, the system routes their question to the best-matching section using keyword scoring.

PROBLEM: Sometimes a caller's words match the WRONG section because sections share vocabulary.
SOLUTION: Exclusion keywords — if a word appears in a section's exclusion list, that section is skipped.

Your job: Given a TARGET section and its SIBLING sections, identify words or short phrases (1-3 words) that:
1. Strongly belong to a SIBLING section's topic
2. Could accidentally match the TARGET section
3. Would help the routing engine skip the TARGET when those words appear

Rules:
- Return 3-8 suggestions maximum
- Each suggestion must be a single word or short phrase (1-3 words, lowercase)
- Only suggest words that genuinely appear in sibling section topics
- Don't suggest words that are core to the TARGET section itself
- Focus on the most impactful disambiguation words

Return ONLY a JSON object:
{
  "suggestions": [
    { "word": "duct cleaning", "reason": "Belongs to the Duct Cleaning section", "fromSection": "Duct Cleaning Service" },
    { "word": "emergency", "reason": "Routes to Emergency AC Service instead", "fromSection": "Emergency AC Service" }
  ]
}`;

    const userPrompt = `TARGET SECTION (#${idx}):
Label: ${target.label || 'Untitled'}
Content: ${(target.content || '').substring(0, 400)}
${targetPhrases ? `Caller phrases: ${targetPhrases}` : ''}
${targetTerms ? `Trade terms: ${targetTerms}` : ''}
${existingNegs.length ? `Already excluded: ${existingNegs.join(', ')}` : ''}

SIBLING SECTIONS:
${siblings.map(s => _fmtSection(s)).join('\n')}`;

    // ── Call Groq ───────────────────────────────────────────────────────
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   400,
      temperature: 0.3,
      jsonMode:    true,
      system:      systemPrompt,
      messages:    [{ role: 'user', content: userPrompt }],
    });

    if (!result.response) throw new Error('No response from LLM');

    let parsed;
    try {
      parsed = JSON.parse(result.response);
    } catch (_) {
      const match = result.response.match(/\{[\s\S]*?\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    const rawSuggestions = parsed?.suggestions || [];

    // ── Filter out already-existing negatives ───────────────────────────
    const suggestions = rawSuggestions
      .filter(s => s?.word && !existingNegs.includes(s.word.toLowerCase().trim()))
      .map(s => ({
        word:        s.word.toLowerCase().trim(),
        reason:      s.reason || '',
        fromSection: s.fromSection || '',
      }));

    logger.info('[companyKnowledge] suggest-negatives', {
      companyId, containerId, sectionIndex: idx,
      sectionLabel: target.label, count: suggestions.length,
    });

    return res.json({ success: true, suggestions });
  } catch (err) {
    logger.error('[companyKnowledge] suggest-negatives error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to generate suggestions' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/draft-section
// Generate a section label + starter content for a caller phrase that has
// no good home in existing KCs. Uses Groq (Llama 3.3 70B).
//
// Body: { phrase }
// Returns: { label, content }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/draft-section', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const phrase = `${req.body.phrase || ''}`.trim();
  if (!phrase) return res.status(400).json({ success: false, error: 'phrase required' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: 'GROQ_API_KEY not configured' });

  try {
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   250,
      temperature: 0.5,
      jsonMode:    true,
      system: `You are a knowledge base architect for an AI phone receptionist at a service company.

A caller asked a question that no existing knowledge section covers. Generate a new section to answer it.

Return ONLY a JSON object with exactly these two fields:
{
  "label": "Short topic label (2-5 words, title case)",
  "content": "The answer a phone receptionist would read to the caller. Natural, conversational, informative. Maximum 180 characters."
}

The label should categorize the topic (e.g. "Tune-Up Frequency", "Emergency Service Hours", "Warranty Coverage").
The content should directly answer the caller's question in a helpful, professional tone.`,
      messages: [{ role: 'user', content: `Caller asked: "${phrase}"` }],
    });

    if (!result.response) throw new Error('No response from LLM');

    let parsed;
    try {
      parsed = JSON.parse(result.response);
    } catch (_) {
      const match = result.response.match(/\{[\s\S]*?\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    if (!parsed?.label || !parsed?.content) {
      throw new Error('Invalid response format');
    }

    return res.json({
      success: true,
      label:   parsed.label.trim().slice(0, 80),
      content: parsed.content.trim().slice(0, 300),
    });
  } catch (err) {
    logger.error('[companyKnowledge] draft-section error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Draft generation failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/phrase-suggestions
// Return missed utterances from production calls that semantically match
// this section — sourced from Customer.discoveryNotes[].qaLog[] where
// type is KC_LLM_FALLBACK or KC_GRACEFUL_ACK (missed by KC, fell to LLM/ack).
//
// Body: { containerId, sectionIndex }
// Returns: { suggestions: [{ text, type, similarity, seenAt }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/phrase-suggestions', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { containerId, sectionIndex } = req.body;
  if (!containerId || typeof sectionIndex !== 'number') {
    return res.status(400).json({ success: false, error: 'containerId and sectionIndex required' });
  }

  try {
    // ── Load target section embedding ─────────────────────────────────────
    const targetRaw = await CompanyKnowledgeContainer.collection.findOne(
      _resolveRawQuery(containerId, companyId),
      { projection: { 'sections.contentEmbedding': 1 } }
    );
    if (!targetRaw) return res.status(404).json({ success: false, error: 'Container not found' });

    const targetEmb = targetRaw.sections?.[sectionIndex]?.contentEmbedding;
    if (!targetEmb?.length) {
      return res.json({ success: true, suggestions: [], note: 'No content embedding — save section first' });
    }

    // ── Aggregate missed utterances from qaLog ────────────────────────────
    // Collect questions from KC_LLM_FALLBACK and KC_GRACEFUL_ACK entries
    const pipeline = [
      { $match: { companyId } },
      { $unwind: { path: '$discoveryNotes', preserveNullAndEmptyArrays: false } },
      { $unwind: { path: '$discoveryNotes.qaLog', preserveNullAndEmptyArrays: false } },
      {
        $match: {
          'discoveryNotes.qaLog.type': { $in: ['KC_LLM_FALLBACK', 'KC_GRACEFUL_ACK'] },
          'discoveryNotes.qaLog.question': { $exists: true, $ne: '' },
        },
      },
      {
        $group: {
          _id:     { $toLower: '$discoveryNotes.qaLog.question' },
          type:    { $first: '$discoveryNotes.qaLog.type' },
          seenAt:  { $max:   '$discoveryNotes.capturedAt' },
          count:   { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 100 },
    ];

    const missedRaw = await Customer.aggregate(pipeline);
    if (!missedRaw.length) return res.json({ success: true, suggestions: [] });

    // ── Embed the missed questions ────────────────────────────────────────
    const texts      = missedRaw.map(r => r._id);
    const embeddings = await SemanticMatchService.embedBatch(texts);

    // ── Score against target section + filter by relevance ───────────────
    const scored = [];
    for (let i = 0; i < texts.length; i++) {
      const emb = embeddings[i];
      if (!emb?.length) continue;
      const sim = _cosineSimilarity(emb, targetEmb);
      if (sim >= 0.65) {  // Lower threshold for suggestions — 0.65 = relevant but not yet optimized
        scored.push({
          text:       texts[i],
          type:       missedRaw[i].type,
          count:      missedRaw[i].count,
          similarity: Math.round(sim * 100) / 100,
          seenAt:     missedRaw[i].seenAt,
        });
      }
    }

    // Sort by similarity desc, return top 15
    scored.sort((a, b) => b.similarity - a.similarity);
    return res.json({ success: true, suggestions: scored.slice(0, 15) });
  } catch (err) {
    logger.error('[companyKnowledge] phrase-suggestions error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Phrase suggestions failed' });
  }
});

module.exports = router;
