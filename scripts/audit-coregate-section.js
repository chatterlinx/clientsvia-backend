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

if (!companyId || !containerId || !input || anchorWords.length === 0) {
  console.error('Usage: node scripts/audit-coregate-section.js --companyId <id> --containerId <id> --sectionIdx <n> --input "<utterance>" --anchors "a,b,c"');
  process.exit(1);
}
if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set'); process.exit(1); }

// Lessons from yesterday: TWO pools.
const PhraseReducerService     = require('../services/phraseIntelligence/PhraseReducerService');
const SemanticMatchService     = require('../services/engine/kc/SemanticMatchService');
const AnchorSynonymResolver    = require('../services/engine/kc/AnchorSynonymResolver');
const CompanyKnowledgeContainer = require('../models/CompanyKnowledgeContainer');

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

  // ── 5. Print verdict ─────────────────────────────────────────────────────
  hr('═');
  console.log(`SCORING — cosine vs phraseCoreEmbedding (threshold ≥ 0.80)`);
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

  // ── 6. Recommendation ────────────────────────────────────────────────────
  hr('═');
  console.log(`READOUT`);
  hr('═');
  const winners = rows.filter(r => r.score !== null && r.score >= 0.80);
  if (winners.length === 0) {
    console.log('❌ No strategy passes 0.80. Vocabulary mismatch is the bottleneck.');
    console.log('   Likely fix: section\'s callerPhrases need at least one phrase');
    console.log('   that uses the caller\'s actual words ("come back", "somebody").');
    console.log('   Cosine has nothing to grip on if the stored phrases never use');
    console.log('   those tokens.');
  } else {
    const best = winners.reduce((a, b) => (a.score > b.score ? a : b));
    console.log(`✅ Winner: strategy ${best.id} — "${best.label}" — ${fmt(best.score)}`);
    console.log('   Recommend wiring this shape into the Step-2 rescue path.');
  }
  console.log('');

  await cleanup();
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  Promise.allSettled([mongoose.disconnect()]).finally(() => process.exit(1));
});
