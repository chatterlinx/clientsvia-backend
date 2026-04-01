/**
 * =============================================================================
 * FIX: Service Call KC — Penguin Air
 * =============================================================================
 *
 * PROBLEM:
 *   Two orphaned/stale KC containers are competing with the real "Service Call"
 *   KC (mongoId: 69ca7c7ae8bb1e062b2dbc54) and winning keyword scoring:
 *
 *   1. "Service Call & Diagnostic Fee" — seeded by seed-knowledge-containers-penguin-air.js
 *      Has $89 hardcoded. No daType. No kcId. Priority=45.
 *
 *   2. "What Happens During a Service Call — What to Expect" — created via admin UI.
 *      No kcId. Has $89 hardcoded. Beats the real KC on keyword scoring.
 *
 * FIX:
 *   a) Deactivate both orphaned containers.
 *   b) Resolve {reg_diagnostic_fee} placeholder in the real KC sections
 *      (set to $99 per sampleResponse in the KC file).
 *   c) Print a summary of what changed.
 *
 * RENDER SHELL USAGE:
 *   node scripts/fix-kc-service-call-penguin-air.js
 *
 * NOTE: This script is idempotent — safe to run multiple times.
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

// The real KC the user configured via services.html
const REAL_KC_ID  = new ObjectId('69ca7c7ae8bb1e062b2dbc54');

// The resolved value for {reg_diagnostic_fee} — matches sampleResponse in the KC
const RESOLVED_FEE = '$99';

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db   = client.db(DB_NAME);
  const coll = db.collection(COLL);

  console.log('=== KC Service Call Fix — Penguin Air ===\n');

  // ── Step 0: Show all active containers for diagnosis ──────────────────────
  console.log('--- ALL active KC containers for Penguin Air ---');
  const allActive = await coll
    .find({ companyId: COMPANY_OID, isActive: true })
    .project({ title: 1, daType: 1, kcId: 1, priority: 1, keywords: 1 })
    .sort({ priority: 1 })
    .toArray();

  for (const c of allActive) {
    const kws = (c.keywords || []).slice(0, 4).join(', ');
    console.log(`  [${c.priority ?? '?'}] "${c.title}" | daType=${c.daType || 'NONE'} | kcId=${c.kcId || 'NONE'} | kws: ${kws}`);
  }
  console.log(`  Total active: ${allActive.length}\n`);

  // ── Step 1: Deactivate "Service Call & Diagnostic Fee" (seeded, $89 hardcoded) ──
  const r1 = await coll.updateOne(
    {
      companyId: COMPANY_OID,
      title: 'Service Call & Diagnostic Fee',
    },
    {
      $set: { isActive: false, updatedAt: new Date(), _deactivatedReason: 'Replaced by user-configured Service Call KC (69ca7c7ae8bb1e062b2dbc54)' }
    }
  );
  console.log(`Step 1 — Deactivate "Service Call & Diagnostic Fee": ${r1.matchedCount ? `DONE (matched=${r1.matchedCount}, modified=${r1.modifiedCount})` : 'NOT FOUND (already gone or not present)'}`);

  // ── Step 2: Deactivate "What Happens During a Service Call — What to Expect" ──
  const r2 = await coll.updateOne(
    {
      companyId: COMPANY_OID,
      title: /what happens during a service call/i,
    },
    {
      $set: { isActive: false, updatedAt: new Date(), _deactivatedReason: 'Orphaned admin-UI container — no kcId, hardcoded price, replaced by user-configured Service Call KC' }
    }
  );
  console.log(`Step 2 — Deactivate "What Happens During..." orphan: ${r2.matchedCount ? `DONE (matched=${r2.matchedCount}, modified=${r2.modifiedCount})` : 'NOT FOUND (already gone or title differs)'}`);

  // ── Step 3: Safety net — deactivate ANY other active container matching
  //            "service call" in title that is NOT the real KC and has no kcId ──
  const r3 = await coll.updateMany(
    {
      companyId: COMPANY_OID,
      _id:       { $ne: REAL_KC_ID },
      isActive:  true,
      kcId:      { $in: [null, undefined, ''] },
      title:     /service call/i,
    },
    {
      $set: { isActive: false, updatedAt: new Date(), _deactivatedReason: 'Safety net — service call container without kcId, superseded by real KC' }
    }
  );
  console.log(`Step 3 — Safety net (other unkeyed service-call containers): modified=${r3.modifiedCount}`);

  // ── Step 4: Fix {reg_diagnostic_fee} placeholder in the real KC sections ──
  const realKc = await coll.findOne({ _id: REAL_KC_ID });

  if (!realKc) {
    console.log(`\nStep 4 — Real KC not found at _id=${REAL_KC_ID}. Skipping placeholder fix.`);
  } else {
    console.log(`\nStep 4 — Fixing {reg_diagnostic_fee} in "${realKc.title}"...`);

    // Patch sections[] — replace {reg_diagnostic_fee} in content fields
    let changed = 0;
    const patchedSections = (realKc.sections || []).map(s => {
      if (s.content && s.content.includes('{reg_diagnostic_fee}')) {
        changed++;
        return { ...s, content: s.content.replace(/\{reg_diagnostic_fee\}/g, RESOLVED_FEE) };
      }
      return s;
    });

    // Also patch pq responseContext fields inside sections
    const patchedSections2 = patchedSections.map(s => {
      if (!s.preQualifyQuestion?.options) return s;
      const patchedOptions = s.preQualifyQuestion.options.map(opt => {
        if (opt.responseContext && opt.responseContext.includes('{reg_diagnostic_fee}')) {
          changed++;
          return { ...opt, responseContext: opt.responseContext.replace(/\{reg_diagnostic_fee\}/g, RESOLVED_FEE) };
        }
        return opt;
      });
      return { ...s, preQualifyQuestion: { ...s.preQualifyQuestion, options: patchedOptions } };
    });

    if (changed > 0) {
      await coll.updateOne(
        { _id: REAL_KC_ID },
        { $set: { sections: patchedSections2, updatedAt: new Date() } }
      );
      console.log(`  Replaced {reg_diagnostic_fee} → "${RESOLVED_FEE}" in ${changed} field(s).`);
    } else {
      console.log(`  No {reg_diagnostic_fee} placeholders found — already resolved or different format.`);
    }
  }

  // ── Step 5: Print the updated state of the real KC ────────────────────────
  if (realKc) {
    const updated = await coll.findOne({ _id: REAL_KC_ID }, { projection: { title: 1, daType: 1, kcId: 1, isActive: 1, sections: 1, keywords: 1, priority: 1 } });
    console.log('\nStep 5 — Real KC current state:');
    console.log(`  title:    "${updated.title}"`);
    console.log(`  isActive: ${updated.isActive}`);
    console.log(`  daType:   ${updated.daType || 'NONE'}`);
    console.log(`  kcId:     ${updated.kcId || 'NONE'}`);
    console.log(`  priority: ${updated.priority}`);
    console.log(`  keywords: ${(updated.keywords || []).join(', ')}`);
    console.log(`  sections:`);
    for (const s of (updated.sections || [])) {
      console.log(`    [${s.label}] ${s.content?.substring(0, 80)}...`);
    }
  }

  // ── Step 6: Invalidate BridgeService Redis cache ──────────────────────────
  // The bridge is cached in Redis as bridge:{companyId} with no TTL.
  // Deactivating containers doesn't auto-invalidate it — we must do it manually.
  // Next lookup will trigger a fresh build from MongoDB.
  try {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const Redis = require('ioredis');
      const redisClient = new Redis(redisUrl);
      const bridgeKey = `bridge:${COMPANY_ID}`;
      const deleted = await redisClient.del(bridgeKey);
      console.log(`\nStep 6 — Bridge cache invalidated (key="${bridgeKey}", deleted=${deleted})`);
      redisClient.disconnect();
    } else {
      console.log('\nStep 6 — REDIS_URL not set — bridge cache not invalidated (will rebuild on next call)');
    }
  } catch (redisErr) {
    console.log(`\nStep 6 — Redis invalidation failed (non-fatal): ${redisErr.message}`);
  }

  // ── Step 7: Print final active container list ──────────────────────────────
  console.log('\n--- Final active containers ---');
  const finalActive = await coll
    .find({ companyId: COMPANY_OID, isActive: true })
    .project({ title: 1, daType: 1, kcId: 1, priority: 1 })
    .sort({ priority: 1 })
    .toArray();
  for (const c of finalActive) {
    console.log(`  [${c.priority ?? '?'}] "${c.title}" | daType=${c.daType || 'NONE'} | kcId=${c.kcId || 'NONE'}`);
  }
  console.log(`  Total active: ${finalActive.length}`);

  console.log('\n⚠️  NOTE: The real KC "Service Call" has daType=SERVICE_DETAILS_QUERY.');
  console.log('   If UAP fires PRICING_QUERY for "how much is a service call", the bridge');
  console.log('   will miss and fall to keyword scoring — which WILL find it (score ~7).');
  console.log('   Alternatively, change daType to PRICING_QUERY via services.html if you');
  console.log('   want the bridge to fast-path directly to it.');

  await client.close();
  console.log('\n✅ Done.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
