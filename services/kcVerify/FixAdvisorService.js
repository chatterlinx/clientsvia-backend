'use strict';

/**
 * ============================================================================
 * FIX ADVISOR SERVICE — LLM-assisted gap fix classification + drafting
 * ============================================================================
 *
 * PURPOSE
 * -------
 * Given a failing gap + its full GapReplayService trace, decide the smallest
 * correct fix and draft the concrete change needed — without ever asking the
 * admin to read 300+ sections of content to figure it out.
 *
 * The advisor classifies each gap into one of FOUR fix types:
 *
 *   ADD_PHRASES        — The caller's idea is ALREADY in a section; we're
 *                        missing the specific WORDING the caller used. Fix:
 *                        add 3-6 new callerPhrases to the existing section.
 *                        (Anchor-word hints supplied.)
 *
 *   AUGMENT_SECTION    — A related section exists but the caller's concern
 *                        is adjacent, not covered. Fix: expand that section's
 *                        content to include the new sub-topic, plus phrases.
 *
 *   NEW_SECTION        — No related section exists in any container. Fix:
 *                        propose a new section with label, content skeleton,
 *                        and 10-15 callerPhrases with anchor words.
 *
 *   ROUTING_PROBLEM    — The content IS there and closely matches, but a
 *                        routing gate is mis-firing (anchor poisoning, negative
 *                        keyword blocking, word gate too strict, etc.). Fix:
 *                        identify the mis-firing gate and recommend a config
 *                        change (noAnchor flag, remove negative keyword, etc.)
 *                        — NOT new content.
 *
 * OVER-BUILD PREVENTION (critical)
 * --------------------------------
 * Before the LLM call, we compute a SIMILARITY SWEEP:
 *   - Embed the caller phrase and compare to every existing callerPhrase's
 *     embedding across ALL active containers
 *   - Compare to every section's phraseCoreEmbedding
 *   - Compare to every section's contentEmbedding
 *
 * The top-K near-misses are passed to the LLM as "SIMILAR EXISTING CONTENT"
 * with a strict rule: if any existing section scores ≥ NEW_SECTION_VETO_THRESHOLD
 * the advisor MUST pick ADD_PHRASES or AUGMENT_SECTION — never NEW_SECTION.
 *
 * This makes it structurally hard for the advisor to recommend duplicate
 * content.  The human admin can still override, but the default strongly
 * biases toward extending existing content.
 *
 * PROMPT DISCIPLINE
 * -----------------
 * We DO NOT send full section `content` or `groqContent` to Claude. Only:
 *   - Container titles
 *   - Section labels
 *   - Up to K similar existing callerPhrases (the piece that actually matters
 *     for ADD_PHRASES decisions)
 *
 * This keeps token cost low and keeps the advisor focused on the routing
 * surface rather than summarizing content. Content generation for NEW_SECTION
 * is bounded (150-250 word skeleton) so the advisor drafts a starting point,
 * not a finished article.
 *
 * OUTPUT SHAPE
 * ------------
 * {
 *   type:             'ADD_PHRASES' | 'AUGMENT_SECTION' | 'NEW_SECTION' | 'ROUTING_PROBLEM',
 *   confidence:       'HIGH' | 'MED' | 'LOW',
 *   target: {
 *     containerId:    <ObjectId string or null>,
 *     kcId:           <string or null>,
 *     containerTitle: <string or null>,
 *     sectionIdx:     <int or null>,
 *     sectionLabel:   <string or null>,
 *   } | null,
 *
 *   proposal: {
 *     // For ADD_PHRASES:
 *     newPhrases?: [
 *       { text: "...", anchorWords: ["..."] }
 *     ],
 *
 *     // For AUGMENT_SECTION:
 *     augmentedContent?: "...",          // ≤ 400 chars
 *     augmentedGroqContent?: "...",      // ≤ 400 chars
 *     newPhrases?: [ { text, anchorWords } ],
 *
 *     // For NEW_SECTION:
 *     suggestedContainerId?: <string>,   // best-fit existing container
 *     suggestedContainerTitle?: <string>,
 *     sectionLabel?: "...",
 *     contentSkeleton?: "...",           // 30-42 words (Fixed)
 *     groqContentSkeleton?: "...",       // 150-250 words (seed)
 *     newPhrases?: [ { text, anchorWords } ],
 *
 *     // For ROUTING_PROBLEM:
 *     misfiringGate?: 'WORD_GATE' | 'NEGATIVE_KEYWORDS' | 'ANCHOR_POISON' | 'THRESHOLD',
 *     recommendation?: "...",
 *   },
 *
 *   reasoning:     "...",                // 1-2 sentences of WHY this fix
 *   nearMisses:    [ ... ],              // similarity-sweep top-5 for UI display
 *   advisorModel:  'claude-3-5-sonnet-<version>',
 *   latencyMs:     <int>,
 *   generatedAt:   <ISO>,
 * }
 *
 * MULTI-TENANT SAFETY
 * -------------------
 * All MongoDB reads scoped by companyId. Anthropic API key read from env.
 * No cross-tenant data ever reaches the advisor's context.
 *
 * ============================================================================
 */

