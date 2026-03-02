/**
 * ============================================================================
 * TRUTH TEST: Find The Exact Source of the 5 Fake Triggers
 * ============================================================================
 * 
 * Runs the 3 queries suggested by the advisor to definitively answer:
 * "Where are the 5 fake triggers stored?"
 * 
 * USAGE:
 *   node scripts/truthTestTriggers.js
 * 
 * QUERIES:
 *   1. CompanyTriggerSettings (check activeGroupId + strictMode)
 *   2. CompanyLocalTrigger (check for the 5 fake ruleIds)
 *   3. Company.aiAgentSettings.agent2.discovery.playbook.rules (legacy)
 * 
 * ============================================================================
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');

const Company = require('../models/Company');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const CompanyTriggerSettings = require('../models/CompanyTriggerSettings');

const PENGUIN_ID = '68e3f77a9d623b8058c700c4';
const FAKE_IDS = [
  'pricing.service_call',
  'problem.thermostat',
  'problem.not_cooling',
  'problem.system_not_running',
  'problem.water_leak'
];

async function truthTest() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI not set');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected\n');

  console.log('═'.repeat(80));
  console.log('TRUTH TEST: Finding The 5 Fake Triggers');
  console.log('═'.repeat(80));
  console.log();
  console.log('Company: Penguin Air');
  console.log('ID:', PENGUIN_ID);
  console.log();
  console.log('Looking for these 5 fake IDs:');
  FAKE_IDS.forEach((id, i) => console.log(`  ${i+1}. ${id}`));
  console.log();

  let source = null;
  let foundIds = [];

  // ══════════════════════════════════════════════════════════════════════════
  // QUERY 1: CompanyTriggerSettings
  // ══════════════════════════════════════════════════════════════════════════
  console.log('QUERY 1: CompanyTriggerSettings');
  console.log('─'.repeat(80));
  
  const settings = await CompanyTriggerSettings.findOne({ 
    companyId: PENGUIN_ID 
  }).lean();
  
  if (!settings) {
    console.log('❌ Document DOES NOT EXIST');
    console.log('   This is a critical missing piece!');
    console.log();
  } else {
    console.log('✅ Document exists');
    console.log(`   activeGroupId: ${settings.activeGroupId || 'null ❌'}`);
    console.log(`   strictMode: ${settings.strictMode !== false ? 'true' : 'false'}`);
    console.log(`   disabledGlobalTriggerIds: ${settings.disabledGlobalTriggerIds?.length || 0}`);
    console.log();
    
    if (!settings.activeGroupId) {
      console.log('🔍 FINDING: No activeGroupId assigned');
      console.log('   → Global triggers CANNOT load');
      console.log('   → System will fall back to local or legacy');
    }
    
    if (settings.strictMode !== false) {
      console.log('🔍 FINDING: Strict mode is ENABLED (default)');
      console.log('   → Legacy playbook.rules should be BLOCKED');
      console.log('   → But if pool ends up empty, there may be a fallback bug');
    }
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // QUERY 2: CompanyLocalTrigger
  // ══════════════════════════════════════════════════════════════════════════
  console.log('QUERY 2: CompanyLocalTrigger collection');
  console.log('─'.repeat(80));
  
  const localTriggers = await CompanyLocalTrigger.find({ 
    companyId: PENGUIN_ID 
  }).lean();
  
  console.log(`Found ${localTriggers.length} local triggers in collection`);
  
  if (localTriggers.length === 0) {
    console.log('   ✅ Collection is empty (clean)');
  } else {
    console.log();
    localTriggers.forEach((t, i) => {
      const isFake = FAKE_IDS.includes(t.ruleId);
      console.log(`  ${i+1}. ${t.ruleId.padEnd(40)} ${isFake ? '🎯 MATCH!' : ''}`);
      if (isFake) foundIds.push(t.ruleId);
    });
    
    if (foundIds.length > 0) {
      console.log();
      console.log(`✅ FOUND ${foundIds.length} / 5 fake triggers in CompanyLocalTrigger`);
      source = 'CompanyLocalTrigger';
    }
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // QUERY 3: Company.aiAgentSettings.agent2.discovery.playbook.rules
  // ══════════════════════════════════════════════════════════════════════════
  console.log('QUERY 3: company.aiAgentSettings.agent2.discovery.playbook.rules (legacy)');
  console.log('─'.repeat(80));
  
  const company = await Company.findById(PENGUIN_ID).lean();
  
  if (!company) {
    console.log('❌ Company not found!');
    await mongoose.disconnect();
    process.exit(1);
  }
  
  const legacyCards = company?.aiAgentSettings?.agent2?.discovery?.playbook?.rules || [];
  
  console.log(`Found ${legacyCards.length} cards in playbook.rules array`);
  
  if (legacyCards.length === 0) {
    console.log('   ✅ playbook.rules is empty (clean)');
  } else {
    console.log();
    const legacyMatches = [];
    legacyCards.forEach((card, i) => {
      const cardId = card.id || card.ruleId || card.triggerId || 'NO_ID';
      const isFake = FAKE_IDS.includes(cardId);
      console.log(`  ${i+1}. ${cardId.padEnd(40)} "${card.label || 'NO_LABEL'}" ${isFake ? '🎯 MATCH!' : ''}`);
      if (isFake) legacyMatches.push(cardId);
    });
    
    if (legacyMatches.length > 0) {
      console.log();
      console.log(`✅ FOUND ${legacyMatches.length} / 5 fake triggers in playbook.rules`);
      if (!source || legacyMatches.length > foundIds.length) {
        source = 'playbook.rules (legacy in-document array)';
        foundIds = legacyMatches;
      }
    }
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL VERDICT
  // ══════════════════════════════════════════════════════════════════════════
  console.log('═'.repeat(80));
  console.log('VERDICT');
  console.log('═'.repeat(80));
  console.log();
  
  if (!source) {
    console.log('❌ FAKE TRIGGERS NOT FOUND in any of the 3 sources!');
    console.log();
    console.log('This means they are:');
    console.log('  1. Hardcoded/default triggers in application code, OR');
    console.log('  2. Coming from a 4th source not checked, OR');
    console.log('  3. The call report is from an older deployment');
    console.log();
    console.log('🔧 NEXT STEP: Check application code for hardcoded default triggers');
    console.log('   Search for: "pricing.service_call" in codebase');
  } else {
    console.log(`✅ SOURCE IDENTIFIED: ${source}`);
    console.log(`   Found ${foundIds.length} / 5 fake trigger IDs`);
    console.log();
    console.log('Matched IDs:');
    foundIds.forEach(id => console.log(`   - ${id}`));
    console.log();
    
    // Provide specific cleanup command
    if (source.includes('playbook.rules')) {
      console.log('🔧 CLEANUP COMMAND:');
      console.log('   db.companies.updateOne(');
      console.log(`     { _id: ObjectId("${PENGUIN_ID}") },`);
      console.log('     { $set: { "aiAgentSettings.agent2.discovery.playbook.rules": [] } }');
      console.log('   )');
      console.log();
      console.log('   OR run: node scripts/nuclearCleanupTriggers.js');
    } else if (source.includes('CompanyLocalTrigger')) {
      console.log('🔧 CLEANUP COMMAND:');
      console.log('   db.companyLocalTriggers.deleteMany({ companyId: "' + PENGUIN_ID + '" })');
      console.log();
      console.log('   OR run: node scripts/nuclearCleanupTriggers.js');
    }
  }
  
  console.log();
  console.log('═'.repeat(80));
  console.log('ADDITIONAL FINDINGS');
  console.log('═'.repeat(80));
  console.log();
  
  // Show what's missing
  console.log('Configuration gaps:');
  if (!settings) {
    console.log('  ❌ No CompanyTriggerSettings document');
  } else if (!settings.activeGroupId) {
    console.log('  ❌ No activeGroupId assigned → official library cannot load');
  }
  
  if (legacyCards.length > 0) {
    console.log(`  ⚠️  ${legacyCards.length} legacy playbook.rules exist (should be 0)`);
  }
  
  if (localTriggers.length > 0) {
    console.log(`  ⚠️  ${localTriggers.length} CompanyLocalTrigger records exist`);
  }
  
  console.log();
  console.log('═'.repeat(80));
  console.log('RECOMMENDED ACTION');
  console.log('═'.repeat(80));
  console.log();
  console.log('Run nuclear cleanup to eliminate ALL legacy/fake data:');
  console.log('  node scripts/nuclearCleanupTriggers.js');
  console.log();
  console.log('This will:');
  console.log('  1. Backup all data');
  console.log('  2. Delete fake/legacy triggers from ALL sources');
  console.log('  3. Seed official 42-trigger library');
  console.log('  4. Assign to all companies');
  console.log('  5. Enable strict mode');
  console.log('  6. Verify clean state');
  console.log();
  
  await mongoose.disconnect();
  console.log('✅ Truth test complete');
}

truthTest().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
