/**
 * =============================================================================
 * NUKE: Orphaned KC Containers — Penguin Air
 * =============================================================================
 *
 * RULE:
 *   Any KC container WITHOUT a kcId was created by a seed script, not the
 *   admin UI. These are orphans — they have hardcoded prices, stale content,
 *   and no linkage to the services.html admin system.
 *
 *   kcId is set atomically at POST time (routes/admin/companyKnowledge.js).
 *   Seeded containers bypass the POST route → no kcId → orphan.
 *
 * ACTION:
 *   Hard-delete every KC container for Penguin Air that has no kcId.
 *   UI-created containers (kcId set) are untouched.
 *   Bridge cache is invalidated so next call gets a clean build.
 *
 * RENDER SHELL USAGE:
 *   node scripts/nuke-orphan-kc-containers-penguin-air.js
 *
 * Safe: prints a full list BEFORE deleting. Exits with count of nuked docs.
 * =============================================================================
 */

'use strict';

const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const COMPANY_ID  = '68e3f77a9d623b8058c700c4'; // Penguin Air
const COMPANY_OID = new ObjectId(COMPANY_ID);
const DB_NAME     = 'clientsvia';
const COLL        = 'companyKnowledgeContainers';

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db   = client.db(DB_NAME);
  const coll = db.collection(COLL);

  console.log('=== NUKE Orphaned KC Containers — Penguin Air ===\n');

  // ── Step 1: Show EVERYTHING currently in MongoDB for this company ──────────
  const all = await coll
    .find({ companyId: COMPANY_OID })
    .project({ title: 1, kcId: 1, isActive: 1, daType: 1, priority: 1, createdAt: 1 })
    .sort({ kcId: 1, priority: 1 })
    .toArray();

  console.log(`Total containers in MongoDB (active + inactive): ${all.length}`);
  console.log('\n--- ORPHANS (no kcId — will be DELETED) ---');
  const orphans = all.filter(c => !c.kcId);
  for (const c of orphans) {
    console.log(`  ❌ "${c.title}" | active=${c.isActive} | daType=${c.daType || 'none'} | _id=${c._id}`);
  }
  console.log(`  Orphan count: ${orphans.length}`);

  console.log('\n--- KEEPERS (have kcId — will NOT be touched) ---');
  const keepers = all.filter(c => !!c.kcId);
  for (const c of keepers) {
    console.log(`  ✅ "${c.title}" | kcId=${c.kcId} | active=${c.isActive} | daType=${c.daType || 'none'}`);
  }
  console.log(`  Keeper count: ${keepers.length}`);

  if (orphans.length === 0) {
    console.log('\n✅ No orphans found — nothing to delete.');
    await client.close();
    return;
  }

  // ── Step 2: Hard-delete all containers without a kcId ─────────────────────
  console.log(`\nDeleting ${orphans.length} orphan(s)...`);
  const result = await coll.deleteMany({
    companyId: COMPANY_OID,
    $or: [
      { kcId: { $exists: false } },
      { kcId: null },
      { kcId: '' },
    ],
  });
  console.log(`Deleted: ${result.deletedCount}`);

  // ── Step 3: Invalidate BridgeService Redis cache ───────────────────────────
  try {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const Redis = require('ioredis');
      const r = new Redis(redisUrl);
      const bridgeKey = `bridge:${COMPANY_ID}`;
      const deleted = await r.del(bridgeKey);
      console.log(`\nBridge cache invalidated (key="${bridgeKey}", deleted=${deleted})`);
      r.disconnect();
    } else {
      console.log('\nREDIS_URL not set — bridge will rebuild on next call automatically.');
    }
  } catch (e) {
    console.log(`\nRedis invalidation failed (non-fatal): ${e.message}`);
  }

  // ── Step 4: Show final state ───────────────────────────────────────────────
  console.log('\n--- FINAL STATE (surviving containers) ---');
  const survivors = await coll
    .find({ companyId: COMPANY_OID })
    .project({ title: 1, kcId: 1, isActive: 1, daType: 1, priority: 1, keywords: 1 })
    .sort({ priority: 1 })
    .toArray();

  for (const c of survivors) {
    const kws = (c.keywords || []).slice(0, 5).join(', ');
    console.log(`  [${c.priority ?? '?'}] "${c.title}" | kcId=${c.kcId} | active=${c.isActive} | daType=${c.daType || 'none'}`);
    if (kws) console.log(`       kws: ${kws}`);
  }
  console.log(`\nTotal surviving: ${survivors.length}`);
  console.log(`  Active:   ${survivors.filter(c => c.isActive).length}`);
  console.log(`  Inactive: ${survivors.filter(c => !c.isActive).length}`);

  await client.close();
  console.log('\n✅ Done. All orphaned KC containers nuked.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
