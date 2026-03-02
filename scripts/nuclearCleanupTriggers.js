/**
 * ════════════════════════════════════════════════════════════════════════════
 * NUCLEAR CLEANUP: Eliminate ALL Fake/Legacy Triggers
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * PRE-LAUNCH SANITATION SCRIPT
 * 
 * WHAT THIS DOES:
 * 1. Backs up ALL legacy/fake trigger data to timestamped files
 * 2. DELETES all legacy playbook.rules from ALL companies
 * 3. DELETES all CompanyLocalTrigger records (fake development data)
 * 4. DELETES all orphaned GlobalTrigger records (not in hvac-master-v1)
 * 5. Seeds official HVAC Master V1 library (42 triggers)
 * 6. Publishes the library (version 1)
 * 7. Assigns official library to ALL companies
 * 8. Clears ALL trigger caches
 * 9. Verifies clean state
 * 
 * ⚠️  THIS IS IRREVERSIBLE (but backups are created)
 * 
 * USAGE:
 *   node scripts/nuclearCleanupTriggers.js
 * 
 * SAFETY:
 *   - Creates backups before any deletion
 *   - Logs every action
 *   - Verifies final state
 *   - Safe to run multiple times (idempotent)
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');

const Company = require('../models/Company');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const GlobalTrigger = require('../models/GlobalTrigger');
const GlobalTriggerGroup = require('../models/GlobalTriggerGroup');
const CompanyTriggerSettings = require('../models/CompanyTriggerSettings');

const GROUP_ID = 'hvac-master-v1';
const TRIGGERS_FILE = path.join(__dirname, '../docs/triggers-master-v1.json');
const BACKUP_DIR = path.join(__dirname, '../backups');

// Ensure backups directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const timestamp = Date.now();
const backupPrefix = `nuclear-cleanup-${timestamp}`;

async function nuclearCleanup() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI not set in environment');
    process.exit(1);
  }

  console.log('═'.repeat(80));
  console.log('☢️  NUCLEAR CLEANUP: TRIGGER SYSTEM SANITATION');
  console.log('═'.repeat(80));
  console.log();
  console.log('⚠️  WARNING: This will DELETE all legacy/fake trigger data');
  console.log('⚠️  Backups will be created in:', BACKUP_DIR);
  console.log();
  console.log('Connecting to MongoDB...');
  
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected\n');

  const stats = {
    companiesWithLegacy: 0,
    legacyCardsCleared: 0,
    localTriggersDeleted: 0,
    orphanedGlobalsDeleted: 0,
    companiesAssigned: 0,
    errors: []
  };

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 0: PRE-FLIGHT DIAGNOSTICS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 0: Pre-flight diagnostics');
  console.log('─'.repeat(80));
  
  const totalCompanies = await Company.countDocuments({});
  console.log(`Total companies in database: ${totalCompanies}`);
  
  if (totalCompanies > 1) {
    console.log('\n⚠️  WARNING: Found multiple companies in database');
    console.log('   This script will process ALL companies');
    console.log('   If you only want to clean Penguin Air, abort and modify script');
    console.log();
    console.log('   Press Ctrl+C to abort, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    console.log('✅ Only 1 company found (safe for pre-launch cleanup)');
  }
  console.log();
  
  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1: BACKUP ALL LEGACY DATA
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 1: Creating backups');
  console.log('─'.repeat(80));
  
  // Backup: Legacy playbook.rules from ALL companies
  const companiesWithLegacy = await Company.find({
    'aiAgentSettings.agent2.discovery.playbook.rules': { 
      $exists: true, 
      $not: { $size: 0 } 
    }
  }).lean();
  
  if (companiesWithLegacy.length > 0) {
    const legacyBackup = companiesWithLegacy.map(c => ({
      companyId: c._id.toString(),
      companyName: c.businessName || c.companyName,
      legacyTriggers: c.aiAgentSettings?.agent2?.discovery?.playbook?.rules || []
    }));
    
    const legacyBackupFile = path.join(BACKUP_DIR, `${backupPrefix}-legacy-playbook-rules.json`);
    fs.writeFileSync(legacyBackupFile, JSON.stringify(legacyBackup, null, 2));
    console.log(`✅ Backed up legacy playbook.rules from ${companiesWithLegacy.length} companies`);
    console.log(`   File: ${legacyBackupFile}`);
    stats.companiesWithLegacy = companiesWithLegacy.length;
  } else {
    console.log('   No legacy playbook.rules found (already clean)');
  }
  
  // Backup: All CompanyLocalTrigger records
  const allLocalTriggers = await CompanyLocalTrigger.find({}).lean();
  
  if (allLocalTriggers.length > 0) {
    const localBackupFile = path.join(BACKUP_DIR, `${backupPrefix}-company-local-triggers.json`);
    fs.writeFileSync(localBackupFile, JSON.stringify(allLocalTriggers, null, 2));
    console.log(`✅ Backed up ${allLocalTriggers.length} CompanyLocalTrigger records`);
    console.log(`   File: ${localBackupFile}`);
  } else {
    console.log('   No CompanyLocalTrigger records found');
  }
  
  // Backup: Orphaned GlobalTriggers (not in hvac-master-v1)
  const orphanedGlobals = await GlobalTrigger.find({
    $or: [
      { groupId: { $ne: GROUP_ID } },
      { groupId: { $exists: false } },
      { groupId: null }
    ]
  }).lean();
  
  if (orphanedGlobals.length > 0) {
    const orphanBackupFile = path.join(BACKUP_DIR, `${backupPrefix}-orphaned-global-triggers.json`);
    fs.writeFileSync(orphanBackupFile, JSON.stringify(orphanedGlobals, null, 2));
    console.log(`✅ Backed up ${orphanedGlobals.length} orphaned GlobalTrigger records`);
    console.log(`   File: ${orphanBackupFile}`);
  } else {
    console.log('   No orphaned GlobalTriggers found');
  }
  
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2: NUKE LEGACY PLAYBOOK.RULES (IN-DOCUMENT ARRAYS)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 2: Clearing legacy playbook.rules from ALL companies');
  console.log('─'.repeat(80));
  
  if (companiesWithLegacy.length > 0) {
    const bulkOps = companiesWithLegacy.map(c => ({
      updateOne: {
        filter: { _id: c._id },
        update: { 
          $set: { 
            'aiAgentSettings.agent2.discovery.playbook.rules': [] 
          }
        }
      }
    }));
    
    const clearResult = await Company.bulkWrite(bulkOps);
    console.log(`✅ Cleared playbook.rules from ${clearResult.modifiedCount} companies`);
    stats.legacyCardsCleared = companiesWithLegacy.reduce((sum, c) => 
      sum + (c.aiAgentSettings?.agent2?.discovery?.playbook?.rules?.length || 0), 0
    );
    console.log(`   Total legacy cards eliminated: ${stats.legacyCardsCleared}`);
  } else {
    console.log('   No legacy playbook.rules to clear (already clean)');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3: DELETE ALL CompanyLocalTrigger RECORDS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 3: Deleting ALL CompanyLocalTrigger records');
  console.log('─'.repeat(80));
  
  if (allLocalTriggers.length > 0) {
    const deleteLocalResult = await CompanyLocalTrigger.deleteMany({});
    console.log(`✅ Deleted ${deleteLocalResult.deletedCount} CompanyLocalTrigger records`);
    stats.localTriggersDeleted = deleteLocalResult.deletedCount;
  } else {
    console.log('   No CompanyLocalTrigger records to delete (already clean)');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4: DELETE ORPHANED GlobalTrigger RECORDS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 4: Deleting orphaned GlobalTrigger records');
  console.log('─'.repeat(80));
  
  if (orphanedGlobals.length > 0) {
    const deleteOrphanResult = await GlobalTrigger.deleteMany({
      $or: [
        { groupId: { $ne: GROUP_ID } },
        { groupId: { $exists: false } },
        { groupId: null }
      ]
    });
    console.log(`✅ Deleted ${deleteOrphanResult.deletedCount} orphaned GlobalTrigger records`);
    stats.orphanedGlobalsDeleted = deleteOrphanResult.deletedCount;
  } else {
    console.log('   No orphaned GlobalTriggers to delete (already clean)');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5: SEED OFFICIAL LIBRARY (HVAC Master V1)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 5: Seeding official HVAC Master V1 library');
  console.log('─'.repeat(80));
  
  // Check if already seeded
  let group = await GlobalTriggerGroup.findOne({ groupId: GROUP_ID });
  
  if (!group) {
    console.log('Creating GlobalTriggerGroup...');
    group = new GlobalTriggerGroup({
      groupId: GROUP_ID,
      name: 'HVAC Master V1',
      icon: '🌡️',
      description: 'Official HVAC trigger library with 42 triggers covering emergencies, diagnostics, maintenance, booking, and billing.',
      createdBy: 'nuclear-cleanup-script',
      isDraft: false,
      publishedVersion: 1,
      triggerCount: 0,  // Will update after seeding
      versionHistory: [{
        version: 1,
        triggerCount: 0,
        publishedAt: new Date(),
        publishedBy: 'nuclear-cleanup-script',
        changeLog: 'Initial seed from triggers-master-v1.json'
      }],
      auditLog: [{
        action: 'GROUP_CREATED',
        performedBy: 'nuclear-cleanup-script',
        performedAt: new Date(),
        details: { source: 'nuclear-cleanup', purpose: 'pre-launch-sanitation' }
      }]
    });
    await group.save();
    console.log(`✅ Created GlobalTriggerGroup: ${GROUP_ID}`);
  } else {
    console.log(`   Group already exists: ${GROUP_ID}`);
    console.log(`   publishedVersion: ${group.publishedVersion}`);
  }
  
  // Load official triggers from JSON
  const officialTriggers = require(TRIGGERS_FILE);
  console.log(`   Loaded ${officialTriggers.length} triggers from triggers-master-v1.json`);
  
  // Seed each trigger (draft + published)
  let created = 0;
  let updated = 0;
  
  for (const trigger of officialTriggers) {
    const ruleId = trigger.ruleId;
    if (!ruleId) {
      console.warn(`   ⚠️  Skipping trigger with no ruleId`);
      continue;
    }
    
    const triggerData = {
      groupId: GROUP_ID,
      triggerId: ruleId,
      ruleId: ruleId,
      label: trigger.label,
      priority: trigger.priority || 50,
      bucket: trigger.bucket || null,
      maxInputWords: trigger.maxInputWords || null,
      keywords: trigger.keywords || [],
      phrases: trigger.phrases || [],
      negativeKeywords: trigger.negativeKeywords || [],
      negativePhrases: trigger.negativePhrases || [],
      responseMode: trigger.responseMode || 'standard',
      answerText: trigger.answerText || '',
      audioUrl: trigger.audioUrl || '',
      followUpQuestion: trigger.followUpQuestion || '',
      followUpNextAction: trigger.followUpNextAction || '',
      llmFactPack: trigger.llmFactPack || null,
      enabled: true,
      createdBy: 'nuclear-cleanup-script',
      lastModifiedBy: 'nuclear-cleanup-script'
    };
    
    // Upsert draft version
    await GlobalTrigger.updateOne(
      { triggerId: ruleId, groupId: GROUP_ID, state: 'draft' },
      { $set: triggerData },
      { upsert: true }
    );
    
    // Upsert published version
    const result = await GlobalTrigger.updateOne(
      { triggerId: ruleId, groupId: GROUP_ID, state: 'published' },
      { $set: triggerData },
      { upsert: true }
    );
    
    if (result.upsertedCount > 0) {
      created++;
    } else if (result.modifiedCount > 0) {
      updated++;
    }
  }
  
  console.log(`✅ Seeded ${officialTriggers.length} triggers`);
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  
  // Update group trigger count
  await GlobalTriggerGroup.updateOne(
    { groupId: GROUP_ID },
    { 
      $set: { 
        triggerCount: officialTriggers.length,
        publishedVersion: 1,
        isDraft: false,
        lastPublishedAt: new Date()
      }
    }
  );
  console.log(`✅ Published group (version 1)`);
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6: ASSIGN OFFICIAL LIBRARY TO ALL COMPANIES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 6: Assigning official library to ALL companies');
  console.log('─'.repeat(80));
  
  const allCompanies = await Company.find({}).select('_id businessName companyName');
  console.log(`Found ${allCompanies.length} companies\n`);
  
  for (const company of allCompanies) {
    const companyId = company._id.toString();
    const name = company.businessName || company.companyName || companyId;
    
    try {
      await CompanyTriggerSettings.setActiveGroup(
        companyId,
        GROUP_ID,
        1,
        'nuclear-cleanup-script'
      );
      
      // Also ensure strictMode is enabled
      await CompanyTriggerSettings.updateOne(
        { companyId },
        { 
          $set: { 
            strictMode: true,
            strictModeSetAt: new Date(),
            strictModeSetBy: 'nuclear-cleanup-script'
          }
        },
        { upsert: true }
      );
      
      console.log(`✅ ${name}`);
      stats.companiesAssigned++;
      
    } catch (err) {
      console.error(`❌ ${name}: ${err.message}`);
      stats.errors.push({ companyId, name, error: err.message });
    }
  }
  
  console.log(`\n✅ Assigned official library to ${stats.companiesAssigned} / ${allCompanies.length} companies`);
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7: CLEAR ALL TRIGGER CACHES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 7: Clearing trigger caches');
  console.log('─'.repeat(80));
  
  const TriggerService = require('../services/engine/agent2/TriggerService');
  TriggerService.invalidateAllCache();
  console.log('✅ All trigger caches cleared');
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 8: VERIFY CLEAN STATE
  // ══════════════════════════════════════════════════════════════════════════
  console.log('STEP 8: Verifying clean state');
  console.log('─'.repeat(80));
  
  // Check for any remaining legacy
  const remainingLegacy = await Company.countDocuments({
    'aiAgentSettings.agent2.discovery.playbook.rules': { 
      $exists: true, 
      $not: { $size: 0 } 
    }
  });
  
  if (remainingLegacy > 0) {
    console.log(`❌ WARNING: ${remainingLegacy} companies still have playbook.rules!`);
  } else {
    console.log('✅ All legacy playbook.rules cleared');
  }
  
  // Check for any remaining CompanyLocalTriggers
  const remainingLocal = await CompanyLocalTrigger.countDocuments({});
  
  if (remainingLocal > 0) {
    console.log(`❌ WARNING: ${remainingLocal} CompanyLocalTrigger records still exist!`);
  } else {
    console.log('✅ All CompanyLocalTrigger records deleted');
  }
  
  // Verify official library
  const publishedCount = await GlobalTrigger.countDocuments({
    groupId: GROUP_ID,
    state: 'published'
  });
  
  if (publishedCount === officialTriggers.length) {
    console.log(`✅ Official library seeded: ${publishedCount} published triggers`);
  } else {
    console.log(`⚠️  Trigger count mismatch: ${publishedCount} / ${officialTriggers.length}`);
  }
  
  // Verify all companies have assignment
  const assignedCount = await CompanyTriggerSettings.countDocuments({
    activeGroupId: GROUP_ID
  });
  
  if (assignedCount === allCompanies.length) {
    console.log(`✅ All ${assignedCount} companies have official library assigned`);
  } else {
    console.log(`⚠️  Assignment incomplete: ${assignedCount} / ${allCompanies.length}`);
  }
  
  // Verify strict mode
  const strictModeCount = await CompanyTriggerSettings.countDocuments({
    strictMode: true
  });
  
  console.log(`✅ Strict mode enabled: ${strictModeCount} / ${assignedCount} companies`);
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  console.log('═'.repeat(80));
  console.log('CLEANUP SUMMARY');
  console.log('═'.repeat(80));
  console.log();
  console.log('✅ BACKUPS CREATED:');
  console.log(`   - Legacy playbook.rules: ${stats.companiesWithLegacy} companies`);
  console.log(`   - CompanyLocalTrigger: ${allLocalTriggers.length} records`);
  console.log(`   - Orphaned GlobalTriggers: ${orphanedGlobals.length} records`);
  console.log(`   - Location: ${BACKUP_DIR}`);
  console.log();
  console.log('✅ DATA DELETED:');
  console.log(`   - Legacy cards cleared: ${stats.legacyCardsCleared}`);
  console.log(`   - Local triggers deleted: ${stats.localTriggersDeleted}`);
  console.log(`   - Orphaned globals deleted: ${stats.orphanedGlobalsDeleted}`);
  console.log();
  console.log('✅ OFFICIAL LIBRARY:');
  console.log(`   - Group: ${GROUP_ID}`);
  console.log(`   - Published triggers: ${publishedCount}`);
  console.log(`   - Status: Published (version 1)`);
  console.log();
  console.log('✅ COMPANY ASSIGNMENTS:');
  console.log(`   - Companies assigned: ${stats.companiesAssigned}`);
  console.log(`   - Strict mode enabled: ${strictModeCount}`);
  console.log();
  
  if (stats.errors.length > 0) {
    console.log('❌ ERRORS:');
    stats.errors.forEach(e => {
      console.log(`   ${e.name}: ${e.error}`);
    });
    console.log();
  }
  
  console.log('═'.repeat(80));
  console.log('NEXT STEPS');
  console.log('═'.repeat(80));
  console.log();
  console.log('1. Make a test call to Penguin Air');
  console.log('2. Check Call Console → TRIGGER_POOL_SOURCE event');
  console.log('   Expected: total: 42, scopes: { GLOBAL: 42 }');
  console.log('3. Verify trigger match on "maintenance" and "cost" queries');
  console.log('4. Monitor for 24 hours to ensure no regressions');
  console.log();
  console.log('═'.repeat(80));
  console.log('☢️  NUCLEAR CLEANUP COMPLETE');
  console.log('═'.repeat(80));
  
  await mongoose.disconnect();
}

nuclearCleanup().catch(err => {
  console.error('❌ FATAL ERROR:', err);
  console.error(err.stack);
  process.exit(1);
});
