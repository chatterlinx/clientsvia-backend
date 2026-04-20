'use strict';

/**
 * ============================================================================
 * GAP REPLAY SERVICE — Enterprise-grade stateless routing replay
 * ============================================================================
 *
 * PURPOSE
 * -------
 * Given a companyId + caller phrase + optional anchor context, replays the
 * exact same KC routing pipeline the production runtime uses and returns a
 * full per-gate diagnostic trace explaining WHY the phrase did (or did not)
 * route to a KC section.
 *
 * This is the enterprise-grade replacement for the earlier KCVerifyService,
 * which only ran 2 of the 4 routing gates (CueExtractor + findContainer) and
 * therefore could not explain UAP failures, Word Gate failures, semantic
 * near-misses, or anchor-context misbehavior.
 *
 * GUIDING PRINCIPLE
 * -----------------
 * Compose the SAME pure modules the production KCDiscoveryRunner calls —
 * never re-implement routing logic. If a gate changes in production, it
 * changes here automatically.
 *
 * GATES REPLAYED (in production order)
 * ------------------------------------
 *   GATE 2.4  CueExtractorService.extract()       — 8-field cue detection
 *   GATE 2.5  UtteranceActParser.parse()          — phrase-index match + passes 1-4
 *             Word Gate      (≥90% anchor words)  — post-UAP safety check
 *             Core Confirm   (cosine ≥0.80)       — post-UAP semantic check
 *   GATE 2.8  SemanticMatchService.findBestSection — embedding similarity
 *   GATE 3    KnowledgeContainerService.findContainer — keyword + title + anchor
 *
 * EVERY gate writes its outcome to a TraceCollector. At the end we compute:
 *   - finalMatch          — the container+section that would have answered
 *   - failureMode         — enum explaining WHY if no match (or weak match)
 *   - wouldFallThroughToLLM — true if runtime would hit Claude fallback
 *   - nearMisses          — top candidates from each gate with scores
 *   - verdict             — 'resolved' | 'weak' | 'failing' (tri-state)
 *
 * SIDE-EFFECT FREE BY CONSTRUCTION
 * --------------------------------
 * All 4 gate modules are pure / read-only:
 *   - CueExtractor reads Redis trade-index cache only
 *   - UAP reads Redis phrase-index cache only
 *   - Semantic reads MongoDB embeddings + calls OpenAI for utterance embedding
 *   - findContainer is a pure in-memory scorer
 *
 * NO writes occur to discoveryNotes, qaLog, Redis call-state, Twilio, or audio.
 *
 * FAILURE MODE TAXONOMY
 * ---------------------
 *   NO_CUE_MATCH             — CueExtractor fired 0 fields + no tradeMatches
 *   PHRASE_NOT_INDEXED       — UAP matchType=NONE, no phrase in phraseIndex
 *                              resembles the utterance (even after fuzzy)
 *   WORD_GATE_FAIL           — UAP matched a phrase but <90% of that phrase's
 *                              anchorWords appear in the utterance
 *   CORE_CONFIRM_FAIL        — UAP + Word Gate passed but cosine(topicWords,
 *                              phraseCoreEmbedding) < 0.80
 *   SEMANTIC_WEAK            — No callerPhrase/content embedding scores above
 *                              SEMANTIC_MIN_SIMILARITY (0.70)
 *   KEYWORD_BELOW_THRESHOLD  — findContainer returned null (best < threshold 8)
 *   SECTION_MISSING          — Container matched but no section identified
 *   OK                       — Match is clean (verdict=resolved)
 *
 * RESPONSE SHAPE
 * --------------
 * {
 *   verdict:               'resolved' | 'weak' | 'failing',
 *   failureMode:           <enum above>,
 *   phrase:                <raw caller phrase>,
 *   normalizedPhrase:      <normalized>,
 *   gapKey:                <sha1 fingerprint — same hash as KCGapResolution>,
 *   anchorContainerId:     <passed-in or null>,
 *
 *   trace: {
 *     gate_2_4_cueExtractor: { fieldCount, fields{}, tradeMatches[], isSingleTrade, pass },
 *     gate_2_5_uap:          { matchType, matchedPhrase, confidence, containerId,
 *                              kcId, sectionIdx, anchorWords[], topicWords[], pass },
 *     wordGate:              { required, matched, coverage, pass, reason },
 *     coreConfirm:           { cosine, threshold, pass, reason, skipped },
 *     gate_2_8_semantic:     { bestSimilarity, bestContainerId, bestSectionIdx,
 *                              matchSource, pass, topK[] },
 *     gate_3_keyword:        { score, threshold, containerId, sectionIdx,
 *                              anchorBoosted, anchorFloor, sourceTier, pass, breakdown },
 *   },
 *
 *   finalMatch: {
 *     source:       'UAP' | 'SEMANTIC' | 'KEYWORD' | null,
 *     containerId:  <ObjectId-string>,
 *     kcId:         <string>,
 *     containerTitle: <string>,
 *     sectionIdx:   <int>,
 *     sectionLabel: <string>,
 *   } | null,
 *
 *   wouldFallThroughToLLM: <bool>,
 *   latencyMs:             <int>,
 *   verifiedAt:            <ISO>,
 *   runnerVersion:         'GapReplay-v2.0',
 * }
 *
 * MULTI-TENANT SAFETY
 * -------------------
 * All container reads scoped by companyId. All cache keys scoped by companyId.
 * No cross-tenant data crosses boundaries.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const CueExtractorService  = require('../cueExtractor/CueExtractorService');
const UtteranceActParser   = require('../engine/kc/UtteranceActParser');
const SemanticMatchService = require('../engine/kc/SemanticMatchService');
const KCS                  = require('../engine/agent2/KnowledgeContainerService');
const KCGapResolution      = require('../../models/KCGapResolution');
const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');
const logger               = require('../../utils/logger');

// ── Thresholds MUST mirror the production runtime ─────────────────────────
// Keep in sync with KCDiscoveryRunner + UAP + SemanticMatchService.
const MIN_KEYWORD_THRESHOLD   = parseInt(process.env.KC_KEYWORD_THRESHOLD, 10) || 8;
const ANCHOR_FLOOR            = 24;
const WEAK_MARGIN             = 4;     // keyword score within this of threshold → weak
const WORD_GATE_THRESHOLD     = 0.90;  // ≥90% of matched phrase's anchor words in input
const CORE_CONFIRM_THRESHOLD  = 0.80;  // cosine ≥0.80
const SEMANTIC_MIN_SIMILARITY = 0.70;

const FAILURE_MODE = Object.freeze({
  OK:                       'OK',
  NO_CUE_MATCH:             'NO_CUE_MATCH',
  PHRASE_NOT_INDEXED:       'PHRASE_NOT_INDEXED',
  WORD_GATE_FAIL:           'WORD_GATE_FAIL',
  CORE_CONFIRM_FAIL:        'CORE_CONFIRM_FAIL',
  SEMANTIC_WEAK:            'SEMANTIC_WEAK',
  KEYWORD_BELOW_THRESHOLD:  'KEYWORD_BELOW_THRESHOLD',
  SECTION_MISSING:          'SECTION_MISSING',
});

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Replay a caller phrase through the full KC routing pipeline and return a
 * comprehensive diagnostic trace.
 *
 * @param {Object}  opts
 * @param {string}  opts.companyId
 * @param {string}  opts.phrase                 — raw caller utterance
 * @param {string} [opts.anchorContainerId]     — if set, applies 3× boost on
 *                                                that container (reproduces
 *                                                mid-call anchor state)
 * @param {string} [opts.expectedContainerId]   — if provided, contributes to
 *                                                verdict: wrong container → weak
 * @returns {Promise<Object>} replay report (see module docstring)
 */
