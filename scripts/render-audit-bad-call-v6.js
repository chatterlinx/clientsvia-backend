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

  // NOTE: KC container collection name is camelCase (mongoose model registers it
  //       as 'companyKnowledgeContainers'). MEMORY.md warns some collections
  //       store companyId as ObjectId while others store it as String —
  //       CompanyKnowledgeContainer.companyId is STRING. Filter accordingly.
  const customers  = db.collection('customers');                    // companyId: ObjectId
  const containers = db.collection('companyKnowledgeContainers');   // companyId: String

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
    // Skip cost-tracking events (ELEVENLABS_TTS_CHARS, GROQ_COST_*) — they
    // clutter the gate view. Section A is for gate decisions, not billing.
    const COST_TYPES = new Set(['ELEVENLABS_TTS_CHARS', 'GROQ_COST_INPUT', 'GROQ_COST_OUTPUT']);
    const qaLog = (dn.qaLog || [])
      .filter(q => !COST_TYPES.has(q.type))
      .slice()
      .sort((a, b) => {
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
      } else if (q.type === 'KC_GROQ_ANSWERED') {
        // Key forensic detail — reveals which gate emitted this event:
        //   source='prequal'                → GATE 0.7 _handlePrequalResponse
        //   path=KC_DIRECT_ANSWER, no source → GATE 3 _handleKCMatch
        console.log('       path=' + q.path + ' source=' + (q.source || '(none)') + ' intent=' + q.intent);
        console.log('       containerTitle="' + (q.containerTitle || '') + '" kcId=' + q.kcId + ' containerId=' + q.containerId);
        console.log('       latencyMs=' + q.latencyMs + ' confidence=' + q.confidence);
        console.log('       responsePreview=' + trunc(q.responsePreview, 120));
      } else {
        // Catch-all — any event type we don't handle above prints a one-line
        // shape summary so we never miss a signal.
        const keys = Object.keys(q).filter(k => !['type','turn','timestamp','question','answer'].includes(k));
        console.log('       [unhandled-type] keys=' + keys.join(',').slice(0, 200));
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
  // (B) FLAT PHRASE CORPUS — the vertical view UAP actually searches
  // ────────────────────────────────────────────────────────────────────────
  // UAP does not care about container walls. It searches one flat index of
  // every callerPhrase on every section across every container. This block
  // builds that same flat view offline and ranks it by word-overlap against
  // the caller's Turn 1 utterance. That answers the correct diagnostic
  // question: "was a No Cooling phrase even a candidate? Did it rank? Why
  // didn't it win?" — instead of the wrong question, "No Cooling vs New
  // System folder-shape comparison".
  //
  // LIMITATION: This does NOT run UAP's real 2-gate algorithm (embeddings +
  // anchor confirm). It uses simple content-word overlap as a relevance
  // proxy — sufficient to show WHICH phrases sit close to the utterance
  // in the flat corpus. The qaLog in Section (A) shows UAP's real decision.
  // ────────────────────────────────────────────────────────────────────────
  sep('(B) FLAT PHRASE CORPUS — every callerPhrase in the company');

  // Step 1 — extract Turn 1 utterance from qaLog (UAP's real input)
  const turn1Q =
    dn && Array.isArray(dn.qaLog)
      ? dn.qaLog.find(q => (q.turn === 1 || q.turn === 0) && q.question)
      : null;
  const utterance = turn1Q ? String(turn1Q.question) : '';
  console.log('  Turn 1 utterance (input UAP actually searched on):');
  console.log('    "' + utterance + '"');

  // Step 2 — tokenize utterance into content words (drop stopwords + punctuation)
  const STOP = new Set([
    'the','a','an','and','or','but','if','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','i','you','he','she','it','we','they','me',
    'my','your','his','her','their','our','this','that','these','those','to','of','in',
    'on','at','for','with','from','by','as','so','just','very','really','now','then',
    'ok','okay','yeah','yes','no','not','like','can','could','would','should','will','up'
  ]);
  // length >= 2 (keep "AC" — the most important word in HVAC utterances),
  // but still drop "a", "i", "to", "of", etc. via the STOP list above.
  const contentWords = (utterance.toLowerCase().match(/[a-z']+/g) || [])
    .filter(w => w.length >= 2 && !STOP.has(w));
  console.log('  contentWords:', contentWords.join(', ') || '(none)');

  // Step 3 — pull ALL containers, flatten every callerPhrase
  // companyId stored as STRING (see CompanyKnowledgeContainer.js L371-377)
  const allContainers = await containers
    .find({ companyId: COMPANY_ID })
    .project({ kcId: 1, title: 1, isActive: 1, noAnchor: 1, sections: 1 })
    .toArray();
  console.log('  KC containers found for company:', allContainers.length);

  // ── DEBUG probe — per-container section count + first section shape ──────
  // If "Total phrases in corpus: 0" despite containers being returned, this
  // tells us whether (a) sections[] is empty, (b) callerPhrases[] is empty,
  // (c) field names drifted. Uncomment or leave on — it's a few lines.
  console.log('  ── per-container: section count / callerPhrase total ──');
  for (const c of allContainers) {
    const secs = Array.isArray(c.sections) ? c.sections : [];
    let phraseSum = 0;
    for (const s of secs) {
      const cp = Array.isArray(s.callerPhrases) ? s.callerPhrases : [];
      phraseSum += cp.length;
    }
    console.log('    [' + (c.kcId || '?') + '] ' + (c.title || '').padEnd(32) + ' sections=' + secs.length + ' phrases=' + phraseSum);
  }
  // Dump raw shape of first container's first section — verifies field names
  if (allContainers.length > 0) {
    const first   = allContainers[0];
    const firstSec = (first.sections || [])[0];
    if (firstSec) {
      console.log('  ── first container.firstSection keys:', Object.keys(firstSec).join(','));
      if (firstSec.callerPhrases && firstSec.callerPhrases[0]) {
        console.log('     callerPhrases[0] keys:', Object.keys(firstSec.callerPhrases[0]).join(','));
        console.log('     callerPhrases[0]:', JSON.stringify(firstSec.callerPhrases[0]).slice(0, 250));
      } else {
        console.log('     firstSection.callerPhrases empty or missing');
      }
    } else {
      console.log('  ── first container has no sections[] entries');
      console.log('     first container keys:', Object.keys(first).join(','));
    }
  }

  const flat = []; // { containerTitle, kcId, sectionIdx, sectionLabel, phrase, anchorWords, isActive, noAnchor, overlap }
  for (const c of allContainers) {
    const secs = Array.isArray(c.sections) ? c.sections : [];
    for (let idx = 0; idx < secs.length; idx++) {
      const s = secs[idx];
      const phrases = Array.isArray(s.callerPhrases) ? s.callerPhrases : [];
      const anchors = Array.isArray(s.anchorWords) ? s.anchorWords : [];
      for (const p of phrases) {
        // callerPhraseSchema field is `text`, NOT `phrase` — evidence from
        // live debug probe: callerPhrases[0] keys = text,addedAt,anchorWords,
        // score,embedding. Keep `phrase` as secondary fallback in case legacy
        // data drifted, and `text` as primary.
        const phraseText =
          typeof p === 'string'
            ? p
            : (p && (p.text || p.phrase)) || '';
        if (!phraseText) continue;
        // Anchor words live on the PHRASE, not the section (per-phrase anchor
        // words system, April 2026). Prefer phrase-level, fall back to
        // section-level for any legacy rows.
        const phraseAnchors = Array.isArray(p && p.anchorWords)
          ? p.anchorWords
          : anchors;
        flat.push({
          containerTitle: c.title,
          kcId:           c.kcId,
          sectionIdx:     idx,
          sectionLabel:   s.label || '',
          phrase:         phraseText,
          anchorWords:    phraseAnchors,
          isActive:       c.isActive !== false,
          noAnchor:       !!c.noAnchor,
          overlap:        0, // computed next
        });
      }
    }
  }

  // Step 4 — score each phrase by content-word overlap with utterance
  for (const f of flat) {
    const phraseWords = new Set((f.phrase.toLowerCase().match(/[a-z']+/g) || []).filter(w => w.length >= 2));
    let overlap = 0;
    for (const w of contentWords) if (phraseWords.has(w)) overlap += 1;
    f.overlap = overlap;
  }

  // Step 5 — per-container corpus stats
  sep('(B.1) Corpus inventory — phrases per container (all containers)');
  const perContainer = {};
  for (const f of flat) {
    const key = (f.kcId || '?') + ' :: ' + f.containerTitle;
    if (!perContainer[key]) perContainer[key] = { total: 0, withOverlap: 0, isActive: f.isActive, noAnchor: f.noAnchor };
    perContainer[key].total += 1;
    if (f.overlap > 0) perContainer[key].withOverlap += 1;
  }
  const perContainerSorted = Object.entries(perContainer)
    .sort((a, b) => (b[1].withOverlap - a[1].withOverlap) || (b[1].total - a[1].total));
  console.log('  Total phrases in corpus:', flat.length);
  console.log('  Containers w/ any overlap:', perContainerSorted.filter(([, v]) => v.withOverlap > 0).length);
  console.log('  ── container  (active | noAnchor | totalPhrases | matchingPhrases) ──');
  for (const [name, v] of perContainerSorted) {
    const flags =
      (v.isActive ? 'active' : 'INACTIVE') + ' | ' +
      (v.noAnchor ? 'noAnchor' : 'anchor-ok');
    console.log('    ' + String(v.withOverlap).padStart(3) + '/' + String(v.total).padStart(4) + '  [' + flags + ']  ' + name);
  }

  // Step 6 — top 40 phrases ranked by overlap (the flat UAP candidate view)
  sep('(B.2) Top 40 flat-corpus candidates for this utterance (by content-word overlap)');
  const ranked = flat
    .filter(f => f.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 40);
  if (!ranked.length) {
    console.log('  (no phrase in the flat corpus has any content-word overlap with Turn 1)');
  } else {
    for (const f of ranked) {
      console.log(
        '  overlap=' + f.overlap +
        '  [' + (f.kcId || '?') + ']  ' +
        trunc(f.containerTitle, 28).padEnd(30) + ' § ' +
        trunc(f.sectionLabel || '(idx ' + f.sectionIdx + ')', 28).padEnd(30) +
        '  "' + trunc(f.phrase, 70) + '"'
      );
      if (Array.isArray(f.anchorWords) && f.anchorWords.length) {
        console.log('        anchorWords(' + f.anchorWords.length + '): ' + f.anchorWords.slice(0, 10).join(', '));
      }
    }
  }

  // Step 7 — No Cooling / New System specific call-out (context, not comparison)
  sep('(B.3) Where did No Cooling (' + NO_COOLING_KC + ') and New System (' + NEW_SYSTEM_KC + ') rank?');
  const rankOf = (kcId) => {
    const firstIdx = flat
      .filter(f => f.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .findIndex(f => f.kcId === kcId);
    return firstIdx >= 0 ? (firstIdx + 1) : null;
  };
  console.log('  No Cooling top rank: ', rankOf(NO_COOLING_KC));
  console.log('  New System top rank: ', rankOf(NEW_SYSTEM_KC));

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

  // ────────────────────────────────────────────────────────────────────────
  // (D) GATE 1 BOOKING INTENT — narrative filter + question filter per-turn
  // ────────────────────────────────────────────────────────────────────────
  // Mirror the regex constants from KCDiscoveryRunner.js (lines ~915-955):
  //   - booking intent regex
  //   - narrative indicators
  //   - question filter
  // Run them against every Turn 1 utterance to see whether GATE 1 would
  // have fired booking intent and routed away from UAP on T1.
  // ────────────────────────────────────────────────────────────────────────
  sep('(D) GATE 1 Booking intent analysis — Turn 1 utterance');
  if (turn1Q) {
    const rawInput = String(turn1Q.question || '');
    const norm     = rawInput.toLowerCase().replace(/[^a-z'\s]/g, ' ').trim();

    const hasQuestionMark = rawInput.includes('?');
    const bookingRe   = /\b(schedul|book|appoint|come\s+out|send\s+someone|service\s+call|set\s+up)/i;
    const narrativeRe = /\b(was\s+here|came\s+out|already\s+(came|been\s+out|sent\s+someone|repaired|fixed)|still\s+not\s+(working|cooling|fixed|running|heating|cold|warm|blowing)|didn[''']?t\s+fix|hasn[''']?t\s+(been\s+)?fixed|back\s+again|last\s+time\s+(you|the\s+tech|your|he|she|they)\s+came|i\s+had\s+|we\s+had\s+|you\s+guys\s+(?:have\s+|had\s+|'ve\s+)?(?:been|come|came)|tony\s+was|changed\s+the|now\s+(?:water|it|the))/i;

    console.log('  raw input:                 "' + trunc(rawInput, 120) + '"');
    console.log('  norm (booking check input):"' + trunc(norm, 120) + '"');
    console.log('  has "?":                   ', hasQuestionMark);
    console.log('  matches bookingRe:         ', bookingRe.test(norm));
    console.log('  matches narrativeIndicators:', narrativeRe.test(rawInput));
    console.log('  word count:                ', rawInput.split(/\s+/).filter(Boolean).length);
  } else {
    console.log('  (no Turn 1 question found in qaLog)');
  }

  await client.close();
})().catch((e) => {
  console.error('ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
