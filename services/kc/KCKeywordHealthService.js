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
const GROQ_SUGGEST_CAP     = 4;      // Max containers to run Groq keyword suggestions per check
const TAG = '[KCKeywordHealth]';

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD QUALITY — GENERIC WORD BLOCKLIST
// Single-word keywords on this list are too broad to reliably identify a
// specific container. They match almost every caller utterance and cause
// the wrong container to fire. Any KC container with these as standalone
// keywords will score HIGH severity in the quality report.
// ─────────────────────────────────────────────────────────────────────────────
const GENERIC_SINGLE_WORDS = new Set([
  // Cost / money — appear in nearly every service call
  'fee', 'fees', 'cost', 'costs', 'price', 'prices', 'pricing',
  'rate', 'rates', 'charge', 'charges', 'payment', 'payments', 'bill',
  // Service actions — universal
  'service', 'services', 'repair', 'repairs', 'fix', 'fixing', 'help',
  'call', 'visit', 'come', 'send', 'check', 'inspect', 'inspection',
  'replace', 'replacement', 'upgrade', 'install', 'installation',
  // Scheduling / availability — booking intent collision risk
  'schedule', 'scheduled', 'scheduling', 'available', 'availability', 'book',
  // Financial modifiers — too ambiguous alone
  'credit', 'credits', 'included', 'includes', 'include', 'covered', 'coverage', 'cover',
  'waived', 'waive', 'applied',
  // Promotions — single word matches any promo question
  'special', 'specials', 'deal', 'deals', 'promo', 'promotion', 'promotions',
  'discount', 'discounts', 'offer', 'offers', 'coupon', 'coupons', 'sale',
  // Warranty / guarantee — too generic
  'warranty', 'warranties', 'guarantee', 'guarantees', 'guaranteed',
  // Policy — too broad
  'policy', 'policies', 'terms', 'contract', 'agreement',
  // Maintenance — extremely common in HVAC
  'maintenance', 'plan', 'plans', 'tune', 'tuneup', 'annual',
  // Generic info words
  'info', 'information', 'question', 'questions', 'details', 'about',
  // Common verbs that appear everywhere
  'need', 'want', 'get', 'have', 'use', 'work', 'time', 'unit', 'system',
]);

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
// KEYWORD QUALITY — PER-CONTAINER ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _analyzeContainerQuality — Scores a single container's keyword list.
 *
 * Issue types (returned in `issues` array):
 *   TOO_GENERIC   HIGH  — single word in GENERIC_SINGLE_WORDS blocklist
 *   TOO_SHORT     HIGH  — single word < 5 characters
 *   NO_MULTI_WORD HIGH  — container has zero multi-word phrases (all single words)
 *   DUPLICATE     WARN  — exact duplicate within the same container
 *   LOW_COVERAGE  WARN  — fewer than 4 keywords total
 *   REDUNDANT     INFO  — single word already covered by a longer phrase in same container
 *
 * Grade scale:  A(90-100) B(75-89) C(60-74) D(45-59) F(<45)
 */
