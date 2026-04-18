'use strict';

/**
 * ============================================================================
 * KC HEALTH CHECK SERVICE — Structural Audit of KC Configuration
 * ============================================================================
 *
 * PURPOSE:
 *   Read-only structural audit of a company's KC configuration. Surfaces
 *   blind spots that leave UAP operating below full power — empty tradeTerms,
 *   meta-containers with noAnchor unset, missing phrase cores, etc.
 *
 *   This is the Config Health complement to kcGaps (Runtime Health).
 *   Gaps = "what broke during calls". Health = "what's misconfigured now".
 *
 * NOT TO BE CONFUSED WITH:
 *   - KCKeywordHealthService — scores keyword density per KC
 *   - kcIntelligence — Groq-driven gap mining + conflict detection (~30-60s)
 *   This service: lightweight (<1s), deterministic, no LLM, no embeddings.
 *
 * ARCHITECTURAL INVARIANT (locked):
 *   UAP reads phrases. Groq reads responses. This service never reads
 *   section.content or section.groqContent for routing-style evaluation.
 *
 * ============================================================================
 */

const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');
const AdminSettings             = require('../../models/AdminSettings');
const logger                    = require('../../utils/logger');

// ──────────────────────────────────────────────────────────────────────────
// Meta-container whitelist — titles that MUST have noAnchor=true
// ──────────────────────────────────────────────────────────────────────────
const META_CONTAINER_PATTERNS = [
  /conversational recovery/i,
  /price objections?/i,
  /scheduling\s*&?\s*availability/i,
  /warranty\s*&?\s*guarantee/i,
  /appointment management/i,
  /spam\s*&?\s*solicitation/i,
];

function _isMetaContainer(title) {
  if (!title) return false;
  return META_CONTAINER_PATTERNS.some(re => re.test(title));
}

// ──────────────────────────────────────────────────────────────────────────
// Severity ranks (used for sorting + UI)
// ──────────────────────────────────────────────────────────────────────────
const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MED: 2, LOW: 1, INFO: 0 };

// ──────────────────────────────────────────────────────────────────────────
// Build check entries
// ──────────────────────────────────────────────────────────────────────────

function _checkContainer(container) {
  const checks  = [];
  const title   = container.title || '(untitled)';
  const isMeta  = _isMetaContainer(title);
  const hasKey  = !!container.tradeVocabularyKey;

  // META_NOANCHOR_UNSET — CRITICAL
  if (isMeta && container.noAnchor !== true) {
    checks.push({
      id:       'META_NOANCHOR_UNSET',
      severity: 'CRITICAL',
      message:  `"${title}" is a meta-container but noAnchor is not set. Any Turn 1 match here will poison the anchor (3× keyword boost drowns HVAC routing).`,
    });
  }

  // TRADE_VOCAB_KEY_MISSING — HIGH (trade KC with no vocab link)
  if (!isMeta && !hasKey && container.isActive !== false) {
    checks.push({
      id:       'TRADE_VOCAB_KEY_MISSING',
      severity: 'HIGH',
      message:  `"${title}" has no tradeVocabularyKey. CueExtractor cannot source global trade terms for this container.`,
    });
  }

  // NEGATIVE_KEYWORDS_SUSPICIOUS — LOW
  const sections   = container.sections || [];
  const sectionNeg = sections.reduce((n, s) => n + ((s.negativeKeywords || []).length), 0);
  if (isMeta && sectionNeg < 20 * sections.length) {
    checks.push({
      id:       'NEGATIVE_KEYWORDS_SUSPICIOUS',
      severity: 'LOW',
      message:  `Meta-container "${title}" has thin negativeKeywords (${sectionNeg} total across ${sections.length} sections). Cross-contamination risk.`,
    });
  }

  return { checks, isMeta };
}

