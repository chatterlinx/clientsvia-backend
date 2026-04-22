/**
 * ═══════════════════════════════════════════════════════════════════════════
 * diag-uap-misses.js — Drill-down on why UAP Layer 1 missed every turn
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FOLLOW-UP TO diag-uap-bridge.js
 * --------------------------------
 * First diagnostic proved:
 *   ✅ Bridge Redis key healthy (6705 phrases, v5)
 *   ✅ Corpus quality excellent ("cool":1703, "thermostat":298, etc.)
 *   ✅ UAP IS firing (6 UAP_LAYER1 events across 10 calls)
 *   ❌ 0 hits / 6 misses — gate rejecting every candidate
 *
 * This script reads the last N UAP_LAYER1 qaLog entries with hit=false and
 * dumps the uapDiagnostic.anchorGate + coreGate fields so we can see
 * exactly which gate fired and why:
 *
 *   anchorGate: null                     → UAP found NO phrase candidate
 *   anchorGate.passed=false              → Logic 1 Word Gate rejected (anchor words missing)
 *   anchorGate.passed=true + coreGate... → Logic 2 Core Confirmation rejected (embedding <0.80)
 *   belowThreshold=true                  → confidence <0.8, fuzzy recovery fell through
 *
 * MULTI-TENANT SAFETY
 * -------------------
 * companyId required CLI arg — never hardcoded.
 *
 * USAGE
 * -----
 *   node scripts/diag-uap-misses.js <companyId> [limit=20]
 *
 * READ-ONLY — no writes to Redis or MongoDB.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID = process.argv[2];
const LIMIT      = parseInt(process.argv[3], 10) || 20;

if (!COMPANY_ID) {
  console.error('❌ Usage: node scripts/diag-uap-misses.js <companyId> [limit=20]');
  process.exit(1);
}

(async () => {
  if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set'); process.exit(1); }

  const mongo = await MongoClient.connect(process.env.MONGODB_URI);
  const db    = mongo.db('clientsvia');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  UAP LAYER 1 MISS DRILL-DOWN');
  console.log('  companyId: ' + COMPANY_ID);
  console.log('  limit:     last ' + LIMIT + ' miss events');
  console.log('═══════════════════════════════════════════════════════════════');

  // Pull recent customers with qaLog, flatten UAP_LAYER1 events across calls
  const recent = await db.collection('customers').aggregate([
    { $match: { companyId: new ObjectId(COMPANY_ID), 'discoveryNotes.qaLog': { $exists: true } } },
    { $sort: { updatedAt: -1 } },
    { $limit: 10 },
    { $project: { phone: 1, discoveryNotes: { $slice: ['$discoveryNotes', -20] } } }
  ]).toArray();

  const events = [];
  recent.forEach(c => {
    (c.discoveryNotes || []).forEach(dn => {
      (dn.qaLog || []).forEach(q => {
        if (q.type === 'UAP_LAYER1' && q.hit !== true) {
          events.push({
            callSid:      dn.callSid,
            phone:        c.phone,
            ts:           q.timestamp,
            turn:         q.turn,
            question:     q.question,
            containerId:  q.containerId,
            kcId:         q.kcId,
            sectionIdx:   q.sectionIdx,
            sectionId:    q.sectionId,
            confidence:   q.confidence,
            matchType:    q.matchType,
            phrase:       q.phrase,
            anchorGate:   q.anchorGate,
            coreGate:     q.coreGate,
            topicWords:   q.topicWords,
            belowThreshold: q.belowThreshold,
            fuzzyRecovery: q.fuzzyRecovery,
          });
        }
      });
    });
  });

  events.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  const shown = events.slice(0, LIMIT);

  console.log('\nTotal UAP_LAYER1 miss events found: ' + events.length);
  console.log('Showing most recent: ' + shown.length);
  console.log('');

  // Per-event dump
  shown.forEach((e, i) => {
    console.log('─────────────────────────────────────────────────────────────');
    console.log('MISS #' + (i + 1) + '  ' + (e.callSid || '?') + '  turn=' + e.turn);
    console.log('  ts:        ' + e.ts);
    console.log('  question:  ' + JSON.stringify((e.question || '').slice(0, 200)));
    console.log('  matched phrase: ' + JSON.stringify(e.phrase || '(none — no candidate)'));
    console.log('  matchType: ' + (e.matchType || 'NONE'));
    console.log('  confidence: ' + (e.confidence !== undefined ? e.confidence : 'n/a'));
    console.log('  kcId/sectionIdx: ' + (e.kcId || '?') + ' / ' + (e.sectionIdx ?? '?'));

    if (e.belowThreshold) {
      console.log('  🔶 BELOW_THRESHOLD — confidence < 0.8 (path: fuzzy recovery fell through)');
    }

    if (!e.anchorGate && !e.phrase) {
      console.log('  🔴 NO CANDIDATE — UAP found ZERO matching phrases in the bridge');
      console.log("     (caller's words don't overlap any indexed phrase after normalisation)");
    } else if (e.anchorGate) {
      const ag = e.anchorGate;
      console.log('  anchorGate (Logic 1 — Word Gate):');
      console.log('    required:  ' + ag.required);
      console.log('    hits:      ' + ag.hits);
      console.log('    ratio:     ' + ag.ratio + ' (threshold ' + ag.threshold + ')');
      console.log('    passed:    ' + ag.passed + '   reason: ' + ag.reason);
      if (ag.missed && ag.missed.length) {
        console.log('    missed:    ' + JSON.stringify(ag.missed));
      }
    }

    if (e.coreGate) {
      const cg = e.coreGate;
      console.log('  coreGate (Logic 2 — Core Confirmation):');
      console.log('    similarity: ' + cg.similarity);
      console.log('    threshold:  ' + cg.threshold);
      console.log('    passed:     ' + cg.passed + '   reason: ' + cg.reason);
    }

    if (e.topicWords && e.topicWords.length) {
      console.log('  topicWords (UAP-extracted): ' + JSON.stringify(e.topicWords.slice(0, 10)));
    }
    console.log('');
  });

  // ── Aggregate — which gate rejected most often? ──────────────────────────
  let noCandidate = 0, l1Fail = 0, l1PassL2Fail = 0, belowConf = 0, other = 0;
  events.forEach(e => {
    if (e.belowThreshold)                                    belowConf++;
    else if (!e.anchorGate && !e.phrase)                     noCandidate++;
    else if (e.anchorGate && !e.anchorGate.passed)           l1Fail++;
    else if (e.anchorGate?.passed && e.coreGate?.passed === false) l1PassL2Fail++;
    else                                                     other++;
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  MISS BREAKDOWN (all ' + events.length + ' events)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🔴 NO CANDIDATE (phrase lookup returned null): ' + noCandidate);
  console.log('  🔶 LOGIC 1 FAIL (anchor words missing):        ' + l1Fail);
  console.log('  🔶 LOGIC 2 FAIL (semantic confidence <0.80):   ' + l1PassL2Fail);
  console.log('  🔷 BELOW THRESHOLD (confidence <0.8):          ' + belowConf);
  console.log('  ⚪ OTHER / MIXED:                               ' + other);
  console.log('');
  console.log('FIX GUIDANCE:');
  if (noCandidate > l1Fail && noCandidate > l1PassL2Fail) {
    console.log('  → Majority are phrase-lookup misses. Callers phrase things the');
    console.log("    authored corpus doesn't cover. Run Phrase Finder on the exact");
    console.log('    questions above and add missing variants.');
  } else if (l1Fail > 0) {
    console.log('  → Majority are Logic 1 Word Gate rejections. Anchor words on the');
    console.log('    matched sections are too strict. Inspect the "missed" anchor words');
    console.log('    above — those are the discriminators the caller never said.');
    console.log('    Either (a) lower ANCHOR_MATCH_THRESHOLD (global), or (b) re-score');
    console.log('    those sections to auto-populate anchors from core words (per-section).');
  } else if (l1PassL2Fail > 0) {
    console.log('  → Majority are Logic 2 Core rejections. Semantic threshold 0.80 is');
    console.log('    rejecting valid matches. Consider lowering Logic 2 threshold or');
    console.log('    re-generating phraseCoreEmbedding for affected sections.');
  }
  console.log('');

  await mongo.close();
  process.exit(0);
})().catch(e => {
  console.error('DIAGNOSTIC ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
