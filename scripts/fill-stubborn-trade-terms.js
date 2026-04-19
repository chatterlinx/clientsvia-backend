'use strict';

/**
 * ============================================================================
 * FILL STUBBORN TRADE TERMS — 3-Tier Backfill for TRADE_TERMS_EMPTY Sections
 * ============================================================================
 *
 * Purpose:
 *   The server-side AUTO_TRADETERMS_FILLED hook (companyKnowledge.js ~L2633)
 *   runs phrase-only derivation intersected with the GlobalShare HVAC
 *   allowlist. For many HVAC sections, caller phrases use everyday language
 *   ("not cold", "broken", "warm air") that doesn't appear verbatim in the
 *   curated trade vocabulary — so the intersection is empty and tradeTerms
 *   stays []. GATE 2.4 Field 8 (tradeCore) never fires for those sections.
 *
 *   This script closes the gap with a 3-tier fallback:
 *     Tier 1 — phrase-side token intersection with allowlist (same as auto hook)
 *     Tier 2 — section label tokens intersected with allowlist
 *     Tier 3 — container-level defaults (per-title pattern), validated against
 *              the live allowlist at runtime (no bogus terms ever written)
 *
 * Architectural invariant (locked):
 *   UAP reads phrases. Groq reads responses. This script reads only:
 *     • section.label
 *     • section.callerPhrases[].text
 *     • section.callerPhrases[].anchorWords[]
 *     • container.title (for pattern matching to select a default family)
 *     • GlobalShare tradeVocabulary (allowlist)
 *   NEVER reads section.content or section.groqContent.
 *
 * Safety:
 *   • --dry-run is the default. Prints every planned write with reason
 *     (tier 1 / tier 2 / tier 3-default).
 *   • --apply is required to persist.
 *   • Skips meta containers (noAnchor=true OR title matches meta pattern).
 *   • Skips sections that already have tradeTerms.length > 0 (manual overrides
 *     are never overwritten).
 *   • Writes use dot-notation $set (sections.${i}.tradeTerms) — never replaces
 *     the full sections array (preserves the save-safety rule).
 *   • Validates every candidate against the runtime allowlist before write;
 *     any term not in the allowlist is rejected silently.
 *   • Caps per-section tradeTerms at 12.
 *
 * Usage — paste into Render Shell:
 *   node scripts/fill-stubborn-trade-terms.js               # dry-run
 *   node scripts/fill-stubborn-trade-terms.js --apply       # write
 *   node scripts/fill-stubborn-trade-terms.js --apply COMP  # other company
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';

// Parse args
const args      = process.argv.slice(2);
const APPLY     = args.includes('--apply');
const COMPANY_ID = args.find(a => !a.startsWith('--')) || PENGUIN_AIR_ID;

const MAX_TERMS_PER_SECTION = 12;

// ──────────────────────────────────────────────────────────────────────────
// Meta-container whitelist
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
// STOP set — mirrors _extractContentKeywords stopwords
// ──────────────────────────────────────────────────────────────────────────
const STOP = new Set([
  'the','and','for','with','from','that','this','have','will','your','you','are',
  'but','not','can','has','had','was','were','been','being','their','there','these',
  'those','they','them','what','when','where','which','while','who','whom','why',
  'how','any','all','our','one','two','out','our','its','it\'s','i\'ll','i\'d',
  'need','needs','want','wants','get','got','let','like','much','very','just',
  'about','into','over','than','then','some','more','most','also','only','even',
  'still','yeah','yes','please','thanks','thank','okay','ok','sure','right',
]);

// ──────────────────────────────────────────────────────────────────────────
// Container default families — title-pattern → candidate tradeTerm list
// Every candidate MUST be validated against the live allowlist before write.
// Unknown terms are dropped at runtime, never shipped.
// ──────────────────────────────────────────────────────────────────────────
const DEFAULT_FAMILIES = [
  {
    match: /no cooling/i,
    terms: ['cooling', 'ac', 'hvac', 'air conditioning', 'air conditioner', 'compressor', 'refrigerant', 'condenser', 'thermostat', 'unit'],
  },
  {
    match: /diagnostic/i,
    terms: ['diagnostic', 'service call', 'inspection', 'technician', 'ac', 'hvac', 'system'],
  },
  {
    match: /maintenance/i,
    terms: ['maintenance', 'tune up', 'tune-up', 'service', 'filter', 'coil', 'inspection', 'hvac', 'ac', 'system'],
  },
  {
    match: /duct/i,
    terms: ['duct', 'ductwork', 'vent', 'airflow', 'return', 'supply', 'hvac', 'system'],
  },
  {
    match: /new system|install(ation)?/i,
    terms: ['installation', 'install', 'replacement', 'system', 'unit', 'ac', 'hvac', 'condenser', 'air handler'],
  },
  {
    match: /repair/i,
    terms: ['repair', 'service', 'fix', 'ac', 'hvac', 'system', 'technician'],
  },
  {
    match: /dryer vent/i,
    terms: ['dryer vent', 'dryer', 'vent', 'ductwork', 'lint'],
  },
  {
    match: /heat|furnace|heating/i,
    terms: ['heat', 'heating', 'furnace', 'heat pump', 'system', 'hvac'],
  },
  // Universal fallback — applies if no title pattern matched
  {
    match: /.*/,
    terms: ['hvac', 'ac', 'air conditioning', 'system', 'service'],
  },
];