function _checkSection(section, container) {
  const checks   = [];
  const isMeta   = _isMetaContainer(container.title);
  const hasVKey  = !!container.tradeVocabularyKey;
  const active   = section.isActive !== false;
  const label    = section.label || '(unlabelled)';
  const phrases  = section.callerPhrases || [];

  // TRADE_TERMS_EMPTY — HIGH (only relevant for trade containers that CAN fill)
  if (active && !isMeta && hasVKey && (section.tradeTerms || []).length === 0) {
    checks.push({
      id:           'TRADE_TERMS_EMPTY',
      severity:     'HIGH',
      message:      `Section "${label}" has no tradeTerms. GATE 2.4 Field 8 dark for this section.`,
      sectionLabel: label,
    });
  }

  // PHRASE_CORE_MISSING — MED
  if (active && phrases.length > 0 && !section.phraseCore) {
    checks.push({
      id:           'PHRASE_CORE_MISSING',
      severity:     'MED',
      message:      `Section "${label}" has ${phrases.length} callerPhrases but no phraseCore. Run Re-score All.`,
      sectionLabel: label,
    });
  }

  // PHRASE_CORE_EMBEDDING_MISSING — MED (requires unrestricted read; may be undetectable w/ select:false)
  // We check via a separate query path in the service; skipped here.

  // ANCHOR_WORDS_EMPTY — MED (aggregated per section)
  if (active && phrases.length > 0) {
    const noAnchorCount = phrases.filter(p => !p.anchorWords || p.anchorWords.length === 0).length;
    if (noAnchorCount === phrases.length) {
      checks.push({
        id:           'ANCHOR_WORDS_EMPTY',
        severity:     'MED',
        message:      `Section "${label}" has zero anchorWords across all ${phrases.length} phrases. Word Gate degraded.`,
        sectionLabel: label,
      });
    }
  }

  // CONTENT_KEYWORDS_EMPTY — MED
  if (active && (section.contentKeywords || []).length === 0) {
    checks.push({
      id:           'CONTENT_KEYWORDS_EMPTY',
      severity:     'MED',
      message:      `Section "${label}" has no contentKeywords. GATE 3 keyword fallback degraded.`,
      sectionLabel: label,
    });
  }

  // SECTION_INACTIVE — INFO
  if (section.isActive === false) {
    checks.push({
      id:           'SECTION_INACTIVE',
      severity:     'INFO',
      message:      `Section "${label}" is inactive. Content preserved but skipped at runtime.`,
      sectionLabel: label,
    });
  }

  return checks;
}

// ──────────────────────────────────────────────────────────────────────────
// Coverage computation
// ──────────────────────────────────────────────────────────────────────────

function _pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10; // one decimal
}

