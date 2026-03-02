/**
 * ============================================================================
 * TRIGGER GROUP MISMATCH FIX
 * ============================================================================
 *
 * Diagnoses and repairs the following known issues:
 *
 *  1. Stale GlobalTrigger drafts with malformed triggerId (no groupId:: prefix)
 *     — created by old broken promote-to-global code before the V131 fix.
 *
 *  2. Orphaned GlobalTriggerGroup entries that no company is using
 *     and that contain only draft/malformed triggers.
 *
 *  3. Reports the full truth: company settings, groups, published counts.
 *
 * USAGE:
 *   node scripts/fixTriggerGroupMismatch.js             (dry run — shows what would change)
 *   node scripts/fixTriggerGroupMismatch.js --execute   (apply fixes)
 *
 * ============================================================================
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');

const COMPANY_ID    = '68e3f77a9d623b8058c700c4'; // Penguin Air
const DRY_RUN       = !process.argv.includes('--execute');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  if (!uri) {
    console.error('❌  MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(DRY_RUN ? '  DRY RUN — no changes will be written' : '  LIVE — changes WILL be applied');
  console.log('════════════════════════════════════════════════════════════\n');

  // ── 1. Company trigger settings ─────────────────────────────────────────────
  const settings = await db.collection('companyTriggerSettings')
    .findOne({ companyId: COMPANY_ID }, { projection: { companyId:1, activeGroupId:1, strictMode:1 } });

  console.log('── Company Trigger Settings ──────────────────────────────────');
  console.log(JSON.stringify(settings, null, 2));
  const activeGroupId = settings?.activeGroupId || null;
  console.log(`\n  Runtime will load global triggers from group: "${activeGroupId || '(none)'}"\n`);

  // ── 2. All global trigger groups ────────────────────────────────────────────
  const groups = await db.collection('globalTriggerGroups')
    .find({}, { projection: { groupId:1, name:1, publishedVersion:1, triggerCount:1, isDraft:1 } })
    .toArray();

  console.log('── GlobalTriggerGroups ───────────────────────────────────────');
  for (const g of groups) {
    const publishedCount = await db.collection('globalTriggers')
      .countDocuments({ groupId: g.groupId, state: 'published', isDeleted: { $ne: true } });
    const draftCount = await db.collection('globalTriggers')
      .countDocuments({ groupId: g.groupId, state: 'draft', isDeleted: { $ne: true } });

    const active = g.groupId === activeGroupId ? '  ← COMPANY IS USING THIS' : '';
    console.log(`  groupId: "${g.groupId}"  name: "${g.name}"  published: ${publishedCount}  draft: ${draftCount}  publishedVersion: ${g.publishedVersion}${active}`);
  }

  // ── 3. Malformed global trigger records ────────────────────────────────────
  // A properly formatted triggerId looks like: "groupId::ruleId"
  // Malformed = no "::" separator OR triggerId matches just a ruleId
  const allGlobalTriggers = await db.collection('globalTriggers')
    .find({ isDeleted: { $ne: true } }, { projection: { _id:1, groupId:1, ruleId:1, triggerId:1, state:1 } })
    .toArray();

  const malformed = allGlobalTriggers.filter(t => {
    if (!t.triggerId) return true;
    // Canonical format: groupId::ruleId  OR  groupId::ruleId::draft
    const parts = t.triggerId.split('::');
    return parts.length < 2;
  });

  console.log('\n── Malformed GlobalTrigger records (triggerId missing groupId:: prefix) ──');
  if (malformed.length === 0) {
    console.log('  ✅  None found');
  } else {
    malformed.forEach(t => {
      console.log(`  ❌  _id: ${t._id}  groupId: "${t.groupId}"  ruleId: "${t.ruleId}"  triggerId: "${t.triggerId}"  state: "${t.state}"`);
    });
  }

  // ── 4. Stale drafts in groups not assigned to any company ─────────────────
  const allActiveGroupIds = await db.collection('companyTriggerSettings')
    .distinct('activeGroupId');

  const unusedGroupIds = groups
    .map(g => g.groupId)
    .filter(gid => gid && !allActiveGroupIds.includes(gid));

  console.log('\n── Groups not assigned to any company ────────────────────────');
  if (unusedGroupIds.length === 0) {
    console.log('  ✅  None');
  } else {
    unusedGroupIds.forEach(gid => console.log(`  ⚠️   "${gid}"`));
  }

  // ── 5. Apply fixes ──────────────────────────────────────────────────────────
  if (malformed.length === 0 && unusedGroupIds.length === 0) {
    console.log('\n✅  No action needed. DB state is clean.\n');
    await mongoose.disconnect();
    return;
  }

  console.log('\n── Proposed Fixes ────────────────────────────────────────────');

  if (malformed.length > 0) {
    console.log(`  • Soft-delete ${malformed.length} malformed GlobalTrigger record(s) (wrong triggerId format, state=draft, old broken code)`);
  }

  if (DRY_RUN) {
    console.log('\n  ℹ️   DRY RUN — run with --execute to apply.\n');
    await mongoose.disconnect();
    return;
  }

  // Apply: soft-delete malformed records
  if (malformed.length > 0) {
    const ids = malformed.map(t => t._id);
    const result = await db.collection('globalTriggers').updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          isDeleted:     true,
          deletedAt:     new Date(),
          deletedBy:     'fix-script-trigger-group-mismatch',
          deletedReason: 'MALFORMED_TRIGGERID_FROM_OLD_BROKEN_PROMOTE_CODE'
        }
      }
    );
    console.log(`\n  ✅  Soft-deleted ${result.modifiedCount} malformed GlobalTrigger record(s)`);
  }

  // Recount triggerCounts on all groups
  for (const g of groups) {
    const publishedCount = await db.collection('globalTriggers')
      .countDocuments({ groupId: g.groupId, state: 'published', isDeleted: { $ne: true } });
    await db.collection('globalTriggerGroups').updateOne(
      { groupId: g.groupId },
      { $set: { triggerCount: publishedCount, updatedAt: new Date() } }
    );
    console.log(`  🔢  Updated "${g.groupId}" triggerCount → ${publishedCount}`);
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  COMPLETE');
  console.log('════════════════════════════════════════════════════════════');
  console.log('\n  NEXT: Refresh cache in the Agent Console or run:');
  console.log('  POST /api/company/68e3f77a9d623b8058c700c4/triggers/clear-cache\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌  Script failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