function _analyzeContainerQuality(container, crossConflictSet) {
  const rawKeywords = (container.keywords || []).map(k => k.toLowerCase().trim()).filter(Boolean);
  const issues = [];
  const seen   = new Set();
  const multiWordKws  = rawKeywords.filter(k => k.includes(' '));
  const singleWordKws = rawKeywords.filter(k => !k.includes(' '));

  // ── Structural checks (whole-container) ────────────────────────────────────
  if (rawKeywords.length < 4) {
    issues.push({
      keyword:  null,
      type:     'LOW_COVERAGE',
      severity: 'WARN',
      message:  `Only ${rawKeywords.length} keyword${rawKeywords.length === 1 ? '' : 's'} — add more phrases to capture diverse caller phrasings (aim for 6-10 specific multi-word phrases).`,
    });
  }

  if (rawKeywords.length > 0 && multiWordKws.length === 0) {
    issues.push({
      keyword:  null,
      type:     'NO_MULTI_WORD',
      severity: 'HIGH',
      message:  'No multi-word phrases — all keywords are single words. Single-word keywords score low in findContainer() and will lose to any multi-word match in competing containers.',
    });
  }

  // ── Per-keyword checks ─────────────────────────────────────────────────────
  for (const kw of rawKeywords) {
    // Duplicate within same container
    if (seen.has(kw)) {
      issues.push({ keyword: kw, type: 'DUPLICATE', severity: 'WARN',
        message: `"${kw}" appears more than once in this container — remove the duplicate.` });
      continue;
    }
    seen.add(kw);

    // Cross-container conflict: same keyword appears in more than one container.
    // This is the #1 routing ambiguity cause — the KC engine scores both containers
    // and may pick the wrong one. Flag all duplicates across containers.
    if (crossConflictSet.has(kw)) {
      const isMultiWord = kw.includes(' ');
      issues.push({ keyword: kw, type: 'CROSS_CONTAINER', severity: 'HIGH',
        message: `"${kw}" exists in another container — this causes routing confusion and the wrong container may fire. Remove or rephrase this ${isMultiWord ? 'phrase' : 'keyword'} so it only lives in one container.` });
    }

    if (!kw.includes(' ')) {
      // Single-word checks
      if (kw.length < 5) {
        issues.push({ keyword: kw, type: 'TOO_SHORT', severity: 'HIGH',
          message: `"${kw}" is ${kw.length} characters — too short to be meaningful as a standalone keyword. Wrap it in a phrase e.g. "${kw} repair cost".` });
      } else if (GENERIC_SINGLE_WORDS.has(kw)) {
        issues.push({ keyword: kw, type: 'TOO_GENERIC', severity: 'HIGH',
          message: `"${kw}" is a common word that appears in almost every caller utterance — this container will fire incorrectly on unrelated questions. Replace with a specific phrase like "${kw} diagnostic cost" or "${kw} service included".` });
      } else {
        // Redundant: already covered by a more specific multi-word phrase in same container
        const coveredBy = multiWordKws.find(mw => mw.split(/\s+/).includes(kw));
        if (coveredBy) {
          issues.push({ keyword: kw, type: 'REDUNDANT', severity: 'INFO',
            message: `"${kw}" is already covered by the more specific "${coveredBy}" — remove the single word to reduce noise.` });
        }
      }
    }
  }

  // ── Score calculation ───────────────────────────────────────────────────────
  const highPenalty = issues.filter(i => i.severity === 'HIGH').length * 20;
  const warnPenalty = issues.filter(i => i.severity === 'WARN').length * 10;
  const infoPenalty = issues.filter(i => i.severity === 'INFO').length * 3;
  const multiBonus  = rawKeywords.length >= 5 && multiWordKws.length / rawKeywords.length >= 0.7 ? 5 : 0;
  const score = Math.max(0, Math.min(100, 100 - highPenalty - warnPenalty - infoPenalty + multiBonus));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F';

  return {
    containerId: String(container._id),
    title:       container.title,
    kcId:        container.kcId || null,
    score,
    grade,
    issues,
    keywords:    rawKeywords,
    multiWordCount:  multiWordKws.length,
    singleWordCount: singleWordKws.length,
    suggestions: null, // filled in by Groq below for D/F grades
  };
}

/**
 * _groqSuggestKeywords — Uses Groq to generate 6-8 specific multi-word
 * replacement phrases for containers with a D or F quality grade.
 * Returns an array of suggestion strings, or [] on any failure.
 */
