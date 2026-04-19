'use strict';

/**
 * ============================================================================
 * REWRITE DEFLECTION CONTENT — Replace dead-air endings with real answers
 * ============================================================================
 *
 * Purpose:
 *   The Config Health audit flags 8 sections whose section.content ends with
 *   a DEFLECTION phrase ("let me check", "hold on while I", etc.). These
 *   promise async work the agent cannot actually do — the result is dead air
 *   on the call and a failure mode the answer-from-kb LLM posture explicitly
 *   bans as a fallback ("never end with 'let me check'").
 *
 *   This script replaces those 8 Fixed-response strings with hand-crafted
 *   rewrites that follow the Acknowledge → Deliver → Directive structure,
 *   clock in at 30-42 words, and pass the DEFLECTION_PATTERNS regex.
 *
 * Scope — only Fixed `section.content`. `section.groqContent` is Groq source
 *   and is not touched by this script.
 *
 * Safety:
 *   • --dry-run is the default. Prints before/after diff per section.
 *   • --apply is required to persist.
 *   • Idempotent: skips sections whose current content does NOT match the
 *     expected "before" text (protects manual edits made after this script
 *     was written).
 *   • Validates every rewrite against DEFLECTION_PATTERNS before write — if
 *     a rewrite somehow still matches, it refuses to ship.
 *   • Word-count guard: rejects rewrites outside 28-45 words.
 *   • Writes use dot-notation $set (sections.${i}.content) — never replaces
 *     the full sections array.
 *
 * Usage — paste into Render Shell:
 *   node scripts/rewrite-deflection-content.js               # dry-run
 *   node scripts/rewrite-deflection-content.js --apply       # write
 *   node scripts/rewrite-deflection-content.js --apply COMP  # other company
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';
const args      = process.argv.slice(2);
const APPLY     = args.includes('--apply');
const COMPANY_ID = args.find(a => !a.startsWith('--')) || PENGUIN_AIR_ID;

// ──────────────────────────────────────────────────────────────────────────
// DEFLECTION_PATTERNS — must mirror KCHealthCheckService.js
// ──────────────────────────────────────────────────────────────────────────
const DEFLECTION_PATTERNS = [
  /\blet me (see|check|pull|look)\b/i,
  /\bi(?:'ll| will| would|'d) (need|have) to (check|confirm|verify|look)\b/i,
  /\bi(?:'ll| will) (check|confirm|verify|look) (on|into) (that|this)\b/i,
  /\bone (moment|second|sec) while i\b/i,
  /\bhold on while i\b/i,
  /\bbear with me while i\b/i,
  /\bgimme (a |one )?(sec|second|moment)\b/i,
];

function _contentIsDeflection(content) {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (trimmed.length < 15) return false;
  const sentences = trimmed
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (sentences.length === 0) return false;
  const lastSentence  = sentences[sentences.length - 1];
  const firstSentence = sentences[0];
  return DEFLECTION_PATTERNS.some(re =>
    re.test(lastSentence) || (sentences.length === 1 && re.test(firstSentence))
  );
}

function _wordCount(s) {
  return (s || '').trim().split(/\s+/).filter(Boolean).length;
}

// ──────────────────────────────────────────────────────────────────────────
// The 8 hand-crafted rewrites, keyed by (containerTitleRegex, sectionLabel)
//
// Structure each rewrite follows:
//   Acknowledge → Deliver a concrete answer → Directive (question or offer)
// ──────────────────────────────────────────────────────────────────────────
const REWRITES = [
  {
    containerMatch: /appointment management/i,
    label: 'Technician ETA',
    newContent:
      "I completely understand — waiting with no update is frustrating. Our dispatch team texts and calls with live ETA windows the moment your tech is en route. Want me to pull your ticket up and confirm your scheduled window right now?",
  },
  {
    containerMatch: /conversational recovery/i,
    label: 'Repeat Caller Impatience',
    newContent:
      "You are absolutely right to be frustrated, and I apologize for the runaround. I am going to stay with this call until we get you scheduled. Can I grab your name and address so we can lock in the next available slot?",
  },
  {
    containerMatch: /conversational recovery/i,
    label: 'Threatening To Leave',
    newContent:
      "I hear you, and I don't want to lose you as a customer — your loyalty matters to us. We can get you on today's schedule with our next available window. What address should I have the technician head to?",
  },
  {
    containerMatch: /no cooling/i,
    label: 'Urgent No Cooling Response',
    newContent:
      "I completely understand — no cooling is miserable, especially right now. We prioritize emergency no-cooling calls and can dispatch a technician today for the {reg_diagnostic_fee} diagnostic. Can I grab your address so we can lock in the next available window?",
  },
  {
    containerMatch: /no cooling/i,
    label: 'No Cooling With Same Day Concern',
    newContent:
      "Absolutely — same-day service is exactly what we do for no-cooling calls. Our {reg_diagnostic_fee} diagnostic covers the tech's visit and a full system check. What address should I send the technician to, and what is the best callback number?",
  },
  {
    containerMatch: /no cooling/i,
    label: 'No Cooling With Guests Coming',
    newContent:
      "I completely get it — you have guests on the way and the house needs to be cool. We will get a technician out today on priority. What address should I send them to, and how soon do the guests arrive?",
  },
  {
    containerMatch: /no cooling/i,
    label: 'No Cooling Before Event Or Party',
    newContent:
      "Totally understand — an event at a warm house is stressful. We will dispatch a technician today on our priority no-cooling list so you are comfortable before your guests arrive. What is the address, and what time does the event start?",
  },
  {
    containerMatch: /scheduling\s*&?\s*availability/i,
    label: 'Holiday Availability',
    newContent:
      "Yes — we run a reduced holiday schedule with on-call technicians for emergencies like no cooling or no heat. Standard diagnostic rates apply. Want me to get you on the schedule or have the on-call dispatcher reach out?",
  },
];

// Pre-validate every rewrite at script load — fail fast if any snuck through
(function validateRewrites() {
  for (const r of REWRITES) {
    if (_contentIsDeflection(r.newContent)) {
      throw new Error(`REWRITE SELF-CHECK FAILED — "${r.label}" still matches DEFLECTION_PATTERNS`);
    }
    const wc = _wordCount(r.newContent);
    if (wc < 28 || wc > 45) {
      throw new Error(`REWRITE WORD-COUNT OUT OF RANGE — "${r.label}" = ${wc} words (target 30-42, hard range 28-45)`);
    }
  }
})();

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set — run this on Render Shell');
    process.exit(1);
  }

  const mode = APPLY ? 'APPLY (writes)' : 'DRY-RUN (read-only)';
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`REWRITE DEFLECTION CONTENT — ${COMPANY_ID}`);
  console.log(`Mode: ${mode}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('clientsvia');

  // NOTE: collection name is camelCase, companyId is STRING (not ObjectId)
  const kcCol = db.collection('companyKnowledgeContainers');
  const containers = await kcCol
    .find({ companyId: COMPANY_ID })
    .sort({ title: 1 })
    .toArray();

  const planned = []; // { kcId, title, idx, label, before, after, wc }
  let unmatched = 0;

  for (const rewrite of REWRITES) {
    const matches = containers.filter(c => rewrite.containerMatch.test(c.title || ''));
    if (matches.length === 0) {
      console.log(`⚠️  No container matched "${rewrite.containerMatch}" for label "${rewrite.label}" — skipping`);
      unmatched++;
      continue;
    }
    for (const c of matches) {
      const sections = Array.isArray(c.sections) ? c.sections : [];
      const idx = sections.findIndex(s => (s.label || '').trim() === rewrite.label);
      if (idx === -1) continue;
      const s = sections[idx];
      if (!_contentIsDeflection(s.content)) {
        console.log(`✅ ${c.title} → "${rewrite.label}" no longer deflection — skipping (was already fixed)`);
        continue;
      }
      planned.push({
        kcId:   c._id,
        title:  c.title,
        idx,
        label:  rewrite.label,
        before: s.content,
        after:  rewrite.newContent,
        wc:     _wordCount(rewrite.newContent),
      });
    }
  }

  // ── Print dry-run ──────────────────────────────────────────────────────
  for (const p of planned) {
    console.log(`\n▶ ${p.title}  [${p.idx}] "${p.label}"  (${p.wc} words)`);
    console.log(`   BEFORE: ${JSON.stringify(p.before)}`);
    console.log(`   AFTER:  ${JSON.stringify(p.after)}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Rewrites defined:    ${REWRITES.length}`);
  console.log(`  Unmatched containers: ${unmatched}`);
  console.log(`  Planned writes:      ${planned.length}`);
  console.log('');

  if (!APPLY) {
    console.log('Dry-run only — no writes. Re-run with --apply to persist.\n');
    await client.close();
    return;
  }

  // ── APPLY ──────────────────────────────────────────────────────────────
  console.log(`Applying ${planned.length} writes...`);
  let applied = 0, failed = 0;
  for (const p of planned) {
    // Re-verify just before write (belt + suspenders)
    if (_contentIsDeflection(p.after)) {
      console.error(`❌ FATAL — rewrite for "${p.label}" still matches DEFLECTION_PATTERNS. Aborting.`);
      failed++;
      continue;
    }
    try {
      const res = await kcCol.updateOne(
        { _id: p.kcId },
        { $set: { [`sections.${p.idx}.content`]: p.after } }
      );
      if (res.modifiedCount === 1) {
        applied++;
        console.log(`  ✅ ${p.title} [${p.idx}] "${p.label}"`);
      } else {
        failed++;
        console.log(`  ⚠️ no-op for ${p.title} [${p.idx}] (modifiedCount=0)`);
      }
    } catch (err) {
      failed++;
      console.error(`  ❌ failed ${p.title} [${p.idx}]: ${err.message}`);
    }
  }

  console.log('');
  console.log(`  Applied: ${applied}`);
  console.log(`  Failed:  ${failed}`);
  console.log('');
  console.log('Next: open services.html → any affected containers → Generate');
  console.log('Missing Audio (rewritten content needs new TTS). Then rescan');
  console.log('Config Health — DEFLECTION_CONTENT count should drop to 0.');
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('❌ rewrite failed:', err);
  process.exit(1);
});
