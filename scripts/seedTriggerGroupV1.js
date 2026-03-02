/**
 * ============================================================================
 * SEED SCRIPT: HVAC Master Trigger Group V1
 * ============================================================================
 *
 * Imports docs/triggers-master-v1.json into the GlobalTrigger system as a
 * new GlobalTriggerGroup with all 42 triggers published and ready to assign.
 *
 * USAGE:
 *   node scripts/seedTriggerGroupV1.js
 *
 * WHAT IT DOES:
 *   1. Creates GlobalTriggerGroup: { groupId: 'hvac-master-v1', name: 'HVAC Master V1' }
 *   2. Creates one GlobalTrigger document per trigger (both draft and published)
 *   3. Sets publishedVersion: 1 on the group (makes it live immediately)
 *
 * IDEMPOTENT: Safe to run multiple times — uses upsert on triggerId + state.
 *
 * ASSIGN TO COMPANY:
 *   After seeding, go to Admin → Triggers → select "HVAC Master V1" group
 *   and assign it to your company. Then click "Refresh Cache".
 *
 * ============================================================================
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const GlobalTriggerGroup = require('../models/GlobalTriggerGroup');
const GlobalTrigger      = require('../models/GlobalTrigger');

const GROUP_ID      = 'hvac-master-v1';
const GROUP_NAME    = 'HVAC Master V1';
const GROUP_ICON    = '🌡️';
const GROUP_DESC    = 'Complete HVAC trigger library. 42 triggers covering emergencies, system failures, maintenance, booking, billing, and membership. Built with ScrabEngine contraction normalization and context-aware negative matching.';
const SEEDED_BY     = 'seed-script-v1';

const TRIGGERS_FILE = path.join(__dirname, '../docs/triggers-master-v1.json');

async function main() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI not set in environment. Add it to .env or set it before running:');
    console.error('   MONGODB_URI=mongodb+srv://... node scripts/seedTriggerGroupV1.js');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected\n');

  // Load trigger library
  const rawTriggers = require(TRIGGERS_FILE).filter(t => t.ruleId);
  console.log(`Loaded ${rawTriggers.length} triggers from triggers-master-v1.json\n`);

  // ── Step 1: Upsert the GlobalTriggerGroup ──────────────────────────────────
  let group = await GlobalTriggerGroup.findOne({ groupId: GROUP_ID });
  if (!group) {
    group = new GlobalTriggerGroup({
      groupId:     GROUP_ID,
      name:        GROUP_NAME,
      icon:        GROUP_ICON,
      description: GROUP_DESC,
      createdBy:   SEEDED_BY,
      isDraft:     false,
      publishedVersion: 1,
      triggerCount: rawTriggers.length,
      versionHistory: [{
        version:    1,
        triggerCount: rawTriggers.length,
        publishedAt: new Date(),
        publishedBy: SEEDED_BY,
        changeLog:  'Initial seed from triggers-master-v1.json'
      }],
      auditLog: [{
        action:      'GROUP_CREATED',
        performedBy: SEEDED_BY,
        performedAt: new Date(),
        details:     { source: 'seed-script', triggerCount: rawTriggers.length }
      }, {
        action:      'GROUP_PUBLISHED',
        performedBy: SEEDED_BY,
        performedAt: new Date(),
        details:     { version: 1 }
      }]
    });
    await group.save();
    console.log(`✅ Created GlobalTriggerGroup: ${GROUP_ID}`);
  } else {
    console.log(`ℹ️  Group already exists: ${GROUP_ID} (skipping group creation)`);
  }

  // ── Step 2: Upsert each trigger as both draft and published ─────────────────
  let created = 0; let updated = 0; let errors = [];

  for (const raw of rawTriggers) {
    const triggerId      = GlobalTrigger.generateTriggerId(GROUP_ID, raw.ruleId);
    const triggerIdDraft = `${triggerId}::draft`;

    const baseDoc = {
      groupId:          GROUP_ID,
      ruleId:           raw.ruleId,
      label:            raw.label || raw.ruleId,
      enabled:          raw.enabled !== false,
      priority:         typeof raw.priority === 'number' ? raw.priority : 50,
      keywords:         (raw.keywords || []).map(k => k.toLowerCase().trim()).filter(Boolean),
      phrases:          (raw.phrases  || []).map(p => p.toLowerCase().trim()).filter(Boolean),
      negativeKeywords: (raw.negativeKeywords || []).map(n => n.toLowerCase().trim()).filter(Boolean),
      negativePhrases:  (raw.negativePhrases  || []).map(p => p.toLowerCase().trim()).filter(Boolean),
      bucket:           raw.bucket || null,
      maxInputWords:    typeof raw.maxInputWords === 'number' ? raw.maxInputWords : undefined,
      responseMode:     raw.responseMode || 'standard',
      answerText:       raw.answerText   || '',
      audioUrl:         raw.audioUrl     || '',
      followUpQuestion: raw.followUpQuestion     || '',
      followUpNextAction: raw.followUpNextAction || 'CONTINUE',
      createdBy:        SEEDED_BY,
      updatedBy:        SEEDED_BY,
      isDeleted:        false
    };

    // Upsert PUBLISHED version
    try {
      const publishedId = triggerId;
      const existing = await GlobalTrigger.findOne({ triggerId: publishedId, state: 'published' });
      if (existing) {
        await GlobalTrigger.updateOne(
          { triggerId: publishedId, state: 'published' },
          { $set: { ...baseDoc, state: 'published', triggerId: publishedId } }
        );
        updated++;
      } else {
        await GlobalTrigger.create({ ...baseDoc, state: 'published', triggerId: publishedId });
        created++;
      }
    } catch (e) {
      errors.push({ ruleId: raw.ruleId, state: 'published', error: e.message });
    }

    // Upsert DRAFT version
    try {
      const draftId = triggerIdDraft;
      const existingDraft = await GlobalTrigger.findOne({ groupId: GROUP_ID, ruleId: raw.ruleId, state: 'draft' });
      if (existingDraft) {
        await GlobalTrigger.updateOne(
          { groupId: GROUP_ID, ruleId: raw.ruleId, state: 'draft' },
          { $set: { ...baseDoc, state: 'draft' } }
        );
      } else {
        await GlobalTrigger.create({ ...baseDoc, state: 'draft', triggerId: draftId });
      }
    } catch (e) {
      // Draft upsert failure is non-critical (published is what matters for runtime)
      if (!e.message.includes('duplicate')) {
        errors.push({ ruleId: raw.ruleId, state: 'draft', error: e.message });
      }
    }
  }

  // ── Step 3: Update group trigger count ────────────────────────────────────
  const publishedCount = await GlobalTrigger.countDocuments({ groupId: GROUP_ID, state: 'published', isDeleted: { $ne: true } });
  await GlobalTriggerGroup.updateOne({ groupId: GROUP_ID }, { $set: { triggerCount: publishedCount, publishedVersion: 1 } });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════');
  console.log('SEED COMPLETE');
  console.log('════════════════════════════════════════');
  console.log(`  Group:     ${GROUP_NAME} (${GROUP_ID})`);
  console.log(`  Created:   ${created} new triggers`);
  console.log(`  Updated:   ${updated} existing triggers`);
  console.log(`  Published: ${publishedCount} triggers live`);
  if (errors.length > 0) {
    console.log(`\n⚠️  ${errors.length} error(s):`);
    errors.forEach(e => console.log(`   - ${e.ruleId} [${e.state}]: ${e.error}`));
  } else {
    console.log('\n✅ No errors');
  }
  console.log('\nNEXT STEPS:');
  console.log('  1. Go to Admin → Triggers');
  console.log('  2. Select "HVAC Master V1" from the group dropdown');
  console.log('  3. Assign it to your company via Company Trigger Settings');
  console.log('  4. Click "Refresh Cache" to activate immediately');
  console.log('════════════════════════════════════════\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Seed script failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
