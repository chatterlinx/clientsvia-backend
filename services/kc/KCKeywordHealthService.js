'use strict';

/**
 * ============================================================================
 * KC KEYWORD HEALTH SERVICE
 * ============================================================================
 *
 * Enterprise-grade semantic conflict detection for Knowledge Containers.
 *
 * WHAT IT DOES:
 *   1. Embeds each KC container (title + sections) using OpenAI
 *      text-embedding-3-small at 512 dimensions at save time.
 *   2. At analysis time, runs pairwise cosine similarity across all active
 *      containers for a company PLUS keyword set-intersection (hybrid approach).
 *   3. Classifies each conflicting pair by severity: HIGH / WARN / INFO.
 *   4. Runs a Groq LLM validator on HIGH + WARN pairs to determine conflict
 *      type (COMPLEMENTARY / OUTDATED / CONFLICTING / MISINFORMATION /
 *      NO_CONFLICT) and generates a plain-English recommendation.
 *   5. Returns a full structured report for the admin health dashboard.
 *
 * REUSED INFRASTRUCTURE (no new deps):
 *   - getEmbedding() + cosineSimilarity() from scenarioEngine/embeddingService
 *   - OpenAI client: config/openai.js (OPENAI_API_KEY env var)
 *   - Groq: GroqStreamAdapter (GROQ_API_KEY env var)
 *
 * THRESHOLDS:
 *   - Semantic similarity ≥ 0.80 → flagged as potential conflict
 *   - Same priority number on conflicting cards → severity escalated to HIGH
 *
 * MULTI-TENANT SAFETY:
 *   All queries scoped to companyId — no cross-tenant data ever returned.
 *
 * ============================================================================
 */

const logger                     = require('../../utils/logger');
const CompanyKnowledgeContainer  = require('../../models/CompanyKnowledgeContainer');
const GroqStreamAdapter          = require('../streaming/adapters/GroqStreamAdapter');
const { getEmbedding, cosineSimilarity } = require('../scenarioEngine/embeddingService');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.80;   // Flag pairs at or above this cosine score
const LLM_VALIDATE_CAP     = 8;      // Max pairs to run through Groq per health check
const TAG = '[KCKeywordHealth]';

// ─────────────────────────────────────────────────────────────────────────────
// EMBEDDING TEXT BUILDER
// title + section content joined, capped for the 512-dim model
// ─────────────────────────────────────────────────────────────────────────────