function _computeCoverage(containers) {
  let totalSections         = 0;
  let activeSections        = 0;
  let sectionsWithTrade     = 0;
  let sectionsWithCore      = 0;
  let sectionsWithEmb       = 0;
  let totalPhrases          = 0;
  let phrasesWithAnchors    = 0;
  let metaContainers        = 0;
  let metaContainersCorrect = 0;

  for (const c of containers) {
    const isMeta = _isMetaContainer(c.title);
    if (isMeta) {
      metaContainers++;
      if (c.noAnchor === true) metaContainersCorrect++;
    }
    for (const s of (c.sections || [])) {
      totalSections++;
      if (s.isActive !== false) activeSections++;
      if ((s.tradeTerms || []).length > 0)    sectionsWithTrade++;
      if (s.phraseCore)                       sectionsWithCore++;
      if (s.phraseCoreScoredAt)               sectionsWithEmb++; // proxy — real embedding is select:false
      for (const p of (s.callerPhrases || [])) {
        totalPhrases++;
        if ((p.anchorWords || []).length > 0) phrasesWithAnchors++;
      }
    }
  }

  return {
    totalSections,
    activeSections,
    totalPhrases,
    tradeTermsFilledPct:     _pct(sectionsWithTrade,  activeSections),
    phraseCoreFilledPct:     _pct(sectionsWithCore,   activeSections),
    phraseCoreEmbeddedPct:   _pct(sectionsWithEmb,    activeSections),
    anchorWordsFilledPct:    _pct(phrasesWithAnchors, totalPhrases),
    noAnchorCorrectness:     `${metaContainersCorrect}/${metaContainers}`,
    metaContainers,
    metaContainersCorrect,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Platform-level checks (GlobalShare)
// ──────────────────────────────────────────────────────────────────────────

async function _checkPlatform(containers) {
  const checks = [];
  let cuePatternCount = 0;
  const tradeVocabKeys = [];

  try {
    const settings = await AdminSettings.findOne({}, { 'globalHub.phraseIntelligence': 1 }).lean();
    const pi       = settings?.globalHub?.phraseIntelligence || {};
    const cues     = Array.isArray(pi.cuePhrases) ? pi.cuePhrases : [];
    const vocabs   = Array.isArray(pi.tradeVocabularies) ? pi.tradeVocabularies : [];

    cuePatternCount = cues.length;
    for (const v of vocabs) if (v && v.tradeKey) tradeVocabKeys.push(v.tradeKey);

    if (cues.length < 500) {
      checks.push({
        id:       'GLOBAL_CUE_PATTERNS_LOW',
        severity: 'HIGH',
        message:  `Global cuePhrases is only ${cues.length} patterns (target ≥500). Fields 1-7 may be dark on many utterances.`,
      });
    }

    // Verify each container's tradeVocabularyKey resolves to a real vocab
    const keySet = new Set(tradeVocabKeys);
    for (const c of containers) {
      if (c.tradeVocabularyKey && !keySet.has(c.tradeVocabularyKey)) {
        checks.push({
          id:       'TRADE_VOCAB_MISSING',
          severity: 'HIGH',
          message:  `Container "${c.title}" references tradeVocabularyKey "${c.tradeVocabularyKey}" which does not exist in GlobalShare.`,
        });
      }
    }
  } catch (err) {
    logger.warn('[KCHealthCheck] Platform check partial failure', { err: err.message });
    checks.push({
      id:       'PLATFORM_READ_ERROR',
      severity: 'LOW',
      message:  `Could not fully read AdminSettings.globalHub: ${err.message}`,
    });
  }

  return { checks, cuePatternCount, tradeVocabKeys };
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run a full health check for a company.
 * @param {string|ObjectId} companyId
 * @returns {Promise<object>} Structured health report.
 */
async function runHealthCheck(companyId) {
  const t0 = Date.now();

  // Load all containers for the company (exclude heavy fields)
  const containers = await CompanyKnowledgeContainer
    .find(
      { companyId },
      {
        title:              1,
        kcId:               1,
        isActive:           1,
        noAnchor:           1,
        tradeVocabularyKey: 1,
        priority:           1,
        category:           1,
        'sections.label':             1,
        'sections.isActive':          1,
        'sections.tradeTerms':        1,
        'sections.negativeKeywords':  1,
        'sections.contentKeywords':   1,
        'sections.phraseCore':        1,
        'sections.phraseCoreScoredAt': 1,
        'sections.callerPhrases.text':        1,
        'sections.callerPhrases.anchorWords': 1,
      }
    )
    .lean();

  // Per-container + per-section checks
  const containerReports = [];
  for (const c of containers) {
    const { checks: containerChecks } = _checkContainer(c);
    const sectionChecks = [];
    for (const s of (c.sections || [])) {
      sectionChecks.push(..._checkSection(s, c));
    }
    const allChecks = [...containerChecks, ...sectionChecks];

    containerReports.push({
      kcId:               c.kcId,
      title:              c.title,
      noAnchor:           c.noAnchor === true,
      tradeVocabularyKey: c.tradeVocabularyKey || null,
      isActive:           c.isActive !== false,
      isMeta:             _isMetaContainer(c.title),
      sectionCount:       (c.sections || []).length,
      activeSectionCount: (c.sections || []).filter(s => s.isActive !== false).length,
      checks:             allChecks,
      topSeverity:        allChecks.reduce((m, c) => Math.max(m, SEVERITY_RANK[c.severity] || 0), 0),
    });
  }

  // Sort containers: highest severity first, then by title
  containerReports.sort((a, b) => {
    if (b.topSeverity !== a.topSeverity) return b.topSeverity - a.topSeverity;
    return (a.title || '').localeCompare(b.title || '');
  });

  // Platform checks
  const platform = await _checkPlatform(containers);

  // Coverage
  const coverage = _computeCoverage(containers);

  // Aggregate severity counts
  const severityCounts = { CRITICAL: 0, HIGH: 0, MED: 0, LOW: 0, INFO: 0 };
  for (const cr of containerReports) {
    for (const chk of cr.checks) severityCounts[chk.severity] = (severityCounts[chk.severity] || 0) + 1;
  }
  for (const chk of platform.checks) severityCounts[chk.severity] = (severityCounts[chk.severity] || 0) + 1;

  const elapsedMs = Date.now() - t0;

  return {
    success:     true,
    companyId:   String(companyId),
    generatedAt: new Date().toISOString(),
    elapsedMs,
    summary: {
      totalContainers:  containers.length,
      totalSections:    coverage.totalSections,
      activeSections:   coverage.activeSections,
      totalPhrases:     coverage.totalPhrases,
      severityCounts,
      coverage: {
        tradeTermsFilledPct:   coverage.tradeTermsFilledPct,
        phraseCoreFilledPct:   coverage.phraseCoreFilledPct,
        phraseCoreEmbeddedPct: coverage.phraseCoreEmbeddedPct,
        anchorWordsFilledPct:  coverage.anchorWordsFilledPct,
        noAnchorCorrectness:   coverage.noAnchorCorrectness,
        metaContainers:        coverage.metaContainers,
        metaContainersCorrect: coverage.metaContainersCorrect,
      },
    },
    containers: containerReports,
    platform: {
      checks:          platform.checks,
      cuePatternCount: platform.cuePatternCount,
      tradeVocabKeys:  platform.tradeVocabKeys,
    },
  };
}

module.exports = {
  runHealthCheck,
  _isMetaContainer,       // exported for tests
  META_CONTAINER_PATTERNS,
};
