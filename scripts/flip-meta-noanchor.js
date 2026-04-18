'use strict';

/**
 * ============================================================================
 * FLIP META-CONTAINER noAnchor FLAG — one-shot config repair
 * ============================================================================
 *
 * PURPOSE:
 *   Meta-conversation KC containers (Conversational Recovery, Price Objections,
 *   Scheduling & Availability, Warranty & Guarantee, Appointment Management,
 *   Spam & Solicitation) MUST have `noAnchor: true` so they never become the
 *   anchor container at runtime. A Turn 1 frustration phrase matching Recovery
 *   would otherwise give Recovery a 3× keyword boost for the rest of the call,
 *   drowning out real HVAC routing.
 *
 *   This script detects meta-containers by title regex, reports their current
 *   state, and (with --apply) flips `noAnchor: true`.
 *
 * USAGE — Render Shell:
 *   node scripts/flip-meta-noanchor.js [companyId]                # dry-run (all companies if no id)
 *   node scripts/flip-meta-noanchor.js [companyId] --apply        # perform writes
 *   node scripts/flip-meta-noanchor.js all --apply                # all companies
 *   node scripts/flip-meta-noanchor.js 68e3f77a9d623b8058c700c4   # Penguin Air dry-run
 *
 *   --include "Maintenance Member Benefits"  add an extra title pattern
 *
 * SAFETY:
 *   - Dry-run by default (no --apply → read-only)
 *   - Idempotent (skips containers already noAnchor=true)
 *   - Reports every match with before/after state
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

// ──────────────────────────────────────────────────────────────────────────
// Args
// ──────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let   APPLY = false;
let   COMPANY_ID = null;
const EXTRA_PATTERNS = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--apply')   APPLY = true;
  else if (a === '--include' && args[i + 1]) { EXTRA_PATTERNS.push(args[++i]); }
  else if (!COMPANY_ID) COMPANY_ID = a;
}

// ──────────────────────────────────────────────────────────────────────────
// Meta-container title patterns (whitelist)
// ──────────────────────────────────────────────────────────────────────────
const META_PATTERNS = [
  /^conversational recovery$/i,
  /^price objections?$/i,
  /^scheduling\s*&\s*availability$/i,
  /^warranty\s*&\s*guarantee$/i,
  /^appointment management$/i,
  /^spam\s*&\s*solicitation$/i,
  ...EXTRA_PATTERNS.map(p => new RegExp(p, 'i')),
];

function _isMeta(title) {
  if (!title) return false;
  return META_PATTERNS.some(re => re.test(title.trim()));
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: MONGODB_URI env var not set.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' FLIP META-CONTAINER noAnchor — ' + (APPLY ? 'APPLY MODE' : 'DRY RUN'));
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' Patterns:');
  for (const re of META_PATTERNS) console.log('   ' + re);
  console.log('');

  try {
    await client.connect();
    const db         = client.db('clientsvia');
    const containers = db.collection('companyKnowledgeContainers');

    // Build filter: all meta-candidates, optionally scoped to companyId
    const filter = {};
    if (COMPANY_ID && COMPANY_ID !== 'all') {
      filter.companyId = new ObjectId(COMPANY_ID);
    }
    // Use an $or of regexes — cheaper than scanning all
    filter.$or = META_PATTERNS.map(re => ({ title: { $regex: re.source, $options: re.flags } }));

    const docs = await containers
      .find(filter, { projection: { companyId: 1, title: 1, noAnchor: 1, kcId: 1 } })
      .toArray();

    if (docs.length === 0) {
      console.log(' No meta-containers matched. Nothing to do.');
      return;
    }

    // Group by companyId for readable output
    const byCompany = {};
    for (const d of docs) {
      const cid = String(d.companyId);
      if (!byCompany[cid]) byCompany[cid] = [];
      byCompany[cid].push(d);
    }

    let totalMatched  = 0;
    let totalSkipped  = 0;
    let totalFlipped  = 0;

    for (const cid of Object.keys(byCompany)) {
      console.log(`\n── Company: ${cid} ──`);
      for (const d of byCompany[cid]) {
        totalMatched++;
        const current = d.noAnchor === true;
        const tag     = current ? '[already true, skip]' : '[FLIP → true]';
        console.log(`   ${tag.padEnd(22)} "${d.title}"  ${d.kcId || '(no kcId)'}`);

        if (current) { totalSkipped++; continue; }

        if (APPLY) {
          const r = await containers.updateOne(
            { _id: d._id },
            { $set: { noAnchor: true } }
          );
          if (r.modifiedCount === 1) totalFlipped++;
        } else {
          totalFlipped++; // would-flip count in dry-run
        }
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(` Summary: matched=${totalMatched}  already-true=${totalSkipped}  ${APPLY ? 'flipped' : 'would-flip'}=${totalFlipped}`);
    if (!APPLY && totalFlipped > 0) {
      console.log('');
      console.log(' → Dry run. Re-run with --apply to perform writes.');
    }
    console.log('═══════════════════════════════════════════════════════════════════');
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
