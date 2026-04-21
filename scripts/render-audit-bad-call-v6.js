'use strict';

/**
 * ============================================================================
 * v6 — AUDIT #3: No Cooling mis-routing diagnostic (read-only)
 * ============================================================================
 *
 * CONTEXT:
 *   Bad call CA04f553d9fabebc32b7edf487d04d720a (+12398889905, Penguin Air)
 *   Turn 1 scored kcId 700c4-39 "New System / Replacement" instead of
 *   kcId 700c4-34 "No Cooling" — despite the No Cooling corpus having 200+
 *   authored sections, including dedicated repeat-caller coverage
 *   (pay for another service call / same problem / came back / etc).
 *
 *   This script answers — with zero guessing — exactly why.
 *
 * QUESTIONS ANSWERED:
 *   (A) Bad call full timeline — what did each gate see and emit?
 *       1. Caller Turn 1 utterance (from qaLog or transcripts)
 *       2. UAP_LAYER1 entries       — phrase index hit/miss + anchor/core gates
 *       3. UAP_SEMANTIC_MISS        — best-below-threshold semantic score
 *       4. UAP_MISS_KEYWORD_RESCUED — Gate 3 rescue winner + score
 *       5. KC_SECTION_GAP*          — any cross-container rescue
 *       6. Any NEGATIVE_KEYWORD_BLOCK that suppressed No Cooling
 *   (B) Side-by-side container shape — what the scorer actually compared
 *       1. No Cooling (700c4-34) — isActive, noAnchor, contentKeywords,
 *          negativeKeywords, total sections, sample callerPhrases
 *       2. New System (700c4-39) — same fields
 *   (C) Caller routing pattern — how often has this caller been routed to
 *       New System on prior calls (is this a chronic mis-route or one-off?)
 *
 * SCOPE:
 *   Read-only. Uses raw mongodb driver per MEMORY.md Render-Shell pattern.
 *
 * USAGE (Render Shell):
 *   node scripts/render-audit-bad-call-v6.js
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID  = '68e3f77a9d623b8058c700c4';
const PHONE       = '+12398889905';
const BAD_CALLSID = 'CA04f553d9fabebc32b7edf487d04d720a';

const NO_COOLING_KC  = '700c4-34';
const NEW_SYSTEM_KC  = '700c4-39';

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('ERROR: MONGODB_URI not set'); process.exit(1); }

function sep(label) {
  const line = '─'.repeat(78);
  console.log('\n' + line);
  console.log('── ' + label);
  console.log(line);
}

function trunc(s, n = 140) {
  if (!s) return '(null)';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

(async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('clientsvia');

  const customers  = db.collection('customers');
  const containers = db.collection('companyknowledgecontainers');

  // ────────────────────────────────────────────────────────────────────────
  // (A) BAD CALL — FULL TIMELINE
  // ────────────────────────────────────────────────────────────────────────
  sep('(A) BAD CALL TIMELINE — ' + BAD_CALLSID);

  const cust = await customers.findOne(
    { companyId: new ObjectId(COMPANY_ID), phone: PHONE },
    { projection: { discoveryNotes: 1, callHistory: 1 } }
  );
  if (!cust) {
    console.log('  NO CUSTOMER FOUND for', PHONE);
    await client.close();
    return;
  }

  const dn = (cust.discoveryNotes || []).find(n => n.callSid === BAD_CALLSID);
  if (!dn) {
    console.log('  BAD CALL dN entry NOT FOUND — may have been purged or never persisted');
  } else {
    console.log('  capturedAt:      ', dn.capturedAt);
    console.log('  callReason:      ', dn.callReason);
    console.log('  objective:       ', dn.objective);
    console.log('  anchorContainerId:', dn.anchorContainerId);
    console.log('  _preWarmed:      ', dn._preWarmed);
    console.log('  _preWarmedAt:    ', dn._preWarmedAt);
    console.log('  temp.firstName:  ', dn.temp && dn.temp.firstName);
    console.log('  temp.lastName:   ', dn.temp && dn.temp.lastName);
    console.log('  confirmed keys:  ', dn.confirmed ? Object.keys(dn.confirmed).join(',') : '(null)');
    console.log('  qaLog length:    ', (dn.qaLog || []).length);

    sep('(A.1) qaLog by TURN — chronological gate timeline');
    const qaLog = (dn.qaLog || []).slice().sort((a, b) => {
      if (a.turn !== b.turn) return (a.turn || 0) - (b.turn || 0);
      return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
    });

    for (const q of qaLog) {
      console.log('  T' + (q.turn ?? '?') + ' [' + q.type + '] ' + trunc(q.question, 80));
      if (q.type === 'UAP_LAYER1') {
        console.log('       containerId=' + q.containerId + ' kcId=' + q.kcId + ' hit=' + q.hit + ' confidence=' + q.confidence + ' matchType=' + q.matchType);
        if (q.anchorGate) console.log('       anchorGate=' + JSON.stringify(q.anchorGate).slice(0, 200));
        if (q.coreGate)   console.log('       coreGate=' + JSON.stringify(q.coreGate).slice(0, 200));
        if (q.noCandidate) console.log('       noCandidate=true reason=' + q.reason);
      } else if (q.type === 'UAP_SEMANTIC_MISS') {
        console.log('       containerId=' + q.containerId + ' kcId=' + q.kcId + ' similarity=' + q.similarity + ' threshold=' + q.threshold);
        console.log('       matchedPhrase=' + trunc(q.matchedPhrase, 80));
      } else if (q.type === 'UAP_MISS_KEYWORD_RESCUED') {
        console.log('       rescuedKcId=' + q.rescuedKcId + ' title="' + q.rescuedContainerTitle + '" score=' + q.rescuedScore);
        console.log('       rescuedSection=' + q.rescuedSection + ' idx=' + q.rescuedSectionIdx);
        if (q.uap25)      console.log('       uap25.bestCandidate=' + JSON.stringify(q.uap25.bestCandidate || null).slice(0, 200));
        if (q.semantic28) console.log('       semantic28.bestBelow=' + JSON.stringify(q.semantic28.bestBelow || null).slice(0, 200));
      } else if (q.type === 'KC_SECTION_GAP' || q.type === 'KC_SECTION_GAP_RESCUED' || q.type === 'KC_SECTION_GAP_ANSWERED') {
        console.log('       containerTitle="' + (q.containerTitle || '') + '" kcId=' + q.kcId);
        if (q.originalContainer) console.log('       originalContainer=' + JSON.stringify(q.originalContainer).slice(0, 200));
        if (q.rescuedContainer)  console.log('       rescuedContainer=' + JSON.stringify(q.rescuedContainer).slice(0, 200));
      } else if (q.type === 'NEGATIVE_KEYWORD_BLOCK') {
        console.log('       suppressedKcId=' + q.kcId + ' title="' + (q.suppressedContainerTitle || '') + '"');
        console.log('       blockedBy=' + JSON.stringify(q.blockedBy || null).slice(0, 200));
      } else if (q.type === 'KC_LLM_FALLBACK') {
        console.log('       answer=' + trunc(q.answer, 80));
        console.log('       latencyMs=' + q.latencyMs + ' cost=' + JSON.stringify(q.cost || null).slice(0, 120));
      } else if (q.type === 'KC_GRACEFUL_ACK') {
        console.log('       answer=' + trunc(q.answer, 80));
      }
    }

    sep('(A.2) callHistory entry for this callSid');
    const ch = (cust.callHistory || []).find(h => h.callSid === BAD_CALLSID);
    if (!ch) {
      console.log('  NOT FOUND in callHistory — call may not have stamped');
    } else {
      console.log('  callDate:       ', ch.callDate);
      console.log('  callReason:     ', ch.callReason);
      console.log('  callOutcome:    ', ch.callOutcome);
      console.log('  objective:      ', ch.objective);
      console.log('  durationSeconds:', ch.durationSeconds);
      console.log('  confirmedFields keys:', ch.confirmedFields ? Object.keys(ch.confirmedFields).join(',') : '(null)');
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // (B) SIDE-BY-SIDE CONTAINER SHAPE
  // ────────────────────────────────────────────────────────────────────────
  sep('(B) CONTAINER COMPARISON — what the scorer compared');

  const coolQ = { companyId: new ObjectId(COMPANY_ID), kcId: NO_COOLING_KC };
  const sysQ  = { companyId: new ObjectId(COMPANY_ID), kcId: NEW_SYSTEM_KC };

  const [cool, sys] = await Promise.all([
    containers.findOne(coolQ),
    containers.findOne(sysQ),
  ]);

  function summarizeContainer(c, label) {
    if (!c) { console.log('  ' + label + ': NOT FOUND'); return; }
    console.log('  ── ' + label + ' ──');
    console.log('    _id:                  ', c._id && c._id.toString());
    console.log('    kcId:                 ', c.kcId);
    console.log('    title:                ', c.title);
    console.log('    isActive:             ', c.isActive);
    console.log('    noAnchor:             ', c.noAnchor);
    console.log('    priority:             ', c.priority);
    console.log('    category:             ', c.category);
    const ck = Array.isArray(c.contentKeywords) ? c.contentKeywords : [];
    const nk = Array.isArray(c.negativeKeywords) ? c.negativeKeywords : [];
    console.log('    contentKeywords(' + ck.length + '):', ck.slice(0, 25).join(', ') + (ck.length > 25 ? ' …' : ''));
    console.log('    negativeKeywords(' + nk.length + '):', nk.slice(0, 25).join(', ') + (nk.length > 25 ? ' …' : ''));
    const secs = Array.isArray(c.sections) ? c.sections : [];
    console.log('    sections count:       ', secs.length);
    console.log('    sections w/ callerPhrases:', secs.filter(s => Array.isArray(s.callerPhrases) && s.callerPhrases.length > 0).length);
    console.log('    sections w/ anchorWords:  ', secs.filter(s => Array.isArray(s.anchorWords) && s.anchorWords.length > 0).length);
  }

  summarizeContainer(cool, 'NO COOLING (' + NO_COOLING_KC + ')');
  summarizeContainer(sys,  'NEW SYSTEM / REPLACEMENT (' + NEW_SYSTEM_KC + ')');

  // ── No Cooling — deep-dive on the "repeat-caller" sections 200-215 ──
  sep('(B.1) No Cooling — repeat-caller section callerPhrases (idx 200-215)');
  const coolSecs = Array.isArray(cool?.sections) ? cool.sections : [];
  for (let i = 200; i <= 215 && i < coolSecs.length; i++) {
    const s = coolSecs[i];
    if (!s) continue;
    const phrases = Array.isArray(s.callerPhrases) ? s.callerPhrases : [];
    const anchors = Array.isArray(s.anchorWords) ? s.anchorWords : [];
    console.log('  [' + i + '] label="' + trunc(s.label, 60) + '"');
    console.log('        callerPhrases(' + phrases.length + '): ' + phrases.slice(0, 3).map(p => typeof p === 'string' ? p : (p.phrase || '')).join(' | '));
    console.log('        anchorWords(' + anchors.length + '): ' + anchors.slice(0, 8).join(', '));
  }

  // ── Top 5 sections from each container (for visual comparison) ──
  sep('(B.2) First 5 sections — label + callerPhrases count — both containers');
  console.log('  NO COOLING:');
  coolSecs.slice(0, 5).forEach((s, i) => {
    const n = Array.isArray(s.callerPhrases) ? s.callerPhrases.length : 0;
    console.log('    [' + i + '] "' + trunc(s.label, 70) + '" callerPhrases=' + n);
  });
  console.log('  NEW SYSTEM:');
  const sysSecs = Array.isArray(sys?.sections) ? sys.sections : [];
  sysSecs.slice(0, 5).forEach((s, i) => {
    const n = Array.isArray(s.callerPhrases) ? s.callerPhrases.length : 0;
    console.log('    [' + i + '] "' + trunc(s.label, 70) + '" callerPhrases=' + n);
  });

  // ────────────────────────────────────────────────────────────────────────
  // (C) CALLER ROUTING PATTERN
  // ────────────────────────────────────────────────────────────────────────
  sep('(C) Caller routing pattern — recent 10 calls, winning anchor container');
  const recent = (cust.discoveryNotes || [])
    .slice()
    .sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')))
    .slice(0, 10);

  for (const n of recent) {
    const uapHit = (n.qaLog || []).find(q => q.type === 'UAP_LAYER1' && q.hit);
    const keyRes = (n.qaLog || []).find(q => q.type === 'UAP_MISS_KEYWORD_RESCUED');
    const llmFb  = (n.qaLog || []).find(q => q.type === 'KC_LLM_FALLBACK');
    const winner = uapHit
      ? 'UAP→' + (uapHit.kcId || uapHit.containerId)
      : keyRes
        ? 'KEYWORD→' + (keyRes.rescuedKcId || keyRes.rescuedContainerId)
        : llmFb
          ? 'GROQ'
          : '(no match)';
    console.log('  ' + n.capturedAt + ' | ' + trunc(n.callReason, 40).padEnd(42) + ' | anchor=' + (n.anchorContainerId || '-').padEnd(26) + ' | ' + winner);
  }

  await client.close();
})().catch((e) => {
  console.error('ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
