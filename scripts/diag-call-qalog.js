/**
 * ═══════════════════════════════════════════════════════════════════════════
 * diag-call-qalog.js — Dump complete qaLog timeline for one callSid
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FOLLOW-UP TO diag-uap-misses.js
 * -------------------------------
 * Prior diagnostic showed UAP_LAYER1 qaLog entries are sparse — the
 * bad test call CAe6c7965b925227141de7a6e928df1025 produced ZERO UAP_LAYER1
 * entries, yet the call report showed matchScore=11 (keyword-scoring output)
 * from container "New System / Replacement". Architecturally, GATE 3
 * keyword scoring should only run AFTER GATE 2.5 UAP misses — which should
 * have written a qaLog entry. The mismatch means something is bypassing
 * normal telemetry.
 *
 * This script dumps EVERY qaLog entry for a specific callSid in chronological
 * order, so we can see the exact gate sequence that fired.
 *
 * MULTI-TENANT SAFETY
 * -------------------
 * Requires both companyId and callSid as CLI args — no hardcoding.
 *
 * USAGE
 * -----
 *   node scripts/diag-call-qalog.js <companyId> <callSid>
 *
 * READ-ONLY — no writes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID = process.argv[2];
const CALL_SID   = process.argv[3];

if (!COMPANY_ID || !CALL_SID) {
  console.error('❌ Usage: node scripts/diag-call-qalog.js <companyId> <callSid>');
  process.exit(1);
}

(async () => {
  if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set'); process.exit(1); }

  const mongo = await MongoClient.connect(process.env.MONGODB_URI);
  const db    = mongo.db('clientsvia');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CALL qaLog TIMELINE DUMP');
  console.log('  companyId: ' + COMPANY_ID);
  console.log('  callSid:   ' + CALL_SID);
  console.log('═══════════════════════════════════════════════════════════════');

  // Find the customer doc + specific discoveryNote for this call
  const cust = await db.collection('customers').findOne(
    { companyId: new ObjectId(COMPANY_ID), 'discoveryNotes.callSid': CALL_SID }
  );

  if (!cust) {
    console.log('\n❌ No customer record found containing callSid ' + CALL_SID);
    console.log('   (may have been written to a different record, or never saved)');
    await mongo.close();
    process.exit(0);
  }

  const note = (cust.discoveryNotes || []).find(n => n.callSid === CALL_SID);
  if (!note) {
    console.log('\n❌ Customer found (' + cust.phone + ') but no discoveryNote with callSid');
    await mongo.close();
    process.exit(0);
  }

  console.log('\nCustomer: ' + (cust.phone || '?'));
  console.log('Call started: ' + (note.createdAt || note.ts || '?'));
  console.log('Total qaLog entries: ' + ((note.qaLog || []).length));

  // Sort by timestamp — qaLog entries are appended, but let's enforce chrono
  const log = (note.qaLog || []).slice().sort((a, b) => {
    const ta = a.timestamp || a.ts || '';
    const tb = b.timestamp || b.ts || '';
    return ta.localeCompare(tb);
  });

  // Histogram by type
  const hist = {};
  log.forEach(q => { hist[q.type] = (hist[q.type] || 0) + 1; });
  console.log('\nType histogram:');
  Object.entries(hist).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    console.log('  ' + t.padEnd(35) + ' ' + n);
  });

  console.log('\n──────────────── ENTRIES ────────────────');
  log.forEach((q, i) => {
    console.log('\n[' + (i + 1) + '/' + log.length + ']  ' + (q.timestamp || q.ts || '(no ts)'));
    console.log('  type: ' + q.type);
    if (q.turn !== undefined) console.log('  turn: ' + q.turn);
    if (q.question) console.log('  question: ' + JSON.stringify((q.question || '').slice(0, 200)));

    // Print all remaining keys except the ones we already showed
    const skip = new Set(['type', 'turn', 'question', 'timestamp', 'ts']);
    Object.keys(q).filter(k => !skip.has(k)).forEach(k => {
      const v = q[k];
      const s = typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v);
      console.log('  ' + k + ': ' + s);
    });
  });

  // Print the discoveryNotes summary context
  console.log('\n──────────────── NOTE CONTEXT ────────────────');
  console.log('  callReason:       ' + JSON.stringify(note.callReason || null));
  console.log('  objective:        ' + JSON.stringify(note.objective || null));
  console.log('  anchorContainerId:' + JSON.stringify(note.anchorContainerId || null));
  console.log('  temp keys:        ' + Object.keys(note.temp || {}).join(', '));
  console.log('  confirmed keys:   ' + Object.keys(note.confirmed || {}).join(', '));
  console.log('  doNotReask:       ' + JSON.stringify(note.doNotReask || []));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  END');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await mongo.close();
  process.exit(0);
})().catch(e => {
  console.error('DIAGNOSTIC ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
