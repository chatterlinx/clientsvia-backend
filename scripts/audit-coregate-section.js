#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * audit-coregate-section.js — Forensic audit of one section's Logic-2 gate
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * -------
 * After the CAe8e444a9 replay showed Step-2 rescue scoring 0.50 (vs 0.51 for
 * Logic-2 full) on the "Do I have to pay again" section, we need to know
 * exactly what we're scoring against before iterating on the rescue strategy.
 *
 * The asymmetry hypothesis: section's `phraseCoreEmbedding` is built from
 * PhraseReducerService output (intent-normalized, stopword-stripped, tight),
 * but the rescue embeds RAW window text. Different shapes → bounded cosine.
 *
 * This script dumps the actual stored `phraseCore` text + tries 4 scoring
 * strategies for a given caller input, so we can pick the winning approach
 * with data instead of guessing:
 *
 *   A. Logic-2 full         — caller utterance reduced to topicWords-style
 *                              (mirrors what UAP feeds in production)
 *   B. Rescue raw           — anchor-anchored window, raw
 *   C. Rescue reduced       — anchor-anchored window run through
 *                              PhraseReducerService (symmetric with section)
 *   D. Anchor-only          — just the matched anchor stems joined
 *
 * USAGE
 * -----
 *   node scripts/audit-coregate-section.js \
 *     --companyId   68e3f77a9d623b8058c700c4 \
 *     --containerId 69e8dbade3a70247b2a15dee \
 *     --sectionIdx  0 \
 *     --input       "How much is that cost to have some? Do I have to pay for somebody to come back here again?" \
 *     --anchors     "pay,again"
 *
 * READ-ONLY against Mongo. No writes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

try { require('dotenv').config(); } catch (_e) { /* optional */ }

const { MongoClient, ObjectId } = require('mongodb');
const mongoose                  = require('mongoose');

// ── CLI ──────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const ix = process.argv.indexOf(`--${name}`);
  return ix !== -1 ? process.argv[ix + 1] : fallback;
}
const companyId    = arg('companyId');
const containerId  = arg('containerId');
const sectionIdx   = parseInt(arg('sectionIdx', '0'), 10);
const input        = arg('input');
const anchorsCsv   = arg('anchors', '');
const anchorWords  = anchorsCsv.split(',').map(s => s.trim()).filter(Boolean);
// Multi-input flags — pipe-separated so individual inputs can contain commas.
// Defaults provide a reasonable threshold-calibration set if none passed.
const positivesArg = arg('positives', null);
const negativesArg = arg('negatives', null);
const DEFAULT_POSITIVES = [
  // Same intent ("will I be charged again for the same trip"), different surface forms.
  'do i have to pay for somebody to come back',
  'will i be charged again for another visit',
  'is there a fee if you have to come out twice',
  'do i pay again for the same problem',
];
const DEFAULT_NEGATIVES = [
  // Pure off-topic — wouldn't reach Logic 2 (no anchor match), but tests the floor.
  'what time do you open',
  'i need to schedule an appointment',
  'the technician already came yesterday',
  // Anchor false positives — these CAN reach Logic 2 because they share anchor
  // words with the section ("pay" / "again"). The new gate must reject them.
  'do you have to pay for parking again',
  'i can pay you again next time we talk',
  'come back and tell me again what your name is',
];
const positives = (positivesArg
  ? positivesArg.split('|').map(s => s.trim()).filter(Boolean)
  : DEFAULT_POSITIVES);
const negatives = (negativesArg
  ? negativesArg.split('|').map(s => s.trim()).filter(Boolean)
  : DEFAULT_NEGATIVES);

if (!companyId || !containerId || !input || anchorWords.length === 0) {
  console.error('Usage: node scripts/audit-coregate-section.js --companyId <id> --containerId <id> --sectionIdx <n> --input "<utterance>" --anchors "a,b,c" [--positives "p1|p2|..."] [--negatives "n1|n2|..."]');
  process.exit(1);
}
if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set'); process.exit(1); }

