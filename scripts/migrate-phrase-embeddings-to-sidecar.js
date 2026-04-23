'use strict';

/**
 * ============================================================================
 * MIGRATION — Move inline callerPhrases[].embedding → PhraseEmbedding sidecar
 * ============================================================================
 *
 * WHY:
 *   Inline per-phrase embeddings pushed large containers (e.g. No Cooling at
 *   ~3,000 phrases) past MongoDB's 16 MB document ceiling, causing BSONObj
 *   size validation failures on save. Sidecar pattern keeps each phrase in
 *   its own small document so the container itself stays under 1 MB.
 *
 * WHAT THIS DOES:
 *   1. Scan companyknowledgecontainers
 *   2. For every section.callerPhrases[] with an inline `embedding` array,
 *      upsert (containerId, phraseText) into the phraseembeddings collection
 *   3. Unset the inline embedding field from the container doc
 *   4. Idempotent — safe to re-run. Upserts are keyed on (containerId, text);
 *      unset is a no-op if already gone.
 *
 * USAGE (Render Shell — MONGODB_URI already in env):
 *   node scripts/migrate-phrase-embeddings-to-sidecar.js
 *   node scripts/migrate-phrase-embeddings-to-sidecar.js --dry        # no writes
 *   node scripts/migrate-phrase-embeddings-to-sidecar.js --company=ID # single tenant
 *
 * SAFETY:
 *   - Dry-run prints what WOULD move without touching the DB
 *   - Writes use `ordered:false` bulkWrite so one bad row doesn't abort a batch
 *   - The $unset on the container is the last step — if it fails, the sidecar
 *     already has the vectors, so subsequent runs still converge
 *   - Normalization (trim + lowercase) matches PhraseEmbeddingService
 *
 * ============================================================================
 */

const { MongoClient } = require('mongodb');

const DRY_RUN       = process.argv.includes('--dry');
const COMPANY_ARG   = process.argv.find(a => a.startsWith('--company='));
const SPECIFIC_CO   = COMPANY_ARG ? COMPANY_ARG.split('=')[1] : null;
const CHUNK         = 500;  // bulkWrite chunk size — keeps wire payload ~2 MB

function normalizeText(text) {
  if (!text) return '';
  return String(text).trim().toLowerCase();
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Run this inside Render Shell.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  console.log('[migrate] connected');

  try {
    const db = client.db('clientsvia');
    const containers = db.collection('companyknowledgecontainers');
    const sidecar    = db.collection('phraseembeddings');

    const query = SPECIFIC_CO ? { companyId: SPECIFIC_CO } : {};
    const cursor = containers.find(query, {
      // Project just what we need — inline embeddings can be big so stream them
      projection: {
        _id:                                1,
        companyId:                          1,
        title:                              1,
        'sections._id':                     1,
        'sections.callerPhrases.text':      1,
        'sections.callerPhrases.embedding': 1,
      },
    });

    let scanned       = 0;
    let containersTouched = 0;
    let totalUpserts   = 0;
    let totalSkipped   = 0;
    let totalUnset     = 0;

    while (await cursor.hasNext()) {
      const c = await cursor.next();
      scanned++;

      const companyId   = c.companyId ? String(c.companyId) : null;
      const containerId = c._id;
      if (!companyId) {
        console.warn(`[migrate] container ${containerId} has no companyId — skipping`);
        continue;
      }

      // Collect all (text, vec, sectionId) triples that are inline
      const ops  = [];
      const seen = new Set();
      let inlineCount = 0;

      for (const section of (c.sections || [])) {
        for (const phrase of (section.callerPhrases || [])) {
          const text = normalizeText(phrase?.text);
          const vec  = Array.isArray(phrase?.embedding) ? phrase.embedding : null;
          if (!text || !vec || !vec.length) continue;

          inlineCount++;
          if (seen.has(text)) { totalSkipped++; continue; }
          seen.add(text);

          ops.push({
            updateOne: {
              filter: { containerId, phraseText: text },
              update: {
                $set: {
                  companyId,
                  containerId,
                  phraseText: text,
                  embedding:  vec,
                  sectionId:  section._id || null,
                  updatedAt:  new Date(),
                },
                $setOnInsert: { createdAt: new Date() },
              },
              upsert: true,
            },
          });
        }
      }

      if (!ops.length) continue;
      containersTouched++;

      console.log(`[migrate] ${c.title || containerId} — ${ops.length} unique phrases (${inlineCount} inline total)`);

      if (DRY_RUN) continue;

      // 1. Upsert into sidecar in chunks
      for (let i = 0; i < ops.length; i += CHUNK) {
        const slice = ops.slice(i, i + CHUNK);
        const res = await sidecar.bulkWrite(slice, { ordered: false });
        totalUpserts += (res.upsertedCount || 0) + (res.modifiedCount || 0);
      }

      // 2. Unset the inline embedding fields on every callerPhrase in the
      //    container. We use a pipeline-style update to walk the array safely.
      const unsetRes = await containers.updateOne(
        { _id: containerId },
        [
          {
            $set: {
              sections: {
                $map: {
                  input: { $ifNull: ['$sections', []] },
                  as:    'sec',
                  in: {
                    $mergeObjects: [
                      '$$sec',
                      {
                        callerPhrases: {
                          $map: {
                            input: { $ifNull: ['$$sec.callerPhrases', []] },
                            as:    'p',
                            in: {
                              // Recreate the phrase subdoc without `embedding`
                              $arrayToObject: {
                                $filter: {
                                  input: { $objectToArray: '$$p' },
                                  as:    'kv',
                                  cond:  { $ne: ['$$kv.k', 'embedding'] },
                                },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      );
      if (unsetRes.modifiedCount) totalUnset++;
    }

    console.log('');
    console.log('==========================================');
    console.log(`  MIGRATION ${DRY_RUN ? '(DRY RUN)' : 'COMPLETE'}`);
    console.log('==========================================');
    console.log(`  containers scanned:    ${scanned}`);
    console.log(`  containers touched:    ${containersTouched}`);
    console.log(`  phrase rows upserted:  ${totalUpserts}`);
    console.log(`  duplicate texts skip:  ${totalSkipped}`);
    console.log(`  containers unset-ed:   ${totalUnset}`);
    console.log('==========================================');
    if (DRY_RUN) {
      console.log('  DRY RUN — no writes performed. Re-run without --dry to apply.');
    }
  } finally {
    await client.close();
    console.log('[migrate] disconnected');
  }
}

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
