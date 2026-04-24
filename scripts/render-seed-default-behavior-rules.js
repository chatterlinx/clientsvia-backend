'use strict';

/**
 * ============================================================================
 * RENDER SHELL SEED — DEFAULT_BEHAVIOR_RULES → llmAgent.behaviorRules
 * ============================================================================
 *
 * PURPOSE:
 *   Seeds the platform-default Behavior Rules (the "onboarding-ready" wording
 *   defaults defined in `config/llmAgentDefaults.js → DEFAULT_BEHAVIOR_RULES`)
 *   into `company.aiAgentSettings.llmAgent.behaviorRules[]`. These are the
 *   8 edge-case handlers that shape how the agent words responses:
 *
 *     - br_frustrated_caller   (emotional)
 *     - br_angry_demanding     (emotional)
 *     - br_language_switching  (language)
 *     - br_multiple_intents    (intent)
 *     - br_topic_change        (intent)
 *     - br_wants_more_info     (flow)
 *     - br_specific_person     (flow)
 *     - br_unclear_response    (flow)
 *
 *   `composeSystemPrompt()` renders them into the LLM system prompt on every
 *   call under `=== BEHAVIOR RULES ===` — they are the canonical "wording
 *   samples" for how the agent should handle common edge cases.
 *
 * IDEMPOTENCY / SAFETY:
 *   - Rule IDs are the stable keys above (straight from DEFAULT_BEHAVIOR_RULES).
 *   - If a rule ID already exists on the tenant, it is LEFT UNTOUCHED.
 *     → An admin who edited the default wording keeps their edit. Always.
 *   - Only missing default rule IDs are inserted.
 *   - Admin-authored rules (any non-default ID) are preserved untouched.
 *   - Re-running the script is a no-op when all defaults are already present.
 *
 * MULTI-TENANT:
 *   Scoped per companyId argument, or `--all` across every tenant. Every
 *   company gets the SAME default rule set (platform policy, not tenant
 *   content). Individual edits per tenant remain safe.
 *
 * USAGE — Render Shell:
 *   node scripts/render-seed-default-behavior-rules.js <companyId>
 *
 *   Example (Penguin Air):
 *     node scripts/render-seed-default-behavior-rules.js 68e3f77a9d623b8058c700c4
 *
 *   To seed every tenant that has an LLM agent at all:
 *     node scripts/render-seed-default-behavior-rules.js --all
 *
 *   Dry run (report what would change without writing):
 *     node scripts/render-seed-default-behavior-rules.js <companyId> --dry-run
 *     node scripts/render-seed-default-behavior-rules.js --all --dry-run
 *
 * VERIFY:
 *   After running, open services.html → Behavior tab → Behavior Rules card.
 *   The 8 default rules appear with filter chips:
 *     Emotional 2 · Language 1 · Intent 2 · Flow 3
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

// Single source of truth — the const lives in config, the seed just mirrors it.
const { DEFAULT_BEHAVIOR_RULES } = require(path.resolve(__dirname, '..', 'config', 'llmAgentDefaults.js'));

const NOW = new Date();

// ─────────────────────────────────────────────────────────────────────────────
// SEED CORE
// ─────────────────────────────────────────────────────────────────────────────

async function seedCompany(db, companyId, { dryRun = false } = {}) {
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

  const label    = company.companyName || companyId;
  const existing = company.aiAgentSettings?.llmAgent?.behaviorRules || [];
  const existingIds = new Set(existing.map(r => r.id));

  // Only add defaults that are NOT already present — never clobber admin edits.
  const toAdd = DEFAULT_BEHAVIOR_RULES
    .filter(def => !existingIds.has(def.id))
    .map(def => ({
      id:        def.id,
      title:     def.title,
      rule:      def.rule,
      category:  def.category,
      enabled:   def.enabled !== false,
      isDefault: true,
      priority:  typeof def.priority === 'number' ? def.priority : 0,
      createdAt: NOW,
      updatedAt: NOW,
    }));

  if (toAdd.length === 0) {
    console.log(`  ℹ️   ${label}: all ${DEFAULT_BEHAVIOR_RULES.length} defaults already present — nothing to add.`);
    return { skipped: true, reason: 'already_seeded' };
  }

  // Append defaults at end; priority field drives display order in the UI.
  const merged = [...existing, ...toAdd];

  if (dryRun) {
    console.log(`  🧪  DRY RUN — ${label}: would add ${toAdd.length} rule(s): ${toAdd.map(r => r.id).join(', ')}`);
    console.log(`       Preserved existing rules: ${existing.length}`);
    return { skipped: false, added: toAdd.length, preserved: existing.length, dryRun: true };
  }

  await db.collection('companiesCollection').updateOne(
    { _id: companyObjId },
    {
      $set: {
        'aiAgentSettings.llmAgent.behaviorRules': merged,
        'aiAgentSettings.llmAgent.updatedAt':     NOW,
      },
    }
  );

  // Count by category for a useful confirmation line
  const byCategory = toAdd.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {});
  const catLine = Object.entries(byCategory)
    .map(([c, n]) => `${c}: ${n}`)
    .join('  |  ');

  console.log(`  ✅  ${label}: added ${toAdd.length} default rule(s)`);
  console.log(`       ${catLine}`);
  console.log(`       Preserved existing rules: ${existing.length}`);

  return { skipped: false, added: toAdd.length, preserved: existing.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const allMode = args.includes('--all');
  // Positional args are anything that isn't a recognized flag.
  const positional = args.filter(a => !a.startsWith('--'));
  const companyIdArg = positional[0];

  // Need either --all OR a companyId. Having neither is a usage error.
  if (!allMode && !companyIdArg) {
    console.error('');
    console.error('❌  Usage: node scripts/render-seed-default-behavior-rules.js <companyId|--all> [--dry-run]');
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
  console.log('  🌱  Seed DEFAULT_BEHAVIOR_RULES → llmAgent.behaviorRules');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Defaults to seed: ${DEFAULT_BEHAVIOR_RULES.length} rule(s) from config/llmAgentDefaults.js`);
  if (dryRun) console.log('  Mode: DRY RUN — no writes will be performed');
  console.log('');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('  ✅  MongoDB connected');

  const db = client.db('clientsvia');

  let targets = [];
  if (allMode) {
    // Seed every tenant. Limit projection to ids + name for fast scan.
    const companies = await db.collection('companiesCollection').find(
      {},
      { projection: { _id: 1, companyName: 1 } }
    ).toArray();
    targets = companies.map(c => String(c._id));
    console.log(`  Targets (--all): ${targets.length} companies\n`);
  } else {
    try {
      new ObjectId(companyIdArg);
    } catch {
      console.error(`❌  Invalid companyId format: "${companyIdArg}"`);
      await client.close();
      process.exit(1);
    }
    targets = [companyIdArg];
    console.log(`  Target: ${companyIdArg}\n`);
  }

  if (targets.length === 0) {
    console.log('  ℹ️   No companies matched — nothing to seed.\n');
    await client.close();
    return;
  }

  const results = { seeded: 0, skipped: 0, errors: 0, totalAdded: 0 };
  for (const cid of targets) {
    try {
      const r = await seedCompany(db, cid, { dryRun });
      if (r.skipped) {
        results.skipped++;
      } else {
        results.seeded++;
        results.totalAdded += (r.added || 0);
      }
    } catch (err) {
      console.error(`  ❌  Error seeding ${cid}: ${err.message}`);
      results.errors++;
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Summary: ${results.seeded} seeded (${results.totalAdded} rules added), ${results.skipped} skipped, ${results.errors} errors`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');
  if (!dryRun) {
    console.log('  ✅  Done. Verify in services.html → Behavior tab → Behavior Rules.');
  } else {
    console.log('  🧪  Dry run complete — re-run without --dry-run to write changes.');
  }
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('❌  Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