const Anthropic           = require('@anthropic-ai/sdk');
const SemanticMatchService = require('../engine/kc/SemanticMatchService');
const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');
const logger              = require('../../utils/logger');

// ── Configuration ───────────────────────────────────────────────────────────
// Model: matches the production pattern in agentConsole.js:2750 and
// config/llmAgentDefaults.js. Old default 'claude-3-5-sonnet-20241022'
// is deprecated (404 from Anthropic API). Haiku 4.5 handles the
// structured JSON advisor task in ~800-1500ms. Override via env
// FIX_ADVISOR_MODEL (e.g. 'claude-sonnet-4-6' for harder reasoning).
const ADVISOR_MODEL               = process.env.FIX_ADVISOR_MODEL || 'claude-haiku-4-5-20251001';
const ADVISOR_MAX_TOKENS          = 1600;
const ADVISOR_TEMPERATURE         = 0.2;   // deterministic classification
const NEW_SECTION_VETO_THRESHOLD  = 0.80;  // any existing section ≥ this → NEW_SECTION veto
const AUGMENT_HINT_THRESHOLD      = 0.65;  // 0.65-0.79 → strongly hint AUGMENT_SECTION
const NEAR_MISS_TOP_K             = 5;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate a fix proposal for a failing gap.
 *
 * @param {Object} opts
 * @param {string} opts.companyId
 * @param {string} opts.phrase               — raw caller phrase that failed
 * @param {Object} opts.replayTrace          — full trace from GapReplayService.replayPhrase()
 * @param {string} [opts.originalContainerId] — container the runtime thought was the match
 * @param {string} [opts.originalContainerTitle]
 * @returns {Promise<Object>} advisor output (see module docstring)
 */
async function adviseFix({
  companyId,
  phrase,
  replayTrace,
  originalContainerId = null,
  originalContainerTitle = null,
}) {
  const startMs = Date.now();

  if (!companyId || !phrase) {
    throw new Error('[FixAdvisor] companyId and phrase are required');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('[FixAdvisor] ANTHROPIC_API_KEY missing — cannot run advisor');
  }

  // ── STEP 1: Similarity sweep across all active content ──────────────────
  // This is the over-build guard. We find existing content that already
  // covers (or nearly covers) the caller's phrase so the advisor is forced
  // to extend rather than duplicate.
  const { nearMisses, topSimilarity, vetoNewSection } =
    await _runSimilaritySweep({ companyId, phrase });

  // ── STEP 2: Load container catalog (titles + section labels only) ───────
  // This is what the advisor needs to route the fix — not full content.
  const catalog = await _loadContainerCatalog(companyId);

  // ── STEP 3: Build the advisor prompt ────────────────────────────────────
  const { system, user } = _buildAdvisorPrompt({
    phrase,
    replayTrace,
    nearMisses,
    catalog,
    vetoNewSection,
    topSimilarity,
    originalContainerId,
    originalContainerTitle,
  });

  // ── STEP 4: Call Claude Sonnet ──────────────────────────────────────────
  let advisorRaw;
  try {
    const client = new Anthropic({ apiKey });
    const resp   = await client.messages.create({
      model:       ADVISOR_MODEL,
      max_tokens:  ADVISOR_MAX_TOKENS,
      temperature: ADVISOR_TEMPERATURE,
      system,
      messages: [{ role: 'user', content: user }],
    });
    advisorRaw = resp.content?.[0]?.text || '';
  } catch (err) {
    logger.error('[FixAdvisor] Anthropic API error', {
      companyId, err: err.message, status: err.status,
    });
    throw new Error(`Fix Advisor LLM call failed: ${err.message}`);
  }

  // ── STEP 5: Parse + validate ────────────────────────────────────────────
  const parsed = _parseAdvisorJSON(advisorRaw);
  const final  = _postProcess({
    parsed, nearMisses, vetoNewSection, topSimilarity, catalog,
  });

  final.advisorModel = ADVISOR_MODEL;
  final.latencyMs    = Date.now() - startMs;
  final.generatedAt  = new Date().toISOString();

  logger.info('[FixAdvisor] done', {
    companyId,
    phrasePreview: phrase.slice(0, 50),
    type:          final.type,
    confidence:    final.confidence,
    topSimilarity: Number(topSimilarity.toFixed(3)),
    vetoNewSection,
    latencyMs:     final.latencyMs,
  });

  return final;
}