async function _groqSuggestKeywords(container, qualityResult) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return [];

  try {
    // Build content summary from sections
    const contentSummary = (container.sections || [])
      .slice(0, 3)
      .map(s => `${s.label ? s.label + ': ' : ''}${(s.content || '').substring(0, 180)}`)
      .filter(Boolean)
      .join('\n');

    const weakKeywords = qualityResult.issues
      .filter(i => i.severity === 'HIGH' && i.keyword)
      .map(i => i.keyword);

    const goodKeywords = (container.keywords || [])
      .filter(k => k.includes(' '))   // keep multi-word phrases that passed
      .slice(0, 5);

    const prompt = `You are a knowledge-base keyword specialist for a phone AI used by home-service companies (HVAC, plumbing, electrical).

CONTAINER TITLE: "${container.title}"
CONTENT:
${contentSummary || '(no sections defined yet)'}

WEAK KEYWORDS TO REPLACE (too generic — these cause the container to fire on wrong questions):
${weakKeywords.length ? weakKeywords.map(k => `"${k}"`).join(', ') : 'none'}

EXISTING GOOD KEYWORDS (keep these, do not repeat):
${goodKeywords.length ? goodKeywords.map(k => `"${k}"`).join(', ') : 'none'}

Generate 7 specific multi-word replacement phrases for this container.
STRICT RULES:
1. Every phrase MUST be 2-6 words (never a single word)
2. Must sound like natural caller speech — what would a homeowner actually say?
3. Must be SPECIFIC to this container's exact topic — not general HVAC questions
4. Must NOT repeat any existing good keywords listed above
5. Mix question forms ("how much does", "do you charge") with noun phrases ("refrigerant recharge cost")

Return ONLY a valid JSON array of strings — no markdown, no explanation:
["phrase one", "phrase two", "phrase three", "phrase four", "phrase five", "phrase six", "phrase seven"]`;

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   300,
      temperature: 0.25,
      system:      'You are a keyword specialist. Return only valid JSON arrays. No markdown.',
      messages:    [{ role: 'user', content: prompt }],
      jsonMode:    false,
    });

    if (!result.response) return [];

    const raw = result.response.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Validate: keep only strings with at least one space (multi-word)
    return parsed
      .filter(s => typeof s === 'string' && s.trim().includes(' '))
      .map(s => s.trim().toLowerCase())
      .slice(0, 8);

  } catch (err) {
    logger.warn(`${TAG} _groqSuggestKeywords failed`, { containerId: container._id, err: err.message });
    return [];
  }
}

/**
 * analyzeKeywordQuality — Full keyword quality audit for all active containers.
 *
 * Runs synchronously for scoring, then fires Groq suggestions for D/F containers.
 * Returns structured per-container quality reports + overall summary.
 */
async function analyzeKeywordQuality(companyId) {
  const containers = await CompanyKnowledgeContainer
    .find({ companyId, isActive: true })
    .select('_id kcId title keywords sections')
    .lean();

  if (!containers.length) {
    return { qualityReports: [], overallScore: 100, overallGrade: 'A', gradeCounts: { A:0,B:0,C:0,D:0,F:0 } };
  }

  // Build cross-conflict set: which keywords appear in more than one container?
  const kwToContainers = new Map();
  for (const c of containers) {
    for (const kw of (c.keywords || [])) {
      const norm = kw.toLowerCase().trim();
      if (!kwToContainers.has(norm)) kwToContainers.set(norm, new Set());
      kwToContainers.get(norm).add(String(c._id));
    }
  }
  const crossConflictSet = new Set(
    [...kwToContainers.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([kw]) => kw)
  );

  // Score all containers synchronously
  const reports = containers.map(c => _analyzeContainerQuality(c, crossConflictSet));

  // Groq suggestions for D/F containers (capped at GROQ_SUGGEST_CAP)
  const needsSuggestions = reports
    .filter(r => (r.grade === 'D' || r.grade === 'F') && r.issues.some(i => i.severity === 'HIGH' && i.keyword))
    .slice(0, GROQ_SUGGEST_CAP);

  if (needsSuggestions.length) {
    await Promise.all(needsSuggestions.map(async (report) => {
      const container = containers.find(c => String(c._id) === report.containerId);
      if (!container) return;
      report.suggestions = await _groqSuggestKeywords(container, report);
    }));
  }

  // Overall score = average of all container scores
  const overallScore = Math.round(reports.reduce((s, r) => s + r.score, 0) / reports.length);
  const overallGrade = overallScore >= 90 ? 'A' : overallScore >= 75 ? 'B' : overallScore >= 60 ? 'C' : overallScore >= 45 ? 'D' : 'F';
  const gradeCounts  = reports.reduce((acc, r) => { acc[r.grade] = (acc[r.grade] || 0) + 1; return acc; }, { A:0,B:0,C:0,D:0,F:0 });

  logger.info(`${TAG} analyzeKeywordQuality complete`, {
    companyId, containers: reports.length, overallScore, overallGrade,
    grades: Object.entries(gradeCounts).map(([g,n]) => `${g}:${n}`).join(' '),
  });

  return { qualityReports: reports, overallScore, overallGrade, gradeCounts };
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
  analyzeKeywordQuality,
};