async function replayPhrase({
  companyId,
  phrase,
  anchorContainerId = null,
  expectedContainerId = null,
}) {
  const startMs    = Date.now();
  const rawPhrase  = String(phrase || '').trim();
  const normPhrase = KCGapResolution.normalizePhrase(rawPhrase);
  const gapKey     = KCGapResolution.buildGapKey(companyId, rawPhrase);

  // ── Base report (returned on any early exit) ─────────────────────────────
  const report = {
    verdict:               'failing',
    failureMode:           FAILURE_MODE.PHRASE_NOT_INDEXED,
    phrase:                rawPhrase,
    normalizedPhrase:      normPhrase,
    gapKey,
    anchorContainerId:     anchorContainerId ? String(anchorContainerId) : null,
    trace: {
      gate_2_4_cueExtractor: null,
      gate_2_5_uap:          null,
      wordGate:              null,
      coreConfirm:           null,
      gate_2_8_semantic:     null,
      gate_3_keyword:        null,
    },
    finalMatch:            null,
    wouldFallThroughToLLM: true,
    latencyMs:             0,
    verifiedAt:            new Date().toISOString(),
    runnerVersion:         'GapReplay-v2.0',
  };

  if (!companyId || !rawPhrase) {
    report.latencyMs = Date.now() - startMs;
    report.error     = 'companyId and phrase are required';
    return report;
  }

  try {
    // ────────────────────────────────────────────────────────────────────
    // GATE 2.4 — CueExtractor (8-field cue pattern match)
    // ────────────────────────────────────────────────────────────────────
    const cueFrame = await CueExtractorService.extract(companyId, rawPhrase).catch((err) => {
      logger.warn('[GapReplay] CueExtractor error', { companyId, err: err.message });
      return null;
    });

    report.trace.gate_2_4_cueExtractor = _captureCueGate(cueFrame);

    // ────────────────────────────────────────────────────────────────────
    // GATE 2.5 — UAP (phrase index match, 6-pass pipeline)
    // ────────────────────────────────────────────────────────────────────
    const uapResult = await UtteranceActParser.parse(companyId, rawPhrase).catch((err) => {
      logger.warn('[GapReplay] UAP parse error', { companyId, err: err.message });
      return null;
    });

    report.trace.gate_2_5_uap = _captureUapGate(uapResult);

    // ────────────────────────────────────────────────────────────────────
    // Word Gate + Core Confirmation
    // Run only if UAP returned a match and that match has anchor words /
    // phrase core embedding to confirm against.
    // ────────────────────────────────────────────────────────────────────
    const uapMatched = uapResult && uapResult.matchType && uapResult.matchType !== 'NONE';

    if (uapMatched) {
      report.trace.wordGate = _runWordGate(rawPhrase, uapResult);

      // Core confirm needs the phraseCoreEmbedding for the matched section.
      // We lazily fetch it from MongoDB only when needed to keep replay cheap.
      if (report.trace.wordGate.pass) {
        report.trace.coreConfirm = await _runCoreConfirm({
          companyId,
          rawPhrase,
          uapResult,
        });
      } else {
        report.trace.coreConfirm = {
          pass: false, skipped: true, reason: 'Skipped — Word Gate failed.',
          cosine: null, threshold: CORE_CONFIRM_THRESHOLD,
        };
      }
    } else {
      report.trace.wordGate    = { pass: false, skipped: true, reason: 'Skipped — UAP returned NONE.', required: 0, matched: 0, coverage: 0 };
      report.trace.coreConfirm = { pass: false, skipped: true, reason: 'Skipped — UAP returned NONE.', cosine: null, threshold: CORE_CONFIRM_THRESHOLD };
    }

    const uapAccepted = uapMatched
      && report.trace.wordGate.pass
      && report.trace.coreConfirm.pass;

    // ────────────────────────────────────────────────────────────────────
    // Load active containers for semantic + keyword gates.
    // Use the warm cache where possible — matches runtime behavior exactly.
    // For semantic we need embeddings, which are `select: false` — fetch the
    // embedding-hydrated copy via a dedicated query (pattern from KCDiscoveryRunner).
    // ────────────────────────────────────────────────────────────────────
    const [containersLean, containersWithEmb] = await Promise.all([
      KCS.getActiveForCompany(companyId),
      _loadContainersWithEmbeddings(companyId),
    ]);

    // ────────────────────────────────────────────────────────────────────
    // GATE 2.8 — Semantic match (utterance embedding vs section embeddings)
    // ────────────────────────────────────────────────────────────────────
    let semanticBest = null;
    try {
      semanticBest = await SemanticMatchService.findBestSection(
        companyId, rawPhrase, containersWithEmb
      );
    } catch (err) {
      logger.warn('[GapReplay] Semantic match error', { companyId, err: err.message });
    }
    report.trace.gate_2_8_semantic = _captureSemanticGate(semanticBest);

    // ────────────────────────────────────────────────────────────────────
    // GATE 3 — Keyword + title + anchor scoring
    // Reproduces anchor context by passing expectedContainerId as the
    // anchor when the caller supplied one (mid-call replay), otherwise
    // passes the container that matched in UAP (speculative anchor).
    // ────────────────────────────────────────────────────────────────────
    const ctxAnchor = anchorContainerId || (uapAccepted ? uapResult.containerId : null);
    const ctx = ctxAnchor ? { anchorContainerId: ctxAnchor } : null;
    const kwMatch = KCS.findContainer(containersLean, rawPhrase, ctx);
    report.trace.gate_3_keyword = _captureKeywordGate(kwMatch, ctxAnchor);

    // ────────────────────────────────────────────────────────────────────
    // RESOLVE finalMatch + failureMode
    // Priority: UAP (if accepted) > Semantic (if above MIN) > Keyword (if ≥threshold)
    // This mirrors the runtime pipeline's order.
    // ────────────────────────────────────────────────────────────────────
    if (uapAccepted) {
      report.finalMatch = {
        source:          'UAP',
        containerId:     uapResult.containerId ? String(uapResult.containerId) : null,
        kcId:            uapResult.kcId || null,
        containerTitle:  _findContainerTitle(containersLean, uapResult.containerId),
        sectionIdx:      uapResult.sectionIdx ?? null,
        sectionLabel:    uapResult.sectionLabel || null,
      };
      report.failureMode           = FAILURE_MODE.OK;
      report.wouldFallThroughToLLM = false;
    } else if (semanticBest && semanticBest.similarity >= SEMANTIC_MIN_SIMILARITY) {
      report.finalMatch = {
        source:         'SEMANTIC',
        containerId:    String(semanticBest.container._id),
        kcId:           semanticBest.container.kcId || null,
        containerTitle: semanticBest.container.title || null,
        sectionIdx:     semanticBest.sectionIdx,
        sectionLabel:   semanticBest.section?.label || null,
      };
      report.failureMode           = FAILURE_MODE.OK;
      report.wouldFallThroughToLLM = false;
    } else if (kwMatch && kwMatch.score >= MIN_KEYWORD_THRESHOLD) {
      report.finalMatch = {
        source:         'KEYWORD',
        containerId:    String(kwMatch.container._id),
        kcId:           kwMatch.container.kcId || null,
        containerTitle: kwMatch.container.title || null,
        sectionIdx:     kwMatch.bestSectionIdx ?? null,
        sectionLabel:   kwMatch.bestSection?.label || null,
      };
      report.failureMode = (kwMatch.bestSectionIdx === null || kwMatch.bestSectionIdx === undefined)
        ? FAILURE_MODE.SECTION_MISSING
        : FAILURE_MODE.OK;
      report.wouldFallThroughToLLM = false;
    } else {
      // No gate fired — compute the most informative failure mode from the trace
      report.failureMode           = _deriveFailureMode(report.trace);
      report.wouldFallThroughToLLM = true;
    }

    // ────────────────────────────────────────────────────────────────────
    // VERDICT — tri-state (resolved / weak / failing)
    // ────────────────────────────────────────────────────────────────────
    report.verdict = _computeVerdict({
      finalMatch:          report.finalMatch,
      kwScore:             report.trace.gate_3_keyword?.score,
      expectedContainerId,
    });

  } catch (err) {
    logger.error('[GapReplay] Fatal error', {
      companyId, phrase: rawPhrase.slice(0, 80), err: err.message, stack: err.stack,
    });
    report.error   = err.message;
    report.verdict = 'failing';
  }

  report.latencyMs = Date.now() - startMs;

  logger.info('[GapReplay] done', {
    companyId,
    phrasePreview: rawPhrase.slice(0, 50),
    verdict:       report.verdict,
    failureMode:   report.failureMode,
    source:        report.finalMatch?.source || null,
    latencyMs:     report.latencyMs,
  });

  return report;
}