// ============================================================================
// SIMILARITY SWEEP (over-build guard)
// ============================================================================

async function _runSimilaritySweep({ companyId, phrase }) {
  const emptyResult = { nearMisses: [], topSimilarity: 0, vetoNewSection: false };

  try {
    const utteranceVec = await SemanticMatchService.embedText(phrase);
    if (!utteranceVec) return emptyResult;

    const docs = await CompanyKnowledgeContainer
      .find({ companyId, isActive: true })
      .select(
        'title kcId ' +
        '+sections.contentEmbedding ' +
        '+sections.callerPhrases.embedding ' +
        '+sections.phraseCoreEmbedding ' +
        'sections.label sections.callerPhrases.text'
      )
      .lean();

    const hits = [];
    for (const c of docs) {
      for (let sIdx = 0; sIdx < (c.sections || []).length; sIdx++) {
        const s = c.sections[sIdx];

        // A. phraseCoreEmbedding — the strongest signal for "covered topic"
        if (s.phraseCoreEmbedding?.length) {
          const sim = SemanticMatchService.cosineSimilarity(utteranceVec, s.phraseCoreEmbedding);
          if (sim > 0) {
            hits.push({
              containerId:    String(c._id),
              kcId:           c.kcId || null,
              containerTitle: c.title,
              sectionIdx:     sIdx,
              sectionLabel:   s.label,
              similarity:     sim,
              matchSource:    'PHRASE_CORE',
              matchedPhrase:  null,
            });
          }
        }

        // B. individual callerPhrase embeddings — useful for ADD_PHRASES decisions
        for (const p of (s.callerPhrases || [])) {
          if (!p.embedding?.length) continue;
          const sim = SemanticMatchService.cosineSimilarity(utteranceVec, p.embedding);
          if (sim > 0) {
            hits.push({
              containerId:    String(c._id),
              kcId:           c.kcId || null,
              containerTitle: c.title,
              sectionIdx:     sIdx,
              sectionLabel:   s.label,
              similarity:     sim,
              matchSource:    'CALLER_PHRASE',
              matchedPhrase:  p.text,
            });
          }
        }

        // C. contentEmbedding — adjacency signal (weakest, mostly a fallback)
        if (s.contentEmbedding?.length) {
          const sim = SemanticMatchService.cosineSimilarity(utteranceVec, s.contentEmbedding);
          if (sim > 0) {
            hits.push({
              containerId:    String(c._id),
              kcId:           c.kcId || null,
              containerTitle: c.title,
              sectionIdx:     sIdx,
              sectionLabel:   s.label,
              similarity:     sim,
              matchSource:    'CONTENT',
              matchedPhrase:  null,
            });
          }
        }
      }
    }

    // Dedup by (containerId, sectionIdx) — keep the highest similarity
    const bySection = new Map();
    for (const h of hits) {
      const key  = `${h.containerId}:${h.sectionIdx}`;
      const prev = bySection.get(key);
      if (!prev || h.similarity > prev.similarity) bySection.set(key, h);
    }
    const ranked = [...bySection.values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, NEAR_MISS_TOP_K)
      .map((h) => ({ ...h, similarity: Number(h.similarity.toFixed(3)) }));

    const topSimilarity  = ranked[0]?.similarity || 0;
    const vetoNewSection = topSimilarity >= NEW_SECTION_VETO_THRESHOLD;

    return { nearMisses: ranked, topSimilarity, vetoNewSection };
  } catch (err) {
    logger.warn('[FixAdvisor] similarity sweep failed', { companyId, err: err.message });
    return emptyResult;
  }
}