function _pickDefaultFamily(title) {
  for (const fam of DEFAULT_FAMILIES) {
    if (fam.match.test(title || '')) return fam.terms;
  }
  return DEFAULT_FAMILIES[DEFAULT_FAMILIES.length - 1].terms;
}

// ──────────────────────────────────────────────────────────────────────────
// Tokenizer — unigrams + bigrams, minimum length 3
// ──────────────────────────────────────────────────────────────────────────
function _tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const clean = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(w => w.length >= 3 && !STOP.has(w));
  const out = new Set(words);
  // bigrams
  for (let i = 0; i < words.length - 1; i++) {
    out.add(`${words[i]} ${words[i + 1]}`);
  }
  return Array.from(out);
}

function _extractPhraseSignal(section) {
  const parts = [];
  if (section.label) parts.push(section.label);
  const phrases = Array.isArray(section.callerPhrases) ? section.callerPhrases : [];
  for (const p of phrases) {
    if (p.text) parts.push(p.text);
    if (Array.isArray(p.anchorWords)) {
      for (const a of p.anchorWords) if (a) parts.push(a);
    }
  }
  return _tokenize(parts.join(' '));
}

function _extractLabelSignal(section) {
  return _tokenize(section.label || '');
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

  const mode = APPLY ? 'APPLY (writes)' : 'DRY-RUN (read-only)';
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`FILL STUBBORN TRADE TERMS — ${COMPANY_ID}`);
  console.log(`Mode: ${mode}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('clientsvia');

  // ── Load allowlist ──────────────────────────────────────────────────────
  // Shape: globalHub.phraseIntelligence.tradeVocabularies = [{ tradeKey, label, terms[] }]
  // Match: container.tradeVocabularyKey === vocab.tradeKey (case-exact)
  const adminDoc = await db.collection('adminsettings').findOne({});
  const vocabs = adminDoc?.globalHub?.phraseIntelligence?.tradeVocabularies || [];
  const allowlists = {};
  for (const v of vocabs) {
    if (!v || !v.tradeKey) continue;
    allowlists[v.tradeKey] = new Set(
      (Array.isArray(v.terms) ? v.terms : [])
        .map(t => (typeof t === 'string' ? t.toLowerCase().trim() : ''))
        .filter(Boolean)
    );
  }

  // ── Load containers ────────────────────────────────────────────────────
  // NOTE: collection name is camelCase, companyId is STRING (not ObjectId)
  const kcCol = db.collection('companyKnowledgeContainers');
  const containers = await kcCol
    .find({ companyId: COMPANY_ID })
    .sort({ title: 1 })
    .toArray();

  let totalSkippedMeta   = 0;
  let totalSkippedNoKey  = 0;
  let totalAlreadyFilled = 0;
  let totalFilledTier1   = 0;
  let totalFilledTier2   = 0;
  let totalFilledTier3   = 0;
  let totalStillEmpty    = 0;
  const writes = []; // { kcId, idx, terms, tier }

  for (const c of containers) {
    const title  = c.title || '(untitled)';
    const isMeta = _isMetaContainer(title) || c.noAnchor === true;
    const vk     = c.tradeVocabularyKey;

    if (isMeta) {
      totalSkippedMeta += (c.sections || []).length;
      continue;
    }
    if (!vk) {
      totalSkippedNoKey += (c.sections || []).length;
      continue;
    }
    const allow = allowlists[vk];
    if (!allow || allow.size === 0) {
      console.log(`⚠️  ${title}: tradeVocabularyKey "${vk}" has no allowlist — skipping`);
      continue;
    }

    const sections = Array.isArray(c.sections) ? c.sections : [];
    const defaultFamily = _pickDefaultFamily(title);
    let containerHeaderPrinted = false;

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (s.isActive === false) continue;
      const existing = Array.isArray(s.tradeTerms) ? s.tradeTerms : [];
      if (existing.length > 0) { totalAlreadyFilled++; continue; }

      // Tier 1 — phrase signal ∩ allowlist
      const phraseSig = _extractPhraseSignal(s);
      const tier1 = phraseSig.filter(t => allow.has(t));

      // Tier 2 — label signal ∩ allowlist
      const labelSig = _extractLabelSignal(s);
      const tier2 = labelSig.filter(t => allow.has(t));

      // Tier 3 — container defaults ∩ allowlist
      const tier3 = defaultFamily.filter(t => allow.has(t));

      // Merge in priority order, dedupe, cap
      const merged = [];
      const seen = new Set();
      const usedTiers = [];
      for (const [tierName, list] of [['T1', tier1], ['T2', tier2], ['T3', tier3]]) {
        let added = false;
        for (const t of list) {
          if (seen.has(t)) continue;
          if (merged.length >= MAX_TERMS_PER_SECTION) break;
          merged.push(t);
          seen.add(t);
          added = true;
        }
        if (added) usedTiers.push(tierName);
      }

      if (!containerHeaderPrinted) {
        console.log(`\n▶ ${title}  (vocab=${vk}, default-family=${JSON.stringify(defaultFamily)})`);
        containerHeaderPrinted = true;
      }

      if (merged.length === 0) {
        totalStillEmpty++;
        console.log(`    [${i}] "${s.label || '(no label)'}" — ⚠️ still empty (no T1/T2/T3 hit)`);
        continue;
      }

      // Tier accounting (per section — count the TOP tier contributed)
      if (tier1.length > 0) totalFilledTier1++;
      else if (tier2.length > 0) totalFilledTier2++;
      else totalFilledTier3++;

      writes.push({ kcId: c._id, idx: i, terms: merged, tier: usedTiers.join('+'), label: s.label });
      console.log(`    [${i}] "${s.label || '(no label)'}" → ${JSON.stringify(merged)}  [${usedTiers.join('+')}]`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Skipped (meta containers):       ${totalSkippedMeta}`);
  console.log(`  Skipped (no tradeVocabularyKey): ${totalSkippedNoKey}`);
  console.log(`  Skipped (already filled):        ${totalAlreadyFilled}`);
  console.log(`  Filled via Tier 1 (phrases):     ${totalFilledTier1}`);
  console.log(`  Filled via Tier 2 (label):       ${totalFilledTier2}`);
  console.log(`  Filled via Tier 3 (defaults):    ${totalFilledTier3}`);
  console.log(`  Still empty (review manually):   ${totalStillEmpty}`);
  console.log(`  TOTAL planned writes:            ${writes.length}`);
  console.log('');

  if (!APPLY) {
    console.log('Dry-run only — no writes. Re-run with --apply to persist.\n');
    await client.close();
    return;
  }

  // ── APPLY ──────────────────────────────────────────────────────────────
  console.log(`\nApplying ${writes.length} writes...`);
  let applied = 0;
  let failed  = 0;
  for (const w of writes) {
    try {
      const res = await kcCol.updateOne(
        { _id: w.kcId },
        { $set: { [`sections.${w.idx}.tradeTerms`]: w.terms } }
      );
      if (res.modifiedCount === 1) {
        applied++;
      } else {
        failed++;
        console.log(`    ⚠️ no-op for kc=${w.kcId} idx=${w.idx}  (modifiedCount=0)`);
      }
    } catch (err) {
      failed++;
      console.error(`    ❌ failed kc=${w.kcId} idx=${w.idx}: ${err.message}`);
    }
  }
  console.log(`\n  Applied: ${applied}`);
  console.log(`  Failed:  ${failed}`);
  console.log('');
  console.log('Next: open services.html → bulk Re-score All → Foundation strip');
  console.log('should show tradeTermsFilledPct climbing above 95%.');
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('❌ fill failed:', err);
  process.exit(1);
});
