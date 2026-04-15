// Diagnostic: Trace CueExtractor pipeline for a real utterance
// Run on Render Shell: node scripts/diag-cue-extractor.js
const { MongoClient } = require('mongodb');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air

// Turn 4 from call report — should produce 5+ cue fields
const TEST_UTTERANCE = 'I want to ask you. Um, how much is my service phone going to be. Uh, do I have to pay for this call today? Seeing that you guys came out here like 3 times already.';

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('clientsvia');

  // ── STEP 1: Load cue patterns from GlobalShare ──────────────────────
  console.log('═══ STEP 1: Cue Patterns from GlobalShare ═══');
  const settings = await db.collection('adminsettings').findOne({});
  const pi = settings?.globalHub?.phraseIntelligence;
  const cuePhrases = pi?.cuePhrases || [];
  console.log('Total cue patterns:', cuePhrases.length);

  // Group by token
  const byToken = {};
  for (const cp of cuePhrases) {
    const token = (cp.token || '').toLowerCase();
    if (!token) continue;
    if (!byToken[token]) byToken[token] = [];
    byToken[token].push(cp.pattern.toLowerCase().trim());
  }
  for (const token of Object.keys(byToken)) {
    byToken[token].sort((a, b) => b.length - a.length);
    console.log(`  ${token}: ${byToken[token].length} patterns`);
  }

  // ── STEP 2: Load trade vocabularies ─────────────────────────────────
  console.log('\n═══ STEP 2: Trade Vocabularies ═══');
  const vocabs = pi?.tradeVocabularies || [];
  console.log('Vocabularies:', vocabs.length);
  for (const v of vocabs) {
    console.log(`  ${v.tradeKey}: ${(v.terms || []).length} terms`);
  }

  // ── STEP 3: Build trade index for company ───────────────────────────
  console.log('\n═══ STEP 3: Trade Index Build ═══');
  const containers = await db.collection('companyKnowledgeContainers').find({
    companyId: COMPANY_ID,
    isActive: true,
  }, {
    projection: {
      _id: 1, title: 1, tradeVocabularyKey: 1,
      'sections.label': 1, 'sections.isActive': 1, 'sections.tradeTerms': 1,
    },
  }).toArray();
  console.log('Active containers:', containers.length);

  const vocabMap = {};
  for (const v of vocabs) {
    vocabMap[v.tradeKey] = v.terms || [];
  }

  const tradeIndex = {};
  let containerLevelCount = 0;
  let sectionLevelCount = 0;

  for (const c of containers) {
    const cId = String(c._id);

    // Source 1: Global vocab via tradeVocabularyKey
    if (c.tradeVocabularyKey && vocabMap[c.tradeVocabularyKey]) {
      for (const term of vocabMap[c.tradeVocabularyKey]) {
        const norm = term.toLowerCase().trim();
        if (!norm) continue;
        if (!tradeIndex[norm]) tradeIndex[norm] = [];
        tradeIndex[norm].push({
          term, containerId: cId, sectionIdx: -1, sectionLabel: '',
        });
        containerLevelCount++;
      }
    }

    // Source 2: Per-section tradeTerms
    const sections = c.sections || [];
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const section = sections[sIdx];
      if (section.isActive === false) continue;
      for (const term of (section.tradeTerms || [])) {
        const norm = term.toLowerCase().trim();
        if (!norm) continue;
        if (!tradeIndex[norm]) tradeIndex[norm] = [];
        tradeIndex[norm].push({
          term, containerId: cId, sectionIdx: sIdx, sectionLabel: section.label || '',
        });
        sectionLevelCount++;
      }
    }
  }

  const uniqueTerms = Object.keys(tradeIndex).length;
  console.log('Trade index unique terms:', uniqueTerms);
  console.log('  Container-level entries:', containerLevelCount);
  console.log('  Section-level entries:', sectionLevelCount);

  // ── STEP 4: Extract cue fields from utterance ───────────────────────
  console.log('\n═══ STEP 4: Extract from Utterance ═══');
  console.log('Utterance:', TEST_UTTERANCE.substring(0, 80) + '...');
  const lower = TEST_UTTERANCE.toLowerCase().trim();

  const CUE_FIELDS = [
    'requestCue', 'permissionCue', 'infoCue', 'directiveCue',
    'actionCore', 'urgencyCore', 'modifierCore',
  ];

  const frame = {};
  for (const f of CUE_FIELDS) frame[f] = null;

  for (const field of CUE_FIELDS) {
    const token = field.toLowerCase();
    const patterns = byToken[token];
    if (!patterns) continue;
    for (const pat of patterns) {
      if (lower.includes(pat)) {
        frame[field] = pat;
        break;
      }
    }
  }

  console.log('\nFields 1-7 results:');
  let fieldCount = 0;
  for (const field of CUE_FIELDS) {
    const val = frame[field];
    if (val) fieldCount++;
    console.log(`  ${field}: ${val || '—'}`);
  }

  // ── STEP 5: Match trade terms ───────────────────────────────────────
  console.log('\nField 8 (tradeCore):');
  const tradeTerms = Object.keys(tradeIndex);
  tradeTerms.sort((a, b) => b.length - a.length);

  const tradeMatches = [];
  const matched = new Set();
  for (const term of tradeTerms) {
    if (lower.includes(term)) {
      const entries = tradeIndex[term];
      for (const entry of entries) {
        const key = `${entry.containerId}:${entry.sectionIdx}`;
        if (!matched.has(key)) {
          matched.add(key);
          tradeMatches.push(entry);
        }
      }
    }
  }

  if (tradeMatches.length > 0) {
    fieldCount++;
    // Show first 10 matches
    const show = tradeMatches.slice(0, 10);
    for (const m of show) {
      const c = containers.find(x => String(x._id) === m.containerId);
      console.log(`  MATCH: "${m.term}" → ${c?.title || '?'} (sectionIdx=${m.sectionIdx}, label="${m.sectionLabel}")`);
    }
    if (tradeMatches.length > 10) console.log(`  ... and ${tradeMatches.length - 10} more`);
  } else {
    console.log('  NO trade matches');
  }

  // ── STEP 6: GATE 2.4 verdict ───────────────────────────────────────
  console.log('\n═══ GATE 2.4 VERDICT ═══');
  console.log('fieldCount:', fieldCount, '(min required: 3)');
  console.log('tradeMatches:', tradeMatches.length, '(min required: 1)');
  const wouldRoute = fieldCount >= 3 && tradeMatches.length > 0;
  console.log('GATE 2.4 would route:', wouldRoute ? 'YES ✓' : 'NO ✗');

  if (wouldRoute) {
    const best = tradeMatches[0];
    const bc = containers.find(x => String(x._id) === best.containerId);
    console.log('Best trade match:', `"${best.term}" → ${bc?.title || '?'} (sectionIdx=${best.sectionIdx})`);
    console.log('isContainerLevel:', best.sectionIdx === -1);
  }

  await client.close();
})().catch(e => console.error('ERROR:', e.message));
