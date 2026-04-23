'use strict';

/**
 * ============================================================================
 * BACKFILL contentKeywords FROM CONTENT ONLY (no section.label)
 * ============================================================================
 *
 * Purpose:
 *   Historical _extractContentKeywords(label, content) blended section.label
 *   tokens into contentKeywords at weight ×2. That violated the locked rule:
 *   container.title + section.label are ADMIN-ONLY metadata and must never
 *   influence routing. The code was fixed in commit (Stage 3), but every
 *   section in the database still carries polluted contentKeywords from the
 *   old derivation. This script re-extracts contentKeywords from section.content
 *   (+ section.groqContent when available) ONLY, across every company.
 *
 * Usage (Render Shell):
 *   node scripts/backfill-contentkeywords-content-only.js               # all companies, write
 *   node scripts/backfill-contentkeywords-content-only.js --dry         # all companies, dry-run
 *   node scripts/backfill-contentkeywords-content-only.js --company=ID  # one company
 *   node scripts/backfill-contentkeywords-content-only.js --company=ID --dry
 *
 * Safety:
 *   - Idempotent (re-running produces the same output for unchanged content).
 *   - Per-section targeted $set via arrayFilters — does NOT replace whole sections.
 *   - Skips sections where the derivation is identical to existing keywords.
 *
 * Reads:  companiesCollection (DB: clientsvia) — NOT v2companies.
 * Writes: contentKeywords[] on each section of each KC container.
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

const URI    = process.env.MONGODB_URI;
const DBNAME = 'clientsvia';
const CONTAINERS_COLL = 'companyknowledgecontainers';

// ── CLI parsing ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY  = args.includes('--dry');
const COMPANY_ARG = args.find(a => a.startsWith('--company='));
const ONLY_COMPANY = COMPANY_ARG ? COMPANY_ARG.split('=')[1] : null;

if (!URI) {
  console.error('ERR: MONGODB_URI env var not set.');
  process.exit(1);
}

// ── Stop words (must match utils/stopWords.js exactly) ────────────────────
// Imported dynamically so we match the runtime derivation byte-for-byte.
let STOP;
try {
  const StopWords = require('../utils/stopWords');
  STOP = StopWords.getStopWords();
} catch (err) {
  console.error('ERR: utils/stopWords.js not found or failed to load:', err.message);
  process.exit(1);
}

// ── Derivation (must match companyKnowledge.js::_extractContentKeywords) ──
function extract(content) {
  const text = `${content || ''}`.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = text.split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  if (!words.length) return [];
  const keywords = new Set();
  for (const w of words) if (w.length >= 5) keywords.add(w);
  for (let i = 0; i < words.length - 1; i++) keywords.add(`${words[i]} ${words[i + 1]}`);
  return [...keywords].slice(0, 40);
}

const arraysEqual = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DBNAME);
  const containers = db.collection(CONTAINERS_COLL);

  const filter = ONLY_COMPANY ? { companyId: new ObjectId(ONLY_COMPANY) } : {};
  const cursor = containers.find(filter).project({ _id: 1, companyId: 1, title: 1, sections: 1 });

  let containersSeen = 0;
  let containersTouched = 0;
  let sectionsRewritten = 0;
  let sectionsUnchanged = 0;
  const perCompany = new Map(); // companyId → { touched, rewritten }

  while (await cursor.hasNext()) {
    const c = await cursor.next();
    containersSeen++;

    const cid = String(c.companyId || '(no companyId)');
    if (!perCompany.has(cid)) perCompany.set(cid, { touched: 0, rewritten: 0 });

    const updates = [];
    for (let i = 0; i < (c.sections || []).length; i++) {
      const section = c.sections[i];
      const contentSource = section.groqContent
        ? `${section.content || ''} ${section.groqContent}`
        : (section.content || '');
      const nextKeywords = extract(contentSource);
      const prevKeywords = Array.isArray(section.contentKeywords) ? section.contentKeywords : [];

      if (arraysEqual(prevKeywords, nextKeywords)) {
        sectionsUnchanged++;
        continue;
      }
      updates.push({ sectionId: section._id, idx: i, nextKeywords, prevLen: prevKeywords.length, nextLen: nextKeywords.length });
    }

    if (!updates.length) continue;
    containersTouched++;
    perCompany.get(cid).touched++;

    console.log(`\n[${c._id}] "${c.title || '(untitled)'}"  company=${cid}  sections_to_rewrite=${updates.length}`);

    if (DRY) {
      for (const u of updates) {
        console.log(`  · section[${u.idx}]  ${u.prevLen} → ${u.nextLen} keywords`);
      }
      continue;
    }

    // Apply one section at a time with arrayFilter so we never replace the full
    // sections[] array (which would wipe embeddings etc).
    for (const u of updates) {
      try {
        const res = await containers.updateOne(
          { _id: c._id },
          { $set: { 'sections.$[s].contentKeywords': u.nextKeywords } },
          { arrayFilters: [{ 's._id': u.sectionId }] }
        );
        if (res.modifiedCount === 1) {
          sectionsRewritten++;
          perCompany.get(cid).rewritten++;
        } else {
          console.warn(`  ⚠ section[${u.idx}] _id=${u.sectionId} not modified (match=${res.matchedCount}).`);
        }
      } catch (err) {
        console.error(`  ✗ section[${u.idx}] _id=${u.sectionId} write failed: ${err.message}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(DRY ? 'DRY RUN SUMMARY' : 'WRITE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`Containers seen:       ${containersSeen}`);
  console.log(`Containers with changes: ${containersTouched}`);
  console.log(`Sections rewritten:    ${sectionsRewritten}`);
  console.log(`Sections unchanged:    ${sectionsUnchanged}`);
  console.log('');
  console.log('Per-company:');
  for (const [cid, { touched, rewritten }] of perCompany) {
    console.log(`  ${cid}  containers=${touched}  sections=${rewritten}`);
  }
  console.log('');
  console.log(DRY ? 'Re-run without --dry to apply.' : 'Done. Verify with Foundation scan + a live test call.');

  await client.close();
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
