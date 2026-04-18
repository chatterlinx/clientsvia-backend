'use strict';

/**
 * ============================================================================
 * BACKFILL tradeTerms — PHRASE-ONLY Derivation
 * ============================================================================
 *
 * PURPOSE:
 *   CueExtractor GATE 2.4 uses `section.tradeTerms[]` as Field 8 (tradeCore).
 *   When tradeTerms is empty, this field is dark and GATE 2.4 can't early-exit
 *   on strong trade-vocabulary matches. April 2026 audit found tradeTerms
 *   empty on 479/479 sections across Penguin Air. This script backfills them.
 *
 * ARCHITECTURAL INVARIANT (locked):
 *   UAP reads PHRASES.  Groq reads RESPONSES.
 *   This script sources tradeTerms ONLY from phrase-side fields:
 *     - section.label
 *     - section.callerPhrases[].text
 *     - section.callerPhrases[].anchorWords[]
 *   It NEVER reads section.content or section.groqContent.
 *
 *   The allowlist filter (container's GlobalShare tradeVocabulary) ensures
 *   only real trade vocabulary survives — not noisy phrase tokens.
 *
 * USAGE — Render Shell:
 *   node scripts/backfill-trade-terms.js                            # dry-run, all companies
 *   node scripts/backfill-trade-terms.js <companyId>                # dry-run, one company
 *   node scripts/backfill-trade-terms.js <companyId> --apply        # apply writes
 *   node scripts/backfill-trade-terms.js all --apply                # apply, all companies
 *
 * SAFETY:
 *   - Dry-run by default
 *   - Skips sections where tradeTerms already populated (manual overrides safe)
 *   - Skips noAnchor=true meta-containers
 *   - Skips containers without tradeVocabularyKey
 *   - Uses dot-notation $set (never replaces full sections array)
 *   - Caps 15 terms per section
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

// ──────────────────────────────────────────────────────────────────────────
// Args
// ──────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let APPLY      = false;
let COMPANY_ID = null;

for (const a of args) {
  if (a === '--apply') APPLY = true;
  else if (!COMPANY_ID) COMPANY_ID = a;
}

// ──────────────────────────────────────────────────────────────────────────
// Minimal stop set (inline — script runs on Render Shell without mongoose init)
// Admin STOP list lives in AdminSettings.globalHub.dictionaries.stopWords and
// will be merged in at runtime via utils/stopWords; this static set is enough
// for the one-time backfill de-noise step before the tradeVocabulary allowlist
// does the real filtering.
// ──────────────────────────────────────────────────────────────────────────
const STOP = new Set([
  'the','a','an','and','or','but','if','is','are','was','were','be','been','being',
  'to','of','in','on','at','for','with','by','from','as','into','about','over',
  'i','you','he','she','it','we','they','me','my','your','his','her','its','our','their',
  'this','that','these','those','there','here','where','when','why','how','what','who','which',
  'do','does','did','done','doing','has','have','had','having',
  'can','could','should','would','will','may','might','must','shall',
  'not','no','nor','so','than','then','too','very','just','also',
  'get','got','go','goes','going','come','came','take','took',
  'some','any','all','each','every','other','another','such','much','many','more','most','less',
  'am','up','down','out','off','over','under','through','between','among','across',
  'yes','yeah','okay','ok','um','uh','well','oh','hi','hello',
  'one','two','three','please','thanks','thank','really','kind',
  'know','think','thought','say','said','ask','asked','see','seen','look','looks',
]);

// ──────────────────────────────────────────────────────────────────────────
// Tokenisation & candidate extraction (phrase-side only)
// ──────────────────────────────────────────────────────────────────────────
function _normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function _tokens(s) {
  return _normalize(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
}

/**
 * Build candidate terms for one section using PHRASE-SIDE sources only.
 * Returns Map<term, freq> — frequency = number of phrases containing that term
 * (or the label counted once).
 */
function _buildCandidates(section) {
  const candidates = new Map(); // term → freq
  const addFromText = (text, weight = 1) => {
    const toks = _tokens(text);
    // Unigrams (≥4 chars, non-stop)
    const seen = new Set();
    for (const w of toks) {
      if (seen.has(w)) continue;
      seen.add(w);
      candidates.set(w, (candidates.get(w) || 0) + weight);
    }
    // Bigrams — consecutive content words
    for (let i = 0; i < toks.length - 1; i++) {
      const bg = `${toks[i]} ${toks[i + 1]}`;
      if (seen.has(bg)) continue;
      seen.add(bg);
      candidates.set(bg, (candidates.get(bg) || 0) + weight);
    }
  };

  // 1. Section label (counts once, weight 2 — label is strong signal)
  if (section.label) addFromText(section.label, 2);

  // 2. callerPhrases[].text
  for (const p of (section.callerPhrases || [])) {
    if (p && p.text) addFromText(p.text, 1);
  }

  // 3. callerPhrases[].anchorWords[] — each anchor contributes as a unigram
  for (const p of (section.callerPhrases || [])) {
    for (const aw of (p.anchorWords || [])) {
      const n = _normalize(aw);
      if (n.length >= 4 && !STOP.has(n)) {
        candidates.set(n, (candidates.get(n) || 0) + 1);
      }
    }
  }

  return candidates;
}

/**
 * Filter candidates against the container's trade vocabulary allowlist.
 * allowSet is a Set of lowercase terms from GlobalShare tradeVocabulary.
 * Keeps terms with freq >= 2 OR that appear in the section label.
 */
