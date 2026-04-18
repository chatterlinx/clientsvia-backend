'use strict';

/**
 * ============================================================================
 * AUDIT HIGH ISSUES — Read-Only Diagnostic for 62 HIGH Config Health Issues
 * ============================================================================
 *
 * Purpose:
 *   Zero-write diagnostic that surfaces exactly WHICH sections + phrases are
 *   triggering TRADE_TERMS_EMPTY and DEFLECTION_CONTENT in the Config Health
 *   report, so the follow-on backfill + rewrite scripts can target them
 *   precisely.
 *
 *   Mirrors the logic from services/kc/KCHealthCheckService.js (DEFLECTION
 *   regex + TRADE_TERMS_EMPTY rule) but prints everything to stdout for a
 *   human-reviewable pass before we write anything.
 *
 * Output sections:
 *   1. Container roster — title, kcId, noAnchor, tradeVocabularyKey, counts
 *   2. TRADE_TERMS_EMPTY — full list by container + section, with a 20-term
 *      preview of each section's phrase-side signal (label + phrase text +
 *      anchorWords) so we can see why the allowlist intersection returned 0
 *   3. DEFLECTION_CONTENT — full current text of all 8 flagged sections
 *   4. GlobalShare HVAC allowlist size + sample terms
 *
 * Architectural invariant (locked):
 *   UAP reads phrases. Groq reads responses. This script NEVER reads
 *   section.content or section.groqContent for tradeTerms derivation
 *   analysis — only for DEFLECTION_CONTENT inspection (which is its own
 *   content-quality check, not routing).
 *
 * Usage — paste into Render Shell:
 *   node scripts/audit-high-issues.js [companyId]
 *
 * Defaults to Penguin Air if no arg provided. Read-only, safe to re-run.
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';
const COMPANY_ID     = process.argv[2] || PENGUIN_AIR_ID;

// ──────────────────────────────────────────────────────────────────────────
// DEFLECTION_PATTERNS — mirror of KCHealthCheckService.js
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

function _whichPatternMatched(content) {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  const sentences = trimmed
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (sentences.length === 0) return null;
  const lastSentence  = sentences[sentences.length - 1];
  const firstSentence = sentences[0];
  for (const re of DEFLECTION_PATTERNS) {
    if (re.test(lastSentence)) return { pattern: re.source, in: 'last', sentence: lastSentence };
    if (sentences.length === 1 && re.test(firstSentence)) {
      return { pattern: re.source, in: 'only', sentence: firstSentence };
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Meta-container whitelist — mirror of KCHealthCheckService.js
// ──────────────────────────────────────────────────────────────────────────
const META_CONTAINER_PATTERNS = [
  /conversational recovery/i,
  /price objections?/i,
  /scheduling\s*&?\s*availability/i,
  /warranty\s*&?\s*guarantee/i,
  /appointment management/i,
  /spam\s*&?\s*solicitation/i,
];
function _isMetaContainer(title) {
  if (!title) return false;
  return META_CONTAINER_PATTERNS.some(re => re.test(title));
}

// ──────────────────────────────────────────────────────────────────────────
// Phrase-side signal extractor (for preview only — NO writes)
// ──────────────────────────────────────────────────────────────────────────
function _extractPhraseSignal(section) {
  const tokens = new Set();
  const add = (s) => {
    if (!s || typeof s !== 'string') return;
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3)
      .forEach(w => tokens.add(w));
  };
  add(section.label);
  const phrases = Array.isArray(section.callerPhrases) ? section.callerPhrases : [];
  for (const p of phrases) {
    add(p.text);
    if (Array.isArray(p.anchorWords)) {
      for (const a of p.anchorWords) add(a);
    }
  }
  return Array.from(tokens);
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set — run this on Render Shell');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('clientsvia');

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`KC HIGH-ISSUE AUDIT — ${COMPANY_ID}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── Load company (for name) ────────────────────────────────────────────
  const companiesCol = db.collection('companiesCollection');
  const company = await companiesCol.findOne(
    { _id: new ObjectId(COMPANY_ID) },
    { projection: { companyName: 1 } }
  );
  if (!company) {
    console.error(`❌ Company ${COMPANY_ID} not found in companiesCollection`);
    await client.close();
    process.exit(1);
  }
  console.log(`Company:  ${company.companyName || '(unnamed)'}\n`);

  // ── Load HVAC allowlist from AdminSettings ─────────────────────────────
  const adminCol = db.collection('adminsettings');
  const adminDoc = await adminCol.findOne({});
  const tradeVocab = adminDoc?.globalHub?.tradeVocabulary || {};
  const allowlists = {};
  for (const [key, arr] of Object.entries(tradeVocab)) {
    allowlists[key] = Array.isArray(arr)
      ? arr.map(t => (typeof t === 'string' ? t.toLowerCase() : '')).filter(Boolean)
      : [];
  }
  const vocabKeys = Object.keys(allowlists);
  console.log(`GlobalShare tradeVocabulary keys: ${vocabKeys.length}`);
  for (const k of vocabKeys) {
    const list = allowlists[k];
    const preview = list.slice(0, 10).join(', ');
    console.log(`  • ${k.padEnd(20)} (${String(list.length).padStart(3)} terms) — sample: ${preview}${list.length > 10 ? ', …' : ''}`);
  }
  console.log('');

  // ── Load containers ────────────────────────────────────────────────────
  const kcCol = db.collection('companyknowledgecontainers');
  const containers = await kcCol
    .find({ companyId: new ObjectId(COMPANY_ID) })
    .sort({ title: 1 })
    .toArray();

  console.log(`Containers loaded: ${containers.length}\n`);
  console.log('─── ROSTER ────────────────────────────────────────────────────────');
  for (const c of containers) {
    const sections = Array.isArray(c.sections) ? c.sections : [];
    const active   = sections.filter(s => s.isActive !== false);
    const meta     = _isMetaContainer(c.title) ? '[META]' : '      ';
    const vk       = c.tradeVocabularyKey || '(none)';
    const na       = c.noAnchor ? '✅' : '❌';
    console.log(`  ${meta}  ${(c.title || '(untitled)').padEnd(38)} noAnchor=${na}  vocab=${vk.padEnd(10)}  sections=${sections.length} (active=${active.length})`);
  }
  console.log('');

  // ── TRADE_TERMS_EMPTY pass ─────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('TRADE_TERMS_EMPTY — sections missing tradeTerms (HIGH)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let tradeEmptyCount = 0;
  for (const c of containers) {
    const title  = c.title || '(untitled)';
    const isMeta = _isMetaContainer(title);
    const hasKey = !!c.tradeVocabularyKey;
    if (isMeta) continue;       // meta containers are exempt
    if (!hasKey) continue;      // TRADE_VOCAB_KEY_MISSING is a separate check
    const sections = Array.isArray(c.sections) ? c.sections : [];

    const flagged = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (s.isActive === false) continue;
      const tt = Array.isArray(s.tradeTerms) ? s.tradeTerms : [];
      if (tt.length === 0) flagged.push({ idx: i, section: s });
    }
    if (flagged.length === 0) continue;

    console.log(`▶ ${title}  (vocab=${c.tradeVocabularyKey}, flagged=${flagged.length}/${sections.length})`);
    const allow = allowlists[c.tradeVocabularyKey] || [];
    const allowSet = new Set(allow);

    for (const { idx, section } of flagged) {
      tradeEmptyCount++;
      const signal = _extractPhraseSignal(section);
      const hits = signal.filter(w => allowSet.has(w));
      const sampleSignal = signal.slice(0, 20).join(', ');
      console.log(`    [${idx}] "${section.label || '(no label)'}"`);
      console.log(`         phrase-signal tokens: ${signal.length} (sample: ${sampleSignal}${signal.length > 20 ? ', …' : ''})`);
      console.log(`         allowlist intersection: ${hits.length} ${hits.length ? '→ ' + hits.join(', ') : '(empty — this is why AUTO_TRADETERMS_FILLED returned 0)'}`);
    }
    console.log('');
  }
  console.log(`TOTAL TRADE_TERMS_EMPTY: ${tradeEmptyCount}\n`);

  // ── DEFLECTION_CONTENT pass ────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('DEFLECTION_CONTENT — Fixed content ending with dead-air (HIGH)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let deflectionCount = 0;
  for (const c of containers) {
    const title    = c.title || '(untitled)';
    const sections = Array.isArray(c.sections) ? c.sections : [];
    const flagged  = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (s.isActive === false) continue;
      if (!_contentIsDeflection(s.content)) continue;
      flagged.push({ idx: i, section: s });
    }
    if (flagged.length === 0) continue;

    console.log(`▶ ${title}  (flagged=${flagged.length})`);
    for (const { idx, section } of flagged) {
      deflectionCount++;
      const hit = _whichPatternMatched(section.content);
      const words = (section.content || '').trim().split(/\s+/).filter(Boolean).length;
      console.log(`    [${idx}] "${section.label || '(no label)'}"  (${words} words)`);
      console.log(`         content: ${JSON.stringify(section.content)}`);
      console.log(`         matched: ${hit ? hit.pattern : '(unknown)'}  [in ${hit ? hit.in : '?'} sentence]`);
      console.log(`         offending sentence: "${hit ? hit.sentence : '?'}"`);
    }
    console.log('');
  }
  console.log(`TOTAL DEFLECTION_CONTENT: ${deflectionCount}\n`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  TRADE_TERMS_EMPTY:  ${tradeEmptyCount}`);
  console.log(`  DEFLECTION_CONTENT: ${deflectionCount}`);
  console.log(`  TOTAL HIGH:         ${tradeEmptyCount + deflectionCount}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review the allowlist-intersection=0 sections above — confirm');
  console.log('     container defaults (scripts/fill-stubborn-trade-terms.js).');
  console.log('  2. Review the DEFLECTION content above — rewrites live in');
  console.log('     scripts/rewrite-deflection-content.js (keyed by title+label).');
  console.log('  3. Run both scripts --dry-run first, then --apply.');
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('❌ audit failed:', err);
  process.exit(1);
});