// ============================================================================
// CONTAINER CATALOG (lightweight — titles + section labels only)
// ============================================================================

async function _loadContainerCatalog(companyId) {
  const docs = await CompanyKnowledgeContainer
    .find({ companyId, isActive: true })
    .select('_id kcId title noAnchor tradeVocabularyKey sections.label sections.isActive')
    .sort({ priority: 1 })
    .lean();

  return docs.map((c) => ({
    containerId:        String(c._id),
    kcId:               c.kcId || null,
    title:              c.title,
    noAnchor:           !!c.noAnchor,
    tradeVocabularyKey: c.tradeVocabularyKey || null,
    sections: (c.sections || [])
      .map((s, idx) => ({ idx, label: s.label, isActive: s.isActive !== false }))
      .filter((s) => s.isActive),
  }));
}

// ============================================================================
// PROMPT CONSTRUCTION
// ============================================================================

function _buildAdvisorPrompt({
  phrase, replayTrace, nearMisses, catalog,
  vetoNewSection, topSimilarity,
  originalContainerId, originalContainerTitle,
}) {
  const system = [
    'You are a Knowledge Container (KC) Fix Advisor for a voice-AI HVAC platform.',
    'A caller phrase failed to route to any KC section. Your job is to choose the SMALLEST CORRECT fix.',
    '',
    'FIX TYPES (choose exactly one):',
    '',
    '1. ADD_PHRASES — The section that should handle this phrase ALREADY EXISTS and already covers the topic.',
    '   The caller\'s exact wording is just missing from callerPhrases. Propose 3-6 new callerPhrases + anchor words.',
    '',
    '2. AUGMENT_SECTION — A related section exists but the caller\'s concern is an ADJACENT sub-topic not yet covered.',
    '   Propose short content additions AND 3-6 new callerPhrases.',
    '',
    '3. NEW_SECTION — No existing section covers this topic or anything close to it.',
    '   Propose a section label, a short Fixed content (30-42 words), a Groq content seed (150-250 words), and 10-15 callerPhrases with anchor words.',
    '   Also recommend which existing container to attach it to.',
    '',
    '4. ROUTING_PROBLEM — Existing content DOES cover this topic and scores highly on semantic similarity, but a routing GATE is blocking the match.',
    '   Identify which gate is mis-firing and recommend a config change (NOT new content).',
    '',
    'STRICT RULES:',
    '- If any existing section has semantic similarity ≥ 0.80 to the caller phrase, you MUST NOT choose NEW_SECTION.',
    '- Prefer the smallest fix. ADD_PHRASES > AUGMENT_SECTION > NEW_SECTION.',
    '- Anchor words must be discriminating (not stopwords like "the", "is", "do").',
    '- Reasoning must be 1-2 short sentences.',
    '',
    'OUTPUT: Respond with a SINGLE JSON object inside a fenced code block (```json ... ```).',
    'No prose outside the fenced block. Schema:',
    '',
    '```json',
    '{',
    '  "type": "ADD_PHRASES | AUGMENT_SECTION | NEW_SECTION | ROUTING_PROBLEM",',
    '  "confidence": "HIGH | MED | LOW",',
    '  "target": {',
    '    "containerId": "<id from catalog or null>",',
    '    "sectionIdx": <int or null>',
    '  },',
    '  "proposal": { ...fields per fix type... },',
    '  "reasoning": "<1-2 sentences>"',
    '}',
    '```',
  ].join('\n');

  // ── User message body ────────────────────────────────────────────────────
  const lines = [];
  lines.push('## FAILING CALLER PHRASE');
  lines.push(`"${phrase}"`);
  lines.push('');

  lines.push('## ROUTING FAILURE MODE');
  lines.push(`${replayTrace.failureMode || 'UNKNOWN'} — wouldFallThroughToLLM=${replayTrace.wouldFallThroughToLLM}`);
  lines.push('');

  lines.push('## PER-GATE TRACE (what each gate saw)');
  const t = replayTrace.trace || {};
  lines.push(`- GATE 2.4 CueExtractor: ${t.gate_2_4_cueExtractor?.pass ? 'PASS' : 'FAIL'} — fields fired: ${t.gate_2_4_cueExtractor?.fieldCount || 0}/7, tradeMatches: ${(t.gate_2_4_cueExtractor?.tradeMatches || []).length}`);
  lines.push(`- GATE 2.5 UAP: ${t.gate_2_5_uap?.pass ? `PASS (${t.gate_2_5_uap.matchType})` : 'FAIL'}${t.gate_2_5_uap?.matchedPhrase ? ` — matched "${t.gate_2_5_uap.matchedPhrase}"` : ''}`);
  if (t.wordGate && !t.wordGate.skipped) {
    lines.push(`- WORD GATE: ${t.wordGate.pass ? 'PASS' : 'FAIL'} — ${t.wordGate.matched}/${t.wordGate.required} anchor words found${t.wordGate.missing?.length ? ` (missing: ${t.wordGate.missing.join(', ')})` : ''}`);
  }
  if (t.coreConfirm && !t.coreConfirm.skipped) {
    lines.push(`- CORE CONFIRM: ${t.coreConfirm.pass ? 'PASS' : 'FAIL'} — cosine ${t.coreConfirm.cosine} (threshold ${t.coreConfirm.threshold})`);
  }
  lines.push(`- GATE 2.8 Semantic: ${t.gate_2_8_semantic?.pass ? 'PASS' : 'FAIL'} — best similarity ${t.gate_2_8_semantic?.bestSimilarity || 0} (threshold ${t.gate_2_8_semantic?.threshold || 0.70})`);
  lines.push(`- GATE 3 Keyword: ${t.gate_3_keyword?.pass ? 'PASS' : 'FAIL'} — score ${t.gate_3_keyword?.score || 0} (threshold ${t.gate_3_keyword?.threshold || 8})`);
  lines.push('');

  if (originalContainerId) {
    lines.push(`## ORIGINAL CONTAINER AT TIME OF FAILURE`);
    lines.push(`${originalContainerTitle || '(unknown)'} (id: ${originalContainerId})`);
    lines.push('');
  }

  lines.push('## SIMILAR EXISTING CONTENT (semantic sweep across ALL active sections)');
  if (nearMisses.length === 0) {
    lines.push('_No existing content has measurable semantic overlap with the caller phrase._');
    lines.push('_(Green-field — NEW_SECTION is likely appropriate if no routing issue is present.)_');
  } else {
    lines.push('| # | Similarity | Container → Section | Match Source | Example Phrase |');
    lines.push('|---|------------|--------------------|--------------|----------------|');
    nearMisses.forEach((nm, i) => {
      const phraseCell = nm.matchedPhrase
        ? `"${String(nm.matchedPhrase).slice(0, 60)}"`
        : '—';
      lines.push(`| ${i + 1} | ${nm.similarity} | ${nm.containerTitle} → ${nm.sectionLabel} | ${nm.matchSource} | ${phraseCell} |`);
    });
    lines.push('');
    if (vetoNewSection) {
      lines.push(`**VETO: top similarity ${topSimilarity} ≥ ${NEW_SECTION_VETO_THRESHOLD} — you MUST pick ADD_PHRASES or AUGMENT_SECTION (or ROUTING_PROBLEM if the gate trace shows a mis-fire).**`);
    } else if (topSimilarity >= AUGMENT_HINT_THRESHOLD) {
      lines.push(`*Hint: top similarity ${topSimilarity} suggests AUGMENT_SECTION is likely the right fix.*`);
    }
  }
  lines.push('');

  // ── Container catalog (titles + section labels, no content) ──────────────
  lines.push('## KNOWLEDGE CONTAINER CATALOG (this company — titles + section labels only)');
  for (const c of catalog) {
    const flags = [
      c.noAnchor              ? 'noAnchor'           : null,
      c.tradeVocabularyKey    ? `trade=${c.tradeVocabularyKey}` : null,
    ].filter(Boolean).join(', ');
    lines.push(`- **${c.title}** [${c.containerId}${flags ? ` · ${flags}` : ''}]`);
    for (const s of c.sections) {
      lines.push(`    - §${s.idx}: ${s.label}`);
    }
  }
  lines.push('');

  lines.push('Return your fix proposal as the single JSON object specified in the system prompt.');

  return { system, user: lines.join('\n') };
}

