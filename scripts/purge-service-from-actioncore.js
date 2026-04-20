/**
 * purge-service-from-actioncore.js — Remove misclassified actionCore patterns
 *
 * Run on Render Shell (dry-run first):
 *   node scripts/purge-service-from-actioncore.js            # dry-run, shows what would change
 *   node scripts/purge-service-from-actioncore.js --apply    # actually writes
 *
 * WHY:
 *   The CueExtractor uses longest-match-wins substring matching with no POS
 *   awareness. "service" was seeded into actionCore via CUE_STARTER_PATTERNS
 *   (routes/admin/globalshare.js) as an action verb. But in HVAC-speak, "service"
 *   is overwhelmingly a NOUN ("service call", "service fee", "service plan",
 *   "service area"). Because "service" (7 chars) sorts ahead of shorter
 *   financial verbs like "pay" (3 chars), and the extractor breaks on first
 *   match, it wins the actionCore slot in phrases like:
 *       "do I have to pay for a service call"
 *   → actionCore = "service" (misleading noun match)
 *   "pay" is in the dictionary (via seed-cue-obligation-repeat.js) but is
 *   NEVER evaluated because "service" short-circuits the loop.
 *
 *   The verb intent of "servicing a unit" is already covered by check / repair
 *   / fix / diagnose / tune up / maintain / inspect. Removing "service" from
 *   actionCore costs us nothing and uncovers the real action verb underneath.
 *
 * WHAT IT DOES:
 *   Removes any cuePhrases entry where pattern === "service" AND token === "actionCore"
 *   from adminsettings.globalHub.phraseIntelligence.cuePhrases.
 *   Also flushes the in-memory PhraseReducerService cache via direct DB write +
 *   forces a redeploy afterwards (Marc: push any no-op commit to trigger Render).
 *
 * COMPANION CHANGE:
 *   routes/admin/globalshare.js — "service" removed from CUE_STARTER_PATTERNS
 *   so re-running the starter-set loader won't re-introduce it.
 */

'use strict';

const { MongoClient } = require('mongodb');

const TARGETS = [
  { pattern: 'service', token: 'actionCore' },
  // Add more ambiguous noun-as-verb patterns here if discovered in future audits.
  // Candidates to watch (kept for now, decide with data):
  //   { pattern: 'estimate', token: 'actionCore' }  // noun in "get an estimate"
  //   { pattern: 'repair',   token: 'actionCore' }  // noun in "need a repair"
];

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  purge-service-from-actioncore  (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
  console.log('══════════════════════════════════════════════════════════════');

  const client = await MongoClient.connect(uri);
  const db  = client.db('clientsvia');
  const col = db.collection('adminsettings');

  const doc = await col.findOne({});
  if (!doc) { console.error('No adminsettings doc found'); process.exit(1); }

  const pi = doc.globalHub?.phraseIntelligence || {};
  const existing = Array.isArray(pi.cuePhrases) ? pi.cuePhrases : [];

  console.log(`\nCurrent cuePhrases total: ${existing.length}`);

  // Find matches
  const matchKey = t => `${(t.pattern || '').toLowerCase().trim()}|${t.token}`;
  const targetKeys = new Set(TARGETS.map(matchKey));

  const toRemove = [];
  const toKeep   = [];
  for (const cp of existing) {
    const key = matchKey(cp);
    if (targetKeys.has(key)) {
      toRemove.push(cp);
    } else {
      toKeep.push(cp);
    }
  }

  console.log(`\nWould remove ${toRemove.length} pattern(s):`);
  if (toRemove.length === 0) {
    console.log('  (none found — already clean, or patterns never seeded)');
  } else {
    for (const cp of toRemove) {
      console.log(`  - { pattern: "${cp.pattern}", token: "${cp.token}" }`);
    }
  }
  console.log(`\nKeeping ${toKeep.length} pattern(s).`);

  // Show actionCore patterns that remain (for sanity)
  const remainingAction = toKeep.filter(c => c.token === 'actionCore').map(c => c.pattern).sort();
  console.log(`\nRemaining actionCore patterns (${remainingAction.length}):`);
  console.log('  ' + remainingAction.join(', '));

  if (!APPLY) {
    console.log('\n── DRY-RUN — no writes performed. Re-run with --apply to commit. ──');
    await client.close();
    return;
  }

  if (toRemove.length === 0) {
    console.log('\nNothing to remove. Exiting without write.');
    await client.close();
    return;
  }

  const result = await col.updateOne(
    { _id: doc._id },
    {
      $set: {
        'globalHub.phraseIntelligence.cuePhrases':            toKeep,
        'globalHub.phraseIntelligenceUpdatedAt':              new Date().toISOString(),
        'globalHub.phraseIntelligenceUpdatedBy':              'purge-service-from-actioncore.js',
      },
    }
  );

  console.log(`\n✅ Updated. matched=${result.matchedCount} modified=${result.modifiedCount}`);
  console.log(`   Removed ${toRemove.length} pattern(s). cuePhrases total now: ${toKeep.length}`);
  console.log('\n⚠️  IMPORTANT: PhraseReducerService has a 5-min in-memory cache.');
  console.log('   Push a no-op commit to force Render redeploy, OR wait 5 minutes,');
  console.log('   before running replay / placing test calls.');

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