// ============================================================================
// PER-GATE CAPTURE HELPERS
// ============================================================================

function _captureCueGate(cueFrame) {
  if (!cueFrame) {
    return {
      fieldCount: 0, fields: {}, tradeMatches: [], isSingleTrade: false,
      pass: false, reason: 'CueExtractor returned null or errored.',
    };
  }
  const fieldCount  = cueFrame.fieldCount || 0;
  const tradeCount  = (cueFrame.tradeMatches || []).length;
  const pass        = fieldCount > 0 || tradeCount > 0;
  return {
    fieldCount,
    fields: {
      requestCue:    cueFrame.requestCue    || null,
      permissionCue: cueFrame.permissionCue || null,
      infoCue:       cueFrame.infoCue       || null,
      directiveCue:  cueFrame.directiveCue  || null,
      actionCore:    cueFrame.actionCore    || null,
      urgencyCore:   cueFrame.urgencyCore   || null,
      modifierCore:  cueFrame.modifierCore  || null,
    },
    tradeMatches: (cueFrame.tradeMatches || []).map((tm) => ({
      containerId: tm.containerId ? String(tm.containerId) : null,
      sectionIdx:  tm.sectionIdx,
      term:        tm.term,
      kcId:        tm.kcId,
      title:       tm.title,
    })),
    isSingleTrade: !!cueFrame.isSingleTrade,
    pass,
    reason: pass ? null : 'Zero cue fields fired and zero tradeTerm matches.',
  };
}