// ============================================================================
// RESPONSE PARSING + POST-PROCESS
// ============================================================================

function _parseAdvisorJSON(raw) {
  // Claude sometimes wraps JSON in ```json ... ``` fences; sometimes returns bare JSON.
  // Be forgiving.
  let text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  // Fallback: slice from first { to last }
  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last  = text.lastIndexOf('}');
    if (first >= 0 && last > first) text = text.slice(first, last + 1);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    logger.warn('[FixAdvisor] JSON parse failed', { rawPreview: raw.slice(0, 200), err: err.message });
    return null;
  }
}

function _postProcess({ parsed, nearMisses, vetoNewSection, topSimilarity, catalog }) {
  const VALID = ['ADD_PHRASES', 'AUGMENT_SECTION', 'NEW_SECTION', 'ROUTING_PROBLEM'];
  const CONF  = ['HIGH', 'MED', 'LOW'];

  const defaultReturn = {
    type:       'NEW_SECTION',
    confidence: 'LOW',
    target:     null,
    proposal:   {},
    reasoning:  'Advisor response could not be parsed — defaulting to NEW_SECTION at LOW confidence. Review manually.',
    nearMisses,
    vetoed:     false,
    vetoReason: null,
  };

  if (!parsed || typeof parsed !== 'object') return defaultReturn;

  let { type, confidence, target, proposal, reasoning } = parsed;

  if (!VALID.includes(type))       type       = 'NEW_SECTION';
  if (!CONF.includes(confidence))  confidence = 'LOW';

  // ── Enforce the over-build veto on the server even if the LLM ignored it ──
  let vetoed     = false;
  let vetoReason = null;
  if (vetoNewSection && type === 'NEW_SECTION') {
    // Find the top near-miss and downgrade to AUGMENT
    const top = nearMisses[0];
    type   = 'AUGMENT_SECTION';
    target = {
      containerId: top.containerId,
      sectionIdx:  top.sectionIdx,
    };
    proposal = {
      ...(proposal || {}),
      _overrideNotice: `Advisor proposed NEW_SECTION but similarity sweep found "${top.containerTitle} → ${top.sectionLabel}" at ${top.similarity}. Downgraded to AUGMENT_SECTION.`,
      newPhrases:      proposal?.newPhrases || [],
    };
    confidence = 'MED';
    reasoning  = `Server veto: existing section "${top.sectionLabel}" is too similar (${top.similarity}) for a new section. Extend it instead.`;
    vetoed     = true;
    vetoReason = `similarity ${top.similarity} ≥ ${NEW_SECTION_VETO_THRESHOLD}`;
  }

  // ── Hydrate target with container title + section label from catalog ────
  if (target?.containerId) {
    const c = catalog.find((x) => x.containerId === String(target.containerId));
    if (c) {
      target.kcId            = c.kcId;
      target.containerTitle  = c.title;
      if (typeof target.sectionIdx === 'number') {
        const s = c.sections.find((s) => s.idx === target.sectionIdx);
        if (s) target.sectionLabel = s.label;
      }
    }
  }

  return {
    type,
    confidence,
    target:    target || null,
    proposal:  proposal || {},
    reasoning: reasoning || '',
    nearMisses,
    vetoed,
    vetoReason,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  adviseFix,
  _constants: {
    ADVISOR_MODEL,
    NEW_SECTION_VETO_THRESHOLD,
    AUGMENT_HINT_THRESHOLD,
    NEAR_MISS_TOP_K,
  },
  // exposed for tests
  _runSimilaritySweep,
  _parseAdvisorJSON,
  _postProcess,
};