function _applyAllowlist(candidates, allowSet, labelTokens) {
  const out = [];
  for (const [term, freq] of candidates.entries()) {
    if (!allowSet.has(term)) continue;
    if (freq >= 2 || labelTokens.has(term)) out.push({ term, freq });
  }
  // Sort by freq desc, tie-break by longer term first (more specific)
  out.sort((a, b) => (b.freq - a.freq) || (b.term.length - a.term.length));
  return out.slice(0, 15).map(x => x.term);
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('ERROR: MONGODB_URI not set.'); process.exit(1); }

  const client = new MongoClient(uri);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' BACKFILL tradeTerms (phrase-only) — ' + (APPLY ? 'APPLY MODE' : 'DRY RUN'));
  console.log('═══════════════════════════════════════════════════════════════════');

  try {
    await client.connect();
    const db         = client.db('clientsvia');
    const containers = db.collection('companyKnowledgeContainers');
    const settingsC  = db.collection('adminsettings'); // default collection name for AdminSettings

    // Load trade vocabularies from GlobalShare
    const settings = await settingsC.findOne({}, { projection: { 'globalHub.phraseIntelligence.tradeVocabularies': 1 } });
    const vocabs   = (settings?.globalHub?.phraseIntelligence?.tradeVocabularies) || [];
    const vocabByKey = {};
    for (const v of vocabs) {
      if (v && v.tradeKey) {
        const s = new Set((v.terms || []).map(t => _normalize(t)).filter(Boolean));
        vocabByKey[v.tradeKey] = s;
        console.log(`   Loaded vocab "${v.tradeKey}" — ${s.size} terms`);
      }
    }
    if (Object.keys(vocabByKey).length === 0) {
      console.warn('   ⚠️  No trade vocabularies found in AdminSettings.globalHub.phraseIntelligence.tradeVocabularies');
      console.warn('   ⚠️  Run scripts/seed-trade-vocab-hvac.js first, then retry.');
    }

    // Build filter
    const filter = {};
    if (COMPANY_ID && COMPANY_ID !== 'all') filter.companyId = new ObjectId(COMPANY_ID);

    const cursor = containers.find(filter, {
      projection: {
        companyId:          1,
        title:              1,
        kcId:               1,
        noAnchor:           1,
        tradeVocabularyKey: 1,
        sections:           1, // NOTE: full sections — unavoidable for this audit
      }
    });

    let totalContainers         = 0;
    let skippedNoAnchor         = 0;
    let skippedNoVocabKey       = 0;
    let skippedVocabMissing     = 0;
    let totalSections           = 0;
    let sectionsAlreadyFilled   = 0;
    let sectionsNoPhrases       = 0;
    let sectionsFilled          = 0;
    let totalTermsAdded         = 0;

    for await (const c of cursor) {
      totalContainers++;
      const companyId = String(c.companyId);

      if (c.noAnchor === true) {
        console.log(`\n── Skip (noAnchor=true): "${c.title}" [${companyId}]`);
        skippedNoAnchor++;
        continue;
      }
      if (!c.tradeVocabularyKey) {
        console.log(`\n── Skip (no tradeVocabularyKey): "${c.title}" [${companyId}]`);
        skippedNoVocabKey++;
        continue;
      }
      const allowSet = vocabByKey[c.tradeVocabularyKey];
      if (!allowSet) {
        console.log(`\n── Skip (vocabulary "${c.tradeVocabularyKey}" not found in GlobalShare): "${c.title}" [${companyId}]`);
        skippedVocabMissing++;
        continue;
      }

      console.log(`\n── Container: "${c.title}" (${c.tradeVocabularyKey}) [${companyId}]`);

      const sections = c.sections || [];
      for (let idx = 0; idx < sections.length; idx++) {
        const s = sections[idx];
        totalSections++;

        if (!s || s.isActive === false) continue;

        if ((s.tradeTerms || []).length > 0) {
          sectionsAlreadyFilled++;
          continue;
        }

        const phrases = s.callerPhrases || [];
        if (phrases.length === 0) {
          sectionsNoPhrases++;
          continue;
        }

        // Candidate extraction (phrase-only)
        const candidates = _buildCandidates(s);
        const labelTokens = new Set(_tokens(s.label || ''));

        const accepted = _applyAllowlist(candidates, allowSet, labelTokens);

        if (accepted.length === 0) {
          console.log(`     [${idx}] "${s.label}" — 0 terms after allowlist, skip`);
          continue;
        }

        console.log(`     [${idx}] "${s.label}"`);
        console.log(`         → ${accepted.length} tradeTerms: ${accepted.join(', ')}`);
        sectionsFilled++;
        totalTermsAdded += accepted.length;

        if (APPLY) {
          const setKey = `sections.${idx}.tradeTerms`;
          await containers.updateOne(
            { _id: c._id },
            { $set: { [setKey]: accepted } }
          );
        }
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(' SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(` Containers scanned:          ${totalContainers}`);
    console.log(`   skipped (noAnchor):        ${skippedNoAnchor}`);
    console.log(`   skipped (no vocab key):    ${skippedNoVocabKey}`);
    console.log(`   skipped (vocab missing):   ${skippedVocabMissing}`);
    console.log(` Sections scanned:            ${totalSections}`);
    console.log(`   already filled:            ${sectionsAlreadyFilled}`);
    console.log(`   no phrases:                ${sectionsNoPhrases}`);
    console.log(`   ${APPLY ? 'filled' : 'would fill'}:${(APPLY ? '                   ' : '             ')}${sectionsFilled}`);
    console.log(` Total terms ${APPLY ? 'added' : 'would-add'}:   ${totalTermsAdded}`);
    if (sectionsFilled > 0) {
      console.log(` Avg terms per section:       ${(totalTermsAdded / sectionsFilled).toFixed(1)}`);
    }
    console.log('═══════════════════════════════════════════════════════════════════');
    if (!APPLY) console.log(' → Dry run. Re-run with --apply to perform writes.');
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