function _captureUapGate(uap) {
  if (!uap) {
    return {
      matchType: 'NONE', matchedPhrase: null, confidence: 0,
      containerId: null, kcId: null, sectionIdx: null, sectionLabel: null,
      anchorWords: [], topicWords: [],
      pass: false, reason: 'UAP returned null or errored.',
    };
  }
  const pass = uap.matchType && uap.matchType !== 'NONE';
  return {
    matchType:     uap.matchType || 'NONE',
    matchedPhrase: uap.matchedPhrase || null,
    confidence:    typeof uap.confidence === 'number' ? uap.confidence : 0,
    containerId:   uap.containerId ? String(uap.containerId) : null,
    kcId:          uap.kcId || null,
    sectionIdx:    uap.sectionIdx ?? null,
    sectionLabel:  uap.sectionLabel || null,
    anchorWords:   Array.isArray(uap.anchorWords) ? [...uap.anchorWords] : [],
    topicWords:    Array.isArray(uap.topicWords)  ? [...uap.topicWords]  : [],
    pass,
    reason: pass ? null : 'UAP found no phrase index match (even after fuzzy/phonetic passes).',
  };
}

function _runWordGate(rawInput, uapResult) {
  const required = Array.isArray(uapResult.anchorWords) ? uapResult.anchorWords.length : 0;
  if (required === 0) {
    // No anchor words on the matched phrase → gate passes trivially
    return {
      required: 0, matched: 0, coverage: 1.0,
      pass: true, reason: 'No anchor words on matched phrase — gate not applicable.',
    };
  }

  const inputNorm = String(rawInput || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const inputWords = new Set(inputNorm.split(/\s+/).filter(Boolean));

  let matched = 0;
  const missing = [];
  for (const aw of uapResult.anchorWords) {
    const awNorm = String(aw || '').toLowerCase().trim();
    if (!awNorm) continue;
    // Substring match handles stem / plural variants cheaply
    let found = inputWords.has(awNorm);
    if (!found) {
      for (const w of inputWords) {
        if (w.includes(awNorm) || awNorm.includes(w)) { found = true; break; }
      }
    }
    if (found) matched++;
    else missing.push(awNorm);
  }

  const coverage = required > 0 ? matched / required : 1;
  const pass     = coverage >= WORD_GATE_THRESHOLD;
  return {
    required, matched, coverage: Number(coverage.toFixed(3)), missing,
    threshold: WORD_GATE_THRESHOLD,
    pass,
    reason: pass
      ? null
      : `Only ${matched}/${required} anchor words present (need ≥${Math.round(WORD_GATE_THRESHOLD * 100)}%). Missing: ${missing.join(', ') || '—'}`,
  };
}

/**
 * Core Confirmation — cosine(utterance embedding, phraseCoreEmbedding).
 * Uses the OpenAI embedding for the raw utterance (via SemanticMatchService),
 * then compares to the matched section's stored phraseCoreEmbedding.
 *
 * Skipped if:
 *   - The section has no phraseCoreEmbedding (not yet scored)
 *   - OPENAI_API_KEY missing (SemanticMatchService.embedText returns null)
 */
async function _runCoreConfirm({ companyId, rawPhrase, uapResult }) {
  try {
    if (!uapResult.containerId || uapResult.sectionIdx === null || uapResult.sectionIdx === undefined) {
      return {
        pass: true, skipped: true, reason: 'No section identified — core confirm not applicable.',
        cosine: null, threshold: CORE_CONFIRM_THRESHOLD,
      };
    }

    // Load just the phraseCoreEmbedding for the matched section
    const doc = await CompanyKnowledgeContainer
      .findOne({ companyId, _id: uapResult.containerId })
      .select('+sections.phraseCoreEmbedding sections.phraseCore sections.label')
      .lean();

    const section = doc?.sections?.[uapResult.sectionIdx];
    if (!section?.phraseCoreEmbedding?.length) {
      return {
        pass: true, skipped: true,
        reason: 'Section has no phraseCoreEmbedding (not yet scored). Runtime bypasses Core Confirm in this case.',
        cosine: null, threshold: CORE_CONFIRM_THRESHOLD,
      };
    }

    const utteranceVec = await SemanticMatchService.embedText(rawPhrase);
    if (!utteranceVec) {
      return {
        pass: true, skipped: true,
        reason: 'OpenAI embed unavailable — Core Confirm skipped (matches runtime graceful path).',
        cosine: null, threshold: CORE_CONFIRM_THRESHOLD,
      };
    }

    const cosine = SemanticMatchService.cosineSimilarity(utteranceVec, section.phraseCoreEmbedding);
    const pass   = cosine >= CORE_CONFIRM_THRESHOLD;
    return {
      pass, skipped: false,
      cosine: Number(cosine.toFixed(3)),
      threshold: CORE_CONFIRM_THRESHOLD,
      phraseCore: section.phraseCore || null,
      reason: pass
        ? null
        : `Cosine ${cosine.toFixed(3)} below threshold ${CORE_CONFIRM_THRESHOLD}. Caller phrasing is semantically distant from section's phraseCore.`,
    };
  } catch (err) {
    logger.warn('[GapReplay] Core confirm error', { companyId, err: err.message });
    return {
      pass: true, skipped: true,
      reason: `Core Confirm errored (${err.message}) — treated as skipped to avoid false negatives.`,
      cosine: null, threshold: CORE_CONFIRM_THRESHOLD,
    };
  }
}

function _captureSemanticGate(best) {
  if (!best) {
    return {
      bestSimilarity: 0, bestContainerId: null, bestContainerTitle: null,
      bestSectionIdx: null, bestSectionLabel: null, matchSource: null,
      threshold: SEMANTIC_MIN_SIMILARITY,
      pass: false, reason: 'No section embedding exceeded the minimum similarity threshold.',
    };
  }
  return {
    bestSimilarity:     Number(best.similarity.toFixed(3)),
    bestContainerId:    String(best.container._id),
    bestContainerTitle: best.container.title || null,
    bestSectionIdx:     best.sectionIdx,
    bestSectionLabel:   best.section?.label || null,
    matchSource:        best.matchSource || null,
    matchedPhrase:      best.matchedPhrase || null,
    threshold:          SEMANTIC_MIN_SIMILARITY,
    pass:               best.similarity >= SEMANTIC_MIN_SIMILARITY,
    reason:             best.similarity >= SEMANTIC_MIN_SIMILARITY
      ? null
      : `Best similarity ${best.similarity.toFixed(3)} below threshold ${SEMANTIC_MIN_SIMILARITY}.`,
  };
}

function _captureKeywordGate(match, ctxAnchor) {
  if (!match) {
    return {
      score: 0, threshold: MIN_KEYWORD_THRESHOLD, anchorFloor: ANCHOR_FLOOR,
      containerId: null, containerTitle: null, sectionIdx: null, sectionLabel: null,
      anchorBoosted: false, anchorFloorApplied: false, sourceTier: null,
      pass: false, ctxAnchor: ctxAnchor ? String(ctxAnchor) : null,
      reason: `findContainer returned null — best score across all containers < threshold ${MIN_KEYWORD_THRESHOLD}.`,
    };
  }
  return {
    score:              match.score ?? 0,
    threshold:          MIN_KEYWORD_THRESHOLD,
    anchorFloor:        ANCHOR_FLOOR,
    containerId:        match.container?._id ? String(match.container._id) : null,
    containerTitle:     match.container?.title || null,
    sectionIdx:         match.bestSectionIdx ?? null,
    sectionLabel:       match.bestSection?.label || null,
    anchorBoosted:      !!match.anchorBoosted,
    anchorFloorApplied: !!match.anchorFloor,
    sourceTier:         match.sourceTier || null,
    ctxAnchor:          ctxAnchor ? String(ctxAnchor) : null,
    pass:               (match.score ?? 0) >= MIN_KEYWORD_THRESHOLD,
    reason: (match.score ?? 0) >= MIN_KEYWORD_THRESHOLD
      ? null
      : `Score ${match.score} below threshold ${MIN_KEYWORD_THRESHOLD}.`,
  };
}

// ============================================================================
// DATA LOADERS
// ============================================================================

/**
 * Load active containers WITH all embeddings included. Needed for GATE 2.8
 * semantic match. Runtime uses the same direct MongoDB path when embeddings
 * are required — Redis cache omits them because they're large.
 */
async function _loadContainersWithEmbeddings(companyId) {
  return CompanyKnowledgeContainer
    .find({ companyId, isActive: true })
    .select(
      '+embeddingVector ' +
      '+sections.contentEmbedding ' +
      '+sections.callerPhrases.embedding ' +
      '+sections.phraseCoreEmbedding'
    )
    .sort({ priority: 1, createdAt: 1 })
    .lean();
}

// ============================================================================
// DERIVATION HELPERS
// ============================================================================

function _findContainerTitle(containers, containerId) {
  if (!containerId || !Array.isArray(containers)) return null;
  const target = String(containerId);
  const c = containers.find((c) => String(c._id) === target);
  return c?.title || null;
}

/**
 * Derive the most informative failure mode when no gate produced a match.
 * Priority reflects the conceptual "ladder" admins think in:
 *   - If CueExtractor fired nothing, start there (caller's intent unclassified)
 *   - Otherwise, look at which KC gate came closest and explain its miss
 */
function _deriveFailureMode(trace) {
  const cue    = trace.gate_2_4_cueExtractor;
  const uap    = trace.gate_2_5_uap;
  const wordG  = trace.wordGate;
  const coreC  = trace.coreConfirm;
  const sem    = trace.gate_2_8_semantic;

  if (!cue?.pass) return FAILURE_MODE.NO_CUE_MATCH;

  // UAP found a phrase but confirmation gates killed it
  if (uap?.pass && !wordG?.pass && !wordG?.skipped) return FAILURE_MODE.WORD_GATE_FAIL;
  if (uap?.pass && wordG?.pass && coreC && !coreC.pass && !coreC.skipped) return FAILURE_MODE.CORE_CONFIRM_FAIL;

  // UAP found nothing — is there any semantic signal at all?
  if (!uap?.pass) {
    if (sem && sem.bestSimilarity > 0) return FAILURE_MODE.SEMANTIC_WEAK;
    return FAILURE_MODE.PHRASE_NOT_INDEXED;
  }

  // Fall-through: keyword scoring is the last safety net
  return FAILURE_MODE.KEYWORD_BELOW_THRESHOLD;
}

/**
 * Tri-state verdict from the composed pipeline outcome.
 *   resolved — clean hit via any gate, within expected container if specified
 *   weak     — match exists but section missing, score near threshold, or wrong container
 *   failing  — no match (runtime would fall to Claude)
 */
function _computeVerdict({ finalMatch, kwScore, expectedContainerId }) {
  if (!finalMatch) return 'failing';

  // Wrong container when expectation was supplied → weak
  if (expectedContainerId
      && String(expectedContainerId) !== String(finalMatch.containerId)) {
    return 'weak';
  }

  // No section inside container → weak (Groq gets all sections → bad UX)
  if (finalMatch.sectionIdx === null || finalMatch.sectionIdx === undefined) {
    return 'weak';
  }

  // Keyword score near threshold (only when keyword was the winning gate)
  if (finalMatch.source === 'KEYWORD'
      && typeof kwScore === 'number'
      && kwScore < (MIN_KEYWORD_THRESHOLD + WEAK_MARGIN)) {
    return 'weak';
  }

  return 'resolved';
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  replayPhrase,
  FAILURE_MODE,
  _constants: {
    MIN_KEYWORD_THRESHOLD,
    ANCHOR_FLOOR,
    WEAK_MARGIN,
    WORD_GATE_THRESHOLD,
    CORE_CONFIRM_THRESHOLD,
    SEMANTIC_MIN_SIMILARITY,
  },
  // Exposed for targeted tests
  _computeVerdict,
  _deriveFailureMode,
  _runWordGate,
};
