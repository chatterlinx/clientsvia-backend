/**
 * ============================================================================
 * FORENSIC INVESTIGATION: Where Are The 5 Fake Trigger Cards?
 * ============================================================================
 * 
 * The production system is loading 5 trigger cards that DO NOT exist in the
 * official 42-trigger export. This script finds where they're stored.
 * 
 * USAGE:
 *   node scripts/findFakeTriggers.js
 * 
 * ============================================================================
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const fs = require('fs');

const Company = require('../models/v2Company');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const GlobalTrigger = require('../models/GlobalTrigger');
const CompanyTriggerSettings = require('../models/CompanyTriggerSettings');
const GlobalTriggerGroup = require('../models/GlobalTriggerGroup');

const PENGUIN_ID = '68e3f77a9d623b8058c700c4';
const FAKE_IDS = [
  'pricing.service_call',
  'problem.thermostat',
  'problem.not_cooling',
  'problem.system_not_running',
  'problem.water_leak'
];

async function investigate() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI not set in environment');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected\n');

  console.log('═'.repeat(80));
  console.log('FORENSIC INVESTIGATION: Where Are The 5 Fake Triggers?');
  console.log('═'.repeat(80));
  console.log();
  console.log('Target Company: Penguin Air');
  console.log('Company ID:', PENGUIN_ID);
  console.log();
  console.log('Fake Trigger IDs:');
  FAKE_IDS.forEach((id, i) => console.log(`  ${i+1}. ${id}`));
  console.log();

  let foundSource = null;
  let foundCount = 0;

  // ──────────────────────────────────────────────────────────────────────────
  // SOURCE 1: Legacy playbook.rules (in-document array)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('🔍 SOURCE 1: company.aiAgentSettings.agent2.discovery.playbook.rules');
  console.log('─'.repeat(80));
  
  const company = await Company.findById(PENGUIN_ID);
  
  if (!company) {
    console.log('❌ Company not found!');
    process.exit(1);
  }
  
  const legacyCards = company?.aiAgentSettings?.agent2?.discovery?.playbook?.rules || [];
  
  console.log(`Found ${legacyCards.length} cards in playbook.rules`);
  
  if (legacyCards.length > 0) {
    console.log('\nCards in playbook.rules:');
    
    const matches = [];
    legacyCards.forEach((card, i) => {
      const cardId = card.id || card.ruleId || card.triggerId || 'NO_ID';
      const isFake = FAKE_IDS.includes(cardId);
      const marker = isFake ? '🎯 MATCH!' : '';
      console.log(`  ${i+1}. ${cardId.padEnd(40)} ${card.label || 'NO_LABEL'} ${marker}`);
      if (isFake) matches.push(cardId);
    });
    
    console.log(`\nMatches: ${matches.length} / 5 fake cards found here`);
    
    if (matches.length === 5) {
      console.log('\n✅ ALL 5 FAKE CARDS FOUND IN playbook.rules!');
      console.log('📋 DIAGNOSIS: Legacy in-document triggers are loading');
      console.log('🔧 ROOT CAUSE: TriggerService is falling back to playbook.rules');
      foundSource = 'playbook.rules';
      foundCount = matches.length;
      
      // Create backup
      const backupDir = path.join(__dirname, '../backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupFile = path.join(backupDir, `penguin-legacy-triggers-${Date.now()}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(legacyCards, null, 2));
      console.log(`\n💾 Backup saved: ${backupFile}`);
    } else if (matches.length > 0) {
      console.log(`\n⚠️  PARTIAL MATCH: ${matches.length} / 5 found here`);
      console.log('   Other cards must be in another source');
    }
  } else {
    console.log('   playbook.rules is empty or does not exist');
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // SOURCE 2: CompanyLocalTrigger collection
  // ──────────────────────────────────────────────────────────────────────────
  console.log('🔍 SOURCE 2: CompanyLocalTrigger collection (MongoDB)');
  console.log('─'.repeat(80));
  
  const localTriggers = await CompanyLocalTrigger.find({ 
    companyId: PENGUIN_ID 
  }).lean();
  
  console.log(`Found ${localTriggers.length} local triggers in collection`);
  
  if (localTriggers.length > 0) {
    console.log('\nLocal triggers:');
    
    const matches = [];
    localTriggers.forEach((t, i) => {
      const isFake = FAKE_IDS.includes(t.ruleId);
      const marker = isFake ? '🎯 MATCH!' : '';
      console.log(`  ${i+1}. ${(t.ruleId || 'NO_ID').padEnd(40)} ${t.label || 'NO_LABEL'} ${marker}`);
      if (isFake) matches.push(t.ruleId);
    });
    
    console.log(`\nMatches: ${matches.length} / 5 fake cards found here`);
    
    if (matches.length === 5) {
      console.log('\n✅ ALL 5 FAKE CARDS FOUND IN CompanyLocalTrigger!');
      console.log('📋 DIAGNOSIS: Old local triggers in database');
      console.log('🔧 ACTION: Delete these and assign official library');
      if (!foundSource) {
        foundSource = 'CompanyLocalTrigger';
        foundCount = matches.length;
      }
      
      // Create backup
      const backupDir = path.join(__dirname, '../backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupFile = path.join(backupDir, `penguin-local-triggers-${Date.now()}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(localTriggers, null, 2));
      console.log(`\n💾 Backup saved: ${backupFile}`);
    } else if (matches.length > 0) {
      console.log(`\n⚠️  PARTIAL MATCH: ${matches.length} / 5 found here`);
    }
  } else {
    console.log('   No local triggers in collection');
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // SOURCE 3: GlobalTrigger collection (orphaned)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('🔍 SOURCE 3: GlobalTrigger collection (orphaned records)');
  console.log('─'.repeat(80));
  
  const orphans = await GlobalTrigger.find({
    ruleId: { $in: FAKE_IDS }
  }).lean();
  
  console.log(`Found ${orphans.length} orphaned global triggers`);
  
  if (orphans.length > 0) {
    console.log('\nOrphaned global triggers:');
    orphans.forEach((t, i) => {
      console.log(`  ${i+1}. ${t.ruleId}`);
      console.log(`     groupId: ${t.groupId || 'NOT SET'}`);
      console.log(`     state: ${t.state}`);
      console.log(`     enabled: ${t.enabled}`);
    });
    
    if (!foundSource) {
      foundSource = 'GlobalTrigger (orphaned)';
      foundCount = orphans.length;
    }
  } else {
    console.log('   No orphaned global triggers found');
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK: CompanyTriggerSettings
  // ──────────────────────────────────────────────────────────────────────────
  console.log('🔍 CompanyTriggerSettings');
  console.log('─'.repeat(80));
  
  const settings = await CompanyTriggerSettings.findOne({ 
    companyId: PENGUIN_ID 
  }).lean();
  
  if (!settings) {
    console.log('❌ CompanyTriggerSettings document DOES NOT EXIST');
    console.log('   This needs to be created!');
  } else {
    console.log('✅ CompanyTriggerSettings exists');
    console.log(`   activeGroupId: ${settings.activeGroupId || 'NOT SET ❌'}`);
    console.log(`   strictMode: ${settings.strictMode !== false ? 'true (DEFAULT)' : 'false'}`);
    console.log(`   disabledGlobalTriggerIds: ${settings.disabledGlobalTriggerIds?.length || 0}`);
    console.log(`   partialOverrides: ${settings.partialOverrides ? settings.partialOverrides.size : 0}`);
    
    if (!settings.activeGroupId) {
      console.log('\n⚠️  NO activeGroupId — this is why global triggers are not loading!');
    }
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK: Official Trigger Group
  // ──────────────────────────────────────────────────────────────────────────
  console.log('🔍 Official Trigger Group (hvac-master-v1)');
  console.log('─'.repeat(80));
  
  const officialGroup = await GlobalTriggerGroup.findOne({ 
    groupId: 'hvac-master-v1' 
  });
  
  if (!officialGroup) {
    console.log('❌ GlobalTriggerGroup "hvac-master-v1" DOES NOT EXIST');
    console.log('   The official library has NEVER been seeded!');
    console.log('🔧 ACTION: Run: node scripts/seedTriggerGroupV1.js');
  } else {
    console.log('✅ GlobalTriggerGroup exists');
    console.log(`   groupId: ${officialGroup.groupId}`);
    console.log(`   name: ${officialGroup.name}`);
    console.log(`   publishedVersion: ${officialGroup.publishedVersion}`);
    console.log(`   isDraft: ${officialGroup.isDraft}`);
    console.log(`   triggerCount: ${officialGroup.triggerCount}`);
    console.log(`   createdAt: ${officialGroup.createdAt}`);
    
    if (officialGroup.publishedVersion === 0) {
      console.log('\n⚠️  Group exists but is NOT PUBLISHED (draft mode)');
      console.log('   Global triggers will NOT load until published!');
    }
    
    // Check actual trigger count
    const publishedCount = await GlobalTrigger.countDocuments({
      groupId: 'hvac-master-v1',
      state: 'published'
    });
    
    const draftCount = await GlobalTrigger.countDocuments({
      groupId: 'hvac-master-v1',
      state: 'draft'
    });
    
    console.log(`\n   Triggers in DB:`);
    console.log(`     Published: ${publishedCount}`);
    console.log(`     Draft: ${draftCount}`);
    
    if (publishedCount === 0) {
      console.log('\n❌ ZERO published triggers found!');
      console.log('   Group exists but has no trigger records');
      console.log('🔧 ACTION: Run: node scripts/seedTriggerGroupV1.js');
    } else if (publishedCount < 40) {
      console.log(`\n⚠️  Only ${publishedCount} published triggers (expected 42-43)`);
      console.log('   Some triggers may be missing from seed');
    } else {
      console.log(`\n✅ ${publishedCount} published triggers available`);
    }
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // FINAL DIAGNOSIS
  // ──────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(80));
  console.log('FINAL DIAGNOSIS');
  console.log('═'.repeat(80));
  console.log();
  
  if (foundSource) {
    console.log(`✅ FAKE TRIGGERS FOUND IN: ${foundSource}`);
    console.log(`   Count: ${foundCount} / 5`);
    console.log();
  } else {
    console.log('❌ FAKE TRIGGERS NOT FOUND IN ANY SOURCE');
    console.log('   This is very strange — they are loading from somewhere!');
    console.log();
  }
  
  // Build remediation steps
  const steps = [];
  
  if (!officialGroup) {
    steps.push({
      num: steps.length + 1,
      action: 'Seed the official trigger library',
      command: 'node scripts/seedTriggerGroupV1.js',
      critical: true
    });
  } else if (!officialGroup.publishedVersion || officialGroup.publishedVersion === 0) {
    steps.push({
      num: steps.length + 1,
      action: 'Publish the trigger group',
      command: 'Use admin UI or MongoDB update',
      critical: true
    });
  } else {
    const publishedCount = await GlobalTrigger.countDocuments({
      groupId: 'hvac-master-v1',
      state: 'published'
    });
    if (publishedCount === 0) {
      steps.push({
        num: steps.length + 1,
        action: 'Seed triggers (group exists but no trigger records)',
        command: 'node scripts/seedTriggerGroupV1.js',
        critical: true
      });
    }
  }
  
  if (foundSource === 'playbook.rules') {
    steps.push({
      num: steps.length + 1,
      action: 'Clear legacy playbook.rules',
      command: 'node scripts/clearLegacyTriggers.js (needs to be created)',
      critical: true
    });
  }
  
  if (foundSource === 'CompanyLocalTrigger') {
    steps.push({
      num: steps.length + 1,
      action: 'Delete fake local triggers',
      command: 'node scripts/deleteFakeLocalTriggers.js (needs to be created)',
      critical: true
    });
  }
  
  if (!settings || !settings.activeGroupId) {
    steps.push({
      num: steps.length + 1,
      action: 'Assign official group to Penguin Air',
      command: 'node scripts/assignOfficialLibrary.js (needs to be created)',
      critical: true
    });
  }
  
  steps.push({
    num: steps.length + 1,
    action: 'Clear trigger cache',
    command: 'TriggerService.invalidateCacheForCompany(...)',
    critical: true
  });
  
  steps.push({
    num: steps.length + 1,
    action: 'Make test call and verify 42+ triggers load',
    command: 'Check Call Console → TRIGGER_POOL_SOURCE event',
    critical: true
  });
  
  console.log('REMEDIATION STEPS:');
  console.log('─'.repeat(80));
  steps.forEach(step => {
    const marker = step.critical ? '🔴 CRITICAL' : '○';
    console.log(`${marker} ${step.num}. ${step.action}`);
    console.log(`   → ${step.command}`);
    console.log();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ADDITIONAL CONTEXT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(80));
  console.log('ADDITIONAL CONTEXT');
  console.log('═'.repeat(80));
  console.log();
  
  // Check how many companies have this problem
  const allCompanies = await Company.find({
    'aiAgentSettings.agent2.discovery.playbook.rules': { 
      $exists: true, 
      $not: { $size: 0 } 
    }
  }).select('_id businessName aiAgentSettings.agent2.discovery.playbook.rules');
  
  console.log(`Companies with legacy playbook.rules: ${allCompanies.length}`);
  if (allCompanies.length > 0) {
    console.log('\nFirst 10 companies with legacy triggers:');
    allCompanies.slice(0, 10).forEach((c, i) => {
      const count = c.aiAgentSettings?.agent2?.discovery?.playbook?.rules?.length || 0;
      console.log(`  ${i+1}. ${(c.businessName || c._id.toString()).padEnd(30)} ${count} legacy cards`);
    });
    if (allCompanies.length > 10) {
      console.log(`  ... and ${allCompanies.length - 10} more`);
    }
    console.log();
    console.log(`⚠️  This is a SYSTEMIC ISSUE affecting ${allCompanies.length} companies!`);
  }
  
  // Check how many have activeGroupId set
  const withGroups = await CompanyTriggerSettings.countDocuments({
    activeGroupId: { $exists: true, $ne: null }
  });
  
  const totalCompanies = await Company.countDocuments({});
  
  console.log();
  console.log(`Companies with activeGroupId assigned: ${withGroups} / ${totalCompanies}`);
  console.log(`Companies WITHOUT activeGroupId: ${totalCompanies - withGroups} ❌`);
  
  if (withGroups === 0) {
    console.log('\n❌ ZERO companies have official library assigned!');
    console.log('   This is a complete deployment failure');
  }
  
  console.log();
  console.log('═'.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('═'.repeat(80));
  
  await mongoose.disconnect();
}

investigate().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
