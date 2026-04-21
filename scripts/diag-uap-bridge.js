/**
 * ═══════════════════════════════════════════════════════════════════════════
 * diag-uap-bridge.js — UAP Layer 1 phrase-index health diagnostic
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS
 * ----------------
 * The /agent-console/uap.html Calibration tab showed 0% UAP hit rate across
 * 16 KC-pipeline turns in 24h, while gap page showed 22 Section Gaps +
 * 16 UAP Miss → Groq. That pattern says GATE 2.5 never fires. Possible causes:
 *
 *   A. Bridge Redis key missing or stale     → UAP has no phrase index to query
 *   B. Bridge present but corpus-sparse       → phrases don't match callers say
 *   C. Container has phrases but bridge lost   → BridgeService build bug
 *   D. Container has ZERO phrases at source   → authoring gap
 *   E. UAP runs but confidence always <0.8    → anchor gate rejecting all
 *
 * This script inspects all 5 in one run.
 *
 * MULTI-TENANT SAFETY
 * -------------------
 * companyId is a REQUIRED CLI arg — NEVER hardcoded. Pass it at invocation:
 *
 *   node scripts/diag-uap-bridge.js 68e3f77a9d623b8058c700c4
 *
 * USAGE (Render shell)
 * --------------------
 *   node scripts/diag-uap-bridge.js <companyId>
 *
 * READ-ONLY — makes zero writes to Redis or MongoDB.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { MongoClient, ObjectId } = require('mongodb');
const Redis = require('ioredis');

const COMPANY_ID = process.argv[2];
if (!COMPANY_ID) {
  console.error('❌ Usage: node scripts/diag-uap-bridge.js <companyId>');
  process.exit(1);
}

(async () => {
  if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set'); process.exit(1); }
  if (!process.env.REDIS_URL)   { console.error('❌ REDIS_URL not set');   process.exit(1); }

  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const mongo = await MongoClient.connect(process.env.MONGODB_URI);
  const db    = mongo.db('clientsvia');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  UAP LAYER 1 DIAGNOSTIC');
  console.log('  companyId: ' + COMPANY_ID);
  console.log('═══════════════════════════════════════════════════════════════');

  // ── [1/5] Bridge Redis key state ──────────────────────────────────────────
  const key = 'bridge:' + COMPANY_ID;
  const raw = await redis.get(key);
  let bridge = null;

  console.log('\n[1/5] BRIDGE REDIS KEY');
  console.log('-------------------------');
  if (!raw) {
    console.log('  ❌ MISSING: ' + key);
    console.log('  → UAP Layer 1 CANNOT fire on this company.');
    console.log('  → Fix: open services.html → KC admin → trigger bridge rebuild');
    console.log('    (any save on a container calls BridgeService.build()).');
  } else {
    try {
      bridge = JSON.parse(raw);
      const ageMin = bridge.ts ? ((Date.now() - bridge.ts) / 60000).toFixed(1) : 'unknown';
      console.log('  ✅ Present');
      console.log('  key:         ' + key);
      console.log('  version:     ' + bridge.version + '   (expected: 5)');
      console.log('  phraseCount: ' + bridge.phraseCount);
      console.log('  age:         ' + ageMin + ' min');
      console.log('  sizeKB:      ' + (raw.length / 1024).toFixed(1));
      if (bridge.version !== 5) {
        console.log('  ⚠️  VERSION MISMATCH — this is why UAP is dead. Force rebuild.');
      }
    } catch (e) {
      console.log('  ❌ PARSE ERROR: ' + e.message);
    }
  }

  // ── [2/5] Sample the phrase index ─────────────────────────────────────────
  console.log('\n[2/5] PHRASE INDEX SAMPLE');
  console.log('-------------------------');
  if (!bridge || !bridge.phraseIndex) {
    console.log('  (skipped — no bridge loaded)');
  } else {
    const phrases = Object.keys(bridge.phraseIndex);
    console.log('  Total phrases indexed: ' + phrases.length);
    if (phrases.length === 0) {
      console.log('  ❌ PHRASE INDEX EMPTY — corpus is empty or build dropped them all');
    } else {
      console.log('  First 15:');
      phrases.slice(0, 15).forEach(p => {
        const e = bridge.phraseIndex[p];
        const title = e.containerTitle || '?';
        const sec = (e.sectionIdx !== undefined) ? ' sec' + e.sectionIdx : '';
        console.log('    ' + JSON.stringify(p) + ' → ' + title + sec);
      });
    }
  }

  // ── [3/5] Probe — does the index cover the "No Cooling" symptom space? ────
  console.log('\n[3/5] PROBE: critical phrases');
  console.log('-------------------------');
  if (!bridge || !bridge.phraseIndex) {
    console.log('  (skipped — no bridge loaded)');
  } else {
    const phrases = Object.keys(bridge.phraseIndex);
    ['cool', 'thermostat', 'leak', 'water', 'not blowing'].forEach(term => {
      const matches = phrases.filter(p => new RegExp(term, 'i').test(p));
      console.log('  "' + term + '": ' + matches.length + ' phrase(s)');
      matches.slice(0, 5).forEach(p => {
        const e = bridge.phraseIndex[p];
        console.log('    → ' + JSON.stringify(p) + ' → ' + (e.containerTitle || '?'));
      });
    });
  }

  // ── [4/5] Inspect No Cooling container at source (MongoDB) ────────────────
  console.log('\n[4/5] NO COOLING CONTAINER (source of truth)');
  console.log('-------------------------');
  const co = await db.collection('companiesCollection').findOne(
    { _id: new ObjectId(COMPANY_ID) },
    { projection: { knowledgeContainers: 1 } }
  );
  const containers = co?.knowledgeContainers || [];
  console.log('  Total containers: ' + containers.length);

  const noCooling = containers.find(c => /no cooling/i.test(c.title || ''));
  if (!noCooling) {
    console.log('  ❌ No Cooling container NOT FOUND');
    console.log('  All container titles:');
    containers.forEach(c => console.log('    • ' + c.title));
  } else {
    console.log('  ✅ Found: "' + noCooling.title + '"');
    console.log('  kcId:     ' + noCooling.kcId);
    console.log('  sections: ' + (noCooling.sections || []).length);
    let totalPhr = 0, totalNeg = 0, secsWithZeroPhrases = 0;
    (noCooling.sections || []).forEach((s, i) => {
      const p = (s.callerPhrases || []).length;
      const n = (s.negativeKeywords || []).length;
      totalPhr += p; totalNeg += n;
      if (p === 0) secsWithZeroPhrases++;
      if (i < 8) {
        const t = (s.title || '?').slice(0, 50);
        console.log('    sec' + i + ': "' + t + '"  phrases=' + p + ' neg=' + n);
      }
    });
    console.log('  totals:   phrases=' + totalPhr + '  negativeKeywords=' + totalNeg);
    console.log('  sections with zero phrases: ' + secsWithZeroPhrases);
  }

  // ── [5/5] qaLog UAP_LAYER1 history (has GATE 2.5 ever fired?) ─────────────
  console.log('\n[5/5] qaLog UAP_LAYER1 HISTORY — last 10 calls');
  console.log('-------------------------');
  const recent = await db.collection('customers').aggregate([
    { $match: { companyId: new ObjectId(COMPANY_ID), 'discoveryNotes.qaLog': { $exists: true } } },
    { $sort: { updatedAt: -1 } },
    { $limit: 3 },
    { $project: {
        phone: 1,
        discoveryNotes: { $slice: ['$discoveryNotes', -10] }
      }
    }
  ]).toArray();

  let totalEvents = 0, totalHits = 0, totalMisses = 0, callCount = 0;
  recent.forEach(c => {
    (c.discoveryNotes || []).forEach(dn => {
      callCount++;
      const events = (dn.qaLog || []).filter(q => q.type === 'UAP_LAYER1');
      const hits   = events.filter(q => q.hit === true).length;
      const misses = events.filter(q => q.hit !== true).length;
      totalEvents += events.length; totalHits += hits; totalMisses += misses;
      if (events.length > 0) {
        console.log('  ' + (dn.callSid || '?').padEnd(36) +
                    ' events=' + events.length + '  hits=' + hits + '  misses=' + misses);
      }
    });
  });
  console.log('  ------');
  console.log('  Calls examined:    ' + callCount);
  console.log('  UAP_LAYER1 events: ' + totalEvents);
  console.log('  UAP_LAYER1 hits:   ' + totalHits);
  console.log('  UAP_LAYER1 misses: ' + totalMisses);

  if (totalEvents === 0) {
    console.log('  → GATE 2.5 has NEVER fired. Bridge absent or UtteranceActParser bypassed.');
  } else if (totalHits === 0) {
    console.log('  → UAP runs but confidence always <0.8 or anchor gate rejects all. Threshold/anchor bug.');
  } else {
    console.log('  → UAP is firing and hitting. 0% hit rate is a display/qaLog-type-filter bug.');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  END DIAGNOSTIC');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await mongo.close();
  redis.disconnect();
  process.exit(0);
})().catch(e => {
  console.error('DIAGNOSTIC ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