function _buildEmbeddingText(container) {
  const sectionText = (container.sections || [])
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(s => `${s.label ? s.label + ': ' : ''}${s.content || ''}`.trim())
    .filter(Boolean)
    .join('\n');
  return `${container.title || ''}\n${sectionText}`.substring(0, 3000).trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// SEVERITY CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────

function _classifySeverity({ semanticSimilarity, sharedKeywords, samePriority }) {
  const semantic  = semanticSimilarity >= SIMILARITY_THRESHOLD;
  const hasKw     = sharedKeywords.length > 0;

  if (semantic && hasKw && samePriority)  return 'HIGH';
  if (semantic && hasKw)                  return 'WARN';
  if (semantic && samePriority)           return 'WARN';
  if (semantic)                           return 'INFO';
  if (hasKw    && samePriority)           return 'WARN';
  if (hasKw)                              return 'INFO';
  return null;  // no conflict
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM VALIDATOR
// Runs one Groq call per conflicting pair (HIGH/WARN only) to classify
// the conflict type using Google's DRAGged 2025 taxonomy.
// Returns { type, explanation, recommendation } or null on failure.
// ─────────────────────────────────────────────────────────────────────────────

async function _llmValidatePair(containerA, containerB) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const summarise = c => {
    const sections = (c.sections || [])
      .slice(0, 3)
      .map(s => `  • ${s.label || 'Section'}: ${(s.content || '').substring(0, 200)}`)
      .join('\n');
    return `Title: "${c.title}"\nKeywords: ${(c.keywords || []).slice(0, 8).join(', ')}\nContent:\n${sections}`;
  };

  const prompt = `You are a knowledge-base quality auditor for a home-service phone AI.

CONTAINER A:
${summarise(containerA)}

CONTAINER B:
${summarise(containerB)}

Classify the relationship between these two knowledge containers.
Choose EXACTLY ONE type:

COMPLEMENTARY   — Both are correct and cover different aspects of the same topic.
                  Caller will benefit from both but they don't contradict.
OUTDATED        — One entry appears to supersede the other (newer pricing, updated policy, etc.).
CONFLICTING     — They give genuinely contradictory answers to the same caller question.
MISINFORMATION  — One entry appears to contain incorrect or misleading information.
NO_CONFLICT     — They are about different topics despite surface-level keyword overlap.

Return ONLY valid JSON — no markdown:
{"type":"<TYPE>","explanation":"<1 sentence>","recommendation":"<1 actionable sentence for the admin>"}`;

  try {
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   200,
      temperature: 0.1,
      system:      'You are a knowledge-base conflict classifier. Return only valid JSON.',
      messages:    [{ role: 'user', content: prompt }],
      jsonMode:    false,
    });

    const raw = (result.response || '').trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/,           '');

    const parsed = JSON.parse(raw);
    if (!parsed.type) throw new Error('missing type');
    return parsed;
  } catch (err) {
    logger.warn(`${TAG} LLM validator failed for pair`, {
      a: containerA.title, b: containerB.title, err: err.message
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: generateAndStoreEmbedding
// Called fire-and-forget after every POST/PATCH that changes title or sections.
// ─────────────────────────────────────────────────────────────────────────────

async function generateAndStoreEmbedding(containerId) {
  try {
    // Load with sections (normally not selected by lean queries)
    const container = await CompanyKnowledgeContainer
      .findById(containerId)
      .select('title sections')
      .lean();

    if (!container) {
      logger.warn(`${TAG} generateAndStoreEmbedding: container not found`, { containerId });
      return;
    }

    const text      = _buildEmbeddingText(container);
    const embedding = await getEmbedding(text);

    await CompanyKnowledgeContainer.findByIdAndUpdate(containerId, {
      $set: { embeddingVector: embedding, embeddingUpdatedAt: new Date() }
    });

    logger.debug(`${TAG} Embedding stored`, { containerId, dims: embedding.length });
  } catch (err) {
    // Graceful degrade — embedding failure never blocks the save response
    logger.warn(`${TAG} generateAndStoreEmbedding failed`, { containerId, err: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: batchGenerateEmbeddings
// Backfills all active containers for a company that are missing embeddings.
// Called inline when admin opens the health dashboard for the first time.
// ─────────────────────────────────────────────────────────────────────────────

async function batchGenerateEmbeddings(companyId) {
  const containers = await CompanyKnowledgeContainer
    .find({ companyId, isActive: true })
    .select('title sections embeddingVector embeddingUpdatedAt updatedAt')
    .lean();

  const stale = containers.filter(c =>
    !c.embeddingVector?.length ||
    (c.updatedAt && c.embeddingUpdatedAt && c.embeddingUpdatedAt < c.updatedAt)
  );

  if (!stale.length) return { processed: 0, failed: 0 };

  logger.info(`${TAG} batchGenerateEmbeddings`, { companyId, staleCount: stale.length });

  let processed = 0;
  let failed    = 0;

  for (const c of stale) {
    try {
      const text      = _buildEmbeddingText(c);
      const embedding = await getEmbedding(text);
      await CompanyKnowledgeContainer.findByIdAndUpdate(c._id, {
        $set: { embeddingVector: embedding, embeddingUpdatedAt: new Date() }
      });
      processed++;
    } catch (err) {
      logger.warn(`${TAG} batch embed failed for container`, { id: c._id, err: err.message });
      failed++;
    }
  }

  return { processed, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: analyzeConflicts
// Full conflict detection pipeline for all active containers of a company.
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeConflicts(companyId) {
  // Load ALL active containers — include embeddingVector (select: false normally)
  const containers = await CompanyKnowledgeContainer
    .find({ companyId, isActive: true })
    .select('_id kcId title keywords priority sections embeddingVector embeddingUpdatedAt')
    .lean();

  if (containers.length < 2) {
    return _emptyReport(containers.length);
  }

  // ── Track missing embeddings (so caller can surface "rescan" prompt) ──────
  const missingEmbeddings = containers.filter(c => !c.embeddingVector?.length).length;

  // ── Pairwise conflict analysis ─────────────────────────────────────────────
  const conflicts  = [];
  const seenPairs  = new Set();

  for (let i = 0; i < containers.length; i++) {
    for (let j = i + 1; j < containers.length; j++) {
      const a = containers[i];
      const b = containers[j];

      const pairKey = [String(a._id), String(b._id)].sort().join(':');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      // ── Keyword intersection ──────────────────────────────────────────────
      const aKws         = new Set((a.keywords || []).map(k => k.toLowerCase().trim()));
      const bKws         = new Set((b.keywords || []).map(k => k.toLowerCase().trim()));
      const sharedKeywords = [...aKws].filter(k => bKws.has(k));

      // ── Semantic similarity ───────────────────────────────────────────────
      let semanticSimilarity = 0;
      if (a.embeddingVector?.length && b.embeddingVector?.length) {
        semanticSimilarity = cosineSimilarity(a.embeddingVector, b.embeddingVector);
        semanticSimilarity = Math.round(semanticSimilarity * 1000) / 1000;  // 3dp
      }

      const samePriority = (a.priority ?? 100) === (b.priority ?? 100);
      const severity     = _classifySeverity({ semanticSimilarity, sharedKeywords, samePriority });

      if (!severity) continue;  // no conflict detected

      conflicts.push({
        severity,
        samePriority,
        containerA:         { _id: String(a._id), kcId: a.kcId || null, title: a.title, priority: a.priority ?? 100 },
        containerB:         { _id: String(b._id), kcId: b.kcId || null, title: b.title, priority: b.priority ?? 100 },
        sharedKeywords,
        semanticSimilarity,
        isSemanticConflict: semanticSimilarity >= SIMILARITY_THRESHOLD,
        isKeywordConflict:  sharedKeywords.length > 0,
        // LLM fields filled in below
        conflictType:       null,
        conflictExplanation:null,
        recommendation:     null,
        _containerAData:    a,   // kept for LLM validator, stripped before response
        _containerBData:    b,
      });
    }
  }

  // Sort: HIGH first, then WARN, then INFO
  const ORDER = { HIGH: 0, WARN: 1, INFO: 2 };
  conflicts.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  // ── LLM validation for HIGH + WARN pairs (capped at LLM_VALIDATE_CAP) ─────
  const toValidate = conflicts
    .filter(c => c.severity === 'HIGH' || c.severity === 'WARN')
    .slice(0, LLM_VALIDATE_CAP);

  await Promise.all(toValidate.map(async (conflict) => {
    const result = await _llmValidatePair(
      conflict._containerAData,
      conflict._containerBData
    );
    if (result) {
      conflict.conflictType        = result.type        || null;
      conflict.conflictExplanation = result.explanation || null;
      conflict.recommendation      = result.recommendation || null;
    }
  }));

  // ── Strip internal _containerXData before returning ────────────────────────
  const cleanConflicts = conflicts.map(({ _containerAData, _containerBData, ...rest }) => rest);

  // ── Build conflict map: keyword → [containerIds] — for edit-page chip lookup
  const conflictMap = {};
  for (const c of cleanConflicts) {
    for (const kw of c.sharedKeywords) {
      if (!conflictMap[kw]) conflictMap[kw] = [];
      // Collect both container titles for the tooltip
      const existing = conflictMap[kw];
      if (!existing.find(x => x.id === c.containerA._id)) {
        existing.push({ id: c.containerA._id, title: c.containerA.title });
      }
      if (!existing.find(x => x.id === c.containerB._id)) {
        existing.push({ id: c.containerB._id, title: c.containerB.title });
      }
    }
  }

  // ── Per-container conflict count — for card badges ─────────────────────────
  const containerConflictCounts = {};
  for (const c of cleanConflicts) {
    containerConflictCounts[c.containerA._id] = (containerConflictCounts[c.containerA._id] || 0) + 1;
    containerConflictCounts[c.containerB._id] = (containerConflictCounts[c.containerB._id] || 0) + 1;
  }

  logger.info(`${TAG} analyzeConflicts complete`, {
    companyId,
    totalContainers: containers.length,
    totalConflicts:  cleanConflicts.length,
    high:            cleanConflicts.filter(c => c.severity === 'HIGH').length,
    warn:            cleanConflicts.filter(c => c.severity === 'WARN').length,
    info:            cleanConflicts.filter(c => c.severity === 'INFO').length,
  });

  return {
    totalContainers:        containers.length,
    totalConflicts:         cleanConflicts.length,
    highCount:              cleanConflicts.filter(c => c.severity === 'HIGH').length,
    warnCount:              cleanConflicts.filter(c => c.severity === 'WARN').length,
    infoCount:              cleanConflicts.filter(c => c.severity === 'INFO').length,
    missingEmbeddings,
    conflicts:              cleanConflicts,
    conflictMap,             // { keyword: [{id, title}] } — for edit-page chip lookup
    containerConflictCounts, // { containerId: N } — for card badges
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _emptyReport(totalContainers) {
  return {
    totalContainers,
    totalConflicts:          0,
    highCount:               0,
    warnCount:               0,
    infoCount:               0,
    missingEmbeddings:       0,
    conflicts:               [],
    conflictMap:             {},
    containerConflictCounts: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generateAndStoreEmbedding,
  batchGenerateEmbeddings,
  analyzeConflicts,
};