// Lessons from yesterday: TWO pools.
const PhraseReducerService     = require('../services/phraseIntelligence/PhraseReducerService');
const SemanticMatchService     = require('../services/engine/kc/SemanticMatchService');
const AnchorSynonymResolver    = require('../services/engine/kc/AnchorSynonymResolver');
const CompanyKnowledgeContainer = require('../models/CompanyKnowledgeContainer');
const PhraseEmbedding           = require('../models/PhraseEmbedding');

// ── HELPERS ──────────────────────────────────────────────────────────────────

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return null;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma  += a[i] * a[i];
    mb  += b[i] * b[i];
  }
  return (ma && mb) ? dot / (Math.sqrt(ma) * Math.sqrt(mb)) : 0;
}

function tokenize(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function fmt(n) { return n === null ? '   ---' : n.toFixed(4); }

const hr = (c = '─', n = 90) => console.log(c.repeat(n));

// ── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI);
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'clientsvia' });

  const cleanup = async () => {
    try { await mongoose.disconnect(); } catch (_e) { /* */ }
    try { await mongo.close(); }       catch (_e) { /* */ }
  };

  // ── 1. Load section with hidden phraseCoreEmbedding ──────────────────────
  const containerDoc = await CompanyKnowledgeContainer.findById(containerId)
    .select('+sections.phraseCoreEmbedding')
    .lean();

  if (!containerDoc) {
    console.error(`❌ Container ${containerId} not found`);
    await cleanup();
    process.exit(1);
  }
  const section = containerDoc.sections?.[sectionIdx];
  if (!section) {
    console.error(`❌ Section index ${sectionIdx} not found in container "${containerDoc.title}"`);
    await cleanup();
    process.exit(1);
  }

  // ── 2. Dump stored section data ──────────────────────────────────────────
  hr('═');
  console.log(`SECTION AUDIT — "${containerDoc.title}" → "${section.label}"`);
  hr('═');
  console.log(`containerId:        ${containerId}`);
  console.log(`sectionIdx:         ${sectionIdx}`);
  console.log(`phraseCore (text):  ${JSON.stringify(section.phraseCore || '(none)')}`);
  console.log(`contentCore (text): ${JSON.stringify(section.contentCore || '(none)')}`);
  console.log(`phraseCoreEmbedding length: ${section.phraseCoreEmbedding?.length || 0}`);
  console.log(`phraseCoreEmbedding[0..2]:  ${section.phraseCoreEmbedding?.slice(0, 3).map(x => x.toFixed(4)).join(', ') || '(none)'}`);
  console.log(`phraseScoreHash:    ${section.phraseScoreHash || '(none — Re-score not run since edit)'}`);
  console.log(`phraseCoreScoredAt: ${section.phraseCoreScoredAt || '(never)'}`);
  console.log(`callerPhrases (${section.callerPhrases?.length || 0}):`);
  (section.callerPhrases || []).slice(0, 12).forEach((p, i) => {
    console.log(`  [${i}] ${JSON.stringify(p.text)}`);
  });
  console.log('');

  if (!section.phraseCoreEmbedding?.length) {
    console.error('❌ Section has no phraseCoreEmbedding — Re-score required before audit can run.');
    await cleanup();
    process.exit(1);
  }

  const phraseCoreEmb = section.phraseCoreEmbedding;
  const sectionContentText = `${section.label || ''} ${section.content || ''}`.trim();

  // ── 3. Build the four caller-side variants ───────────────────────────────
  hr('═');
  console.log(`AUDIT INPUT`);
  hr('═');
  console.log(`raw input:    ${JSON.stringify(input)}`);
  console.log(`anchorWords:  [${anchorWords.join(', ')}]`);
  console.log('');

  // -- A. Logic-2 full (mirrors production: topicWords-style content tokens)
  // Production passes `(uapResult.topicWords || []).join(' ')`. We don't have
  // a UAP run here, so simulate the same shape via PhraseReducerService —
  // the PRINCIPLE production uses for whittling is the same reducer at
  // re-score time, and runtime topicWords come from a similar stop-stripped
  // tokenization. This is the closest faithful reproduction without hooking
  // the full UAP pipeline.
  const callerReduction = await PhraseReducerService.reduce(input, sectionContentText);
  const callerCoreFull  = callerReduction.core || '';

  // -- B. Rescue raw — anchor-anchored window, raw text (current Step-2)
  // Build a synonym map so the resolver can find anchors via synonym (matches
  // production behaviour). We pass nothing — the resolver tolerates an empty
  // map; literal/stem matches on the anchor words themselves are sufficient
  // for window placement when anchors appear literally in input.
  const synonymMap = new Map();
  const winRaw = AnchorSynonymResolver.computeAnchorAnchoredWindow({
    rawInput:     input,
    anchorWords,
    synonymMap,
    paddingWords: 2,
  });
  const rescueRaw = winRaw?.window || '';

  // -- C. Rescue reduced — same window, run through PhraseReducerService
  //   This is the symmetry hypothesis: section side reduces, rescue should too.
  const winReduction = rescueRaw ? await PhraseReducerService.reduce(rescueRaw, sectionContentText) : null;
  const rescueReduced = winReduction?.core || '';

  // -- D. Anchor-only — just the matched anchor stems joined
  //   Tightest possible rescue. No padding.
  const anchorOnly = anchorWords.join(' ');

  // ── 4. Embed all four + score ────────────────────────────────────────────
  const [embA, embB, embC, embD] = await Promise.all([
    callerCoreFull ? SemanticMatchService.embedText(callerCoreFull) : Promise.resolve(null),
    rescueRaw      ? SemanticMatchService.embedText(rescueRaw)      : Promise.resolve(null),
    rescueReduced  ? SemanticMatchService.embedText(rescueReduced)  : Promise.resolve(null),
    anchorOnly     ? SemanticMatchService.embedText(anchorOnly)     : Promise.resolve(null),
  ]);

  const scores = {
    A: { text: callerCoreFull, score: cosine(embA, phraseCoreEmb), embedded: !!embA },
    B: { text: rescueRaw,      score: cosine(embB, phraseCoreEmb), embedded: !!embB },
    C: { text: rescueReduced,  score: cosine(embC, phraseCoreEmb), embedded: !!embC },
    D: { text: anchorOnly,     score: cosine(embD, phraseCoreEmb), embedded: !!embD },
  };

  // ── 5. Print verdict — kitchen-sink phraseCore comparison ────────────────
  hr('═');
  console.log(`PART 1 — cosine vs section.phraseCoreEmbedding (current Logic-2 target)`);
  console.log(`         threshold ≥ 0.80`);
  hr('═');
  const rows = [
    { id: 'A', label: 'Logic-2 full (reduced caller)', ...scores.A },
    { id: 'B', label: 'Rescue raw (current Step-2)',   ...scores.B },
    { id: 'C', label: 'Rescue reduced (symmetric)',    ...scores.C },
    { id: 'D', label: 'Anchor-only (stems joined)',    ...scores.D },
  ];
  for (const r of rows) {
    const pass = r.score !== null && r.score >= 0.80;
    const flag = pass ? '✅' : '❌';
    console.log(`  ${r.id}. ${r.label.padEnd(34)}  score=${fmt(r.score)} ${flag}`);
    console.log(`     text: ${JSON.stringify(r.text || '(empty)')}`);
  }
  console.log('');

  // ── 5b. PER-PHRASE MAX — alternative architecture ────────────────────────
  // Per-phrase 512-dim embeddings already exist in the PhraseEmbedding sidecar
  // collection — built at the same Re-score that builds phraseCore. They're
  // tight, focused, ONE-PHRASE-EACH vectors. The thesis: comparing the
  // caller's vector to EACH stored phrase and taking max should bypass the
  // kitchen-sink centroid problem entirely. This part of the audit confirms
  // (with real data) whether the architectural fix works.
  hr('═');
  console.log(`PART 2 — cosine vs section.callerPhrases[].embedding (per-phrase MAX)`);
  console.log(`         threshold ≥ 0.80 — same threshold, different target`);
  hr('═');

  // Load per-phrase embeddings for this container, filter to the section's
  // callerPhrase texts (normalized: trim+lower) so cross-section bleed is
  // impossible.
  const sectionPhraseTexts = new Set(
    (section.callerPhrases || [])
      .map(p => String(p.text || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const allPhraseEmbs = await PhraseEmbedding
    .find({ containerId })
    .select('phraseText embedding')
    .lean();

  const sectionPhraseEmbs = allPhraseEmbs.filter(r =>
    sectionPhraseTexts.has(String(r.phraseText || '').trim().toLowerCase())
  );

  console.log(`per-phrase embeddings loaded: ${allPhraseEmbs.length} (container) → ${sectionPhraseEmbs.length} (this section)`);
  console.log('');

  if (sectionPhraseEmbs.length === 0) {
    console.log('⚠️  No per-phrase embeddings found for this section — sidecar not populated.');
    console.log('    Re-score may need to run, or PhraseEmbeddingService.saveBatch failed previously.');
  } else {
    // Score each caller-side variant against the BEST per-phrase match.
    const variants = [
      { id: 'A', label: 'Logic-2 full (reduced caller)', emb: embA, text: callerCoreFull },
      { id: 'B', label: 'Rescue raw (current Step-2)',   emb: embB, text: rescueRaw },
      { id: 'C', label: 'Rescue reduced (symmetric)',    emb: embC, text: rescueReduced },
      { id: 'D', label: 'Anchor-only (stems joined)',    emb: embD, text: anchorOnly },
    ];

    for (const v of variants) {
      if (!v.emb) {
        console.log(`  ${v.id}. ${v.label.padEnd(34)}  (no embed)`);
        continue;
      }
      let bestScore = -Infinity;
      let bestText  = null;
      for (const row of sectionPhraseEmbs) {
        const s = cosine(v.emb, row.embedding);
        if (s !== null && s > bestScore) { bestScore = s; bestText = row.phraseText; }
      }
      const pass = bestScore >= 0.80;
      const flag = pass ? '✅' : '❌';
      console.log(`  ${v.id}. ${v.label.padEnd(34)}  MAX=${fmt(bestScore)} ${flag}`);
      console.log(`     caller text:    ${JSON.stringify(v.text || '(empty)')}`);
      console.log(`     winning phrase: ${JSON.stringify(bestText || '(none)')}`);
    }
  }
  console.log('');

  // ── 5c. PART 3 — threshold sweep (positives vs negatives) ────────────────
  // Per-phrase MAX is only safe to ship if it cleanly separates on-topic
  // paraphrases from off-topic utterances. We embed each test input raw
  // (no windowing — embedding-3-small handles short text fine) and compute
  // per-phrase MAX vs the same section's stored phrase embeddings.
  //
  // Two flavors of negative are critical:
  //   (a) pure off-topic — no anchor words. Wouldn't reach Logic 2 in
  //       production but tests the absolute score floor of unrelated text.
  //   (b) anchor false positives — share anchor words with the section but
  //       carry a different intent ("pay for parking again"). These DO reach
  //       Logic 2 and are the actual things we need the gate to reject.
  //
  // The threshold candidates [0.70, 0.75, 0.78, 0.80] mark which thresholds
  // each input passes. The right threshold is the highest one that:
  //   ✅ all positives pass    AND   ✅ all negatives reject
  hr('═');
  if (sectionPhraseEmbs.length === 0) {
    console.log('PART 3 — threshold sweep — SKIPPED (no per-phrase embeddings)');
    hr('═');
  } else {
    console.log(`PART 3 — threshold sweep over per-phrase MAX (positives vs negatives)`);
    console.log(`         positives: ${positives.length} inputs   negatives: ${negatives.length} inputs`);
    hr('═');

    // Embed all test inputs in a single batch round-trip per side.
    const testInputs = [
      ...positives.map(t => ({ text: t, kind: 'positive' })),
      ...negatives.map(t => ({ text: t, kind: 'negative' })),
    ];
    const allEmbs = await Promise.all(
      testInputs.map(t => SemanticMatchService.embedText(t.text))
    );

    // Per-input: compute MAX over section's phrase embeddings.
    const results = testInputs.map((t, i) => {
      const emb = allEmbs[i];
      if (!emb) return { ...t, max: null, winner: null };
      let best = -Infinity, winText = null;
      for (const row of sectionPhraseEmbs) {
        const s = cosine(emb, row.embedding);
        if (s !== null && s > best) { best = s; winText = row.phraseText; }
      }
      return { ...t, max: best, winner: winText };
    });

    const THRESHOLDS = [0.70, 0.75, 0.78, 0.80];
    const colW = 8;

    // Print table header
    const hdrThresh = THRESHOLDS.map(t => `≥${t.toFixed(2)}`.padStart(colW)).join('');
    console.log('');
    console.log(`  kind      MAX     ${hdrThresh}   input → winning phrase`);
    console.log('  ' + '─'.repeat(96));

    for (const r of results) {
      if (r.max === null) {
        console.log(`  ${r.kind.padEnd(9)} (no embed)`);
        continue;
      }
      const cells = THRESHOLDS.map(t => {
        const passes = r.max >= t;
        // For positives we WANT pass (✅). For negatives we WANT reject (✅).
        const correct = (r.kind === 'positive') ? passes : !passes;
        return (correct ? '✅' : '❌').padStart(colW);
      }).join('');
      const arrow = r.kind === 'positive' ? '→' : '⊘';
      console.log(`  ${r.kind.padEnd(9)} ${fmt(r.max)} ${cells}   "${r.text.slice(0, 40)}${r.text.length > 40 ? '…' : ''}"`);
      console.log(`            ${' '.repeat(colW * THRESHOLDS.length + 6)}   ${arrow} "${(r.winner || '').slice(0, 60)}"`);
    }
    console.log('');

    // ── Separation analysis ────────────────────────────────────────────────
    const posMin = Math.min(...results.filter(r => r.kind === 'positive' && r.max !== null).map(r => r.max));
    const negMax = Math.max(...results.filter(r => r.kind === 'negative' && r.max !== null).map(r => r.max));
    const gap   = posMin - negMax;
    console.log(`  separation:  min(positive) = ${fmt(posMin)}    max(negative) = ${fmt(negMax)}    gap = ${fmt(gap)}`);
    console.log('');
    if (gap > 0) {
      // Pick threshold midway in the gap, biased slightly toward negMax to
      // forgive paraphrasing more than to admit false positives.
      const recThresh = Math.round(((negMax + (posMin - negMax) * 0.4)) * 100) / 100;
      console.log(`  ✅ Clean separation. Recommended threshold: ${recThresh.toFixed(2)}`);
      console.log(`     (admits all ${results.filter(r => r.kind === 'positive').length} positives, rejects all ${results.filter(r => r.kind === 'negative').length} negatives in this set)`);
    } else {
      console.log(`  ⚠️  No clean threshold. min(positive) ≤ max(negative) — overlap zone.`);
      console.log(`     Architectural change alone won't suffice. Either:`);
      console.log(`       - add the missing positive paraphrase to section.callerPhrases, OR`);
      console.log(`       - add a secondary signal (negative keyword check, anchor proximity)`);
      console.log(`         to disambiguate the overlapping inputs.`);
    }
    console.log('');
  }

  // ── 6. Readout ───────────────────────────────────────────────────────────
  hr('═');
  console.log(`READOUT`);
  hr('═');
  console.log(`PART 1 (vs phraseCoreEmbedding): all 4 strategies fail → kitchen-sink`);
  console.log(`        centroid is in the wrong region of embedding space for short`);
  console.log(`        focused utterances. This is the architecture issue.`);
  console.log('');
  console.log(`PART 2 (per-phrase MAX): scores how well per-phrase MAX cosine works`);
  console.log(`        against the SAME caller variants we tested in Part 1. If the`);
  console.log(`        scores jumped meaningfully, the architecture pivot is real.`);
  console.log('');
  console.log(`PART 3 (threshold sweep): the recommendation is only valid if positives`);
  console.log(`        and negatives separate cleanly. The "gap" line is the answer:`);
  console.log(`        positive gap → ship the architectural change at the recommended`);
  console.log(`        threshold. Negative gap → the section's vocabulary needs a new`);
  console.log(`        callerPhrase OR Logic 2 needs a secondary signal beyond cosine.`);
  console.log('');

  await cleanup();
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  Promise.allSettled([mongoose.disconnect()]).finally(() => process.exit(1));
});
