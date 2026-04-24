'use strict';

/**
 * ============================================================================
 * RENDER SHELL MIGRATION — Standalone Behavior Card → llmAgent.behaviorRules
 * ============================================================================
 *
 * PURPOSE:
 *   Migrates a company's standalone `discovery_flow` Behavior Card (the ONLY
 *   standalone BC type ever consumed by runtime — KCDiscoveryRunner L3770)
 *   into `company.aiAgentSettings.llmAgent.behaviorRules[]`, which the
 *   services.html Behavior tab edits and `composeSystemPrompt()` injects on
 *   every LLM call (broader coverage than Engine Hub's KC-fallback-only path).
 *
 *   This migration is the additive half of the Engine Hub nuke. It runs
 *   BEFORE the code nuke so any admin-tuned BC content lands safely in the
 *   new home. The standalone BC document in `behaviorCards` is left intact
 *   (reversible) — the code nuke deletes it later if desired.
 *
 * IDEMPOTENCY:
 *   Rule IDs are derived as `stdbc:discovery_flow:do:N`, `stdbc:discovery_flow:doNot:N`,
 *   `stdbc:discovery_flow:tone`. Re-running the script updates text on
 *   existing IDs, never duplicates. Rules with any other ID (admin-authored)
 *   are untouched.
 *
 * MULTI-TENANT:
 *   Scoped to the companyId argument. Zero cross-tenant reads/writes.
 *
 * USAGE — Render Shell:
 *   node scripts/render-migrate-standalone-bc-to-llmagent.js <companyId>
 *
 *   Example (Penguin Air):
 *     node scripts/render-migrate-standalone-bc-to-llmagent.js 68e3f77a9d623b8058c700c4
 *
 *   To run against every tenant that has a discovery_flow BC:
 *     node scripts/render-migrate-standalone-bc-to-llmagent.js --all
 *
 * VERIFY:
 *   After running, open services.html → Behavior tab → Behavior Rules card.
 *   Migrated rules appear with category='flow', titles like
 *   "Discovery flow — DO #1", "Discovery flow — DO NOT #1", "Discovery flow — Tone".
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

const NOW = new Date();

// ─────────────────────────────────────────────────────────────────────────────
// RULE BUILDERS — stable IDs for idempotent upsert
// ─────────────────────────────────────────────────────────────────────────────

function buildRuleFromDo(text, index) {
  return {
    id:        `stdbc:discovery_flow:do:${index}`,
    title:     `Discovery flow — DO #${index + 1}`,
    rule:      `DO: ${String(text).trim()}`,
    category:  'flow',
    enabled:   true,
    isDefault: false,
    priority:  100 + index,   // After isDefault=false admin rules, before custom overrides
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildRuleFromDoNot(text, index) {
  return {
    id:        `stdbc:discovery_flow:doNot:${index}`,
    title:     `Discovery flow — DO NOT #${index + 1}`,
    rule:      `DO NOT: ${String(text).trim()}`,
    category:  'flow',
    enabled:   true,
    isDefault: false,
    priority:  200 + index,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildRuleFromTone(tone) {
  return {
    id:        'stdbc:discovery_flow:tone',
    title:     'Discovery flow — Tone',
    rule:      `TONE: ${String(tone).trim()}`,
    category:  'flow',
    enabled:   true,
    isDefault: false,
    priority:  10,   // Tone surfaces first
    createdAt: NOW,
    updatedAt: NOW,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION CORE
// ─────────────────────────────────────────────────────────────────────────────

async function migrateCompany(db, companyId) {
  const companyObjId = new ObjectId(companyId);

  const company = await db.collection('companiesCollection')
    .findOne(
      { _id: companyObjId },
      { projection: { companyName: 1, 'aiAgentSettings.llmAgent.behaviorRules': 1 } }
    );

  if (!company) {
    console.log(`  ⚠️   Company not found — skipped: ${companyId}`);
    return { skipped: true, reason: 'company_not_found' };
  }

  const bc = await db.collection('behaviorCards').findOne({
    companyId,                               // String (matches seed script)
    type:           'standalone',
    standaloneType: 'discovery_flow',
  });

  if (!bc) {
    console.log(`  ℹ️   No discovery_flow BC found for ${company.companyName || companyId} — skipped`);
    return { skipped: true, reason: 'no_standalone_bc' };
  }

  console.log(`  📘  Found BC "${bc.name || 'Discovery Flow'}" for ${company.companyName || companyId}`);

  // Build migration rules
  const migrated = [];
  if (bc.tone) migrated.push(buildRuleFromTone(bc.tone));

  const doRules = Array.isArray(bc.rules?.do) ? bc.rules.do : [];
  doRules.forEach((text, i) => { if (text && text.trim()) migrated.push(buildRuleFromDo(text, i)); });

  const doNotRules = Array.isArray(bc.rules?.doNot) ? bc.rules.doNot : [];
  doNotRules.forEach((text, i) => { if (text && text.trim()) migrated.push(buildRuleFromDoNot(text, i)); });

  if (migrated.length === 0) {
    console.log(`  ℹ️   BC has no content to migrate — skipped`);
    return { skipped: true, reason: 'bc_empty' };
  }

  // Merge with existing rules (preserve admin-authored, update migrated by ID)
  const existing = company.aiAgentSettings?.llmAgent?.behaviorRules || [];
  const migratedIds = new Set(migrated.map(r => r.id));
  const preservedExisting = existing.filter(r => !migratedIds.has(r.id));

  // For migrated rules that already exist, preserve createdAt
  const existingById = new Map(existing.map(r => [r.id, r]));
  const mergedMigrated = migrated.map(r => {
    const prev = existingById.get(r.id);
    if (prev) {
      return { ...r, createdAt: prev.createdAt || r.createdAt };
    }
    return r;
  });

  const mergedRules = [...preservedExisting, ...mergedMigrated];

  // Write back (dot-notation $set — never replace the whole object)
  await db.collection('companiesCollection').updateOne(
    { _id: companyObjId },
    {
      $set: {
        'aiAgentSettings.llmAgent.behaviorRules': mergedRules,
        'aiAgentSettings.llmAgent.updatedAt':     NOW,
      },
    }
  );

  const added   = mergedMigrated.filter(m => !existingById.has(m.id)).length;
  const updated = mergedMigrated.filter(m =>  existingById.has(m.id)).length;

  console.log(`  ✅  Migrated: ${mergedMigrated.length} rule(s) (${added} added, ${updated} updated)`);
  console.log(`       Tone rules: ${bc.tone ? 1 : 0}  |  DO: ${doRules.filter(t => t?.trim()).length}  |  DO NOT: ${doNotRules.filter(t => t?.trim()).length}`);
  console.log(`       Preserved admin rules: ${preservedExisting.length}`);

  return { skipped: false, added, updated, total: mergedRules.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('');
    console.error('❌  Usage: node scripts/render-migrate-standalone-bc-to-llmagent.js <companyId|--all>');
    console.error('');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌  MONGODB_URI not set. Run this in Render Shell where env vars are available.');
    process.exit(1);
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  🔄  Migrate Standalone BC (discovery_flow) → llmAgent.behaviorRules');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('  ✅  MongoDB connected');

  const db = client.db('clientsvia');

  let targets = [];
  if (arg === '--all') {
    // Find every company that has a discovery_flow BC
    const bcDocs = await db.collection('behaviorCards').find(
      { type: 'standalone', standaloneType: 'discovery_flow' },
      { projection: { companyId: 1 } }
    ).toArray();
    targets = [...new Set(bcDocs.map(d => d.companyId).filter(Boolean))];
    console.log(`  Targets (--all): ${targets.length} companies with discovery_flow BC\n`);
  } else {
    // Validate ObjectId format
    try {
      new ObjectId(arg);
    } catch {
      console.error(`❌  Invalid companyId format: "${arg}"`);
      await client.close();
      process.exit(1);
    }
    targets = [arg];
    console.log(`  Target: ${arg}\n`);
  }

  if (targets.length === 0) {
    console.log('  ℹ️   No companies matched — nothing to migrate.\n');
    await client.close();
    return;
  }

  const results = { migrated: 0, skipped: 0, errors: 0 };
  for (const cid of targets) {
    try {
      const r = await migrateCompany(db, cid);
      if (r.skipped) results.skipped++;
      else results.migrated++;
    } catch (err) {
      console.error(`  ❌  Error migrating ${cid}: ${err.message}`);
      results.errors++;
    }
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Summary: ${results.migrated} migrated, ${results.skipped} skipped, ${results.errors} errors`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  ✅  Done. Verify in services.html → Behavior tab → Behavior Rules.');
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('❌  Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
